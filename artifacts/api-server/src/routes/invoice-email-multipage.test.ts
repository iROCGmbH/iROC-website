/**
 * Confirmation test: POST /iroc/invoices/:id/email assembles the PDF buffer
 * correctly across multiple pages.
 *
 * What & Why
 * ──────────
 * The invoice email endpoint builds the PDF via an event-emitter pattern:
 *
 *   doc.on("data", chunk => chunks.push(chunk));
 *   doc.on("end",  ()    => resolve(Buffer.concat(chunks)));
 *   buildInvoicePDF(doc, row, customer, items);
 *   doc.end();
 *
 * It buffers generated pages so draft and cancelled invoices can receive a
 * watermark after their content is drawn. There is also coverage for the
 * multi-page branch of the email endpoint.
 *
 * This test confirms:
 *
 *   1. buildInvoicePDF calls doc.addPage() naturally when there are enough
 *      items to overflow a single page — the page count comes from real
 *      production calls, not a preconfigured mock value.
 *   2. Every addPage() call pushes a distinct chunk into the PassThrough
 *      stream, so Buffer.concat aggregates all of them.
 *   3. The assembled buffer is passed to sendEmail as an attachment.
 *   4. A single-item invoice does NOT call addPage() — confirming the boundary
 *      condition.
 *   5. A 30-item invoice DOES call addPage() at least once — confirming the
 *      production overflow branch fires.
 *   6. The multi-page buffer is strictly larger than the single-page buffer
 *      because extra page chunks were emitted.
 *
 * Strategy
 * ────────
 * MockPDFDocument extends PassThrough.  Its constructor pushes a "page-0"
 * chunk, and every addPage() call pushes a "page-N" chunk and resets y to 0.
 * buildInvoicePDF calls addPage() via its ensureSpace() guard when
 *   curY + rowH > page.height - 62 - 14  (= 765.89 for A4).
 *
 * With heightOfString() returning 10, each item row is 20pt tall.  The header
 * sections advance curY to ~313pt before the first item, so overflow occurs
 * after ~22–23 items.  30 items reliably triggers at least one addPage().
 *
 * 1 item stays comfortably on the first page (curY ≈ 333 after rendering,
 * well below AVAIL_BOTTOM).
 *
 * Follows the MockPDFDocument / selectChain pattern from
 * offer-pdf-watermark-multipage.test.ts and
 * delivery-note-watermark-multipage.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock-factory state ──────────────────────────────────────────────
const {
  pdfState,
  mockSendEmail,
  mockDbSelect,
  mockDbUpdate,
  updateReturning,
  mockDbDelete,
  mockDbInsert,
} = vi.hoisted(() => {
  const pdfState = {
    /**
     * Number of addPage() calls made by buildInvoicePDF during a request.
     * This comes from actual production overflow, NOT from preconfigured config.
     */
    pageCount: 0,
    watermarks: [] as Array<{ text: string; page: number }>,
  };

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
    pdfState,
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
    currentPage = 0;

    constructor(_opts?: unknown) {
      super();
      // Push initial page data so the "data" listener receives content for page 0.
      this.push(Buffer.from("page-0"));
    }

    /**
     * Called by buildInvoicePDF's ensureSpace() when content overflows the
     * available vertical space.  Pushes a new page chunk so the final
     * Buffer.concat captures every page, and resets y so subsequent curY
     * calculations from doc.y + 1 start from the top of the new page.
     */
    addPage() {
      pdfState.pageCount += 1;
      this.push(Buffer.from(`page-${pdfState.pageCount}`));
      this.y = 0;
      this.currentPage = pdfState.pageCount;
      return this;
    }

    /** Returns every generated page so the cancelled watermark can be stamped
     *  after invoice content is complete. */
    bufferedPageRange() {
      return { start: 0, count: pdfState.pageCount + 1 };
    }

    switchToPage(pageIndex: number) { this.currentPage = pageIndex; return this; }

    text(str: string, ..._rest: unknown[]) {
      if (["ENTWURF", "DRAFT", "STORNIERT", "CANCELLED"].includes(str)) {
        pdfState.watermarks.push({ text: str, page: this.currentPage });
        // Keep the marker in the generated stream so the assertion verifies
        // the watermark is part of the attached PDF buffer, not just a call
        // made while rendering a detached document.
        this.push(Buffer.from(`watermark-${str}-page-${this.currentPage}`));
      }
      return this;
    }
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
    widthOfString()  { return 10; }
    /** Returns 10 so each item row measures as MIN_ROW_H (13) < 10 + 4 = 14,
     *  giving rowH = max(13, 14 + PAD_V*2=6) = 20 pt per item row. */
    heightOfString() { return 10; }
    flushPages()     { return this; }
    end(cb?: () => void) { super.end(cb); return this; }
  }

  return { default: MockPDFDocument };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
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

const WC = {
  id:                      7,
  customerNr:              "WC-007",
  salutation:              "Frau",
  title:                   null,
  firstName:               "Anna",
  lastName:                "Beispiel",
  institutionName:         null,
  specialty:               null,
  institutionType:         null,
  address:                 "Musterstr. 1",
  postalCode:              "10001",
  city:                    "Berlin",
  country:                 "Deutschland",
  phone:                   null,
  fax:                     null,
  email:                   "anna@example.com",
  website:                 null,
  referenceNumber:         null,
  ustIdNr:                 null,
  instrument:              "iroc",
  notes:                   null,
  privacyConsent:          true,
  isEu:                    false,
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

const INVOICE = {
  id:                42,
  invoiceNumber:     "2026-0042",
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2026-08-07",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  websiteCustomerId: WC.id,
  customerId:        null,
  status:            "final",
  subtotal:          "500.00",
  vatRate:           "19.00",
  vatAmount:         "95.00",
  total:             "595.00",
  deliveryCosts:     "0.00",
  notes:             null,
  vatNote:           null,
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

/** Build N line items for the invoice. */
function buildItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id:              i + 1,
    invoiceId:       INVOICE.id,
    productId:       null,
    productName:     `Product ${i + 1}`,
    sku:             null,
    description:     null,
    lotNumber:       null,
    hsCode:          null,
    countryOfOrigin: null,
    weightKg:        null,
    unitPrice:       "100.00",
    discountPercent: null,
    isDemo:          false,
    quantity:        1,
    lineTotal:       "100.00",
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  c.from      = vi.fn().mockReturnValue(c);
  c.where     = vi.fn().mockReturnValue(c);
  c.leftJoin  = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.orderBy   = vi.fn().mockReturnValue(c);
  c.limit     = vi.fn().mockResolvedValue(result);
  return c;
}

/**
 * Stage the three DB selects the email endpoint makes:
 *  1. invoice row  2. websiteCustomer  3. line items
 */
function stageDbForEmail(itemCount: number, invoice = INVOICE) {
  mockDbSelect
    .mockReturnValueOnce(selectChain([invoice]))
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain(buildItems(itemCount)));
}

/** Standard email payload. */
const EMAIL_BODY = {
  to:      "patient@example.com",
  subject: "Ihre Rechnung 2026-0042",
  body:    "Bitte finden Sie Ihre Rechnung im Anhang.",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices/:id/email — PDF buffer assembled correctly for multi-page invoices", () => {
  beforeEach(() => {
    pdfState.pageCount  = 0;
    pdfState.watermarks = [];
    mockDbSelect.mockReset();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(undefined);
    updateReturning.mockReset();
  });

  // ── Single-page baseline ──────────────────────────────────────────────────

  it("returns 200 { ok: true } and calls sendEmail once for a 1-item invoice", async () => {
    stageDbForEmail(1);

    const res = await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("does NOT call addPage() for a 1-item invoice — it fits on a single page", async () => {
    stageDbForEmail(1);

    await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    // A 1-item invoice at 20pt per row sits well below AVAIL_BOTTOM (~765pt).
    expect(pdfState.pageCount).toBe(0);
  });

  it("assembles a non-empty buffer for a 1-item invoice and attaches it", async () => {
    stageDbForEmail(1);

    await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const attachment = mockSendEmail.mock.calls[0][0].attachments[0];

    expect(Buffer.isBuffer(attachment.content)).toBe(true);
    expect((attachment.content as Buffer).length).toBeGreaterThan(0);
    // Initial page-0 chunk must be present.
    expect((attachment.content as Buffer).toString()).toContain("page-0");
  });

  // ── Multi-page: overflow branch ───────────────────────────────────────────

  it("calls addPage() at least once for a 30-item invoice — the production overflow branch fires", async () => {
    // 30 items × 20pt/row = 600pt of item content.
    // Header sections advance curY to ~313pt before the first item, so
    // total vertical usage ≈ 913pt > AVAIL_BOTTOM (765.89pt).
    // ensureSpace() in buildInvoicePDF therefore calls doc.addPage() mid-table.
    stageDbForEmail(30);

    await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(pdfState.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("assembles a buffer containing data from every page for a 30-item invoice", async () => {
    stageDbForEmail(30);

    await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const buf = mockSendEmail.mock.calls[0][0].attachments[0].content as Buffer;
    const content = buf.toString();

    // page-0 chunk is always present (initial page).
    expect(content).toContain("page-0");

    // At least one addPage() occurred, so page-1 chunk must also be present.
    expect(content).toContain("page-1");

    // The total page count matches the actual addPage() calls.
    for (let p = 0; p <= pdfState.pageCount; p++) {
      expect(content).toContain(`page-${p}`);
    }
  });

  it("multi-page buffer is strictly larger than single-page buffer", async () => {
    // ── Single-page run ──────────────────────────────────────────────────────
    stageDbForEmail(1);

    await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    const singlePageSize =
      (mockSendEmail.mock.calls[0][0].attachments[0].content as Buffer).length;

    // ── Multi-page run ───────────────────────────────────────────────────────
    pdfState.pageCount = 0;
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(undefined);
    mockDbSelect.mockReset();

    stageDbForEmail(30);

    await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    const multiPageSize =
      (mockSendEmail.mock.calls[0][0].attachments[0].content as Buffer).length;

    // Each addPage() push adds at least 6 bytes ("page-N") to the stream.
    // The 30-item run triggers at least one addPage(), so multiPageSize must
    // be strictly larger.
    expect(pdfState.pageCount).toBeGreaterThanOrEqual(1);
    expect(multiPageSize).toBeGreaterThan(singlePageSize);
  });

  it("attaches the German ENTWURF watermark once on every draft page", async () => {
    stageDbForEmail(30, { ...INVOICE, status: "draft", language: "de" });

    const res = await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(200);
    const attachment = mockSendEmail.mock.calls[0][0].attachments[0];
    const content = (attachment.content as Buffer).toString();
    const calls = pdfState.watermarks.filter(({ text }) => text === "ENTWURF");

    expect(calls).toHaveLength(pdfState.pageCount + 1);
    expect(calls.map(({ page }) => page).sort((a, b) => a - b))
      .toEqual(Array.from({ length: pdfState.pageCount + 1 }, (_, page) => page));
    expect(content).toContain("watermark-ENTWURF-page-0");
    expect(content).toContain(`watermark-ENTWURF-page-${pdfState.pageCount}`);
    expect(pdfState.watermarks.filter(({ text }) => text === "DRAFT")).toHaveLength(0);
  });

  it("attaches the English DRAFT watermark for an English draft invoice", async () => {
    stageDbForEmail(1, { ...INVOICE, status: "draft", language: "en" });

    const res = await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(200);
    const attachment = mockSendEmail.mock.calls[0][0].attachments[0];
    const content = (attachment.content as Buffer).toString();

    expect(pdfState.watermarks).toEqual([{ text: "DRAFT", page: 0 }]);
    expect(content).toContain("watermark-DRAFT-page-0");
    expect(content).not.toContain("watermark-ENTWURF-page-0");
  });

  it("renders the German STORNIERT watermark exactly once on every cancelled page", async () => {
    stageDbForEmail(30, { ...INVOICE, status: "cancelled", language: "de" });

    const res = await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(200);
    const calls = pdfState.watermarks.filter(({ text }) => text === "STORNIERT");
    expect(calls).toHaveLength(pdfState.pageCount + 1);
    expect(calls.map(({ page }) => page).sort((a, b) => a - b))
      .toEqual(Array.from({ length: pdfState.pageCount + 1 }, (_, page) => page));
    expect(pdfState.watermarks.filter(({ text }) => text === "CANCELLED")).toHaveLength(0);
  });

  it("renders the English CANCELLED watermark exactly once on every cancelled page", async () => {
    stageDbForEmail(30, { ...INVOICE, status: "cancelled", language: "en" });

    const res = await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(200);
    const calls = pdfState.watermarks.filter(({ text }) => text === "CANCELLED");
    expect(calls).toHaveLength(pdfState.pageCount + 1);
    expect(calls.map(({ page }) => page).sort((a, b) => a - b))
      .toEqual(Array.from({ length: pdfState.pageCount + 1 }, (_, page) => page));
    expect(pdfState.watermarks.filter(({ text }) => text === "STORNIERT")).toHaveLength(0);
  });

  it.each(["draft", "sent", "paid"] as const)(
    "does not render a cancelled watermark for a %s email attachment",
    async status => {
      stageDbForEmail(30, { ...INVOICE, status, language: "de" });

      const res = await request(app)
        .post(`/api/iroc/invoices/${INVOICE.id}/email`)
        .set("Authorization", AUTH)
        .send(EMAIL_BODY);

      expect(res.status).toBe(200);
      expect(pdfState.watermarks.filter(({ text }) => text === "STORNIERT")).toHaveLength(0);
      expect(pdfState.watermarks.filter(({ text }) => text === "CANCELLED")).toHaveLength(0);
    },
  );

  it.each([
    { status: "sent", language: "de", draft: "ENTWURF", cancellation: "STORNIERT" },
    { status: "sent", language: "en", draft: "DRAFT", cancellation: "CANCELLED" },
    { status: "paid", language: "de", draft: "ENTWURF", cancellation: "STORNIERT" },
    { status: "paid", language: "en", draft: "DRAFT", cancellation: "CANCELLED" },
  ] as const)(
    "keeps the finalized $status $language email attachment free of draft and cancellation watermarks",
    async ({ status, language, draft, cancellation }) => {
      stageDbForEmail(30, { ...INVOICE, status, language });

      const res = await request(app)
        .post(`/api/iroc/invoices/${INVOICE.id}/email`)
        .set("Authorization", AUTH)
        .send(EMAIL_BODY);

      expect(res.status).toBe(200);
      const attachment = mockSendEmail.mock.calls[0][0].attachments[0];
      const content = (attachment.content as Buffer).toString();

      expect(pdfState.watermarks).toEqual([]);
      expect(content).not.toContain(`watermark-${draft}`);
      expect(content).not.toContain(`watermark-${cancellation}`);
    },
  );

  // ── Attachment metadata ───────────────────────────────────────────────────

  it("sets the PDF attachment filename to invoiceNumber.pdf", async () => {
    stageDbForEmail(1);

    await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    const attachment = mockSendEmail.mock.calls[0][0].attachments[0];
    expect(attachment.filename).toBe(`${INVOICE.invoiceNumber}.pdf`);
    expect(attachment.contentType).toBe("application/pdf");
  });

  it("passes the correct recipient, subject, and body text to sendEmail", async () => {
    stageDbForEmail(2);

    const customPayload = {
      to:      "doctor@hospital.de",
      subject: "Rechnung Nr. 2026-0042",
      body:    "Sehr geehrte Damen und Herren, anbei Ihre Rechnung.",
    };

    await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(customPayload);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [call] = mockSendEmail.mock.calls;
    expect(call[0].to).toBe(customPayload.to);
    expect(call[0].subject).toBe(customPayload.subject);
    expect(call[0].text).toContain(customPayload.body);
    expect(call[0].text).toContain("iROC GmbH");
    expect(call[0].text).toContain("Telefon: +49 89 4625993 70");
    expect(call[0].text).toContain("E-Mail: info@i-roc.de");
    expect(call[0].text).toContain("Web: https://i-roc.de");
  });

  // ── Error paths ───────────────────────────────────────────────────────────

  it("returns 400 when required email fields are missing", async () => {
    stageDbForEmail(1);

    const res = await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
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

  it("returns 500 and does not crash when sendEmail rejects", async () => {
    stageDbForEmail(1);
    mockSendEmail.mockRejectedValueOnce(new Error("SMTP connection refused"));

    const res = await request(app)
      .post(`/api/iroc/invoices/${INVOICE.id}/email`)
      .set("Authorization", AUTH)
      .send(EMAIL_BODY);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/SMTP connection refused/);
  });
});
