/**
 * Integration tests: POST /admin/sally/import/leads — missing email guard
 *
 * What & Why
 * ──────────
 * The import SELECT filters `WHERE email IS NOT NULL AND email <> ''`.
 * A lead whose id is valid but whose email is null or blank must be silently
 * skipped: imported = 0 and no orphan rows in sally_leads or sally_email_queue.
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

const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;

let nullEmailId: number;
let emptyEmailId: number;

async function cleanup() {
  if (nullEmailId)  await pool.query("DELETE FROM iroc_leads WHERE id = $1", [nullEmailId]);
  if (emptyEmailId) await pool.query("DELETE FROM iroc_leads WHERE id = $1", [emptyEmailId]);
}

beforeAll(async () => {
  await cleanup();

  // Seed a lead with email = NULL
  {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO iroc_leads (first_name, last_name, email, status, created_at)
       VALUES ('NoEmail', 'Null', NULL, 'new', NOW())
       RETURNING id`,
    );
    nullEmailId = rows[0].id;
  }

  // Seed a lead with email = '' (empty string)
  {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO iroc_leads (first_name, last_name, email, status, created_at)
       VALUES ('NoEmail', 'Empty', '', 'new', NOW())
       RETURNING id`,
    );
    emptyEmailId = rows[0].id;
  }
});

afterAll(cleanup);

describe("POST /admin/sally/import/leads — missing email guard", () => {
  it("silently skips a lead with email = NULL: imported=0, no sally_leads row, no email_queue row", async () => {
    const res = await request(app)
      .post("/api/admin/sally/import/leads")
      .set("Authorization", ADMIN_AUTH)
      .send({ ids: [nullEmailId] });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);

    // No sally_leads row
    const { rows: leads } = await pool.query(
      "SELECT id FROM sally_leads WHERE id IN (SELECT id FROM sally_leads WHERE name = 'NoEmail Null') LIMIT 1",
    );
    expect(leads).toHaveLength(0);

    // No sally_email_queue row referencing this iroc_leads id via a sally_leads join
    const { rowCount } = await pool.query(
      `SELECT 1 FROM sally_leads sl
       JOIN sally_email_queue seq ON seq.related_lead_id = sl.id
       WHERE sl.name = 'NoEmail Null'
       LIMIT 1`,
    );
    expect(rowCount ?? 0).toBe(0);
  });

  it("silently skips a lead with email = '': imported=0, no sally_leads row, no email_queue row", async () => {
    const res = await request(app)
      .post("/api/admin/sally/import/leads")
      .set("Authorization", ADMIN_AUTH)
      .send({ ids: [emptyEmailId] });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);

    // No sally_leads row
    const { rows: leads } = await pool.query(
      "SELECT id FROM sally_leads WHERE name = 'NoEmail Empty' LIMIT 1",
    );
    expect(leads).toHaveLength(0);

    // No sally_email_queue row
    const { rowCount } = await pool.query(
      `SELECT 1 FROM sally_leads sl
       JOIN sally_email_queue seq ON seq.related_lead_id = sl.id
       WHERE sl.name = 'NoEmail Empty'
       LIMIT 1`,
    );
    expect(rowCount ?? 0).toBe(0);
  });

  it("silently skips a completely unknown lead id: imported=0, no sally_leads row, no email_queue row", async () => {
    const nonExistentId = 999999999;

    // Confirm the id truly does not exist in iroc_leads before we start.
    const { rowCount: sourceExists } = await pool.query(
      "SELECT 1 FROM iroc_leads WHERE id = $1",
      [nonExistentId],
    );
    expect(sourceExists ?? 0).toBe(0);

    // Snapshot counts before the import so we can detect any new rows.
    const { rows: [{ count: leadsBefore }] } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM sally_leads",
    );
    const { rows: [{ count: queueBefore }] } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM sally_email_queue",
    );

    const res = await request(app)
      .post("/api/admin/sally/import/leads")
      .set("Authorization", ADMIN_AUTH)
      .send({ ids: [nonExistentId] });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);

    // sally_leads must not have grown — no orphan row was inserted.
    const { rows: [{ count: leadsAfter }] } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM sally_leads",
    );
    expect(leadsAfter).toBe(leadsBefore);

    // sally_email_queue must not have grown either.
    const { rows: [{ count: queueAfter }] } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM sally_email_queue",
    );
    expect(queueAfter).toBe(queueBefore);
  });
});
