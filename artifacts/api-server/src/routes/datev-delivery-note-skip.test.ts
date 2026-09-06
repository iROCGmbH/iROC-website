/**
 * Integration test — DATEV export generates accounting invoice PDFs, not delivery notes
 *
 * What & Why
 * ──────────
 * Delivery notes (Lieferscheine) in this application are ephemeral views
 * generated on demand via GET /iroc/invoices/:id/delivery-note using
 * buildDeliveryNotePDF.  They are NOT stored as separate invoice records and
 * have no distinct invoiceType value in the database.  The DATEV accounting
 * export (both /datev/download and /datev/export) delegates to buildDatevZip
 * which always calls buildInvoicePDF — the accounting renderer — for every
 * invoice it processes.
 *
 * Delivery notes cannot pollute DATEV exports because:
 *   a) They share the same invoice record as their parent accounting invoice.
 *   b) The DATEV listing (GET /iroc/datev/invoices) only surfaces invoices
 *      whose status is 'sent' or 'paid'.  Draft invoices, which may have had
 *      a delivery-note PDF generated before the accounting invoice was issued,
 *      are excluded at that selection layer.
 *   c) buildDatevZip renders PDFs via buildInvoicePDF (named
 *      "{invoiceNumber}.pdf") — never via buildDeliveryNotePDF (which would
 *      produce "LS-{invoiceNumber}.pdf").
 *
 * These tests confirm all three layers:
 *
 * Test 1 — DATEV listing includes invoiceType for each invoice
 *   GET /iroc/datev/invoices returns the invoiceType field so the UI can
 *   present the correct document type to the admin.
 *
 * Test 2 — DATEV download ZIP filenames are accounting PDF names (no LS- prefix)
 *   POST /iroc/datev/download with a mix of valid invoice types (domestic,
 *   eu, export, noneu) produces a ZIP whose PDF entries are named
 *   "{invoiceNumber}.pdf".  No "LS-" prefixed file (the delivery-note naming
 *   convention) exists in the archive.
 *
 * Test 3 — document_data.xml references only accounting invoice numbers
 *   For the same mixed batch, the DATEV XML manifest must contain each invoice
 *   number exactly once and must not contain any "LS-" reference.
 *
 * Test 4 — POST /iroc/datev/export with force=true uses the accounting renderer
 *   Even when the duplicate guard is bypassed via force=true, the generated ZIP
 *   is the same accounting archive (sendEmail is called once with the ZIP).
 *
 * Hoisting note
 * ─────────────
 * vi.mock() factories are hoisted above all ESM imports.  Variables they close
 * over must be initialised via vi.hoisted() so they exist before the factories run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import JSZip from "jszip";

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
    insert:      mockInsert,
    update:      mockUpdate,
    transaction: mockTransaction,
    execute:     vi.fn().mockResolvedValue(undefined),
  },
  irocInvoices:               { id: "id", invoiceNumber: "invoiceNumber", issueDate: "issueDate", vatRate: "vatRate", total: "total", websiteCustomerId: "websiteCustomerId", customerId: "customerId", status: "status", invoiceType: "invoiceType" },
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

/** Shared website customer used by all test invoices. */
const WC = {
  id:                      5,
  customerNr:              "WC-005",
  salutation:              "Herr",
  title:                   null,
  firstName:               "Klaus",
  lastName:                "Müller",
  specialty:               null,
  institutionName:         "Musterklinik GmbH",
  institutionType:         null,
  address:                 "Musterstraße 10",
  postalCode:              "10115",
  city:                    "Berlin",
  country:                 "Deutschland",
  phone:                   null,
  fax:                     null,
  email:                   "k.mueller@musterklinik.de",
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

/** One line item for an invoice. */
function makeItem(invoiceId: number, lineTotal: string) {
  return {
    id:          invoiceId * 10,
    invoiceId,
    productId:   null,
    productName: "iROC® Instrument Kit",
    quantity:    1,
    unitPrice:   lineTotal,
    lineTotal,
    discount:    "0.00",
    notes:       null,
  };
}

/**
 * Build a joined invoice row as returned by buildDatevZip's initial batch query.
 * Uses a real persisted invoiceType value from the schema enum.
 */
function makeJoinedRow(invoice: {
  id: number;
  invoiceNumber: string;
  issueDate: string;
  vatRate: string;
  total: string;
  invoiceType?: string;
  status?: string;
}) {
  return {
    invoice: {
      id:                invoice.id,
      invoiceNumber:     invoice.invoiceNumber,
      invoiceType:       invoice.invoiceType ?? "domestic",
      issueDate:         invoice.issueDate,
      vatRate:           invoice.vatRate,
      total:             invoice.total,
      vatAmount:         "0.00",
      subtotal:          invoice.total,
      status:            invoice.status ?? "sent",
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
    wcUstIdNr:   WC.ustIdNr,
    legacyName:  null,
    legacyVatId: null,
  };
}

// ── Invoice fixtures — one for each major invoiceType ─────────────────────────

/** Domestic invoice (19 % VAT) — standard German accounting document. */
const INV_DOMESTIC = {
  id:            10,
  invoiceNumber: "2026-DE-010",
  issueDate:     "2026-04-01",
  vatRate:       "19.00",
  total:         "1190.00",
  invoiceType:   "domestic",
};

/** EU invoice (0 % VAT, intra-community supply). */
const INV_EU = {
  id:            11,
  invoiceNumber: "2026-EU-011",
  issueDate:     "2026-04-02",
  vatRate:       "0.00",
  total:         "500.00",
  invoiceType:   "eu",
};

/** Export / commercial invoice (0 % VAT, third country). */
const INV_EXPORT = {
  id:            12,
  invoiceNumber: "2026-EXP-012",
  issueDate:     "2026-04-03",
  vatRate:       "0.00",
  total:         "750.00",
  invoiceType:   "export",
};

/** Non-EU invoice (0 % VAT, non-EU country, non-commercial). */
const INV_NONEU = {
  id:            13,
  invoiceNumber: "2026-NEU-013",
  issueDate:     "2026-04-04",
  vatRate:       "0.00",
  total:         "600.00",
  invoiceType:   "noneu",
};

const ALL_INVOICES = [INV_DOMESTIC, INV_EU, INV_EXPORT, INV_NONEU];

// ── DB staging helpers ────────────────────────────────────────────────────────

/**
 * Stage the SELECT calls for a single invoice going through buildDatevZip:
 *   call 1 — initial joined fetch
 *   call 2 — website customer lookup
 *   call 3 — line items
 */
function stageOneInvoice(inv: typeof INV_DOMESTIC) {
  mockSelect
    .mockReturnValueOnce(selectChain([makeJoinedRow(inv)]))
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain([makeItem(inv.id, "1000.00")]));
}

/**
 * Stage the DATEV listing endpoint SELECT call.
 *
 * The GET /iroc/datev/invoices handler runs a single joined query filtered
 * by status.  We return a row for each invoice so the test can inspect
 * what the listing returns.
 */
function stageListingForInvoices(invoices: typeof ALL_INVOICES) {
  const listingRows = invoices.map((inv) => ({
    invoice: {
      ...makeJoinedRow(inv).invoice,
    },
    wcFirstName: WC.firstName,
    wcLastName:  WC.lastName,
    wcEmail:     WC.email,
    legacyName:  null,
  }));
  mockSelect.mockReturnValueOnce(selectChain(listingRows));
}

/**
 * Stage SELECT calls for four invoices through buildDatevZip:
 *   call 1  — initial joined fetch (all four rows)
 *   calls 2–3  — customer + items for domestic
 *   calls 4–5  — customer + items for eu
 *   calls 6–7  — customer + items for export
 *   calls 8–9  — customer + items for noneu
 */
function stageFourInvoices() {
  mockSelect
    .mockReturnValueOnce(selectChain(ALL_INVOICES.map(makeJoinedRow)));
  for (const inv of ALL_INVOICES) {
    mockSelect
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([makeItem(inv.id, "1000.00")]));
  }
}

// ── Transaction mock helper ───────────────────────────────────────────────────
/**
 * Builds a mockTransaction.mockImplementation that:
 *   - allows the advisory lock (execute)
 *   - returns no conflicts (select)
 *   - simulates insert of datevExports returning { id: exportId }
 *   - simulates insert of datevExportItems
 */
function mockExportTransaction(exportId = 42) {
  const insertReturning  = vi.fn().mockResolvedValue([{ id: exportId }]);
  const itemInsertValues = vi.fn().mockResolvedValue([]);

  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    let insertCallCount = 0;
    await cb({
      execute: vi.fn().mockResolvedValue(undefined),
      select:  vi.fn().mockReturnValue(selectChain([])), // no prior conflicts
      insert:  vi.fn().mockImplementation(() => {
        insertCallCount++;
        // first insert = datevExports row; second = datevExportItems rows
        return insertCallCount === 1
          ? { values: vi.fn().mockReturnValue({ returning: insertReturning }) }
          : { values: itemInsertValues };
      }),
    });
  });

  mockUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: exportId, status: "sent" }]),
      }),
    }),
  });
}

// ── Helper: POST /iroc/datev/download and return parsed ZIP ──────────────────
async function downloadZip(invoiceIds: number[]): Promise<JSZip> {
  const res = await request(app)
    .post("/api/iroc/datev/download")
    .set("Authorization", AUTH)
    .send({
      invoiceIds,
      exemptionReasons: Object.fromEntries(
        ALL_INVOICES.filter(invoice => invoice.vatRate === "0.00")
          .map(invoice => [invoice.id, "Applicable VAT exemption"]),
      ),
    })
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });

  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toMatch(/application\/zip/);

  return JSZip.loadAsync(res.body as Buffer);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DATEV export — accounting invoice PDFs only; delivery notes excluded by architecture", () => {

  beforeEach(() => {
    mockSelect.mockReset().mockReturnValue(selectChain([]));
    mockInsert.mockReset();
    mockUpdate.mockReset();
    mockTransaction.mockReset();
    mockSendEmail.mockReset();
  });

  // ── Test 1: DATEV listing returns invoiceType for downstream inspection ─────
  //
  // The listing endpoint exposes invoiceType so the admin UI can present each
  // invoice's document type.  The status filter (sent/paid) on the DB query
  // is the gatekeeper that prevents draft invoices — which may only exist as
  // delivery-note views — from reaching DATEV selection.

  it("GET /iroc/datev/invoices returns invoiceType for every listed invoice", async () => {
    stageListingForInvoices(ALL_INVOICES);

    const res = await request(app)
      .get("/api/iroc/datev/invoices")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // Every item in the listing must carry an invoiceType so the UI can
    // distinguish accounting invoices from (hypothetical) shipment documents.
    for (const item of res.body as { invoiceType?: string }[]) {
      expect(item).toHaveProperty("invoiceType");
      expect(typeof item.invoiceType).toBe("string");
    }

    // Confirm each of our four invoice types is present in the listing.
    const types = (res.body as { invoiceType: string }[]).map((i) => i.invoiceType);
    expect(types).toContain("domestic");
    expect(types).toContain("eu");
    expect(types).toContain("export");
    expect(types).toContain("noneu");
  });

  // ── Test 1b: DATEV listing DB query carries a ne('delivery-note') condition ───
  //
  // Because the DB is fully mocked, we cannot verify filtered rows directly.
  // Instead we capture the argument passed to .where() and confirm it contains
  // the string 'delivery-note', proving ne(irocInvoices.invoiceType, 'delivery-note')
  // was included in the AND condition sent to the database.

  it("GET /iroc/datev/invoices passes a delivery-note exclusion condition to the DB query", async () => {
    let capturedWhere: unknown;

    // Build a custom chain that intercepts the .where() call.
    const rows = [
      {
        invoice: { ...makeJoinedRow(INV_DOMESTIC).invoice },
        wcFirstName: WC.firstName,
        wcLastName:  WC.lastName,
        wcEmail:     WC.email,
        legacyName:  null,
      },
    ];
    const p = Promise.resolve(rows);
    const capturingChain: Record<string, unknown> = {
      then:      p.then.bind(p),
      catch:     p.catch.bind(p),
      finally:   p.finally.bind(p),
    };
    const self = capturingChain;
    capturingChain.from      = vi.fn().mockReturnValue(self);
    capturingChain.leftJoin  = vi.fn().mockReturnValue(self);
    capturingChain.innerJoin = vi.fn().mockReturnValue(self);
    capturingChain.orderBy   = vi.fn().mockReturnValue(p);
    capturingChain.limit     = vi.fn().mockResolvedValue(rows);
    capturingChain.where     = vi.fn().mockImplementation((cond: unknown) => {
      capturedWhere = cond;
      return self;
    });

    mockSelect.mockReturnValueOnce(capturingChain);

    const res = await request(app)
      .get("/api/iroc/datev/invoices")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    // The where argument is and(inArray(...), ne(...), ...).
    // Drizzle encodes SQL expressions as objects whose queryChunks / values
    // contain the literal strings and params — serialising to JSON is enough
    // to confirm the exclusion value reached the DB layer.
    const condStr = JSON.stringify(capturedWhere);
    expect(condStr).toContain("delivery-note");
  });

  // ── Test 1c: regular invoices still appear in the DATEV listing ──────────────
  //
  // Confirms that the ne() filter does not inadvertently remove accounting
  // invoices (domestic / eu / export / noneu) from the listing response.

  it("GET /iroc/datev/invoices still returns regular accounting invoices", async () => {
    stageListingForInvoices(ALL_INVOICES);

    const res = await request(app)
      .get("/api/iroc/datev/invoices")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as unknown[]).length).toBe(ALL_INVOICES.length);

    const numbers = (res.body as { invoiceNumber: string }[]).map((r) => r.invoiceNumber);
    for (const inv of ALL_INVOICES) {
      expect(numbers).toContain(inv.invoiceNumber);
    }
  });

  // ── Test 2: ZIP PDF filenames are accounting names (no LS- delivery-note prefix)

  it("POST /iroc/datev/download produces PDF files named after invoice numbers, not delivery-note filenames", async () => {
    stageFourInvoices();

    const zip = await downloadZip(ALL_INVOICES.map((i) => i.id));
    const filenames = Object.keys(zip.files);
    const pdfFiles  = filenames.filter((f) => f.endsWith(".pdf"));

    // Accounting PDF naming: "{invoiceNumber}.pdf"
    for (const inv of ALL_INVOICES) {
      expect(pdfFiles).toContain(`${inv.invoiceNumber}.pdf`);
    }

    // Delivery-note naming convention is "LS-{invoiceNumber}.pdf".
    // No LS- prefixed file must exist — confirms buildDeliveryNotePDF was never called.
    const deliveryNoteFiles = pdfFiles.filter((f) => f.startsWith("LS-"));
    expect(deliveryNoteFiles).toHaveLength(0);
  });

  // ── Test 3: document_data.xml references accounting invoice numbers, no LS- ─

  it("document_data.xml references each accounting invoice number and contains no LS- delivery-note references", async () => {
    stageFourInvoices();

    const zip = await downloadZip(ALL_INVOICES.map((i) => i.id));

    const xmlFile = zip.file("document_data.xml");
    expect(xmlFile).not.toBeNull();
    const xml = await xmlFile!.async("string");

    for (const inv of ALL_INVOICES) {
      expect(xml).toContain(inv.invoiceNumber);
    }

    // The DATEV XML must not reference any LS- prefixed filename — the
    // delivery-note PDF renderer is a separate endpoint and is never invoked
    // by buildDatevZip.
    expect(xml).not.toMatch(/LS-/);
  });

  // ── Test 4: POST /iroc/datev/export with force=true uses accounting renderer

  it("POST /iroc/datev/export with force=true sends accounting invoice ZIP via email (no delivery-note PDFs)", async () => {
    stageOneInvoice(INV_DOMESTIC);
    mockExportTransaction();
    mockSendEmail.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds:      [INV_DOMESTIC.id],
        bookkeeperEmail: "buchhaltung@example.com",
        force:           true,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    // Email must be sent exactly once.
    expect(mockSendEmail).toHaveBeenCalledOnce();

    // Inspect the ZIP attachment to confirm accounting PDF naming.
    const callArgs = mockSendEmail.mock.calls[0][0] as {
      attachments?: { filename?: string; content?: Buffer }[];
    };
    expect(callArgs.attachments).toBeDefined();
    expect(callArgs.attachments!.length).toBeGreaterThan(0);

    const zipAttachment = callArgs.attachments![0];
    const zip = await JSZip.loadAsync(zipAttachment.content!);
    const pdfFiles = Object.keys(zip.files).filter((f) => f.endsWith(".pdf"));

    // Accounting PDF present.
    expect(pdfFiles).toContain(`${INV_DOMESTIC.invoiceNumber}.pdf`);

    // No delivery-note PDF present.
    expect(pdfFiles.filter((f) => f.startsWith("LS-"))).toHaveLength(0);
  });

  // ── Test 5: force=true still skips delivery-note invoices ────────────────────
  //
  // The duplicate-export guard is bypassed when force=true, but the delivery-note
  // exclusion filter inside buildDatevZip is unconditional — it must run even
  // when the guard is skipped.  This test submits a batch that contains both a
  // regular (domestic) invoice and a delivery-note invoice, and confirms:
  //   a) Only the regular invoice PDF appears in the emailed ZIP.
  //   b) The delivery-note invoice number does not appear in document_data.xml.

  it("POST /iroc/datev/export with force=true still excludes delivery-note invoices from the ZIP and XML", async () => {
    /** Delivery-note invoice that must be filtered out by buildDatevZip. */
    const INV_DN = {
      id:            99,
      invoiceNumber: "2026-DN-099",
      issueDate:     "2026-04-10",
      vatRate:       "0.00",
      total:         "0.00",
      invoiceType:   "delivery-note",
      status:        "sent",
    };

    // Stage the initial joined fetch — both the regular invoice and the
    // delivery-note invoice are returned from the DB (simulating an admin who
    // somehow passes the delivery-note ID directly to the export endpoint).
    // buildDatevZip must filter out INV_DN before further processing.
    mockSelect
      .mockReturnValueOnce(
        selectChain([makeJoinedRow(INV_DOMESTIC), makeJoinedRow(INV_DN)]),
      )
      // Only INV_DOMESTIC reaches the customer + items queries.
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain([makeItem(INV_DOMESTIC.id, "1000.00")]));

    mockExportTransaction();
    mockSendEmail.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds:      [INV_DOMESTIC.id, INV_DN.id],
        bookkeeperEmail: "buchhaltung@example.com",
        force:           true,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    // Email sent exactly once with the ZIP attachment.
    expect(mockSendEmail).toHaveBeenCalledOnce();

    const callArgs = mockSendEmail.mock.calls[0][0] as {
      attachments?: { filename?: string; content?: Buffer }[];
    };
    expect(callArgs.attachments).toBeDefined();
    expect(callArgs.attachments!.length).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(callArgs.attachments![0].content!);

    // ── a) ZIP PDF entries ────────────────────────────────────────────────────
    const pdfFiles = Object.keys(zip.files).filter((f) => f.endsWith(".pdf"));

    // Regular accounting invoice must be present.
    expect(pdfFiles).toContain(`${INV_DOMESTIC.invoiceNumber}.pdf`);

    // Delivery-note invoice must NOT appear under any naming convention.
    expect(pdfFiles).not.toContain(`${INV_DN.invoiceNumber}.pdf`);
    expect(pdfFiles.filter((f) => f.startsWith("LS-"))).toHaveLength(0);

    // ── b) document_data.xml must not reference the delivery-note number ──────
    const xmlFile = zip.file("document_data.xml");
    expect(xmlFile).not.toBeNull();
    const xml = await xmlFile!.async("string");

    // Regular invoice is present in the manifest.
    expect(xml).toContain(INV_DOMESTIC.invoiceNumber);

    // Delivery-note invoice number must be absent from the manifest.
    expect(xml).not.toContain(INV_DN.invoiceNumber);
  });

});
