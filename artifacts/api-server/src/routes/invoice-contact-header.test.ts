import { beforeEach, describe, expect, it, vi } from "vitest";

const { pdfState } = vi.hoisted(() => ({
  pdfState: {
    calls: [] as Array<{ text: string; x?: number; y?: number; options?: Record<string, unknown> }>,
    imageCalls: [] as Array<{ src: string; x?: number; y?: number; options?: Record<string, unknown> }>,
  },
}));

vi.mock("pdfkit", () => {
  class MockPDFDocument {
    page = { width: 595.28, height: 841.89 };
    y = 0;

    text(text: string, ...args: unknown[]) {
      pdfState.calls.push({
        text,
        x: typeof args[0] === "number" ? args[0] : undefined,
        y: typeof args[1] === "number" ? args[1] : undefined,
        options: typeof args[2] === "object" ? args[2] as Record<string, unknown> : undefined,
      });
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
    image(src: string, ...args: unknown[]) {
      pdfState.imageCalls.push({
        src,
        x: typeof args[0] === "number" ? args[0] : undefined,
        y: typeof args[1] === "number" ? args[1] : undefined,
        options: typeof args[2] === "object" ? args[2] as Record<string, unknown> : undefined,
      });
      return this;
    }
    moveTo() { return this; }
    lineTo() { return this; }
    rect() { return this; }
    clip() { return this; }
    stroke() { return this; }
    fill() { return this; }
    rotate() { return this; }
    opacity() { return this; }
    heightOfString() { return 10; }
    widthOfString(text: string) { return text.length * 3.5; }
  }

  return { default: MockPDFDocument };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
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
  irocTrainingOffers: {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable: {},
}));

vi.mock("../lib/geocode", () => ({
  geocodeMissingDoctors: vi.fn(),
  geocodeSearch: vi.fn(),
  toCountryCode: vi.fn(),
  lookupPostalAddress: vi.fn(),
  lookupInstitutionMultiple: vi.fn(),
}));

import PDFDocument from "pdfkit";
import { buildDeliveryNotePDF, buildInvoicePDF } from "./iroc";

const baseInvoice = {
  id: 1,
  invoiceNumber: "2026-0001",
  customerId: 1,
  websiteCustomerId: null,
  invoiceType: "domestic",
  language: "de",
  issueDate: "2026-08-28",
  dueDate: null,
  orderNumber: null,
  referenceNumber: null,
  shippingMethod: null,
  reasonForExport: null,
  termsOfDelivery: null,
  deliveryCosts: "0.00",
  insuranceCosts: "0.00",
  subtotal: "100.00",
  vatRate: "19.00",
  vatAmount: "19.00",
  total: "119.00",
  status: "draft",
  notes: null,
  vatNote: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const customer = {
  id: 1,
  name: "Example Customer",
  company: null,
  salutation: null,
  title: null,
  address: "Example Street 1",
  postalCode: "10115",
  city: "Berlin",
  country: "Germany",
  vatId: null,
  email: "customer@example.com",
  phone: null,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const item = {
  id: 1,
  invoiceId: 1,
  productId: null,
  productName: "Medical device",
  sku: null,
  description: null,
  lotNumber: null,
  hsCode: null,
  countryOfOrigin: null,
  weightKg: null,
  discountPercent: null,
  isDemo: false,
  unitPrice: "100.00",
  quantity: 1,
  lineTotal: "100.00",
  vatRate: "19.00",
};

describe("invoice and offer PDF contact header", () => {
  beforeEach(() => {
    pdfState.calls = [];
    pdfState.imageCalls = [];
  });

  it("uses the full iROC lockup in the invoice header", () => {
    const doc = new PDFDocument() as Parameters<typeof buildInvoicePDF>[0];
    buildInvoicePDF(
      doc,
      baseInvoice as Parameters<typeof buildInvoicePDF>[1],
      customer as Parameters<typeof buildInvoicePDF>[2],
      [item as Parameters<typeof buildInvoicePDF>[3][number]],
    );

    const logoCall = pdfState.imageCalls[0];
    expect(logoCall).toBeDefined();
    expect(logoCall?.src).toMatch(/iroc-new-logo\.png$/);
    expect(logoCall?.x).toBe(42);
    expect(logoCall?.options?.fit).toEqual([180, 68]);
    expect(pdfState.calls.filter((call) => call.text === "iROC GmbH" && (call.y ?? Infinity) < 60)).toHaveLength(0);
  });

  it("keeps the delivery-note logo proportional to the adjacent company note", () => {
    const doc = new PDFDocument() as Parameters<typeof buildDeliveryNotePDF>[0];
    buildDeliveryNotePDF(
      doc,
      baseInvoice as Parameters<typeof buildDeliveryNotePDF>[1],
      customer as Parameters<typeof buildDeliveryNotePDF>[2],
      [item as Parameters<typeof buildDeliveryNotePDF>[3][number]],
    );

    const logoCall = pdfState.imageCalls[0];
    expect(logoCall?.src).toMatch(/iroc-new-logo\.png$/);
    expect(logoCall?.x).toBe(42);
    expect(logoCall?.y).toBe(26);
    expect(logoCall?.options?.fit).toEqual([180, 68]);
    expect(pdfState.calls.filter((call) => call.text === "iROC GmbH" && (call.y ?? Infinity) < 60)).toHaveLength(0);
  });

  for (const variant of ["standard", "export", "offer"] as const) {
    for (const language of ["de", "en"] as const) {
      it(`keeps both ${language} contact rows together for the ${variant} variant`, () => {
        const doc = new PDFDocument() as Parameters<typeof buildInvoicePDF>[0];
        buildInvoicePDF(
          doc,
          {
            ...baseInvoice,
            invoiceType: variant === "export" ? "export" : "domestic",
            language,
          } as Parameters<typeof buildInvoicePDF>[1],
          customer as Parameters<typeof buildInvoicePDF>[2],
          [item as Parameters<typeof buildInvoicePDF>[3][number]],
          {
            offer: variant === "offer",
            contact: {
              email: "returns@example.com",
              phone: "+49 (0)89 600 60 805",
            },
          },
        );

        const returnLabel = language === "de" ? "Rücksendeanfrage an:" : "Return requests to:";
        const enquiryLabel = language === "de" ? "Rückfragen an:" : "Questions to:";
        const service = language === "de" ? "Kundenberatung" : "Customer service";

        const returnLabelCall = pdfState.calls.find((call) => call.text === returnLabel);
        const emailCall = pdfState.calls.find((call) => call.text === "returns@example.com");
        const enquiryLabelCall = pdfState.calls.find((call) => call.text === enquiryLabel);
        const phoneCall = pdfState.calls.find(
          (call) => call.text === `${service} +49 (0)89 600 60 805`,
        );

        expect(returnLabelCall).toBeDefined();
        expect(emailCall).toBeDefined();
        expect(enquiryLabelCall).toBeDefined();
        expect(phoneCall).toBeDefined();
        expect(emailCall?.y).toBe(returnLabelCall?.y);
        expect(phoneCall?.y).toBe(enquiryLabelCall?.y);
        expect(enquiryLabelCall?.x).toBe(returnLabelCall?.x);
        expect(emailCall?.options?.lineBreak).toBe(false);
        expect(phoneCall?.options?.lineBreak).toBe(false);
        const rightPageMargin = 42 + 511.28;
        expect(emailCall!.x! + "returns@example.com".length * 3.5).toBeCloseTo(rightPageMargin);
        expect(phoneCall!.x! + `${service} +49 (0)89 600 60 805`.length * 3.5)
          .toBeCloseTo(rightPageMargin);
      });
    }
  }

  it("localizes and left-aligns the English footer while keeping the IBAN on one line", () => {
    const doc = new PDFDocument() as Parameters<typeof buildInvoicePDF>[0];
    buildInvoicePDF(
      doc,
      { ...baseInvoice, language: "en" } as Parameters<typeof buildInvoicePDF>[1],
      customer as Parameters<typeof buildInvoicePDF>[2],
      [item as Parameters<typeof buildInvoicePDF>[3][number]],
    );

    for (const title of ["iROC GmbH", "Contact", "Management", "Registered office", "Bank details"]) {
      const call = pdfState.calls.filter((entry) => entry.text === title).at(-1);
      expect(call).toBeDefined();
      expect(call?.options?.align).toBe("left");
    }

    expect(pdfState.calls.some((entry) => entry.text === "Kontakt")).toBe(false);
    expect(pdfState.calls.some((entry) => entry.text === "Bankverbindung")).toBe(false);
    expect(pdfState.calls.some((entry) => entry.text === "Germany")).toBe(true);

    const ibanCall = pdfState.calls.find((entry) => entry.text.startsWith("IBAN:"));
    expect(ibanCall).toBeDefined();
    expect(ibanCall?.options?.lineBreak).toBe(false);
    expect(ibanCall?.options?.align).toBe("left");
  });

  for (const [language, invoiceType, headers] of [
    ["de", "domestic", ["Pos.", "Artikel", "Beschreibung", "LOT-Nr.", "Menge", "Grundpreis", "Rabatt", "Rabattpreis", "Gesamt"]],
    ["en", "domestic", ["Pos.", "Item", "Description", "LOT No.", "Qty", "Unit Price", "Discount", "Disc. Price", "Total"]],
    ["en", "export", ["Pos.", "Item", "Description", "HS/HTS Code", "Qty", "Unit Price", "Country of Origin", "Total incl. Disc.", "Weight (kg)"]],
  ] as const) {
    it(`keeps ${language} ${invoiceType} product table headings on one line`, () => {
      const doc = new PDFDocument() as Parameters<typeof buildInvoicePDF>[0];
      buildInvoicePDF(
        doc,
        { ...baseInvoice, language, invoiceType } as Parameters<typeof buildInvoicePDF>[1],
        customer as Parameters<typeof buildInvoicePDF>[2],
        [item as Parameters<typeof buildInvoicePDF>[3][number]],
      );

      for (const header of headers) {
        const call = pdfState.calls.filter((entry) => entry.text === header).at(-1);
        expect(call, `missing table heading ${header}`).toBeDefined();
        expect(call?.options?.lineBreak, `${header} should not wrap`).toBe(false);
      }
    });
  }
});