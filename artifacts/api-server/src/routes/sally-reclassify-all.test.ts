/**
 * Integration test: POST /admin/sally/leads/reclassify/all corrects a
 * canonical-but-stale lead by re-evaluating the original specialty text.
 *
 * What & Why
 * ──────────
 * The original POST /admin/sally/leads/reclassify intentionally skips rows
 * whose product_interest_group is already one of the four canonical values
 * (spirecut / ministem / cellenis / ""). If a keyword is later removed from
 * SPIRECUT_KEYWORDS (or the other arrays), leads classified by that keyword
 * are now "canonical but stale" — the regular reclassify endpoint will never
 * correct them.
 *
 * POST /admin/sally/leads/reclassify/all addresses this by re-evaluating
 * every non-deleted lead against the current keyword set, using the stored
 * `specialty` column (the original free-text) as the classification input
 * rather than the already-derived canonical label. Without the original text
 * the canonical label conveys no information about which keyword matched; a
 * lead stored as "spirecut" because of "wrist" vs one stored as "spirecut"
 * because of "spirecut" look identical to the endpoint unless the source text
 * is preserved.
 *
 * Test scenario
 * ─────────────
 * 1. A lead is seeded with:
 *      specialty               = "hand surgeon"  (original free-text)
 *      product_interest_group  = "spirecut"      (canonical, from import time)
 *    The lead is canonical because "hand surg" (a substring of "hand surgeon")
 *    was in SPIRECUT_KEYWORDS when it was imported.
 *
 * 2. specialtyToProductGroup is mocked to simulate the removal of source
 *    keywords that matched "hand surgeon" (specifically "hand surg",
 *    "hand surgeon"). The brand word "spirecut" itself is intentionally left
 *    as a keyword so the mock mirrors real keyword surgery — only the source
 *    specialty keywords are removed, not the brand name.
 *
 *    With this mock, specialtyToProductGroup("hand surgeon") → ""
 *    but specialtyToProductGroup("spirecut")                 → "spirecut"
 *    (unchanged, showing the endpoint uses specialty, not the stored label).
 *
 * 3. POST /admin/sally/leads/reclassify/all is called.
 *
 * 4. The test confirms:
 *    - The response is { ok: true, updated: ≥ 1 }.
 *    - The DB row now holds "" (general) instead of "spirecut".
 *
 * sendEmail is mocked so no SMTP traffic occurs.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";

// Mock sendEmail before app is imported so no real SMTP traffic occurs.
vi.mock("../lib/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "mock-id" }),
}));

// Mock specialtyToProductGroup to simulate the removal of source keywords that
// originally caused "hand surgeon" to be classified as "spirecut".
//
// Specifically: "hand surg" and "hand surgeon" are removed from SPIRECUT_KEYWORDS.
// The brand word "spirecut" is intentionally kept — the mock is faithfully
// representing keyword surgery on the source specialty list, not on the brand
// word. This means:
//   specialtyToProductGroup("hand surgeon") → ""   (stale lead corrected)
//   specialtyToProductGroup("spirecut")     → "spirecut"  (brand word intact)
//
// This proves the endpoint re-evaluates the stored specialty column and not
// the canonical label — if it used the label "spirecut" the lead would not
// be updated.
vi.mock("../lib/sally-groups.js", () => ({
  specialtyToProductGroup: vi.fn((s: string | null | undefined): string => {
    if (!s) return "";
    const lower = s.toLowerCase();
    // SPIRECUT keywords with "hand surg" / "hand surgeon" removed.
    const SPIRECUT = [
      // "hand surg", "hand surgeon", "hand chirur", "hand chirur" — REMOVED
      "spirecut",   // brand word kept
      "wrist",      // retained — but not present in "hand surgeon"
      "handgelenk",
      "finger",
    ];
    const MINISTEM = [
      "mfat", "svf", "micro fat", "mikrofett", "micro-fat",
      "stromal vascular", "fat transfer", "ministem", "adipose", "stem cell",
    ];
    const CELLENIS = [
      "prp", "prf", "platelet-rich", "platelet rich", "exosome",
      "cellenis", "regenerative",
    ];
    if (MINISTEM.some(k => lower.includes(k))) return "ministem";
    if (CELLENIS.some(k => lower.includes(k))) return "cellenis";
    if (SPIRECUT.some(k => lower.includes(k))) return "spirecut";
    return "";
  }),
  PRODUCT_GROUPS: ["spirecut", "ministem", "cellenis", ""],
}));

import app from "../app.js";

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const TEST_EMAIL = "sally-reclassify-all-stale-test@example.com";
const DELETED_EMAIL = "sally-reclassify-all-deleted-test@example.com";

let leadId: number;
let deletedLeadId: number;

async function cleanup() {
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = ANY($1)", [[TEST_EMAIL, DELETED_EMAIL]]);
  await pool.query("DELETE FROM sally_leads WHERE email = ANY($1)", [[TEST_EMAIL, DELETED_EMAIL]]);
}

beforeAll(async () => {
  await cleanup();

  // Seed a canonical-but-stale lead:
  //   specialty               = "hand surgeon"  (original free-text from import)
  //   product_interest_group  = "spirecut"      (canonical — correct at import time)
  //
  // The lead was correctly classified when "hand surg" was in SPIRECUT_KEYWORDS.
  // The mock above simulates that keyword being removed, so re-evaluating
  // "hand surgeon" now yields "" (general). The endpoint must detect and fix this.
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_leads
       (name, email, specialty, product_interest_group, first_contact_date,
        is_cancelled, training_registered)
     VALUES ('Stale Canonical Lead', $1, 'hand surgeon', 'spirecut', CURRENT_DATE, false, false)
     RETURNING id`,
    [TEST_EMAIL],
  );
  leadId = rows[0].id;

  // Seed a soft-deleted lead with the same stale canonical group.
  // deleted_at IS NOT NULL means reclassify/all must NOT touch this row.
  const { rows: deletedRows } = await pool.query<{ id: number }>(
    `INSERT INTO sally_leads
       (name, email, specialty, product_interest_group, first_contact_date,
        is_cancelled, training_registered, deleted_at)
     VALUES ('Deleted Stale Lead', $1, 'hand surgeon', 'spirecut', CURRENT_DATE, false, false, NOW())
     RETURNING id`,
    [DELETED_EMAIL],
  );
  deletedLeadId = deletedRows[0].id;
});

afterAll(cleanup);

describe("POST /admin/sally/leads/reclassify/all — corrects canonical-but-stale leads", () => {
  it("seeded lead starts with specialty 'hand surgeon' and canonical group 'spirecut'", async () => {
    const { rows } = await pool.query<{ product_interest_group: string; specialty: string }>(
      "SELECT product_interest_group, specialty FROM sally_leads WHERE id = $1",
      [leadId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].specialty).toBe("hand surgeon");
    expect(rows[0].product_interest_group).toBe("spirecut");
  });

  it("reclassify/all returns ok:true and updated >= 1 — stale canonical row is re-evaluated", async () => {
    const res = await request(app)
      .post("/api/admin/sally/leads/reclassify/all")
      .set("Authorization", ADMIN_AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Our seeded lead has a specialty whose source keywords were removed, so
    // it must have been updated.
    expect(res.body.updated).toBeGreaterThanOrEqual(1);
  });

  it("DB row now holds '' (general) — stale canonical value was corrected via specialty re-evaluation", async () => {
    const { rows } = await pool.query<{ product_interest_group: string }>(
      "SELECT product_interest_group FROM sally_leads WHERE id = $1",
      [leadId],
    );
    expect(rows).toHaveLength(1);
    // specialtyToProductGroup("hand surgeon") → "" with the mock keyword set.
    // The endpoint re-evaluated against specialty, detected the drift, and updated.
    expect(rows[0].product_interest_group).toBe("");
  });

  it("reclassify/all does not insert a new sally_email_queue row for the corrected lead", async () => {
    // The endpoint only updates product_interest_group; it must never call
    // queueFirstContactEmail (or any other email-queuing function) for leads
    // that are merely being re-classified.  A future enhancement that wires
    // auto-emailing into the reclassify/all path could accidentally spam leads
    // who were already contacted — this test is the guard against that.
    const { rows } = await pool.query<{ id: number }>(
      "SELECT id FROM sally_email_queue WHERE related_lead_id = $1",
      [leadId],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("POST /admin/sally/leads/reclassify/all — skips soft-deleted leads", () => {
  it("soft-deleted lead starts with specialty 'hand surgeon' and stale canonical group 'spirecut'", async () => {
    const { rows } = await pool.query<{ product_interest_group: string; specialty: string; deleted_at: Date | null }>(
      "SELECT product_interest_group, specialty, deleted_at FROM sally_leads WHERE id = $1",
      [deletedLeadId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].specialty).toBe("hand surgeon");
    expect(rows[0].product_interest_group).toBe("spirecut");
    // Confirm the row really is soft-deleted
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("reclassify/all does not change the soft-deleted lead's product_interest_group", async () => {
    // The endpoint was already called in the previous describe block, so just
    // check the DB state directly — the deleted row must still hold 'spirecut'.
    const { rows } = await pool.query<{ product_interest_group: string }>(
      "SELECT product_interest_group FROM sally_leads WHERE id = $1",
      [deletedLeadId],
    );
    expect(rows).toHaveLength(1);
    // Must remain unchanged — the endpoint only fetches WHERE deleted_at IS NULL.
    expect(rows[0].product_interest_group).toBe("spirecut");
  });
});
