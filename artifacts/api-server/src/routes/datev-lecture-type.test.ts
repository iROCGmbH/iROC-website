/**
 * Integration test — DATEV export endpoints accept lecture-eu and lecture-noneu invoices
 *
 * What & Why
 * ──────────
 * The invoice creation/update schema includes `lecture-eu` and `lecture-noneu` as
 * valid invoice types.  This confirms that the DATEV export path (both the ZIP
 * preview-download route and the email-export route) treats these types like any
 * other invoice type: they flow through to DATEV-safe output rather than being
 * silently dropped or producing a 500.
 *
 * Additionally, `ListIrocInvoicesResponseItem` and every other DATEV-adjacent
 * response schema in `lib/api-zod/src/generated/api.ts` must enumerate all six
 * invoice types — this test imports those schemas and asserts they parse both
 * lecture variants without errors.
 *
 * Test 1 — download: lecture-eu invoice produces a ZIP (200)
 *   POST /iroc/datev/download with a lecture-eu invoice must return 200 with
 *   Content-Type: application/zip.
 *
 * Test 2 — download: lecture-noneu invoice produces a ZIP (200)
 *   POST /iroc/datev/download with a lecture-noneu invoice must return 200 with
 *   Content-Type: application/zip.
 *
 * Test 3 — export: lecture-eu invoice sends email and returns ok (no rejection)
 *   POST /iroc/datev/export with a lecture-eu invoice must return 200 and call
 *   sendEmail exactly once.
 *
 * Test 4 — Zod schema: ListIrocInvoicesResponseItem parses lecture variants
 *   The api-zod schema must accept 'lecture-eu' and 'lecture-noneu' in invoiceType
 *   without throwing.
 *
 * Hoisting note
 * ─────────────
 * vi.mock() factories are hoisted above all ESM imports.  Variables they close
 * over must be initialised via vi.hoisted() so they exist before the factories run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock-factory state ──────────────────────────────────────────────────

const { mockSelect, mockInsert, mockUpdate, mockTransaction, mockSendEmail } =
  vi.hoisted(() => ({
    mockSelect:      vi.fn(),
    mockInsert:      vi.fn(),
    mockUpdate:      vi.fn(),
    mockTransaction: vi.fn(),
    mockSendEmail:   vi.fn(),
  }));

// ── Mock PDFKit ───────────────────────────────────────────────────────────────

vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");

  class MockPDFDocument extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;

    constructor(_opts?: unknown) {
      super();
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
    text()           { return this; }
    heightOfString() { return 10; }
    widthOfString()  { return 10; }
    rotate()         { return this; }
    opacity()        { return this; }
    switchToPage()   { return this; }
    flushPages()     { return this; }
    bufferedPageRange() { return { start: 0, count: 1 }; }

    end(cb?: () => void) {
      this.push(Buffer.from("PDF stub"));
      super.end(cb);
      return this;
    }
  }

  return { default: MockPDFDocument };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select:      mockSelect,
    insert:      mockInsert,
    update:      mockUpdate,
    transaction: mockTransaction,
    execute:     vi.fn().mockResolvedValue(undefined),
  },
  irocInvoices:               { id: "id", invoiceNumber: "invoiceNumber", issueDate: "issueDate", vatRate: "vatRate", total: "total", websiteCustomerId: "websiteCustomerId", customerId: "customerId", status: "status" },
  irocInvoiceItems:           { invoiceId: "invoiceId", id: "id" },
  irocCustomers:              { id: "id" },
  websiteCustomersTable:      { id: "id" },
  settingsTable:              { key: "key" },
  datevExports:               { id: "id", status: "status" },
  datevExportItems:           { exportId: "exportId", invoiceId: "invoiceId" },
  irocAppUsers:               {},
  irocNotifications:          {},
  irocProducts:               {},
  irocInventoryLots:          {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable:        {},
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

// ── Fluent select-chain builder ───────────────────────────────────────────────

function selectChain(result: unknown[]) {
  const p = Promise.resolve(result);
  type AnyFn = ReturnType<typeof vi.fn>;
  interface Chain {
    from:      AnyFn;
    where:     AnyFn;
    leftJoin:  AnyFn;
    innerJoin: AnyFn;
    orderBy:   AnyFn;
    limit:     AnyFn;
    then:      typeof p.then;
    catch:     typeof p.catch;
    finally:   typeof p.finally;
  }
  const c = {
    then:    p.then.bind(p),
    catch:   p.catch.bind(p),
    finally: p.finally.bind(p),
  } as unknown as Chain;

  c.from      = vi.fn().mockReturnValue(c);
  c.where     = vi.fn().mockReturnValue(c);
  c.leftJoin  = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.orderBy   = vi.fn().mockReturnValue(c);
  c.limit     = vi.fn().mockResolvedValue(result);

  return c;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WC = {
  id:                      1,
  customerNr:              "WC-001",
  salutation:              "Herr",
  title:                   null,
  firstName:               "Max",
  lastName:                "Mustermann",
  specialty:               null,
  institutionName:         "Test Clinic GmbH",
  institutionType:         null,
  address:                 "Teststraße 1",
  postalCode:              "80001",
  city:                    "München",
  country:                 "Deutschland",
  phone:                   null,
  fax:                     null,
  email:                   "max@example.com",
  website:                 null,
  referenceNumber:         null,
  ustIdNr:                 "DE123456789",
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

function makeItem(invoiceId: number, lineTotal: string) {
  return {
    id:          invoiceId * 10,
    invoiceId,
    productId:   null,
    productName: "Spirecut Lecture Fee",
    quantity:    1,
    unitPrice:   lineTotal,
    lineTotal,
    discount:    "0.00",
    notes:       null,
  };
}

/**
 * Build a joined-row that buildDatevZip expects, with the given invoiceType.
 */
function makeJoinedRow(invoice: {
  id: number;
  invoiceNumber: string;
  issueDate: string;
  vatRate: string;
  total: string;
  invoiceType: string;
}) {
  return {
    invoice: {
      id:                invoice.id,
      invoiceNumber:     invoice.invoiceNumber,
      invoiceType:       invoice.invoiceType,
      issueDate:         invoice.issueDate,
      vatRate:           invoice.vatRate,
      total:             invoice.total,
      vatAmount:         "0.00",
      subtotal:          invoice.total,
      status:            "sent",
      customerId:        null,
      websiteCustomerId: WC.id,
      dueDate:           null,
      orderNumber:       null,
      referenceNumber:   null,
      shippingMethod:    null,
      reasonForExport:   null,
      termsOfDelivery:   null,
      deliveryCosts:     "0.00",
      notes:             null,
      vatNote:           null,
      language:          "de",
      createdAt:         new Date(),
      updatedAt:         new Date(),
    },
    wcFirstName: WC.firstName,
    wcLastName:  WC.lastName,
    wcEmail:     WC.email,
    wcUstIdNr:   null,
    legacyName:  null,
    legacyVatId: null,
  };
}

/**
 * Stage the DATEV download path's four db.select() calls for a single-invoice batch:
 *   call 1 — initial joined invoice fetch
 *   call 2 — website customer lookup
 *   call 3 — line items
 *   call 4 — prior email-export conflict check
 */
function stageSelectsForOneInvoice(invoice: {
  id: number;
  invoiceNumber: string;
  issueDate: string;
  vatRate: string;
  total: string;
  invoiceType: string;
}) {
  mockSelect
    .mockReturnValueOnce(selectChain([makeJoinedRow(invoice)]))
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain([makeItem(invoice.id, invoice.total)]))
    .mockReturnValueOnce(selectChain([]));
}

// ── Tests: lecture invoice types in the DATEV export path ─────────────────────

describe("DATEV export endpoints — lecture invoice types pass through", () => {

  beforeEach(() => {
    mockSelect.mockReset();
    mockInsert.mockReset();
    mockUpdate.mockReset();
    mockTransaction.mockReset();
    mockSendEmail.mockReset();
  });

  // ── Test 1: download — lecture-eu produces a ZIP ──────────────────────────

  it("POST /iroc/datev/download returns 200 (ZIP) for a lecture-eu invoice", async () => {
    const inv = {
      id: 100,
      invoiceNumber: "2026-0100",
      issueDate:     "2026-06-15",
      vatRate:       "0.00",
      total:         "1200.00",
      invoiceType:   "lecture-eu",
    };
    stageSelectsForOneInvoice(inv);

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({
        invoiceIds: [inv.id],
        exemptionReasons: { [inv.id]: "Lecture service supplied to an EU business (reverse charge)" },
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/zip/);
  });

  // ── Test 2: download — lecture-noneu produces a ZIP ───────────────────────

  it("POST /iroc/datev/download returns 200 (ZIP) for a lecture-noneu invoice", async () => {
    const inv = {
      id: 101,
      invoiceNumber: "2026-0101",
      issueDate:     "2026-06-16",
      vatRate:       "0.00",
      total:         "800.00",
      invoiceType:   "lecture-noneu",
    };
    stageSelectsForOneInvoice(inv);

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({
        invoiceIds: [inv.id],
        exemptionReasons: { [inv.id]: "Lecture service supplied outside the EU" },
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/zip/);
  });

  // ── Test 3: export — lecture-eu invoice triggers email send ───────────────

  it("POST /iroc/datev/export returns 200 and sends email for a lecture-eu invoice", async () => {
    const inv = {
      id: 102,
      invoiceNumber: "2026-0102",
      issueDate:     "2026-06-17",
      vatRate:       "0.00",
      total:         "950.00",
      invoiceType:   "lecture-eu",
    };
    stageSelectsForOneInvoice(inv);

    // Mock the transaction: advisory lock + conflict check + insert + returning
    const insertReturning = vi.fn().mockResolvedValue([{ id: 99 }]);
    const insertValues    = vi.fn().mockReturnValue({ returning: insertReturning });
    const insertBase      = vi.fn().mockReturnValue({ values: insertValues });

    const itemInsertValues = vi.fn().mockResolvedValue([]);
    const itemInsertBase   = vi.fn().mockReturnValue({ values: itemInsertValues });

    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      let insertCallCount = 0;
      await cb({
        execute: vi.fn().mockResolvedValue(undefined),
        select:  vi.fn().mockReturnValue(selectChain([])), // no conflicts
        insert:  vi.fn().mockImplementation(() => {
          insertCallCount++;
          // first insert = datevExports; second insert = datevExportItems
          return insertCallCount === 1
            ? { values: vi.fn().mockReturnValue({ returning: insertReturning }) }
            : { values: itemInsertValues };
        }),
      });
    });

    // update status to 'sent'
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    mockSendEmail.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds:      [inv.id],
        bookkeeperEmail: "bookkeeper@example.com",
        exemptionReasons: {
          [inv.id]: "Lecture service supplied to an EU business (reverse charge)",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  // ── Test 4: download — a domestic 0 % invoice without a reason is rejected
  it("POST /iroc/datev/download returns validation details for a 0 % domestic invoice without an exemption reason", async () => {
    const inv = {
      id: 103,
      invoiceNumber: "2026-0103",
      issueDate:     "2026-06-18",
      vatRate:       "0.00",
      total:         "400.00",
      invoiceType:   "domestic",
    };
    mockSelect.mockReturnValueOnce(selectChain([makeJoinedRow(inv)]));

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [inv.id] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details).toEqual([
      expect.stringContaining(`${inv.invoiceNumber}: 0 % VAT invoices require a DATEV exemption reason.`),
    ]);
    // Validation happens before customer/items lookups and before a ZIP exists.
    expect(mockSelect).toHaveBeenCalledOnce();
  });

  // ── Test 5: export — the same validation prevents email delivery
  it("POST /iroc/datev/export returns the same validation details and does not send a 0 % domestic invoice without an exemption reason", async () => {
    const inv = {
      id: 104,
      invoiceNumber: "2026-0104",
      issueDate:     "2026-06-19",
      vatRate:       "0.00",
      total:         "450.00",
      invoiceType:   "domestic",
    };
    mockSelect.mockReturnValueOnce(selectChain([makeJoinedRow(inv)]));

    const res = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds: [inv.id],
        bookkeeperEmail: "bookkeeper@example.com",
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details).toEqual([
      expect.stringContaining(`${inv.invoiceNumber}: 0 % VAT invoices require a DATEV exemption reason.`),
    ]);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

});

// ── Tests: Zod schema accepts lecture invoice types ───────────────────────────

describe("api-zod schemas — lecture invoice types are valid enum members", () => {

  it("ListIrocInvoicesResponseItem parses invoiceType 'lecture-eu' without error", async () => {
    const { ListIrocInvoicesResponseItem } = await import("@workspace/api-zod");

    const base = {
      id:                1,
      invoiceNumber:     "2026-0100",
      customerId:        1,
      websiteCustomerId: null,
      customerName:      "Max Mustermann",
      issueDate:         "2026-06-15",
      paymentTermCode:   "prepayment",
      isB2g:             false,
      dueDate:           null,
      orderNumber:       null,
      referenceNumber:   null,
      shippingMethod:    null,
      reasonForExport:   null,
      deliveryCosts:     "0.00",
      insuranceCosts:    "0.00",
      subtotal:          "1200.00",
      vatRate:           "0.00",
      vatAmount:         "0.00",
      total:             "1200.00",
      status:            "sent" as const,
      notes:             null,
      language:          "de" as const,
      createdAt:         "2026-06-15T10:00:00.000Z",
    };

    expect(() =>
      ListIrocInvoicesResponseItem.parse({ ...base, invoiceType: "lecture-eu" }),
    ).not.toThrow();

    expect(() =>
      ListIrocInvoicesResponseItem.parse({ ...base, invoiceType: "lecture-noneu" }),
    ).not.toThrow();
  });

  it("ListIrocInvoicesResponseItem rejects an unknown invoice type", async () => {
    const { ListIrocInvoicesResponseItem } = await import("@workspace/api-zod");

    const base = {
      id:                2,
      invoiceNumber:     "2026-0200",
      customerId:        1,
      websiteCustomerId: null,
      customerName:      "Max Mustermann",
      invoiceType:       "unknown-type",
      issueDate:         "2026-06-15",
      paymentTermCode:   "prepayment",
      isB2g:             false,
      dueDate:           null,
      orderNumber:       null,
      referenceNumber:   null,
      shippingMethod:    null,
      reasonForExport:   null,
      deliveryCosts:     "0.00",
      insuranceCosts:    "0.00",
      subtotal:          "500.00",
      vatRate:           "19.00",
      vatAmount:         "95.00",
      total:             "595.00",
      status:            "sent" as const,
      notes:             null,
      language:          "de" as const,
      createdAt:         "2026-06-15T10:00:00.000Z",
    };

    expect(() => ListIrocInvoicesResponseItem.parse(base)).toThrow();
  });

});
