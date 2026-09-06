import { describe, expect, it } from "vitest";
import { invoiceInsuranceCoverageGap, invoiceInsuranceValue, isDirectInvoiceShipmentEligible, isPortalSourceOrder, resolveInvoiceShipmentAddress } from "./shipment-rules";

describe("invoice shipment rules", () => {
  it("prefers the dedicated shipping address over a billing address", () => {
    const address = resolveInvoiceShipmentAddress({
      first_name: "Ada",
      last_name: "Lovelace",
      customer_email: "billing@example.com",
      street: "Billing lane",
      house_number: "8",
      postal_code: "10115",
      city: "Berlin",
      country: "DE",
      shipping_street: "Delivery road",
      shipping_house_number: "17a",
      shipping_postal_code: "20095",
      shipping_city: "Hamburg",
      shipping_country: "DE",
      shipping_email: "shipping@example.com",
      shipping_first_name: "Grace",
      shipping_last_name: "Hopper",
      shipping_institution_name: "Delivery practice",
    });

    expect(address).toMatchObject({
      street: "Delivery road",
      houseNumber: "17a",
      postalCode: "20095",
      city: "Hamburg",
      email: "shipping@example.com",
      name: "Grace Hopper",
      company: "Delivery practice",
    });
  });

  it("falls back to a historical legacy customer address", () => {
    const address = resolveInvoiceShipmentAddress({
      legacy_name: "Legacy Practice",
      legacy_email: "legacy@example.com",
      legacy_street: "Old street",
      legacy_house_number: "4",
      legacy_postal_code: "50667",
      legacy_city: "Köln",
      legacy_country: "DE",
    });

    expect(address).toMatchObject({
      name: "Legacy Practice",
      street: "Old street",
      houseNumber: "4",
      postalCode: "50667",
      city: "Köln",
      email: "legacy@example.com",
    });
  });

  it("requests whole-euro full insurance only above the €800 threshold", () => {
    expect(invoiceInsuranceValue(800)).toBe(0);
    expect(invoiceInsuranceValue(800.01)).toBe(801);
    expect(invoiceInsuranceValue(1000.01)).toBe(1001);
    expect(invoiceInsuranceValue(12551.07)).toBe(5000);
    expect(invoiceInsuranceCoverageGap(12551.07)).toBe(7552);
  });

  it("permits manual and iROC Portal draft invoices, but not other website orders", () => {
    expect(isDirectInvoiceShipmentEligible("draft", null)).toBe(true);
    expect(isDirectInvoiceShipmentEligible("sent", null)).toBe(false);
    expect(isDirectInvoiceShipmentEligible("draft", 12)).toBe(false);
    expect(isDirectInvoiceShipmentEligible("draft", 12, '{"source":"iroc_portal"}')).toBe(true);
    expect(isDirectInvoiceShipmentEligible("sent", 12, '{"source":"iroc_portal"}')).toBe(false);
    expect(isPortalSourceOrder('{"source":"iroc_portal","structuredProducts":true}')).toBe(true);
    expect(isPortalSourceOrder("not-json")).toBe(false);
  });
});