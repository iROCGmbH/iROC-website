/**
 * DATEV document_data XML builder — v5.0 schema compliant.
 *
 * Reference: DATEV "document_data_v050.xsd"
 * Namespace: http://xml.datev.de/bedi/tps/document/v05.0
 *
 * All numeric amounts use dot notation (e.g. 1190.00).
 * Tax amounts are computed per line-item from the invoice's single vatRate.
 */

export interface DatevLineItem {
  productName: string;
  quantity: number;
  lineTotal: number;   // net amount (ex-VAT)
}

export interface DatevInvoice {
  invoiceNumber: string;
  issueDate: string;      // YYYY-MM-DD
  totalGross: number;     // invoice total (inc-VAT)
  vatRate: number;        // e.g. 19, 7, or 0
  customerName: string;
  customerVatId?: string | null;
  pdfFilename: string;    // exact name used in the ZIP archive
  items: DatevLineItem[];
  /**
   * Optional DATEV tax exemption reason code (e.g. "Steuerfreie innergemeinschaftliche Lieferung").
   * When present and vatRate = 0 a <taxExemptionReason> element is emitted inside each
   * invoiceLineItem block so DATEV importers do not reject the invoice for missing exemption info.
   */
  exemptionReason?: string;
}

/** Escape XML special characters in text content or attribute values. */
function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Format a number to 2 decimal places with dot separator. */
function fmt(n: number): string {
  return n.toFixed(2);
}

/**
 * Build the DATEV document_data.xml string for a batch of invoices.
 * Returns a UTF-8 encoded XML string ready to be written into the ZIP.
 */
export function buildDatevXml(invoices: DatevInvoice[]): string {
  // Validate all VAT rates before emitting any XML.
  for (const inv of invoices) {
    if (inv.vatRate < 0 || inv.vatRate > 100) {
      throw new RangeError(
        `Invalid vatRate ${inv.vatRate} on invoice "${inv.invoiceNumber}": ` +
        `vatRate must be between 0 and 100 (inclusive).`,
      );
    }
  }

  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<archive' +
    ' xmlns="http://xml.datev.de/bedi/tps/document/v05.0"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
    ' xsi:schemaLocation="http://xml.datev.de/bedi/tps/document/v05.0 document_data_v050.xsd"' +
    ' version="5.0"' +
    ' generatingSystem="iROC Interface App"' +
    ' xmlData="Eigentum und Urheberrecht der DATEV eG">'
  );
  lines.push("  <content>");

  for (const inv of invoices) {
    lines.push("    <document>");

    // File extension — name must exactly match the PDF filename in the ZIP
    lines.push(`      <extension xsi:type="File" name="${escXml(inv.pdfFilename)}" />`);

    // Invoice metadata
    lines.push(
      `      <invoiceInfo` +
      ` invoiceType="Outgoing"` +
      ` invoiceDate="${escXml(inv.issueDate)}"` +
      ` invoiceNumber="${escXml(inv.invoiceNumber)}"` +
      ` totalGrossAmount="${fmt(inv.totalGross)}"` +
      ` currency="EUR">`
    );

    // Customer party
    lines.push("        <customerParty>");
    lines.push(`          <name>${escXml(inv.customerName || "Unknown")}</name>`);
    if (inv.customerVatId?.trim()) {
      lines.push(`          <vatId>${escXml(inv.customerVatId.trim())}</vatId>`);
    }
    lines.push("        </customerParty>");

    // Line items — each with proportional gross/net/tax amounts
    for (const item of inv.items) {
      const net  = item.lineTotal;
      const tax  = net * (inv.vatRate / 100);
      const gross = net + tax;

      lines.push("        <invoiceLineItem>");
      lines.push(`          <quantity>${fmt(item.quantity)}</quantity>`);
      lines.push(`          <description>${escXml(item.productName)}</description>`);
      lines.push(`          <grossAmount>${fmt(gross)}</grossAmount>`);
      lines.push(`          <netAmount>${fmt(net)}</netAmount>`);
      lines.push(`          <taxAmount>${fmt(tax)}</taxAmount>`);
      lines.push(`          <taxRate>${Math.round(inv.vatRate)}</taxRate>`);
      if (inv.vatRate === 0 && inv.exemptionReason?.trim()) {
        lines.push(`          <taxExemptionReason>${escXml(inv.exemptionReason.trim())}</taxExemptionReason>`);
      }
      lines.push("        </invoiceLineItem>");
    }

    lines.push("      </invoiceInfo>");
    lines.push("    </document>");
  }

  lines.push("  </content>");
  lines.push("</archive>");

  return lines.join("\n");
}
