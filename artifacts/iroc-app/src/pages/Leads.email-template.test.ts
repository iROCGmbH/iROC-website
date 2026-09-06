import { describe, expect, it } from "vitest";
import { recipientLanguageForCountry } from "@/lib/recipient-language";

describe("lead invitation email template language", () => {
  it.each([
    "Germany",
    "Deutschland",
    "Bundesrepublik Deutschland",
    "DE",
    "DEU",
    "Austria",
    "Österreich",
    "Oesterreich",
    "AT",
    "AUT",
  ])("uses German templates for %s", (country) => {
    expect(recipientLanguageForCountry(country)).toBe("de");
  });

  it.each(["United Kingdom", "Switzerland", "", null, undefined])(
    "uses English templates for %s",
    (country) => {
      expect(recipientLanguageForCountry(country)).toBe("en");
    },
  );

  it("accepts country values with different case and whitespace", () => {
    expect(recipientLanguageForCountry("  deutschland  ")).toBe("de");
    expect(recipientLanguageForCountry("aT")).toBe("de");
  });
});