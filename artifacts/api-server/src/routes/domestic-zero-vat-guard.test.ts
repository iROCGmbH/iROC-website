/**
 * Integration test: POST & PUT /iroc/invoices — domestic 0 % VAT guard
 *
 * What & Why
 * ──────────
 * Domestic invoices are subject to German VAT at 7 % (reduced) or 19 %
 * (standard).  A 0 % rate on a domestic invoice is tax-invalid and would
 * produce a legally incorrect PDF.  This test confirms that both the creation
 * (POST) and update (PUT) endpoints reject a domestic invoice with vatRate=0,
 * returning 400 before any write reaches the database.
 *
 * Tests:
 *   POST:
 *   1. vatRate=0 + invoiceType='domestic' → 400, error mentions 7 % / 19 %
 *   2. vatRate=19 + invoiceType='domestic' → 201 (valid, no rejection)
 *
 *   PUT:
 *   3. vatRate=0 + invoiceType='domestic' → 400, error mentions 7 % / 19 %
 *   4. vatRate=7 + invoiceType='domestic' → 200 (valid, no rejection)
 *
 * Follows the insert-chain mock pattern from invoice-creation-7pct-vat.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist shared mock state ────────────────────────────────────────────────────

const { mockDbSelect, mockDbInsert, insertValues, insertReturning, mockDbUpdateReturning, mockDbUpdateSet, mockDbDelete } = vi.hoisted(() => {
  const insertReturning    = vi.fn();
  const insertValues       = vi.fn().mockReturnValue({ returning: insertReturning });
  const mockDbInsert       = vi.fn().mockReturnValue({ values: insertValues });
  const mockDbSelect       = vi.fn();
  const mockDbUpdateReturning = vi.fn().mockResolvedValue([]);
  const mockDbUpdateWhere  = vi.fn().mockReturnValue({ returning: mockDbUpdateReturning });
  const mockDbUpdateSet    = vi.fn().mockReturnValue({ where: mockDbUpdateWhere });
  const mockDbDelete       = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  return { mockDbSelect, mockDbInsert, insertValues, insertReturning, mockDbUpdateReturning, mockDbUpdateSet, mockDbDelete };
});

// ── Mock PDFKit ───────────────────────────────────────────────────────────────
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
    update: vi.fn().mockReturnValue({ set: mockDbUpdateSet }),
    delete:      mockDbDelete,
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
  id: 10, customerNr: "WC-010", salutation: "Herr", title: null,
  firstName: "Hans", lastName: "Müller", institutionName: null, specialty: null,
  institutionType: null, address: "Kurfürstenstr. 5", postalCode: "10785",
  city: "Berlin", country: "Deutschland", phone: null, fax: null,
  email: "hans@example.com", website: null, referenceNumber: null, ustIdNr: null,
  instrument: "iroc", notes: null, privacyConsent: true,
  shippingFirstName: null, shippingLastName: null, shippingInstitutionName: null,
  shippingAddress: null, shippingPostalCode: null, shippingCity: null,
  shippingCountry: null, shippingPhone: null, shippingEmail: null,
  createdAt: new Date(),
};

/** Minimal invoice item. */
function item(unitPrice: string, quantity = 1) {
  return {
    productId: null, productName: "iROC Device", sku: null,
    description: null, lotNumber: null, hsCode: null,
    countryOfOrigin: null, weightKg: null,
    unitPrice, discountPercent: null, isDemo: false, quantity,
  };
}

/** Build the invoice row that INSERT … RETURNING would emit. */
function makeInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 55, invoiceNumber: "2026-0055", invoiceType: "domestic",
    websiteCustomerId: WC.id, customerId: null,
    issueDate: "2026-08-01", dueDate: null, orderNumber: null, referenceNumber: null,
    shippingMethod: null, reasonForExport: null, termsOfDelivery: null,
    deliveryCosts: "0.00", insuranceCosts: "0.00", subtotal: "1000.00",
    vatRate: "19.00", vatAmount: "190.00", total: "1190.00",
    status: "draft", notes: null, vatNote: null, language: "de",
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Stage select calls for POST /iroc/invoices:
 *   1st no-field call  → websiteCustomer lookup
 *   with-fields call   → generateInvoiceNumber (no prior invoices → seq = 1)
 *   subsequent calls   → empty (line-items fetch)
 */
function stagePostSelects() {
  let noFieldCallCount = 0;
  mockDbSelect.mockImplementation((fields?: unknown) => {
    if (fields) return selectChain([]);
    noFieldCallCount++;
    if (noFieldCallCount === 1) return selectChain([WC]);
    return selectChain([]);
  });
}

/**
 * Stage select calls for PUT /iroc/invoices/:id:
 *   1st no-field call  → existing invoice
 *   2nd no-field call  → websiteCustomer lookup
 *   3rd no-field call  → updated line-items fetch (post-write)
 */
function stagePutSelects(existingInvoice: Record<string, unknown>) {
  let noFieldCallCount = 0;
  mockDbSelect.mockImplementation((fields?: unknown) => {
    if (fields) return selectChain([]);
    noFieldCallCount++;
    if (noFieldCallCount === 1) return selectChain([existingInvoice]);
    if (noFieldCallCount === 2) return selectChain([WC]);
    return selectChain([]);  // 3rd call: updated line items — return empty list
  });
}

/** Base existing domestic invoice for PUT tests. */
const EXISTING_DOMESTIC = {
  id: 55, invoiceNumber: "2026-0055", invoiceType: "domestic",
  websiteCustomerId: WC.id, customerId: null,
  issueDate: "2026-08-01", dueDate: null, status: "draft",
  vatRate: "19.00", vatAmount: "190.00", total: "1190.00",
  subtotal: "1000.00", deliveryCosts: "0.00", insuranceCosts: "0.00",
  notes: null, vatNote: null, language: "de",
  createdAt: new Date(), updatedAt: new Date(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices — domestic 0 % VAT guard", () => {

  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    insertValues.mockReset();
    insertReturning.mockReset();

    mockDbInsert.mockReturnValue({ values: insertValues });
    insertValues.mockReturnValue({ returning: insertReturning });
  });

  it("returns 400 when vatRate is '0' and invoiceType is 'domestic'", async () => {
    stagePostSelects();

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
        vatRate:           "0",
        notes:             null,
        vatNote:           null,
        items:             [item("1000.00")],
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/19 %/);
    // Confirm no insert was attempted
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("returns 400 when vatRate is '0.00' and invoiceType is 'domestic'", async () => {
    stagePostSelects();

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
        vatRate:           "0.00",
        notes:             null,
        vatNote:           null,
        items:             [item("1000.00")],
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/19 %/);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("accepts vatRate=19 with invoiceType 'domestic' and creates the invoice", async () => {
    stagePostSelects();

    const invoiceRow = makeInvoiceRow({ vatRate: "19.00", vatAmount: "190.00", total: "1190.00" });
    insertReturning.mockResolvedValueOnce([invoiceRow]);
    // items insert
    insertReturning.mockResolvedValueOnce([]);

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
        vatRate:           "19",
        notes:             null,
        vatNote:           null,
        items:             [item("1000.00")],
      });

    expect(res.status).toBe(201);
    expect(parseFloat((res.body as typeof invoiceRow).vatRate)).toBe(19);
  });

});

describe("PUT /iroc/invoices/:id — domestic 0 % VAT guard", () => {

  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    insertValues.mockReset();
    insertReturning.mockReset();
    mockDbUpdateSet.mockReset();
    mockDbUpdateReturning.mockReset();
    mockDbDelete.mockReset();

    mockDbInsert.mockReturnValue({ values: insertValues });
    insertValues.mockReturnValue({ returning: insertReturning });
    // Rebuild the update chain: .set().where().returning()
    mockDbUpdateReturning.mockResolvedValue([]);
    const mockDbUpdateWhere = vi.fn().mockReturnValue({ returning: mockDbUpdateReturning });
    mockDbUpdateSet.mockReturnValue({ where: mockDbUpdateWhere });
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  });

  it("returns 400 when PUT vatRate is '0' and invoiceType is 'domestic'", async () => {
    stagePutSelects(EXISTING_DOMESTIC);

    const res = await request(app)
      .put("/api/iroc/invoices/55")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "domestic",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0",
        notes:             null,
        vatNote:           null,
        items:             [item("1000.00")],
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/7 %/);
    expect((res.body as { error: string }).error).toMatch(/19 %/);
    // Confirm no update was attempted
    expect(mockDbUpdateSet).not.toHaveBeenCalled();
  });

  it("accepts vatRate=7 with invoiceType 'domestic' and updates the invoice", async () => {
    stagePutSelects(EXISTING_DOMESTIC);

    const updatedRow = makeInvoiceRow({ vatRate: "7.00", vatAmount: "70.00", total: "1070.00" });
    mockDbUpdateReturning.mockResolvedValueOnce([updatedRow]);
    // delete + re-insert items
    insertReturning.mockResolvedValue([]);

    const res = await request(app)
      .put("/api/iroc/invoices/55")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "domestic",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "7",
        notes:             null,
        vatNote:           null,
        items:             [item("1000.00")],
      });

    expect(res.status).toBe(200);
    expect(parseFloat((res.body as typeof updatedRow).vatRate)).toBe(7);
  });

});
