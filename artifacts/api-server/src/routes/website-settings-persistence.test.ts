/**
 * website-settings-persistence.test.ts — Task #78
 *
 * Verifies that a value saved via POST /api/admin/website-settings is
 * actually persisted so that a subsequent GET /api/website-settings
 * (simulating a cold page load / fresh tab) returns the updated value.
 *
 * The existing auth-bridge tests confirm the POST is authenticated; these
 * tests focus exclusively on the round-trip persistence behaviour.
 *
 * Strategy: the db mock uses a shared in-memory Map so that values written
 * by insert().values().onConflictDoUpdate() are visible to subsequent
 * select().from() calls — exactly as a real database would behave.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Stateful in-memory DB mock ────────────────────────────────────────────────
//
// vi.hoisted() runs before any imports so the mock is in place before
// @workspace/db is resolved.

const { store, mockInsert, mockSelect } = vi.hoisted(() => {
  // Shared key→value store simulating the `settings` table.
  const store = new Map<string, string>();

  // insert(table).values({ key, value }).onConflictDoUpdate(…)
  // We capture the written value in the values() call.
  const mockOnConflictDoUpdate = vi.fn().mockImplementation(() =>
    Promise.resolve(undefined)
  );

  const mockValues = vi.fn().mockImplementation((row: { key: string; value: string }) => {
    store.set(row.key, row.value);
    return { onConflictDoUpdate: mockOnConflictDoUpdate };
  });

  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  // select().from(table) — returns all rows currently in the store.
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
  // Other tables referenced by the broader router
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

// ── Import app AFTER mocks ────────────────────────────────────────────────────
import app from "../app";

// ── Auth helper (mirrors iroc.ts signToken) ───────────────────────────────────

function makeValidJwt(payload: { userId: number; username: string }): string {
  const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const JWT_AUTH = `Bearer ${makeValidJwt({ userId: 1, username: "admin" })}`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("website-settings persistence — cold-load round-trip", () => {
  beforeEach(() => {
    // Reset the in-memory store before each test so tests are independent.
    store.clear();
  });

  // ── Contact fields ──────────────────────────────────────────────────────────

  it("GET /api/website-settings returns the updated ws_contact_phone after a POST", async () => {
    const newPhone = "+49 89 999 000 1";

    // Persist via admin endpoint
    const postRes = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_contact_phone", value: newPhone });

    expect(postRes.status).toBe(200);
    expect(postRes.body).toMatchObject({ ok: true });

    // Cold-load via public endpoint (fresh request — no shared cache state)
    const getRes = await request(app)
      .get("/api/website-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.ws_contact_phone).toBe(newPhone);
  });

  it("GET /api/website-settings returns the updated ws_contact_email after a POST", async () => {
    const newEmail = "kontakt@i-roc.de";

    await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_contact_email", value: newEmail });

    const getRes = await request(app).get("/api/website-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.ws_contact_email).toBe(newEmail);
  });

  it("GET /api/website-settings returns the updated ws_contact_fax after a POST", async () => {
    const newFax = "+49 89 000 111 2";

    await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_contact_fax", value: newFax });

    const getRes = await request(app).get("/api/website-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.ws_contact_fax).toBe(newFax);
  });

  it("persists the invoice PDF email and phone for the next configuration load", async () => {
    const email = "returns@example.com";
    const phone = "+49 89 123 45 67";

    const emailRes = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "invoice_contact_email", value: email });
    const phoneRes = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "invoice_contact_phone", value: phone });

    expect(emailRes.status).toBe(200);
    expect(phoneRes.status).toBe(200);

    const getRes = await request(app).get("/api/website-settings");
    expect(getRes.status).toBe(200);
    expect(getRes.body.invoice_contact_email).toBe(email);
    expect(getRes.body.invoice_contact_phone).toBe(phone);
  });

  it("rejects an invalid invoice PDF contact email without saving it", async () => {
    const postRes = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "invoice_contact_email", value: "not-an-email" });

    expect(postRes.status).toBe(400);
    expect(postRes.body).toMatchObject({ error: "Invalid email" });
    expect(store.has("invoice_contact_email")).toBe(false);
  });

  // ── Address fields ──────────────────────────────────────────────────────────

  it("GET /api/website-settings returns the updated ws_address_street after a POST", async () => {
    const newStreet = "Musterstraße 99";

    await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_address_street", value: newStreet });

    const getRes = await request(app).get("/api/website-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.ws_address_street).toBe(newStreet);
  });

  it("GET /api/website-settings returns the updated ws_address_postal after a POST", async () => {
    const newPostal = "12345";

    await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_address_postal", value: newPostal });

    const getRes = await request(app).get("/api/website-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.ws_address_postal).toBe(newPostal);
  });

  it("GET /api/website-settings returns the updated ws_address_city after a POST", async () => {
    const newCity = "Musterstadt";

    await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_address_city", value: newCity });

    const getRes = await request(app).get("/api/website-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.ws_address_city).toBe(newCity);
  });

  // ── Multi-field: two fields persisted independently ─────────────────────────

  it("persists multiple fields independently and returns all via GET", async () => {
    const newPhone = "+49 89 111 222 3";
    const newStreet = "Testgasse 7";

    await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_contact_phone", value: newPhone });

    await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_address_street", value: newStreet });

    const getRes = await request(app).get("/api/website-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.ws_contact_phone).toBe(newPhone);
    expect(getRes.body.ws_address_street).toBe(newStreet);
  });

  // ── Default fallback when no overrides are stored ───────────────────────────

  it("GET /api/website-settings returns defaults when the store is empty", async () => {
    // store.clear() already called in beforeEach — no POSTs in this test
    const getRes = await request(app).get("/api/website-settings");

    expect(getRes.status).toBe(200);
    // Spot-check a couple of defaults from WS_DEFAULTS
    expect(getRes.body.ws_contact_phone).toBe("+49 89 4625993 70");
    expect(getRes.body.ws_address_city).toBe("Aschheim");
    expect(getRes.body.invoice_contact_email).toBe("info@i-roc.de");
    expect(getRes.body.invoice_contact_phone).toBe("+49 (0)89 600 60 805");
  });

  // ── onConflictDoUpdate: later write wins ────────────────────────────────────

  it("a second POST to the same key overwrites the first (simulates DB upsert)", async () => {
    const firstPhone = "+49 89 111 111 1";
    const secondPhone = "+49 89 222 222 2";

    await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_contact_phone", value: firstPhone });

    await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_contact_phone", value: secondPhone });

    const getRes = await request(app).get("/api/website-settings");

    expect(getRes.status).toBe(200);
    // The second write must win, matching real onConflictDoUpdate semantics
    expect(getRes.body.ws_contact_phone).toBe(secondPhone);
  });

  // ── Rejection: unknown key is never written ─────────────────────────────────

  it("POST with an unknown key returns 400 and does not pollute GET response", async () => {
    const postRes = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_unknown_field", value: "should-not-persist" });

    expect(postRes.status).toBe(400);

    const getRes = await request(app).get("/api/website-settings");
    expect(getRes.status).toBe(200);
    // The unknown key must not appear in the public response
    expect((getRes.body as Record<string, unknown>)["ws_unknown_field"]).toBeUndefined();
  });
});
