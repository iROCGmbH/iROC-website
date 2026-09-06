/**
 * Tests for POST /api/iroc/website-customers — duplicate-email guard
 *
 * Verifies that:
 *  1. A second POST with the same email returns 409 with error "duplicate_email"
 *     and the existingId of the original record.
 *  2. A second POST whose email differs only by letter case also returns 409.
 *  3. A POST with a brand-new email returns 201.
 *
 * The duplicate check calls:
 *   db.select().from(websiteCustomersTable).where(...).limit(1)
 *
 * nextCustomerNr() also calls:
 *   db.select({maxNr: ...}).from(websiteCustomersTable).where(...)
 *   — this chain is awaited directly (no .limit()), so the where() mock must
 *   return a thenable that also exposes .limit().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock-factory state ──────────────────────────────────────────────────
// All state closed over by vi.mock() factories must be declared via vi.hoisted()
// so it is available before factories execute.

const {
  mockReturning,
  mockValues,
  mockInsert,
  mockLimit,
  mockWhere,
  mockFrom,
  mockDbSelect,
  mockTransaction,
} =
  vi.hoisted(() => {
    const mockReturning = vi.fn();
    const mockValues    = vi.fn().mockReturnValue({ returning: mockReturning });
    const mockInsert    = vi.fn().mockReturnValue({ values: mockValues });

    // where() must return something that:
    //   a) is awaitable (thenable) — for nextCustomerNr() which awaits where() directly
    //   b) has .limit() — for the duplicate-check which calls .limit(1) on the result
    // We build a fresh thenable-with-limit each call in the mock implementation.
    const mockLimit  = vi.fn();
    const mockWhere  = vi.fn();
    const mockFrom   = vi.fn();
    const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });
    const mockTransaction = vi.fn();

    return {
      mockReturning,
      mockValues,
      mockInsert,
      mockLimit,
      mockWhere,
      mockFrom,
      mockDbSelect,
      mockTransaction,
    };
  });

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockInsert,
    transaction: mockTransaction,
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
  irocInvoices:               {},
  irocInvoiceItems:           {},
  irocCustomers:              {},
  websiteCustomersTable:      {},
  irocAppUsers:               {},
  irocNotifications:          {},
  settingsTable:              {},
  irocProducts:               {},
  irocInventoryLots:          {},
  trainingRegistrationsTable: {},
}));

vi.mock("../lib/reorder-code", () => ({
  generateUniqueReorderCode: vi.fn().mockResolvedValue("REORDER42"),
}));

// ── Mock pdfkit (imported transitively by iroc.ts) ────────────────────────────
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

// ── JWT helper (mirrors iroc.ts signToken) ────────────────────────────────────
const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

// ── Fixture data ──────────────────────────────────────────────────────────────
const existingCustomer = {
  id:              42,
  customerNr:      "2026-0001",
  firstName:       "Anna",
  lastName:        "Example",
  institutionName: null,
  email:           "anna@example.com",
  country:         "DE",
  phone:           null,
  address:         null,
  postalCode:      null,
  city:            null,
  ustIdNr:         null,
  instrument:      "iroc",
  specialty:       null,
  privacyConsent:  true,
  createdAt:       new Date(),
};

const newCustomer = {
  ...existingCustomer,
  id:         99,
  customerNr: "2026-0002",
  email:      "new@example.com",
};

// ── Helper: build a thenable that also exposes .limit() ──────────────────────
// The duplicate-check calls where().limit(1); nextCustomerNr() awaits where()
// directly.  We return a Promise that also has a .limit method so both patterns
// work against the same mock.
function whereChain(directRows: unknown[], limitRows?: unknown[]) {
  const p = Promise.resolve(directRows) as Promise<unknown[]> & { limit: typeof mockLimit };
  mockLimit.mockResolvedValueOnce(limitRows ?? directRows);
  p.limit = mockLimit;
  return p;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("POST /api/iroc/website-customers — duplicate-email guard", () => {
  beforeEach(() => {
    mockWhere.mockReset();
    mockFrom.mockReset();
    mockLimit.mockReset();
    mockDbSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockTransaction.mockReset();
    mockReturning.mockReset();
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });
  });

  it("returns 409 with duplicate_email and existingId when the email already exists", async () => {
    // Duplicate check: db.select().from().where().limit(1) → [existingCustomer]
    mockWhere.mockReturnValueOnce(whereChain([existingCustomer], [existingCustomer]));

    const res = await request(app)
      .post("/api/iroc/website-customers")
      .set("Authorization", AUTH)
      .send({ email: "anna@example.com", firstName: "Anna", lastName: "Example" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_email");
    expect(res.body.existingId).toBe(42);
  });

  it("returns 201 with the created record when the email is new", async () => {
    // First call: duplicate check → no existing record
    mockWhere.mockReturnValueOnce(whereChain([], []));
    // Second call: nextCustomerNr() → no existing customer_nr rows
    mockWhere.mockReturnValueOnce(whereChain([{ maxNr: null }]));

    // Insert returning the new record
    mockReturning.mockResolvedValueOnce([newCustomer]);

    const res = await request(app)
      .post("/api/iroc/website-customers")
      .set("Authorization", AUTH)
      .send({ email: "new@example.com", firstName: "New", lastName: "Person" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(99);
    expect(res.body.email).toBe("new@example.com");
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ reorderCode: "REORDER42" }));
  });

  it("removes a duplicated academic title before inserting the name fields", async () => {
    mockWhere.mockReturnValueOnce(whereChain([], []));
    mockWhere.mockReturnValueOnce(whereChain([{ maxNr: null }]));
    mockReturning.mockResolvedValueOnce([{
      ...newCustomer,
      firstName: "Sarah",
      lastName: "Mustermann",
    }]);

    const res = await request(app)
      .post("/api/iroc/website-customers")
      .set("Authorization", AUTH)
      .send({
        email: "sarah@example.com",
        title: "Dr. med",
        firstName: "Dr. med Sarah",
        lastName: "Dr. Mustermann",
      });

    expect(res.status).toBe(201);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      title: "Dr. med",
      firstName: "Sarah",
      lastName: "Mustermann",
    }));
  });

  it("returns 409 when a second import differs only by email letter case", async () => {
    // First request: the case-insensitive duplicate check finds no record.
    mockWhere.mockReturnValueOnce(whereChain([], []));
    // nextCustomerNr(): no existing customer_nr rows.
    mockWhere.mockReturnValueOnce(whereChain([{ maxNr: null }]));
    mockReturning.mockResolvedValueOnce([{ ...existingCustomer, email: "Anna@Example.com" }]);

    const first = await request(app)
      .post("/api/iroc/website-customers")
      .set("Authorization", AUTH)
      .send({ email: "Anna@Example.com", firstName: "Anna", lastName: "Example" });

    expect(first.status).toBe(201);

    // nextCustomerNr() awaits where() directly, leaving its unused .limit()
    // response in this shared mock's queue.
    mockLimit.mockReset();

    // Second request: LOWER(email) matching must find the first record.
    mockWhere.mockReturnValueOnce(whereChain(
      [{ ...existingCustomer, email: "Anna@Example.com" }],
      [{ ...existingCustomer, email: "Anna@Example.com" }],
    ));

    const second = await request(app)
      .post("/api/iroc/website-customers")
      .set("Authorization", AUTH)
      .send({ email: "anna@example.com", firstName: "Anna", lastName: "Example" });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe("duplicate_email");
    expect(second.body.existingId).toBe(42);
  });

  it("serializes a registration import and reports a completed retry", async () => {
    const transactionTx = {
      execute: vi.fn().mockResolvedValue({ rows: [{ locked: true }] }),
      select: mockDbSelect,
      insert: mockInsert,
    };
    mockTransaction.mockImplementationOnce(async (callback: (tx: typeof transactionTx) => Promise<unknown>) => callback(transactionTx));

    // First select checks the existing email; second is nextCustomerNr().
    mockWhere.mockReturnValueOnce(whereChain([], []));
    mockWhere.mockReturnValueOnce(whereChain([{ maxNr: null }]));
    mockReturning.mockResolvedValueOnce([newCustomer]);

    const first = await request(app)
      .post("/api/iroc/website-customers")
      .set("Authorization", AUTH)
      .send({
        sourceRegistrationId: 77,
        email: "new@example.com",
        firstName: "New",
        lastName: "Person",
      });

    expect(first.status).toBe(201);
    expect(transactionTx.execute).toHaveBeenCalled();

    // The retry takes the same source lock and sees the customer created by
    // the first request, so it is reported as completed rather than created.
    mockLimit.mockReset();
    mockTransaction.mockImplementationOnce(async (callback: (tx: typeof transactionTx) => Promise<unknown>) => callback(transactionTx));
    mockWhere.mockReturnValueOnce(whereChain([{ ...newCustomer }], [{ ...newCustomer }]));

    const retry = await request(app)
      .post("/api/iroc/website-customers")
      .set("Authorization", AUTH)
      .send({
        sourceRegistrationId: 77,
        email: "new@example.com",
        firstName: "New",
        lastName: "Person",
      });

    expect(retry.status).toBe(409);
    expect(retry.body.error).toBe("customer_already_imported");
    expect(retry.body.existingId).toBe(99);
  });

  it("reports a registration import as in progress when its lock is held", async () => {
    const transactionTx = {
      execute: vi.fn().mockResolvedValue({ rows: [{ locked: false }] }),
      select: mockDbSelect,
      insert: mockInsert,
    };
    mockTransaction.mockImplementationOnce(async (callback: (tx: typeof transactionTx) => Promise<unknown>) => callback(transactionTx));

    const res = await request(app)
      .post("/api/iroc/website-customers")
      .set("Authorization", AUTH)
      .send({
        sourceRegistrationId: 77,
        email: "new@example.com",
        firstName: "New",
        lastName: "Person",
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("customer_import_in_progress");
    expect(res.body.registrationId).toBe(77);
  });
});
