/**
 * Integration test for POST /iroc/datev/export — exemption reason in emailed ZIP
 *
 * Captures the ZIP passed to sendEmail and validates document_data.xml, proving
 * the export-to-bookkeeper path preserves the optional DATEV exemption reason.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import JSZip from "jszip";

const { mockSelect, mockSendEmail, mockTransaction, mockUpdate } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockSendEmail: vi.fn(),
  mockTransaction: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");

  class MockPDFDocument extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;

    font() { return this; }
    fontSize() { return this; }
    fillColor() { return this; }
    strokeColor() { return this; }
    lineWidth() { return this; }
    save() { return this; }
    restore() { return this; }
    addPage() { return this; }
    image() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    rect() { return this; }
    clip() { return this; }
    stroke() { return this; }
    fill() { return this; }
    text() { return this; }
    heightOfString() { return 10; }
    widthOfString() { return 10; }
    rotate() { return this; }
    opacity() { return this; }
    switchToPage() { return this; }
    flushPages() { return this; }
    bufferedPageRange() { return { start: 0, count: 1 }; }

    end(cb?: () => void) {
      this.push(Buffer.from("PDF stub"));
      super.end(cb);
      return this;
    }
  }

  return { default: MockPDFDocument };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: mockUpdate,
    transaction: mockTransaction,
    execute: vi.fn().mockResolvedValue(undefined),
  },
  irocInvoices: {
    id: "id",
    invoiceNumber: "invoiceNumber",
    issueDate: "issueDate",
    vatRate: "vatRate",
    total: "total",
    websiteCustomerId: "websiteCustomerId",
    customerId: "customerId",
    status: "status",
  },
  irocInvoiceItems: { invoiceId: "invoiceId", id: "id" },
  irocCustomers: { id: "id" },
  websiteCustomersTable: { id: "id" },
  settingsTable: { key: "key" },
  datevExports: { id: "id", status: "status" },
  datevExportItems: { exportId: "exportId", invoiceId: "invoiceId" },
  irocAppUsers: {},
  irocNotifications: {},
  irocProducts: {},
  irocInventoryLots: {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable: {},
}));

vi.mock("../lib/email", () => ({
  sendEmail: mockSendEmail,
}));

import app from "../app";

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const data = Buffer.from(JSON.stringify({ userId: 1, username: "admin", exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

function selectChain(result: unknown[]) {
  const promise = Promise.resolve(result);
  type AnyFn = ReturnType<typeof vi.fn>;
  interface Chain {
    from: AnyFn;
    where: AnyFn;
    leftJoin: AnyFn;
    innerJoin: AnyFn;
    orderBy: AnyFn;
    limit: AnyFn;
    then: typeof promise.then;
    catch: typeof promise.catch;
    finally: typeof promise.finally;
  }
  const chain = {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  } as unknown as Chain;

  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.leftJoin = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  return chain;
}

const customer = {
  id: 10,
  customerNr: "WC-010",
  salutation: "Frau",
  title: null,
  firstName: "EU",
  lastName: "Clinic",
  specialty: null,
  institutionName: "EU Clinic GmbH",
  institutionType: null,
  address: "Europastraße 1",
  postalCode: "10001",
  city: "Berlin",
  country: "Deutschland",
  phone: null,
  fax: null,
  email: "clinic@eu-example.com",
  website: null,
  referenceNumber: null,
  ustIdNr: "DE123456789",
  instrument: "iroc",
  notes: null,
  privacyConsent: true,
  shippingFirstName: null,
  shippingLastName: null,
  shippingInstitutionName: null,
  shippingAddress: null,
  shippingPostalCode: null,
  shippingCity: null,
  shippingCountry: null,
  shippingPhone: null,
  shippingEmail: null,
  createdAt: new Date(),
};

const invoice = {
  id: 1,
  invoiceNumber: "2026-EU-001",
  issueDate: "2026-03-15",
  vatRate: "0.00",
  total: "500.00",
};

function stageInvoiceSelects() {
  const joinedRow = {
    invoice: {
      ...invoice,
      invoiceType: "eu",
      vatAmount: "0.00",
      subtotal: invoice.total,
      status: "sent",
      customerId: null,
      websiteCustomerId: customer.id,
      dueDate: null,
      orderNumber: null,
      referenceNumber: null,
      shippingMethod: null,
      reasonForExport: null,
      termsOfDelivery: null,
      deliveryCosts: "0.00",
      notes: null,
      vatNote: null,
      language: "de",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    wcFirstName: customer.firstName,
    wcLastName: customer.lastName,
    wcEmail: customer.email,
    wcUstIdNr: customer.ustIdNr,
    legacyName: null,
    legacyVatId: null,
  };
  const lineItem = {
    id: 10,
    invoiceId: invoice.id,
    productId: null,
    productName: "Spirecut® Kit",
    quantity: 1,
    unitPrice: "500.00",
    lineTotal: "500.00",
    discount: "0.00",
    notes: null,
  };

  mockSelect
    .mockReturnValueOnce(selectChain([joinedRow]))
    .mockReturnValueOnce(selectChain([customer]))
    .mockReturnValueOnce(selectChain([lineItem]));
}

function stageSuccessfulExport() {
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
    let insertCount = 0;
    await callback({
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockReturnValue(selectChain([])),
      insert: vi.fn().mockImplementation(() => {
        insertCount += 1;
        return insertCount === 1
          ? { values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 77 }]) }) }
          : { values: vi.fn().mockResolvedValue([]) };
      }),
    });
  });
  mockUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 77, status: "sent" }]),
      }),
    }),
  });
  mockSendEmail.mockResolvedValue({ messageId: "test-message" });
}

async function exportAndReadXml(exemptionReasons?: Record<number, string>): Promise<string> {
  stageInvoiceSelects();
  stageSuccessfulExport();

  const response = await request(app)
    .post("/api/iroc/datev/export")
    .set("Authorization", AUTH)
    .send({
      invoiceIds: [invoice.id],
      bookkeeperEmail: "bookkeeper@example.com",
      ...(exemptionReasons === undefined ? {} : { exemptionReasons }),
    });

  expect(response.status).toBe(200);
  expect(mockSendEmail).toHaveBeenCalledOnce();

  const email = mockSendEmail.mock.calls[0]?.[0] as {
    to: string;
    mailboxPurpose: string;
    attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
  };
  expect(email).toMatchObject({
    to: "bookkeeper@example.com",
    mailboxPurpose: "datev",
  });
  expect(email.attachments).toHaveLength(1);
  expect(email.attachments[0]?.filename).toMatch(/^DATEV_Export_.*\.zip$/);
  expect(email.attachments[0]?.contentType).toBe("application/zip");

  const zip = await JSZip.loadAsync(email.attachments[0]!.content);
  const xmlFile = zip.file("document_data.xml");
  expect(xmlFile).not.toBeNull();
  return xmlFile!.async("string");
}

describe("POST /iroc/datev/export — exemption reason propagation into emailed ZIP", () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockSendEmail.mockReset();
    mockTransaction.mockReset();
    mockUpdate.mockReset();
  });

  it("includes <taxExemptionReason> with the submitted value in the emailed document_data.xml", async () => {
    const reason = "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)";

    const xml = await exportAndReadXml({ [invoice.id]: reason });

    expect(xml).toContain("<taxExemptionReason>");
    expect(xml).toContain(reason);
  });

  it("returns validation details and does not email XML when no map is submitted", async () => {
    stageInvoiceSelects();

    const response = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds: [invoice.id],
        bookkeeperEmail: "bookkeeper@example.com",
      });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: "Validation failed",
      details: [expect.stringContaining("0 % VAT invoices require a DATEV exemption reason.")],
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});