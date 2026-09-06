/**
 * Confirmation test: the invoice preview endpoint produces a real PDF whose
 * draft watermark is visible and rotated, rather than only calling a mocked
 * PDFKit `.text()` method.
 *
 * The PDFKit renderer and Factur-X post-processing are both real.  Only the
 * database and authentication boundaries are mocked, and the returned bytes
 * are parsed as a PDF after XML embedding.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import zlib from "node:zlib";
import pdfParse from "pdf-parse";
import {
  PDFArray,
  PDFDocument as PdfLibDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";

const {
  mockDbSelect,
  mockDbUpdate,
  mockDbDelete,
  mockDbInsert,
} = vi.hoisted(() => {
  const mockDbSelect = vi.fn();
  const updateReturning = vi.fn();
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: updateSet });
  const mockDbDelete = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
  });
  const mockDbInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue([]),
  });
  return { mockDbSelect, mockDbUpdate, mockDbDelete, mockDbInsert };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
  },
  irocInvoices: {},
  irocInvoiceItems: {},
  irocCustomers: {},
  websiteCustomersTable: {},
  irocAppUsers: {},
  irocNotifications: {},
  settingsTable: {},
  irocProducts: {},
  irocInventoryLots: {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable: {},
}));

import app from "../app";

const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${signature}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;
const URL = "/api/iroc/invoices/42/pdf";

const customer = {
  id: 7,
  customerNr: "WC-007",
  salutation: "Frau",
  title: null,
  firstName: "Anna",
  lastName: "Beispiel",
  institutionName: null,
  specialty: null,
  institutionType: null,
  address: "Musterstr. 1",
  postalCode: "10001",
  city: "Berlin",
  country: "Deutschland",
  phone: null,
  fax: null,
  email: "anna@example.com",
  website: null,
  referenceNumber: null,
  ustIdNr: null,
  instrument: "iroc",
  notes: null,
  privacyConsent: true,
  isEu: false,
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

function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    invoiceNumber: "2026-0042",
    invoiceType: "domestic",
    language: "de",
    issueDate: "2026-08-07",
    dueDate: null,
    orderNumber: null,
    referenceNumber: null,
    shippingMethod: null,
    reasonForExport: null,
    termsOfDelivery: null,
    websiteCustomerId: customer.id,
    customerId: null,
    status: "draft",
    subtotal: "100.00",
    vatRate: "19.00",
    vatAmount: "19.00",
    total: "119.00",
    deliveryCosts: "0.00",
    notes: null,
    vatNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const items = [{
  id: 1,
  invoiceId: 42,
  productId: null,
  productName: "Product 1",
  sku: null,
  description: null,
  lotNumber: null,
  hsCode: null,
  countryOfOrigin: null,
  weightKg: null,
  unitPrice: "100.00",
  discountPercent: null,
  vatRate: "19.00",
  isDemo: false,
  quantity: 1,
  lineTotal: "100.00",
}];

function buildItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...items[0],
    id: index + 1,
    productName: `Product ${index + 1}`,
  }));
}

function selectChain(result: unknown[]) {
  const promise = Promise.resolve(result);
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    leftJoin: vi.fn(),
    innerJoin: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  for (const method of ["from", "where", "leftJoin", "innerJoin", "orderBy"]) {
    chain[method as keyof typeof chain] = vi.fn().mockReturnValue(chain) as never;
  }
  chain.limit = vi.fn().mockResolvedValue(result);
  return chain;
}

function stageDb(
  invoice: ReturnType<typeof buildInvoice>,
  invoiceItems = items,
) {
  mockDbSelect
    .mockReturnValueOnce(selectChain([invoice]))
    .mockReturnValueOnce(selectChain([customer]))
    .mockReturnValueOnce(selectChain(invoiceItems))
    .mockReturnValueOnce(selectChain([])); // invoice contact settings
}

type PdfTextPage = {
  getTextContent: (options: Record<string, boolean>) => Promise<{
    items: Array<{ str: string }>;
  }>;
};

async function extractedPageText(pdf: Buffer): Promise<string[]> {
  const pages: string[] = [];
  const parsed = await pdfParse(pdf, {
    pagerender: async (page: PdfTextPage) => {
      const content = await page.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      const text = content.items.map(item => item.str).join(" ");
      pages.push(text);
      return text;
    },
  });
  expect(pages).toHaveLength(parsed.numpages);
  return pages;
}

async function pageContentStreams(pdf: Buffer): Promise<string[]> {
  const document = await PdfLibDocument.load(pdf);
  return document.getPages().map(page => {
    const contents = page.node.lookup(PDFName.of("Contents"));
    if (!contents) return "";

    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    return streams
      .map(stream => {
        const rawStream = document.context.lookup(stream) as PDFRawStream;
        return Buffer.from(decodePDFRawStream(rawStream).decode()).toString("latin1");
      })
      .join("\n");
  });
}

/**
 * PDFKit compresses page content with FlateDecode.  Decode the streams so the
 * test can verify the actual text operator and the rotation matrix emitted by
 * the real renderer.
 */
function decodedContent(pdf: Buffer): string {
  const streams: string[] = [];
  const marker = Buffer.from("stream");
  const endMarker = Buffer.from("endstream");
  let offset = 0;

  while (true) {
    const streamAt = pdf.indexOf(marker, offset);
    if (streamAt < 0) break;
    let contentStart = streamAt + marker.length;
    while (pdf[contentStart] === 0x0a || pdf[contentStart] === 0x0d) contentStart++;
    const contentEnd = pdf.indexOf(endMarker, contentStart);
    if (contentEnd < 0) break;
    try {
      streams.push(zlib.inflateSync(pdf.subarray(contentStart, contentEnd)).toString("latin1"));
    } catch {
      // Font and metadata streams are not page content and may use a
      // different encoding.  Ignore those while looking for page operators.
    }
    offset = contentEnd + endMarker.length;
  }
  return streams.join("\n");
}

async function getInvoicePdf(
  invoice: ReturnType<typeof buildInvoice>,
  invoiceItems = items,
): Promise<Buffer> {
  stageDb(invoice, invoiceItems);
  const response = await request(app).get(URL).set("Authorization", AUTH);
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toMatch(/pdf/);
  return Buffer.from(response.body);
}

describe("GET /iroc/invoices/:id/pdf — real draft watermark rendering", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
  });

  it.each([
    { language: "de", watermark: "ENTWURF" },
    { language: "en", watermark: "DRAFT" },
  ])("renders a visible $watermark watermark at -38°", async ({ language, watermark }) => {
    const pdf = await getInvoicePdf(buildInvoice({ language, status: "draft" }));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const parsed = await pdfParse(pdf);
    expect(parsed.text).toContain(watermark);

    const content = decodedContent(pdf);
    // The embedded DejaVu font uses four-digit CID glyph codes, so the
    // extracted text above is the reliable label assertion.  This operator
    // assertion confirms the large watermark text was emitted by real PDFKit.
    expect(content).toMatch(/52 Tf\s*\[[\s\S]*?\]\s*TJ/);

    // PDFKit's page-coordinate matrix for rotate(-38) is:
    // cos(38°), -sin(38°), sin(38°), cos(38°).
    expect(content).toMatch(
      /0\.788011\s+-0\.615661\s+0\.615661\s+0\.788011\s+-?[\d.]+\s+-?[\d.]+\s+cm/,
    );
  });

  it("prevents browser and proxy caches from serving an outdated regenerated PDF", async () => {
    stageDb(buildInvoice({ language: "de", status: "sent" }), items);

    const response = await request(app).get(URL).set("Authorization", AUTH);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/pdf/);
    expect(response.headers["cache-control"]).toBe(
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    expect(response.headers["pragma"]).toBe("no-cache");
    expect(response.headers["expires"]).toBe("0");
  });

  it.each([
    { language: "de", watermark: "ENTWURF" },
    { language: "en", watermark: "DRAFT" },
  ])("keeps the $watermark watermark and diagonal matrix on every page of a real multi-page hybrid invoice", async ({
    language,
    watermark,
  }) => {
    const pageItemCount = 48;
    const subtotal = (pageItemCount * 100).toFixed(2);
    const vatAmount = (pageItemCount * 19).toFixed(2);
    const total = (pageItemCount * 119).toFixed(2);

    const pdf = await getInvoicePdf(
      buildInvoice({ language, status: "draft", subtotal, vatAmount, total }),
      buildItems(pageItemCount),
    );
    const parsed = await pdfParse(pdf);
    const pageTexts = await extractedPageText(pdf);
    const pageStreams = await pageContentStreams(pdf);

    expect(parsed.numpages).toBeGreaterThan(1);
    expect(pageTexts).toHaveLength(parsed.numpages);
    expect(pageTexts.every(text => text.includes(watermark))).toBe(true);
    expect(pageStreams).toHaveLength(parsed.numpages);

    for (const stream of pageStreams) {
      expect(stream).toMatch(
        /0\.788011\s+-0\.615661\s+0\.615661\s+0\.788011\s+-?[\d.]+\s+-?[\d.]+\s+cm/,
      );
    }
  });

  it.each([
    { status: "sent", language: "de", draftWatermark: "ENTWURF", cancellationWatermark: "STORNIERT" },
    { status: "paid", language: "de", draftWatermark: "ENTWURF", cancellationWatermark: "STORNIERT" },
    { status: "sent", language: "en", draftWatermark: "DRAFT", cancellationWatermark: "CANCELLED" },
    { status: "paid", language: "en", draftWatermark: "DRAFT", cancellationWatermark: "CANCELLED" },
  ] as const)(
    "does not include draft or cancellation watermarks for a $language $status invoice",
    async ({ status, language, draftWatermark, cancellationWatermark }) => {
      const pdf = await getInvoicePdf(buildInvoice({ status, language }));
      const parsed = await pdfParse(pdf);

      expect(parsed.text).not.toContain(draftWatermark);
      expect(parsed.text).not.toContain(cancellationWatermark);
    },
  );
});