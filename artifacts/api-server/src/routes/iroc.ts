import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { db, pool } from "@workspace/db";
import {
  irocAppUsers,
  irocCustomers,
  irocProducts,
  irocProductGroups,
  irocInventoryLots,
  irocInvoices,
  irocInvoiceItems,
  irocNotifications,
  irocLeads,
  irocTrainingOffers,
  irocOrders,
  irocOrderShipments,
  irocCustomerWebsiteLinks,
  websiteCustomersTable,
  trainingRegistrationsTable,
  settingsTable,
  trainedDoctorsTable,
  doctorCertificationsTable,
} from "@workspace/db";
import {
  eq,
  desc,
  sum,
  count,
  lte,
  sql,
  and,
  or,
  like,
  inArray,
  isNull,
  isNotNull,
  ne,
} from "drizzle-orm";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import { PDFDocument as PdfLibDocument } from "pdf-lib";
import QRCode from "qrcode";
import { sendEmail } from "../lib/email";
import { appendImpressumSignature } from "../lib/impressum-signature";
import { recipientLanguageForCountry } from "../lib/recipient-language";
import { generateUniqueReorderCode } from "../lib/reorder-code";
import {
  createSendcloudShipment,
  findSendcloudShipmentByExternalReference,
  getSendcloudRates,
  normalizeSendcloudCountryCode,
  nextPreferredPickupDate,
  SendcloudRequestError,
} from "../lib/sendcloud";
import { invoiceInsuranceCoverageGap, invoiceInsuranceValue, isDirectInvoiceShipmentEligible, isPortalSourceOrder, resolveInvoiceShipmentAddress } from "../lib/shipment-rules";
import { calculateInvoiceTotals } from "../lib/invoice-totals";
import { buildFacturXInvoiceInput, calculateFacturXTotals, embedFacturXInvoice } from "../lib/facturx-invoice";
import { inferCategory } from "../lib/infer-category";
import { getDefaultPostopFormConfig, isValidInvoiceDate, resolvePaymentTerms } from "@workspace/spirecut-shared";
import { archiveRemovedProcedureLabels } from "./patient-extras.js";
import {
  analyzeLegacyCustomerTitleCleanup,
  normalizeWebsiteCustomerNameFields,
  stripLegacyCustomerTitlePrefix,
  stripWebsiteCustomerTitlePrefix,
} from "../lib/website-customer-name";
import {
  IrocLoginBody,
  UpdateIrocMeBody,
  ChangeIrocPasswordBody,
  CreateIrocCustomerBody,
  UpdateIrocCustomerBody,
  CreateIrocProductBody,
  UpdateIrocProductBody,
  CreateIrocProductGroupBody,
  UpdateIrocProductGroupBody,
  AdjustIrocProductStockBody,
  CreateIrocInvoiceBody,
  UpdateIrocInvoiceStatusBody,
  CreateIrocInvoiceCorrectionBody,
  CreateLeadTrainingOfferPdfBody,
  CreateLeadTrainingOfferPdfParams,
  GetIrocTrainingOfferParams,
  computeDefaultVatNote,
} from "@workspace/api-zod";

const router: IRouter = Router();

const POSTOP_PREFIX_IROC = "patient_postop_";

/**
 * Persists the only safe bridge between the two independent customer ID spaces
 * and assigns any matching legacy invoices to the website customer.
 */
type CustomerLinkExecutor = Pick<typeof db, "insert" | "select" | "update">;

class CustomerLinkConflictError extends Error {}
class TrainingQualificationError extends Error {}

async function linkLegacyCustomerToWebsiteCustomerWith(
  tx: CustomerLinkExecutor,
  irocCustomerId: number,
  websiteCustomerId: number,
): Promise<boolean> {
  await tx
    .insert(irocCustomerWebsiteLinks)
    .values({ irocCustomerId, websiteCustomerId })
    .onConflictDoNothing();

  const [websiteLink] = await tx
    .select({ irocCustomerId: irocCustomerWebsiteLinks.irocCustomerId })
    .from(irocCustomerWebsiteLinks)
    .where(eq(irocCustomerWebsiteLinks.websiteCustomerId, websiteCustomerId));
  const [legacyLink] = await tx
    .select({ websiteCustomerId: irocCustomerWebsiteLinks.websiteCustomerId })
    .from(irocCustomerWebsiteLinks)
    .where(eq(irocCustomerWebsiteLinks.irocCustomerId, irocCustomerId));

  if (
    websiteLink?.irocCustomerId !== irocCustomerId ||
    legacyLink?.websiteCustomerId !== websiteCustomerId
  ) {
    return false;
  }

  await tx
    .update(irocInvoices)
    .set({ websiteCustomerId })
    .where(
      and(
        isNull(irocInvoices.websiteCustomerId),
        eq(irocInvoices.customerId, irocCustomerId),
      ),
    );
  return true;
}

async function linkLegacyCustomerToWebsiteCustomer(
  irocCustomerId: number,
  websiteCustomerId: number,
): Promise<boolean> {
  return db.transaction(tx => linkLegacyCustomerToWebsiteCustomerWith(tx, irocCustomerId, websiteCustomerId));
}

async function resolveLegacyCustomerId(
  websiteCustomerId: number,
  websiteCustomerEmail: string,
): Promise<number | null> {
  const [existingLink] = await db
    .select({ irocCustomerId: irocCustomerWebsiteLinks.irocCustomerId })
    .from(irocCustomerWebsiteLinks)
    .where(eq(irocCustomerWebsiteLinks.websiteCustomerId, websiteCustomerId));
  if (existingLink) return existingLink.irocCustomerId;

  const normalizedEmail = websiteCustomerEmail.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const [websiteMatches, legacyMatches] = await Promise.all([
    db
      .select({ id: websiteCustomersTable.id })
      .from(websiteCustomersTable)
      .where(sql`lower(btrim(${websiteCustomersTable.email})) = ${normalizedEmail}`),
    db
      .select({ id: irocCustomers.id })
      .from(irocCustomers)
      .where(sql`lower(btrim(${irocCustomers.email})) = ${normalizedEmail}`),
  ]);
  if (websiteMatches.length !== 1 || legacyMatches.length !== 1) return null;

  const legacyCustomerId = legacyMatches[0].id;
  return await linkLegacyCustomerToWebsiteCustomer(legacyCustomerId, websiteCustomerId)
    ? legacyCustomerId
    : null;
}

// ── Asset paths ───────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In dev: __dirname = src/routes → go up two levels to api-server root
// In built dist: __dirname = dist → go up one level to api-server root
const apiServerRoot = __dirname.includes("/dist")
  ? path.resolve(__dirname, "..")
  : path.resolve(__dirname, "../..");

const ASSETS = {
  logo:      path.join(apiServerRoot, "src/assets/iroc-new-logo.png"),
  footer:    path.join(apiServerRoot, "src/assets/iroc-footer.png"),
  signature: path.join(apiServerRoot, "src/assets/iroc-signature.png"),
};

const PDF_WATERMARK_ANGLE = -38;
const PDF_WATERMARK_FONT = "Helvetica-Bold";
const PDF_WATERMARK_FONT_SIZE = 52;
const PDF_WATERMARK_VERTICAL_OFFSET = 36;

function renderPdfWatermark(
  doc: PDFKit.PDFDocument,
  text: string,
  color: string,
  opacity: number,
): void {
  const { width, height } = doc.page;
  doc.save()
    .rotate(PDF_WATERMARK_ANGLE, { origin: [width / 2, height / 2] })
    .font(PDF_WATERMARK_FONT)
    .fontSize(PDF_WATERMARK_FONT_SIZE)
    .fillColor(color)
    .opacity(opacity)
    .text(text, 0, height / 2 - PDF_WATERMARK_VERTICAL_OFFSET, {
      width,
      align: "center",
      lineBreak: false,
    })
    .opacity(1)
    .restore();
}

// ── Company constants ──────────────────────────────────────────────────────────
const CO = {
  name:        "iROC GmbH",
  street:      "St. Emmeram-Str. 26",
  cityZip:     "85609 Aschheim",
  eori:        "DE990485776181558",
  email:       "info@i-roc.de",
  phone:       "+49 (0)89 600 60 805",
  phoneDirect: "+49 89 4625993 70",
  fax:         "+49 89 21530 334",
  web:         "www.i-roc.de",
  ceo1:        "Dr. med Edan Manos",
  ceo2:        "Dr. med Daniel A. Flesch",
  court:       "Handelsregister München",
  hrb:         "HRB 303391",
  vatDe:       "DE455683037",
  bankShort:   "MERKUR PRIVATBANK München",
  bank:        "MERKUR PRIVATBANK München",
  iban:        "DE85 7013 0800 0001 1395 50",
  bic:         "GENODEF1M06",
};

export type InvoiceContactSettings = {
  email: string;
  phone: string;
};

export const INVOICE_CONTACT_DEFAULTS: InvoiceContactSettings = {
  email: CO.email,
  phone: CO.phone,
};

/**
 * Invoice contact details are shared by every PDF distribution path. A blank
 * saved setting intentionally resolves to the built-in company contact, while
 * a temporarily unavailable settings read must not prevent invoice generation.
 */
export async function getInvoiceContactSettings(
  loadRows: () => Promise<Array<{ key: string; value: string | null }>> = () => db.select().from(settingsTable),
): Promise<InvoiceContactSettings> {
  try {
    const rows = await loadRows();
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return {
      email: values["invoice_contact_email"]?.trim() || INVOICE_CONTACT_DEFAULTS.email,
      phone: values["invoice_contact_phone"]?.trim() || INVOICE_CONTACT_DEFAULTS.phone,
    };
  } catch {
    return INVOICE_CONTACT_DEFAULTS;
  }
}

function fmtEur(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (isNaN(n)) return "€0,00";
  const [int, dec] = n.toFixed(2).split(".");
  const formatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `€${formatted},${dec}`;
}

// ── EPC QR (GiroCode / SEPA Credit Transfer) helpers ──────────────────────────

/** Build an EPC-069 payload string for a SEPA banking QR code. */
function buildEpcPayload(total: string, invoiceNumber: string, iDE: boolean): string {
  const amount = parseFloat(total);
  const amountStr = isNaN(amount) || amount <= 0 ? "" : `EUR${amount.toFixed(2)}`;
  const iban = CO.iban.replace(/\s/g, "");
  const remittance = invoiceNumber
    ? (iDE ? `Rechnung ${invoiceNumber}` : `Invoice ${invoiceNumber}`)
    : (iDE ? "Angebot" : "Offer");
  return [
    "BCD",      // Service tag
    "002",      // Version
    "1",        // Character set: UTF-8
    "SCT",      // Identification
    CO.bic,     // BIC
    CO.name,    // Beneficiary name
    iban,       // IBAN (no spaces)
    amountStr,  // Amount (e.g. EUR123.45)
    "",         // Purpose code (empty)
    "",         // Creditor reference (empty — using unstructured below)
    remittance, // Remittance info (unstructured, max 140 chars)
    "",         // Info to originator (empty)
  ].join("\n");
}

/** Draw an EPC QR code as PDFKit rectangles (synchronous, no tmp files). */
function drawQRCode(
  doc: PDFKit.PDFDocument,
  payload: string,
  x: number,
  y: number,
  size: number,
): void {
  try {
    const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
    const n    = qr.modules.size;
    const cell = size / n;
    doc.save();
    doc.rect(x, y, size, size).fill("white");
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.data[r * n + c] !== 0) {
          doc.rect(x + c * cell, y + r * cell, cell, cell).fill("black");
        }
      }
    }
    doc.restore();
  } catch { /* non-critical — skip QR on error */ }
}

// ── VAT normalization + validation (shared by invoice create/update and offers) ─
export function normalizeAndValidateVat(
  invoiceType: string,
  vatRate: string | null | undefined,
  vatNote?: string | null,
): { rate: number } | { error: string } {
  let rate = parseFloat(vatRate ?? "0");
  if (!vatRate) rate = invoiceType === "domestic" ? 19 : 0;
  // If caller sent a fraction (e.g. 0.19 instead of 19), normalise to percentage
  if (rate > 0 && rate < 1) rate = rate * 100;
  rate = parseFloat(rate.toFixed(2));

  if (!Number.isFinite(rate)) {
    return { error: "VAT rate must be numeric." };
  }

  if (rate === 7 && invoiceType !== "domestic") {
    return { error: "The 7 % reduced VAT rate is only permitted for domestic invoices. Set invoiceType to 'domestic' or use a different VAT rate." };
  }
  const ZERO_VAT_TYPES = ["eu", "noneu", "export", "lecture-eu", "lecture-noneu"];
  if (ZERO_VAT_TYPES.includes(invoiceType) && rate !== 0) {
    return { error: `Invoice type '${invoiceType}' requires a 0 % VAT rate. The saved VAT rate (${rate} %) is incompatible with this type.` };
  }
  if (invoiceType === "domestic" && rate === 0) {
    return { error: "Domestic invoices require a VAT rate of 7 % or 19 %. A 0 % rate is not permitted for domestic invoice type." };
  }
  // EU goods invoices and EU lecture/service invoices both have 0 % VAT, but
  // their legal footnotes are different. Do not persist a manually supplied
  // §3a service note on a plain EU invoice, where it would describe the wrong
  // type of supply.
  if (invoiceType === "eu" && /§\s*3a/i.test(vatNote ?? "")) {
    return {
      error: "An invoice with a §3a service/lecture VAT note must use invoiceType 'lecture-eu'. Choose 'lecture-eu' for teaching, consulting, or speaking services.",
    };
  }
  return { rate };
}

function validateOfferLineItems(
  items: Array<{ unitPrice: string; quantity: number }>,
): string | null {
  for (const [index, item] of items.entries()) {
    const unitPriceText = item.unitPrice.trim();
    const unitPrice = Number(unitPriceText);
    if (!unitPriceText || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return `Line item ${index + 1} unit price must be a finite non-negative number.`;
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return `Line item ${index + 1} quantity must be a positive integer.`;
    }
  }
  return null;
}

function validateOfferDeliveryCosts(deliveryCosts: string): string | null {
  const deliveryCostsText = deliveryCosts.trim();
  const delivery = Number(deliveryCostsText);
  if (!deliveryCostsText || !Number.isFinite(delivery) || delivery < 0) {
    return "Delivery costs must be a finite non-negative number.";
  }
  return null;
}

export function normalizeAndValidateLineVatRates(
  invoiceType: string,
  invoiceRate: number,
  lineRates: Array<string | null | undefined>,
): { rates: number[] } | { error: string } {
  const zeroVat = ["eu", "noneu", "export", "lecture-eu", "lecture-noneu"].includes(invoiceType);
  const rates: number[] = [];
  for (const [index, raw] of lineRates.entries()) {
    if (raw === null || raw === undefined || raw === "") {
      rates.push(invoiceRate);
      continue;
    }
    let value = Number(raw);
    if (!Number.isFinite(value)) return { error: `Item ${index + 1} has an invalid VAT rate.` };
    if (value > 0 && value < 1) value *= 100;
    value = Number(value.toFixed(2));
    if (zeroVat && value !== 0) {
      return { error: `Item ${index + 1} must use 0 % VAT for invoice type '${invoiceType}'.` };
    }
    if (invoiceType === "domestic" && value !== 7 && value !== 19) {
      return { error: `Item ${index + 1} must use the supported domestic VAT rate of 7 % or 19 %.` };
    }
    rates.push(value);
  }
  return { rates };
}

/** Validate the persisted VAT values before a saved offer is allowed back into
 * the invoice editor. Older snapshots may omit a line rate; that case inherits
 * the saved offer rate just as the editor does. */
export function validateSavedTrainingOfferVat(
  invoiceType: string,
  vatRate: unknown,
  items: unknown,
): string | null {
  if (!Array.isArray(items) || !items.every(item => item && typeof item === "object")) {
    return "Saved training offer items are invalid.";
  }
  const vatCheck = normalizeAndValidateVat(invoiceType, String(vatRate));
  if ("error" in vatCheck) return vatCheck.error;
  const lineVatCheck = normalizeAndValidateLineVatRates(
    invoiceType,
    vatCheck.rate,
    items.map(item => {
      const line = item as { vatRate?: unknown };
      return line.vatRate == null ? undefined : String(line.vatRate);
    }),
  );
  return "error" in lineVatCheck ? lineVatCheck.error : null;
}

// ── PDF helper ─────────────────────────────────────────────────────────────────
export type PdfCustomer = Partial<typeof irocCustomers.$inferSelect> & {
  customerNr?: string | null;
  salutation?: string | null;
  title?: string | null;
  name?: string | null;
  company?: string | null;
  vatId?: string | null;
  reorderCode?: string | null;
  shippingFirstName?: string | null;
  shippingLastName?: string | null;
  shippingInstitutionName?: string | null;
  shippingAddress?: string | null;
  shippingPostalCode?: string | null;
  shippingCity?: string | null;
  shippingCountry?: string | null;
};

function parseTrainingOfferCustomerSnapshot(snapshot: unknown): PdfCustomer | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = snapshot as Record<string, unknown>;
  const isNullableString = (field: unknown): field is string | null =>
    field === null || typeof field === "string";
  if (
    typeof value.id !== "number"
    || typeof value.name !== "string"
    || typeof value.isEu !== "boolean"
    || ![
      value.company,
      value.salutation,
      value.title,
      value.address,
      value.postalCode,
      value.city,
      value.country,
      value.email,
      value.phone,
      value.vatId,
      value.notes,
      value.customerNr,
      value.reorderCode,
    ].every(isNullableString)
  ) {
    return null;
  }
  return value as PdfCustomer;
}

export function buildInvoicePDF(
  doc: PDFKit.PDFDocument,
  row: typeof irocInvoices.$inferSelect,
  customer: PdfCustomer | undefined,
  items: (typeof irocInvoiceItems.$inferSelect)[],
  opts: { offer?: boolean; contact?: InvoiceContactSettings } = {},
): void {
  const isOffer  = opts.offer === true;
  const isCorrection = row.correctionOfInvoiceId != null;
  const isExport = row.invoiceType === "export";
  const isNonEu  = row.invoiceType === "noneu";
  const lang     = row.language === "en" ? "en" : "de";
  const iDE      = lang === "de";
  const selectedPaymentTerms = resolvePaymentTerms(row);
  const contactEmail = opts.contact?.email?.trim() || INVOICE_CONTACT_DEFAULTS.email;
  const contactPhone = opts.contact?.phone?.trim() || INVOICE_CONTACT_DEFAULTS.phone;

  // Format an ISO date string (YYYY-MM-DD) for the document language
  const fmtDate = (iso: string | null | undefined): string => {
    if (!iso) return "";
    const [y, m, d] = iso.slice(0, 10).split("-");
    if (!y || !m || !d) return iso;
    if (iDE) return `${d}.${m}.${y}`;
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] ?? m} ${y}`;
  };

  const PW    = doc.page.width;   // 595.28
  const ML    = 42;
  const CW    = PW - ML * 2;     // 511.28

  // ── Colors matching approved mockup designs ────────────────────────────────
  const NAVY  = "#002244";   // dark navy — headings, table header, banner text
  const LBLUE = "#cce0f5";   // light blue — banner background
  const MGRAY = "#555555";   // medium gray — labels, secondary text
  const LGRAY = "#f5f5f5";   // light gray — shaded ref grid cells
  const BRDR  = "#dddddd";   // border color
  const BLACK = "#000000";
  const BLNK  = "#1155cc";   // blue link / email

  // ── Helpers ────────────────────────────────────────────────────────────────
  function hRule(y: number, color = BRDR, lw = 0.5) {
    doc.save().moveTo(ML, y).lineTo(ML + CW, y).lineWidth(lw).strokeColor(color).stroke().restore();
  }
  function vLine(x: number, y1: number, y2: number) {
    doc.save().moveTo(x, y1).lineTo(x, y2).lineWidth(0.4).strokeColor(BRDR).stroke().restore();
  }
  function fillRect(x: number, y: number, w: number, h: number, bg: string) {
    doc.save().rect(x, y, w, h).fill(bg).restore();
  }
  function strokeRect(x: number, y: number, w: number, h: number, color = BRDR, lw = 0.4) {
    doc.save().rect(x, y, w, h).lineWidth(lw).strokeColor(color).stroke().restore();
  }
  function t(
    text: string, x: number, y: number, w: number,
    opts: { fs?: number; bold?: boolean; italic?: boolean; color?: string;
            align?: "left"|"center"|"right"; lb?: boolean; ellipsis?: boolean } = {},
  ) {
    const { fs = 8, bold = false, italic = false, color = BLACK, align = "left", lb = false, ellipsis = false } = opts;
    const font = bold ? "Helvetica-Bold" : italic ? "Helvetica-Oblique" : "Helvetica";
    doc.font(font).fontSize(fs).fillColor(color).text(text, x, y, { width: w, align, lineBreak: lb, ellipsis });
  }
  function cellT(
    text: string, x: number, y: number, w: number, h: number,
    opts: { fs?: number; bold?: boolean; color?: string; align?: "left"|"center"|"right" } = {},
  ) {
    const { fs = 8, bold = false, color = BLACK, align = "left" } = opts;
    const ty = y + Math.max(1, (h - fs * 1.15) / 2);
    t(text, x + 3, ty, w - 6, { fs, bold, color, align, ellipsis: true });
  }

  // ─── SECTION 1: Header — full iROC lockup (left), title (right) ───────────
  let curY = 26;
  const LOGO_FIT_W = 180, LOGO_FIT_H = 68;

  try {
    doc.image(ASSETS.logo, ML, curY, { fit: [LOGO_FIT_W, LOGO_FIT_H] });
  } catch {
    doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY).text("iROC GmbH", ML, curY + 10);
  }

  // Invoice / offer / export title — right-aligned
  const titleStr  = isOffer
    ? (iDE ? "Angebot" : "Offer")
    : isCorrection ? (iDE ? "Rechnungskorrektur" : "Invoice correction")
    : isExport ? "COMMERCIAL INVOICE" : (iDE ? "Rechnung" : "Invoice");
  const titleFs   = isExport ? 20 : 28;
  doc.font("Helvetica").fontSize(titleFs).fillColor(NAVY)
     .text(titleStr, ML, curY + (isExport ? 18 : 6), { width: CW, align: "right", lineBreak: false });
  curY += 72;

  // ─── SECTION 2 (Export only): Reason/Shipping strip between two rules ────
  hRule(curY);
  curY += 5;
  if (isExport) {
    const expReason = row.reasonForExport || "Sale";
    const expShip   = row.shippingMethod  || "DHL Express";
    doc.font("Helvetica").fontSize(7.5).fillColor(MGRAY)
       .text(`Reason for Export: `, ML, curY, { continued: true, lineBreak: false })
       .font("Helvetica-Bold").fillColor(BLACK)
       .text(expReason, { lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor(MGRAY)
       .text(`Shipping Method: `, ML + CW * 0.55, curY, { continued: true, lineBreak: false })
       .font("Helvetica-Bold").fillColor(BLACK)
       .text(expShip, { lineBreak: false });
    curY += 13;
    hRule(curY);
    curY += 5;
  }

  // ─── SECTION 3: Address bar + contact ────────────────────────────────────
  const addrLine = `${CO.name} | ${CO.street} | ${CO.cityZip}`;
  t(addrLine, ML, curY, CW * 0.48, { fs: 7, color: MGRAY });
  if (isExport) {
    t(`EORI: ${CO.eori}`, ML, curY + 9, CW * 0.48, { fs: 7, color: MGRAY });
  }

  // Keep the complete contact block in one right-hand column. The former
  // three-column layout gave the return label, email, and phone different
  // widths, which made the phone number appear split/misaligned in the PDF.
  const contactX = ML + CW * 0.5;
  const contactRight = ML + CW;
  const returnLabel = iDE ? "Rücksendeanfrage an:" : "Return requests to:";
  const enquiryLabel = iDE ? "Rückfragen an:" : "Questions to:";
  const enquiryValue = `${iDE ? "Kundenberatung" : "Customer service"} ${contactPhone}`;

  // Render each row as a single, non-breaking label/value line. In particular,
  // the telephone string must never become a second text column or wrap into a
  // separate visual row.
  const contactRow = (
    label: string,
    value: string,
    y: number,
    valueColor: string,
    boldValue = false,
    valueAlign: "left" | "right" = "left",
  ) => {
    const fs = 7;
    const labelWidth = doc.font("Helvetica").fontSize(fs).widthOfString(label);
    const valueFont = boldValue ? "Helvetica-Bold" : "Helvetica";
    const valueWidth = doc.font(valueFont).fontSize(fs).widthOfString(value);
    const labelX = contactX;
    const valueX = valueAlign === "right"
      ? Math.max(contactX + labelWidth + 3, contactRight - valueWidth)
      : contactX + labelWidth + 3;

    doc.font("Helvetica").fontSize(fs).fillColor(MGRAY)
      .text(label, labelX, y, { lineBreak: false });
    doc.font(valueFont).fontSize(fs).fillColor(valueColor)
      .text(value, valueX, y, {
        width: Math.max(1, contactRight - valueX),
        lineBreak: false,
      });
  };
  contactRow(returnLabel, contactEmail, curY, BLNK, false, "right");
  contactRow(enquiryLabel, enquiryValue, curY + 11, BLACK, true, "right");
  curY += 25;
  hRule(curY);
  curY += 12;

  // ─── SECTION 4: Customer block (left) + Reference grid (right) ───────────
  const refW   = CW * 0.49;
  const refX   = ML + CW - refW;
  const custW  = CW - refW - 14;
  const cellW  = refW / 2;
  const lblH   = 10;   // label sub-row height
  const datH   = 14;   // data sub-row height
  const pairH  = lblH + datH;

  const refLabels = isExport ? [
    ["Order Nr.", isOffer ? "Offer" : "Invoice Nr.*"],
    ["Reference Nr.", isOffer ? "Offer Date*" : "Invoice Issue Date*"],
    ["Customer Tax/VAT Nr.", "Customer Nr.*"],
  ] : iDE ? [
    ["Auftragsnummer", isOffer ? "Angebot" : "Rechnungsnummer*"],
    [isCorrection ? "Originalrechnung" : "Ihre Referenz", isOffer ? "Angebotsdatum*" : "Rechnungsdatum*"],
    ["Ihre Ust-ID-Nummer", "Kundennummer*"],
  ] : [
    ["Order No.", isOffer ? "Offer" : "Invoice No.*"],
    [isCorrection ? "Original invoice" : "Your Reference", isOffer ? "Offer Date*" : "Invoice Date*"],
    ["Your VAT-ID No.", "Customer No.*"],
  ];

  const refVals = [
    [row.orderNumber ?? "", isOffer ? (iDE ? "Unverbindlich" : "Non-binding") : row.invoiceNumber],
    [row.referenceNumber ?? "", fmtDate(row.issueDate)],
    [customer?.vatId ?? "", customer?.customerNr ?? ""],
  ];

  const gridStartY = curY;
  let refY = gridStartY;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      const cx = refX + c * cellW;
      // label sub-row
      t(refLabels[r][c], cx + 4, refY + 2, cellW - 8, { fs: 7, color: MGRAY });
      // data sub-row
      if (c === 1) fillRect(cx, refY + lblH, cellW, datH, LGRAY);
      t(refVals[r][c], cx + 4, refY + lblH + 3, cellW - 8,
        { fs: c === 1 ? 9 : 8.5, bold: c === 1 });
    }
    // Clip to ref-grid width only — hRule() spans full page and bleeds over the address block
    doc.save().moveTo(refX, refY + pairH).lineTo(refX + refW, refY + pairH)
       .lineWidth(0.3).strokeColor(BRDR).stroke().restore();
    refY += pairH;
  }
  strokeRect(refX, gridStartY, refW, 3 * pairH, BRDR, 0.4);
  vLine(refX + cellW, gridStartY, gridStartY + 3 * pairH);

  const noteStr = isExport ? "* Please specify when making payment." : "* bei Zahlung bitte angeben";
  t(noteStr, refX, refY + 2, refW, { fs: 6.5, color: MGRAY, align: "right" });
  refY += 10;

  // Customer address blocks (left side)
  let cy = gridStartY;
  if (customer) {
    const renderAddressBlock = (label: string, addrLines: string[], startY: number): number => {
      t(label, ML, startY, custW, { fs: 7.5, bold: true, color: MGRAY });
      let blockY = startY + 11;
      for (const line of addrLines) {
        // Render with word-wrap (lb: true) and track actual rendered height via doc.y
        doc.font("Helvetica").fontSize(8.5).fillColor(BLACK)
           .text(line, ML, blockY, { width: custW });
        blockY = doc.y + 1;
      }
      return blockY;
    };

    // Build name line with salutation + title. Legacy names may already contain
    // the separately stored title because they predate this boundary.
    const customerName = stripLegacyCustomerTitlePrefix(customer.name ?? "", customer.title);
    const billingNameLine = [customer.salutation, customer.title, customerName]
      .filter(Boolean).join(" ");
    const billingLines: string[] = [];
    if (billingNameLine) billingLines.push(billingNameLine);
    if (customer.company) billingLines.push(customer.company);
    if (customer.address) billingLines.push(customer.address);
    const billingCityStr = [customer.postalCode, customer.city].filter(Boolean).join(" ");
    if (billingCityStr) billingLines.push(billingCityStr);
    if (customer.country) billingLines.push(customer.country);

    cy = renderAddressBlock(iDE ? "Rechnungsadresse / Bill To" : "Billing Address / Bill To", billingLines, cy);

    // A shipping address is optional and only shown when its identifying fields
    // are set. The billing block above remains visible for cross-checking.
    if (customer.shippingFirstName || customer.shippingAddress) {
      const shippingNameLine = [customer.shippingFirstName, customer.shippingLastName]
        .filter(Boolean).join(" ");
      const shippingLines: string[] = [];
      if (shippingNameLine) shippingLines.push(shippingNameLine);
      if (customer.shippingInstitutionName) shippingLines.push(customer.shippingInstitutionName);
      if (customer.shippingAddress) shippingLines.push(customer.shippingAddress);
      const shippingCityStr = [customer.shippingPostalCode, customer.shippingCity]
        .filter(Boolean).join(" ");
      if (shippingCityStr) shippingLines.push(shippingCityStr);
      if (customer.shippingCountry) shippingLines.push(customer.shippingCountry);

      cy += 7;
      cy = renderAddressBlock(iDE ? "Lieferadresse / Ship To" : "Shipping Address / Ship To", shippingLines, cy);
    }
  }

  // Incoterms (commercial invoice only)
  if (isExport) {
    cy += 6;
    const inco = `Terms of Delivery (Incoterm): ${(row as any).termsOfDelivery || "DAP (Delivered At Place)"}`;
    const expR = `Reason for Export: ${row.reasonForExport || "Permanent Sale / Commercial"}`;
    t(inco, ML, cy, custW, { fs: 7.5 });
    cy += 11;
    t(expR, ML, cy, custW, { fs: 7.5 });
    cy += 11;
  }

  // ─── SECTION 5: Payment box ───────────────────────────────────────────────
  if (isExport) {
    // Commercial: right-side box stacked below ref grid
    // Left 54 pt of box → QR code; remaining right → intro + bank details
    const payH  = 72;
    const qrSz  = 54;  // QR code size (fits inside payH=72 with margins)
    const qrPad = 9;   // left/top margin inside box
    strokeRect(refX, refY + 2, refW, payH, BRDR, 0.4);
    const epcPayload = buildEpcPayload(row.total?.toString() ?? "0", row.invoiceNumber, iDE);
    drawQRCode(doc, epcPayload, refX + qrPad, refY + 2 + (payH - qrSz) / 2, qrSz);
    doc.font("Helvetica").fontSize(5.5).fillColor(MGRAY)
       .text("GiroCode", refX + qrPad, refY + 2 + (payH - qrSz) / 2 + qrSz + 1, { width: qrSz, align: "center" });
    const txX = refX + qrPad + qrSz + 6;
    const txW = refW - qrPad - qrSz - 10;
    let py = refY + 8;
    const introExp = `${selectedPaymentTerms.description} Transfer to the following account:`;
    doc.font("Helvetica-Oblique").fontSize(6.5).fillColor(MGRAY)
       .text(introExp, txX, py, { width: txW });
    py += 22;
    t(CO.name,            txX, py, txW, { fs: 7.5, bold: true }); py += 10;
    t(`Bank: ${CO.bank}`, txX, py, txW, { fs: 7 });               py += 9;
    t(`IBAN: ${CO.iban}`, txX, py, txW, { fs: 7 });               py += 9;
    t(`BIC/SWIFT: ${CO.bic}`, txX, py, txW, { fs: 7 });
    curY = Math.max(cy + 8, refY + 2 + payH + 10);
  } else {
    // Standard: full-width box — left side: QR + intro text; right side: bank details
    curY = Math.max(refY + 10, cy + 8);
    const payH   = 68;   // taller to fit QR (50) + "GiroCode" label
    const qrSz   = 50;
    const qrX    = ML + 5;
    const qrY    = curY + 4;
    const splitX = ML + CW * 0.46;
    strokeRect(ML, curY, CW, payH, BRDR, 0.4);
    vLine(splitX, curY, curY + payH);

    // QR code on left portion
    const epcPayload = buildEpcPayload(row.total?.toString() ?? "0", row.invoiceNumber, iDE);
    drawQRCode(doc, epcPayload, qrX, qrY, qrSz);
    doc.font("Helvetica").fontSize(5.5).fillColor(MGRAY)
       .text("GiroCode", qrX, qrY + qrSz + 1, { width: qrSz, align: "center" });

    // Payment intro text to the right of the QR
    const introX = qrX + qrSz + 5;
    const introW = splitX - introX - 4;
    const payIntro = iDE
      ? `${selectedPaymentTerms.description} Bitte auf folgendes Konto überweisen:`
      : `${selectedPaymentTerms.description} Please transfer to the following account:`;
    doc.font("Helvetica-Oblique").fontSize(6.5).fillColor(MGRAY)
       .text(payIntro, introX, curY + 7, { width: introW });

    // Bank details on right portion
    let py = curY + 7;
    t(CO.name,               splitX + 8, py, CW * 0.5 - 12, { fs: 7.5, bold: true }); py += 11;
    t(`Bank: ${CO.bank}`,    splitX + 8, py, CW * 0.5 - 12, { fs: 7 });               py += 10;
    t(`IBAN: ${CO.iban}`,    splitX + 8, py, CW * 0.5 - 12, { fs: 7 });               py += 10;
    t(`BIC/SWIFT: ${CO.bic}`,splitX + 8, py, CW * 0.5 - 12, { fs: 7 });
    curY += payH + 12;
  }

  // ─── SECTION 6: Items table ───────────────────────────────────────────────
  type Col = { key: string; label: string; w: number; align: "left"|"center"|"right" };

  const TABLE_FS  = 7;
  const PAD_H     = 3;   // horizontal cell padding (each side)
  const PAD_V     = 3;   // vertical cell padding (top and bottom)
  const MIN_ROW_H = 13;
  const MIN_HDR_H = 16;

  /** Measure the height text will occupy inside a cell (word-wrapped).
   *  A small buffer guards against PDFKit heightOf rounding errors. */
  function cellMeasure(text: string, colW: number, bold = false, fs = TABLE_FS): number {
    if (!text) return 0;
    try {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fs);
      // +4pt buffer so floating-point imprecision never makes rowH smaller than needed.
      return doc.heightOfString(text, { width: colW - PAD_H * 2 }) + 4;
    } catch { return fs * 1.35; }
  }

  /** Render cell text with word-wrap. Single-line values are centred vertically.
   *  Multi-line text uses a graphical clip (save/rect.clip/restore) so overflow
   *  is cut at the row rectangle boundary — never mid-glyph. PDFKit's `height`
   *  text option is intentionally avoided here because it clips mid-character
   *  when measurement is off by even 1pt. */
  function renderCell(
    text: string, x: number, y: number, colW: number, rowH: number,
    opts: {
      bold?: boolean;
      color?: string;
      align?: "left"|"center"|"right";
      fs?: number;
      noWrap?: boolean;
    } = {},
  ) {
    if (!text) return;
    const {
      bold = false,
      color = BLACK,
      align = "left",
      fs = TABLE_FS,
      noWrap = false,
    } = opts;
    const font = bold ? "Helvetica-Bold" : "Helvetica";
    const measuredH = cellMeasure(text, colW, bold, fs);
    // Strip the buffer before comparing so the single-line threshold is accurate.
    const singleLine = noWrap || (measuredH - 4) <= fs * 1.6;
    const ty = singleLine
      ? y + Math.max(PAD_V, (rowH - fs * 1.15) / 2)   // centre vertically
      : y + PAD_V;                                       // top-align

    if (singleLine) {
      // Headers use noWrap because their measured widths fit their columns;
      // this prevents PDFKit from ever splitting a heading at a word boundary.
      // Product content continues to use the measured, wrapped-cell path below.
      doc.font(font).fontSize(fs).fillColor(color)
         .text(text, x + PAD_H, ty, {
           width: colW - PAD_H * 2,
           align,
           lineBreak: false,
         });
    } else {
      // Graphical clip: restrict rendering to the cell rectangle so that overflow
      // is cut cleanly at the row boundary, never mid-glyph.
      // doc.save()/restore() scopes the clip to this cell only.
      doc.save();
      doc.rect(x, y, colW, rowH).clip();
      doc.font(font).fontSize(fs).fillColor(color)
         .text(text, x + PAD_H, ty, {
           width: colW - PAD_H * 2,
           align,
           lineBreak: true,
         });
      doc.restore();
    }
  }

  // Column widths must sum to CW = 511.28
  const stdCols: Col[] = [
    // Keep short headings comfortably wider than their text metrics. In
    // particular, PDFKit's Helvetica-Bold can otherwise move the final "."
    // in "Pos." or the final "t" in "Discount" onto a second line.
    { key: "pos",    label: iDE ? "Pos."          : "Pos.",             w: 28,    align: "center" },
    { key: "name",   label: iDE ? "Artikel"        : "Item",            w: 64,    align: "left"   },
    { key: "desc",   label: iDE ? "Beschreibung"   : "Description",     w: 103,   align: "left"   },
    { key: "lot",    label: iDE ? "LOT-Nr."        : "LOT No.",         w: 52,    align: "center" },
    { key: "qty",    label: iDE ? "Menge"          : "Qty",             w: 35,    align: "center" },
    { key: "price",  label: iDE ? "Grundpreis"     : "Unit Price",      w: 62,    align: "right"  },
    { key: "disc",   label: iDE ? "Rabatt"         : "Discount",        w: 46,    align: "center" },
    { key: "dprice", label: iDE ? "Rabattpreis"    : "Disc. Price",     w: 62,    align: "right"  },
    { key: "total",  label: iDE ? "Gesamt"         : "Total",           w: 59.28, align: "right"  },
  ];

  // Commercial Invoice columns — widths sum to 511.28
  // pos:28 + name:75 + desc:72 + hs:58 + qty:28 + price:65 + origin:65 + total:65 + weight:55.28
  const comCols: Col[] = [
    { key: "pos",    label: "Pos.",              w: 28,    align: "center" },
    { key: "name",   label: "Item",              w: 75,    align: "left"   },
    { key: "desc",   label: "Description",       w: 72,    align: "left"   },
    { key: "hs",     label: "HS/HTS Code",       w: 58,    align: "center" },
    { key: "qty",    label: "Qty",               w: 28,    align: "center" },
    { key: "price",  label: "Unit Price",        w: 65,    align: "right"  },
    { key: "origin", label: "Country of Origin", w: 65,    align: "center" },
    { key: "total",  label: "Total incl. Disc.", w: 65,    align: "right"  },
    { key: "weight", label: "Weight (kg)",       w: 55.28, align: "right"  },
  ];

  const cols: Col[] = isExport ? comCols : stdCols;

  // ── Header row (auto-height so no label is clipped) ──────────────────────
  const hdrH = Math.max(MIN_HDR_H,
    ...cols.map(col => cellMeasure(col.label, col.w, true) + PAD_V * 2));
  let tx = ML;
  for (const col of cols) {
    fillRect(tx, curY, col.w, hdrH, NAVY);
    renderCell(col.label, tx, curY, col.w, hdrH,
      { bold: true, color: "#ffffff", align: col.align, noWrap: true });
    tx += col.w;
  }
  curY += hdrH;

  // ── Page-break guard ──────────────────────────────────────────────────────
  // Leave the bottom 76pt (62pt footer + 14pt clearance) untouched.
  // When a row or tail block won't fit in the remaining space, add a new page
  // and re-draw the table header so every page is self-contained.
  const AVAIL_BOTTOM = doc.page.height - 62 - 14;
  function ensureSpace(needed: number) {
    if (curY + needed > AVAIL_BOTTOM) {
      doc.addPage();
      curY = 36; // top margin
      let hx = ML;
      for (const col of cols) {
        fillRect(hx, curY, col.w, hdrH, NAVY);
        renderCell(col.label, hx, curY, col.w, hdrH,
          { bold: true, color: "#ffffff", align: col.align, noWrap: true });
        hx += col.w;
      }
      curY += hdrH;
    }
  }

  // ── Item rows (auto-height so no cell value is clipped) ──────────────────
  items.forEach((item, idx) => {
    const rowBg = idx % 2 === 0 ? "#ffffff" : LGRAY;
    const disc   = parseFloat(item.discountPercent?.toString() ?? "0") || 0;
    const up     = parseFloat(item.unitPrice.toString());
    const dPrice = up * (1 - disc / 100);
    const lt     = parseFloat(item.lineTotal.toString());

    const rowData: Record<string, string> = isExport ? {
      pos:    String(idx + 1),
      name:   item.productName,
      desc:   item.description ?? "",
      hs:     item.hsCode ?? "",
      qty:    String(item.quantity),
      price:  fmtEur(up),
      origin: item.countryOfOrigin ?? "",
      total:  fmtEur(lt),
      weight: item.weightKg ? `${parseFloat(item.weightKg.toString()).toFixed(3)} kg` : "",
    } : {
      pos:    String(idx + 1),
      name:   item.productName,
      desc:   item.description ?? "",
      lot:    item.lotNumber ?? "",
      qty:    String(item.quantity),
      price:  fmtEur(up),
      disc:   disc > 0 ? `${disc.toFixed(0)}%` : "",
      dprice: fmtEur(dPrice),
      total:  fmtEur(lt),
    };

    // Measure every cell, use tallest as row height
    const rowH = Math.max(MIN_ROW_H,
      ...cols.map(col => cellMeasure(rowData[col.key] ?? "", col.w) + PAD_V * 2));

    // Ensure the row fits above the footer zone; add a page if not.
    ensureSpace(rowH);

    let rx = ML;
    for (const col of cols) {
      fillRect(rx, curY, col.w, rowH, rowBg);
      renderCell(rowData[col.key] ?? "", rx, curY, col.w, rowH, { align: col.align });
      rx += col.w;
    }
    curY += rowH;
  });

  // ── Tail-block space guard ────────────────────────────────────────────────
  // Ensure that the summary row, totals, notes, banner, and optional signature
  // all land on the same page. Approximate heights (pt):
  //   summary 23 + totals 66 + vat-note 11 + tc 26 + banner 34 = 160
  //   + optional notes 12 + export signature 74
  const tailH = (isExport ? 234 : 160) + (row.notes ? 12 : 0);
  ensureSpace(tailH);

  // ── Summary row ──────────────────────────────────────────────────────────
  doc.save().moveTo(ML, curY).lineTo(ML + CW, curY).lineWidth(1.5).strokeColor(NAVY).stroke().restore();
  fillRect(ML, curY, CW, MIN_ROW_H, LGRAY);
  renderCell(iDE ? "Gesamt" : "Total", ML, curY, CW, MIN_ROW_H,
    { bold: true, fs: 7.5 });
  curY += MIN_ROW_H + 10;

  // ─── SECTION 7: Totals block (right-aligned) ─────────────────────────────
  const totX  = ML + CW * 0.5;
  const totW  = CW * 0.5;
  const totLW = CW * 0.3;
  const totVW = CW * 0.2;
  const totLH = 13;

  const subAmt   = parseFloat(row.subtotal.toString());
  const delAmt   = parseFloat(row.deliveryCosts.toString());
  const insAmt   = parseFloat((row.insuranceCosts ?? 0).toString());
  const vatAmt   = parseFloat(row.vatAmount.toString());
  const totAmt   = parseFloat(row.total.toString());
  const vatRateN = parseFloat(row.vatRate.toString());
  const visibleVat = items.length ? calculateFacturXTotals(
    {
      invoiceType: row.invoiceType,
      vatRate: row.vatRate,
      deliveryCosts: row.deliveryCosts,
      insuranceCosts: row.insuranceCosts,
    },
    items.map(item => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      vatRate: item.vatRate ?? row.vatRate,
    })),
  ) : {
    vatGroups: [{ ratePercent: vatRateN, taxCents: Math.round(vatAmt * 100) }],
  };

  const isLectureNonEu = row.invoiceType === "lecture-noneu";
  const isLectureEu    = row.invoiceType === "lecture-eu";
  const vatLabel = (isExport || isNonEu || isLectureNonEu || isLectureEu)
    ? ((isNonEu || isLectureNonEu) && iDE ? "Umsatzsteuer**" : "VAT**")
    : iDE ? `Umsatzsteuer ${vatRateN.toFixed(0)}% **` : `VAT ${vatRateN.toFixed(0)}% **`;

  type TRow = [string, string, boolean?];
  const isZeroVatTreatment = ["eu", "noneu", "export", "lecture-eu", "lecture-noneu"].includes(row.invoiceType);
  const vatRows: TRow[] = visibleVat.vatGroups.map(group => [
    isZeroVatTreatment || group.ratePercent === 0
      ? vatLabel
      : (iDE ? `Umsatzsteuer ${group.ratePercent.toFixed(0)}% **` : `VAT ${group.ratePercent.toFixed(0)}% **`),
    fmtEur(group.taxCents / 100),
  ]);
  const totRows: TRow[] = isExport ? [
    ["Net Amount",   fmtEur(subAmt)],
    ["Shipping",     fmtEur(delAmt)],
    ...(insAmt > 0 ? [["Insurance", fmtEur(insAmt)] as TRow] : []),
    ...vatRows,
    ["Total Amount", fmtEur(totAmt), true],
  ] : iDE ? [
    ["Netto-Betrag", fmtEur(subAmt)],
    ["Lieferung",    fmtEur(delAmt)],
    ...(insAmt > 0 ? [["Transportversicherung", fmtEur(insAmt)] as TRow] : []),
    ...vatRows,
    ["Gesamtbetrag", fmtEur(totAmt), true],
  ] : [
    ["Net Amount",  fmtEur(subAmt)],
    ["Delivery",    fmtEur(delAmt)],
    ...(insAmt > 0 ? [["Insurance", fmtEur(insAmt)] as TRow] : []),
    ...vatRows,
    ["Grand Total", fmtEur(totAmt), true],
  ];

  for (const [label, value, isBold] of totRows) {
    if (isBold) {
      doc.save().moveTo(totX, curY).lineTo(totX + totW, curY).lineWidth(0.8).strokeColor(NAVY).stroke().restore();
      t(label, totX + 4,        curY + 3, totLW - 4, { fs: 9, bold: true });
      t(value, totX + totLW,    curY + 3, totVW - 4, { fs: 9, bold: true, align: "right" });
      curY += totLH + 2;
    } else {
      t(label, totX + 4,        curY + 2, totLW - 4, { fs: 8 });
      t(value, totX + totLW,    curY + 2, totVW - 4, { fs: 8, align: "right" });
      curY += totLH;
    }
  }
  curY += 12;

  // ─── SECTION 8: VAT note + T&C ───────────────────────────────────────────
  // Use admin-supplied override if present, otherwise compute from invoice type
  let vatNote = (row as any).vatNote as string | null | undefined;
  if (!vatNote) {
    // Fallback for invoices stored before vatNote was always persisted.
    vatNote = computeDefaultVatNote(row.invoiceType, lang);
  }
  // Measure actual wrapped height so multi-line footnotes don't overlap the next block.
  const vatNoteH = doc.font("Helvetica-Oblique").fontSize(7.5).heightOfString(vatNote, { width: CW });
  t(vatNote, ML, curY, CW, { fs: 7.5, italic: true, color: MGRAY, lb: true });
  curY += vatNoteH + 4;

  if (row.notes) {
    const notesH = doc.font("Helvetica").fontSize(7.5).heightOfString(row.notes.toString(), { width: CW });
    t(row.notes, ML, curY, CW, { fs: 7.5, lb: true });
    curY += notesH + 4;
  }

  const tc1 = iDE
    ? "Die Lieferung und Leistung erfolgt ausschließlich zu unseren allgemeinen Verkaufsbedingungen, die Sie hier www.i-roc.de/AVB/ einsehen können."
    : "Delivery is made in accordance with our General Terms and Conditions.";
  const tc1H = doc.font("Helvetica").fontSize(7.5).heightOfString(tc1, { width: CW });
  t(tc1, ML, curY, CW, { fs: 7.5, lb: true }); curY += tc1H + 2;
  curY += 16;

  // ─── SECTION 9: Banner — light blue background, navy bold text ───────────
  const bannerH   = 20;
  let bannerTxt: string;
  if (isOffer) {
    if (row.dueDate) {
      bannerTxt = iDE
        ? `Unverbindliches Angebot – Zahlungsfrist: ${fmtDate(row.dueDate)} (21 Tage vor Schulungsbeginn)`
        : `Non-binding offer – Payment due by: ${fmtDate(row.dueDate)} (21 days before training)`;
    } else {
      bannerTxt = iDE ? "Unverbindliches Angebot" : "Non-binding offer";
    }
  } else {
    bannerTxt = iDE ? "Vielen Dank für Ihren Auftrag." : "Thank you for your business.";
  }
  fillRect(ML, curY, CW, bannerH, LBLUE);
  const bty = curY + Math.max(1, (bannerH - 9 * 1.15) / 2);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY)
     .text(bannerTxt, ML, bty, { width: CW, align: "center", lineBreak: false });
  curY += bannerH + 14;

  // ─── SECTION 9b: Reorder code notice ──────────────────────────────────────
  if (!isOffer && customer?.reorderCode && customer?.customerNr) {
    const reorderTxt = iDE
      ? `Für Ihre nächste Bestellung verwenden Sie bitte Ihren persönlichen Bestellcode ${customer.reorderCode} zusammen mit Ihrer Kundennummer ${customer.customerNr} auf unserem Bestellformular.`
      : `For your next order, please use your personal reorder code ${customer.reorderCode} together with your customer number ${customer.customerNr} on our order form.`;
    t(reorderTxt, ML, curY, CW, { fs: 7.5, bold: true });
    curY += 20;
  }

  // ─── SECTION 10: Declaration + Signature (export only) ───────────────────
  if (isExport) {
    t(
      "I declare that the information mentioned above is true and correct to the best of my knowledge.",
      ML, curY, CW * 0.55, { fs: 7.5, italic: true },
    );
    doc.image(ASSETS.signature, ML + CW * 0.58, curY - 6, { height: 42 });
    curY += 48;
    t(CO.ceo1,          ML + CW * 0.58, curY, CW * 0.42, { fs: 8, bold: true });
    curY += 10;
    t(`CEO, ${CO.name}`, ML + CW * 0.58, curY, CW * 0.42, { fs: 8 });
    curY += 16;
  }

  // ─── SECTION 11: Fixed footer ─────────────────────────────────────────────
  const footerY = doc.page.height - 62;
  // Thicker navy rule matching logo color
  doc.save().moveTo(ML, footerY - 4).lineTo(ML + CW, footerY - 4)
     .lineWidth(1.5).strokeColor(NAVY).stroke().restore();

  const COL_W = CW / 5;
  const fcols: string[][] = [
    [CO.name, CO.street, CO.cityZip, iDE ? "Deutschland" : "Germany"],
    [iDE ? "Kontakt" : "Contact", `T ${CO.phoneDirect}`, `F ${CO.fax}`, CO.email, CO.web],
    [iDE ? "Geschäftsführung" : "Management", CO.ceo1, CO.ceo2, CO.court, CO.hrb],
    [iDE ? "Sitz der Gesellschaft" : "Registered office", CO.street, `D-${CO.cityZip}`, iDE ? "Deutschland" : "Germany", CO.vatDe],
    [iDE ? "Bankverbindung" : "Bank details", CO.bank, `BIC/SWIFT: ${CO.bic}`, `IBAN: ${CO.iban}`, `EORI: ${CO.eori}`],
  ];

  for (let i = 0; i < fcols.length; i++) {
    const fx = ML + i * COL_W;
    let fy = footerY;
    const titleFs = 5.5;
    const detailFs = 4.8;
    for (let li = 0; li < fcols[i].length; li++) {
      const fnt = li === 0 ? "Helvetica-Bold" : "Helvetica";
      const colW = COL_W - 3;
      const isIban = i === fcols.length - 1 && fcols[i][li].startsWith("IBAN:");
      const lineFs = li === 0 ? titleFs : detailFs;
      doc.font(fnt).fontSize(lineFs).fillColor(MGRAY);
      const lineH = doc.heightOfString(fcols[i][li], { width: colW });
      doc.text(fcols[i][li], fx, fy, {
        width: colW,
        align: "left",
        lineBreak: !isIban,
      });
      fy += Math.max(lineH, 7) + 1;
    }
  }
}

// ── Delivery Note PDF (bilingual DE / EN) ─────────────────────────────────────
export interface ShippingInfo {
  firstName: string | null;
  lastName: string | null;
  institutionName: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
}

export function buildDeliveryNotePDF(
  doc: InstanceType<typeof PDFDocument>,
  row: typeof irocInvoices.$inferSelect,
  customer: PdfCustomer | undefined,
  items: (typeof irocInvoiceItems.$inferSelect)[],
  shippingInfo?: ShippingInfo,
): void {
  // Always bilingual — German primary, English secondary on every label.
  const PW = doc.page.width;
  const ML = 42;
  const CW = PW - ML * 2;

  const NAVY  = "#002244";
  const LBLUE = "#cce0f5";
  const MGRAY = "#555555";
  const LGRAY = "#f5f5f5";
  const BRDR  = "#dddddd";
  const BLACK = "#000000";
  const BLNK  = "#1155cc";

  function hRule(y: number, color = BRDR, lw = 0.5) {
    doc.save().moveTo(ML, y).lineTo(ML + CW, y).lineWidth(lw).strokeColor(color).stroke().restore();
  }
  function vLine(x: number, y1: number, y2: number) {
    doc.save().moveTo(x, y1).lineTo(x, y2).lineWidth(0.4).strokeColor(BRDR).stroke().restore();
  }
  function fillRect(x: number, y: number, w: number, h: number, bg: string) {
    doc.save().rect(x, y, w, h).fill(bg).restore();
  }
  function strokeRect(x: number, y: number, w: number, h: number, color = BRDR, lw = 0.4) {
    doc.save().rect(x, y, w, h).lineWidth(lw).strokeColor(color).stroke().restore();
  }
  function t(
    text: string, x: number, y: number, w: number,
    opts: { fs?: number; bold?: boolean; italic?: boolean; color?: string;
            align?: "left"|"center"|"right"; lb?: boolean; ellipsis?: boolean } = {},
  ) {
    const { fs = 8, bold = false, italic = false, color = BLACK, align = "left", lb = false, ellipsis = false } = opts;
    const font = bold ? "Helvetica-Bold" : italic ? "Helvetica-Oblique" : "Helvetica";
    doc.font(font).fontSize(fs).fillColor(color).text(text, x, y, { width: w, align, lineBreak: lb, ellipsis });
  }

  // ─── Header: full iROC lockup (left) · bilingual title (right) ────────────
  let curY = 26;
  const DN_LOGO_W = 180, DN_LOGO_H = 68;

  try {
    doc.image(ASSETS.logo, ML, curY, { fit: [DN_LOGO_W, DN_LOGO_H] });
  } catch {
    doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY).text("iROC GmbH", ML, curY + 10);
  }

  // Bilingual title — right-aligned
  doc.font("Helvetica").fontSize(26).fillColor(NAVY)
     .text("Lieferschein", ML, curY + 6, { width: CW, align: "right", lineBreak: false });
  doc.font("Helvetica").fontSize(11).fillColor(MGRAY)
     .text("Delivery Note", ML, curY + 36, { width: CW, align: "right", lineBreak: false });
  curY += 72;

  // ─── Address bar + contact ────────────────────────────────────────────────
  hRule(curY);
  curY += 5;
  const addrLine = `${CO.name} | ${CO.street} | ${CO.cityZip}`;
  t(addrLine, ML, curY, CW * 0.48, { fs: 7, color: MGRAY });
  t("Rücksendeanfrage an: / Returns to: ", ML + CW * 0.5, curY, 88, { fs: 7, color: MGRAY });
  doc.font("Helvetica").fontSize(7).fillColor(BLNK)
     .text(CO.email, ML + CW * 0.5 + 89, curY, { width: CW * 0.76 - CW * 0.5 - 91, lineBreak: false });
  t("Rückfragen / Enquiries: ", ML + CW * 0.76, curY, 64, { fs: 7, color: MGRAY });
  t("Kundenberatung", ML + CW * 0.76 + 64, curY, CW * 0.14, { fs: 7, bold: true });
  curY += 9;
  t(CO.phone, ML + CW * 0.76 + 64, curY, CW * 0.14, { fs: 7, bold: true });
  curY += 11;
  hRule(curY);
  curY += 12;

  // ─── Customer block (left) + Bilingual reference grid (right) ────────────
  const refW  = CW * 0.49;
  const refX  = ML + CW - refW;
  const custW = CW - refW - 14;
  const cellW = refW / 2;
  const lblH  = 10;
  const datH  = 14;
  const pairH = lblH + datH;

  const dnNumber = `LS-${row.invoiceNumber}`;

  // Each label: "DE / EN" — fits at 6.5 pt within cellW - 8 ≈ 117 pt
  const refLabels = [
    ["Auftragsnr. / Order No.",    "LS-Nr.* / Del. Note No.*"],
    ["Referenz / Reference",       "Lieferdatum* / Date*"],
    ["Ust-ID / VAT-ID No.",        "Kundennr.* / Customer No.*"],
  ];

  const refVals = [
    [row.orderNumber     ?? "", dnNumber],
    [row.referenceNumber ?? "", row.issueDate],
    [customer?.vatId     ?? "", customer?.customerNr ?? ""],
  ];

  const gridStartY = curY;
  let refY = gridStartY;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      const cx = refX + c * cellW;
      t(refLabels[r][c], cx + 4, refY + 2, cellW - 8, { fs: 6.5, color: MGRAY });
      if (c === 1) fillRect(cx, refY + lblH, cellW, datH, LGRAY);
      t(refVals[r][c], cx + 4, refY + lblH + 3, cellW - 8,
        { fs: c === 1 ? 9 : 8.5, bold: c === 1 });
    }
    doc.save().moveTo(refX, refY + pairH).lineTo(refX + refW, refY + pairH)
       .lineWidth(0.3).strokeColor(BRDR).stroke().restore();
    refY += pairH;
  }
  strokeRect(refX, gridStartY, refW, 3 * pairH, BRDR, 0.4);
  vLine(refX + cellW, gridStartY, gridStartY + 3 * pairH);

  t("* bei Zahlung bitte angeben / please specify when making payment",
    refX, refY + 2, refW, { fs: 6, color: MGRAY, align: "right" });
  refY += 10;

  // Customer address (left) — use shipping address if provided, else billing
  let cy = gridStartY;
  if (shippingInfo && (shippingInfo.firstName || shippingInfo.address)) {
    const nameLine = [shippingInfo.firstName, shippingInfo.lastName].filter(Boolean).join(" ");
    const addrLines: string[] = [];
    if (nameLine) addrLines.push(nameLine);
    if (shippingInfo.institutionName) addrLines.push(shippingInfo.institutionName);
    if (shippingInfo.address) addrLines.push(shippingInfo.address);
    const cityStr = [shippingInfo.postalCode, shippingInfo.city].filter(Boolean).join(" ");
    if (cityStr) addrLines.push(cityStr);
    if (shippingInfo.country) addrLines.push(shippingInfo.country);
    for (const line of addrLines) {
      doc.font("Helvetica").fontSize(8.5).fillColor(BLACK).text(line, ML, cy, { width: custW });
      cy = doc.y + 1;
    }
  } else if (customer) {
    const customerName = stripLegacyCustomerTitlePrefix(customer.name ?? "", customer.title);
    const nameLine = [customer.salutation, customer.title, customerName].filter(Boolean).join(" ");
    const addrLines: string[] = [];
    if (nameLine) addrLines.push(nameLine);
    if (customer.company) addrLines.push(customer.company);
    if (customer.address) addrLines.push(customer.address);
    const cityStr = [customer.postalCode, customer.city].filter(Boolean).join(" ");
    if (cityStr) addrLines.push(cityStr);
    if (customer.country) addrLines.push(customer.country);
    for (const line of addrLines) {
      doc.font("Helvetica").fontSize(8.5).fillColor(BLACK).text(line, ML, cy, { width: custW });
      cy = doc.y + 1;
    }
  }
  curY = Math.max(refY + 10, cy + 12);

  // ─── Items table — bilingual headers, no price/discount/total ────────────
  type Col = { key: string; label: string; w: number; align: "left"|"center"|"right" };
  const TABLE_FS  = 7;
  const PAD_H     = 3;
  const PAD_V     = 3;
  const MIN_ROW_H = 13;
  const MIN_HDR_H = 16;

  function cellMeasure(text: string, colW: number, bold = false, fs = TABLE_FS): number {
    if (!text) return 0;
    try {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fs);
      return doc.heightOfString(text, { width: colW - PAD_H * 2 }) + 4;
    } catch { return fs * 1.35; }
  }
  function renderCell(
    text: string, x: number, y: number, colW: number, rowH: number,
    opts: { bold?: boolean; color?: string; align?: "left"|"center"|"right"; fs?: number } = {},
  ) {
    if (!text) return;
    const { bold = false, color = BLACK, align = "left", fs = TABLE_FS } = opts;
    const font = bold ? "Helvetica-Bold" : "Helvetica";
    const measuredH = cellMeasure(text, colW, bold, fs);
    const singleLine = (measuredH - 4) <= fs * 1.6;
    const ty = singleLine
      ? y + Math.max(PAD_V, (rowH - fs * 1.15) / 2)
      : y + PAD_V;
    if (singleLine) {
      doc.font(font).fontSize(fs).fillColor(color)
         .text(text, x + PAD_H, ty, { width: colW - PAD_H * 2, align, lineBreak: false });
    } else {
      doc.save();
      doc.rect(x, y, colW, rowH).clip();
      doc.font(font).fontSize(fs).fillColor(color)
         .text(text, x + PAD_H, ty, { width: colW - PAD_H * 2, align, lineBreak: true });
      doc.restore();
    }
  }

  // pos:22 + name:90 + desc:230 + lot:90 + qty:79.28 = 511.28
  const dnCols: Col[] = [
    { key: "pos",  label: "Pos.",                    w: 22,    align: "center" },
    { key: "name", label: "Artikel / Item",          w: 90,    align: "left"   },
    { key: "desc", label: "Beschreibung / Description", w: 230, align: "left"  },
    { key: "lot",  label: "LOT-Nr.",                 w: 90,    align: "center" },
    { key: "qty",  label: "Menge / Qty",             w: 79.28, align: "center" },
  ];

  const hdrH = Math.max(MIN_HDR_H, ...dnCols.map(col => cellMeasure(col.label, col.w, true) + PAD_V * 2));
  let tx = ML;
  for (const col of dnCols) {
    fillRect(tx, curY, col.w, hdrH, NAVY);
    renderCell(col.label, tx, curY, col.w, hdrH, { bold: true, color: "#ffffff", align: col.align });
    tx += col.w;
  }
  curY += hdrH;

  items.forEach((item, idx) => {
    const rowBg = idx % 2 === 0 ? "#ffffff" : LGRAY;
    const rowData: Record<string, string> = {
      pos:  String(idx + 1),
      name: item.productName,
      desc: item.description ?? "",
      lot:  item.lotNumber   ?? "",
      qty:  String(item.quantity),
    };
    const rowH = Math.max(MIN_ROW_H, ...dnCols.map(col => cellMeasure(rowData[col.key] ?? "", col.w) + PAD_V * 2));
    let rx = ML;
    for (const col of dnCols) {
      fillRect(rx, curY, col.w, rowH, rowBg);
      renderCell(rowData[col.key] ?? "", rx, curY, col.w, rowH, { align: col.align });
      rx += col.w;
    }
    curY += rowH;
  });

  // Summary row — bilingual
  doc.save().moveTo(ML, curY).lineTo(ML + CW, curY).lineWidth(1.5).strokeColor(NAVY).stroke().restore();
  fillRect(ML, curY, CW, MIN_ROW_H, LGRAY);
  const n = items.length;
  renderCell(
    `${n} Position${n !== 1 ? "en" : ""} / ${n} item${n !== 1 ? "s" : ""}`,
    ML, curY, CW, MIN_ROW_H, { bold: true, fs: 7.5 },
  );
  curY += MIN_ROW_H + 14;

  // Notes (pass-through from invoice)
  if (row.notes) {
    t(row.notes, ML, curY, CW, { fs: 7.5 }); curY += 12;
  }

  // T&C — German line then English line
  t(
    "Die Lieferung erfolgt ausschließlich zu unseren allgemeinen Verkaufsbedingungen, die Sie unter www.i-roc.de/AVB/ einsehen können.",
    ML, curY, CW, { fs: 7.5 },
  );
  curY += 10;
  t(
    "Delivery is made exclusively under our General Terms and Conditions, available at www.i-roc.de/AVB/.",
    ML, curY, CW, { fs: 7.5, italic: true, color: MGRAY },
  );
  curY += 14;

  // ─── Banner — bilingual ───────────────────────────────────────────────────
  const bannerH = 20;
  fillRect(ML, curY, CW, bannerH, LBLUE);
  const bty = curY + Math.max(1, (bannerH - 9 * 1.15) / 2);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY)
     .text("Vielen Dank für Ihren Auftrag.  ·  Thank you for your business.",
       ML, bty, { width: CW, align: "center", lineBreak: false });

  // ─── Fixed footer (shared design with invoice) ────────────────────────────
  const footerY = doc.page.height - 62;
  doc.save().moveTo(ML, footerY - 4).lineTo(ML + CW, footerY - 4)
     .lineWidth(1.5).strokeColor(NAVY).stroke().restore();

  const COL_W = CW / 5;
  const fcols: string[][] = [
    [CO.name, CO.street, CO.cityZip, "Deutschland"],
    ["Kontakt", `T ${CO.phoneDirect}`, `F ${CO.fax}`, CO.email, CO.web],
    ["Geschäftsführung", CO.ceo1, CO.ceo2, CO.court, CO.hrb],
    ["Sitz der Gesellschaft", CO.street, `D-${CO.cityZip}`, "Deutschland", CO.vatDe],
    ["Bankverbindung", CO.bank, `BIC/SWIFT: ${CO.bic}`, `IBAN: ${CO.iban}`, `EORI: ${CO.eori}`],
  ];
  for (let i = 0; i < fcols.length; i++) {
    const fx = ML + i * COL_W;
    let fy = footerY;
    const fs = 5.5;
    for (let li = 0; li < fcols[i].length; li++) {
      const fnt = li === 0 ? "Helvetica-Bold" : "Helvetica";
      const colW = COL_W - 3;
      doc.font(fnt).fontSize(fs).fillColor(MGRAY);
      const lineH = doc.heightOfString(fcols[i][li], { width: colW });
      doc.text(fcols[i][li], fx, fy, { width: colW, lineBreak: true });
      fy += Math.max(lineH, 7) + 1;
    }
  }
}

// ── Token helpers ─────────────────────────────────────────────────────────────
const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

/** Token lifetime in seconds. Default: 8 hours. Override via TOKEN_TTL_SECONDS env var. */
const TOKEN_TTL_SECONDS = parseInt(process.env.TOKEN_TTL_SECONDS ?? "", 10) || 8 * 60 * 60;

function signToken(payload: { userId: number; username: string }): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const full = { ...payload, exp };
  const data = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(
  token: string,
): { userId: number; username: string } | null {
  try {
    const [data, sig] = token.split(".");
    if (!data || !sig) return null;
    const expected = crypto
      .createHmac("sha256", SECRET)
      .update(data)
      .digest("base64url");
    if (sig !== expected) return null;
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString());
    // Reject tokens that are missing exp or are at/past their expiry.
    // Legacy tokens without exp are intentionally invalid — admins must log in again.
    if (typeof parsed.exp !== "number") return null;
    if (Math.floor(Date.now() / 1000) >= parsed.exp) return null;
    return { userId: parsed.userId, username: parsed.username };
  } catch {
    return null;
  }
}

// ── Password helpers (scrypt, no extra deps) ──────────────────────────────────
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, 32)
    .toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 32).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(derived, "hex"),
  );
}

// ── Seed / sync admin user ────────────────────────────────────────────────────
// Always updates the hash to match the current ADMIN_PASSWORD secret so that
// rotating the secret (or setting it after initial deploy) takes effect on the
// next server restart without needing a manual DB edit.
async function ensureAdminUser() {
  try {
    const currentPassword = process.env.ADMIN_PASSWORD ?? "iroc-admin-2024";
    const [existing] = await db
      .select()
      .from(irocAppUsers)
      .limit(1);
    if (!existing) {
      await db.insert(irocAppUsers).values({
        username: "admin",
        passwordHash: hashPassword(currentPassword),
      });
    } else {
      // Keep manual password changes across restarts. The bootstrap secret
      // still rotates the password for accounts that have never changed it.
      if (!existing.passwordChangedAt && !verifyPassword(currentPassword, existing.passwordHash)) {
        await db
          .update(irocAppUsers)
          .set({ passwordHash: hashPassword(currentPassword) })
          .where(eq(irocAppUsers.id, existing.id));
      }
    }
  } catch {
    // DB not ready yet — will retry on first login
  }
}
ensureAdminUser();

// ── Auth middleware ───────────────────────────────────────────────────────────
interface IrocRequest extends Request {
  irocUser?: { userId: number; username: string };
}

export function requireIrocAuth(
  req: IrocRequest,
  res: Response,
  next: NextFunction,
): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  req.irocUser = payload;
  next();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post("/iroc/login", async (req: Request, res: Response) => {
  const parsed = IrocLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login data" });
    return;
  }
  const { username, password } = parsed.data;
  try {
    // Ensure admin exists before first login attempt
    await ensureAdminUser();
    const [user] = await db
      .select()
      .from(irocAppUsers)
      .where(eq(irocAppUsers.username, username));
    if (!user || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = signToken({ userId: user.id, username: user.username });
    res.json({ token, username: user.username });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

router.get(
  "/iroc/me",
  requireIrocAuth,
  async (req: IrocRequest, res: Response) => {
    res.json({ authenticated: true, username: req.irocUser?.username ?? null });
  },
);

router.patch(
  "/iroc/me",
  requireIrocAuth,
  async (req: IrocRequest, res: Response) => {
    const parsed = UpdateIrocMeBody.safeParse(req.body);
    if (!parsed.success || !req.irocUser) {
      res.status(400).json({ error: "Invalid username" });
      return;
    }

    const username = parsed.data.username.trim();
    if (!username) {
      res.status(400).json({ error: "Username cannot be empty" });
      return;
    }

    try {
      const [currentUser] = await db
        .select({ id: irocAppUsers.id, username: irocAppUsers.username })
        .from(irocAppUsers)
        .where(eq(irocAppUsers.id, req.irocUser.userId))
        .limit(1);
      if (!currentUser) {
        res.status(401).json({ error: "User account not found" });
        return;
      }

      if (currentUser.username !== username) {
        const [conflictingUser] = await db
          .select({ id: irocAppUsers.id })
          .from(irocAppUsers)
          .where(eq(irocAppUsers.username, username))
          .limit(1);
        if (conflictingUser && conflictingUser.id !== currentUser.id) {
          res.status(409).json({ error: "Username is already in use" });
          return;
        }
      }

      const [updatedUser] = await db
        .update(irocAppUsers)
        .set({ username })
        .where(eq(irocAppUsers.id, currentUser.id))
        .returning({ id: irocAppUsers.id, username: irocAppUsers.username });

      if (!updatedUser) {
        res.status(404).json({ error: "User account not found" });
        return;
      }

      const token = signToken({ userId: updatedUser.id, username: updatedUser.username });
      res.json({
        authenticated: true,
        username: updatedUser.username,
        token,
      });
    } catch (err) {
      if ((err as { code?: string })?.code === "23505") {
        res.status(409).json({ error: "Username is already in use" });
        return;
      }
      console.error("[iroc] Failed to update username:", err);
      res.status(500).json({ error: "Failed to update username" });
    }
  },
);

router.patch(
  "/iroc/password",
  requireIrocAuth,
  async (req: IrocRequest, res: Response) => {
    const parsed = ChangeIrocPasswordBody.safeParse(req.body);
    if (!parsed.success || !req.irocUser) {
      res.status(400).json({ error: "Invalid password data" });
      return;
    }

    const { currentPassword, newPassword } = parsed.data;
    if (currentPassword === newPassword) {
      res.status(400).json({ error: "New password must be different" });
      return;
    }

    try {
      const [currentUser] = await db
        .select({
          id: irocAppUsers.id,
          passwordHash: irocAppUsers.passwordHash,
        })
        .from(irocAppUsers)
        .where(eq(irocAppUsers.id, req.irocUser.userId))
        .limit(1);
      if (!currentUser) {
        res.status(401).json({ error: "User account not found" });
        return;
      }

      if (!verifyPassword(currentPassword, currentUser.passwordHash)) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      await db
        .update(irocAppUsers)
        .set({
          passwordHash: hashPassword(newPassword),
          passwordChangedAt: new Date(),
        })
        .where(eq(irocAppUsers.id, currentUser.id));

      res.json({ success: true });
    } catch (err) {
      console.error("[iroc] Failed to update password:", err);
      res.status(500).json({ error: "Failed to update password" });
    }
  },
);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get(
  "/iroc/dashboard",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    try {
      // Optional ?year=YYYY filter for invoice metrics
      const yearParam = req.query.year;
      const year =
        typeof yearParam === "string" && /^\d{4}$/.test(yearParam)
          ? yearParam
          : null;
      const yearFilter = year
        ? like(irocInvoices.issueDate, `${year}-%`)
        : undefined;

      // Non-invoice metrics are always all-time
      // totalCustomers counts website_customers — the current source of truth used by CustomersList
      const [
        [{ totalCustomers }],
        [{ totalProducts }],
        [{ lowStockCount }],
        [{ unreadNotifications }],
        [{ pendingIncomingOrders }],
        [{ confirmedIncomingOrders }],
      ] =
        await Promise.all([
          db.select({ totalCustomers: count() }).from(websiteCustomersTable),
          db.select({ totalProducts: count() }).from(irocProducts),
          db
            .select({ lowStockCount: count() })
            .from(irocProducts)
            .where(lte(irocProducts.stockQuantity, irocProducts.lowStockThreshold)),
          db
            .select({ unreadNotifications: count() })
            .from(irocNotifications)
            .where(eq(irocNotifications.isRead, false)),
          db
            .select({ pendingIncomingOrders: count() })
            .from(irocOrders)
            .where(eq(irocOrders.status, "pending")),
          db
            .select({ confirmedIncomingOrders: count() })
            .from(irocOrders)
            .where(eq(irocOrders.status, "approved")),
        ]);

      // Invoice metrics — filtered by year when ?year is set
      const [[{ totalInvoices }], [{ revenueTotal }], [{ revenueSent }], statusRows] =
        await Promise.all([
          db
            .select({ totalInvoices: count() })
            .from(irocInvoices)
            .where(yearFilter),
          db
            .select({ revenueTotal: sum(irocInvoices.total) })
            .from(irocInvoices)
            .where(and(eq(irocInvoices.status, "paid"), yearFilter)),
          db
            .select({ revenueSent: sum(irocInvoices.total) })
            .from(irocInvoices)
            .where(and(eq(irocInvoices.status, "sent"), yearFilter)),
          db
            .select({ status: irocInvoices.status, n: count() })
            .from(irocInvoices)
            .where(yearFilter)
            .groupBy(irocInvoices.status),
        ]);

      const invoicesByStatus = { draft: 0, sent: 0, paid: 0, cancelled: 0 };
      for (const row of statusRows) {
        if (row.status === "draft") invoicesByStatus.draft = row.n;
        else if (row.status === "sent") invoicesByStatus.sent = row.n;
        else if (row.status === "paid") invoicesByStatus.paid = row.n;
        else if (row.status === "cancelled") invoicesByStatus.cancelled = row.n;
      }

      // Available years for the frontend dropdown — always all invoices
      const yearRows = await db
        .selectDistinct({
          year: sql<number>`SUBSTR(${irocInvoices.issueDate}, 1, 4)::int`,
        })
        .from(irocInvoices)
        .orderBy(desc(sql`SUBSTR(${irocInvoices.issueDate}, 1, 4)::int`));
      const availableYears = yearRows.map((r) => r.year).filter(Boolean);

      const { settingsTable: st } = await import("@workspace/db");
      const quoteRows = await db
        .select()
        .from(st)
        .where(like(st.key, `${POSTOP_PREFIX_IROC}%`));
      const pendingQuotes = quoteRows
        .map((r) => { try { return JSON.parse(r.value); } catch { return null; } })
        .filter(Boolean)
        .filter((s: Record<string, unknown>) => s.shareQuote === true && s.quoteApproved == null)
        .length;

      // Recent orders — only customers who have at least one open invoice.
      // Draft and sent invoices are open; paid and cancelled invoices are not.
      const recentOrderRows = await db
        .select({
          id:              websiteCustomersTable.id,
          firstName:       websiteCustomersTable.firstName,
          lastName:        websiteCustomersTable.lastName,
          institutionName: websiteCustomersTable.institutionName,
          email:           websiteCustomersTable.email,
          instrument:      websiteCustomersTable.instrument,
          createdAt:       websiteCustomersTable.createdAt,
          openOrderCount:  count(irocInvoices.id),
        })
        .from(websiteCustomersTable)
        .innerJoin(
          irocInvoices,
          eq(irocInvoices.websiteCustomerId, websiteCustomersTable.id),
        )
        .where(inArray(irocInvoices.status, ["draft", "sent"]))
        .groupBy(
          websiteCustomersTable.id,
          websiteCustomersTable.firstName,
          websiteCustomersTable.lastName,
          websiteCustomersTable.institutionName,
          websiteCustomersTable.email,
          websiteCustomersTable.instrument,
          websiteCustomersTable.createdAt,
        )
        .orderBy(desc(websiteCustomersTable.createdAt))
        .limit(5);

      // Total pending (non-certified) training registrations
      const [{ pendingTrainings }] = await db
        .select({ pendingTrainings: count() })
        .from(trainingRegistrationsTable)
        .where(isNull(trainingRegistrationsTable.certifiedDoctorId));

      // Upcoming training registrations — exclude completed/certified entries
      // certifiedDoctorId is set when training completed and certificate was issued
      const recentTrainingRows = await db
        .select({
          id:               trainingRegistrationsTable.id,
          medicalDegree:    trainingRegistrationsTable.medicalDegree,
          firstName:        trainingRegistrationsTable.firstName,
          lastName:         trainingRegistrationsTable.lastName,
          email:            trainingRegistrationsTable.email,
          instrument:       trainingRegistrationsTable.instrument,
          trainingDateInfo: trainingRegistrationsTable.trainingDateInfo,
          createdAt:        trainingRegistrationsTable.createdAt,
        })
        .from(trainingRegistrationsTable)
        .where(isNull(trainingRegistrationsTable.certifiedDoctorId))
        .orderBy(desc(trainingRegistrationsTable.createdAt))
        .limit(5);

      // Per-category outstanding totals — gross amounts (inc. VAT), split proportionally.
      // category_gross = invoice.total × (category_net_items / invoice_total_net_items)
      // Done in JS to avoid raw-SQL array param issues with the Drizzle/node-postgres driver.
      const customerIds = recentOrderRows.map(r => r.id).filter(Boolean) as number[];

      const [openInvoiceRows, itemRows] = customerIds.length > 0
        ? await Promise.all([
            // Gross totals per open invoice
            db.select({
              id:         irocInvoices.id,
              customerId: irocInvoices.websiteCustomerId,
              total:      irocInvoices.total,
            })
            .from(irocInvoices)
            .where(and(
              inArray(irocInvoices.status, ["draft", "sent"]),
              inArray(irocInvoices.websiteCustomerId as any, customerIds),
            )),
            // Line items with category for those invoices (via joined invoices filter)
            db.select({
              invoiceId:   irocInvoiceItems.invoiceId,
              productName: irocInvoiceItems.productName,
              category:    irocProducts.category,
              lineTotal:   irocInvoiceItems.lineTotal,
            })
            .from(irocInvoiceItems)
            .innerJoin(irocInvoices, eq(irocInvoices.id, irocInvoiceItems.invoiceId))
            .leftJoin(irocProducts, eq(irocProducts.id, irocInvoiceItems.productId))
            .where(and(
              inArray(irocInvoices.status, ["draft", "sent"]),
              inArray(irocInvoices.websiteCustomerId as any, customerIds),
            )),
          ])
        : [[], []];

      // Build invoice gross lookup: invoiceId → { customerId, gross }
      const invoiceGrossMap = new Map<number, { customerId: number; gross: number }>();
      for (const inv of openInvoiceRows) {
        if (inv.customerId != null)
          invoiceGrossMap.set(inv.id, { customerId: inv.customerId, gross: parseFloat(inv.total ?? "0") });
      }

      // Accumulate net totals per invoice per category (replace window function with JS loop)
      const invoiceCategoryNet = new Map<number, Map<string, number>>();
      const invoiceTotalNet    = new Map<number, number>();
      for (const item of itemRows) {
        const cat = inferCategory(item.category, item.productName);
        const net = parseFloat(item.lineTotal ?? "0");
        const byCategory = invoiceCategoryNet.get(item.invoiceId) ?? new Map<string, number>();
        byCategory.set(cat, (byCategory.get(cat) ?? 0) + net);
        invoiceCategoryNet.set(item.invoiceId, byCategory);
        invoiceTotalNet.set(item.invoiceId, (invoiceTotalNet.get(item.invoiceId) ?? 0) + net);
      }

      // Compute proportional gross per customer per category and sum
      const categoryTotalsAccum = new Map<number, Map<string, number>>();
      for (const [invoiceId, byCategory] of invoiceCategoryNet) {
        const invInfo  = invoiceGrossMap.get(invoiceId);
        const totalNet = invoiceTotalNet.get(invoiceId) ?? 0;
        if (!invInfo || totalNet === 0) continue;
        const byCustomer = categoryTotalsAccum.get(invInfo.customerId) ?? new Map<string, number>();
        for (const [cat, catNet] of byCategory) {
          const catGross = invInfo.gross * (catNet / totalNet);
          byCustomer.set(cat, (byCustomer.get(cat) ?? 0) + catGross);
        }
        categoryTotalsAccum.set(invInfo.customerId, byCustomer);
      }

      // Seed every customer returned by the open-invoice query so an invoice
      // without line items still has a stable categoryTotals array.
      const categoryTotalsByCustomer = new Map<number, { category: string; total: string }[]>();
      for (const row of recentOrderRows) {
        categoryTotalsByCustomer.set(row.id, []);
      }
      for (const [custId, byCategory] of categoryTotalsAccum) {
        categoryTotalsByCustomer.set(
          custId,
          Array.from(byCategory.entries()).map(([category, total]) => ({
            category,
            total: total.toFixed(2),
          })),
        );
      }

      const recentOrders = recentOrderRows.map(r => ({
        id:              r.id,
        name:            [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email,
        institutionName: r.institutionName ?? null,
        email:           r.email,
        instrument:      r.instrument,
        createdAt:       r.createdAt.toISOString(),
        openOrderCount:  r.openOrderCount,
        categoryTotals:  categoryTotalsByCustomer.get(r.id) ?? [],
      }));

      const recentTrainings = recentTrainingRows.map(r => ({
        id:               r.id,
        name:             [r.medicalDegree, r.firstName, r.lastName].filter(Boolean).join(" ") || r.email,
        email:            r.email,
        instrument:       r.instrument,
        trainingDateInfo: r.trainingDateInfo ?? null,
        createdAt:        r.createdAt.toISOString(),
      }));

      res.json({
        totalCustomers,
        totalProducts,
        totalInvoices,
        lowStockCount,
        unreadNotifications,
        revenueTotal: revenueTotal ?? "0",
        revenueSent: revenueSent ?? "0",
        availableYears,
        invoicesByStatus,
        incomingOrders: {
          pending: pendingIncomingOrders,
          approved: confirmedIncomingOrders,
        },
        pendingQuotes,
        pendingTrainings,
        recentOrders,
        recentTrainings,
      });
    } catch {
      res.status(500).json({ error: "Failed to load dashboard" });
    }
  },
);

// ── Customers ─────────────────────────────────────────────────────────────────
router.get(
  "/iroc/customers",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(irocCustomers)
      .orderBy(desc(irocCustomers.createdAt));
    res.json(
      rows.map((r) => ({
        ...r,
        name: stripLegacyCustomerTitlePrefix(r.name, r.title),
        createdAt: r.createdAt.toISOString(),
        updatedAt: undefined,
      })),
    );
  },
);

router.post(
  "/iroc/customers",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const parsed = CreateIrocCustomerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid customer data" });
      return;
    }
    const [row] = await db
      .insert(irocCustomers)
      .values({
        ...parsed.data,
        name: stripLegacyCustomerTitlePrefix(parsed.data.name, parsed.data.title),
        isEu: parsed.data.isEu ?? false,
      })
      .returning();
    res.status(201).json({
      ...row,
      name: stripLegacyCustomerTitlePrefix(row.name, row.title),
      createdAt: row.createdAt.toISOString(),
    });
  },
);

// ── Controlled legacy title cleanup ────────────────────────────────────────────
// Dry-run is the default. Applying requires an explicit { apply: true } body so
// an audit can be reviewed before any legacy customer names are changed.
router.post(
  "/iroc/customers/cleanup-duplicated-titles",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const apply = req.body?.apply === true;
    const rows = await db
      .select({
        id: irocCustomers.id,
        title: irocCustomers.title,
        name: irocCustomers.name,
      })
      .from(irocCustomers)
      .where(isNotNull(irocCustomers.title));

    const candidates: Array<{
      id: number;
      title: string;
      originalName: string;
      cleanedName: string;
      matchedPrefix: string;
    }> = [];
    const skipped: Array<{
      id: number;
      title: string;
      name: string;
      matchedPrefix: string | null;
      reason: "ambiguous";
    }> = [];

    for (const row of rows) {
      if (!row.title?.trim()) continue;
      const analysis = analyzeLegacyCustomerTitleCleanup(row.name, row.title);
      if (analysis.status === "duplicate" && analysis.matchedPrefix) {
        candidates.push({
          id: row.id,
          title: row.title,
          originalName: analysis.originalName,
          cleanedName: analysis.cleanedName,
          matchedPrefix: analysis.matchedPrefix,
        });
      } else if (analysis.status === "ambiguous") {
        skipped.push({
          id: row.id,
          title: row.title,
          name: analysis.originalName,
          matchedPrefix: analysis.matchedPrefix,
          reason: "ambiguous",
        });
      }
    }

    let updated = 0;
    if (apply && candidates.length > 0) {
      await db.transaction(async (tx) => {
        for (const candidate of candidates) {
          const [changed] = await tx
            .update(irocCustomers)
            .set({
              name: candidate.cleanedName,
              updatedAt: new Date(),
            })
            .where(and(
              eq(irocCustomers.id, candidate.id),
              eq(irocCustomers.title, candidate.title),
              eq(irocCustomers.name, candidate.originalName),
            ))
            .returning({ id: irocCustomers.id });
          if (changed) updated++;
        }
      });
    }

    res.json({
      ok: true,
      dryRun: !apply,
      scanned: rows.length,
      candidateCount: candidates.length,
      updated,
      unchanged: rows.length - candidates.length - skipped.length,
      candidates,
      skipped,
    });
  },
);

router.get(
  "/iroc/customers/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [row] = await db
      .select()
      .from(irocCustomers)
      .where(eq(irocCustomers.id, id));
    if (!row) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json({
      ...row,
      name: stripLegacyCustomerTitlePrefix(row.name, row.title),
      createdAt: row.createdAt.toISOString(),
    });
  },
);

router.patch(
  "/iroc/customers/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const parsed = UpdateIrocCustomerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid customer data" });
      return;
    }
    const [row] = await db
      .update(irocCustomers)
      .set({
        ...parsed.data,
        name: stripLegacyCustomerTitlePrefix(parsed.data.name, parsed.data.title),
        updatedAt: new Date(),
      })
      .where(eq(irocCustomers.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json({
      ...row,
      name: stripLegacyCustomerTitlePrefix(row.name, row.title),
      createdAt: row.createdAt.toISOString(),
    });
  },
);

router.delete(
  "/iroc/customers/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    await db.delete(irocCustomers).where(eq(irocCustomers.id, id));
    res.json({ message: "Customer deleted" });
  },
);

// ── Combined customer list (iROC + website) ────────────────────────────────────
router.get(
  "/iroc/customers-combined",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const [irocList, websiteList] = await Promise.all([
      db.select().from(irocCustomers).orderBy(desc(irocCustomers.createdAt)),
      db.select().from(websiteCustomersTable).orderBy(desc(websiteCustomersTable.createdAt)),
    ]);
    const combined = [
      ...irocList.map(r => ({
        source: "iroc" as const,
        id: r.id,
        salutation: (r as any).salutation ?? null as string | null,
        title: (r as any).title ?? null as string | null,
        name: stripLegacyCustomerTitlePrefix(r.name, r.title),
        company: r.company ?? null,
        email: r.email ?? null,
        country: r.country ?? null,
        shippingCountry: null as string | null,
        city: r.city ?? null,
        address: [r.address, r.street, r.houseNumber].filter(Boolean).join(" ") || null,
        postalCode: r.postalCode ?? null,
        isEu: r.isEu,
        vatId: r.vatId ?? null,
        isPublicAuthority: false,
        defaultBuyerReference: null as string | null,
        irocCustomerId: r.id,
        customerNr: null as string | null,
      })),
      ...websiteList.map(r => ({
        source: "website" as const,
        id: r.id,
        salutation: r.salutation ?? null,
        title: r.title ?? null,
        name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email,
        company: r.institutionName ?? null,
        email: r.email,
        country: r.country ?? null,
        shippingCountry: r.shippingCountry ?? null,
        city: r.city ?? null,
        address: [r.address, r.street, r.houseNumber].filter(Boolean).join(" ") || null,
        postalCode: r.postalCode ?? null,
        isEu: null as boolean | null,
        vatId: r.ustIdNr ?? null,
        isPublicAuthority: r.isPublicAuthority,
        defaultBuyerReference: r.defaultBuyerReference ?? null,
        irocCustomerId: null as number | null,
        customerNr: r.customerNr ?? null,
      })),
    ];
    res.json(combined);
  },
);

// ── Import website customer into iROC customers (deduplicates by email) ────────
const EU_COUNTRIES = new Set(["AT","BE","BG","CY","CZ","DK","EE","FI","FR","GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK"]);

router.post(
  "/iroc/customers/from-website",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { websiteCustomerId } = req.body as { websiteCustomerId: number };
    const [wc] = await db
      .select()
      .from(websiteCustomersTable)
      .where(eq(websiteCustomersTable.id, websiteCustomerId));
    if (!wc) {
      res.status(404).json({ error: "Website customer not found" });
      return;
    }
    // Deduplicate by email
    if (wc.email) {
      const [existing] = await db
        .select()
        .from(irocCustomers)
        .where(eq(irocCustomers.email, wc.email));
      if (existing) {
        res.json({ ...existing, createdAt: existing.createdAt.toISOString() });
        return;
      }
    }
    const fullName = [wc.firstName, wc.lastName].filter(Boolean).join(" ") || wc.email;
    const countryUpper = wc.country?.toUpperCase() ?? "";
    const isEu = EU_COUNTRIES.has(countryUpper);
    const [created] = await db
      .insert(irocCustomers)
      .values({
        name: fullName,
        company: wc.institutionName ?? null,
        address: wc.address ?? null,
        city: wc.city ?? null,
        postalCode: wc.postalCode ?? null,
        country: wc.country ?? "DE",
        vatId: wc.ustIdNr ?? null,
        isEu,
        email: wc.email,
        phone: wc.phone ?? null,
        notes: wc.specialty ? `Specialty: ${wc.specialty}` : null,
      })
      .returning();
    res.status(201).json({ ...created, createdAt: created.createdAt.toISOString() });
  },
);

// ── Auto-increment customer number (YYYY-####) ────────────────────────────────
async function nextCustomerNr(
  executor: Pick<typeof db, "select"> = db,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  const [row] = await executor
    .select({ maxNr: sql<string>`MAX(customer_nr)` })
    .from(websiteCustomersTable)
    .where(sql`customer_nr LIKE ${prefix + "%"}`);
  const current = row?.maxNr;
  let seq = 1;
  if (current) {
    const num = parseInt(current.split("-")[1] ?? "0", 10);
    if (!isNaN(num) && num >= seq) seq = num + 1;
  }
  return `${year}-${String(seq).padStart(4, "0")}`;
}

function normalizeCustomerCertifications(
  certifications: unknown,
  instrument: unknown,
): string[] {
  const source = Array.isArray(certifications)
    ? certifications
    : typeof certifications === "string"
      ? [certifications]
      : typeof instrument === "string"
        ? [instrument]
        : [];

  return [...new Set(
    source
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase())
      .flatMap((value) => value === "both" ? ["spirecut", "ministem"] : [value])
      .filter(Boolean),
  )];
}

// ── Website Customers CRUD (managed from iROC app) ────────────────────────────
router.get(
  "/iroc/website-customers",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(websiteCustomersTable)
      .orderBy(desc(websiteCustomersTable.createdAt));
    res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
  },
);

// ── Regenerate a customer's reorder code (e.g. if compromised) ────────────────
router.post(
  "/iroc/website-customers/:id/reorder-code",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const [wc] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, id));
    if (!wc) { res.status(404).json({ error: "Customer not found" }); return; }
    const reorderCode = await generateUniqueReorderCode();
    await db.update(websiteCustomersTable).set({ reorderCode }).where(eq(websiteCustomersTable.id, id));
    res.json({ id, reorderCode });
  },
);

// ── Assign missing reorder codes without replacing existing ones ───────────────
router.post(
  "/iroc/website-customers/reorder-codes",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const body = req.body as { customerIds?: unknown };
    if (
      !Array.isArray(body.customerIds)
      || body.customerIds.length === 0
      || body.customerIds.length > 500
      || body.customerIds.some((id) => typeof id !== "number" || !Number.isInteger(id) || id <= 0)
    ) {
      res.status(400).json({
        error: "customerIds must be a non-empty list of up to 500 positive integer IDs",
      });
      return;
    }

    const customerIds = [...new Set(body.customerIds as number[])];
    const result = await assignMissingReorderCodes(customerIds);
    res.json(result);
  },
);

async function assignMissingReorderCodes(customerIds: number[]): Promise<{
  requested: number;
  assigned: number;
  skipped: number;
  notFound: number;
}> {
  // The partial unique index protects against collisions with other requests.
  // If two requests happen to generate the same random code concurrently,
  // retry the whole transaction rather than returning a partial result.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: websiteCustomersTable.id,
            reorderCode: websiteCustomersTable.reorderCode,
          })
          .from(websiteCustomersTable)
          .where(inArray(websiteCustomersTable.id, customerIds));

        const reservedCodes = new Set<string>();
        let assigned = 0;
        let skipped = 0;

        for (const row of rows) {
          if (row.reorderCode?.trim()) {
            skipped++;
            continue;
          }

          const reorderCode = await generateUniqueReorderCode(reservedCodes);
          reservedCodes.add(reorderCode);
          const [updated] = await tx
            .update(websiteCustomersTable)
            .set({ reorderCode })
            .where(
              and(
                eq(websiteCustomersTable.id, row.id),
                or(
                  isNull(websiteCustomersTable.reorderCode),
                  sql`btrim(${websiteCustomersTable.reorderCode}) = ''`,
                ),
              ),
            )
            .returning({ id: websiteCustomersTable.id });

          if (updated) assigned++;
          else skipped++;
        }

        return {
          requested: customerIds.length,
          assigned,
          skipped,
          notFound: customerIds.length - rows.length,
        };
      });
    } catch (error) {
      if ((error as { code?: string })?.code !== "23505" || attempt === 4) throw error;
    }
  }

  throw new Error("Could not assign missing reorder codes");
}

// ── Incoming website orders (approval flow) ───────────────────────────────────
router.get(
  "/iroc/orders",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const rows = await db.select().from(irocOrders).orderBy(desc(irocOrders.createdAt));
    // Map orders to their auto-drafted invoices (source_order_id link)
    const linkedInvoices = await db
      .select({ id: irocInvoices.id, invoiceNumber: irocInvoices.invoiceNumber, status: irocInvoices.status, sourceOrderId: irocInvoices.sourceOrderId })
      .from(irocInvoices)
      .where(isNotNull(irocInvoices.sourceOrderId));
    const invByOrder = new Map(linkedInvoices.map(i => [i.sourceOrderId, i]));
    res.json(rows.map(r => ({
      ...r,
      approvalToken: undefined, // never expose the token to the client
      createdAt: r.createdAt.toISOString(),
      approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      invoice: invByOrder.has(r.id)
        ? { id: invByOrder.get(r.id)!.id, invoiceNumber: invByOrder.get(r.id)!.invoiceNumber, status: invByOrder.get(r.id)!.status }
        : null,
    })));
  },
);

router.delete(
  "/iroc/orders/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid order id" });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: shipments } = await client.query(
        "SELECT id FROM iroc_order_shipments WHERE order_id = $1 FOR UPDATE",
        [id],
      );
      if (shipments.length) {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "ORDER_HAS_SHIPMENT",
          message: "Orders with an existing shipment cannot be deleted.",
        });
        return;
      }

      const { rows: deleted } = await client.query<{ id: number }>(
        "DELETE FROM iroc_orders WHERE id = $1 RETURNING id",
        [id],
      );
      if (!deleted.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Order not found" });
        return;
      }

      // Prevent an old missing-information draft from being sent after its
      // source order has been removed.
      await client.query(
        `UPDATE sally_email_queue
         SET status = 'cancelled', updated_at = NOW()
         WHERE related_order_id = $1 AND status = 'pending'`,
        [id],
      );
      await client.query("COMMIT");
      res.json({ message: "Order deleted", id: deleted[0].id });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },
);

router.post(
  "/iroc/website-customers",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const {
      salutation, title,
      firstName, lastName, institutionName, institutionType, specialty,
      email, phone, fax, website, referenceNumber,
      isPublicAuthority, defaultBuyerReference,
      address, postalCode, city, country, ustIdNr,
      instrument, certifications,
      notes,
      shippingFirstName, shippingLastName, shippingInstitutionName,
      shippingAddress, shippingPostalCode, shippingCity, shippingCountry,
      shippingPhone, shippingEmail,
    } = req.body;
    if (!email) { res.status(400).json({ error: "email is required" }); return; }

    // Bulk imports identify the source registration so a lost or delayed
    // response cannot cause a second request to create another customer. The
    // transaction-scoped lock also lets us tell the admin that another import
    // is still running instead of making the request wait indefinitely.
    const sourceRegistrationId = req.body?.sourceRegistrationId;
    if (
      typeof sourceRegistrationId === "number"
      && Number.isSafeInteger(sourceRegistrationId)
      && sourceRegistrationId > 0
    ) {
      const result = await db.transaction(async (tx) => {
        const lockResult = await tx.execute(sql`
          SELECT pg_try_advisory_xact_lock(
            hashtextextended(${`iroc-training-registration-customer:${sourceRegistrationId}`}, 0)
          ) AS locked
        `);
        const locked = Boolean(
          (lockResult as unknown as { rows?: Array<{ locked?: boolean }> }).rows?.[0]?.locked,
        );
        if (!locked) {
          return { kind: "in_progress" as const };
        }

        const [existing] = await tx
          .select()
          .from(websiteCustomersTable)
          .where(sql`LOWER(${websiteCustomersTable.email}) = LOWER(${email})`)
          .limit(1);
        if (existing) {
          return {
            kind: "already_imported" as const,
            existing,
          };
        }

        const normalizedCertifications = normalizeCustomerCertifications(
          certifications,
          instrument || "other",
        );
        if (normalizedCertifications.length === 0) {
          return { kind: "invalid_certification" as const };
        }

        const customerNr = await nextCustomerNr(tx);
        const normalizedNames = normalizeWebsiteCustomerNameFields({ title, firstName, lastName });
        const [created] = await tx
          .insert(websiteCustomersTable)
          .values({
            customerNr,
            // Keep first imports consistent with repeat imports: whitespace-only
            // honorific fields have no semantic value and must not block a later
            // real value from being backfilled.
            salutation: typeof salutation === "string" && salutation.trim() ? salutation : null,
            title: typeof title === "string" && title.trim() ? title : null,
            firstName: normalizedNames.firstName ?? null,
            lastName: normalizedNames.lastName ?? null,
            institutionName: institutionName || null,
            institutionType: institutionType || null,
            specialty: specialty || null,
            email,
            phone: phone || null, fax: fax || null,
            website: website || null,
            referenceNumber: referenceNumber || null,
            isPublicAuthority: isPublicAuthority === true,
            defaultBuyerReference: defaultBuyerReference || null,
            address: address || null, postalCode: postalCode || null,
            city: city || null, country: country || "DE",
            ustIdNr: ustIdNr || null,
            instrument: instrument || "other",
            certifications: normalizedCertifications,
            reorderCode: await generateUniqueReorderCode(),
            notes: notes || null,
            shippingFirstName: shippingFirstName || null,
            shippingLastName: shippingLastName || null,
            shippingInstitutionName: shippingInstitutionName || null,
            shippingAddress: shippingAddress || null,
            shippingPostalCode: shippingPostalCode || null,
            shippingCity: shippingCity || null,
            shippingCountry: shippingCountry || null,
            shippingPhone: shippingPhone || null,
            shippingEmail: shippingEmail || null,
            privacyConsent: true,
          })
          .returning();
        return { kind: "created" as const, created };
      });

      if (result.kind === "in_progress") {
        res.status(409).json({
          error: "customer_import_in_progress",
          registrationId: sourceRegistrationId,
          message: "This registration is already being imported.",
        });
        return;
      }
      if (result.kind === "already_imported") {
        res.status(409).json({
          error: "customer_already_imported",
          existingId: result.existing.id,
          customerNr: result.existing.customerNr,
          registrationId: sourceRegistrationId,
          message: `This registration was already imported as customer ${result.existing.id}.`,
        });
        return;
      }
      if (result.kind === "invalid_certification") {
        res.status(400).json({ error: "At least one certification is required" });
        return;
      }
      res.status(201).json({ ...result.created, createdAt: result.created.createdAt.toISOString() });
      return;
    }

    // Check for an existing customer with the same email before inserting
    const [existing] = await db
      .select()
      .from(websiteCustomersTable)
      .where(sql`LOWER(${websiteCustomersTable.email}) = LOWER(${email})`)
      .limit(1);
    if (existing) {
      res.status(409).json({
        error: "duplicate_email",
        existingId: existing.id,
        customerNr: existing.customerNr,
        message: `A customer with email ${email} already exists (ID ${existing.id})`,
      });
      return;
    }

    const normalizedCertifications = normalizeCustomerCertifications(
      certifications,
      instrument || "other",
    );
    if (normalizedCertifications.length === 0) {
      res.status(400).json({ error: "At least one certification is required" });
      return;
    }

    const customerNr = await nextCustomerNr();
    const normalizedNames = normalizeWebsiteCustomerNameFields({ title, firstName, lastName });
    const [created] = await db
      .insert(websiteCustomersTable)
      .values({
        customerNr,
        salutation: salutation || null, title: title || null,
        firstName: normalizedNames.firstName ?? null,
        lastName: normalizedNames.lastName ?? null,
        institutionName: institutionName || null,
        institutionType: institutionType || null,
        specialty: specialty || null,
        email,
        phone: phone || null, fax: fax || null,
        website: website || null,
        referenceNumber: referenceNumber || null,
        isPublicAuthority: isPublicAuthority === true,
        defaultBuyerReference: defaultBuyerReference || null,
        address: address || null, postalCode: postalCode || null,
        city: city || null, country: country || "DE",
        ustIdNr: ustIdNr || null,
        instrument: instrument || "other",
        certifications: normalizedCertifications,
        reorderCode: await generateUniqueReorderCode(),
        notes: notes || null,
        shippingFirstName: shippingFirstName || null,
        shippingLastName: shippingLastName || null,
        shippingInstitutionName: shippingInstitutionName || null,
        shippingAddress: shippingAddress || null,
        shippingPostalCode: shippingPostalCode || null,
        shippingCity: shippingCity || null,
        shippingCountry: shippingCountry || null,
        shippingPhone: shippingPhone || null,
        shippingEmail: shippingEmail || null,
        privacyConsent: true,
      })
      .returning();
    res.status(201).json({ ...created, createdAt: created.createdAt.toISOString() });
  },
);

// Must be registered BEFORE /:id to avoid "from-iroc" matching as an id
router.post(
  "/iroc/website-customers/from-iroc",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { irocCustomerId } = req.body as { irocCustomerId: number };
    let status = 200;
    let payload: Record<string, unknown> = {};
    try {
      await db.transaction(async tx => {
        const [ic] = await tx.select().from(irocCustomers).where(eq(irocCustomers.id, irocCustomerId));
        if (!ic) {
          status = 404;
          payload = { error: "iROC customer not found" };
          return;
        }

        const normalizedEmail = ic.email?.trim().toLowerCase();
        const [websiteMatches, legacyMatches] = normalizedEmail
          ? await Promise.all([
              tx
                .select()
                .from(websiteCustomersTable)
                .where(sql`lower(btrim(${websiteCustomersTable.email})) = ${normalizedEmail}`),
              tx
                .select({ id: irocCustomers.id })
                .from(irocCustomers)
                .where(sql`lower(btrim(${irocCustomers.email})) = ${normalizedEmail}`),
            ])
          : [[], [{ id: ic.id }]];

        if (websiteMatches.length > 1 || legacyMatches.length !== 1) {
          status = 409;
          payload = { error: "Ambiguous customer email; link the records manually before importing" };
          return;
        }

        const [existing] = websiteMatches;
        if (existing) {
          const linked = await linkLegacyCustomerToWebsiteCustomerWith(tx, ic.id, existing.id);
          if (!linked) {
            status = 409;
            payload = { error: "Legacy customer is already linked to another website customer" };
            return;
          }

          const patch: Record<string, string | null> = {};
          if (ic.salutation?.trim() && !existing.salutation) patch.salutation = ic.salutation;
          if (ic.title?.trim() && !existing.title) patch.title = ic.title;
          if (Object.keys(patch).length === 0) {
            payload = { ...existing, createdAt: existing.createdAt.toISOString() };
            return;
          }

          const profileUpdateConditions = [
            eq(websiteCustomersTable.id, existing.id),
            ...(patch.salutation !== undefined ? [isNull(websiteCustomersTable.salutation)] : []),
            ...(patch.title !== undefined ? [isNull(websiteCustomersTable.title)] : []),
          ];
          const [updated] = await tx
            .update(websiteCustomersTable)
            .set(patch)
            .where(and(...profileUpdateConditions))
            .returning();
          if (updated) {
            payload = { ...updated, createdAt: updated.createdAt.toISOString() };
            return;
          }

          // Another request may have filled or corrected one of the fields
          // after the initial lookup. The conditional UPDATE protects that
          // value; re-read the row so the response reflects the winner.
          const [current] = await tx
            .select()
            .from(websiteCustomersTable)
            .where(eq(websiteCustomersTable.id, existing.id));
          if (!current) {
            status = 404;
            payload = { error: "Website customer not found" };
            return;
          }
          payload = { ...current, createdAt: current.createdAt.toISOString() };
          return;
        }

        const [existingLink] = await tx
          .select({ websiteCustomerId: irocCustomerWebsiteLinks.websiteCustomerId })
          .from(irocCustomerWebsiteLinks)
          .where(eq(irocCustomerWebsiteLinks.irocCustomerId, ic.id));
        if (existingLink) {
          status = 409;
          payload = { error: "Legacy customer is already linked to another website customer" };
          return;
        }

        const email = ic.email || `iroc+${ic.id}@iroc.internal`;
        const nameParts = (stripWebsiteCustomerTitlePrefix(ic.name, ic.title) ?? "")
          .split(/\s+/)
          .filter(Boolean);
        const normalizedNames = normalizeWebsiteCustomerNameFields({
          title: ic.title,
          firstName: nameParts[0] ?? null,
          lastName: nameParts.slice(1).join(" ") || null,
        });
        const customerNr = await nextCustomerNr();
        const [created] = await tx
          .insert(websiteCustomersTable)
          .values({
            customerNr, email, instrument: "other", privacyConsent: true,
            salutation: ic.salutation ?? null,
            title: ic.title ?? null,
            firstName: normalizedNames.firstName ?? null,
            lastName: normalizedNames.lastName ?? null,
            institutionName: ic.company ?? null, address: ic.address ?? null,
            postalCode: ic.postalCode ?? null, city: ic.city ?? null,
            country: ic.country ?? "DE", phone: ic.phone ?? null, ustIdNr: ic.vatId ?? null,
            reorderCode: await generateUniqueReorderCode(),
          })
          .returning();
        if (!await linkLegacyCustomerToWebsiteCustomerWith(tx, ic.id, created.id)) {
          throw new CustomerLinkConflictError();
        }
        status = 201;
        payload = { ...created, createdAt: created.createdAt.toISOString() };
      });
    } catch (error) {
      if (!(error instanceof CustomerLinkConflictError)) throw error;
      status = 409;
      payload = { error: "Legacy customer is already linked to another website customer" };
    }
    res.status(status).json(payload);
  },
);

router.get(
  "/iroc/website-customers/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [row] = await db
      .select({
        customer: websiteCustomersTable,
        legacyCustomerId: irocCustomerWebsiteLinks.irocCustomerId,
      })
      .from(websiteCustomersTable)
      .leftJoin(
        irocCustomerWebsiteLinks,
        eq(irocCustomerWebsiteLinks.websiteCustomerId, websiteCustomersTable.id),
      )
      .where(eq(websiteCustomersTable.id, id));
    if (!row) { res.status(404).json({ error: "Customer not found" }); return; }
    const legacyCustomerId = row.legacyCustomerId
      ?? await resolveLegacyCustomerId(row.customer.id, row.customer.email);
    res.json({
      ...row.customer,
      legacyCustomerId,
      createdAt: row.customer.createdAt.toISOString(),
    });
  },
);

router.patch(
  "/iroc/website-customers/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const fields = req.body as Record<string, any>;
    const allowed = [
      "salutation","title","firstName","lastName","institutionName","institutionType",
      "email","phone","fax","website","specialty",
      "address","postalCode","city","country","ustIdNr","instrument","certifications",
      "isPublicAuthority","defaultBuyerReference",
      "shippingFirstName","shippingLastName","shippingInstitutionName",
      "shippingAddress","shippingPostalCode","shippingCity","shippingCountry",
      "shippingPhone","shippingEmail",
      "customerNr","notes",
    ];
    const update: Record<string, any> = {};
    for (const k of allowed) { if (k in fields) update[k] = fields[k]; }
    const hasNameUpdate = "firstName" in fields || "lastName" in fields;
    let titleForNameUpdate = fields.title;
    if (hasNameUpdate && !("title" in fields)) {
      const [existing] = await db
        .select({ title: websiteCustomersTable.title })
        .from(websiteCustomersTable)
        .where(eq(websiteCustomersTable.id, id));
      if (!existing) { res.status(404).json({ error: "Customer not found" }); return; }
      titleForNameUpdate = existing.title;
    }
    if (hasNameUpdate) {
      Object.assign(
        update,
        normalizeWebsiteCustomerNameFields({
          title: titleForNameUpdate,
          firstName: fields.firstName,
          lastName: fields.lastName,
        }),
      );
    }
    if ("certifications" in fields && (
      !Array.isArray(fields.certifications) ||
      fields.certifications.some((value) => typeof value !== "string") ||
      normalizeCustomerCertifications(fields.certifications, "").length === 0
    )) {
      res.status(400).json({ error: "At least one certification is required" });
      return;
    }
    if ("certifications" in fields) {
      update.certifications = normalizeCustomerCertifications(
        fields.certifications,
        fields.instrument,
      );
    } else if ("instrument" in fields) {
      // Keep older admin clients that only submit `instrument` working.
      update.certifications = normalizeCustomerCertifications(
        undefined,
        fields.instrument,
      );
    }
    const [row] = await db
      .update(websiteCustomersTable)
      .set(update)
      .where(eq(websiteCustomersTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Customer not found" }); return; }
    res.json({ ...row, createdAt: row.createdAt.toISOString() });
  },
);

router.delete(
  "/iroc/website-customers/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    await db.delete(websiteCustomersTable).where(eq(websiteCustomersTable.id, id));
    res.json({ message: "Customer deleted" });
  },
);

// ── Per-customer category totals ─────────────────────────────────────────────
router.get(
  "/iroc/website-customers/:id/category-totals",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const customerId = parseInt(String(req.params.id));
    if (isNaN(customerId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [link] = await db
      .select({ irocCustomerId: irocCustomerWebsiteLinks.irocCustomerId })
      .from(irocCustomerWebsiteLinks)
      .where(eq(irocCustomerWebsiteLinks.websiteCustomerId, customerId));

    const rows = await db
      .select({
        lineTotal:       irocInvoiceItems.lineTotal,
        productName:     irocInvoiceItems.productName,
        productCategory: irocProducts.category,
      })
      .from(irocInvoiceItems)
      .innerJoin(irocInvoices, eq(irocInvoiceItems.invoiceId, irocInvoices.id))
      .leftJoin(irocProducts, eq(irocInvoiceItems.productId, irocProducts.id))
      .where(
        and(
          ne(irocInvoices.status, "cancelled"),
          link
            ? or(
                eq(irocInvoices.websiteCustomerId, customerId),
                and(
                  isNull(irocInvoices.websiteCustomerId),
                  eq(irocInvoices.customerId, link.irocCustomerId),
                ),
              )
            : eq(irocInvoices.websiteCustomerId, customerId),
        ),
      );

    const accum = new Map<string, number>();
    for (const r of rows) {
      const cat = inferCategory(r.productCategory, r.productName);
      accum.set(cat, (accum.get(cat) ?? 0) + Number(r.lineTotal));
    }

    const totals = Array.from(accum.entries())
      .map(([category, total]) => ({ category, total: total.toFixed(2) }))
      .sort((a, b) => a.category.localeCompare(b.category));

    res.json(totals);
  },
);

// ── Products ──────────────────────────────────────────────────────────────────
function formatProductRow(row: typeof irocProducts.$inferSelect) {
  return {
    ...row,
    unitPrice: row.unitPrice.toString(),
    unitPriceBrutto: row.unitPriceBrutto?.toString() ?? null,
    purchasePrice: row.purchasePrice?.toString() ?? null,
    purchaseDiscount: row.purchaseDiscount?.toString() ?? null,
    recommendedPrice: row.recommendedPrice?.toString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get(
  "/iroc/products",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(irocProducts)
      .orderBy(irocProducts.sku);
    res.json(
      rows.map(formatProductRow),
    );
  },
);


// ── Product groups ────────────────────────────────────────────────────────────
async function productGroupExists(key: string): Promise<boolean> {
  const [row] = await db
    .select({ id: irocProductGroups.id })
    .from(irocProductGroups)
    .where(eq(irocProductGroups.key, key));
  return !!row;
}

router.get(
  "/iroc/product-groups",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(irocProductGroups)
      .orderBy(irocProductGroups.sortOrder, irocProductGroups.key);
    res.json(rows.map((r) => ({ ...r, createdAt: undefined })));
  },
);

// Public: non-service groups, ordered — used by the website order form for labels/order
router.get(
  "/product-groups-public",
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(irocProductGroups)
      .where(eq(irocProductGroups.isService, false))
      .orderBy(irocProductGroups.sortOrder, irocProductGroups.key);
    res.json(rows.map((r) => ({ ...r, createdAt: undefined })));
  },
);

router.post(
  "/iroc/product-groups",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const parsed = CreateIrocProductGroupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid product group data" });
      return;
    }
    const key = parsed.data.key.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
      res.status(400).json({ error: "Group key must contain only lowercase letters, digits, '-' or '_'" });
      return;
    }
    const [existing] = await db
      .select({ id: irocProductGroups.id })
      .from(irocProductGroups)
      .where(eq(irocProductGroups.key, key));
    if (existing) {
      res.status(409).json({ error: "A group with this key already exists" });
      return;
    }
    const [row] = await db
      .insert(irocProductGroups)
      .values({
        key,
        nameEn: parsed.data.nameEn.trim(),
        nameDe: parsed.data.nameDe.trim(),
        sortOrder: parsed.data.sortOrder ?? 0,
        isService: parsed.data.isService ?? false,
      })
      .returning();
    res.status(201).json({ ...row, createdAt: undefined });
  },
);

router.patch(
  "/iroc/product-groups/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const parsed = UpdateIrocProductGroupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid product group data" });
      return;
    }
    const newKey = parsed.data.key.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(newKey)) {
      res.status(400).json({ error: "Group key must contain only lowercase letters, digits, '-' or '_'" });
      return;
    }
    // Read, conflict-check, and update inside one transaction with a row lock so
    // concurrent renames serialize instead of surfacing unique-violation errors.
    let status = 200;
    let payload: Record<string, unknown> = {};
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(irocProductGroups)
        .where(eq(irocProductGroups.id, id))
        .for("update");
      if (!current) {
        status = 404; payload = { error: "Product group not found" };
        return;
      }
      if (newKey !== current.key) {
        const [conflict] = await tx
          .select({ id: irocProductGroups.id })
          .from(irocProductGroups)
          .where(eq(irocProductGroups.key, newKey));
        if (conflict) {
          status = 409; payload = { error: "A group with this key already exists" };
          return;
        }
      }
      const [updated] = await tx
        .update(irocProductGroups)
        .set({
          key: newKey,
          nameEn: parsed.data.nameEn.trim(),
          nameDe: parsed.data.nameDe.trim(),
          sortOrder: parsed.data.sortOrder ?? current.sortOrder,
          isService: parsed.data.isService ?? current.isService,
        })
        .where(eq(irocProductGroups.id, id))
        .returning();
      if (newKey !== current.key) {
        // Rename propagates to all products in the group atomically.
        await tx
          .update(irocProducts)
          .set({ category: newKey, updatedAt: new Date() })
          .where(eq(irocProducts.category, current.key));
      }
      payload = { ...updated, createdAt: undefined };
    });
    res.status(status).json(payload);
  },
);

router.delete(
  "/iroc/product-groups/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    let status = 200;
    let payload: Record<string, unknown> = { success: true };
    await db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(irocProductGroups)
        .where(eq(irocProductGroups.id, id))
        .for("update");
      if (!group) {
        status = 404; payload = { error: "Product group not found" };
        return;
      }
      const [{ count: productCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(irocProducts)
        .where(eq(irocProducts.category, group.key));
      if (productCount > 0) {
        status = 409; payload = { error: "Group still has products. Move them to another group first." };
        return;
      }
      await tx.delete(irocProductGroups).where(eq(irocProductGroups.id, id));
    });
    res.status(status).json(payload);
  },
);

// Public: products grouped by category for the website order form (no auth needed)
router.get(
  "/products-public",
  async (_req: Request, res: Response) => {
    const [rows, groups] = await Promise.all([
      db
        .select({
          id: irocProducts.id,
          nameEn: irocProducts.nameEn,
          nameDe: irocProducts.nameDe,
          sku: irocProducts.sku,
          category: irocProducts.category,
        })
        .from(irocProducts)
        .orderBy(irocProducts.category, irocProducts.nameEn),
      db
        .select()
        .from(irocProductGroups)
        .orderBy(irocProductGroups.sortOrder, irocProductGroups.key),
    ]);
    // Service groups are not orderable physical goods
    const serviceKeys = new Set(groups.filter((g) => g.isService).map((g) => g.key));
    serviceKeys.add("services"); // safety fallback if the group row is missing
    const grouped: Record<string, { id: number; nameEn: string; nameDe: string; sku: string }[]> = {};
    for (const g of groups) {
      if (!g.isService) grouped[g.key] = [];
    }
    for (const r of rows) {
      const cat = r.category ?? "cellenis";
      if (serviceKeys.has(cat)) continue;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ id: r.id, nameEn: r.nameEn, nameDe: r.nameDe, sku: r.sku });
    }
    res.json(grouped);
  },
);

router.post(
  "/iroc/products",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const parsed = CreateIrocProductBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid product data" });
      return;
    }
    if (parsed.data.category != null && !(await productGroupExists(parsed.data.category))) {
      res.status(400).json({ error: "Unknown product group" });
      return;
    }
    const [row] = await db
      .insert(irocProducts)
      .values({
        ...parsed.data,
        category: parsed.data.category ?? undefined,
        descriptionEn: parsed.data.descriptionEn ?? undefined,
        descriptionDe: parsed.data.descriptionDe ?? undefined,
        unitPriceBrutto: parsed.data.unitPriceBrutto ?? undefined,
        purchasePrice: parsed.data.purchasePrice ?? undefined,
        purchaseDiscount: parsed.data.purchaseDiscount ?? undefined,
        purchaseCurrency: parsed.data.purchaseCurrency ?? undefined,
        purchaseRawPrice: parsed.data.purchaseRawPrice ?? undefined,
        recommendedPrice: parsed.data.recommendedPrice ?? undefined,
        stockQuantity: parsed.data.stockQuantity ?? 0,
        lowStockThreshold: parsed.data.lowStockThreshold ?? 5,
      })
      .returning();
    res.status(201).json(formatProductRow(row));
  },
);

router.get(
  "/iroc/products/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [row] = await db
      .select()
      .from(irocProducts)
      .where(eq(irocProducts.id, id));
    if (!row) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json(formatProductRow(row));
  },
);

router.patch(
  "/iroc/products/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const parsed = UpdateIrocProductBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid product data" });
      return;
    }
    if (parsed.data.category != null && !(await productGroupExists(parsed.data.category))) {
      res.status(400).json({ error: "Unknown product group" });
      return;
    }
    const [row] = await db
      .update(irocProducts)
      .set({
        ...parsed.data,
        category: parsed.data.category ?? undefined,
        descriptionEn: parsed.data.descriptionEn ?? undefined,
        descriptionDe: parsed.data.descriptionDe ?? undefined,
        // Preserve an explicit null so admins can clear an existing gross price.
        unitPriceBrutto: parsed.data.unitPriceBrutto,
        purchasePrice: parsed.data.purchasePrice ?? undefined,
        purchaseDiscount: parsed.data.purchaseDiscount ?? undefined,
        purchaseCurrency: parsed.data.purchaseCurrency ?? undefined,
        purchaseRawPrice: parsed.data.purchaseRawPrice ?? undefined,
        recommendedPrice: parsed.data.recommendedPrice ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(irocProducts.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    res.json(formatProductRow(row));
  },
);

router.delete(
  "/iroc/products/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    await db.delete(irocProducts).where(eq(irocProducts.id, id));
    res.json({ message: "Product deleted" });
  },
);

router.patch(
  "/iroc/products/:id/stock",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const parsed = AdjustIrocProductStockBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid stock data" });
      return;
    }
    const [row] = await db
      .update(irocProducts)
      .set({ stockQuantity: parsed.data.quantity, updatedAt: new Date() })
      .where(eq(irocProducts.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    // Create low-stock notification if needed
    if (row.stockQuantity <= row.lowStockThreshold) {
      await db
        .insert(irocNotifications)
        .values({
          type: "low_stock",
          message: JSON.stringify({
            de: `Niedriger Lagerbestand: ${row.nameDe} – noch ${row.stockQuantity} Einheiten verfügbar`,
            en: `Low stock alert: ${row.nameDe} (${row.nameEn}) — only ${row.stockQuantity} units remaining`,
          }),
          productId: row.id,
        })
        .onConflictDoNothing();
    }
    res.json({
      ...row,
      unitPrice: row.unitPrice.toString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  },
);

// ── Invoices ──────────────────────────────────────────────────────────────────

// ── Inventory Lots ────────────────────────────────────────────────────────────
router.get(
  "/iroc/inventory",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    // Two-months cutoff: lots that have been empty continuously for >2 months are auto-hidden
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    const rows = await db
      .select({
        id: irocInventoryLots.id,
        productId: irocInventoryLots.productId,
        lotNumber: irocInventoryLots.lotNumber,
        purchaseDate: irocInventoryLots.purchaseDate,
        expirationDate: irocInventoryLots.expirationDate,
        description: irocInventoryLots.description,
        quantityReceived: irocInventoryLots.quantityReceived,
        quantityUsed: irocInventoryLots.quantityUsed,
        emptyAt: irocInventoryLots.emptyAt,
        productSku: irocProducts.sku,
        productNameEn: irocProducts.nameEn,
        productNameDe: irocProducts.nameDe,
        productDescriptionEn: irocProducts.descriptionEn,
        productDescriptionDe: irocProducts.descriptionDe,
        productCategory: irocProducts.category,
        productPurchasePrice: irocProducts.purchasePrice,
        createdAt: irocInventoryLots.createdAt,
      })
      .from(irocInventoryLots)
      .leftJoin(irocProducts, eq(irocInventoryLots.productId, irocProducts.id))
      // Exclude lots that have been continuously empty for more than 2 months
      .where(
        and(
          // Pending expense lots belong exclusively in the delivery queue until received.
          // Once received, their status changes to in_house and they appear here.
          sql`iroc_inventory_lots.status <> 'pending'`,
          or(
            // Still has stock — always show
            sql`(${irocInventoryLots.quantityReceived} - ${irocInventoryLots.quantityUsed}) > 0`,
            // No emptyAt recorded yet — show (legacy rows before this feature)
            isNull(irocInventoryLots.emptyAt),
            // Became empty less than 2 months ago — still show
            sql`${irocInventoryLots.emptyAt} > ${twoMonthsAgo.toISOString()}`,
          ),
        )
      )
      .orderBy(desc(irocInventoryLots.purchaseDate));
    res.json(rows.map(r => ({
      ...r,
      productPurchasePrice: r.productPurchasePrice?.toString() ?? null,
      createdAt: r.createdAt.toISOString(),
      emptyAt: r.emptyAt?.toISOString() ?? null,
    })));
  },
);

router.post(
  "/iroc/inventory",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { productId, lotNumber, purchaseDate, expirationDate, description, quantityReceived, purchasePrice } = req.body;
    if (!productId || !lotNumber || !purchaseDate || quantityReceived == null) {
      res.status(400).json({ error: "productId, lotNumber, purchaseDate, quantityReceived are required" });
      return;
    }
    const qty = parseInt(String(quantityReceived));
    const pid = parseInt(String(productId));
    const [created] = await db
      .insert(irocInventoryLots)
      .values({ productId: pid, lotNumber: String(lotNumber), purchaseDate: String(purchaseDate), expirationDate: expirationDate ? String(expirationDate) : null, description: description || null, quantityReceived: qty, quantityUsed: 0, status: "in_house" })
      .returning();
    // Update stock quantity; also persist purchase price on the product so it carries forward to future lots
    const productUpdate: Record<string, any> = { stockQuantity: sql`${irocProducts.stockQuantity} + ${qty}`, updatedAt: new Date() };
    if (purchasePrice != null && String(purchasePrice).trim() !== "") {
      productUpdate.purchasePrice = String(purchasePrice).trim();
      // Lot prices are entered in EUR; reset the purchase-source metadata so a
      // later product edit doesn't restore a stale foreign-currency raw price.
      productUpdate.purchaseCurrency = "EUR";
      productUpdate.purchaseRawPrice = null;
    }
    await db.update(irocProducts).set(productUpdate).where(eq(irocProducts.id, pid));
    res.status(201).json(created);
  },
);

router.patch(
  "/iroc/inventory/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const fields = req.body as Record<string, any>;
    const update: Record<string, any> = { updatedAt: new Date() };
    if ('description' in fields) update.description = fields.description;
    if ('lotNumber' in fields) update.lotNumber = fields.lotNumber;
    if ('purchaseDate' in fields) update.purchaseDate = fields.purchaseDate;
    if ('expirationDate' in fields) update.expirationDate = fields.expirationDate || null;
    if ('quantityReceived' in fields) update.quantityReceived = parseInt(String(fields.quantityReceived));
    if ('quantityUsed' in fields) update.quantityUsed = parseInt(String(fields.quantityUsed));
    const [row] = await db.update(irocInventoryLots).set(update).where(eq(irocInventoryLots.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }

    // Maintain emptyAt: set when lot first becomes empty; clear if restocked
    const remaining = row.quantityReceived - row.quantityUsed;
    if (remaining <= 0 && !row.emptyAt) {
      await db.update(irocInventoryLots).set({ emptyAt: new Date() }).where(eq(irocInventoryLots.id, id));
    } else if (remaining > 0 && row.emptyAt) {
      await db.update(irocInventoryLots).set({ emptyAt: null }).where(eq(irocInventoryLots.id, id));
    }

    // Recalculate product stock from all lots
    const [sr] = await db
      .select({ total: sql<number>`COALESCE(SUM(quantity_received - quantity_used), 0)` })
      .from(irocInventoryLots)
      .where(and(
        eq(irocInventoryLots.productId, row.productId),
        eq(irocInventoryLots.status, "in_house"),
      ));
    await db.update(irocProducts).set({ stockQuantity: sr.total ?? 0, updatedAt: new Date() }).where(eq(irocProducts.id, row.productId));
    res.json(row);
  },
);

router.delete(
  "/iroc/inventory/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [row] = await db.select().from(irocInventoryLots).where(eq(irocInventoryLots.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.delete(irocInventoryLots).where(eq(irocInventoryLots.id, id));
    const [sr] = await db
      .select({ total: sql<number>`COALESCE(SUM(quantity_received - quantity_used), 0)` })
      .from(irocInventoryLots)
      .where(and(
        eq(irocInventoryLots.productId, row.productId),
        eq(irocInventoryLots.status, "in_house"),
      ));
    await db.update(irocProducts).set({ stockQuantity: sr.total ?? 0, updatedAt: new Date() }).where(eq(irocProducts.id, row.productId));
    res.json({ message: "Deleted" });
  },
);

async function nextInvoiceSeq(): Promise<{ year: number; seq: number }> {
  const year = new Date().getFullYear();
  // Fetch all invoice numbers for the current year (any format) and find the max trailing sequence
  const rows = await db
    .select({ n: irocInvoices.invoiceNumber })
    .from(irocInvoices)
    .where(sql`EXTRACT(YEAR FROM ${irocInvoices.createdAt}) = ${year}`);
  let maxSeq = 0;
  for (const r of rows) {
    const m = r.n.match(/(\d+)$/);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  }
  return { year, seq: maxSeq + 1 };
}

export async function generateInvoiceNumber(): Promise<string> {
  const { year, seq } = await nextInvoiceSeq();
  return `${year}-${seq.toString().padStart(4, "0")}`;
}

type ShipmentInput = {
  serviceId: string; carrier: string; serviceCode: string; quotedDeliveryCost: number;
  quotedInsuranceCost?: number; includeInsurance?: boolean; weightKg: number; lengthCm?: number; widthCm?: number; heightCm?: number; confirm?: boolean;
};

async function orderShippingContext(orderId: number) {
  const { rows } = await pool.query(
    `SELECT o.*, wc.first_name, wc.last_name, wc.institution_name, wc.email AS customer_email,
            wc.phone AS customer_phone, wc.street, wc.house_number, wc.address, wc.postal_code,
            wc.city, wc.country, wc.shipping_street, wc.shipping_house_number, wc.shipping_address,
            wc.shipping_postal_code, wc.shipping_city, wc.shipping_country, wc.shipping_email, wc.shipping_phone
       FROM iroc_orders o LEFT JOIN website_customers wc ON wc.id = o.website_customer_id
      WHERE o.id = $1`,
    [orderId],
  );
  return rows[0] as Record<string, string | number | null | undefined> | undefined;
}

async function invoiceShippingContext(invoiceId: number) {
  const { rows } = await pool.query(
    `SELECT i.*,
            wc.first_name, wc.last_name, wc.institution_name, wc.email AS customer_email,
            wc.phone AS customer_phone, wc.street, wc.house_number, wc.address, wc.postal_code,
            wc.city, wc.country, wc.shipping_street, wc.shipping_house_number, wc.shipping_address,
            wc.shipping_postal_code, wc.shipping_city, wc.shipping_country, wc.shipping_email, wc.shipping_phone,
            wc.shipping_first_name, wc.shipping_last_name, wc.shipping_institution_name,
            lc.name AS legacy_name, lc.company AS legacy_company, lc.email AS legacy_email,
            lc.phone AS legacy_phone, lc.street AS legacy_street, lc.house_number AS legacy_house_number,
            lc.address AS legacy_address, lc.postal_code AS legacy_postal_code, lc.city AS legacy_city,
            lc.country AS legacy_country,
            o.sally_review_result AS source_order_sally_review_result
       FROM iroc_invoices i
       LEFT JOIN website_customers wc ON wc.id = i.website_customer_id
       LEFT JOIN iroc_customers lc ON lc.id = i.customer_id
       LEFT JOIN iroc_orders o ON o.id = i.source_order_id
      WHERE i.id = $1`,
    [invoiceId],
  );
  return rows[0] as Record<string, string | number | null | undefined> | undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR",
  "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
  "SE", "SI", "SK",
]);

type InvoiceCustomsItem = {
  description: string;
  quantity: number;
  value: number;
  hsCode: string;
  countryOfOrigin: string;
  sku: string;
  weightKg: number;
};

const SENDCLOUD_EXPORT_REASON_BY_LABEL: Record<string, "commercial_goods" | "commercial_sample" | "gift" | "return_goods" | "documents" | "other"> = {
  "permanent sale / commercial": "commercial_goods",
  "commercial goods": "commercial_goods",
  "commercial": "commercial_goods",
  "sale": "commercial_goods",
  "commercial sample": "commercial_sample",
  "gift": "gift",
  "return goods": "return_goods",
  "documents": "documents",
  "other": "other",
};

function buildInvoiceCustomsData(
  invoice: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  destinationCountry: string,
  charges?: { freightCosts: number; insuranceCosts: number },
): { data?: { information: {
  invoiceNumber: string; invoiceDate: string;
  exportReason: "commercial_goods" | "commercial_sample" | "gift" | "return_goods" | "documents" | "other";
  freightCosts: number; insuranceCosts: number;
}; items: InvoiceCustomsItem[] }; error?: string } {
  if (EU_COUNTRY_CODES.has(normalizeSendcloudCountryCode(destinationCountry))) return {};

  const shipmentReason = String(invoice.reason_for_export ?? "").trim().toLocaleLowerCase("en-US");
  const incoterm = String(invoice.terms_of_delivery ?? "").trim();
  const transportMethod = String(invoice.shipping_method ?? "").trim();
  const exportReason = SENDCLOUD_EXPORT_REASON_BY_LABEL[shipmentReason];
  if (!exportReason || !incoterm || !transportMethod) {
    return { error: "Non-EU shipments require a shipment reason, Incoterm, and transport method. Save the commercial invoice fields before continuing." };
  }

  const customsItems: InvoiceCustomsItem[] = [];
  for (const [index, item] of items.entries()) {
    const description = String(item.description ?? item.product_name ?? "").trim();
    const quantity = Number(item.quantity);
    // Sendcloud's parcel_items value is a per-unit customs value. The invoice
    // stores a discounted line total, so divide it by the declared quantity.
    const value = Number(item.line_total) / quantity;
    const sku = String(item.sku ?? "").trim();
    const hsCode = String(item.hs_code ?? "").replace(/[.\s-]/g, "");
    const countryOfOrigin = normalizeSendcloudCountryCode(String(item.country_of_origin ?? ""));
    const weightKg = Number(item.weight_kg);
    if (!description || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(value) || value < 0 ||
        !sku || !/^\d{6,10}$/.test(hsCode) || !/^[A-Z]{2}$/.test(countryOfOrigin) ||
        !Number.isFinite(weightKg) || weightKg <= 0) {
      return {
        error: `Customs data for line ${index + 1} is incomplete. Description, quantity, value, SKU, a 6–10 digit HS code, ISO origin country, and positive item weight are required.`,
      };
    }
    customsItems.push({ description, quantity, value, sku, hsCode, countryOfOrigin, weightKg });
  }
  return {
    data: {
      information: {
        invoiceNumber: String(invoice.invoice_number ?? ""),
        invoiceDate: String(invoice.issue_date ?? ""),
        exportReason,
        freightCosts: charges?.freightCosts ?? Number(invoice.delivery_costs ?? 0),
        insuranceCosts: charges?.insuranceCosts ?? Number(invoice.insurance_costs ?? 0),
      },
      items: customsItems,
    },
  };
}

router.get("/iroc/orders/:id/shipping-rates", requireIrocAuth, async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const weightKg = Number(req.query.weightKg);
  if (!Number.isInteger(id) || !Number.isFinite(weightKg) || weightKg <= 0) {
    res.status(400).json({ error: "A positive parcel weight is required" }); return;
  }
  const order = await orderShippingContext(id);
  if (!order || order.status !== "approved") { res.status(404).json({ error: "Approved order not found" }); return; }
  const country = String(order.shipping_country ?? order.country ?? "DE");
  const postalCode = String(order.shipping_postal_code ?? order.postal_code ?? "");
  if (!postalCode) { res.status(400).json({ error: "Shipping postal code is required before retrieving rates" }); return; }
  const includeInsurance = req.query.includeInsurance !== "false";
  const { rows: orderInvoices } = await pool.query(
    "SELECT total FROM iroc_invoices WHERE source_order_id=$1 ORDER BY id DESC LIMIT 1",
    [id],
  );
  const orderValue = Number(orderInvoices[0]?.total ?? 0);
  const insuredValue = includeInsurance ? invoiceInsuranceValue(orderValue) : 0;
  const rates = await getSendcloudRates({ country, postalCode, weightKg, insuredValue });
  rates.sort((a, b) => a.price - b.price);
  res.json({
    rates, suggestedServiceId: rates[0]?.id ?? null, insuredValue,
    uninsuredValue: invoiceInsuranceCoverageGap(orderValue),
    insuranceIncluded: includeInsurance,
    pickupWindow: "Mon/Wed/Fri 09:00–13:00 (when supported)",
  });
});

router.post("/iroc/orders/:id/shipment", requireIrocAuth, async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body as ShipmentInput;
  if (!Number.isInteger(id) || !body?.confirm || !body.serviceId || !body.carrier || !body.serviceCode ||
      !Number.isFinite(Number(body.weightKg)) || Number(body.weightKg) <= 0 || !Number.isFinite(Number(body.quotedDeliveryCost))) {
    res.status(400).json({ error: "Confirm a valid shipment with service, cost and positive parcel weight" }); return;
  }
  const order = await orderShippingContext(id);
  if (!order || order.status !== "approved") { res.status(404).json({ error: "Approved order not found" }); return; }
  const street = String(order.shipping_street ?? order.street ?? order.shipping_address ?? order.address ?? "").trim();
  const postalCode = String(order.shipping_postal_code ?? order.postal_code ?? "").trim();
  const city = String(order.shipping_city ?? order.city ?? "").trim();
  const country = String(order.shipping_country ?? order.country ?? "DE").trim();
  const email = String(order.shipping_email ?? order.customer_email ?? order.contact_email ?? "").trim();
  if (!street || !postalCode || !city || !email) { res.status(400).json({ error: "A complete shipping street, postal code, city and email are required" }); return; }
  const client = await pool.connect();
  let shipmentId: number;
  let invoice: Record<string, string | number | null | undefined>;
  let invoiceValue: number;
  let insuredValue: number;
  let insuranceCosts: number;
  let delivery: number;
  let externalReference: string;
  let pickupScheduledFor: Date;
  try {
    await client.query("BEGIN");
    // There is no row to lock before the first shipment. The advisory lock
    // makes simultaneous confirmations serialize before either can announce.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`iroc-order-shipment:${id}`]);
    const { rows: existing } = await client.query(
      "SELECT id FROM iroc_order_shipments WHERE order_id = $1 FOR UPDATE", [id],
    );
    if (existing.length) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "A shipment already exists for this order", shipmentId: existing[0].id });
      return;
    }
    const { rows: invoices } = await client.query(
      "SELECT * FROM iroc_invoices WHERE source_order_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE", [id],
    );
    invoice = invoices[0];
    if (!invoice) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Create the draft invoice before creating a shipment" });
      return;
    }
    if (invoice.status !== "draft") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Delivery costs can only be added to a draft invoice" });
      return;
    }
    const { rows: invoiceShipment } = await client.query(
      "SELECT id FROM iroc_order_shipments WHERE invoice_id = $1 FOR UPDATE", [invoice.id],
    );
    if (invoiceShipment.length) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "A shipment attempt already exists for this invoice", shipmentId: invoiceShipment[0].id });
      return;
    }
    invoiceValue = Number(invoice.total);
    insuredValue = body.includeInsurance === false ? 0 : invoiceInsuranceValue(invoiceValue);
    insuranceCosts = body.includeInsurance === false ? 0 : Number(body.quotedInsuranceCost ?? 0);
    delivery = Number(body.quotedDeliveryCost);
    pickupScheduledFor = nextPreferredPickupDate();
    const { rows: invoiceTaxItems } = await client.query(
      "SELECT product_name, quantity, unit_price, line_total, vat_rate FROM iroc_invoice_items WHERE invoice_id=$1",
      [invoice.id],
    );
    const grouped = invoiceTaxItems.length ? calculateFacturXTotals(
      { invoiceType: String(invoice.invoice_type ?? "domestic"), vatRate: invoice.vat_rate, deliveryCosts: delivery, insuranceCosts },
      invoiceTaxItems.map(item => ({
        productName: item.product_name,
        quantity: Number(item.quantity),
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
        vatRate: item.vat_rate ?? invoice.vat_rate,
      })),
    ) : null;
    const legacyTotals = grouped ? null : calculateInvoiceTotals({
      subtotal: Number(invoice.subtotal),
      deliveryCosts: delivery,
      insuranceCosts,
      vatRate: Number(invoice.vat_rate),
    });
    const vatAmount = grouped ? grouped.taxTotalCents / 100 : legacyTotals!.vatAmount;
    const total = grouped ? grouped.grandTotalCents / 100 : legacyTotals!.total;
    const quoteSnapshot = JSON.stringify({
      serviceId: body.serviceId, quotedDeliveryCost: delivery, carrier: body.carrier, serviceCode: body.serviceCode,
    });
    const result = await client.query(
      `INSERT INTO iroc_order_shipments
       (order_id, invoice_id, status, carrier, service_code, tracking_number, label_url, sendcloud_shipment_id, quote_snapshot,
        weight_kg, length_cm, width_cm, height_cm, delivery_costs, insurance_costs, insured_value, pickup_scheduled_for)
       VALUES ($1,$2,'creating',$3,$4,NULL,NULL,NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [id, invoice.id, body.carrier, body.serviceCode, quoteSnapshot,
       body.weightKg, body.lengthCm ?? null, body.widthCm ?? null, body.heightCm ?? null, delivery, insuranceCosts, insuredValue,
       pickupScheduledFor],
    );
    shipmentId = result.rows[0].id;
    externalReference = `iroc-order-shipment:${shipmentId}`;
    // Keep the exact provider correlation key with the durable reservation.
    await client.query(
      "UPDATE iroc_order_shipments SET quote_snapshot=$1 WHERE id=$2",
      [JSON.stringify({ serviceId: body.serviceId, quotedDeliveryCost: delivery, carrier: body.carrier, serviceCode: body.serviceCode, externalReference }), shipmentId],
    );
    await client.query("COMMIT");

    let created: Awaited<ReturnType<typeof createSendcloudShipment>>;
    try {
      created = await createSendcloudShipment({
        name: String(order.contact_name ?? `${order.first_name ?? ""} ${order.last_name ?? ""}`).trim() || "Customer",
        company: String(order.shipping_institution_name ?? order.institution_name ?? order.company_name ?? "") || null,
        address: street, houseNumber: String(order.shipping_house_number ?? order.house_number ?? "") || null,
        postalCode, city, country, email, phone: String(order.shipping_phone ?? order.customer_phone ?? order.contact_phone ?? "") || null,
        weightKg: Number(body.weightKg), lengthCm: body.lengthCm, widthCm: body.widthCm, heightCm: body.heightCm,
      serviceId: body.serviceId, insuredValue, orderValue: invoiceValue, externalReference,
      });
    } catch (error) {
      if (error instanceof SendcloudRequestError) {
        await client.query("UPDATE iroc_order_shipments SET status='provider_error' WHERE id=$1 AND status='creating'", [shipmentId]);
        req.log.warn({ err: error, orderId: id, shipmentId }, "Sendcloud rejected order shipment");
        res.status(502).json({
          error: "Sendcloud could not create the shipment. The attempt was retained for review; do not submit it again.",
          shipmentId,
        });
        return;
      }
      // A timeout or dropped connection can happen after Sendcloud accepted the
      // parcel. Correlate before reporting an uncertain state; never retry POST.
      const recovered = await findSendcloudShipmentByExternalReference(externalReference).catch(() => null);
      if (recovered) {
        created = recovered;
      } else {
        await client.query("UPDATE iroc_order_shipments SET status='needs_reconciliation' WHERE id=$1 AND status='creating'", [shipmentId]);
        req.log.error({ err: error, orderId: id, shipmentId }, "Sendcloud response was ambiguous; order shipment needs reconciliation");
        res.status(502).json({ error: "Sendcloud did not confirm the shipment. The attempt needs reconciliation; do not submit it again.", shipmentId });
        return;
      }
    }

    try {
      await client.query("BEGIN");
      const invoiceUpdate = await client.query(
        `UPDATE iroc_invoices SET delivery_costs=$1, insurance_costs=$2, shipping_method=$3, vat_amount=$4, total=$5, updated_at=NOW()
         WHERE id=$6 AND status='draft'
         RETURNING delivery_costs, insurance_costs, vat_amount, total`,
        [delivery, insuranceCosts, `${body.carrier} ${body.serviceCode}`, vatAmount, total, invoice.id],
      );
      if (!invoiceUpdate.rows.length) throw new Error("Invoice was no longer a draft when the shipment was created");
      const shipmentUpdate = await client.query(
        `UPDATE iroc_order_shipments
         SET status='created', tracking_number=$1, label_url=$2, sendcloud_shipment_id=$3
         WHERE id=$4 AND status='creating'`,
        [created.trackingNumber, created.labelUrl, created.id, shipmentId],
      );
      if (!shipmentUpdate.rowCount) throw new Error("Shipment reservation was no longer available");
      await client.query("COMMIT");
      const updatedInvoice = invoiceUpdate.rows[0];
      res.status(201).json({
        shipmentId, trackingNumber: created.trackingNumber, labelUrl: created.labelUrl,
        insuredValue, pickupScheduledFor,
        invoiceTotals: {
          deliveryCosts: String(updatedInvoice.delivery_costs),
          insuranceCosts: String(updatedInvoice.insurance_costs),
          vatAmount: String(updatedInvoice.vat_amount),
          total: String(updatedInvoice.total),
        },
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("UPDATE iroc_order_shipments SET status='needs_reconciliation' WHERE id=$1 AND status='creating'", [shipmentId]).catch(() => undefined);
      req.log.error({ err: error, orderId: id, shipmentId }, "Sendcloud created the order shipment, but local updates need reconciliation");
      res.status(502).json({ error: "Sendcloud created the shipment, but the order update needs reconciliation. Do not submit it again.", shipmentId });
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error, orderId: id }, "Unable to persist Sendcloud shipment");
    if (!res.headersSent) res.status(409).json({ error: "Shipment could not be saved; no invoice changes were applied" });
  } finally { client.release(); }
});

router.get("/iroc/invoices/:id/shipping-rates", requireIrocAuth, async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const weightKg = Number(req.query.weightKg);
  if (!Number.isInteger(id) || !Number.isFinite(weightKg) || weightKg <= 0) {
    res.status(400).json({ error: "A positive parcel weight is required" }); return;
  }
  const invoice = await invoiceShippingContext(id);
  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (!isDirectInvoiceShipmentEligible(invoice.status, invoice.source_order_id, invoice.source_order_sally_review_result)) {
    res.status(409).json({ error: invoice.source_order_id ? "Website-order invoices must be shipped from Incoming Orders" : "Shipping can only be prepared for a draft invoice" }); return;
  }
  const address = resolveInvoiceShipmentAddress(invoice);
  if (!address.postalCode) { res.status(400).json({ error: "Shipping postal code is required before retrieving rates" }); return; }
  if (!EU_COUNTRY_CODES.has(normalizeSendcloudCountryCode(address.country)) &&
      ![req.query.lengthCm, req.query.widthCm, req.query.heightCm].every(optionalPositiveNumber)) {
    res.status(400).json({ error: "Non-EU shipments require positive parcel length, width, and height before retrieving rates" }); return;
  }
  const { rows: invoiceItems } = await pool.query(
    "SELECT product_name, sku, description, hs_code, country_of_origin, weight_kg, quantity, line_total FROM iroc_invoice_items WHERE invoice_id = $1",
    [id],
  );
  const customs = buildInvoiceCustomsData(invoice, invoiceItems, address.country);
  if (customs.error) { res.status(400).json({ error: customs.error }); return; }
  const invoiceValue = Number(invoice.total);
  const includeInsurance = req.query.includeInsurance !== "false";
  const insuredValue = includeInsurance ? invoiceInsuranceValue(invoiceValue) : 0;
  const rates = await getSendcloudRates({
    country: address.country,
    postalCode: address.postalCode,
    weightKg,
    lengthCm: optionalPositiveNumber(req.query.lengthCm),
    widthCm: optionalPositiveNumber(req.query.widthCm),
    heightCm: optionalPositiveNumber(req.query.heightCm),
    insuredValue,
  });
  res.json({
    rates,
    suggestedServiceId: rates[0]?.id ?? null,
    insuredValue,
    uninsuredValue: invoiceInsuranceCoverageGap(invoiceValue),
    insuranceIncluded: includeInsurance,
    pickupWindow: "Mon/Wed/Fri 09:00–13:00 (when supported)",
  });
});

router.post("/iroc/invoices/:id/shipment", requireIrocAuth, async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const body = req.body as ShipmentInput;
  const dimensions = [body?.lengthCm, body?.widthCm, body?.heightCm];
  if (!Number.isInteger(id) || !body?.confirm || !body.serviceId || !body.carrier || !body.serviceCode ||
      !Number.isFinite(Number(body.weightKg)) || Number(body.weightKg) <= 0 ||
      !Number.isFinite(Number(body.quotedDeliveryCost)) || Number(body.quotedDeliveryCost) < 0 ||
      !dimensions.every((value) => value === undefined || value === null || (Number.isFinite(Number(value)) && Number(value) > 0)) ||
      (body.quotedInsuranceCost !== undefined && (!Number.isFinite(Number(body.quotedInsuranceCost)) || Number(body.quotedInsuranceCost) < 0))) {
    res.status(400).json({ error: "Confirm a valid shipment with a service, non-negative costs, and positive parcel measurements" }); return;
  }
  const shippingContext = await invoiceShippingContext(id);
  if (!shippingContext) { res.status(404).json({ error: "Invoice not found" }); return; }
  const address = resolveInvoiceShipmentAddress(shippingContext);
  if (!address.name || !address.street || !address.postalCode || !address.city || !address.email) {
    res.status(400).json({ error: "A complete recipient name, shipping street, postal code, city and email are required" }); return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // There is no row to lock before the first shipment. An advisory lock makes
    // a second confirmation wait and observe the saved shipment instead.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`iroc-invoice-shipment:${id}`]);
    const { rows: existing } = await client.query(
      "SELECT id, status FROM iroc_order_shipments WHERE invoice_id = $1 FOR UPDATE", [id],
    );
    if (existing.length && existing[0].status !== "provider_error") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "A shipment attempt already exists for this invoice and must be reconciled before another can be created", shipmentId: existing[0].id }); return;
    }
    const { rows: invoices } = await client.query(
      "SELECT * FROM iroc_invoices WHERE id = $1 FOR UPDATE", [id],
    );
    const invoice = invoices[0];
    if (!invoice) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Invoice not found" }); return;
    }
    const sourceOrderReviewResult = await client.query<{ sally_review_result: string | null }>(
      "SELECT sally_review_result FROM iroc_orders WHERE id = $1",
      [invoice.source_order_id],
    );
    if (!isDirectInvoiceShipmentEligible(invoice.status, invoice.source_order_id, sourceOrderReviewResult.rows[0]?.sally_review_result)) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: invoice.source_order_id ? "Website-order invoices must be shipped from Incoming Orders" : "Delivery costs can only be added to a draft invoice" }); return;
    }
    const { rows: invoiceItems } = await client.query(
      "SELECT product_name, sku, description, hs_code, country_of_origin, weight_kg, quantity, unit_price, line_total, vat_rate FROM iroc_invoice_items WHERE invoice_id = $1",
      [id],
    );
    const invoiceValue = Number(invoice.total);
    const insuredValue = body.includeInsurance === false ? 0 : invoiceInsuranceValue(invoiceValue);
    const insuranceCosts = body.includeInsurance === false ? 0 : Number(body.quotedInsuranceCost ?? 0);
    const pickupScheduledFor = nextPreferredPickupDate();
    const delivery = Number(body.quotedDeliveryCost);
    const customs = buildInvoiceCustomsData(invoice, invoiceItems, address.country, {
      freightCosts: delivery,
      insuranceCosts,
    });
    if (customs.error) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: customs.error });
      return;
    }
    if (customs.data && !dimensions.every(optionalPositiveNumber)) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Non-EU shipments require positive parcel length, width, and height." });
      return;
    }
    const grouped = invoiceItems.length ? calculateFacturXTotals(
      { invoiceType: invoice.invoice_type, vatRate: invoice.vat_rate, deliveryCosts: delivery, insuranceCosts },
      invoiceItems.map(item => ({
        productName: item.product_name,
        quantity: Number(item.quantity),
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
        vatRate: item.vat_rate ?? invoice.vat_rate,
      })),
    ) : null;
    const calculatedInvoiceTotals = grouped ? {
      vatAmount: grouped.taxTotalCents / 100,
      total: grouped.grandTotalCents / 100,
    } : calculateInvoiceTotals({
      subtotal: Number(invoice.subtotal),
      deliveryCosts: delivery,
      insuranceCosts,
      vatRate: Number(invoice.vat_rate),
    });
    let persistedInvoiceTotals: {
      deliveryCosts: string;
      insuranceCosts: string;
      vatAmount: string;
      total: string;
    };
    const shipmentValues = [
      body.carrier, body.serviceCode,
      JSON.stringify({ serviceId: body.serviceId, quotedDeliveryCost: delivery, quotedInsuranceCost: insuranceCosts, carrier: body.carrier, serviceCode: body.serviceCode }),
      body.weightKg, optionalPositiveNumber(body.lengthCm) ?? null, optionalPositiveNumber(body.widthCm) ?? null,
      optionalPositiveNumber(body.heightCm) ?? null, delivery, insuranceCosts, insuredValue, pickupScheduledFor,
    ];
    const shipmentId = existing.length
      ? existing[0].id as number
      : (await client.query(
        `INSERT INTO iroc_order_shipments
         (order_id, invoice_id, status, carrier, service_code, quote_snapshot, weight_kg, length_cm, width_cm, height_cm,
          delivery_costs, insurance_costs, insured_value, pickup_scheduled_for)
         VALUES (NULL,$1,'creating',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [invoice.id, ...shipmentValues],
      )).rows[0].id as number;
    if (existing.length) {
      await client.query(
        `UPDATE iroc_order_shipments
         SET status='creating', carrier=$1, service_code=$2, quote_snapshot=$3, weight_kg=$4, length_cm=$5, width_cm=$6, height_cm=$7,
             delivery_costs=$8, insurance_costs=$9, insured_value=$10, pickup_scheduled_for=$11,
             tracking_number=NULL, label_url=NULL, sendcloud_shipment_id=NULL
         WHERE id=$12`,
        [...shipmentValues, shipmentId],
      );
    }
    // The administrator has explicitly accepted this quote. Apply its charges to
    // the draft now, rather than making the customer-facing invoice depend on
    // Sendcloud's later payment or label-generation response.
    const quoteInvoiceUpdate = await client.query(
      `UPDATE iroc_invoices
          SET delivery_costs=$1, insurance_costs=$2, shipping_method=$3, vat_amount=$4, total=$5, updated_at=NOW()
        WHERE id=$6 AND status='draft'
        RETURNING delivery_costs, insurance_costs, vat_amount, total`,
      [delivery, insuranceCosts, `${body.carrier} ${body.serviceCode}`,
        calculatedInvoiceTotals.vatAmount, calculatedInvoiceTotals.total, invoice.id],
    );
    if (!quoteInvoiceUpdate.rows.length) throw new Error("Invoice was no longer a draft when the shipping quote was accepted");
    const quoteInvoice = quoteInvoiceUpdate.rows[0];
    persistedInvoiceTotals = {
      deliveryCosts: Number(quoteInvoice.delivery_costs).toFixed(2),
      insuranceCosts: Number(quoteInvoice.insurance_costs).toFixed(2),
      vatAmount: Number(quoteInvoice.vat_amount).toFixed(2),
      total: Number(quoteInvoice.total).toFixed(2),
    };
    await client.query("COMMIT");
    const externalReference = `iroc-invoice-shipment:${shipmentId}`;

    let created: Awaited<ReturnType<typeof createSendcloudShipment>>;
    try {
      created = await createSendcloudShipment({
        name: address.name, company: address.company, address: address.street, houseNumber: address.houseNumber,
        postalCode: address.postalCode, city: address.city, country: address.country, email: address.email, phone: address.phone,
        weightKg: Number(body.weightKg), lengthCm: optionalPositiveNumber(body.lengthCm), widthCm: optionalPositiveNumber(body.widthCm),
        heightCm: optionalPositiveNumber(body.heightCm), serviceId: body.serviceId, insuredValue, orderValue: invoiceValue, externalReference,
        customs: customs.data,
      });
    } catch (error) {
      if (error instanceof SendcloudRequestError) {
        await client.query("UPDATE iroc_order_shipments SET status='provider_error' WHERE id=$1 AND status='creating'", [shipmentId]);
        req.log.warn({ err: error, invoiceId: id, shipmentId }, "Sendcloud rejected invoice shipment");
        const billingProblem = error.message.includes("no_valid_payment_method");
        res.status(502).json({
          error: billingProblem
            ? "Sendcloud needs a valid payment method in its billing settings before it can create a shipment or label."
            : "Sendcloud could not create the shipment. The attempt was retained for review; do not submit it again.",
          shipmentId,
          invoiceTotals: persistedInvoiceTotals,
        });
        return;
      }
      // A timeout or dropped connection can happen after Sendcloud accepted the
      // parcel. Correlate before reporting an uncertain state; never retry POST.
      const recovered = await findSendcloudShipmentByExternalReference(externalReference).catch(() => null);
      if (recovered) {
        created = recovered;
      } else {
        await client.query("UPDATE iroc_order_shipments SET status='needs_reconciliation' WHERE id=$1 AND status='creating'", [shipmentId]);
        req.log.error({ err: error, invoiceId: id, shipmentId }, "Sendcloud response was ambiguous; shipment needs reconciliation");
        res.status(502).json({ error: "Sendcloud did not confirm the shipment. The attempt needs reconciliation; do not submit it again." }); return;
      }
    }

    try {
      await client.query("BEGIN");
      // Quote acceptance already committed the invoice's shipping and insurance
      // charges before calling the provider. Do not write those totals again:
      // an administrator may have saved other draft changes while Sendcloud was
      // processing the external request.
      await client.query(
        `UPDATE iroc_order_shipments
         SET status='created', tracking_number=$1, label_url=$2, sendcloud_shipment_id=$3
         WHERE id=$4 AND status='creating'`,
        [created.trackingNumber, created.labelUrl, created.id, shipmentId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await client.query("UPDATE iroc_order_shipments SET status='needs_reconciliation' WHERE id=$1 AND status='creating'", [shipmentId]).catch(() => undefined);
      req.log.error({ err: error, invoiceId: id, shipmentId }, "Sendcloud shipment needs invoice reconciliation");
      res.status(502).json({ error: "Sendcloud created the shipment, but the invoice update needs reconciliation. Do not submit it again." }); return;
    }
    res.status(201).json({
      shipmentId,
      trackingNumber: created.trackingNumber,
      labelUrl: created.labelUrl,
      insuredValue,
      insuranceCosts,
      pickupScheduledFor,
      invoiceTotals: persistedInvoiceTotals,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error, invoiceId: id }, "Unable to create Sendcloud invoice shipment");
    res.status(502).json({ error: "Shipment could not be created; no invoice changes were applied" });
  } finally {
    client.release();
  }
});

/** Build the delivery-note ShippingInfo block from a websiteCustomer's shipping fields (null if none set) */
export function wcToShippingInfo(wc: typeof websiteCustomersTable.$inferSelect): ShippingInfo | undefined {
  if (!wc.shippingFirstName && !wc.shippingAddress) return undefined;
  return {
    firstName:       wc.shippingFirstName ?? null,
    lastName:        wc.shippingLastName ?? null,
    institutionName: wc.shippingInstitutionName ?? null,
    address:         wc.shippingAddress ?? null,
    postalCode:      wc.shippingPostalCode ?? null,
    city:            wc.shippingCity ?? null,
    country:         wc.shippingCountry ?? null,
    phone:           wc.shippingPhone ?? null,
    email:           wc.shippingEmail ?? null,
  };
}

/** Normalise a websiteCustomer record into the shape buildInvoicePDF expects */
export function wcToCustomerShape(wc: typeof websiteCustomersTable.$inferSelect) {
  const EU = new Set(["AT","BE","BG","CY","CZ","DK","EE","FI","FR","GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK"]);
  return {
    id: wc.id,
    customerNr: wc.customerNr ?? null,
    reorderCode: wc.reorderCode ?? null,
    salutation: wc.salutation ?? null,
    title: wc.title ?? null,
    name: [wc.firstName, wc.lastName].filter(Boolean).join(" ") || wc.email,
    company: wc.institutionName ?? null,
    address: wc.address ?? null,
    street: wc.street ?? null,
    houseNumber: wc.houseNumber ?? null,
    city: wc.city ?? null,
    postalCode: wc.postalCode ?? null,
    country: wc.country ?? "DE",
    vatId: wc.ustIdNr ?? null,
    isEu: EU.has((wc.country ?? "").toUpperCase()),
    email: wc.email,
    shippingFirstName: wc.shippingFirstName ?? null,
    shippingLastName: wc.shippingLastName ?? null,
    shippingInstitutionName: wc.shippingInstitutionName ?? null,
    shippingAddress: wc.shippingAddress ?? null,
    shippingPostalCode: wc.shippingPostalCode ?? null,
    shippingCity: wc.shippingCity ?? null,
    shippingCountry: wc.shippingCountry ?? null,
    shippingEmail: wc.shippingEmail ?? null,
    phone: wc.phone ?? null,
    isPublicAuthority: wc.isPublicAuthority,
    defaultBuyerReference: wc.defaultBuyerReference ?? null,
    notes: null as string | null,
    createdAt: wc.createdAt,
    updatedAt: new Date(),
  };
}

function legacyToCustomerShape(customer: typeof irocCustomers.$inferSelect) {
  return {
    ...customer,
    name: stripLegacyCustomerTitlePrefix(customer.name, customer.title),
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

/** Split a line net amount into immutable per-unit cent buckets whose rounded
 * unit VAT also reconciles to the VAT of the complete source line. */
export function allocateInvoiceLineUnitNetCents(totalNetCents: number, quantity: number, vatRate: number): number[] {
  if (!Number.isInteger(totalNetCents) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Invalid source line allocation values.");
  }
  const sign = totalNetCents < 0 ? -1 : 1;
  const total = Math.abs(totalNetCents);
  const rate = Math.abs(vatRate);
  const buckets = Array.from({ length: quantity }, (_, index) =>
    Math.floor(total / quantity) + (index < total % quantity ? 1 : 0));
  const vat = (cents: number) => Math.round(cents * rate / 100);
  const targetVat = vat(total);
  let currentVat = buckets.reduce((sum, value) => sum + vat(value), 0);

  // Moving one cent between units preserves line net. Choose the first stable
  // pair that moves aggregate rounded VAT toward the source line's rounded VAT.
  // A bounded exhaustive search also handles discounts and very small lines.
  for (let attempts = 0; currentVat !== targetVat && attempts < quantity * quantity * 200; attempts++) {
    const direction = Math.sign(targetVat - currentVat);
    let moved = false;
    for (let donor = quantity - 1; donor >= 0 && !moved; donor--) {
      if (buckets[donor] === 0) continue;
      for (let receiver = 0; receiver < quantity; receiver++) {
        if (receiver === donor) continue;
        const before = vat(buckets[donor]) + vat(buckets[receiver]);
        const after = vat(buckets[donor] - 1) + vat(buckets[receiver] + 1);
        if (Math.sign(after - before) === direction) {
          buckets[donor]--;
          buckets[receiver]++;
          currentVat += after - before;
          moved = true;
          break;
        }
      }
    }
    if (!moved) throw new Error("Unable to reconcile source line VAT allocation.");
  }
  if (currentVat !== targetVat) throw new Error("Unable to reconcile source line VAT allocation.");
  return buckets.map(value => value * sign);
}

function formatInvoiceRow(row: typeof irocInvoices.$inferSelect & { customerName?: string | null }) {
  const resolvedPaymentTerms = resolvePaymentTerms(row);
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    customerId: row.customerId ?? null,
    websiteCustomerId: row.websiteCustomerId ?? null,
    customerName: (row as any).customerName ?? null,
    invoiceType: row.invoiceType,
    issueDate: row.issueDate,
    dueDate: resolvedPaymentTerms.dueDate,
    orderNumber: row.orderNumber ?? null,
    referenceNumber: row.referenceNumber ?? null,
    buyerReference: row.buyerReference ?? null,
    sellerVatId: row.sellerVatId ?? null,
    buyerVatId: row.buyerVatId ?? null,
    paymentTerms: resolvedPaymentTerms.description,
    paymentTermCode: resolvedPaymentTerms.paymentTermCode,
    isB2g: row.isB2g ?? false,
    shippingMethod: row.shippingMethod ?? null,
    reasonForExport: row.reasonForExport ?? null,
    termsOfDelivery: (row as any).termsOfDelivery ?? null,
    deliveryCosts: row.deliveryCosts.toString(),
    insuranceCosts: row.insuranceCosts.toString(),
    subtotal: row.subtotal.toString(),
    vatRate: row.vatRate.toString(),
    vatAmount: row.vatAmount.toString(),
    total: row.total.toString(),
    status: row.status,
    notes: row.notes ?? null,
    vatNote: row.vatNote ?? null,
    language: row.language,
    sourceOrderId: row.sourceOrderId ?? null,
    sallyGenerated: row.sallyGenerated ?? false,
    correctionOfInvoiceId: row.correctionOfInvoiceId ?? null,
    correctionReason: row.correctionReason ?? null,
    reminderSuppressed: row.reminderSuppressed ?? false,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get(
  "/iroc/invoices",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select({
        invoice: irocInvoices,
        wcFirstName: websiteCustomersTable.firstName,
        wcLastName: websiteCustomersTable.lastName,
        wcEmail: websiteCustomersTable.email,
        legacyName: irocCustomers.name,
      })
      .from(irocInvoices)
      .leftJoin(websiteCustomersTable, eq(irocInvoices.websiteCustomerId, websiteCustomersTable.id))
      .leftJoin(irocCustomers, eq(irocInvoices.customerId, irocCustomers.id))
      .orderBy(desc(irocInvoices.createdAt));

    res.json(
      rows.map((r) => {
        const wcName = [r.wcFirstName, r.wcLastName].filter(Boolean).join(" ") || r.wcEmail;
        return formatInvoiceRow({ ...r.invoice, customerName: wcName || r.legacyName });
      }),
    );
  },
);

router.post(
  "/iroc/invoices",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const parsed = CreateIrocInvoiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid invoice data" });
      return;
    }
    const {
      websiteCustomerId,
      invoiceType,
      issueDate,
      dueDate,
      orderNumber,
      referenceNumber,
      buyerReference,
      sellerVatId,
      buyerVatId,
      paymentTerms,
      paymentTermCode,
      isB2g = false,
      shippingMethod,
      reasonForExport,
      termsOfDelivery,
      deliveryCosts = "0",
      vatRate,
      notes,
      vatNote,
      language = "de",
      items,
    } = parsed.data;
    if (isB2g && !buyerReference?.trim()) {
      res.status(422).json({ error: "B2G invoices require a non-empty buyer reference (BT-10 / Leitweg-ID)." });
      return;
    }
    const resolvedPaymentTerms = resolvePaymentTerms({ issueDate, paymentTermCode, paymentTerms, dueDate, language });
    if (resolvedPaymentTerms.paymentTermCode === "custom" && !isValidInvoiceDate(resolvedPaymentTerms.dueDate)) {
      res.status(422).json({ error: "Custom payment terms require a valid due date (YYYY-MM-DD)." });
      return;
    }

    // Validate websiteCustomer exists
    const [wc] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, websiteCustomerId));
    if (!wc) {
      res.status(400).json({ error: "Website customer not found" });
      return;
    }
    // Calculate totals (discounted price × quantity)
    let subtotal = 0;
    for (const item of items) {
      if (item.isDemo) continue; // demo items are free
      const disc = parseFloat(item.discountPercent?.toString() ?? "0") || 0;
      const base = parseFloat(item.unitPrice);
      subtotal += base * (1 - disc / 100) * item.quantity;
    }
    const delivery = parseFloat(deliveryCosts ?? "0");
    // New manually-created invoices have no Sendcloud insurance yet.
    const insurance = 0;

    // VAT normalization + guards shared with the offer-PDF route
    const vatCheck = normalizeAndValidateVat(invoiceType, vatRate, vatNote);
    if ("error" in vatCheck) {
      // A non-zero VAT rate conflicts with these zero-VAT invoice types.
      // Treat it as semantically invalid input so handcrafted API requests
      // cannot persist a tax-invalid invoice.
      const status = ["eu", "noneu", "export"].includes(invoiceType) ? 422 : 400;
      res.status(status).json({ error: vatCheck.error });
      return;
    }
    const effectiveVatRate = vatCheck.rate;
    const effectiveBuyerVatId = buyerVatId?.trim() || wc.ustIdNr?.trim() || null;
    const effectiveSellerVatId = sellerVatId?.trim() || CO.vatDe;
    if (["eu", "lecture-eu"].includes(invoiceType) && !effectiveBuyerVatId) {
      res.status(422).json({ error: "Buyer VAT ID is required for intra-community and reverse-charge invoices." });
      return;
    }
    const lineVatCheck = normalizeAndValidateLineVatRates(
      invoiceType,
      effectiveVatRate,
      items.map(item => item.vatRate),
    );
    if ("error" in lineVatCheck) {
      res.status(422).json({ error: lineVatCheck.error });
      return;
    }

    const groupedTotals = calculateFacturXTotals(
      { invoiceType, vatRate: effectiveVatRate, deliveryCosts: delivery, insuranceCosts: insurance },
      items.map((item, index) => {
        const discount = parseFloat(item.discountPercent?.toString() ?? "0") || 0;
        const lineTotal = item.isDemo ? 0 : parseFloat(item.unitPrice) * (1 - discount / 100) * item.quantity;
        return { productName: item.productName, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal, vatRate: lineVatCheck.rates[index] };
      }),
    );
    const vatAmount = groupedTotals.taxTotalCents / 100;
    const total = groupedTotals.grandTotalCents / 100;

    const invoiceNumber = await generateInvoiceNumber();

    const [invoice] = await db
      .insert(irocInvoices)
      .values({
        invoiceNumber,
        customerId: null,
        websiteCustomerId,
        invoiceType,
        issueDate,
        dueDate: resolvedPaymentTerms.dueDate,
        orderNumber: orderNumber ?? null,
        referenceNumber: referenceNumber ?? null,
        buyerReference: buyerReference?.trim() || null,
        sellerVatId: effectiveSellerVatId,
        buyerVatId: effectiveBuyerVatId,
        paymentTerms: resolvedPaymentTerms.description,
        paymentTermCode: resolvedPaymentTerms.paymentTermCode,
        isB2g,
        shippingMethod: shippingMethod ?? null,
        reasonForExport: reasonForExport ?? null,
        termsOfDelivery: termsOfDelivery ?? null,
        deliveryCosts: delivery.toFixed(2),
        subtotal: subtotal.toFixed(2),
        vatRate: effectiveVatRate.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        total: total.toFixed(2),
        status: "draft",
        notes: notes ?? null,
        vatNote: vatNote ?? null,
        language,
      })
      .returning();

    // Insert line items
    if (items.length > 0) {
      await db.insert(irocInvoiceItems).values(
        items.map((item, index) => {
          const isDemo  = item.isDemo === true;
          const discPct = parseFloat(item.discountPercent?.toString() ?? "0") || 0;
          const base    = parseFloat(item.unitPrice);
          const dPrice  = isDemo ? 0 : base * (1 - discPct / 100);
          return {
            invoiceId:       invoice.id,
            productId:       item.productId ?? null,
            productName:     item.productName,
            sku:             item.sku ?? null,
            description:     item.description ?? null,
            lotNumber:       item.lotNumber ?? null,
            hsCode:          item.hsCode ?? null,
            countryOfOrigin: item.countryOfOrigin ?? null,
            weightKg:        item.weightKg ?? null,
            discountPercent: item.discountPercent ?? null,
            vatRate: lineVatCheck.rates[index].toFixed(2),
            isDemo:          isDemo,
            unitPrice:       item.unitPrice,
            quantity:        item.quantity,
            lineTotal:       (dPrice * item.quantity).toFixed(2),
          };
        }),
      );

      // Stock is NOT decremented at draft creation — it is deducted when the
      // invoice is first marked as "sent" or "paid" (see PATCH /status route).
    }

    const lineItems = await db
      .select()
      .from(irocInvoiceItems)
      .where(eq(irocInvoiceItems.invoiceId, invoice.id));

    const customerData = wcToCustomerShape(wc);

    res.status(201).json({
      ...formatInvoiceRow({ ...invoice, customerName: customerData.name }),
      items: lineItems.map((li) => ({
        ...li,
        unitPrice: li.unitPrice.toString(),
        lineTotal: li.lineTotal.toString(),
      })),
      customer: { ...customerData, createdAt: customerData.createdAt.toISOString() },
    });
  },
);

// ── Next invoice number preview (must come before /:id) ──────────────────────
router.get(
  "/iroc/invoices/next-number",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const { year, seq } = await nextInvoiceSeq();
    res.json({ nextNumber: `${year}-${seq.toString().padStart(4, "0")}` });
  },
);

router.get(
  "/iroc/invoices/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [row] = await db
      .select({
        invoice: irocInvoices,
        wcFirstName: websiteCustomersTable.firstName,
        wcLastName: websiteCustomersTable.lastName,
        wcEmail: websiteCustomersTable.email,
        legacyName: irocCustomers.name,
        sourceOrderReviewResult: irocOrders.sallyReviewResult,
      })
      .from(irocInvoices)
      .leftJoin(websiteCustomersTable, eq(irocInvoices.websiteCustomerId, websiteCustomersTable.id))
      .leftJoin(irocCustomers, eq(irocInvoices.customerId, irocCustomers.id))
      .leftJoin(irocOrders, eq(irocInvoices.sourceOrderId, irocOrders.id))
      .where(eq(irocInvoices.id, id));

    if (!row) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // Prefer websiteCustomer; fall back to legacy irocCustomer
    let customerData: any = null;
    if (row.invoice.customerSnapshot && typeof row.invoice.customerSnapshot === "object") {
      // A correction is a legal record of the seller/buyer particulars when it
      // was issued, not a live view of subsequently edited customer data.
      customerData = row.invoice.customerSnapshot;
    } else if (row.invoice.websiteCustomerId) {
      const [wc] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, row.invoice.websiteCustomerId));
      if (wc) customerData = { ...wcToCustomerShape(wc), createdAt: wc.createdAt.toISOString() };
    } else if (row.invoice.customerId) {
      const [ic] = await db.select().from(irocCustomers).where(eq(irocCustomers.id, row.invoice.customerId));
      if (ic) {
        customerData = {
          ...ic,
          name: stripLegacyCustomerTitlePrefix(ic.name, ic.title),
          createdAt: ic.createdAt.toISOString(),
        };
      }
    }

    const wcName = [row.wcFirstName, row.wcLastName].filter(Boolean).join(" ") || row.wcEmail;
    const lineItems = await db
      .select({
        item:            irocInvoiceItems,
        productCategory: irocProducts.category,
        productDescriptionEn: irocProducts.descriptionEn,
        productDescriptionDe: irocProducts.descriptionDe,
      })
      .from(irocInvoiceItems)
      .leftJoin(irocProducts, eq(irocProducts.id, irocInvoiceItems.productId))
      .where(eq(irocInvoiceItems.invoiceId, id));

    const { rows: shipmentRows } = await pool.query(
      `SELECT id, status, tracking_number, label_url, sendcloud_shipment_id, delivery_costs, insurance_costs,
              insured_value, pickup_scheduled_for, weight_kg, length_cm, width_cm, height_cm
         FROM iroc_order_shipments
        WHERE invoice_id = $1
        ORDER BY id DESC
        LIMIT 1`,
      [id],
    );

    const savedShipment = shipmentRows[0];
    const linkedCorrections = await db.select({
      id: irocInvoices.id, invoiceNumber: irocInvoices.invoiceNumber, status: irocInvoices.status,
    }).from(irocInvoices).where(eq(irocInvoices.correctionOfInvoiceId, id));
    res.json({
      ...formatInvoiceRow({ ...row.invoice, customerName: wcName || row.legacyName }),
      items: lineItems.map(({ item: li, productCategory, productDescriptionEn, productDescriptionDe }) => ({
        ...li,
        description: li.description?.trim()
          ? li.description
          : (row.invoice.language === "en" ? productDescriptionEn : productDescriptionDe) ?? null,
        unitPrice:       li.unitPrice.toString(),
        lineTotal:       li.lineTotal.toString(),
        productCategory: productCategory ?? null,
      })),
      customer: customerData,
      corrections: linkedCorrections,
      isPortalOrder: isPortalSourceOrder(row.sourceOrderReviewResult),
      shipment: savedShipment ? {
        shipmentId: Number(savedShipment.id),
        status: String(savedShipment.status),
        trackingNumber: savedShipment.tracking_number ?? null,
        labelUrl: savedShipment.label_url ?? null,
        sendcloudShipmentId: savedShipment.sendcloud_shipment_id ?? null,
        deliveryCosts: String(savedShipment.delivery_costs ?? "0"),
        insuranceCosts: String(savedShipment.insurance_costs ?? "0"),
        insuredValue: String(savedShipment.insured_value ?? "0"),
        weightKg: String(savedShipment.weight_kg ?? ""),
        lengthCm: savedShipment.length_cm == null ? null : String(savedShipment.length_cm),
        widthCm: savedShipment.width_cm == null ? null : String(savedShipment.width_cm),
        heightCm: savedShipment.height_cm == null ? null : String(savedShipment.height_cm),
        pickupScheduledFor: savedShipment.pickup_scheduled_for instanceof Date
          ? savedShipment.pickup_scheduled_for.toISOString()
          : savedShipment.pickup_scheduled_for ?? null,
      } : null,
    });
  },
);

// ── Returned products: separately numbered Rechnungskorrektur ────────────────
router.post(
  "/iroc/invoices/:id/corrections",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const sourceId = Number(req.params.id);
    const parsed = CreateIrocInvoiceCorrectionBody.safeParse(req.body);
    if (!Number.isInteger(sourceId) || sourceId <= 0 || !parsed.success) {
      res.status(400).json({ error: "A reason and at least one returned invoice line with a positive quantity are required." });
      return;
    }
    const reason = parsed.data.reason.trim();
    if (!parsed.data.reason.trim()) {
      res.status(400).json({ error: "A correction reason must not be blank." });
      return;
    }
    const requested = parsed.data.items;
    const quantities = new Map<number, number>();
    for (const line of requested) {
      const itemId = Number(line.invoiceItemId);
      quantities.set(itemId, (quantities.get(itemId) ?? 0) + Number(line.quantity));
    }
    try {
      const correction = await db.transaction(async tx => {
        // The source row lock serializes simultaneous correction requests, so
        // validation and creation cannot cumulatively over-refund a line.
        // Lock first, then read through Drizzle so column names are mapped to
        // the schema's camelCase properties. Rows returned by a raw
        // `SELECT *` expose PostgreSQL snake_case names (for example
        // `vat_rate`), which made otherwise valid corrections fail VAT
        // validation because `source.vatRate` was undefined.
        const sourceLock = await tx.execute(sql`
          SELECT id FROM iroc_invoices WHERE id = ${sourceId} FOR UPDATE
        `);
        const [source] = sourceLock.rows.length
          ? await tx.select().from(irocInvoices).where(eq(irocInvoices.id, sourceId))
          : [];
        if (!source) throw new Error("Invoice not found");
        if (source.correctionOfInvoiceId != null) {
          throw new Error("An invoice correction cannot be used as the source of another correction.");
        }
        if (source.status !== "sent" && source.status !== "paid") {
          throw new Error("Invoice corrections can only be created from sent or paid invoices.");
        }
        const sourceItems = await tx.select().from(irocInvoiceItems)
          .where(eq(irocInvoiceItems.invoiceId, sourceId));
        const byId = new Map(sourceItems.map(item => [item.id, item]));
        const previouslyCorrected = new Map<number, number>();
        for (const [itemId, quantity] of quantities) {
          const item = byId.get(itemId);
          if (!item) throw new Error("A selected returned line does not belong to the original invoice.");
          const prior = await tx.execute(sql`
            SELECT COALESCE(SUM(ci.quantity), 0)::integer AS quantity
            FROM iroc_invoice_items ci
            JOIN iroc_invoices c ON c.id = ci.invoice_id
            WHERE ci.correction_source_item_id = ${itemId}
              AND c.status <> 'cancelled'
          `);
          const alreadyCorrected = Number(prior.rows[0]?.quantity ?? 0);
          previouslyCorrected.set(itemId, alreadyCorrected);
          if (quantity + alreadyCorrected > item.quantity) {
            throw new Error(`Returned quantity for "${item.productName}" exceeds the remaining refundable quantity.`);
          }
        }
        const websiteCustomer = source.websiteCustomerId
          ? (await tx.select().from(websiteCustomersTable)
            .where(eq(websiteCustomersTable.id, source.websiteCustomerId)))[0]
          : undefined;
        const legacyCustomer = !websiteCustomer && source.customerId
          ? (await tx.select().from(irocCustomers).where(eq(irocCustomers.id, source.customerId)))[0]
          : undefined;
        const customerSnapshot = websiteCustomer
          ? { ...wcToCustomerShape(websiteCustomer), createdAt: websiteCustomer.createdAt.toISOString(), updatedAt: new Date().toISOString() }
          : legacyCustomer ? legacyToCustomerShape(legacyCustomer) : null;
        if (!customerSnapshot) throw new Error("The original invoice customer could not be snapshotted.");
        const correctionLines = [...quantities.entries()].map(([itemId, quantity]) => {
          const item = byId.get(itemId)!;
          // EN 16931 BR-27 requires a non-negative unit price even for credit
          // notes; the negative correction value is represented by lineTotal.
          const unitPrice = Math.abs(Number(item.unitPrice));
          // Allocate the original line's integer cents unit-by-unit. This
          // avoids floating point drift and makes partial corrections reconcile
          // exactly with the original total (the final correction gets residual cents).
          const totalCents = Math.round(Math.abs(Number(item.lineTotal)) * 100);
          const unitBuckets = allocateInvoiceLineUnitNetCents(
            totalCents,
            item.quantity,
            Number(item.vatRate ?? source.vatRate),
          );
          const priorQuantity = previouslyCorrected.get(itemId) ?? 0;
          const lineTotal = -unitBuckets.slice(priorQuantity, priorQuantity + quantity)
            .reduce((sum, cents) => sum + cents, 0) / 100;
          return { item, itemId, quantity, unitPrice, lineTotal };
        });
        const totals = calculateFacturXTotals(
          { invoiceType: source.invoiceType, vatRate: source.vatRate, deliveryCosts: 0, insuranceCosts: 0 },
          correctionLines.map(line => ({
            productName: line.item.productName, quantity: line.quantity,
            unitPrice: line.unitPrice, lineTotal: line.lineTotal,
            vatRate: line.item.vatRate ?? source.vatRate,
          })),
        );
        const invoiceNumber = await generateInvoiceNumber();
        const today = new Date().toISOString().slice(0, 10);
        const isEnglish = source.language === "en";
        const label = isEnglish ? "Invoice correction" : "Rechnungskorrektur";
        const [created] = await tx.insert(irocInvoices).values({
          // Corrections intentionally have no mutable customer FK: all legal
          // buyer data is carried by the immutable normalized snapshot.
          invoiceNumber, customerId: null, websiteCustomerId: null,
          invoiceType: source.invoiceType, issueDate: today, dueDate: today,
          orderNumber: source.orderNumber, referenceNumber: source.invoiceNumber,
          buyerReference: source.buyerReference, sellerVatId: source.sellerVatId, buyerVatId: source.buyerVatId,
          paymentTerms: source.language === "en" ? "Refund due immediately" : "Erstattung sofort fällig",
          paymentTermCode: "immediate", isB2g: source.isB2g,
          deliveryCosts: "0.00", insuranceCosts: "0.00",
          subtotal: (totals.lineTotalCents / 100).toFixed(2), vatRate: source.vatRate,
          vatAmount: (totals.taxTotalCents / 100).toFixed(2), total: (totals.grandTotalCents / 100).toFixed(2),
          status: "draft", notes: `${label} ${isEnglish ? "for" : "zu"} ${source.invoiceNumber} (${source.issueDate})\n${reason}`,
          vatNote: source.vatNote, language: source.language, correctionOfInvoiceId: source.id,
          correctionReason: reason, customerSnapshot,
          originalInvoiceNumber: source.invoiceNumber, originalInvoiceDate: source.issueDate,
        }).returning();
        await tx.insert(irocInvoiceItems).values(correctionLines.map(line => ({
          invoiceId: created.id, correctionSourceItemId: line.itemId, productId: line.item.productId,
          productName: line.item.productName, sku: line.item.sku, description: line.item.description,
          lotNumber: line.item.lotNumber, hsCode: line.item.hsCode, countryOfOrigin: line.item.countryOfOrigin,
          weightKg: line.item.weightKg, discountPercent: line.item.discountPercent, vatRate: line.item.vatRate,
          isDemo: line.item.isDemo, unitPrice: line.unitPrice.toFixed(2), quantity: line.quantity,
          lineTotal: line.lineTotal.toFixed(2),
        })));
        return created;
      });
      res.status(201).json(formatInvoiceRow(correction));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create invoice correction.";
      res.status(message === "Invoice not found" ? 404 : 409).json({ error: message });
    }
  },
);

router.delete(
  "/iroc/invoices/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [existing] = await db
      .select({ status: irocInvoices.status })
      .from(irocInvoices)
      .where(eq(irocInvoices.id, id));
    if (!existing) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (existing.status === "sent" || existing.status === "paid" || existing.status === "cancelled") {
      res.status(409).json({
        error: "Sent, paid, and cancelled invoices cannot be permanently deleted. Per German GoBD requirements invoices must be retained for 10 years. Cancel the invoice instead.",
      });
      return;
    }
    await db.delete(irocInvoices).where(eq(irocInvoices.id, id));
    res.json({ message: "Invoice deleted" });
  },
);

// Duplicate an invoice into a new draft. Corrections are handled by the separate
// correction route; a duplicate remains a normal invoice so users can reuse an
// existing invoice as a starting point for a new order.
router.post(
  "/iroc/invoices/:id/duplicate",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [source] = await db.select().from(irocInvoices).where(eq(irocInvoices.id, id));
    if (!source) { res.status(404).json({ error: "Invoice not found" }); return; }
    // A correction is an immutable accounting document. It must never become
    // the positive source of a new draft through the legacy copy endpoint.
    if (source.correctionOfInvoiceId != null) {
      res.status(410).json({
        error: "Invoice corrections cannot be duplicated. Create a new invoice or use the returned-products correction workflow.",
      });
      return;
    }

    const sourceItems = await db
      .select()
      .from(irocInvoiceItems)
      .where(eq(irocInvoiceItems.invoiceId, id));

    // Today's date as YYYY-MM-DD (server locale-independent)
    const today = new Date().toISOString().slice(0, 10);

    // Build the correction note — prepend to any existing notes
    const correctionLabel = (source.language ?? "de") === "en"
      ? `Correction invoice for ${source.invoiceNumber}`
      : `Korrekturrechnung zu ${source.invoiceNumber}`;
    const combinedNotes = source.notes
      ? `${correctionLabel}\n\n${source.notes}`
      : correctionLabel;

    const invoiceNumber = await generateInvoiceNumber();
    const duplicatePaymentTerms = resolvePaymentTerms({
      issueDate: today,
      paymentTermCode: source.paymentTermCode,
      paymentTerms: source.paymentTerms,
      dueDate: source.dueDate,
      language: source.language,
    });

    const [newInvoice] = await db
      .insert(irocInvoices)
      .values({
        invoiceNumber,
        // Preserve the legacy reference when this source predates website
        // customers; otherwise the duplicated draft could not produce a
        // delivery note or invoice PDF.
        customerId:        source.customerId ?? null,
        websiteCustomerId: source.websiteCustomerId,
        invoiceType:       source.invoiceType,
        issueDate:         today,
        dueDate:           duplicatePaymentTerms.dueDate,
        orderNumber:       source.orderNumber ?? null,
        // referenceNumber points to the original invoice so it prints on the PDF
        referenceNumber:   source.invoiceNumber,
        buyerReference:    source.buyerReference,
        sellerVatId:       source.sellerVatId,
        buyerVatId:        source.buyerVatId,
        paymentTerms:      duplicatePaymentTerms.description,
        paymentTermCode:   duplicatePaymentTerms.paymentTermCode,
        isB2g:             source.isB2g ?? false,
        shippingMethod:    source.shippingMethod   ?? null,
        reasonForExport:   source.reasonForExport  ?? null,
        termsOfDelivery:   source.termsOfDelivery  ?? null,
        deliveryCosts:     source.deliveryCosts,
        subtotal:          source.subtotal,
        vatRate:           source.vatRate,
        vatAmount:         source.vatAmount,
        total:             source.total,
        status:            "draft",
        notes:             combinedNotes,
        vatNote:           source.vatNote ?? null,
        language:          source.language,
      })
      .returning();

    if (sourceItems.length > 0) {
      await db.insert(irocInvoiceItems).values(
        sourceItems.map(item => ({
          invoiceId:       newInvoice.id,
          productId:       item.productId,
          productName:     item.productName,
          sku:             item.sku             ?? null,
          description:     item.description     ?? null,
          lotNumber:       item.lotNumber       ?? null,
          hsCode:          item.hsCode          ?? null,
          countryOfOrigin: item.countryOfOrigin ?? null,
          weightKg:        item.weightKg        ?? null,
          discountPercent: item.discountPercent ?? null,
          vatRate:          item.vatRate,
          isDemo:          item.isDemo,
          unitPrice:       item.unitPrice,
          quantity:        item.quantity,
          lineTotal:       item.lineTotal,
        })),
      );
    }

    // Resolve customer for response shape
    let customerData: ReturnType<typeof wcToCustomerShape> | undefined;
    if (source.websiteCustomerId) {
      const [wc] = await db
        .select()
        .from(websiteCustomersTable)
        .where(eq(websiteCustomersTable.id, source.websiteCustomerId!));
      if (wc) customerData = wcToCustomerShape(wc);
    }

    const newItems = await db
      .select()
      .from(irocInvoiceItems)
      .where(eq(irocInvoiceItems.invoiceId, newInvoice.id));

    res.status(201).json({
      ...formatInvoiceRow(newInvoice),
      items: newItems.map(li => ({
        ...li,
        unitPrice: li.unitPrice.toString(),
        lineTotal: li.lineTotal.toString(),
      })),
      customer: customerData,
    });
  },
);

// ── Full invoice update (finalized invoices are immutable) ───────────────────
router.put(
  "/iroc/invoices/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));

    const [existing] = await db.select().from(irocInvoices).where(eq(irocInvoices.id, id));
    if (!existing) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (existing.correctionOfInvoiceId != null) { res.status(409).json({ error: "Invoice corrections are immutable after creation." }); return; }
    if (existing.status !== "draft") { res.status(409).json({ error: "Only draft invoices can be edited; sent, paid, and cancelled invoices are immutable." }); return; }

    const parsed = CreateIrocInvoiceBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid invoice data", details: parsed.error.issues }); return; }

    const {
      websiteCustomerId,
      invoiceType,
      issueDate,
      dueDate,
      orderNumber,
      referenceNumber,
      buyerReference,
      sellerVatId,
      buyerVatId,
      paymentTerms,
      paymentTermCode,
      isB2g = false,
      shippingMethod,
      reasonForExport,
      termsOfDelivery,
      deliveryCosts = "0",
      vatRate,
      notes,
      vatNote,
      language = "de",
      items,
    } = parsed.data;
    if (isB2g && !buyerReference?.trim()) {
      res.status(422).json({ error: "B2G invoices require a non-empty buyer reference (BT-10 / Leitweg-ID)." });
      return;
    }
    const resolvedPaymentTerms = resolvePaymentTerms({ issueDate, paymentTermCode, paymentTerms, dueDate, language });
    if (resolvedPaymentTerms.paymentTermCode === "custom" && !isValidInvoiceDate(resolvedPaymentTerms.dueDate)) {
      res.status(422).json({ error: "Custom payment terms require a valid due date (YYYY-MM-DD)." });
      return;
    }

    const [wc] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, websiteCustomerId));
    if (!wc) { res.status(400).json({ error: "Website customer not found" }); return; }

    let subtotal = 0;
    for (const item of items) {
      if (item.isDemo) continue;
      const disc = parseFloat(item.discountPercent?.toString() ?? "0") || 0;
      const base = parseFloat(item.unitPrice);
      subtotal += base * (1 - disc / 100) * item.quantity;
    }
    const delivery = parseFloat(deliveryCosts ?? "0");

    let effectiveVatRate = parseFloat(vatRate ?? "0");
    if (!vatRate) effectiveVatRate = invoiceType === "domestic" ? 19 : 0;
    if (effectiveVatRate > 0 && effectiveVatRate < 1) effectiveVatRate = effectiveVatRate * 100;
    // Round to 2 dp to eliminate floating-point imprecision (e.g. 0.07*100 = 7.000000000000001)
    effectiveVatRate = parseFloat(effectiveVatRate.toFixed(2));

    // Guard: 7 % reduced VAT rate is only legal for domestic (DE) invoices
    if (effectiveVatRate === 7 && invoiceType !== "domestic") {
      const status = ["eu", "noneu", "export"].includes(invoiceType) ? 422 : 400;
      res.status(status).json({
        error: "The 7 % reduced VAT rate is only permitted for domestic invoices. Set invoiceType to 'domestic' or use a different VAT rate.",
      });
      return;
    }

    // Guard: non-domestic invoice types must carry 0 % VAT.
    // Catches the case where an admin switches the type (e.g. domestic → EU) without
    // also resetting the VAT rate to 0 — the resulting combination is tax-invalid.
    const ZERO_VAT_TYPES_PUT = ["eu", "noneu", "export", "lecture-eu", "lecture-noneu"];
    if (ZERO_VAT_TYPES_PUT.includes(invoiceType) && effectiveVatRate !== 0) {
      const status = ["eu", "noneu", "export"].includes(invoiceType) ? 422 : 400;
      res.status(status).json({
        error: `Invoice type '${invoiceType}' requires a 0 % VAT rate. The saved VAT rate (${effectiveVatRate} %) is incompatible with this type.`,
      });
      return;
    }

    // Guard: domestic invoices must carry 7 % or 19 % VAT — never 0 %.
    if (invoiceType === "domestic" && effectiveVatRate === 0) {
      res.status(400).json({
        error: "Domestic invoices require a VAT rate of 7 % or 19 %. A 0 % rate is not permitted for domestic invoice type.",
      });
      return;
    }

    if (invoiceType === "eu" && /§\s*3a/i.test(vatNote ?? "")) {
      res.status(422).json({
        error: "An invoice with a §3a service/lecture VAT note must use invoiceType 'lecture-eu'. Choose 'lecture-eu' for teaching, consulting, or speaking services.",
      });
      return;
    }
    const lineVatCheck = normalizeAndValidateLineVatRates(
      invoiceType,
      effectiveVatRate,
      items.map(item => item.vatRate),
    );
    if ("error" in lineVatCheck) {
      res.status(422).json({ error: lineVatCheck.error });
      return;
    }
    const effectiveBuyerVatId = buyerVatId?.trim() || existing.buyerVatId?.trim() || wc.ustIdNr?.trim() || null;
    const effectiveSellerVatId = sellerVatId?.trim() || existing.sellerVatId?.trim() || CO.vatDe;
    if (["eu", "lecture-eu"].includes(invoiceType) && !effectiveBuyerVatId) {
      res.status(422).json({ error: "Buyer VAT ID is required for intra-community and reverse-charge invoices." });
      return;
    }

    // Shipment insurance is server-owned and not part of the general invoice-edit
    // payload. Preserve it when normal draft edits recalculate VAT and totals.
    const insuranceCosts = Number(existing.insuranceCosts ?? 0);
    const groupedTotals = calculateFacturXTotals(
      { invoiceType, vatRate: effectiveVatRate, deliveryCosts: delivery, insuranceCosts: Number.isFinite(insuranceCosts) ? insuranceCosts : 0 },
      items.map((item, index) => {
        const discount = parseFloat(item.discountPercent?.toString() ?? "0") || 0;
        const lineTotal = item.isDemo ? 0 : parseFloat(item.unitPrice) * (1 - discount / 100) * item.quantity;
        return { productName: item.productName, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal, vatRate: lineVatCheck.rates[index] };
      }),
    );
    const vatAmount = groupedTotals.taxTotalCents / 100;
    const total = groupedTotals.grandTotalCents / 100;

    const [invoice] = await db
      .update(irocInvoices)
      .set({
        websiteCustomerId,
        customerId: null,
        invoiceType,
        issueDate,
        dueDate: resolvedPaymentTerms.dueDate,
        orderNumber: orderNumber ?? null,
        referenceNumber: referenceNumber ?? null,
        buyerReference: buyerReference?.trim() || null,
        sellerVatId: effectiveSellerVatId,
        buyerVatId: effectiveBuyerVatId,
        paymentTerms: resolvedPaymentTerms.description,
        paymentTermCode: resolvedPaymentTerms.paymentTermCode,
        isB2g,
        shippingMethod: shippingMethod ?? null,
        reasonForExport: reasonForExport ?? null,
        termsOfDelivery: termsOfDelivery ?? null,
        deliveryCosts: delivery.toFixed(2),
        subtotal: subtotal.toFixed(2),
        vatRate: effectiveVatRate.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        total: total.toFixed(2),
        notes: notes ?? null,
        vatNote: vatNote ?? null,
        language,
        updatedAt: new Date(),
      })
      .where(eq(irocInvoices.id, id))
      .returning();

    // Replace all line items (no inventory re-adjustment on edit)
    await db.delete(irocInvoiceItems).where(eq(irocInvoiceItems.invoiceId, id));

    if (items.length > 0) {
      await db.insert(irocInvoiceItems).values(
        items.map((item, index) => {
          const isDemo = item.isDemo === true;
          const discPct = parseFloat(item.discountPercent?.toString() ?? "0") || 0;
          const base = parseFloat(item.unitPrice);
          const dPrice = isDemo ? 0 : base * (1 - discPct / 100);
          return {
            invoiceId: invoice.id,
            productId: item.productId ?? null,
            productName: item.productName,
            sku: item.sku ?? null,
            description: item.description ?? null,
            lotNumber: item.lotNumber ?? null,
            hsCode: item.hsCode ?? null,
            countryOfOrigin: item.countryOfOrigin ?? null,
            weightKg: item.weightKg ?? null,
            discountPercent: item.discountPercent ?? null,
            vatRate: lineVatCheck.rates[index].toFixed(2),
            isDemo,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            lineTotal: (dPrice * item.quantity).toFixed(2),
          };
        }),
      );
    }

    const updatedItems = await db.select().from(irocInvoiceItems).where(eq(irocInvoiceItems.invoiceId, id));
    const customerData = wcToCustomerShape(wc);

    res.json({
      ...formatInvoiceRow(invoice),
      items: updatedItems.map(li => ({
        id: li.id,
        invoiceId: li.invoiceId,
        productId: li.productId,
        productName: li.productName,
        sku: li.sku,
        description: li.description,
        lotNumber: li.lotNumber,
        hsCode: li.hsCode,
        countryOfOrigin: li.countryOfOrigin,
        weightKg: li.weightKg,
        unitPrice: li.unitPrice.toString(),
        discountPercent: li.discountPercent,
        isDemo: li.isDemo,
        quantity: li.quantity,
        lineTotal: li.lineTotal.toString(),
      })),
      customer: customerData,
    });
  },
);

router.patch(
  "/iroc/invoices/:id/status",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const parsed = UpdateIrocInvoiceStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    const newStatus = parsed.data.status;

    // Read current invoice so we know the old status before updating
    const [existing] = await db.select().from(irocInvoices).where(eq(irocInvoices.id, id));
    if (!existing) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    const oldStatus = existing.status;
    const isCorrection = existing.correctionOfInvoiceId != null;
    if (isCorrection) {
      try {
        const row = await db.transaction(async tx => {
          const locked = await tx.execute(sql`SELECT * FROM iroc_invoices WHERE id = ${id} FOR UPDATE`);
          const current = locked.rows[0] as typeof irocInvoices.$inferSelect | undefined;
          if (!current) throw new Error("Invoice not found");
          if (current.status !== "draft" && !["sent", "paid"].includes(newStatus)) {
            throw new Error("A finalized invoice correction cannot be reverted or cancelled because its returned inventory has been restored.");
          }
          const [updated] = await tx.update(irocInvoices).set({ status: newStatus, updatedAt: new Date() })
            .where(eq(irocInvoices.id, id)).returning();
          if (current.status === "draft" && ["sent", "paid"].includes(newStatus) && !current.inventoryRestoredAt) {
            // Status, idempotency marker, product/lot adjustments all belong to
            // this transaction. A failed lot/product update rolls back all of it.
            const acquired = await tx.update(irocInvoices).set({ inventoryRestoredAt: new Date() })
              .where(and(eq(irocInvoices.id, id), isNull(irocInvoices.inventoryRestoredAt)))
              .returning({ id: irocInvoices.id });
            if (acquired.length) {
              const items = await tx.select().from(irocInvoiceItems).where(eq(irocInvoiceItems.invoiceId, id));
              for (const item of items) {
                if (!item.productId) continue;
                await tx.update(irocProducts).set({
                  stockQuantity: sql`${irocProducts.stockQuantity} + ${item.quantity}`, updatedAt: new Date(),
                }).where(eq(irocProducts.id, item.productId));
                if (item.lotNumber) {
                  await tx.update(irocInventoryLots).set({
                    quantityUsed: sql`${irocInventoryLots.quantityUsed} - ${item.quantity}`, updatedAt: new Date(),
                  }).where(and(eq(irocInventoryLots.productId, item.productId), eq(irocInventoryLots.lotNumber, item.lotNumber)));
                }
              }
            }
          }
          return updated;
        });
        res.json(formatInvoiceRow(row));
      } catch (error) {
        res.status(error instanceof Error && error.message === "Invoice not found" ? 404 : 409)
          .json({ error: error instanceof Error ? error.message : "Unable to finalize invoice correction." });
      }
      return;
    }
    if (isCorrection && oldStatus !== "draft" && !["sent", "paid"].includes(newStatus)) {
      res.status(409).json({ error: "A finalized invoice correction cannot be reverted or cancelled because its returned inventory has been restored." });
      return;
    }

    const [row] = await db
      .update(irocInvoices)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(irocInvoices.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // ── Inventory adjustment on status transitions ────────────────────────────
    // Stock is deducted the first time an invoice leaves "draft" (→ sent or paid).
    // Stock is restored if an invoice is reverted from "sent" back to "draft".
    // sent → paid does NOT deduct again (already deducted at "sent").
    const DEDUCTED_STATUSES = ["sent", "paid"];
    const shouldDeduct  = !isCorrection && oldStatus === "draft" && DEDUCTED_STATUSES.includes(newStatus);
    // Restore stock when reverting to draft OR when cancelling a sent/paid invoice
    const shouldRestore = !isCorrection && DEDUCTED_STATUSES.includes(oldStatus) && (newStatus === "draft" || newStatus === "cancelled");

    // A correction restores returned inventory only once, on its first
    // finalization. The conditional update is the durable idempotency marker
    // across duplicate requests/retries and concurrent status changes.
    let shouldRestoreCorrection = false;
    if (isCorrection && oldStatus === "draft" && DEDUCTED_STATUSES.includes(newStatus)) {
      const restored = await db.update(irocInvoices)
        .set({ inventoryRestoredAt: new Date() })
        .where(and(eq(irocInvoices.id, id), isNull(irocInvoices.inventoryRestoredAt)))
        .returning({ id: irocInvoices.id });
      shouldRestoreCorrection = restored.length === 1;
    }

    if (shouldDeduct || shouldRestore || shouldRestoreCorrection) {
      const lineItems = await db
        .select()
        .from(irocInvoiceItems)
        .where(eq(irocInvoiceItems.invoiceId, id));

      for (const item of lineItems) {
        if (!item.productId) continue;
        const qty = item.quantity;

        const [updated] = await db
          .update(irocProducts)
          .set({
            stockQuantity: shouldDeduct
              ? sql`${irocProducts.stockQuantity} - ${qty}`
              : sql`${irocProducts.stockQuantity} + ${qty}`,
            updatedAt: new Date(),
          })
          .where(eq(irocProducts.id, item.productId))
          .returning();

        // Adjust the specific inventory lot if a lot number was recorded on the line item
        if (item.lotNumber) {
          const [updatedLot] = await db
            .update(irocInventoryLots)
            .set({
              quantityUsed: shouldDeduct
                ? sql`${irocInventoryLots.quantityUsed} + ${qty}`
                : sql`${irocInventoryLots.quantityUsed} - ${qty}`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(irocInventoryLots.productId, item.productId),
              eq(irocInventoryLots.lotNumber, item.lotNumber),
            ))
            .returning();

          if (updatedLot) {
            if (shouldDeduct && updatedLot.quantityUsed >= updatedLot.quantityReceived && !updatedLot.emptyAt) {
              // Mark lot as empty when it first hits zero
              await db.update(irocInventoryLots)
                .set({ emptyAt: new Date() })
                .where(eq(irocInventoryLots.id, updatedLot.id));
            } else if (shouldRestore && updatedLot.quantityUsed < updatedLot.quantityReceived && updatedLot.emptyAt) {
              // Clear emptyAt now that stock has been restored
              await db.update(irocInventoryLots)
                .set({ emptyAt: null })
                .where(eq(irocInventoryLots.id, updatedLot.id));
            }
          }
        }

        // Emit a low-stock notification only on deduction
        if (shouldDeduct && updated && updated.stockQuantity <= updated.lowStockThreshold) {
          await db.insert(irocNotifications).values({
            type: "low_stock",
            message: JSON.stringify({
              de: `Niedriger Lagerbestand: ${updated.nameDe} – ${updated.stockQuantity} Einheiten verbleibend`,
              en: `Low stock: ${updated.nameDe} — ${updated.stockQuantity} units remaining`,
            }),
            productId: updated.id,
          });
        }
      }
    }

    // Record the moment an invoice first becomes "sent" (used by payment-reminder cron)
    if (newStatus === "sent" && oldStatus !== "sent") {
      await pool.query(
        "UPDATE iroc_invoices SET sent_at = NOW() WHERE id = $1 AND sent_at IS NULL",
        [id],
      );
    }

    // ── Sally dispatch email on draft → sent ─────────────────────────────────
    // Queue a customer "on the way" email (admin approval required); the
    // invoice + delivery-note PDFs are attached at send time.
    if (oldStatus === "draft" && newStatus === "sent") {
      setImmediate(async () => {
        try {
          const { queueInvoiceDispatchEmail } = await import("../lib/sally-invoice.js");
          await queueInvoiceDispatchEmail(id);
        } catch (err) {
          console.error("Sally dispatch email queueing failed", err);
        }
      });
    }

    res.json(formatInvoiceRow(row));
  },
);

// ── Per-item updates (product link and customs fields) ─────────────────────────
router.patch(
  "/iroc/invoices/:id/items/:itemId",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const invoiceId = parseInt(String(req.params.id));
    const itemId    = parseInt(String(req.params.itemId));
    const body = req.body as {
      productId?: number | null;
      hsCode?: string | null;
      countryOfOrigin?: string | null;
      weightKg?: string | null;
    };
    const updates: {
      productId?: number | null;
      hsCode?: string | null;
      countryOfOrigin?: string | null;
      weightKg?: string | null;
    } = {};
    const [invoice] = await db.select({
      correctionOfInvoiceId: irocInvoices.correctionOfInvoiceId,
    }).from(irocInvoices).where(eq(irocInvoices.id, invoiceId));
    if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }
    if (invoice.correctionOfInvoiceId != null) {
      res.status(409).json({ error: "Invoice correction lines are immutable." });
      return;
    }

    if ("productId" in body) {
      const productId = body.productId ?? null;
      if (productId !== null && (!Number.isInteger(productId) || productId <= 0)) {
        res.status(400).json({ error: "Invalid product ID" });
        return;
      }
      if (productId !== null) {
        const [product] = await db
          .select({ id: irocProducts.id })
          .from(irocProducts)
          .where(eq(irocProducts.id, productId));
        if (!product) {
          res.status(404).json({ error: "Product not found" });
          return;
        }
      }
      updates.productId = productId;
    }
    if ("hsCode" in body) updates.hsCode = body.hsCode ?? null;
    if ("countryOfOrigin" in body) updates.countryOfOrigin = body.countryOfOrigin ?? null;
    if ("weightKg" in body) updates.weightKg = body.weightKg ?? null;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No item fields provided" });
      return;
    }

    const [updated] = await db
      .update(irocInvoiceItems)
      .set(updates)
      .where(and(eq(irocInvoiceItems.id, itemId), eq(irocInvoiceItems.invoiceId, invoiceId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    res.json({
      id:              updated.id,
      productId:       updated.productId,
      hsCode:          updated.hsCode,
      countryOfOrigin: updated.countryOfOrigin,
      weightKg:        updated.weightKg,
    });
  },
);

// ── PDF generation ────────────────────────────────────────────────────────────
export class InvoiceComplianceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceComplianceValidationError";
  }
}

export class InvoicePdfPostProcessingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvoicePdfPostProcessingError";
  }
}

async function resolveInvoiceItemDescriptions(
  row: typeof irocInvoices.$inferSelect,
  items: (typeof irocInvoiceItems.$inferSelect)[],
): Promise<(typeof irocInvoiceItems.$inferSelect)[]> {
  const productIds = [...new Set(items
    .filter(item => !item.description?.trim() && item.productId != null)
    .map(item => item.productId as number))];
  if (productIds.length === 0) return items;

  const products = await db
    .select({
      id: irocProducts.id,
      descriptionEn: irocProducts.descriptionEn,
      descriptionDe: irocProducts.descriptionDe,
    })
    .from(irocProducts)
    .where(inArray(irocProducts.id, productIds));
  const localizedByProductId = new Map(products.map(product => [
    product.id,
    row.language === "en" ? product.descriptionEn : product.descriptionDe,
  ]));

  return items.map(item => {
    if (item.description?.trim() || item.productId == null) return item;
    const description = localizedByProductId.get(item.productId)?.trim();
    return description ? { ...item, description } : item;
  });
}

/**
 * Renderer tests use deliberately non-PDF PDFKit stream spies so they can
 * inspect drawing calls. This seam must never permit visual-only output in a
 * deployed runtime.
 */
function isLightweightPdfKitTestDouble(output: Buffer): boolean {
  return process.env.NODE_ENV === "test" && !output.subarray(0, 5).equals(Buffer.from("%PDF-"));
}

/**
 * Render an official invoice as a Factur-X/EN 16931 hybrid PDF.
 *
 * Quotes and delivery notes intentionally use their visual renderers instead:
 * they are not invoices and must not carry an EN 16931 payload.
 */
export async function renderHybridInvoicePdf(
  row: typeof irocInvoices.$inferSelect,
  customer: PdfCustomer | undefined,
  items: (typeof irocInvoiceItems.$inferSelect)[],
  contact?: InvoiceContactSettings,
): Promise<Buffer> {
  const resolvedItems = await resolveInvoiceItemDescriptions(row, items);
  // Validate the EN 16931 payload before rendering the visible document. Apart
  // from avoiding wasted renderer work, this ensures malformed persisted values
  // (notably an invalid line VAT rate) have the same typed validation outcome as
  // failures raised while Factur-X is embedded below.
  try {
    buildFacturXInvoiceInput(row, (customer ?? {}) as any, resolvedItems);
  } catch (error) {
    throw new InvoiceComplianceValidationError(
      error instanceof Error ? error.message : "Unable to generate compliant invoice",
    );
  }
  const resolvedContact = contact ?? await getInvoiceContactSettings();

  const visualPdf = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 36, bottom: 10, left: 42, right: 42 },
      autoFirstPage: true,
      bufferPages: true,
      font: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    });
    if (typeof doc.registerFont === "function") {
      doc.registerFont("Helvetica", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
      doc.registerFont("Helvetica-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
      doc.registerFont("Helvetica-Oblique", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf");
    }
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    buildInvoicePDF(doc, row, customer, resolvedItems, { contact: resolvedContact });
    const watermark = row.status === "draft"
      ? { text: row.language === "en" ? "DRAFT" : "ENTWURF", color: "#aaaaaa", opacity: 0.22 }
      : row.status === "cancelled"
        ? { text: row.language === "en" ? "CANCELLED" : "STORNIERT", color: "#cc2222", opacity: 0.18 }
        : null;
    if (watermark) {
      const { start, count } = doc.bufferedPageRange();
      for (let i = 0; i < count; i++) {
        doc.switchToPage(start + i);
        renderPdfWatermark(doc, watermark.text, watermark.color, watermark.opacity);
      }
    }
    doc.flushPages();
    doc.end();
  });
  if (!visualPdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    if (isLightweightPdfKitTestDouble(visualPdf)) return visualPdf;
    throw new InvoicePdfPostProcessingError(
      "Unable to generate invoice: the visual renderer produced an invalid PDF",
    );
  }
  try {
    await PdfLibDocument.load(visualPdf);
  } catch (error) {
    throw new InvoicePdfPostProcessingError(
      "Unable to generate invoice: PDF post-processing could not parse the rendered document",
      { cause: error },
    );
  }
  try {
    // Embed the same resolved item records that were used for the visible PDF.
    // In particular, productName is the saved customer-facing value and must
    // never be replaced by a localized catalog name during PDF generation.
    return await embedFacturXInvoice(visualPdf, row, (customer ?? {}) as any, resolvedItems);
  } catch (error) {
    // Filesystem and renderer/runtime failures are operational failures, not
    // invoice data errors.  Keep them distinguishable so callers can retain
    // their normal 500 handling.
    if (typeof error === "object" && error !== null && "code" in error) {
      throw error;
    }
    throw new InvoiceComplianceValidationError(
      error instanceof Error ? error.message : "Unable to generate compliant invoice",
    );
  }
}

router.get(
  "/iroc/invoices/:id/pdf",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [row] = await db.select().from(irocInvoices).where(eq(irocInvoices.id, id));
    if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }

    // Corrections are rendered exclusively from the immutable buyer snapshot.
    // Ordinary invoices continue to resolve their live customer.
    let customer: typeof irocCustomers.$inferSelect | undefined;
    if (row.correctionOfInvoiceId != null) {
      customer = row.customerSnapshot && typeof row.customerSnapshot === "object"
        ? row.customerSnapshot as typeof irocCustomers.$inferSelect
        : undefined;
    } else if (row.websiteCustomerId) {
      const [wc] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, row.websiteCustomerId));
      if (wc) customer = wcToCustomerShape(wc) as typeof irocCustomers.$inferSelect;
    }
    if (row.correctionOfInvoiceId == null && !customer && row.customerId) {
      [customer] = await db.select().from(irocCustomers).where(eq(irocCustomers.id, row.customerId));
    }

    const items = await db.select().from(irocInvoiceItems).where(eq(irocInvoiceItems.invoiceId, id));

    // Allow per-generation overrides (passed as query params)
    const pdfRow = { ...row } as typeof row & { termsOfDelivery?: string | null };
    if (req.query.reasonForExport) pdfRow.reasonForExport = req.query.reasonForExport as string;
    if (req.query.shippingMethod)  pdfRow.shippingMethod  = req.query.shippingMethod  as string;
    if (req.query.termsOfDelivery) pdfRow.termsOfDelivery = req.query.termsOfDelivery as string;
    // "standard" format: render as a normal DE/EN invoice (0 % VAT, export footnote) instead of Commercial Invoice
    if (req.query.invoiceFormat === "standard") pdfRow.invoiceType = "noneu";

    let pdf: Buffer;
    try {
      pdf = await renderHybridInvoicePdf(pdfRow, customer, items);
    } catch (error) {
      req.log.error({ err: error, invoiceId: id }, "Unable to generate EN 16931 invoice");
      const complianceError = error instanceof InvoiceComplianceValidationError;
      res.status(complianceError ? 422 : 500).json({
        error: error instanceof Error
          ? error.message
          : complianceError
            ? "Unable to generate compliant invoice"
            : "Unable to render invoice",
      });
      return;
    }
    // Invoice PDFs are rendered from the current template on every request.
    // Prevent browsers and proxies from serving an older PDF for a past invoice.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${row.invoiceNumber}.pdf"`);
    res.end(pdf);
  },
);

// ── Offer PDF (non-binding quote — never persisted) ──────────────────────────
// Renders an invoice-style PDF from the posted payload without saving anything:
// no invoice number is consumed, no DB rows are written, the reorder code is
// suppressed and a watermark marks the document as a non-binding offer.
router.post(
  "/iroc/invoices/offer-pdf",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const parsed = CreateIrocInvoiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid offer data" });
      return;
    }
    const {
      websiteCustomerId,
      invoiceType,
      issueDate,
      dueDate,
      orderNumber,
      referenceNumber,
      shippingMethod,
      reasonForExport,
      termsOfDelivery,
      deliveryCosts = "0",
      vatRate,
      notes,
      vatNote,
      language = "de",
      items,
    } = parsed.data;

    const lineItemError = validateOfferLineItems(items);
    if (lineItemError) {
      res.status(400).json({ error: lineItemError });
      return;
    }
    const deliveryCostsError = validateOfferDeliveryCosts(deliveryCosts);
    if (deliveryCostsError) {
      res.status(400).json({ error: deliveryCostsError });
      return;
    }

    const [wc] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, websiteCustomerId));
    if (!wc) {
      res.status(400).json({ error: "Website customer not found" });
      return;
    }

    // Totals — same math as invoice creation
    let subtotal = 0;
    for (const item of items) {
      if (item.isDemo) continue;
      const disc = parseFloat(item.discountPercent?.toString() ?? "0") || 0;
      const base = parseFloat(item.unitPrice);
      subtotal += base * (1 - disc / 100) * item.quantity;
    }
    const delivery = parseFloat(deliveryCosts ?? "0");
    const vatCheck = normalizeAndValidateVat(invoiceType, vatRate, vatNote);
    if ("error" in vatCheck) {
      res.status(400).json({ error: vatCheck.error });
      return;
    }
    const effectiveVatRate = vatCheck.rate;
    const vatAmount = ((subtotal + delivery) * effectiveVatRate) / 100;
    const total = subtotal + delivery + vatAmount;

    const now = new Date();
    const offerRow = {
      id: 0,
      invoiceNumber: "",
      customerId: null,
      websiteCustomerId,
      invoiceType,
      issueDate,
      dueDate: dueDate ?? null,
      orderNumber: orderNumber ?? null,
      referenceNumber: referenceNumber ?? null,
      shippingMethod: shippingMethod ?? null,
      reasonForExport: reasonForExport ?? null,
      termsOfDelivery: termsOfDelivery ?? null,
      deliveryCosts: delivery.toFixed(2),
      subtotal: subtotal.toFixed(2),
      vatRate: effectiveVatRate.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      total: total.toFixed(2),
      status: "draft",
      notes: notes ?? null,
      vatNote: vatNote ?? null,
      language,
      createdAt: now,
      updatedAt: now,
    } as unknown as typeof irocInvoices.$inferSelect;

    const offerItems = items.map((item, idx) => {
      const isDemo  = item.isDemo === true;
      const discPct = parseFloat(item.discountPercent?.toString() ?? "0") || 0;
      const base    = parseFloat(item.unitPrice);
      const dPrice  = isDemo ? 0 : base * (1 - discPct / 100);
      return {
        id: idx + 1,
        invoiceId: 0,
        productId: item.productId ?? null,
        productName: item.productName,
        sku: item.sku ?? null,
        description: item.description ?? null,
        lotNumber: item.lotNumber ?? null,
        hsCode: item.hsCode ?? null,
        countryOfOrigin: item.countryOfOrigin ?? null,
        weightKg: item.weightKg ?? null,
        discountPercent: item.discountPercent ?? null,
        isDemo,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: (dPrice * item.quantity).toFixed(2),
      } as unknown as typeof irocInvoiceItems.$inferSelect;
    });

    // Customer without the personal reorder code or customer number (offers must not reveal these)
    const customer = { ...wcToCustomerShape(wc), reorderCode: null, customerNr: null };
    const contact = await getInvoiceContactSettings();

    // bufferPages keeps every page in memory so we can revisit them after all
    // content is drawn and paint the watermark on the top layer.
    const doc = new PDFDocument({ size: "A4", margins: { top: 36, bottom: 10, left: 42, right: 42 }, autoFirstPage: true, bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    const offerName = language === "en" ? "Offer" : "Angebot";
    res.setHeader("Content-Disposition", `attachment; filename="${offerName}_${issueDate}.pdf"`);
    doc.pipe(res);

    buildInvoicePDF(doc, offerRow, customer, offerItems, { offer: true, contact });

    // ── Watermark on top layer — paint AFTER content so it is the topmost element ──
    const wmText = language === "en" ? "NON-BINDING OFFER" : "UNVERBINDLICHES ANGEBOT";
    const { start, count } = doc.bufferedPageRange();
    for (let i = 0; i < count; i++) {
      doc.switchToPage(start + i);
      renderPdfWatermark(doc, wmText, "#aaaaaa", 0.22);
    }

    doc.flushPages();
    doc.end();
  },
);

// ── Lead training offer PDF (immutable snapshot) ─────────────────────────────
// This route deliberately has no websiteCustomerId input: an offer is made to a
// lead before payment, and only Registered → Qualified creates an invoiceable
// website customer.
router.post(
  "/iroc/leads/:id/training-offer-pdf",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const params = CreateLeadTrainingOfferPdfParams.safeParse(req.params);
    const parsed = CreateLeadTrainingOfferPdfBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Invalid training offer data" });
      return;
    }

    const leadId = params.data.id;
    const data = parsed.data;
    const [lead] = await db.select().from(irocLeads).where(eq(irocLeads.id, leadId));
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
    if (!lead.email?.trim()) {
      res.status(422).json({ error: "Lead has no email address — cannot create a training offer." });
      return;
    }
    if (lead.status === "qualified" || lead.status === "converted") {
      res.status(409).json({ error: "A qualified or converted lead cannot receive a new training offer." });
      return;
    }
    const [existingOffer] = await db
      .select({ id: irocTrainingOffers.id })
      .from(irocTrainingOffers)
      .where(eq(irocTrainingOffers.leadId, leadId));
    if (existingOffer) {
      res.status(409).json({ error: "This lead already has a saved training offer." });
      return;
    }

    const language = data.language ?? "de";
    const delivery = parseFloat(data.deliveryCosts ?? "0");
    if (!Number.isFinite(delivery)) {
      res.status(400).json({ error: "Delivery costs must be numeric." });
      return;
    }
    const vatCheck = normalizeAndValidateVat(data.invoiceType, data.vatRate, data.vatNote);
    if ("error" in vatCheck) {
      res.status(400).json({ error: vatCheck.error });
      return;
    }
    const lineVatCheck = normalizeAndValidateLineVatRates(
      data.invoiceType,
      vatCheck.rate,
      data.items.map(item => item.vatRate),
    );
    if ("error" in lineVatCheck) {
      res.status(422).json({ error: lineVatCheck.error });
      return;
    }
    let subtotal = 0;
    for (const item of data.items) {
      if (item.isDemo) continue;
      const discount = parseFloat(item.discountPercent ?? "0") || 0;
      subtotal += parseFloat(item.unitPrice) * (1 - discount / 100) * item.quantity;
    }
    const vatAmount = ((subtotal + delivery) * vatCheck.rate) / 100;
    const now = new Date();
    const offerCustomer = leadOfferCustomer(lead);
    const offerRow = {
      id: 0,
      invoiceNumber: "",
      customerId: null,
      websiteCustomerId: null,
      invoiceType: data.invoiceType,
      issueDate: data.issueDate,
      dueDate: data.dueDate ?? null,
      orderNumber: data.orderNumber ?? null,
      referenceNumber: data.referenceNumber ?? null,
      shippingMethod: data.shippingMethod ?? null,
      reasonForExport: data.reasonForExport ?? null,
      termsOfDelivery: data.termsOfDelivery ?? null,
      deliveryCosts: delivery.toFixed(2),
      subtotal: subtotal.toFixed(2),
      vatRate: vatCheck.rate.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      total: (subtotal + delivery + vatAmount).toFixed(2),
      status: "draft",
      notes: decorateTrainingNotes(data.notes, data.trainingDate, language),
      vatNote: data.vatNote ?? null,
      language,
      createdAt: now,
      updatedAt: now,
    } as unknown as typeof irocInvoices.$inferSelect;
    const offerItems = data.items.map((item, index) => {
      const isDemo = item.isDemo === true;
      const discount = parseFloat(item.discountPercent ?? "0") || 0;
      const discountedUnitPrice = isDemo ? 0 : parseFloat(item.unitPrice) * (1 - discount / 100);
      return {
        id: index + 1,
        invoiceId: 0,
        productId: item.productId ?? null,
        productName: item.productName,
        sku: item.sku ?? null,
        description: item.description ?? null,
        lotNumber: item.lotNumber ?? null,
        hsCode: item.hsCode ?? null,
        countryOfOrigin: item.countryOfOrigin ?? null,
        weightKg: item.weightKg ?? null,
        discountPercent: item.discountPercent ?? null,
        isDemo,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: (discountedUnitPrice * item.quantity).toFixed(2),
      } as unknown as typeof irocInvoiceItems.$inferSelect;
    });

    const contact = await getInvoiceContactSettings();
    // Build the PDF first. A lead is not marked Registered until generation has
    // completed and the immutable offer snapshot can be safely persisted.
    const doc = new PDFDocument({ size: "A4", margins: { top: 36, bottom: 10, left: 42, right: 42 }, autoFirstPage: true, bufferPages: true });
    const chunks: Buffer[] = [];
    const pdf = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    buildInvoicePDF(doc, offerRow, offerCustomer, offerItems, { offer: true, contact });
    const watermark = language === "en" ? "NON-BINDING OFFER" : "UNVERBINDLICHES ANGEBOT";
    const { start, count: pageCount } = doc.bufferedPageRange();
    for (let page = 0; page < pageCount; page++) {
      doc.switchToPage(start + page);
      renderPdfWatermark(doc, watermark, "#aaaaaa", 0.22);
    }
    doc.flushPages();
    doc.end();

    let document: Buffer;
    try {
      document = await pdf;
    } catch {
      res.status(500).json({ error: "Could not generate the training offer PDF." });
      return;
    }

    try {
      await db.transaction(async (tx) => {
        const [currentLead] = await tx.select().from(irocLeads).where(eq(irocLeads.id, leadId));
        if (!currentLead || currentLead.status === "qualified" || currentLead.status === "converted") {
          throw new TrainingQualificationError("Lead status changed before the offer could be saved.");
        }
        const [savedOffer] = await tx
          .insert(irocTrainingOffers)
          .values({
            leadId,
            invoiceType: data.invoiceType,
            language,
            issueDate: data.issueDate,
            dueDate: data.dueDate ?? null,
            trainingDate: data.trainingDate ?? null,
            orderNumber: data.orderNumber ?? null,
            referenceNumber: data.referenceNumber ?? null,
            shippingMethod: data.shippingMethod ?? null,
            reasonForExport: data.reasonForExport ?? null,
            termsOfDelivery: data.termsOfDelivery ?? null,
            deliveryCosts: delivery.toFixed(2),
            vatRate: vatCheck.rate.toFixed(2),
            notes: data.notes ?? null,
            vatNote: data.vatNote ?? null,
            itemsSnapshot: JSON.stringify(data.items),
            customerSnapshot: JSON.stringify(offerCustomer),
          })
          .onConflictDoNothing()
          .returning({ id: irocTrainingOffers.id });
        if (!savedOffer) throw new TrainingQualificationError("This lead already has a saved training offer.");
        await tx
          .update(irocLeads)
          .set({ status: "registered", updatedAt: new Date() })
          .where(eq(irocLeads.id, leadId));
      });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : "Could not save training offer." });
      return;
    }

    const offerName = language === "en" ? "Offer" : "Angebot";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${offerName}_${data.issueDate}.pdf"`);
    res.end(document);
  },
);

router.get(
  "/iroc/leads/:id/training-offer-pdf",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const params = CreateLeadTrainingOfferPdfParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid lead id" });
      return;
    }

    const leadId = params.data.id;
    const [savedOffer] = await db
      .select()
      .from(irocTrainingOffers)
      .where(eq(irocTrainingOffers.leadId, leadId));
    if (!savedOffer) {
      res.status(404).json({ error: "Saved training offer not found." });
      return;
    }

    let items: unknown;
    try {
      items = JSON.parse(savedOffer.itemsSnapshot);
    } catch {
      res.status(500).json({ error: "Saved training offer items are invalid." });
      return;
    }
    const parsedItems = CreateLeadTrainingOfferPdfBody.shape.items.safeParse(items);
    if (!parsedItems.success) {
      res.status(500).json({ error: "Saved training offer items are invalid." });
      return;
    }

    if (!savedOffer.customerSnapshot) {
      res.status(422).json({ error: "Saved training offer is missing its immutable customer snapshot." });
      return;
    }
    let customerData: unknown;
    try {
      customerData = JSON.parse(savedOffer.customerSnapshot);
    } catch {
      res.status(500).json({ error: "Saved training offer customer details are invalid." });
      return;
    }
    const customer = parseTrainingOfferCustomerSnapshot(customerData);
    if (!customer) {
      res.status(500).json({ error: "Saved training offer customer details are invalid." });
      return;
    }

    const language = savedOffer.language === "en" ? "en" : "de";
    const delivery = Number(savedOffer.deliveryCosts);
    if (!Number.isFinite(delivery)) {
      res.status(500).json({ error: "Saved training offer delivery costs are invalid." });
      return;
    }
    const vatRate = Number(savedOffer.vatRate);
    if (!Number.isFinite(vatRate)) {
      res.status(500).json({ error: "Saved training offer VAT rate is invalid." });
      return;
    }
    for (const [index, item] of parsedItems.data.entries()) {
      // A stored per-line override can originate from a historical/corrupted
      // snapshot, so validate it again before it can re-enter a downloaded PDF
      // or a subsequent invoice workflow.
      if (item.vatRate !== undefined && !Number.isFinite(Number(item.vatRate))) {
        res.status(500).json({
          error: `Saved training offer item ${index + 1} VAT rate is invalid.`,
        });
        return;
      }
    }
    const subtotal = parsedItems.data.reduce((sum, item) => {
      if (item.isDemo) return sum;
      const discount = parseFloat(item.discountPercent ?? "0") || 0;
      return sum + parseFloat(item.unitPrice) * (1 - discount / 100) * item.quantity;
    }, 0);
    const vatAmount = ((subtotal + delivery) * vatRate) / 100;
    const offerRow = {
      id: 0,
      invoiceNumber: "",
      customerId: null,
      websiteCustomerId: null,
      invoiceType: savedOffer.invoiceType,
      issueDate: savedOffer.issueDate,
      dueDate: savedOffer.dueDate,
      orderNumber: savedOffer.orderNumber,
      referenceNumber: savedOffer.referenceNumber,
      shippingMethod: savedOffer.shippingMethod,
      reasonForExport: savedOffer.reasonForExport,
      termsOfDelivery: savedOffer.termsOfDelivery,
      deliveryCosts: delivery.toFixed(2),
      subtotal: subtotal.toFixed(2),
      vatRate: vatRate.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      total: (subtotal + delivery + vatAmount).toFixed(2),
      status: "draft",
      notes: decorateTrainingNotes(savedOffer.notes, savedOffer.trainingDate, language),
      vatNote: savedOffer.vatNote,
      language,
      createdAt: savedOffer.createdAt,
      updatedAt: savedOffer.createdAt,
    } as unknown as typeof irocInvoices.$inferSelect;
    const offerItems = parsedItems.data.map((item, index) => {
      const isDemo = item.isDemo === true;
      const discount = parseFloat(item.discountPercent ?? "0") || 0;
      const discountedUnitPrice = isDemo ? 0 : parseFloat(item.unitPrice) * (1 - discount / 100);
      return {
        id: index + 1,
        invoiceId: 0,
        productId: item.productId ?? null,
        productName: item.productName,
        sku: item.sku ?? null,
        description: item.description ?? null,
        lotNumber: item.lotNumber ?? null,
        hsCode: item.hsCode ?? null,
        countryOfOrigin: item.countryOfOrigin ?? null,
        weightKg: item.weightKg ?? null,
        discountPercent: item.discountPercent ?? null,
        isDemo,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: (discountedUnitPrice * item.quantity).toFixed(2),
      } as unknown as typeof irocInvoiceItems.$inferSelect;
    });

    const contact = await getInvoiceContactSettings();
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 36, bottom: 10, left: 42, right: 42 },
      autoFirstPage: true,
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    const pdf = new Promise<Buffer>((resolve, reject) => {
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });
    buildInvoicePDF(doc, offerRow, customer, offerItems, { offer: true, contact });
    const watermark = language === "en" ? "NON-BINDING OFFER" : "UNVERBINDLICHES ANGEBOT";
    const { start, count: pageCount } = doc.bufferedPageRange();
    for (let page = 0; page < pageCount; page++) {
      doc.switchToPage(start + page);
      const width = doc.page.width;
      const height = doc.page.height;
      doc.save()
        .rotate(PDF_WATERMARK_ANGLE, { origin: [width / 2, height / 2] })
        .font("Helvetica-Bold").fontSize(52).fillColor("#aaaaaa").opacity(0.22)
        .text(watermark, 0, height / 2 - 36, { width, align: "center", lineBreak: false })
        .opacity(1)
        .restore();
    }
    doc.flushPages();
    doc.end();

    try {
      const document = await pdf;
      const offerName = language === "en" ? "Offer" : "Angebot";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${offerName}_${savedOffer.issueDate}.pdf"`);
      res.end(document);
    } catch {
      res.status(500).json({ error: "Could not generate the training offer PDF." });
    }
  },
);

router.get(
  "/iroc/training-offers/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const params = GetIrocTrainingOfferParams.safeParse(req.params);
    if (!params.success) { res.status(400).json({ error: "Invalid offer id" }); return; }
    const [offer] = await db
      .select()
      .from(irocTrainingOffers)
      .where(eq(irocTrainingOffers.id, params.data.id));
    if (!offer?.websiteCustomerId) {
      res.status(404).json({ error: "Saved training offer not found or not yet qualified." });
      return;
    }
    let items: unknown;
    try {
      items = JSON.parse(offer.itemsSnapshot);
    } catch {
      res.status(500).json({ error: "Saved training offer items are invalid." });
      return;
    }
    const vatError = validateSavedTrainingOfferVat(offer.invoiceType, offer.vatRate, items);
    if (vatError) {
      res.status(422).json({ error: vatError });
      return;
    }
    res.json({
      id: offer.id,
      leadId: offer.leadId,
      websiteCustomerId: offer.websiteCustomerId,
      invoiceType: offer.invoiceType,
      language: offer.language,
      issueDate: offer.issueDate,
      dueDate: offer.dueDate,
      trainingDate: offer.trainingDate,
      orderNumber: offer.orderNumber,
      referenceNumber: offer.referenceNumber,
      shippingMethod: offer.shippingMethod,
      reasonForExport: offer.reasonForExport,
      termsOfDelivery: offer.termsOfDelivery,
      deliveryCosts: offer.deliveryCosts.toString(),
      vatRate: offer.vatRate.toString(),
      vatNote: offer.vatNote,
      notes: offer.notes,
      items,
    });
  },
);

// ── Invoice Email (PDF as attachment) ─────────────────────────────────────────
router.post(
  "/iroc/invoices/:id/email",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [row] = await db.select().from(irocInvoices).where(eq(irocInvoices.id, id));
    if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }

    const { to, subject, body } = req.body;
    if (!to || !subject || !body) {
      res.status(400).json({ error: "to, subject, body are required" }); return;
    }

    let customer: typeof irocCustomers.$inferSelect | undefined;
    if (row.correctionOfInvoiceId != null) {
      customer = row.customerSnapshot && typeof row.customerSnapshot === "object"
        ? row.customerSnapshot as typeof irocCustomers.$inferSelect
        : undefined;
    } else if (row.websiteCustomerId) {
      const [wc] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, row.websiteCustomerId));
      if (wc) customer = wcToCustomerShape(wc) as typeof irocCustomers.$inferSelect;
    }
    if (row.correctionOfInvoiceId == null && !customer && row.customerId) {
      [customer] = await db.select().from(irocCustomers).where(eq(irocCustomers.id, row.customerId));
    }

    const items = await db.select().from(irocInvoiceItems).where(eq(irocInvoiceItems.invoiceId, id));

    if (!customer) {
      res.status(422).json({ error: "A complete customer is required for an EN 16931 invoice" });
      return;
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderHybridInvoicePdf(row, customer, items);
    } catch (err) {
      req.log.error({ err, invoiceId: id }, "Unable to generate EN 16931 invoice attachment");
      const complianceError = err instanceof InvoiceComplianceValidationError;
      res.status(complianceError ? 422 : 500).json({
        error: err instanceof Error
          ? err.message
          : complianceError ? "Unable to generate compliant invoice" : "Unable to render invoice attachment",
      });
      return;
    }

    try {
      await sendEmail({
        to,
        subject,
        text: await appendImpressumSignature(body, recipientLanguageForCountry(customer.country)),
        attachments: [{ filename: `${row.invoiceNumber}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
        signatureGroup: "admin",
        signatureLanguage: recipientLanguageForCountry(customer.country),
        mailboxPurpose: "invoice",
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Send failed" });
    }
  },
);

// ── Delivery Note PDF ─────────────────────────────────────────────────────────
router.get(
  "/iroc/invoices/:id/delivery-note",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [row] = await db.select().from(irocInvoices).where(eq(irocInvoices.id, id));
    if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }

    let customer: typeof irocCustomers.$inferSelect | undefined;
    let shippingInfo: ShippingInfo | undefined;
    if (row.websiteCustomerId) {
      const [wc] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, row.websiteCustomerId));
      if (wc) {
        customer = wcToCustomerShape(wc) as typeof irocCustomers.$inferSelect;
        // Use shipping address on delivery note if it differs from billing
        shippingInfo = wcToShippingInfo(wc);
      }
    }
    if (!customer && row.customerId) {
      [customer] = await db.select().from(irocCustomers).where(eq(irocCustomers.id, row.customerId));
    }
    if (!customer) {
      res.status(400).json({ error: "Customer reference is required" });
      return;
    }
    // A resolved reference alone is not enough for a usable delivery note.
    // Reject partially migrated/damaged customer records before looking up line
    // items or opening the renderer, rather than emitting an incomplete address.
    if (!customer.name?.trim() || !customer.address?.trim() || !customer.postalCode?.trim() || !customer.city?.trim() || !customer.country?.trim()) {
      res.status(400).json({
        error: "Customer record is incomplete / Kundendatensatz ist unvollständig.",
      });
      return;
    }

    const items = await db.select().from(irocInvoiceItems).where(eq(irocInvoiceItems.invoiceId, id));

    // bufferPages keeps every page in memory so we can revisit them after all
    // content is drawn and stamp the header on the top layer of each page.
    const doc = new PDFDocument({ size: "A4", margins: { top: 36, bottom: 10, left: 42, right: 42 }, autoFirstPage: true, bufferPages: true });
    const dnFilename = `LS-${row.invoiceNumber}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${dnFilename}"`);
    doc.pipe(res);

    buildDeliveryNotePDF(doc, row, customer, items, shippingInfo);

    // ── Stamp on every page — paint AFTER content so it sits on the top layer ──
    const { start, count } = doc.bufferedPageRange();
    for (let i = 0; i < count; i++) {
      doc.switchToPage(start + i);
      renderPdfWatermark(doc, "LIEFERSCHEIN", "#002244", 0.07);
    }

    doc.flushPages();
    doc.end();
  },
);

// ── Pending payment reminders for an invoice ──────────────────────────────────
router.get(
  "/iroc/invoices/:id/pending-reminders",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { rows } = await pool.query<{
      id: number;
      recipient_email: string;
      subject: string;
      created_at: string;
      status: string;
    }>(
      `SELECT id, recipient_email, subject, created_at, status
       FROM sally_email_queue
       WHERE related_invoice_id = $1
         AND trigger_type = 'payment_reminder'
         AND status = 'pending'
       ORDER BY created_at DESC`,
      [id],
    );
    res.json(rows);
  },
);

// ── Toggle reminder suppression for an invoice ────────────────────────────────
router.patch(
  "/iroc/invoices/:id/reminder-suppressed",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { suppressed } = req.body as { suppressed?: boolean };
    if (typeof suppressed !== "boolean") {
      res.status(400).json({ error: "suppressed must be a boolean" });
      return;
    }

    const [updated] = await db
      .update(irocInvoices)
      .set({ reminderSuppressed: suppressed, updatedAt: new Date() })
      .where(eq(irocInvoices.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Invoice not found" }); return; }
    res.json({ id: updated.id, reminderSuppressed: updated.reminderSuppressed });
  },
);

// ── Notifications ─────────────────────────────────────────────────────────────
router.get(
  "/iroc/notifications",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(irocNotifications)
      .orderBy(desc(irocNotifications.createdAt));
    res.json(
      rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    );
  },
);

router.post(
  "/iroc/notifications/read-all",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    await db
      .update(irocNotifications)
      .set({ isRead: true })
      .where(eq(irocNotifications.isRead, false));
    res.json({ message: "All notifications marked as read" });
  },
);

router.post(
  "/iroc/notifications/read-by-type",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { type } = req.body as { type?: string };
    if (!type) {
      res.status(400).json({ error: "type is required" });
      return;
    }
    await db
      .update(irocNotifications)
      .set({ isRead: true })
      .where(and(eq(irocNotifications.isRead, false), eq(irocNotifications.type, type)));
    res.json({ message: `Notifications of type '${type}' marked as read` });
  },
);

router.patch(
  "/iroc/notifications/:id/read",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [row] = await db
      .update(irocNotifications)
      .set({ isRead: true })
      .where(eq(irocNotifications.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ ...row, createdAt: row.createdAt.toISOString() });
  },
);

router.delete(
  "/iroc/notifications/read",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const deleted = await db
      .delete(irocNotifications)
      .where(eq(irocNotifications.isRead, true))
      .returning({ id: irocNotifications.id });
    res.json({ deleted: deleted.length });
  },
);

router.delete(
  "/iroc/notifications/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    const [row] = await db
      .delete(irocNotifications)
      .where(eq(irocNotifications.id, id))
      .returning({ id: irocNotifications.id });
    if (!row) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ deleted: true });
  },
);

// ── Spirecut quote moderation (iROC-JWT protected) ───────────────────────────
// These endpoints give iROC admins moderation access without exposing
// the raw ADMIN_PASSWORD to the browser.

router.get(
  "/iroc/quotes",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const { settingsTable: st } = await import("@workspace/db");
    const { like: likeOp } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(st)
      .where(likeOp(st.key, `${POSTOP_PREFIX_IROC}%`));
    const submissions = rows
      .map((r) => { try { return JSON.parse(r.value); } catch { return null; } })
      .filter(Boolean)
      .filter((s: Record<string, unknown>) => s.shareQuote === true)
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        new Date(b.submittedAt as string).getTime() - new Date(a.submittedAt as string).getTime()
      );
    res.json(submissions);
  },
);

router.patch(
  "/iroc/quotes/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const body = req.body as { approved?: unknown; featured?: unknown };
    const hasApproved = "approved" in body;
    const hasFeatured = "featured" in body;

    if (hasApproved && typeof body.approved !== "boolean") {
      res.status(400).json({ error: "approved must be a boolean" });
      return;
    }
    if (hasFeatured && typeof body.featured !== "boolean") {
      res.status(400).json({ error: "featured must be a boolean" });
      return;
    }
    if (!hasApproved && !hasFeatured) {
      res.status(400).json({ error: "approved or featured must be provided" });
      return;
    }

    const { settingsTable: st } = await import("@workspace/db");
    const { eq: eqOp, like: likeOp } = await import("drizzle-orm");
    const dbKey = `${POSTOP_PREFIX_IROC}${req.params.id}`;
    const rows = await db.select().from(st).where(eqOp(st.key, dbKey));
    if (rows.length === 0) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(rows[0].value); } catch {
      res.status(500).json({ error: "Corrupt submission data" }); return;
    }
    if (!parsed.shareQuote) {
      res.status(400).json({ error: "This submission has no quote to approve" });
      return;
    }

    if (hasApproved) {
      parsed.quoteApproved = body.approved;
      // When rejecting a featured quote: remember it was featured, then clear the flag
      if (body.approved === false && parsed.featured) {
        parsed.wasFeatured = true;
        parsed.featured = false;
      }
      // When re-approving: clear wasFeatured only if the quote is being featured again
      // (wasFeatured stays so the UI can show the re-feature notice)
    }

    if (hasFeatured) {
      if (body.featured === true && parsed.quoteApproved !== true) {
        res.status(400).json({ error: "Only approved quotes can be featured" });
        return;
      }
      parsed.featured = body.featured;
      // Clear the wasFeatured reminder once the admin explicitly re-features the quote
      if (body.featured === true) {
        parsed.wasFeatured = false;
      }

      // When featuring this quote, unset featured on all other quotes
      if (body.featured === true) {
        const allRows = await db.select().from(st).where(likeOp(st.key, `${POSTOP_PREFIX_IROC}%`));
        for (const row of allRows) {
          if (row.key === dbKey) continue;
          let other: Record<string, unknown>;
          try { other = JSON.parse(row.value); } catch { continue; }
          if (other.featured === true) {
            other.featured = false;
            await db.update(st).set({ value: JSON.stringify(other), updatedAt: new Date() }).where(eqOp(st.key, row.key));
          }
        }
      }
    }

    await db
      .update(st)
      .set({ value: JSON.stringify(parsed), updatedAt: new Date() })
      .where(eqOp(st.key, dbKey));
    res.json({ id: req.params.id, quoteApproved: parsed.quoteApproved, featured: parsed.featured ?? false, wasFeatured: parsed.wasFeatured ?? false });
  },
);

router.delete(
  "/iroc/quotes/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { settingsTable: st } = await import("@workspace/db");
    const { eq: eqOp } = await import("drizzle-orm");
    const dbKey = `${POSTOP_PREFIX_IROC}${req.params.id}`;
    await db.delete(st).where(eqOp(st.key, dbKey));
    res.json({ message: "Deleted" });
  },
);

// ── Last discount for a (customer, product) pair ─────────────────────────────
router.get(
  "/iroc/invoice-items/last-discount",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const websiteCustomerId = parseInt(String(req.query.websiteCustomerId));
    const productId         = parseInt(String(req.query.productId));
    if (!websiteCustomerId || !productId) {
      res.status(400).json({ error: "websiteCustomerId and productId are required" });
      return;
    }
    const [row] = await db
      .select({ discountPercent: irocInvoiceItems.discountPercent })
      .from(irocInvoiceItems)
      .innerJoin(irocInvoices, eq(irocInvoiceItems.invoiceId, irocInvoices.id))
      .where(
        and(
          eq(irocInvoices.websiteCustomerId, websiteCustomerId),
          eq(irocInvoiceItems.productId, productId),
          sql`${irocInvoiceItems.discountPercent} IS NOT NULL`,
          sql`${irocInvoiceItems.discountPercent}::numeric > 0`,
        ),
      )
      .orderBy(desc(irocInvoices.issueDate), desc(irocInvoices.id))
      .limit(1);
    res.json({ discountPercent: row?.discountPercent?.toString() ?? null });
  },
);

// ── Sales Summary ────────────────────────────────────────────────────────────
router.get(
  "/iroc/sales-summary",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const rows = await db
      .select({
        itemId:          irocInvoiceItems.id,
        invoiceId:       irocInvoiceItems.invoiceId,
        productName:     irocInvoiceItems.productName,
        sku:             irocInvoiceItems.sku,
        quantity:        irocInvoiceItems.quantity,
        lineTotal:       irocInvoiceItems.lineTotal,
        isDemo:          irocInvoiceItems.isDemo,
        issueDate:       irocInvoices.issueDate,
        status:          irocInvoices.status,
        invoiceTotal:    irocInvoices.total,
        wcFirstName:     websiteCustomersTable.firstName,
        wcLastName:      websiteCustomersTable.lastName,
        wcEmail:         websiteCustomersTable.email,
        legacyName:      irocCustomers.name,
        productCategory: irocProducts.category,
      })
      .from(irocInvoiceItems)
      .innerJoin(irocInvoices, eq(irocInvoiceItems.invoiceId, irocInvoices.id))
      .leftJoin(websiteCustomersTable, eq(irocInvoices.websiteCustomerId, websiteCustomersTable.id))
      .leftJoin(irocCustomers, eq(irocInvoices.customerId, irocCustomers.id))
      .leftJoin(irocProducts, eq(irocInvoiceItems.productId, irocProducts.id))
      .orderBy(desc(irocInvoices.issueDate));

    res.json(
      rows.map((r) => {
        const customerName =
          [r.wcFirstName, r.wcLastName].filter(Boolean).join(" ") ||
          r.wcEmail ||
          r.legacyName ||
          "Unknown";
        return {
          itemId:       r.itemId,
          invoiceId:    r.invoiceId,
          productName:  r.productName,
          sku:          r.sku,
          quantity:     r.quantity,
          lineTotal:    r.lineTotal.toString(),
          isDemo:       r.isDemo,
          issueDate:    r.issueDate,
          status:       r.status,
          invoiceTotal: r.invoiceTotal.toString(),
          customerName,
          category:     inferCategory(r.productCategory, r.productName),
        };
      }),
    );
  },
);

// ── Announcements: send individual emails to selected customers ───────────────
router.post(
  "/iroc/announcements/send",
  requireIrocAuth,
  async (req, res) => {
    const { customerIds, subject, body } = req.body as {
      customerIds: number[];
      subject: string;
      body: string;
    };

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      res.status(400).json({ error: "customerIds must be a non-empty array" });
      return;
}
    if (!subject?.trim()) { res.status(400).json({ error: "subject is required" }); return; }
    if (!body?.trim())    return res.status(400).json({ error: "body is required" });

    // Resolve "from" address from settings, fall back to default
    const [fromRow] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, "iroc_announcement_from"));
    const fromAddress = fromRow?.value?.trim() || undefined;

    // Load customers
    const rows = await db
      .select({ id: websiteCustomersTable.id, email: websiteCustomersTable.email })
      .from(websiteCustomersTable)
      .where(inArray(websiteCustomersTable.id, customerIds));

    const results: { customerId: number; email: string; status: "sent" | "failed"; error?: string }[] = [];

    for (const customer of rows) {
      try {
        await sendEmail({
          to: customer.email,
          subject,
          text: body,
          from: fromAddress,
          signatureGroup: "admin",
          signatureLanguage: "de",
          mailboxPurpose: "announcement",
        });
        results.push({ customerId: customer.id, email: customer.email, status: "sent" });
      } catch (err) {
        results.push({
          customerId: customer.id,
          email: customer.email,
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const sent   = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return res.json({ sent, failed, results });
  }
);

// ── SMTP test email ────────────────────────────────────────────────────────────

router.post(
  "/iroc/leads/test-email",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { to } = req.body;
    if (!to) { res.status(400).json({ error: "to is required" }); return; }
    try {
      await sendEmail({
        to,
        subject: "iROC Test-E-Mail",
        text: `Diese E-Mail bestätigt, dass der E-Mail-Versand korrekt konfiguriert ist.\n\niROC GmbH\ninfo@i-roc.de`,
        signatureGroup: "admin",
        signatureLanguage: "de",
        mailboxPurpose: "notifications",
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Send failed" });
    }
  },
);

// ── Leads ──────────────────────────────────────────────────────────────────────

const LEAD_STATUSES = ["new", "contacted", "registered", "qualified", "converted"] as const;
const MANUAL_LEAD_STATUSES = ["new", "contacted", "converted"] as const;

// The authenticated app uses the complete managed footer to prefill editable
// lead invitations. Invisible boundaries let the sender replace stale CMS
// content idempotently if it changes before the draft is sent.
router.get("/iroc/impressum-signature", requireIrocAuth, async (req: Request, res: Response) => {
  const language = req.query.language === "de" ? "de" : "en";
  res.json({ language, signature: await appendImpressumSignature("", language) });
});

function leadOfferCustomer(lead: typeof irocLeads.$inferSelect): PdfCustomer {
  return {
    id: 0,
    name: [lead.firstName, lead.lastName].filter(Boolean).join(" "),
    company: lead.institutionName ?? null,
    salutation: lead.salutation ?? null,
    title: lead.medicalTitle ?? null,
    address: [lead.street, lead.houseNumber].filter(Boolean).join(" ") || null,
    postalCode: lead.zipCode ?? null,
    city: lead.city ?? null,
    country: lead.country ?? "Germany",
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    vatId: null,
    isEu: false,
    notes: null,
    customerNr: null,
    reorderCode: null,
  };
}

function decorateTrainingNotes(
  notes: string | null | undefined,
  trainingDate: string | null | undefined,
  language: "de" | "en",
): string | null {
  if (!trainingDate) return notes ?? null;
  const [year, month, day] = trainingDate.slice(0, 10).split("-");
  const formatted = language === "de"
    ? `${day}.${month}.${year}`
    : `${Number(day)} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(month) - 1] ?? month} ${year}`;
  const prefix = language === "de" ? `Schulungsdatum: ${formatted}` : `Training date: ${formatted}`;
  return notes?.trim() ? `${prefix}\n${notes.trim()}` : prefix;
}

async function qualifyRegisteredLead(leadId: number): Promise<{ websiteCustomerId: number; customerCreated: boolean }> {
  return db.transaction(async (tx) => {
    // Serializes double-clicks/retries for this lead, including customer creation.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${leadId})`);

    const [lead] = await tx.select().from(irocLeads).where(eq(irocLeads.id, leadId));
    if (!lead) throw new TrainingQualificationError("Lead not found");
    if (lead.status === "qualified") {
      const [existingOffer] = await tx
        .select({ websiteCustomerId: irocTrainingOffers.websiteCustomerId })
        .from(irocTrainingOffers)
        .where(eq(irocTrainingOffers.leadId, leadId));
      if (existingOffer?.websiteCustomerId) {
        return { websiteCustomerId: existingOffer.websiteCustomerId, customerCreated: false };
      }
      throw new TrainingQualificationError("Qualified lead has no invoiceable customer.");
    }
    if (lead.status !== "registered") {
      throw new TrainingQualificationError("Only a Registered lead with a sent training offer can be qualified.");
    }
    if (!lead.email?.trim()) {
      throw new TrainingQualificationError("Lead has no email address — cannot create an invoiceable customer.");
    }

    const [offer] = await tx
      .select()
      .from(irocTrainingOffers)
      .where(eq(irocTrainingOffers.leadId, leadId));
    if (!offer) {
      throw new TrainingQualificationError("A saved training offer is required before qualifying this lead.");
    }

    let websiteCustomerId = offer.websiteCustomerId;
    let customerCreated = false;
    if (!websiteCustomerId) {
      const normalizedEmail = lead.email.trim().toLowerCase();
      const [existingCustomer] = await tx
        .select({ id: websiteCustomersTable.id })
        .from(websiteCustomersTable)
        .where(sql`lower(btrim(${websiteCustomersTable.email})) = ${normalizedEmail}`)
        .orderBy(websiteCustomersTable.id)
        .limit(1);

      if (existingCustomer) {
        websiteCustomerId = existingCustomer.id;
      } else {
        const year = new Date().getFullYear().toString();
        const prefix = `${year}-`;
        const maxRow = await pool.query<{ max_nr: string | null }>(
          `SELECT MAX(customer_nr) AS max_nr FROM website_customers WHERE customer_nr LIKE $1`,
          [`${prefix}%`],
        );
        const prevMax = maxRow.rows[0]?.max_nr;
        const nextSeq = prevMax ? parseInt(prevMax.slice(prefix.length), 10) + 1 : 1;
        const customerNr = `${prefix}${String(nextSeq).padStart(4, "0")}`;
        const normalizedNames = normalizeWebsiteCustomerNameFields({
          title: lead.medicalTitle,
          firstName: lead.firstName,
          lastName: lead.lastName,
        });
        const [customer] = await tx
          .insert(websiteCustomersTable)
          .values({
            customerNr,
            salutation: lead.salutation || null,
            title: lead.medicalTitle || null,
            firstName: normalizedNames.firstName ?? null,
            lastName: normalizedNames.lastName ?? null,
            specialty: lead.specialty ?? null,
            institutionName: lead.institutionName ?? null,
            email: lead.email.trim(),
            phone: lead.phone ?? null,
            postalCode: lead.zipCode ?? null,
            city: lead.city ?? null,
            country: lead.country ?? "Germany",
            website: lead.website ?? null,
            instrument: "spirecut",
            privacyConsent: false,
          })
          .returning({ id: websiteCustomersTable.id });
        websiteCustomerId = customer.id;
        customerCreated = true;
      }

      await tx
        .update(irocTrainingOffers)
        .set({ websiteCustomerId, qualifiedAt: new Date() })
        .where(eq(irocTrainingOffers.id, offer.id));
    }

    await tx
      .update(irocLeads)
      .set({ status: "qualified", updatedAt: new Date() })
      .where(eq(irocLeads.id, leadId));
    return { websiteCustomerId, customerCreated };
  });
}

router.get(
  "/iroc/leads",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const [rows, offers] = await Promise.all([
      db
        .select()
        .from(irocLeads)
        .orderBy(desc(irocLeads.createdAt)),
      db
        .select({
          leadId: irocTrainingOffers.leadId,
          customerSnapshot: irocTrainingOffers.customerSnapshot,
        })
        .from(irocTrainingOffers),
    ]);
    const downloadableOfferLeadIds = new Set(
      offers.flatMap(({ leadId, customerSnapshot }) => {
        if (!customerSnapshot) return [];
        try {
          return parseTrainingOfferCustomerSnapshot(JSON.parse(customerSnapshot)) ? [leadId] : [];
        } catch {
          return [];
        }
      }),
    );
    const savedOfferLeadIds = new Set(offers.map(({ leadId }) => leadId));
    res.json(rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      trainingOfferSaved: savedOfferLeadIds.has(r.id),
      trainingOfferDownloadAvailable: downloadableOfferLeadIds.has(r.id),
    })));
  },
);

router.post(
  "/iroc/leads",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const {
      salutation, medicalTitle, firstName, lastName, specialty, institutionName,
      zipCode, city, country, email, phone, website, contactWhere, notes, status, firstContactDate,
    } = req.body;
    if (!lastName) { res.status(400).json({ error: "lastName is required" }); return; }
    if (status !== undefined && !MANUAL_LEAD_STATUSES.includes(status)) {
      res.status(422).json({ error: "Registered and Qualified are controlled by the training-offer payment workflow." });
      return;
    }
    const [row] = await db
      .insert(irocLeads)
      .values({
        salutation:       salutation       ?? "Herr",
        medicalTitle:     medicalTitle     ?? null,
        firstName:        firstName        ?? "",
        lastName,
        specialty:        specialty        ?? null,
        institutionName:  institutionName  ?? null,
        zipCode:          zipCode          ?? null,
        city:             city             ?? null,
        country:          country          ?? null,
        email:            email            ?? null,
        phone:            phone            ?? null,
        website:          website          ?? null,
        contactWhere:     contactWhere     ?? null,
        notes:            notes            ?? null,
        firstContactDate: firstContactDate ?? null,
        status:           status           ?? "new",
      })
      .returning();
    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
  },
);

// ── Bulk status update ────────────────────────────────────────────────────────
router.patch(
  "/iroc/leads/bulk",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { ids, status } = req.body as { ids: number[]; status: string };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids must be a non-empty array" }); return; }
    if (!LEAD_STATUSES.includes(status as typeof LEAD_STATUSES[number])) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    if (status === "registered") {
      res.status(422).json({ error: "Registered is set automatically only after a training offer is saved." });
      return;
    }
    if (status !== "qualified") {
      const registeredLead = await db
        .select({ id: irocLeads.id })
        .from(irocLeads)
        .where(and(inArray(irocLeads.id, ids), eq(irocLeads.status, "registered")))
        .limit(1);
      if (registeredLead.length > 0) {
        res.status(422).json({ error: "Registered leads must be marked Qualified after payment before their status can change." });
        return;
      }
    }
    if (status === "qualified") {
      try {
        for (const id of ids) await qualifyRegisteredLead(id);
      } catch (err) {
        res.status(422).json({ error: err instanceof Error ? err.message : "Could not qualify selected leads" });
        return;
      }
    } else {
      await db.update(irocLeads)
        .set({ status, updatedAt: new Date() })
        .where(inArray(irocLeads.id, ids));
    }
    res.json({ ok: true, updated: ids.length });
  },
);

// ── Bulk delete ───────────────────────────────────────────────────────────────
router.delete(
  "/iroc/leads/bulk",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { ids } = req.body as { ids: number[] };
    if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids must be a non-empty array" }); return; }
    await db.delete(irocLeads).where(inArray(irocLeads.id, ids));
    res.json({ ok: true, deleted: ids.length });
  },
);

router.put(
  "/iroc/leads/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const {
      salutation, medicalTitle, firstName, lastName, specialty, institutionName,
      zipCode, city, country, email, phone, website, contactWhere, notes, status, firstContactDate,
    } = req.body;
    const [existing] = await db.select().from(irocLeads).where(eq(irocLeads.id, id));
    if (!existing) { res.status(404).json({ error: "Lead not found" }); return; }
    if (status !== undefined && !LEAD_STATUSES.includes(status as typeof LEAD_STATUSES[number])) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    if (status === "registered" && existing.status !== "registered") {
      res.status(422).json({ error: "Registered is set automatically only after a training offer is saved." });
      return;
    }
    if (
      existing.status === "registered"
      && status !== undefined
      && status !== "registered"
      && status !== "qualified"
    ) {
      res.status(422).json({ error: "Registered leads must be marked Qualified after payment before their status can change." });
      return;
    }
    if (status === "qualified" && existing.status !== "qualified") {
      try {
        await qualifyRegisteredLead(id);
      } catch (err) {
        res.status(422).json({ error: err instanceof Error ? err.message : "Could not qualify lead" });
        return;
      }
    }

    const [row] = await db
      .update(irocLeads)
      .set({
        ...(salutation        !== undefined && { salutation }),
        ...(medicalTitle      !== undefined && { medicalTitle }),
        ...(firstName         !== undefined && { firstName }),
        ...(lastName          !== undefined && { lastName }),
        ...(specialty         !== undefined && { specialty }),
        ...(institutionName   !== undefined && { institutionName }),
        ...(zipCode           !== undefined && { zipCode }),
        ...(city              !== undefined && { city }),
        ...(country           !== undefined && { country }),
        ...(email             !== undefined && { email }),
        ...(phone             !== undefined && { phone }),
        ...(website           !== undefined && { website }),
        ...(contactWhere      !== undefined && { contactWhere }),
        ...(notes             !== undefined && { notes }),
        // Auto-promote: firstContactDate being set on a "new" lead → contacted
        ...(status !== undefined
          ? { status: (status === "new" && firstContactDate) ? "contacted" : status }
          : {}),
        ...(firstContactDate  !== undefined && { firstContactDate }),
        updatedAt: new Date(),
      })
      .where(eq(irocLeads.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
  },
);

router.delete(
  "/iroc/leads/:id",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.delete(irocLeads).where(eq(irocLeads.id, id));
    res.json({ ok: true });
  },
);

// ── Lead status auto-sync ──────────────────────────────────────────────────────
// Rules (applied by rank — status only ever increases):
//   Rank 1 — contacted  : firstContactDate is set
//   Rank 4 — converted  : email found in certified trained_doctors
// Training registration intentionally does not imply payment or qualification.
router.post(
  "/iroc/leads/sync-status",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const [leads, trainedDoctors, certifications] = await Promise.all([
      db.select().from(irocLeads),
      db.select().from(trainedDoctorsTable),
      db.select().from(doctorCertificationsTable),
    ]);

    const STATUS_RANK: Record<string, number> = { new: 0, contacted: 1, registered: 2, qualified: 3, converted: 4 };

    const certifiedDoctorIds = new Set(certifications.map(c => c.doctorId));
    const certifiedEmails = new Set(
      trainedDoctors
        .filter(d => certifiedDoctorIds.has(d.id) && d.email)
        .map(d => d.email!.trim().toLowerCase()),
    );

    let contacted = 0, converted = 0;

    for (const lead of leads) {
      const email = (lead.email ?? "").trim().toLowerCase();
      const currentRank = STATUS_RANK[lead.status] ?? 0;
      let targetRank = currentRank;

      // Rule 1: firstContactDate set → at least contacted
      if (lead.firstContactDate && targetRank < STATUS_RANK["contacted"]) targetRank = STATUS_RANK["contacted"];

      // Rule 2: email in certified trained_doctors → converted. A Registered
      // lead still requires the explicit payment-confirmed qualification step
      // before certification may promote it further.
      if (
        lead.status !== "registered"
        && email
        && certifiedEmails.has(email)
        && targetRank < STATUS_RANK["converted"]
      ) {
        targetRank = STATUS_RANK["converted"];
      }

      if (targetRank !== currentRank) {
        const newStatus = Object.keys(STATUS_RANK).find(k => STATUS_RANK[k] === targetRank)!;
        await db.update(irocLeads).set({ status: newStatus, updatedAt: new Date() }).where(eq(irocLeads.id, lead.id));
        if (newStatus === "contacted") contacted++;
        else if (newStatus === "converted") converted++;
      }
    }

    res.json({ ok: true, updated: contacted + converted, contacted, registered: 0, qualified: 0, converted });
  },
);

router.post(
  "/iroc/leads/:id/email",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const [lead] = await db.select().from(irocLeads).where(eq(irocLeads.id, id));
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
    if (!lead.email) { res.status(400).json({ error: "Lead has no email address" }); return; }

    const { subject, body } = req.body;
    if (!subject || !body) { res.status(400).json({ error: "subject and body are required" }); return; }

    await sendEmail({
      to:   lead.email,
      from: "iROC GmbH <info@i-roc.de>",
      subject,
      text: await appendImpressumSignature(body, recipientLanguageForCountry(lead.country)),
      signatureGroup: "admin",
      signatureLanguage: recipientLanguageForCountry(lead.country),
      mailboxPurpose: "sally_ai",
    });

    // Mark as contacted + set firstContactDate (if not already set)
    const today = new Date().toISOString().slice(0, 10);
    await db.update(irocLeads).set({
      ...(lead.status === "new" && { status: "contacted" }),
      ...(!lead.firstContactDate && { firstContactDate: today }),
      updatedAt: new Date(),
    }).where(eq(irocLeads.id, id));

    res.json({ ok: true });
  },
);


// ── Lead → Invoice config ─────────────────────────────────────────────────────
// Resolves (or auto-creates) the websiteCustomer for a lead and returns the
// product-group access rules based on the lead's certification status.
//
// allowedGroups values:
//   "service-only"  – lead not yet converted; training invoices only (isService groups)
//   "spirecut"      – certified in Spirecut only
//   "ministem"      – certified in MiniSTEM only (JointechLabs products)
//   "all"           – certified in both, OR no specific cert (Estar Medical etc.)
router.post(
  "/iroc/leads/:id/invoice-config",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const [lead] = await db.select().from(irocLeads).where(eq(irocLeads.id, id));
    if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
    if (!lead.email) {
      res.status(422).json({ error: "Lead has no email address — cannot create invoice." });
      return;
    }

    // A payment-confirmed offer remains the source of truth for official
    // invoice prefill even if certification later promotes the lead to
    // Converted.
    const [offer] = await db
      .select({
        id: irocTrainingOffers.id,
        websiteCustomerId: irocTrainingOffers.websiteCustomerId,
        trainingDate: irocTrainingOffers.trainingDate,
      })
      .from(irocTrainingOffers)
      .where(eq(irocTrainingOffers.leadId, id));
    if (offer?.websiteCustomerId) {
      res.json({
        websiteCustomerId: offer.websiteCustomerId,
        allowedGroups: "service-only",
        customerCreated: false,
        isOffer: false,
        trainingDate: offer.trainingDate,
        trainingOfferId: offer.id,
      });
      return;
    }
    if (offer) {
      res.status(409).json({
        error: "A training offer is already saved. Mark the accepted offer Qualified to create the official invoice.",
      });
      return;
    }
    // Pre-payment training offers use lead data directly; no invoiceable
    // customer is created until the administrator marks the offer as paid.
    // Registered leads without an offer (for example after a legacy import)
    // use the same offer flow as contacted leads.
    if (lead.status !== "converted" && lead.status !== "qualified") {
      let trainingDate: string | null = null;
      try {
        const regRows = await pool.query<{ training_date_info: string | null; training_date_id: number | null }>(
          `SELECT training_date_info, training_date_id
           FROM training_registrations
           WHERE LOWER(email) = LOWER($1)
           ORDER BY created_at DESC
           LIMIT 1`,
          [lead.email],
        );
        const reg = regRows.rows[0];
        if (reg?.training_date_info) trainingDate = reg.training_date_info.slice(0, 10);
        else if (reg?.training_date_id) {
          const dateRows = await pool.query<{ date: string }>(
            `SELECT date FROM training_dates WHERE id = $1 LIMIT 1`,
            [reg.training_date_id],
          );
          trainingDate = dateRows.rows[0]?.date?.slice(0, 10) ?? null;
        }
      } catch { /* Training date is optional for an offer. */ }
      res.json({
        websiteCustomerId: null,
        allowedGroups: "service-only",
        customerCreated: false,
        isOffer: true,
        trainingDate,
        leadName: [lead.salutation, lead.medicalTitle, lead.firstName, lead.lastName].filter(Boolean).join(" "),
      });
      return;
    }

    // ── 1. Resolve or auto-create websiteCustomer ──────────────────────────
    let websiteCustomerId: number;
    let customerCreated = false;

    const [existing] = await db
      .select({ id: websiteCustomersTable.id, salutation: websiteCustomersTable.salutation, title: websiteCustomersTable.title })
      .from(websiteCustomersTable)
      .where(eq(websiteCustomersTable.email, lead.email))
      .limit(1);

    if (existing) {
      websiteCustomerId = existing.id;
      // Back-fill salutation / title from lead if the customer record is missing them
      const patch: Record<string, string> = {};
      if (!existing.salutation && lead.salutation) patch.salutation = lead.salutation;
      if (!existing.title && lead.medicalTitle)    patch.title      = lead.medicalTitle;
      if (Object.keys(patch).length > 0) {
        const profileUpdateConditions = [
          eq(websiteCustomersTable.id, existing.id),
          ...(patch.salutation !== undefined ? [isNull(websiteCustomersTable.salutation)] : []),
          ...(patch.title !== undefined ? [isNull(websiteCustomersTable.title)] : []),
        ];
        await db
          .update(websiteCustomersTable)
          .set(patch)
          .where(and(...profileUpdateConditions));
      }
    } else {
      // Generate next customerNr in YYYY-NNNN format
      const year = new Date().getFullYear().toString();
      const prefix = `${year}-`;
      const maxRow = await pool.query<{ max_nr: string | null }>(
        `SELECT MAX(customer_nr) AS max_nr FROM website_customers WHERE customer_nr LIKE $1`,
        [`${prefix}%`],
      );
      const prevMax = maxRow.rows[0]?.max_nr;
      const nextSeq = prevMax ? parseInt(prevMax.slice(prefix.length), 10) + 1 : 1;
      const customerNr = `${prefix}${String(nextSeq).padStart(4, "0")}`;
      const normalizedNames = normalizeWebsiteCustomerNameFields({
        title: lead.medicalTitle,
        firstName: lead.firstName,
        lastName: lead.lastName,
      });

      const [newCust] = await db
        .insert(websiteCustomersTable)
        .values({
          customerNr,
          salutation:      lead.salutation || null,
          title:           lead.medicalTitle || null,
          firstName:       normalizedNames.firstName ?? null,
          lastName:        normalizedNames.lastName ?? null,
          institutionName: lead.institutionName ?? null,
          email:           lead.email,
          phone:           lead.phone ?? null,
          postalCode:      lead.zipCode ?? null,
          city:            lead.city ?? null,
          country:         lead.country ?? "Germany",
          instrument:      "spirecut",  // default; admin can update on the customer record
          privacyConsent:  false,
        })
        .returning({ id: websiteCustomersTable.id });
      websiteCustomerId = newCust.id;
      customerCreated = true;
    }

    // ── 1b. Look up most-recent training registration for this lead's email ──
    let trainingDate: string | null = null;
    try {
      // Case-insensitive email match (leads and registrations may differ in case)
      const regRows = await pool.query<{ training_date_info: string | null; training_date_id: number | null }>(
        `SELECT training_date_info, training_date_id
         FROM training_registrations
         WHERE LOWER(email) = LOWER($1)
         ORDER BY created_at DESC
         LIMIT 1`,
        [lead.email],
      );
      const reg = regRows.rows[0];
      if (reg?.training_date_info) {
        // trainingDateInfo format: "2026-09-15 – München" — take first 10 chars
        trainingDate = reg.training_date_info.slice(0, 10);
      } else if (reg?.training_date_id) {
        // Fall back: resolve the date from trainingDates table
        const dtRows = await pool.query<{ date: string }>(
          `SELECT date FROM training_dates WHERE id = $1 LIMIT 1`,
          [reg.training_date_id],
        );
        if (dtRows.rows[0]?.date) trainingDate = dtRows.rows[0].date.slice(0, 10);
      }
    } catch { /* non-critical — proceed without training date */ }

    // ── 2. Compute allowed product groups ─────────────────────────────────
    let allowedGroups: string;

    if (lead.status !== "converted") {
      // Not yet certified — training invoice only (service products)
      allowedGroups = "service-only";
    } else {
      // Look up certifications via trained_doctors → doctor_certifications
      const certsResult = await pool.query<{ instrument: string }>(
        `SELECT dc.instrument
         FROM trained_doctors td
         JOIN doctor_certifications dc ON dc.doctor_id = td.id
         WHERE td.email = $1`,
        [lead.email],
      );
      const instruments = new Set(certsResult.rows.map(r => r.instrument));
      const hasSpirecut = instruments.has("spirecut");
      const hasMinistem = instruments.has("ministem");

      if (hasSpirecut && hasMinistem) {
        allowedGroups = "all";                    // certified in both → everything
      } else if (hasSpirecut) {
        allowedGroups = "spirecut";
      } else if (hasMinistem) {
        allowedGroups = "ministem";
      } else {
        // No instrument cert (Estar Medical or other open-access group) → all
        allowedGroups = "all";
      }
    }

    // Historic Qualified leads predate immutable training-offer snapshots.
    // They retain the legacy customer-resolution flow and create an official
    // invoice, while new paid training offers returned earlier use their saved
    // snapshot as the source of truth.
    const isOffer = lead.status !== "converted" && lead.status !== "qualified";
    res.json({ websiteCustomerId, allowedGroups, customerCreated, isOffer, trainingDate });
  },
);

// ── ECB exchange-rate proxy ────────────────────────────────────────────────
// ── Postop form config ─────────────────────────────────────────────────────────
// Stores the patient feedback form schema (dropdown options, visible sections)
// as a JSON blob in the settings table. Key: "postop_form_config"
// The same key is also written by /admin/patient-postop-form-config in patient-extras.ts

const POSTOP_FORM_CONFIG_KEY_IROC = "postop_form_config";

router.get(
  "/iroc/postop-form-config",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, POSTOP_FORM_CONFIG_KEY_IROC));
    if (!row) return res.json(null);
    try {
      return res.json(JSON.parse(row.value));
    } catch {
      return res.json(null);
    }
  },
);

router.put(
  "/iroc/postop-form-config",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    if (
      !Array.isArray(body.procedures) ||
      !Array.isArray(body.ageRanges) ||
      !Array.isArray(body.genders) ||
      !Array.isArray(body.occupations) ||
      !Array.isArray(body.diseases) ||
      typeof body.visibleSections !== "object"
    ) {
      return res.status(400).json({ error: "Invalid form config structure" });
    }
    const [storedConfig] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, POSTOP_FORM_CONFIG_KEY_IROC));
    let previousProcedures = getDefaultPostopFormConfig().procedures;
    if (storedConfig) {
      try {
        const parsed = JSON.parse(storedConfig.value) as { procedures?: unknown };
        if (Array.isArray(parsed.procedures)) {
          previousProcedures = parsed.procedures as typeof previousProcedures;
        }
      } catch {
        // Treat an unreadable config as the built-in configuration.
      }
    }
    await archiveRemovedProcedureLabels(
      previousProcedures,
      body.procedures as typeof previousProcedures,
    );
    const value = JSON.stringify(body);
    await db
      .insert(settingsTable)
      .values({ key: POSTOP_FORM_CONFIG_KEY_IROC, value })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value, updatedAt: new Date() },
      });
    return res.json({ ok: true });
  },
);

// ── Nav config ────────────────────────────────────────────────────────────────
// Stores the sidebar navigation tree as a JSON blob in the settings table.
// Key: "nav_config"  Value: JSON-serialised NavConfig (array of NavGroup)

const NAV_CONFIG_KEY = "nav_config";

// All known route slugs — used to validate PUT requests
const KNOWN_ROUTE_SLUGS = new Set([
  "/customers", "/products", "/inventory", "/invoices", "/expenses", "/sales-summary",
  "/reports", "/spirecut-quotes", "/announcements", "/leads", "/upcoming-events",
  "/web-design-agent", "/tori", "/spiro", "/datev-export",
  "/iroc-website/training", "/iroc-website/registrations", "/iroc-website/doctors",
  "/iroc-website/resources", "/iroc-website/team", "/iroc-website/events",
  "/iroc-website/email", "/iroc-website/customers", "/iroc-website/orders",
  "/iroc-website/settings", "/iroc-website/browser-app", "/iroc-website/portal-passwords", "/iroc-website/content",
  "/spirecut/media", "/spirecut/social", "/spirecut/postop",
  "/spirecut/settings", "/spirecut/content", "/spirecut/testimonials",
  "/spirecut/browser-app",
  // Agents (unified Sally + legacy sub-slugs kept for backwards compat + Tori + Nite)
  "/sally",
  "/sally/leads", "/sally/doctors", "/sally/email-queue", "/sally/settings",
  // Apps → iROC Doctor Portal
  "/portal/design", "/portal/content", "/portal/nav-config",
  // Configuration → Email
  "/email-config",
  "/email-help",
]);

// Groups that must always appear in the nav config, even if the stored config
// pre-dates them. Each entry is appended when its id is absent from the stored config.
const ALWAYS_PRESENT_GROUPS: Array<{ id: string; labelDe: string; labelEn: string; icon: string; items: Array<{ slug: string; visible: boolean }> }> = [
  {
    id: "agents",
    labelDe: "KI-Agenten",
    labelEn: "Agents",
    icon: "BotMessageSquare",
    items: [
      { slug: "/sally",            visible: true },
      { slug: "/spiro",            visible: true },
      { slug: "/tori",             visible: true },
      { slug: "/web-design-agent", visible: true },
    ],
  },
];

router.get(
  "/iroc/nav-config",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const [row] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, NAV_CONFIG_KEY));
    if (!row) return res.json(null); // frontend uses its DEFAULT_NAV_CONFIG
    try {
      const stored = JSON.parse(row.value) as Array<{ id: string }>;
      const storedIds = new Set(stored.map((g) => g.id));
      // Append any groups that were added after the config was last saved
      const merged = [
        ...stored,
        ...ALWAYS_PRESENT_GROUPS.filter((g) => !storedIds.has(g.id)),
      ];
      return res.json(merged);
    } catch {
      return res.json(null);
    }
  },
);

router.put(
  "/iroc/nav-config",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const config = req.body;
    if (!Array.isArray(config)) {
      return res.status(400).json({ error: "Expected an array of groups" });
    }
    // Validate structure
    for (const group of config as Record<string, unknown>[]) {
      if (typeof group.id !== "string" || !group.id) {
        return res.status(400).json({ error: "Each group must have a string id" });
      }
      if (!Array.isArray(group.items)) {
        return res.status(400).json({ error: `Group ${group.id} must have an items array` });
      }
      for (const item of group.items as Record<string, unknown>[]) {
        if (typeof item.slug !== "string") {
          return res.status(400).json({ error: "Each item must have a string slug" });
        }
        if (!KNOWN_ROUTE_SLUGS.has(item.slug)) {
          return res.status(400).json({ error: `Unknown route slug: ${item.slug}` });
        }
      }
    }
    const value = JSON.stringify(config);
    await db
      .insert(settingsTable)
      .values({ key: NAV_CONFIG_KEY, value })
      .onConflictDoUpdate({
        target: settingsTable.key,
        set: { value, updatedAt: new Date() },
      });
    return res.json({ ok: true });
  },
);

// The browser cannot reliably reach api.frankfurter.app from Replit's proxied
// iframe, so the frontend calls this endpoint and the server makes the request.
router.get(
  "/iroc/exchange-rate",
  async (req: Request, res: Response) => {
    const { from, to = "EUR", amount = "1", date = "latest" } = req.query as Record<string, string>;
    if (!from) { res.status(400).json({ error: "Missing 'from' parameter" }); return; }

    const tryFetch = async (endpoint: string) => {
      const url = `https://api.frankfurter.app/${endpoint}?from=${from}&to=${to}&amount=${amount}`;
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok) return null;
      return r.json() as Promise<Record<string, unknown>>;
    };

    const data = date === "latest"
      ? await tryFetch("latest")
      : (await tryFetch(date)) ?? (await tryFetch("latest"));

    if (!data || typeof (data as { rates?: Record<string, number> }).rates?.[to] !== "number") {
      res.status(502).json({ error: "Rate unavailable" });
      return;
    }
    res.json(data);
  },
);

export default router;
