import { describe, expect, it } from "vitest";
import {
  recipientLanguageForCountry,
  supplierReorderLanguageContext,
} from "./recipient-language";

describe("recipientLanguageForCountry", () => {
  it.each([
    "DE",
    "deu",
    "Germany",
    "Deutschland",
    "AT",
    "aut",
    "Austria",
    "Österreich",
    "Oesterreich",
  ])("uses German for %s", (country) => {
    expect(recipientLanguageForCountry(country)).toBe("de");
  });

  it.each(["Switzerland", "CH", "France", "", null, undefined])(
    "uses English for %s",
    (country) => {
      expect(recipientLanguageForCountry(country)).toBe("en");
    },
  );
});

describe("supplierReorderLanguageContext", () => {
  it("requires German only for German and Austrian suppliers", () => {
    expect(supplierReorderLanguageContext("Deutschland")).toContain(
      "Required Email Language: German",
    );
    expect(supplierReorderLanguageContext("AT")).toContain(
      "Required Email Language: German",
    );
  });

  it("requires English when the supplier country is unknown or non-German", () => {
    expect(supplierReorderLanguageContext(null)).toContain(
      "Required Email Language: English",
    );
    expect(supplierReorderLanguageContext("France")).toContain(
      "Required Email Language: English",
    );
  });
});