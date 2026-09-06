import { describe, expect, it } from "vitest";
import { getInvoiceTypeLabel } from "./utils";

describe("getInvoiceTypeLabel", () => {
  const expectedLabels = [
    ["domestic", "Inland", "Domestic"],
    ["eu", "EU", "EU"],
    ["export", "Export", "Export"],
    ["noneu", "Nicht-EU", "Non-EU"],
    ["lecture-eu", "Vortrag EU", "Lecture EU"],
    ["lecture-noneu", "Vortrag Nicht-EU", "Lecture Non-EU"],
  ] as const;

  it.each(expectedLabels)(
    "returns the shared German and English labels for %s",
    (type, germanLabel, englishLabel) => {
      expect(getInvoiceTypeLabel(type, "de")).toBe(germanLabel);
      expect(getInvoiceTypeLabel(type, "en")).toBe(englishLabel);
    },
  );
});