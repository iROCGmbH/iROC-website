/**
 * Confirmation test: watermark opts.width equals the page width on US Letter
 * pages for GET /iroc/invoices/:id/pdf.
 *
 * What & Why
 * ──────────
 * The invoice-pdf watermark loop reads doc.page.width (pw) and calls:
 *   .text(wmText, 0, ph / 2 - 36, { width: pw, align: "center", … })
 *
 * The multipage watermark tests confirm that every page receives a watermark,
 * and that the correct text and page index are used.  They do NOT assert that
 * opts.width equals pw — a stale or hardcoded value would go undetected.
 *
 * This test overrides page.width to US Letter (612 pt), captures the opts
 * argument from every doc.text() call, and asserts that opts.width === 612,
 * proving the watermark spans the full page regardless of page size.
 *
 * Strategy
 * ────────
 * Follows the MockPDFDocument / selectChain pattern from
 * invoice-pdf-watermark-multipage.test.ts and
 * offer-pdf-watermark-letter-size.test.ts.
 * The MockPDFDocument exposes a configurable page.width via pdfState and
 * records { text, y, opts, page } for every .text() call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock-factory state ──────────────────────────────────────────────
const {
  pdfState,
  pdfConfig,
  mockDbSelect,
  mockDbUpdate,
  updateReturning,
  mockDbDelete,
  mockDbInsert,
} = vi.hoisted(() => {
  const pdfState = {
    /** All text calls: { text, y, opts, page } */
    textCalls: [] as Array<{ text: string; y: number | undefined; opts: Record<string, unknown> | undefined; page: number }>,
    /** All rotate calls: { angle, origin, page } */
    rotateCalls: [] as Array<{ angle: number; origin: [number, number] | undefined; page: number }>,
    /** The page currently selected via switchToPage(). */
    currentPage: 0,
    /** Page dimensions — override per test to simulate different page sizes. */
    pageWidth: 612,
    pageHeight: 792,
  };

  /** Controls bufferedPageRange(). Set per test before making the request. */
  const pdfConfig = { pageCount: 1, pageStart: 0 };

  const mockDbSelect = vi.fn();

  const updateReturning = vi.fn();
  const updateWhere     = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet       = vi.fn().mockReturnValue({ where: updateWhere });
  const mockDbUpdate    = vi.fn().mockReturnValue({ set: updateSet });

  const deleteWhere  = vi.fn().mockResolvedValue([]);
  const mockDbDelete = vi.fn().mockReturnValue({ where: deleteWhere });

  const insertValues = vi.fn().mockResolvedValue([]);
  const mockDbInsert = vi.fn().mockReturnValue({ values: insertValues });

  return {
    pdfState,
    pdfConfig,
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
    /** Expose page dimensions through a getter so pdfState controls the values. */
    get page() {
      return { width: pdfState.pageWidth, height: pdfState.pageHeight };
    }

    y = 0;

    constructor(_opts?: unknown) { super(); }

    /**
     * Record text(str, x, y, opts) together with the currently active page.
     * The watermark loop calls:
     *   .text(wmText, 0, ph / 2 - 36, { width: pw, align: "center", … })
     * so rest[0]=x, rest[1]=y, rest[2]=opts.
     */
    text(str: string, ...rest: unknown[]) {
      if (typeof str === "string") {
        const y    = typeof rest[1] === "number" ? rest[1] : undefined;
        const opts = (rest[2] !== null && typeof rest[2] === "object")
          ? (rest[2] as Record<string, unknown>)
          : undefined;
        pdfState.textCalls.push({ text: str, y, opts, page: pdfState.currentPage });
      }
      return this;
    }

    /**
     * Capture rotate(angle, options) calls.
     * The watermark loop calls:
     *   .rotate(-38, { origin: [pw / 2, ph / 2] })
     */
    rotate(angle: number, opts?: { origin?: [number, number] }) {
      pdfState.rotateCalls.push({
        angle,
        origin: opts?.origin,
        page: pdfState.currentPage,
      });
      return this;
    }

    switchToPage(pageIndex: number) {
      pdfState.currentPage = pageIndex;
      return this;
    }

    bufferedPageRange() {
      return { start: pdfConfig.pageStart, count: pdfConfig.pageCount };
    }

    font()           { return this; }
    fontSize()       { return this; }
    fillColor()      { return this; }
    strokeColor()    { return this; }
    lineWidth()      { return this; }
    opacity()        { return this; }
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

const WC = {
  id:                      7,
  customerNr:              "WC-007",
  salutation:              "Frau",
  title:                   null,
  firstName:               "Anna",
  lastName:                "Beispiel",
  institutionName:         null,
  specialty:               null,
  institutionType:         null,
  address:                 "Musterstr. 1",
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

function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id:                42,
    invoiceNumber:     "2026-0042",
    invoiceType:       "domestic",
    language:          "de",
    issueDate:         "2026-08-07",
    dueDate:           null,
    orderNumber:       null,
    referenceNumber:   null,
    shippingMethod:    null,
    reasonForExport:   null,
    termsOfDelivery:   null,
    websiteCustomerId: WC.id,
    customerId:        null,
    status:            "draft",
    subtotal:          "500.00",
    vatRate:           "19.00",
    vatAmount:         "95.00",
    total:             "595.00",
    deliveryCosts:     "0.00",
    notes:             null,
    vatNote:           null,
    createdAt:         new Date(),
    updatedAt:         new Date(),
    ...overrides,
  };
}

function buildItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id:              i + 1,
    invoiceId:       42,
    productId:       null,
    productName:     `Product ${i + 1}`,
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
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Stage the three DB selects the invoice-pdf endpoint makes:
 *  1. invoice row  2. websiteCustomer  3. line items
 */
function stageDb(invoice: ReturnType<typeof buildInvoice>, itemCount = 2) {
  mockDbSelect
    .mockReturnValueOnce(selectChain([invoice]))
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain(buildItems(itemCount)));
}

// US Letter dimensions in points
const LETTER_WIDTH  = 612;
const LETTER_HEIGHT = 792;

// A4 dimensions in points (the invoice PDF's default page size)
const A4_WIDTH  = 595.28;
const A4_HEIGHT = 841.89;

const INVOICE_ID = 42;
const URL = `/api/iroc/invoices/${INVOICE_ID}/pdf`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/invoices/:id/pdf — watermark opts.width equals page width on US Letter", () => {
  beforeEach(() => {
    pdfState.textCalls   = [];
    pdfState.rotateCalls = [];
    pdfState.currentPage = 0;
    // Set US Letter dimensions
    pdfState.pageWidth   = LETTER_WIDTH;
    pdfState.pageHeight  = LETTER_HEIGHT;
    pdfConfig.pageCount  = 1;
    pdfConfig.pageStart  = 0;
    mockDbSelect.mockReset();
    updateReturning.mockReset();
  });

  it("passes width option equal to page width (612) so the centred text spans the full US Letter page", async () => {
    stageDb(buildInvoice({ status: "draft", language: "de" }));

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const DE_WATERMARK = "ENTWURF";
    const wmCalls = pdfState.textCalls.filter(c => c.text === DE_WATERMARK);

    expect(wmCalls).toHaveLength(1);
    // The y-position must use ph (page height = 792), not a stale/default height.
    expect(wmCalls[0].y).toBe(LETTER_HEIGHT / 2 - 36);
    expect(wmCalls[0].y).toBe(360);
    // The width option must equal pw (page width = 612) so text() centres the
    // string relative to the full page width, not a stale or hardcoded value.
    expect(wmCalls[0].opts).toBeDefined();
    expect(wmCalls[0].opts!["width"]).toBe(LETTER_WIDTH);
    expect(wmCalls[0].opts!["width"]).toBe(612);
  });

  it("passes width option equal to page width (612) for English watermark on US Letter", async () => {
    stageDb(buildInvoice({ status: "draft", language: "en" }));

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const EN_WATERMARK = "DRAFT";
    const wmCalls = pdfState.textCalls.filter(c => c.text === EN_WATERMARK);

    expect(wmCalls).toHaveLength(1);
    expect(wmCalls[0].y).toBe(LETTER_HEIGHT / 2 - 36);
    expect(wmCalls[0].y).toBe(360);
    expect(wmCalls[0].opts).toBeDefined();
    expect(wmCalls[0].opts!["width"]).toBe(LETTER_WIDTH);
    expect(wmCalls[0].opts!["width"]).toBe(612);
  });

  it("passes width 612 on every page of a multi-page US Letter draft invoice", async () => {
    pdfConfig.pageCount = 3;
    stageDb(buildInvoice({ status: "draft", language: "de" }), 6);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const DE_WATERMARK = "ENTWURF";
    const wmCalls = pdfState.textCalls.filter(c => c.text === DE_WATERMARK);

    // One watermark per page — three total
    expect(wmCalls).toHaveLength(3);
    for (const wm of wmCalls) {
      expect(wm.opts).toBeDefined();
      expect(wm.opts!["width"]).toBe(612);
    }
  });

  it("does not include a width option in watermark calls when status is not draft", async () => {
    stageDb(buildInvoice({ status: "sent", language: "de" }));

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    // No watermark text calls at all for non-draft invoices
    expect(pdfState.textCalls.filter(c => c.text === "ENTWURF")).toHaveLength(0);
    expect(pdfState.textCalls.filter(c => c.text === "DRAFT")).toHaveLength(0);
  });
});

describe("GET /iroc/invoices/:id/pdf — watermark coordinates on A4", () => {
  beforeEach(() => {
    pdfState.textCalls   = [];
    pdfState.rotateCalls = [];
    pdfState.currentPage = 0;
    pdfState.pageWidth   = A4_WIDTH;
    pdfState.pageHeight  = A4_HEIGHT;
    pdfConfig.pageCount  = 1;
    pdfConfig.pageStart  = 0;
    mockDbSelect.mockReset();
    updateReturning.mockReset();
  });

  it("uses the A4 page centre for the German watermark origin and A4 height / 2 - 36 for y", async () => {
    stageDb(buildInvoice({ status: "draft", language: "de" }));

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const wmCalls = pdfState.textCalls.filter(c => c.text === "ENTWURF");
    expect(wmCalls).toHaveLength(1);
    expect(wmCalls[0].y).toBe(A4_HEIGHT / 2 - 36);
    expect(wmCalls[0].y).toBe(384.945);

    expect(pdfState.rotateCalls).toHaveLength(1);
    expect(pdfState.rotateCalls[0].origin).toEqual([
      A4_WIDTH / 2,
      A4_HEIGHT / 2,
    ]);
    expect(pdfState.rotateCalls[0].origin).toEqual([297.64, 420.945]);
  });

  it("uses the A4 page centre for the English watermark origin and A4 height / 2 - 36 for y", async () => {
    stageDb(buildInvoice({ status: "draft", language: "en" }));

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const wmCalls = pdfState.textCalls.filter(c => c.text === "DRAFT");
    expect(wmCalls).toHaveLength(1);
    expect(wmCalls[0].y).toBe(A4_HEIGHT / 2 - 36);
    expect(wmCalls[0].y).toBe(384.945);

    expect(pdfState.rotateCalls).toHaveLength(1);
    expect(pdfState.rotateCalls[0].origin).toEqual([
      A4_WIDTH / 2,
      A4_HEIGHT / 2,
    ]);
    expect(pdfState.rotateCalls[0].origin).toEqual([297.64, 420.945]);
  });

  it("uses the A4 page centre for the German cancelled watermark origin and A4 height / 2 - 36 for y", async () => {
    stageDb(buildInvoice({ status: "cancelled", language: "de" }));

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const wmCalls = pdfState.textCalls.filter(c => c.text === "STORNIERT");
    expect(wmCalls).toHaveLength(1);
    expect(wmCalls[0].y).toBe(A4_HEIGHT / 2 - 36);
    expect(wmCalls[0].y).toBe(384.945);

    expect(pdfState.rotateCalls).toHaveLength(1);
    expect(pdfState.rotateCalls[0].origin).toEqual([
      A4_WIDTH / 2,
      A4_HEIGHT / 2,
    ]);
    expect(pdfState.rotateCalls[0].origin).toEqual([297.64, 420.945]);
  });

  it("uses the A4 page centre for the English cancelled watermark origin and A4 height / 2 - 36 for y", async () => {
    stageDb(buildInvoice({ status: "cancelled", language: "en" }));

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const wmCalls = pdfState.textCalls.filter(c => c.text === "CANCELLED");
    expect(wmCalls).toHaveLength(1);
    expect(wmCalls[0].y).toBe(A4_HEIGHT / 2 - 36);
    expect(wmCalls[0].y).toBe(384.945);

    expect(pdfState.rotateCalls).toHaveLength(1);
    expect(pdfState.rotateCalls[0].origin).toEqual([
      A4_WIDTH / 2,
      A4_HEIGHT / 2,
    ]);
    expect(pdfState.rotateCalls[0].origin).toEqual([297.64, 420.945]);
  });
});
