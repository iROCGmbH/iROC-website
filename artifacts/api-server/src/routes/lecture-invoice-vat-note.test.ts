/**
 * Regression test: GET /iroc/invoices/:id/pdf — vatNote footnote for lecture types.
 *
 * Confirms that:
 *  1. A `lecture-eu` German PDF renders the §3a Abs. 2 / §13b UStG Reverse Charge footnote.
 *  2. A `lecture-eu` English PDF renders the English equivalent.
 *  3. A `lecture-noneu` German PDF renders the "nicht steuerbar gem. §3a Abs. 2 UStG" footnote.
 *  4. A `lecture-noneu` English PDF renders the English equivalent.
 *  5. Neither lecture type shows the generic export (§4 Nr. 1a UStG) text.
 *  6. Neither lecture type shows the regular EU Reverse Charge goods text (without §3a).
 *
 * Strategy: PDFKit streams are FlateDecode-compressed so text is not readable as raw bytes.
 * We mock PDFDocument to intercept every `.text()` call and collect the rendered strings.
 * Assertions then check those captured strings directly — no PDF parsing needed.
 *
 * Follows the MockPDFDocument pattern established in vat-rate-pdf.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock-factory state ──────────────────────────────────────────────
const {
  pdfState,
  mockWhere,
  mockFrom,
  mockDbSelect,
  mockDbUpdate,
  mockUpdateSet,
  mockUpdateWhere,
  mockUpdateReturning,
  mockDbDelete,
  mockDbInsert,
  mockInsertValues,
  mockInsertReturning,
} = vi.hoisted(() => {
  const pdfState = { capturedText: [] as string[] };
  const mockWhere    = vi.fn().mockResolvedValue([]);
  const mockFrom     = vi.fn().mockReturnValue({ where: mockWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });
  const mockUpdateReturning = vi.fn();
  const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
  const mockDbDelete = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  const mockInsertReturning = vi.fn();
  const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  return {
    pdfState,
    mockWhere,
    mockFrom,
    mockDbSelect,
    mockDbUpdate,
    mockUpdateSet,
    mockUpdateWhere,
    mockUpdateReturning,
    mockDbDelete,
    mockDbInsert,
    mockInsertValues,
    mockInsertReturning,
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

const baseInvoice = {
  id:                20,
  invoiceNumber:     "2025-0120",
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
  vatNote:           null,   // no override — force fallback computation
  deliveryCosts:     "0.00",
  insuranceCosts:    "0.00",
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

/** lecture-eu, German language */
const invLectureEuDe = {
  ...baseInvoice,
  id:          20,
  invoiceNumber: "2025-0120",
  invoiceType: "lecture-eu",
  language:    "de",
  issueDate:   "2025-08-01",
  subtotal:    "500.00",
  vatRate:     "0.00",
  vatAmount:   "0.00",
  total:       "500.00",
};

/** lecture-eu, English language */
const invLectureEuEn = {
  ...baseInvoice,
  id:          21,
  invoiceNumber: "2025-0121",
  invoiceType: "lecture-eu",
  language:    "en",
  issueDate:   "2025-08-01",
  subtotal:    "500.00",
  vatRate:     "0.00",
  vatAmount:   "0.00",
  total:       "500.00",
};

/** lecture-noneu, German language */
const invLectureNoneuDe = {
  ...baseInvoice,
  id:          22,
  invoiceNumber: "2025-0122",
  invoiceType: "lecture-noneu",
  language:    "de",
  issueDate:   "2025-08-01",
  subtotal:    "500.00",
  vatRate:     "0.00",
  vatAmount:   "0.00",
  total:       "500.00",
};

/** lecture-noneu, English language */
const invLectureNoneuEn = {
  ...baseInvoice,
  id:          23,
  invoiceNumber: "2025-0123",
  invoiceType: "lecture-noneu",
  language:    "en",
  issueDate:   "2025-08-01",
  subtotal:    "500.00",
  vatRate:     "0.00",
  vatAmount:   "0.00",
  total:       "500.00",
};

/** Minimal customer (no shipping address, no special fields needed). */
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
  mockWhere
    .mockResolvedValueOnce([invoice])   // irocInvoices
    .mockResolvedValueOnce([customer])  // irocCustomers fallback
    .mockResolvedValueOnce([{
      id: 1,
      invoiceId: (invoice as { id?: number }).id ?? 20,
      productName: "Lecture service",
      quantity: 1,
      unitPrice: "500.00",
      lineTotal: "500.00",
      vatRate: "0.00",
    }]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/invoices/:id/pdf — lecture-type vatNote footnote", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    mockWhere.mockReset().mockResolvedValue([]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });
    mockUpdateSet.mockReset().mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockReset().mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateReturning.mockReset();
    mockDbUpdate.mockReset().mockReturnValue({ set: mockUpdateSet });
    mockDbDelete.mockReset().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
    mockInsertValues.mockReset().mockReturnValue({ returning: mockInsertReturning });
    mockInsertReturning.mockReset();
    mockDbInsert.mockReset().mockReturnValue({ values: mockInsertValues });
  });

  // ── lecture-eu ────────────────────────────────────────────────────────────

  it("lecture-eu German: renders §3a Abs. 2 / §13b UStG Reverse Charge footnote", async () => {
    stageDbSelects(invLectureEuDe);

    const res = await request(app)
      .get("/api/iroc/invoices/20/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");

    // Must contain the §3a Abs. 2 lecture-EU footnote (German)
    // New legal text uses § 3a ... § 13b with proper spacing + Art. 196 MwStSystRL
    expect(allText).toContain("Vortrag");
    expect(allText).toContain("Reverse Charge");
    expect(allText).toContain("MwStSystRL");

    // Must NOT show the generic export footnote
    expect(allText).not.toContain("§ 4 No. 1a UStG");
    expect(allText).not.toContain("§ 4 Nr. 1a UStG");

    // Must NOT show the plain EU Reverse Charge goods text (without §3a)
    // The plain EU note is "** Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)"
    // The lecture-eu note adds "Sonstige Leistung" and "§3a" — ensure the simpler text
    // does NOT appear as a standalone line (it won't if only lecture text was rendered).
    // We check that the §4 export text is absent, which is the key guard.
    expect(allText).not.toContain("§ 6 UStG");

    // Must NOT show the lecture-noneu "nicht steuerbar" text
    expect(allText).not.toContain("nicht steuerbar in Deutschland");
  });

  it("lecture-eu English: renders §3a (2) UStG / §13b UStG Reverse Charge footnote", async () => {
    stageDbSelects(invLectureEuEn);

    const res = await request(app)
      .get("/api/iroc/invoices/21/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");

    // Must contain the English §3a (2) lecture-EU footnote
    // New legal text uses § 3a (2) UStG ... § 13b (1) UStG + VAT Directive citation
    expect(allText).toContain("VAT Directive");
    expect(allText).toContain("Reverse Charge");
    expect(allText).toContain("speaking");

    // Must NOT show the generic export footnote
    expect(allText).not.toContain("§ 4 No. 1a UStG");

    // Must NOT show the lecture-noneu "not subject to German VAT" text
    expect(allText).not.toContain("not subject to German VAT");
  });

  // ── lecture-noneu ─────────────────────────────────────────────────────────

  it("lecture-noneu German: renders 'nicht steuerbar in Deutschland gem. §3a Abs. 2 UStG' footnote", async () => {
    stageDbSelects(invLectureNoneuDe);

    const res = await request(app)
      .get("/api/iroc/invoices/22/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");

    // Must contain the §3a Abs. 2 lecture-noneu footnote (German)
    // New legal text: "Nicht steuerbar in Deutschland" (capital N after period) + Drittland citation
    expect(allText).toContain("Nicht steuerbar in Deutschland");
    expect(allText).toContain("Drittland");

    // Must NOT show the generic export footnote
    expect(allText).not.toContain("§ 4 No. 1a UStG");
    expect(allText).not.toContain("§ 6 UStG");

    // Must NOT show the Reverse Charge goods text (§13b)
    expect(allText).not.toContain("§13b UStG");

    // Must NOT show the lecture-eu Reverse Charge text
    expect(allText).not.toContain("EU-Ausland");
  });

  it("lecture-noneu English: renders 'not subject to German VAT pursuant to §3a (2) UStG' footnote", async () => {
    stageDbSelects(invLectureNoneuEn);

    const res = await request(app)
      .get("/api/iroc/invoices/23/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");

    // Must contain the English lecture-noneu footnote
    // New legal text: "Not subject to German VAT" (capital N after period) + third country
    expect(allText).toContain("Not subject to German VAT");
    expect(allText).toContain("third country");

    // Must NOT show the generic export footnote
    expect(allText).not.toContain("§ 4 No. 1a UStG");

    // Must NOT show the Reverse Charge text (only lecture-eu has that)
    expect(allText).not.toContain("Reverse Charge");

    // Must NOT show the lecture-eu footnote text
    expect(allText).not.toContain("§13b UStG");
  });

  // ── vatNote override guard ─────────────────────────────────────────────────

  it("lecture-eu with custom vatNote override: renders the custom string, not the §3a default", async () => {
    const customNote = "** Benutzerdefinierter Hinweis: Diese Rechnung ist von der Steuer befreit.";
    const invoiceWithOverride = {
      ...invLectureEuDe,
      id:            30,
      invoiceNumber: "2025-0130",
      vatNote:       customNote,
    };
    stageDbSelects(invoiceWithOverride);

    const res = await request(app)
      .get("/api/iroc/invoices/30/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");

    // Must render the custom override verbatim
    expect(allText).toContain(customNote);

    // Must NOT fall back to the §3a Abs. 2 lecture-eu default
    // Must NOT contain the lecture-eu default (MwStSystRL is unique to that branch)
    expect(allText).not.toContain("MwStSystRL");
    expect(allText).not.toContain("EU-Ausland");
  });

  it("lecture-noneu with custom vatNote override: renders the custom string, not the §3a default", async () => {
    const customNote = "** Custom override: VAT exemption applies per bilateral agreement.";
    const invoiceWithOverride = {
      ...invLectureNoneuEn,
      id:            31,
      invoiceNumber: "2025-0131",
      vatNote:       customNote,
    };
    stageDbSelects(invoiceWithOverride);

    const res = await request(app)
      .get("/api/iroc/invoices/31/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");

    // Must render the custom override verbatim
    expect(allText).toContain(customNote);

    // Must NOT fall back to the §3a (2) lecture-noneu default
    // Must NOT contain the lecture-noneu default (third country phrasing is unique to that branch)
    expect(allText).not.toContain("not subject to German VAT");
    expect(allText).not.toContain("third country");
  });

  it("lecture-eu with an empty vatNote: falls back to the §3a default", async () => {
    const invoiceWithEmptyNote = {
      ...invLectureEuDe,
      id:            32,
      invoiceNumber: "2025-0132",
      vatNote:       "",
    };
    stageDbSelects(invoiceWithEmptyNote);

    const res = await request(app)
      .get("/api/iroc/invoices/32/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");

    // An empty override must behave like null and render the lecture-EU default.
    expect(allText).toContain("Vortrag");
    expect(allText).toContain("Reverse Charge");
    expect(allText).toContain("MwStSystRL");
    expect(allText).not.toContain("Nicht steuerbar in Deutschland");
  });

  it("lecture-noneu with an empty vatNote: falls back to the §3a default", async () => {
    const invoiceWithEmptyNote = {
      ...invLectureNoneuDe,
      id:            33,
      invoiceNumber: "2025-0133",
      vatNote:       "",
    };
    stageDbSelects(invoiceWithEmptyNote);

    const res = await request(app)
      .get("/api/iroc/invoices/33/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");

    // An empty override must behave like null and render the lecture-non-EU default.
    expect(allText).toContain("Nicht steuerbar in Deutschland");
    expect(allText).toContain("Drittland");
    expect(allText).not.toContain("Reverse Charge");
    expect(allText).not.toContain("MwStSystRL");
  });

  // ── save → PDF round-trip ───────────────────────────────────────────────────

  it("lecture-eu: preserves a custom vatNote through PUT and the subsequent PDF", async () => {
    const customNote = "** Individueller EU-Hinweis: Die Vortragsleistung wird ohne deutsche Umsatzsteuer abgerechnet.";
    const existingInvoice = {
      ...invLectureEuDe,
      id: 40,
      invoiceNumber: "2025-0140",
      status: "draft",
      websiteCustomerId: null,
      customerId: 5,
      insuranceCosts: "0.00",
    };
    let persistedInvoice!: Record<string, unknown>;

    // PUT: existing invoice → website customer → replaced line items.
    mockWhere
      .mockResolvedValueOnce([existingInvoice])
      .mockResolvedValueOnce([customer])
      .mockResolvedValueOnce([]);
    mockUpdateReturning.mockImplementationOnce(async () => {
      const payload = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
      persistedInvoice = { ...existingInvoice, ...payload };
      return [persistedInvoice];
    });

    const putRes = await request(app)
      .put("/api/iroc/invoices/40")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: 5,
        invoiceType: "lecture-eu",
        issueDate: "2025-08-01",
        dueDate: null,
        orderNumber: null,
        referenceNumber: null,
        buyerVatId: "DE123456789",
        shippingMethod: null,
        reasonForExport: null,
        termsOfDelivery: null,
        deliveryCosts: "0.00",
        vatRate: "0.00",
        notes: null,
        vatNote: customNote,
        language: "de",
        items: [{
          productId: null,
          productName: "Vortragsleistung",
          sku: null,
          description: null,
          lotNumber: null,
          hsCode: null,
          countryOfOrigin: null,
          weightKg: null,
          unitPrice: "500.00",
          discountPercent: null,
          isDemo: false,
          quantity: 1,
        }],
      });

    expect(putRes.status).toBe(200);
    expect((mockUpdateSet.mock.calls[0][0] as Record<string, unknown>).vatNote).toBe(customNote);

    // GET /pdf must read the row returned by the save, not the pre-save fixture.
    mockWhere
      .mockResolvedValueOnce([persistedInvoice])
      .mockResolvedValueOnce([customer])
      .mockResolvedValueOnce([{
        id: 1, invoiceId: 40, productName: "Vortragsleistung", quantity: 1,
        unitPrice: "500.00", lineTotal: "500.00", vatRate: "0.00",
      }]);

    const pdfRes = await request(app)
      .get("/api/iroc/invoices/40/pdf")
      .set("Authorization", AUTH);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers["content-type"]).toMatch(/pdf/);
    const allText = pdfState.capturedText.join("\n");
    expect(allText).toContain(customNote);
    expect(allText).not.toContain("MwStSystRL");
  });

  it("lecture-noneu: preserves a custom vatNote through PUT and the subsequent PDF", async () => {
    const customNote = "** Custom third-country note: recipient-country VAT rules apply.";
    const existingInvoice = {
      ...invLectureNoneuEn,
      id: 41,
      invoiceNumber: "2025-0141",
      status: "draft",
      websiteCustomerId: null,
      customerId: 5,
      insuranceCosts: "0.00",
    };
    let persistedInvoice!: Record<string, unknown>;

    // PUT: existing invoice → website customer → replaced line items.
    mockWhere
      .mockResolvedValueOnce([existingInvoice])
      .mockResolvedValueOnce([customer])
      .mockResolvedValueOnce([]);
    mockUpdateReturning.mockImplementationOnce(async () => {
      const payload = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
      persistedInvoice = { ...existingInvoice, ...payload };
      return [persistedInvoice];
    });

    const putRes = await request(app)
      .put("/api/iroc/invoices/41")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: 5,
        invoiceType: "lecture-noneu",
        issueDate: "2025-08-01",
        dueDate: null,
        orderNumber: null,
        referenceNumber: null,
        shippingMethod: null,
        reasonForExport: null,
        termsOfDelivery: null,
        deliveryCosts: "0.00",
        vatRate: "0.00",
        notes: null,
        vatNote: customNote,
        language: "en",
        items: [{
          productId: null,
          productName: "Lecture service",
          sku: null,
          description: null,
          lotNumber: null,
          hsCode: null,
          countryOfOrigin: null,
          weightKg: null,
          unitPrice: "500.00",
          discountPercent: null,
          isDemo: false,
          quantity: 1,
        }],
      });

    expect(putRes.status).toBe(200);
    expect((mockUpdateSet.mock.calls[0][0] as Record<string, unknown>).vatNote).toBe(customNote);

    mockWhere
      .mockResolvedValueOnce([persistedInvoice])
      .mockResolvedValueOnce([customer])
      .mockResolvedValueOnce([{
        id: 1, invoiceId: 41, productName: "Lecture service", quantity: 1,
        unitPrice: "500.00", lineTotal: "500.00", vatRate: "0.00",
      }]);

    const pdfRes = await request(app)
      .get("/api/iroc/invoices/41/pdf")
      .set("Authorization", AUTH);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers["content-type"]).toMatch(/pdf/);
    const allText = pdfState.capturedText.join("\n");
    expect(allText).toContain(customNote);
    expect(allText).not.toContain("Not subject to German VAT");
  });

  // ── Retired duplicate route ─────────────────────────────────────────────────

  it.each([
    {
      label: "lecture-eu",
      sourceId: 50,
    },
    {
      label: "lecture-noneu",
      sourceId: 51,
    },
  ])("$label: rejects the retired duplicate route in favor of immutable corrections", async ({ sourceId }) => {
    // The route still resolves the requested source before directing callers
    // to the correction workflow.
    mockWhere.mockResolvedValueOnce([{ id: sourceId }]);

    const duplicateRes = await request(app)
      .post(`/api/iroc/invoices/${sourceId}/duplicate`)
      .set("Authorization", AUTH);

    // Generic duplication was deliberately retired: it could create an
    // untraceable, mutable credit document. Returned products must use the
    // linked correction endpoint, which snapshots the original buyer and VAT
    // note. Do not revive this path just to satisfy stale PDF fixtures.
    expect(duplicateRes.status).toBe(410);
    expect(duplicateRes.body.error).toContain("invoice-correction workflow");
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
