/**
 * DATEV Buchungsstapel v700 CSV builder for purchase invoices (Ausgaben).
 *
 * Spec references:
 *  - DATEV Buchungsstapel-Schnittstelle v700 (category 21)
 *  - DATEV Buchungsschnittstelle v700 column layout
 */

// ── Default category → DATEV expense account (SKR04) ─────────────────────────

export const DEFAULT_KONTO_MAP: Record<string, string> = {
  "Office Supplies":   "6815",
  "Software":          "6820",
  "Travel":            "6650",
  "Medical Equipment": "6840",
  "Consulting":        "6800",
  "Utilities":         "6300",
  "Advertising":       "6600",
  "Other":             "6300",
};

export const DEFAULT_GEGEN_KONTO = "1600"; // Verbindlichkeiten L+L (SKR04)

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive the DATEV BU-Schlüssel (input-VAT tax key) from net and tax amounts.
 *
 * Only two German standard VAT rates are recognized:
 *   - Exactly 19 % Vorsteuer → "9"
 *   - Exactly  7 % Vorsteuer → "8"
 *   - Any other rate (0 %, 10 %, 20 %, …) → "" (no BU key; DATEV posts without VAT split)
 *
 * A ±0.5 percentage-point tolerance is applied to absorb integer-cent rounding
 * differences in scanned receipts (e.g. net=84.03, tax=15.97 rounds to 19.0 %).
 * Rates 18 %, 20 %, 6 %, 8 %, etc. are intentionally NOT recognized and return "".
 */
export function buKey(net: number | null, tax: number | null): string {
  if (!net || net <= 0 || !tax || tax <= 0) return "";
  const rate = (tax / net) * 100;
  if (rate >= 18.5 && rate <= 19.5) return "9"; // 19 % Vorsteuer
  if (rate >=  6.5 && rate <=  7.5) return "8"; //  7 % Vorsteuer
  return "";
}

/**
 * Format an ISO date string (YYYY-MM-DD) as DDMM for the DATEV Belegdatum
 * column.  Returns an empty string for null/empty input.
 */
export function belegDatum(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return "";
  const [, m, d] = parts;
  return `${d}${m}`;
}

/**
 * Escape a value for DATEV semicolon-delimited CSV output.
 * Fields that contain semicolons, double-quotes, or newlines are double-quote
 * wrapped; internal double-quotes are doubled.
 */
export function datevCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── Expense row type ──────────────────────────────────────────────────────────

export interface ExpenseRow {
  invoice_date:   string | null;
  invoice_number: string | null;
  vendor_name:    string | null;
  category:       string | null;
  net_amount:     string | null;
  tax_amount:     string | null;
  gross_amount:   string | null;
  currency:       string;
  net_amount_eur?: string | null;
  tax_amount_eur?: string | null;
  gross_amount_eur?: string | null;
  conversion_status?: string | null;
  notes:          string | null;
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build a DATEV Buchungsstapel v700 CSV string from expense rows.
 *
 * Header layout (EXTF format, all fields semicolon-delimited):
 *
 * Pos  Name                    Notes
 *  0   "EXTF"                  Fixed identifier
 *  1   700                     Format version
 *  2   21                      Data category (Buchungsstapel)
 *  3   "Buchungsstapel"        Category name
 *  4   7                       Buchungsstapel version
 *  5   YYYYMMDDHHMMSSMMM       Created timestamp (17 chars, includes ms)
 *  6   (empty)                 Import timestamp
 *  7   1                       Origin (1 = created by application)
 *  8   "iROC"                  Created by
 *  9   (empty)                 Imported by
 * 10   YYYYMMDD                Wirtschaftsjahresbeginn (fiscal year start)
 * 11   4                       Sachkontennummernlänge (4 for SKR04 4-digit accts)
 * 12   YYYYMMDD                Datum von (period start)
 * 13   YYYYMMDD                Datum bis (period end)
 * 14   "Ausgaben-Export"       Bezeichnung
 * 15   (empty)                 Diktatkürzel
 * 16   1                       Buchungstyp (1 = normal)
 * 17   0                       Rechnungslegungszweck
 * 18   0                       Festschreibung
 * 19   "EUR"                   WKZ
 * 20-35 (empty)                Reserved
 *
 * Data column headers (line 2) and rows follow.
 */
export function buildDatevBuchungsstapelCsv(
  rows: ExpenseRow[],
  kontoMap: Record<string, string>,
  gegenKonto: string,
): string {
  const now = new Date();

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");

  // 17-character created timestamp: YYYYMMDDHHMMSSMMM
  const ts17 =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}` +
    `${pad3(now.getMilliseconds())}`;

  // Determine period from expense dates (sort ascending)
  const dates = rows
    .map(r => r.invoice_date)
    .filter((d): d is string => !!d)
    .sort();

  // Helper: YYYY-MM-DD → YYYYMMDD (for header dates)
  const toDatevHeaderDate = (iso: string) => iso.replace(/-/g, "");

  const periodFromISO = dates[0]      ?? now.toISOString().slice(0, 10);
  const periodToISO   = dates[dates.length - 1] ?? periodFromISO;

  // Fiscal year start = 1 Jan of the period-from year
  const fyYear = periodFromISO.slice(0, 4);
  const wjBeginn = `${fyYear}0101`;

  // Build the 36-field EXTF header (fields 20-35 are reserved/empty)
  const headerFields: (string | number)[] = [
    '"EXTF"',             //  0: Format identifier
    700,                  //  1: Format version
    21,                   //  2: Data category (Buchungsstapel)
    '"Buchungsstapel"',   //  3: Category name
    7,                    //  4: Buchungsstapel version
    ts17,                 //  5: Created timestamp (17 chars)
    "",                   //  6: Import timestamp (empty at creation)
    1,                    //  7: Origin (1 = created by application)
    '"iROC"',             //  8: Created by
    "",                   //  9: Imported by
    wjBeginn,             // 10: Wirtschaftsjahresbeginn YYYYMMDD
    4,                    // 11: Sachkontennummernlänge (4 for SKR04 4-digit accts)
    toDatevHeaderDate(periodFromISO), // 12: Datum von YYYYMMDD
    toDatevHeaderDate(periodToISO),   // 13: Datum bis YYYYMMDD
    '"Ausgaben-Export"',  // 14: Bezeichnung
    "",                   // 15: Diktatkürzel
    1,                    // 16: Buchungstyp (1 = normal)
    0,                    // 17: Rechnungslegungszweck (0 = none)
    0,                    // 18: Festschreibung (0 = no)
    '"EUR"',              // 19: WKZ
    ...Array(16).fill(""), // 20-35: Reserved
  ];

  const header = headerFields.join(";");

  // Column headers (line 2)
  const colHeaders = [
    "Umsatz (ohne Soll/Haben-Kz)",
    "Soll/Haben-Kennzeichen",
    "WKZ Umsatz",
    "Kurs",
    "Basis-Umsatz",
    "WKZ Basis-Umsatz",
    "Konto",
    "Gegenkonto (ohne BU-Schlüssel)",
    "BU-Schlüssel",
    "Belegdatum",
    "Belegfeld 1",
    "Belegfeld 2",
    "Skonto",
    "Buchungstext",
  ].join(";");

  // Data rows (line 3+)
  const dataRows = rows.map(r => {
    const hasEurSnapshot = r.conversion_status === "converted"
      || r.conversion_status === "manual"
      || r.conversion_status === "not_needed";
    const netValue = hasEurSnapshot ? r.net_amount_eur ?? r.net_amount : r.net_amount;
    const taxValue = hasEurSnapshot ? r.tax_amount_eur ?? r.tax_amount : r.tax_amount;
    const grossValue = hasEurSnapshot ? r.gross_amount_eur ?? r.gross_amount : r.gross_amount;
    const net   = netValue   ? parseFloat(netValue)   : null;
    const tax   = taxValue   ? parseFloat(taxValue)   : null;
    const gross = grossValue ? parseFloat(grossValue) : null;

    // Booking amount: prefer gross; fall back to net+tax or net
    const umsatz = gross ?? (net != null && tax != null ? net + tax : net) ?? 0;
    // DATEV expects comma as decimal separator
    const umsatzStr = umsatz.toFixed(2).replace(".", ",");

    const konto = kontoMap[r.category ?? ""] ?? kontoMap["Other"] ?? "6300";
    const bu    = buKey(net, tax);

    return [
      datevCell(umsatzStr),                                 // Umsatz
      "S",                                                  // Soll (expense = debit)
      datevCell(hasEurSnapshot ? "EUR" : (r.currency || "EUR")), // WKZ
      "",                                                   // Kurs (empty = 1)
      "",                                                   // Basis-Umsatz
      "",                                                   // WKZ Basis-Umsatz
      datevCell(konto),                                     // Konto
      datevCell(gegenKonto),                                // Gegenkonto
      datevCell(bu),                                        // BU-Schlüssel
      datevCell(belegDatum(r.invoice_date)),                // Belegdatum (DDMM)
      datevCell(r.invoice_number ?? ""),                    // Belegfeld 1
      "",                                                   // Belegfeld 2
      "",                                                   // Skonto
      datevCell((r.vendor_name ?? r.notes ?? "").slice(0, 60)), // Buchungstext
    ].join(";");
  });

  return [header, colHeaders, ...dataRows].join("\r\n");
}
