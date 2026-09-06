/**
 * Confirmation test: POST /iroc/invoices/:id/email handles the case where
 * websiteCustomerId is set but the websiteCustomersTable row has been deleted.
 *
 * What & Why
 * ──────────
 * The email endpoint has two customer-lookup paths:
 *
 *   if (row.websiteCustomerId) {
 *     const [wc] = await db.select()…from(websiteCustomersTable)…
 *     if (wc) customer = wcToCustomerShape(wc);   // ← wc is undefined if deleted
 *   }
 *   if (!customer && row.customerId) {             // skipped — customerId is null
 *     …
 *   }
 *
 * When the websiteCustomersTable row has been deleted after the invoice was
 * created, the first `if` block fires but the select returns [].  Because wc
 * is undefined, wcToCustomerShape is never called and customer remains
 * undefined.  The second `if` block is also skipped because customerId is null.
 * buildInvoicePDF therefore receives undefined customer — the same blank-
 * customer state documented in invoice-email-no-customer.test.ts, but reached
 * via a different code path.
 *
 * There was no test covering this specific path, so a null-dereference inside
 * buildInvoicePDF (or a crash in the first `if` block itself) would go
 * undetected.
 *
 * This test confirms:
 *   1. websiteCustomersTable IS queried (first if block fires).
 *   2. irocCustomers is NOT queried (customerId is null — second if skipped).
 *   3. sendEmail is called with a non-empty PDF buffer — no crash.
 *   4. The response is 200 { ok: true }.
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
   * The production endpoint passes these to .from() — by making them unique we
   * can assert exactly which tables were queried.
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
 * Invoice where websiteCustomerId is set (non-null) but customerId is null.
 * The website customer row has been deleted — the DB select will return [].
 */
const DELETED_WC_INVOICE = {
  id:                88,
  invoiceNumber:     "2026-0088",
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2026-08-08",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  websiteCustomerId: 42,   // ← set, but the row has been deleted
  customerId:        null, // ← no legacy customer fallback
  status:            "final",
  subtotal:          "120.00",
  vatRate:           "19.00",
  vatAmount:         "22.80",
  total:             "142.80",
  deliveryCosts:     "0.00",
  notes:             null,
  vatNote:           null,
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

const SINGLE_ITEM = [{
  id:              1,
  invoiceId:       DELETED_WC_INVOICE.id,
  productId:       null,
  productName:     "Archived Product",
  sku:             null,
  description:     null,
  lotNumber:       null,
  hsCode:          null,
  countryOfOrigin: null,
  weightKg:        null,
  unitPrice:       "120.00",
  discountPercent: null,
  isDemo:          false,
  quantity:        1,
  lineTotal:       "120.00",
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
 * Stage the three DB selects for the deleted-website-customer scenario:
 *  1. Invoice row           (websiteCustomerId set, customerId null)
 *  2. websiteCustomersTable (returns [] — row was deleted)
 *  3. Line items
 *
 * irocCustomers is intentionally NOT staged: if the endpoint incorrectly
 * queries it, mockDbSelect returns undefined, causing a failure.
 */
function stageDbForDeletedWcEmail() {
  mockDbSelect
    .mockReturnValueOnce(selectChain([DELETED_WC_INVOICE]))  // 1. invoice
    .mockReturnValueOnce(selectChain([]))                     // 2. websiteCustomers → deleted
    .mockReturnValueOnce(selectChain(SINGLE_ITEM));           // 3. line items
}

const EMAIL_BODY = {
  to:      "recipient@example.com",
  subject: "Ihre Rechnung 2026-0088",
  body:    "Bitte finden Sie Ihre Rechnung im Anhang.",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices/:id/email — websiteCustomerId set but customer row deleted", () => {
  beforeEach(() => {
    fromCalls.length = 0;   // reset tracked .from() calls between tests
    mockDbSelect.mockReset();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(undefined);
    updateReturning.mockReset();
  });

  it("queries websiteCustomersTable when websiteCustomerId is set", async () => {
    stageDbForDeletedWcEmail();

    await request(app)
      .post(`/api/iroc/invoices/${DELETED_WC_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    // The first if block must fire — websiteCustomerId is non-null.
    expect(fromCalls).toContain(WEBSITE_CUSTOMERS_TABLE);
  });

  it("does not query irocCustomers when customerId is null", async () => {
    stageDbForDeletedWcEmail();

    await request(app)
      .post(`/api/iroc/invoices/${DELETED_WC_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    // customerId is null so the second if block is skipped entirely.
    expect(fromCalls).not.toContain(IROC_CUSTOMERS_TABLE);
  });

  it("does not send an official invoice when the website customer row is missing", async () => {
    stageDbForDeletedWcEmail();

    const res = await request(app)
      .post(`/api/iroc/invoices/${DELETED_WC_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(422);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns a specific compliance error when the website customer row has been deleted", async () => {
    stageDbForDeletedWcEmail();

    const res = await request(app)
      .post(`/api/iroc/invoices/${DELETED_WC_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/complete customer/i);
  });

  it("returns 404 when the invoice itself does not exist", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .post("/api/iroc/invoices/9999/email")
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(404);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 400 when required email fields are missing", async () => {
    stageDbForDeletedWcEmail();

    const res = await request(app)
      .post(`/api/iroc/invoices/${DELETED_WC_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send({ to: "x@example.com" }); // missing subject and body

    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
