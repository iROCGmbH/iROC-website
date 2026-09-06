/**
 * Confirmation test: POST /iroc/invoices/offer-pdf paints the watermark on
 * EVERY page for multi-page offers.
 *
 * What & Why
 * ──────────
 * The offer-pdf endpoint calls doc.bufferedPageRange() after all content is
 * drawn and loops over each page to paint the "UNVERBINDLICHES ANGEBOT" /
 * "NON-BINDING OFFER" watermark.  The existing test suite only exercises the
 * single-page path (bufferedPageRange returns count = 1).
 *
 * A bug in the loop — e.g. off-by-one, early break, wrong start index, or
 * re-using the same page index on every iteration — would leave later pages
 * without a watermark, undetected by existing tests.
 *
 * This test:
 *   1. Mocks bufferedPageRange to return count > 1 (3 pages for "de", 2 for "en").
 *   2. Tracks the active page via switchToPage() in the mock.
 *   3. Associates every .text() call with the page that was active at the time.
 *   4. Asserts that each expected page index (start … start+count-1) received
 *      exactly one watermark call — catching both missing pages AND repeated pages.
 *   5. Confirms the German watermark for language "de" and the English watermark
 *      for language "en".
 *
 * Strategy
 * ────────
 * The MockPDFDocument exposes two module-level knobs:
 *   - pdfConfig.pageCount  — controls bufferedPageRange().count
 *   - pdfConfig.pageStart  — controls bufferedPageRange().start (default 0)
 *
 * pdfState records every .text() call as { text, page } so tests can assert
 * per-page watermark placement precisely.  switchToPage() updates pdfState.currentPage.
 *
 * Follows the MockPDFDocument / selectChain pattern from
 * offer-pdf-reflects-saved-edits.test.ts.
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
    /** The page currently selected via switchToPage(). */
    currentPage: 0,
  };

  /**
   * Controls bufferedPageRange().
   * Set per test before posting.
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
     * This is the key stub: the watermark loop calls switchToPage(start + i)
     * once per iteration.  We record the argument so tests can verify that
     * each page index gets exactly one watermark, not the same page repeated.
     */
    switchToPage(pageIndex: number) {
      pdfState.currentPage = pageIndex;
      return this;
    }

    /** Configurable via pdfConfig — set per test before posting. */
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

/** Build an offer POST body with the given language and a specified number of items. */
function buildOfferBody(language: "de" | "en", itemCount: number) {
  const items = Array.from({ length: itemCount }, (_, i) => ({
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
  }));

  return {
    websiteCustomerId: WC.id,
    invoiceType:       "domestic",
    language,
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
    items,
  };
}

/**
 * Returns the watermark calls from pdfState.calls, filtering by the given text.
 * Each returned entry is { text, page } — the page the watermark was painted on.
 */
function wmCallsFor(wmText: string) {
  return pdfState.calls.filter(c => c.text === wmText);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices/offer-pdf — watermark appears on every page for multi-page offers", () => {
  beforeEach(() => {
    pdfState.calls       = [];
    pdfState.currentPage = 0;
    pdfConfig.pageCount  = 1;
    pdfConfig.pageStart  = 0;
    mockDbSelect.mockReset();
    updateReturning.mockReset();
  });

  it("renders the German watermark exactly once on each of 3 distinct pages (pages 0, 1, 2)", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 3;

    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("de", 6));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const DE_WATERMARK = "UNVERBINDLICHES ANGEBOT";
    const calls = wmCallsFor(DE_WATERMARK);

    // Three watermark calls total — one per page
    expect(calls).toHaveLength(3);

    // Each page index in [start … start+count-1] receives exactly one watermark
    const pages = calls.map(c => c.page).sort((a, b) => a - b);
    expect(pages).toEqual([0, 1, 2]);
  });

  it("renders the English watermark exactly once on each of 2 distinct pages (pages 0, 1)", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 2;

    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("en", 4));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const EN_WATERMARK = "NON-BINDING OFFER";
    const calls = wmCallsFor(EN_WATERMARK);

    // Two watermark calls total — one per page
    expect(calls).toHaveLength(2);

    const pages = calls.map(c => c.page).sort((a, b) => a - b);
    expect(pages).toEqual([0, 1]);
  });

  it("uses bufferedPageRange start index correctly — watermarks pages 2, 3, 4 when start = 2, count = 3", async () => {
    // Simulates a non-zero start: the buffer began at page 2.
    // The loop must call switchToPage(2), switchToPage(3), switchToPage(4).
    pdfConfig.pageStart = 2;
    pdfConfig.pageCount = 3;

    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("de", 6));

    expect(res.status).toBe(200);

    const DE_WATERMARK = "UNVERBINDLICHES ANGEBOT";
    const calls = wmCallsFor(DE_WATERMARK);

    expect(calls).toHaveLength(3);

    const pages = calls.map(c => c.page).sort((a, b) => a - b);
    // Must be start+0, start+1, start+2 — not 0, 1, 2
    expect(pages).toEqual([2, 3, 4]);
  });

  it("renders the German watermark exactly once for a single-page offer (page 0)", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 1;

    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("de", 1));

    expect(res.status).toBe(200);

    const DE_WATERMARK = "UNVERBINDLICHES ANGEBOT";
    const calls = wmCallsFor(DE_WATERMARK);

    expect(calls).toHaveLength(1);
    expect(calls[0].page).toBe(0);
  });

  it("renders the English watermark exactly once for a single-page offer (page 0)", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 1;

    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("en", 1));

    expect(res.status).toBe(200);

    const EN_WATERMARK = "NON-BINDING OFFER";
    const calls = wmCallsFor(EN_WATERMARK);

    expect(calls).toHaveLength(1);
    expect(calls[0].page).toBe(0);
  });

  it("does not render the German watermark text when language is 'en'", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 2;

    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("en", 4));

    expect(res.status).toBe(200);

    const DE_WATERMARK = "UNVERBINDLICHES ANGEBOT";
    expect(wmCallsFor(DE_WATERMARK)).toHaveLength(0);
  });

  it("does not render the English watermark text when language is 'de'", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 2;

    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("de", 4));

    expect(res.status).toBe(200);

    const EN_WATERMARK = "NON-BINDING OFFER";
    expect(wmCallsFor(EN_WATERMARK)).toHaveLength(0);
  });
});
