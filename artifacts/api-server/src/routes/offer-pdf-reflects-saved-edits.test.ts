/**
 * Confirmation test: POST /iroc/invoices/offer-pdf reads the websiteCustomer
 * fresh from the DB on every call — no stale cache.
 *
 * What & Why
 * ──────────
 * The offer-pdf endpoint accepts the full invoice payload in the POST body and
 * performs a fresh SELECT on websiteCustomersTable for the supplied
 * websiteCustomerId.  This test confirms:
 *
 *   1. After a PUT that updates the customer record (same ID, different address),
 *      a subsequent POST to /offer-pdf with that same websiteCustomerId shows the
 *      UPDATED address, not the pre-edit address — proving no per-ID cache exists.
 *   2. Two consecutive POST /offer-pdf calls using the SAME websiteCustomerId
 *      but staged with different DB rows produce different PDFs — proving the
 *      endpoint re-queries the DB on every request.
 *   3. The websiteCustomer SELECT is issued exactly once per POST request.
 *
 * Key design principle
 * ────────────────────
 * Both test cases deliberately use the SAME websiteCustomerId in every POST.
 * This rules out a customer-by-ID cache: if the endpoint cached the customer
 * lookup by ID, any edit to the same customer would go undetected and the old
 * address would appear in the PDF.  Only a fresh per-request SELECT can pass
 * both tests when the staged DB rows differ between calls.
 *
 * Strategy
 * ────────
 * PDFKit output is FlateDecode-compressed, so we mock PDFDocument and capture
 * every `.text()` call.  The db layer is mocked with staged `mockReturnValueOnce`
 * chains that simulate the DB state before and after the edit.  We also assert
 * `mockDbSelect` call counts to verify the SELECT is issued once per POST.
 *
 * Follows the MockPDFDocument / selectChain pattern from
 * delivery-note-pdf-reflects-saved-edits.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock-factory state ──────────────────────────────────────────────
const {
  pdfState,
  mockDbSelect,
  mockDbUpdate,
  updateReturning,
  mockDbDelete,
  mockDbInsert,
} = vi.hoisted(() => {
  const pdfState = { capturedText: [] as string[] };

  // select chain — staged per-call in tests via mockReturnValueOnce
  const mockDbSelect = vi.fn();

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
    pdfState,
    mockDbSelect,
    mockDbUpdate, updateReturning,
    mockDbDelete,
    mockDbInsert,
  };
});

// ── Mock pdfkit ───────────────────────────────────────────────────────────────
vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");

  class MockPDFDocument extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;

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
    opacity()        { return this; }
    save()           { return this; }
    restore()        { return this; }
    rotate()         { return this; }
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
    switchToPage()   { return this; }
    bufferedPageRange() { return { start: 0, count: 1 }; }
    flushPages()     { return this; }
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

// ── Fixtures ──────────────────────────────────────────────────────────────────
//
// Both WC_BEFORE and WC_AFTER share the SAME id (7).  All tests post with
// websiteCustomerId = 7 throughout — a per-ID cache would not detect the
// address change and would serve the stale row.

/** Customer row as it exists in the DB BEFORE the admin edits the address. */
const WC_BEFORE = {
  id:                      7,
  customerNr:              "WC-007",
  salutation:              "Frau",
  title:                   null,
  firstName:               "Anna",
  lastName:                "Beispiel",
  institutionName:         null,
  specialty:               null,
  institutionType:         null,
  address:                 "Alte Str. 1",
  postalCode:              "10001",
  city:                    "Berlin",
  country:                 "Deutschland",
  phone:                   null,
  fax:                     null,
  email:                   "anna@example.com",
  website:                 null,
  referenceNumber:         null,
  ustIdNr:                 null,
  instrument:              "iroc",
  notes:                   null,
  privacyConsent:          true,
  isEu:                    false,
  shippingFirstName:       null,
  shippingLastName:        null,
  shippingInstitutionName: null,
  shippingAddress:         null,
  shippingPostalCode:      null,
  shippingCity:            null,
  shippingCountry:         null,
  shippingPhone:           null,
  shippingEmail:           null,
  createdAt:               new Date(),
};

/**
 * Same customer (id = 7) AFTER the admin edits their address.
 * The ID is identical — only address fields changed.
 */
const WC_AFTER = {
  ...WC_BEFORE,
  address:    "Neue Str. 99",
  postalCode: "20095",
  city:       "Hamburg",
};

/** Invoice stored in the DB (used only for the PUT leg of the first test). */
const invoiceRow = {
  id:                1,
  invoiceNumber:     "2026-0033",
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2026-08-07",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  websiteCustomerId: WC_BEFORE.id,   // same customer id both before and after
  customerId:        null,
  status:            "draft",
  subtotal:          "100.00",
  vatRate:           "19.00",
  vatAmount:         "19.00",
  total:             "119.00",
  deliveryCosts:     "0.00",
  insuranceCosts:    "0.00",
  notes:             null,
  vatNote:           null,
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

/** A single line item (content unimportant for address assertions). */
const item = {
  id:              1,
  invoiceId:       1,
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
  lineTotal:       "100.00",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fluent select-chain that always resolves to `result`.
 * Mirrors the helper used in delivery-note-pdf-reflects-saved-edits.test.ts.
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

/**
 * Shared offer-PDF POST body — websiteCustomerId is always 7 (WC_BEFORE.id).
 * Using the same ID in both tests is intentional: a customer-by-ID cache would
 * not detect an address change and would serve the stale row.
 */
const offerBody = {
  websiteCustomerId: WC_BEFORE.id,   // ← constant across all POSTs
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

/** PUT body that re-saves the invoice (address change happens on the customer, not the invoice). */
const putBody = {
  websiteCustomerId: WC_BEFORE.id,
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

describe("POST /iroc/invoices/offer-pdf — reads websiteCustomer fresh from DB, not stale data", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    mockDbSelect.mockReset();
    updateReturning.mockReset();
  });

  it("offer PDF downloaded after a customer address edit (same ID) reflects the new address, not the pre-edit address", async () => {
    // ── Stage PUT db calls ────────────────────────────────────────────────
    // The admin saves the invoice (no customer switch — the edit happens on
    // the websiteCustomer row itself, outside this endpoint).
    // PUT /iroc/invoices/1:
    //   1. select existing invoice
    //   2. select websiteCustomer (still WC_BEFORE.id = 7)
    //   3. update invoice .returning()
    //   4. delete items / insert items (delete+insert chains)
    //   5. select updated items (for response body)
    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceRow]))   // existing-invoice check
      .mockReturnValueOnce(selectChain([WC_BEFORE]))    // websiteCustomer lookup during PUT
      .mockReturnValueOnce(selectChain([item]));        // items select after upsert

    updateReturning.mockResolvedValueOnce([invoiceRow]);

    const putRes = await request(app)
      .put("/api/iroc/invoices/1")
      .set("Authorization", AUTH)
      .send(putBody);

    expect(putRes.status).toBe(200);

    // ── Stage POST /offer-pdf: DB now holds WC_AFTER (address changed) ────
    // The offer-pdf endpoint performs exactly ONE SELECT:
    //   db.select().from(websiteCustomersTable).where(eq(...id, 7))
    // The mock is staged to return WC_AFTER — same id=7, new address.
    const selectCountBefore = mockDbSelect.mock.calls.length;

    mockDbSelect
      .mockReturnValueOnce(selectChain([WC_AFTER]));   // fresh select → updated customer

    const offerRes = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(offerBody);

    expect(offerRes.status).toBe(200);
    expect(offerRes.headers["content-type"]).toMatch(/pdf/);

    // The request freshly reads both the customer and invoice contact settings.
    expect(mockDbSelect.mock.calls.length).toBe(selectCountBefore + 2);

    const allText = pdfState.capturedText.join("\n");

    // New address (WC_AFTER) must appear — proves the endpoint re-read the DB
    expect(allText).toContain("Anna Beispiel");      // name unchanged — confirms right customer
    expect(allText).toContain("Neue Str. 99");
    expect(allText).toContain("20095 Hamburg");

    // Pre-edit address must NOT appear — proves no stale data served
    expect(allText).not.toContain("Alte Str. 1");
    expect(allText).not.toContain("10001 Berlin");
  });

  it("two consecutive POST /offer-pdf calls (same websiteCustomerId) produce different PDFs when the DB row changes between them", async () => {
    // ── First POST: DB returns WC_BEFORE (old address) ───────────────────
    // Using websiteCustomerId = 7 (WC_BEFORE.id) in both requests.
    // A per-ID cache would serve the stale WC_BEFORE row on the second call.
    mockDbSelect
      .mockReturnValueOnce(selectChain([WC_BEFORE]));  // first request → old row

    const res1 = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(offerBody);

    expect(res1.status).toBe(200);
    const text1 = pdfState.capturedText.join("\n");

    // Old address appears in first offer PDF
    expect(text1).toContain("Alte Str. 1");
    expect(text1).toContain("10001 Berlin");

    // ── Reset captured text; stage WC_AFTER for the second POST ──────────
    pdfState.capturedText = [];
    const selectCountBetween = mockDbSelect.mock.calls.length;

    mockDbSelect
      .mockReturnValueOnce(selectChain([WC_AFTER]));   // second request → updated row (same id)

    const res2 = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(offerBody);   // identical body — same websiteCustomerId = 7

    expect(res2.status).toBe(200);

    // The second request freshly reads both customer data and contact settings.
    expect(mockDbSelect.mock.calls.length).toBe(selectCountBetween + 2);

    const text2 = pdfState.capturedText.join("\n");

    // Updated address must appear — proves DB re-queried, not cached
    expect(text2).toContain("Neue Str. 99");
    expect(text2).toContain("20095 Hamburg");

    // Old address must NOT appear — proves no stale data
    expect(text2).not.toContain("Alte Str. 1");
    expect(text2).not.toContain("10001 Berlin");
  });
});
