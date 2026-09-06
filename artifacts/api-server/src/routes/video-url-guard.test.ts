/**
 * video-url-guard.test.ts — Task #173
 *
 * Confirms that POST /api/admin/video-urls enforces the YouTube URL guard when
 * called directly (bypassing the admin UI), including edge cases like
 * http:// YouTube URLs, Vimeo links, and javascript: URLs.
 *
 * Guard: isValidYouTubeUrl
 *   - empty string                          → 200 (field cleared)
 *   - https://www.youtube.com/embed/<id>   → 200
 *   - https://youtube.com/embed/<id>       → 200
 *   - https://www.youtube.com/watch?v=<id> → 200
 *   - https://youtu.be/<id>                → 200
 *   - Vimeo URL                             → 422
 *   - plain https non-YouTube URL           → 422
 *   - http:// YouTube URL (not https)       → 422
 *   - javascript: URL                       → 422
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── In-memory store mock ──────────────────────────────────────────────────────

const { store } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return { store };
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

describe("POST /api/admin/video-urls — YouTube URL guard", () => {
  beforeEach(() => {
    store.clear();
  });

  // ── Rejected: non-YouTube URLs → 422 ─────────────────────────────────────

  it("returns 422 for a Vimeo URL", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "spirecut", url: "https://vimeo.com/123456789" });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 422 for a plain https non-YouTube URL", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "ministem", url: "https://example.com/video.mp4" });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 422 for an http:// YouTube URL (scheme must be https)", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "spirecut", url: "http://www.youtube.com/embed/dQw4w9WgXcQ" });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 422 for a javascript: URL", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "spirecut", url: "javascript:alert(1)" });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("error");
  });

  // ── Accepted: valid YouTube URLs → 200 ───────────────────────────────────

  it("returns 200 for a valid https://www.youtube.com/embed URL", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "spirecut", url: "https://www.youtube.com/embed/mjPCpa427go" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "Updated" });
  });

  it("returns 200 for a valid https://youtube.com/embed URL (without www)", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "ministem", url: "https://youtube.com/embed/dQw4w9WgXcQ" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "Updated" });
  });

  it("returns 200 for a valid https://www.youtube.com/watch?v= URL", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "spirecut", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "Updated" });
  });

  it("returns 200 for a valid https://youtu.be short link", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "ministem", url: "https://youtu.be/dQw4w9WgXcQ" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "Updated" });
  });

  // ── Accepted: empty string clears the field → 200 ────────────────────────

  it("returns 200 for an empty string (field cleared)", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "spirecut", url: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "Updated" });
  });

  it("returns 200 for ministem with an empty string", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "ministem", url: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: "Updated" });
  });

  // ── Bad instrument → 400 (not the URL guard) ─────────────────────────────

  it("returns 400 for an unknown instrument (guard fires before URL check)", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", AUTH)
      .send({ instrument: "unknown", url: "https://www.youtube.com/embed/test123" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  // ── Auth guard fires before URL guard ────────────────────────────────────

  it("returns 401 when no auth token is provided, even with a bad URL", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .send({ instrument: "spirecut", url: "https://vimeo.com/123456789" });

    expect(res.status).toBe(401);
  });
});
