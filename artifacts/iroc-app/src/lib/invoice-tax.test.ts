import { describe, expect, it } from "vitest";
import { computeDefaultInvoiceTax, normalizeCountryCode } from "@workspace/api-zod";
import {
  computeDefaultInvoiceLanguage,
  inferInvoiceOriginCountry,
  inferInvoiceSupplyKind,
  resolveInvoiceDestinationCountry,
} from "./invoice-tax";

describe("automatic invoice tax treatment", () => {
  it("uses domestic VAT when origin and destination are the same", () => {
    const tax = computeDefaultInvoiceTax({
      destinationCountry: "Germany",
      originCountry: "DE",
      supplyKind: "goods",
      lang: "de",
    });

    expect(tax.invoiceType).toBe("domestic");
    expect(tax.vatRate).toBe(19);
  });

  it("normalizes localized European country names before choosing the invoice type", () => {
    expect(normalizeCountryCode("Österreich")).toBe("AT");
    expect(normalizeCountryCode("Italien")).toBe("IT");

    const tax = computeDefaultInvoiceTax({
      destinationCountry: "Österreich",
      originCountry: "Deutschland",
      supplyKind: "goods",
      lang: "de",
    });

    expect(tax.invoiceType).toBe("eu");
    expect(tax.vatRate).toBe(0);
  });

  it("uses a populated shipping country instead of the billing country", () => {
    expect(resolveInvoiceDestinationCountry("Österreich", "Deutschland")).toBe("Österreich");
    expect(resolveInvoiceDestinationCountry(null, "Deutschland")).toBe("Deutschland");
  });

  it.each([
    ["DE", "de"],
    ["Germany", "de"],
    ["Deutschland", "de"],
    ["AT", "de"],
    ["Austria", "de"],
    ["Österreich", "de"],
    ["CH", "en"],
    ["Switzerland", "en"],
    [null, "en"],
  ] as const)("defaults %s to %s invoice language", (country, expected) => {
    expect(computeDefaultInvoiceLanguage(null, country)).toBe(expected);
  });

  it("prefers shipping country over billing country for the language default", () => {
    expect(computeDefaultInvoiceLanguage("Austria", "Germany")).toBe("de");
    expect(computeDefaultInvoiceLanguage("Switzerland", "Germany")).toBe("en");
  });

  it("uses the goods clauses for EU and third-country destinations", () => {
    const euTax = computeDefaultInvoiceTax({
      destinationCountry: "France",
      originCountry: "Germany",
      supplyKind: "goods",
      lang: "de",
    });
    const exportTax = computeDefaultInvoiceTax({
      destinationCountry: "GB",
      originCountry: "Germany",
      supplyKind: "goods",
      lang: "en",
    });

    expect(euTax.invoiceType).toBe("eu");
    expect(euTax.vatRate).toBe(0);
    expect(euTax.vatNote).toContain("§ 6a");
    expect(exportTax.invoiceType).toBe("export");
    expect(exportTax.vatRate).toBe(0);
    expect(exportTax.vatNote).toContain("§ 6");
  });

  it("uses the service clauses for teaching and consulting categories", () => {
    const items = [{
      productId: 7,
      productName: "Advanced training",
      countryOfOrigin: "Germany",
    }];
    const products = [{ id: 7, category: "services" }];
    const groups = [{ key: "services", isService: true }];
    const supplyKind = inferInvoiceSupplyKind(items, products, groups);

    expect(supplyKind).toBe("service");
    expect(inferInvoiceOriginCountry(items)).toBe("Germany");

    const euTax = computeDefaultInvoiceTax({
      destinationCountry: "NL",
      originCountry: "Germany",
      supplyKind,
      lang: "de",
    });
    const thirdCountryTax = computeDefaultInvoiceTax({
      destinationCountry: "United States",
      originCountry: "Germany",
      supplyKind,
      lang: "de",
    });

    expect(euTax.invoiceType).toBe("lecture-eu");
    expect(euTax.vatRate).toBe(0);
    expect(euTax.vatNote).toContain("§ 13b");
    expect(thirdCountryTax.invoiceType).toBe("lecture-noneu");
    expect(thirdCountryTax.vatRate).toBe(0);
    expect(thirdCountryTax.vatNote).toMatch(/Nicht steuerbar/i);
  });
});