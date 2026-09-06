/**
 * Tests for POST /api/iroc/invoices/offer-pdf — form-state fidelity
 *
 * Confirms that the offer PDF reflects the items and prices supplied in the
 * request body, not any stored invoice data. This guards against a regression
 * where the endpoint might fall back to persisted invoice rows instead of
 * the unsaved form state sent by InvoiceEdit.
 *
 * Strategy:
 * - Give each DB table a distinct sentinel object so `db.select().from(table)`
 *   can be routed to a per-table mock.
 * - Supply a "stored" invoice row (returned only when irocInvoices is queried)
 *   with a price that differs from the one in the POST body.
 * - Assert the PDF contains the posted price and does NOT contain the stored
 *   price. If the endpoint ever reads stored invoice rows the wrong price
 *   would appear and the negative assertion would catch it.
 * - Also assert that db.select().from(irocInvoices) is never called (the
 *   invoice-table where-mock records all calls made against it).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock state so it is available inside vi.mock() factories ─────────────
const {
  pdfState,
  CUST_TABLE,
  INV_TABLE,
  INV_ITEMS_TABLE,
  mockCustWhere,
  mockInvWhere,
  mockInvItemsWhere,
  mockDbSelect,
} = vi.hoisted(() => {
  // Unique sentinel objects — the from() router uses reference equality.
  const CUST_TABLE       = { __sentinel: "websiteCustomers" };
  const INV_TABLE        = { __sentinel: "irocInvoices" };
  const INV_ITEMS_TABLE  = { __sentinel: "irocInvoiceItems" };

  const pdfState = { capturedText: [] as string[] };

  const mockCustWhere      = vi.fn().mockResolvedValue([]);
  const mockInvWhere       = vi.fn().mockResolvedValue([]);
  const mockInvItemsWhere  = vi.fn().mockResolvedValue([]);

  const mockFrom = vi.fn().mockImplementation((tbl: unknown) => {
    if (tbl === CUST_TABLE)      return { where: mockCustWhere };
    if (tbl === INV_TABLE)       return { where: mockInvWhere };
    if (tbl === INV_ITEMS_TABLE) return { where: mockInvItemsWhere };
    return { where: vi.fn().mockResolvedValue([]) };
  });

  const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return {
    pdfState,
    CUST_TABLE,
    INV_TABLE,
    INV_ITEMS_TABLE,
    mockCustWhere,
    mockInvWhere,
    mockInvItemsWhere,
    mockDbSelect,
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
    rotate()         { return this; }
    opacity()        { return this; }
    heightOfString() { return 10; }
    widthOfString()  { return 10; }
    bufferedPageRange() { return { start: 0, count: 1 }; }
    switchToPage(_n: number) { return this; }
    flushPages() { return this; }
    end(cb?: () => void) { super.end(cb); return this; }
  }

  return { default: MockPDFDocument };
});

// ── Mock @workspace/db — tables are the unique sentinel objects ───────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
  // These sentinel references are used by the iroc.ts route to call
  // db.select().from(<table>). Using the same objects lets the from() mock
  // distinguish customer lookups from invoice lookups.
  websiteCustomersTable:      CUST_TABLE,
  irocInvoices:               INV_TABLE,
  irocInvoiceItems:           INV_ITEMS_TABLE,
  irocCustomers:              {},
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
const websiteCustomer = {
  id:              10,
  customerNr:      "2026-0001",
  salutation:      "Frau",
  title:           null,
  firstName:       "Anna",
  lastName:        "Beispiel",
  specialty:       null,
  institutionName: null,
  institutionType: null,
  address:         "Teststr. 5",
  postalCode:      "10115",
  city:            "Berlin",
  country:         "Deutschland",
  phone:           null,
  fax:             null,
  email:           "anna@example.com",
  website:         null,
  referenceNumber: null,
  ustIdNr:         null,
  instrument:      "iroc",
  notes:           null,
  privacyConsent:  true,
  createdAt:       new Date(),
};

// Stored invoice row whose unitPrice intentionally differs from the POST body.
// If the offer-pdf endpoint ever reads this row instead of using the posted
// payload the stored price ("€100,00") would appear and the negative assertion
// would catch it.
const storedInvoiceRow = {
  id:          42,
  invoiceNumber: "RE-2026-0042",
  invoiceType: "domestic",
  language:    "de",
  issueDate:   "2026-01-01",
  dueDate:     null,
  orderNumber: null,
  referenceNumber: null,
  shippingMethod: null,
  reasonForExport: null,
  termsOfDelivery: null,
  deliveryCosts: "0.00",
  subtotal:    "100.00",   // ← stored price: €100,00
  vatRate:     "19.00",
  vatAmount:   "19.00",
  total:       "119.00",
  status:      "draft",
  notes:       null,
  vatNote:     null,
  customerId:  null,
  websiteCustomerId: 10,
  createdAt:   new Date(),
  updatedAt:   new Date(),
};

const storedInvoiceItem = {
  id:          1,
  invoiceId:   42,
  productId:   null,
  productName: "Gespeichertes Produkt",
  sku:         null,
  description: null,
  lotNumber:   null,
  hsCode:      null,
  countryOfOrigin: null,
  weightKg:    null,
  discountPercent: null,
  isDemo:      false,
  unitPrice:   "100.00",  // ← stored price: €100,00
  quantity:    1,
  lineTotal:   "100.00",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/iroc/invoices/offer-pdf — form-state fidelity", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    // Customer lookup succeeds.
    mockCustWhere.mockReset().mockResolvedValue([websiteCustomer]);
    // Invoice and item mocks return the conflicting stored data — if the
    // endpoint reads these, the wrong price will appear in the PDF.
    mockInvWhere.mockReset().mockResolvedValue([storedInvoiceRow]);
    mockInvItemsWhere.mockReset().mockResolvedValue([storedInvoiceItem]);
  });

  it("renders the unit-price from the request body, not the stored invoice price", async () => {
    // POST with a price (€999,00) that differs from the stored row (€100,00).
    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: 10,
        invoiceType: "domestic",
        issueDate: "2026-08-06",
        deliveryCosts: "0.00",
        vatRate: "19.00",
        language: "de",
        items: [
          {
            productId: null,
            productName: "Spiralcut-Set",
            unitPrice: "999.00",   // edited, unsaved price
            quantity: 1,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // The posted (unsaved) price must appear in the PDF — fmtEur(999) = "€999,00".
    expect(pdfState.capturedText).toContain("€999,00");

    // The stored price must NOT appear — if the endpoint fell back to stored
    // data the PDF would contain "€100,00" and this assertion would fail.
    const allText = pdfState.capturedText.join("\n");
    expect(allText).not.toContain("€100,00");
  });

  it("renders all per-item prices from the request body when multiple items are posted", async () => {
    const res = await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: 10,
        invoiceType: "domestic",
        issueDate: "2026-08-06",
        deliveryCosts: "0.00",
        vatRate: "19.00",
        language: "de",
        items: [
          { productId: null, productName: "Artikel A", unitPrice: "250.00", quantity: 2 },
          { productId: null, productName: "Artikel B", unitPrice: "75.50",  quantity: 1 },
        ],
      });

    expect(res.status).toBe(200);

    const allText = pdfState.capturedText.join("\n");
    // Both unsaved unit prices must appear — fmtEur(250)="€250,00", fmtEur(75.5)="€75,50".
    expect(allText).toContain("€250,00");
    expect(allText).toContain("€75,50");
    // The stored invoice price must not appear.
    expect(allText).not.toContain("€100,00");
  });

  it("never queries the irocInvoices or irocInvoiceItems tables", async () => {
    await request(app)
      .post("/api/iroc/invoices/offer-pdf")
      .set("Authorization", AUTH)
      .send({
        websiteCustomerId: 10,
        invoiceType: "domestic",
        issueDate: "2026-08-06",
        deliveryCosts: "0.00",
        vatRate: "19.00",
        language: "de",
        items: [
          { productId: null, productName: "Test", unitPrice: "500.00", quantity: 1 },
        ],
      });

    // The offer-pdf endpoint must never read stored invoice or item rows.
    // If it did, mockInvWhere / mockInvItemsWhere would have been called.
    expect(mockInvWhere).not.toHaveBeenCalled();
    expect(mockInvItemsWhere).not.toHaveBeenCalled();

    // The customer lookup is the only DB read: it must have been called once.
    expect(mockCustWhere).toHaveBeenCalledTimes(1);
  });
});
