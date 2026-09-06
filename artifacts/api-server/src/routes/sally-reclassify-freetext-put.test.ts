/**
 * Integration test: POST /admin/sally/leads/reclassify corrects a lead whose
 * product_interest_group was set to an unrecognised freetext value via the
 * single-lead PUT endpoint.
 *
 * What & Why
 * ──────────
 * An admin can PUT /admin/sally/leads/:id with any arbitrary productInterestGroup
 * string, e.g. "Aesthetic Medicine". If the value is neither canonical
 * (spirecut / ministem / cellenis / "") nor matches any keyword in
 * specialtyToProductGroup, it sits as a non-canonical group indefinitely.
 * The bulk reclassify endpoint runs specialtyToProductGroup() over every lead
 * whose group is not already one of the four canonical values and fixes it.
 *
 * Because the DB CHECK constraint added by runSallyMigrations rejects
 * non-canonical values at write time, this test temporarily drops the
 * constraint before calling the PUT endpoint with the freetext value, then
 * re-adds it after the reclassify run has canonicalised all rows — mirroring
 * the migration's own backfill-then-constrain flow and explicitly exercising
 * the PUT endpoint's request/DB path.
 *
 * Test steps:
 *  1. Seed a lead with product_interest_group = "" (canonical).
 *  2. Drop the DB CHECK constraint so the PUT endpoint can write a non-canonical
 *     value into the DB.
 *  3. PUT /admin/sally/leads/:id { productInterestGroup: "Aesthetic Medicine" }
 *     and assert the response and DB row reflect the freetext value.
 *  4. POST /admin/sally/leads/reclassify → confirm updated >= 1 and the DB
 *     row now holds product_interest_group = "".
 *  5. Run runSallyCronNow() and confirm the queued 4_week_followup subject
 *     does not contain the stale "Aesthetic Medicine" value and instead uses
 *     the generic "iROC Produkte" / "iROC products" label that the "" group
 *     produces.
 *
 * Constraint teardown safety: afterAll canonicalises any remaining
 * non-canonical rows in the whole table before re-adding the constraint, so
 * the teardown succeeds even if another concurrent test left a non-canonical
 * row behind (e.g. from a failed mid-test cleanup).
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

// Mock sendEmail before app is imported so no real SMTP traffic occurs
vi.mock("../lib/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "mock-id" }),
}));

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const TEST_EMAIL = "sally-reclassify-freetext-put-test@example.com";
const FREETEXT_GROUP = "Aesthetic Medicine"; // unrecognised — specialtyToProductGroup maps it to ""
const TEST_SCHEMA = `sally_reclassify_freetext_${process.pid}_${Date.now()}`;
const sharedDatabaseUrl = process.env.DATABASE_URL_INTERNAL ?? process.env.DATABASE_URL;
if (!sharedDatabaseUrl) throw new Error("A database URL is required");

let app: Express;
let pool: typeof bootstrapPool;
let runSallyCronNow: typeof import("../lib/sally-cron.js").runSallyCronNow;
let leadId: number;

async function cleanup() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [TEST_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [TEST_EMAIL]);
}

async function dropGroupConstraint() {
  await pool.query(`
    ALTER TABLE sally_leads
      DROP CONSTRAINT IF EXISTS sally_leads_product_interest_group_check
  `);
}

async function restoreGroupConstraint() {
  // Before restoring, canonicalise any remaining non-canonical rows in the whole
  // table so the ADD CONSTRAINT check succeeds regardless of what other tests
  // may have left behind while the constraint was absent.
  await pool.query(`
    UPDATE sally_leads
       SET product_interest_group = '',
           updated_at = NOW()
     WHERE product_interest_group NOT IN ('spirecut', 'ministem', 'cellenis', '')
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sally_leads_product_interest_group_check'
          AND conrelid = 'sally_leads'::regclass
      ) THEN
        ALTER TABLE sally_leads
          ADD CONSTRAINT sally_leads_product_interest_group_check
          CHECK (product_interest_group IN ('spirecut', 'ministem', 'cellenis', ''));
      END IF;
    END
    $$;
  `);
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

  // Step 1: Seed a lead with a canonical group so the PUT endpoint has a row
  //         to update. first_contact_date 30 days ago → cron-eligible for both
  //         4_week_followup (>= 28 days) and 2_month_reminder paths.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_leads
       (name, email, product_interest_group, first_contact_date,
        is_cancelled, training_registered)
     VALUES ('Freetext PUT Test Lead', $1, '', $2, false, false)
     RETURNING id`,
    [TEST_EMAIL, thirtyDaysAgo],
  );
  leadId = rows[0].id;

  // Step 2: Drop the CHECK constraint so the PUT endpoint can write an
  //         unrecognised freetext value into the DB.
  await dropGroupConstraint();

  // Step 3: Call the actual PUT endpoint with the freetext non-canonical value.
  //         This exercises the full request → handler → UPDATE path and confirms
  //         that the endpoint persists whatever the admin sends without its own
  //         allow-list check — the scenario the reclassify endpoint must fix.
  const putRes = await request(app)
    .put(`/api/admin/sally/leads/${leadId}`)
    .set("Authorization", ADMIN_AUTH)
    .send({ productInterestGroup: FREETEXT_GROUP });

  if (putRes.status !== 200) {
    throw new Error(
      `beforeAll: PUT /api/admin/sally/leads/${leadId} returned ${putRes.status}: ${JSON.stringify(putRes.body)}`,
    );
  }
});

afterAll(async () => {
  await cleanup();
  // Re-add the CHECK constraint. restoreGroupConstraint() canonicalises any
  // residual non-canonical rows (from this or any other test that dropped the
  // constraint) before executing the ALTER TABLE, so the teardown is safe even
  // in parallel / shared-DB environments.
  await restoreGroupConstraint();
  await pool.end();
  await bootstrapPool.query(`DROP SCHEMA "${TEST_SCHEMA}" CASCADE`);
});

describe(
  "POST /admin/sally/leads/reclassify — corrects freetext group written via single-lead PUT",
  () => {
    it("PUT endpoint persisted the non-canonical freetext group in the DB row", async () => {
      // Verify the DB reflects what the PUT wrote — the constraint is currently
      // dropped so the UPDATE could store the arbitrary string.
      const { rows } = await pool.query<{ product_interest_group: string }>(
        "SELECT product_interest_group FROM sally_leads WHERE id = $1",
        [leadId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].product_interest_group).toBe(FREETEXT_GROUP);
    });

    it("reclassify returns ok:true and reports at least one updated lead", async () => {
      const res = await request(app)
        .post("/api/admin/sally/leads/reclassify")
        .set("Authorization", ADMIN_AUTH)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // At least our seeded lead (with the non-canonical freetext) must be updated.
      expect(res.body.updated).toBeGreaterThanOrEqual(1);
    });

    it("DB row now holds the empty-string canonical group after reclassify", async () => {
      // specialtyToProductGroup("Aesthetic Medicine") returns "" — "aesthetic"
      // does not match any keyword in SPIRECUT_, MINISTEM_, or CELLENIS_KEYWORDS.
      const { rows } = await pool.query<{ product_interest_group: string }>(
        "SELECT product_interest_group FROM sally_leads WHERE id = $1",
        [leadId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].product_interest_group).toBe("");
    });

    it(
      "cron-queued 4-week follow-up subject does not contain the stale freetext value",
      async () => {
        // runSallyCronNow reads product_interest_group directly from the DB row.
        // After reclassify the value is "", so the queued subject must use the
        // generic label — not the old arbitrary "Aesthetic Medicine" string.
        await runSallyCronNow();

        const { rows: queued } = await pool.query<{
          subject: string;
          trigger_type: string;
        }>(
          `SELECT subject, trigger_type FROM sally_email_queue
           WHERE recipient_email = $1 AND trigger_type = '4_week_followup'
           ORDER BY id DESC LIMIT 1`,
          [TEST_EMAIL],
        );

        expect(queued).toHaveLength(1);
        expect(queued[0].subject).not.toContain("Aesthetic Medicine");
        // The "" group maps to "iROC Produkte" (DE) or "iROC products" (EN).
        expect(
          queued[0].subject.includes("iROC Produkte") ||
          queued[0].subject.includes("iROC products"),
        ).toBe(true);
      },
    );

    it(
      "cron-queued 4-week follow-up subject does not reference any brand-specific label",
      async () => {
        const { rows: queued } = await pool.query<{ subject: string }>(
          `SELECT subject FROM sally_email_queue
           WHERE recipient_email = $1 AND trigger_type = '4_week_followup'
           ORDER BY id DESC LIMIT 1`,
          [TEST_EMAIL],
        );

        expect(queued).toHaveLength(1);
        // After reclassify the group is "" — no brand-specific label should appear.
        expect(queued[0].subject).not.toContain("Spirecut");
        expect(queued[0].subject).not.toContain("Cellenis");
        expect(queued[0].subject).not.toContain("MiniStem");
      },
    );
  },
);
