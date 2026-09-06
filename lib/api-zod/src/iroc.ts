export type InvoiceSupplyKind = "goods" | "service" | "mixed";
export type DefaultInvoiceType =
  | "domestic"
  | "eu"
  | "export"
  | "noneu"
  | "lecture-eu"
  | "lecture-noneu";

export interface DefaultInvoiceTax {
  invoiceType: DefaultInvoiceType;
  vatRate: number;
  vatNote: string;
  destinationCountry: string;
  originCountry: string;
}

const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR",
  "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL",
  "PT", "RO", "SE", "SI", "SK",
]);

const COUNTRY_ALIASES: Record<string, string> = {
  DEUTSCHLAND: "DE",
  AUSTRIA: "AT",
  ÖSTERREICH: "AT",
  BELGIUM: "BE",
  BELGIEN: "BE",
  BULGARIA: "BG",
  BULGARIEN: "BG",
  CROATIA: "HR",
  KROATIEN: "HR",
  CYPRUS: "CY",
  ZYPERN: "CY",
  CZECHIA: "CZ",
  "CZECH REPUBLIC": "CZ",
  TSCHECHIEN: "CZ",
  DENMARK: "DK",
  DÄNEMARK: "DK",
  ESTONIA: "EE",
  ESTLAND: "EE",
  FINLAND: "FI",
  FINNLAND: "FI",
  FRANCE: "FR",
  FRANKREICH: "FR",
  GERMANY: "DE",
  GREECE: "GR",
  GRIECHENLAND: "GR",
  HUNGARY: "HU",
  UNGARN: "HU",
  IRELAND: "IE",
  IRLAND: "IE",
  ITALY: "IT",
  ITALIEN: "IT",
  LATVIA: "LV",
  LETTLAND: "LV",
  LITHUANIA: "LT",
  LITAUEN: "LT",
  LUXEMBOURG: "LU",
  LUXEMBURG: "LU",
  MALTA: "MT",
  NETHERLANDS: "NL",
  NIEDERLANDE: "NL",
  POLAND: "PL",
  POLEN: "PL",
  PORTUGAL: "PT",
  ROMANIA: "RO",
  RUMÄNIEN: "RO",
  SLOVAKIA: "SK",
  SLOWAKEI: "SK",
  SLOVENIA: "SI",
  SLOWENIEN: "SI",
  SPAIN: "ES",
  SPANIEN: "ES",
  SWEDEN: "SE",
  SCHWEDEN: "SE",
  "UNITED KINGDOM": "GB",
  UK: "GB",
  "VEREINIGTES KÖNIGREICH": "GB",
  SWITZERLAND: "CH",
  SCHWEIZ: "CH",
  NORWAY: "NO",
  NORWEGEN: "NO",
  UNITEDSTATES: "US",
  "UNITED STATES": "US",
  USA: "US",
  CANADA: "CA",
  AUSTRALIA: "AU",
  JAPAN: "JP",
  CHINA: "CN",
};

/** Resolve the country values used by the app, which may be ISO codes or names. */
export function normalizeCountryCode(country: string | null | undefined): string {
  const value = country?.trim().toUpperCase() ?? "";
  if (!value) return "";
  return value.length === 2 ? value : COUNTRY_ALIASES[value] ?? value;
}

export function isEuCountryCode(country: string | null | undefined): boolean {
  return EU_COUNTRY_CODES.has(normalizeCountryCode(country));
}

/**
 * Select the default invoice treatment from the dispatch/origin country,
 * destination country, and the type of supply. The app operates from Germany
 * by default; the line-item origin is used when one is entered.
 *
 * This is a default, not tax advice: admins can still override the invoice
 * type, VAT rate, and footnote when a special exemption applies.
 */
export function computeDefaultInvoiceTax({
  destinationCountry,
  originCountry = "Germany",
  supplyKind = "goods",
  lang = "de",
}: {
  destinationCountry?: string | null;
  originCountry?: string | null;
  supplyKind?: InvoiceSupplyKind;
  lang?: string;
}): DefaultInvoiceTax {
  const destination = normalizeCountryCode(destinationCountry) || "DE";
  const origin = normalizeCountryCode(originCountry) || "DE";
  const isService = supplyKind === "service";
  const isDomestic = destination === origin;
  const invoiceType: DefaultInvoiceType = isDomestic
    ? "domestic"
    : isEuCountryCode(destination)
      ? (isService ? "lecture-eu" : "eu")
      : (isService ? "lecture-noneu" : "export");

  return {
    invoiceType,
    vatRate: invoiceType === "domestic" ? 19 : 0,
    vatNote: computeDefaultVatNote(invoiceType, lang),
    destinationCountry: destination,
    originCountry: origin,
  };
}

export function computeDefaultVatNote(type: string, lang: string): string {
  const de = lang === "de";

  // Export (goods exported outside the EU)
  if (type === "export") {
    return de
      ? "** Steuerfreie Ausfuhrlieferung gemäß § 4 Nr. 1a UStG i. V. m. § 6 UStG. Die Umsatzsteuerfreiheit setzt den Nachweis der Ausfuhr voraus."
      : "** Tax-exempt export delivery pursuant to § 4 No. 1a UStG in conjunction with § 6 UStG. VAT exemption is subject to proof of export.";
  }

  // Non-EU standard (services / goods to non-EU recipient)
  if (type === "noneu") {
    return de
      ? "** Nicht steuerbar in Deutschland gemäß § 3a Abs. 2 UStG. Der Leistungsort liegt im Drittland; etwaige Steuerpflichten im Empfängerland obliegen dem Leistungsempfänger."
      : "** Not subject to German VAT pursuant to § 3a (2) UStG. Place of supply is in a third country; any tax obligations in the recipient’s country are the responsibility of the service recipient.";
  }

  // EU intra-community supply (goods, Reverse Charge)
  if (type === "eu") {
    return de
      ? "** Steuerfreie innergemeinschaftliche Lieferung gemäß § 4 Nr. 1b UStG i. V. m. § 6a UStG. Der Erwerb unterliegt im Bestimmungsland der Erwerbsbesteuerung durch den Leistungsempfänger."
      : "** Tax-exempt intra-community supply pursuant to § 4 No. 1b UStG in conjunction with § 6a UStG. The acquisition is subject to acquisition taxation in the country of destination.";
  }

  // Lecture / speaking fee — EU (services to EU business)
  if (type === "lecture-eu") {
    return de
      ? "** Sonstige Leistung (z. B. Schulung, Beratung oder Vortrag) an einen Unternehmer im EU-Ausland gemäß § 3a Abs. 2 UStG. Die Steuerschuldnerschaft geht auf den Leistungsempfänger über (Reverse Charge) gemäß Art. 196 MwStSystRL i. V. m. § 13b Abs. 1 UStG."
      : "** Service (e.g. teaching, consulting or speaking) to a business customer in the EU pursuant to § 3a (2) UStG. Tax liability transfers to the service recipient (Reverse Charge) pursuant to Art. 196 VAT Directive in conjunction with § 13b (1) UStG.";
  }

  // Lecture / speaking fee — non-EU (services to non-EU business)
  if (type === "lecture-noneu") {
    return de
      ? "** Sonstige Leistung (z. B. Schulung, Beratung oder Vortrag) an einen Unternehmer im Drittland gemäß § 3a Abs. 2 UStG. Nicht steuerbar in Deutschland; die steuerliche Behandlung richtet sich nach dem Recht des Empfängerlandes."
      : "** Service (e.g. teaching, consulting or speaking) to a business customer in a third country pursuant to § 3a (2) UStG. Not subject to German VAT; tax treatment is governed by the law of the recipient’s country.";
  }

  // Domestic taxable supply
  return de ? "** Steuerpflichtige Lieferung." : "** Subject to VAT.";
}