/**
 * JWT replay-after-secret-rotation tests
 *
 * Context
 * ───────
 * iROC JWTs are HMAC-SHA256 tokens: `<base64url-payload>.<base64url-sig>`.
 * The signing secret is SESSION_SECRET, captured once at module-load time into
 * the module-level constant SECRET (iroc.ts line ~1132).  There is no expiry
 * field — tokens are valid indefinitely until the secret changes.
 *
 * Revocation mechanism
 * ────────────────────
 * Changing the admin's *password* (ADMIN_PASSWORD) does NOT invalidate
 * outstanding JWTs — the password only governs login.  The ONLY way to
 * revoke all live tokens is to rotate SESSION_SECRET and restart the server,
 * forcing the new value into SECRET.
 *
 * What these tests verify
 * ───────────────────────
 * Each test simulates two server lifecycles:
 *
 *   Epoch 1 — server starts with OLD_SECRET.  Admin logs in; a token is minted.
 *   Epoch 2 — SESSION_SECRET is rotated to NEW_SECRET; server restarts.
 *             The module is re-imported so SECRET re-reads from process.env.
 *
 * The tests confirm that the Epoch-1 token is rejected (null / 401) by the
 * Epoch-2 module, while a freshly minted Epoch-2 token is still accepted.
 *
 * Environment & module isolation
 * ───────────────────────────────
 * vi.resetModules() clears the module-instance cache before each dynamic
 * import so that the module re-reads process.env.SESSION_SECRET from scratch.
 * afterEach() restores the original env value to prevent cross-test bleed.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── All vi.mock() calls are hoisted by Vitest and persist across resetModules ──
// They must appear before any import that transitively loads the mocked modules.

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
          // also allow .where().resolvedValue([]) for other callers
        }),
        orderBy: vi.fn().mockResolvedValue([]),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  },
  irocAppUsers:               { id: "id", username: "username" },
  irocCustomers:              { id: "id" },
  irocProducts:               { id: "id", stockQuantity: "stockQuantity", updatedAt: "updatedAt" },
  irocProductGroups:          { id: "id" },
  irocInventoryLots:          {},
  irocInvoices:               { id: "id" },
  irocInvoiceItems:           { invoiceId: "invoiceId" },
  irocNotifications:          { id: "id", isRead: "isRead", type: "type", createdAt: "createdAt" },
  irocLeads:                  { id: "id", createdAt: "createdAt", updatedAt: "updatedAt" },
  irocOrders:                 { id: "id" },
  websiteCustomersTable:      { id: "id", email: "email" },
  trainingRegistrationsTable: {
    id: "id", salutation: "salutation", medicalDegree: "medicalDegree",
    firstName: "firstName", lastName: "lastName", specialty: "specialty",
    institutionName: "institutionName", address: "address", postalCode: "postalCode",
    city: "city", country: "country", phone: "phone", fax: "fax", email: "email",
    instrument: "instrument", trainingDateId: "trainingDateId",
    trainingDateInfo: "trainingDateInfo", websiteUrl: "websiteUrl", notes: "notes",
    privacyConsent: "privacyConsent", certifiedDoctorId: "certifiedDoctorId",
    status: "status", confirmedAt: "confirmedAt", createdAt: "createdAt",
  },
  trainedDoctorsTable:       { id: "id", email: "email" },
  doctorCertificationsTable: { id: "id", doctorId: "doctorId" },
  resourcesTable:            { id: "id" },
  settingsTable:             { key: "key" },
  datevExports:              { id: "id", status: "status" },
  datevExportItems:          { exportId: "exportId", invoiceId: "invoiceId" },
}));

vi.mock("@workspace/integrations-gemini-ai/image", () => ({
  ai: { models: { generateContent: vi.fn() } },
}));

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: class {
    getObjectEntityFile                = vi.fn();
    getObjectEntityUploadURLWithSubdir = vi.fn();
    normalizeObjectEntityPath          = vi.fn();
    downloadObject                     = vi.fn();
  },
  ObjectNotFoundError: class extends Error {},
}));

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

// ── Restore env after each test so secrets don't bleed across tests ────────────

const ORIGINAL_SESSION_SECRET = process.env.SESSION_SECRET;

afterEach(() => {
  process.env.SESSION_SECRET = ORIGINAL_SESSION_SECRET;
  vi.resetModules(); // clear module cache so the next test re-reads env cleanly
});

// ── Signing helper — mirrors iroc.ts logic (base64url-payload.base64url-sig) ──

function mintToken(secret: string, payload: { userId: number; username: string; exp?: number } = { userId: 1, username: "admin" }): string {
  const exp = payload.exp ?? Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const full = { ...payload, exp };
  const data = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig  = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Unit tests — verifyToken() re-imported after SECRET rotation
//
// Simulates:
//   Epoch 1 — module loaded with OLD_SECRET; token minted.
//   Epoch 2 — SESSION_SECRET rotated to NEW_SECRET; module re-imported.
//             Pre-rotation token must be rejected; post-rotation token must pass.
// ═════════════════════════════════════════════════════════════════════════════

describe("verifyToken() — rejects pre-rotation token after SESSION_SECRET is rotated", () => {

  it("returns null for a token minted with the old secret once the module reloads with the new secret", async () => {
    const OLD_SECRET = "epoch-1-secret-unit-test";
    const NEW_SECRET = "epoch-2-secret-unit-test";

    // ── Epoch 1: load module with OLD_SECRET ──────────────────────────────
    process.env.SESSION_SECRET = OLD_SECRET;
    vi.resetModules();
    const { verifyToken: verifyEpoch1 } = await import("./iroc");

    const preRotationToken = mintToken(OLD_SECRET);

    // Token is valid while the old secret is still active.
    expect(verifyEpoch1(preRotationToken)).not.toBeNull();

    // ── Epoch 2: rotate secret and reload module ───────────────────────────
    process.env.SESSION_SECRET = NEW_SECRET;
    vi.resetModules();
    const { verifyToken: verifyEpoch2 } = await import("./iroc");

    // Pre-rotation token must be rejected — HMAC no longer matches.
    expect(verifyEpoch2(preRotationToken)).toBeNull();
  });

  it("accepts a post-rotation token minted with the new secret", async () => {
    const OLD_SECRET = "epoch-1-secret-accept-test";
    const NEW_SECRET = "epoch-2-secret-accept-test";

    // Rotate to NEW_SECRET and reload.
    process.env.SESSION_SECRET = NEW_SECRET;
    vi.resetModules();
    const { verifyToken: verifyEpoch2 } = await import("./iroc");

    // A token signed with OLD_SECRET (pre-rotation) is rejected.
    const preRotationToken  = mintToken(OLD_SECRET);
    expect(verifyEpoch2(preRotationToken)).toBeNull();

    // A token signed with NEW_SECRET (post-rotation) is accepted.
    const postRotationToken = mintToken(NEW_SECRET);
    const result = verifyEpoch2(postRotationToken);
    expect(result).not.toBeNull();
    expect(result?.username).toBe("admin");
  });

  it("returns null for a completely malformed token regardless of secret", async () => {
    process.env.SESSION_SECRET = "any-secret";
    vi.resetModules();
    const { verifyToken } = await import("./iroc");
    expect(verifyToken("not-a-valid-token")).toBeNull();
    expect(verifyToken("")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. HTTP integration tests — requireIrocAuth middleware
//
// The same rotation boundary, exercised end-to-end through the Express router.
// Representative endpoint: GET /api/iroc/me (always protected by requireIrocAuth).
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/iroc/me — pre-rotation token rejected at HTTP layer after secret rotation", () => {

  it("returns 401 when the request carries a token minted before the secret was rotated", async () => {
    const OLD_SECRET = "epoch-1-secret-http-test";
    const NEW_SECRET = "epoch-2-secret-http-test";

    // Mint the pre-rotation token (signed under OLD_SECRET).
    const preRotationToken = mintToken(OLD_SECRET);

    // Simulate server restart with the new secret: reload app with NEW_SECRET.
    process.env.SESSION_SECRET = NEW_SECRET;
    vi.resetModules();
    const { default: app } = await import("../app");

    const res = await request(app)
      .get("/api/iroc/me")
      .set("Authorization", `Bearer ${preRotationToken}`);

    expect(res.status).toBe(401);
  });

  it("accepts a token minted after the secret was rotated (baseline — 200, not 401)", async () => {
    const NEW_SECRET = "epoch-2-secret-http-baseline";

    // Load app with NEW_SECRET.
    process.env.SESSION_SECRET = NEW_SECRET;
    vi.resetModules();
    const { default: app } = await import("../app");

    // Mint a post-rotation token.
    const postRotationToken = mintToken(NEW_SECRET);

    const res = await request(app)
      .get("/api/iroc/me")
      .set("Authorization", `Bearer ${postRotationToken}`);

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  it("returns 401 when no Authorization header is present", async () => {
    process.env.SESSION_SECRET = "any-secret-no-header-test";
    vi.resetModules();
    const { default: app } = await import("../app");

    const res = await request(app).get("/api/iroc/me");
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Documentation test — password change does NOT revoke JWTs
//
// Changing ADMIN_PASSWORD updates the password hash in the DB but does NOT
// change SESSION_SECRET.  Outstanding tokens remain valid until the secret is
// rotated.  This test asserts that property explicitly.
// ═════════════════════════════════════════════════════════════════════════════

describe("Password change vs. secret rotation — revocation-mechanism documentation", () => {

  it("a token issued before a password change is still accepted by verifyToken (password ≠ secret)", async () => {
    const SECRET = "stable-secret-password-change-test";

    // Epoch 1: admin logs in → token minted.
    process.env.SESSION_SECRET = SECRET;
    vi.resetModules();
    const { verifyToken: verifyBefore } = await import("./iroc");
    const tokenBeforePasswordChange = mintToken(SECRET);
    expect(verifyBefore(tokenBeforePasswordChange)).not.toBeNull();

    // Admin changes their password — SESSION_SECRET is NOT changed.
    // Simulate "server restart after password change" by reloading the module
    // with the SAME secret (no rotation occurred).
    vi.resetModules();
    process.env.SESSION_SECRET = SECRET; // unchanged
    const { verifyToken: verifyAfter } = await import("./iroc");

    // The pre-password-change token must still be valid because the secret
    // never changed.  Password change alone is not a revocation mechanism.
    const result = verifyAfter(tokenBeforePasswordChange);
    expect(result).not.toBeNull();
    expect(result?.username).toBe("admin");
  });
});
