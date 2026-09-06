/**
 * Confirmation test: POST /iroc/invoices/:id/email rejects unauthenticated callers.
 *
 * What & Why
 * ──────────
 * The route is guarded by requireIrocAuth, but a misconfigured middleware could
 * silently drop the guard and expose the SMTP-send path to unauthenticated callers.
 *
 * This test confirms:
 *
 *   1. A POST with no Authorization header receives a 401 response.
 *   2. A POST with a malformed token (not a valid HMAC-signed JWT) receives a 401.
 *   3. sendEmail is never called in either case — the handler never runs.
 *
 * Strategy
 * ────────
 * Follows the mock pattern from invoice-email-multipage.test.ts.
 * The db mocks are wired up but never reached — we assert sendEmail is NOT called,
 * which is evidence the handler body was never entered.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import * as crypto from "crypto";

// ── Hoist mock-factory state ───────────────────────────────────────────────────
const { pdfState, mockSendEmail, mockDbSelect } = vi.hoisted(() => {
  const pdfState = { capturedText: [] as string[] };
  const mockSendEmail = vi.fn().mockResolvedValue(undefined);
  const mockDbSelect  = vi.fn();
  return { pdfState, mockSendEmail, mockDbSelect };
});

// ── Mock pdfkit (unused in auth-rejected paths, but required for module load) ──
vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");

  class MockPDFDocument extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y    = 0;
    constructor(_opts?: unknown) { super(); this.push(Buffer.from("page-0")); }
    addPage()        { return this; }
    bufferedPageRange() { return { start: 0, count: 1 }; }
    switchToPage()   { return this; }
    text(str: string) {
      if (typeof str === "string") pdfState.capturedText.push(str);
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
    heightOfString() { return 10; }
    widthOfString()  { return 10; }
    flushPages()     { return this; }
    end(cb?: () => void) { super.end(cb); return this; }
  }

  return { default: MockPDFDocument };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INVOICE_ID = 42;

const EMAIL_BODY = {
  to:      "patient@example.com",
  subject: "Ihre Rechnung 2026-0042",
  body:    "Bitte finden Sie Ihre Rechnung im Anhang.",
};

const NON_EU_GERMAN_INVOICE = {
  id:                43,
  invoiceNumber:     "2026-0043",
  invoiceType:       "noneu",
  language:          "de",
  issueDate:         "2026-08-28",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  websiteCustomerId: null,
  customerId:        7,
  status:            "final",
  subtotal:          "100.00",
  vatRate:           "0.00",
  vatAmount:         "0.00",
  total:             "100.00",
  deliveryCosts:     "0.00",
  insuranceCosts:    "0.00",
  notes:             null,
  vatNote:           null,
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

const NON_EU_ENGLISH_INVOICE = {
  ...NON_EU_GERMAN_INVOICE,
  id:                44,
  invoiceNumber:     "2026-0044",
  language:          "en",
};

const CUSTOMER = {
  id:              7,
  customerNr:      "C-007",
  salutation:      "Herr",
  title:           null,
  firstName:       "Max",
  lastName:        "Mustermann",
  name:            "Max Mustermann",
  company:         null,
  vatId:           null,
  institutionName: null,
  specialty:       null,
  institutionType: null,
  address:         "Musterstr. 1",
  postalCode:      "80331",
  city:            "München",
  country:         "Germany",
  phone:           null,
  fax:             null,
  email:           "patient@example.com",
  website:         null,
  referenceNumber: null,
  ustIdNr:         null,
  notes:           null,
  createdAt:       new Date(),
};

const ITEM = {
  id:              1,
  invoiceId:       NON_EU_GERMAN_INVOICE.id,
  productId:       null,
  productName:     "Test product",
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
};

const ENGLISH_ITEM = {
  ...ITEM,
  invoiceId: NON_EU_ENGLISH_INVOICE.id,
};

function selectChain(result: unknown[]) {
  const promise = Promise.resolve(result);
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/invoices/:id/email — auth guard", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    mockDbSelect.mockReset();
    mockSendEmail.mockReset();
    mockSendEmail.mockResolvedValue(undefined);
  });

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app)
      .post(`/api/iroc/invoices/${INVOICE_ID}/email`)
      .send(EMAIL_BODY);

    expect(res.status).toBe(401);
  });

  it("does not call sendEmail when no Authorization header is provided", async () => {
    await request(app)
      .post(`/api/iroc/invoices/${INVOICE_ID}/email`)
      .send(EMAIL_BODY);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header carries a malformed token", async () => {
    const res = await request(app)
      .post(`/api/iroc/invoices/${INVOICE_ID}/email`)
      .set("Authorization", "Bearer this.is.not.a.valid.token")
      .send(EMAIL_BODY);

    expect(res.status).toBe(401);
  });

  it("does not call sendEmail when a malformed token is supplied", async () => {
    await request(app)
      .post(`/api/iroc/invoices/${INVOICE_ID}/email`)
      .set("Authorization", "Bearer this.is.not.a.valid.token")
      .send(EMAIL_BODY);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 401 for a token signed with the wrong secret", async () => {
    // Build a structurally valid token but signed with a different secret.
    const crypto = await import("crypto");
    const payload = { userId: 1, username: "admin" };
    const data    = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig     = crypto.createHmac("sha256", "wrong-secret").update(data).digest("base64url");
    const badToken = `Bearer ${data}.${sig}`;

    const res = await request(app)
      .post(`/api/iroc/invoices/${INVOICE_ID}/email`)
      .set("Authorization", badToken)
      .send(EMAIL_BODY);

    expect(res.status).toBe(401);
  });

  it("does not call sendEmail when the token is signed with the wrong secret", async () => {
    const crypto = await import("crypto");
    const payload = { userId: 1, username: "admin" };
    const data    = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig     = crypto.createHmac("sha256", "wrong-secret").update(data).digest("base64url");
    const badToken = `Bearer ${data}.${sig}`;

    await request(app)
      .post(`/api/iroc/invoices/${INVOICE_ID}/email`)
      .set("Authorization", badToken)
      .send(EMAIL_BODY);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends a German plain non-EU invoice with the Umsatzsteuer** PDF label", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([NON_EU_GERMAN_INVOICE]))
      .mockReturnValueOnce(selectChain([CUSTOMER]))
      .mockReturnValueOnce(selectChain([ITEM]));

    const res = await request(app)
      .post(`/api/iroc/invoices/${NON_EU_GERMAN_INVOICE.id}/email`)
      .set("Authorization", `Bearer ${makeIrocToken()}`)
      .send({
        ...EMAIL_BODY,
        subject: "Ihre Rechnung 2026-0043",
      });

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: EMAIL_BODY.to,
      mailboxPurpose: "invoice",
    }));
    expect(pdfState.capturedText).toContain("Umsatzsteuer**");
    expect(pdfState.capturedText).not.toContain("VAT**");

    const attachment = mockSendEmail.mock.calls[0][0].attachments[0];
    expect(Buffer.isBuffer(attachment.content)).toBe(true);
    expect((attachment.content as Buffer).length).toBeGreaterThan(0);
  });

  it("sends an English plain non-EU invoice with the VAT** PDF label", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([NON_EU_ENGLISH_INVOICE]))
      .mockReturnValueOnce(selectChain([CUSTOMER]))
      .mockReturnValueOnce(selectChain([ENGLISH_ITEM]));

    const res = await request(app)
      .post(`/api/iroc/invoices/${NON_EU_ENGLISH_INVOICE.id}/email`)
      .set("Authorization", `Bearer ${makeIrocToken()}`)
      .send({
        ...EMAIL_BODY,
        subject: "Your invoice 2026-0044",
      });

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: EMAIL_BODY.to,
      mailboxPurpose: "invoice",
    }));
    expect(pdfState.capturedText).toContain("VAT**");
    expect(pdfState.capturedText).not.toContain("Umsatzsteuer**");

    const attachment = mockSendEmail.mock.calls[0][0].attachments[0];
    expect(Buffer.isBuffer(attachment.content)).toBe(true);
    expect((attachment.content as Buffer).length).toBeGreaterThan(0);
  });
});
