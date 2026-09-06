/**
 * Unit test — shared VAT normalization/validation used by invoice creation AND
 * the non-binding offer PDF endpoint (POST /iroc/invoices/offer-pdf).
 *
 * Why: the offer endpoint must reject the same tax-invalid combinations as the
 * real invoice route (7 % only domestic, 0 % mandatory for EU/export/non-EU/
 * lecture types, no 0 % domestic), so a direct API request cannot generate an
 * offer PDF an invoice could never have.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeAndValidateLineVatRates,
  normalizeAndValidateVat,
  validateSavedTrainingOfferVat,
} from "./iroc";

describe("normalizeAndValidateVat — offer/invoice VAT guard parity", () => {
  it("rejects 7 % on non-domestic types", () => {
    for (const type of ["eu", "export", "noneu", "lecture-eu", "lecture-noneu"]) {
      const r = normalizeAndValidateVat(type, "7.00");
      expect(r).toHaveProperty("error");
    }
  });

  it("rejects non-zero VAT on zero-VAT invoice types", () => {
    for (const type of ["eu", "export", "noneu", "lecture-eu", "lecture-noneu"]) {
      const r = normalizeAndValidateVat(type, "19.00");
      expect(r).toHaveProperty("error");
    }
  });

  it("rejects 0 % on domestic invoices", () => {
    expect(normalizeAndValidateVat("domestic", "0")).toHaveProperty("error");
  });

  it("accepts valid combinations", () => {
    expect(normalizeAndValidateVat("domestic", "19.00")).toEqual({ rate: 19 });
    expect(normalizeAndValidateVat("domestic", "7.00")).toEqual({ rate: 7 });
    expect(normalizeAndValidateVat("eu", "0.00")).toEqual({ rate: 0 });
    expect(normalizeAndValidateVat("export", "0")).toEqual({ rate: 0 });
  });

  it("defaults when vatRate is missing: 19 % domestic, 0 % otherwise", () => {
    expect(normalizeAndValidateVat("domestic", undefined)).toEqual({ rate: 19 });
    expect(normalizeAndValidateVat("eu", null)).toEqual({ rate: 0 });
  });

  it("normalises fractional rates (0.19 → 19 %)", () => {
    expect(normalizeAndValidateVat("domestic", "0.19")).toEqual({ rate: 19 });
  });

  it.each(["NaN", "Infinity", "-Infinity"])("rejects non-finite VAT rate %s", (vatRate) => {
    expect(normalizeAndValidateVat("domestic", vatRate)).toEqual({ error: "VAT rate must be numeric." });
  });
});

describe("normalizeAndValidateLineVatRates", () => {
  it("rejects taxable lines on zero-VAT invoices", () => {
    expect(normalizeAndValidateLineVatRates("eu", 0, ["19"])).toHaveProperty("error");
  });

  it("normalizes fractions and permits only supported domestic rates", () => {
    expect(normalizeAndValidateLineVatRates("domestic", 19, ["0.07", "19"]))
      .toEqual({ rates: [7, 19] });
    expect(normalizeAndValidateLineVatRates("domestic", 19, ["5"])).toHaveProperty("error");
    expect(normalizeAndValidateLineVatRates("domestic", 19, ["not-a-rate"])).toHaveProperty("error");
  });
});

describe("validateSavedTrainingOfferVat", () => {
  it("rejects corrupted persisted line VAT before an offer can be reused", () => {
    expect(validateSavedTrainingOfferVat("domestic", "19", [
      { vatRate: "19" },
      { vatRate: "corrupted" },
    ])).toContain("Item 2 has an invalid VAT rate");
  });

  it("keeps legacy lines without an explicit VAT rate by inheriting the offer rate", () => {
    expect(validateSavedTrainingOfferVat("domestic", "7", [{ productName: "Legacy line" }]))
      .toBeNull();
  });
});
