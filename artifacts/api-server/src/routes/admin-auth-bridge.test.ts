/**
 * Admin auth bridge tests — Task #41
 *
 * Verifies that a logged-in iROC app user (holding a valid iROC JWT) can
 * successfully POST to:
 *   POST /api/admin/website-settings
 *   POST /api/admin/spirecut-settings
 *
 * A 401 from either endpoint while the caller holds a valid iROC JWT is a
 * failing test.  The tests also confirm that requireAdmin still rejects
 * missing/invalid tokens so the auth guard remains effective.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { verifyToken } from "./iroc.js";
import { encryptMicrosoftToken } from "../lib/microsoft-365.js";

// ── Hoist DB mocks before any imports touch @workspace/db ────────────────────

const { mockInsert, mockOnConflict, mockPoolQuery, mockSendEmailConfigurationTest } = vi.hoisted(() => {
  const mockOnConflict = vi.fn().mockResolvedValue(undefined);
  const mockSendEmailConfigurationTest = vi.fn().mockResolvedValue({ messageId: undefined });

  const mockValues = vi.fn().mockImplementation(() => ({
    onConflictDoUpdate: mockOnConflict,
    onConflictDoNothing: mockOnConflict,
  }));

  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
  const mockPoolQuery = vi.fn();

  return { mockInsert, mockOnConflict, mockPoolQuery, mockSendEmailConfigurationTest };
});

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery },
  db: {
    insert: mockInsert,
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockResolvedValue([]),
      }),
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

vi.mock("../lib/email.js", () => ({
  sendEmail: vi.fn(),
  sendEmailConfigurationTest: mockSendEmailConfigurationTest,
}));

// ── Import app AFTER mocks ───────────────────────────────────────────────────
import app from "../app";

// ── Token helpers (mirrors iroc.ts signToken) ────────────────────────────────

/**
 * Generate a valid iROC JWT using the same algorithm as iroc.ts signToken().
 * In tests, SESSION_SECRET is not set, so both sides fall back to the same
 * compile-time constant "iroc-fallback-secret".
 *
 * @param payload  userId + username (required)
 * @param exp      Unix timestamp (seconds). Defaults to 8 hours from now.
 *                 Pass a value in the past to produce an already-expired token.
 */
function makeValidJwt(
  payload: { userId: number; username: string },
  exp?: number,
): string {
  const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
  const resolvedExp = exp ?? Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const full = { ...payload, exp: resolvedExp };
  const data = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/**
 * Generate a token WITHOUT an exp field (simulates a legacy / pre-expiry token).
 * These should now be rejected by verifyToken.
 */
function makeTokenWithoutExp(payload: { userId: number; username: string }): string {
  const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** A valid JWT for a fictional iROC admin user (expires 8 h from now). */
const VALID_JWT = makeValidJwt({ userId: 1, username: "admin" });

/** Bearer header carrying a valid iROC JWT. */
const JWT_AUTH = `Bearer ${VALID_JWT}`;

/** Bearer header with the raw ADMIN_PASSWORD (used for one baseline check). */
const PASSWORD_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? "iroc-admin-2024"}`;

// ═══════════════════════════════════════════════════════════════════════════════
// requireAdmin — iROC JWT acceptance
// ═══════════════════════════════════════════════════════════════════════════════

describe("requireAdmin — iROC JWT accepted on /api/admin/website-settings", () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockImplementation(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    });
  });

  it("returns 200 (not 401) when Authorization carries a valid iROC JWT", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "ws_contact_email", value: "test@i-roc.de" });

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .send({ key: "ws_contact_email", value: "test@i-roc.de" });

    expect(res.status).toBe(401);
  });

  it("returns 401 when token signature is tampered", async () => {
    const tamperedToken = `${VALID_JWT.split(".")[0]}.invalidsignature`;
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", `Bearer ${tamperedToken}`)
      .send({ key: "ws_contact_email", value: "test@i-roc.de" });

    expect(res.status).toBe(401);
  });

  it("returns 401 when token is an arbitrary non-JWT string", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", "Bearer not-a-real-token")
      .send({ key: "ws_contact_email", value: "test@i-roc.de" });

    expect(res.status).toBe(401);
  });

  it("still accepts the raw ADMIN_PASSWORD bearer token", async () => {
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", PASSWORD_AUTH)
      .send({ key: "ws_contact_email", value: "test@i-roc.de" });

    // Should be 200 (password path works) or 401 only if env var differs;
    // we just confirm the JWT path is not the *only* path.
    // In CI the env var may differ, so we assert ≠ 401 only for JWT tests.
    expect([200, 400]).toContain(res.status); // 400 = wrong key if env mismatch; never 401 for valid pw
  });

  it("returns 401 when the JWT exp is in the past (expired token)", async () => {
    const expiredJwt = makeValidJwt(
      { userId: 1, username: "admin" },
      Math.floor(Date.now() / 1000) - 1, // 1 second ago
    );
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", `Bearer ${expiredJwt}`)
      .send({ key: "ws_contact_email", value: "test@i-roc.de" });

    expect(res.status).toBe(401);
  });

  it("returns 401 when the JWT exp equals the current second (boundary: >= check)", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const boundaryJwt = makeValidJwt({ userId: 1, username: "admin" }, nowSec);
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", `Bearer ${boundaryJwt}`)
      .send({ key: "ws_contact_email", value: "test@i-roc.de" });

    expect(res.status).toBe(401);
  });

  it("returns 401 when the JWT has no exp claim (legacy token)", async () => {
    const legacyJwt = makeTokenWithoutExp({ userId: 1, username: "admin" });
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", `Bearer ${legacyJwt}`)
      .send({ key: "ws_contact_email", value: "test@i-roc.de" });

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// requireAdmin — iROC JWT accepted on /api/admin/spirecut-settings
// ═══════════════════════════════════════════════════════════════════════════════

describe("requireAdmin — iROC JWT accepted on /api/admin/spirecut-settings", () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockImplementation(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    });
  });

  it("returns 200 (not 401) when Authorization carries a valid iROC JWT", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_ct_url", value: "https://www.youtube.com/embed/test" });

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .send({ key: "sp_video_ct_url", value: "https://www.youtube.com/embed/test" });

    expect(res.status).toBe(401);
  });

  it("returns 401 when token signature is tampered", async () => {
    const tamperedToken = `${VALID_JWT.split(".")[0]}.badsig`;
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", `Bearer ${tamperedToken}`)
      .send({ key: "sp_video_ct_url", value: "https://www.youtube.com/embed/test" });

    expect(res.status).toBe(401);
  });

  it("returns 401 when token is completely wrong", async () => {
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", "Bearer garbage")
      .send({ key: "sp_video_ct_url", value: "https://www.youtube.com/embed/test" });

    expect(res.status).toBe(401);
  });

  it("returns 401 when the JWT exp is in the past (expired token)", async () => {
    const expiredJwt = makeValidJwt(
      { userId: 1, username: "admin" },
      Math.floor(Date.now() / 1000) - 1, // 1 second ago
    );
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", `Bearer ${expiredJwt}`)
      .send({ key: "sp_video_ct_url", value: "https://www.youtube.com/embed/test" });

    expect(res.status).toBe(401);
  });

  it("returns 401 when the JWT exp equals the current second (boundary: >= check)", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const boundaryJwt = makeValidJwt({ userId: 1, username: "admin" }, nowSec);
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", `Bearer ${boundaryJwt}`)
      .send({ key: "sp_video_ct_url", value: "https://www.youtube.com/embed/test" });

    expect(res.status).toBe(401);
  });

  it("returns 401 when the JWT has no exp claim (legacy token)", async () => {
    const legacyJwt = makeTokenWithoutExp({ userId: 1, username: "admin" });
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", `Bearer ${legacyJwt}`)
      .send({ key: "sp_video_ct_url", value: "https://www.youtube.com/embed/test" });

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// End-to-end flow: login → use JWT on both settings endpoints
// ═══════════════════════════════════════════════════════════════════════════════

describe("End-to-end: JWT from login accepted on both settings endpoints", () => {
  /**
   * Simulates what the iROC app does:
   * 1. The user logs in and receives a JWT.
   * 2. That JWT is used (via adminPost) to save a website setting.
   * 3. The same JWT is used to save a Spirecut setting.
   * Both saves must succeed (status 200), not 401.
   */

  beforeEach(() => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockImplementation(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    });
  });

  it("accepts the JWT on /api/admin/website-settings with a valid ws_* key", async () => {
    const jwt = makeValidJwt({ userId: 42, username: "iroc_user" });
    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", `Bearer ${jwt}`)
      .send({ key: "ws_contact_phone", value: "+49 89 0000 0000" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("accepts the JWT on /api/admin/spirecut-settings with a valid sp_* key", async () => {
    const jwt = makeValidJwt({ userId: 42, username: "iroc_user" });
    const res = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", `Bearer ${jwt}`)
      .send({ key: "sp_contact_email_de", value: "info@spirecut.de" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it("rejects invalid keys even with a valid JWT (400, not 401)", async () => {
    const jwt = makeValidJwt({ userId: 1, username: "admin" });

    const wsRes = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", `Bearer ${jwt}`)
      .send({ key: "not_a_real_key", value: "bad" });
    expect(wsRes.status).toBe(400);
    expect(wsRes.status).not.toBe(401);

    const spRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", `Bearer ${jwt}`)
      .send({ key: "not_a_real_key", value: "bad" });
    expect(spRes.status).toBe(400);
    expect(spRes.status).not.toBe(401);
  });

  it("a JWT signed with the wrong secret is rejected (401)", async () => {
    const badSecret = "wrong-secret";
    const data = Buffer.from(JSON.stringify({ userId: 1, username: "admin" })).toString("base64url");
    const sig = crypto.createHmac("sha256", badSecret).update(data).digest("base64url");
    const badToken = `${data}.${sig}`;

    const res = await request(app)
      .post("/api/admin/website-settings")
      .set("Authorization", `Bearer ${badToken}`)
      .send({ key: "ws_contact_email", value: "x@example.com" });

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/training-dates — JWT acceptance
// ═══════════════════════════════════════════════════════════════════════════════

describe("requireAdmin — iROC JWT accepted on POST /api/admin/training-dates", () => {
  const VALID_BODY = {
    instrument: "spirecut",
    date: "2026-10-01",
    location: "Berlin",
    maxParticipants: 10,
  };

  beforeEach(() => {
    const mockReturning = vi.fn().mockResolvedValue([{
      id: 1,
      instrument: "spirecut",
      date: "2026-10-01",
      time: null,
      location: "Berlin",
      locationDetail: null,
      maxParticipants: 10,
      notes: null,
      isActive: true,
    }]);
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: mockReturning }),
    });
  });

  it("returns non-401 when Authorization carries a valid iROC JWT", async () => {
    const res = await request(app)
      .post("/api/admin/training-dates")
      .set("Authorization", JWT_AUTH)
      .send(VALID_BODY);

    expect(res.status).not.toBe(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/admin/training-dates")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });

  it("returns 401 when token signature is invalid", async () => {
    const res = await request(app)
      .post("/api/admin/training-dates")
      .set("Authorization", `Bearer ${VALID_JWT.split(".")[0]}.badsig`)
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/doctors — JWT acceptance
// ═══════════════════════════════════════════════════════════════════════════════

describe("requireAdmin — iROC JWT accepted on POST /api/admin/doctors", () => {
  const VALID_BODY = {
    firstName: "Max",
    lastName: "Mustermann",
    city: "Berlin",
    country: "Deutschland",
    certifications: [{ instrument: "spirecut", certifiedDate: "2026-01-01" }],
  };

  beforeEach(() => {
    let callCount = 0;
    const doctorRow = {
      id: 1,
      title: null,
      firstName: "Max",
      lastName: "Mustermann",
      specialty: null,
      institutionName: null,
      city: "Berlin",
      postalCode: null,
      country: "Deutschland",
      email: null,
      websiteUrl: null,
    };
    const certRow = { instrument: "spirecut", certifiedDate: "2026-01-01", doctorId: 1 };

    mockInsert.mockImplementation(() => {
      callCount++;
      const rowToReturn = callCount === 1 ? [doctorRow] : [certRow];
      return {
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(rowToReturn) }),
      };
    });
  });

  it("returns non-401 when Authorization carries a valid iROC JWT", async () => {
    const res = await request(app)
      .post("/api/admin/doctors")
      .set("Authorization", JWT_AUTH)
      .send(VALID_BODY);

    expect(res.status).not.toBe(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/admin/doctors")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });

  it("returns 401 when token signature is invalid", async () => {
    const res = await request(app)
      .post("/api/admin/doctors")
      .set("Authorization", `Bearer ${VALID_JWT.split(".")[0]}.badsig`)
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/resources — JWT acceptance
// ═══════════════════════════════════════════════════════════════════════════════

describe("requireAdmin — iROC JWT accepted on POST /api/admin/resources", () => {
  const VALID_BODY = {
    title: "Test Resource",
    type: "pdf",
    instrument: "spirecut",
    url: "https://example.com/test.pdf",
  };

  beforeEach(() => {
    const mockReturning = vi.fn().mockResolvedValue([{
      id: 1,
      title: "Test Resource",
      titleDe: null,
      description: null,
      descriptionDe: null,
      type: "pdf",
      instrument: "spirecut",
      url: "https://example.com/test.pdf",
      thumbnailUrl: null,
    }]);
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: mockReturning }),
    });
  });

  it("returns non-401 when Authorization carries a valid iROC JWT", async () => {
    const res = await request(app)
      .post("/api/admin/resources")
      .set("Authorization", JWT_AUTH)
      .send(VALID_BODY);

    expect(res.status).not.toBe(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/admin/resources")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });

  it("returns 401 when token signature is invalid", async () => {
    const res = await request(app)
      .post("/api/admin/resources")
      .set("Authorization", `Bearer ${VALID_JWT.split(".")[0]}.badsig`)
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/email-settings — JWT acceptance
// ═══════════════════════════════════════════════════════════════════════════════

describe("requireAdmin — iROC JWT accepted on POST /api/admin/email-settings", () => {
  const VALID_BODY = { key: "email_dest_contact", email: "contact@i-roc.de" };

  beforeEach(() => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("returns non-401 when Authorization carries a valid iROC JWT", async () => {
    const res = await request(app)
      .post("/api/admin/email-settings")
      .set("Authorization", JWT_AUTH)
      .send(VALID_BODY);

    expect(res.status).not.toBe(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/admin/email-settings")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });

  it("returns 401 when token signature is invalid", async () => {
    const res = await request(app)
      .post("/api/admin/email-settings")
      .set("Authorization", `Bearer ${VALID_JWT.split(".")[0]}.badsig`)
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/email-delivery-test", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockSendEmailConfigurationTest.mockReset();
    mockSendEmailConfigurationTest.mockResolvedValue({ messageId: undefined });
  });

  it("sends the shared diagnostic message for the selected delivery role", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ blocked: false }] });

    const res = await request(app)
      .post("/api/admin/email-delivery-test")
      .set("Authorization", JWT_AUTH)
      .send({ purpose: "order_new", to: "admin@example.test" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, purpose: "order_new", to: "admin@example.test" });
    expect(mockSendEmailConfigurationTest).toHaveBeenCalledWith({
      to: "admin@example.test",
      mailboxPurpose: "order_new",
    });
  });

  it("rejects a known customer or contact address before sending", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ blocked: true }] });

    const res = await request(app)
      .post("/api/admin/email-delivery-test")
      .set("Authorization", JWT_AUTH)
      .send({ purpose: "notifications", to: "customer@example.test" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("email_test_recipient_blocked");
    expect(mockSendEmailConfigurationTest).not.toHaveBeenCalled();
  });

  it("requires administrator authentication", async () => {
    const res = await request(app)
      .post("/api/admin/email-delivery-test")
      .send({ purpose: "notifications", to: "admin@example.test" });

    expect(res.status).toBe(401);
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockSendEmailConfigurationTest).not.toHaveBeenCalled();
  });

  it("does not query contacts or send when the role is invalid", async () => {
    const res = await request(app)
      .post("/api/admin/email-delivery-test")
      .set("Authorization", JWT_AUTH)
      .send({ purpose: "customer", to: "admin@example.test" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/i);
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockSendEmailConfigurationTest).not.toHaveBeenCalled();
  });

  it("returns the shared transport error for diagnosis", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ blocked: false }] });
    mockSendEmailConfigurationTest.mockRejectedValue(new Error("Microsoft Graph rejected the mailbox action (403)."));

    const res = await request(app)
      .post("/api/admin/email-delivery-test")
      .set("Authorization", JWT_AUTH)
      .send({ purpose: "notifications", to: "admin@example.test" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: "Microsoft Graph rejected the mailbox action (403).",
      code: "email_test_failed",
    });
  });
});

describe("Microsoft 365 mailbox registry", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    process.env.MICROSOFT_TOKEN_ENCRYPTION_KEY = "test-only-microsoft-token-encryption-key";
  });

  it("stores the requested read-only or read/write access level via a valid iROC JWT", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{
        id: 4, email: "invoices@i-roc.de", display_name: "Invoices",
        purpose: "invoice_ai", access_level: "read", enabled: true,
        authorization_status: "awaiting_authorization",
      }],
    });

    const res = await request(app)
      .post("/api/admin/microsoft-365-mailboxes")
      .set("Authorization", JWT_AUTH)
      .send({ email: "Invoices@i-roc.de", display_name: "Invoices", purpose: "invoice_ai", access_level: "read", enabled: true });

    expect(res.status).toBe(201);
    expect(res.body.access_level).toBe("read");
    expect(mockPoolQuery.mock.calls[0]?.[1]).toContain("read");
  });

  it("accepts a Tori AI mailbox purpose", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{
        id: 5, email: "expenses@i-roc.de", display_name: "Tori Expenses",
        purpose: "tori_ai", access_level: "read", enabled: true,
        authorization_status: "awaiting_authorization",
      }],
    });

    const res = await request(app)
      .post("/api/admin/microsoft-365-mailboxes")
      .set("Authorization", JWT_AUTH)
      .send({ email: "expenses@i-roc.de", display_name: "Tori Expenses", purpose: "tori_ai", access_level: "read", enabled: true });

    expect(res.status).toBe(201);
    expect(res.body.purpose).toBe("tori_ai");
  });

  it.each([
    "general",
    "website_contact",
    "order_new",
    "order_existing",
    "training_spirecut",
    "training_ministem",
    "invoice",
    "invoice_ai",
    "datev",
    "announcement",
    "smtp",
    "tori_ai",
    "sally_ai",
    "notifications",
  ])("accepts the %s operational email purpose", async (purpose) => {
    mockPoolQuery.mockResolvedValue({
      rows: [{
        id: 6, email: `${purpose}@i-roc.de`, display_name: null,
        purpose, access_level: "read_write", enabled: true,
        authorization_status: "awaiting_authorization",
      }],
    });

    const res = await request(app)
      .post("/api/admin/microsoft-365-mailboxes")
      .set("Authorization", JWT_AUTH)
      .send({ email: `${purpose}@i-roc.de`, purpose, access_level: "read_write", enabled: true });

    expect(res.status).toBe(201);
    expect(res.body.purpose).toBe(purpose);
  });

  it("rejects an unknown access level before it reaches the database", async () => {
    const res = await request(app)
      .post("/api/admin/microsoft-365-mailboxes")
      .set("Authorization", JWT_AUTH)
      .send({ email: "invoices@i-roc.de", purpose: "invoice_ai", access_level: "admin" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/access level/i);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("rejects a valid non-admin iROC JWT from mailbox configuration", async () => {
    const nonAdminJwt = makeValidJwt({ userId: 99, username: "iroc_user" });
    const res = await request(app)
      .get("/api/admin/microsoft-365-mailboxes")
      .set("Authorization", `Bearer ${nonAdminJwt}`);

    expect(res.status).toBe(403);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("does not offer an authorization attempt for a disabled mailbox", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 4, enabled: false, access_level: "read" }] });

    const res = await request(app)
      .post("/api/admin/microsoft-365-mailboxes/4/connect")
      .set("Authorization", JWT_AUTH)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/enable/i);
  });

  it("creates a one-time Microsoft consent URL for an enabled mailbox", async () => {
    process.env.MICROSOFT_CLIENT_ID = "test-client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "test-client-secret";
    process.env.MICROSOFT_REDIRECT_URI = "https://admin.example.test/api/admin/microsoft-365/oauth/callback";
    mockPoolQuery.mockImplementation((query: string) => {
      if (query.includes("SELECT id, enabled, access_level")) {
        return Promise.resolve({ rows: [{ id: 4, enabled: true, access_level: "read" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post("/api/admin/microsoft-365-mailboxes/4/connect")
      .set("Authorization", JWT_AUTH)
      .send({});

    expect(res.status).toBe(200);
    const url = new URL(res.body.authorization_url);
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.searchParams.get("scope")).toContain("Mail.Read");
    expect(url.searchParams.get("scope")).not.toContain("Mail.ReadWrite");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(mockPoolQuery.mock.calls.some(([query]) => String(query).includes("iroc_microsoft_oauth_states"))).toBe(true);
  });

  it("requests Mail.Send as well as Mail.ReadWrite for a send-capable mailbox", async () => {
    process.env.MICROSOFT_CLIENT_ID = "test-client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "test-client-secret";
    process.env.MICROSOFT_REDIRECT_URI = "https://admin.example.test/api/admin/microsoft-365/oauth/callback";
    mockPoolQuery.mockImplementation((query: string) => {
      if (query.includes("SELECT id, enabled, access_level")) {
        return Promise.resolve({ rows: [{ id: 4, enabled: true, access_level: "read_write" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post("/api/admin/microsoft-365-mailboxes/4/connect")
      .set("Authorization", JWT_AUTH)
      .send({});

    expect(res.status).toBe(200);
    const scope = new URL(res.body.authorization_url).searchParams.get("scope");
    expect(scope).toContain("Mail.ReadWrite");
    expect(scope).toContain("Mail.Send");
  });

  it("connects only when Microsoft confirms the configured mailbox identity", async () => {
    process.env.MICROSOFT_CLIENT_ID = "test-client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "test-client-secret";
    process.env.MICROSOFT_REDIRECT_URI = "https://admin.example.test/api/admin/microsoft-365/oauth/callback";
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ mailbox_id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 4, email: "invoices@i-roc.de", enabled: true, access_level: "read" }] })
      .mockResolvedValueOnce({ rows: [] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ mail: "invoices@i-roc.de", userPrincipalName: "invoices@i-roc.de" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/admin/microsoft-365/oauth/callback?state=valid-state&code=valid-code")
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("microsoft=connected");
    const update = mockPoolQuery.mock.calls.find(([query]) =>
      String(query).includes("authorization_status='connected'"),
    );
    expect(update?.[1]?.[0]).not.toContain("access-token");
    expect(update?.[1]?.[1]).not.toContain("refresh-token");
    vi.unstubAllGlobals();
  });

  it("refuses to connect a different Microsoft account to the configured mailbox", async () => {
    process.env.MICROSOFT_CLIENT_ID = "test-client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "test-client-secret";
    process.env.MICROSOFT_REDIRECT_URI = "https://admin.example.test/api/admin/microsoft-365/oauth/callback";
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ mailbox_id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 4, email: "invoices@i-roc.de", enabled: true, access_level: "read" }] })
      .mockResolvedValueOnce({ rows: [] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ mail: "other@i-roc.de", userPrincipalName: "other@i-roc.de" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/admin/microsoft-365/oauth/callback?state=valid-state&code=valid-code")
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("microsoft=error");
    expect(mockPoolQuery.mock.calls.some(([query, values]) =>
      String(query).includes("authorization_status='error'")
      && Array.isArray(values)
      && String(values[0]).includes("does not match"),
    )).toBe(true);
    vi.unstubAllGlobals();
  });

  it("blocks Graph send actions for mailboxes configured as read-only", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{
        id: 4,
        email: "invoices@i-roc.de",
        enabled: true,
        access_level: "read",
        authorization_status: "connected",
        authorization_error: null,
        oauth_access_token: encryptMicrosoftToken("access-token"),
        oauth_refresh_token: encryptMicrosoftToken("refresh-token"),
        oauth_expires_at: new Date(Date.now() + 3_600_000),
      }],
    });

    const res = await request(app)
      .post("/api/admin/microsoft-365-mailboxes/4/send")
      .set("Authorization", JWT_AUTH)
      .send({ to: "doctor@example.test", subject: "Test", text: "Hello" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("mailbox_read_only");
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it("accepts Graph's empty 202 response after a send has been queued", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{
        id: 4,
        email: "invoices@i-roc.de",
        enabled: true,
        access_level: "read_write",
        authorization_status: "connected",
        authorization_error: null,
        oauth_access_token: encryptMicrosoftToken("access-token"),
        oauth_refresh_token: encryptMicrosoftToken("refresh-token"),
        oauth_expires_at: new Date(Date.now() + 3_600_000),
      }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ "content-length": "0" }),
      text: async () => {
        throw new Error("An empty 202 response must not be parsed.");
      },
    }));

    const res = await request(app)
      .post("/api/admin/microsoft-365-mailboxes/4/send")
      .set("Authorization", JWT_AUTH)
      .send({ to: "doctor@example.test", subject: "Test", text: "Hello" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    vi.unstubAllGlobals();
  });

  it("marks a mailbox invalid and blocks its Graph action after Microsoft rejects its token", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [{
        id: 4,
        email: "invoices@i-roc.de",
        enabled: true,
        access_level: "read",
        authorization_status: "connected",
        authorization_error: null,
        oauth_access_token: encryptMicrosoftToken("access-token"),
        oauth_refresh_token: encryptMicrosoftToken("refresh-token"),
        oauth_expires_at: new Date(Date.now() + 3_600_000),
      }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401, ok: false }));

    const res = await request(app)
      .get("/api/admin/microsoft-365-mailboxes/4/messages")
      .set("Authorization", JWT_AUTH);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("microsoft_authorization_invalid");
    expect(mockPoolQuery.mock.calls.some(([query]) =>
      String(query).includes("authorization_status=CASE WHEN enabled THEN 'error'"),
    )).toBe(true);
    vi.unstubAllGlobals();
  });

  it("blocks a send when an expired token cannot be refreshed", async () => {
    process.env.MICROSOFT_CLIENT_ID = "test-client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "test-client-secret";
    process.env.MICROSOFT_REDIRECT_URI = "https://admin.example.test/api/admin/microsoft-365/oauth/callback";
    mockPoolQuery.mockResolvedValue({
      rows: [{
        id: 4,
        email: "invoices@i-roc.de",
        enabled: true,
        access_level: "read_write",
        authorization_status: "connected",
        authorization_error: null,
        oauth_access_token: null,
        oauth_refresh_token: encryptMicrosoftToken("expired-refresh-token"),
        oauth_expires_at: new Date(Date.now() - 60_000),
      }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "invalid_grant" }),
    }));

    const res = await request(app)
      .post("/api/admin/microsoft-365-mailboxes/4/send")
      .set("Authorization", JWT_AUTH)
      .send({ to: "doctor@example.test", subject: "Test", text: "Hello" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("microsoft_authorization_invalid");
    expect(mockPoolQuery.mock.calls.some(([query]) =>
      String(query).includes("authorization_status=CASE WHEN enabled THEN 'error'"),
    )).toBe(true);
    vi.unstubAllGlobals();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/video-urls — JWT acceptance
// ═══════════════════════════════════════════════════════════════════════════════

describe("requireAdmin — iROC JWT accepted on POST /api/admin/video-urls", () => {
  const VALID_BODY = {
    instrument: "spirecut",
    url: "https://www.youtube.com/embed/mjPCpa427go",
  };

  beforeEach(() => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("returns non-401 when Authorization carries a valid iROC JWT", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", JWT_AUTH)
      .send(VALID_BODY);

    expect(res.status).not.toBe(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });

  it("returns 401 when token signature is invalid", async () => {
    const res = await request(app)
      .post("/api/admin/video-urls")
      .set("Authorization", `Bearer ${VALID_JWT.split(".")[0]}.badsig`)
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/portal-passwords — JWT acceptance
// ═══════════════════════════════════════════════════════════════════════════════

describe("requireAdmin — iROC JWT accepted on POST /api/admin/portal-passwords", () => {
  const VALID_BODY = { instrument: "spirecut", password: "securepassword" };

  beforeEach(() => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("returns non-401 when Authorization carries a valid iROC JWT", async () => {
    const res = await request(app)
      .post("/api/admin/portal-passwords")
      .set("Authorization", JWT_AUTH)
      .send(VALID_BODY);

    expect(res.status).not.toBe(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/admin/portal-passwords")
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });

  it("returns 401 when token signature is invalid", async () => {
    const res = await request(app)
      .post("/api/admin/portal-passwords")
      .set("Authorization", `Bearer ${VALID_JWT.split(".")[0]}.badsig`)
      .send(VALID_BODY);

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// verifyToken unit tests — expiry logic, missing exp, boundary, TTL
// ═══════════════════════════════════════════════════════════════════════════════

describe("verifyToken — expiry enforcement", () => {
  it("returns payload for a token with exp well in the future", () => {
    const jwt = makeValidJwt({ userId: 7, username: "tester" });
    const result = verifyToken(jwt);
    expect(result).not.toBeNull();
    expect(result?.userId).toBe(7);
    expect(result?.username).toBe("tester");
  });

  it("returns null for an expired token (exp in the past)", () => {
    const expiredJwt = makeValidJwt(
      { userId: 7, username: "tester" },
      Math.floor(Date.now() / 1000) - 60, // 60 seconds ago
    );
    expect(verifyToken(expiredJwt)).toBeNull();
  });

  it("returns null when exp equals the current second (>= boundary)", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const boundaryJwt = makeValidJwt({ userId: 7, username: "tester" }, nowSec);
    expect(verifyToken(boundaryJwt)).toBeNull();
  });

  it("returns null for a legacy token that has no exp field", () => {
    const legacyJwt = makeTokenWithoutExp({ userId: 7, username: "tester" });
    expect(verifyToken(legacyJwt)).toBeNull();
  });

  it("returns null for a tampered signature even if exp is valid", () => {
    const jwt = makeValidJwt({ userId: 7, username: "tester" });
    const [data] = jwt.split(".");
    const tampered = `${data}.badsig`;
    expect(verifyToken(tampered)).toBeNull();
  });

  it("returns null for a token with no dot separator", () => {
    expect(verifyToken("notavalidtoken")).toBeNull();
  });
});
