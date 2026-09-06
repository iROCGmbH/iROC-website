/**
 * Integration test — a completed DATEV export is visible to the invoice list
 *
 * The "Already exported" badge is driven by GET /iroc/datev/exported-ids,
 * which must return the IDs stored by POST /export.
 *
 * This test exercises the real email-export route first, captures the invoice
 * IDs written to datev_export_items by its transaction, and then feeds that
 * persisted state into the badge endpoint. It also verifies that a normal
 * re-export is rejected while force=true deliberately creates a new export.
 *
 * vi.mock() factories are hoisted above ESM imports, so all mock state used by
 * them is created through vi.hoisted().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

const {
  mockSelect,
  mockUpdate,
  mockTransaction,
  mockSendEmail,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockTransaction: vi.fn(),
  mockSendEmail: vi.fn(),
}));

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
    widthOfString()  { return 10; }
    heightOfString() { return 10; }
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

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
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
    invoiceType: "invoiceType",
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
  const payload = { userId: 1, username: "admin", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

function selectChain(result: unknown[]) {
  const promise = Promise.resolve(result);
  const chain = {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    from: vi.fn(),
    where: vi.fn(),
    leftJoin: vi.fn(),
    innerJoin: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };

  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);

  return chain;
}

const WEBSITE_CUSTOMER = {
  id: 501,
  customerNr: "WC-501",
  salutation: "Frau",
  title: null,
  firstName: "Export",
  lastName: "Test",
  specialty: null,
  institutionName: "Export Test Clinic",
  institutionType: null,
  address: "Exportstraße 1",
  postalCode: "10115",
  city: "Berlin",
  country: "Deutschland",
  phone: null,
  fax: null,
  email: "export-test@example.com",
  website: null,
  referenceNumber: null,
  ustIdNr: null,
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

const INVOICES = [
  {
    id: 701,
    invoiceNumber: "INV-2026-0701",
    issueDate: "2026-08-12",
    total: "119.00",
    vatRate: "19.00",
  },
  {
    id: 702,
    invoiceNumber: "INV-2026-0702",
    issueDate: "2026-08-18",
    total: "238.00",
    vatRate: "19.00",
  },
] as const;

function makeInvoiceRow(invoice: (typeof INVOICES)[number]) {
  return {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceType: "domestic",
      issueDate: invoice.issueDate,
      vatRate: invoice.vatRate,
      total: invoice.total,
      vatAmount: "19.00",
      subtotal: invoice.total,
      status: "sent",
      customerId: null,
      websiteCustomerId: WEBSITE_CUSTOMER.id,
      dueDate: null,
      orderNumber: null,
      referenceNumber: null,
      shippingMethod: null,
      reasonForExport: null,
      termsOfDelivery: null,
      deliveryCosts: "0.00",
      insuranceCosts: "0.00",
      notes: null,
      vatNote: null,
      language: "de",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    wcFirstName: WEBSITE_CUSTOMER.firstName,
    wcLastName: WEBSITE_CUSTOMER.lastName,
    wcEmail: WEBSITE_CUSTOMER.email,
    wcUstIdNr: null,
    legacyName: null,
    legacyVatId: null,
  };
}

function makeLineItem(invoiceId: number, lineTotal: string) {
  return {
    id: invoiceId * 10,
    invoiceId,
    productId: null,
    productName: "iROC Instrument Kit",
    sku: null,
    description: null,
    lotNumber: null,
    hsCode: null,
    countryOfOrigin: null,
    weightKg: null,
    unitPrice: lineTotal,
    discountPercent: null,
    isDemo: false,
    quantity: 1,
    lineTotal,
  };
}

function installFakeDatevPersistence() {
  const exportItems: { exportId: number; invoiceId: number }[] = [];
  // Each email export builds its ZIP before the duplicate guard runs. The
  // preview download does too, then checks existing claims without creating
  // one. Supply reads for the initial export, blocked preview, forced preview,
  // rejected email retry, and forced email retry.
  const zipBuildResults: unknown[][] = Array.from({ length: 5 }, () => [
    INVOICES.map(makeInvoiceRow),
    [WEBSITE_CUSTOMER],
    [makeLineItem(INVOICES[0].id, INVOICES[0].total)],
    [WEBSITE_CUSTOMER],
    [makeLineItem(INVOICES[1].id, INVOICES[1].total)],
  ]).flat();

  mockSelect.mockImplementation((fields?: Record<string, unknown>) => {
    if (fields?.invoiceNumber === "invoiceNumber") {
      return selectChain(exportItems.map(({ invoiceId }) => ({
        invoiceId,
        invoiceNumber: INVOICES.find((invoice) => invoice.id === invoiceId)?.invoiceNumber,
      })));
    }
    // GET /exported-ids reads the rows actually written by the export
    // transaction, rather than a response staged specifically for this request.
    if (fields?.invoiceId === "invoiceId") {
      return selectChain(exportItems.map(({ invoiceId }) => ({ invoiceId })));
    }

    const next = zipBuildResults.shift();
    if (!next) {
      throw new Error("Unexpected DATEV database select");
    }
    return selectChain(next);
  });

  return exportItems;
}

describe("DATEV export → exported IDs round trip", () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockUpdate.mockReset();
    mockTransaction.mockReset();
    mockSendEmail.mockReset();
  });

  it("returns exported IDs, blocks a duplicate, and permits a forced re-export", async () => {
    const persistedExportItems = installFakeDatevPersistence();
    const createdExportIds: number[] = [];

    mockSendEmail.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
      let insertCall = 0;
      let exportId = 0;
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockImplementation(() => selectChain(
          persistedExportItems.map(({ invoiceId }) => ({
            invoiceId,
            invoiceNumber: INVOICES.find((invoice) => invoice.id === invoiceId)?.invoiceNumber,
          })),
        )),
        insert: vi.fn().mockImplementation(() => {
          insertCall += 1;

          if (insertCall === 1) {
            exportId = 9001 + createdExportIds.length;
            createdExportIds.push(exportId);
            return {
              values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: exportId }]),
              }),
            };
          }

          return {
            values: vi.fn().mockImplementation(
              (items: { invoiceId: number }[]) => {
                persistedExportItems.push(
                  ...items.map((item) => ({ exportId, invoiceId: item.invoiceId })),
                );
                return Promise.resolve([]);
              },
            ),
          };
        }),
      };

      await callback(tx);
    });

    const exportResponse = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds: INVOICES.map((invoice) => invoice.id),
        bookkeeperEmail: "buchhaltung@example.com",
      });

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body).toMatchObject({
      ok: true,
      exported: INVOICES.length,
      skipped: [],
    });
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(persistedExportItems.map((item) => item.invoiceId))
      .toEqual(INVOICES.map((invoice) => invoice.id));

    // A ZIP download is inspection-only, so it does not create a new export
    // record. It must still return the same 409 confirmation payload as email
    // export when the requested invoices were previously claimed.
    const downloadResponse = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({
        invoiceIds: INVOICES.map((invoice) => invoice.id),
      });

    expect(downloadResponse.status).toBe(409);
    expect(downloadResponse.body).toEqual({
      error: "already_exported",
      invoiceNumbers: INVOICES.map((invoice) => invoice.invoiceNumber),
    });
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(createdExportIds).toEqual([9001]);
    expect(persistedExportItems).toEqual(
      INVOICES.map((invoice) => ({ exportId: 9001, invoiceId: invoice.id })),
    );

    const forcedDownloadResponse = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({
        invoiceIds: INVOICES.map((invoice) => invoice.id),
        force: true,
      });

    expect(forcedDownloadResponse.status).toBe(200);
    expect(forcedDownloadResponse.headers["content-type"]).toMatch(/^application\/zip/);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(createdExportIds).toEqual([9001]);

    // The badge's source of truth must contain the IDs written by the export.
    const exportedIdsResponse = await request(app)
      .get("/api/iroc/datev/exported-ids")
      .set("Authorization", AUTH);

    expect(exportedIdsResponse.status).toBe(200);
    expect(exportedIdsResponse.body).toEqual({
      ids: INVOICES.map((invoice) => invoice.id),
    });

    const duplicateResponse = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds: INVOICES.map((invoice) => invoice.id),
        bookkeeperEmail: "buchhaltung@example.com",
      });

    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body).toEqual({
      error: "already_exported",
      invoiceNumbers: INVOICES.map((invoice) => invoice.invoiceNumber),
    });
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(createdExportIds).toEqual([9001]);

    const forcedResponse = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds: INVOICES.map((invoice) => invoice.id),
        bookkeeperEmail: "buchhaltung@example.com",
        force: true,
      });

    expect(forcedResponse.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(createdExportIds).toEqual([9001, 9002]);
    expect(persistedExportItems).toEqual([
      { exportId: 9001, invoiceId: INVOICES[0].id },
      { exportId: 9001, invoiceId: INVOICES[1].id },
      { exportId: 9002, invoiceId: INVOICES[0].id },
      { exportId: 9002, invoiceId: INVOICES[1].id },
    ]);
  });

  it("blocks a later export when a crash-left pending claim already includes its invoice", async () => {
    const pendingInvoice = INVOICES[0];
    const pendingExport = { id: 8801, status: "pending" as const };
    const pendingExportItems = [{ exportId: pendingExport.id, invoiceId: pendingInvoice.id }];

    // The ZIP is built before the claim check, so stage its three read queries.
    mockSelect
      .mockReturnValueOnce(selectChain([makeInvoiceRow(pendingInvoice)]))
      .mockReturnValueOnce(selectChain([WEBSITE_CUSTOMER]))
      .mockReturnValueOnce(selectChain([makeLineItem(pendingInvoice.id, pendingInvoice.total)]));

    const txInsert = vi.fn();
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
      await callback({
        execute: vi.fn().mockResolvedValue(undefined),
        // This row models the persisted datev_exports/status='pending' record
        // joined through datev_export_items after an API process crash.
        select: vi.fn().mockReturnValue(selectChain(
          pendingExportItems.map(({ invoiceId }) => ({
            invoiceId,
            invoiceNumber: invoiceId === pendingInvoice.id ? pendingInvoice.invoiceNumber : undefined,
          })),
        )),
        insert: txInsert,
      });
    });

    const response = await request(app)
      .post("/api/iroc/datev/export")
      .set("Authorization", AUTH)
      .send({
        invoiceIds: [pendingInvoice.id],
        bookkeeperEmail: "buchhaltung@example.com",
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "already_exported",
      invoiceNumbers: [pendingInvoice.invoiceNumber],
    });
    expect(txInsert).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});