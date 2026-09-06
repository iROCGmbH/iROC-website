/**
 * website-settings-url-validation.test.ts — Task #81
 *
 * Verifies that POST /api/admin/website-settings and
 * POST /api/admin/spirecut-settings reject non-URL values for URL-typed
 * keys, and still accept valid http/https URLs and empty strings.
 *
 * This covers the server-side guard that prevents bad values from reaching
 * the database even when the endpoint is called directly (e.g. via curl),
 * bypassing any client-side validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── In-memory DB mock ─────────────────────────────────────────────────────────

const { store, mockInsert, mockSelect } = vi.hoisted(() => {
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
    insert: mockInsert,
    select: mockSelect,
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

// ── Auth helper ───────────────────────────────────────────────────────────────

function makeValidJwt(payload: { userId: number; username: string }): string {
  const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const JWT_AUTH = `Bearer ${makeValidJwt({ userId: 1, username: "admin" })}`;

// ── website-settings URL validation ───────────────────────────────────────────

describe("POST /api/admin/website-settings — URL field validation", () => {
  beforeEach(() => {
    store.clear();
    mockInsert.mockClear();
  });

  const URL_KEYS = [
    "ws_hero_image_url",
    "ws_maps_embed_url",
    "ws_maps_directions_url",
    "ws_social_linkedin",
    "ws_social_facebook",
    "ws_social_instagram",
    "ws_social_youtube",
    "config_iroc_website_url",
    "config_spirecut_website_url",
    "ws_webapp_url",
  ] as const;

  // ── Rejection cases ─────────────────────────────────────────────────────────

  it.each(URL_KEYS)(
    "rejects a plain string for %s with 400 Invalid URL",
    async (key) => {
      const res = await request(app)
        .post("/api/admin/website-settings")
        .set("Authorization", JWT_AUTH)
        .send({ key, value: "not-a-url" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "Invalid URL" });
      // The bad value must never reach the DB mock
      expect(store.has(key)).toBe(false);
    }
  );

  it("rejects a javascript: URL for ws_social_linkedin with 400 Invalid URL", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_social_linkedin", value: "javascript:alert(1)" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid URL" });
    expect(store.has("ws_social_linkedin")).toBe(false);
  });

  it("rejects a data: URL for ws_maps_embed_url with 400 Invalid URL", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_maps_embed_url", value: "data:text/html,<h1>hi</h1>" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid URL" });
    expect(store.has("ws_maps_embed_url")).toBe(false);
  });

  it("rejects a ftp: URL for ws_hero_image_url with 400 Invalid URL", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url", value: "ftp://example.com/img.png" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid URL" });
    expect(store.has("ws_hero_image_url")).toBe(false);
  });

  it("rejects a relative path for ws_maps_directions_url with 400 Invalid URL", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_maps_directions_url", value: "/relative/path" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid URL" });
    expect(store.has("ws_maps_directions_url")).toBe(false);
  });

  // ── Acceptance cases ────────────────────────────────────────────────────────

  it("accepts a valid https URL for ws_social_linkedin", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_social_linkedin", value: "https://linkedin.com/company/iroc" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts a valid http URL for ws_maps_embed_url", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_maps_embed_url", value: "http://maps.example.com/embed?q=Munich" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts an empty string for a URL key (clears the field)", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_social_youtube", value: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts a missing value (treated as empty) for a URL key", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_hero_image_url" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("saves and clears the iROC web-app destination", async () => {
    const destination = "https://portal.example.com/doctor-app";

    const save = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_webapp_url", value: destination });

    expect(save.status).toBe(200);
    expect(store.get("ws_webapp_url")).toBe(destination);

    const publicSettings = await request(app).get("/api/website-settings");
    expect(publicSettings.status).toBe(200);
    expect(publicSettings.body.ws_webapp_url).toBe(destination);

    const clear = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_webapp_url", value: "" });

    expect(clear.status).toBe(200);
    expect(store.get("ws_webapp_url")).toBe("");
  });

  // ── Non-URL keys are unaffected ─────────────────────────────────────────────

  it("accepts any string for a non-URL key like ws_contact_phone", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_contact_phone", value: "not-a-url-but-thats-fine" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });
});

// ── spirecut-settings URL validation ─────────────────────────────────────────

describe("POST /api/admin/spirecut-settings — URL field validation", () => {
  beforeEach(() => {
    store.clear();
    mockInsert.mockClear();
  });

  const SP_URL_KEYS = [
    "sp_video_ct_url",
    "sp_video_tf_url",
    "sp_video_praktisch_1_url",
    "sp_video_praktisch_2_url",
    "sp_webapp_url",
  ] as const;

  it.each(SP_URL_KEYS)(
    "rejects a plain string for %s with 400 Invalid URL",
    async (key) => {
      const res = await request(app)
        .post("/api/admin/spirecut-settings")
        .set("Authorization", JWT_AUTH)
        .send({ key, value: "not-a-url" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: "Invalid URL" });
      expect(store.has(key)).toBe(false);
    }
  );

  it("saves and clears the Spirecut PWA destination", async () => {
    const destination = "https://patients.example.com/app";

    const save = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_webapp_url", value: destination });

    expect(save.status).toBe(200);
    expect(store.get("sp_webapp_url")).toBe(destination);

    const publicSettings = await request(app).get("/api/patient-settings");
    expect(publicSettings.status).toBe(200);
    expect(publicSettings.body.sp_webapp_url).toBe(destination);

    const clear = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_webapp_url", value: "" });

    expect(clear.status).toBe(200);
    expect(store.get("sp_webapp_url")).toBe("");
  });

  it("rejects a javascript: URL for sp_video_ct_url with 400 Invalid URL", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_ct_url", value: "javascript:void(0)" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid URL" });
    expect(store.has("sp_video_ct_url")).toBe(false);
  });

  // ── YouTube-only validation (422) ───────────────────────────────────────────

  it("rejects a Vimeo URL for sp_video_ct_url with 422", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_ct_url", value: "https://vimeo.com/123456789" });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/YouTube/i);
    expect(store.has("sp_video_ct_url")).toBe(false);
  });

  it("rejects a Vimeo URL for sp_video_tf_url with 422", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_tf_url", value: "https://vimeo.com/987654321" });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/YouTube/i);
    expect(store.has("sp_video_tf_url")).toBe(false);
  });

  it("rejects a Vimeo URL for sp_video_praktisch_1_url with 422", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: "https://vimeo.com/111222333" });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/YouTube/i);
    expect(store.has("sp_video_praktisch_1_url")).toBe(false);
  });

  it("rejects a Vimeo URL for sp_video_praktisch_2_url with 422", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_praktisch_2_url", value: "https://vimeo.com/444555666" });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/YouTube/i);
    expect(store.has("sp_video_praktisch_2_url")).toBe(false);
  });

  it("rejects an arbitrary https URL for sp_video_ct_url with 422", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_ct_url", value: "https://example.com/video/embed/abc" });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/YouTube/i);
    expect(store.has("sp_video_ct_url")).toBe(false);
  });

  // ── Acceptance cases ────────────────────────────────────────────────────────

  it("accepts a valid https YouTube embed URL for sp_video_ct_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_ct_url", value: "https://www.youtube.com/embed/dQw4w9WgXcQ" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts a YouTube watch URL for sp_video_tf_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_tf_url", value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts a youtu.be short URL for sp_video_ct_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_ct_url", value: "https://youtu.be/dQw4w9WgXcQ" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts a valid YouTube embed URL for sp_video_praktisch_1_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: "https://www.youtube.com/embed/abc123DEF45" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts a valid YouTube watch URL for sp_video_praktisch_2_url", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_praktisch_2_url", value: "https://www.youtube.com/watch?v=abc123DEF45" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts an empty string for sp_video_praktisch_1_url (clears the field)", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts an empty string for sp_video_tf_url (clears the field)", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_tf_url", value: "" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts any string for a non-URL key like sp_contact_email_de", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_contact_email_de", value: "kontakt@spirecut.de" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });
});
