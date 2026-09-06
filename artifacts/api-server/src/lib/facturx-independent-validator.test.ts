import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractXml } from "@stackforge-eu/factur-x";
import PDFDocument from "pdfkit";
import {
  embedFacturXInvoice,
  type IrocFacturXCustomer,
  type IrocFacturXInvoice,
  type IrocFacturXItem,
} from "./facturx-invoice";

const mustangJar = process.env.MUSTANG_CLI_JAR;
const validateIt = mustangJar ? it : it.skip;

interface InvoiceFixture {
  name: string;
  invoice: IrocFacturXInvoice;
  customer: IrocFacturXCustomer;
  items: IrocFacturXItem[];
  expectedTypeCode: string;
  expectedVatCategories: string[];
  expectedTotals: {
    line: string;
    taxBasis: string;
    tax: string;
    grand: string;
  };
  precedingInvoice?: string;
}

const baseInvoice: IrocFacturXInvoice = {
  invoiceNumber: "RE-2026-BASE",
  issueDate: "2026-08-28",
  invoiceType: "domestic",
  vatRate: "19",
  deliveryCosts: "0",
  insuranceCosts: "0",
  buyerReference: "BUYER-REF-945",
  sellerVatId: "DE455683037",
  dueDate: "2026-09-11",
};

const germanCustomer: IrocFacturXCustomer = {
  name: "Ada Buyer",
  company: "Ada Buyer GmbH",
  address: "Buyer Street 1",
  city: "Munich",
  postalCode: "80331",
  country: "DE",
  email: "buyer@example.test",
};

const fixtures: InvoiceFixture[] = [
  {
    name: "domestic",
    invoice: { ...baseInvoice, invoiceNumber: "RE-2026-DOMESTIC", deliveryCosts: "5" },
    customer: germanCustomer,
    items: [{ productName: "Spirecut instrument", quantity: 1, unitPrice: "100", lineTotal: "100", vatRate: "19" }],
    expectedTypeCode: "380",
    expectedVatCategories: ["S"],
    expectedTotals: { line: "100.00", taxBasis: "105.00", tax: "19.95", grand: "124.95" },
  },
  {
    name: "mixed-rate",
    invoice: {
      ...baseInvoice,
      invoiceNumber: "RE-2026-MIXED",
      deliveryCosts: "0.01",
      insuranceCosts: "0.02",
    },
    customer: germanCustomer,
    items: [
      { productName: "Standard-rate item", quantity: 1, unitPrice: "10", lineTotal: "10", vatRate: "19" },
      { productName: "Reduced-rate item", quantity: 1, unitPrice: "5", lineTotal: "5", vatRate: "7" },
    ],
    expectedTypeCode: "380",
    expectedVatCategories: ["S", "S"],
    expectedTotals: { line: "15.00", taxBasis: "15.03", tax: "2.25", grand: "17.28" },
  },
  {
    name: "reverse-charge",
    invoice: {
      ...baseInvoice,
      invoiceNumber: "RE-2026-REVERSE",
      invoiceType: "lecture-eu",
      vatRate: "0",
      buyerVatId: "ATU12345678",
    },
    customer: { ...germanCustomer, country: "AT" },
    items: [{ productName: "Training service", quantity: 1, unitPrice: "250", lineTotal: "250", vatRate: "0" }],
    expectedTypeCode: "380",
    expectedVatCategories: ["AE"],
    expectedTotals: { line: "250.00", taxBasis: "250.00", tax: "0.00", grand: "250.00" },
  },
  {
    name: "export",
    invoice: { ...baseInvoice, invoiceNumber: "RE-2026-EXPORT", invoiceType: "export", vatRate: "0" },
    customer: { ...germanCustomer, country: "US", postalCode: "10001", city: "New York" },
    items: [{ productName: "Exported instrument", quantity: 2, unitPrice: "80", lineTotal: "160", vatRate: "0" }],
    expectedTypeCode: "380",
    expectedVatCategories: ["G"],
    expectedTotals: { line: "160.00", taxBasis: "160.00", tax: "0.00", grand: "160.00" },
  },
  {
    name: "service",
    invoice: { ...baseInvoice, invoiceNumber: "RE-2026-SERVICE", invoiceType: "lecture-noneu", vatRate: "0" },
    customer: { ...germanCustomer, country: "US", postalCode: "10001", city: "New York" },
    items: [{ productName: "Training service", quantity: 2, unitPrice: "150", lineTotal: "300", vatRate: "0" }],
    expectedTypeCode: "380",
    expectedVatCategories: ["O"],
    expectedTotals: { line: "300.00", taxBasis: "300.00", tax: "0.00", grand: "300.00" },
  },
  {
    name: "correction",
    invoice: {
      ...baseInvoice,
      invoiceNumber: "RE-2026-CORRECTION",
      referenceNumber: "RE-2026-ORIGINAL",
      notes: "Correction invoice for RE-2026-ORIGINAL",
    },
    customer: germanCustomer,
    items: [{ productName: "Corrected instrument", quantity: 1, unitPrice: "50", lineTotal: "50", vatRate: "19" }],
    expectedTypeCode: "384",
    expectedVatCategories: ["S"],
    expectedTotals: { line: "50.00", taxBasis: "50.00", tax: "9.50", grand: "59.50" },
    precedingInvoice: "RE-2026-ORIGINAL",
  },
];

let outputDirectory: string;

beforeAll(async () => {
  outputDirectory = await mkdtemp(path.join(tmpdir(), "iroc-facturx-mustang-"));
});

afterAll(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

async function createVisualPdf(): Promise<Buffer> {
  const document = new PDFDocument({ font: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf" });
  document.registerFont("Helvetica", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
  document.registerFont("Helvetica-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
  document.registerFont("Helvetica-Oblique", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf");
  const chunks: Buffer[] = [];
  document.on("data", chunk => chunks.push(Buffer.from(chunk)));
  const finished = new Promise<void>((resolve, reject) => {
    document.on("end", resolve);
    document.on("error", reject);
  });
  document.font("Helvetica").text("Representative iROC invoice fixture");
  document.font("Helvetica-Bold").text("Independent EN 16931 validation");
  document.font("Helvetica-Oblique").text("Embedded fonts and PDF/A-3 metadata");
  document.end();
  await finished;
  return Buffer.concat(chunks);
}

function values(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<ram:${tag}(?: [^>]*)?>([^<]*)</ram:${tag}>`, "g"))]
    .map(match => match[1]);
}

describe.sequential("independent Mustangproject Factur-X validation", () => {
  validateIt.each(fixtures)(
    "$name invoice passes PDF/A-3 and EN 16931 validation",
    async fixture => {
      const pdf = await embedFacturXInvoice(
        await createVisualPdf(),
        fixture.invoice,
        fixture.customer,
        fixture.items,
      );
      const pdfPath = path.join(outputDirectory, `${fixture.name}.pdf`);
      await import("node:fs/promises").then(({ writeFile }) => writeFile(pdfPath, pdf));

      const validation = spawnSync(
        "java",
        ["-jar", mustangJar!, "--action", "validate", "--no-notices", "--source", pdfPath],
        { encoding: "utf8", timeout: 30_000 },
      );
      expect(validation.error).toBeUndefined();
      expect(validation.status, validation.stderr || validation.stdout).toBe(0);
      expect(validation.stdout).toContain('flavour=3b');
      expect(validation.stdout).toContain('isCompliant=true');
      expect(validation.stdout).toContain('<profile>urn:cen.eu:en16931:2017</profile>');
      expect(validation.stdout).toContain('<validator version="2.26.0"/>');
      expect(validation.stdout).not.toContain('<error ');
      expect(validation.stdout.match(/<summary status="valid"\/>/g)).toHaveLength(3);

      const extracted = await extractXml(pdf);
      expect(extracted).toMatchObject({ filename: "factur-x.xml", profile: "EN16931" });
      expect(values(extracted.xml, "TypeCode")).toContain(fixture.expectedTypeCode);
      expect(values(extracted.xml, "CategoryCode")).toEqual(expect.arrayContaining(fixture.expectedVatCategories));
      expect(values(extracted.xml, "LineTotalAmount")).toContain(fixture.expectedTotals.line);
      expect(values(extracted.xml, "TaxBasisTotalAmount")).toContain(fixture.expectedTotals.taxBasis);
      expect(values(extracted.xml, "TaxTotalAmount")).toContain(fixture.expectedTotals.tax);
      expect(values(extracted.xml, "GrandTotalAmount")).toContain(fixture.expectedTotals.grand);
      expect(pdf.toString("latin1")).toContain("pdfaid:part");
      expect(pdf.toString("latin1")).toContain("factur-x.xml");

      if (fixture.precedingInvoice) {
        expect(extracted.xml).toContain(
          `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${fixture.precedingInvoice}</ram:IssuerAssignedID>`,
        );
      }
      if (fixture.name === "service") {
        expect(extracted.xml).not.toContain("<ram:SpecifiedTaxRegistration>");
        expect(extracted.xml).not.toContain("<ram:RateApplicablePercent>");
      }
    },
    35_000,
  );
});