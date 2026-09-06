/**
 * Integration test: POST /iroc/invoices — 7 % reduced VAT rate
 *
 * What & Why
 * ──────────
 * The admin invoice form now exposes a 7 % VAT rate option for domestic
 * invoices (reduced rate for certain medical supplies, etc.).  This test
 * confirms that:
 *
 *   1. The creation endpoint accepts vatRate "7.00" and returns a record
 *      with the correct vatAmount (7 % of subtotal) and total.
 *   2. A fractional vatRate value (0.07) is normalised to 7 before being
 *      stored, matching the API's normalisation guard.
 *   3. 7 % VAT also applies correctly when delivery costs are included in
 *      the taxable base (subtotal + delivery).
 *   4. Unauthenticated requests are rejected with 401.
 *
 * Hoisting note
 * ─────────────
 * vi.mock() factories run before ESM imports.  State shared between the
 * factory and the test body is initialised via vi.hoisted().
 *
 * Insert-chain mock note
 * ──────────────────────
 * The route calls db.insert(table).values({...}).returning(), so the mock
 * must chain: db.insert → { values: insertValues }, insertValues → { returning:
 * insertReturning }, insertReturning → Promise<row[]>.  A flat
 * mockResolvedValueOnce on insertValues alone would fail at .returning().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist shared mock state ────────────────────────────────────────────────────

const { mockDbSelect, mockDbInsert, insertValues, insertReturning } = vi.hoisted(() => {
  const insertReturning = vi.fn();
  const insertValues    = vi.fn().mockReturnValue({ returning: insertReturning });
  const mockDbInsert    = vi.fn().mockReturnValue({ values: insertValues });
  const mockDbSelect    = vi.fn();
  return { mockDbSelect, mockDbInsert, insertValues, insertReturning };
});

// ── Mock PDFKit (imported transitively; not exercised in these tests) ──────────
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

// ── Mock @workspace/db ────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select:      mockDbSelect,
    insert:      mockDbInsert,
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    execute:     vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  },
  irocInvoices:               { id: "id", invoiceNumber: "invoiceNumber", createdAt: "createdAt" },
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

// ── Import app AFTER mocks ────────────────────────────────────────────────────
import app from "../app";

// ── JWT helper (mirrors requireIrocAuth) ──────────────────────────────────────
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

/** Fluent select-chain that resolves to result via .then / .from / .where etc. */
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

/** Minimal website customer fixture. */
const WC = {
  id: 42, customerNr: "WC-042", salutation: "Herr", title: null,
  firstName: "Max", lastName: "Mustermann", institutionName: null, specialty: null,
  institutionType: null, address: "Teststr. 1", postalCode: "80001",
  city: "München", country: "Deutschland", phone: null, fax: null,
  email: "max@example.com", website: null, referenceNumber: null, ustIdNr: null,
  instrument: "iroc", notes: null, privacyConsent: true,
  shippingFirstName: null, shippingLastName: null, shippingInstitutionName: null,
  shippingAddress: null, shippingPostalCode: null, shippingCity: null,
  shippingCountry: null, shippingPhone: null, shippingEmail: null,
  createdAt: new Date(),
};

/** Minimal invoice item request body. */
function item(unitPrice: string, quantity = 1) {
  return {
    productId: null, productName: "Medical Supply A", sku: null,
    description: null, lotNumber: null, hsCode: null,
    countryOfOrigin: null, weightKg: null,
    unitPrice, discountPercent: null, isDemo: false, quantity,
  };
}

/** Build the invoice row that INSERT … RETURNING would emit. */
function makeInvoiceRow(overrides: Record<string, unknown>) {
  return {
    id: 99, invoiceNumber: "2026-0010", invoiceType: "domestic",
    websiteCustomerId: WC.id, customerId: null,
    issueDate: "2026-08-01", dueDate: null, orderNumber: null, referenceNumber: null,
    shippingMethod: null, reasonForExport: null, termsOfDelivery: null,
    insuranceCosts: "0.00", status: "draft", notes: null, vatNote: null, language: "de",
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices — 7 % reduced VAT rate", () => {

  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    insertValues.mockReset();
    insertReturning.mockReset();

    // Restore insert chain after reset
    mockDbInsert.mockReturnValue({ values: insertValues });
    insertValues.mockReturnValue({ returning: insertReturning });
  });

  /**
   * Stage the three db.select() calls the invoice creation route makes:
   *   1. websiteCustomer lookup — db.select().from(websiteCustomersTable).where(...)
   *   2. generateInvoiceNumber  — db.select({ n: ... }).from(irocInvoices).where(...)
   *   3. lineItems fetch        — db.select().from(irocInvoiceItems).where(...)
   *
   * Calls 1 and 3 have no field-selector argument; call 2 receives a field
   * object.  We track invocation count to distinguish calls 1 and 3.
   */
  function stageSelects() {
    let noFieldCallCount = 0;
    mockDbSelect.mockImplementation((fields?: unknown) => {
      if (fields) {
        // generateInvoiceNumber: db.select({ n: irocInvoices.invoiceNumber })
        return selectChain([]);           // no prior invoices → seq = 1
      }
      noFieldCallCount++;
      if (noFieldCallCount === 1) {
        // First no-field call: websiteCustomer lookup
        return selectChain([WC]);
      }
      // Subsequent no-field calls: lineItems fetch (return empty — no items stored in mock)
      return selectChain([]);
    });
  }

  // ── Test 1: vatAmount is 7 % of the taxable base ───────────────────────────

  it("persists vatAmount equal to 7 % of subtotal when vatRate is '7.00'", async () => {
    stageSelects();

    const invoiceRow = makeInvoiceRow({
      deliveryCosts: "0.00",
      subtotal:      "1000.00",
      vatRate:       "7.00",
      vatAmount:     "70.00",
      total:         "1070.00",
    });

    // db.insert(irocInvoices).values({...}).returning() → [invoiceRow]
    insertReturning.mockResolvedValueOnce([invoiceRow]);
    // db.insert(irocInvoiceItems).values([...]) → result ignored (no .returning())

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "domestic",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "7.00",
        notes:             null,
        vatNote:           null,
        items:             [item("1000.00")],
      });

    expect(res.status).toBe(201);
    expect(parseFloat((res.body as Record<string, string>).vatRate)).toBe(7);
    expect(parseFloat((res.body as Record<string, string>).vatAmount)).toBeCloseTo(70, 2);
    expect(parseFloat((res.body as Record<string, string>).total)).toBeCloseTo(1070, 2);
  });

  // ── Test 2: fractional vatRate (0.07) is normalised to 7 % ────────────────

  it("normalises a fractional vatRate 0.07 to 7 %", async () => {
    stageSelects();

    const invoiceRow = makeInvoiceRow({
      deliveryCosts: "0.00",
      subtotal:      "500.00",
      vatRate:       "7.00",
      vatAmount:     "35.00",
      total:         "535.00",
    });

    insertReturning.mockResolvedValueOnce([invoiceRow]);

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "domestic",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0.07",   // fractional — backend normalises to 7
        notes:             null,
        vatNote:           null,
        items:             [item("500.00")],
      });

    expect(res.status).toBe(201);
    expect(parseFloat((res.body as Record<string, string>).vatRate)).toBe(7);
    expect(parseFloat((res.body as Record<string, string>).vatAmount)).toBeCloseTo(35, 2);
  });

  // ── Test 3: 7 % VAT applies to subtotal + delivery costs ──────────────────

  it("applies 7 % VAT to subtotal + delivery costs combined", async () => {
    // subtotal=200, delivery=100 → taxable base=300 → vatAmount=21 → total=321
    stageSelects();

    const invoiceRow = makeInvoiceRow({
      deliveryCosts: "100.00",
      subtotal:      "200.00",
      vatRate:       "7.00",
      vatAmount:     "21.00",
      total:         "321.00",
    });

    insertReturning.mockResolvedValueOnce([invoiceRow]);

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "domestic",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "100.00",
        vatRate:           "7.00",
        notes:             null,
        vatNote:           null,
        items:             [item("200.00")],
      });

    expect(res.status).toBe(201);
    expect(parseFloat((res.body as Record<string, string>).vatAmount)).toBeCloseTo(21, 2);
    expect(parseFloat((res.body as Record<string, string>).total)).toBeCloseTo(321, 2);
  });

  // ── Test 4: unauthenticated requests rejected ────────────────────────────────

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app)
      .post("/api/iroc/invoices")
      .send({ websiteCustomerId: WC.id, invoiceType: "domestic" });

    expect(res.status).toBe(401);
  });

  // ── Test 5: 7 % VAT rejected for non-domestic (EU) invoice ───────────────────

  it("returns 422 when vatRate is '7.00' but invoiceType is 'eu'", async () => {
    stageSelects();

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "eu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "7.00",
        notes:             null,
        vatNote:           null,
        items:             [item("1000.00")],
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/domestic/);
  });

  // ── Test 6: 7 % VAT rejected for non-domestic (export) invoice ───────────────

  it("returns 422 when vatRate is '7.00' but invoiceType is 'export'", async () => {
    stageSelects();

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "export",
        language:          "en",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "7.00",
        notes:             null,
        vatNote:           null,
        items:             [item("1000.00")],
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
  });

  // ── Test 7: fractional 0.07 is also blocked for non-domestic after normalisation

  it("returns 422 when vatRate is '0.07' (fractional) but invoiceType is 'eu'", async () => {
    stageSelects();

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "eu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0.07",
        notes:             null,
        vatNote:           null,
        items:             [item("1000.00")],
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/domestic/);
  });

});

// ── PUT /iroc/invoices/:id — 7 % VAT guard ────────────────────────────────────

/** Fluent select-chain for the PUT describe block (mirrors the one above). */
function selectChainPut(result: unknown[]) {
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

const EXISTING_INVOICE = {
  id: 55, invoiceNumber: "2026-0055", invoiceType: "eu",
  websiteCustomerId: WC.id, customerId: null,
  issueDate: "2026-07-01", dueDate: null, status: "draft",
  vatRate: "0.00", vatAmount: "0.00", total: "800.00",
  subtotal: "800.00", deliveryCosts: "0.00", insuranceCosts: "0.00",
  notes: null, vatNote: null, language: "de",
  createdAt: new Date(), updatedAt: new Date(),
};

/** One item that satisfies the items.min(1) schema constraint. */
const ONE_ITEM = [{
  productId: null, productName: "Test Item", sku: null, description: null,
  lotNumber: null, hsCode: null, countryOfOrigin: null, weightKg: null,
  unitPrice: "500.00", discountPercent: null, isDemo: false, quantity: 1,
}];

/** Stage select calls for the PUT route: 1st = existing invoice, 2nd = website customer. */
function stagePutSelects() {
  let callCount = 0;
  mockDbSelect.mockImplementation((fields?: unknown) => {
    if (fields) return selectChainPut([]);
    callCount++;
    if (callCount === 1) return selectChainPut([EXISTING_INVOICE]);
    return selectChainPut([WC]);
  });
}

describe("PUT /iroc/invoices/:id — 7 % reduced VAT guard", () => {

  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    insertValues.mockReset();
    insertReturning.mockReset();

    mockDbInsert.mockReturnValue({ values: insertValues });
    insertValues.mockReturnValue({ returning: insertReturning });
  });

  it("returns 422 when PUT vatRate is '7.00' but invoiceType is 'eu'", async () => {
    stagePutSelects();

    const res = await request(app)
      .put("/api/iroc/invoices/55")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "eu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "7.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/domestic/);
  });

  // ── Fractional form (0.07) is also blocked after normalisation ───────────────

  it("returns 422 when PUT vatRate is '0.07' (fractional) but invoiceType is 'eu'", async () => {
    stagePutSelects();

    const res = await request(app)
      .put("/api/iroc/invoices/55")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "eu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0.07",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/domestic/);
  });

});
