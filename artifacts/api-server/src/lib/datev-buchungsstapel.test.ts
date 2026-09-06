/**
 * Unit tests for the DATEV Buchungsstapel v700 CSV builder.
 *
 * Covers:
 *  1. Header compliance — EXTF identifier, Sachkontennummernlänge=4,
 *     17-char timestamp, YYYYMMDD period dates, 36 semicolon-separated fields
 *  2. BU-Schlüssel derivation — 19 % → "9", 7 % → "8", 0 %/null → ""
 *  3. belegDatum helper — DDMM format from ISO date
 *  4. datevCell escaping — semicolons and quotes
 *  5. Data rows — Soll indicator "S", comma decimal separator, Konto mapping,
 *     Buchungstext, filtered rows
 *  6. Konto mapping — custom map overrides defaults; fallback to "Other" account
 *  7. Empty/null amounts — zero booking amount does not crash
 */

import { describe, it, expect } from "vitest";
import {
  buildDatevBuchungsstapelCsv,
  buKey,
  belegDatum,
  datevCell,
  DEFAULT_KONTO_MAP,
  DEFAULT_GEGEN_KONTO,
  type ExpenseRow,
} from "./datev-buchungsstapel";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    invoice_date:   "2026-03-15",
    invoice_number: "EXP-001",
    vendor_name:    "ACME GmbH",
    category:       "Software",
    net_amount:     "100.00",
    tax_amount:     "19.00",
    gross_amount:   "119.00",
    currency:       "EUR",
    notes:          null,
    ...overrides,
  };
}

// ── Helper: parse the CSV into lines ─────────────────────────────────────────

function lines(csv: string): string[] {
  return csv.split("\r\n");
}

function headerFields(csv: string): string[] {
  return lines(csv)[0].split(";");
}

function dataRow(csv: string, rowIndex = 0): string[] {
  // line 0 = EXTF header, line 1 = column headers, line 2+ = data
  return lines(csv)[2 + rowIndex].split(";");
}

// ── Tests: buKey ─────────────────────────────────────────────────────────────

describe("buKey()", () => {
  it("returns '9' for 19 % VAT", () => {
    expect(buKey(100, 19)).toBe("9");
  });

  it("returns '9' for amounts yielding exactly 19 % (rounding)", () => {
    // 84.03 * 0.19 = 15.97 → rounded 19 %
    expect(buKey(84.03, 15.97)).toBe("9");
  });

  it("returns '8' for 7 % VAT", () => {
    expect(buKey(100, 7)).toBe("8");
  });

  it("returns '' for 0 % VAT (no tax)", () => {
    expect(buKey(100, 0)).toBe("");
  });

  it("returns '' for null net", () => {
    expect(buKey(null, 19)).toBe("");
  });

  it("returns '' for null tax", () => {
    expect(buKey(100, null)).toBe("");
  });

  it("returns '' for both null", () => {
    expect(buKey(null, null)).toBe("");
  });

  it("returns '' for an unusual VAT rate (e.g. 10 %)", () => {
    expect(buKey(100, 10)).toBe("");
  });

  // Boundary: rates adjacent to 19 % that must NOT be recognized
  it("returns '' for 18 % VAT (not 19 %)", () => {
    expect(buKey(100, 18)).toBe("");
  });

  it("returns '' for 20 % VAT (not 19 %)", () => {
    expect(buKey(100, 20)).toBe("");
  });

  // Boundary: rates adjacent to 7 % that must NOT be recognized
  it("returns '' for 6 % VAT (not 7 %)", () => {
    expect(buKey(100, 6)).toBe("");
  });

  it("returns '' for 8 % VAT (not 7 %)", () => {
    expect(buKey(100, 8)).toBe("");
  });

  // Just outside the ±0.5 pp tolerance for 19 %
  it("returns '' for 18.49 % (below 19 % tolerance boundary)", () => {
    // net=100, tax=18.49 → rate=18.49 % → below 18.5 lower bound
    expect(buKey(100, 18.49)).toBe("");
  });

  it("returns '' for 19.51 % (above 19 % tolerance boundary)", () => {
    expect(buKey(100, 19.51)).toBe("");
  });

  // Just outside the ±0.5 pp tolerance for 7 %
  it("returns '' for 6.49 % (below 7 % tolerance boundary)", () => {
    expect(buKey(100, 6.49)).toBe("");
  });

  it("returns '' for 7.51 % (above 7 % tolerance boundary)", () => {
    expect(buKey(100, 7.51)).toBe("");
  });

  // Inside tolerance for 19 %
  it("returns '9' for 18.5 % (lower tolerance boundary for 19 %)", () => {
    expect(buKey(100, 18.5)).toBe("9");
  });

  it("returns '9' for 19.5 % (upper tolerance boundary for 19 %)", () => {
    expect(buKey(100, 19.5)).toBe("9");
  });

  // Inside tolerance for 7 %
  it("returns '8' for 6.5 % (lower tolerance boundary for 7 %)", () => {
    expect(buKey(100, 6.5)).toBe("8");
  });

  it("returns '8' for 7.5 % (upper tolerance boundary for 7 %)", () => {
    expect(buKey(100, 7.5)).toBe("8");
  });
});

// ── Tests: belegDatum ────────────────────────────────────────────────────────

describe("belegDatum()", () => {
  it("formats YYYY-MM-DD as DDMM", () => {
    expect(belegDatum("2026-03-15")).toBe("1503");
  });

  it("pads single-digit day and month", () => {
    expect(belegDatum("2026-01-05")).toBe("0501");
  });

  it("returns '' for null", () => {
    expect(belegDatum(null)).toBe("");
  });

  it("returns '' for undefined", () => {
    expect(belegDatum(undefined)).toBe("");
  });

  it("returns '' for empty string", () => {
    expect(belegDatum("")).toBe("");
  });
});

// ── Tests: datevCell ─────────────────────────────────────────────────────────

describe("datevCell()", () => {
  it("returns the value as-is when no special characters", () => {
    expect(datevCell("ACME GmbH")).toBe("ACME GmbH");
  });

  it("wraps in double-quotes when value contains a semicolon", () => {
    expect(datevCell("ACME;GmbH")).toBe('"ACME;GmbH"');
  });

  it("doubles internal double-quotes and wraps", () => {
    expect(datevCell('He said "hi"')).toBe('"He said ""hi"""');
  });

  it("wraps when value contains a newline", () => {
    expect(datevCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("returns '' for null", () => {
    expect(datevCell(null)).toBe("");
  });

  it("returns '' for undefined", () => {
    expect(datevCell(undefined)).toBe("");
  });

  it("converts numbers to string", () => {
    expect(datevCell(42)).toBe("42");
  });
});

// ── Tests: EXTF header compliance ────────────────────────────────────────────

describe("buildDatevBuchungsstapelCsv() — EXTF header", () => {
  const csv = buildDatevBuchungsstapelCsv(
    [makeRow()],
    DEFAULT_KONTO_MAP,
    DEFAULT_GEGEN_KONTO,
  );
  const fields = headerFields(csv);

  it("starts with \"EXTF\"", () => {
    expect(fields[0]).toBe('"EXTF"');
  });

  it("field 1 is format version 700", () => {
    expect(fields[1]).toBe("700");
  });

  it("field 2 is data category 21 (Buchungsstapel)", () => {
    expect(fields[2]).toBe("21");
  });

  it("field 3 is \"Buchungsstapel\"", () => {
    expect(fields[3]).toBe('"Buchungsstapel"');
  });

  it("field 4 is Buchungsstapel version 7", () => {
    expect(fields[4]).toBe("7");
  });

  it("field 5 (created timestamp) is exactly 17 characters (YYYYMMDDHHMMSSMMM)", () => {
    const ts = fields[5];
    expect(ts).toHaveLength(17);
    expect(/^\d{17}$/.test(ts)).toBe(true);
  });

  it("field 10 (WJ-Beginn) is YYYYMMDD format (8 digits)", () => {
    const wj = fields[10];
    expect(/^\d{8}$/.test(wj)).toBe(true);
    // Must end in 0101 (Jan 1)
    expect(wj.slice(4)).toBe("0101");
  });

  it("field 11 (Sachkontennummernlänge) is 4 for SKR04 4-digit accounts", () => {
    expect(fields[11]).toBe("4");
  });

  it("field 12 (Datum von) is YYYYMMDD format", () => {
    expect(/^\d{8}$/.test(fields[12])).toBe(true);
  });

  it("field 13 (Datum bis) is YYYYMMDD format", () => {
    expect(/^\d{8}$/.test(fields[13])).toBe(true);
  });

  it("period dates are derived from expense invoice_date", () => {
    // Row date is 2026-03-15 → from = 20260315, to = 20260315
    expect(fields[12]).toBe("20260315");
    expect(fields[13]).toBe("20260315");
  });

  it("field 14 (Bezeichnung) is \"Ausgaben-Export\"", () => {
    expect(fields[14]).toBe('"Ausgaben-Export"');
  });

  it("field 16 (Buchungstyp) is 1 (normal)", () => {
    expect(fields[16]).toBe("1");
  });

  it("has at least 36 semicolon-separated fields", () => {
    expect(fields.length).toBeGreaterThanOrEqual(36);
  });
});

// ── Tests: column header row ──────────────────────────────────────────────────

describe("buildDatevBuchungsstapelCsv() — column header row", () => {
  const csv = buildDatevBuchungsstapelCsv([makeRow()], DEFAULT_KONTO_MAP, DEFAULT_GEGEN_KONTO);
  const cols = lines(csv)[1].split(";");

  it("second line starts with Umsatz column", () => {
    expect(cols[0]).toBe("Umsatz (ohne Soll/Haben-Kz)");
  });

  it("Soll/Haben-Kennzeichen is the second column", () => {
    expect(cols[1]).toBe("Soll/Haben-Kennzeichen");
  });

  it("Konto is the 7th column (index 6)", () => {
    expect(cols[6]).toBe("Konto");
  });

  it("BU-Schlüssel is the 9th column (index 8)", () => {
    expect(cols[8]).toBe("BU-Schlüssel");
  });

  it("Belegdatum is the 10th column (index 9)", () => {
    expect(cols[9]).toBe("Belegdatum");
  });
});

// ── Tests: data rows ──────────────────────────────────────────────────────────

describe("buildDatevBuchungsstapelCsv() — data rows", () => {
  it("Soll/Haben-Kennzeichen is 'S' (Soll = debit) for expenses", () => {
    const csv = buildDatevBuchungsstapelCsv([makeRow()], DEFAULT_KONTO_MAP, DEFAULT_GEGEN_KONTO);
    expect(dataRow(csv)[1]).toBe("S");
  });

  it("Umsatz uses comma as decimal separator (German locale)", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ gross_amount: "119.00" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[0]).toBe("119,00");
  });

  it("Konto maps Software category to 6820 (default SKR04)", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ category: "Software" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[6]).toBe("6820");
  });

  it("Konto maps Office Supplies category to 6815", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ category: "Office Supplies" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[6]).toBe("6815");
  });

  it("Gegenkonto is 1600 (default payables account)", () => {
    const csv = buildDatevBuchungsstapelCsv([makeRow()], DEFAULT_KONTO_MAP, DEFAULT_GEGEN_KONTO);
    expect(dataRow(csv)[7]).toBe("1600");
  });

  it("BU-Schlüssel is 9 for 19 % VAT", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ net_amount: "100.00", tax_amount: "19.00", gross_amount: "119.00" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[8]).toBe("9");
  });

  it("BU-Schlüssel is 8 for 7 % VAT", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ net_amount: "100.00", tax_amount: "7.00", gross_amount: "107.00" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[8]).toBe("8");
  });

  it("BU-Schlüssel is empty for 0 % VAT", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ net_amount: "100.00", tax_amount: "0.00", gross_amount: "100.00" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[8]).toBe("");
  });

  it("Belegdatum is DDMM from invoice_date", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ invoice_date: "2026-03-15" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[9]).toBe("1503");
  });

  it("Belegfeld 1 is the invoice number", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ invoice_number: "INV-2026-042" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[10]).toBe("INV-2026-042");
  });

  it("Buchungstext is the vendor name (truncated to 60 chars)", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ vendor_name: "ACME GmbH" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[13]).toBe("ACME GmbH");
  });

  it("Buchungstext falls back to notes when vendor_name is null", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ vendor_name: null, notes: "Taxi receipt" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[13]).toBe("Taxi receipt");
  });

  it("WKZ Umsatz is EUR for EUR expense", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ currency: "EUR" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[2]).toBe("EUR");
  });

  it("WKZ Umsatz reflects non-EUR currency", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ currency: "USD" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[2]).toBe("USD");
  });
});

// ── Tests: Konto mapping ──────────────────────────────────────────────────────

describe("buildDatevBuchungsstapelCsv() — custom Konto mapping", () => {
  it("uses custom konto when provided", () => {
    const customMap = { ...DEFAULT_KONTO_MAP, Software: "9999" };
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ category: "Software" })],
      customMap,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[6]).toBe("9999");
  });

  it("falls back to 'Other' account for unknown category", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ category: "UnknownCategory" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    // 'Other' maps to 6300 by default
    expect(dataRow(csv)[6]).toBe("6300");
  });

  it("uses custom Gegenkonto", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow()],
      DEFAULT_KONTO_MAP,
      "3000",
    );
    expect(dataRow(csv)[7]).toBe("3000");
  });
});

// ── Tests: multiple rows and period range ─────────────────────────────────────

describe("buildDatevBuchungsstapelCsv() — multiple rows", () => {
  const rows: ExpenseRow[] = [
    makeRow({ invoice_date: "2026-01-10", invoice_number: "EXP-001" }),
    makeRow({ invoice_date: "2026-03-15", invoice_number: "EXP-002", category: "Travel" }),
    makeRow({ invoice_date: "2026-02-20", invoice_number: "EXP-003", category: "Utilities" }),
  ];
  const csv = buildDatevBuchungsstapelCsv(rows, DEFAULT_KONTO_MAP, DEFAULT_GEGEN_KONTO);
  const allLines = lines(csv);

  it("produces header + col-header + one data row per expense", () => {
    expect(allLines.length).toBe(5); // 1 header + 1 col-header + 3 data rows
  });

  it("sets Datum von to earliest invoice_date", () => {
    expect(headerFields(csv)[12]).toBe("20260110");
  });

  it("sets Datum bis to latest invoice_date", () => {
    expect(headerFields(csv)[13]).toBe("20260315");
  });

  it("third row uses Travel konto (6650)", () => {
    // row index 1 → line index 3 (0-based data rows)
    expect(dataRow(csv, 1)[6]).toBe("6650");
  });
});

// ── Tests: edge cases ─────────────────────────────────────────────────────────

describe("buildDatevBuchungsstapelCsv() — edge cases", () => {
  it("uses the stored EUR snapshot for converted foreign-currency expenses", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({
        currency: "USD",
        net_amount: "100.00",
        tax_amount: "20.00",
        gross_amount: "120.00",
        net_amount_eur: "92.00",
        tax_amount_eur: "18.40",
        gross_amount_eur: "110.40",
        conversion_status: "converted",
      })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[0]).toBe("110,40");
    expect(dataRow(csv)[2]).toBe("EUR");
  });

  it("handles null gross_amount by falling back to net+tax", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ gross_amount: null, net_amount: "100.00", tax_amount: "19.00" })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[0]).toBe("119,00");
  });

  it("handles all null amounts without crashing (books 0,00)", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ gross_amount: null, net_amount: null, tax_amount: null })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[0]).toBe("0,00");
  });

  it("handles null invoice_date gracefully (empty Belegdatum)", () => {
    const csv = buildDatevBuchungsstapelCsv(
      [makeRow({ invoice_date: null })],
      DEFAULT_KONTO_MAP,
      DEFAULT_GEGEN_KONTO,
    );
    expect(dataRow(csv)[9]).toBe("");
  });

  it("produces an empty body (only header + col-header) for zero rows", () => {
    const csv = buildDatevBuchungsstapelCsv([], DEFAULT_KONTO_MAP, DEFAULT_GEGEN_KONTO);
    expect(lines(csv).length).toBe(2);
  });
});
