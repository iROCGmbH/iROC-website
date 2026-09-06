/**
 * Integration tests: Sally inbound-inquiry escalation
 *
 * When Sally can't properly answer a customer email (can_answer=false from the
 * AI analysis), processInboundEmail must:
 *   1. Still queue a customer-facing holding reply as a pending inbound_reply
 *      draft, claiming forwarding only after delivery succeeds.
 *   2. Raise the question to the admin via an iroc_notifications row
 *      (type 'sally_escalation').
 *   3. Forward the original inquiry only when the Sally destination is configured.
 * When can_answer=true, none of the escalation side effects may fire.
 *
 * Gemini and SMTP are mocked; the queue/notifications run on the real dev DB.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { pool } from "@workspace/db";

const state = vi.hoisted(() => ({
  analysis: {} as Record<string, unknown>,
  responses: [] as Record<string, unknown>[],
  rawResponses: [] as string[],
  sent: [] as {
    to?: string;
    subject: string;
    text: string;
    replyTo?: string;
    mailboxPurpose?: string;
  }[],
  customerServiceEmail: "",
  sendError: false,
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: async () => ({
        candidates: [{ content: { parts: [{ text: state.rawResponses.shift() ?? JSON.stringify(state.responses.shift() ?? state.analysis) }] } }],
      }),
    },
  },
}));

vi.mock("../lib/email.js", () => ({
  getEmailDest: async () => {
    if (state.customerServiceEmail) return state.customerServiceEmail;
    throw new Error(
      "Automated email flow 'Sally' cannot be sent: mailbox role 'sally_ai' is unavailable.",
    );
  },
  sendEmail: async (opts: { to?: string; subject: string; text: string; replyTo?: string }) => {
    if (state.sendError) throw new Error("Escalation delivery failed");
    state.sent.push(opts);
    return { messageId: "mock-message-id" };
  },
}));

import { processInboundEmail, retryFailedEscalation } from "../lib/sally-reply.js";

const FROM = "sally-escalation-test@example.com";
const GERMAN_FROM = "sally-escalation-german@example.com";
const AUSTRIAN_FROM = "sally-escalation-austrian@example.com";

async function cleanup() {
  state.sendError = false;
  await pool.query("DELETE FROM sally_email_queue WHERE inbound_from = $1", [FROM]);
  await pool.query("DELETE FROM iroc_notifications WHERE type = 'sally_escalation' AND message LIKE '%' || $1 || '%'", [FROM]);
  await pool.query("DELETE FROM settings WHERE key = 'sally_escalation_email'");
  await pool.query("DELETE FROM sally_email_queue WHERE inbound_from IN ($1, $2)", [GERMAN_FROM, AUSTRIAN_FROM]);
  await pool.query("DELETE FROM iroc_leads WHERE email IN ($1, $2)", [GERMAN_FROM, AUSTRIAN_FROM]);
}

beforeAll(async () => {
  await pool.query(`
    ALTER TABLE sally_email_queue
      DROP CONSTRAINT IF EXISTS sally_email_queue_escalation_forward_status_check;
    ALTER TABLE sally_email_queue
      ADD CONSTRAINT sally_email_queue_escalation_forward_status_check
        CHECK (escalation_forward_status IN ('forwarding', 'succeeded', 'failed'));
  `);
  await cleanup();
});
afterAll(cleanup);

describe("Sally inbound escalation", () => {
  it("can_answer=false → holding reply queued and missing Sally destination is reported", async () => {
    state.sent = [];
    state.customerServiceEmail = "";
    state.analysis = {
      language: "de",
      formality: "formal",
      can_answer: false,
      escalation_summary: "Customer asks about clinical study data for Spirecut.",
      reply_subject: "Re: Frage zu klinischen Daten",
      reply_body:
        "Sehr geehrter Herr Test,\n\nvielen Dank für Ihre Anfrage. Ich habe sie an unsere Kundenservice-Abteilung weitergeleitet; Sie erhalten in Kürze eine Antwort.\n\nMit freundlichen Grüßen,\nSally",
    };

    const msgId = "escalation-test-" + Date.now() + "@example.com";
    const send = () => processInboundEmail({
      inboundFrom: FROM,
      inboundSubject: "Frage zu klinischen Daten",
      rawSource: "From: " + FROM + "\nSubject: Frage zu klinischen Daten\n\nGibt es klinische Studien zum Spirecut-Verfahren?",
      inboundMessageId: msgId,
      sallyName: "Sally",
      sallyEmail: "sally@i-roc.de",
    });

    // Concurrent polls of the SAME message → exactly one draft + one escalation
    const results = await Promise.all([send(), send(), send()]);
    expect(results.filter(Boolean).length).toBe(1);

    // 1. Holding reply queued for admin approval without claiming that the
    // unavailable forwarding destination received it.
    const { rows: drafts } = await pool.query<{
      recipient_email: string;
      trigger_type: string;
      status: string;
      subject: string;
      body: string;
      escalation_forward_status: string | null;
    }>(
      "SELECT recipient_email, trigger_type, status, subject, body, escalation_forward_status FROM sally_email_queue WHERE inbound_from = $1",
      [FROM],
    );
    expect(drafts.length).toBe(1);
    expect(drafts[0]).toMatchObject({
      recipient_email: FROM,
      trigger_type: "inbound_reply",
      status: "pending",
      escalation_forward_status: "failed",
    });
    // Holding reply comes from the controlled template, not the model
    // No authoritative country record exists for this fixture: unknown is English,
    // even though the inbound message and model analysis are German.
    expect(drafts[0].body).toContain("We are reviewing your inquiry");
    expect(drafts[0].body).not.toContain("forwarded your inquiry");
    expect(drafts[0].subject).toBe("Your message to iROC GmbH");

    // 2. Admin notification raised, even though the required escalation
    // destination is not configured.
    const { rows: notifs } = await pool.query(
      "SELECT message FROM iroc_notifications WHERE type = 'sally_escalation' AND message LIKE '%' || $1 || '%'",
      [FROM],
    );
    expect(notifs.length).toBe(1);
    expect(notifs[0].message).toContain("mailbox role 'sally_ai'");
    expect(notifs[0].message).toContain("clinical study data");

    // 3. No message is sent to the shared fallback mailbox.
    expect(state.sent.length).toBe(0);
  });

  it("uses a German controlled subject for an escalation despite foreign inbound/model subjects", async () => {
    await pool.query(
      `INSERT INTO iroc_leads (first_name, last_name, email, country, status)
       VALUES ('German', 'Recipient', $1, 'Deutschland', 'new')`,
      [GERMAN_FROM],
    );
    state.analysis = {
      language: "fr", formality: "formal", can_answer: false, escalation_summary: "",
      reply_subject: "Objet étranger", reply_body: "Bonjour",
    };
    await processInboundEmail({
      inboundFrom: GERMAN_FROM, inboundSubject: "Objet français", rawSource: "Bonjour",
      inboundMessageId: "german-controlled-subject-" + Date.now(), sallyName: "Sally", sallyEmail: "sally@i-roc.de",
    });
    const { rows } = await pool.query<{ subject: string; body: string }>(
      "SELECT subject, body FROM sally_email_queue WHERE inbound_from = $1 ORDER BY id DESC LIMIT 1", [GERMAN_FROM],
    );
    expect(rows[0].subject).toBe("Ihre Nachricht an iROC GmbH");
    expect(rows[0].body).toContain("Wir prüfen Ihr Anliegen");
    expect(rows[0].body).not.toContain("weitergeleitet");
  });

  it("uses the configured sally_escalation_email setting for the forward and notification", async () => {
    await cleanup();
    state.sent = [];
    state.customerServiceEmail = "service@i-roc.de";
    await pool.query(
      "INSERT INTO settings (key, value, updated_at) VALUES ('sally_escalation_email', 'service@i-roc.de', NOW()) ON CONFLICT (key) DO UPDATE SET value = 'service@i-roc.de'",
    );
    state.analysis = {
      language: "en",
      formality: "formal",
      can_answer: false,
      escalation_summary: "Customer asks about a warranty claim.",
      reply_subject: "Re: Warranty",
      reply_body: "ignored — controlled template used",
    };

    const created = await processInboundEmail({
      inboundFrom: FROM,
      inboundSubject: "Warranty",
      rawSource: "From: " + FROM + "\n\nMy instrument broke, is it covered?",
      inboundMessageId: "escalation-custom-" + Date.now() + "@example.com",
      sallyName: "Sally",
      sallyEmail: "sally@i-roc.de",
    });
    expect(created).toBe(true);
    expect(state.sent.length).toBe(1);
    expect(state.sent[0]).toMatchObject({
      to: "service@i-roc.de",
      replyTo: FROM,
      mailboxPurpose: "sally_ai",
    });

    const { rows: drafts } = await pool.query<{
      body: string;
      escalation_forward_status: string | null;
    }>(
      "SELECT body, escalation_forward_status FROM sally_email_queue WHERE inbound_from = $1 ORDER BY id DESC LIMIT 1",
      [FROM],
    );
    expect(drafts[0].body).toContain("forwarded your inquiry to our customer service department");
    expect(drafts[0].body).toContain("receive an answer shortly");
    expect(drafts[0].escalation_forward_status).toBe("succeeded");

    const { rows: notifs } = await pool.query(
      "SELECT message FROM iroc_notifications WHERE type = 'sally_escalation' AND message LIKE '%' || $1 || '%'",
      [FROM],
    );
    expect(notifs.length).toBe(1);
    expect(notifs[0].message).toContain("service@i-roc.de");
  });

  it("keeps the customer reply truthful when the configured escalation send fails", async () => {
    await cleanup();
    state.sent = [];
    state.customerServiceEmail = "service@i-roc.de";
    state.sendError = true;
    state.analysis = {
      language: "en",
      formality: "formal",
      can_answer: false,
      escalation_summary: "Customer asks about a warranty claim.",
      reply_subject: "Re: Warranty",
      reply_body: "ignored — controlled template used",
    };

    const created = await processInboundEmail({
      inboundFrom: FROM,
      inboundSubject: "Warranty",
      rawSource: "From: " + FROM + "\n\nMy instrument broke, is it covered?",
      inboundMessageId: "escalation-send-failure-" + Date.now() + "@example.com",
      sallyName: "Sally",
      sallyEmail: "sally@i-roc.de",
    });
    expect(created).toBe(true);
    expect(state.sent).toHaveLength(0);

    const { rows: drafts } = await pool.query<{
      body: string;
      escalation_forward_status: string | null;
    }>(
      "SELECT body, escalation_forward_status FROM sally_email_queue WHERE inbound_from = $1 ORDER BY id DESC LIMIT 1",
      [FROM],
    );
    expect(drafts[0].body).toContain("We are reviewing your inquiry");
    expect(drafts[0].body).not.toContain("forwarded your inquiry");
    expect(drafts[0].escalation_forward_status).toBe("forwarding");

    const { rows: notifications } = await pool.query<{ message: string }>(
      "SELECT message FROM iroc_notifications WHERE type = 'sally_escalation' AND message LIKE '%' || $1 || '%'",
      [FROM],
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toContain("Delivery through mailbox role 'sally_ai' failed");
  });

  it("retries a failed escalation once an administrator fixes delivery", async () => {
    await cleanup();
    state.sent = [];
    state.customerServiceEmail = "";
    state.sendError = false;
    state.analysis = {
      language: "en", formality: "formal", can_answer: false,
      escalation_summary: "Customer asks about a warranty claim.",
      reply_subject: "Re: Warranty", reply_body: "ignored — controlled template used",
    };
    await processInboundEmail({
      inboundFrom: FROM, inboundSubject: "Warranty", rawSource: "Original warranty inquiry",
      inboundMessageId: "escalation-retry-" + Date.now(), sallyName: "Sally", sallyEmail: "sally@i-roc.de",
    });
    const { rows: failedDrafts } = await pool.query<{ id: number }>(
      "SELECT id FROM sally_email_queue WHERE inbound_from = $1 AND escalation_forward_status = 'failed' ORDER BY id DESC LIMIT 1",
      [FROM],
    );

    state.customerServiceEmail = "service@i-roc.de";
    const result = await retryFailedEscalation(failedDrafts[0].id);
    expect(result).toBe("succeeded");
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ to: "service@i-roc.de", replyTo: FROM, mailboxPurpose: "sally_ai" });

    const { rows: retriedDrafts } = await pool.query<{ body: string; escalation_forward_status: string }>(
      "SELECT body, escalation_forward_status FROM sally_email_queue WHERE id = $1",
      [failedDrafts[0].id],
    );
    expect(retriedDrafts[0].escalation_forward_status).toBe("succeeded");
    expect(retriedDrafts[0].body).toContain("forwarded your inquiry to our customer service department");
  });

  it("does not resend when delivery succeeds but its terminal DB update fails", async () => {
    await cleanup();
    state.sent = [];
    state.customerServiceEmail = "";
    state.sendError = false;
    state.analysis = {
      language: "en", formality: "formal", can_answer: false,
      escalation_summary: "", reply_subject: "Re: Warranty", reply_body: "ignored",
    };
    await processInboundEmail({
      inboundFrom: FROM, inboundSubject: "Warranty", rawSource: "Original warranty inquiry",
      inboundMessageId: "escalation-retry-exception-" + Date.now(), sallyName: "Sally", sallyEmail: "sally@i-roc.de",
    });
    const { rows: failedDrafts } = await pool.query<{ id: number }>(
      "SELECT id FROM sally_email_queue WHERE inbound_from = $1 AND escalation_forward_status = 'failed' ORDER BY id DESC LIMIT 1",
      [FROM],
    );
    // Raise after sendEmail returns successfully, while recording the terminal
    // status. The durable forwarding claim must remain non-retryable because delivery
    // occurred and its DB outcome is now ambiguous.
    await pool.query(`
      CREATE OR REPLACE FUNCTION sally_retry_claim_failure() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = ${failedDrafts[0].id} AND NEW.escalation_forward_status = 'succeeded' THEN
          RAISE EXCEPTION 'simulated terminal write failure after claim';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS sally_retry_claim_failure_trigger ON sally_email_queue;
      CREATE TRIGGER sally_retry_claim_failure_trigger
        BEFORE UPDATE ON sally_email_queue
        FOR EACH ROW EXECUTE FUNCTION sally_retry_claim_failure();
    `);
    state.customerServiceEmail = "service@i-roc.de";
    await expect(retryFailedEscalation(failedDrafts[0].id)).rejects.toThrow("simulated terminal write failure after claim");
    await pool.query("DROP TRIGGER IF EXISTS sally_retry_claim_failure_trigger ON sally_email_queue");
    await pool.query("DROP FUNCTION IF EXISTS sally_retry_claim_failure()");
    expect(state.sent).toHaveLength(1);

    const { rows: unconfirmed } = await pool.query<{ escalation_forward_status: string | null }>(
      "SELECT escalation_forward_status FROM sally_email_queue WHERE id = $1",
      [failedDrafts[0].id],
    );
    expect(unconfirmed[0].escalation_forward_status).toBe("forwarding");

    await expect(retryFailedEscalation(failedDrafts[0].id)).resolves.toBe("not_retryable");
    expect(state.sent).toHaveLength(1);
  });

  it("never claims a legacy failed escalation with a nullable inbound_from", async () => {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO sally_email_queue
         (recipient_email, subject, body, trigger_type, status, inbound_from, escalation_forward_status)
       VALUES ('legacy@example.com', 'Legacy escalation', 'Pending manual review',
               'inbound_reply', 'pending', NULL, 'failed')
       RETURNING id`,
    );
    const id = rows[0].id;
    // If the implementation attempted the old NULL claim, this trigger would
    // make even its first recovery update fail. The fixed claim predicate skips
    // the row entirely, leaving the durable failed state untouched.
    await pool.query(`
      CREATE OR REPLACE FUNCTION sally_nullable_retry_claim_failure() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = ${id} AND NEW.escalation_forward_status = 'forwarding' THEN
          RAISE EXCEPTION 'nullable escalation must not be claimed';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS sally_nullable_retry_claim_failure_trigger ON sally_email_queue;
      CREATE TRIGGER sally_nullable_retry_claim_failure_trigger
        BEFORE UPDATE ON sally_email_queue
        FOR EACH ROW EXECUTE FUNCTION sally_nullable_retry_claim_failure();
    `);
    try {
      await expect(retryFailedEscalation(id)).resolves.toBe("not_retryable");
      const { rows: unchanged } = await pool.query<{ escalation_forward_status: string }>(
        "SELECT escalation_forward_status FROM sally_email_queue WHERE id = $1",
        [id],
      );
      expect(unchanged[0].escalation_forward_status).toBe("failed");
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS sally_nullable_retry_claim_failure_trigger ON sally_email_queue");
      await pool.query("DROP FUNCTION IF EXISTS sally_nullable_retry_claim_failure()");
      await pool.query("DELETE FROM sally_email_queue WHERE id = $1", [id]);
    }
  });

  it("can_answer=true → no escalation side effects", async () => {
    await cleanup();
    state.sent = [];
    state.analysis = {
      language: "en",
      formality: "formal",
      can_answer: true,
      escalation_summary: "",
      reply_subject: "Re: Thank you",
      reply_body: "Dear Customer,\n\nThank you for your message.\n\nKind regards,\nSally",
    };

    const created = await processInboundEmail({
      inboundFrom: FROM,
      inboundSubject: "Thank you",
      rawSource: "From: " + FROM + "\n\nThanks for the quick delivery!",
      sallyName: "Sally",
      sallyEmail: "sally@i-roc.de",
    });
    expect(created).toBe(true);

    const { rows: drafts } = await pool.query(
      "SELECT trigger_type, status FROM sally_email_queue WHERE inbound_from = $1",
      [FROM],
    );
    expect(drafts.length).toBe(1);

    const { rows: notifs } = await pool.query(
      "SELECT id FROM iroc_notifications WHERE type = 'sally_escalation' AND message LIKE '%' || $1 || '%'",
      [FROM],
    );
    expect(notifs.length).toBe(0);
    expect(state.sent.length).toBe(0);
  });

  it("rewrites conflicting model output before queuing an unknown-country reply", async () => {
    await cleanup();
    state.responses = [
      {
        language: "de", formality: "formal", can_answer: true, escalation_summary: "",
        reply_subject: "Re: Danke",
        reply_body: "Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Nachricht.\n\nMit freundlichen Grüßen,\nSally",
      },
      {
        reply_subject: "Re: Thank you",
        reply_body: "Dear Customer,\n\nthank you for your message.\n\nKind regards,\nSally\nSales Manager | iROC GmbH\nsally@i-roc.de",
      },
    ];
    const created = await processInboundEmail({
      inboundFrom: FROM,
      inboundSubject: "Danke",
      rawSource: `From: ${FROM}\n\nDanke für Ihre Hilfe.`,
      inboundMessageId: "language-rewrite-" + Date.now() + "@example.com",
      sallyName: "Sally",
      sallyEmail: "sally@i-roc.de",
    });
    expect(created).toBe(true);
    const { rows } = await pool.query<{ subject: string; body: string; detected_language: string }>(
      "SELECT subject, body, detected_language FROM sally_email_queue WHERE inbound_from = $1 ORDER BY id DESC LIMIT 1",
      [FROM],
    );
    expect(rows[0]).toMatchObject({ subject: "Re: Thank you", detected_language: "en" });
    expect(rows[0].body).toContain("thank you for your message");
    expect(rows[0].body).not.toContain("Sehr geehrte");
  });

  it("fails closed when French falsely declares English and the rewrite is also French", async () => {
    await cleanup();
    state.responses = [
      {
        language: "en", formality: "formal", can_answer: true, escalation_summary: "",
        reply_subject: "Re: Merci",
        reply_body: "Bonjour,\n\nmerci pour votre message. Nous vous répondrons bientôt.\n\nCordialement,\nSally",
      },
      {
        reply_subject: "Re: Merci",
        reply_body: "Bonjour,\n\nmerci pour votre message.\n\nCordialement,\nSally",
      },
    ];
    await processInboundEmail({
      inboundFrom: FROM,
      inboundSubject: "Merci",
      rawSource: `From: ${FROM}\n\nMerci.`,
      inboundMessageId: "french-language-fallback-" + Date.now() + "@example.com",
      sallyName: "Sally",
      sallyEmail: "sally@i-roc.de",
    });
    const { rows } = await pool.query<{ body: string; detected_language: string }>(
      "SELECT body, detected_language FROM sally_email_queue WHERE inbound_from = $1 ORDER BY id DESC LIMIT 1",
      [FROM],
    );
    expect(rows[0].detected_language).toBe("en");
    expect(rows[0].body).toContain("We are reviewing your inquiry");
    expect(rows[0].body).not.toContain("Bonjour");
  });

  it.each([
    ["subject", { reply_subject: "   ", reply_body: "Dear Customer,\n\nThank you for your message." }],
    ["body", { reply_subject: "Re: Your question", reply_body: "\n\t" }],
  ])("skips an AI draft with a blank %s without inserting a queue row", async (_field, content) => {
    await cleanup();
    state.rawResponses = [];
    state.responses = [];
    state.analysis = {
      language: "en",
      formality: "formal",
      can_answer: true,
      escalation_summary: "",
      ...content,
    };

    const created = await processInboundEmail({
      inboundFrom: FROM,
      inboundSubject: "Customer question",
      rawSource: `From: ${FROM}\n\nPlease send more information.`,
      inboundMessageId: `invalid-ai-content-${_field}-${Date.now()}@example.com`,
      sallyName: "Sally",
      sallyEmail: "sally@i-roc.de",
    });

    expect(created).toBe(false);
    const { rows } = await pool.query(
      "SELECT id FROM sally_email_queue WHERE inbound_from = $1",
      [FROM],
    );
    expect(rows).toHaveLength(0);
  });

  it("uses a German deterministic subject/body when AI generation fails for an Austrian recipient", async () => {
    await pool.query(
      `INSERT INTO iroc_leads (first_name, last_name, email, country, status)
       VALUES ('Austrian', 'Recipient', $1, 'Österreich', 'new')`,
      [AUSTRIAN_FROM],
    );
    state.rawResponses = ["not valid JSON"];
    await processInboundEmail({
      inboundFrom: AUSTRIAN_FROM, inboundSubject: "Sujet français", rawSource: "Bonjour",
      inboundMessageId: "austrian-ai-failure-" + Date.now(), sallyName: "Sally", sallyEmail: "sally@i-roc.de",
    });
    const { rows } = await pool.query<{ subject: string; body: string; detected_language: string }>(
      "SELECT subject, body, detected_language FROM sally_email_queue WHERE inbound_from = $1 ORDER BY id DESC LIMIT 1", [AUSTRIAN_FROM],
    );
    expect(rows[0]).toMatchObject({ subject: "Ihre Nachricht an iROC GmbH", detected_language: "de" });
    expect(rows[0].body).toContain("Wir prüfen Ihr Anliegen");
  });
});
