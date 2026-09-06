/**
 * Integration test — DATEV export endpoints reject batches with invalid VAT rates
 *
 * What & Why
 * ──────────
 * `buildDatevXml` throws a `RangeError` when any invoice in the batch carries a
 * `vatRate` outside the range [0, 100].  Without explicit handling in the route,
 * that error would surface as an unhandled 500.
 *
 * These tests confirm that both the email-export route (POST /iroc/datev/export)
 * and the preview-download route (POST /iroc/datev/download) catch the RangeError
 * inside `buildDatevZip` and return a 422 with a human-readable error body —
 * before any ZIP is created or any email is sent.
 *
 * Test 1 — download: 422 on negative vatRate
 *   POST /iroc/datev/download with an invoice whose vatRate is -1 must return
 *   422 and an error body containing a meaningful message.
 *
 * Test 2 — download: 422 on vatRate > 100
 *   POST /iroc/datev/download with an invoice whose vatRate is 150 must return
 *   422 and an error body containing a meaningful message.
 *
 * Test 3 — export: 422 on invalid vatRate (no email sent)
 *   POST /iroc/datev/export with an invoice whose vatRate is -5 must return 422.
 *   The sendEmail mock must NOT have been called.
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

const { mockSelect, mockSendEmail, mockTransaction } = vi.hoisted(() => ({
  mockSelect:       vi.fn(),
  mockSendEmail:    vi.fn(),
  mockTransaction:  vi.fn(),
}));

// ── Mock PDFKit ───────────────────────────────────────────────────────────────
// The real PDFKit cannot run in the test sandbox (no font resolver, no canvas).
// We replace it with a PassThrough stream that emits minimal PDF-ish bytes so
// the archive entry is non-empty without triggering font-resolution errors.
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
    insert:      vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    update:      vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 99, status: "sent" }]),
        }),
      }),
    }),
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

// ── JWT helper (mirrors requireIrocAuth — no external library) ────────────────
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

function makeItem(invoiceId: number, lineTotal: string) {
  return {
    id:          invoiceId * 10,
    invoiceId,
    productId:   null,
    productName: "Test Product",
    quantity:    1,
    unitPrice:   lineTotal,
    lineTotal,
    discount:    "0.00",
    notes:       null,
  };
}

/**
 * Build the joined-row shape that buildDatevZip expects from its initial
 * batch fetch.  Pass any vatRate string (including an invalid one) to
 * exercise the validation path.
 */
function makeJoinedRow(invoice: {
  id: number;
  invoiceNumber: string;
  issueDate: string;
  vatRate: string;
  total: string;
}) {
  return {
    invoice: {
      id:                invoice.id,
      invoiceNumber:     invoice.invoiceNumber,
      invoiceType:       "domestic",
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
 * Stage the db.select() calls for a single-invoice batch:
 *   call 1 — initial joined invoice fetch
 *   call 2 — website customer lookup
 *   call 3 — line items
 */
function stageSelectsForOneInvoice(invoice: {
  id: number;
  invoiceNumber: string;
  issueDate: string;
  vatRate: string;
  total: string;
}) {
  mockSelect
    .mockReturnValueOnce(selectChain([makeJoinedRow(invoice)]))
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain([makeItem(invoice.id, invoice.total)]));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DATEV export endpoints — invalid VAT rate rejection", () => {

  beforeEach(() => {
    mockSelect.mockReset();
    mockSendEmail.mockReset();
    mockTransaction.mockReset();
  });

  // ── Test 1: download — 422 on negative vatRate ─────────────────────────────

  it("POST /iroc/datev/download returns 422 when an invoice has a negative vatRate", async () => {
    const inv = { id: 1, invoiceNumber: "2026-0001", issueDate: "2026-01-10", vatRate: "-1.00", total: "500.00" };
    stageSelectsForOneInvoice(inv);

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [inv.id] });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "Invoice compliance validation failed",
      details: [expect.stringContaining("VAT rate")],
    });
  });

  // ── Test 2: download — 422 on vatRate > 100 ────────────────────────────────

  it("POST /iroc/datev/download returns 422 when an invoice has vatRate > 100", async () => {
    const inv = { id: 2, invoiceNumber: "2026-0002", issueDate: "2026-01-11", vatRate: "150.00", total: "1000.00" };
    stageSelectsForOneInvoice(inv);

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [inv.id] });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "Invoice compliance validation failed",
      details: [expect.stringContaining("VAT rate")],
    });
  });

  // ── Test 3: download — 422 on mixed batch (one skipped + one invalid vatRate)

  it("POST /iroc/datev/download returns 422 when the only non-skipped invoice has a negative vatRate", async () => {
    // Invoice A — will be skipped (no line items)
    const invA = { id: 10, invoiceNumber: "2026-0010", issueDate: "2026-02-01", vatRate: "19.00", total: "100.00" };
    // Invoice B — has items but carries an invalid vatRate
    const invB = { id: 11, invoiceNumber: "2026-0011", issueDate: "2026-02-02", vatRate: "-3.00", total: "200.00" };

    // Call 1: initial batch fetch — two rows
    mockSelect.mockReturnValueOnce(selectChain([makeJoinedRow(invA), makeJoinedRow(invB)]));
    // Calls 2–3: invoice A — WC lookup + items (empty → skipped)
    mockSelect.mockReturnValueOnce(selectChain([WC]));
    mockSelect.mockReturnValueOnce(selectChain([]));
    // Calls 4–5: invoice B — WC lookup + items (non-empty, triggers XML build)
    mockSelect.mockReturnValueOnce(selectChain([WC]));
    mockSelect.mockReturnValueOnce(selectChain([makeItem(invB.id, invB.total)]));

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [invA.id, invB.id] });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "Invoice compliance validation failed",
      details: [expect.stringContaining("VAT rate")],
    });
  });

  // ── Test 4: export — 422 and no email sent on invalid vatRate ─────────────

  it("POST /iroc/datev/export returns 422 and does not send email when an invoice has an invalid vatRate", async () => {
    const inv = { id: 3, invoiceNumber: "2026-0003", issueDate: "2026-01-12", vatRate: "-5.00", total: "800.00" };
    stageSelectsForOneInvoice(inv);

    const res = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds:      [inv.id],
        bookkeeperEmail: "bookkeeper@example.com",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: "Invoice compliance validation failed",
      details: [expect.stringContaining("VAT rate")],
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

});

// ── Tests: all-skipped batch (every invoice has zero line items) ──────────────

describe("DATEV export endpoints — all-skipped batch (no line items)", () => {

  beforeEach(() => {
    mockSelect.mockReset();
    mockSendEmail.mockReset();
    mockTransaction.mockReset();
  });

  /**
   * Stage the db.select() calls for a single-invoice batch where the
   * invoice has NO line items and will therefore be skipped.
   *   call 1 — initial joined invoice fetch
   *   call 2 — website customer lookup
   *   call 3 — line items (empty)
   */
  function stageSelectsForSkippedInvoice(invoice: {
    id: number;
    invoiceNumber: string;
    issueDate: string;
    vatRate: string;
    total: string;
  }) {
    mockSelect
      .mockReturnValueOnce(selectChain([makeJoinedRow(invoice)]))
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([])); // no items → skipped
  }

  // ── Test 5: download — 422 when the single invoice has no line items ────────

  it("POST /iroc/datev/download returns 422 when the only invoice has no line items", async () => {
    const inv = { id: 20, invoiceNumber: "2026-0020", issueDate: "2026-03-01", vatRate: "19.00", total: "300.00" };
    stageSelectsForSkippedInvoice(inv);

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [inv.id] });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: expect.stringContaining("exportable") });
  });

  // ── Test 6: download — 422 when ALL invoices in a multi-invoice batch are skipped

  it("POST /iroc/datev/download returns 422 when every invoice in the batch has no line items", async () => {
    const invA = { id: 21, invoiceNumber: "2026-0021", issueDate: "2026-03-02", vatRate: "19.00", total: "100.00" };
    const invB = { id: 22, invoiceNumber: "2026-0022", issueDate: "2026-03-03", vatRate: "7.00",  total: "200.00" };

    // Call 1: initial batch fetch — two rows
    mockSelect.mockReturnValueOnce(selectChain([makeJoinedRow(invA), makeJoinedRow(invB)]));
    // Calls 2–3: invoice A — WC lookup + items (empty)
    mockSelect.mockReturnValueOnce(selectChain([WC]));
    mockSelect.mockReturnValueOnce(selectChain([]));
    // Calls 4–5: invoice B — WC lookup + items (empty)
    mockSelect.mockReturnValueOnce(selectChain([WC]));
    mockSelect.mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [invA.id, invB.id] });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: expect.stringContaining("exportable") });
  });

  // ── Test 7: export — 422 and no email sent when all invoices have no items ──

  it("POST /iroc/datev/export returns 422 and does not send email when all invoices have no line items", async () => {
    const inv = { id: 23, invoiceNumber: "2026-0023", issueDate: "2026-03-04", vatRate: "19.00", total: "500.00" };
    stageSelectsForSkippedInvoice(inv);

    const res = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds:      [inv.id],
        bookkeeperEmail: "bookkeeper@example.com",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: expect.stringContaining("exportable") });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

});

// ── Tests: mixed batch (some skipped, some exported) ─────────────────────────

describe("DATEV export endpoints — mixed batch (some skipped, some exported)", () => {

  beforeEach(() => {
    mockSelect.mockReset();
    mockSendEmail.mockReset();
    mockTransaction.mockReset();
  });

  /**
   * Stage db.select() calls for a two-invoice batch where:
   *   invA — no line items → skipped
   *   invB — has one line item → exported
   *
   * Call order inside buildDatevZip:
   *   1. initial joined batch fetch  → [invA row, invB row]
   *   2. invA WC lookup              → [WC]
   *   3. invA line items             → []   (triggers skip)
   *   4. invB WC lookup              → [WC]
   *   5. invB line items             → [item]
   */
  function stageMixedBatch(
    invA: { id: number; invoiceNumber: string; issueDate: string; vatRate: string; total: string },
    invB: { id: number; invoiceNumber: string; issueDate: string; vatRate: string; total: string },
  ) {
    mockSelect
      .mockReturnValueOnce(selectChain([makeJoinedRow(invA), makeJoinedRow(invB)]))
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([makeItem(invB.id, invB.total)]));
  }

  // ── Test 8: download — 200 and ZIP content-type for a mixed batch ──────────

  it("POST /iroc/datev/download returns 200 and a ZIP when one invoice is skipped and one is exported", async () => {
    const invA = { id: 30, invoiceNumber: "2026-0030", issueDate: "2026-04-01", vatRate: "19.00", total: "100.00" };
    const invB = { id: 31, invoiceNumber: "2026-0031", issueDate: "2026-04-02", vatRate: "19.00", total: "200.00" };
    stageMixedBatch(invA, invB);
    // The download path checks for prior email-export claims after building the ZIP.
    mockSelect.mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [invA.id, invB.id] });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/zip/);
  });

  // ── Test 9: export — 200, email sent, skipped list in body ────────────────

  it("POST /iroc/datev/export returns 200, sends email, and includes skipped list for a mixed batch", async () => {
    const invA = { id: 32, invoiceNumber: "2026-0032", issueDate: "2026-04-03", vatRate: "19.00", total: "150.00" };
    const invB = { id: 33, invoiceNumber: "2026-0033", issueDate: "2026-04-04", vatRate: "19.00", total: "250.00" };
    stageMixedBatch(invA, invB);

    // Mock the transaction: advisory lock + no conflicts + insert export record + insert items
    mockTransaction.mockImplementationOnce(
      async (cb: (tx: {
        execute:  ReturnType<typeof vi.fn>;
        select:   ReturnType<typeof vi.fn>;
        insert:   ReturnType<typeof vi.fn>;
      }) => Promise<void>) => {
        const txInsert = vi.fn()
          // First call: insert into datevExports → .values().returning() → [{id:99}]
          .mockReturnValueOnce({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 99 }]),
            }),
          })
          // Second call: insert into datevExportItems → .values() → []
          .mockReturnValueOnce({
            values: vi.fn().mockResolvedValue([]),
          });

        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select:  vi.fn().mockReturnValue(selectChain([])), // no prior conflicts
          insert:  txInsert,
        };

        return cb(tx);
      },
    );

    const res = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds:      [invA.id, invB.id],
        bookkeeperEmail: "bookkeeper@example.com",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok:       true,
      exported: 1,
      skipped:  expect.arrayContaining([expect.stringContaining(invA.invoiceNumber)]),
    });
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  // ── Test 10: export — force override preserves skipped list ---------------

  it("POST /iroc/datev/export returns skipped invoices when force-overriding a prior export", async () => {
    // Invoice A — already exported in a prior sent export, so it would normally
    // trigger the duplicate guard.
    const invA = { id: 34, invoiceNumber: "2026-0034", issueDate: "2026-04-05", vatRate: "19.00", total: "175.00" };
    // Invoice B — no line items, so it must remain in the response's skipped list.
    const invB = { id: 35, invoiceNumber: "2026-0035", issueDate: "2026-04-06", vatRate: "19.00", total: "225.00" };

    mockSelect
      // Initial batch fetch
      .mockReturnValueOnce(selectChain([makeJoinedRow(invA), makeJoinedRow(invB)]))
      // Invoice A customer + line items
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([makeItem(invA.id, invA.total)]))
      // Invoice B customer + line items (empty → skipped)
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([]));

    // A prior sent export would be returned by the duplicate query.  The
    // force=true branch must bypass that query and still claim/send the batch.
    const priorSentConflict = {
      invoiceId: invA.id,
      invoiceNumber: invA.invoiceNumber,
    };
    const duplicateSelect = vi.fn().mockReturnValue(selectChain([priorSentConflict]));
    mockTransaction.mockImplementationOnce(
      async (cb: (tx: {
        execute: ReturnType<typeof vi.fn>;
        select: ReturnType<typeof vi.fn>;
        insert: ReturnType<typeof vi.fn>;
      }) => Promise<void>) => {
        const txInsert = vi.fn()
          .mockReturnValueOnce({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 100 }]),
            }),
          })
          .mockReturnValueOnce({
            values: vi.fn().mockResolvedValue([]),
          });
        const tx = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: duplicateSelect,
          insert: txInsert,
        };
        return cb(tx);
      },
    );

    const res = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds:      [invA.id, invB.id],
        bookkeeperEmail: "bookkeeper@example.com",
        force:           true,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok:       true,
      exported: 1,
      skipped:  expect.arrayContaining([expect.stringContaining(invB.invoiceNumber)]),
    });
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(duplicateSelect).not.toHaveBeenCalled();
  });

});
