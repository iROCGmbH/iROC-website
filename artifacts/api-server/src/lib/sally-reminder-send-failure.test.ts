/**
 * Integration tests: admin is notified when a payment reminder fails to send
 * after approval (#534)
 *
 * What & Why
 * ──────────
 * When the admin approves a payment reminder queue row and `sendEmail()` throws
 * (e.g. SMTP is unreachable), the current flow must:
 *
 *   1. Keep the queue row at `'pending'` (it is never flipped to `'sent'` because
 *      the status update only happens after a successful send).
 *
 *   2. Insert a `payment_reminder_send_failed` notification row into
 *      `iroc_notifications` so the admin can see the failure in the UI.
 *
 * The test mocks `sendEmail` to throw an SMTP error, then calls
 * `approveAndSendEmail` directly and asserts both invariants.
 *
 * All DB rows are created and cleaned up in beforeAll / afterAll.
 */

import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { pool } from "@workspace/db";

// ── Mock email transport ──────────────────────────────────────────────────────
// Mock before importing the module under test so the stub is in place when
// approveAndSendEmail's module-level import is resolved.
vi.mock("./email.js", () => ({
  sendEmail:        vi.fn(),
  isSmtpConfigured: vi.fn().mockResolvedValue(true),
  getEmailDest:     vi.fn().mockResolvedValue("admin@i-roc.de"),
}));

// Import AFTER the mock is registered
import { approveAndSendEmail } from "./sally-cron.js";
import * as emailModule from "./email.js";
import { buildImpressumSignature } from "./impressum-signature.js";

// ── Shared state ──────────────────────────────────────────────────────────────

const CUSTOMER_NR = "TEST-SNDFL-534";
const TEST_EMAIL  = "send-failure-test-534@example.com";
let wcId: number;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureWebsiteCustomer(): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO website_customers
       (customer_nr, first_name, last_name, email, address, postal_code, city, country, instrument)
     VALUES ($1, 'Send', 'Failure', $2, 'Teststr. 1', '80331', 'München', 'DE', 'iroc')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [CUSTOMER_NR, TEST_EMAIL],
  );
  if (rows.length) return rows[0].id;
  const { rows: ex } = await pool.query<{ id: number }>(
    "SELECT id FROM website_customers WHERE customer_nr = $1",
    [CUSTOMER_NR],
  );
  return ex[0].id;
}

async function insertOverdueInvoice(): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO iroc_invoices
       (invoice_number, website_customer_id, invoice_type, issue_date,
        subtotal, vat_rate, vat_amount, total, delivery_costs,
        status, language, sent_at)
     VALUES (
       'TEST-SNDFL-' || to_char(NOW(), 'YYYYMMDDHH24MISSUS'),
       $1, 'domestic',
       CURRENT_DATE - 15,
       '100.00', '19.00', '19.00', '119.00', '0.00',
       'sent', 'de',
       NOW() - INTERVAL '15 days'
     )
     RETURNING id`,
    [wcId],
  );
  const invoiceId = rows[0].id;
  await pool.query(
    `INSERT INTO iroc_invoice_items
       (invoice_id, product_name, quantity, unit_price, line_total, vat_rate)
     VALUES ($1, 'Test product', 1, '100.00', '100.00', '19.00')`,
    [invoiceId],
  );
  return invoiceId;
}

/** Insert a pending payment_reminder queue row for the given invoice. */
async function insertPendingQueueRow(invoiceId: number): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_email_queue
       (recipient_email, subject, body, trigger_type, status, related_invoice_id)
     VALUES ($1, 'Zahlungserinnerung', 'Please pay.', 'payment_reminder', 'pending', $2)
     RETURNING id`,
    [TEST_EMAIL, invoiceId],
  );
  return rows[0].id;
}

async function cleanup() {
  await pool.query(
    `DELETE FROM iroc_notifications
     WHERE type = 'payment_reminder_send_failed'
       AND message::text LIKE '%TEST-SNDFL-%'`,
  ).catch(() => {});
  // Also clean by queue item reference (no invoice_number in notification for this case)
  await pool.query(
    `DELETE FROM sally_email_queue
     WHERE related_invoice_id IN (
       SELECT id FROM iroc_invoices WHERE website_customer_id = $1
     )`,
    [wcId ?? 0],
  ).catch(() => {});
  await pool.query(
    "DELETE FROM iroc_invoices WHERE website_customer_id = $1",
    [wcId ?? 0],
  ).catch(() => {});
  await pool.query(
    "DELETE FROM website_customers WHERE customer_nr = $1",
    [CUSTOMER_NR],
  ).catch(() => {});
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  wcId = 0;
  await cleanup();
  wcId = await ensureWebsiteCustomer();
});

afterAll(async () => {
  await cleanup();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("approveAndSendEmail — payment reminder send failure", () => {

  /**
   * Test 1 — queue row stays 'pending':
   *   When sendEmail() throws, the queue row must NOT be flipped to 'sent'
   *   because the status update only runs after a successful send.
   */
  it("queue row stays 'pending' when sendEmail throws", async () => {
    const invoiceId  = await insertOverdueInvoice();
    const queueRowId = await insertPendingQueueRow(invoiceId);

    // Force sendEmail to throw
    vi.mocked(emailModule.sendEmail).mockRejectedValueOnce(
      new Error("SMTP connection refused"),
    );

    // approveAndSendEmail must re-throw
    await expect(approveAndSendEmail(queueRowId)).rejects.toThrow("SMTP connection refused");

    // Queue row must still be 'pending'
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM sally_email_queue WHERE id = $1",
      [queueRowId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });

  it("refreshes a legacy invoice draft with the current German footer before sending", async () => {
    const invoiceId = await insertOverdueInvoice();
    const queueRowId = await insertPendingQueueRow(invoiceId); // deliberately has no detected_language
    vi.mocked(emailModule.sendEmail).mockResolvedValueOnce({ messageId: "footer-refresh-test" });

    // Change a CMS-managed footer field after the draft was created. Approval
    // must use that current value, not the body stored in the legacy row.
    const { rows: cmsRows } = await pool.query<{ key: string; de: string }>(
      `SELECT key, de FROM page_content
        WHERE site = 'iroc' AND key = 'iroc.impressum.body_contact_info'`,
    );
    expect(cmsRows).toHaveLength(1);
    const oldContactInfo = cmsRows[0].de;
    const currentContactInfo = "Telefon: +49 89 4625993 70\nE-Mail: footer-refresh@i-roc.de\nWeb: https://i-roc.de";
    try {
      await pool.query(
        `UPDATE page_content SET de = $2
          WHERE site = 'iroc' AND key = $1`,
        ["iroc.impressum.body_contact_info", currentContactInfo],
      );
      await approveAndSendEmail(queueRowId);

      // The old queue row has no language metadata. Approval must use the
      // invoice customer's country (DE) rather than defaulting to English.
      const signature = await buildImpressumSignature("de");
      expect(signature).toContain("footer-refresh@i-roc.de");
      expect(emailModule.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: TEST_EMAIL,
        mailboxPurpose: "sally_ai",
        text: expect.stringContaining(signature),
      }));
      const { rows } = await pool.query<{ body: string; detected_language: string }>(
        "SELECT body, detected_language FROM sally_email_queue WHERE id = $1",
        [queueRowId],
      );
      expect(rows[0].body).toContain(signature);
      expect(rows[0].detected_language).toBe("de");
    } finally {
      await pool.query(
        `UPDATE page_content SET de = $2
          WHERE site = 'iroc' AND key = $1`,
        ["iroc.impressum.body_contact_info", oldContactInfo],
      );
    }
  });

  /**
   * Test 2 — failure notification is created:
   *   When sendEmail() throws for a payment_reminder queue item, a
   *   `payment_reminder_send_failed` notification must appear in
   *   `iroc_notifications` so the admin is alerted in the UI.
   */
  it("inserts a payment_reminder_send_failed notification when sendEmail throws", async () => {
    const invoiceId  = await insertOverdueInvoice();
    const queueRowId = await insertPendingQueueRow(invoiceId);

    vi.mocked(emailModule.sendEmail).mockRejectedValueOnce(
      new Error("SMTP timeout"),
    );

    await expect(approveAndSendEmail(queueRowId)).rejects.toThrow();

    // A notification referencing this specific queue item id must exist
    const { rows } = await pool.query<{ id: number; message: unknown }>(
      `SELECT id, message FROM iroc_notifications
       WHERE type = 'payment_reminder_send_failed'
         AND message::text LIKE $1
       ORDER BY id DESC
       LIMIT 1`,
      [`%${queueRowId}%`],
    );
    expect(rows).toHaveLength(1);

    // Notification message must reference the queue item id and explain the failure
    const raw = rows[0].message;
    const msg: { de: string; en: string } =
      typeof raw === "string" ? JSON.parse(raw) : (raw as { de: string; en: string });
    expect(msg.en).toContain(String(queueRowId));
    expect(msg.en).toMatch(/payment reminder/i);
    expect(msg.en).toMatch(/pending/i);
    expect(msg.de).toContain(String(queueRowId));
  });

  /**
   * Test 3 — non-reminder trigger types do NOT produce a notification:
   *   The notification is scoped to `payment_reminder` queue rows only.
   *   Other trigger types (e.g. `4_week_followup`) must not insert a
   *   `payment_reminder_send_failed` row.
   */
  it("does not insert a payment_reminder_send_failed notification for non-reminder trigger types", async () => {
    // Insert a pending 4_week_followup row (no invoice link required)
    const { rows: inserted } = await pool.query<{ id: number }>(
      `INSERT INTO sally_email_queue
         (recipient_email, subject, body, trigger_type, status)
       VALUES ($1, 'Followup', 'body', '4_week_followup', 'pending')
       RETURNING id`,
      [TEST_EMAIL],
    );
    const queueRowId = inserted[0].id;

    const { rows: before } = await pool.query<{ id: number }>(
      "SELECT id FROM iroc_notifications WHERE type = 'payment_reminder_send_failed'",
    );

    vi.mocked(emailModule.sendEmail).mockRejectedValueOnce(
      new Error("SMTP refused"),
    );

    await expect(approveAndSendEmail(queueRowId)).rejects.toThrow();

    const { rows: after } = await pool.query<{ id: number }>(
      "SELECT id FROM iroc_notifications WHERE type = 'payment_reminder_send_failed'",
    );

    // No new notification for non-reminder trigger types
    expect(after.length).toBe(before.length);

    // Clean up the non-invoice queue row
    await pool.query("DELETE FROM sally_email_queue WHERE id = $1", [queueRowId]);
  });

});
