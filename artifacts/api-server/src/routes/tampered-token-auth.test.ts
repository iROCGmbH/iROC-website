/**
 * Integration tests: tampered-token rejection across admin router groups
 *
 * What & Why
 * ──────────
 * Task #638 verified that DELETE /api/admin/expenses/file rejects wrong-secret
 * and malformed tokens with 401.  These tests extend that coverage to the three
 * remaining admin router groups so that no admin surface can be bypassed by a
 * crafted iROC JWT:
 *
 *   Group A — iROC admin (requireIrocAuth in iroc.ts)
 *             Representative: GET /iroc/me
 *
 *   Group B — Training admin (requireAdmin in admin.ts)
 *             Representative: GET /admin/training-registrations
 *
 *   Group C — Doctor / Resource admin (requireAdmin in admin.ts)
 *             Representative: POST /admin/resources
 *
 * For each group we send:
 *   1. A structurally valid JWT signed with the wrong secret  → 401
 *   2. A completely malformed / random-string token           → 401
 */

import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── DB mock ───────────────────────────────────────────────────────────────────
// Must be hoisted before any route module is imported.

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  db: {
    select:      vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockResolvedValue([]),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert:      vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    update:      vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    delete:      vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    execute:     vi.fn().mockResolvedValue(undefined),
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
  trainedDoctorsTable:        { id: "id", email: "email" },
  doctorCertificationsTable:  { id: "id", doctorId: "doctorId" },
  resourcesTable:             { id: "id" },
  settingsTable:              { key: "key" },
  datevExports:               { id: "id", status: "status" },
  datevExportItems:           { exportId: "exportId", invoiceId: "invoiceId" },
}));

// ── Mock transitively imported modules not under test ─────────────────────────

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

// ── Import app AFTER mocks ────────────────────────────────────────────────────

import app from "../app";

// ── Token helpers ─────────────────────────────────────────────────────────────

const CORRECT_SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
const WRONG_SECRET   = "totally-wrong-secret-that-will-never-match";

/**
 * Build a JWT whose payload is valid but whose signature uses the wrong secret.
 * The token has the correct data.sig structure so the format check passes;
 * only the HMAC verification should reject it.
 */
function makeWrongSecretToken(): string {
  const payload = { userId: 1, username: "admin" };
  const data    = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig     = crypto.createHmac("sha256", WRONG_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** Sanity check: produce a token with the correct secret (must NOT return 401). */
function makeValidToken(): string {
  const exp     = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data    = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig     = crypto.createHmac("sha256", CORRECT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const WRONG_SECRET_BEARER = `Bearer ${makeWrongSecretToken()}`;
const MALFORMED_BEARER    = "Bearer this-is-not-a-valid-token-at-all";
const VALID_BEARER        = `Bearer ${makeValidToken()}`;

// ═════════════════════════════════════════════════════════════════════════════
// Group A — iROC admin (requireIrocAuth)
// Representative endpoint: GET /iroc/me
// ═════════════════════════════════════════════════════════════════════════════

describe("iROC admin endpoints (requireIrocAuth) — tampered JWT rejected", () => {

  it("returns 401 when the JWT is signed with the wrong secret", async () => {
    const res = await request(app)
      .get("/api/iroc/me")
      .set("Authorization", WRONG_SECRET_BEARER);

    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is a random malformed string", async () => {
    const res = await request(app)
      .get("/api/iroc/me")
      .set("Authorization", MALFORMED_BEARER);

    expect(res.status).toBe(401);
  });

  it("returns 401 when the Authorization header is absent", async () => {
    const res = await request(app).get("/api/iroc/me");

    expect(res.status).toBe(401);
  });

  // Baseline: a correctly signed token must NOT be rejected.
  it("accepts a correctly signed JWT (returns 200, not 401)", async () => {
    const res = await request(app)
      .get("/api/iroc/me")
      .set("Authorization", VALID_BEARER);

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Group B — Training admin (requireAdmin in admin.ts)
// Representative endpoint: GET /admin/training-registrations
// ═════════════════════════════════════════════════════════════════════════════

describe("Training admin endpoints (requireAdmin) — tampered JWT rejected", () => {

  it("returns 401 when the JWT is signed with the wrong secret", async () => {
    const res = await request(app)
      .get("/api/admin/training-registrations")
      .set("Authorization", WRONG_SECRET_BEARER);

    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is a random malformed string", async () => {
    const res = await request(app)
      .get("/api/admin/training-registrations")
      .set("Authorization", MALFORMED_BEARER);

    expect(res.status).toBe(401);
  });

  it("returns 401 when the Authorization header is absent", async () => {
    const res = await request(app).get("/api/admin/training-registrations");

    expect(res.status).toBe(401);
  });

  // Baseline: a correctly signed iROC JWT must be accepted by requireAdmin.
  it("accepts a correctly signed iROC JWT (returns 200, not 401)", async () => {
    const res = await request(app)
      .get("/api/admin/training-registrations")
      .set("Authorization", VALID_BEARER);

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Group C — Doctor / Resource admin (requireAdmin in admin.ts)
// Two representative endpoints: POST /admin/doctors  and  POST /admin/resources
// ═════════════════════════════════════════════════════════════════════════════

describe("Doctor admin endpoints (requireAdmin) — tampered JWT rejected", () => {

  it("returns 401 on POST /admin/doctors when the JWT is signed with the wrong secret", async () => {
    const res = await request(app)
      .post("/api/admin/doctors")
      .set("Authorization", WRONG_SECRET_BEARER)
      .send({ firstName: "Test", lastName: "Doctor", certifications: [] });

    expect(res.status).toBe(401);
  });

  it("returns 401 on POST /admin/doctors when the token is a random malformed string", async () => {
    const res = await request(app)
      .post("/api/admin/doctors")
      .set("Authorization", MALFORMED_BEARER)
      .send({ firstName: "Test", lastName: "Doctor", certifications: [] });

    expect(res.status).toBe(401);
  });

  it("returns 401 on POST /admin/doctors when the Authorization header is absent", async () => {
    const res = await request(app)
      .post("/api/admin/doctors")
      .send({ firstName: "Test", lastName: "Doctor", certifications: [] });

    expect(res.status).toBe(401);
  });
});

describe("Resource admin endpoints (requireAdmin) — tampered JWT rejected", () => {

  it("returns 401 on POST /admin/resources when the JWT is signed with the wrong secret", async () => {
    const res = await request(app)
      .post("/api/admin/resources")
      .set("Authorization", WRONG_SECRET_BEARER)
      .send({ title: "Test", type: "pdf", instrument: "spirecut", url: "https://example.com/r.pdf" });

    expect(res.status).toBe(401);
  });

  it("returns 401 on POST /admin/resources when the token is a random malformed string", async () => {
    const res = await request(app)
      .post("/api/admin/resources")
      .set("Authorization", MALFORMED_BEARER)
      .send({ title: "Test", type: "pdf", instrument: "spirecut", url: "https://example.com/r.pdf" });

    expect(res.status).toBe(401);
  });

  it("returns 401 on POST /admin/resources when the Authorization header is absent", async () => {
    const res = await request(app)
      .post("/api/admin/resources")
      .send({ title: "Test", type: "pdf", instrument: "spirecut", url: "https://example.com/r.pdf" });

    expect(res.status).toBe(401);
  });

  // Baseline: a correctly signed iROC JWT must be accepted by requireAdmin
  // (resource insert mock returns empty → 201 path; we only assert ≠ 401).
  it("accepts a correctly signed iROC JWT on POST /admin/resources (returns 201, not 401)", async () => {
    const res = await request(app)
      .post("/api/admin/resources")
      .set("Authorization", VALID_BEARER)
      .send({ title: "Test Resource", type: "pdf", instrument: "spirecut", url: "https://example.com/r.pdf" });

    expect(res.status).not.toBe(401);
  });
});
