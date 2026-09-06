/**
 * Integration tests: Sally brand-group email routing after lead import
 *
 * What & Why
 * ──────────
 * The specialty → product-group mapping drives all outbound Sally first-contact
 * emails. A gap in coverage could send a hand-surgeon a generic "our products"
 * email instead of a Spirecut-branded one, or a MFAT specialist Cellenis copy.
 *
 * These tests assert the full import path via the actual HTTP endpoint:
 *   POST /admin/sally/import/leads  (with iroc_leads IDs)
 *     → iroc_leads.specialty resolved via specialtyToProductGroup()
 *     → sally_leads row created with correct product_interest_group
 *     → sally_email_queue row queued with brand-appropriate subject
 *
 * sendEmail is mocked so no SMTP traffic occurs.
 * All DB rows are created and cleaned up around the suite.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";

// Mock sendEmail before the app is imported so no SMTP traffic occurs
vi.mock("../lib/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "mock-id" }),
}));

import app from "../app.js";

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;
const PREFIX = "sally-grp-route-test";

// specialty → { expectedGroup, subjectFragment }
const CASES = [
  { specialty: "Hand Surgery", email: `${PREFIX}-hand@example.com`, expectedGroup: "spirecut",  fragment: "Spirecut"      },
  { specialty: "MFAT",        email: `${PREFIX}-mfat@example.com`, expectedGroup: "ministem",  fragment: "MiniStem"      },
  { specialty: "PRP",         email: `${PREFIX}-prp@example.com`,  expectedGroup: "cellenis",  fragment: "Cellenis"      },
  { specialty: "Orthopedics", email: `${PREFIX}-orth@example.com`, expectedGroup: "",          fragment: "iROC products" },
] as const;

const allEmails = CASES.map(c => c.email);
let leadIds: Record<string, number> = {};

async function cleanup() {
  const emails = allEmails;
  await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = ANY($1)", [emails]);
  await pool.query("DELETE FROM sally_leads WHERE email = ANY($1)", [emails]);
  await pool.query("DELETE FROM iroc_leads WHERE email = ANY($1)", [emails]);
}

beforeAll(async () => {
  await cleanup();

  // Seed one iroc_leads row per test case
  for (const c of CASES) {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO iroc_leads
         (first_name, last_name, email, specialty, status, created_at)
       VALUES ('Test', 'Doctor', $1, $2, 'new', NOW())
       RETURNING id`,
      [c.email, c.specialty],
    );
    leadIds[c.email] = rows[0].id;
  }
});

afterAll(cleanup);

describe("POST /admin/sally/import/leads — brand-group email routing", () => {
  for (const { specialty, email, expectedGroup, fragment } of CASES) {
    it(`specialty "${specialty}" → group "${expectedGroup}" → subject contains "${fragment}"`, async () => {
      const id = leadIds[email];

      const res = await request(app)
        .post("/api/admin/sally/import/leads")
        .set("Authorization", ADMIN_AUTH)
        .send({ ids: [id] });

      expect(res.status).toBe(200);
      expect(res.body.imported).toBe(1);

      // Confirm sally_leads row has the correct product_interest_group
      const { rows: leads } = await pool.query<{ product_interest_group: string }>(
        "SELECT product_interest_group FROM sally_leads WHERE LOWER(email) = LOWER($1)",
        [email],
      );
      expect(leads).toHaveLength(1);
      expect(leads[0].product_interest_group).toBe(expectedGroup);

      // Confirm the queued first-contact email subject carries the brand label
      const { rows: queued } = await pool.query<{ subject: string }>(
        `SELECT subject FROM sally_email_queue
         WHERE recipient_email = $1 AND trigger_type = 'first_contact'
         ORDER BY id DESC LIMIT 1`,
        [email],
      );
      expect(queued).toHaveLength(1);
      expect(queued[0].subject).toContain(fragment);
    });
  }
});

// ── Duplicate-import guard ────────────────────────────────────────────────────

describe("POST /admin/sally/import/leads — duplicate guard", () => {
  const DUP_EMAIL = `${PREFIX}-dup@example.com`;
  let dupLeadId: number;

  beforeAll(async () => {
    // Clean up any leftovers from a previous run
    await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [DUP_EMAIL]);
    await pool.query("DELETE FROM sally_leads WHERE LOWER(email) = LOWER($1)", [DUP_EMAIL]);
    await pool.query("DELETE FROM iroc_leads WHERE LOWER(email) = LOWER($1)", [DUP_EMAIL]);

    // Seed one iroc_leads row
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO iroc_leads
         (first_name, last_name, email, specialty, status, created_at)
       VALUES ('Dup', 'Test', $1, 'Hand Surgery', 'new', NOW())
       RETURNING id`,
      [DUP_EMAIL],
    );
    dupLeadId = rows[0].id;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM sally_email_queue WHERE recipient_email = $1", [DUP_EMAIL]);
    await pool.query("DELETE FROM sally_leads WHERE LOWER(email) = LOWER($1)", [DUP_EMAIL]);
    await pool.query("DELETE FROM iroc_leads WHERE LOWER(email) = LOWER($1)", [DUP_EMAIL]);
  });

  it("first import creates exactly one sally_leads row and one email_queue entry", async () => {
    const res = await request(app)
      .post("/api/admin/sally/import/leads")
      .set("Authorization", ADMIN_AUTH)
      .send({ ids: [dupLeadId] });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);

    const { rows: leads } = await pool.query(
      "SELECT id FROM sally_leads WHERE LOWER(email) = LOWER($1)",
      [DUP_EMAIL],
    );
    expect(leads).toHaveLength(1);

    const { rows: queued } = await pool.query(
      "SELECT id FROM sally_email_queue WHERE recipient_email = $1 AND trigger_type = 'first_contact'",
      [DUP_EMAIL],
    );
    expect(queued).toHaveLength(1);
  });

  it("second import of the same id returns imported=0 and creates no new rows", async () => {
    const res = await request(app)
      .post("/api/admin/sally/import/leads")
      .set("Authorization", ADMIN_AUTH)
      .send({ ids: [dupLeadId] });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);

    // Still exactly one sally_leads row
    const { rows: leads } = await pool.query(
      "SELECT id FROM sally_leads WHERE LOWER(email) = LOWER($1)",
      [DUP_EMAIL],
    );
    expect(leads).toHaveLength(1);

    // Still exactly one email_queue entry
    const { rows: queued } = await pool.query(
      "SELECT id FROM sally_email_queue WHERE recipient_email = $1 AND trigger_type = 'first_contact'",
      [DUP_EMAIL],
    );
    expect(queued).toHaveLength(1);
  });
});
