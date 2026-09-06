/**
 * Confirmation test: POST /iroc/invoices/:id/email delivers the PDF when the
 * invoice uses the legacy customerId field (websiteCustomerId is null).
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
 * The multi-page test (invoice-email-multipage.test.ts) always supplies an
 * invoice with websiteCustomerId set, so the legacy branch is never exercised.
 * If the legacy irocCustomers select were silently removed or pointed at the
 * wrong table, the PDF would still render (customer would be undefined) and
 * the mocked sendEmail would still fire — so the test would pass despite the
 * regression.
 *
 * This test prevents that by giving irocCustomers and websiteCustomersTable
 * distinct object identities, tracking every .from() call, and asserting:
 *   1. irocCustomers IS queried (legacy path executed).
 *   2. websiteCustomersTable is NOT queried (new path correctly skipped).
 *   3. sendEmail is called with a non-empty PDF attachment.
 *   4. The response is 200 { ok: true }.
 *
 * With these assertions, removing or mis-routing the legacy select causes the
 * test to fail, fulfilling the confirmation requirement.
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
    widthOfString()  { return 10; }
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

/** A legacy irocCustomers row — the shape the legacy branch returns. */
const LEGACY_CUSTOMER = {
  id:              99,
  customerNr:      "LC-099",
  salutation:      "Herr",
  title:           null,
  name:            "Klaus Legacy",
  company:         null,
  vatId:           null,
  firstName:       "Klaus",
  lastName:        "Legacy",
  institutionName: null,
  specialty:       null,
  institutionType: null,
  address:         "Altstr. 9",
  postalCode:      "20095",
  city:            "Hamburg",
  country:         "Deutschland",
  phone:           null,
  fax:             null,
  email:           "legacy@example.com",
  website:         null,
  referenceNumber: null,
  ustIdNr:         null,
  notes:           null,
  createdAt:       new Date(),
};

/**
 * Invoice with customerId set and websiteCustomerId null — the legacy shape.
 * Ensures the endpoint skips the websiteCustomersTable branch and falls
 * through to the irocCustomers select.
 */
const LEGACY_INVOICE = {
  id:                77,
  invoiceNumber:     "2026-0077",
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2026-08-07",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  websiteCustomerId: null,                // ← legacy: no websiteCustomerId
  customerId:        LEGACY_CUSTOMER.id,  // ← legacy FK
  status:            "final",
  subtotal:          "200.00",
  vatRate:           "19.00",
  vatAmount:         "38.00",
  total:             "238.00",
  deliveryCosts:     "0.00",
  notes:             null,
  vatNote:           null,
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

const SINGLE_ITEM = [{
  id:              1,
  invoiceId:       LEGACY_INVOICE.id,
  productId:       null,
  productName:     "Legacy Product",
  sku:             null,
  description:     null,
  lotNumber:       null,
  hsCode:          null,
  countryOfOrigin: null,
  weightKg:        null,
  unitPrice:       "200.00",
  discountPercent: null,
  isDemo:          false,
  quantity:        1,
  lineTotal:       "200.00",
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
 * Stage the three DB selects for the legacy customer path:
 *  1. Invoice row       (customerId set, websiteCustomerId null)
 *  2. irocCustomers row (legacy branch — websiteCustomersTable is NOT queried)
 *  3. Line items
 */
function stageDbForLegacyEmail() {
  mockDbSelect
    .mockReturnValueOnce(selectChain([LEGACY_INVOICE]))   // 1. invoice
    .mockReturnValueOnce(selectChain([LEGACY_CUSTOMER]))  // 2. irocCustomers (legacy)
    .mockReturnValueOnce(selectChain(SINGLE_ITEM));        // 3. line items
}

const EMAIL_BODY = {
  to:      "legacy@example.com",
  subject: "Ihre Rechnung 2026-0077",
  body:    "Bitte finden Sie Ihre Rechnung im Anhang.",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices/:id/email — legacy customerId path", () => {
  beforeEach(() => {
    fromCalls.length = 0;   // reset tracked .from() calls between tests
    mockDbSelect.mockReset();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(undefined);
    updateReturning.mockReset();
  });

  // ── Core legacy-path assertions ───────────────────────────────────────────

  it("queries irocCustomers (not websiteCustomersTable) when websiteCustomerId is null", async () => {
    stageDbForLegacyEmail();

    await request(app)
      .post(`/api/iroc/invoices/${LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    // The legacy branch must query irocCustomers.
    expect(fromCalls).toContain(IROC_CUSTOMERS_TABLE);

    // The new-path table must NOT be queried — websiteCustomerId is null, so
    // the first `if` block is skipped entirely.
    expect(fromCalls).not.toContain(WEBSITE_CUSTOMERS_TABLE);
  });

  it("attaches a non-empty PDF buffer when the invoice uses the legacy customerId", async () => {
    stageDbForLegacyEmail();

    await request(app)
      .post(`/api/iroc/invoices/${LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const attachment = mockSendEmail.mock.calls[0][0].attachments[0];

    // Buffer must be real and non-empty — confirming the full legacy code path
    // ran: irocCustomers select → buildInvoicePDF → sendEmail.
    expect(Buffer.isBuffer(attachment.content)).toBe(true);
    expect((attachment.content as Buffer).length).toBeGreaterThan(0);
    // The MockPDFDocument constructor pushes "page-0" as the first chunk.
    expect((attachment.content as Buffer).toString()).toContain("page-0");
  });

  it("returns 200 { ok: true } when the invoice uses the legacy customerId field", async () => {
    stageDbForLegacyEmail();

    const res = await request(app)
      .post(`/api/iroc/invoices/${LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("calls sendEmail exactly once on the legacy customer path", async () => {
    stageDbForLegacyEmail();

    await request(app)
      .post(`/api/iroc/invoices/${LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  // ── Attachment metadata ───────────────────────────────────────────────────

  it("sets the PDF filename to invoiceNumber.pdf on the legacy path", async () => {
    stageDbForLegacyEmail();

    await request(app)
      .post(`/api/iroc/invoices/${LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    const attachment = mockSendEmail.mock.calls[0][0].attachments[0];
    expect(attachment.filename).toBe(`${LEGACY_INVOICE.invoiceNumber}.pdf`);
    expect(attachment.contentType).toBe("application/pdf");
  });

  it("passes the correct recipient, subject, and body to sendEmail on the legacy path", async () => {
    stageDbForLegacyEmail();

    await request(app)
      .post(`/api/iroc/invoices/${LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [call] = mockSendEmail.mock.calls;
    expect(call[0].to).toBe(EMAIL_BODY.to);
    expect(call[0].subject).toBe(EMAIL_BODY.subject);
    expect(call[0].text).toContain(EMAIL_BODY.body);
    expect(call[0].text).toContain("iROC GmbH");
    expect(call[0].text).toContain("Telefon: +49 89 4625993 70");
    expect(call[0].text).toContain("E-Mail: info@i-roc.de");
    expect(call[0].text).toContain("Web: https://i-roc.de");
  });

  // ── Error paths ───────────────────────────────────────────────────────────

  it("returns 400 when required email fields are missing on the legacy path", async () => {
    stageDbForLegacyEmail();

    const res = await request(app)
      .post(`/api/iroc/invoices/${LEGACY_INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send({ to: "x@example.com" }); // missing subject and body

    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
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
});
