/**
 * Integration test: soft-deleted leads are skipped by the reclassify endpoint
 * and never queued by the Sally cron.
 *
 * What & Why
 * ──────────
 * The reclassify endpoint (POST /admin/sally/leads/reclassify) filters on
 * `deleted_at IS NULL`.  Without this guard a soft-deleted lead with a
 * non-canonical product_interest_group (e.g. "hand surgery") would be
 * reclassified and could then be picked up by the cron, violating the
 * soft-delete contract.
 *
 * Test steps:
 *  1. Seed a sally_lead whose deleted_at IS NOT NULL and whose
 *     product_interest_group = 'hand surgery' (a non-canonical, stale value
 *     that the reclassify endpoint would normally rewrite).
 *     The DB check constraint is temporarily dropped so we can seed the
 *     stale value, then restored after.
 *  2. POST /admin/sally/leads/reclassify — must NOT touch the deleted row.
 *  3. Assert the DB row still holds product_interest_group = 'hand surgery'.
 *  4. Run runSallyCronNow() and confirm no email was queued for this lead.
 *
 * sendEmail is mocked so no SMTP traffic occurs.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";

vi.mock("../lib/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "mock-id" }),
}));

import app from "../app.js";
import { runSallyCronNow } from "../lib/sally-cron.js";

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const TEST_EMAIL = "sally-deleted-reclassify-test@example.com";

let leadId: number;

async function dropGroupConstraint() {
  await pool.query(`
    ALTER TABLE sally_leads
      DROP CONSTRAINT IF EXISTS sally_leads_product_interest_group_check
  `);
}

async function restoreGroupConstraint() {
  // Canonicalise any remaining non-canonical rows before re-adding the
  // constraint so the ALTER TABLE succeeds even if another test left stale rows.
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

async function cleanup() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [TEST_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [TEST_EMAIL]);
}

beforeAll(async () => {
  await cleanup();
  // Drop the CHECK constraint so we can seed a stale non-canonical group.
  // We restore it in afterAll after cleanup removes the test row, ensuring the
  // canonicalize-then-constrain step in restoreGroupConstraint won't wipe the
  // value we need to observe during the tests.
  await dropGroupConstraint();

  // Seed a soft-deleted lead with a stale, non-canonical product_interest_group
  // ("hand surgery") and a first_contact_date old enough to trigger cron emails
  // if the lead were active (>= 28 days old).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_leads
       (name, email, product_interest_group, first_contact_date,
        is_cancelled, training_registered, deleted_at)
     VALUES ('Deleted Lead', $1, 'hand surgery', $2, false, false, NOW())
     RETURNING id`,
    [TEST_EMAIL, thirtyDaysAgo],
  );
  leadId = rows[0].id;
});

afterAll(async () => {
  // Remove the test row first, then restore the constraint so the canonicalize
  // step inside restoreGroupConstraint doesn't overwrite our observed value.
  await cleanup();
  await restoreGroupConstraint();
});

describe("POST /admin/sally/leads/reclassify — skips soft-deleted leads", () => {
  it("leaves the deleted lead's product_interest_group unchanged", async () => {
    const res = await request(app)
      .post("/api/admin/sally/leads/reclassify")
      .set("Authorization", ADMIN_AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The deleted lead must not have been touched.
    const { rows } = await pool.query<{ product_interest_group: string }>(
      "SELECT product_interest_group FROM sally_leads WHERE id = $1",
      [leadId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].product_interest_group).toBe("hand surgery");
  });
});

describe("runSallyCronNow — does not queue emails for soft-deleted leads", () => {
  it("queues no follow-up email for the deleted lead", async () => {
    await runSallyCronNow();

    const { rows } = await pool.query<{ id: number }>(
      "SELECT id FROM sally_email_queue WHERE recipient_email = $1",
      [TEST_EMAIL],
    );
    expect(rows).toHaveLength(0);
  });
});
