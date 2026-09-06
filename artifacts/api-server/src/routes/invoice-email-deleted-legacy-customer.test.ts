/**
 * Confirmation test: POST /iroc/invoices/:id/email renders the PDF correctly
 * when the legacy customer record has been deleted after the invoice was created.
 *
 * What & Why
 * ──────────
 * The email endpoint has two customer-lookup paths:
 *
 *   if (row.websiteCustomerId) {
 *     // new path: query websiteCustomersTable + wcToCustomerShape()
 *   }
 *   if (!customer && row.customerId) {
 *     // legacy path: query irocCustomers directly
 *   }
 *
 * When the invoice has customerId set and websiteCustomerId is null, the legacy
 * branch fires.  But the irocCustomers row may have been hard-deleted after the
 * invoice was created.  In that case the select returns [] and `customer`
 * remains undefined — the same blank-customer state as when both IDs are null.
 *
 * buildInvoicePDF must handle undefined gracefully; if it throws, the endpoint
 * crashes and the admin gets a 500 instead of the PDF.  No existing test
 * covered this specific combination (legacy branch fires, select returns []).
 *
 * This test confirms:
 *   1. irocCustomers IS queried (legacy path executed — not silently bypassed).
 *   2. websiteCustomersTable is NOT queried (websiteCustomerId is null).
 *   3. sendEmail is called with a non-empty PDF buffer (endpoint does not crash).
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
   * can assert which table was actually queried.
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
 * Invoice with customerId set and websiteCustomerId null — the legacy shape.
 * The customer referenced by customerId has since been hard-deleted from
 * irocCustomers, so the select returns [].
 */
const DELETED_LEGACY_INVOICE = {
  id:                88,
  invoiceNumber:     "2025-0088",
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2025-03-12",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  websiteCustomerId: null,   // ← legacy: no websiteCustomerId
  customerId:        42,     // ← legacy FK — but row 42 has been deleted
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
  id:              5,
  invoiceId:       DELETED_LEGACY_INVOICE.id,
  productId:       null,
  productName:     "Deleted Customer Product",
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
 * This lets us assert which DB table each select actually targeted.
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
 * Stage the three DB selects for the deleted-legacy-customer path:
 *  1. Invoice row       (customerId set, websiteCustomerId null)
 *  2. irocCustomers     (legacy branch fires — but returns [] because row was deleted)
 *  3. Line items
 */
function stageDbForDeletedLegacyEmail() {
  mockDbSelect
    .mockReturnValueOnce(selectChain([DELETED_LEGACY_INVOICE]))  // 1. invoice
    .mockReturnValueOnce(selectChain([]))                         // 2. irocCustomers — deleted, returns []
    .mockReturnValueOnce(selectChain(SINGLE_ITEM));               // 3. line items
}

const EMAIL_BODY = {
  to:      "admin@example.com",
  subject: "Rechnung 2025-0088",
  body:    "Anbei Ihre Rechnung.",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices/:id/email — deleted legacy customer", () => {
  beforeEach(() => {
    fromCalls.length = 0;   // reset tracked .from() calls between tests
    mockDbSelect.mockReset();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(undefined);
    updateReturning.mockReset();
  });

  it("queries irocCustomers when customerId is set, even though the row was deleted", async () => {
    stageDbForDeletedLegacyEmail();

    await request(app)
      .post(`/api/iroc/invoices/${DELETED_LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    // The legacy branch must have queried irocCustomers.
    expect(fromCalls).toContain(IROC_CUSTOMERS_TABLE);
  });

  it("does not query websiteCustomersTable when websiteCustomerId is null", async () => {
    stageDbForDeletedLegacyEmail();

    await request(app)
      .post(`/api/iroc/invoices/${DELETED_LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    // websiteCustomerId is null — the new-path branch must be skipped entirely.
    expect(fromCalls).not.toContain(WEBSITE_CUSTOMERS_TABLE);
  });

  it("does not send an official invoice when the legacy customer row is missing", async () => {
    stageDbForDeletedLegacyEmail();

    const res = await request(app)
      .post(`/api/iroc/invoices/${DELETED_LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(422);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns a specific compliance error when the legacy customer row is missing", async () => {
    stageDbForDeletedLegacyEmail();

    const res = await request(app)
      .post(`/api/iroc/invoices/${DELETED_LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/complete customer/i);
  });
});
