/**
 * spirecut-settings-praktisch-prefill.test.ts — Task #174
 *
 * Confirms that sp_video_praktisch_1_url and sp_video_praktisch_2_url values
 * previously saved via POST /api/admin/spirecut-settings are correctly returned
 * by a subsequent GET /api/patient-settings — which is how SpirecutSettings.tsx
 * pre-fills the input fields when the admin reopens the settings tab.
 *
 * Also covers clearing a URL (empty-string save) and the effect on the patient
 * page: when GET returns "" for a praktisch URL, toEmbedUrl("") returns "" so
 * the PraktischeInformationen embed is hidden.
 *
 * Strategy: stateful in-memory Map mock — values written by POST are visible to
 * the subsequent GET, mirroring real DB upsert behaviour.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Stateful in-memory DB mock ────────────────────────────────────────────────

const { store } = vi.hoisted(() => {
  const store = new Map<string, string>();

  const mockOnConflictDoUpdate = vi.fn().mockImplementation(() =>
    Promise.resolve(undefined),
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
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockImplementation((row: { key: string; value: string }) => {
        store.set(row.key, row.value);
        return { onConflictDoUpdate };
      });
      return { values };
    }),
    select: vi.fn().mockImplementation(() => {
      const from = vi.fn().mockImplementation(() => {
        const rows = Array.from(store.entries()).map(([key, value]) => ({ key, value }));
        return Promise.resolve(rows);
      });
      return { from };
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            const repairedKeys = Array.from(store.entries())
              .filter(([, value]) => value !== "" && value.trim() === "")
              .map(([key]) => key);
            for (const key of repairedKeys) store.set(key, "");
            return Promise.resolve(repairedKeys.map((key) => ({ key })));
          }),
        }),
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

const AUTH = `Bearer ${makeValidJwt({ userId: 1, username: "admin" })}`;

// ── Test YouTube URLs ─────────────────────────────────────────────────────────

const YT_P1 = "https://www.youtube.com/embed/praktisch1test?rel=0";
const YT_P2 = "https://www.youtube.com/embed/praktisch2test?rel=0";
const YT_WATCH = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const YT_SHORT = "https://youtu.be/dQw4w9WgXcQ";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Praktisch video URL pre-fill — admin settings tab reopened", () => {
  beforeEach(() => {
    store.clear();
  });

  // ── Pre-fill: saved URL 1 appears on re-fetch ─────────────────────────────

  it("GET /api/patient-settings returns saved sp_video_praktisch_1_url", async () => {
    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: YT_P1 });

    expect(postRes.status).toBe(200);
    expect(postRes.body).toMatchObject({ ok: true });

    // Simulate admin reopening the settings tab: fresh GET call
    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_1_url).toBe(YT_P1);
  });

  // ── Pre-fill: saved URL 2 appears on re-fetch ─────────────────────────────

  it("GET /api/patient-settings returns saved sp_video_praktisch_2_url", async () => {
    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_2_url", value: YT_P2 });

    expect(postRes.status).toBe(200);

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_2_url).toBe(YT_P2);
  });

  // ── Pre-fill: both URLs saved and returned together ───────────────────────

  it("GET /api/patient-settings returns both praktisch URLs when both are saved", async () => {
    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: YT_P1 });

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_2_url", value: YT_P2 });

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_1_url).toBe(YT_P1);
    expect(getRes.body.sp_video_praktisch_2_url).toBe(YT_P2);
  });

  // ── Clear: empty string saved → GET returns empty → embed hidden ──────────

  it("saving empty string for URL 1 causes GET to return empty string (embed hidden)", async () => {
    // First save a URL
    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: YT_P1 });

    // Then clear it
    const clearRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: "" });

    expect(clearRes.status).toBe(200);
    expect(clearRes.body).toMatchObject({ ok: true });

    const getRes = await request(app).get("/api/patient-settings");
    expect(getRes.status).toBe(200);
    // Empty string → toEmbedUrl("") returns "" → PraktischeInformationen hides the embed
    expect(getRes.body.sp_video_praktisch_1_url).toBe("");
  });

  it("saving empty string for URL 2 causes GET to return empty string (embed hidden)", async () => {
    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_2_url", value: YT_P2 });

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_2_url", value: "" });

    const getRes = await request(app).get("/api/patient-settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_2_url).toBe("");
  });

  // ── Default: no override stored → empty string default returned ───────────

  it("GET returns empty string for both praktisch URL keys when no override is saved", async () => {
    // store is cleared in beforeEach — no POSTs
    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    // SP_DEFAULTS for these keys is "" — no video shown until admin configures one
    expect(getRes.body.sp_video_praktisch_1_url).toBe("");
    expect(getRes.body.sp_video_praktisch_2_url).toBe("");
  });

  // ── Valid YouTube watch URL saved → returned verbatim ─────────────────────

  it("GET returns a saved youtube.com/watch URL for sp_video_praktisch_1_url", async () => {
    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: YT_WATCH });

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    // Value stored as-is; toEmbedUrl() converts it to embed format client-side
    expect(getRes.body.sp_video_praktisch_1_url).toBe(YT_WATCH);
  });

  // ── Valid youtu.be short link saved → returned verbatim ───────────────────

  it("GET returns a saved youtu.be short link for sp_video_praktisch_2_url", async () => {
    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_2_url", value: YT_SHORT });

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_2_url).toBe(YT_SHORT);
  });

  // ── Upsert: second save overwrites first ──────────────────────────────────

  it("second POST for sp_video_praktisch_1_url overwrites the first", async () => {
    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: YT_P1 });

    const secondUrl = "https://www.youtube.com/embed/updated?rel=0";
    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: secondUrl });

    const getRes = await request(app).get("/api/patient-settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_1_url).toBe(secondUrl);
  });

  // ── Titles also pre-fill correctly ───────────────────────────────────────

  it("GET returns saved sp_video_praktisch_1_title for the field label", async () => {
    const title = "Karpaltunnelsyndrom – Eingriff";

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_title", value: title });

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_1_title).toBe(title);
  });

  it("GET returns saved sp_video_praktisch_2_title for the field label", async () => {
    const title = "Schnappfinger – Eingriff";

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_2_title", value: title });

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_2_title).toBe(title);
  });

  it.each([
    ["sp_video_praktisch_1_title", "   \t"],
    ["sp_video_praktisch_2_title", "\n  "],
  ])("normalizes a whitespace-only %s to an empty setting", async (key, value) => {
    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key, value });

    expect(postRes.status).toBe(200);
    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body[key]).toBe("");
  });

  it("preserves surrounding whitespace on a non-blank practical video title", async () => {
    const title = "  Karpaltunnel – Eingriff  ";

    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_title", value: title });

    expect(postRes.status).toBe(200);
    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.body.sp_video_praktisch_1_title).toBe(title);
  });

  it("repairs pre-existing whitespace-only title rows without changing custom titles", async () => {
    const legacyTitle1 = " \t\n ";
    const customTitle = "  Individueller Ablauf  ";
    store.set("sp_video_praktisch_1_title", legacyTitle1);
    store.set("sp_video_praktisch_2_title", customTitle);

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_1_title).toBe("");
    expect(getRes.body.sp_video_praktisch_2_title).toBe(customTitle);
    expect(store.get("sp_video_praktisch_1_title")).toBe("");
    expect(store.get("sp_video_praktisch_2_title")).toBe(customTitle);
  });

  it("repairs both pre-existing practical title rows when they contain only whitespace", async () => {
    store.set("sp_video_praktisch_1_title", " \t");
    store.set("sp_video_praktisch_2_title", "\n  ");

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_1_title).toBe("");
    expect(getRes.body.sp_video_praktisch_2_title).toBe("");
    expect(store.get("sp_video_praktisch_1_title")).toBe("");
    expect(store.get("sp_video_praktisch_2_title")).toBe("");
  });

  // ── URL + title saved together — both pre-fill ────────────────────────────

  it("URL and title for the same slot are both returned after being saved", async () => {
    const title = "Karpaltunnel – OP-Ablauf";

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_url", value: YT_P1 });

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", AUTH)
      .send({ key: "sp_video_praktisch_1_title", value: title });

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_1_url).toBe(YT_P1);
    expect(getRes.body.sp_video_praktisch_1_title).toBe(title);
  });
});
