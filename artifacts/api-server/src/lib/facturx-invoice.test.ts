import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { buildXml, extractXml, Flavor, Profile } from "@stackforge-eu/factur-x";
import {
  buildFacturXInvoiceInput,
  calculateFacturXTotals,
  embedFacturXInvoice,
  mapInvoiceTypeVat,
} from "./facturx-invoice";

const invoice = {
  invoiceNumber: "RE-2026-001",
  issueDate: "2026-03-20",
  invoiceType: "domestic",
  vatRate: "19",
  deliveryCosts: "0.01",
  insuranceCosts: "0.02",
};

describe("Factur-X invoice adapter", () => {
  it("uses a line VAT rate and allocates every charge cent exactly once", () => {
    const totals = calculateFacturXTotals(invoice, [
      { productName: "Standard", quantity: 1, unitPrice: "10", lineTotal: "10", vatRate: "19" },
      { productName: "Reduced", quantity: 1, unitPrice: "5", lineTotal: "5", vatRate: "7" },
    ]);

    expect(totals.vatGroups.map(group => ({
      rate: group.ratePercent,
      basis: group.taxableCents,
      vat: group.taxCents,
    }))).toEqual([
      { rate: 19, basis: 1002, vat: 190 },
      { rate: 7, basis: 501, vat: 35 },
    ]);
    expect(totals).toMatchObject({ lineTotalCents: 1500, taxBasisCents: 1503, taxTotalCents: 225, grandTotalCents: 1728 });
  });

  it("maps EU and export tax treatments to their EN 16931 categories", () => {
    expect(mapInvoiceTypeVat("eu", 0)).toMatchObject({ categoryCode: "K" });
    expect(mapInvoiceTypeVat("export", 0)).toMatchObject({ categoryCode: "G" });
    expect(mapInvoiceTypeVat("lecture-eu", 0)).toMatchObject({ categoryCode: "AE" });
  });

  it("builds matching document charges and EN 16931 totals", () => {
    const input = buildFacturXInvoiceInput(invoice, {
      name: "Ada Buyer", address: "Buyer Street 1", city: "Munich", postalCode: "80331", country: "Germany",
    }, [
      { productName: "Product", quantity: 1, unitPrice: "10", lineTotal: "10" },
    ]);

    expect(input.totals).toMatchObject({ lineTotal: 10, chargeTotal: 0.03, taxBasisTotal: 10.03, taxTotal: 1.91, grandTotal: 11.94 });
    expect(input.allowancesCharges).toHaveLength(2);
    expect(input.vatBreakdown).toEqual([expect.objectContaining({ categoryCode: "S", taxableAmount: 10.03, taxAmount: 1.91 })]);
  });

  it("uses credit transfer account details, localized terms, and CII date format", () => {
    const input = buildFacturXInvoiceInput(
      { ...invoice, dueDate: "2026-04-19", paymentTermCode: "net30", language: "de" },
      { name: "Ada Buyer", address: "Buyer Street 1", city: "Munich", postalCode: "80331", country: "DE" },
      [{ productName: "Product", quantity: 1, unitPrice: "10", lineTotal: "10" }],
    );
    expect(input.payment).toMatchObject({
      meansCode: "30", iban: "DE85701308000001139550", bic: "GENODEF1M06",
      accountName: "iROC GmbH", dueDate: "2026-04-19",
    });
    expect(input.payment?.termsDescription).toContain("Zahlbar innerhalb von 30 Tagen");
    expect(buildXml(input, Profile.EN16931, Flavor.FACTUR_X)).toContain('format="102">20260419');
  });

  it("only emits BT-10 for B2G invoices and requires it there", () => {
    const customer = { name: "Ada Buyer", address: "Buyer Street 1", city: "Munich", postalCode: "80331", country: "DE" };
    const lines = [{ productName: "Product", quantity: 1, unitPrice: "10", lineTotal: "10" }];
    const nonB2g = buildFacturXInvoiceInput({ ...invoice, buyerReference: "private ref" }, customer, lines);
    expect(nonB2g.document.buyerReference).toBeUndefined();
    expect(() => buildFacturXInvoiceInput({ ...invoice, isB2g: true }, customer, lines))
      .toThrow("B2G invoices require");
    expect(buildFacturXInvoiceInput({ ...invoice, isB2g: true, buyerReference: "LEITWEG-1" }, customer, lines)
      .document.buyerReference).toBe("LEITWEG-1");
  });

  it("rejects a missing or invalid custom payment deadline", () => {
    const customer = { name: "Ada Buyer", address: "Buyer Street 1", city: "Munich", postalCode: "80331", country: "DE" };
    const lines = [{ productName: "Product", quantity: 1, unitPrice: "10", lineTotal: "10" }];
    expect(() => buildFacturXInvoiceInput({ ...invoice, paymentTermCode: "custom" }, customer, lines))
      .toThrow("Custom payment terms require");
    expect(() => buildFacturXInvoiceInput({ ...invoice, paymentTermCode: "custom", dueDate: "2026-02-30" }, customer, lines))
      .toThrow("Custom payment terms require");
    // An omitted code with a saved divergent legacy-like deadline resolves to
    // custom too, and must receive the same calendar-date validation.
    expect(() => buildFacturXInvoiceInput({ ...invoice, dueDate: "2026-02-30" }, customer, lines))
      .toThrow("Custom payment terms require");
  });

  it("requires a buyer VAT ID for EU and reverse-charge invoices", () => {
    const customer = { name: "Ada Buyer", address: "Buyer Street 1", city: "Munich", postalCode: "80331", country: "DE" };
    const lines = [{ productName: "Product", quantity: 1, unitPrice: "10", lineTotal: "10", vatRate: "0" }];
    for (const invoiceType of ["eu", "lecture-eu"]) {
      expect(() => buildFacturXInvoiceInput({ ...invoice, invoiceType, vatRate: "0" }, customer, lines))
        .toThrow("Buyer VAT ID is required");
      expect(buildFacturXInvoiceInput(
        { ...invoice, invoiceType, vatRate: "0", buyerVatId: "DE123456789" },
        customer,
        lines,
      ).buyer.taxRegistrations).toEqual([{ id: "DE123456789", schemeId: "VA" }]);
    }
  });

  it("omits VAT identifiers and rates for services outside the scope of VAT", () => {
    const input = buildFacturXInvoiceInput(
      { ...invoice, invoiceType: "lecture-noneu", vatRate: "0" },
      { name: "Ada Buyer", address: "Buyer Street 1", city: "New York", postalCode: "10001", country: "US" },
      [{ productName: "Training", quantity: 1, unitPrice: "100", lineTotal: "100", vatRate: "0" }],
    );

    expect(input.seller.taxRegistrations).toBeUndefined();
    expect(input.buyer.taxRegistrations).toBeUndefined();
    expect(input.lines?.[0].vatCategoryCode).toBe("O");
    expect(input.vatBreakdown?.[0].categoryCode).toBe("O");
  });

  it("keeps ordinary customer references as commercial invoices", () => {
    const input = buildFacturXInvoiceInput(
      { ...invoice, referenceNumber: "CUSTOMER-REFERENCE-123" },
      { name: "Ada Buyer", address: "Buyer Street 1", city: "Munich", postalCode: "80331", country: "DE" },
      [{ productName: "Product", quantity: 1, unitPrice: "10", lineTotal: "10" }],
    );

    expect(input.document.typeCode).toBe("380");
    expect(input.references).toEqual([]);
  });

  it("maps returned-product invoice corrections to UNTDID 381 and the preceding invoice", () => {
    const input = buildFacturXInvoiceInput(
      {
        ...invoice,
        referenceNumber: "RE-2026-ORIGINAL",
        notes: "Rechnungskorrektur zu RE-2026-ORIGINAL\n\nReturned product",
      },
      { name: "Ada Buyer", address: "Buyer Street 1", city: "Munich", postalCode: "80331", country: "DE" },
      [{ productName: "Product", quantity: 1, unitPrice: "10", lineTotal: "10" }],
    );

    expect(input.document.typeCode).toBe("381");
    expect(input.references).toContainEqual({ id: "RE-2026-ORIGINAL", type: "preceding" });
  });

  it("recognizes the English Invoice correction label", () => {
    const input = buildFacturXInvoiceInput(
      {
        ...invoice,
        referenceNumber: "INV-2026-ORIGINAL",
        notes: "Invoice correction for INV-2026-ORIGINAL\n\nReturned product",
        deliveryCosts: "0",
        insuranceCosts: "0",
      },
      { name: "Ada Buyer", address: "Buyer Street 1", city: "Munich", postalCode: "80331", country: "DE" },
      [{ productName: "Product", quantity: 1, unitPrice: "-10", lineTotal: "-10" }],
    );

    expect(input.document.typeCode).toBe("381");
    expect(input.references).toContainEqual({ id: "INV-2026-ORIGINAL", type: "preceding" });
    expect(input.totals?.grandTotal).toBe(-11.9);
  });

  it("produces an extractable PDF/A-3 Factur-X invoice with embedded fonts", async () => {
    const document = new PDFDocument({
      font: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    });
    document.registerFont("Helvetica", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
    document.registerFont("Helvetica-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
    document.registerFont("Helvetica-Oblique", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf");
    const chunks: Buffer[] = [];
    document.on("data", chunk => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
      document.on("end", resolve);
      document.on("error", reject);
    });
    document.font("Helvetica-Oblique").text("Compliant invoice");
    document.end();
    await finished;

    const pdf = await embedFacturXInvoice(
      Buffer.concat(chunks),
      { ...invoice, issueDate: "2026-08-28", buyerReference: "REF-1" },
      { name: "Ada Buyer", address: "Buyer Street 1", city: "Munich", postalCode: "80331", country: "DE" },
      [{ productName: "Product", quantity: 1, unitPrice: "10", lineTotal: "10", vatRate: "19" }],
    );
    const extracted = await extractXml(pdf);
    expect(extracted).toMatchObject({ filename: "factur-x.xml", profile: "EN16931" });
    expect(extracted.xml).toContain("RE-2026-001");
    expect(pdf.toString("latin1")).toContain("pdfaid:part");
  });
});