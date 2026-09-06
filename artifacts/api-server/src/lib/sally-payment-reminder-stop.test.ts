/**
 * Integration tests: payment reminders stop the moment an invoice is marked paid (#525)
 *
 * What & Why
 * ──────────
 * The payment reminder cron (`runPaymentRemindersJob`) skips invoices whose
 * status is no longer 'sent'.  `queuePaymentReminderEmail` also guards against
 * queueing for non-sent invoices at the point of insertion.  Neither behaviour
 * has been verified end-to-end.  These tests confirm:
 *
 *   1. Cron sweep skips an invoice the moment its status changes to 'paid':
 *      an invoice that was already overdue ('sent' + sent_at ≥ 10 days ago)
 *      does NOT get a new reminder row after being flipped to 'paid', even
 *      when the sweep runs immediately afterwards.
 *
 *   2. Cancelling a pending reminder queue row prevents it from being sent
 *      when the invoice is later marked as paid: the cancelled row stays
 *      'cancelled' and no new 'pending' row appears after the cron runs.
 *
 * Both tests run against the real dev database (same approach as
 * sally-invoice-autodraft.test.ts).  All rows are cleaned up in beforeAll /
 * afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "@workspace/db";
import { runPaymentRemindersJob } from "./sally-cron.js";
import { queuePaymentReminderEmail } from "./sally-invoice.js";
import { buildImpressumSignature } from "./impressum-signature.js";

// ── Shared test state ──────────────────────────────────────────────────────────

const TEST_EMAIL = "sally-reminder-stop-test@example.com";
let wcId: number;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Insert a minimal website customer and return its id. */
async function ensureWebsiteCustomer(): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO website_customers
       (customer_nr, first_name, last_name, email, country, instrument)
     VALUES ('TEST-RMS-1', 'Reminder', 'Stop', $1, 'Deutschland', 'iroc')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [TEST_EMAIL],
  );
  if (rows.length) return rows[0].id;
  // Already exists — fetch it
  const { rows: existing } = await pool.query<{ id: number }>(
    "SELECT id FROM website_customers WHERE email = $1",
    [TEST_EMAIL],
  );
  return existing[0].id;
}

/**
 * Insert a minimal invoice with the given status and a sent_at that is
 * `daysOverdue` days in the past.  Returns the new invoice id.
 */
async function insertInvoice(opts: {
  status: string;
  daysOverdue: number;
}): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO iroc_invoices
       (invoice_number, website_customer_id, invoice_type, issue_date,
        subtotal, vat_rate, vat_amount, total, delivery_costs,
        status, language, sent_at)
     VALUES (
       'TEST-RMS-' || to_char(NOW(), 'YYYYMMDDHH24MISSUS'),
       $1, 'domestic',
       CURRENT_DATE - $2::int,
       '100.00', '19.00', '19.00', '119.00', '0.00',
       $3, 'de',
       NOW() - ($2::text || ' days')::interval
     )
     RETURNING id`,
    [wcId, opts.daysOverdue, opts.status],
  );
  return rows[0].id;
}

/** Delete all test data created for this test suite. */
async function cleanup() {
  await pool.query(
    `DELETE FROM sally_email_queue
     WHERE related_invoice_id IN (
       SELECT id FROM iroc_invoices WHERE website_customer_id = $1
     )`,
    [wcId],
  );
  await pool.query(
    "DELETE FROM iroc_invoices WHERE website_customer_id = $1",
    [wcId],
  );
  await pool.query(
    "DELETE FROM website_customers WHERE email = $1",
    [TEST_EMAIL],
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await cleanup(); // ensure a clean slate even if a previous run crashed
  wcId = await ensureWebsiteCustomer();
});

afterAll(async () => {
  await cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("payment reminders stop when invoice is marked paid", () => {

  /**
   * Test 1 — cron sweep:
   *   1. Create invoice with status='sent' and sent_at 11 days ago (overdue).
   *   2. Run the cron sweep → one reminder is queued.
   *   3. Mark the queue row as 'sent' (simulate admin approving + sending it).
   *   4. Change the invoice status to 'paid'.
   *   5. Run the cron sweep again → NO new reminder row is created.
   */
  it("cron sweep queues no new reminder after invoice is marked paid", async () => {
    const invoiceId = await insertInvoice({ status: "sent", daysOverdue: 11 });

    // Step 2: first sweep → reminder queued
    await runPaymentRemindersJob();

    const { rows: after1st } = await pool.query<{ id: number; status: string; body: string }>(
      `SELECT id, status, body FROM sally_email_queue
       WHERE related_invoice_id = $1 AND trigger_type = 'payment_reminder'
       ORDER BY id`,
      [invoiceId],
    );
    expect(after1st).toHaveLength(1);
    expect(after1st[0].status).toBe("pending");
    expect(after1st[0].body).toContain(await buildImpressumSignature("de"));
    const firstRowId = after1st[0].id;

    // Step 3: simulate admin approving the reminder (mark it sent + age it)
    await pool.query(
      `UPDATE sally_email_queue
       SET status = 'sent', updated_at = NOW() - INTERVAL '11 days', created_at = NOW() - INTERVAL '11 days'
       WHERE id = $1`,
      [firstRowId],
    );

    // Step 4: mark invoice as paid
    await pool.query(
      "UPDATE iroc_invoices SET status = 'paid', updated_at = NOW() WHERE id = $1",
      [invoiceId],
    );

    // Step 5: second sweep — must NOT add a new row
    await runPaymentRemindersJob();

    const { rows: afterPaid } = await pool.query<{ id: number }>(
      `SELECT id FROM sally_email_queue
       WHERE related_invoice_id = $1 AND trigger_type = 'payment_reminder'`,
      [invoiceId],
    );
    // Still exactly one row — the original sent reminder; no second row added
    expect(afterPaid).toHaveLength(1);
    expect(afterPaid[0].id).toBe(firstRowId);
  });

  /**
   * Test 2 — direct queuePaymentReminderEmail guard:
   *   Confirms the function itself refuses to queue a reminder when the
   *   invoice status is already 'paid' (guards against calling the function
   *   directly after a race with the status update).
   */
  it("queuePaymentReminderEmail returns false and inserts nothing when invoice is already paid", async () => {
    const invoiceId = await insertInvoice({ status: "paid", daysOverdue: 15 });

    const inserted = await queuePaymentReminderEmail(invoiceId, 1);

    expect(inserted).toBe(false);

    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM sally_email_queue
       WHERE related_invoice_id = $1 AND trigger_type = 'payment_reminder'`,
      [invoiceId],
    );
    expect(rows).toHaveLength(0);
  });

  /**
   * Test 3 — cancelling a pending reminder queue row:
   *   1. Create invoice with status='sent' (overdue).
   *   2. Manually insert a 'pending' payment_reminder queue row.
   *   3. Cancel that row (status = 'cancelled').
   *   4. Mark invoice as 'paid'.
   *   5. Run cron sweep → the cancelled row stays 'cancelled'; no new row.
   *
   * This verifies that a cancelled row does not block a cron re-run (since
   * the unique index is partial on status='pending') but also that no new
   * reminder is created because the invoice is now paid.
   */
  it("a cancelled pending reminder stays cancelled and no new reminder appears after invoice is paid", async () => {
    const invoiceId = await insertInvoice({ status: "sent", daysOverdue: 12 });

    // Step 2: manually insert a 'pending' reminder row
    const { rows: inserted } = await pool.query<{ id: number }>(
      `INSERT INTO sally_email_queue
         (recipient_email, subject, body, trigger_type, status, related_invoice_id)
       VALUES ($1, 'Zahlungserinnerung', 'body', 'payment_reminder', 'pending', $2)
       RETURNING id`,
      [TEST_EMAIL, invoiceId],
    );
    const pendingRowId = inserted[0].id;

    // Step 3: admin cancels the reminder before sending
    await pool.query(
      "UPDATE sally_email_queue SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
      [pendingRowId],
    );

    // Step 4: mark invoice as paid
    await pool.query(
      "UPDATE iroc_invoices SET status = 'paid', updated_at = NOW() WHERE id = $1",
      [invoiceId],
    );

    // Step 5: cron sweep — must produce zero new rows
    await runPaymentRemindersJob();

    const { rows } = await pool.query<{ id: number; status: string }>(
      `SELECT id, status FROM sally_email_queue
       WHERE related_invoice_id = $1 AND trigger_type = 'payment_reminder'
       ORDER BY id`,
      [invoiceId],
    );

    // Only the original cancelled row; no new pending row
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(pendingRowId);
    expect(rows[0].status).toBe("cancelled");
  });

});
