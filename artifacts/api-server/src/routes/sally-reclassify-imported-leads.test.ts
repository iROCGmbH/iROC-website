/**
 * Integration test: POST /admin/sally/leads/reclassify corrects a lead that was
 * imported via POST /admin/sally/import/leads from an iroc_leads row whose
 * specialty was unrecognised at import time, and later carries a stale
 * non-canonical group value when specialtyToProductGroup logic is updated.
 *
 * What & Why
 * ──────────
 * The import route runs specialtyToProductGroup(row.specialty) at insert time.
 * If the classification logic is later extended (new keywords added), old leads
 * already in sally_leads still carry whatever group was assigned at import.
 * The bulk reclassify endpoint re-runs specialtyToProductGroup() over every
 * non-canonical row to fix these stale values.
 *
 * This test exercises the specific path of a lead that:
 *  1. Originated in iroc_leads with an unrecognised specialty.
 *  2. Was imported via the import endpoint (group assigned as "" at import time).
 *  3. Ended up with a stale non-canonical group value — simulating an earlier
 *     import that ran before a keyword was added that now maps it differently
 *     (achieved by directly updating the DB row after dropping the CHECK
 *     constraint, mirroring the approach in sally-reclassify-freetext-put.test.ts).
 *  4. Is fixed by POST /admin/sally/leads/reclassify.
 *  5. Subsequently has a cron-queued 4-week follow-up email whose subject uses
 *     the generic "iROC Produkte" / "iROC products" label (not the stale value).
 *
 * Test steps:
 *  1. Seed an iroc_leads row with specialty = "Aesthetic Dermatology".
 *  2. POST /admin/sally/import/leads → lead inserted into sally_leads with
 *     product_interest_group = "" (specialtyToProductGroup returns "").
 *  3. Drop the DB CHECK constraint, then directly UPDATE the sally_leads row to
 *     a stale non-canonical value ("aesthetic_dermatology") — simulating what an
 *     earlier import would have stored before the current mapping was in place.
 *  4. POST /admin/sally/leads/reclassify → expect updated >= 1 and DB row now
 *     holds product_interest_group = "" (specialtyToProductGroup maps
 *     "aesthetic_dermatology" back to "").
 *  5. Run runSallyCronNow() and confirm the queued 4_week_followup subject uses
 *     the generic label, not the stale non-canonical string.
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
const TEST_EMAIL = "sally-reclassify-imported-leads-test@example.com";

// A non-canonical stale value — simulates a group stored by an earlier import
// before specialtyToProductGroup keywords were updated.
const STALE_GROUP = "aesthetic_dermatology";

let irocLeadId: number;
let sallyLeadId: number;

async function cleanup() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [TEST_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [TEST_EMAIL]);
  await pool.query("DELETE FROM iroc_leads WHERE email = $1", [TEST_EMAIL]);
}

async function dropGroupConstraint() {
  await pool.query(`
    ALTER TABLE sally_leads
      DROP CONSTRAINT IF EXISTS sally_leads_product_interest_group_check
  `);
}

async function restoreGroupConstraint() {
  // Canonicalise any remaining non-canonical rows in the whole table before
  // re-adding the constraint so the ALTER TABLE succeeds even when another
  // concurrent test left a non-canonical row behind.
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
  await cleanup();

  // Step 1: Seed an iroc_leads row with an unrecognised specialty.
  // first_contact_date 30 days ago → cron-eligible for 4_week_followup (>= 28 days).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { rows: irocRows } = await pool.query<{ id: number }>(
    `INSERT INTO iroc_leads
       (first_name, last_name, email, specialty, status, first_contact_date, created_at)
     VALUES ('Reclassify', 'ImportTest', $1, 'Aesthetic Dermatology', 'new', $2, NOW())
     RETURNING id`,
    [TEST_EMAIL, thirtyDaysAgo],
  );
  irocLeadId = irocRows[0].id;

  // Step 2: Import via the actual HTTP endpoint — specialty "Aesthetic Dermatology"
  // is unrecognised by specialtyToProductGroup so the inserted group is "".
  const importRes = await request(app)
    .post("/api/admin/sally/import/leads")
    .set("Authorization", ADMIN_AUTH)
    .send({ ids: [irocLeadId] });

  if (importRes.status !== 200 || importRes.body.imported !== 1) {
    throw new Error(
      `beforeAll: import returned ${importRes.status}: ${JSON.stringify(importRes.body)}`,
    );
  }

  // Retrieve the sally_leads id so we can manipulate the row directly.
  const { rows: slRows } = await pool.query<{ id: number }>(
    "SELECT id FROM sally_leads WHERE LOWER(email) = LOWER($1) LIMIT 1",
    [TEST_EMAIL],
  );
  if (slRows.length === 0) {
    throw new Error("beforeAll: imported sally_leads row not found");
  }
  sallyLeadId = slRows[0].id;

  // Step 3: Simulate a stale non-canonical group written by an older import run.
  // Drop the CHECK constraint first so the direct UPDATE is allowed.
  await dropGroupConstraint();
  await pool.query(
    "UPDATE sally_leads SET product_interest_group = $1, updated_at = NOW() WHERE id = $2",
    [STALE_GROUP, sallyLeadId],
  );
});

afterAll(async () => {
  await cleanup();
  // Restore the CHECK constraint. restoreGroupConstraint() canonicalises any
  // remaining non-canonical rows before executing the ALTER TABLE.
  await restoreGroupConstraint();
});

describe(
  "POST /admin/sally/leads/reclassify — fixes imported iroc_lead with stale non-canonical specialty group",
  () => {
    it("import endpoint inserted the lead with the unrecognised specialty resolved to empty string", async () => {
      // The DB row was set to STALE_GROUP in beforeAll; verify the stale value
      // is actually there before reclassify runs (confirms the setup is correct).
      const { rows } = await pool.query<{ product_interest_group: string }>(
        "SELECT product_interest_group FROM sally_leads WHERE id = $1",
        [sallyLeadId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].product_interest_group).toBe(STALE_GROUP);
    });

    it("reclassify returns ok:true and reports at least one updated lead", async () => {
      const res = await request(app)
        .post("/api/admin/sally/leads/reclassify")
        .set("Authorization", ADMIN_AUTH)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // Our seeded lead has the non-canonical stale group — at least one must be updated.
      expect(res.body.updated).toBeGreaterThanOrEqual(1);
    });

    it("DB row now holds the empty-string canonical group after reclassify", async () => {
      // specialtyToProductGroup("aesthetic_dermatology") → "" because "aesthetic"
      // and "dermatology" match no keyword in SPIRECUT_, MINISTEM_, or CELLENIS_KEYWORDS.
      const { rows } = await pool.query<{ product_interest_group: string }>(
        "SELECT product_interest_group FROM sally_leads WHERE id = $1",
        [sallyLeadId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].product_interest_group).toBe("");
    });

    it("cron-queued 4-week follow-up subject uses the generic label, not the stale specialty string", async () => {
      // runSallyCronNow reads product_interest_group from the DB row; after reclassify
      // it is "" so the queued subject must use the generic iROC label.
      await runSallyCronNow();

      const { rows: queued } = await pool.query<{ subject: string; trigger_type: string }>(
        `SELECT subject, trigger_type FROM sally_email_queue
         WHERE recipient_email = $1 AND trigger_type = '4_week_followup'
         ORDER BY id DESC LIMIT 1`,
        [TEST_EMAIL],
      );

      expect(queued).toHaveLength(1);
      // The stale non-canonical group string must not appear in the subject.
      expect(queued[0].subject).not.toContain(STALE_GROUP);
      expect(queued[0].subject).not.toContain("aesthetic_dermatology");
      // The "" group maps to "iROC Produkte" (DE) or "iROC products" (EN).
      expect(
        queued[0].subject.includes("iROC Produkte") ||
        queued[0].subject.includes("iROC products"),
      ).toBe(true);
    });

    it("cron-queued 4-week follow-up subject does not reference any brand-specific label", async () => {
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
    });
  },
);
