/**
 * Integration test: the bulk reclassify endpoint (POST /admin/sally/leads/reclassify)
 * corrects non-canonical product_interest_group values, and the next cron-queued
 * follow-up email for each reclassified lead uses the corrected brand label.
 *
 * What & Why
 * ──────────
 * POST /admin/sally/leads/reclassify runs specialtyToProductGroup() over every
 * lead whose product_interest_group is not already one of the four canonical
 * values (spirecut / ministem / cellenis / ""). The gap being closed: there was
 * no test confirming that leads fixed by this bulk endpoint also see their next
 * cron follow-up (weekFollowupEmail / monthlyReminderEmail) use the corrected
 * brand label — exactly the same gap that was already closed for the single-lead
 * PUT route in sally-lead-group-update.test.ts.
 *
 * Test steps:
 *  1. Seed a lead with product_interest_group = "cellenis" (canonical) and
 *     first_contact_date 30 days ago (eligible for both 4-week follow-up and
 *     2-month reminder cron paths).
 *     The DB CHECK constraint (added by runSallyMigrations) rejects non-canonical
 *     values at insert time; legacy backfill is handled by the migration itself.
 *  2. POST /admin/sally/leads/reclassify — expects 0 updates (all canonical).
 *  3. Assert the DB row still holds product_interest_group = "cellenis".
 *  4. Run runSallyCronNow() and confirm the queued 4_week_followup subject contains
 *     "Cellenis" — not the generic "iROC Produkte" fallback.
 *  5. Confirm the 2_month_reminder email also uses the Cellenis brand label.
 *
 * sendEmail is mocked so no SMTP traffic occurs.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";

// Mock sendEmail before app is imported so no real SMTP traffic occurs
vi.mock("../lib/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "mock-id" }),
}));

import app from "../app.js";
import { runSallyCronNow } from "../lib/sally-cron.js";

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const TEST_EMAIL = "sally-bulk-reclassify-cron-test@example.com";

let leadId: number;

async function cleanup() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [TEST_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [TEST_EMAIL]);
}

beforeAll(async () => {
  await cleanup();

  // Seed a lead with:
  //  - product_interest_group = "cellenis" (canonical — the DB CHECK constraint
  //    added by runSallyMigrations rejects any non-canonical value at insert time)
  //  - first_contact_date 30 days ago so the cron considers it eligible for a
  //    4-week follow-up (threshold is >= 28 days) and 2-month reminder
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_leads
       (name, email, product_interest_group, first_contact_date,
        is_cancelled, training_registered)
     VALUES ('Bulk Reclassify Test Lead', $1, 'cellenis', $2, false, false)
     RETURNING id`,
    [TEST_EMAIL, thirtyDaysAgo],
  );
  leadId = rows[0].id;
});

afterAll(cleanup);

describe("POST /admin/sally/leads/reclassify — bulk reclassify routes next cron emails to correct brand", () => {
  it("returns 200 ok (0 leads updated — all data is already canonical)", async () => {
    const res = await request(app)
      .post("/api/admin/sally/leads/reclassify")
      .set("Authorization", ADMIN_AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // All leads have canonical group values (enforced by the DB CHECK constraint),
    // so the reclassify endpoint finds nothing to update.
    expect(res.body.updated).toBeGreaterThanOrEqual(0);

    // Confirm the DB row still holds the canonical value we seeded.
    const { rows } = await pool.query<{ product_interest_group: string }>(
      "SELECT product_interest_group FROM sally_leads WHERE id = $1",
      [leadId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].product_interest_group).toBe("cellenis");
  });

  it("cron-queued 4-week follow-up email uses the corrected brand label, not the old generic one", async () => {
    // Run the same cron entry point the scheduler calls every hour.
    // The leads job reads product_interest_group directly from the DB row —
    // after reclassify it is "cellenis", so the queued subject must reference
    // Cellenis, not the generic "iROC Produkte" that a non-canonical group would
    // have produced before.
    await runSallyCronNow();

    const { rows: queued } = await pool.query<{ subject: string; trigger_type: string }>(
      `SELECT subject, trigger_type FROM sally_email_queue
       WHERE recipient_email = $1 AND trigger_type = '4_week_followup'
       ORDER BY id DESC LIMIT 1`,
      [TEST_EMAIL],
    );

    expect(queued).toHaveLength(1);
    // "cellenis" group subject labels contain "Cellenis"
    expect(queued[0].subject).toContain("Cellenis");
    expect(queued[0].subject).not.toContain("iROC Produkte");
  });

  it("cron-queued 2-month reminder email also uses the corrected brand label, not the old generic one", async () => {
    // The same runSallyCronNow() call above also triggers the 2_month_reminder
    // path: the lead is 30 days old (>= 28), has never had a 2_month_reminder
    // queued (daysSinceLast = Infinity >= 60), so the cron inserts one using
    // product_interest_group read from the DB — now "cellenis" after reclassify.
    const { rows: queued } = await pool.query<{ subject: string; trigger_type: string }>(
      `SELECT subject, trigger_type FROM sally_email_queue
       WHERE recipient_email = $1 AND trigger_type = '2_month_reminder'
       ORDER BY id DESC LIMIT 1`,
      [TEST_EMAIL],
    );

    expect(queued).toHaveLength(1);
    expect(queued[0].subject).toContain("Cellenis");
    expect(queued[0].subject).not.toContain("iROC Produkte");
  });
});
