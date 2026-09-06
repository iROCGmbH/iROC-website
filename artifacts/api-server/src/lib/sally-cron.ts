/**
 * Sally CRM background jobs.
 *
 * Scheduling strategy: a lightweight interval fires every hour and checks
 * whether each daily/periodic job is due to run (tracked via the settings table).
 *
 * Jobs:
 *  - daily_leads   : 4-week follow-up + 2-month reminder for unregistered leads
 *  - daily_doctors : 2-month check-in for certified doctors
 *  - promo         : 6-month bulk promotion scan for certified doctors
 *  - imap_poll     : poll Sally's inbox for inbound replies (if IMAP enabled)
 */

import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { sendEmail } from "./email.js";
import { pollSallyInbox } from "./sally-imap.js";
import { reviewApprovedOrders } from "./sally-order-review.js";
import { generateInvoicesForCompleteOrders, renderInvoiceAttachments, queuePaymentReminderEmail } from "./sally-invoice.js";
import { sweepExpenseOrphans } from "./expense-orphan-sweep.js";
import {
  type ProductGroup,
  groupLabelDe,
  groupLabelEn,
  groupSubjectDe,
  groupSubjectEn,
} from "./sally-groups.js";
import { recipientLanguageForCountry, resolveRecipientLanguage } from "./recipient-language.js";
import { appendImpressumSignature } from "./impressum-signature.js";
import { SALLY_AUTOMATION_MASTER_KEY, isSallyAutomationEnabled } from "./sally-controls.js";
import { invalidSallyEmailContentField } from "./sally-email-content.js";

export { invalidSallyEmailContentField } from "./sally-email-content.js";

// ── Settings helpers ──────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

async function getSettingsMulti(keys: string[]): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1)",
    [keys],
  );
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value],
  );
}

/** Days between two ISO date strings (or today if b is omitted). */
function daysSince(isoDate: string, now = new Date()): number {
  return Math.floor((now.getTime() - new Date(isoDate).getTime()) / 86_400_000);
}

// ── Language / template helpers ───────────────────────────────────────────────

export type SallyLang = "de" | "en" | "both";

function bilingual(
  de: string,
  en: string,
  lang: SallyLang,
): string {
  if (lang === "de") return de;
  if (lang === "en") return en;
  return `${de}\n\n---\n\n${en}`;
}

function subjectBilingual(de: string, en: string, lang: SallyLang): string {
  if (lang === "de") return de;
  if (lang === "en") return en;
  return `${de} / ${en}`;
}

function signature(name: string, email: string): string {
  const line1 = `${name}`;
  const line2 = "Sales Manager | iROC GmbH";
  return email ? `${line1}\n${line2}\n${email}` : `${line1}\n${line2}`;
}

// ── Email template builders ───────────────────────────────────────────────────

export function firstContactEmail(
  name: string,
  group: string,
  lang: SallyLang,
  sallyName: string,
  sallyEmail: string,
) {
  const g = (group || "") as ProductGroup;
  const gDe = groupLabelDe(g);
  const gEn = groupLabelEn(g);
  const sDe = groupSubjectDe(g);
  const sEn = groupSubjectEn(g);
  const sig  = signature(sallyName, sallyEmail);

  const de = `Sehr geehrte/r ${name},

vielen Dank für Ihr Interesse an ${gDe}. Wir freuen uns, Ihnen mehr über unsere Schulungsangebote und Produkte mitteilen zu können.

Bei Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.

Mit freundlichen Grüßen,
${sig}`;

  const en = `Dear ${name},

Thank you for your interest in ${gEn}. We look forward to sharing more about our training offerings and products with you.

Please do not hesitate to reach out if you have any questions.

Kind regards,
${sig}`;

  return {
    subject: subjectBilingual(
      `Information über ${sDe} – iROC GmbH`,
      `Information about ${sEn} – iROC GmbH`,
      lang,
    ),
    body: bilingual(de, en, lang),
  };
}

export function weekFollowupEmail(
  name: string,
  group: string,
  lang: SallyLang,
  sallyName: string,
  sallyEmail: string,
) {
  const g = (group || "") as ProductGroup;
  const gDe = groupLabelDe(g);
  const gEn = groupLabelEn(g);
  const sDe = groupSubjectDe(g);
  const sEn = groupSubjectEn(g);
  const sig  = signature(sallyName, sallyEmail);

  const de = `Sehr geehrte/r ${name},

wir möchten Sie daran erinnern, dass Sie sich noch nicht für eine Schulung zu ${gDe} angemeldet haben. Gerne reservieren wir Ihnen einen Platz.

Melden Sie sich jetzt an, um das Beste aus Ihren Produkten herauszuholen.

Mit freundlichen Grüßen,
${sig}`;

  const en = `Dear ${name},

We would like to remind you that you have not yet registered for a training on ${gEn}. We would be happy to reserve a spot for you.

Register now to get the most out of your products.

Kind regards,
${sig}`;

  return {
    subject: subjectBilingual(
      `Erinnerung: Schulungsanmeldung – ${sDe}`,
      `Reminder: Training registration – ${sEn}`,
      lang,
    ),
    body: bilingual(de, en, lang),
  };
}

export function monthlyReminderEmail(
  name: string,
  group: string,
  lang: SallyLang,
  sallyName: string,
  sallyEmail: string,
) {
  const g = (group || "") as ProductGroup;
  const gDe = groupLabelDe(g);
  const gEn = groupLabelEn(g);
  const sDe = groupSubjectDe(g);
  const sEn = groupSubjectEn(g);
  const sig  = signature(sallyName, sallyEmail);

  const de = `Sehr geehrte/r ${name},

wir melden uns erneut bezüglich Ihres Interesses an ${gDe}. Schulungstermine sind verfügbar und wir würden uns freuen, Sie als Teilnehmer/in begrüßen zu dürfen.

Bitte zögern Sie nicht, uns zu kontaktieren.

Mit freundlichen Grüßen,
${sig}`;

  const en = `Dear ${name},

We are reaching out again regarding your interest in ${gEn}. Training dates are available and we would be delighted to welcome you as a participant.

Please do not hesitate to get in touch.

Kind regards,
${sig}`;

  return {
    subject: subjectBilingual(
      `Freundliche Erinnerung: Schulung ${sDe}`,
      `Friendly reminder: Training ${sEn}`,
      lang,
    ),
    body: bilingual(de, en, lang),
  };
}

export function doctorCheckinEmail(
  name: string,
  lang: SallyLang,
  sallyName: string,
  sallyEmail: string,
) {
  const sig = signature(sallyName, sallyEmail);

  const de = `Sehr geehrte/r ${name},

wir haben bemerkt, dass es schon eine Weile her ist, seit Ihrer letzten Bestellung. Wir hoffen, dass alles gut läuft.

Falls wir Ihnen behilflich sein können oder Sie eine neue Bestellung aufgeben möchten, stehen wir gerne zur Verfügung.

Mit freundlichen Grüßen,
${sig}`;

  const en = `Dear ${name},

We noticed it has been a while since your last order. We hope everything is going well.

If we can be of assistance or you would like to place a new order, please do not hesitate to contact us.

Kind regards,
${sig}`;

  return {
    subject: subjectBilingual(
      "Wie läuft es? – iROC GmbH",
      "How is everything? – iROC GmbH",
      lang,
    ),
    body: bilingual(de, en, lang),
  };
}

export function doctorPromoEmail(
  name: string,
  discountPct: string,
  lang: SallyLang,
  sallyName: string,
  sallyEmail: string,
) {
  const sig = signature(sallyName, sallyEmail);

  const de = `Sehr geehrte/r ${name},

als geschätzter zertifizierter Partner möchten wir Ihnen ein exklusives Mengenangebot unterbreiten: Erhalten Sie ${discountPct}% Rabatt, wenn Sie mindestens 10 Artikel bestellen.

Dieses Angebot ist zeitlich begrenzt. Kontaktieren Sie uns, um von diesem besonderen Angebot zu profitieren.

Mit freundlichen Grüßen,
${sig}`;

  const en = `Dear ${name},

As a valued certified partner, we would like to offer you an exclusive bulk discount: receive ${discountPct}% off when you order at least 10 items.

This offer is available for a limited time. Contact us to take advantage of this special deal.

Kind regards,
${sig}`;

  return {
    subject: subjectBilingual(
      `Exklusives Mengenangebot: ${discountPct}% Rabatt ab 10 Artikeln – iROC GmbH`,
      `Exclusive bulk offer: ${discountPct}% discount from 10 items – iROC GmbH`,
      lang,
    ),
    body: bilingual(de, en, lang),
  };
}

// ── Queue helper ──────────────────────────────────────────────────────────────

async function queueEmailIfNeeded(opts: {
  recipientEmail: string;
  subject: string;
  body: string;
  triggerType: string;
  relatedLeadId?: number;
  relatedDoctorId?: number;
  detectedLanguage?: "de" | "en";
}): Promise<boolean> {
  const { recipientEmail, subject, body, triggerType, relatedLeadId, relatedDoctorId, detectedLanguage } = opts;
  const invalidField = invalidSallyEmailContentField(subject, body);
  if (invalidField) {
    logger.warn({ triggerType, invalidField }, "Sally: skipped queue draft with invalid content");
    return false;
  }

  const idCol = relatedLeadId != null ? "related_lead_id" : "related_doctor_id";
  const idVal = relatedLeadId ?? relatedDoctorId;

  if (idVal != null) {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM sally_email_queue
       WHERE ${idCol} = $1 AND trigger_type = $2 AND status IN ('pending','sent')
       LIMIT 1`,
      [idVal, triggerType],
    );
    if (rows.length > 0) return false;
  }

  await pool.query(
    `INSERT INTO sally_email_queue
       (recipient_email, subject, body, trigger_type, status, related_lead_id, related_doctor_id, detected_language)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)`,
    [recipientEmail, subject, body, triggerType, relatedLeadId ?? null, relatedDoctorId ?? null, detectedLanguage ?? null],
  );
  return true;
}

// ── Job: leads ────────────────────────────────────────────────────────────────

async function runLeadsJob(
  sallySettings: Record<string, string>,
): Promise<void> {
  const now  = new Date();
  const name = sallySettings.sally_from_name  || "Sally";
  const email = sallySettings.sally_from_email || "";

  const { rows: leads } = await pool.query<{
    id: number; name: string; email: string;
    product_interest_group: string; first_contact_date: string | null;
    training_registered: boolean; is_cancelled: boolean;
  }>("SELECT * FROM sally_leads WHERE is_cancelled = false AND training_registered = false AND deleted_at IS NULL");

  let queued = 0;
  for (const lead of leads) {
    const lang = await resolveRecipientLanguage({ email: lead.email, preferredSource: "lead" });
    if (!lead.first_contact_date) continue;
    const age = daysSince(lead.first_contact_date, now);

    if (age >= 28) {
      const { rows: existing4w } = await pool.query<{ id: number }>(
        "SELECT id FROM sally_email_queue WHERE related_lead_id = $1 AND trigger_type = '4_week_followup' AND status IN ('pending','sent') LIMIT 1",
        [lead.id],
      );
      if (existing4w.length === 0) {
        const { subject, body } = weekFollowupEmail(lead.name, lead.product_interest_group, lang, name, email);
        const inserted = await queueEmailIfNeeded({
          recipientEmail: lead.email,
          subject,
          body: await appendImpressumSignature(body, lang),
          triggerType: "4_week_followup",
          relatedLeadId: lead.id,
          detectedLanguage: lang,
        });
        if (inserted) queued++;
      }
    }

    const { rows: lastReminder } = await pool.query<{ created_at: Date }>(
      "SELECT created_at FROM sally_email_queue WHERE related_lead_id = $1 AND trigger_type = '2_month_reminder' AND status IN ('pending','sent') ORDER BY created_at DESC LIMIT 1",
      [lead.id],
    );
    const lastDate     = lastReminder[0]?.created_at;
    const daysSinceLast = lastDate ? daysSince(lastDate.toISOString(), now) : Infinity;

    if (daysSinceLast >= 60 && age >= 28) {
      const { subject, body } = monthlyReminderEmail(lead.name, lead.product_interest_group, lang, name, email);
      const inserted = await queueEmailIfNeeded({
        recipientEmail: lead.email,
        subject,
        body: await appendImpressumSignature(body, lang),
        triggerType: "2_month_reminder",
        relatedLeadId: lead.id,
        detectedLanguage: lang,
      });
      if (inserted) queued++;
    }
  }

  if (queued > 0) logger.info({ queued }, "Sally: lead follow-up emails queued");
}

// ── Job: doctors ──────────────────────────────────────────────────────────────

async function runDoctorsJob(
  sallySettings: Record<string, string>,
): Promise<void> {
  const now   = new Date();
  const name  = sallySettings.sally_from_name   || "Sally";
  const email = sallySettings.sally_from_email  || "";

  const { rows: doctors } = await pool.query<{
    id: number; name: string; email: string;
    last_purchase_date: string | null; is_cancelled: boolean;
  }>("SELECT * FROM sally_certified_doctors WHERE is_cancelled = false AND deleted_at IS NULL");

  let queued = 0;
  for (const doc of doctors) {
    const lang = await resolveRecipientLanguage({ email: doc.email, preferredSource: "doctor" });
    if (!doc.last_purchase_date) continue;
    const age = daysSince(doc.last_purchase_date, now);
    if (age < 60) continue;

    const { rows: last } = await pool.query<{ created_at: Date }>(
      "SELECT created_at FROM sally_email_queue WHERE related_doctor_id = $1 AND trigger_type = 'doctor_checkin' AND status IN ('pending','sent') ORDER BY created_at DESC LIMIT 1",
      [doc.id],
    );
    const daysSinceLast = last[0]?.created_at ? daysSince(last[0].created_at.toISOString(), now) : Infinity;
    if (daysSinceLast < 60) continue;

    const { subject, body } = doctorCheckinEmail(doc.name, lang, name, email);
    const inserted = await queueEmailIfNeeded({
      recipientEmail: doc.email,
      subject,
      body: await appendImpressumSignature(body, lang),
      triggerType: "doctor_checkin",
      relatedDoctorId: doc.id,
      detectedLanguage: lang,
    });
    if (inserted) queued++;
  }

  if (queued > 0) logger.info({ queued }, "Sally: doctor check-in emails queued");
}

// ── Job: 6-month promo ────────────────────────────────────────────────────────

async function runPromoJob(
  sallySettings: Record<string, string>,
): Promise<void> {
  const lastRun = await getSetting("sally_cron_promo_last_run");
  const now     = new Date();
  if (lastRun && daysSince(lastRun, now) < 180) return;

  const name       = sallySettings.sally_from_name   || "Sally";
  const email      = sallySettings.sally_from_email  || "";
  const discountPct = sallySettings.sally_bulk_discount_pct ?? "10";

  const { rows: doctors } = await pool.query<{
    id: number; name: string; email: string;
    avg_items_per_order: number;
  }>(
    "SELECT * FROM sally_certified_doctors WHERE is_cancelled = false AND deleted_at IS NULL AND avg_items_per_order < 5",
  );

  let queued = 0;
  for (const doc of doctors) {
    const lang = await resolveRecipientLanguage({ email: doc.email, preferredSource: "doctor" });
    const { subject, body } = doctorPromoEmail(doc.name, discountPct, lang, name, email);
    const inserted = await queueEmailIfNeeded({
      recipientEmail: doc.email,
      subject,
      body: await appendImpressumSignature(body, lang),
      triggerType: "doctor_promo",
      relatedDoctorId: doc.id,
      detectedLanguage: lang,
    });
    if (inserted) queued++;
  }

  await setSetting("sally_cron_promo_last_run", now.toISOString());
  logger.info({ queued, discountPct }, "Sally: 6-month promo emails queued");
}

// ── Main: run all due jobs ────────────────────────────────────────────────────

// ── Payment reminder sweep ────────────────────────────────────────────────────
// Runs once per day. Finds every invoice whose status is still 'sent' and whose
// sent_at is ≥10 days in the past, then queues a country-language payment reminder for
// admin approval — provided no pending reminder already exists and the last sent
// reminder was also >10 days ago. Repeats every 10 days until the status changes.

export async function runPaymentRemindersJob(): Promise<void> {
  const { rows } = await pool.query<{
    id: number;
    invoice_number: string;
    sent_reminder_count: string;
  }>(
    `SELECT
       i.id,
       i.invoice_number,
       COUNT(*) FILTER (WHERE q.status = 'sent')    AS sent_reminder_count
     FROM iroc_invoices i
     LEFT JOIN sally_email_queue q
       ON q.related_invoice_id = i.id AND q.trigger_type = 'payment_reminder'
     WHERE i.status = 'sent'
       AND i.sent_at IS NOT NULL
       AND i.sent_at <= NOW() - INTERVAL '10 days'
       AND i.website_customer_id IS NOT NULL
       AND i.reminder_suppressed = false
     GROUP BY i.id, i.invoice_number
     HAVING
       -- No pending reminder is already waiting for admin approval
       COUNT(*) FILTER (WHERE q.status = 'pending') = 0
       AND (
         -- First reminder: no sent reminders yet
         COUNT(*) FILTER (WHERE q.status = 'sent') = 0
         OR
         -- Subsequent: the last sent reminder was more than 10 days ago
         MAX(q.created_at) FILTER (WHERE q.status = 'sent') <= NOW() - INTERVAL '10 days'
       )`,
  );

  for (const row of rows) {
    const nextCount = parseInt(row.sent_reminder_count, 10) + 1;
    await queuePaymentReminderEmail(row.id, nextCount);
  }

  if (rows.length > 0) {
    logger.info({ count: rows.length }, "Sally: payment reminder sweep queued reminders for admin approval");
  }
}

export async function runSallyCronNow(): Promise<{ leads: string; doctors: string; promo: string }> {
  const sallySettings = await getSettingsMulti([
    "sally_from_name", "sally_from_email",
    "sally_lang_first_contact", "sally_lang_followup",
    "sally_bulk_discount_pct",
  ]);

  const results = { leads: "ok", doctors: "ok", promo: "ok", orders: "ok" };
  try { await runLeadsJob(sallySettings); }      catch (err) { logger.error({ err }, "Sally leads job failed");      results.leads     = String(err); }
  try { await runDoctorsJob(sallySettings); }    catch (err) { logger.error({ err }, "Sally doctors job failed");    results.doctors   = String(err); }
  try { await runPromoJob(sallySettings); }      catch (err) { logger.error({ err }, "Sally promo job failed");      results.promo     = String(err); }
  try { await reviewApprovedOrders(); }          catch (err) { logger.error({ err }, "Sally order review failed");   results.orders    = String(err); }
  try { await runPaymentRemindersJob(); }        catch (err) { logger.error({ err }, "Sally payment reminders failed"); (results as Record<string,string>).reminders = String(err); }
  return results;
}

// ── Scheduler ────────────────────────────────────────────────────────────────

export function initSallyCron(): void {
  async function tick() {
    if (!(await isSallyAutomationEnabled(SALLY_AUTOMATION_MASTER_KEY))) {
      logger.info("Sally scheduled automation is paused");
      return;
    }
    const now      = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const sallySettings = await getSettingsMulti([
      "sally_from_name", "sally_from_email",
      "sally_lang_first_contact", "sally_lang_followup",
      "sally_bulk_discount_pct",
    ]);

    try {
      const lastLeadsRun = await getSetting("sally_cron_leads_last_run");
      if (lastLeadsRun !== todayStr) {
        await runLeadsJob(sallySettings);
        await runDoctorsJob(sallySettings);
        await setSetting("sally_cron_leads_last_run", todayStr);
      }
      await runPromoJob(sallySettings);

    // Payment reminder sweep — runs every tick (6 h) but the SQL HAVING clause
    // ensures a new reminder is only created once per 10-day window per invoice.
    try {
      await runPaymentRemindersJob();
    } catch (err) {
      logger.error({ err }, "Sally payment reminders tick failed");
    }
    } catch (err) {
      logger.error({ err }, "Sally cron tick failed");
    }

    // Poll IMAP inbox for inbound replies (independent — failure is non-fatal)
    try {
      await pollSallyInbox();
    } catch (err) {
      logger.error({ err }, "Sally IMAP poll tick failed");
    }

    // Review any approved orders Sally hasn't looked at yet
    try {
      await reviewApprovedOrders();
    } catch (err) {
      logger.error({ err }, "Sally order review tick failed");
    }
    try {
      await generateInvoicesForCompleteOrders();
    } catch (err) {
      logger.error({ err }, "Sally invoice generation tick failed");
    }

    // Expense-receipt orphan sweep — runs every tick; the cutoff age (30 min)
    // is enforced inside the function so repeated ticks are idempotent.
    try {
      await sweepExpenseOrphans();
    } catch (err) {
      logger.error({ err }, "Expense orphan sweep tick failed");
    }
  }

  setTimeout(() => tick(), 10_000);
  setInterval(() => tick(), 6 * 60 * 60 * 1000);

  logger.info("Sally CRM cron scheduler started");
}

// ── First-contact email helper (called by route on lead creation) ─────────────

export async function queueFirstContactEmail(
  leadId: number,
  name: string,
  email: string,
  group: string,
): Promise<void> {
  const s    = await getSettingsMulti(["sally_lang_first_contact", "sally_from_name", "sally_from_email"]);
  const lang = await resolveRecipientLanguage({ email, preferredSource: "lead" });
  const { subject, body } = firstContactEmail(name, group, lang, s.sally_from_name || "Sally", s.sally_from_email || "");

  await queueEmailIfNeeded({
    recipientEmail: email,
    subject,
    body: await appendImpressumSignature(body, lang),
    triggerType: "first_contact",
    relatedLeadId: leadId,
    detectedLanguage: lang,
  });
}

// ── Approve & send ────────────────────────────────────────────────────────────

export class SallyEmailContentValidationError extends Error {
  readonly statusCode = 400;

  constructor(field: "subject" | "body") {
    super(field === "subject"
      ? "Email subject cannot be blank / Der E-Mail-Betreff darf nicht leer sein"
      : "Email body cannot be blank / Der E-Mail-Text darf nicht leer sein");
    this.name = "SallyEmailContentValidationError";
  }
}

export async function approveAndSendEmail(queueItemId: number): Promise<void> {
  const { rows } = await pool.query<{
    id: number; recipient_email: string; subject: string; body: string;
    status: string; in_reply_to: string | null;
    trigger_type: string; related_invoice_id: number | null;
    related_lead_id: number | null; related_doctor_id: number | null;
    detected_language: string | null;
  }>(
    `SELECT id, recipient_email, subject, body, status, in_reply_to, trigger_type,
            related_invoice_id, related_lead_id, related_doctor_id, detected_language
       FROM sally_email_queue WHERE id = $1`,
    [queueItemId],
  );
  const item = rows[0];
  if (!item) throw new Error("Email queue item not found");
  if (item.status !== "pending") throw new Error(`Cannot send: status is '${item.status}'`);
  const invalidField = invalidSallyEmailContentField(item.subject, item.body);
  if (invalidField) throw new SallyEmailContentValidationError(invalidField);

  // Resolve Sally's sender identity
  const s          = await getSettingsMulti(["sally_from_name", "sally_from_email"]);
  const sallyName  = s.sally_from_name  || "Sally";
  const sallyEmail = s.sally_from_email || "";

  const fromStr = sallyEmail
    ? `${sallyName}, Sales Manager, iROC GmbH <${sallyEmail}>`
    : `${sallyName}, Sales Manager, iROC GmbH`;

  let language: "de" | "en";
  if (item.detected_language === "de" || item.detected_language === "en") {
    language = item.detected_language;
  } else if (item.related_invoice_id && (
    item.trigger_type === "invoice_dispatch" ||
    item.trigger_type === "invoice_dispatch_shipping" ||
    item.trigger_type === "payment_reminder"
  )) {
    // Legacy invoice drafts did not persist their language. Shipping dispatches
    // must use the shipping country rather than the billing country.
    const { rows } = await pool.query<{ country: string | null; shipping_country: string | null }>(
      `SELECT wc.country, wc.shipping_country
         FROM iroc_invoices i
         JOIN website_customers wc ON wc.id = i.website_customer_id
        WHERE i.id = $1`,
      [item.related_invoice_id],
    );
    const country = item.trigger_type === "invoice_dispatch_shipping"
      ? rows[0]?.shipping_country || rows[0]?.country
      : rows[0]?.country;
    language = recipientLanguageForCountry(country);
  } else {
    language = await resolveRecipientLanguage({
      email: item.recipient_email,
      preferredSource: item.related_lead_id !== null ? "lead" : item.related_doctor_id !== null ? "doctor" : "customer",
    });
  }
  // Invoice dispatch emails carry PDF attachments, rendered fresh at send time
  // so last-minute invoice edits are always reflected. The billing recipient
  // gets invoice + delivery note; the shipping recipient gets ONLY the delivery
  // note (billing documents are never disclosed to the shipping address).
  let attachments: { filename: string; content: Buffer; contentType: string }[] | undefined;
  if (item.related_invoice_id && (
    item.trigger_type === "invoice_dispatch" ||
    item.trigger_type === "invoice_dispatch_shipping" ||
    item.trigger_type === "payment_reminder"
  )) {
    attachments = await renderInvoiceAttachments(item.related_invoice_id, {
      // Shipping-only emails never get the invoice; all other types (billing dispatch + reminders) do
      includeInvoice: item.trigger_type !== "invoice_dispatch_shipping",
    });
  }

  // Refresh CMS-managed legal details at the final send boundary as well as
  // composition time, so an approved draft cannot send a stale Impressum.
  const bodyWithCurrentImpressum = await appendImpressumSignature(item.body, language);
  await pool.query(
    `UPDATE sally_email_queue
        SET body = $2, detected_language = COALESCE(detected_language, $3), updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [item.id, bodyWithCurrentImpressum, language],
  );

  let result: { messageId: string | undefined };
  try {
    result = await sendEmail({
      to:         item.recipient_email,
      subject:    item.subject,
      // Keep the freshly refreshed Impressum visible at this boundary too.
      // sendEmail replaces it idempotently when it applies the current custom
      // Sally signature immediately before delivery.
      text:       bodyWithCurrentImpressum,
      from:       fromStr,
      signatureGroup: "sally",
      signatureLanguage: language,
      replyTo:    sallyEmail || undefined,
      inReplyTo:  item.in_reply_to || undefined,
      attachments,
       mailboxPurpose: "sally_ai",
    });
  } catch (err) {
    logger.error({ err, queueItemId, triggerType: item.trigger_type }, "Sally: email send failed after queue item approval");

    // Surface every Sally delivery failure so an unavailable mailbox role
    // cannot remain hidden in the pending queue. The queue row intentionally
    // stays 'pending' so the admin can retry.
    const notificationType = item.trigger_type === "payment_reminder"
      ? "payment_reminder_send_failed"
      : "sally_email_send_failed";
    const flowLabel = item.trigger_type === "payment_reminder" ? "payment reminder" : "Sally email";
    const flowLabelDe = item.trigger_type === "payment_reminder" ? "Zahlungserinnerung" : "Sally-E-Mail";
    const errorDetails = err instanceof Error ? ` ${err.message}` : "";
    await pool.query(
      `INSERT INTO iroc_notifications (type, message)
       VALUES ($1, $2)`,
      [notificationType, JSON.stringify({
        de: `Fehler beim Senden der ${flowLabelDe} (Warteschlangeneintrag #${queueItemId}). Die E-Mail wurde nicht zugestellt – der Eintrag bleibt auf 'ausstehend'.${errorDetails}`,
        en: `Failed to send ${flowLabel} (queue item #${queueItemId}). The email was not delivered — the queue row remains 'pending'.${errorDetails}`,
      })],
    ).catch((notifErr: unknown) => {
      logger.error({ notifErr, queueItemId }, "Sally: failed to insert email delivery failure notification");
    });

    throw err;
  }

  await pool.query(
    "UPDATE sally_email_queue SET status = 'sent', message_id = $2, updated_at = NOW() WHERE id = $1",
    [queueItemId, result.messageId ?? null],
  );
}
