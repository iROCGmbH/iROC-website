/**
 * Tests for POST /api/iroc/invoices/offer-pdf — offer language
 *
 * Verifies that the offer PDF's watermark, title, and bottom banner follow
 * the `language` field of the request body:
 *   – language "en" → "NON-BINDING OFFER" watermark + English banner
 *   – language "de" → "UNVERBINDLICHES ANGEBOT" watermark + German banner
 *
 * Strategy: PDFKit streams are FlateDecode-compressed, so we mock PDFDocument
 * and capture every `.text()` call (same approach as delivery-note tests).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock-factory state ──────────────────────────────────────────────────
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

    constructor(_opts?: unknown) {
      super();
    }

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
    rotate()         { return this; }
    opacity()        { return this; }
    heightOfString() { return 10; }
    widthOfString()  { return 10; }

    // bufferPages support (used by the offer-pdf route)
    bufferedPageRange() { return { start: 0, count: 1 }; }
    switchToPage(_n: number) { return this; }
    flushPages() { return this; }

    end(cb?: () => void) {
      super.end(cb);
      return this;
    }
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
  irocProductGroups:          {},
  irocInventoryLots:          {},
  irocLeads:                  {},
  irocOrders:                 {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable:        {},
  doctorCertificationsTable:  {},
}));

// ── Import app AFTER mocks ────────────────────────────────────────────────────
import app from "../app";

// ── JWT helper (mirrors iroc.ts signToken) ────────────────────────────────────
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

const websiteCustomer = {
  id:                      10,
  customerNr:              "2026-0001",
  salutation:              "Herr",
  title:                   null,
  firstName:               "Max",
  lastName:                "Mustermann",
  specialty:               null,
  institutionName:         null,
  institutionType:         null,
  address:                 "Musterstr. 1",
  postalCode:              "80001",
  city:                    "München",
  country:                 "Deutschland",
  phone:                   null,
  fax:                     null,
  email:                   "max@example.com",
  website:                 null,
  referenceNumber:         null,
  ustIdNr:                 null,
  instrument:              "iroc",
  notes:                   null,
  privacyConsent:          true,
  createdAt:               new Date(),
};

function offerBody(language: "de" | "en") {
  return {
    websiteCustomerId: 10,
    invoiceType: "domestic",
    issueDate: "2026-08-06",
    deliveryCosts: "0.00",
    vatRate: "19.00",
    language,
    items: [
      {
        productId: null,
        productName: "Test Product",
        unitPrice: "100.00",
        quantity: 1,
      },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/iroc/invoices/offer-pdf — language of watermark & banner", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    mockWhere.mockReset().mockResolvedValue([websiteCustomer]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });
  });

  it('language "en" renders the English watermark, title, and banner', async () => {
    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(offerBody("en"));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);
    expect(res.headers["content-disposition"]).toContain("Offer_2026-08-06.pdf");

    expect(pdfState.capturedText).toContain("NON-BINDING OFFER");
    expect(pdfState.capturedText).toContain("Offer");
    // Banner text for a non-lecture domestic offer in English
    expect(pdfState.capturedText).toContain("Non-binding offer");
    // English auto VAT footnote for domestic type
    expect(pdfState.capturedText).toContain("** Subject to VAT.");

    const all = pdfState.capturedText.join("\n");
    expect(all).not.toContain("UNVERBINDLICHES ANGEBOT");
    expect(all).not.toContain("Unverbindliches Angebot – Zahlungsfrist");
    expect(all).not.toContain("** Steuerpflichtige Lieferung.");
  });

  it('language "de" renders the German watermark, title, and banner', async () => {
    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(offerBody("de"));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);
    expect(res.headers["content-disposition"]).toContain("Angebot_2026-08-06.pdf");

    expect(pdfState.capturedText).toContain("UNVERBINDLICHES ANGEBOT");
    expect(pdfState.capturedText).toContain("Angebot");
    // Banner text for a non-lecture domestic offer in German
    expect(pdfState.capturedText).toContain("Unverbindliches Angebot");
    // German auto VAT footnote for domestic type
    expect(pdfState.capturedText).toContain("** Steuerpflichtige Lieferung.");

    const all = pdfState.capturedText.join("\n");
    expect(all).not.toContain("NON-BINDING OFFER");
    expect(all).not.toContain("Non-binding offer – Payment due by");
    expect(all).not.toContain("** Subject to VAT.");
  });

  it("preserves a customized linked product name alongside an unchanged canonical name", async () => {
    const body = offerBody("en");
    body.items = [
      {
        productId: null,
        productName: "Customer-specific product name",
        unitPrice: "100.00",
        quantity: 1,
      },
      {
        productId: null,
        productName: "Test Product",
        unitPrice: "50.00",
        quantity: 1,
      },
    ];

    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send(body);

    expect(res.status).toBe(200);
    const all = pdfState.capturedText.join("\n");
    expect(all).toContain("Customer-specific product name");
    expect(all).toContain("Test Product");
  });
});
