/**
 * Integration test for POST /iroc/datev/download — exemptionReason in XML
 *
 * What & Why
 * ──────────
 * The unit tests in datev-xml.test.ts verify that buildDatevXml emits
 * <taxExemptionReason> when the field is set on the invoice object.  But that
 * alone does not prove the value chosen in the admin UI actually flows through
 * the HTTP route all the way into the generated document_data.xml inside the
 * ZIP.
 *
 * These tests treat the route as a black box:
 *   • POST the request body (invoiceIds + exemptionReasons map)
 *   • Receive the ZIP response
 *   • Unzip the buffer and read document_data.xml
 *   • Assert on the XML content
 *
 * Test 1 — reason present: exemptionReasons map provided
 *   A 0 % VAT invoice is exported with exemptionReasons: { [id]: "reason" }.
 *   The document_data.xml inside the ZIP must contain a <taxExemptionReason>
 *   element whose text content matches the supplied reason.
 *
 * Test 2 — reason absent: no exemptionReasons map provided
 *   The same invoice exported without an exemptionReasons map must NOT contain
 *   a <taxExemptionReason> element anywhere in the XML.
 *
 * Test 3 — reason absent for non-zero VAT invoice even when map is provided
 *   A 19 % VAT invoice included in the exemptionReasons map must NOT emit
 *   <taxExemptionReason>; the element is only valid for 0 % invoices.
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
import { extractXml } from "@stackforge-eu/factur-x";
import pdfParse from "pdf-parse";
import {
  PDFArray,
  PDFDocument as PdfLibDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";

// ── Hoist mock-factory state ──────────────────────────────────────────────────

const { mockSelect, mockPoolQuery } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockPoolQuery: vi.fn(),
}));

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery },
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

/** Shared website customer used by the test invoices. */
const WC = {
  id:                      10,
  customerNr:              "WC-010",
  salutation:              "Frau",
  title:                   null,
  firstName:               "EU",
  lastName:                "Clinic",
  specialty:               null,
  institutionName:         "EU Clinic GmbH",
  institutionType:         null,
  address:                 "Europastraße 1",
  postalCode:              "10001",
  city:                    "Berlin",
  country:                 "Deutschland",
  phone:                   null,
  fax:                     null,
  email:                   "clinic@eu-example.com",
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
    productName: "Spirecut® Kit",
    quantity:    1,
    unitPrice:   lineTotal,
    lineTotal,
    vatRate:     null,
    discount:    "0.00",
    notes:       null,
  };
}

/**
 * The initial batch query in buildDatevZip returns rows that contain both the
 * invoice columns and the join columns from websiteCustomersTable /
 * irocCustomers.
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
      invoiceType:       Number(invoice.vatRate) === 0 ? "eu" : "domestic",
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
    wcUstIdNr:   WC.ustIdNr,
    legacyName:  null,
    legacyVatId: null,
  };
}

/** Invoice with 0 % VAT — EU / export scenario. */
const EU_INV = { id: 1, invoiceNumber: "2026-EU-001", issueDate: "2026-03-15", vatRate: "0.00", total: "500.00" };

/** Invoice with 19 % VAT — standard domestic scenario. */
const DE_INV = { id: 2, invoiceNumber: "2026-DE-042", issueDate: "2026-03-20", vatRate: "19.00", total: "1190.00" };

/**
 * Stage the three sequential db.select() calls that buildDatevZip makes for a
 * single invoice:
 *   call 1 — initial joined invoice fetch
 *   call 2 — website customer lookup
 *   call 3 — line items
 */
function stageSelectsForOneInvoice(
  inv: typeof EU_INV,
  lineTotal: string,
) {
  mockSelect
    .mockReturnValueOnce(selectChain([makeJoinedRow(inv)]))
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain([makeItem(inv.id, lineTotal)]));
}

/**
 * Stage the five sequential db.select() calls that buildDatevZip makes for two
 * invoices:
 *   call 1 — initial joined invoice fetch (both rows)
 *   calls 2–3 — customer + items for inv1
 *   calls 4–5 — customer + items for inv2
 */
function stageSelectsForTwoInvoices(
  inv1: typeof EU_INV,
  lineTotal1: string,
  inv2: typeof DE_INV,
  lineTotal2: string,
) {
  mockSelect
    .mockReturnValueOnce(selectChain([makeJoinedRow(inv1), makeJoinedRow(inv2)]))
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain([makeItem(inv1.id, lineTotal1)]))
    .mockReturnValueOnce(selectChain([WC]))
    .mockReturnValueOnce(selectChain([makeItem(inv2.id, lineTotal2)]));
}

/** Download and parse the ZIP returned by the preview endpoint. */
async function downloadZip(
  invoiceIds: number[],
  exemptionReasons?: Record<number, string>,
): Promise<JSZip> {
  // The preview route checks for existing email-export claims after its three
  // invoice/customer/item lookups.
  mockSelect.mockReturnValueOnce(selectChain([]));

  const res = await request(app)
    .post("/api/iroc/datev/download")
    .set("Authorization", AUTH)
    .send({ invoiceIds, ...(exemptionReasons !== undefined ? { exemptionReasons } : {}) })
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });

  expect(res.status).toBe(200);
  return JSZip.loadAsync(res.body as Buffer);
}

/** Download the ZIP and return the document_data.xml content as a string. */
async function downloadAndReadXml(
  invoiceIds: number[],
  exemptionReasons?: Record<number, string>,
): Promise<string> {
  const zip = await downloadZip(invoiceIds, exemptionReasons);
  const xmlFile = zip.file("document_data.xml");
  expect(xmlFile).not.toBeNull();
  return xmlFile!.async("string");
}

type PdfTextPage = {
  getTextContent: (options: Record<string, boolean>) => Promise<{ items: Array<{ str: string }> }>;
};

async function extractedPageText(pdf: Buffer): Promise<string[]> {
  const pages: string[] = [];
  await pdfParse(pdf, {
    pagerender: async (page: PdfTextPage) => {
      const text = (await page.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      })).items.map(item => item.str).join(" ");
      pages.push(text);
      return text;
    },
  });
  return pages;
}

async function pageContentStreams(pdf: Buffer): Promise<string[]> {
  const document = await PdfLibDocument.load(pdf);
  return document.getPages().map(page => {
    const contents = page.node.lookup(PDFName.of("Contents"));
    const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    return streams.map(stream =>
      Buffer.from(decodePDFRawStream(document.context.lookup(stream) as PDFRawStream).decode()).toString("latin1"),
    ).join("\n");
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /iroc/datev/download — exemptionReason propagation into document_data.xml", () => {

  beforeEach(() => {
    mockSelect.mockReset();
    mockPoolQuery.mockReset();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it("uses configured invoice contact details for every archive PDF with one settings query", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        { key: "invoice_contact_email", value: "accounts@example.test" },
        { key: "invoice_contact_phone", value: "+49 89 123456" },
      ],
    });
    stageSelectsForOneInvoice(DE_INV, "1000.00");

    const zip = await downloadZip([DE_INV.id]);
    const pdf = await zip.file(`${DE_INV.invoiceNumber}.pdf`)!.async("nodebuffer");
    const parsed = await pdfParse(pdf);

    expect(mockPoolQuery).toHaveBeenCalledOnce();
    expect(parsed.text).toContain("accounts@example.test");
    expect(parsed.text).toContain("+49 89 123456");
  });

  it("keeps the draft watermark on every page of the packaged DATEV invoice PDF", async () => {
    const draft = makeJoinedRow(DE_INV);
    draft.invoice = {
      ...draft.invoice,
      status: "draft",
      subtotal: "4800.00",
      vatAmount: "912.00",
      total: "5712.00",
    };
    const manyItems = Array.from({ length: 48 }, (_, index) => ({
      ...makeItem(DE_INV.id, "100.00"),
      id: index + 1,
      productName: `DATEV archive line ${index + 1}`,
    }));
    mockSelect
      .mockReturnValueOnce(selectChain([draft]))
      .mockReturnValueOnce(selectChain([WC]))
      .mockReturnValueOnce(selectChain(manyItems))
      .mockReturnValueOnce(selectChain([]));

    const zip = await downloadZip([DE_INV.id]);
    const pdf = await zip.file(`${DE_INV.invoiceNumber}.pdf`)!.async("nodebuffer");
    const pageTexts = await extractedPageText(pdf);
    const streams = await pageContentStreams(pdf);

    expect(pageTexts.length).toBeGreaterThan(1);
    expect(pageTexts.every(text => text.includes("ENTWURF"))).toBe(true);
    expect(streams).toHaveLength(pageTexts.length);
    for (const stream of streams) {
      expect(stream).toMatch(
        /0\.788011\s+-0\.615661\s+0\.615661\s+0\.788011\s+-?[\d.]+\s+-?[\d.]+\s+cm/,
      );
    }
  });

  it("puts an EN16931 Factur-X PDF/A invoice in the DATEV ZIP", async () => {
    const reason = "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)";
    stageSelectsForOneInvoice(EU_INV, "500.00");

    const zip = await downloadZip([EU_INV.id], { [EU_INV.id]: reason });
    const invoiceFile = zip.file(`${EU_INV.invoiceNumber}.pdf`);
    expect(invoiceFile).not.toBeNull();

    const pdf = await invoiceFile!.async("nodebuffer");
    const extracted = await extractXml(pdf);
    expect(extracted).toMatchObject({
      filename: "factur-x.xml",
      profile: "EN16931",
    });
    expect(extracted.xml).toContain(EU_INV.invoiceNumber);
    expect(pdf.toString("latin1")).toContain("pdfaid:part");
  });

  it("returns 422 rather than exporting a visual-only PDF for an incomplete customer", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([makeJoinedRow(DE_INV)]))
      .mockReturnValueOnce(selectChain([{ ...WC, address: null }]))
      .mockReturnValueOnce(selectChain([makeItem(DE_INV.id, "1000.00")]));

    const response = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [DE_INV.id] });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: "Invoice compliance validation failed",
      details: [
        expect.stringContaining(
          "Customer name, street address, city, postal code, and country are required for EN 16931",
        ),
      ],
    });
  });

  // ── Test 1: exemptionReason present in XML when map is supplied ────────────

  it("emits <taxExemptionReason> in document_data.xml when exemptionReasons map is provided for a 0 % VAT invoice", async () => {
    const reason = "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)";

    stageSelectsForOneInvoice(EU_INV, "500.00");

    const xml = await downloadAndReadXml(
      [EU_INV.id],
      { [EU_INV.id]: reason },
    );

    expect(xml).toContain("<taxExemptionReason>");
    expect(xml).toContain(reason);

    // Must appear inside an <invoiceLineItem> block, not floating at document level.
    const lineItemBlock = xml.match(/<invoiceLineItem>[\s\S]*?<\/invoiceLineItem>/)?.[0] ?? "";
    expect(lineItemBlock).toContain("<taxExemptionReason>");
    expect(lineItemBlock).toContain(reason);
  });

  // ── Test 2: a missing reason is rejected before XML is built ──────────────

  it("returns validation details instead of building XML when exemptionReasons map is omitted", async () => {
    stageSelectsForOneInvoice(EU_INV, "500.00");

    const response = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [EU_INV.id] });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: "Validation failed",
      details: [expect.stringContaining("0 % VAT invoices require a DATEV exemption reason.")],
    });
  });

  // ── Test 3: element absent for non-zero VAT even when map provides a value ─

  it("does NOT emit <taxExemptionReason> for a 19 % VAT invoice even when the exemptionReasons map includes its id", async () => {
    stageSelectsForOneInvoice(DE_INV, "1000.00");

    const xml = await downloadAndReadXml(
      [DE_INV.id],
      { [DE_INV.id]: "Should not appear" },
    );

    expect(xml).not.toContain("<taxExemptionReason>");
    expect(xml).not.toContain("Should not appear");
  });

  // ── Test 4: mixed batch — reason present only for the 0 % invoice ─────────

  it("emits <taxExemptionReason> only for the 0 % VAT invoice in a mixed batch", async () => {
    const reason = "Ausfuhrlieferung (§ 4 Nr. 1a UStG)";

    stageSelectsForTwoInvoices(EU_INV, "500.00", DE_INV, "1000.00");

    const xml = await downloadAndReadXml(
      [EU_INV.id, DE_INV.id],
      { [EU_INV.id]: reason, [DE_INV.id]: "Should not appear" },
    );

    // Reason appears exactly once — in the EU invoice's line-item block.
    expect(xml).toContain("<taxExemptionReason>");
    expect(xml).toContain(reason);
    expect(xml).not.toContain("Should not appear");

    // Count occurrences: only one <taxExemptionReason> element in the whole document.
    const occurrences = (xml.match(/<taxExemptionReason>/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  // ── Test 5: empty/whitespace reason is rejected ───────────────────────────

  it("returns validation details when the exemptionReasons value is an empty string", async () => {
    stageSelectsForOneInvoice(EU_INV, "500.00");

    const response = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [EU_INV.id], exemptionReasons: { [EU_INV.id]: "" } });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      expect.stringContaining("0 % VAT invoices require a DATEV exemption reason."),
    ]);
  });

  it("returns validation details when the exemptionReasons value is whitespace only", async () => {
    stageSelectsForOneInvoice(EU_INV, "500.00");

    const response = await request(app)
      .post("/api/iroc/datev/download")
      .set("Authorization", AUTH)
      .send({ invoiceIds: [EU_INV.id], exemptionReasons: { [EU_INV.id]: "   " } });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual([
      expect.stringContaining("0 % VAT invoices require a DATEV exemption reason."),
    ]);
  });

});
