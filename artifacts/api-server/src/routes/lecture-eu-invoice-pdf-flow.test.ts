/**
 * End-to-end integration test: lecture-eu invoice save → PDF label
 *
 * What & Why
 * ──────────
 * The vatLabel fix for lecture-eu invoices is already verified at the
 * PDF-generation layer (vat-rate-pdf.test.ts).  This test closes the
 * remaining gap: confirming that the admin invoice form path — i.e. the
 * POST (create) and PUT (update) API routes — correctly persists
 * invoiceType="lecture-eu" and that the PDF endpoint driven by the saved
 * row returns the bare "VAT**" label with no rate digit.
 *
 * A form bug that accidentally submits invoiceType="domestic" would bypass
 * the PDF fix; these tests confirm that cannot happen silently.
 *
 * Design
 * ──────
 * The key constraint: the PDF phase of each combined-flow test must consume
 * state derived from the write, not from a hand-built fixture.  This is
 * achieved by making insertReturning / updateReturning dynamically build
 * the saved row from the payload captured at insertValues / updateSet.  The
 * same captured payload is then used to stage the db.select() calls for the
 * PDF endpoint.  If the route passes the wrong invoiceType to the DB, the
 * PDF phase reads that wrong type and the VAT label assertion fails —
 * exactly catching the regression this test guards against.
 *
 * Scenarios covered
 * ─────────────────
 *   POST:
 *   1. POST vatRate=0 + invoiceType=lecture-eu → 201; write payload contains
 *      invoiceType="lecture-eu" and vatRate="0.00".
 *   2. POST vatRate=7 + invoiceType=lecture-eu → 400; INSERT never called.
 *
 *   PUT:
 *   3. PUT vatRate=0 + invoiceType=lecture-eu → 200; write payload contains
 *      invoiceType="lecture-eu" and vatRate="0.00".
 *   4. PUT vatRate=7 + invoiceType=lecture-eu → 400; UPDATE never called.
 *
 *   Combined flows (save → PDF):
 *   5. POST lecture-eu → PDF → "VAT**" confirmed; PDF driven by what was
 *      actually inserted, not a hand-built fixture.
 *   6. PUT lecture-eu → PDF → "VAT**" confirmed; PDF driven by what was
 *      actually set in the update, not a hand-built fixture.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist all shared mock state ───────────────────────────────────────────────

const {
  pdfState,
  mockDbSelect,
  mockDbInsert,
  insertValues,
  insertReturning,
  updateReturning,
  updateWhere,
  updateSet,
  mockDbUpdate,
  deleteWhere,
  mockDbDelete,
} = vi.hoisted(() => {
  const pdfState = { capturedText: [] as string[] };

  // INSERT chain: db.insert(t).values(payload).returning()
  const insertReturning = vi.fn();
  const insertValues    = vi.fn().mockReturnValue({ returning: insertReturning });
  const mockDbInsert    = vi.fn().mockReturnValue({ values: insertValues });

  // UPDATE chain: db.update(t).set(payload).where(...).returning()
  const updateReturning = vi.fn();
  const updateWhere     = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet       = vi.fn().mockReturnValue({ where: updateWhere });
  const mockDbUpdate    = vi.fn().mockReturnValue({ set: updateSet });

  // DELETE chain: db.delete(t).where(...)
  const deleteWhere  = vi.fn().mockResolvedValue([]);
  const mockDbDelete = vi.fn().mockReturnValue({ where: deleteWhere });

  // SELECT — configured per-test via mockImplementation
  const mockDbSelect = vi.fn();

  return {
    pdfState,
    mockDbSelect, mockDbInsert, insertValues, insertReturning,
    updateReturning, updateWhere, updateSet, mockDbUpdate,
    deleteWhere, mockDbDelete,
  };
});

// ── Mock PDFKit — text-capturing (same pattern as vat-rate-pdf.test.ts) ───────

vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");

  class MockPDFDocument extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y    = 0;

    constructor(_opts?: unknown) { super(); }

    text(str: string, ..._rest: unknown[]) {
      if (typeof str === "string") pdfState.capturedText.push(str);
      return this;
    }

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
    heightOfString() { return 10; }
    widthOfString()  { return 10; }
    rotate()         { return this; }
    opacity()        { return this; }
    switchToPage()   { return this; }
    flushPages()     { return this; }
    bufferedPageRange() { return { start: 0, count: 1 }; }

    end(cb?: () => void) { super.end(cb); return this; }
  }

  return { default: MockPDFDocument };
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal website customer — used both for customer lookup in POST and PDF. */
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

/** One invoice item used as the POST/PUT body. */
const ONE_ITEM = [{
  productId: null, productName: "Lecture Fee", sku: null, description: null,
  lotNumber: null, hsCode: null, countryOfOrigin: null, weightKg: null,
  unitPrice: "800.00", discountPercent: null, isDemo: false, quantity: 1,
}];

// ── Select-chain helper ───────────────────────────────────────────────────────

/** Fluent select-chain that resolves to `result`. */
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
 * Stage db.select() calls for POST /iroc/invoices:
 *   1st no-field call → websiteCustomer lookup → [WC]
 *   with-fields call  → generateInvoiceNumber → []  (seq = 1)
 *   subsequent calls  → lineItems fetch → []
 */
function stagePostSelects() {
  let noFieldCount = 0;
  mockDbSelect.mockImplementation((fields?: unknown) => {
    if (fields) return selectChain([]);   // generateInvoiceNumber
    noFieldCount++;
    if (noFieldCount === 1) return selectChain([WC]);
    return selectChain([]);               // lineItems
  });
}

/**
 * Stage db.select() calls for PUT /iroc/invoices/:id:
 *   1st no-field call → existing invoice
 *   2nd no-field call → websiteCustomer lookup → [WC]
 *   with-fields call  → not used, but guard on mock
 *   subsequent calls  → lineItems after PUT
 */
function stagePutSelects(existingInvoice: Record<string, unknown>) {
  let noFieldCount = 0;
  mockDbSelect.mockImplementation((fields?: unknown) => {
    if (fields) return selectChain([]);
    noFieldCount++;
    if (noFieldCount === 1) return selectChain([existingInvoice]);
    if (noFieldCount === 2) return selectChain([WC]);
    return selectChain([]);   // lineItems
  });
}

/**
 * Stage db.select() calls for GET /iroc/invoices/:id/pdf.
 *
 * The PDF route does:
 *   1. irocInvoices lookup → invoice row
 *   2a. If invoice.websiteCustomerId is set → websiteCustomersTable → [WC]
 *   2b. Else if invoice.customerId is set   → irocCustomers         → [customer]
 *   3. irocInvoiceItems → a complete persisted lecture line
 *
 * This function inspects the invoice to serve the right customer record.
 */
function stagePdfSelects(invoice: Record<string, unknown>) {
  let noFieldCount = 0;
  mockDbSelect.mockImplementation(() => {
    noFieldCount++;
    if (noFieldCount === 1) return selectChain([invoice]);           // irocInvoices
    if (noFieldCount === 2) {
      // Route prefers websiteCustomerId
      if (invoice.websiteCustomerId) return selectChain([WC]);       // websiteCustomersTable
      return selectChain([{ id: invoice.customerId, name: "Test", address: "Str 1",
        postalCode: "80331", city: "München", country: "Germany",
        email: "t@t.de", salutation: null, title: null, company: null,
        vatId: null, isEu: false, phone: null, notes: null,
        createdAt: new Date(), updatedAt: new Date() }]);             // irocCustomers
    }
    return selectChain([{
      id: 1,
      invoiceId: invoice.id,
      ...ONE_ITEM[0],
      lineTotal: ONE_ITEM[0].unitPrice,
      vatRate: "0.00",
    }]);                                                              // irocInvoiceItems
  });
}

// ── beforeEach reset helper ───────────────────────────────────────────────────

function resetMocks() {
  pdfState.capturedText = [];
  mockDbSelect.mockReset();
  mockDbInsert.mockReset().mockReturnValue({ values: insertValues });
  insertValues.mockReset().mockReturnValue({ returning: insertReturning });
  insertReturning.mockReset();
  mockDbUpdate.mockReset().mockReturnValue({ set: updateSet });
  updateSet.mockReset().mockReturnValue({ where: updateWhere });
  updateWhere.mockReset().mockReturnValue({ returning: updateReturning });
  updateReturning.mockReset();
  mockDbDelete.mockReset().mockReturnValue({ where: deleteWhere });
  deleteWhere.mockReset().mockResolvedValue([]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices — lecture-eu write payload", () => {

  beforeEach(resetMocks);

  // ── Test 1: write payload confirmed ───────────────────────────────────────

  it("persists invoiceType='lecture-eu' and vatRate='0.00' in the INSERT payload", async () => {
    stagePostSelects();

    // insertValues captures the payload; insertReturning returns it as the saved row
    insertReturning.mockImplementationOnce(async () => {
      const payload = insertValues.mock.calls[0][0] as Record<string, unknown>;
      return [{
        id: 99, invoiceNumber: "2026-0099",
        status: "draft", insuranceCosts: "0.00", createdAt: new Date(), updatedAt: new Date(),
        ...payload,
      }];
    });

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "en",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(201);

    // Assert the actual payload written to the database (first call = invoice row)
    expect(insertValues).toHaveBeenCalled();
    const writtenPayload = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(writtenPayload.invoiceType).toBe("lecture-eu");
    expect(writtenPayload.vatRate).toBe("0.00");

    // Response body also reflects the saved type
    expect((res.body as Record<string, unknown>).invoiceType).toBe("lecture-eu");
  });

  // ── Test 2: 7 % guard — INSERT never called ───────────────────────────────

  it("returns 400 for vatRate=7 + invoiceType=lecture-eu and never calls INSERT", async () => {
    stagePostSelects();

    const res = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "en",
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

    // The guard must fire before the INSERT — no invoice is ever persisted
    expect(insertValues).not.toHaveBeenCalled();
  });

});

// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /iroc/invoices/:id — lecture-eu write payload on update", () => {

  /** Existing draft EU invoice that will be edited to lecture-eu. */
  const EXISTING_EU = {
    id: 77, invoiceNumber: "2026-0077", invoiceType: "eu",
    websiteCustomerId: null, customerId: null,
    issueDate: "2026-07-01", dueDate: null, status: "draft",
    vatRate: "0.00", vatAmount: "0.00", total: "600.00",
    subtotal: "600.00", deliveryCosts: "0.00",
    notes: null, vatNote: null, language: "en",
    createdAt: new Date(), updatedAt: new Date(),
  };

  beforeEach(resetMocks);

  // ── Test 3: write payload confirmed ───────────────────────────────────────

  it("persists invoiceType='lecture-eu' and vatRate='0.00' in the UPDATE payload", async () => {
    stagePutSelects(EXISTING_EU);

    // updateSet captures the set-payload; updateReturning returns it as the saved row
    updateReturning.mockImplementationOnce(async () => {
      const payload = updateSet.mock.calls[0][0] as Record<string, unknown>;
      return [{
        id: 77, invoiceNumber: "2026-0077",
        status: "draft", insuranceCosts: "0.00", createdAt: new Date(), updatedAt: new Date(),
        ...payload,
      }];
    });

    const res = await request(app)
      .put("/api/iroc/invoices/77")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "en",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(res.status).toBe(200);

    // Assert the actual payload written to the database
    expect(updateSet).toHaveBeenCalledOnce();
    const writtenPayload = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(writtenPayload.invoiceType).toBe("lecture-eu");
    expect(writtenPayload.vatRate).toBe("0.00");

    // Response body also reflects the saved type
    expect((res.body as Record<string, unknown>).invoiceType).toBe("lecture-eu");
  });

  // ── Test 4: 7 % guard — UPDATE never called ───────────────────────────────

  it("returns 400 for vatRate=7 + invoiceType=lecture-eu on PUT and never calls UPDATE", async () => {
    stagePutSelects(EXISTING_EU);

    const res = await request(app)
      .put("/api/iroc/invoices/77")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "en",
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

    // The guard must fire before UPDATE
    expect(updateSet).not.toHaveBeenCalled();
  });

});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST → GET /pdf — VAT** label driven by what was actually inserted", () => {
  /**
   * Combined flow: save a lecture-eu invoice via POST, then call the PDF
   * endpoint using the row derived from the actual INSERT payload (not a
   * hand-built fixture).  If the route ever passes invoiceType="domestic"
   * to the DB, the PDF phase will read that wrong type and the "VAT**"
   * assertion will fail — correctly catching the regression.
   */

  beforeEach(resetMocks);

  it("PDF shows 'VAT**' (no rate digit) when the invoice was saved as lecture-eu via POST", async () => {
    // ── Phase 1: POST the invoice ──────────────────────────────────────────
    stagePostSelects();

    // insertValues captures the write payload; insertReturning builds the
    // returned row from that same payload so nothing is fabricated.
    insertReturning.mockImplementationOnce(async () => {
      const payload = insertValues.mock.calls[0][0] as Record<string, unknown>;
      return [{
        id: 201, invoiceNumber: "2026-0201",
        status: "draft", insuranceCosts: "0.00", createdAt: new Date(), updatedAt: new Date(),
        ...payload,
      }];
    });

    const postRes = await request(app)
      .post("/api/iroc/invoices")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "en",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(postRes.status).toBe(201);

    // Capture the payload that was actually sent to INSERT
    const insertedPayload = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedPayload.invoiceType).toBe("lecture-eu");   // write confirmed

    // Build the "saved row" entirely from the captured INSERT payload
    const savedRow: Record<string, unknown> = {
      id: 201, invoiceNumber: "2026-0201",
      status: "draft", createdAt: new Date(), updatedAt: new Date(),
      ...insertedPayload,
    };

    // ── Phase 2: request the PDF for invoice 201 ───────────────────────────
    // Reset select mock; stage the three selects the PDF route makes,
    // serving the row derived from the write payload.
    mockDbSelect.mockReset();
    stagePdfSelects(savedRow);

    const pdfRes = await request(app)
      .get("/api/iroc/invoices/201/pdf")
      .set("Authorization", AUTH);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers["content-type"]).toMatch(/pdf/);

    // ── Phase 3: assert the VAT label ─────────────────────────────────────
    // lecture-eu → bare "VAT**" label, never a rate-digit variant
    expect(pdfState.capturedText).toContain("VAT**");

    const allText = pdfState.capturedText.join("\n");

    // No rate digit must appear alongside VAT
    expect(allText).not.toContain("VAT 7%");
    expect(allText).not.toContain("VAT 7% **");
    expect(allText).not.toContain("VAT 19%");

    // German labels must not appear on an English invoice
    expect(allText).not.toContain("Umsatzsteuer");
  });

});

// ─────────────────────────────────────────────────────────────────────────────

describe("PUT → GET /pdf — VAT** label driven by what was actually updated", () => {
  /**
   * Combined flow: edit an existing eu invoice to lecture-eu via PUT, then
   * call the PDF endpoint using the row derived from the actual UPDATE
   * set-payload.  Guards against a PUT bug that stores the wrong type.
   */

  const EXISTING_EU = {
    id: 202, invoiceNumber: "2026-0202", invoiceType: "eu",
    websiteCustomerId: null, customerId: null,
    issueDate: "2026-07-15", dueDate: null, status: "draft",
    vatRate: "0.00", vatAmount: "0.00", total: "500.00",
    subtotal: "500.00", deliveryCosts: "0.00",
    notes: null, vatNote: null, language: "en",
    createdAt: new Date(), updatedAt: new Date(),
  };

  beforeEach(resetMocks);

  it("PDF shows 'VAT**' (no rate digit) after invoice 202 is updated to lecture-eu via PUT", async () => {
    // ── Phase 1: PUT the update ────────────────────────────────────────────
    stagePutSelects(EXISTING_EU);

    // updateSet captures the set-payload; updateReturning builds the row from it
    updateReturning.mockImplementationOnce(async () => {
      const payload = updateSet.mock.calls[0][0] as Record<string, unknown>;
      return [{
        id: 202, invoiceNumber: "2026-0202",
        status: "draft", insuranceCosts: "0.00", createdAt: new Date(), updatedAt: new Date(),
        ...payload,
      }];
    });

    const putRes = await request(app)
      .put("/api/iroc/invoices/202")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "en",
        issueDate:         "2026-08-01",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(putRes.status).toBe(200);

    // Capture what was actually sent to UPDATE … SET
    const updatedPayload = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(updatedPayload.invoiceType).toBe("lecture-eu");   // write confirmed

    // Build the "saved row" entirely from the captured UPDATE payload
    const savedRow: Record<string, unknown> = {
      id: 202, invoiceNumber: "2026-0202",
      status: "draft", createdAt: new Date(), updatedAt: new Date(),
      ...updatedPayload,
    };

    // ── Phase 2: request the PDF for invoice 202 ───────────────────────────
    mockDbSelect.mockReset();
    stagePdfSelects(savedRow);

    const pdfRes = await request(app)
      .get("/api/iroc/invoices/202/pdf")
      .set("Authorization", AUTH);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers["content-type"]).toMatch(/pdf/);

    // ── Phase 3: assert the VAT label ─────────────────────────────────────
    expect(pdfState.capturedText).toContain("VAT**");

    const allText = pdfState.capturedText.join("\n");

    // No rate digit must appear after editing to lecture-eu
    expect(allText).not.toContain("VAT 7%");
    expect(allText).not.toContain("VAT 7% **");
    expect(allText).not.toContain("VAT 19%");

    // German labels must not appear on an English invoice
    expect(allText).not.toContain("Umsatzsteuer");
  });

  it("PDF keeps the bare English label when a saved German lecture-eu invoice is switched to English", async () => {
    const existingGermanLectureEu = {
      id: 203, invoiceNumber: "2026-0203", invoiceType: "lecture-eu",
      websiteCustomerId: null, customerId: null,
      issueDate: "2026-07-16", dueDate: null, status: "draft",
      vatRate: "0.00", vatAmount: "0.00", total: "500.00",
      subtotal: "500.00", deliveryCosts: "0.00",
      notes: null, vatNote: null, language: "de",
      createdAt: new Date(), updatedAt: new Date(),
    };

    // ── Phase 1: switch the saved invoice language via PUT ─────────────────
    stagePutSelects(existingGermanLectureEu);

    updateReturning.mockImplementationOnce(async () => {
      const payload = updateSet.mock.calls[0][0] as Record<string, unknown>;
      return [{
        id: 203, invoiceNumber: "2026-0203",
        status: "draft", insuranceCosts: "0.00", createdAt: new Date(), updatedAt: new Date(),
        ...payload,
      }];
    });

    const putRes = await request(app)
      .put("/api/iroc/invoices/203")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: WC.id,
        invoiceType:       "lecture-eu",
        language:          "en",
        issueDate:         "2026-08-02",
        dueDate:           null,
        deliveryCosts:     "0.00",
        vatRate:           "0.00",
        notes:             null,
        vatNote:           null,
        items:             ONE_ITEM,
      });

    expect(putRes.status).toBe(200);

    const updatedPayload = updateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(updatedPayload.invoiceType).toBe("lecture-eu");
    expect(updatedPayload.language).toBe("en");

    // ── Phase 2: request the PDF from the row actually written by PUT ───────
    const savedRow: Record<string, unknown> = {
      id: 203, invoiceNumber: "2026-0203",
      status: "draft", createdAt: new Date(), updatedAt: new Date(),
      ...updatedPayload,
    };
    mockDbSelect.mockReset();
    stagePdfSelects(savedRow);

    const pdfRes = await request(app)
      .get("/api/iroc/invoices/203/pdf")
      .set("Authorization", AUTH);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers["content-type"]).toMatch(/pdf/);

    // ── Phase 3: assert the label follows the updated language ──────────────
    expect(pdfState.capturedText).toContain("VAT**");

    const allText = pdfState.capturedText.join("\n");
    expect(allText).not.toContain("VAT 7%");
    expect(allText).not.toContain("VAT 7% **");
    expect(allText).not.toContain("VAT 19%");
    expect(allText).not.toContain("Umsatzsteuer");
  });

});
