/**
 * Sally auto-invoicing (#496).
 *
 * 1. When an approved website order passes Sally's review as 'complete' AND is
 *    linked to a website customer, Sally drafts an invoice automatically:
 *    - product lines parsed from the order's free-text via Gemini and matched
 *      against the iroc_products catalog (unmapped items flagged with price 0)
 *    - invoice language = the linked customer's authoritative country
 *    - VAT/invoice type defaulted from the customer's country
 *    - dedupe via UNIQUE index on iroc_invoices.source_order_id
 *
 * 2. When any invoice with a website customer moves draft → sent, Sally queues
 *    a short "your order is on the way" email (trigger_type='invoice_dispatch',
 *    admin approval required). At send time the invoice PDF + delivery note PDF
 *    are rendered and attached (see attachment hook in sally-cron.ts).
 *
 * NB: imports from routes/iroc.js are dynamic to avoid a static import cycle
 * (iroc.ts imports this module for the draft→sent hook).
 */
import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { SALLY_AUTO_INVOICE_KEY, isSallyAutomationEnabled } from "./sally-controls.js";
import PDFDocument from "pdfkit";
import { recipientLanguageForCountry, resolveRecipientLanguage } from "./recipient-language.js";
import { appendImpressumSignature } from "./impressum-signature.js";
import { invalidSallyEmailContentField } from "./sally-email-content.js";

const EU = new Set(["AT","BE","BG","CY","CZ","DK","EE","FI","FR","GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK"]);

/**
 * Canonicalize a free-text country value to an ISO 3166-1 alpha-2 code.
 * The website country field is free text, so German/English names and common
 * variants must be recognized; unknown values return the uppercased input.
 */
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  // Germany
  "GERMANY": "DE", "DEUTSCHLAND": "DE",
  // EU members (German + English names, common variants)
  "AUSTRIA": "AT", "ÖSTERREICH": "AT", "OESTERREICH": "AT",
  "BELGIUM": "BE", "BELGIEN": "BE",
  "BULGARIA": "BG", "BULGARIEN": "BG",
  "CYPRUS": "CY", "ZYPERN": "CY",
  "CZECH REPUBLIC": "CZ", "CZECHIA": "CZ", "TSCHECHIEN": "CZ", "TSCHECHISCHE REPUBLIK": "CZ",
  "DENMARK": "DK", "DÄNEMARK": "DK", "DAENEMARK": "DK",
  "ESTONIA": "EE", "ESTLAND": "EE",
  "FINLAND": "FI", "FINNLAND": "FI",
  "FRANCE": "FR", "FRANKREICH": "FR",
  "GREECE": "GR", "GRIECHENLAND": "GR",
  "CROATIA": "HR", "KROATIEN": "HR",
  "HUNGARY": "HU", "UNGARN": "HU",
  "IRELAND": "IE", "IRLAND": "IE",
  "ITALY": "IT", "ITALIEN": "IT",
  "LITHUANIA": "LT", "LITAUEN": "LT",
  "LUXEMBOURG": "LU", "LUXEMBURG": "LU",
  "LATVIA": "LV", "LETTLAND": "LV",
  "MALTA": "MT",
  "NETHERLANDS": "NL", "NIEDERLANDE": "NL", "HOLLAND": "NL",
  "POLAND": "PL", "POLEN": "PL",
  "PORTUGAL": "PT",
  "ROMANIA": "RO", "RUMÄNIEN": "RO", "RUMAENIEN": "RO",
  "SWEDEN": "SE", "SCHWEDEN": "SE",
  "SLOVENIA": "SI", "SLOWENIEN": "SI",
  "SLOVAKIA": "SK", "SLOWAKEI": "SK",
  "SPAIN": "ES", "SPANIEN": "ES",
  // Common non-EU
  "SWITZERLAND": "CH", "SCHWEIZ": "CH",
  "UNITED KINGDOM": "GB", "GREAT BRITAIN": "GB", "UK": "GB", "GROSSBRITANNIEN": "GB", "GROßBRITANNIEN": "GB", "ENGLAND": "GB",
  "UNITED STATES": "US", "USA": "US", "UNITED STATES OF AMERICA": "US", "VEREINIGTE STAATEN": "US",
  "NORWAY": "NO", "NORWEGEN": "NO",
  "TURKEY": "TR", "TÜRKEI": "TR", "TUERKEI": "TR",
};
// ES is an EU member missing from the code set above (kept in sync with wcToCustomerShape)
const EU_FULL = new Set([...EU, "ES"]);

export function canonicalCountry(raw: string | null | undefined): string {
  const v = String(raw ?? "DE").trim().toUpperCase();
  if (!v) return "DE";
  if (v.length === 2) return v;
  return COUNTRY_NAME_TO_ISO[v] ?? v;
}

interface ParsedLine {
  product_id: number | null;
  name: string;
  quantity: number;
}

interface CatalogRow {
  id: number;
  sku: string;
  name_de: string;
  name_en: string;
  description_de: string | null;
  description_en: string | null;
  unit_price: string;
  category: string;
}

async function geminiParseOrderLines(
  productsText: string,
  instrument: string,
  catalog: CatalogRow[],
): Promise<ParsedLine[] | null> {
  if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || !process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    logger.warn("Sally: Gemini not configured — invoice line parsing skipped");
    return null;
  }
  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const catalogList = catalog
      .map(p => `id=${p.id} | sku=${p.sku} | de="${p.name_de}" | en="${p.name_en}" | category=${p.category}`)
      .join("\n");

    const prompt = `You convert a customer's free-text order lines into structured invoice line items.

PRODUCT CATALOG:
${catalogList}

ORDER (instrument context: ${instrument}):
${productsText}

Rules:
- Match each ordered item to exactly one catalog product when the name/SKU clearly corresponds (fuzzy matching on German or English name or SKU is fine).
- If an item cannot be confidently matched, return it with "product_id": null and keep the customer's wording as "name".
- Quantities: use the stated quantity; default to 1 if none is given.
- Never invent items that are not in the order text.

Respond with ONLY a JSON array, no markdown:
[{"product_id": <catalog id or null>, "name": "<line description>", "quantity": <integer >= 1>}]`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed
      .filter((l: unknown): l is Record<string, unknown> => !!l && typeof l === "object")
      .map((l) => ({
        product_id: typeof l.product_id === "number" ? l.product_id : null,
        name: String(l.name ?? "").trim() || "(unnamed item)",
        quantity: Math.max(1, Math.round(Number(l.quantity) || 1)),
      }));
  } catch (err) {
    logger.error({ err }, "Sally: invoice line parsing AI call failed");
    return null;
  }
}

/**
 * Creates a draft invoice for a reviewed-complete order. Idempotent:
 * - skips if an invoice already exists for the order (unique source_order_id)
 * - skips (retried by cron) if the order has no linked website customer yet
 * Returns 'created' | 'exists' | 'no_customer' | 'skipped' | null on failure.
 */
export async function generateDraftInvoiceForOrder(orderId: number): Promise<string | null> {
  if (!(await isSallyAutomationEnabled(SALLY_AUTO_INVOICE_KEY))) {
    logger.info({ orderId }, "Sally automatic invoice creation is paused");
    return null;
  }
  try {
    const { rows: orders } = await pool.query(
      `SELECT * FROM iroc_orders
       WHERE id = $1 AND status = 'approved' AND sally_review_status = 'complete'`,
      [orderId],
    );
    const order = orders[0];
    if (!order) return "skipped";

    const { rows: existing } = await pool.query(
      "SELECT id FROM iroc_invoices WHERE source_order_id = $1",
      [orderId],
    );
    if (existing.length) return "exists";

    if (!order.website_customer_id) {
      logger.info({ orderId }, "Sally: order complete but not linked to a website customer — invoice deferred");
      return "no_customer";
    }

    const { rows: wcs } = await pool.query(
      "SELECT * FROM website_customers WHERE id = $1",
      [order.website_customer_id],
    );
    const wc = wcs[0];
    if (!wc) return "no_customer";

    const { rows: catalog } = await pool.query<CatalogRow>(
      `SELECT id, sku, name_de, name_en, description_de, description_en,
              unit_price::text AS unit_price, category
         FROM iroc_products
        ORDER BY id`,
    );

    const lines = await geminiParseOrderLines(order.products ?? "", order.instrument, catalog);
    if (!lines) return null; // AI unavailable/failed — cron retries later

    const byId = new Map(catalog.map(p => [p.id, p]));

    // Build items: mapped lines take catalog name + price; unmapped are flagged.
    const unmapped: string[] = [];
    const language = await resolveRecipientLanguage({
      email: wc.email,
      websiteCustomerId: order.website_customer_id,
    });
    const items = lines.map((l) => {
      const p = l.product_id != null ? byId.get(l.product_id) : undefined;
      if (!p) unmapped.push(`${l.quantity}× ${l.name}`);
      const unitPrice = p ? parseFloat(p.unit_price) : 0;
      return {
        productId:   p ? p.id : null,
        productName: p ? (language === "en" ? p.name_en : p.name_de) : l.name,
        sku:         p ? p.sku : null,
        description: p
          ? (language === "en" ? p.description_en : p.description_de)
          : "⚠ Kein Produkt-Link / no product link — bitte prüfen",
        unitPrice,
        quantity:    l.quantity,
        lineTotal:   unitPrice * l.quantity,
      };
    });

    // VAT / invoice type defaults from the customer's country (free-text → ISO)
    const country = canonicalCountry(wc.country);
    const isDomestic = country === "DE";
    const invoiceType = isDomestic ? "domestic" : EU_FULL.has(country) ? "eu" : "noneu";
    const vatRate = isDomestic ? 19 : 0;

    const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
    const vatAmount = (subtotal * vatRate) / 100;
    const total = subtotal + vatAmount;

    const { generateInvoiceNumber } = await import("../routes/iroc.js");
    const today = new Date().toISOString().slice(0, 10);

    const noteLines = [
      `Von Sally automatisch aus Website-Bestellung #${orderId} erstellt — bitte vor Versand prüfen.`,
      ...(unmapped.length
        ? [`Nicht zugeordnete Positionen (Preis 0, manuell prüfen): ${unmapped.join("; ")}`]
        : []),
    ];

    // Invoice header, line items and notification commit atomically — a failure
    // in any line insert must not leave a header-only invoice behind.
    // generateInvoiceNumber() is max+1 based and can race with a concurrent
    // manual create, so retry on invoice_number unique violations.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const invoiceNumber = await generateInvoiceNumber();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows: created } = await client.query<{ id: number }>(
          `INSERT INTO iroc_invoices
             (invoice_number, website_customer_id, invoice_type, issue_date, order_number,
              delivery_costs, subtotal, vat_rate, vat_amount, total,
              status, notes, language, source_order_id, sally_generated)
           VALUES ($1, $2, $3, $4, $5, '0', $6, $7, $8, $9, 'draft', $10, $11, $12, true)
           ON CONFLICT (source_order_id) WHERE source_order_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [
            invoiceNumber, order.website_customer_id, invoiceType, today, `WEB-${orderId}`,
            subtotal.toFixed(2), vatRate.toFixed(2), vatAmount.toFixed(2), total.toFixed(2),
            noteLines.join("\n"), language, orderId,
          ],
        );
        if (!created.length) {
          await client.query("ROLLBACK");
          return "exists"; // concurrent worker won the race
        }

        const invoiceId = created[0].id;
        for (const i of items) {
          await client.query(
            `INSERT INTO iroc_invoice_items
               (invoice_id, product_id, product_name, sku, description, unit_price, quantity, line_total)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [invoiceId, i.productId, i.productName, i.sku, i.description,
             i.unitPrice.toFixed(2), i.quantity, i.lineTotal.toFixed(2)],
          );
        }

        await client.query(
          `INSERT INTO iroc_notifications (type, message)
           VALUES ('sally_invoice', $1)`,
          [JSON.stringify({
            de: `Sally hat Rechnungsentwurf ${invoiceNumber} aus Bestellung #${orderId} erstellt${unmapped.length ? ` (${unmapped.length} Position(en) ohne Produkt-Link)` : ""}`,
            en: `Sally created draft invoice ${invoiceNumber} from order #${orderId}${unmapped.length ? ` (${unmapped.length} item(s) without product link)` : ""}`,
          })],
        );

        await client.query("COMMIT");
        logger.info({ orderId, invoiceId, invoiceNumber, unmapped: unmapped.length }, "Sally: draft invoice created from order");
        return "created";
      } catch (err: unknown) {
        await client.query("ROLLBACK").catch(() => {});
        const uniqueViolation = (err as { code?: string })?.code === "23505"
          && String((err as { constraint?: string })?.constraint ?? "").includes("invoice_number");
        if (uniqueViolation && attempt < 3) {
          logger.warn({ orderId, invoiceNumber, attempt }, "Sally: invoice number collision — retrying");
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
    return null; // exhausted retries
  } catch (err) {
    logger.error({ err, orderId }, "Sally: draft invoice generation failed");
    return null;
  }
}

/** Cron sweep: draft invoices for reviewed-complete orders that don't have one yet. */
export async function generateInvoicesForCompleteOrders(): Promise<void> {
  if (!(await isSallyAutomationEnabled(SALLY_AUTO_INVOICE_KEY))) {
    logger.info("Sally automatic invoice creation is paused");
    return;
  }
  const { rows } = await pool.query<{ id: number }>(
    `SELECT o.id FROM iroc_orders o
     WHERE o.status = 'approved' AND o.sally_review_status = 'complete'
       AND o.website_customer_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM iroc_invoices i WHERE i.source_order_id = o.id)
     ORDER BY o.id
     LIMIT 10`,
  );
  for (const r of rows) {
    await generateDraftInvoiceForOrder(r.id);
  }
}

// ── Dispatch email on invoice draft → sent ────────────────────────────────────

// ── Date formatter (mirrors iroc.ts fmtDate; needed for email bodies) ────────
function fmtDateSally(iso: string, lang: "de" | "en"): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  if (lang === "de") return `${d}.${m}.${y}`;
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] ?? m} ${y}`;
}

// ── Build locale-appropriate greeting names from a website_customers row ──────
function buildGreetingNames(wc: {
  salutation?: string | null;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  institution_name?: string | null;
  email?: string | null;
}): { nameDE: string; nameEN: string } {
  const nameDE =
    [wc.salutation, wc.title, wc.first_name, wc.last_name].filter(Boolean).join(" ") ||
    (wc.institution_name as string | null) ||
    (wc.email as string | null) ||
    "";
  // For English: omit German salutation (Herr/Frau); keep title + first + last
  const nameEN =
    [wc.title, wc.first_name, wc.last_name].filter(Boolean).join(" ") ||
    (wc.institution_name as string | null) ||
    (wc.email as string | null) ||
    "";
  return { nameDE, nameEN };
}

function dispatchEmailTemplate(
  language: string,
  sallyName: string,
  invoiceNumber: string,
  nameDE: string,
  nameEN: string,
) {
  if (language === "en") {
    return {
      subject: `Your iROC order is on the way (Invoice ${invoiceNumber})`,
      body: `Dear ${nameEN},

good news — your order is on its way to you. Please find the invoice and delivery note attached.

If you have any questions, simply reply to this email.

Best regards
${sallyName}
Sales Manager, iROC GmbH`,
    };
  }
  return {
    subject: `Ihre iROC-Bestellung ist unterwegs (Rechnung ${invoiceNumber})`,
    body: `Guten Tag ${nameDE},

gute Nachrichten — Ihre Bestellung ist auf dem Weg zu Ihnen. Rechnung und Lieferschein finden Sie im Anhang.

Bei Fragen antworten Sie einfach auf diese E-Mail.

Mit freundlichen Grüßen
${sallyName}
Sales Manager, iROC GmbH`,
  };
}

/**
 * Queues the "on the way" email(s) for an invoice that just moved draft → sent.
 * Two separately reviewable queue rows:
 *  - billing email → trigger 'invoice_dispatch' (invoice + delivery note attached)
 *  - distinct shipping email → trigger 'invoice_dispatch_shipping'
 *    (delivery note ONLY — billing documents are never disclosed to the
 *     shipping address)
 * Idempotent via the partial unique index on (related_invoice_id, trigger_type).
 * PDFs are attached at approval/send time (sally-cron.ts).
 */
export async function queueInvoiceDispatchEmail(invoiceId: number): Promise<void> {
  try {
    const { rows: invs } = await pool.query(
      "SELECT * FROM iroc_invoices WHERE id = $1",
      [invoiceId],
    );
    const inv = invs[0];
    if (!inv || inv.status !== "sent") return;
    if (!inv.website_customer_id) {
      logger.info({ invoiceId }, "Sally: invoice sent but no website customer — dispatch email skipped");
      return;
    }
    const { rows: wcs } = await pool.query(
      "SELECT * FROM website_customers WHERE id = $1",
      [inv.website_customer_id],
    );
    const wc = wcs[0];
    if (!wc?.email?.trim()) return;

    const billingEmail = wc.email.trim() as string;
    const shipEmail = (wc.shipping_email as string | null)?.trim();
    const distinctShipping = shipEmail && shipEmail.toLowerCase() !== billingEmail.toLowerCase() ? shipEmail : null;

    const { rows: settings } = await pool.query<{ key: string; value: string }>(
      "SELECT key, value FROM settings WHERE key = 'sally_from_name'",
    );
    const sallyName = settings[0]?.value || "Sally";
    const { nameDE, nameEN } = buildGreetingNames(wc);
    const billingLanguage = recipientLanguageForCountry(wc.country);

    // Billing recipient: invoice + delivery note.
    // Distinct shipping recipient: separate queue row, delivery note only
    // (never disclose billing documents to the shipping address).
    const rows: [string, string, "de" | "en"][] = [[billingEmail, "invoice_dispatch", billingLanguage]];
    if (distinctShipping) {
      rows.push([
        distinctShipping,
        "invoice_dispatch_shipping",
        recipientLanguageForCountry(wc.shipping_country || wc.country),
      ]);
    }

    for (const [recipient, triggerType, language] of rows) {
      const { subject, body } = dispatchEmailTemplate(language, sallyName, inv.invoice_number, nameDE, nameEN);
      const invalidField = invalidSallyEmailContentField(subject, body);
      if (invalidField) {
        logger.warn({ invoiceId, recipient, triggerType, invalidField }, "Sally: skipped invoice dispatch draft with blank content");
        continue;
      }
      const bodyWithImpressum = await appendImpressumSignature(body, language);
      const invalidSignedField = invalidSallyEmailContentField(subject, bodyWithImpressum);
      if (invalidSignedField) {
        logger.warn({ invoiceId, recipient, triggerType, invalidField: invalidSignedField }, "Sally: blank invoice dispatch content was not queued");
        continue;
      }
      const { rowCount } = await pool.query(
        `INSERT INTO sally_email_queue
           (recipient_email, subject, body, trigger_type, status, related_invoice_id, detected_language)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6)
         ON CONFLICT (related_invoice_id, trigger_type)
           WHERE trigger_type IN ('invoice_dispatch', 'invoice_dispatch_shipping') AND status IN ('pending', 'sent')
         DO NOTHING`,
        [recipient, subject, bodyWithImpressum, triggerType, invoiceId, language],
      );
      if (rowCount) {
        logger.info({ invoiceId, recipient, triggerType }, "Sally: invoice dispatch email queued for approval");
      }
    }
  } catch (err) {
    logger.error({ err, invoiceId }, "Sally: queuing invoice dispatch email failed");
  }
}

// ── Payment reminder email ────────────────────────────────────────────────────

function ordinalSuffix(n: number): string {
  if (n === 2) return "nd";
  if (n === 3) return "rd";
  return n === 1 ? "st" : "th";
}

function paymentReminderTemplate(
  invoiceNumber: string,
  total: string | number,
  issueDate: string,
  nameDE: string,
  nameEN: string,
  reminderCount: number,
  language: "de" | "en",
): { subject: string; body: string } {
  if (language === "en") {
    const n = typeof total === "string" ? parseFloat(total) : total;
    const formattedTotal = isNaN(n)
      ? String(total)
      : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return {
      subject: `Payment Reminder – Invoice ${invoiceNumber}${reminderCount > 1 ? ` (${reminderCount}${ordinalSuffix(reminderCount)} Reminder)` : ""}`,
      body: `Dear ${nameEN},

We would like to kindly draw your attention to the following outstanding invoice:

  Invoice number:    ${invoiceNumber}
  Invoice date:      ${fmtDateSally(issueDate, "en")}
  Amount due:        EUR ${formattedTotal}

We kindly ask you to arrange payment of the outstanding amount to the bank account referenced in the attached invoice at your earliest convenience.

If you have already arranged payment, please disregard this notice.

Should you have any questions, please do not hesitate to contact us.

Kind regards,
iROC GmbH`,
    };
  }
  const countTag = reminderCount > 1
    ? ` (${reminderCount}. Erinnerung)`
    : "";
  const subject = `Zahlungserinnerung – Rechnung ${invoiceNumber}${countTag}`;

  const n = typeof total === "string" ? parseFloat(total) : total;
  const formattedTotal = isNaN(n)
    ? String(total)
    : n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Locale-formatted date
  const issueDateDE = fmtDateSally(issueDate, "de");

  const body =
`Sehr geehrte/r ${nameDE},

wir erlauben uns, Sie freundlich daran zu erinnern, dass die nachstehende Rechnung gemäß unseren Unterlagen noch offen ist:

  Rechnungsnummer:   ${invoiceNumber}
  Rechnungsdatum:    ${issueDateDE}
  Offener Betrag:    EUR ${formattedTotal}

Wir bitten Sie, den ausstehenden Betrag umgehend auf das in der beigefügten Rechnung angegebene Konto zu überweisen.

Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie bitte dieses Schreiben als gegenstandslos.

Für Rückfragen stehen wir Ihnen jederzeit gerne zur Verfügung.

Mit freundlichen Grüßen
iROC GmbH`;

  return { subject, body };
}

/**
 * Queues a payment reminder for an overdue invoice (status='sent' for ≥10 days).
 * Idempotent: the partial unique index on (related_invoice_id) WHERE
 * trigger_type='payment_reminder' AND status='pending' prevents duplicates.
 * Returns true if a new queue row was inserted.
 */
export async function queuePaymentReminderEmail(
  invoiceId: number,
  reminderCount: number,
): Promise<boolean> {
  try {
    const { rows: invs } = await pool.query(
      "SELECT * FROM iroc_invoices WHERE id = $1",
      [invoiceId],
    );
    const inv = invs[0];
    if (!inv || inv.status !== "sent") return false;
    if (inv.reminder_suppressed) {
      logger.info({ invoiceId }, "Sally: payment reminder skipped — reminders suppressed for this invoice");
      return false;
    }
    if (!inv.website_customer_id) {
      logger.info({ invoiceId }, "Sally: payment reminder skipped — no website customer");
      return false;
    }

    const { rows: wcs } = await pool.query(
      "SELECT * FROM website_customers WHERE id = $1",
      [inv.website_customer_id],
    );
    const wc = wcs[0];
    if (!wc?.email) {
      logger.warn({ invoiceId }, "Sally: payment reminder skipped — customer has no billing email");
      // Notify the admin so they can add the missing email before the next sweep.
      await pool.query(
        `INSERT INTO iroc_notifications (type, message)
         VALUES ('payment_reminder_skipped', $1)`,
        [JSON.stringify({
          de: `Zahlungserinnerung für Rechnung ${inv.invoice_number} übersprungen – beim Kunden ist keine E-Mail-Adresse hinterlegt.`,
          en: `Payment reminder for invoice ${inv.invoice_number} skipped — customer has no billing email on file.`,
        })],
      ).catch((err: unknown) => {
        logger.error({ err, invoiceId }, "Sally: failed to insert payment_reminder_skipped notification");
      });
      return false;
    }

    const { nameDE, nameEN } = buildGreetingNames(wc);
    const issueDate: string =
      typeof inv.issue_date === "string"
        ? inv.issue_date
        : (inv.issue_date as Date | null)?.toISOString().slice(0, 10) ??
          (inv.created_at as Date).toISOString().slice(0, 10);

    const language = recipientLanguageForCountry(wc.country);
    const { subject, body } = paymentReminderTemplate(
      inv.invoice_number,
      inv.total,
      issueDate,
      nameDE,
      nameEN,
      reminderCount,
      language,
    );
    const bodyWithImpressum = await appendImpressumSignature(body, language);
    const invalidField = invalidSallyEmailContentField(subject, bodyWithImpressum);
    if (invalidField) {
      logger.warn({ invoiceId, recipient: wc.email, invalidField }, "Sally: blank payment reminder content was not queued");
      return false;
    }

    const { rowCount } = await pool.query(
      `INSERT INTO sally_email_queue
         (recipient_email, subject, body, trigger_type, status, related_invoice_id, detected_language)
       VALUES ($1, $2, $3, 'payment_reminder', 'pending', $4, $5)
       ON CONFLICT (related_invoice_id)
         WHERE trigger_type = 'payment_reminder' AND status = 'pending'
       DO NOTHING`,
      [wc.email, subject, bodyWithImpressum, invoiceId, language],
    );

    const inserted = (rowCount ?? 0) > 0;
    if (inserted) {
      logger.info(
        { invoiceId, reminderCount, recipient: wc.email },
        "Sally: payment reminder queued for admin approval",
      );
    }
    return inserted;
  } catch (err) {
    logger.error({ err, invoiceId }, "Sally: queuing payment reminder email failed");
    return false;
  }
}

// ── PDF rendering for attachments (used by approveAndSendEmail) ───────────────

export async function renderInvoiceAttachments(
  invoiceId: number,
  opts: { includeInvoice?: boolean } = {},
): Promise<{ filename: string; content: Buffer; contentType: string }[]> {
  const includeInvoice = opts.includeInvoice !== false;
  const iroc = await import("../routes/iroc.js");
  const { db, irocInvoices, irocInvoiceItems, websiteCustomersTable, irocCustomers } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");

  const [row] = await db.select().from(irocInvoices).where(eq(irocInvoices.id, invoiceId));
  if (!row) throw new Error(`Invoice ${invoiceId} not found`);

  let customer: any;
  let shippingInfo: any;
  if (row.websiteCustomerId) {
    const [wc] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, row.websiteCustomerId));
    if (wc) {
      customer = iroc.wcToCustomerShape(wc);
      shippingInfo = iroc.wcToShippingInfo(wc);
    }
  }
  if (!customer && row.customerId) {
    [customer] = await db.select().from(irocCustomers).where(eq(irocCustomers.id, row.customerId));
  }
  const items = await db.select().from(irocInvoiceItems).where(eq(irocInvoiceItems.invoiceId, invoiceId));

  const render = (build: (doc: InstanceType<typeof PDFDocument>) => void) =>
    new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margins: { top: 36, bottom: 10, left: 42, right: 42 }, autoFirstPage: true, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      build(doc);
      doc.flushPages();
      doc.end();
    });

  const deliveryPdf = await render((doc) => iroc.buildDeliveryNotePDF(doc, row, customer, items, shippingInfo));
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  if (includeInvoice) {
    const invoicePdf = await iroc.renderHybridInvoicePdf(row, customer, items);
    attachments.push({ filename: `${row.invoiceNumber}.pdf`, content: invoicePdf, contentType: "application/pdf" });
  }
  attachments.push({ filename: `LS-${row.invoiceNumber}.pdf`, content: deliveryPdf, contentType: "application/pdf" });
  return attachments;
}
