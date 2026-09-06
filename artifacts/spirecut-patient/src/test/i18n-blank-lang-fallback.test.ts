/**
 * i18n.ts — blank-language forced-reload fallback tests (Task #181)
 *
 * Confirms that when an admin blanks one language field and the broadcast
 * invalidation triggers a forced CMS reload in an already-open tab:
 *
 *  1. A key whose DE override is now blank reverts to the static locale
 *     default (does not retain the previous CMS override in memory).
 *  2. The other language (EN) keeps its CMS override unchanged.
 *  3. A subsequent forced reload re-applying both non-empty values restores
 *     both CMS overrides.
 *  4. The initial (non-forced) load still works normally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── We need the module to re-initialise per test ──────────────────────────────
// vi.resetModules() before each test ensures the module-level i18next init and
// the _cmsLoaded flag start fresh, giving us an isolated environment.

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A minimal flat CMS response where DE and EN are both non-empty. */
function makeCmsResponse(deVal: string, enVal: string) {
  return { "spirecut.home.hero_title": { de: deVal, en: enVal } };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(response: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => response,
  } as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Fresh module state per test: re-runs i18next.init() and resets _cmsLoaded.
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadSpirecutCmsContent — blank-language forced-reload fallback", () => {
  // ── Scenario 1: forced reload with blank DE reverts to static locale ─────────

  it("reverts DE to the static locale default after a forced reload with blank DE", async () => {
    // Step 1: initial CMS load — both DE and EN are set
    mockFetch(makeCmsResponse("Benutzerdefinierter Text", "Custom Text"));
    const { loadSpirecutCmsContent, default: i18n } = await import("../i18n");
    await loadSpirecutCmsContent(false);

    // Confirm CMS override is applied
    expect(i18n.t("home.hero_title")).toBe("Benutzerdefinierter Text");

    // Step 2: forced reload — DE is now blank, EN still set
    mockFetch(makeCmsResponse("", "Custom Text"));
    await loadSpirecutCmsContent(true);

    // DE should revert to the static locale default (from de.json)
    // The static DE value for this key doesn't exist in the fixture — i18next
    // returns the key itself when no translation is found.  What matters is
    // that it is NOT "Benutzerdefinierter Text" (the old CMS override).
    const deResult = i18n.t("home.hero_title", { lng: "de" });
    expect(deResult).not.toBe("Benutzerdefinierter Text");
  });

  // ── Scenario 2: EN keeps its CMS override after blank-DE reload ──────────────

  it("keeps the EN CMS override after a forced reload that only blanks DE", async () => {
    const customEn = "My Custom English Override";

    // Step 1: load both
    mockFetch(makeCmsResponse("Benutzerdefinierter Text", customEn));
    const { loadSpirecutCmsContent, default: i18n } = await import("../i18n");
    await loadSpirecutCmsContent(false);

    // Step 2: force reload — DE blank, EN still set
    mockFetch(makeCmsResponse("", customEn));
    await loadSpirecutCmsContent(true);

    // EN CMS override must be intact
    const enResult = i18n.t("home.hero_title", { lng: "en" });
    expect(enResult).toBe(customEn);
  });

  // ── Scenario 3: re-applying DE after blank restores CMS override ─────────────

  it("restores DE CMS override after a subsequent forced reload with DE non-empty", async () => {
    const customDe = "Neuer Benutzerdefinierter Text";
    const customEn = "New Custom English Text";

    const { loadSpirecutCmsContent, default: i18n } = await import("../i18n");

    // Load with both blank first (simulate the admin-blanked state)
    mockFetch(makeCmsResponse("", ""));
    await loadSpirecutCmsContent(false);

    // Now force-reload with both non-empty
    mockFetch(makeCmsResponse(customDe, customEn));
    await loadSpirecutCmsContent(true);

    expect(i18n.t("home.hero_title", { lng: "de" })).toBe(customDe);
    expect(i18n.t("home.hero_title", { lng: "en" })).toBe(customEn);
  });

  // ── Scenario 4: initial load (force=false) applies non-empty CMS overrides ───

  it("applies non-empty CMS overrides on the initial load", async () => {
    const customDe = "Initial Überschrift";
    const customEn = "Initial Heading";

    mockFetch(makeCmsResponse(customDe, customEn));
    const { loadSpirecutCmsContent, default: i18n } = await import("../i18n");
    await loadSpirecutCmsContent(false);

    expect(i18n.t("home.hero_title", { lng: "de" })).toBe(customDe);
    expect(i18n.t("home.hero_title", { lng: "en" })).toBe(customEn);
  });
});
