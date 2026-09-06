/**
 * Integration test for POST /iroc/datev/download — mixed VAT rates
 *
 * What & Why
 * ──────────
 * The download endpoint delegates to buildDatevZip, which renders one PDF per
 * invoice and wraps them in a JSZip archive alongside a document_data.xml
 * manifest.  A regression where a particular VAT rate (0 %, 7 %, or 19 %)
 * causes a crash, a skipped PDF, or a corrupt archive would be silent in the
 * browser — the user just downloads a bad file with no error shown.
 *
 * Test 1 — headers: Content-Type and Content-Disposition
 *   POST /iroc/datev/download with three invoice IDs (0 %, 7 %, 19 % VAT)
 *   must return status 200, Content-Type application/zip, and a
 *   Content-Disposition header containing "attachment".
 *
 * Test 2 — ZIP contains document_data.xml
 *   The archive must include the DATEV XML manifest at the root level.
 *
 * Test 3 — ZIP contains one PDF per invoice
 *   The archive must contain exactly three .pdf entries, named after the
 *   respective invoice numbers.
 *
 * Test 4 — 400 when invoiceIds is empty
 *   The endpoint must reject an empty array before attempting to build the ZIP.
 *
 * Test 5 — 401 when no auth token is provided
 *   The endpoint must reject unauthenticated requests.
 *
 * Hoisting note
 * ─────────────
 * vi.mock() factories are hoisted above all ESM imports.  Any variable they
 * close over must be initialised via vi.hoisted() so it exists before the
 * factory runs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import JSZip from "jszip";

// ── Hoist mock-factory state ──────────────────────────────────────────────────

const { mockSelect } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
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
      // Emit a small stub payload so the buffer is non-zero.
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
    select: mockSelect,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    transaction: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
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
/**
 * Returns a thenable chain that resolves to `result`.
 *
 * Supports arbitrary combinations of .from() / .where() / .leftJoin() /
 * .innerJoin() / .orderBy() / .limit() so the test does not need to know the
 * exact call sequence inside buildDatevZip.
 */
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

/** Shared website customer used by all three test invoices. */
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

/** One line item shared across all invoice fixtures. */
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
 * The initial batch query in buildDatevZip returns rows that contain both the
 * invoice columns and the join columns from websiteCustomersTable /
 * irocCustomers.  We stage the full joined shape here.
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

const INV_0  = { id: 1, invoiceNumber: "2026-0001", issueDate: "2026-01-10", vatRate: "0.00",  total: "500.00"  };
const INV_7  = { id: 2, invoiceNumber: "2026-0002", issueDate: "2026-01-11", vatRate: "7.00",  total: "535.00"  };
const INV_19 = { id: 3, invoiceNumber: "2026-0003", issueDate: "2026-01-12", vatRate: "19.00", total: "1190.00" };
const INV_EMPTY = { id: 4, invoiceNumber: "2026-0004", issueDate: "2026-01-13", vatRate: "19.00", total: "1190.00" };

const ALL_INVOICE_IDS = [INV_0.id, INV_7.id, INV_19.id];
const EXEMPTION_REASONS = { [INV_0.id]: "Zero-rated test invoice" };

/**
 * Stage the seven sequential db.select() calls that buildDatevZip makes for
 * a batch of three invoices:
 *   call 1 — initial joined invoice fetch (one query for all IDs)
 *   calls 2, 4, 6 — website customer lookup per invoice
 *   calls 3, 5, 7 — line items per invoice
 */
function stageSelectsForThreeInvoices() {
  mockSelect
    .mockReturnValueOnce(selectChain([
      makeJoinedRow(INV_0),
      makeJoinedRow(INV_7),
      makeJoinedRow(INV_19),
    ]))
    // INV_0
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain([makeItem(INV_0.id, "500.00")]))
    // INV_7
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain([makeItem(INV_7.id, "500.00")]))
    // INV_19
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain([makeItem(INV_19.id, "1000.00")]));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/datev/download — mixed VAT rates (0 %, 7 %, 19 %)", () => {

  beforeEach(() => {
    mockSelect.mockReset();
    // The preview route checks for prior email-export claims after building
    // the ZIP. Unless a test explicitly stages a conflict, that lookup is empty.
    mockSelect.mockReturnValue(selectChain([]));
  });

  // ── Test 1: response headers ───────────────────────────────────────────────

  it("responds with Content-Type application/zip and Content-Disposition attachment", async () => {
    stageSelectsForThreeInvoices();

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: ALL_INVOICE_IDS, exemptionReasons: EXEMPTION_REASONS });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/zip/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
  });

  // ── Test 2: ZIP contains document_data.xml ─────────────────────────────────

  it("ZIP contains document_data.xml", async () => {
    stageSelectsForThreeInvoices();

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: ALL_INVOICE_IDS, exemptionReasons: EXEMPTION_REASONS })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    const zip = await JSZip.loadAsync(res.body as Buffer);
    const filenames = Object.keys(zip.files);

    expect(filenames).toContain("document_data.xml");
  });

  // ── Test 3: ZIP contains one PDF per invoice ───────────────────────────────

  it("ZIP contains exactly three PDFs, one per invoice number", async () => {
    stageSelectsForThreeInvoices();

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: ALL_INVOICE_IDS, exemptionReasons: EXEMPTION_REASONS })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    const zip = await JSZip.loadAsync(res.body as Buffer);
    const filenames = Object.keys(zip.files);

    const pdfFiles = filenames.filter((f) => f.endsWith(".pdf"));
    expect(pdfFiles).toHaveLength(3);
    expect(pdfFiles).toContain(`${INV_0.invoiceNumber}.pdf`);
    expect(pdfFiles).toContain(`${INV_7.invoiceNumber}.pdf`);
    expect(pdfFiles).toContain(`${INV_19.invoiceNumber}.pdf`);
  });

  // ── Test 4: invoices with no items are skipped without corrupting the ZIP ───

  it("returns a valid ZIP containing only invoices that have line items", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([
        makeJoinedRow(INV_7),
        makeJoinedRow(INV_EMPTY),
      ]))
      // INV_7 has an exportable line item.
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([makeItem(INV_7.id, "500.00")]))
      // INV_EMPTY has no line items and must be omitted from the ZIP and XML.
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([]));

    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [INV_7.id, INV_EMPTY.id] })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/zip/);

    const zip = await JSZip.loadAsync(res.body as Buffer);
    const filenames = Object.keys(zip.files);
    const pdfFiles = filenames.filter((f) => f.endsWith(".pdf"));
    const xml = await zip.file("document_data.xml")?.async("string");

    expect(pdfFiles).toEqual([`${INV_7.invoiceNumber}.pdf`]);
    expect(xml).toContain(INV_7.invoiceNumber);
    expect(xml).not.toContain(INV_EMPTY.invoiceNumber);
    expect(res.headers["x-datev-skipped"]).toBe(INV_EMPTY.invoiceNumber);
  });

  // ── Test 5: empty invoiceIds rejected with 400 ─────────────────────────────

  it("returns 400 when invoiceIds is an empty array", async () => {
    const res = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [] });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  // ── Test 6: unauthenticated requests rejected ──────────────────────────────

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app)
      .post("/api/iroc/datev/download")
      .send({ invoiceIds: ALL_INVOICE_IDS });

    expect(res.status).toBe(401);
  });

});
