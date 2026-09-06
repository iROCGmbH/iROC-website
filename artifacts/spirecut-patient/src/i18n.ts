import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "./locales/de.json";
import en from "./locales/en.json";

// Deep-clone the static locale objects immediately at module load — before
// i18next's internal deepExtend() can mutate them.  i18next stores the
// resources by reference, so every addResourceBundle() call with deep=true
// modifies the original `de`/`en` objects in place.  Saving pristine copies
// here ensures the forced-reload reset always starts from uncontaminated data.
const DE_PRISTINE: typeof de = JSON.parse(JSON.stringify(de));
const EN_PRISTINE: typeof en = JSON.parse(JSON.stringify(en));

const STORAGE_KEY = "spirecut_lang";
const savedLang = localStorage.getItem(STORAGE_KEY) ?? "de";

function syncDocumentLanguage(lng: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng.startsWith("en") ? "en" : "de";
  }
}

i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: "de",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (lng) => {
  localStorage.setItem(STORAGE_KEY, lng);
  syncDocumentLanguage(lng);
});
syncDocumentLanguage(savedLang);

// ── CMS content loader ────────────────────────────────────────────────────────

/** Reconstruct a nested object from a dot-notation path + value. */
function setPath(obj: Record<string, unknown>, path: string, value: string) {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextKey = parts[i + 1];
    if (cur[key] === undefined || cur[key] === null) {
      cur[key] = /^\d+$/.test(nextKey) ? [] : {};
    }
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Fetch CMS-overridden content from the API and inject it into i18next.
 * Safe to call multiple times — a guard prevents duplicate loads.
 *
 * @param force  When true, bypasses the browser HTTP cache (cache:'no-store')
 *               so an admin-save invalidation always fetches fresh data even
 *               within the server's 30-second max-age window.
 */
let _cmsLoaded = false;

export async function loadSpirecutCmsContent(force = false): Promise<void> {
  if (_cmsLoaded && !force) return;
  // Snapshot the previous loaded state so we can restore it on error.
  // A failing forced refresh (e.g. API temporarily offline) must NOT clear
  // the bundles that were already injected by a previous successful load —
  // the existing i18next bundles stay in place because we never remove them
  // before fetching.  Restoring _cmsLoaded ensures a transient failure
  // doesn't mark the content as "dirty" and trigger repeated re-fetches.
  const previouslyLoaded = _cmsLoaded;
  try {
    const fetchOptions: RequestInit = force ? { cache: "no-store" } : {};
    const res = await fetch("/api/content/spirecut", fetchOptions);
    if (!res.ok) {
      // Non-2xx response — treat as a failed refresh; keep existing bundles.
      _cmsLoaded = previouslyLoaded;
      return;
    }
    const flat: Record<string, { de: string; en: string }> = await res.json();

    const deBundle: Record<string, unknown> = {};
    const enBundle: Record<string, unknown> = {};

    for (const [fullKey, { de: deVal, en: enVal }] of Object.entries(flat)) {
      // Strip the 'spirecut.' prefix to get the i18next path
      const key = fullKey.replace(/^spirecut\./, "");
      // Skip empty overrides — an admin accidentally blanking a field should
      // fall back to the hardcoded i18next default, not produce a blank string.
      if (deVal !== "") setPath(deBundle, key, deVal);
      if (enVal !== "") setPath(enBundle, key, enVal);
    }

    if (force) {
      // On a forced refresh (admin save / cross-tab invalidation) we must first
      // reset the in-memory i18next bundles to the static locale so that any
      // key the admin intentionally blanked reverts to its hardcoded default
      // rather than retaining the previous CMS override in memory.
      //
      // We use JSON.parse(JSON.stringify(...)) to deep-clone the static locale
      // objects before passing them to addResourceBundle.  This is necessary
      // because i18next's internal deepExtend() mutates the target bundle in
      // place — which, after a shallow spread (`{...de}`), means the original
      // imported `de` / `en` objects get mutated too.  Passing a mutated `de`
      // as the "reset" baseline would leave old CMS keys intact.  The deep
      // clone guarantees we always start from a clean copy of the static locale.
      //
      // addResourceBundle with deep=false, overwrite=true replaces the entire
      // namespace bundle with the cloned static locale, giving us a clean slate
      // before we apply only non-empty CMS overrides on top.
      i18n.addResourceBundle("de", "translation", JSON.parse(JSON.stringify(DE_PRISTINE)) as typeof de, false, true);
      i18n.addResourceBundle("en", "translation", JSON.parse(JSON.stringify(EN_PRISTINE)) as typeof en, false, true);
    }

    i18n.addResourceBundle("de", "translation", deBundle, true, true);
    i18n.addResourceBundle("en", "translation", enBundle, true, true);
    // Force all useTranslation() consumers to re-render by triggering a
    // language "change" to the same language. This is the most reliable way
    // to flush the i18next translation cache in react-i18next.
    await i18n.changeLanguage(i18n.language);
    _cmsLoaded = true;
  } catch {
    // Network error or parse failure — restore the previous loaded state so
    // the existing i18next bundles (already in memory) are preserved and the
    // page continues to show the last-known-good CMS content.
    _cmsLoaded = previouslyLoaded;
  }
}

/** Call after an admin save so the next app load fetches fresh content. */
export function invalidateSpirecutCmsCache() {
  _cmsLoaded = false;
  // Notify same-tab subscribers
  cmsInvalidationListeners.forEach((fn) => fn());
  // Notify other open tabs (e.g. the public Spirecut site when admin is in iroc-app)
  getSpirecutCmsChannel()?.postMessage("invalidate");
}

// ── BroadcastChannel for cross-tab CMS invalidation ──────────────────────────
const SPIRECUT_CMS_CHANNEL_NAME = "spirecut-cms-content-invalidate";
let _cmsBc: BroadcastChannel | null = null;

function getSpirecutCmsChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!_cmsBc) _cmsBc = new BroadcastChannel(SPIRECUT_CMS_CHANNEL_NAME);
  return _cmsBc;
}

/** Subscribers are notified when the CMS cache is invalidated from any tab. */
export const cmsInvalidationListeners = new Set<() => void>();

// Listen for invalidation messages from other tabs (e.g. the iroc-app admin)
if (typeof BroadcastChannel !== "undefined") {
  const bc = getSpirecutCmsChannel();
  if (bc) {
    bc.onmessage = async () => {
      _cmsLoaded = false;
      // Re-load with cache:'no-store' so we bypass the 30-second browser HTTP
      // cache and pick up the admin's changes immediately.
      await loadSpirecutCmsContent(true);
      cmsInvalidationListeners.forEach((fn) => fn());
    };
  }
}

export default i18n;
