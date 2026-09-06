/**
 * Confirmation test: POST /iroc/invoices/offer-pdf returns 400 when the
 * websiteCustomerId does not exist in the DB.
 *
 * What & Why
 * ──────────
 * The offer-pdf endpoint performs a fresh SELECT on websiteCustomersTable for
 * the supplied websiteCustomerId.  If the row is not found it must return
 * HTTP 400 with a descriptive error — not 200 (which would produce a broken PDF)
 * and not 500 (which would mean an unhandled exception surfaced instead).
 *
 * This test stages the DB mock to return an empty array for the customer lookup,
 * then asserts:
 *   1. The response status is exactly 400.
 *   2. The response body contains an error field.
 *   3. The response is NOT 200 and NOT 500.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock-factory state ──────────────────────────────────────────────
const {
  mockDbSelect,
  mockDbUpdate,
  updateReturning,
  mockDbDelete,
  mockDbInsert,
  mockPdfDocument,
} = vi.hoisted(() => {
  // select chain — staged per-call in tests via mockReturnValueOnce
  const mockDbSelect = vi.fn();
  const mockPdfDocument = vi.fn();

  // update chain: db.update(t).set({}).where({}).returning()
  const updateReturning = vi.fn();
  const updateWhere     = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet       = vi.fn().mockReturnValue({ where: updateWhere });
  const mockDbUpdate    = vi.fn().mockReturnValue({ set: updateSet });

  // delete chain: db.delete(t).where({})
  const deleteWhere  = vi.fn().mockResolvedValue([]);
  const mockDbDelete = vi.fn().mockReturnValue({ where: deleteWhere });

  // insert chain: db.insert(t).values([...])
  const insertValues = vi.fn().mockResolvedValue([]);
  const mockDbInsert = vi.fn().mockReturnValue({ values: insertValues });

  return {
    mockDbSelect,
    mockDbUpdate, updateReturning,
    mockDbDelete,
    mockDbInsert,
    mockPdfDocument,
  };
});

// ── Mock pdfkit (should never be reached in the error path) ──────────────────
vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");

  class MockPDFDocument extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;
    constructor(_opts?: unknown) { super(); mockPdfDocument(); }
    text()              { return this; }
    font()              { return this; }
    fontSize()          { return this; }
    fillColor()         { return this; }
    strokeColor()       { return this; }
    lineWidth()         { return this; }
    opacity()           { return this; }
    save()              { return this; }
    restore()           { return this; }
    rotate()            { return this; }
    addPage()           { return this; }
    image()             { return this; }
    moveTo()            { return this; }
    lineTo()            { return this; }
    rect()              { return this; }
    clip()              { return this; }
    stroke()            { return this; }
    fill()              { return this; }
    heightOfString()    { return 10; }
    switchToPage()      { return this; }
    bufferedPageRange() { return { start: 0, count: 1 }; }
    flushPages()        { return this; }
    end(cb?: () => void) { super.end(cb); return this; }
  }

  return { default: MockPDFDocument };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
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
  trainedDoctorsTable:        {},
}));

// ── Import app AFTER mocks ────────────────────────────────────────────────────
import app from "../app";

// ── JWT helper ────────────────────────────────────────────────────────────────
const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fluent select-chain that resolves to `result`.
 * Mirrors the helper in offer-pdf-reflects-saved-edits.test.ts.
 */
function selectChain(result: unknown[]) {
  const p = Promise.resolve(result);
  type AnyFn = ReturnType<typeof vi.fn>;
  interface Chain {
    from: AnyFn; where: AnyFn; leftJoin: AnyFn; innerJoin: AnyFn;
    orderBy: AnyFn; limit: AnyFn;
    then: typeof p.then; catch: typeof p.catch; finally: typeof p.finally;
  }
  const c = {
    then: p.then.bind(p), catch: p.catch.bind(p), finally: p.finally.bind(p),
  } as unknown as Chain;
  c.from      = vi.fn().mockReturnValue(c);
  c.where     = vi.fn().mockReturnValue(c);
  c.leftJoin  = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.orderBy   = vi.fn().mockReturnValue(c);
  c.limit     = vi.fn().mockResolvedValue(result);
  return c;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A well-formed POST body — only the websiteCustomerId matters for this test. */
const offerBody = {
  websiteCustomerId: 99999,   // ID that will not be found in the DB
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2026-08-07",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  deliveryCosts:     "0.00",
  vatRate:           "19.00",
  notes:             null,
  vatNote:           null,
  items: [{
    productId:       null,
    productName:     "Implant Kit",
    sku:             null,
    description:     null,
    lotNumber:       null,
    hsCode:          null,
    countryOfOrigin: null,
    weightKg:        null,
    unitPrice:       "100.00",
    discountPercent: null,
    isDemo:          false,
    quantity:        1,
  }],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices/offer-pdf — rejects unknown websiteCustomerId", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
    updateReturning.mockReset();
    mockPdfDocument.mockReset();
  });

  it("returns 400 (not 200 or 500) when the websiteCustomerId does not exist in the DB", async () => {
    // Stage the customer lookup to return an empty array — customer not found
    mockDbSelect.mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(offerBody);

    // Must be 400 — the guard must fire, not pass through to PDF generation
    expect(res.status).toBe(400);

    // Must NOT be a success or an unhandled server error
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);

    // Response body must carry an error field
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it("returns 400 and does not produce a PDF content-type when the customer is missing", async () => {
    // Stage empty result again for this independent assertion
    mockDbSelect.mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(offerBody);

    expect(res.status).toBe(400);

    // Content-Type must be JSON, not PDF
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.headers["content-type"]).not.toMatch(/pdf/);
  });
});

describe("POST /iroc/invoices/offer-pdf — rejects invalid request bodies", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
    updateReturning.mockReset();
    mockPdfDocument.mockReset();
  });

  it.each([
    {
      name: "missing websiteCustomerId",
      body: (() => {
        const { websiteCustomerId: _websiteCustomerId, ...body } = offerBody;
        return body;
      })(),
    },
    {
      name: "empty items array",
      body: { ...offerBody, items: [] },
    },
    {
      name: "non-numeric vatRate",
      body: { ...offerBody, vatRate: "not-a-number" },
      customerLookup: true,
    },
    {
      name: "non-numeric line-item unitPrice",
      body: {
        ...offerBody,
        items: [{ ...offerBody.items[0], unitPrice: "not-a-number" }],
      },
    },
    {
      name: "invalid line-item quantity",
      body: {
        ...offerBody,
        items: [{ ...offerBody.items[0], quantity: 0 }],
      },
    },
    {
      name: "non-numeric delivery costs",
      body: { ...offerBody, deliveryCosts: "not-a-number" },
    },
  ])("returns 400 with an error for $name", async ({ body, customerLookup }) => {
    // The VAT value is schema-valid as a string, so it must also be rejected
    // by the endpoint's VAT normalization before PDF generation.
    if (customerLookup) {
      mockDbSelect.mockReturnValueOnce(selectChain([{ id: offerBody.websiteCustomerId }]));
    }

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
    expect(res.body).toHaveProperty("error");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);

    if (!customerLookup) {
      expect(mockDbSelect).not.toHaveBeenCalled();
      expect(mockPdfDocument).not.toHaveBeenCalled();
      expect(res.headers["content-type"]).toMatch(/json/);
      expect(res.headers["content-type"]).not.toMatch(/pdf/);
    }
  });
});
