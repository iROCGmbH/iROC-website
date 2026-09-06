/**
 * Tests for GET /iroc/invoices/:id/delivery-note
 *
 * Verifies that the delivery note PDF uses the shipping address when the
 * linked website_customer has shippingFirstName or shippingAddress set,
 * and falls back to the billing address when those fields are absent.
 *
 * Strategy: PDFKit streams are FlateDecode-compressed so text is not
 * readable as raw bytes.  Instead we mock PDFDocument to intercept every
 * `.text()` call and collect the rendered strings.  The address block
 * assertions then check those captured strings directly.
 *
 * Hoisting note: vi.mock factories are hoisted to the top of the compiled
 * output.  Any state they close over must also be hoisted via vi.hoisted()
 * so it is initialised before the factory runs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock-factory state ──────────────────────────────────────────────
// Everything referenced inside vi.mock() factories must be hoisted so it is
// initialised before the factory closures execute.
// `import` statements for non-Node builtins (e.g. PassThrough) are also
// hoisted by the ESM transform, so we use require() inside the factory instead.

const { pdfState, mockWhere, mockFrom, mockDbSelect } = vi.hoisted(() => {
  // Mutable container for text captured by the PDFKit mock.
  // Using an object wrapper keeps the reference stable across resets.
  const pdfState = { capturedText: [] as string[] };

  const mockWhere    = vi.fn().mockResolvedValue([]);
  const mockFrom     = vi.fn().mockReturnValue({ where: mockWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return { pdfState, mockWhere, mockFrom, mockDbSelect };
});

// ── Mock pdfkit ───────────────────────────────────────────────────────────────
// PassThrough is obtained via require() (not an ESM import) so it is available
// when this factory runs — vi.mock factories are hoisted above ESM imports.
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
    save()               { return this; }
    restore()            { return this; }
    rotate()             { return this; }
    addPage()            { return this; }
    image()              { return this; }
    moveTo()             { return this; }
    lineTo()             { return this; }
    rect()               { return this; }
    clip()               { return this; }
    stroke()             { return this; }
    fill()               { return this; }
    heightOfString()     { return 10; }
    widthOfString(text: string) { return text.length * 5; }
    opacity()            { return this; }
    switchToPage()       { return this; }
    flushPages()         { return this; }
    bufferedPageRange()  { return { start: 0, count: 1 }; }

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
  irocInventoryLots:          {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable:        {},
}));

// ── Import app AFTER mocks ────────────────────────────────────────────────────
import app from "../app";

// ── JWT helper (mirrors iroc.ts signToken — no external library needed) ───────
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
  id:                1,
  invoiceNumber:     "2026-0001",
  invoiceType:       "standard",
  language:          "de",
  issueDate:         "2026-07-30",
  orderNumber:       null,
  referenceNumber:   null,
  status:            "draft",
  notes:             null,
  customerId:        null,
  websiteCustomerId: 10,
  shippingMethod:    null,
  reasonForExport:   null,
  totalNet:          "0.00",
  totalVat:          "0.00",
  totalGross:        "0.00",
  vatPercent:        "0.00",
  discount:          "0.00",
  createdAt:         new Date(),
};

/** Invoice fields used by buildInvoicePDF in the invoice endpoint tests. */
const invoicePdfRow = {
  ...baseInvoice,
  dueDate:         null,
  termsOfDelivery: null,
  subtotal:        "100.00",
  invoiceType:     "domestic",
  vatRate:         "19.00",
  vatAmount:       "19.00",
  total:           "119.00",
  deliveryCosts:   "0.00",
  vatNote:         null,
};

/** Website customer with no shipping fields (billing-only). */
const billingOnlyWc = {
  id:                      10,
  customerNr:              "2026-0001",
  salutation:              "Herr",
  title:                   null,
  firstName:               "BillingFirst",
  lastName:                "BillingLast",
  specialty:               null,
  institutionName:         "Billing Clinic",
  institutionType:         null,
  address:                 "Billing Str. 1",
  postalCode:              "80001",
  city:                    "München",
  country:                 "Deutschland",
  phone:                   null,
  fax:                     null,
  email:                   "billing@example.com",
  website:                 null,
  referenceNumber:         null,
  ustIdNr:                 null,
  instrument:              "iroc",
  notes:                   null,
  privacyConsent:          true,
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

/** Same customer but with shipping fields populated. */
const wcWithShipping = {
  ...billingOnlyWc,
  shippingFirstName:  "ShipFirst",
  shippingLastName:   "ShipLast",
  shippingAddress:    "Shipping Allee 99",
  shippingPostalCode: "10115",
  shippingCity:       "Berlin",
  shippingCountry:    "Deutschland",
};

/** Customer where only shippingAddress is set (shippingFirstName absent). */
const wcAddressOnly = {
  ...billingOnlyWc,
  shippingFirstName: null,
  shippingAddress:   "Only Address Str. 7",
  shippingCity:      "Hamburg",
};

/** Legacy iROC customer used when an invoice has no linked website customer. */
const legacyCustomer = {
  id:         42,
  customerNr: "LEG-0042",
  salutation: "Frau",
  title:      null,
  name:       "LegacyFirst LegacyLast",
  company:     "Legacy Clinic",
  address:    "Legacy Str. 2",
  postalCode: "80331",
  city:       "München",
  country:    "Deutschland",
  vatId:      null,
};

// ── Helper: stage the three sequential db.select().from().where() calls ───────
//
// The delivery-note route calls db.select() three times in order:
//   1. irocInvoices          → invoice row
//   2. websiteCustomersTable → website customer
//   3. irocInvoiceItems       → line items
//
function stageDbSelects(invoice: object, wc: object, items: object[] = []) {
  mockWhere
    .mockResolvedValueOnce([invoice])
    .mockResolvedValueOnce([wc])
    .mockResolvedValueOnce(items);
}

/** Stage the two selects used when neither customer lookup is needed. */
function stageDbSelectsWithoutCustomer(invoice: object, items: object[] = []) {
  mockWhere
    .mockResolvedValueOnce([invoice]) // irocInvoices
    .mockResolvedValueOnce(items);    // irocInvoiceItems
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/invoices/:id/delivery-note — address selection", () => {
  beforeEach(() => {
    // Clear captured text and reset the db mock chain
    pdfState.capturedText = [];
    mockWhere.mockReset().mockResolvedValue([]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });
  });

  it("uses the shipping address when shippingFirstName is set", async () => {
    stageDbSelects(baseInvoice, wcWithShipping);

    const res = await request(app)
      .get("/api/iroc/invoices/1/delivery-note")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    // buildDeliveryNotePDF joins firstName + lastName before passing to .text();
    // postalCode and city are also joined into one string before the call.
    expect(pdfState.capturedText).toContain("ShipFirst ShipLast");
    expect(pdfState.capturedText).toContain("Shipping Allee 99");
    expect(pdfState.capturedText).toContain("10115 Berlin");

    // Billing-only values must NOT have been rendered
    const allText = pdfState.capturedText.join("\n");
    expect(allText).not.toContain("BillingFirst");
    expect(allText).not.toContain("Billing Str. 1");
  });

  it("uses the shipping address when only shippingAddress is set (no shippingFirstName)", async () => {
    stageDbSelects(baseInvoice, wcAddressOnly);

    const res = await request(app)
      .get("/api/iroc/invoices/1/delivery-note")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    expect(pdfState.capturedText).toContain("Only Address Str. 7");
    expect(pdfState.capturedText).toContain("Hamburg");

    const allText = pdfState.capturedText.join("\n");
    expect(allText).not.toContain("Billing Str. 1");
  });

  it("falls back to billing address when no shipping fields are set", async () => {
    stageDbSelects(baseInvoice, billingOnlyWc);

    const res = await request(app)
      .get("/api/iroc/invoices/1/delivery-note")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    // wcToCustomerShape joins firstName + lastName into `name`; the delivery-
    // note renderer then prepends the salutation, so the rendered line is
    // "Herr BillingFirst BillingLast".  Postal code and city are also joined:
    // "80001 München".
    expect(pdfState.capturedText).toContain("Herr BillingFirst BillingLast");
    expect(pdfState.capturedText).toContain("Billing Str. 1");
    expect(pdfState.capturedText).toContain("80001 München");

    const allText = pdfState.capturedText.join("\n");
    expect(allText).not.toContain("ShipFirst");
    expect(allText).not.toContain("Shipping Allee 99");
  });

  it("rejects an invoice with no linked customer before PDF rendering", async () => {
    const invoiceWithoutCustomer = {
      ...baseInvoice,
      id:                2,
      websiteCustomerId: null,
      customerId:        null,
    };
    stageDbSelectsWithoutCustomer(invoiceWithoutCustomer);

    const res = await request(app)
      .get("/api/iroc/invoices/2/delivery-note")
      .set("Authorization", AUTH);

    // A delivery note without a recipient is incomplete. Task 1195 requires
    // a typed failure instead of an apparently successful blank PDF.
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Customer reference is required" });
    expect(res.headers["content-type"]).toMatch(/json/);
    // The missing-customer guard must run before item lookup/rendering.
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });

  it("uses the billing address from the legacy customer when customerId is set", async () => {
    const legacyInvoice = {
      ...baseInvoice,
      id:                3,
      websiteCustomerId: null,
      customerId:        legacyCustomer.id,
    };
    stageDbSelects(legacyInvoice, legacyCustomer);

    const res = await request(app)
      .get("/api/iroc/invoices/3/delivery-note")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);
    expect(pdfState.capturedText).toContain("Frau LegacyFirst LegacyLast");
    expect(pdfState.capturedText).toContain("Legacy Clinic");
    expect(pdfState.capturedText).toContain("Legacy Str. 2");
    expect(pdfState.capturedText).toContain("80331 München");
  });
});

describe("GET /iroc/invoices/:id/pdf — address blocks", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    mockWhere.mockReset().mockResolvedValue([]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });
  });

  it("renders labeled billing and shipping blocks when a shipping address is set", async () => {
    stageDbSelects(invoicePdfRow, wcWithShipping, [{
      id: 1, invoiceId: 1, productName: "iROC product", quantity: 1,
      unitPrice: "100.00", lineTotal: "100.00", vatRate: "19.00",
    }]);

    const res = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");
    expect(allText).toContain("Rechnungsadresse / Bill To");
    expect(allText).toContain("Lieferadresse / Ship To");
    expect(allText).toContain("Herr BillingFirst BillingLast");
    expect(allText).toContain("Billing Str. 1");
    expect(allText).toContain("ShipFirst ShipLast");
    expect(allText).toContain("Shipping Allee 99");
    expect(allText).toContain("10115 Berlin");
  });

  it("renders the shipping block when only the shipping street address is set", async () => {
    stageDbSelects(invoicePdfRow, wcAddressOnly, [{
      id: 1, invoiceId: 1, productName: "iROC product", quantity: 1,
      unitPrice: "100.00", lineTotal: "100.00", vatRate: "19.00",
    }]);

    const res = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const allText = pdfState.capturedText.join("\n");
    expect(allText).toContain("Rechnungsadresse / Bill To");
    expect(allText).toContain("Billing Str. 1");
    expect(allText).toContain("Lieferadresse / Ship To");
    expect(allText).toContain("Only Address Str. 7");
  });

  it("does not render a shipping block when no shipping fields are set", async () => {
    stageDbSelects(invoicePdfRow, billingOnlyWc, [{
      id: 1, invoiceId: 1, productName: "iROC product", quantity: 1,
      unitPrice: "100.00", lineTotal: "100.00", vatRate: "19.00",
    }]);

    const res = await request(app)
      .get("/api/iroc/invoices/1/pdf")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const allText = pdfState.capturedText.join("\n");
    expect(allText).toContain("Rechnungsadresse / Bill To");
    expect(allText).not.toContain("Lieferadresse / Ship To");
    expect(allText).toContain("Billing Str. 1");
  });
});
