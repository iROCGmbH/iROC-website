/**
 * spirecut-settings-url-validation.test.ts — Task #96
 *
 * Confirms that the POST /api/admin/spirecut-settings endpoint enforces URL
 * validation for the sp_video_ct_url and sp_video_tf_url keys (and the two
 * sp_video_praktisch_*_url keys) when called directly with bad values.
 *
 * Guard layers (applied in order):
 *   1. isValidOptionalUrl  — empty or valid http/https → passes; non-URL → 400
 *   2. isValidYouTubeUrl   — empty or YouTube URL     → passes; other https → 422
 *
 * Done looks like:
 *   - A direct POST with a non-URL value for a URL key → 400 { error: "Invalid URL" }
 *   - A direct POST with an empty value               → 200 { ok: true }
 *   - A direct POST with a valid YouTube embed URL    → 200 { ok: true }
 *
 * Strategy: in-memory store mock (same pattern as other route tests here).
 * Auth is satisfied by passing a valid iROC JWT (mirrors makeValidJwt in
 * admin-auth-bridge.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── In-memory store mock ──────────────────────────────────────────────────────

const { store } = vi.hoisted(() => {
  const store = new Map<string, string>();

  const mockOnConflictDoUpdate = vi.fn().mockImplementation(() =>
    Promise.resolve(undefined)
  );
  const mockValues = vi.fn().mockImplementation((row: { key: string; value: string }) => {
    store.set(row.key, row.value);
    return { onConflictDoUpdate: mockOnConflictDoUpdate };
  });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  const mockFrom = vi.fn().mockImplementation(() => {
    const rows = Array.from(store.entries()).map(([key, value]) => ({ key, value }));
    return Promise.resolve(rows);
  });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return { store, mockInsert, mockSelect };
});

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockImplementation(() => {
      const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const mockValues = vi.fn().mockImplementation((row: { key: string; value: string }) => {
        store.set(row.key, row.value);
        return { onConflictDoUpdate: mockOnConflictDoUpdate };
      });
      return { values: mockValues };
    }),
    select: vi.fn().mockImplementation(() => {
      const mockFrom = vi.fn().mockImplementation(() => {
        const rows = Array.from(store.entries()).map(([key, value]) => ({ key, value }));
        return Promise.resolve(rows);
      });
      return { from: mockFrom };
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  },
  settingsTable: { key: "key" },
  trainingDatesTable: {},
  trainedDoctorsTable: {},
  doctorCertificationsTable: {},
  resourcesTable: {},
  trainingRegistrationsTable: {},
  websiteCustomersTable: {},
  irocAppUsers: {},
  irocCustomers: {},
  irocProducts: {},
  irocInventoryLots: {},
  irocInvoices: {},
  irocInvoiceItems: {},
  irocNotifications: {},
}));

import app from "../app";

// ── Auth helpers ──────────────────────────────────────────────────────────────

function makeValidJwt(payload: { userId: number; username: string }): string {
  const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const full = { ...payload, exp };
  const data = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const VALID_JWT = makeValidJwt({ userId: 1, username: "admin" });
const AUTH = `Bearer ${VALID_JWT}`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/admin/spirecut-settings — URL validation guard", () => {
  beforeEach(() => {
    store.clear();
  });

  // ── Bad value: plain string that is not a URL ─────────────────────────────

  it("returns 400 { error: 'Invalid URL' } for a non-URL value on sp_video_ct_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_ct_url", value: "not-a-url" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid URL" });
  });

  it("returns 400 { error: 'Invalid URL' } for a non-URL value on sp_video_tf_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_tf_url", value: "just plain text" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid URL" });
  });

  it("returns 400 for a non-URL value on sp_video_praktisch_1_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: "ftp://bad-scheme.example.com" });

    // ftp:// passes URL constructor but isValidOptionalUrl requires http/https
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid URL" });
  });

  it("returns 400 for a non-URL value on sp_video_praktisch_2_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_2_url", value: "not-a-url-at-all" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid URL" });
  });

  it("returns 400 { error: 'Invalid URL' } for a non-URL value on sp_gate_link_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_gate_link_url", value: "not-a-url" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid URL" });
  });

  // ── Empty value: field cleared — both URL guards allow it ─────────────────

  it("returns 200 { ok: true } when sp_video_ct_url value is empty string", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_ct_url", value: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("returns 200 { ok: true } when sp_video_tf_url value is empty string", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_tf_url", value: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("returns 200 { ok: true } when value is omitted entirely (treated as empty)", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_ct_url" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("returns 200 { ok: true } when sp_gate_link_url value is empty string", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_gate_link_url", value: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  // ── Valid YouTube URL: passes both guards ─────────────────────────────────

  it("returns 200 { ok: true } for a valid YouTube embed URL on sp_video_ct_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_ct_url", value: "https://www.youtube.com/embed/mjPCpa427go" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("returns 200 { ok: true } for a valid YouTube watch URL on sp_video_tf_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_tf_url", value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("returns 200 { ok: true } for a youtu.be short link on sp_video_praktisch_1_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: "https://youtu.be/dQw4w9WgXcQ" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("returns 200 { ok: true } for a valid https URL on sp_gate_link_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_gate_link_url", value: "https://spirecut.com/patient-information" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  // ── Valid https non-YouTube URL: passes URL guard but fails YouTube guard ──
  // This confirms the URL guard fires BEFORE the YouTube-specific guard, and
  // that a valid https URL that is not YouTube gets 422 (not 400 "Invalid URL").

  it("returns 422 (not 400) for a valid https non-YouTube URL on sp_video_ct_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_ct_url", value: "https://vimeo.com/123456" });

    // Passes isValidOptionalUrl → does NOT return 400 "Invalid URL"
    expect(res.status).not.toBe(400);
    expect(res.body.error).not.toBe("Invalid URL");
    // Fails isValidYouTubeUrl → returns 422
    expect(res.status).toBe(422);
  });

  // ── Non-URL keys are not subject to URL validation ────────────────────────

  it("accepts any value for sp_contact_email_de (not a URL key)", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_contact_email_de", value: "info@spirecut.de" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  // ── Bad key still returns 400 ─────────────────────────────────────────────

  it("returns 400 for an unknown key regardless of value", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_unknown_key", value: "https://www.youtube.com/embed/test" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid key" });
  });

  // ── The URL-validation error is returned even without a valid admin token ──
  // (auth guard fires first, so a bad token returns 401 before URL is checked)

  it("returns 401 (not 400) when no auth token is provided, even with a bad URL", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .send({ key: "sp_video_ct_url", value: "not-a-url" });

    expect(res.status).toBe(401);
  });
});
