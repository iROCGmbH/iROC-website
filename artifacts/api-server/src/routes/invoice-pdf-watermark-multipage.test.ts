/**
 * Confirmation test: GET /iroc/invoices/:id/pdf paints status watermarks on
 * EVERY page when the invoice status is "draft" or "cancelled".
 *
 * What & Why
 * ──────────
 * The invoice-pdf endpoint calls doc.bufferedPageRange() after all content is
 * drawn and loops over each page to paint the "ENTWURF" / "DRAFT" watermark
 * for drafts or the red "STORNIERT" / "CANCELLED" watermark for cancelled
 * invoices.  The existing tests only exercise the single-page path or
 * non-draft invoices.
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
 *   5. Confirms the German watermark ("ENTWURF") for language "de" and the
 *      English watermark ("DRAFT") for language "en".
 *   6. Verifies the non-zero start-index case: start=2, count=3 → pages 2, 3, 4.
 *   7. Confirms no draft watermark appears when the invoice status is NOT
 *      "draft".
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
 * offer-pdf-watermark-multipage.test.ts and delivery-note-watermark-multipage.test.ts.
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
    /** Every watermark rotation angle, in render order. */
    rotateCalls: [] as number[],
    /** Styling calls, used to distinguish draft and cancellation marks. */
    fillColorCalls: [] as string[],
    opacityCalls: [] as number[],
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
     * The watermark loop calls switchToPage(start + i) once per iteration.
     * We record the argument so tests can verify that each page index gets
     * exactly one watermark, not the same page repeated.
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
    fillColor(color: string) {
      pdfState.fillColorCalls.push(color);
      return this;
    }
    strokeColor()    { return this; }
    lineWidth()      { return this; }
    opacity(value: number) {
      pdfState.opacityCalls.push(value);
      return this;
    }
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
    widthOfString()  { return 10; }
    heightOfString() { return 10; }
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

/** Build N line items. */
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
function stageDb(invoice: ReturnType<typeof buildInvoice>, itemCount = 6) {
  mockDbSelect
    .mockReturnValueOnce(selectChain([invoice]))
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain(buildItems(itemCount)));
}

/**
 * Returns all watermark calls from pdfState.calls whose text matches wmText.
 * Each entry is { text, page } — the page the watermark was painted on.
 */
function wmCallsFor(wmText: string) {
  return pdfState.calls.filter(c => c.text === wmText);
}

const INVOICE_ID = 42;
const URL = `/api/iroc/invoices/${INVOICE_ID}/pdf`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/invoices/:id/pdf — draft watermark appears on every page for multi-page invoices", () => {
  beforeEach(() => {
    pdfState.calls       = [];
    pdfState.rotateCalls = [];
    pdfState.fillColorCalls = [];
    pdfState.opacityCalls = [];
    pdfState.currentPage = 0;
    pdfConfig.pageCount  = 1;
    pdfConfig.pageStart  = 0;
    mockDbSelect.mockReset();
    updateReturning.mockReset();
  });

  it("renders the German watermark exactly once on each of 3 distinct pages (pages 0, 1, 2)", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 3;

    stageDb(buildInvoice({ status: "draft", language: "de" }), 6);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const DE_WATERMARK = "ENTWURF";
    const calls = wmCallsFor(DE_WATERMARK);

    // Three watermark calls total — one per page
    expect(calls).toHaveLength(3);

    // Each page index in [start … start+count-1] receives exactly one watermark
    const pages = calls.map(c => c.page).sort((a, b) => a - b);
    expect(pages).toEqual([0, 1, 2]);

    expect(pdfState.rotateCalls).toHaveLength(3);
    for (const angle of pdfState.rotateCalls) {
      expect(angle).toBe(-38);
    }
  });

  it("renders the English watermark exactly once on each of 2 distinct pages (pages 0, 1)", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 2;

    stageDb(buildInvoice({ status: "draft", language: "en" }), 4);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const EN_WATERMARK = "DRAFT";
    const calls = wmCallsFor(EN_WATERMARK);

    // Two watermark calls total — one per page
    expect(calls).toHaveLength(2);

    const pages = calls.map(c => c.page).sort((a, b) => a - b);
    expect(pages).toEqual([0, 1]);

    expect(pdfState.rotateCalls).toHaveLength(2);
    for (const angle of pdfState.rotateCalls) {
      expect(angle).toBe(-38);
    }
  });

  it("uses bufferedPageRange start index correctly — watermarks pages 2, 3, 4 when start=2, count=3", async () => {
    // Simulates a non-zero start: the buffer began at page 2.
    // The loop must call switchToPage(2), switchToPage(3), switchToPage(4).
    pdfConfig.pageStart = 2;
    pdfConfig.pageCount = 3;

    stageDb(buildInvoice({ status: "draft", language: "de" }), 6);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const DE_WATERMARK = "ENTWURF";
    const calls = wmCallsFor(DE_WATERMARK);

    expect(calls).toHaveLength(3);

    const pages = calls.map(c => c.page).sort((a, b) => a - b);
    // Must be start+0, start+1, start+2 — not 0, 1, 2
    expect(pages).toEqual([2, 3, 4]);
  });

  it("renders the German watermark exactly once for a single-page draft invoice (page 0)", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 1;

    stageDb(buildInvoice({ status: "draft", language: "de" }), 1);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const DE_WATERMARK = "ENTWURF";
    const calls = wmCallsFor(DE_WATERMARK);

    expect(calls).toHaveLength(1);
    expect(calls[0].page).toBe(0);
  });

  it("does NOT render any watermark when invoice status is 'sent'", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 3;

    stageDb(buildInvoice({ status: "sent", language: "de" }), 6);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    expect(wmCallsFor("ENTWURF")).toHaveLength(0);
    expect(wmCallsFor("DRAFT")).toHaveLength(0);
  });

  it("does NOT render any watermark when invoice status is 'paid'", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 2;

    stageDb(buildInvoice({ status: "paid", language: "de" }), 4);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    expect(wmCallsFor("ENTWURF")).toHaveLength(0);
    expect(wmCallsFor("DRAFT")).toHaveLength(0);
  });

  it("does not render the German watermark text when language is 'en'", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 2;

    stageDb(buildInvoice({ status: "draft", language: "en" }), 4);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    expect(wmCallsFor("ENTWURF")).toHaveLength(0);
  });

  it("does not render the English watermark text when language is 'de'", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 2;

    stageDb(buildInvoice({ status: "draft", language: "de" }), 4);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    expect(wmCallsFor("DRAFT")).toHaveLength(0);
  });

  it("renders the German STORNIERT watermark exactly once on every cancelled page", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 3;

    stageDb(buildInvoice({ status: "cancelled", language: "de" }), 6);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const calls = wmCallsFor("STORNIERT");
    expect(calls).toHaveLength(3);
    expect(calls.map(c => c.page).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(wmCallsFor("CANCELLED")).toHaveLength(0);
  });

  it("renders the English CANCELLED watermark on every cancelled page", async () => {
    pdfConfig.pageStart = 1;
    pdfConfig.pageCount = 2;

    stageDb(buildInvoice({ status: "cancelled", language: "en" }), 4);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const calls = wmCallsFor("CANCELLED");
    expect(calls).toHaveLength(2);
    expect(calls.map(c => c.page).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(wmCallsFor("STORNIERT")).toHaveLength(0);
  });

  it.each([
    { language: "de", label: "STORNIERT" },
    { language: "en", label: "CANCELLED" },
  ] as const)("uses the prominent cancellation color and opacity for the $label watermark", async ({
    language,
    label,
  }) => {
    pdfConfig.pageCount = 2;
    stageDb(buildInvoice({ status: "cancelled", language }), 4);

    const res = await request(app).get(URL).set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(wmCallsFor(label)).toHaveLength(2);
    expect(pdfState.fillColorCalls.filter(color => color === "#cc2222")).toHaveLength(2);
    expect(pdfState.opacityCalls.filter(opacity => opacity === 0.18)).toHaveLength(2);
    expect(pdfState.fillColorCalls).not.toContain("#aaaaaa");
    expect(pdfState.opacityCalls).not.toContain(0.22);
  });

  it("keeps draft styling separate from cancellation styling", async () => {
    pdfConfig.pageCount = 2;
    stageDb(buildInvoice({ status: "draft", language: "de" }), 4);

    const res = await request(app).get(URL).set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(pdfState.fillColorCalls.filter(color => color === "#aaaaaa")).toHaveLength(2);
    expect(pdfState.opacityCalls.filter(opacity => opacity === 0.22)).toHaveLength(2);
    expect(pdfState.fillColorCalls).not.toContain("#cc2222");
    expect(pdfState.opacityCalls).not.toContain(0.18);
  });

  it.each(["draft", "sent", "paid"] as const)(
    "does not render a cancelled watermark for a %s invoice",
    async status => {
      pdfConfig.pageStart = 0;
      pdfConfig.pageCount = 2;

      stageDb(buildInvoice({ status, language: "de" }), 4);

      const res = await request(app)
        .get(URL)
        .set("Authorization", AUTH);

      expect(res.status).toBe(200);
      expect(wmCallsFor("STORNIERT")).toHaveLength(0);
      expect(wmCallsFor("CANCELLED")).toHaveLength(0);
    },
  );

  it("each page receives exactly one watermark — no page is double-stamped", async () => {
    pdfConfig.pageStart = 0;
    pdfConfig.pageCount = 4;

    stageDb(buildInvoice({ status: "draft", language: "de" }), 8);

    const res = await request(app)
      .get(URL)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const DE_WATERMARK = "ENTWURF";
    const calls = wmCallsFor(DE_WATERMARK);

    // Exactly 4 watermarks for 4 pages
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
