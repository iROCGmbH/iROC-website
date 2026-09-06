/**
 * Integration test: POST /api/admin/expenses — amount-mismatch guard
 *
 * What & Why
 * ──────────
 * `validateAndNormalizeBody` enforces that net + tax = gross ±0.02 EUR when all
 * three monetary fields are present.  If AI extraction returns inconsistent
 * figures (the most likely real-world trigger) and the admin clicks Save without
 * correcting them, the backend must reject the record with HTTP 422 rather than
 * silently persisting invalid data.
 *
 * Tests
 * ─────
 *  1. Inconsistent payload (net=100, tax=10, gross=200) → 422 + mismatch error
 *  2. Payload within the ±0.02 rounding tolerance → 201 (accepted)
 *  3. Payload where only two monetary fields are provided → 201 (guard skipped)
 *  4. Exactly consistent payload (net=100, tax=19, gross=119) → 201 (accepted)
 *  5. Mismatch on a PUT /api/admin/expenses/:id also returns 422
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock state ──────────────────────────────────────────────────────────

const { mockPoolQuery, mockPoolClient, mockPoolConnect, MockObjectStorageService, MockObjectNotFoundError } =
  vi.hoisted(() => {
    const mockPoolQuery = vi.fn();

    const mockPoolClient = { query: vi.fn(), release: vi.fn() };
    const mockPoolConnect = vi.fn().mockResolvedValue(mockPoolClient);

    class MockObjectNotFoundError extends Error {
      constructor(msg = "not found") { super(msg); this.name = "ObjectNotFoundError"; }
    }

    class MockObjectStorageService {
      getObjectEntityFile                = vi.fn();
      getObjectEntityUploadURLWithSubdir = vi.fn();
      normalizeObjectEntityPath          = vi.fn();
      downloadObject                     = vi.fn();
    }

    return { mockPoolQuery, mockPoolClient, mockPoolConnect, MockObjectStorageService, MockObjectNotFoundError };
  });

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/integrations-gemini-ai/image", () => ({
  ai: { models: { generateContent: vi.fn() } },
}));

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService: MockObjectStorageService,
  ObjectNotFoundError:  MockObjectNotFoundError,
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
  db: {
    select:      vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert:      vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    update:      vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    delete:      vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    execute:     vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  },
  irocInvoices:               { id: "id" },
  irocInvoiceItems:           { invoiceId: "invoiceId" },
  irocCustomers:              { id: "id" },
  websiteCustomersTable:      { id: "id" },
  settingsTable:              { key: "key" },
  datevExports:               { id: "id", status: "status" },
  datevExportItems:           { exportId: "exportId", invoiceId: "invoiceId" },
  irocAppUsers:               {},
  irocNotifications:          {},
  irocProducts:               { id: "id", stockQuantity: "stockQuantity", updatedAt: "updatedAt" },
  irocInventoryLots:          {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable:        {},
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

// ── JWT helper ────────────────────────────────────────────────────────────────

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp     = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data    = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig     = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

// ── Shared saved-row stub (used by the "accepted" paths) ─────────────────────

const SAVED_ROW = {
  id: 1, vendor_name: "ACME GmbH", invoice_date: "2026-01-15",
  invoice_number: "INV-001", category: "Software",
  net_amount: "100.00", tax_amount: "19.00", gross_amount: "119.00",
  currency: "EUR", source: "manual", file_object_path: null,
  notes: null, created_at: new Date().toISOString(),
};

// ── Tests: POST /api/admin/expenses ──────────────────────────────────────────

describe("POST /api/admin/expenses — amount-mismatch guard", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no duplicate found (pool.query for dup check when invoice_number present).
    mockPoolQuery.mockResolvedValue({ rows: [] });
    // Success path uses pool.connect() for a transaction client.
    mockPoolClient.query
      .mockResolvedValueOnce(undefined)            // BEGIN
      .mockResolvedValueOnce({ rows: [SAVED_ROW] }) // INSERT RETURNING
      .mockResolvedValueOnce(undefined);            // COMMIT
    mockPoolConnect.mockResolvedValue(mockPoolClient);
  });

  // ── 1. Inconsistent amounts → 422 ────────────────────────────────────────

  it("returns 422 when net=100, tax=10, gross=200 (100+10 ≠ 200)", async () => {
    const res = await request(app)
      .post("/api/admin/expenses")
      .set("Authorization", AUTH)
      .send({
        vendor_name:  "ACME GmbH",
        net_amount:   100,
        tax_amount:   10,
        gross_amount: 200,
        currency:     "EUR",
      });

    expect(res.status).toBe(422);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/mismatch/i);
    // Should mention the expected sum (110) and the actual gross (200)
    expect(body.error).toMatch(/110/);
    expect(body.error).toMatch(/200/);
  });

  // ── 2. Within ±0.02 rounding tolerance → 201 ────────────────────────────

  it("accepts amounts that differ by ≤0.02 (rounding tolerance)", async () => {
    // net=100.00, tax=19.00, gross=119.01  →  |119.01 - 119.00| = 0.01 ≤ 0.02
    const res = await request(app)
      .post("/api/admin/expenses")
      .set("Authorization", AUTH)
      .send({
        vendor_name:  "ACME GmbH",
        net_amount:   100.00,
        tax_amount:   19.00,
        gross_amount: 119.01,
        currency:     "EUR",
      });

    expect(res.status).toBe(201);
  });

  // ── 3. Only two monetary fields provided → guard skipped → 201 ───────────

  it("skips the mismatch guard when gross is omitted", async () => {
    // net=100, tax=10, no gross → guard requires ALL THREE to be non-null
    const res = await request(app)
      .post("/api/admin/expenses")
      .set("Authorization", AUTH)
      .send({
        vendor_name: "ACME GmbH",
        net_amount:  100,
        tax_amount:  10,
        // gross_amount omitted
        currency:    "EUR",
      });

    expect(res.status).toBe(201);
  });

  // ── 4. Exactly consistent amounts → 201 ─────────────────────────────────

  it("accepts exactly consistent amounts (net=100, tax=19, gross=119)", async () => {
    const res = await request(app)
      .post("/api/admin/expenses")
      .set("Authorization", AUTH)
      .send({
        vendor_name:  "ACME GmbH",
        net_amount:   100,
        tax_amount:   19,
        gross_amount: 119,
        currency:     "EUR",
      });

    expect(res.status).toBe(201);
  });

  it("persists a sub-mill FX rate without rounding it to measurement precision", async () => {
    const res = await request(app)
      .post("/api/admin/expenses")
      .set("Authorization", AUTH)
      .send({
        vendor_name: "Korea Supplier",
        net_amount: 100000,
        tax_amount: 0,
        gross_amount: 100000,
        currency: "KRW",
        net_amount_eur: 61.234,
        tax_amount_eur: 0,
        gross_amount_eur: 61.234,
        exchange_rate: 0.00061234,
        exchange_rate_date: "2026-01-15",
        conversion_status: "converted",
      });

    expect(res.status).toBe(201);
    const insertValues = mockPoolClient.query.mock.calls[1]?.[1] as unknown[];
    expect(insertValues).toContain(0.00061234);
  });

  // ── 5. Unauthenticated request → 401 ─────────────────────────────────────

  it("rejects unauthenticated POST with 401", async () => {
    const res = await request(app)
      .post("/api/admin/expenses")
      .send({ vendor_name: "ACME", net_amount: 100, tax_amount: 10, gross_amount: 200 });

    expect(res.status).toBe(401);
  });

  it("includes the matching expense summary when a duplicate is found", async () => {
    const matchingExpense = {
      id: 42,
      vendor_name: "ACME GmbH",
      invoice_date: "2026-01-15",
      invoice_number: "INV-042",
      gross_amount: "119.00",
      currency: "EUR",
    };
    mockPoolQuery.mockResolvedValueOnce({ rows: [matchingExpense] });

    const res = await request(app)
      .post("/api/admin/expenses")
      .set("Authorization", AUTH)
      .send({
        vendor_name: "ACME GmbH",
        invoice_date: "2026-01-15",
        invoice_number: "INV-042",
        gross_amount: 119,
        currency: "EUR",
      });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: "duplicate",
      duplicate: matchingExpense,
    });
  });

});

// ── Tests: PUT /api/admin/expenses/:id — mismatch guard also applies ─────────

describe("PUT /api/admin/expenses/:id — amount-mismatch guard", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    // Stub: the existing record to update
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, vendor_name: "ACME" }] }) // SELECT existing
      .mockResolvedValueOnce({ rows: [SAVED_ROW] }); // UPDATE RETURNING
  });

  it("returns 422 on PUT when net=100, tax=10, gross=200 (100+10 ≠ 200)", async () => {
    const res = await request(app)
      .put("/api/admin/expenses/1")
      .set("Authorization", AUTH)
      .send({
        vendor_name:  "ACME GmbH",
        net_amount:   100,
        tax_amount:   10,
        gross_amount: 200,
        currency:     "EUR",
      });

    expect(res.status).toBe(422);
    const body = res.body as { error: string };
    expect(body.error).toMatch(/mismatch/i);
    expect(body.error).toMatch(/110/);
    expect(body.error).toMatch(/200/);
  });

});
