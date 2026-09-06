import { describe, it, expect } from "vitest";
import { specialtyToProductGroup, groupLabelDe, groupLabelEn, groupSubjectDe, groupSubjectEn } from "./sally-groups.js";

describe("specialtyToProductGroup", () => {
  // ── Spirecut ─────────────────────────────────────────────────────────────
  it.each([
    "Hand Surgery",
    "Handchirurgie",
    "Hand Surgeon",
    "Spirecut",
    "wrist surgeon",
  ])("maps %s → spirecut", (s) => {
    expect(specialtyToProductGroup(s)).toBe("spirecut");
  });

  // ── MiniStem / Jointechlabs ───────────────────────────────────────────────
  it.each([
    "MFAT",
    "SVF",
    "Micro Fat Transfer",
    "Mikrofetttransplantation",
    "Stromal Vascular Fraction",
    "MiniStem",
    "Jointechlabs",
    "stem cell therapy",
    "adipose tissue",
  ])("maps %s → ministem", (s) => {
    expect(specialtyToProductGroup(s)).toBe("ministem");
  });

  // ── Cellenis / Estar Medical ──────────────────────────────────────────────
  it.each([
    "PRP",
    "PRF",
    "Platelet-Rich Plasma",
    "Platelet Rich Fibrin",
    "Exosomes",
    "Exosome Therapy",
    "Cellenis",
    "Estar Medical",
    "regenerative medicine",
    "Thrombozytenreiches Plasma",
  ])("maps %s → cellenis", (s) => {
    expect(specialtyToProductGroup(s)).toBe("cellenis");
  });

  // ── Unrecognised / empty → general ───────────────────────────────────────
  it.each([null, undefined, "", "Orthopedics", "General Medicine", "Physiotherapy"])(
    "maps %s → '' (general)",
    (s) => {
      expect(specialtyToProductGroup(s)).toBe("");
    },
  );

  // MiniStem wins over Spirecut when BOTH keywords are present
  it("prefers ministem over spirecut when mfat keyword is present", () => {
    expect(specialtyToProductGroup("Hand surgery with MFAT interest")).toBe("ministem");
  });
});

describe("label helpers", () => {
  it("produces non-empty labels for all groups", () => {
    for (const g of ["spirecut", "ministem", "cellenis", ""] as const) {
      expect(groupLabelDe(g).length).toBeGreaterThan(0);
      expect(groupLabelEn(g).length).toBeGreaterThan(0);
      expect(groupSubjectDe(g).length).toBeGreaterThan(0);
      expect(groupSubjectEn(g).length).toBeGreaterThan(0);
    }
  });

  it("spirecut labels reference Spirecut", () => {
    expect(groupLabelDe("spirecut")).toContain("Spirecut");
    expect(groupLabelEn("spirecut")).toContain("Spirecut");
  });

  it("ministem labels reference MiniStem and Jointechlabs", () => {
    expect(groupLabelDe("ministem")).toContain("MiniStem");
    expect(groupLabelEn("ministem")).toContain("Jointechlabs");
  });

  it("cellenis labels reference Cellenis/Estar and PRP", () => {
    expect(groupLabelDe("cellenis")).toContain("Cellenis");
    expect(groupLabelEn("cellenis")).toContain("Estar");
    expect(groupLabelEn("cellenis")).toContain("PRP");
  });
});
