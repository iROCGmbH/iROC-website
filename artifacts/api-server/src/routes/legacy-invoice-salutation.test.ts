/**
 * Regression test: GET /iroc/invoices/:id/pdf — legacy invoice (customerId set,
 * websiteCustomerId null) with salutation and title stored in iroc_customers.
 *
 * Confirms that:
 *  1. The name line in the PDF is rendered as "salutation title name"
 *     (e.g. "Herr Dr. med Mustermann") when both fields are stored.
 *  2. Only the name is rendered when salutation and title are null
 *     (documents the pre-migration gap and confirms the fix works for
 *     records that now carry those values).
 *
 * Strategy: PDFKit streams are FlateDecode-compressed so text is not readable
 * as raw bytes.  We mock PDFDocument to intercept every `.text()` call and
 * collect the rendered strings.  Assertions then check those captured strings
 * directly — no PDF parsing needed.
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
  updateSet,
  updateReturning,
} = vi.hoisted(() => {
  const pdfState = { capturedText: [] as string[] };
  const mockWhere    = vi.fn().mockResolvedValue([]);
  const mockFrom     = vi.fn().mockReturnValue({ where: mockWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });
  const updateReturning = vi.fn();
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: updateSet });
  return {
    pdfState,
    mockWhere,
    mockFrom,
    mockDbSelect,
    mockDbUpdate,
    updateSet,
    updateReturning,
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
    widthOfString(text: string) { return text.length * 5; }
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
    update: mockDbUpdate,
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

/** A legacy invoice: customerId is set, websiteCustomerId is null. */
const legacyInvoice = {
  id:                1,
  invoiceNumber:     "2025-0042",
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2025-03-15",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  customerId:        5,           // legacy — linked to iroc_customers
  websiteCustomerId: null,        // no website_customer link
  status:            "draft",
  notes:             null,
  vatNote:           null,
  deliveryCosts:     "0.00",
  subtotal:          "500.00",
  vatRate:           "19.00",
  vatAmount:         "95.00",
  total:             "595.00",
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

/** Legacy customer WITH salutation and title stored (after the migration). */
const legacyCustomerFull = {
  id:         5,
  salutation: "Herr",
  title:      "Dr. med",
  name:       "Mustermann",
  company:    "Muster Klinik",
  address:    "Musterstr. 1",
  postalCode: "80331",
  city:       "München",
  country:    "Germany",
  vatId:      null,
  isEu:       false,
  email:      "mustermann@example.com",
  phone:      null,
  notes:      null,
  createdAt:  new Date(),
  updatedAt:  new Date(),
};

/** Legacy customer with NO salutation/title (documents the pre-migration gap). */
const legacyCustomerNoSalutation = {
  ...legacyCustomerFull,
  salutation: null,
  title:      null,
};

/**
 * Website customer as produced by POST /website-customers/from-iroc for the
 * source customer above. The import splits a single source name into
 * firstName/lastName, while preserving salutation and title.
 */
const importedWebsiteCustomer = {
  id:              42,
  customerNr:      "2025-0001",
  salutation:      "Herr",
  title:           "Dr. med",
  firstName:       "Mustermann",
  lastName:        null,
  institutionName: "Muster Klinik",
  address:         "Musterstr. 1",
  postalCode:      "80331",
  city:            "München",
  country:         "DE",
  ustIdNr:         null,
  email:           "mustermann@example.com",
  phone:           null,
  createdAt:       new Date("2025-06-01"),
};

/**
 * The PDF route calls db.select() twice in sequence:
 *   1. irocInvoices  → the invoice row
 *   2. irocCustomers → the legacy customer (because websiteCustomerId is null)
 * Then a third call for irocInvoiceItems (line items).
 */
function stageDbSelects(invoice: object, customer: object) {
  mockWhere
    .mockResolvedValueOnce([invoice])   // irocInvoices
    .mockResolvedValueOnce([customer])  // irocCustomers fallback
    .mockResolvedValueOnce([{
      id: 1, invoiceId: 1, productName: "iROC product", quantity: 1,
      unitPrice: "500.00", lineTotal: "500.00", vatRate: "19.00",
    }]);
}

/** Stage the website-customer branch of the PDF route. */
function stageWebsiteCustomerPdfSelects(invoice: object, customer: object) {
  mockWhere
    .mockResolvedValueOnce([invoice])   // irocInvoices
    .mockResolvedValueOnce([customer])  // website_customers
    .mockResolvedValueOnce([{
      id: 1, invoiceId: 1, productName: "iROC product", quantity: 1,
      unitPrice: "500.00", lineTotal: "500.00", vatRate: "19.00",
    }]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/invoices/:id/pdf — invoice salutation + title", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    mockWhere.mockReset().mockResolvedValue([]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });
    updateSet.mockClear();
    updateReturning.mockReset();
  });

  it("renders 'salutation title name' on the name line when both are stored", async () => {
    stageDbSelects(legacyInvoice, legacyCustomerFull);

    const res = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // buildInvoicePDF joins [salutation, title, name].filter(Boolean).join(" ")
    // before passing the whole string to .text(), so we expect a single entry.
    expect(pdfState.capturedText).toContain("Herr Dr. med Mustermann");
  });

  it("renders the imported website customer's salutation and title in the billing address", async () => {
    const importedInvoice = {
      ...legacyInvoice,
      id: 2,
      customerId: null,
      websiteCustomerId: importedWebsiteCustomer.id,
    };
    stageWebsiteCustomerPdfSelects(importedInvoice, importedWebsiteCustomer);

    const res = await request(app)
      .get("/api/iroc/invoices/2/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // The website_customer is normalised by wcToCustomerShape before the
    // billing address combines salutation, title, and the imported name.
    expect(pdfState.capturedText).toContain("Herr Dr. med Mustermann");
  });

  it("renders only the name when salutation and title are null (pre-migration gap)", async () => {
    stageDbSelects(legacyInvoice, legacyCustomerNoSalutation);

    const res = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    // Name line should be just the customer name — no salutation/title prefix.
    expect(pdfState.capturedText).toContain("Mustermann");

    // The salutation+name and title+name combinations must NOT appear —
    // confirming that no prefix was prepended to the customer name line.
    // (Note: "Dr. med" appears independently in the footer for CEO names,
    //  so we assert the combined "Dr. med Mustermann" form rather than
    //  the bare "Dr. med" string which belongs to the footer.)
    const allText = pdfState.capturedText.join("\n");
    expect(allText).not.toContain("Herr Mustermann");
    expect(allText).not.toContain("Dr. med Mustermann");
  });

  it("drops a cleared legacy salutation from a subsequently downloaded invoice", async () => {
    const clearedLegacyCustomer = {
      ...legacyCustomerFull,
      salutation: null,
    };

    // Initial download reads the legacy customer data directly.
    stageDbSelects(legacyInvoice, legacyCustomerFull);
    const beforeRes = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(beforeRes.status).toBe(200);
    expect(pdfState.capturedText).toContain("Herr Dr. med Mustermann");

    // The existing legacy customer endpoint accepts an explicit null value.
    updateReturning.mockResolvedValueOnce([clearedLegacyCustomer]);
    const patchRes = await request(app)
      .patch("/api/iroc/customers/5")
      .set("Authorization", AUTH)
      .send({
        salutation: null,
        title: legacyCustomerFull.title,
        name: legacyCustomerFull.name,
        company: legacyCustomerFull.company,
        address: legacyCustomerFull.address,
        city: legacyCustomerFull.city,
        postalCode: legacyCustomerFull.postalCode,
        country: legacyCustomerFull.country,
        vatId: legacyCustomerFull.vatId,
        isEu: legacyCustomerFull.isEu,
        email: legacyCustomerFull.email,
        phone: legacyCustomerFull.phone,
        notes: legacyCustomerFull.notes,
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.salutation).toBeNull();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ salutation: null }),
    );

    // A later request must re-read iroc_customers instead of using a snapshot
    // from the first download.
    pdfState.capturedText = [];
    stageDbSelects(legacyInvoice, clearedLegacyCustomer);
    const afterRes = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(afterRes.status).toBe(200);
    const afterText = pdfState.capturedText.join("\n");
    expect(afterText).toContain("Mustermann");
    expect(afterText).toContain("Dr. med Mustermann");
    expect(afterText).not.toContain("Herr Dr. med Mustermann");
    expect(afterText).not.toContain("Herr Mustermann");
  });
});
