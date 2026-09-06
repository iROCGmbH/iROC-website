/**
 * Sally AI reply drafter.
 *
 * Uses Gemini (via the existing AI integration) to:
 *   1. Detect the language and formality of an inbound email.
 *   2. Draft a reply in the same language and formality, signed as Sally.
 *
 * The draft is inserted into sally_email_queue with trigger_type = 'inbound_reply'
 * and status = 'pending' so the admin can review + approve before sending.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { getLessonsPromptBlock } from "./sally-lessons.js";
import type { ProductGroup } from "./sally-groups.js";
import { specialtyToProductGroup } from "./sally-groups.js";
import { contentMatchesRecipientLanguage, resolveRecipientLanguage } from "./recipient-language.js";
import { appendImpressumSignature } from "./impressum-signature.js";
import { getEmailDest } from "./email.js";
import { invalidSallyEmailContentField } from "./sally-email-content.js";

interface ReplyAnalysis {
  language: string;          // ISO 639-1 code: 'de', 'en', etc.
  formality: "formal" | "informal";
  can_answer: boolean;       // false → Sally can't answer properly; escalate to customer service
  escalation_summary: string; // short English summary of the open question (empty when can_answer)
  reply_subject: string;
  reply_body: string;        // full body including greeting + signature
}

/**
 * Returns a short (~300-token) brand context block for the Gemini prompt,
 * grounding the model in the correct product group for this lead.
 * Returns an empty string for unknown / unset groups.
 */
function brandContextBlock(group: ProductGroup | null | undefined): string {
  if (!group) return "";
  switch (group) {
    case "spirecut":
      return `\nBrand context: This lead is interested in Spirecut — precision instruments for hand surgery (wrist, finger, and hand procedures). Key products: the Spirecut instrument set for hand and wrist surgery. Website: https://spirecut.com. Tailor your reply to Spirecut's hand-surgery instrument portfolio and avoid mentioning unrelated iROC product lines.\n`;
    case "ministem":
      return `\nBrand context: This lead is interested in MiniStem / Jointechlabs — MFAT (Micro-Fat Aspiration & Transfer) and SVF (Stromal Vascular Fraction) micro-fat harvesting technologies. Key technologies: MFAT, SVF, adipose-derived regenerative cell therapies. Website: https://ministem.com. Tailor your reply to MiniStem/Jointechlabs MFAT/SVF products and avoid mentioning unrelated iROC product lines.\n`;
    case "cellenis":
      return `\nBrand context: This lead is interested in Cellenis / Estar Medical — regenerative medicine products including PRP (Platelet-Rich Plasma), PRF (Platelet-Rich Fibrin), and Exosome therapies. Website: https://cellenis.com. Tailor your reply to Cellenis/Estar Medical regenerative products and avoid mentioning unrelated iROC product lines.\n`;
    default: {
      // Exhaustiveness guard: if ProductGroup gains a new member without a
      // matching case above, TypeScript will flag `group` as not assignable to
      // `never` at compile time.  At runtime we still return "" so the caller
      // is never broken, but the build will fail until the case is handled.
      const _exhaustive: never = group;
      void _exhaustive;
      return "";
    }
  }
}

async function geminiDraftReply(
  rawEmailSource: string,
  sallyName: string,
  sallyEmail: string,
  productGroup?: ProductGroup | null,
  recipientLanguage: "de" | "en" = "en",
): Promise<ReplyAnalysis | null> {
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey  = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

  if (!baseUrl || !apiKey) {
    logger.warn("Sally: Gemini not configured — cannot draft AI reply");
    return null;
  }

  try {
    // Lazy-import the workspace Gemini client (throws at load if env vars are absent,
    // but we already guard above, so it will succeed here).
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const lessons = await getLessonsPromptBlock();

    const brandCtx = brandContextBlock(productGroup);

    const prompt = `You are ${sallyName}, Sales Manager at iROC GmbH (email: ${sallyEmail}).
${lessons}${brandCtx}
Below is the raw source of an incoming email (may include headers and body mixed together).
Your task:
1. The recipient's authoritative country record determines the response language: write and return "${recipientLanguage}". Do NOT use the inbound email's detected language to choose the reply language.
2. Identify the formality:
   - "formal" = formal pronouns / tone (e.g. German "Sie", polished English)
   - "informal" = casual pronouns / tone (e.g. German "du", relaxed English)
3. Decide whether you can PROPERLY answer the email yourself ("can_answer").
   You can answer routine sales correspondence: thanking, scheduling, confirming receipt,
   general product interest, order/delivery status follow-ups you can see from context.
   You CANNOT answer (set "can_answer": false) when the email asks something that requires
   knowledge or authority you don't have, e.g.:
   - detailed technical/medical/clinical questions about the products
   - complaints, damaged goods, returns, or warranty claims
   - pricing negotiations, discounts, or contract/legal questions
   - regulatory/certification questions
   - anything where guessing could give the customer wrong information
4. If "can_answer" is false:
    - The reply must NOT attempt to answer the question. Instead, politely inform the
      customer (in the required response language and same formality) that their inquiry has been forwarded
     to our customer service department and will be answered shortly.
   - Also provide "escalation_summary": a 1-2 sentence ENGLISH summary of what the
     customer is asking, for the internal customer service team.
5. Draft a concise, professional reply in the required response language and SAME formality.
6. Greeting rules:
   - Formal German → "Sehr geehrte Damen und Herren," or "Sehr geehrte/r [Name],"
   - Informal German → "Hallo [Name]," or "Liebe/r [Name],"
   - Formal English → "Dear [Name]," or "Dear Sir/Madam,"
   - Informal English → "Hi [Name],"
7. Closing rules:
   - Formal German → "Mit freundlichen Grüßen,"
   - Informal German → "Viele Grüße,"
   - Formal English → "Kind regards,"
   - Informal English → "Best regards,"
8. Do not include a company address, phone number, website, contact email, or
   legal/company signature. The system appends the current company signature
   after this draft is language-checked. You may sign personally as
   "${sallyName}, Sales Manager" if appropriate.

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "language": "<ISO 639-1 code>",
  "formality": "formal" | "informal",
  "can_answer": true | false,
  "escalation_summary": "<1-2 sentence English summary of the open question, or empty string if can_answer is true>",
  "reply_subject": "<Re: original subject>",
   "reply_body": "<complete reply body including greeting, content, and closing>"
}

--- INCOMING EMAIL ---
${rawEmailSource.slice(0, 6000)}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as ReplyAnalysis;
    // Defensive defaults for older/partial model outputs
    if (typeof parsed.can_answer !== "boolean") parsed.can_answer = true;
    if (typeof parsed.escalation_summary !== "string") parsed.escalation_summary = "";
    return parsed;
  } catch (err) {
    logger.error({ err }, "Sally: Gemini reply drafting failed");
    return null;
  }
}

async function enforceInboundReplyLanguage(
  analysis: ReplyAnalysis,
  required: "de" | "en",
): Promise<ReplyAnalysis | null> {
  if (analysis.can_answer === false) return analysis; // controlled holding reply is rendered below
  if (analysis.language === required && contentMatchesRecipientLanguage(analysis.reply_subject, analysis.reply_body, required)) return analysis;
  try {
    const { ai } = await import("@workspace/integrations-gemini-ai");
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: `Rewrite this reply entirely in ${required === "de" ? "German" : "English"}. Keep its meaning and formality. Do not add a company address, phone number, website, contact email, or legal/company signature; the system appends that separately. Return ONLY JSON: {"reply_subject":"...","reply_body":"..."}.\n\nSubject: ${analysis.reply_subject}\n\n${analysis.reply_body}` }] }],
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const rewritten = JSON.parse(raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()) as Pick<ReplyAnalysis, "reply_subject" | "reply_body">;
    if (contentMatchesRecipientLanguage(rewritten.reply_subject, rewritten.reply_body, required)) return { ...analysis, ...rewritten, language: required };
  } catch (err) {
    logger.warn({ err }, "Sally: inbound reply language rewrite failed");
  }
  return null;
}

function manualReplyFallback(language: "de" | "en", sallyName: string, sallyEmail: string): string {
  return language === "de"
    ? `Guten Tag,\n\nvielen Dank für Ihre Nachricht. Wir prüfen Ihr Anliegen und melden uns in Kürze bei Ihnen.\n\nMit freundlichen Grüßen,\n${sallyName}\nSales Manager | iROC GmbH\n${sallyEmail}`
    : `Dear Customer,\n\nthank you for your message. We are reviewing your inquiry and will get back to you shortly.\n\nKind regards,\n${sallyName}\nSales Manager | iROC GmbH\n${sallyEmail}`;
}

function controlledReplySubject(language: "de" | "en"): string {
  return language === "de"
    ? "Ihre Nachricht an iROC GmbH"
    : "Your message to iROC GmbH";
}

/**
 * Creates a pending reply draft in sally_email_queue for an inbound email.
 * Returns true if a new draft was created, false if already exists or skipped.
 */
export async function processInboundEmail(opts: {
  inboundFrom: string;
  inboundSubject: string;
  rawSource: string;
  /** RFC 5322 Message-ID of the inbound email (angle brackets stripped) — dedupe key. */
  inboundMessageId?: string;
  inReplyToMessageId?: string;
  sallyName: string;
  sallyEmail: string;
}): Promise<boolean> {
  const { inboundFrom, inboundSubject, rawSource, inboundMessageId, inReplyToMessageId, sallyName, sallyEmail } = opts;

  // De-duplicate: skip if we already have a pending reply draft for this inbound message
  const { rows: existing } = await pool.query<{ id: number }>(
    `SELECT id FROM sally_email_queue
     WHERE trigger_type = 'inbound_reply' AND inbound_from = $1 AND status = 'pending'
       AND (in_reply_to = $2 OR ($2 IS NULL AND in_reply_to IS NULL))
     LIMIT 1`,
    [inboundFrom, inReplyToMessageId ?? null],
  );
  if (existing.length > 0) return false;

  // Match the thread to a Sally lead or doctor via the original Message-ID
  let relatedLeadId: number | null = null;
  let relatedDoctorId: number | null = null;

  if (inReplyToMessageId) {
    const { rows: origin } = await pool.query<{
      related_lead_id: number | null; related_doctor_id: number | null;
    }>(
      "SELECT related_lead_id, related_doctor_id FROM sally_email_queue WHERE message_id = $1 LIMIT 1",
      [inReplyToMessageId],
    );
    if (origin[0]) {
      relatedLeadId  = origin[0].related_lead_id;
      relatedDoctorId = origin[0].related_doctor_id;
    }
  }

  // Look up the lead's product interest group so the AI reply stays on-topic.
  // Prefer the relatedLeadId resolved from the thread; fall back to email match.
  let productGroup: ProductGroup | null = null;
  try {
    if (relatedLeadId !== null) {
      const { rows: leadRows } = await pool.query<{ product_interest_group: string | null }>(
        "SELECT product_interest_group FROM sally_leads WHERE id = $1 LIMIT 1",
        [relatedLeadId],
      );
      productGroup = (leadRows[0]?.product_interest_group as ProductGroup) ?? null;
    }
    if (!productGroup) {
      const { rows: leadRows } = await pool.query<{ product_interest_group: string | null }>(
        "SELECT product_interest_group FROM sally_leads WHERE email = $1 ORDER BY created_at DESC LIMIT 1",
        [inboundFrom],
      );
      productGroup = (leadRows[0]?.product_interest_group as ProductGroup) ?? null;
    }
  } catch (err) {
    logger.warn({ err, inboundFrom }, "Sally: could not look up lead product group — using generic context");
  }

  // Detect product group from the inbound email body and update the lead if it changed.
  // Only overwrite when a specific group is detected (non-empty); keep the stored group
  // if the keyword check returns "" so a generic reply doesn't clobber a known group.
  const detectedGroup = specialtyToProductGroup(rawSource);
  if (detectedGroup && detectedGroup !== productGroup) {
    const leadIdToUpdate = relatedLeadId ?? (() => {
      // We may not have a relatedLeadId yet; try to look it up by email.
      return null;
    })();
    if (leadIdToUpdate !== null) {
      try {
        await pool.query(
          "UPDATE sally_leads SET product_interest_group = $1 WHERE id = $2",
          [detectedGroup, leadIdToUpdate],
        );
        logger.info(
          { leadId: leadIdToUpdate, oldGroup: productGroup, newGroup: detectedGroup },
          "Sally: updated lead product group from inbound email keywords",
        );
      } catch (err) {
        logger.warn({ err, leadId: leadIdToUpdate }, "Sally: could not update lead product group");
      }
    } else {
      // No lead ID from the thread — try to update by email address
      try {
        await pool.query(
          `UPDATE sally_leads SET product_interest_group = $1
           WHERE id = (
             SELECT id FROM sally_leads WHERE email = $2
             ORDER BY created_at DESC LIMIT 1
           )`,
          [detectedGroup, inboundFrom],
        );
        logger.info(
          { inboundFrom, oldGroup: productGroup, newGroup: detectedGroup },
          "Sally: updated lead product group by email from inbound email keywords",
        );
      } catch (err) {
        logger.warn({ err, inboundFrom }, "Sally: could not update lead product group by email");
      }
    }
    productGroup = detectedGroup;
  }

  // Ask Gemini to analyse + draft the reply
  // Country in the source records is authoritative.  This intentionally also
  // makes unknown recipients English instead of guessing from inbound text.
  const recipientLanguage = await resolveRecipientLanguage({
    email: inboundFrom,
    preferredSource: relatedDoctorId !== null ? "doctor" : relatedLeadId !== null ? "lead" : "customer",
  });
  const generatedAnalysis = await geminiDraftReply(rawSource, sallyName, sallyEmail, productGroup, recipientLanguage);
  // Escalations intentionally ignore the model's reply fields and render a
  // controlled holding template below, so an omitted model field must not
  // suppress that otherwise-valid customer reply.
  if (generatedAnalysis && generatedAnalysis.can_answer !== false) {
    const invalidGeneratedField = invalidSallyEmailContentField(
      generatedAnalysis.reply_subject,
      generatedAnalysis.reply_body,
    );
    if (invalidGeneratedField) {
      logger.warn(
        { inboundFrom, invalidField: invalidGeneratedField },
        "Sally: skipped inbound reply draft with invalid AI content",
      );
      return false;
    }
  }
  const analysis = generatedAnalysis
    ? await enforceInboundReplyLanguage(generatedAnalysis, recipientLanguage)
    : null;

  // A holding/manual fallback must not reflect an inbound or model subject:
  // either can be in a language that conflicts with the country requirement.
  const subject = analysis?.can_answer === true
    ? analysis.reply_subject
    : controlledReplySubject(recipientLanguage);
  let body: string;
  if (!analysis) {
    body = manualReplyFallback(recipientLanguage, sallyName, sallyEmail);
  } else if (analysis.can_answer === false) {
    // Customer-facing holding reply comes from a controlled template, never from
    // the model. Start without a forwarding claim; upgrade the draft only after
    // customer-service delivery succeeds.
    body = holdingReplyTemplate(recipientLanguage, analysis.formality, sallyName, sallyEmail, false);
  } else {
    body = analysis.reply_body || `[AI reply empty — please reply manually to ${inboundFrom}]`;
  }
  // This is deliberately after AI language enforcement. The legal company
  // details always come from the current CMS content, never from the model.
  body = await appendImpressumSignature(body, recipientLanguage);
  const invalidField = invalidSallyEmailContentField(subject, body);
  if (invalidField) {
    logger.warn({ inboundFrom, invalidField }, "Sally: skipped inbound reply draft with invalid content");
    return false;
  }

  // Atomic dedupe on the inbound Message-ID (partial unique index): concurrent
  // polls of the same message result in exactly one draft + one escalation.
  const { rows: inserted } = await pool.query<{ id: number }>(
    `INSERT INTO sally_email_queue
       (recipient_email, subject, body, trigger_type, status,
        related_lead_id, related_doctor_id,
        in_reply_to, inbound_from, inbound_body,
        detected_language, detected_formality, inbound_message_id)
     VALUES ($1, $2, $3, 'inbound_reply', 'pending',
             $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (inbound_message_id)
       WHERE trigger_type = 'inbound_reply' AND inbound_message_id IS NOT NULL
      DO NOTHING
      RETURNING id`,
    [
      inboundFrom, subject, body,
      relatedLeadId, relatedDoctorId,
      inReplyToMessageId ?? null, inboundFrom,
      rawSource.slice(0, 10000),
       recipientLanguage,
      analysis?.formality  ?? null,
      inboundMessageId ?? null,
    ],
  );
  const draftId = inserted[0]?.id;
  if (draftId === undefined) return false; // another poll already processed this message

  logger.info(
    { inboundFrom, lang: recipientLanguage, formality: analysis?.formality },
    "Sally: inbound reply draft created",
  );

  // Escalation: Sally can't answer properly → raise to admin + forward to customer service
  if (analysis && analysis.can_answer === false) {
    // Persist the delivery attempt before crossing the email boundary. If the
    // process or terminal status write fails after acceptance, "forwarding"
    // remains non-retryable and surfaces for manual reconciliation.
    const { rowCount: claimed } = await pool.query(
      `UPDATE sally_email_queue
          SET escalation_forward_status = 'forwarding', updated_at = NOW()
        WHERE id = $1 AND escalation_forward_status IS NULL`,
      [draftId],
    );
    if (!claimed) return true;
    const forwardingOutcome = await escalateInquiry({
      inboundFrom,
      inboundSubject,
      rawSource,
      summary: analysis.escalation_summary,
      sallyName,
    });
    if (forwardingOutcome !== "unconfirmed") {
      await pool.query(
        "UPDATE sally_email_queue SET escalation_forward_status = $1, updated_at = NOW() WHERE id = $2",
        [forwardingOutcome, draftId],
      );
    }
    const forwarded = forwardingOutcome === "succeeded";
    if (forwarded) {
      try {
        const forwardedBody = await appendImpressumSignature(
          holdingReplyTemplate(recipientLanguage, analysis.formality, sallyName, sallyEmail, true),
          recipientLanguage,
        );
        await pool.query(
          "UPDATE sally_email_queue SET body = $1, updated_at = NOW() WHERE id = $2 AND status = 'pending'",
          [forwardedBody, draftId],
        );
      } catch (err) {
        logger.error({ err, draftId, inboundFrom }, "Sally: failed to update holding reply after forwarding");
      }
    }
  }
  return true;
}

/** Customer-service inbox for inquiries Sally can't answer herself (configurable). */
async function getCustomerServiceEmail(): Promise<string> {
  return getEmailDest("sally_escalation_email", { mailboxPurpose: "sally_ai" });
}

/**
 * Retries an escalation that could not be forwarded when its inbound email was
 * first processed. The conditional update acts as a short-lived claim: only
 * one administrator request can retry a failed escalation at a time.
 */
export async function retryFailedEscalation(
  queueItemId: number,
  actor = "admin",
): Promise<"succeeded" | "failed" | "unconfirmed" | "not_found" | "not_retryable"> {
  // Resolve all local prerequisites before claiming. Once the claim is stored
  // as "forwarding", it represents "delivery in progress or outcome unconfirmed" and
  // must never be changed back to retryable after the external send starts.
  const { rows: settings } = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1)",
    [["sally_from_name", "sally_from_email"]],
  );
  const settingMap = Object.fromEntries(settings.map(setting => [setting.key, setting.value]));
  const sallyName = settingMap.sally_from_name || "Sally";
  const sallyEmail = settingMap.sally_from_email || "";

  const { rows } = await pool.query<{
    inbound_from: string | null;
    subject: string;
    inbound_body: string | null;
    detected_language: string | null;
    detected_formality: "formal" | "informal" | null;
  }>(
    `UPDATE sally_email_queue
        SET escalation_forward_status = 'forwarding', updated_at = NOW()
      WHERE id = $1
        AND trigger_type = 'inbound_reply'
        AND status = 'pending'
        AND escalation_forward_status = 'failed'
        AND inbound_from IS NOT NULL
        AND BTRIM(inbound_from) <> ''
      RETURNING inbound_from, subject, inbound_body, detected_language, detected_formality`,
    [queueItemId],
  );
  const item = rows[0];
  if (!item) {
    const { rows: exists } = await pool.query<{ id: number }>(
      "SELECT id FROM sally_email_queue WHERE id = $1",
      [queueItemId],
    );
    return exists[0] ? "not_retryable" : "not_found";
  }

  // The atomic claim excludes null/blank inbound addresses, so invalid legacy
  // rows remain in the durable failed state rather than being claimed and then
  // requiring a potentially fallible recovery write.
  const inboundFrom = item.inbound_from!.trim();

  // "forwarding" is a durable, non-retryable delivery claim. This intentionally favors
  // manual reconciliation over duplicate customer-service forwards: SMTP or
  // Microsoft 365 can accept a message before a later DB write fails.
  const auditActor = reconciliationActor(actor);
  try {
    const forwardingOutcome = await escalateInquiry({
      inboundFrom,
      inboundSubject: item.subject,
      rawSource: item.inbound_body ?? "",
      summary: "",
      sallyName,
    });
    const resultingStatus = forwardingOutcome === "unconfirmed" ? "forwarding" : forwardingOutcome;
    const auditAction = forwardingOutcome === "succeeded"
      ? "retry_succeeded"
      : forwardingOutcome === "failed"
        ? "retry_failed"
        : "retry_unconfirmed";
    const finalClient = await pool.connect();
    try {
      await finalClient.query("BEGIN");
      if (forwardingOutcome !== "unconfirmed") {
        await finalClient.query(
          "UPDATE sally_email_queue SET escalation_forward_status = $1, updated_at = NOW() WHERE id = $2",
          [forwardingOutcome, queueItemId],
        );
      }
      await finalClient.query(
        `INSERT INTO sally_escalation_reconciliation_audit
          (queue_item_id, action, previous_status, resulting_status, actor)
         VALUES ($1, $2, 'forwarding', $3, $4)`,
        [queueItemId, auditAction, resultingStatus, auditActor],
      );
      await finalClient.query("COMMIT");
    } catch (err) {
      await finalClient.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      finalClient.release();
    }
    const forwarded = forwardingOutcome === "succeeded";
    if (forwarded) {
      try {
        const body = await appendImpressumSignature(
          holdingReplyTemplate(item.detected_language ?? undefined, item.detected_formality ?? undefined, sallyName, sallyEmail, true),
          item.detected_language === "de" ? "de" : "en",
        );
        await pool.query(
          "UPDATE sally_email_queue SET body = $1, updated_at = NOW() WHERE id = $2 AND status = 'pending'",
          [body, queueItemId],
        );
      } catch (err) {
        logger.error({ err, queueItemId, inboundFrom }, "Sally: failed to update holding reply after escalation retry");
      }
    }
    return forwardingOutcome;
  } catch (err) {
    logger.error(
      { err, queueItemId, inboundFrom },
      "Sally: escalation retry outcome is unconfirmed; automatic retry disabled to prevent duplicate forwarding",
    );
    throw err;
  }
}

export type EscalationConfirmationResult = "confirmed" | "not_found" | "conflict";
export type EscalationResendResult = "succeeded" | "failed" | "unconfirmed" | "not_found" | "conflict";

export interface SallyEscalationReconciliationAudit {
  id: number;
  queue_item_id: number;
  action: string;
  previous_status: string | null;
  resulting_status: string | null;
  actor: string;
  acknowledged_duplicate_risk: boolean;
  created_at: Date;
}

/**
 * Returns the immutable reconciliation trail for a queue item.
 *
 * This is intentionally a plain read without a row lock. Reconciliation
 * mutations retain their transaction-level concurrency protection, while
 * administrators can inspect the trail without affecting those claims.
 */
export async function getEscalationReconciliationHistory(
  queueItemId: number,
): Promise<SallyEscalationReconciliationAudit[]> {
  const { rows } = await pool.query<SallyEscalationReconciliationAudit>(
    `SELECT id, queue_item_id, action, previous_status, resulting_status,
            actor, acknowledged_duplicate_risk, created_at
       FROM sally_escalation_reconciliation_audit
      WHERE queue_item_id = $1
      ORDER BY created_at ASC, id ASC`,
    [queueItemId],
  );
  return rows;
}

function reconciliationActor(actor: string): string {
  const normalized = actor.trim().slice(0, 200);
  return normalized || "admin";
}

/**
 * Confirms an uncertain escalation after an administrator has checked the
 * customer-service mailbox. The conditional update and audit insert share one
 * transaction, so two administrators cannot both reconcile the same delivery.
 */
export async function confirmEscalationDelivery(
  queueItemId: number,
  actor: string,
): Promise<EscalationConfirmationResult> {
  const client = await pool.connect();
  const auditActor = reconciliationActor(actor);
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ previous_status: string }>(
      `WITH target AS (
         SELECT id, escalation_forward_status
           FROM sally_email_queue
          WHERE id = $1
            AND trigger_type = 'inbound_reply'
            AND status IN ('pending', 'sent')
            AND escalation_forward_status IN ('forwarding', 'unconfirmed')
          FOR UPDATE
       )
       UPDATE sally_email_queue AS queue
          SET escalation_forward_status = 'confirmed', updated_at = NOW()
         FROM target
        WHERE queue.id = target.id
        RETURNING target.escalation_forward_status AS previous_status`,
      [queueItemId],
    );
    if (rows[0]) {
      await client.query(
        `INSERT INTO sally_escalation_reconciliation_audit
          (queue_item_id, action, previous_status, resulting_status, actor)
         VALUES ($1, 'confirm_delivery', $2, 'confirmed', $3)`,
        [queueItemId, rows[0].previous_status, auditActor],
      );
      await client.query("COMMIT");
      return "confirmed";
    }

    const { rows: existing } = await client.query<{ escalation_forward_status: string }>(
      "SELECT escalation_forward_status FROM sally_email_queue WHERE id = $1 FOR UPDATE",
      [queueItemId],
    );
    if (!existing[0]) {
      await client.query("COMMIT");
      return "not_found";
    }
    await client.query(
      `INSERT INTO sally_escalation_reconciliation_audit
        (queue_item_id, action, previous_status, resulting_status, actor)
       VALUES ($1, 'confirm_conflict', $2, $2, $3)`,
      [queueItemId, existing[0].escalation_forward_status ?? null, auditActor],
    );
    await client.query("COMMIT");
    return "conflict";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Resends an uncertain escalation only after the administrator explicitly
 * acknowledges that the original may already have been delivered. A durable
 * `resending` claim is recorded before the external call; if that call has an
 * ambiguous outcome, the claim remains non-retryable until a human reconciles it.
 */
export async function resendUnconfirmedEscalation(
  queueItemId: number,
  actor: string,
): Promise<EscalationResendResult> {
  const { rows: settings } = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1)",
    [["sally_from_name", "sally_from_email"]],
  );
  const settingMap = Object.fromEntries(settings.map(setting => [setting.key, setting.value]));
  const sallyName = settingMap.sally_from_name || "Sally";
  const sallyEmail = settingMap.sally_from_email || "";
  const auditActor = reconciliationActor(actor);

  const client = await pool.connect();
  let item: {
    inbound_from: string;
    subject: string;
    inbound_body: string | null;
    detected_language: string | null;
    detected_formality: "formal" | "informal" | null;
    previous_status: string;
  } | undefined;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<NonNullable<typeof item>>(
      `WITH target AS (
         SELECT id, escalation_forward_status
           FROM sally_email_queue
          WHERE id = $1
            AND trigger_type = 'inbound_reply'
            AND status IN ('pending', 'sent')
            AND escalation_forward_status IN ('forwarding', 'unconfirmed')
            AND inbound_from IS NOT NULL
            AND BTRIM(inbound_from) <> ''
          FOR UPDATE
       )
       UPDATE sally_email_queue AS queue
          SET escalation_forward_status = 'resending', updated_at = NOW()
         FROM target
        WHERE queue.id = target.id
        RETURNING queue.inbound_from, queue.subject, queue.inbound_body,
                  queue.detected_language, queue.detected_formality,
                  target.escalation_forward_status AS previous_status`,
      [queueItemId],
    );
    item = rows[0];
    if (item) {
      await client.query(
        `INSERT INTO sally_escalation_reconciliation_audit
          (queue_item_id, action, previous_status, resulting_status, actor,
           acknowledged_duplicate_risk)
         VALUES ($1, 'resend_requested', $2, 'resending', $3, true)`,
        [queueItemId, item.previous_status, auditActor],
      );
      await client.query("COMMIT");
    } else {
      const { rows: existing } = await client.query<{ escalation_forward_status: string }>(
        "SELECT escalation_forward_status FROM sally_email_queue WHERE id = $1 FOR UPDATE",
        [queueItemId],
      );
      if (!existing[0]) {
        await client.query("COMMIT");
        return "not_found";
      }
      await client.query(
        `INSERT INTO sally_escalation_reconciliation_audit
          (queue_item_id, action, previous_status, resulting_status, actor,
           acknowledged_duplicate_risk)
         VALUES ($1, 'resend_conflict', $2, $2, $3, true)`,
        [queueItemId, existing[0].escalation_forward_status ?? null, auditActor],
      );
      await client.query("COMMIT");
      return "conflict";
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const forwardingOutcome = await escalateInquiry({
    inboundFrom: item.inbound_from.trim(),
    inboundSubject: item.subject,
    rawSource: item.inbound_body ?? "",
    summary: "",
    sallyName,
  });
  const resultingStatus = forwardingOutcome === "succeeded"
    ? "succeeded"
    : forwardingOutcome === "failed"
      ? "failed"
      : "resending";
  const auditAction = forwardingOutcome === "succeeded"
    ? "resend_succeeded"
    : forwardingOutcome === "failed"
      ? "resend_failed"
      : "resend_unconfirmed";

  const finalClient = await pool.connect();
  try {
    await finalClient.query("BEGIN");
    await finalClient.query(
      `UPDATE sally_email_queue
          SET escalation_forward_status = $1, updated_at = NOW()
        WHERE id = $2 AND escalation_forward_status = 'resending'`,
      [resultingStatus, queueItemId],
    );
    await finalClient.query(
      `INSERT INTO sally_escalation_reconciliation_audit
        (queue_item_id, action, previous_status, resulting_status, actor,
         acknowledged_duplicate_risk)
       VALUES ($1, $2, 'resending', $3, $4, true)`,
      [queueItemId, auditAction, resultingStatus, auditActor],
    );
    await finalClient.query("COMMIT");
  } catch (err) {
    await finalClient.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    finalClient.release();
  }

  if (forwardingOutcome === "succeeded") {
    try {
      const body = await appendImpressumSignature(
        holdingReplyTemplate(
          item.detected_language ?? undefined,
          item.detected_formality ?? undefined,
          sallyName,
          sallyEmail,
          true,
        ),
        item.detected_language === "de" ? "de" : "en",
      );
      await pool.query(
        "UPDATE sally_email_queue SET body = $1, updated_at = NOW() WHERE id = $2 AND status = 'pending'",
        [body, queueItemId],
      );
    } catch (err) {
      logger.error({ err, queueItemId }, "Sally: failed to update holding reply after manual escalation resend");
    }
  }
  return forwardingOutcome;
}

/**
 * Controlled, deterministic holding reply for escalated inquiries — never
 * model-generated, so the customer-facing promise is always correct.
 * German (formal/informal) and English; any other language falls back to English.
 */
function holdingReplyTemplate(
  language: string | undefined,
  formality: "formal" | "informal" | undefined,
  sallyName: string,
  sallyEmail: string,
  forwarded: boolean,
): string {
  const signature = `${sallyName}\nSales Manager | iROC GmbH\n${sallyEmail}`;
  if ((language ?? "de") === "de") {
    if (formality === "informal") {
      return forwarded
        ? `Hallo,\n\nvielen Dank für deine Nachricht. Ich habe deine Anfrage an unsere Kundenservice-Abteilung weitergeleitet — du erhältst in Kürze eine Antwort.\n\nViele Grüße,\n\n${signature}`
        : `Hallo,\n\nvielen Dank für deine Nachricht. Ich prüfe dein Anliegen und melde mich so bald wie möglich bei dir.\n\nViele Grüße,\n\n${signature}`;
    }
    return forwarded
      ? `Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Nachricht. Ich habe Ihre Anfrage an unsere Kundenservice-Abteilung weitergeleitet — Sie erhalten in Kürze eine Antwort.\n\nMit freundlichen Grüßen,\n\n${signature}`
      : `Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Nachricht. Wir prüfen Ihr Anliegen und melden uns so bald wie möglich bei Ihnen.\n\nMit freundlichen Grüßen,\n\n${signature}`;
  }
  if (formality === "informal") {
    return forwarded
      ? `Hi,\n\nthank you for your message. I have forwarded your inquiry to our customer service department — you will receive an answer shortly.\n\nBest regards,\n\n${signature}`
      : `Hi,\n\nthank you for your message. I am reviewing your inquiry and will get back to you as soon as possible.\n\nBest regards,\n\n${signature}`;
  }
  return forwarded
    ? `Dear Sir or Madam,\n\nthank you for your message. I have forwarded your inquiry to our customer service department — you will receive an answer shortly.\n\nKind regards,\n\n${signature}`
    : `Dear Sir or Madam,\n\nthank you for your message. We are reviewing your inquiry and will get back to you as soon as possible.\n\nKind regards,\n\n${signature}`;
}

/**
 * Raises an unanswerable inquiry to the admin (bell notification) and forwards
 * the original message to the customer service inbox. Both are best-effort:
 * a failure here must never block the customer's holding reply from being queued.
 */
async function escalateInquiry(opts: {
  inboundFrom: string;
  inboundSubject: string;
  rawSource: string;
  summary: string;
  sallyName: string;
}): Promise<"succeeded" | "failed" | "unconfirmed"> {
  const { inboundFrom, inboundSubject, rawSource, sallyName } = opts;
  // Bound + strip line breaks from the model summary (internal use only)
  const summary = opts.summary.replace(/[\r\n]+/g, " ").slice(0, 500);
  let customerServiceEmail = "";
  let forwardingError: unknown;
  let deliveryAttempted = false;
  try {
    customerServiceEmail = await getCustomerServiceEmail();
    if (!customerServiceEmail.trim()) {
      throw new Error("Sally customer service destination is empty.");
    }
    const { sendEmail } = await import("./email.js");
    deliveryAttempted = true;
    await sendEmail({
      to: customerServiceEmail,
      subject: `[Sally-Eskalation] ${inboundSubject}`,
      text:
        `Sally konnte die folgende Kundenanfrage nicht beantworten und hat dem Kunden mitgeteilt, ` +
        `dass sie an den Kundenservice weitergeleitet wurde und in Kürze beantwortet wird.\n\n` +
        `Von: ${inboundFrom}\n` +
        `Betreff: ${inboundSubject}\n` +
        (summary ? `Zusammenfassung: ${summary}\n` : "") +
        `\n--- Originalnachricht ---\n${rawSource.slice(0, 8000)}\n\n` +
        `Bitte antworten Sie dem Kunden direkt unter ${inboundFrom}.\n\n— ${sallyName} (automatische Weiterleitung)`,
      replyTo: inboundFrom,
      mailboxPurpose: "sally_ai",
    });
    logger.info({ inboundFrom }, "Sally: escalated inquiry forwarded to customer service");
  } catch (err) {
    forwardingError = err;
    logger.error({ err, inboundFrom }, "Sally: failed to forward escalated inquiry to customer service");
  }

  try {
    const errorDetails = forwardingError instanceof Error
      ? ` ${forwardingError.message}`
      : "";
    await pool.query(
      "INSERT INTO iroc_notifications (type, message) VALUES ('sally_escalation', $1)",
      [JSON.stringify({
        de: forwardingError
          ? `Sally konnte eine Kundenanfrage von ${inboundFrom} nicht weiterleiten${summary ? ` — ${summary}` : ""}. Der Versand über die Rolle 'sally_ai' ist fehlgeschlagen.${errorDetails}`
          : `Sally konnte eine Kundenanfrage von ${inboundFrom} nicht beantworten${summary ? ` — ${summary}` : ""}. Die Anfrage wurde an ${customerServiceEmail} weitergeleitet.`,
        en: forwardingError
          ? `Sally could not forward a customer inquiry from ${inboundFrom}${summary ? ` — ${summary}` : ""}. Delivery through mailbox role 'sally_ai' failed.${errorDetails}`
          : `Sally could not answer a customer inquiry from ${inboundFrom}${summary ? ` — ${summary}` : ""}. The inquiry was forwarded to ${customerServiceEmail}.`,
      })],
    );
  } catch (err) {
    logger.error({ err, inboundFrom }, "Sally: failed to create escalation notification");
  }
  if (forwardingError === undefined) return "succeeded";
  // Destination/configuration failures before sendEmail are definitely
  // retryable. Once a transport call starts, any thrown error can occur after
  // provider acceptance and must remain non-retryable pending manual review.
  return deliveryAttempted ? "unconfirmed" : "failed";
}
