/**
 * spirecut-chatbot-starters.test.ts — Task #200
 *
 * Confirms that admin-saved chatbot starter questions are returned by
 * GET /api/patient-settings and that the Chatbot component's parseStartersFromRaw
 * helper correctly applies them (or falls back to hardcoded defaults when cleared).
 *
 * Scenarios:
 *  1. GET /api/patient-settings includes sp_chatbot_starters_de and
 *     sp_chatbot_starters_en as empty string when no value is stored.
 *  2. After saving DE starters via POST, GET returns the saved JSON array.
 *  3. After saving EN starters via POST, GET returns the saved JSON array.
 *  4. Both DE and EN can be saved independently and returned together.
 *  5. A second POST overwrites the first (upsert semantics).
 *  6. Saving an empty value clears the override (GET returns "").
 *  7. parseStartersFromRaw: valid JSON array → uses admin values.
 *  8. parseStartersFromRaw: empty string → falls back to hardcoded defaults.
 *  9. parseStartersFromRaw: invalid JSON → falls back to hardcoded defaults.
 * 10. parseStartersFromRaw: empty array → falls back to hardcoded defaults.
 * 11. parseStartersFromRaw: filters out blank entries from the saved array.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Stateful in-memory DB mock ────────────────────────────────────────────────

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
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const JWT_AUTH = `Bearer ${makeValidJwt({ userId: 1, username: "admin" })}`;

// ── parseStartersFromRaw — pure unit tests (mirrors Chatbot.tsx) ──────────────

const DEFAULT_DE = [
  "Was ist der Spirecut®-Eingriff?",
  "Wie lange dauert die Heilung nach dem Eingriff?",
  "Ist der Eingriff schmerzhaft?",
  "Wie finde ich einen zertifizierten Arzt in meiner Nähe?",
];
const DEFAULT_EN = [
  "What is the Spirecut® procedure?",
  "How long is the recovery after the procedure?",
  "Is the procedure painful?",
  "How do I find a certified doctor near me?",
];

/** Mirrors the parseStartersFromRaw helper in Chatbot.tsx exactly. */
function parseStartersFromRaw(raw: string, fallback: string[]): string[] {
  if (!raw) return fallback;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) return arr.map(String).filter(Boolean);
  } catch { /* ignore */ }
  return fallback;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("chatbot starters — API round-trip (GET /api/patient-settings)", () => {
  beforeEach(() => {
    store.clear();
  });

  // 1. Keys present as empty string when no override is stored

  it("returns sp_chatbot_starters_de and sp_chatbot_starters_en as empty string when store is empty", async () => {
    const res = await request(app).get("/api/patient-settings");
    expect(res.status).toBe(200);
    expect(res.body.sp_chatbot_starters_de).toBe("");
    expect(res.body.sp_chatbot_starters_en).toBe("");
  });

  // 2. Saved DE starters appear in GET

  it("returns saved sp_chatbot_starters_de JSON array after a POST", async () => {
    const deStarters = ["Wie funktioniert Spirecut?", "Ist der Eingriff schmerzhaft?"];
    const value = JSON.stringify(deStarters);

    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_starters_de", value });

    expect(postRes.status).toBe(200);
    expect(postRes.body).toMatchObject({ ok: true });

    const getRes = await request(app).get("/api/patient-settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_chatbot_starters_de).toBe(value);
  });

  // 3. Saved EN starters appear in GET

  it("returns saved sp_chatbot_starters_en JSON array after a POST", async () => {
    const enStarters = ["What is Spirecut?", "How long is recovery?"];
    const value = JSON.stringify(enStarters);

    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_starters_en", value });

    expect(postRes.status).toBe(200);

    const getRes = await request(app).get("/api/patient-settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_chatbot_starters_en).toBe(value);
  });

  // 4. DE and EN persisted independently

  it("persists DE and EN starters independently and returns both via GET", async () => {
    const deValue = JSON.stringify(["Frage auf Deutsch"]);
    const enValue = JSON.stringify(["Question in English"]);

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_starters_de", value: deValue });

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_starters_en", value: enValue });

    const getRes = await request(app).get("/api/patient-settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_chatbot_starters_de).toBe(deValue);
    expect(getRes.body.sp_chatbot_starters_en).toBe(enValue);
  });

  // 5. Second write overwrites first (upsert semantics)

  it("a second POST for the same key overwrites the first", async () => {
    const first = JSON.stringify(["Erste Frage"]);
    const second = JSON.stringify(["Zweite Frage", "Dritte Frage"]);

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_starters_de", value: first });

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_starters_de", value: second });

    const getRes = await request(app).get("/api/patient-settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_chatbot_starters_de).toBe(second);
  });

  // 6. Clearing starters → GET returns empty string

  it("returns empty string for sp_chatbot_starters_de after clearing (POST with value '')", async () => {
    const original = JSON.stringify(["Frage auf Deutsch"]);

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_starters_de", value: original });

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_starters_de", value: "" });

    const getRes = await request(app).get("/api/patient-settings");
    expect(getRes.status).toBe(200);
    // Empty string signals "use hardcoded fallback" to the Chatbot component
    expect(getRes.body.sp_chatbot_starters_de).toBe("");
  });
});

describe("chatbot starters — parseStartersFromRaw (mirrors Chatbot.tsx logic)", () => {
  // 7. Valid JSON array → admin values used

  it("returns the parsed array when the raw value is a valid non-empty JSON array", () => {
    const adminQuestions = ["Wie funktioniert Spirecut?", "Wie lange dauert die Heilung?"];
    const raw = JSON.stringify(adminQuestions);
    const result = parseStartersFromRaw(raw, DEFAULT_DE);
    expect(result).toEqual(adminQuestions);
  });

  // 8. Empty string → hardcoded defaults

  it("returns the hardcoded fallback when raw is an empty string", () => {
    const result = parseStartersFromRaw("", DEFAULT_DE);
    expect(result).toEqual(DEFAULT_DE);
  });

  // 9. Invalid JSON → hardcoded defaults

  it("returns the hardcoded fallback when raw is invalid JSON", () => {
    const result = parseStartersFromRaw("not-valid-json", DEFAULT_EN);
    expect(result).toEqual(DEFAULT_EN);
  });

  // 10. Empty array → hardcoded defaults (arr.length > 0 guard)

  it("returns the hardcoded fallback when raw is an empty JSON array", () => {
    const result = parseStartersFromRaw("[]", DEFAULT_DE);
    expect(result).toEqual(DEFAULT_DE);
  });

  // 11. Blank entries are filtered out from the admin values

  it("filters out blank strings from the parsed admin array", () => {
    const raw = JSON.stringify(["Erste Frage", "", "Dritte Frage", ""]);
    const result = parseStartersFromRaw(raw, DEFAULT_DE);
    expect(result).toEqual(["Erste Frage", "Dritte Frage"]);
  });

  // 12. EN starters are applied correctly (language parity check)

  it("applies EN admin starters correctly when raw is a valid EN JSON array", () => {
    const enAdminQuestions = ["What is the procedure?", "How long is recovery?"];
    const raw = JSON.stringify(enAdminQuestions);
    const result = parseStartersFromRaw(raw, DEFAULT_EN);
    expect(result).toEqual(enAdminQuestions);
  });

  // 13. Empty string clears EN starters and falls back to EN defaults

  it("returns EN hardcoded fallback when EN raw is cleared to empty string", () => {
    const result = parseStartersFromRaw("", DEFAULT_EN);
    expect(result).toEqual(DEFAULT_EN);
  });
});
