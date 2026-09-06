/**
 * Integration tests: POST /api/iroc/login — brute-force / lockout behaviour
 *
 * What & Why
 * ──────────
 * The login endpoint is the front door for the iROC admin app.  These tests
 * document and confirm its current behaviour under repeated wrong-password
 * attempts so that future changes cannot silently regress it.
 *
 * Current design decision: NO lockout
 * ─────────────────────────────────────
 * The endpoint has no in-process rate-limiting or account-lockout logic.
 * Brute-force protection is instead expected at the infrastructure layer
 * (reverse-proxy / Replit edge rate-limiting) rather than inside the
 * application server.  Implementing app-level lockout would require either
 * a shared cache (Redis/Postgres) — which adds latency to every login — or
 * in-process state that resets on each restart.  Given the single-admin
 * model and infrastructure-layer protection, the design intentionally omits
 * app-level lockout.
 *
 * What these tests confirm:
 *  1. A single wrong-password attempt returns 401 with "Invalid credentials".
 *  2. Ten consecutive wrong-password attempts all return 401 (no lockout/429).
 *  3. A correct-password attempt always succeeds, even after many wrong ones.
 *  4. A missing or invalid body returns 400.
 *  5. Non-existent username returns 401 (no user enumeration difference).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Pre-compute a real scrypt hash so verifyPassword works without mocking ─────
// Using a fixed salt makes the hash deterministic across test runs.

const CORRECT_PASSWORD = "correct-horse-battery-staple";
const SALT             = "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8"; // 32 hex = 16 bytes
const HASH             = crypto.scryptSync(CORRECT_PASSWORD, SALT, 32).toString("hex");
const PASSWORD_HASH    = `${SALT}:${HASH}`;

const MOCK_USER = {
  id:           1,
  username:     "admin",
  passwordHash: PASSWORD_HASH,
  createdAt:    new Date().toISOString(),
};

// ── Hoist mock state so vi.mock() factories can close over it ─────────────────

const { mockDbSelect, mockDbInsert, mockDbUpdate } = vi.hoisted(() => {
  const mockDbSelect = vi.fn();
  const mockDbInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
  });
  const mockDbUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  });
  return { mockDbSelect, mockDbInsert, mockDbUpdate };
});

// ── Mock: AI model (transitively imported; not exercised here) ────────────────

vi.mock("@workspace/integrations-gemini-ai/image", () => ({
  ai: { models: { generateContent: vi.fn() } },
}));

// ── Mock: object storage (transitively imported) ──────────────────────────────

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: class {
    getObjectEntityFile                = vi.fn();
    getObjectEntityUploadURLWithSubdir = vi.fn();
    normalizeObjectEntityPath          = vi.fn();
    downloadObject                     = vi.fn();
  },
  ObjectNotFoundError: class extends Error {
    constructor(msg = "not found") { super(msg); this.name = "ObjectNotFoundError"; }
  },
}));

// ── Mock: @workspace/db ───────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  db: {
    select:      mockDbSelect,
    insert:      mockDbInsert,
    update:      mockDbUpdate,
    delete:      vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    execute:     vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  },
  irocAppUsers:               { username: "username", passwordHash: "passwordHash" },
  irocInvoices:               { id: "id" },
  irocInvoiceItems:           { invoiceId: "invoiceId" },
  irocCustomers:              { id: "id" },
  websiteCustomersTable:      { id: "id" },
  settingsTable:              { key: "key" },
  datevExports:               { id: "id", status: "status" },
  datevExportItems:           { exportId: "exportId", invoiceId: "invoiceId" },
  irocNotifications:          {},
  irocProducts:               { id: "id", stockQuantity: "stockQuantity", updatedAt: "updatedAt" },
  irocInventoryLots:          {},
  irocProductGroups:          {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable:        {},
  doctorCertificationsTable:  {},
  irocLeads:                  {},
  irocOrders:                 {},
}));

// ── Mock: pdfkit (transitively imported; not exercised here) ─────────────────

vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");
  class MockPDF extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;
    font()           { return this; }
    fontSize()       { return this; }
    fillColor()      { return this; }
    strokeColor()    { return this; }
    lineWidth()      { return this; }
    save()           { return this; }
    restore()        { return this; }
    addPage()        { return this; }
    image()          { return this; }
    moveTo()         { return this; }
    lineTo()         { return this; }
    rect()           { return this; }
    clip()           { return this; }
    stroke()         { return this; }
    fill()           { return this; }
    text()           { return this; }
    heightOfString() { return 10; }
    end(cb?: () => void) { super.end(cb); return this; }
  }
  return { default: MockPDF };
});

// ── Import app AFTER mocks ────────────────────────────────────────────────────

import app from "../app";

// ── Drizzle select chain helper ───────────────────────────────────────────────

/**
 * Builds a Drizzle-like select chain object: { from: fn → { where: fn → thenable+limit } }
 *
 * Returns the chain object directly (not wrapped in another vi.fn()) so callers
 * can pass it to mockReturnValue / mockReturnValueOnce without TypeScript
 * complaining that a Mock is not directly callable.
 *
 * The login handler awaits .where() directly (no .limit());
 * ensureAdminUser calls .where().limit(1).
 * We attach .limit() onto a real Promise so both consumption patterns work.
 */
function makeSelectChain(rows: unknown[]): { from: ReturnType<typeof vi.fn> } {
  const limitFn     = vi.fn().mockResolvedValue(rows);
  // A real Promise with .limit() attached — supports both direct await and .limit() call.
  const whereResult = Object.assign(Promise.resolve(rows), { limit: limitFn });
  const whereFn     = vi.fn().mockReturnValue(whereResult);
  const fromFn      = vi.fn().mockReturnValue({ where: whereFn });
  return { from: fromFn };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/iroc/login — brute-force / lockout behaviour", () => {

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: ensureAdminUser + login query both return the mock admin user.
    // ensureAdminUser calls select().from().where().limit(1); the login handler
    // awaits where() directly.  makeSelectChain returns a function that, when
    // called as db.select(), yields the correct chain for both callers.
    mockDbSelect.mockReturnValue(makeSelectChain([MOCK_USER]));
  });

  // ── 1. Single wrong password returns 401 ──────────────────────────────────
  it("returns 401 for a single wrong-password attempt", async () => {
    const res = await request(app)
      .post("/api/iroc/login")
      .send({ username: "admin", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toMatch(/invalid credentials/i);
  });

  // ── 2. No lockout after repeated wrong-password attempts ──────────────────
  //
  // DESIGN DECISION DOCUMENTED HERE:
  // The endpoint intentionally has no app-level lockout.  All 10 attempts
  // must return 401 (not 429, not a lockout-specific message).  Infrastructure-
  // layer rate-limiting (reverse proxy / edge) is the chosen defence mechanism.
  it("returns 401 for every one of 10 consecutive wrong-password attempts (no lockout)", async () => {
    const ATTEMPTS = 10;

    for (let i = 0; i < ATTEMPTS; i++) {
      const res = await request(app)
        .post("/api/iroc/login")
        .send({ username: "admin", password: `wrong-attempt-${i}` });

      expect(res.status, `Expected 401 on attempt ${i + 1}, got ${res.status}`).toBe(401);
      expect((res.body as { error: string }).error).toMatch(/invalid credentials/i);
    }
  });

  // ── 3. Correct credentials always succeed, even after many wrong attempts ─
  it("returns 200 with a token when correct credentials are used after wrong attempts", async () => {
    // Send five wrong attempts first.
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/iroc/login")
        .send({ username: "admin", password: "bad-password" });
    }

    // Correct credentials must still work — no lockout applied.
    const res = await request(app)
      .post("/api/iroc/login")
      .send({ username: "admin", password: CORRECT_PASSWORD });

    expect(res.status).toBe(200);
    const body = res.body as { token?: string; username?: string };
    expect(typeof body.token).toBe("string");
    expect(body.token!.length).toBeGreaterThan(0);
    expect(body.username).toBe("admin");
  });

  // ── 4. Non-existent username also returns 401 (no user enumeration) ───────
  it("returns 401 for a username that does not exist in the DB", async () => {
    // Override: select returns empty array (no such user).
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const res = await request(app)
      .post("/api/iroc/login")
      .send({ username: "nonexistent", password: "any-password" });

    expect(res.status).toBe(401);
    // The error message must be identical to the wrong-password case so
    // attackers cannot distinguish a valid username from an invalid one.
    expect((res.body as { error: string }).error).toMatch(/invalid credentials/i);
  });

  // ── 5. Missing username / password returns 400 ───────────────────────────
  it("returns 400 when the request body is empty", async () => {
    const res = await request(app)
      .post("/api/iroc/login")
      .send({});

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/invalid login data/i);
  });

  it("returns 400 when password is missing", async () => {
    const res = await request(app)
      .post("/api/iroc/login")
      .send({ username: "admin" });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/invalid login data/i);
  });

  it("returns 400 when username is missing", async () => {
    const res = await request(app)
      .post("/api/iroc/login")
      .send({ password: "some-password" });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/invalid login data/i);
  });

  // ── 6. DB error returns 500 ───────────────────────────────────────────────
  //
  // ensureAdminUser() is called first and uses .where().limit(1) — it must
  // succeed so the error originates from the login handler's own query
  // (which awaits .where() directly, without .limit()).
  // We use mockImplementationOnce so the first db.select() call (ensureAdminUser)
  // gets the success chain and the second call (login query) gets a rejecting one.
  it("returns 500 when the login database query throws", async () => {
    // Call 1: ensureAdminUser — returns MOCK_USER so it skips insert/update.
    mockDbSelect.mockReturnValueOnce(makeSelectChain([MOCK_USER]));

    // Call 2: login handler — .where() rejects immediately (no .limit() called).
    const dbError = new Error("DB connection refused");
    const rejectingWhereResult = Object.assign(Promise.reject(dbError), {
      limit: vi.fn().mockRejectedValue(dbError),
    });
    // Suppress the unhandled-rejection warning on the promise itself.
    rejectingWhereResult.catch(() => undefined);
    mockDbSelect.mockImplementationOnce(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(rejectingWhereResult),
      }),
    }));

    const res = await request(app)
      .post("/api/iroc/login")
      .send({ username: "admin", password: "any-password" });

    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toMatch(/login failed/i);
  });

});
