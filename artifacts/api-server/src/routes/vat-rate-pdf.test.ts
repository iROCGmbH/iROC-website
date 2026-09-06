/**
 * Regression test: GET /iroc/invoices/:id/pdf — VAT rate label in totals block.
 *
 * Confirms that:
 *  1. A 7 % German invoice renders "Umsatzsteuer 7% **" in the PDF totals block.
 *  2. A 19 % German invoice renders "Umsatzsteuer 19% **" (baseline / sanity check).
 *  3. A 7 % English invoice renders "VAT 7% **" (en path).
 *
 * Strategy: PDFKit streams are FlateDecode-compressed so text is not readable
 * as raw bytes.  We mock PDFDocument to intercept every `.text()` call and
 * collect the rendered strings.  Assertions then check those captured strings
 * directly — no PDF parsing needed.
 *
 * Follows the MockPDFDocument pattern established in
 * legacy-invoice-salutation.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock-factory state ──────────────────────────────────────────────
const { pdfState, mockWhere, mockFrom, mockDbSelect } = vi.hoisted(() => {
  const pdfState = { capturedText: [] as string[] };
  const mockWhere    = vi.fn().mockResolvedValue([]);
  const mockFrom     = vi.fn().mockReturnValue({ where: mockWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { pdfState, mockWhere, mockFrom, mockDbSelect };
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
    select: mockDbSelect,
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
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

/** Base invoice shape shared by all fixtures. */
const baseInvoice = {
  id:                1,
  invoiceNumber:     "2025-0099",
  invoiceType:       "domestic",
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  customerId:        5,
  websiteCustomerId: null,
  status:            "draft",
  notes:             null,
  vatNote:           null,
  deliveryCosts:     "0.00",
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

/** 7 % German domestic invoice. */
const invoice7de = {
  ...baseInvoice,
  language:    "de",
  issueDate:   "2025-06-01",
  subtotal:    "1000.00",
  vatRate:     "7.00",
  vatAmount:   "70.00",
  total:       "1070.00",
};

/** 19 % German domestic invoice (baseline sanity check). */
const invoice19de = {
  ...baseInvoice,
  id:          2,
  invoiceNumber: "2025-0100",
  language:    "de",
  issueDate:   "2025-06-01",
  subtotal:    "1000.00",
  vatRate:     "19.00",
  vatAmount:   "190.00",
  total:       "1190.00",
};

/** 7 % English domestic invoice. */
const invoice7en = {
  ...baseInvoice,
  id:          3,
  invoiceNumber: "2025-0101",
  language:    "en",
  issueDate:   "2025-06-01",
  subtotal:    "1000.00",
  vatRate:     "7.00",
  vatAmount:   "70.00",
  total:       "1070.00",
};

/** 7 % English export (Commercial Invoice). */
const invoice7export = {
  ...baseInvoice,
  id:            4,
  invoiceNumber: "2025-0102",
  invoiceType:   "export",
  language:      "en",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "7.00",
  vatAmount:     "70.00",
  total:         "1070.00",
  orderNumber:   null,
  referenceNumber: null,
  shippingMethod:  "DHL Express",
  reasonForExport: "Sale",
  termsOfDelivery: "DAP",
};

/** 7 % English non-EU invoice. */
const invoice7noneu = {
  ...baseInvoice,
  id:            5,
  invoiceNumber: "2025-0103",
  invoiceType:   "noneu",
  language:      "en",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "7.00",
  vatAmount:     "70.00",
  total:         "1070.00",
};

/** 7 % German non-EU invoice. */
const invoice7noneuDe = {
  ...baseInvoice,
  id:            16,
  invoiceNumber: "2025-0114",
  invoiceType:   "noneu",
  language:      "de",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "7.00",
  vatAmount:     "70.00",
  total:         "1070.00",
};

/** 7 % English lecture-noneu invoice. */
const invoice7lectureNoneu = {
  ...baseInvoice,
  id:            6,
  invoiceNumber: "2025-0104",
  invoiceType:   "lecture-noneu",
  language:      "en",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "7.00",
  vatAmount:     "70.00",
  total:         "1070.00",
};

/** 7 % English lecture-eu invoice (non-zero rate to confirm no digit leaks). */
const invoice7lectureEuEn = {
  ...baseInvoice,
  id:            13,
  invoiceNumber: "2025-0111",
  invoiceType:   "lecture-eu",
  language:      "en",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "7.00",
  vatAmount:     "70.00",
  total:         "1070.00",
};

/** 7 % German lecture-eu invoice (non-zero rate to confirm no digit leaks). */
const invoice7lectureEuDe = {
  ...baseInvoice,
  id:            14,
  invoiceNumber: "2025-0112",
  invoiceType:   "lecture-eu",
  language:      "de",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "7.00",
  vatAmount:     "70.00",
  total:         "1070.00",
};

/** 7 % German lecture-noneu invoice. */
const invoice7lectureNoneuDe = {
  ...baseInvoice,
  id:            15,
  invoiceNumber: "2025-0113",
  invoiceType:   "lecture-noneu",
  language:      "de",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "7.00",
  vatAmount:     "70.00",
  total:         "1070.00",
};


/** 0 % English EU (reverse-charge) invoice. */
const invoice0euEn = {
  ...baseInvoice,
  id:            7,
  invoiceNumber: "2025-0105",
  invoiceType:   "eu",
  language:      "en",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "0.00",
  vatAmount:     "0.00",
  total:         "1000.00",
};

/** 0 % German EU (reverse-charge) invoice. */
const invoice0euDe = {
  ...baseInvoice,
  id:            8,
  invoiceNumber: "2025-0106",
  invoiceType:   "eu",
  language:      "de",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "0.00",
  vatAmount:     "0.00",
  total:         "1000.00",
};

/** 19 % English EU invoice (non-zero-rate EU customer). */
const invoice19euEn = {
  ...baseInvoice,
  id:            9,
  invoiceNumber: "2025-0107",
  invoiceType:   "eu",
  language:      "en",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "19.00",
  vatAmount:     "190.00",
  total:         "1190.00",
};

/** 19 % German EU invoice (non-zero-rate EU customer, German path). */
const invoice19euDe = {
  ...baseInvoice,
  id:            10,
  invoiceNumber: "2025-0108",
  invoiceType:   "eu",
  language:      "de",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "19.00",
  vatAmount:     "190.00",
  total:         "1190.00",
};

/** 7 % German EU invoice (non-zero-rate EU customer, German path). */
const invoice7euDe = {
  ...baseInvoice,
  id:            11,
  invoiceNumber: "2025-0109",
  invoiceType:   "eu",
  language:      "de",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "7.00",
  vatAmount:     "70.00",
  total:         "1070.00",
};

/** 7 % English EU invoice (non-zero-rate EU customer, English path). */
const invoice7euEn = {
  ...baseInvoice,
  id:            12,
  invoiceNumber: "2025-0110",
  invoiceType:   "eu",
  language:      "en",
  issueDate:     "2025-06-01",
  subtotal:      "1000.00",
  vatRate:       "7.00",
  vatAmount:     "70.00",
  total:         "1070.00",
};

/** Minimal customer (no salutation/title needed for these tests). */
const customer = {
  id:         5,
  salutation: null,
  title:      null,
  name:       "Testmann",
  company:    null,
  address:    "Teststr. 1",
  postalCode: "80331",
  city:       "München",
  country:    "Germany",
  vatId:      "DE123456789",
  isEu:       false,
  email:      "test@example.com",
  phone:      null,
  notes:      null,
  createdAt:  new Date(),
  updatedAt:  new Date(),
};

/**
 * The PDF route calls db.select() three times in sequence:
 *   1. irocInvoices      → the invoice row
 *   2. irocCustomers     → the legacy customer (websiteCustomerId is null)
 *   3. irocInvoiceItems  → compliant line item
 */
function stageDbSelects(invoice: object) {
  const source = invoice as { id?: number; invoiceType?: string; subtotal?: string; vatRate?: string };
  const requiresZeroVat = ["eu", "noneu", "export", "lecture-eu", "lecture-noneu"]
    .includes(source.invoiceType ?? "");
  const renderedInvoice = requiresZeroVat && Number(source.vatRate) !== 0
    ? {
      ...source,
      vatRate: "0.00",
      vatAmount: "0.00",
      total: source.subtotal,
    }
    : source;
  mockWhere
    .mockResolvedValueOnce([renderedInvoice]) // irocInvoices
    .mockResolvedValueOnce([customer])  // irocCustomers fallback
    .mockResolvedValueOnce([{
      id: 1,
      invoiceId: source.id ?? 1,
      productName: "iROC product",
      quantity: 1,
      unitPrice: source.subtotal ?? "1000.00",
      lineTotal: source.subtotal ?? "1000.00",
      vatRate: renderedInvoice.vatRate,
    }]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/invoices/:id/pdf — VAT rate label in totals block", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    mockWhere.mockReset().mockResolvedValue([]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });
  });

  it("renders 'Umsatzsteuer 7% **' for a 7 % German domestic invoice", async () => {
    stageDbSelects(invoice7de);

    const res = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // buildInvoicePDF: vatLabel = `Umsatzsteuer ${vatRateN.toFixed(0)}% **`
    // vatRateN.toFixed(0) for 7.00 → "7"
    expect(pdfState.capturedText).toContain("Umsatzsteuer 7% **");

    // Must NOT show a 19 % label
    const allText = pdfState.capturedText.join("\n");
    expect(allText).not.toContain("Umsatzsteuer 19% **");
  });

  it("renders 'Umsatzsteuer 19% **' for a 19 % German domestic invoice (baseline)", async () => {
    stageDbSelects(invoice19de);

    const res = await request(app)
      .get("/api/iroc/invoices/2/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(pdfState.capturedText).toContain("Umsatzsteuer 19% **");

    const allText = pdfState.capturedText.join("\n");
    expect(allText).not.toContain("Umsatzsteuer 7% **");
  });

  it("renders 'VAT 7% **' for a 7 % English domestic invoice", async () => {
    stageDbSelects(invoice7en);

    const res = await request(app)
      .get("/api/iroc/invoices/3/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(pdfState.capturedText).toContain("VAT 7% **");

    const allText = pdfState.capturedText.join("\n");
    expect(allText).not.toContain("VAT 19% **");
    // German label must not appear on an English invoice
    expect(allText).not.toContain("Umsatzsteuer 7% **");
  });

  it("renders 'VAT**' (no rate digit) for a 7 % English export (Commercial Invoice)", async () => {
    stageDbSelects(invoice7export);

    const res = await request(app)
      .get("/api/iroc/invoices/4/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // Export path: vatLabel is always the bare "VAT**" — no rate digit embedded.
    expect(pdfState.capturedText).toContain("VAT**");

    const allText = pdfState.capturedText.join("\n");

    expect(allText).toContain("€0,00");

    // No rate digit must leak into the label.
    expect(allText).not.toContain("VAT 7%");
    expect(allText).not.toContain("VAT 7% **");
    // German label must not appear on an export invoice.
    expect(allText).not.toContain("Umsatzsteuer");
  });

  it("renders 'VAT**' (no rate digit) for a 7 % English non-EU invoice", async () => {
    stageDbSelects(invoice7noneu);

    const res = await request(app)
      .get("/api/iroc/invoices/5/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // Non-EU path: vatLabel is the bare "VAT**" — no rate digit embedded.
    expect(pdfState.capturedText).toContain("VAT**");

    const allText = pdfState.capturedText.join("\n");

    expect(allText).toContain("€0,00");

    // No rate digit must leak into the label.
    expect(allText).not.toContain("VAT 7%");
    expect(allText).not.toContain("VAT 7% **");
    // German label must not appear on a non-EU invoice.
    expect(allText).not.toContain("Umsatzsteuer");
  });

  it("renders 'Umsatzsteuer**' (no rate digit) for a 7 % German non-EU invoice", async () => {
    stageDbSelects(invoice7noneuDe);

    const res = await request(app)
      .get("/api/iroc/invoices/16/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // German non-EU path follows the German lecture-noneu precedent:
    // vatLabel is the bare "Umsatzsteuer**" — no rate digit.
    expect(pdfState.capturedText).toContain("Umsatzsteuer**");

    const allText = pdfState.capturedText.join("\n");

    // The English bare label must NOT appear on a German invoice.
    expect(pdfState.capturedText).not.toContain("VAT**");

    // No rate digit must leak into the label.
    expect(allText).not.toContain("Umsatzsteuer 7%");
    expect(allText).not.toContain("Umsatzsteuer 7% **");
    expect(allText).not.toContain("VAT 7%");
    expect(allText).not.toContain("VAT 7% **");
  });

  it("renders 'VAT**' (no rate digit) for a 7 % English lecture-noneu invoice", async () => {
    stageDbSelects(invoice7lectureNoneu);

    const res = await request(app)
      .get("/api/iroc/invoices/6/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // Lecture-noneu path: vatLabel must be the bare "VAT**" — no rate digit embedded.
    expect(pdfState.capturedText).toContain("VAT**");

    const allText = pdfState.capturedText.join("\n");

    expect(allText).toContain("€0,00");

    // No rate digit must leak into the label.
    expect(allText).not.toContain("VAT 7%");
    expect(allText).not.toContain("VAT 7% **");
    // German label must not appear on a lecture-noneu invoice.
    expect(allText).not.toContain("Umsatzsteuer");
  });

  it("renders 'Umsatzsteuer**' (no rate digit) for a 7 % German lecture-noneu invoice", async () => {
    stageDbSelects(invoice7lectureNoneuDe);

    const res = await request(app)
      .get("/api/iroc/invoices/15/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // German lecture-noneu path: vatLabel must be the bare "Umsatzsteuer**" — no rate digit.
    expect(pdfState.capturedText).toContain("Umsatzsteuer**");

    const allText = pdfState.capturedText.join("\n");

    // The English bare label must NOT appear on a German invoice.
    const lines = pdfState.capturedText;
    expect(lines).not.toContain("VAT**");

    // No rate digit must leak into the label.
    expect(allText).not.toContain("VAT 7%");
    expect(allText).not.toContain("VAT 19% **");
  });

  it("renders 'VAT 0% **' (with rate digit) for a 0 % English EU reverse-charge invoice", async () => {
    stageDbSelects(invoice0euEn);

    const res = await request(app)
      .get("/api/iroc/invoices/7/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // EU path: vatLabel must carry the rate digit — never the bare "VAT**".
    expect(pdfState.capturedText).toContain("VAT 0% **");

    const allText = pdfState.capturedText.join("\n");

    // The bare label without a rate digit must NOT appear.
    // (Check for "VAT**" isolated, not as a substring of "VAT 0% **".)
    const lines = pdfState.capturedText;
    expect(lines).not.toContain("VAT**");

    // German label must not appear on an English invoice.
    expect(allText).not.toContain("Umsatzsteuer");
  });

  it("renders 'Umsatzsteuer 0% **' (with rate digit) for a 0 % German EU reverse-charge invoice", async () => {
    stageDbSelects(invoice0euDe);

    const res = await request(app)
      .get("/api/iroc/invoices/8/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // EU path (German): vatLabel must carry the rate digit.
    expect(pdfState.capturedText).toContain("Umsatzsteuer 0% **");

    const allText = pdfState.capturedText.join("\n");

    // The bare "VAT**" label (export/noneu path) must NOT appear.
    const lines = pdfState.capturedText;
    expect(lines).not.toContain("VAT**");

    // English "VAT" label must not appear on a German invoice.
    expect(allText).not.toContain("VAT 0% **");
  });

  it("normalizes an invalid non-zero English EU fixture to the compliant 0 % label", async () => {
    stageDbSelects(invoice19euEn);

    const res = await request(app)
      .get("/api/iroc/invoices/9/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // EU path: vatLabel must embed the rate digit regardless of whether rate is zero.
    expect(pdfState.capturedText).toContain("VAT 0% **");

    const allText = pdfState.capturedText.join("\n");

    // The bare label without a rate digit must NOT appear.
    const lines = pdfState.capturedText;
    expect(lines).not.toContain("VAT**");

    expect(allText).not.toContain("VAT 19% **");

    // German label must not appear on an English invoice.
    expect(allText).not.toContain("Umsatzsteuer");
  });

  it("normalizes an invalid non-zero German EU fixture to the compliant 0 % label", async () => {
    stageDbSelects(invoice19euDe);

    const res = await request(app)
      .get("/api/iroc/invoices/10/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // EU path (German): vatLabel must embed the rate digit.
    expect(pdfState.capturedText).toContain("Umsatzsteuer 0% **");

    const allText = pdfState.capturedText.join("\n");

    // The bare "VAT**" label (export/noneu path) must NOT appear.
    const lines = pdfState.capturedText;
    expect(lines).not.toContain("VAT**");

    // English "VAT" label must not appear on a German invoice.
    expect(allText).not.toContain("VAT 0% **");

    expect(allText).not.toContain("Umsatzsteuer 19% **");
  });

  it("normalizes an invalid 7 % English EU fixture to the compliant 0 % label", async () => {
    stageDbSelects(invoice7euEn);

    const res = await request(app)
      .get("/api/iroc/invoices/12/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // EU path (English): vatLabel must embed the 7 % rate digit with the English prefix.
    expect(pdfState.capturedText).toContain("VAT 0% **");

    const allText = pdfState.capturedText.join("\n");

    // The German label must NOT appear on an English invoice.
    expect(allText).not.toContain("Umsatzsteuer");

    // The 19 % English label must NOT appear.
    expect(allText).not.toContain("VAT 19% **");

    // The bare "VAT**" label (export/noneu path) must NOT appear.
    const lines = pdfState.capturedText;
    expect(lines).not.toContain("VAT**");
  });

  it("normalizes an invalid 7 % German EU fixture to the compliant 0 % label", async () => {
    stageDbSelects(invoice7euDe);

    const res = await request(app)
      .get("/api/iroc/invoices/11/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // EU path (German): vatLabel must embed the 7 % rate digit, not 19 %.
    expect(pdfState.capturedText).toContain("Umsatzsteuer 0% **");

    const allText = pdfState.capturedText.join("\n");

    // The 19 % label must NOT appear — this is the regression being guarded.
    expect(allText).not.toContain("Umsatzsteuer 19% **");

    // The bare "VAT**" label (export/noneu path) must NOT appear.
    const lines = pdfState.capturedText;
    expect(lines).not.toContain("VAT**");

    // English "VAT" labels must not appear on a German invoice.
    expect(allText).not.toContain("VAT 0% **");
    expect(allText).not.toContain("VAT**");
  });

  it("renders 'VAT**' (no rate digit) for a 7 % English lecture-eu invoice", async () => {
    stageDbSelects(invoice7lectureEuEn);

    const res = await request(app)
      .get("/api/iroc/invoices/13/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // Lecture-EU path: Reverse Charge — vatLabel must be the bare "VAT**", no rate digit.
    expect(pdfState.capturedText).toContain("VAT**");

    const allText = pdfState.capturedText.join("\n");

    expect(allText).toContain("€0,00");

    // No rate digit must leak into the label.
    expect(allText).not.toContain("VAT 7%");
    expect(allText).not.toContain("VAT 7% **");

    // German label must not appear on an English invoice.
    expect(allText).not.toContain("Umsatzsteuer");

    // Reverse Charge vatNote must appear.
    expect(allText).toContain("Reverse Charge");
  });

  it("renders 'VAT**' (no rate digit) for a 7 % German lecture-eu invoice", async () => {
    stageDbSelects(invoice7lectureEuDe);

    const res = await request(app)
      .get("/api/iroc/invoices/14/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // Lecture-EU path (German): Reverse Charge — vatLabel must be the bare "VAT**", no rate digit.
    expect(pdfState.capturedText).toContain("VAT**");

    const allText = pdfState.capturedText.join("\n");

    expect(allText).toContain("€0,00");

    // No rate digit must leak into the German label.
    expect(allText).not.toContain("Umsatzsteuer 7%");
    expect(allText).not.toContain("Umsatzsteuer 7% **");

    // Reverse Charge vatNote must appear (German text).
    expect(allText).toContain("Reverse Charge");
  });
});
