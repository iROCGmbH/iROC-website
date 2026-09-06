import { describe, expect, it } from "vitest";
import {
  isPortalProductGroupAllowed,
  isPortalProductGroupAllowedForCertifications,
} from "./portal-product-filter";

describe("portal product certification filter", () => {
  it("shows only the Spirecut group to a Spirecut-certified doctor", () => {
    const groups = ["spirecut", "ministem", "cellenis", "other", "accessories"];

    expect(groups.filter((key) => isPortalProductGroupAllowed(key, "spirecut")))
      .toEqual(["spirecut", "cellenis", "other", "accessories"]);
  });

  it("shows only the MiniStem group to a MiniStem-certified doctor", () => {
    const groups = [
      "spirecut",
      "ministem",
      "jointechlabs",
      "svf",
      "cellenis",
      "other",
      "accessories",
    ];

    expect(groups.filter((key) => isPortalProductGroupAllowed(key, "ministem")))
      .toEqual([
        "ministem",
        "jointechlabs",
        "svf",
        "cellenis",
        "other",
        "accessories",
      ]);
  });

  it("treats an SVF certification as part of the MiniStem family", () => {
    const groups = ["spirecut", "ministem", "jointechlabs", "svf", "cellenis"];

    expect(groups.filter((key) => isPortalProductGroupAllowed(key, "svf")))
      .toEqual(["ministem", "jointechlabs", "svf", "cellenis"]);
  });

  it("shows all product groups to a doctor certified for both instruments", () => {
    const groups = ["spirecut", "ministem", "cellenis"];

    expect(groups.filter((key) => isPortalProductGroupAllowed(key, "both")))
      .toEqual(groups);
  });

  it("combines separate certifications into one catalog entitlement", () => {
    const groups = ["spirecut", "ministem", "jointechlabs", "cellenis"];

    expect(groups.filter((key) =>
      isPortalProductGroupAllowedForCertifications(
        key,
        ["spirecut", "ministem"],
        "spirecut",
      ),
    )).toEqual(groups);
  });

  it("does not expose instrument-specific or shared groups for an unrecognized instrument", () => {
    expect(isPortalProductGroupAllowed("spirecut", "unknown")).toBe(false);
    expect(isPortalProductGroupAllowed("cellenis", "unknown")).toBe(false);
    expect(isPortalProductGroupAllowed("cellenis", "post_training_support")).toBe(false);
  });
});