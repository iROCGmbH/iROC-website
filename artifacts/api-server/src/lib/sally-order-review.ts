/**
 * Sally order review.
 *
 * Every approved website order is analysed by Sally (Gemini):
 *  - detect the customer's contact language (if not already set)
 *  - check whether all information needed to process the order is present
 *    (delivery address completeness, contact data, clear product lines,
 *     customer resolution)
 *  - if something is missing: draft a "missing info" email to the customer,
 *    in the customer's language, queued for admin approval
 *    (trigger_type = 'order_missing_info')
 *  - if complete: mark the order reviewed with no email
 *
 * Review status lives on iroc_orders.sally_review_status:
 *   null → not yet reviewed | 'reviewing' | 'missing_info' | 'complete'
 */
import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { getLessonsPromptBlock } from "./sally-lessons.js";
import { contentMatchesRecipientLanguage, resolveRecipientLanguage } from "./recipient-language.js";
import { appendImpressumSignature } from "./impressum-signature.js";
import { invalidSallyEmailContentField } from "./sally-email-content.js";

interface OrderRow {
  id: number;
  website_customer_id: number | null;
  customer_type: string;
  customer_nr: string | null;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string;
  contact_phone: string | null;
  instrument: string;
  products: string | null;
  delivery_address: string | null;
  notes: string | null;
  contact_language: string | null;
}

export interface ReviewAnalysis {
  language: string;                 // "de" | "en" | other ISO 639-1
  complete: boolean;
  missing: string[];                // human-readable missing/unclear items
  email_subject: string;            // only when !complete
  email_body: string;               // only when !complete
}

async function getSallyIdentity(): Promise<{ name: string; email: string }> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1)",
    [["sally_from_name", "sally_from_email"]],
  );
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { name: map.sally_from_name || "Sally", email: map.sally_from_email || "" };
}

function orderDescription(o: OrderRow, customerMatched: boolean): string {
  return `Customer type: ${o.customer_type}${o.customer_nr ? ` (customer no. ${o.customer_nr})` : ""}
Matched to an existing customer record: ${customerMatched ? "YES" : "NO"}
Company / institution: ${o.company_name ?? "(empty)"}
Contact name: ${o.contact_name ?? "(empty)"}
Contact email: ${o.contact_email}
Contact phone: ${o.contact_phone ?? "(empty)"}
Instrument: ${o.instrument}
Ordered products (free text): ${o.products ?? "(empty)"}
Delivery address (free text): ${o.delivery_address ?? "(empty)"}
Notes: ${o.notes ?? "(empty)"}`;
}

async function geminiReviewOrder(
  order: OrderRow,
  sallyName: string,
  sallyEmail: string,
  language: "de" | "en",
): Promise<ReviewAnalysis | null> {
  if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || !process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    logger.warn("Sally: Gemini not configured — order review skipped");
    return null;
  }
  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const lessons = await getLessonsPromptBlock();

    const customerMatched = order.website_customer_id != null;
    const langHint = `The customer's authoritative country record determines the contact language. Write entirely in "${language}" (${language === "de" ? "German" : "English"}). Do not infer language from free text or use a detected inbound language.`;

    const prompt = `You are ${sallyName}, Sales Manager at iROC GmbH (a German medical device company). Email: ${sallyEmail}.

You are reviewing an incoming customer order to check whether it can be processed, and drafting a polite email asking for missing information if needed.
${lessons}
${langHint}

An order is PROCESSABLE when ALL of the following hold:
1. Delivery address is complete enough to ship a package: street + number, postal code, city, and country (country may be implied, e.g. a German postal code + city; a bare city or empty address is NOT complete).
2. There is a usable contact (email is always present; a contact name OR company name should exist).
3. The ordered product lines are clear enough to invoice: identifiable product names and quantities. Vague text like "the usual" or "some instruments" is NOT clear — EXCEPT when the order is matched to an existing customer record AND the products text plausibly references a known reorder.
4. For "existing" customer type: the order is matched to a customer record. For "new" customers, no match is expected — do NOT report the missing match itself, but their delivery address and full contact details matter more.

Order to review:
${orderDescription(order, customerMatched)}

If information is missing, draft a short, friendly, professional email to the customer (greeting with their name if known) that:
- thanks them for their order
- lists exactly what is missing, as a clear bullet list
- asks them to reply with the missing details
- is written ENTIRELY in the customer's language ("de" → German with formal "Sie", "en" → English; other languages → use that language, formal register)
 - does not include a company address, phone number, website, contact email,
   or legal/company signature. The system appends the current company
   signature after language enforcement. A personal Sally sign-off is fine.

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "language": "<ISO 639-1 code, e.g. de or en>",
  "complete": true | false,
  "missing": ["<missing item 1>", "..."],
  "email_subject": "<subject in the customer's language; empty string if complete>",
  "email_body": "<full email body; empty string if complete>"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned) as ReviewAnalysis;
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Sally: order review AI call failed");
    return null;
  }
}

function deterministicMissingInfoDraft(
  language: "de" | "en",
  order: OrderRow,
  sallyName: string,
  sallyEmail: string,
): Pick<ReviewAnalysis, "language" | "email_subject" | "email_body"> {
  const name = order.contact_name || order.company_name || "";
  if (language === "de") {
    return {
      language,
      email_subject: "Ihre Bestellung bei iROC GmbH – Rückfrage",
      email_body: `Guten Tag ${name},\n\nvielen Dank für Ihre Bestellung. Für die Bearbeitung benötigen wir noch einige Angaben. Bitte antworten Sie auf diese E-Mail mit den fehlenden Bestell-, Kontakt- oder Lieferdaten.\n\nMit freundlichen Grüßen,\n${sallyName}\nSales Manager | iROC GmbH\n${sallyEmail}`,
    };
  }
  return {
    language,
    email_subject: "Your iROC GmbH order – question",
    email_body: `Dear ${name},\n\nthank you for your order. We need some additional information before we can process it. Please reply to this email with the missing order, contact, or delivery details.\n\nKind regards,\n${sallyName}\nSales Manager | iROC GmbH\n${sallyEmail}`,
  };
}

function safeMissingInfoDraft(language: "de" | "en"): Pick<ReviewAnalysis, "language" | "email_subject" | "email_body"> {
  return language === "de"
    ? {
      language,
      email_subject: "Ihre Bestellung bei iROC GmbH – Rückfrage",
      email_body: "Guten Tag,\n\nvielen Dank für Ihre Bestellung. Für die Bearbeitung benötigen wir noch einige Angaben. Bitte antworten Sie auf diese E-Mail mit den fehlenden Bestell-, Kontakt- oder Lieferdaten.\n\nMit freundlichen Grüßen,\niROC GmbH",
    }
    : {
      language,
      email_subject: "Your iROC GmbH order – question",
      email_body: "Dear Customer,\n\nthank you for your order. We need some additional information before we can process it. Please reply to this email with the missing order, contact, or delivery details.\n\nKind regards,\niROC GmbH",
    };
}

async function enforceReviewDraftLanguage(
  analysis: ReviewAnalysis,
  order: OrderRow,
  language: "de" | "en",
  sallyName: string,
  sallyEmail: string,
): Promise<ReviewAnalysis> {
  if (analysis.complete || (analysis.language === language && contentMatchesRecipientLanguage(analysis.email_subject, analysis.email_body, language))) {
    return analysis;
  }
  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: `Rewrite the following customer email entirely in ${language === "de" ? "German" : "English"}. Keep its meaning and professional formal tone. Do not add a company address, phone number, website, contact email, or legal/company signature; the system appends that separately. Return ONLY JSON: {"email_subject":"...","email_body":"..."}.\n\n${analysis.email_subject}\n\n${analysis.email_body}` }] }],
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const rewritten = JSON.parse(raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()) as Pick<ReviewAnalysis, "email_subject" | "email_body">;
    if (contentMatchesRecipientLanguage(rewritten.email_subject, rewritten.email_body, language)) {
      return { ...analysis, ...rewritten, language };
    }
  } catch (err) {
    logger.warn({ err, orderId: order.id }, "Sally: order-review language rewrite failed");
  }
  // Do not queue a conflicting AI draft when the constrained retry fails.
  return { ...analysis, ...deterministicMissingInfoDraft(language, order, sallyName, sallyEmail) };
}

/** How long a 'reviewing' claim is considered live before another worker may take over. */
const LEASE_MINUTES = 10;

/** Reviews one approved order. Returns the resulting review status or null on failure. */
export async function reviewOrder(orderId: number): Promise<string | null> {
  // Claim the order atomically with a lease so concurrent ticks / re-runs don't double-review.
  // Only unreviewed orders or orders with an expired lease can be claimed.
  // NB: claimed_at is fetched as text — JS Date loses microsecond precision,
  // which would make the lease equality check in the final write always fail.
  const { rows: claimed } = await pool.query<OrderRow & { claimed_at_text: string }>(
    `UPDATE iroc_orders
       SET sally_review_status = 'reviewing', sally_review_claimed_at = NOW()
     WHERE id = $1 AND status = 'approved'
       AND (sally_review_status IS NULL
            OR (sally_review_status = 'reviewing'
                AND (sally_review_claimed_at IS NULL
                     OR sally_review_claimed_at < NOW() - INTERVAL '${LEASE_MINUTES} minutes')))
     RETURNING *, sally_review_claimed_at::text AS claimed_at_text`,
    [orderId],
  );
  const order = claimed[0];
  if (!order) return null;
  const claimedAt = order.claimed_at_text;

  const { name: sallyName, email: sallyEmail } = await getSallyIdentity();
  const language = await resolveRecipientLanguage({
    email: order.contact_email,
    websiteCustomerId: order.website_customer_id,
  });
  const analysis = await geminiReviewOrder(order, sallyName, sallyEmail, language);

  if (!analysis) {
    // Leave in 'reviewing' — retried once the lease expires
    return "reviewing";
  }
  const enforcedAnalysis = await enforceReviewDraftLanguage(analysis, order, language, sallyName, sallyEmail);

  return finalizeReview(order.id, order.contact_email, claimedAt, enforcedAnalysis, language);
}

/**
 * Finalizes a review in ONE transaction: the order-status write (guarded by
 * the lease timestamp) and the email-queue reconciliation commit or roll back
 * together. The lease-guarded UPDATE also row-locks the order until commit,
 * so a concurrent re-run reset cannot interleave between the status write and
 * the queue mutation. A reviewer whose lease was taken over performs NO queue
 * mutation at all.
 *
 * Exported for tests.
 */
export async function finalizeReview(
  orderId: number,
  contactEmail: string,
  claimedAt: string,
  analysis: ReviewAnalysis,
  language: string,
): Promise<string | null> {
  // This final guard is intentionally at the queue boundary as well as before
  // the rewrite retry.  No future caller can accidentally queue conflicting AI
  // output by calling finalizeReview directly.
  const requiredLanguage: "de" | "en" = language === "de" ? "de" : "en";
  const sourceInvalidField = !analysis.complete
    ? invalidSallyEmailContentField(analysis.email_subject, analysis.email_body)
    : null;
  if (sourceInvalidField) {
    logger.warn({ orderId, invalidField: sourceInvalidField }, "Sally: skipped order-review draft with blank content");
    return null;
  }
  const safeAnalysis = !analysis.complete
    && (analysis.language !== requiredLanguage || !contentMatchesRecipientLanguage(analysis.email_subject, analysis.email_body, requiredLanguage))
    ? { ...analysis, ...safeMissingInfoDraft(requiredLanguage) }
    : analysis;
  // Do this before the legal signature is appended: a signature would otherwise
  // make an empty AI body appear non-empty and leave an unusable draft in the
  // approval queue.
  const invalidField = safeAnalysis.complete
    ? null
    : invalidSallyEmailContentField(safeAnalysis.email_subject, safeAnalysis.email_body);
  if (invalidField) {
    logger.warn({ orderId, invalidField }, "Sally: skipped order-review draft with blank content");
    return null;
  }
  // Add legal details only after the final language guard has selected the
  // customer-facing prose. This also makes refreshed pending drafts current.
  const bodyWithImpressum = safeAnalysis.complete
    ? ""
    : await appendImpressumSignature(safeAnalysis.email_body, requiredLanguage);
  const finalStatus = safeAnalysis.complete ? "complete" : "missing_info";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Final write requires our lease to still be the active one; otherwise another
    // worker (e.g. a manual re-run) took over and we must not clobber its result.
    const { rowCount } = await client.query(
      `UPDATE iroc_orders
         SET sally_review_status = $2,
             sally_review_result = $3,
             contact_language    = COALESCE(contact_language, $4)
       WHERE id = $1 AND sally_review_status = 'reviewing' AND sally_review_claimed_at = $5::timestamp`,
       [orderId, finalStatus, JSON.stringify({ missing: safeAnalysis.complete ? [] : (safeAnalysis.missing ?? []) }), language, claimedAt],
    );
    if (!rowCount) {
      await client.query("ROLLBACK");
      logger.info({ orderId }, "Sally: review lease lost — result discarded, no queue mutation");
      return null;
    }

    if (safeAnalysis.complete) {
      // Reconcile: a previously drafted (still pending) missing-info request is now obsolete
      const { rowCount: cancelled } = await client.query(
        `UPDATE sally_email_queue SET status = 'cancelled', updated_at = NOW()
         WHERE related_order_id = $1 AND trigger_type = 'order_missing_info' AND status = 'pending'`,
        [orderId],
      );
      await client.query("COMMIT");
      logger.info({ orderId, cancelledDrafts: cancelled }, "Sally: order reviewed — complete");
      // Order is complete → Sally drafts the invoice (async; cron also sweeps)
      setImmediate(async () => {
        try {
          const { generateDraftInvoiceForOrder } = await import("./sally-invoice.js");
          await generateDraftInvoiceForOrder(orderId);
        } catch (err) {
          logger.error({ err, orderId }, "Sally: post-review invoice generation failed");
        }
      });
      return "complete";
    }

    // Queue the missing-info email. The partial unique index on
    // (related_order_id, trigger_type) for active drafts makes this idempotent;
    // an existing *pending* draft is refreshed with the new content/language
    // (already-sent emails are never touched). Approval gate is preserved:
    // the row stays/becomes 'pending'.
    const subject = safeAnalysis.email_subject || safeMissingInfoDraft(requiredLanguage).email_subject;
    const invalidField = invalidSallyEmailContentField(subject, bodyWithImpressum);
    if (invalidField) {
      await client.query("COMMIT");
      logger.warn({ orderId, invalidField }, "Sally: blank order-review content was not queued");
      return "missing_info";
    }
    const { rows: upserted } = await client.query<{ id: number; status: string }>(
      `INSERT INTO sally_email_queue
         (recipient_email, subject, body, trigger_type, status, related_order_id, detected_language)
       VALUES ($1, $2, $3, 'order_missing_info', 'pending', $4, $5)
       ON CONFLICT (related_order_id, trigger_type)
         WHERE trigger_type = 'order_missing_info' AND status IN ('pending', 'sent')
         DO UPDATE SET
           subject           = EXCLUDED.subject,
           body              = EXCLUDED.body,
           detected_language = EXCLUDED.detected_language,
           updated_at        = NOW()
         WHERE sally_email_queue.status = 'pending'
       RETURNING id, status`,
      [
        contactEmail,
          subject,
          bodyWithImpressum,
        orderId,
        language,
      ],
    );
    await client.query("COMMIT");
    if (upserted[0]) {
      logger.info({ orderId, queueId: upserted[0].id, missing: safeAnalysis.missing }, "Sally: missing-info email queued/updated");
    }
    return "missing_info";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Reviews all approved orders that Sally hasn't reviewed yet. */
export async function reviewApprovedOrders(): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM iroc_orders
     WHERE status = 'approved'
       AND (sally_review_status IS NULL OR sally_review_status = 'reviewing')
     ORDER BY created_at ASC
     LIMIT 20`,
  );
  let reviewed = 0;
  for (const row of rows) {
    try {
      const result = await reviewOrder(row.id);
      if (result && result !== "reviewing") reviewed++;
    } catch (err) {
      logger.error({ err, orderId: row.id }, "Sally: order review failed");
    }
  }
  if (reviewed > 0) logger.info({ reviewed }, "Sally: order reviews completed");
  return reviewed;
}
