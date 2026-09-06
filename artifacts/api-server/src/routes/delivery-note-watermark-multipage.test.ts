/**
 * Confirmation test: GET /iroc/invoices/:id/delivery-note paints the
 * "Lieferschein" stamp on EVERY page for multi-page delivery notes.
 *
 * What & Why
 * ──────────
 * The delivery-note endpoint calls doc.bufferedPageRange() after all content is
 * drawn and loops over each page to paint the "Lieferschein" stamp on the top
 * layer.  A bug in the loop — e.g. off-by-one, early break, wrong start index,
 * or re-using the same page index on every iteration — would leave later pages
 * without a stamp, undetected by existing tests.
 *
 * This test:
 *   1. Mocks bufferedPageRange to return count > 1 (3 pages, then 2 pages).
 *   2. Tracks the active page via switchToPage() in the mock.
 *   3. Associates every .text() call with the page that was active at the time.
 *   4. Asserts that each expected page index (start … start+count-1) received
 *      exactly one stamp call — catching both missing pages AND repeated pages.
 *   5. Confirms the non-zero start-index case (start=2, count=3 → pages 2,3,4).
 *
 * Strategy
 * ────────
 * The MockPDFDocument exposes two module-level knobs:
 *   - pdfConfig.pageCount  — controls bufferedPageRange().count
 *   - pdfConfig.pageStart  — controls bufferedPageRange().start (default 0)
 *
 * pdfState records every .text() call as { text, page } so tests can assert
 * per-page stamp placement precisely.  switchToPage() updates pdfState.currentPage.
 *
 * Follows the MockPDFDocument / selectChain pattern from
 * offer-pdf-watermark-multipage.test.ts.
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
    /** All text calls, tagged with the active page at the time of the call. */
    calls: [] as Array<{ text: string; page: number }>,
    /** Every delivery-note stamp rotation angle, in render order. */
    rotateCalls: [] as number[],
    /** The page currently selected via switchToPage(). */
    currentPage: 0,
  };

  /**
   * Controls bufferedPageRange().
   * Set per test before making the request.
   */
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
    page = { width: 595.28, height: 841.89 };
    y = 0;

    constructor(_opts?: unknown) { super(); }

    /** Record the text together with the currently active page index. */
    text(str: string, ..._rest: unknown[]) {
      if (typeof str === "string") {
        pdfState.calls.push({ text: str, page: pdfState.currentPage });
      }
      return this;
    }

    /**
     * Track which page the document is writing to.
     * This is the key stub: the stamp loop calls switchToPage(start + i)
     * once per iteration.  We record the argument so tests can verify that
     * each page index gets exactly one stamp, not the same page repeated.
     */
    switchToPage(pageIndex: number) {
      pdfState.currentPage = pageIndex;
      return this;
    }

    /** Configurable via pdfConfig — set per test before making the request. */
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
    rotate(angle: number) {
      pdfState.rotateCalls.push(angle);
      return this;
    }
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

const INVOICE = {
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
  status:            "final",
  subtotal:          "500.00",
  vatRate:           "19.00",
  vatAmount:         "95.00",
  total:             "595.00",
  deliveryCosts:     "0.00",
  notes:             null,
  vatNote:           null,
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

/** Build N line items for the invoice. */
function buildItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id:              i + 1,
    invoiceId:       INVOICE.id,
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

/** Stage the three DB selects the delivery-note endpoint makes:
 *  1. invoice row  2. websiteCustomer  3. line items
 */
function stageDbForDeliveryNote(itemCount = 6, language: "de" | "en" = "de") {
  mockDbSelect
    .mockReturnValueOnce(selectChain([{ ...INVOICE, language }]))
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain(buildItems(itemCount)));
}

/**
 * Returns all stamp calls from pdfState.calls whose text matches the stamp text.
 * Each entry is { text, page } — the page the stamp was painted on.
 */
const STAMP_TEXT = "LIEFERSCHEIN";

function stampCalls() {
  return pdfState.calls.filter(c => c.text === STAMP_TEXT);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/invoices/:id/delivery-note — stamp appears on every page for multi-page delivery notes", () => {
  beforeEach(() => {
    pdfState.calls       = [];
    pdfState.rotateCalls = [];
    pdfState.currentPage = 0;
    pdfConfig.pageCount  = 1;
    pdfConfig.pageStart  = 0;
    mockDbSelect.mockReset();
    updateReturning.mockReset();
  });

  it.each(["de", "en"] as const)(
    "renders the stamp exactly once on each of 3 distinct pages (pages 0, 1, 2) for %s",
    async language => {
      pdfConfig.pageStart = 0;
      pdfConfig.pageCount = 3;

      stageDbForDeliveryNote(6, language);

      const res = await request(app)
        .get(`/api/iroc/invoices/${INVOICE.id}/delivery-note`)
        .set("Authorization", AUTH);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/pdf/);

      const calls = stampCalls();

      // Three stamp calls total — one per page
      expect(calls).toHaveLength(3);

      // Each page index in [start … start+count-1] receives exactly one stamp
      const pages = calls.map(c => c.page).sort((a, b) => a - b);
      expect(pages).toEqual([0, 1, 2]);

      expect(pdfState.rotateCalls).toHaveLength(3);
      for (const angle of pdfState.rotateCalls) {
        expect(angle).toBe(-38);
      }
    },
  );

  it("renders the stamp exactly once on each of 2 distinct pages (pages 0, 1)", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 2;

    stageDbForDeliveryNote(4);

    const res = await request(app)
      .get(`/api/iroc/invoices/${INVOICE.id}/delivery-note`)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const calls = stampCalls();

    // Two stamp calls total — one per page
    expect(calls).toHaveLength(2);

    const pages = calls.map(c => c.page).sort((a, b) => a - b);
    expect(pages).toEqual([0, 1]);
  });

  it("uses bufferedPageRange start index correctly — stamps pages 2, 3, 4 when start=2, count=3", async () => {
    // Simulates a non-zero start: the buffer began at page 2.
    // The loop must call switchToPage(2), switchToPage(3), switchToPage(4).
    pdfConfig.pageStart = 2;
    pdfConfig.pageCount = 3;

    stageDbForDeliveryNote(6);

    const res = await request(app)
      .get(`/api/iroc/invoices/${INVOICE.id}/delivery-note`)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const calls = stampCalls();

    expect(calls).toHaveLength(3);

    const pages = calls.map(c => c.page).sort((a, b) => a - b);
    // Must be start+0, start+1, start+2 — not 0, 1, 2
    expect(pages).toEqual([2, 3, 4]);
  });

  it("renders the stamp exactly once for a single-page delivery note (page 0)", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 1;

    stageDbForDeliveryNote(1);

    const res = await request(app)
      .get(`/api/iroc/invoices/${INVOICE.id}/delivery-note`)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const calls = stampCalls();

    expect(calls).toHaveLength(1);
    expect(calls[0].page).toBe(0);
  });

  it("each page receives exactly one stamp — no page is double-stamped", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 4;

    stageDbForDeliveryNote(8);

    const res = await request(app)
      .get(`/api/iroc/invoices/${INVOICE.id}/delivery-note`)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const calls = stampCalls();

    // Exactly 4 stamps for 4 pages
    expect(calls).toHaveLength(4);

    // All page indices are distinct (no double-stamping)
    const pages = calls.map(c => c.page);
    const uniquePages = new Set(pages);
    expect(uniquePages.size).toBe(4);

    // Pages covered are 0, 1, 2, 3 in any order
    const sortedPages = [...uniquePages].sort((a, b) => a - b);
    expect(sortedPages).toEqual([0, 1, 2, 3]);
  });
});
