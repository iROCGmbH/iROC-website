/**
 * email-certificate-credentials.test.ts — Task #319
 *
 * Verifies that the portal credentials block is appended to the email body
 * before it reaches nodemailer's sendMail, for both Spirecut and MiniStem
 * certificates.
 *
 * Tests:
 *   1. POST /api/admin/doctors/:id/email-certificate with instrument='spirecut'
 *      → sent body contains "Portal-Zugang / Portal Access (Spirecut®)" and
 *        the default password.
 *   2. Same for instrument='ministem'
 *      → body contains "Portal-Zugang / Portal Access (MiniStem®)" and the
 *        default ministem password.
 *   3. When portal_url_spirecut is stored in the settings table, the Login-URL
 *      line appears in the sent body.
 *
 * Strategy:
 *   - @workspace/db is mocked with a stateful in-memory Map for the settings
 *     table.
 *   - drizzle-orm helpers are mocked so eq() propagates the queried key so
 *     the where() mock can return the right row.
 *   - nodemailer is mocked (with SMTP env vars set) so sendMail captures the
 *     text body for assertions.
 *   - requireAdmin is bypassed by passing a valid iROC JWT.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist stubs so they are available inside vi.mock factories ────────────────

const {
  settingsStore,
  mockSendMail,
  mockSettingsTable,
  mockTrainedDoctorsTable,
  sentEmailOptions,
} = vi.hoisted(() => {
  /** Simulates the `settings` table rows. key → value */
  const settingsStore = new Map<string, string>();

  /** Captured by the nodemailer mock — lets us assert the text body. */
  const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });

  /** Sentinel so from() can tell it's working with the settings table. */
  const mockSettingsTable = { _tag: "settings", key: "key" };
  const mockTrainedDoctorsTable = { _tag: "trainedDoctors", id: "id" };
  const sentEmailOptions: Record<string, unknown>[] = [];

  return {
    settingsStore,
    mockSendMail,
    mockSettingsTable,
    mockTrainedDoctorsTable,
    sentEmailOptions,
  };
});

// ── drizzle-orm mock ──────────────────────────────────────────────────────────
//
// eq(field, value) → { __eqValue: value } so where() can extract the key.

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_field: unknown, value: unknown) => ({ __eqValue: value })),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((_field: unknown) => "desc"),
  isNotNull: vi.fn((_field: unknown) => "isNotNull"),
  inArray: vi.fn((_field: unknown, values: unknown) => ({ __inArray: values })),
  sql: vi.fn((_strings: TemplateStringsArray, ..._vals: unknown[]) => "sqlExpr"),
  like: vi.fn((_field: unknown, _pattern: unknown) => ({})),
  max: vi.fn((_field: unknown) => "maxExpr"),
  asc: vi.fn((_field: unknown) => "asc"),
}));

// ── @workspace/db mock ────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  /**
   * Build a where() mock that looks up the queried key in settingsStore.
   * This handles both single eq() calls (portal_password_*, portal_url_*)
   * and inArray() calls (email.ts resolveSmtpConfig).
   */
  function makeSettingsWhere() {
    return vi.fn().mockImplementation(
      (condition: { __eqValue?: unknown; __inArray?: unknown }) => {
        if (condition.__eqValue !== undefined) {
          const key = condition.__eqValue as string;
          if (settingsStore.has(key)) {
            return Promise.resolve([{ key, value: settingsStore.get(key) }]);
          }
          return Promise.resolve([]);
        }
        if (condition.__inArray !== undefined) {
          // inArray call from resolveSmtpConfig
          const keys = condition.__inArray as string[];
          const rows = keys
            .filter((k) => settingsStore.has(k))
            .map((k) => ({ key: k, value: settingsStore.get(k) as string }));
          return Promise.resolve(rows);
        }
        return Promise.resolve([]);
      }
    );
  }

  const mockFrom = vi.fn().mockImplementation((table: { _tag?: string }) => {
    if (table._tag === "settings") {
      return { where: makeSettingsWhere() };
    }
    if (table._tag === "trainedDoctors") {
      return {
        where: vi.fn().mockImplementation((condition: { __eqValue?: unknown }) =>
          Promise.resolve(condition.__eqValue === 1
            ? [{ id: 1, country: "Deutschland" }]
            : condition.__eqValue === 2
              ? [{ id: 2, country: "USA" }]
              : []),
        ),
      };
    }
    // Default: empty result for any other table
    return {
      where: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockResolvedValue([]),
      leftJoin: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    };
  });

  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  /**
   * insert() mock: when called on the settings table, intercepts
   * .values({ key, value }).onConflictDoUpdate(...) and writes the key/value
   * pair into settingsStore so that subsequent db.select() calls see the
   * updated row — exactly what happens when an admin saves a new portal
   * password via POST /api/admin/portal-passwords.
   */
  const mockInsert = vi.fn().mockImplementation((table: { _tag?: string }) => {
    let pendingKey: string | undefined;
    let pendingValue: string | undefined;
    return {
      values: vi.fn().mockImplementation(
        (vals: { key?: string; value?: string } | Array<{ key?: string; value?: string }>) => {
          const v = Array.isArray(vals) ? vals[0] : vals;
          pendingKey = v?.key;
          pendingValue = v?.value;
          return {
            returning: vi.fn().mockResolvedValue(
              pendingKey ? [{ key: pendingKey, value: pendingValue ?? "" }] : []
            ),
            onConflictDoUpdate: vi.fn().mockImplementation(() => {
              // Write through to settingsStore for settings table inserts
              if (table._tag === "settings" && pendingKey !== undefined) {
                settingsStore.set(pendingKey, pendingValue ?? "");
              }
              return Promise.resolve(undefined);
            }),
          };
        }
      ),
    };
  });

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    },
    settingsTable: mockSettingsTable,
    trainedDoctorsTable: mockTrainedDoctorsTable,
    doctorCertificationsTable: { _tag: "doctorCerts" },
    resourcesTable: { _tag: "resources" },
    trainingDatesTable: { _tag: "trainingDates" },
    trainingRegistrationsTable: { _tag: "trainingRegs" },
    websiteCustomersTable: { _tag: "websiteCustomers" },
    irocAppUsers: { _tag: "irocAppUsers" },
    irocCustomers: { _tag: "irocCustomers" },
    irocProducts: { _tag: "irocProducts" },
    irocInventoryLots: { _tag: "irocInventoryLots" },
    irocInvoices: { _tag: "irocInvoices" },
    irocInvoiceItems: { _tag: "irocInvoiceItems" },
    irocNotifications: { _tag: "irocNotifications" },
  };
});

// ── nodemailer mock ───────────────────────────────────────────────────────────

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
  createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
}));

// Capture the route-level role before sendEmail hands the message to the
// transport, whose options intentionally do not include mailboxPurpose.
vi.mock("../lib/email", async () => {
  const actual = await vi.importActual<typeof import("../lib/email")>("../lib/email");
  return {
    ...actual,
    sendEmail: vi.fn(async (options: Parameters<typeof actual.sendEmail>[0]) => {
      sentEmailOptions.push(options as Record<string, unknown>);
      return actual.sendEmail(options);
    }),
  };
});

// ── Activate SMTP so the real transport path is used ─────────────────────────

beforeEach(() => {
  process.env.SMTP_HOST = "smtp.test.local";
  process.env.SMTP_USER = "test@test.local";
  process.env.SMTP_PASS = "testpass";
  // Clear default portal password env vars so only the DB / hardcoded fallback applies
  delete process.env.SPIRECUT_PORTAL_PASSWORD;
  delete process.env.MINISTEM_PORTAL_PASSWORD;
  settingsStore.clear();
  mockSendMail.mockClear();
  sentEmailOptions.length = 0;
});

// ── Import app AFTER all mocks are registered ─────────────────────────────────

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_BODY = {
  to: "doctor@example.com",
  subject: "Ihr Spirecut-Zertifikat",
  body: "Sehr geehrte Frau Doktor,\n\nim Anhang finden Sie Ihr Zertifikat.",
  pdfBase64: Buffer.from("fake-pdf").toString("base64"),
  filename: "zertifikat.pdf",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/admin/doctors/:id/email-certificate — required fields", () => {
  it("requires the doctor identified by the route before sending a certificate", async () => {
    const res = await request(app)
      .post("/api/admin/doctors/999/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({ ...BASE_BODY, instrument: "spirecut" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Doctor not found");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("rejects a request with no recipient", async () => {
    const { to: _to, ...requestBody } = BASE_BODY;

    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send(requestBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("to, subject, body, pdfBase64 are required");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("rejects an obviously malformed recipient without sending an email", async () => {
    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({ ...BASE_BODY, to: "notanemail" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("valid email address");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("rejects a request with no subject", async () => {
    const { subject: _subject, ...requestBody } = BASE_BODY;

    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send(requestBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("to, subject, body, pdfBase64 are required");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("rejects a request with no email body", async () => {
    const { body: _body, ...requestBody } = BASE_BODY;

    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send(requestBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("to, subject, body, pdfBase64 are required");
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/doctors/:id/email-certificate — portal credentials block", () => {
  // ── Spirecut ──────────────────────────────────────────────────────────────

  describe("instrument='spirecut'", () => {
    it("appends 'Portal-Zugang / Portal Access (Spirecut®)' to the sent body", async () => {
      const res = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "spirecut" });

      expect(res.status).toBe(200);
      expect(mockSendMail).toHaveBeenCalledOnce();

      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).toContain("Portal-Zugang (Spirecut\u00ae)");
      expect(sentText).not.toContain("Portal Access");
    });

    it("includes the hardcoded fallback password when no DB entry exists", async () => {
      // settingsStore is empty → route falls back to "spirecut2024"
      const res = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "spirecut" });

      expect(res.status).toBe(200);
      expect(sentEmailOptions[0]).toMatchObject({
        to: BASE_BODY.to,
        mailboxPurpose: "notifications",
      });
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).toContain("Passwort: spirecut2024");
    });

    it("uses the password stored in the settings table when present", async () => {
      settingsStore.set("portal_password_spirecut", "s3cr3tSpirecut!");

      const res = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "spirecut" });

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).toContain("Passwort: s3cr3tSpirecut!");
      expect(sentText).not.toContain("spirecut2024");
    });

    it("appends the block after the original body text", async () => {
      const res = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "spirecut" });

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      // Original body appears first, then the separator, then the block
      const bodyIdx = sentText.indexOf(BASE_BODY.body);
      const blockIdx = sentText.indexOf("Portal-Zugang");
      expect(bodyIdx).toBeGreaterThanOrEqual(0);
      expect(blockIdx).toBeGreaterThan(bodyIdx);
    });
  });

  // ── MiniStem ──────────────────────────────────────────────────────────────

  describe("instrument='ministem'", () => {
    it("appends 'Portal-Zugang / Portal Access (MiniStem®)' to the sent body", async () => {
      const res = await request(app)
        .post("/api/admin/doctors/2/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({
          ...BASE_BODY,
          subject: "Ihr MiniStem-Zertifikat",
          instrument: "ministem",
        });

      expect(res.status).toBe(200);
      expect(mockSendMail).toHaveBeenCalledOnce();

      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).toContain("Portal Access (MiniStem\u00ae)");
      expect(sentText).not.toContain("Portal-Zugang");
    });

    it("includes the hardcoded fallback password when no DB entry exists", async () => {
      const res = await request(app)
        .post("/api/admin/doctors/2/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({
          ...BASE_BODY,
          subject: "Ihr MiniStem-Zertifikat",
          instrument: "ministem",
        });

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).toContain("Password: ministem2024");
    });

    it("uses the password stored in the settings table when present", async () => {
      settingsStore.set("portal_password_ministem", "m1n1st3mPass");

      const res = await request(app)
        .post("/api/admin/doctors/2/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({
          ...BASE_BODY,
          subject: "Ihr MiniStem-Zertifikat",
          instrument: "ministem",
        });

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).toContain("Password: m1n1st3mPass");
      expect(sentText).not.toContain("ministem2024");
    });

    it("does NOT include a Spirecut® reference in the MiniStem body", async () => {
      const res = await request(app)
        .post("/api/admin/doctors/2/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({
          ...BASE_BODY,
          subject: "Ihr MiniStem-Zertifikat",
          instrument: "ministem",
        });

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).not.toContain("Spirecut\u00ae");
    });
  });

  // ── Portal URL ─────────────────────────────────────────────────────────────

  describe("portal_url stored in settings", () => {
    it("includes Login-URL in the Spirecut body when portal_url_spirecut is set", async () => {
      settingsStore.set("portal_url_spirecut", "https://portal.spirecut.example.com");

      const res = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "spirecut" });

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      // URL line appears in the block (which covers both DE and EN readers of the email)
      expect(sentText).toContain("Login-URL: https://portal.spirecut.example.com");
    });

    it("the URL line appears within the portal credentials block (after the separator)", async () => {
      settingsStore.set("portal_url_spirecut", "https://portal.spirecut.example.com");

      const res = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "spirecut" });

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      const separatorIdx = sentText.indexOf("\u2500\u2500");
      const urlIdx = sentText.indexOf("Login-URL:");
      expect(separatorIdx).toBeGreaterThanOrEqual(0);
      expect(urlIdx).toBeGreaterThan(separatorIdx);
    });

    it("omits the Login-URL line when portal_url_spirecut is not set", async () => {
      // settingsStore has no URL entry

      const res = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "spirecut" });

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).not.toContain("Login-URL:");
    });

    it("includes Login-URL in the MiniStem body when portal_url_ministem is set", async () => {
      settingsStore.set("portal_url_ministem", "https://portal.ministem.example.com");

      const res = await request(app)
        .post("/api/admin/doctors/2/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({
          ...BASE_BODY,
          subject: "Ihr MiniStem-Zertifikat",
          instrument: "ministem",
        });

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).toContain("Login URL: https://portal.ministem.example.com");
    });
  });

  // ── No credentials block when instrument is absent / unknown ─────────────

  describe("no portal block when instrument is missing or unknown", () => {
    it("sends the body unchanged when instrument is not provided", async () => {
      const res = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY }); // no instrument

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).not.toContain("Portal-Zugang");
      expect(sentText).not.toContain("Portal Access");
    });

    it("sends the body unchanged when instrument is an unknown value", async () => {
      const res = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "unknown-tool" });

      expect(res.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).not.toContain("Portal-Zugang");
    });
  });
});

// ── End-to-end round-trip: admin saves password → email picks it up ───────────
//
// These tests exercise the full path:
//   POST /api/admin/portal-passwords  (writes to settingsStore via the mock)
//   POST /api/admin/doctors/:id/email-certificate  (reads from settingsStore)
//
// This confirms that the email-certificate route uses the DB row written by the
// admin settings panel, not a stale env-var or in-memory cache.

describe("Admin portal-password write → email-certificate read (round-trip)", () => {
  describe("portal_password_spirecut", () => {
    it("email body reflects the new Spirecut password saved via POST /api/admin/portal-passwords", async () => {
      // Step 1: Admin saves a new Spirecut portal password
      const saveRes = await request(app)
        .post("/api/admin/portal-passwords")
        .set("Authorization", JWT_AUTH)
        .send({ instrument: "spirecut", password: "RoundTripSpirecut1" });

      expect(saveRes.status).toBe(200);

      // Step 2: Send a certificate email — the route must read the updated DB row
      mockSendMail.mockClear();
      const emailRes = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "spirecut" });

      expect(emailRes.status).toBe(200);
      expect(mockSendMail).toHaveBeenCalledOnce();

      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).toContain("Passwort: RoundTripSpirecut1");
      // Hardcoded fallback must NOT appear
      expect(sentText).not.toContain("spirecut2024");
    });

    it("email body reflects a second password update (no stale value is reused)", async () => {
      // First update
      await request(app)
        .post("/api/admin/portal-passwords")
        .set("Authorization", JWT_AUTH)
        .send({ instrument: "spirecut", password: "FirstSpirecut12" });

      // Second update overwrites the first
      await request(app)
        .post("/api/admin/portal-passwords")
        .set("Authorization", JWT_AUTH)
        .send({ instrument: "spirecut", password: "SecondSpirecut2" });

      mockSendMail.mockClear();
      const emailRes = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "spirecut" });

      expect(emailRes.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).toContain("Passwort: SecondSpirecut2");
      expect(sentText).not.toContain("FirstSpirecut12");
    });
  });

  describe("portal_password_ministem", () => {
    it("email body reflects the new MiniStem password saved via POST /api/admin/portal-passwords", async () => {
      // Step 1: Admin saves a new MiniStem portal password
      const saveRes = await request(app)
        .post("/api/admin/portal-passwords")
        .set("Authorization", JWT_AUTH)
        .send({ instrument: "ministem", password: "RoundTripMiniStem1" });

      expect(saveRes.status).toBe(200);

      // Step 2: Send a certificate email — route must use the DB row
      mockSendMail.mockClear();
      const emailRes = await request(app)
        .post("/api/admin/doctors/2/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, subject: "Ihr MiniStem-Zertifikat", instrument: "ministem" });

      expect(emailRes.status).toBe(200);
      expect(mockSendMail).toHaveBeenCalledOnce();

      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).toContain("Password: RoundTripMiniStem1");
      // Hardcoded fallback must NOT appear
      expect(sentText).not.toContain("ministem2024");
    });

    it("a MiniStem password update does not bleed into Spirecut emails", async () => {
      await request(app)
        .post("/api/admin/portal-passwords")
        .set("Authorization", JWT_AUTH)
        .send({ instrument: "ministem", password: "MiniStemOnly123" });

      mockSendMail.mockClear();
      // Send a Spirecut email — must not contain the MiniStem password
      const emailRes = await request(app)
        .post("/api/admin/doctors/1/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, instrument: "spirecut" });

      expect(emailRes.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).not.toContain("MiniStemOnly123");
      expect(sentText).toContain("Portal-Zugang (Spirecut\u00ae)");
    });

    it("a Spirecut password update does not bleed into MiniStem emails", async () => {
      await request(app)
        .post("/api/admin/portal-passwords")
        .set("Authorization", JWT_AUTH)
        .send({ instrument: "spirecut", password: "SpirecutOnly123" });

      mockSendMail.mockClear();
      // Send a MiniStem email — must not contain the Spirecut password
      const emailRes = await request(app)
        .post("/api/admin/doctors/2/email-certificate")
        .set("Authorization", JWT_AUTH)
        .send({ ...BASE_BODY, subject: "Ihr MiniStem-Zertifikat", instrument: "ministem" });

      expect(emailRes.status).toBe(200);
      const sentText: string = mockSendMail.mock.calls[0][0].text;
      expect(sentText).not.toContain("SpirecutOnly123");
      expect(sentText).toContain("Portal Access (MiniStem\u00ae)");
    });
  });

  describe("password validation on POST /api/admin/portal-passwords", () => {
    it("rejects a password shorter than 8 characters", async () => {
      const res = await request(app)
        .post("/api/admin/portal-passwords")
        .set("Authorization", JWT_AUTH)
        .send({ instrument: "spirecut", password: "short" });

      expect(res.status).toBe(400);
    });

    it("rejects an unknown instrument value", async () => {
      const res = await request(app)
        .post("/api/admin/portal-passwords")
        .set("Authorization", JWT_AUTH)
        .send({ instrument: "unknown", password: "validpassword123" });

      expect(res.status).toBe(400);
    });
  });
});

// ── End-to-end round-trip: admin saves URL → email picks it up ───────────────
//
// These tests prove that the login URL shown in a certificate email comes from
// the same settings row an admin writes through POST /admin/portal-urls.

describe("Admin portal-URL write → email-certificate read (round-trip)", () => {
  it("includes the new Spirecut URL saved via POST /api/admin/portal-urls on the Login-URL line", async () => {
    const portalUrl = "https://portal.example.test/spirecut/new-login";

    const saveRes = await request(app)
      .post("/api/admin/portal-urls")
      .set("Authorization", JWT_AUTH)
      .send({ instrument: "spirecut", url: portalUrl });

    expect(saveRes.status).toBe(200);

    mockSendMail.mockClear();
    const emailRes = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({ ...BASE_BODY, instrument: "spirecut" });

    expect(emailRes.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledOnce();
    const sentText: string = mockSendMail.mock.calls[0][0].text;
    expect(sentText).toContain(`Login-URL: ${portalUrl}`);
  });

  it("includes the new MiniStem URL saved via POST /api/admin/portal-urls on the Login-URL line", async () => {
    const portalUrl = "https://portal.example.test/ministem/new-login";

    const saveRes = await request(app)
      .post("/api/admin/portal-urls")
      .set("Authorization", JWT_AUTH)
      .send({ instrument: "ministem", url: portalUrl });

    expect(saveRes.status).toBe(200);

    mockSendMail.mockClear();
    const emailRes = await request(app)
      .post("/api/admin/doctors/2/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({
        ...BASE_BODY,
        subject: "Ihr MiniStem-Zertifikat",
        instrument: "ministem",
      });

    expect(emailRes.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledOnce();
    const sentText: string = mockSendMail.mock.calls[0][0].text;
    expect(sentText).toContain(`Login URL: ${portalUrl}`);
  });
});

// ── PDF attachment validation ─────────────────────────────────────────────────
//
// These tests cover the error cases for the pdfBase64 field:
//   1. Omitting pdfBase64 → 400 with a descriptive error message
//   2. Sending a malformed (non-base64) string → no unhandled exception (not 500)
//   3. Happy path: attachment filename reaches sendMail

describe("POST /api/admin/doctors/:id/email-certificate — PDF attachment validation", () => {
  const COMMON = {
    to: "doctor@example.com",
    subject: "Ihr Zertifikat",
    body: "Anbei Ihr Zertifikat.",
  };

  it("returns 400 when pdfBase64 is omitted", async () => {
    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send(COMMON); // no pdfBase64

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    // The error message should mention pdfBase64 so the caller knows what to fix
    expect(String(res.body.error)).toMatch(/pdfBase64/i);
  });

  it("returns 400 when pdfBase64 is an empty string", async () => {
    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({ ...COMMON, pdfBase64: "" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 and does not call sendMail when pdfBase64 contains illegal characters", async () => {
    // The route round-trip validates the base64, so illegal characters must
    // produce a clean 400 — not a 500 and not a silently-corrupted attachment.
    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({ ...COMMON, pdfBase64: "!!!not-valid-base64!!!" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("returns 400 when pdfBase64 has an incomplete base64 quartet (e.g. single character 'A')", async () => {
    // "A" alone is not a valid base64 sequence — it would decode to 0 bytes
    // and re-encode to "" rather than "A".
    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({ ...COMMON, pdfBase64: "A" });

    expect(res.status).toBe(400);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("returns 400 when pdfBase64 has incorrect padding ('A=')", async () => {
    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({ ...COMMON, pdfBase64: "A=" });

    expect(res.status).toBe(400);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("returns 400 when pdfBase64 is a JSON number (non-string type)", async () => {
    // Numeric JSON values must not pass through — typeof check must reject them
    // before Buffer.from() is called.
    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({ ...COMMON, pdfBase64: 12345 });

    expect(res.status).toBe(400);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("passes the attachment filename to sendMail on the success path", async () => {
    const customFilename = "mein-zertifikat.pdf";
    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({
        ...COMMON,
        pdfBase64: Buffer.from("fake-pdf-content").toString("base64"),
        filename: customFilename,
      });

    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledOnce();

    const call = mockSendMail.mock.calls[0][0] as {
      attachments?: Array<{ filename?: string }>;
    };
    expect(call.attachments).toBeDefined();
    expect(call.attachments![0].filename).toBe(customFilename);
  });

  it("falls back to 'zertifikat.pdf' when no filename is provided", async () => {
    const res = await request(app)
      .post("/api/admin/doctors/1/email-certificate")
      .set("Authorization", JWT_AUTH)
      .send({
        ...COMMON,
        pdfBase64: Buffer.from("fake-pdf-content").toString("base64"),
        // no filename field
      });

    expect(res.status).toBe(200);
    expect(mockSendMail).toHaveBeenCalledOnce();

    const call = mockSendMail.mock.calls[0][0] as {
      attachments?: Array<{ filename?: string }>;
    };
    expect(call.attachments![0].filename).toBe("zertifikat.pdf");
  });
});
