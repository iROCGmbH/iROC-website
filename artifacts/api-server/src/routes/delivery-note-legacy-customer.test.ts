/**
 * Confirmation test: GET /iroc/invoices/:id/delivery-note renders a PDF when
 * the invoice uses the legacy customerId field (websiteCustomerId is null).
 *
 * What & Why
 * ──────────
 * The delivery-note endpoint has the same two-path customer lookup as the
 * email endpoint:
 *
 *   if (row.websiteCustomerId) {
 *     // new path: query websiteCustomersTable + wcToCustomerShape()
 *   }
 *   if (!customer && row.customerId) {
 *     // legacy path: query irocCustomers directly
 *   }
 *
 * The existing delivery-note tests always supply invoices with websiteCustomerId
 * set, so the legacy irocCustomers branch is never exercised.  If the legacy
 * select were silently removed or mis-routed, the PDF would still render
 * (customer would be undefined) and the 200 response would still arrive —
 * so a naive status-only assertion would not catch the regression.
 *
 * This test prevents that by giving irocCustomers and websiteCustomersTable
 * distinct object identities, tracking every .from() call, and asserting:
 *   1. irocCustomers IS queried (legacy path executed).
 *   2. websiteCustomersTable is NOT queried (new path correctly skipped).
 *   3. The response is 200 with Content-Type application/pdf.
 *   4. The response body is a non-empty buffer.
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
  address:         "Altstr. 9",
  postalCode:      "20095",
  city:            "Hamburg",
  country:         "Deutschland",
  phone:           null,
  email:           "legacy@example.com",
  vatId:           null,
  notes:           null,
  createdAt:       new Date(),
  updatedAt:       new Date(),
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
function stageDbForLegacyDeliveryNote() {
  mockDbSelect
    .mockReturnValueOnce(selectChain([LEGACY_INVOICE]))   // 1. invoice
    .mockReturnValueOnce(selectChain([LEGACY_CUSTOMER]))  // 2. irocCustomers (legacy)
    .mockReturnValueOnce(selectChain(SINGLE_ITEM));        // 3. line items
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/invoices/:id/delivery-note — legacy customerId path", () => {
  beforeEach(() => {
    fromCalls.length = 0;   // reset tracked .from() calls between tests
    mockDbSelect.mockReset();
    updateReturning.mockReset();
  });

  // ── Core legacy-path assertions ───────────────────────────────────────────

  it("queries irocCustomers (not websiteCustomersTable) when websiteCustomerId is null", async () => {
    stageDbForLegacyDeliveryNote();

    await request(app)
      .get(`/api/iroc/invoices/${LEGACY_INVOICE.id}/delivery-note`)
      .set("Authorization", AUTH);

    // The legacy branch must query irocCustomers.
    expect(fromCalls).toContain(IROC_CUSTOMERS_TABLE);

    // The new-path table must NOT be queried — websiteCustomerId is null, so
    // the first `if` block is skipped entirely.
    expect(fromCalls).not.toContain(WEBSITE_CUSTOMERS_TABLE);
  });

  it("returns 200 with Content-Type application/pdf when the invoice uses the legacy customerId", async () => {
    stageDbForLegacyDeliveryNote();

    const res = await request(app)
      .get(`/api/iroc/invoices/${LEGACY_INVOICE.id}/delivery-note`)
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
  });

  it("returns a non-empty PDF body when the invoice uses the legacy customerId", async () => {
    stageDbForLegacyDeliveryNote();

    const res = await request(app)
      .get(`/api/iroc/invoices/${LEGACY_INVOICE.id}/delivery-note`)
      .set("Authorization", AUTH)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    // Body must be a real non-empty buffer — confirming the full legacy code
    // path ran: irocCustomers select → buildDeliveryNotePDF → pipe to response.
    expect(res.body).toBeTruthy();
    const body = res.body as Buffer;
    expect(body.length).toBeGreaterThan(0);
    // The MockPDFDocument constructor pushes "page-0" as the first chunk.
    expect(body.toString()).toContain("page-0");
  });

  it("sets Content-Disposition to the delivery-note filename on the legacy path", async () => {
    stageDbForLegacyDeliveryNote();

    const res = await request(app)
      .get(`/api/iroc/invoices/${LEGACY_INVOICE.id}/delivery-note`)
      .set("Authorization", AUTH);

    expect(res.headers["content-disposition"]).toContain(
      `LS-${LEGACY_INVOICE.invoiceNumber}.pdf`,
    );
  });

  // ── Error paths ───────────────────────────────────────────────────────────

  it("returns 404 when the invoice does not exist", async () => {
    mockDbSelect.mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .get("/api/iroc/invoices/9999/delivery-note")
      .set("Authorization", AUTH);

    expect(res.status).toBe(404);
  });
});
