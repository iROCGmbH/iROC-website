/**
 * Integration test: POST /admin/sally/leads/reclassify skips leads whose
 * product_interest_group is already a canonical value.
 *
 * What & Why
 * ──────────
 * The reclassify endpoint re-runs specialtyToProductGroup() only over rows
 * whose product_interest_group is NOT one of the four canonical values
 * (spirecut / ministem / cellenis / ""). It deliberately skips canonical rows.
 *
 * This covers a specific edge case: a lead whose specialty once matched a
 * keyword (e.g. "spirecut") was stored as "spirecut" at import time. If that
 * keyword is later removed from SPIRECUT_KEYWORDS, the stored group is now
 * "canonical but stale" — the reclassify endpoint would NOT correct it,
 * because the SQL WHERE clause filters to non-canonical rows only.
 *
 * Scope boundary (intentional design):
 * ─────────────────────────────────────
 * The current reclassify endpoint is designed to canonicalise non-canonical
 * freetext values left by legacy imports — not to revisit rows that already
 * hold a canonical group. Canonical-but-stale rows (e.g. group = "spirecut"
 * but the keyword that caused the match was later removed) are OUT OF SCOPE
 * for this endpoint. If this scenario needs to be addressed in the future, a
 * separate endpoint or migration should be introduced that explicitly targets
 * canonical rows and re-evaluates them against updated keyword sets.
 *
 * This test documents and asserts that scope boundary explicitly:
 *  - Seeds a lead with product_interest_group = "spirecut" (canonical).
 *  - Calls POST /admin/sally/leads/reclassify.
 *  - Asserts updated = 0 — the canonical row was untouched.
 *  - Asserts the DB row still holds "spirecut" after the call.
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

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const TEST_EMAIL = "sally-reclassify-canonical-skip-test@example.com";

let leadId: number;

async function cleanup() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [TEST_EMAIL]);
  await pool.query("DELETE FROM sally_leads WHERE email = $1", [TEST_EMAIL]);
}

beforeAll(async () => {
  await cleanup();

  // Seed a lead with a canonical product_interest_group = "spirecut".
  // The DB CHECK constraint enforces that only canonical values can be inserted,
  // so this insert succeeds without any constraint manipulation.
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_leads
       (name, email, product_interest_group, first_contact_date,
        is_cancelled, training_registered)
     VALUES ('Canonical Skip Test Lead', $1, 'spirecut', CURRENT_DATE, false, false)
     RETURNING id`,
    [TEST_EMAIL],
  );
  leadId = rows[0].id;
});

afterAll(cleanup);

describe(
  "POST /admin/sally/leads/reclassify — canonical rows are skipped (scope boundary)",
  () => {
    it("seeded lead holds the canonical group 'spirecut' before reclassify", async () => {
      const { rows } = await pool.query<{ product_interest_group: string }>(
        "SELECT product_interest_group FROM sally_leads WHERE id = $1",
        [leadId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].product_interest_group).toBe("spirecut");
    });

    it("reclassify returns ok:true and updated = 0 — canonical rows are not revisited", async () => {
      // SCOPE BOUNDARY: The reclassify endpoint only processes rows whose
      // product_interest_group is NOT one of the four canonical values.
      // A lead with group = "spirecut" is considered already classified and is
      // skipped entirely — even if the keyword that caused it to be classified
      // as "spirecut" has since been removed from SPIRECUT_KEYWORDS.
      //
      // Canonical-but-stale leads are intentionally OUT OF SCOPE for this
      // endpoint. Any future effort to re-evaluate canonical rows should be
      // implemented as a separate endpoint or database migration.
      const res = await request(app)
        .post("/api/admin/sally/leads/reclassify")
        .set("Authorization", ADMIN_AUTH)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // updated must be 0: our seeded lead has a canonical group and must not
      // be counted. (Other rows in the DB from parallel tests are also
      // canonical — the DB CHECK constraint prevents non-canonical inserts.)
      expect(res.body.updated).toBe(0);
    });

    it("DB row still holds 'spirecut' after reclassify — canonical value was not modified", async () => {
      const { rows } = await pool.query<{ product_interest_group: string }>(
        "SELECT product_interest_group FROM sally_leads WHERE id = $1",
        [leadId],
      );
      expect(rows).toHaveLength(1);
      // The reclassify endpoint must not have touched this canonical row.
      expect(rows[0].product_interest_group).toBe("spirecut");
    });
  },
);
