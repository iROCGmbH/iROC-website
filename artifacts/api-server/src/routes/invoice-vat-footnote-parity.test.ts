/**
 * End-to-end PDF parity coverage for regular invoice VAT footnotes.
 *
 * Each case drives the real authenticated PDF route with vatNote=null (the
 * value persisted when the admin leaves the generated note alone or resets a
 * manual edit). PDFKit is mocked only to capture rendered text.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { computeDefaultVatNote } from "@workspace/api-zod";

const { pdfState, mockWhere, mockFrom, mockDbSelect } = vi.hoisted(() => {
  const pdfState = { capturedText: [] as string[] };
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { pdfState, mockWhere, mockFrom, mockDbSelect };
});

vi.mock("pdfkit", () => {
  const { PassThrough } = require("stream") as typeof import("stream");

  class MockPDFDocument extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;

    constructor(_opts?: unknown) { super(); }
    text(str: string, ..._rest: unknown[]) {
      if (typeof str === "string") pdfState.capturedText.push(str);
      return this;
    }
    font() { return this; }
    fontSize() { return this; }
    fillColor() { return this; }
    strokeColor() { return this; }
    lineWidth() { return this; }
    save() { return this; }
    restore() { return this; }
    addPage() { return this; }
    image() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    rect() { return this; }
    clip() { return this; }
    stroke() { return this; }
    fill() { return this; }
    rotate() { return this; }
    opacity() { return this; }
    widthOfString(str: string) { return str.length * 4; }
    heightOfString() { return 10; }
    bufferedPageRange() { return { start: 0, count: 1 }; }
    switchToPage(_n: number) { return this; }
    flushPages() { return this; }
    end(cb?: () => void) { super.end(cb); return this; }
  }

  return { default: MockPDFDocument };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
  irocInvoices: {},
  irocInvoiceItems: {},
  irocCustomers: {},
  websiteCustomersTable: {},
  irocAppUsers: {},
  irocNotifications: {},
  settingsTable: {},
  irocProducts: {},
  irocProductGroups: {},
  irocInventoryLots: {},
  irocLeads: {},
  irocOrders: {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable: {},
  doctorCertificationsTable: {},
}));

import app from "../app";

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
const payload = {
  userId: 1,
  username: "admin",
  exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
};
const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
const AUTH = `Bearer ${encodedPayload}.${crypto.createHmac("sha256", SECRET).update(encodedPayload).digest("base64url")}`;

const customer = {
  id: 5,
  salutation: null,
  title: null,
  name: "Testmann",
  company: null,
  address: "Teststr. 1",
  postalCode: "80331",
  city: "München",
  country: "Germany",
  vatId: "DE123456789",
  isEu: false,
  email: "test@example.com",
  phone: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function invoice(invoiceType: "domestic" | "eu" | "export" | "noneu", language: "de" | "en", id: number) {
  return {
    id,
    invoiceNumber: `2026-${String(id).padStart(4, "0")}`,
    invoiceType,
    language,
    issueDate: "2026-08-01",
    dueDate: null,
    orderNumber: null,
    referenceNumber: null,
    shippingMethod: invoiceType === "export" ? "DHL Express" : null,
    reasonForExport: invoiceType === "export" ? "Sale" : null,
    termsOfDelivery: invoiceType === "export" ? "DAP" : null,
    customerId: 5,
    websiteCustomerId: null,
    status: "draft",
    subtotal: "100.00",
    vatRate: invoiceType === "domestic" ? "19.00" : "0.00",
    vatAmount: invoiceType === "domestic" ? "19.00" : "0.00",
    total: invoiceType === "domestic" ? "119.00" : "100.00",
    deliveryCosts: "0.00",
    notes: null,
    vatNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const cases = [
  ["domestic", "de", 1],
  ["eu", "de", 2],
  ["export", "de", 3],
  ["noneu", "de", 4],
  ["domestic", "en", 5],
  ["eu", "en", 6],
  ["export", "en", 7],
  ["noneu", "en", 8],
] as const;

describe("GET /api/iroc/invoices/:id/pdf — VAT footnote parity", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    mockWhere.mockReset().mockResolvedValue([]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });
  });

  it.each(cases)(
    "renders the form default for %s / %s",
    async (invoiceType, language, id) => {
      mockWhere
        .mockResolvedValueOnce([invoice(invoiceType, language, id)])
        .mockResolvedValueOnce([customer])
        .mockResolvedValueOnce([{
          id: 1,
          invoiceId: id,
          productName: "iROC product",
          quantity: 1,
          unitPrice: "100.00",
          lineTotal: "100.00",
        }]);

      const res = await request(app)
        .get(`/api/iroc/invoices/${id}/pdf`)
        .set("Authorization", AUTH);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/pdf/);
      expect(pdfState.capturedText).toContain(computeDefaultVatNote(invoiceType, language));
    },
  );
});