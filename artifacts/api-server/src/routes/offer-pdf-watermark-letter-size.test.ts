/**
 * Confirmation test: watermark rotate origin and text y-position are correct
 * on non-A4 page sizes (US Letter: 612 × 792 pt).
 *
 * What & Why
 * ──────────
 * The watermark loop reads doc.page.width (pw) and doc.page.height (ph) to
 * compute:
 *   - rotate origin  → [pw / 2, ph / 2]
 *   - text y-position → ph / 2 - 36
 *
 * For the default A4 size (595.28 × 841.89) these values are derived
 * implicitly, but the calculation is generic and must also be correct for
 * US Letter (612 × 792 pt) — or any other page size a caller might pass.
 *
 * This test:
 *   1. Overrides MockPDFDocument.page to US Letter dimensions.
 *   2. Captures every doc.rotate() call's origin argument.
 *   3. Captures every doc.text() call's y argument.
 *   4. Asserts rotate origin === [306, 396]  (612/2, 792/2).
 *   5. Asserts text y-position === 360       (792/2 - 36).
 *
 * Strategy
 * ────────
 * Follows the MockPDFDocument / selectChain pattern from
 * offer-pdf-watermark-multipage.test.ts.
 * The MockPDFDocument now captures rotate() and text() arguments so the
 * assertions can inspect the exact values the watermark loop computed.
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

  /** Controls bufferedPageRange(). Set per test before posting. */
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
     * Record the text together with the y-coordinate and the currently active
     * page index.  The watermark loop calls:
     *   .text(wmText, 0, ph / 2 - 36, { width: pw, align: "center", … })
     * so args[1] is the x position (0) and args[2] is the y position.
     */
    text(str: string, ...rest: unknown[]) {
      if (typeof str === "string") {
        // Signature variants: text(str), text(str, opts), text(str, x, y, opts)
        // The watermark always uses text(str, x, y, opts) → rest[0]=x, rest[1]=y, rest[2]=opts
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

function buildOfferBody(language: "de" | "en") {
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
    items: [
      {
        productId:       null,
        productName:     "Product 1",
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
      },
    ],
  };
}

// US Letter dimensions in points
const LETTER_WIDTH  = 612;
const LETTER_HEIGHT = 792;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices/offer-pdf — watermark rotate origin and text y-position on US Letter page size", () => {
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

  it("passes rotate origin [306, 396] — half of US Letter width and height", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("de"));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // Expect exactly one rotate call (one page)
    expect(pdfState.rotateCalls).toHaveLength(1);

    const [call] = pdfState.rotateCalls;
    // Angle must be -38
    expect(call.angle).toBe(-38);
    // Origin must be [pw/2, ph/2] = [306, 396]
    expect(call.origin).toEqual([LETTER_WIDTH / 2, LETTER_HEIGHT / 2]);
    expect(call.origin).toEqual([306, 396]);
  });

  it("passes text y-position 360 — ph/2 - 36 for US Letter height", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("de"));

    expect(res.status).toBe(200);

    const DE_WATERMARK = "UNVERBINDLICHES ANGEBOT";
    const wmCalls = pdfState.textCalls.filter(c => c.text === DE_WATERMARK);

    expect(wmCalls).toHaveLength(1);

    const [wm] = wmCalls;
    // ph / 2 - 36 = 792 / 2 - 36 = 396 - 36 = 360
    expect(wm.y).toBe(LETTER_HEIGHT / 2 - 36);
    expect(wm.y).toBe(360);
  });

  it("rotate origin and text y-position are both correct in a single request on US Letter", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("en"));

    expect(res.status).toBe(200);

    // Rotate angle must be -38 for "en" language on US Letter
    expect(pdfState.rotateCalls).toHaveLength(1);
    expect(pdfState.rotateCalls[0].angle).toBe(-38);

    // Rotate origin
    expect(pdfState.rotateCalls[0].origin).toEqual([306, 396]);

    // Text y-position
    const EN_WATERMARK = "NON-BINDING OFFER";
    const wmCalls = pdfState.textCalls.filter(c => c.text === EN_WATERMARK);
    expect(wmCalls).toHaveLength(1);
    expect(wmCalls[0].y).toBe(360);
  });

  it("passes width option equal to page width (612) so the centred text spans the full page", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("de"));

    expect(res.status).toBe(200);

    const DE_WATERMARK = "UNVERBINDLICHES ANGEBOT";
    const wmCalls = pdfState.textCalls.filter(c => c.text === DE_WATERMARK);

    expect(wmCalls).toHaveLength(1);
    // The width option must equal pw (page width = 612) so text() centres
    // the string relative to the full page width, not a stale/default value.
    expect(wmCalls[0].opts).toBeDefined();
    expect(wmCalls[0].opts!["width"]).toBe(LETTER_WIDTH);
    expect(wmCalls[0].opts!["width"]).toBe(612);
  });

  it("rotate origin and text y-position scale correctly across multiple pages on US Letter", async () => {
    pdfConfig.pageCount = 3;
    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("de"));

    expect(res.status).toBe(200);

    // All three pages must use angle -38 and the same origin
    expect(pdfState.rotateCalls).toHaveLength(3);
    for (const call of pdfState.rotateCalls) {
      expect(call.angle).toBe(-38);
      expect(call.origin).toEqual([306, 396]);
    }

    // All three watermark text calls should use the same y-position
    const DE_WATERMARK = "UNVERBINDLICHES ANGEBOT";
    const wmCalls = pdfState.textCalls.filter(c => c.text === DE_WATERMARK);
    expect(wmCalls).toHaveLength(3);
    for (const wm of wmCalls) {
      expect(wm.y).toBe(360);
    }
  });
});

// ── A4 page size ──────────────────────────────────────────────────────────────

// A4 dimensions in points (as used by PDFKit)
const A4_WIDTH  = 595.28;
const A4_HEIGHT = 841.89;

describe("POST /iroc/invoices/offer-pdf — watermark angle is -38 on A4 page size", () => {
  beforeEach(() => {
    pdfState.textCalls   = [];
    pdfState.rotateCalls = [];
    pdfState.currentPage = 0;
    // Set A4 dimensions
    pdfState.pageWidth   = A4_WIDTH;
    pdfState.pageHeight  = A4_HEIGHT;
    pdfConfig.pageCount  = 1;
    pdfConfig.pageStart  = 0;
    mockDbSelect.mockReset();
    updateReturning.mockReset();
  });

  it("uses angle -38 for German watermark on A4", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("de"));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    expect(pdfState.rotateCalls).toHaveLength(1);
    expect(pdfState.rotateCalls[0].angle).toBe(-38);
    // Origin must be [A4_WIDTH/2, A4_HEIGHT/2]
    expect(pdfState.rotateCalls[0].origin).toEqual([A4_WIDTH / 2, A4_HEIGHT / 2]);
  });

  it("uses angle -38 for English watermark on A4", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("en"));

    expect(res.status).toBe(200);

    expect(pdfState.rotateCalls).toHaveLength(1);
    expect(pdfState.rotateCalls[0].angle).toBe(-38);
    expect(pdfState.rotateCalls[0].origin).toEqual([A4_WIDTH / 2, A4_HEIGHT / 2]);

    const EN_WATERMARK = "NON-BINDING OFFER";
    const wmCalls = pdfState.textCalls.filter(c => c.text === EN_WATERMARK);
    expect(wmCalls).toHaveLength(1);
    // y = A4_HEIGHT / 2 - 36
    expect(wmCalls[0].y).toBeCloseTo(A4_HEIGHT / 2 - 36, 5);
  });

  it("uses angle -38 on every page for a multi-page A4 document", async () => {
    pdfConfig.pageCount = 3;
    mockDbSelect.mockReturnValueOnce(selectChain([WC]));

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(buildOfferBody("de"));

    expect(res.status).toBe(200);

    expect(pdfState.rotateCalls).toHaveLength(3);
    for (const call of pdfState.rotateCalls) {
      expect(call.angle).toBe(-38);
      expect(call.origin).toEqual([A4_WIDTH / 2, A4_HEIGHT / 2]);
    }
  });
});
