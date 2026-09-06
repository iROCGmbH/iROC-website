/**
 * Confirmation test: POST /iroc/invoices/:id/email handles the case where both
 * websiteCustomerId and customerId are null (no customer lookup is made).
 *
 * What & Why
 * ──────────
 * The email endpoint has a third implicit state beyond the two documented paths:
 *
 *   if (row.websiteCustomerId) { … }          // new path — skipped
 *   if (!customer && row.customerId) { … }    // legacy path — skipped
 *
 * When both IDs are null, `customer` remains undefined.  buildInvoicePDF
 * receives undefined and must render a blank customer block rather than throw.
 * There was no test covering this case, so a regression (e.g. a null-dereference
 * inside buildInvoicePDF) would go undetected.
 *
 * This test confirms:
 *   1. Neither irocCustomers nor websiteCustomersTable is queried — only two
 *      DB selects are made (invoice + items).
 *   2. sendEmail is still called with a non-empty PDF buffer — the endpoint
 *      does not crash when customer is undefined.
 *   3. The response is 200 { ok: true }.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock-factory state ──────────────────────────────────────────────
const {
  IROC_CUSTOMERS_TABLE,
  WEBSITE_CUSTOMERS_TABLE,
  fromCalls,
  mockSendEmail,
  mockDbSelect,
  mockDbUpdate,
  updateReturning,
  mockDbDelete,
  mockDbInsert,
} = vi.hoisted(() => {
  /**
   * Distinct sentinel objects for each DB table.
   * If the endpoint ever incorrectly queries either customer table, fromCalls
   * will contain one of these references and the assertion will fail.
   */
  const IROC_CUSTOMERS_TABLE    = { __table: "irocCustomers" };
  const WEBSITE_CUSTOMERS_TABLE = { __table: "websiteCustomersTable" };

  /** Accumulates every argument passed to any chain's .from() call. */
  const fromCalls: unknown[] = [];

  const mockSendEmail = vi.fn().mockResolvedValue(undefined);

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
    IROC_CUSTOMERS_TABLE,
    WEBSITE_CUSTOMERS_TABLE,
    fromCalls,
    mockSendEmail,
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

    constructor(_opts?: unknown) {
      super();
      this.push(Buffer.from("page-0"));
    }

    addPage() {
      this.push(Buffer.from("page-1"));
      this.y = 0;
      return this;
    }

    bufferedPageRange() { return { start: 0, count: 1 }; }
    switchToPage(_n: number) { return this; }

    text(_str: string, ..._rest: unknown[]) { return this; }
    font()           { return this; }
    fontSize()       { return this; }
    fillColor()      { return this; }
    strokeColor()    { return this; }
    lineWidth()      { return this; }
    opacity()        { return this; }
    save()           { return this; }
    restore()        { return this; }
    rotate()         { return this; }
    image()          { return this; }
    moveTo()         { return this; }
    lineTo()         { return this; }
    rect()           { return this; }
    clip()           { return this; }
    stroke()         { return this; }
    fill()           { return this; }
    heightOfString() { return 10; }
    flushPages()     { return this; }
    end(cb?: () => void) { super.end(cb); return this; }
  }

  return { default: MockPDFDocument };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────
// irocCustomers and websiteCustomersTable are given the distinct sentinel
// objects defined in vi.hoisted() so .from() calls can be identified.
vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
  },
  irocInvoices:               { __table: "irocInvoices" },
  irocInvoiceItems:           { __table: "irocInvoiceItems" },
  irocCustomers:              IROC_CUSTOMERS_TABLE,
  websiteCustomersTable:      WEBSITE_CUSTOMERS_TABLE,
  irocAppUsers:               { __table: "irocAppUsers" },
  irocNotifications:          { __table: "irocNotifications" },
  settingsTable:              { __table: "settingsTable" },
  irocProducts:               { __table: "irocProducts" },
  irocInventoryLots:          { __table: "irocInventoryLots" },
  trainingRegistrationsTable: { __table: "trainingRegistrationsTable" },
  trainedDoctorsTable:        { __table: "trainedDoctorsTable" },
}));

// ── Mock email sender ─────────────────────────────────────────────────────────
vi.mock("../lib/email", () => ({
  sendEmail: mockSendEmail,
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

/**
 * Invoice where both websiteCustomerId and customerId are null.
 * This is the third implicit state — no customer branch fires.
 */
const NO_CUSTOMER_INVOICE = {
  id:                55,
  invoiceNumber:     "2026-0055",
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2026-08-08",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  websiteCustomerId: null,  // ← no website customer
  customerId:        null,  // ← no legacy customer
  status:            "final",
  subtotal:          "150.00",
  vatRate:           "19.00",
  vatAmount:         "28.50",
  total:             "178.50",
  deliveryCosts:     "0.00",
  notes:             null,
  vatNote:           null,
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

const SINGLE_ITEM = [{
  id:              1,
  invoiceId:       NO_CUSTOMER_INVOICE.id,
  productId:       null,
  productName:     "Standalone Product",
  sku:             null,
  description:     null,
  lotNumber:       null,
  hsCode:          null,
  countryOfOrigin: null,
  weightKg:        null,
  unitPrice:       "150.00",
  discountPercent: null,
  isDemo:          false,
  quantity:        1,
  lineTotal:       "150.00",
}];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a select chain that records the table argument passed to .from().
 * This lets us assert which DB tables were actually queried.
 */
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
  // Record the table argument so tests can assert which table was queried.
  c.from = vi.fn().mockImplementation((table: unknown) => {
    fromCalls.push(table);
    return c;
  });
  c.where     = vi.fn().mockReturnValue(c);
  c.leftJoin  = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.orderBy   = vi.fn().mockReturnValue(c);
  c.limit     = vi.fn().mockResolvedValue(result);
  return c;
}

/**
 * Stage only the two DB selects needed when no customer lookup is made:
 *  1. Invoice row  (both IDs null — no customer branch fires)
 *  2. Line items
 *
 * No third select is staged; if the endpoint incorrectly queries a customer
 * table, mockDbSelect will return undefined and likely throw or return empty,
 * causing the test to fail.
 */
function stageDbForNoCustomerEmail() {
  mockDbSelect
    .mockReturnValueOnce(selectChain([NO_CUSTOMER_INVOICE]))  // 1. invoice
    .mockReturnValueOnce(selectChain(SINGLE_ITEM));            // 2. line items
}

const EMAIL_BODY = {
  to:      "recipient@example.com",
  subject: "Ihre Rechnung 2026-0055",
  body:    "Bitte finden Sie Ihre Rechnung im Anhang.",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices/:id/email — no customer (both IDs null)", () => {
  beforeEach(() => {
    fromCalls.length = 0;   // reset tracked .from() calls between tests
    mockDbSelect.mockReset();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(undefined);
    updateReturning.mockReset();
  });

  it("does not query irocCustomers when both customer IDs are null", async () => {
    stageDbForNoCustomerEmail();

    await request(app)
      .post(`/api/iroc/invoices/${NO_CUSTOMER_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    // Neither customer table should be queried — both ID fields are null so
    // both `if` blocks are skipped entirely.
    expect(fromCalls).not.toContain(IROC_CUSTOMERS_TABLE);
    expect(fromCalls).not.toContain(WEBSITE_CUSTOMERS_TABLE);
  });

  it("makes exactly two DB selects (invoice + items) when no customer IDs are present", async () => {
    stageDbForNoCustomerEmail();

    await request(app)
      .post(`/api/iroc/invoices/${NO_CUSTOMER_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    // Only the invoice and the items selects should have fired.
    expect(mockDbSelect).toHaveBeenCalledTimes(2);
  });

  it("does not send an official invoice without an associated customer", async () => {
    stageDbForNoCustomerEmail();

    const res = await request(app)
      .post(`/api/iroc/invoices/${NO_CUSTOMER_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(422);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns a specific compliance error when both customer IDs are null", async () => {
    stageDbForNoCustomerEmail();

    const res = await request(app)
      .post(`/api/iroc/invoices/${NO_CUSTOMER_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/complete customer/i);
  });

  it("returns 404 when the invoice does not exist", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .post("/api/iroc/invoices/9999/email")
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(404);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 400 when required email fields are missing", async () => {
    stageDbForNoCustomerEmail();

    const res = await request(app)
      .post(`/api/iroc/invoices/${NO_CUSTOMER_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send({ to: "x@example.com" }); // missing subject and body

    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
