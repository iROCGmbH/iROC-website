/**
 * Integration test: PUT /iroc/invoices/:id — invoice type / VAT rate compatibility guard
 *
 * What & Why
 * ──────────
 * When an admin changes an invoice's type (e.g. domestic → EU) the saved VAT
 * rate must be compatible with the new type.  Non-domestic types (eu, noneu,
 * export, lecture-eu, lecture-noneu) must always carry 0 % VAT; any non-zero
 * rate on these types is tax-invalid and must be rejected at the API level so
 * the UI cannot accidentally save an ill-formed invoice.
 *
 * Tests
 * ─────
 *   PUT — incompatible combos (expect 422 for eu/noneu/export, 400 for lecture types):
 *   1. invoiceType='eu'          + vatRate=19  → rejected
 *   2. invoiceType='noneu'       + vatRate=19  → rejected
 *   3. invoiceType='export'      + vatRate=19  → rejected
 *   4. invoiceType='lecture-eu'  + vatRate=19  → rejected
 *   5. invoiceType='lecture-noneu' + vatRate=19 → rejected
 *
 *   PUT — compatible combos (expect 200):
 *   6. invoiceType='eu'       + vatRate=0   → accepted
 *   7. invoiceType='domestic' + vatRate=19  → accepted
 *
 * POST — incompatible combo (expect 422):
 *   8. invoiceType='eu' + vatRate=19 → rejected at creation too
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist shared mock state ────────────────────────────────────────────────────

const { mockDbSelect, mockDbUpdate, updateSet, updateWhere, mockDbInsert, insertValues, insertReturning, mockDbDelete } =
  vi.hoisted(() => {
    const insertReturning = vi.fn();
    const insertValues    = vi.fn().mockReturnValue({ returning: insertReturning });
    const mockDbInsert    = vi.fn().mockReturnValue({ values: insertValues });
    const updateWhere     = vi.fn();
    const updateSet       = vi.fn().mockReturnValue({ where: updateWhere });
    const mockDbUpdate    = vi.fn().mockReturnValue({ set: updateSet });
    const mockDbSelect    = vi.fn();
    const mockDbDelete    = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    return { mockDbSelect, mockDbUpdate, updateSet, updateWhere, mockDbInsert, insertValues, insertReturning, mockDbDelete };
  });

// ── Mock PDFKit (imported transitively; not exercised here) ───────────────────

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
    update:      mockDbUpdate,
    delete:      mockDbDelete,
    execute:     vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  },
  irocInvoices:               { id: "id", invoiceNumber: "invoiceNumber", createdAt: "createdAt", status: "status" },
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal website customer. */
const WC = {
  id: 10, customerNr: "WC-010", salutation: "Frau", title: null,
  firstName: "Anna", lastName: "Muster", institutionName: null, specialty: null,
  institutionType: null, address: "Musterstr. 5", postalCode: "10115",
  city: "Berlin", country: "Frankreich", phone: null, fax: null,
  email: "anna@example.com", website: null, referenceNumber: null, ustIdNr: "FR12345678901",
  instrument: "iroc", notes: null, privacyConsent: true,
  shippingFirstName: null, shippingLastName: null, shippingInstitutionName: null,
  shippingAddress: null, shippingPostalCode: null, shippingCity: null,
  shippingCountry: null, shippingPhone: null, shippingEmail: null,
  createdAt: new Date(),
};

/** Existing invoice stored as 'domestic' with 19 % VAT — the 'before' state. */
const EXISTING_INVOICE = {
  id: 55, invoiceNumber: "2026-0055", invoiceType: "domestic",
  websiteCustomerId: WC.id, customerId: null,
  issueDate: "2026-07-01", dueDate: null, status: "draft",
  vatRate: "19.00", vatAmount: "190.00", total: "1190.00", insuranceCosts: "0.00",
  subtotal: "1000.00", deliveryCosts: "0.00",
  notes: null, vatNote: null, language: "de",
  orderNumber: null, referenceNumber: null, shippingMethod: null,
  reasonForExport: null, termsOfDelivery: null,
  createdAt: new Date(), updatedAt: new Date(),
};

/** Minimal line item for the request body. */
const ONE_ITEM = [{
  productId: null, productName: "iROC Device", sku: null, description: null,
  lotNumber: null, hsCode: null, countryOfOrigin: null, weightKg: null,
  unitPrice: "1000.00", discountPercent: null, isDemo: false, quantity: 1,
}];

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

/**
 * Stage select calls for PUT /iroc/invoices/:id:
 *   1st no-field call → existing invoice
 *   2nd no-field call → website customer
 *   3rd no-field call → updated line items (after replace)
 *   with-fields call  → generateInvoiceNumber (not used by PUT but guard must pass)
 */
function stagePutSelects() {
  let noFieldCallCount = 0;
  mockDbSelect.mockImplementation((fields?: unknown) => {
    if (fields) return selectChain([]);
    noFieldCallCount++;
    if (noFieldCallCount === 1) return selectChain([EXISTING_INVOICE]);
    if (noFieldCallCount === 2) return selectChain([WC]);
    return selectChain([]); // line-items fetch after replace
  });
}

/**
 * Stage select calls for POST /iroc/invoices:
 *   1st no-field call → website customer lookup
 *   2nd no-field call → line-items fetch (after insert)
 *   with-fields call  → generateInvoiceNumber → empty → seq=1
 */
function stagePostSelects() {
  let noFieldCallCount = 0;
  mockDbSelect.mockImplementation((fields?: unknown) => {
    if (fields) return selectChain([]); // no prior invoices → seq=1
    noFieldCallCount++;
    if (noFieldCallCount === 1) return selectChain([WC]);
    return selectChain([]);
  });
}

// ── PUT /iroc/invoices/:id — type / VAT incompatibility guard ─────────────────

describe("PUT /iroc/invoices/:id — invoice type / VAT rate compatibility guard", () => {

  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    insertValues.mockReset();
    insertReturning.mockReset();
    mockDbUpdate.mockReset();
    mockDbDelete.mockReset();

    mockDbInsert.mockReturnValue({ values: insertValues });
    insertValues.mockReturnValue({ returning: insertReturning });
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  });

  // ── Test 1: invoiceType='eu' + vatRate=19 → 400 ───────────────────────────

  it("returns 422 when switching type to 'eu' while vatRate is 19 %", async () => {
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
        vatRate:           "19.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/eu/i);
    expect((res.body as { error: string }).error).toMatch(/0 %/);
  });

  // ── Test 2: invoiceType='noneu' + vatRate=19 → 400 ───────────────────────

  it("returns 422 when switching type to 'noneu' while vatRate is 19 %", async () => {
    stagePutSelects();

    const res = await request(app)
      .put("/api/iroc/invoices/55")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "noneu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "19.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/0 %/);
  });

  // ── Test 3: invoiceType='export' + vatRate=19 → 400 ─────────────────────

  it("returns 422 when switching type to 'export' while vatRate is 19 %", async () => {
    stagePutSelects();

    const res = await request(app)
      .put("/api/iroc/invoices/55")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "export",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "19.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/0 %/);
  });

  // ── Test 4: invoiceType='lecture-eu' + vatRate=19 → 400 ──────────────────

  it("returns 400 when switching type to 'lecture-eu' while vatRate is 19 %", async () => {
    stagePutSelects();

    const res = await request(app)
      .put("/api/iroc/invoices/55")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "19.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/0 %/);
  });

  // ── Test 5: invoiceType='lecture-noneu' + vatRate=19 → 400 ───────────────

  it("returns 400 when switching type to 'lecture-noneu' while vatRate is 19 %", async () => {
    stagePutSelects();

    const res = await request(app)
      .put("/api/iroc/invoices/55")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-noneu",
        language:          "de",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "19.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/0 %/);
  });

  // ── Test 6: invoiceType='eu' + vatRate=0 → 200 (compatible) ──────────────

  it("accepts the change when switching type to 'eu' with vatRate=0 (compatible)", async () => {
    stagePutSelects();

    // Simulate the invoice row returned by UPDATE … RETURNING
    const updatedRow = {
      ...EXISTING_INVOICE,
      invoiceType: "eu",
      vatRate: "0.00",
      vatAmount: "0.00",
      total: "1000.00",
    };
    const updateReturning = vi.fn().mockResolvedValueOnce([updatedRow]);
    const updateWhereFn   = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSetFn     = vi.fn().mockReturnValue({ where: updateWhereFn });
    mockDbUpdate.mockReturnValue({ set: updateSetFn });

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
        vatRate:           "0.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(200);
    expect((res.body as typeof updatedRow).invoiceType).toBe("eu");
    expect(parseFloat((res.body as typeof updatedRow).vatRate)).toBe(0);
  });

  it("returns 422 when an 'eu' invoice carries a §3a service VAT note", async () => {
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
        vatRate:           "0.00",
        notes:             null,
        vatNote:           "** Sonstige Leistung gemäß § 3a Abs. 2 UStG (Reverse Charge)",
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/lecture-eu/);
    expect((res.body as { error: string }).error).toMatch(/§3a/);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  // ── Test 7: invoiceType='domestic' + vatRate=19 → 200 (compatible) ───────

  it("accepts a domestic invoice with 19 % VAT (standard domestic rate)", async () => {
    stagePutSelects();

    const updatedRow = {
      ...EXISTING_INVOICE,
      invoiceType: "domestic",
      vatRate: "19.00",
      vatAmount: "190.00",
      total: "1190.00",
    };
    const updateReturning = vi.fn().mockResolvedValueOnce([updatedRow]);
    const updateWhereFn   = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSetFn     = vi.fn().mockReturnValue({ where: updateWhereFn });
    mockDbUpdate.mockReturnValue({ set: updateSetFn });

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
        vatRate:           "19.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(200);
    expect((res.body as typeof updatedRow).invoiceType).toBe("domestic");
    expect(parseFloat((res.body as typeof updatedRow).vatRate)).toBe(19);
  });

});

// ── POST /iroc/invoices — type / VAT incompatibility guard ────────────────────

describe("POST /iroc/invoices — invoice type / VAT rate compatibility guard", () => {

  beforeEach(() => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    insertValues.mockReset();
    insertReturning.mockReset();
    mockDbUpdate.mockReset();
    mockDbDelete.mockReset();

    mockDbInsert.mockReturnValue({ values: insertValues });
    insertValues.mockReturnValue({ returning: insertReturning });
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  });

  // ── Test 8: POST with invoiceType='eu' + vatRate=19 → 400 ────────────────

  it("returns 422 when creating an 'eu' invoice with vatRate=19 %", async () => {
    stagePostSelects();

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
        vatRate:           "19.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/eu/i);
    expect((res.body as { error: string }).error).toMatch(/0 %/);
  });

  it("returns 422 when creating an 'eu' invoice with a §3a service VAT note", async () => {
    stagePostSelects();

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
        vatRate:           "0.00",
        notes:             null,
        vatNote:           "** Service gemäß § 3a Abs. 2 UStG (Reverse Charge)",
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toMatch(/lecture-eu/);
    expect((res.body as { error: string }).error).toMatch(/§3a/);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

});
