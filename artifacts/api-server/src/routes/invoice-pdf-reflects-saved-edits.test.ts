/**
 * Confirmation test: GET /iroc/invoices/:id/pdf reads the DB row written by
 * the preceding PUT, not stale cached data.
 *
 * What & Why
 * ──────────
 * The invoice-pdf endpoint performs a fresh SELECT on every request — no
 * response cache, no in-process memo.  This test confirms:
 *
 *   1. After a PUT that raises a unit-price (100 → 200), a subsequent GET /pdf
 *      shows the new total (€238,00) rather than the pre-edit total (€119,00).
 *   2. Two consecutive GET /pdf calls served with different DB rows produce
 *      different PDFs — proving the endpoint never re-uses a prior response.
 *
 * Strategy
 * ────────
 * PDFKit output is FlateDecode-compressed, so we mock PDFDocument and capture
 * every `.text()` call.  The db layer is mocked with staged `mockReturnValueOnce`
 * chains that simulate the DB state before and after the edit.
 *
 * Follows the MockPDFDocument / selectChain pattern from vat-rate-pdf.test.ts
 * and invoice-creation-7pct-vat.test.ts.
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
  const pdfState = {
    capturedText: [] as string[],
    forceInvalidPdfForPostProcessing: false,
  };

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
    widthOfString()  { return 42; }
    heightOfString() { return 10; }
    rotate()         { return this; }
    opacity()        { return this; }
    switchToPage()   { return this; }
    flushPages()     { return this; }
    bufferedPageRange() { return { start: 0, count: 1 }; }
    end(cb?: () => void) {
      if (pdfState.forceInvalidPdfForPostProcessing) {
        this.push(Buffer.from("%PDF-1.7\nnot a parseable PDF"));
      }
      super.end(cb);
      return this;
    }
  }

  return { default: MockPDFDocument };
});

vi.mock("pdf-lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pdf-lib")>();
  const originalLoad = actual.PDFDocument.load.bind(actual.PDFDocument);
  const load = (...args: Parameters<typeof actual.PDFDocument.load>) => {
    if (pdfState.forceInvalidPdfForPostProcessing) {
      return Promise.reject(new Error("forced pdf-lib parse failure"));
    }
    return originalLoad(...args);
  };
  return {
    ...actual,
    PDFDocument: Object.assign(actual.PDFDocument, { load }),
  };
});

vi.mock("../lib/geocode", () => ({
  geocodeMissingDoctors: vi.fn().mockResolvedValue(undefined),
  geocodeSearch: vi.fn(),
  toCountryCode: vi.fn(),
  lookupPostalAddress: vi.fn(),
  lookupInstitutionMultiple: vi.fn(),
}));

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

/** Minimal website-customer returned by websiteCustomersTable SELECT. */
const WC = {
  id:                  7,
  customerNr:          "WC-007",
  salutation:          "Frau",
  title:               null,
  firstName:           "Anna",
  lastName:            "Beispiel",
  institutionName:     null,
  specialty:           null,
  institutionType:     null,
  address:             "Musterstr. 5",
  postalCode:          "10115",
  city:                "Berlin",
  country:             "Deutschland",
  phone:               null,
  fax:                 null,
  email:               "anna@example.com",
  website:             null,
  referenceNumber:     null,
  ustIdNr:             null,
  instrument:          "iroc",
  notes:               null,
  privacyConsent:      true,
  isEu:                false,
  shippingFirstName:   null,
  shippingLastName:    null,
  shippingInstitutionName: null,
  shippingAddress:     null,
  shippingPostalCode:  null,
  shippingCity:        null,
  shippingCountry:     null,
  shippingPhone:       null,
  shippingEmail:       null,
  createdAt:           new Date(),
};

/** Invoice as stored in the DB before the admin edits it. unitPrice was €100. */
const invoiceBefore = {
  id:                1,
  invoiceNumber:     "2026-0055",
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2026-08-01",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  websiteCustomerId: WC.id,
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

/**
 * Invoice as stored AFTER the PUT (unit price raised to €200).
 * subtotal=200, vatAmount=38 (19%), total=238.
 */
const invoiceAfter = {
  ...invoiceBefore,
  subtotal:   "200.00",
  vatAmount:  "38.00",
  total:      "238.00",
  updatedAt:  new Date(),
};

const WC_WITH_BACKFILLED_REORDER_CODE = {
  ...WC,
  reorderCode: "ABCD2345",
};

/** Line-item row returned by irocInvoiceItems after the PUT. */
const itemAfter = {
  id:              1,
  invoiceId:       1,
  productId:       null,
  productName:     "Medical Device",
  sku:             null,
  description:     null,
  lotNumber:       null,
  hsCode:          null,
  countryOfOrigin: null,
  weightKg:        null,
  unitPrice:       "200.00",
  discountPercent: null,
  isDemo:          false,
  quantity:        1,
  lineTotal:       "200.00",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fluent select-chain that always resolves to `result`.
 * Mirrors the helper used in invoice-creation-7pct-vat.test.ts.
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

/** PUT body: domestic DE invoice with a single item at unitPrice 200. */
const putBody = {
  websiteCustomerId: WC.id,
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2026-08-01",
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
    productName:     "Medical Device",
    sku:             null,
    description:     null,
    lotNumber:       null,
    hsCode:          null,
    countryOfOrigin: null,
    weightKg:        null,
    unitPrice:       "200.00",
    discountPercent: null,
    isDemo:          false,
    quantity:        1,
  }],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/invoices/:id/pdf — reads DB row from preceding PUT, not stale data", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    pdfState.forceInvalidPdfForPostProcessing = false;
    mockDbSelect.mockReset();
    updateReturning.mockReset();
  });

  it("PDF downloaded after a price edit reflects the updated total, not the pre-edit total", async () => {
    // ── Stage PUT db calls ────────────────────────────────────────────────
    // PUT: select existing invoice → select websiteCustomer →
    //      update returning → delete items → insert items →
    //      select items (for response body)
    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceBefore]))  // existing-invoice check
      .mockReturnValueOnce(selectChain([WC]))             // websiteCustomer lookup
      .mockReturnValueOnce(selectChain([itemAfter]));     // items select after upsert

    // db.update().set().where().returning() → updated invoice
    updateReturning.mockResolvedValueOnce([invoiceAfter]);

    // ── Execute PUT ───────────────────────────────────────────────────────
    const putRes = await request(app)
      .put("/api/iroc/invoices/1")
      .set("Authorization", AUTH)
      .send(putBody);

    expect(putRes.status).toBe(200);

    // ── Stage GET /pdf db calls with the UPDATED invoice row ──────────────
    // GET /pdf: select invoice → select websiteCustomer → select items
    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceAfter]))   // fresh row from DB
      .mockReturnValueOnce(selectChain([WC]))             // websiteCustomer
      .mockReturnValueOnce(selectChain([itemAfter]));     // line items

    // ── Request the PDF ───────────────────────────────────────────────────
    const pdfRes = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers["content-type"]).toMatch(/pdf/);

    // ── Assert updated totals appear, pre-edit totals do not ─────────────
    //
    // buildInvoicePDF renders the DE totals block as:
    //   "Netto-Betrag"   → subtotal (€200,00)
    //   "Umsatzsteuer 19% **" → vatAmount (€38,00)
    //   "Gesamtbetrag"   → total (€238,00)  ← bold, prominent line
    //
    const allText = pdfState.capturedText.join("\n");

    // New total must appear
    expect(allText).toContain("€238,00");

    // Pre-edit total must not appear — confirms no stale data
    expect(allText).not.toContain("€119,00");
  });

  it("PDF downloaded after saving a linked custom name keeps that name", async () => {
    const customItem = {
      ...itemAfter,
      productId: 7,
      productName: "Customer-specific product name",
      description: "Customer-specific product description",
    };
    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceAfter]))
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([customItem]));

    const pdfRes = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(pdfRes.status).toBe(200);
    const allText = pdfState.capturedText.join("\n");
    expect(allText).toContain("Customer-specific product name");
    expect(allText).not.toContain("Medical Device");
  });

  it("two consecutive GET /pdf calls produce different PDFs when the DB row changes between them", async () => {
    // ── First GET /pdf: original invoice (total €119,00) ─────────────────
    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceBefore]))
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([{
        ...itemAfter,
        unitPrice: "100.00",
        lineTotal: "100.00",
      }]));

    const res1 = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(res1.status).toBe(200);
    const text1 = pdfState.capturedText.join("\n");
    expect(text1).toContain("€119,00");  // original total in first PDF

    // ── Reset captured text and stage updated DB row ──────────────────────
    pdfState.capturedText = [];

    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceAfter]))   // DB now holds updated row
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([itemAfter]));

    const res2 = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(res2.status).toBe(200);
    const text2 = pdfState.capturedText.join("\n");

    // Updated total must appear in the second PDF
    expect(text2).toContain("€238,00");

    // Old total must NOT appear — confirms the endpoint re-queries the DB every time
    expect(text2).not.toContain("€119,00");
  });

  it("includes a reorder code added to the customer before the invoice PDF is regenerated", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceAfter]))
      .mockReturnValueOnce(selectChain([WC_WITH_BACKFILLED_REORDER_CODE]))
      .mockReturnValueOnce(selectChain([itemAfter]));

    const response = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(response.status).toBe(200);
    expect(pdfState.capturedText.join("\n")).toContain("ABCD2345");
  });

  it("returns an operational error and no PDF when post-processing cannot parse the renderer output", async () => {
    pdfState.forceInvalidPdfForPostProcessing = true;
    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceAfter]))
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([itemAfter]));

    const response = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(response.status).toBe(500);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.headers["content-type"]).not.toMatch(/pdf/);
    expect(response.body).toEqual({
      error: "Unable to generate invoice: PDF post-processing could not parse the rendered document",
    });
  });
});
