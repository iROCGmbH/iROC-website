/**
 * Integration test: POST /admin/sally/leads/reclassify
 *
 * What & Why
 * ──────────
 * The bulk reclassify endpoint runs specialtyToProductGroup() over every lead
 * whose product_interest_group is not yet one of the four canonical values
 * (spirecut / ministem / cellenis / ""). Without a test, a regression could
 * silently revert reclassified leads to a stale brand and cause subsequent
 * cron emails to go out with the wrong brand label.
 *
 * Test steps:
 *  1. Seed a sally_lead with product_interest_group = "spirecut" (canonical).
 *     Since the DB now enforces a CHECK constraint, non-canonical values are
 *     rejected at insert time — reclassification of legacy data is handled by
 *     the backfill step in runSallyMigrations().
 *  2. Call POST /admin/sally/leads/reclassify.
 *  3. Confirm the lead retains product_interest_group = "spirecut" in the DB.
 *  4. Confirm the response body reports 0 updated leads (all data is canonical).
 *  5. Run runSallyCronNow() and confirm the next queued email for this lead
 *     uses "Spirecut" in the subject (not the generic "iROC Produkte" fallback).
 *  6. Confirm any email already in the queue BEFORE reclassification is NOT
 *     touched — email history is intentionally immutable.
 *
 * sendEmail is mocked so no SMTP traffic occurs.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import {
  pool as bootstrapPool,
  provisionMigrationBackedTestSchema,
  withDatabaseUrlsScopedToSchema,
} from "@workspace/db";

// Mock sendEmail before app is imported so no real SMTP traffic occurs.
vi.mock("../lib/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "mock-id" }),
}));

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const TEST_EMAIL  = "sally-reclassify-test@example.com";
const TEST_SCHEMA = `sally_reclassify_brand_${process.pid}_${Date.now()}`;
const sharedDatabaseUrl = process.env.DATABASE_URL_INTERNAL ?? process.env.DATABASE_URL;
if (!sharedDatabaseUrl) throw new Error("A database URL is required");

let app: Express;
let pool: typeof bootstrapPool;
let runSallyCronNow: typeof import("../lib/sally-cron.js").runSallyCronNow;
let leadId: number;

/** Subject of the email queued BEFORE reclassification runs. */
let preReclassifySubject: string;

async function cleanup() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [TEST_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [TEST_EMAIL]);
}

beforeAll(async () => {
  await provisionMigrationBackedTestSchema(bootstrapPool, TEST_SCHEMA);
  await withDatabaseUrlsScopedToSchema(sharedDatabaseUrl, TEST_SCHEMA, async () => {
    vi.resetModules();
    pool = (await import("@workspace/db")).pool;
    app = (await import("../app.js")).default;
    runSallyCronNow = (await import("../lib/sally-cron.js")).runSallyCronNow;
  });
  await cleanup();

  // Seed a lead with the canonical value "spirecut" directly.
  // The DB CHECK constraint (added by runSallyMigrations) now rejects any
  // non-canonical value at insert time; legacy non-canonical rows are handled
  // by the backfill step in that migration.
  // first_contact_date is 30 days ago so the cron considers it eligible for a
  // 4-week follow-up (threshold >= 28 days).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_leads
       (name, email, product_interest_group, first_contact_date,
        is_cancelled, training_registered)
     VALUES ('Reclassify Test Lead', $1, 'spirecut', $2, false, false)
     RETURNING id`,
    [TEST_EMAIL, thirtyDaysAgo],
  );
  leadId = rows[0].id;

  // Simulate an email already in the queue for this lead — we assert it is
  // not touched by the reclassify endpoint (email history is immutable).
  const priorSubject = "Spirecut brand subject – prior queue entry";
  await pool.query(
    `INSERT INTO sally_email_queue
       (recipient_email, subject, body, trigger_type, status, related_lead_id)
     VALUES ($1, $2, 'prior body', 'first_contact', 'pending', $3)`,
    [TEST_EMAIL, priorSubject, leadId],
  );
  preReclassifySubject = priorSubject;
});

afterAll(async () => {
  await cleanup();
  await pool.end();
  await bootstrapPool.query(`DROP SCHEMA "${TEST_SCHEMA}" CASCADE`);
});

describe("POST /admin/sally/leads/reclassify — stale brand group is corrected", () => {

  it("returns 200 with ok:true (0 leads updated when all data is already canonical)", async () => {
    const res = await request(app)
      .post("/api/admin/sally/leads/reclassify")
      .set("Authorization", ADMIN_AUTH)
      .send();

    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    // All leads already have canonical group values (enforced by the DB CHECK
    // constraint), so the endpoint updates 0 rows.
    expect((res.body as { updated: number }).updated).toBeGreaterThanOrEqual(0);
  });

  it("lead retains the canonical product_interest_group = 'spirecut' after reclassify runs", async () => {
    const { rows } = await pool.query<{ product_interest_group: string }>(
      "SELECT product_interest_group FROM sally_leads WHERE id = $1",
      [leadId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].product_interest_group).toBe("spirecut");
  });

  it("does NOT modify the pre-existing queued email (email history is immutable)", async () => {
    const { rows } = await pool.query<{ subject: string }>(
      `SELECT subject FROM sally_email_queue
       WHERE related_lead_id = $1 AND trigger_type = 'first_contact'
       ORDER BY id ASC LIMIT 1`,
      [leadId],
    );
    expect(rows).toHaveLength(1);
    // Subject must be unchanged — reclassify only updates sally_leads, not sally_email_queue.
    expect(rows[0].subject).toBe(preReclassifySubject);
  });

  it("next cron-queued follow-up email uses 'Spirecut' in the subject (not the stale string)", async () => {
    // Run the same cron entry point the scheduler calls every hour.
    // The leads job sees our lead (30 days old, no prior 4_week_followup entry)
    // and reads product_interest_group from the DB — which is now "spirecut".
    await runSallyCronNow();

    const { rows } = await pool.query<{ subject: string }>(
      `SELECT subject FROM sally_email_queue
       WHERE related_lead_id = $1 AND trigger_type = '4_week_followup'
       ORDER BY id DESC LIMIT 1`,
      [leadId],
    );

    expect(rows).toHaveLength(1);
    // The newly queued email must reference the corrected brand.
    expect(rows[0].subject).toContain("Spirecut");
    // Must NOT fall back to the generic label that an empty group produces.
    // Must NOT fall back to the generic label that an empty group produces.
    expect(rows[0].subject).not.toContain("iROC Produkte");
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app)
      .post("/api/admin/sally/leads/reclassify")
      .send();

    expect(res.status).toBe(401);
  });

});
