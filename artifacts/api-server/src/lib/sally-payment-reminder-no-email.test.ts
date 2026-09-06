/**
 * Integration tests: payment reminder sweep skips invoices whose customer
 * has no billing email on file (#527)
 *
 * What & Why
 * ──────────
 * `queuePaymentReminderEmail` guards against sending when the linked
 * website_customer has no email.  Without a test, a regression could
 * silently drop reminders — or worse, throw an error — with no admin
 * notification.  These tests confirm:
 *
 *   1. The cron sweep (`runPaymentRemindersJob`) produces no queue row
 *      and no error for a 'sent' invoice linked to a customer with no email.
 *
 *   2. `queuePaymentReminderEmail` returns false (not an error) when the
 *      customer has no email.
 *
 *   3. A `payment_reminder_skipped` notification row is created in
 *      `iroc_notifications` so the admin knows to add the missing address.
 *
 * All tests run against the real dev database.  All rows are cleaned up in
 * beforeAll / afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "@workspace/db";
import { runPaymentRemindersJob } from "./sally-cron.js";
import { queuePaymentReminderEmail } from "./sally-invoice.js";

// ── Shared test state ──────────────────────────────────────────────────────────

let wcId: number;   // website_customer with no email
const CUSTOMER_NR = "TEST-NOEMAIL-527";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Insert a website customer with a blank / null email. */
async function ensureNoEmailCustomer(): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO website_customers
       (customer_nr, first_name, last_name, email, country, instrument)
     VALUES ($1, 'No', 'Email', '', 'Deutschland', 'iroc')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [CUSTOMER_NR],
  );
  if (rows.length) return rows[0].id;
  const { rows: existing } = await pool.query<{ id: number }>(
    "SELECT id FROM website_customers WHERE customer_nr = $1",
    [CUSTOMER_NR],
  );
  return existing[0].id;
}

/**
 * Insert a minimal overdue invoice linked to the no-email customer.
 * `sent_at` is `daysOverdue` days in the past so the sweep considers it eligible.
 */
async function insertOverdueInvoice(daysOverdue = 11): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO iroc_invoices
       (invoice_number, website_customer_id, invoice_type, issue_date,
        subtotal, vat_rate, vat_amount, total, delivery_costs,
        status, language, sent_at)
     VALUES (
       'TEST-NE-' || to_char(NOW(), 'YYYYMMDDHH24MISSUS'),
       $1, 'domestic',
       CURRENT_DATE - $2::int,
       '100.00', '19.00', '19.00', '119.00', '0.00',
       'sent', 'de',
       NOW() - ($2::text || ' days')::interval
     )
     RETURNING id`,
    [wcId, daysOverdue],
  );
  return rows[0].id;
}

/** Remove all rows created by this test suite. */
async function cleanup() {
  // Remove notifications created for invoices owned by the test customer
  await pool.query(
    `DELETE FROM iroc_notifications
     WHERE type = 'payment_reminder_skipped'
       AND message::text LIKE '%TEST-NE-%'`,
  );
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
    "DELETE FROM website_customers WHERE customer_nr = $1",
    [CUSTOMER_NR],
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // wcId may be 0 during cleanup if customer doesn't exist yet — seed it first
  wcId = 0;
  await cleanup().catch(() => {}); // best-effort pre-clean
  wcId = await ensureNoEmailCustomer();
});

afterAll(async () => {
  await cleanup();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("payment reminder sweep — customer with no billing email", () => {

  /**
   * Test 1 — cron sweep:
   *   An overdue invoice linked to a no-email customer must produce
   *   zero queue rows and zero errors when the sweep runs.
   */
  it("cron sweep inserts no queue row for a no-email customer", async () => {
    const invoiceId = await insertOverdueInvoice(11);

    // Record how many payment_reminder rows exist before the sweep
    const { rows: before } = await pool.query<{ id: number }>(
      `SELECT id FROM sally_email_queue
       WHERE related_invoice_id = $1 AND trigger_type = 'payment_reminder'`,
      [invoiceId],
    );

    // Run the sweep — must not throw
    await expect(runPaymentRemindersJob()).resolves.toBeUndefined();

    // Still no queue row
    const { rows: after } = await pool.query<{ id: number }>(
      `SELECT id FROM sally_email_queue
       WHERE related_invoice_id = $1 AND trigger_type = 'payment_reminder'`,
      [invoiceId],
    );
    expect(after).toHaveLength(before.length); // unchanged — still 0
  });

  /**
   * Test 2 — direct function guard:
   *   `queuePaymentReminderEmail` must return false (not throw) when the
   *   customer attached to the invoice has no email.
   */
  it("queuePaymentReminderEmail returns false when customer has no email", async () => {
    const invoiceId = await insertOverdueInvoice(15);

    const result = await queuePaymentReminderEmail(invoiceId, 1);

    expect(result).toBe(false);

    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM sally_email_queue
       WHERE related_invoice_id = $1 AND trigger_type = 'payment_reminder'`,
      [invoiceId],
    );
    expect(rows).toHaveLength(0);
  });

  /**
   * Test 3 — admin notification:
   *   When the reminder is skipped due to a missing email, a
   *   `payment_reminder_skipped` notification must be inserted into
   *   `iroc_notifications` so the admin is alerted.
   */
  it("inserts a payment_reminder_skipped notification when customer has no email", async () => {
    const invoiceId = await insertOverdueInvoice(12);

    // Fetch the invoice number so we can assert the notification message
    const { rows: invRows } = await pool.query<{ invoice_number: string }>(
      "SELECT invoice_number FROM iroc_invoices WHERE id = $1",
      [invoiceId],
    );
    const invoiceNumber = invRows[0].invoice_number;

    // Record notifications count before
    const { rows: before } = await pool.query<{ id: number }>(
      `SELECT id FROM iroc_notifications
       WHERE type = 'payment_reminder_skipped'
         AND message::text LIKE $1`,
      [`%${invoiceNumber}%`],
    );

    await queuePaymentReminderEmail(invoiceId, 1);

    const { rows: after } = await pool.query<{ id: number; message: unknown }>(
      `SELECT id, message FROM iroc_notifications
       WHERE type = 'payment_reminder_skipped'
         AND message::text LIKE $1
       ORDER BY id DESC
       LIMIT 1`,
      [`%${invoiceNumber}%`],
    );

    // At least one new notification was created
    expect(after.length).toBeGreaterThan(before.length);

    // Message contains expected content in both languages
    // The pool returns JSONB columns as plain objects, but text/json columns
    // may arrive as strings — normalise to an object either way.
    const raw = after[0].message;
    const msg: { de: string; en: string } =
      typeof raw === "string" ? JSON.parse(raw) : (raw as { de: string; en: string });
    expect(msg.de).toContain(invoiceNumber);
    expect(msg.en).toContain(invoiceNumber);
    expect(msg.en).toMatch(/no billing email/i);
  });

});
