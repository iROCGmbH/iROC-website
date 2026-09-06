/**
 * i18n.ts — failed forced re-fetch resilience tests (Task #183)
 *
 * Confirms that when `loadSpirecutCmsContent(true)` is called (e.g. after an
 * admin save) but the fetch fails, the previously-loaded i18next translations
 * remain intact and the page continues to show the last-known-good content.
 *
 * Two failure modes are covered:
 *  1. Network error (fetch() rejects) — the catch block restores _cmsLoaded.
 *  2. Non-OK HTTP response (e.g. 503) — the non-ok branch restores _cmsLoaded.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CMS_KEY = "spirecut.home.hero_title";
const I18N_KEY = "home.hero_title";

const INITIAL_DE = "Willkommen bei Spirecut";
const INITIAL_EN = "Welcome to Spirecut";

/** A successful CMS response with the given DE and EN values. */
function makeOkFetch(deVal: string, enVal: string) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ [CMS_KEY]: { de: deVal, en: enVal } }),
  } as Response);
}

/** Simulate a fetch() network rejection (e.g. DNS failure, offline). */
function makeNetworkErrorFetch() {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new TypeError("Failed to fetch")
  );
}

/** Simulate a non-OK HTTP response (e.g. 503 Service Unavailable). */
function makeNonOkFetch(status = 503) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  } as Response);
}

// ── Per-test reset ────────────────────────────────────────────────────────────

beforeEach(() => {
  // Fresh module state per test — re-runs i18next.init() and resets _cmsLoaded.
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadSpirecutCmsContent — failed forced re-fetch resilience", () => {
  // ── Case 1: network error on forced re-fetch ──────────────────────────────

  it("preserves previously-loaded DE and EN translations when fetch() throws a network error", async () => {
    // Step 1: initial successful load — bundles are injected into i18next.
    makeOkFetch(INITIAL_DE, INITIAL_EN);
    const { loadSpirecutCmsContent, default: i18n } = await import("../i18n");
    await loadSpirecutCmsContent(false);

    // Confirm CMS overrides are active before the failure.
    expect(i18n.t(I18N_KEY, { lng: "de" })).toBe(INITIAL_DE);
    expect(i18n.t(I18N_KEY, { lng: "en" })).toBe(INITIAL_EN);

    // Step 2: forced re-fetch fails with a network error.
    makeNetworkErrorFetch();
    await loadSpirecutCmsContent(true);

    // Translations must still be the last-known-good CMS values.
    expect(i18n.t(I18N_KEY, { lng: "de" })).toBe(INITIAL_DE);
    expect(i18n.t(I18N_KEY, { lng: "en" })).toBe(INITIAL_EN);
  });

  // ── Case 2: non-OK response (503) on forced re-fetch ─────────────────────

  it("preserves previously-loaded DE and EN translations when the API returns 503", async () => {
    // Step 1: initial successful load.
    makeOkFetch(INITIAL_DE, INITIAL_EN);
    const { loadSpirecutCmsContent, default: i18n } = await import("../i18n");
    await loadSpirecutCmsContent(false);

    expect(i18n.t(I18N_KEY, { lng: "de" })).toBe(INITIAL_DE);
    expect(i18n.t(I18N_KEY, { lng: "en" })).toBe(INITIAL_EN);

    // Step 2: forced re-fetch returns 503.
    makeNonOkFetch(503);
    await loadSpirecutCmsContent(true);

    // Bundles must remain intact.
    expect(i18n.t(I18N_KEY, { lng: "de" })).toBe(INITIAL_DE);
    expect(i18n.t(I18N_KEY, { lng: "en" })).toBe(INITIAL_EN);
  });

  // ── Case 3: _cmsLoaded flag is restored after network error ──────────────
  // A failing forced refresh must NOT leave _cmsLoaded=false, which would
  // cause every subsequent non-forced call to attempt a redundant re-fetch.

  it("does not clear _cmsLoaded after a network error so non-forced calls remain no-ops", async () => {
    // Step 1: initial successful load.
    makeOkFetch(INITIAL_DE, INITIAL_EN);
    const { loadSpirecutCmsContent, default: i18n } = await import("../i18n");
    await loadSpirecutCmsContent(false);

    // Step 2: forced re-fetch fails.
    makeNetworkErrorFetch();
    await loadSpirecutCmsContent(true);

    // Step 3: a subsequent non-forced call should be a no-op — it must not
    // attempt a new fetch (which would replace the mock and fail the assertion).
    // We verify this by replacing the mock with a spy that would overwrite
    // the translations if called, then confirming translations are unchanged.
    makeOkFetch("OVERWRITTEN_DE", "OVERWRITTEN_EN");
    await loadSpirecutCmsContent(false); // should be skipped due to _cmsLoaded

    // The translations must still be the originally-loaded values, not the
    // "overwritten" values that a fresh fetch would have produced.
    expect(i18n.t(I18N_KEY, { lng: "de" })).toBe(INITIAL_DE);
    expect(i18n.t(I18N_KEY, { lng: "en" })).toBe(INITIAL_EN);
  });

  // ── Case 4: _cmsLoaded flag is restored after a non-OK response ──────────

  it("does not clear _cmsLoaded after a 503 so non-forced calls remain no-ops", async () => {
    // Step 1: initial successful load.
    makeOkFetch(INITIAL_DE, INITIAL_EN);
    const { loadSpirecutCmsContent, default: i18n } = await import("../i18n");
    await loadSpirecutCmsContent(false);

    // Step 2: forced re-fetch returns 503.
    makeNonOkFetch(503);
    await loadSpirecutCmsContent(true);

    // Step 3: non-forced call must be skipped — _cmsLoaded was restored to true.
    makeOkFetch("OVERWRITTEN_DE", "OVERWRITTEN_EN");
    await loadSpirecutCmsContent(false);

    expect(i18n.t(I18N_KEY, { lng: "de" })).toBe(INITIAL_DE);
    expect(i18n.t(I18N_KEY, { lng: "en" })).toBe(INITIAL_EN);
  });
});
