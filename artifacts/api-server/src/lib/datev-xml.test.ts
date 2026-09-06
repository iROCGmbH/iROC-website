/**
 * Unit tests for buildDatevXml — focusing on 0 % VAT (EU/export) invoices.
 *
 * What & Why
 * ──────────
 * EU and export invoices carry vatRate = 0.  The XML builder computes
 * taxAmount = net × (vatRate / 100), so for 0 % VAT this must produce
 *   taxAmount  = 0.00
 *   taxRate    = 0
 * without any NaN, Infinity, or missing element.
 *
 * DATEV importers can reject taxRate = 0 when the element is absent or
 * malformed, so both the value and the element structure are verified.
 *
 * Test 1 — numeric values for 0 % VAT
 *   A single-item invoice with vatRate = 0 must output
 *   <taxAmount>0.00</taxAmount> and <taxRate>0</taxRate>.
 *   The grossAmount and netAmount must equal the lineTotal (no added tax).
 *
 * Test 2 — well-formed XML skeleton
 *   The output must:
 *     • start with the XML declaration
 *     • include the DATEV namespace on <archive>
 *     • include the schemaLocation attribute
 *     • contain a closing </archive> tag
 *     • contain no empty required attributes (invoiceNumber, invoiceDate,
 *       totalGrossAmount, currency must all be non-empty)
 *
 * Test 3 — standard 19 % VAT still works (regression guard)
 *   Changing the 0 % path must not break normal invoices.
 *
 * Test 4 — multiple invoices in one batch (mixed VAT rates)
 *   A batch with one 0 % and one 19 % invoice must produce correct values
 *   for both documents in a single XML output.
 */

import { describe, it, expect } from "vitest";
import { buildDatevXml, type DatevInvoice } from "./datev-xml";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EU_INVOICE: DatevInvoice = {
  invoiceNumber: "2026-EU-001",
  issueDate:     "2026-03-15",
  totalGross:    500.00,   // net = gross because vatRate = 0
  vatRate:       0,
  customerName:  "EU Clinic GmbH",
  customerVatId: "DE123456789",
  pdfFilename:   "2026-EU-001.pdf",
  items: [
    { productName: "Spirecut® Kit", quantity: 1, lineTotal: 500.00 },
  ],
};

const STANDARD_INVOICE: DatevInvoice = {
  invoiceNumber: "2026-DE-042",
  issueDate:     "2026-03-20",
  totalGross:    1190.00,   // 1000 net + 190 VAT
  vatRate:       19,
  customerName:  "German Clinic AG",
  customerVatId: null,
  pdfFilename:   "2026-DE-042.pdf",
  items: [
    { productName: "MiniStem® Set", quantity: 2, lineTotal: 1000.00 },
  ],
};

/** 7 % reduced VAT — e.g. certain medical supplies */
const REDUCED_INVOICE: DatevInvoice = {
  invoiceNumber: "2026-DE-099",
  issueDate:     "2026-04-01",
  totalGross:    107.00,   // 100 net + 7 VAT
  vatRate:       7,
  customerName:  "Med Supply OHG",
  customerVatId: "DE987654321",
  pdfFilename:   "2026-DE-099.pdf",
  items: [
    { productName: "Bandage Pack", quantity: 10, lineTotal: 100.00 },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the text content of the first occurrence of an XML element. */
function extractElement(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m?.[1];
}

/** Extract ALL occurrences of a self-closing or paired element value. */
function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, "g");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildDatevXml — 0 % VAT (EU/export) invoice", () => {

  it("outputs taxAmount=0.00 and taxRate=0 for a 0 % VAT invoice", () => {
    const xml = buildDatevXml([EU_INVOICE]);

    const taxAmounts = extractAll(xml, "taxAmount");
    const taxRates   = extractAll(xml, "taxRate");

    expect(taxAmounts).toHaveLength(1);
    expect(taxRates).toHaveLength(1);

    expect(taxAmounts[0]).toBe("0.00");
    expect(taxRates[0]).toBe("0");
  });

  it("outputs grossAmount equal to netAmount when vatRate is 0", () => {
    const xml = buildDatevXml([EU_INVOICE]);

    const grossAmounts = extractAll(xml, "grossAmount");
    const netAmounts   = extractAll(xml, "netAmount");

    expect(grossAmounts).toHaveLength(1);
    expect(netAmounts).toHaveLength(1);

    // With 0 % VAT, gross = net = lineTotal = 500.00
    expect(grossAmounts[0]).toBe("500.00");
    expect(netAmounts[0]).toBe("500.00");
  });

  it("produces well-formed XML with correct namespace and required attributes", () => {
    const xml = buildDatevXml([EU_INVOICE]);

    // XML declaration
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);

    // DATEV namespace on root element
    expect(xml).toContain('xmlns="http://xml.datev.de/bedi/tps/document/v05.0"');

    // Schema location attribute
    expect(xml).toContain("xsi:schemaLocation=");
    expect(xml).toContain("document_data_v050.xsd");

    // Root element is closed
    expect(xml).toContain("</archive>");

    // <content> wrapper is closed
    expect(xml).toContain("</content>");

    // Invoice metadata attributes are non-empty
    expect(xml).toMatch(/invoiceNumber="2026-EU-001"/);
    expect(xml).toMatch(/invoiceDate="2026-03-15"/);
    expect(xml).toMatch(/totalGrossAmount="500\.00"/);
    expect(xml).toMatch(/currency="EUR"/);

    // No attribute with an empty value (e.g. invoiceNumber="" would be invalid)
    expect(xml).not.toMatch(/="\s*"/);
  });

  it("does not produce NaN or Infinity anywhere in the output for 0 % VAT", () => {
    const xml = buildDatevXml([EU_INVOICE]);

    expect(xml).not.toContain("NaN");
    expect(xml).not.toContain("Infinity");
  });
});

describe("buildDatevXml — standard 19 % VAT (regression guard)", () => {

  it("computes taxAmount and taxRate correctly for 19 % VAT", () => {
    const xml = buildDatevXml([STANDARD_INVOICE]);

    const taxAmounts = extractAll(xml, "taxAmount");
    const taxRates   = extractAll(xml, "taxRate");

    expect(taxAmounts).toHaveLength(1);
    expect(taxRates).toHaveLength(1);

    // lineTotal = 1000, vatRate = 19 → tax = 190.00
    expect(taxAmounts[0]).toBe("190.00");
    expect(taxRates[0]).toBe("19");
  });

  it("computes grossAmount = net + tax for 19 % VAT", () => {
    const xml = buildDatevXml([STANDARD_INVOICE]);

    const grossAmounts = extractAll(xml, "grossAmount");
    const netAmounts   = extractAll(xml, "netAmount");

    expect(grossAmounts[0]).toBe("1190.00");
    expect(netAmounts[0]).toBe("1000.00");
  });
});

describe("buildDatevXml — exemptionReason field", () => {

  it("emits <taxExemptionReason> inside the line-item block when set on a 0 % VAT invoice", () => {
    const inv: DatevInvoice = {
      ...EU_INVOICE,
      exemptionReason: "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)",
    };
    const xml = buildDatevXml([inv]);

    expect(xml).toContain("<taxExemptionReason>");
    expect(xml).toContain(
      "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)",
    );
    // Must appear inside the invoiceLineItem block (after taxRate, before closing tag)
    const lineItemBlock = xml.match(/<invoiceLineItem>[\s\S]*?<\/invoiceLineItem>/)?.[0] ?? "";
    expect(lineItemBlock).toContain("<taxExemptionReason>");
  });

  it("does NOT emit <taxExemptionReason> when exemptionReason is absent on a 0 % VAT invoice", () => {
    const inv: DatevInvoice = { ...EU_INVOICE }; // no exemptionReason
    const xml = buildDatevXml([inv]);
    expect(xml).not.toContain("<taxExemptionReason>");
  });

  it("does NOT emit <taxExemptionReason> when exemptionReason is an empty/whitespace string", () => {
    const inv: DatevInvoice = { ...EU_INVOICE, exemptionReason: "   " };
    const xml = buildDatevXml([inv]);
    expect(xml).not.toContain("<taxExemptionReason>");
  });

  it("does NOT emit <taxExemptionReason> for a non-zero VAT invoice even if exemptionReason is set", () => {
    const inv: DatevInvoice = {
      ...STANDARD_INVOICE,
      exemptionReason: "Should not appear",
    };
    const xml = buildDatevXml([inv]);
    expect(xml).not.toContain("<taxExemptionReason>");
    expect(xml).not.toContain("Should not appear");
  });

  it("XML-escapes special characters in the exemptionReason value", () => {
    const inv: DatevInvoice = {
      ...EU_INVOICE,
      exemptionReason: 'Reason <with> "special" & \'chars\'',
    };
    const xml = buildDatevXml([inv]);
    expect(xml).toContain("&lt;with&gt;");
    expect(xml).toContain("&quot;special&quot;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&apos;chars&apos;");
    // Raw unescaped characters must not appear inside the element
    expect(xml).not.toMatch(/<taxExemptionReason>[^<]*<[^/]/);
  });
});

describe("buildDatevXml — mixed batch (0 % and 19 % in one export)", () => {

  it("outputs correct tax values for both invoices in a single XML", () => {
    const xml = buildDatevXml([EU_INVOICE, STANDARD_INVOICE]);

    const taxAmounts = extractAll(xml, "taxAmount");
    const taxRates   = extractAll(xml, "taxRate");

    // Two line items → two of each element
    expect(taxAmounts).toHaveLength(2);
    expect(taxRates).toHaveLength(2);

    // First document (EU, 0 %)
    expect(taxAmounts[0]).toBe("0.00");
    expect(taxRates[0]).toBe("0");

    // Second document (DE, 19 %)
    expect(taxAmounts[1]).toBe("190.00");
    expect(taxRates[1]).toBe("19");
  });

  it("includes both invoice numbers in the XML", () => {
    const xml = buildDatevXml([EU_INVOICE, STANDARD_INVOICE]);

    expect(xml).toContain('invoiceNumber="2026-EU-001"');
    expect(xml).toContain('invoiceNumber="2026-DE-042"');
  });
});

describe("buildDatevXml — mixed batch (0 %, 7 %, and 19 % in one export)", () => {

  it("outputs correct taxAmount for each invoice in the batch", () => {
    const xml = buildDatevXml([EU_INVOICE, REDUCED_INVOICE, STANDARD_INVOICE]);

    const taxAmounts = extractAll(xml, "taxAmount");

    expect(taxAmounts).toHaveLength(3);

    // 0 % — EU invoice: 500 × 0 = 0.00
    expect(taxAmounts[0]).toBe("0.00");

    // 7 % — reduced invoice: 100 × 0.07 = 7.00
    expect(taxAmounts[1]).toBe("7.00");

    // 19 % — standard invoice: 1000 × 0.19 = 190.00
    expect(taxAmounts[2]).toBe("190.00");
  });

  it("outputs correct taxRate for each invoice in the batch", () => {
    const xml = buildDatevXml([EU_INVOICE, REDUCED_INVOICE, STANDARD_INVOICE]);

    const taxRates = extractAll(xml, "taxRate");

    expect(taxRates).toHaveLength(3);
    expect(taxRates[0]).toBe("0");
    expect(taxRates[1]).toBe("7");
    expect(taxRates[2]).toBe("19");
  });

  it("outputs correct grossAmount and netAmount for the 7 % item", () => {
    const xml = buildDatevXml([EU_INVOICE, REDUCED_INVOICE, STANDARD_INVOICE]);

    const grossAmounts = extractAll(xml, "grossAmount");
    const netAmounts   = extractAll(xml, "netAmount");

    expect(grossAmounts).toHaveLength(3);
    expect(netAmounts).toHaveLength(3);

    // 7 % item: net=100, tax=7, gross=107
    expect(netAmounts[1]).toBe("100.00");
    expect(grossAmounts[1]).toBe("107.00");
  });

  it("includes all three invoice numbers in the XML", () => {
    const xml = buildDatevXml([EU_INVOICE, REDUCED_INVOICE, STANDARD_INVOICE]);

    expect(xml).toContain('invoiceNumber="2026-EU-001"');
    expect(xml).toContain('invoiceNumber="2026-DE-099"');
    expect(xml).toContain('invoiceNumber="2026-DE-042"');
  });

  it("produces no NaN or Infinity values in the 3-invoice batch", () => {
    const xml = buildDatevXml([EU_INVOICE, REDUCED_INVOICE, STANDARD_INVOICE]);

    expect(xml).not.toContain("NaN");
    expect(xml).not.toContain("Infinity");
  });

  it("produces well-formed XML (declaration, namespace, closing tags) for the 3-invoice batch", () => {
    const xml = buildDatevXml([EU_INVOICE, REDUCED_INVOICE, STANDARD_INVOICE]);

    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('xmlns="http://xml.datev.de/bedi/tps/document/v05.0"');
    expect(xml).toContain("xsi:schemaLocation=");
    expect(xml).toContain("</archive>");
    expect(xml).toContain("</content>");
  });
});

describe("buildDatevXml — invalid vatRate rejection", () => {

  it("throws RangeError for a negative vatRate", () => {
    const inv: DatevInvoice = {
      ...STANDARD_INVOICE,
      invoiceNumber: "2026-BAD-001",
      vatRate: -7,
    };
    expect(() => buildDatevXml([inv])).toThrowError(RangeError);
  });

  it("error message for a negative vatRate names the invoice and the bad value", () => {
    const inv: DatevInvoice = {
      ...STANDARD_INVOICE,
      invoiceNumber: "2026-BAD-001",
      vatRate: -7,
    };
    expect(() => buildDatevXml([inv])).toThrow(/2026-BAD-001/);
    expect(() => buildDatevXml([inv])).toThrow(/-7/);
  });

  it("throws RangeError for a vatRate above 100", () => {
    const inv: DatevInvoice = {
      ...STANDARD_INVOICE,
      invoiceNumber: "2026-BAD-002",
      vatRate: 101,
    };
    expect(() => buildDatevXml([inv])).toThrowError(RangeError);
  });

  it("error message for vatRate > 100 names the invoice and the bad value", () => {
    const inv: DatevInvoice = {
      ...STANDARD_INVOICE,
      invoiceNumber: "2026-BAD-002",
      vatRate: 101,
    };
    expect(() => buildDatevXml([inv])).toThrow(/2026-BAD-002/);
    expect(() => buildDatevXml([inv])).toThrow(/101/);
  });

  it("throws when any invoice in a batch has an invalid vatRate (even if others are valid)", () => {
    const badInv: DatevInvoice = {
      ...STANDARD_INVOICE,
      invoiceNumber: "2026-BAD-003",
      vatRate: -1,
    };
    expect(() => buildDatevXml([EU_INVOICE, badInv, REDUCED_INVOICE])).toThrowError(RangeError);
  });

  it("does not throw for boundary values 0 and 100", () => {
    const zeroVat: DatevInvoice = { ...EU_INVOICE };                          // vatRate = 0
    const fullVat: DatevInvoice = { ...STANDARD_INVOICE, vatRate: 100 };     // vatRate = 100

    expect(() => buildDatevXml([zeroVat])).not.toThrow();
    expect(() => buildDatevXml([fullVat])).not.toThrow();
  });

  it("emits no XML output for an invalid batch — the throw prevents any partial output", () => {
    const inv: DatevInvoice = {
      ...STANDARD_INVOICE,
      invoiceNumber: "2026-BAD-004",
      vatRate: -19,
    };
    let result: string | undefined;
    try {
      result = buildDatevXml([inv]);
    } catch {
      // expected
    }
    expect(result).toBeUndefined();
  });
});
