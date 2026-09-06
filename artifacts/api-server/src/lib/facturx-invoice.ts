import {
  DocumentTypeCode,
  buildXml,
  embedFacturX,
  Flavor,
  Profile,
  UnitCode,
  VatCategoryCode,
  validateInput,
  type FacturXInvoiceInput,
} from "@stackforge-eu/factur-x";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { isValidInvoiceDate, resolvePaymentTerms } from "@workspace/spirecut-shared";

type Money = number | string | null | undefined;

/** The columns used by this adapter (deliberately compatible with Drizzle rows). */
export interface IrocFacturXInvoice {
  invoiceNumber: string;
  issueDate: string;
  invoiceType: string;
  vatRate: Money;
  deliveryCosts?: Money;
  insuranceCosts?: Money;
  dueDate?: string | null;
  orderNumber?: string | null;
  referenceNumber?: string | null;
  precedingInvoiceNumber?: string | null;
  originalInvoiceNumber?: string | null;
  buyerReference?: string | null;
  sellerVatId?: string | null;
  buyerVatId?: string | null;
  paymentTerms?: string | null;
  paymentTermCode?: string | null;
  isB2g?: boolean | null;
  notes?: string | null;
  language?: string | null;
}

export interface IrocFacturXCustomer {
  name: string;
  company?: string | null;
  address?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  vatId?: string | null;
  email?: string | null;
}

export interface IrocFacturXItem {
  id?: number | string;
  productName: string;
  description?: string | null;
  sku?: string | null;
  countryOfOrigin?: string | null;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
  vatRate?: Money;
}

export interface VatGroup {
  ratePercent: number;
  categoryCode: VatCategoryCode;
  exemptionReason?: string;
  lineNetCents: number;
  deliveryCents: number;
  insuranceCents: number;
  taxableCents: number;
  taxCents: number;
}

export interface FacturXCalculations {
  vatGroups: VatGroup[];
  lineTotalCents: number;
  deliveryCents: number;
  insuranceCents: number;
  taxBasisCents: number;
  taxTotalCents: number;
  grandTotalCents: number;
}

const SELLER = {
  name: "iROC GmbH",
  address: { line1: "St. Emmeram-Str. 26", city: "Aschheim", postalCode: "85609", country: "DE" },
  commercialRegisterId: "HRB 303391",
  iban: "DE85701308000001139550",
  bic: "GENODEF1M06",
};

const zeroVatTreatment = (invoiceType: string): Pick<VatGroup, "categoryCode" | "exemptionReason"> => {
  switch (invoiceType) {
    case "eu":
      return { categoryCode: VatCategoryCode.INTRA_COMMUNITY_SUPPLY, exemptionReason: "Intra-community supply" };
    case "export":
    case "noneu":
      return { categoryCode: VatCategoryCode.FREE_EXPORT, exemptionReason: "Export outside the EU" };
    case "lecture-eu":
      return { categoryCode: VatCategoryCode.REVERSE_CHARGE, exemptionReason: "Reverse charge" };
    case "lecture-noneu":
      return { categoryCode: VatCategoryCode.OUTSIDE_SCOPE, exemptionReason: "Supply outside the scope of VAT" };
    default:
      return { categoryCode: VatCategoryCode.ZERO_RATED, exemptionReason: "Zero rated" };
  }
};

function precedingInvoiceNumber(invoice: IrocFacturXInvoice): string | undefined {
  const snapshot = invoice.originalInvoiceNumber?.trim();
  if (snapshot) return snapshot;
  const explicit = invoice.precedingInvoiceNumber?.trim();
  if (explicit) return explicit;

  const reference = invoice.referenceNumber?.trim();
  const notes = invoice.notes?.trimStart();
  if (!reference || !notes) return undefined;

  const correctionLabels = [
    `Rechnungskorrektur zu ${reference}`,
    `Invoice correction for ${reference}`,
    // Legacy correction drafts retain their preceding-invoice relationship when
    // exported again. New documents use Rechnungskorrektur / Invoice correction.
    `Korrekturrechnung zu ${reference}`,
    `Correction invoice for ${reference}`,
  ];
  return correctionLabels.some(label => notes.startsWith(label)) ? reference : undefined;
}

/** Maps the iROC tax treatment to EN 16931's VAT category and exemption text. */
export function mapInvoiceTypeVat(invoiceType: string, vatRate: number): Pick<VatGroup, "categoryCode" | "exemptionReason"> {
  return vatRate === 0
    ? zeroVatTreatment(invoiceType)
    : { categoryCode: VatCategoryCode.STANDARD_RATE };
}

function cents(value: Money, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid monetary value for ${field}`);
  return Math.round((parsed + Number.EPSILON) * 100);
}

function rate(value: Money, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Invalid VAT rate for ${field}`);
  }
  return Math.round(parsed * 100) / 100;
}

/**
 * Allocates a cent amount using the largest-remainder method. This guarantees
 * that the allocations add up to exactly the original amount.
 */
function allocateCents(total: number, weights: number[]): number[] {
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return weights.map(() => 0);
  // Corrections use negative invoice lines and charges. Their absolute weights
  // have the same proportions as a regular invoice, so a negative denominator
  // is valid; only an exactly-zero basis cannot be apportioned.
  if (denominator === 0) throw new Error("Cannot allocate charges without taxable invoice lines");
  const shares = weights.map((weight, index) => {
    const exact = total * weight / denominator;
    return { index, floor: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let remainder = total - shares.reduce((sum, share) => sum + share.floor, 0);
  shares.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i++) shares[i % shares.length].floor++;
  const allocation = weights.map(() => 0);
  for (const share of shares) allocation[share.index] = share.floor;
  return allocation;
}

/** Calculates line VAT groups and apportions delivery and insurance in integer cents. */
export function calculateFacturXTotals(
  invoice: Pick<IrocFacturXInvoice, "invoiceType" | "vatRate" | "deliveryCosts" | "insuranceCosts">,
  items: IrocFacturXItem[],
): FacturXCalculations {
  if (!items.length) throw new Error("An EN 16931 invoice requires at least one line item");
  const groups = new Map<string, VatGroup>();
  for (const [index, item] of items.entries()) {
    const itemRate = rate(item.vatRate ?? invoice.vatRate, `item ${index + 1}`);
    const treatment = mapInvoiceTypeVat(invoice.invoiceType, itemRate);
    const key = `${treatment.categoryCode}:${itemRate}`;
    const group = groups.get(key) ?? {
      ratePercent: itemRate, ...treatment, lineNetCents: 0, deliveryCents: 0, insuranceCents: 0,
      taxableCents: 0, taxCents: 0,
    };
    group.lineNetCents += cents(item.lineTotal, `item ${index + 1}`);
    groups.set(key, group);
  }
  const vatGroups = [...groups.values()];
  const deliveryCents = cents(invoice.deliveryCosts ?? 0, "deliveryCosts");
  const insuranceCents = cents(invoice.insuranceCosts ?? 0, "insuranceCosts");
  const weights = vatGroups.map(group => group.lineNetCents);
  const deliveryAllocation = allocateCents(deliveryCents, weights);
  const insuranceAllocation = allocateCents(insuranceCents, weights);
  for (const [index, group] of vatGroups.entries()) {
    group.deliveryCents = deliveryAllocation[index];
    group.insuranceCents = insuranceAllocation[index];
    group.taxableCents = group.lineNetCents + group.deliveryCents + group.insuranceCents;
    group.taxCents = Math.round(group.taxableCents * group.ratePercent / 100);
  }
  const lineTotalCents = weights.reduce((sum, value) => sum + value, 0);
  const taxBasisCents = lineTotalCents + deliveryCents + insuranceCents;
  const taxTotalCents = vatGroups.reduce((sum, group) => sum + group.taxCents, 0);
  return { vatGroups, lineTotalCents, deliveryCents, insuranceCents, taxBasisCents, taxTotalCents, grandTotalCents: taxBasisCents + taxTotalCents };
}

const amount = (value: number) => value / 100;
const countryCode = (country: string | null | undefined) => {
  const value = (country ?? "").trim();
  const named: Record<string, string> = { germany: "DE", deutschland: "DE", austria: "AT", österreich: "AT", switzerland: "CH", schweiz: "CH" };
  return named[value.toLowerCase()] ?? value.toUpperCase();
};

/** Builds the exact EN 16931 input consumed by @stackforge-eu/factur-x. */
export function buildFacturXInvoiceInput(
  invoice: IrocFacturXInvoice,
  customer: IrocFacturXCustomer,
  items: IrocFacturXItem[],
): FacturXInvoiceInput {
  const calculations = calculateFacturXTotals(invoice, items);
  const paymentTerms = resolvePaymentTerms(invoice);
  if (paymentTerms.paymentTermCode === "custom" && !isValidInvoiceDate(paymentTerms.dueDate)) {
    throw new Error("Custom payment terms require a valid due date (YYYY-MM-DD)");
  }
  if (invoice.isB2g && !invoice.buyerReference?.trim()) {
    throw new Error("B2G invoices require a non-empty buyer reference (BT-10 / Leitweg-ID)");
  }
  const precedingInvoice = precedingInvoiceNumber(invoice);
  const hasOutsideScopeVat = calculations.vatGroups.some(
    group => group.categoryCode === VatCategoryCode.OUTSIDE_SCOPE,
  );
  const line1 = customer.address?.trim() || [customer.street, customer.houseNumber].filter(Boolean).join(" ").trim();
  const country = countryCode(customer.country);
  if (!customer.name?.trim() || !line1 || !customer.city?.trim() || !customer.postalCode?.trim() || !country) {
    throw new Error("Customer name, street address, city, postal code, and country are required for EN 16931");
  }
  const sellerVatId = invoice.sellerVatId?.trim() || "DE455683037";
  const buyerVatId = invoice.buyerVatId?.trim() || customer.vatId?.trim();
  if (!sellerVatId) throw new Error("Seller VAT ID is required for EN 16931");
  if (["eu", "lecture-eu"].includes(invoice.invoiceType) && !buyerVatId) {
    throw new Error("Buyer VAT ID is required for intra-community and reverse-charge invoices");
  }
  const charges = ([
    ["Delivery costs", calculations.deliveryCents],
    ["Insurance costs", calculations.insuranceCents],
  ] as const).flatMap(([reason, total]) => allocateCents(total, calculations.vatGroups.map(g => g.lineNetCents))
    .flatMap((allocated, index) => allocated ? [{
      isCharge: true, reason, amount: amount(allocated),
      vatCategoryCode: calculations.vatGroups[index].categoryCode,
      vatRatePercent: calculations.vatGroups[index].ratePercent,
    }] : []));
  return {
    document: {
      id: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      typeCode: precedingInvoice
        // UNTDID 381 is the EN 16931 credit-note document code for a negative
        // correction. The visual document deliberately remains labelled
        // Rechnungskorrektur / Invoice correction, not "Gutschrift", which has
        // a different meaning under German VAT law (recipient self-billing).
        ? DocumentTypeCode.CREDIT_NOTE
        : DocumentTypeCode.COMMERCIAL_INVOICE,
      dueDate: paymentTerms.dueDate,
      buyerReference: invoice.isB2g ? invoice.buyerReference!.trim() : undefined,
      language: invoice.language ?? undefined,
      notes: invoice.notes ? [{ content: invoice.notes }] : undefined,
    },
    seller: {
      name: SELLER.name,
      address: SELLER.address,
      legalOrganization: { id: SELLER.commercialRegisterId },
      taxRegistrations: hasOutsideScopeVat ? undefined : [{ id: sellerVatId, schemeId: "VA" }],
    },
    buyer: {
      name: customer.company?.trim() || customer.name,
      address: { line1, city: customer.city, postalCode: customer.postalCode, country },
      taxRegistrations: buyerVatId && !hasOutsideScopeVat ? [{ id: buyerVatId, schemeId: "VA" }] : undefined,
      electronicAddress: customer.email ? { value: customer.email, schemeID: "EM" } : undefined,
    },
    delivery: { date: invoice.issueDate },
    lines: items.map((item, index) => {
      const vatRate = rate(item.vatRate ?? invoice.vatRate, `item ${index + 1}`);
      const treatment = mapInvoiceTypeVat(invoice.invoiceType, vatRate);
      return {
        id: String(item.id ?? index + 1), name: item.productName, description: item.description ?? undefined,
        sellerAssignedId: item.sku ?? undefined, originCountry: item.countryOfOrigin ? countryCode(item.countryOfOrigin) : undefined,
        quantity: item.quantity, unitCode: UnitCode.UNIT, unitPrice: Number(item.unitPrice),
        lineTotal: amount(cents(item.lineTotal, `item ${index + 1}`)),
        vatCategoryCode: treatment.categoryCode,
        vatRatePercent: vatRate,
      };
    }),
    allowancesCharges: charges.length ? charges : undefined,
    totals: {
      lineTotal: amount(calculations.lineTotalCents), chargeTotal: amount(calculations.deliveryCents + calculations.insuranceCents),
      taxBasisTotal: amount(calculations.taxBasisCents), taxTotal: amount(calculations.taxTotalCents),
      grandTotal: amount(calculations.grandTotalCents), duePayableAmount: amount(calculations.grandTotalCents), currency: "EUR",
    },
    vatBreakdown: calculations.vatGroups.map(group => ({
      categoryCode: group.categoryCode,
      ratePercent: group.ratePercent,
      taxableAmount: amount(group.taxableCents),
      taxAmount: amount(group.taxCents), exemptionReason: group.exemptionReason,
    })),
    payment: {
      meansCode: "30", iban: SELLER.iban, bic: SELLER.bic, accountName: SELLER.name,
      dueDate: paymentTerms.dueDate, paymentReference: invoice.invoiceNumber,
      termsDescription: paymentTerms.description,
    },
    references: [
      ...(invoice.orderNumber ? [{ id: invoice.orderNumber, type: "order" as const }] : []),
      ...(precedingInvoice
        ? [{ id: precedingInvoice, type: "preceding" as const }]
        : []),
    ],
  };
}

/** Embeds a validated EN 16931 Factur-X XML file into the supplied visual PDF. */
export async function embedFacturXInvoice(
  visualPdf: Buffer,
  invoice: IrocFacturXInvoice,
  customer: IrocFacturXCustomer,
  items: IrocFacturXItem[],
): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  const pdfkitEntry = require.resolve("pdfkit");
  const rgbIccProfile = fs.readFileSync(path.join(path.dirname(pdfkitEntry), "data", "sRGB_IEC61966_2_1.icc"));
  const input = buildFacturXInvoiceInput(invoice, customer, items);
  const inputValidation = validateInput(input, Profile.EN16931, Flavor.FACTUR_X);
  if (!inputValidation.valid) {
    throw new Error(
      `Input validation failed for profile "${Profile.EN16931}":\n`
      + inputValidation.errors.map(error => `  - ${error.field}: ${error.message}`).join("\n"),
    );
  }
  // @stackforge-eu/factur-x 1.2.0 requires a numeric rate in its input and
  // builder, while EN 16931 BR-O-05 prohibits that element for category O.
  // Strip it only from outside-scope tax blocks before validating the exact XML.
  const xml = buildXml(input, Profile.EN16931, Flavor.FACTUR_X).replace(
    /<ram:ApplicableTradeTax>[\s\S]*?<\/ram:ApplicableTradeTax>/g,
    taxBlock => taxBlock.includes("<ram:CategoryCode>O</ram:CategoryCode>")
      ? taxBlock.replace(/<ram:RateApplicablePercent>[^<]*<\/ram:RateApplicablePercent>/g, "")
      : taxBlock,
  );
  const result = await embedFacturX({
    pdf: visualPdf, xml,
    profile: Profile.EN16931, flavor: Flavor.FACTUR_X, validateBeforeEmbed: false, validateXsd: true,
    addPdfA3Metadata: true, rgbIccProfile, unembeddedFonts: "throw",
    meta: { author: SELLER.name, title: `Invoice ${invoice.invoiceNumber}`, creator: "iROC" },
  });
  return Buffer.from(result.pdf);
}