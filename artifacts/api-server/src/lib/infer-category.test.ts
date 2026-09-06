/**
 * Unit tests for inferCategory.
 *
 * What & Why
 * ──────────
 * inferCategory resolves an invoice item to one of the revenue categories
 * ("spirecut", "ministem", "services", "other") used by the revenue breakdown.
 *
 * The function has three priority levels:
 *   1. linkedCategory (from the joined iroc_products row) — returned as-is when present.
 *   2. Keyword scan of productName — detects "spirecut", "ministem", "cellenis", and "service".
 *   3. Fallback to "other".
 *
 * Test 1 — linkedCategory "services" is returned verbatim
 *   An item whose linked product has category = "services" must return "services"
 *   regardless of what productName contains.
 *
 * Test 2 — unlinked item with service-sounding name reaches "services"
 *   An item with linkedCategory = null and productName = "Consulting Service" must
 *   return "services" via keyword inference.
 *
 * Test 3 — linkedCategory wins over any keyword in productName
 *   An item whose linked product has category = "services" but whose productName
 *   contains "spirecut" still returns "services" (linkedCategory takes priority).
 *
 * Test 4 — unlinked "spirecut" keyword still resolves correctly
 *   An item with linkedCategory = null and productName "Spirecut® Kit" must return
 *   "spirecut" via keyword inference.
 *
 * Test 5 — unlinked "ministem" keyword (both spellings) resolves correctly
 *   "mini stem" and "ministem" both match.
 *
 * Test 6 — fully unlinked, generic name falls back to "other"
 *   An item with no linked product and a name like "Miscellaneous" returns "other".
 *
 * Test 7 — keyword match is case-insensitive
 *   "SPIRECUT" and "Mini Stem" both match despite different casing.
 */

import { describe, it, expect } from "vitest";
import { inferCategory } from "./infer-category";

describe("inferCategory", () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it("returns 'services' when linkedCategory is 'services', regardless of productName", () => {
    expect(inferCategory("services", "Consulting Service")).toBe("services");
    expect(inferCategory("services", "Annual Maintenance")).toBe("services");
    expect(inferCategory("services", "spirecut training")).toBe("services");
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it("returns 'services' when linkedCategory is null and productName sounds like a service", () => {
    expect(inferCategory(null, "Consulting Service")).toBe("services");
    expect(inferCategory(null, "Service Package")).toBe("services");
    expect(inferCategory(null, "On-site Service")).toBe("services");
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it("linkedCategory takes priority over productName keywords", () => {
    expect(inferCategory("services", "Spirecut® Kit")).toBe("services");
    expect(inferCategory("ministem", "spirecut combo")).toBe("ministem");
    expect(inferCategory("other", "ministem device")).toBe("other");
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it("returns 'spirecut' when linkedCategory is null and productName contains 'spirecut'", () => {
    expect(inferCategory(null, "Spirecut® Kit")).toBe("spirecut");
    expect(inferCategory(null, "spirecut starter pack")).toBe("spirecut");
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it("returns 'ministem' when linkedCategory is null and productName contains 'ministem' or 'mini stem'", () => {
    expect(inferCategory(null, "MiniStem Device")).toBe("ministem");
    expect(inferCategory(null, "mini stem kit")).toBe("ministem");
    expect(inferCategory(null, "ministem pro")).toBe("ministem");
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it("returns 'other' when linkedCategory is null and productName has no recognised keyword", () => {
    expect(inferCategory(null, "Miscellaneous")).toBe("other");
    expect(inferCategory(null, "")).toBe("other");
    expect(inferCategory(null, "Annual Report")).toBe("other");
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it("keyword matching is case-insensitive", () => {
    expect(inferCategory(null, "SPIRECUT BUNDLE")).toBe("spirecut");
    expect(inferCategory(null, "Mini Stem Pro")).toBe("ministem");
    expect(inferCategory(null, "SpireCut Classic")).toBe("spirecut");
  });
});
