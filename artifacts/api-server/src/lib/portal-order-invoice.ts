import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { canonicalCountry } from "./sally-invoice.js";
import { recipientLanguageForCountry } from "./recipient-language.js";
import { logger } from "./logger.js";

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DK", "EE", "ES", "FI", "FR", "GR", "HR",
  "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE",
  "SI", "SK",
]);

export type PortalOrderProduct = {
  id: number;
  sku: string;
  nameEn: string;
  nameDe: string;
  descriptionEn: string | null;
  descriptionDe: string | null;
  unitPrice: string;
  category: string;
  quantity: number;
};

export type PortalOrderCustomer = {
  id: number;
  customerNr: string | null;
  institutionName: string | null;
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  instrument: string;
  ustIdNr: string | null;
  isPublicAuthority: boolean;
  defaultBuyerReference: string | null;
};

export type CreatePortalOrderInput = {
  customer: PortalOrderCustomer;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  deliveryAddress: string;
  notes: string | null;
  products: PortalOrderProduct[];
};

export type PortalOrderInvoiceResult = {
  orderId: number;
  invoiceId: number | null;
  invoiceNumber: string | null;
  invoiceStatus: "draft" | null;
};

export async function createPortalOrderAndDraftInvoice(
  input: CreatePortalOrderInput,
  options: { createInvoice?: boolean } = {},
): Promise<PortalOrderInvoiceResult> {
  const createInvoice = options.createInvoice !== false;
  const country = canonicalCountry(input.customer.country);
  const language = recipientLanguageForCountry(country);
  const invoiceType = country === "DE" ? "domestic" : EU_COUNTRIES.has(country) ? "eu" : "noneu";
  const vatRate = invoiceType === "domestic" ? 19 : 0;
  const productSummary = input.products
    .map((product) => `${product.quantity} × ${language === "de" ? product.nameDe : product.nameEn}`)
    .join("\n");
  const companyName = input.customer.institutionName
    ?? [input.customer.firstName, input.customer.lastName].filter(Boolean).join(" ")
    ?? null;
  const today = new Date().toISOString().slice(0, 10);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { generateInvoiceNumber } = await import("../routes/iroc.js");
    const invoiceNumber = createInvoice ? await generateInvoiceNumber() : null;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: previousDiscounts } = await client.query<{
        product_id: number;
        discount_percent: string;
      }>(
        `SELECT DISTINCT ON (ii.product_id)
                ii.product_id, ii.discount_percent::text AS discount_percent
           FROM iroc_invoice_items ii
           INNER JOIN iroc_invoices i ON i.id = ii.invoice_id
          WHERE i.website_customer_id = $1
            AND ii.product_id = ANY($2::integer[])
            AND ii.discount_percent IS NOT NULL
            AND ii.discount_percent::numeric > 0
          ORDER BY ii.product_id, i.issue_date DESC, i.id DESC`,
        [input.customer.id, input.products.map((product) => product.id)],
      );
      const discountByProductId = new Map(
        previousDiscounts.map((row) => [row.product_id, Number(row.discount_percent)]),
      );
      const lineValues = input.products.map((product) => {
        const unitPrice = Number(product.unitPrice);
        const discountPercent = discountByProductId.get(product.id) ?? null;
        const discountRate = discountPercent ?? 0;
        const discountedUnitPrice = unitPrice * (1 - discountRate / 100);
        return {
          product,
          unitPrice,
          discountPercent,
          lineTotal: discountedUnitPrice * product.quantity,
        };
      });
      const subtotal = lineValues.reduce((sum, line) => sum + line.lineTotal, 0);
      const vatAmount = subtotal * vatRate / 100;
      const total = subtotal + vatAmount;
      const { rows: orders } = await client.query<{ id: number }>(
        `INSERT INTO iroc_orders
           (website_customer_id, customer_type, customer_nr, company_name,
            contact_name, contact_email, contact_phone, instrument, products,
            delivery_address, notes, approval_token, status, approved_at,
            contact_language, sally_review_status, sally_review_result)
         VALUES ($1, 'existing', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 'approved', NOW(), $12, 'complete', $13)
         RETURNING id`,
        [
          input.customer.id,
          input.customer.customerNr,
          companyName,
          input.contactName,
          input.contactEmail,
          input.contactPhone,
          input.customer.instrument,
          productSummary,
          input.deliveryAddress,
          input.notes,
          crypto.randomBytes(24).toString("hex"),
          language,
          JSON.stringify({ source: "iroc_portal", structuredProducts: true }),
        ],
      );
      const orderId = orders[0].id;
      if (!createInvoice) {
        await client.query(
          `INSERT INTO iroc_notifications (type, message)
           VALUES ('portal_order', $1)`,
          [JSON.stringify({
            de: `Portal-Bestellung #${orderId} wurde erstellt; automatische Rechnungserstellung ist pausiert`,
            en: `Portal order #${orderId} was created; automatic invoice creation is paused`,
          })],
        );
        await client.query("COMMIT");
        logger.info(
          { orderId, customerId: input.customer.id },
          "Portal order created without a draft invoice because automatic invoice creation is paused",
        );
        return { orderId, invoiceId: null, invoiceNumber: null, invoiceStatus: null };
      }
      const note = language === "de"
        ? `Automatisch aus iROC-Portal-Bestellung #${orderId} erstellt — bitte vor Versand prüfen.`
        : `Automatically created from iROC Portal order #${orderId} — review before sending.`;
      const { rows: invoices } = await client.query<{ id: number }>(
        `INSERT INTO iroc_invoices
           (invoice_number, website_customer_id, invoice_type, issue_date,
            order_number, buyer_reference, buyer_vat_id, is_b2g,
            delivery_costs, insurance_costs, subtotal, vat_rate, vat_amount,
            total, status, notes, language, source_order_id, sally_generated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 '0', '0', $9, $10, $11, $12, 'draft', $13, $14, $15, false)
         RETURNING id`,
        [
          invoiceNumber,
          input.customer.id,
          invoiceType,
          today,
          `PORTAL-${orderId}`,
          input.customer.defaultBuyerReference,
          input.customer.ustIdNr,
          input.customer.isPublicAuthority,
          subtotal.toFixed(2),
          vatRate.toFixed(2),
          vatAmount.toFixed(2),
          total.toFixed(2),
          note,
          language,
          orderId,
        ],
      );
      const invoiceId = invoices[0].id;

      for (const line of lineValues) {
        const { product } = line;
        await client.query(
          `INSERT INTO iroc_invoice_items
             (invoice_id, product_id, product_name, sku, description,
              unit_price, discount_percent, quantity, line_total, vat_rate)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            invoiceId,
            product.id,
            language === "de" ? product.nameDe : product.nameEn,
            product.sku,
            language === "de" ? product.descriptionDe : product.descriptionEn,
            line.unitPrice.toFixed(2),
            line.discountPercent === null ? null : line.discountPercent.toFixed(2),
            product.quantity,
            line.lineTotal.toFixed(2),
            vatRate.toFixed(2),
          ],
        );
      }

      await client.query(
        `INSERT INTO iroc_notifications (type, message)
         VALUES ('portal_order', $1)`,
        [JSON.stringify({
          de: `Portal-Bestellung #${orderId} und Rechnungsentwurf ${invoiceNumber} wurden erstellt`,
          en: `Portal order #${orderId} and draft invoice ${invoiceNumber} were created`,
        })],
      );
      await client.query("COMMIT");
      logger.info(
        { orderId, invoiceId, invoiceNumber, customerId: input.customer.id },
        "Portal order and draft invoice created",
      );
      return { orderId, invoiceId, invoiceNumber, invoiceStatus: "draft" };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      const uniqueInvoiceNumber = (error as { code?: string; constraint?: string })?.code === "23505"
        && String((error as { constraint?: string }).constraint ?? "").includes("invoice_number");
      if (uniqueInvoiceNumber && attempt < 3) {
        logger.warn({ invoiceNumber, attempt }, "Portal invoice number collision — retrying");
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  throw new Error("Unable to allocate an invoice number");
}