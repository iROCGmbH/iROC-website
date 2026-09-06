import { describe, expect, it } from "vitest";
import {
  analyzeLegacyCustomerTitleCleanup,
  normalizeWebsiteCustomerNameFields,
  stripLegacyCustomerTitlePrefix,
} from "./website-customer-name";

describe("normalizeWebsiteCustomerNameFields", () => {
  it("removes a duplicated Dr. med title from both name fields", () => {
    expect(normalizeWebsiteCustomerNameFields({
      title: "Dr. med",
      firstName: "Dr. med Sarah",
      lastName: "Dr. med Mustermann",
    })).toEqual({
      firstName: "Sarah",
      lastName: "Mustermann",
    });
  });

  it("handles longer and repeated academic prefixes", () => {
    expect(normalizeWebsiteCustomerNameFields({
      title: "Dr. med.",
      firstName: "Prof. Dr. med. Dr. med. Sarah",
      lastName: "Mustermann",
    })).toEqual({
      firstName: "Sarah",
      lastName: "Mustermann",
    });
  });

  it("uses the submitted title when it is a non-standard title", () => {
    expect(normalizeWebsiteCustomerNameFields({
      title: "Dott.ssa",
      firstName: "Dott.ssa Maria",
    })).toEqual({ firstName: "Maria" });
  });

  it("does not alter names that merely start with title-like letters", () => {
    expect(normalizeWebsiteCustomerNameFields({
      title: "Dr.",
      firstName: "Drake",
      lastName: "DrSarah",
    })).toEqual({
      firstName: "Drake",
      lastName: "DrSarah",
    });
  });

  it("turns a title-only name into null", () => {
    expect(normalizeWebsiteCustomerNameFields({
      title: "Dr.",
      firstName: "Dr.",
    })).toEqual({ firstName: null });
  });
});

describe("stripLegacyCustomerTitlePrefix", () => {
  it("removes a duplicated Dr. med prefix from a legacy full name", () => {
    expect(stripLegacyCustomerTitlePrefix("Dr. med Max Mustermann", "Dr. med")).toBe("Max Mustermann");
  });

  it("removes the compound Prof. Dr. prefix from a legacy full name", () => {
    expect(stripLegacyCustomerTitlePrefix("Prof. Dr. Anna Example", "Prof. Dr.")).toBe("Anna Example");
  });

  it("keeps a title-like name prefix when no separate title is stored", () => {
    expect(stripLegacyCustomerTitlePrefix("Dr. Max Mustermann", null)).toBe("Dr. Max Mustermann");
  });
});

describe("analyzeLegacyCustomerTitleCleanup", () => {
  it("identifies a matching known prefix and removes repeated copies", () => {
    expect(analyzeLegacyCustomerTitleCleanup(
      "Dr. med Dr. med Max Mustermann",
      "Dr. med",
    )).toEqual({
      status: "duplicate",
      originalName: "Dr. med Dr. med Max Mustermann",
      cleanedName: "Max Mustermann",
      matchedPrefix: "Dr. med",
    });
  });

  it("accepts punctuation variants of the separately stored title", () => {
    expect(analyzeLegacyCustomerTitleCleanup(
      "Prof. Dr. Anna Example",
      "Professor Dr.",
    )).toMatchObject({
      status: "duplicate",
      cleanedName: "Anna Example",
    });
  });

  it("preserves a known prefix when it disagrees with the separate title", () => {
    expect(analyzeLegacyCustomerTitleCleanup(
      "Prof. Dr. Anna Example",
      "Dr. med",
    )).toEqual({
      status: "ambiguous",
      originalName: "Prof. Dr. Anna Example",
      cleanedName: "Prof. Dr. Anna Example",
      matchedPrefix: "Prof. Dr.",
    });
  });

  it("does not treat a nonstandard title as a safe backfill candidate", () => {
    expect(analyzeLegacyCustomerTitleCleanup(
      "Dott.ssa Maria Example",
      "Dott.ssa",
    )).toEqual({
      status: "unchanged",
      originalName: "Dott.ssa Maria Example",
      cleanedName: "Dott.ssa Maria Example",
      matchedPrefix: null,
    });
  });

  it("preserves title-only names instead of creating an empty required name", () => {
    expect(analyzeLegacyCustomerTitleCleanup("Dr.", "Dr.")).toMatchObject({
      status: "ambiguous",
      cleanedName: "Dr.",
    });
  });
});
