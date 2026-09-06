/**
 * Integration test: POST & PUT /iroc/invoices — lecture type vs. 7 % VAT guard
 *
 * What & Why
 * ──────────
 * The API has a guard that rejects any invoice where vatRate=7 and invoiceType
 * is not "domestic".  The two lecture invoice types (`lecture-eu`, `lecture-noneu`)
 * are non-domestic and must always carry 0 % VAT.  This test confirms that:
 *
 *   POST:
 *   1. vatRate=7 + invoiceType='lecture-eu'    → rejected with 400 (guard fires).
 *   2. vatRate=7 + invoiceType='lecture-noneu' → rejected with 400 (guard fires).
 *   3. vatRate=0 + invoiceType='lecture-eu'    → accepted (201), stored invoiceType
 *      value equals 'lecture-eu'.
 *   4. vatRate=0 + invoiceType='lecture-noneu' → accepted (201), stored invoiceType
 *      value equals 'lecture-noneu'.
 *
 *   PUT:
 *   5. vatRate=7 + invoiceType='lecture-eu'    → rejected with 400 (guard fires).
 *   6. vatRate=7 + invoiceType='lecture-noneu' → rejected with 400 (guard fires).
 *
 * Follows the insert-chain mock pattern from invoice-creation-7pct-vat.test.ts.
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
    widthOfString()  { return 10; }
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

/** Fluent select-chain that resolves to result. */
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
  email: "max@example.com", website: null, referenceNumber: null, ustIdNr: "DE123456789",
  instrument: "iroc", notes: null, privacyConsent: true,
  shippingFirstName: null, shippingLastName: null, shippingInstitutionName: null,
  shippingAddress: null, shippingPostalCode: null, shippingCity: null,
  shippingCountry: null, shippingPhone: null, shippingEmail: null,
  createdAt: new Date(),
};

/** Minimal invoice item. */
function item(unitPrice: string, quantity = 1) {
  return {
    productId: null, productName: "Lecture Fee", sku: null,
    description: null, lotNumber: null, hsCode: null,
    countryOfOrigin: null, weightKg: null,
    unitPrice, discountPercent: null, isDemo: false, quantity,
  };
}

/** Build the invoice row that INSERT … RETURNING would emit. */
function makeInvoiceRow(overrides: Record<string, unknown>) {
  return {
    id: 99, invoiceNumber: "2026-0099", invoiceType: "lecture-eu",
    websiteCustomerId: WC.id, customerId: null,
    issueDate: "2026-08-01", dueDate: null, orderNumber: null, referenceNumber: null,
    shippingMethod: null, reasonForExport: null, termsOfDelivery: null,
    deliveryCosts: "0.00", insuranceCosts: "0.00", subtotal: "800.00",
    vatRate: "0.00", vatAmount: "0.00", total: "800.00",
    status: "draft", notes: null, vatNote: null, language: "de",
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Stage the three db.select() calls POST /iroc/invoices makes:
 *   1. websiteCustomer lookup  (no fields arg, first call)
 *   2. generateInvoiceNumber   (with fields arg)
 *   3. lineItems fetch         (no fields arg, subsequent calls)
 */
function stagePostSelects() {
  let noFieldCallCount = 0;
  mockDbSelect.mockImplementation((fields?: unknown) => {
    if (fields) {
      // generateInvoiceNumber: no prior invoices → seq = 1
      return selectChain([]);
    }
    noFieldCallCount++;
    if (noFieldCallCount === 1) return selectChain([WC]);
    return selectChain([]);
  });
}

// ── POST /iroc/invoices — lecture types vs. 7 % VAT guard ─────────────────────

describe("POST /iroc/invoices — lecture types vs. 7 % VAT guard", () => {

  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    insertValues.mockReset();
    insertReturning.mockReset();

    mockDbInsert.mockReturnValue({ values: insertValues });
    insertValues.mockReturnValue({ returning: insertReturning });
  });

  // ── Test 1: vatRate=7 + lecture-eu → 400 ──────────────────────────────────

  it("returns 400 when vatRate is '7.00' and invoiceType is 'lecture-eu'", async () => {
    stagePostSelects();

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "7.00",
        notes:             null,
        vatNote:           null,
        items:             [item("800.00")],
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/domestic/);
  });

  // ── Test 2: vatRate=7 + lecture-noneu → 400 ───────────────────────────────

  it("returns 400 when vatRate is '7.00' and invoiceType is 'lecture-noneu'", async () => {
    stagePostSelects();

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-noneu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "7.00",
        notes:             null,
        vatNote:           null,
        items:             [item("800.00")],
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/domestic/);
  });

  // ── Test 3: vatRate=0 + lecture-eu → 201, invoiceType stored correctly ─────

  it("accepts vatRate=0 with invoiceType 'lecture-eu' and stores the correct type", async () => {
    stagePostSelects();

    const invoiceRow = makeInvoiceRow({ invoiceType: "lecture-eu" });
    insertReturning.mockResolvedValueOnce([invoiceRow]);

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0.00",
        notes:             null,
        vatNote:           null,
        items:             [item("800.00")],
      });

    expect(res.status).toBe(201);
    expect((res.body as typeof invoiceRow).invoiceType).toBe("lecture-eu");
    expect(parseFloat((res.body as typeof invoiceRow).vatRate)).toBe(0);
  });

  // ── Test 4: vatRate=0 + lecture-noneu → 201, invoiceType stored correctly ──

  it("accepts vatRate=0 with invoiceType 'lecture-noneu' and stores the correct type", async () => {
    stagePostSelects();

    const invoiceRow = makeInvoiceRow({ invoiceType: "lecture-noneu" });
    insertReturning.mockResolvedValueOnce([invoiceRow]);

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-noneu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0.00",
        notes:             null,
        vatNote:           null,
        items:             [item("800.00")],
      });

    expect(res.status).toBe(201);
    expect((res.body as typeof invoiceRow).invoiceType).toBe("lecture-noneu");
    expect(parseFloat((res.body as typeof invoiceRow).vatRate)).toBe(0);
  });

});

// ── PUT /iroc/invoices/:id — lecture types vs. 7 % VAT guard ──────────────────

const EXISTING_LECTURE_INVOICE = {
  id: 77, invoiceNumber: "2026-0077", invoiceType: "lecture-eu",
  websiteCustomerId: WC.id, customerId: null,
  issueDate: "2026-07-01", dueDate: null, status: "draft",
  vatRate: "0.00", vatAmount: "0.00", total: "600.00",
  subtotal: "600.00", deliveryCosts: "0.00",
  notes: null, vatNote: null, language: "de",
  createdAt: new Date(), updatedAt: new Date(),
};

const ONE_ITEM = [{
  productId: null, productName: "Lecture Fee", sku: null, description: null,
  lotNumber: null, hsCode: null, countryOfOrigin: null, weightKg: null,
  unitPrice: "600.00", discountPercent: null, isDemo: false, quantity: 1,
}];

/**
 * Stage select calls for PUT route:
 *   1st no-field call  → existing invoice
 *   2nd no-field call  → website customer
 *   with-fields call   → generateInvoiceNumber (unused by PUT, but guard on mock)
 */
function stagePutSelects() {
  let noFieldCallCount = 0;
  mockDbSelect.mockImplementation((fields?: unknown) => {
    if (fields) return selectChain([]);
    noFieldCallCount++;
    if (noFieldCallCount === 1) return selectChain([EXISTING_LECTURE_INVOICE]);
    return selectChain([WC]);
  });
}

describe("PUT /iroc/invoices/:id — lecture types vs. 7 % VAT guard", () => {

  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    insertValues.mockReset();
    insertReturning.mockReset();

    mockDbInsert.mockReturnValue({ values: insertValues });
    insertValues.mockReturnValue({ returning: insertReturning });
  });

  // ── Test 5: vatRate=7 + lecture-eu → 400 ──────────────────────────────────

  it("returns 400 when PUT vatRate is '7.00' and invoiceType is 'lecture-eu'", async () => {
    stagePutSelects();

    const res = await request(app)
      .put("/api/iroc/invoices/77")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "7.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/domestic/);
  });

  // ── Test 6: vatRate=7 + lecture-noneu → 400 ───────────────────────────────

  it("returns 400 when PUT vatRate is '7.00' and invoiceType is 'lecture-noneu'", async () => {
    stagePutSelects();

    const res = await request(app)
      .put("/api/iroc/invoices/77")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-noneu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "7.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/domestic/);
  });

});
