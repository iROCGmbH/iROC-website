import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'EN' | 'DE';

/** All valid language codes — import this instead of hand-writing string literals. */
export const LANGUAGES = ['DE', 'EN'] as const satisfies Language[];

/**
 * Translation convention — choose the right helper:
 *
 *  t(de, en)      Plain string translation. Checks the CMS override map first
 *                 (keyed by the original German text), then falls back to the
 *                 hardcoded string.
 *
 *  tJSX(de, en)   Rich-content translation. Returns ReactNode.
 *
 *  language       Raw language value ('DE' | 'EN'). Use ONLY for non-content
 *                 logic: active-state styling, data fetching params, etc.
 */
interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (de: string, en: string) => string;
  tJSX: (de: React.ReactNode, en: React.ReactNode) => React.ReactNode;
  /** The raw CMS map — key is the original DE label, value is { de, en } */
  cmsMap: Map<string, { de: string; en: string }>;
  /** Force-replace the entire CMS map (called after a CMS save in the admin) */
  setCmsMap: (map: Map<string, { de: string; en: string }>) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// ── Module-level singleton cache ──────────────────────────────────────────────
type CmsMap = Map<string, { de: string; en: string }>;
type CmsFetchResult = { requestId: number; map: CmsMap };

let _cmsPromise: Promise<CmsFetchResult | null> | null = null;
let _cmsPromiseRequestId: number | null = null;
let _cmsRequestId = 0;
let _latestCmsSuccess: CmsFetchResult | null = null;

function parseCmsMap(
  data: Record<string, { de: string; en: string; label: string }>,
): Map<string, { de: string; en: string }> {
  const map = new Map<string, { de: string; en: string }>();
  for (const entry of Object.values(data)) {
    map.set(entry.label, { de: entry.de, en: entry.en });
  }
  return map;
}

/** Normal load — may use the browser HTTP cache (max-age=30). */
function startCmsFetch(
  options?: RequestInit,
): Promise<CmsFetchResult | null> {
  const requestId = ++_cmsRequestId;
  const requestPromise = fetch('/api/content/iroc', options)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<
        Record<string, { de: string; en: string; label: string }>
      >;
    })
    .then((data) => ({ requestId, map: parseCmsMap(data) }))
    .catch(() => {
      // Only clear the current cache entry. An older overlapping request must
      // not clear a newer request that is still in flight.
      if (_cmsPromiseRequestId === requestId) {
        _cmsPromise = null;
        _cmsPromiseRequestId = null;
      }
      return null;
    });

  _cmsPromise = requestPromise;
  _cmsPromiseRequestId = requestId;
  return requestPromise;
}

/** Normal load — may use the browser HTTP cache (max-age=30). */
function fetchCmsMap(): Promise<CmsFetchResult | null> {
  if (_cmsPromise) return _cmsPromise;
  return startCmsFetch();
}

/**
 * Invalidation-triggered re-fetch — always bypasses the browser HTTP cache so
 * the 30-second max-age doesn't serve stale content after an admin save.
 */
function forceFetchCmsMap(): Promise<CmsFetchResult | null> {
  return startCmsFetch({ cache: 'no-store' });
}

/**
 * Record a successful response only if it belongs to a newer request. An
 * older response can still resolve after a newer one, but must never replace
 * the newest successful CMS map.
 */
function commitCmsResult(result: CmsFetchResult | null): CmsMap | null {
  if (!result) return null;
  if (
    !_latestCmsSuccess ||
    result.requestId > _latestCmsSuccess.requestId
  ) {
    _latestCmsSuccess = result;
  }
  return _latestCmsSuccess.map;
}

// ── BroadcastChannel for cross-tab CMS invalidation ──────────────────────────
const IROC_CMS_CHANNEL_NAME = 'iroc-cms-content-invalidate';
let _cmsBc: BroadcastChannel | null = null;

function getIrocCmsChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!_cmsBc) _cmsBc = new BroadcastChannel(IROC_CMS_CHANNEL_NAME);
  return _cmsBc;
}

/** Subscribers (LanguageProvider instances) are notified when the cache is invalidated. */
const cmsInvalidationListeners = new Set<() => void>();

// Listen for invalidation messages from other tabs / the admin page
if (typeof BroadcastChannel !== 'undefined') {
  const bc = getIrocCmsChannel();
  if (bc) {
    bc.onmessage = () => {
      _cmsPromise = null;
      cmsInvalidationListeners.forEach((fn) => fn());
    };
  }
}

/** Call this after the admin saves CMS changes so the next t() call gets fresh data. */
export function invalidateIrocCmsCache() {
  _cmsPromise = null;
  // Notify same-tab subscribers
  cmsInvalidationListeners.forEach((fn) => fn());
  // Notify other open tabs (e.g. the public iROC website when admin is in iroc-app)
  getIrocCmsChannel()?.postMessage('invalidate');
}

// ─────────────────────────────────────────────────────────────────────────────

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguage] = useState<Language>('DE');
  const [cmsMap, setCmsMap] = useState<CmsMap>(
    () => _latestCmsSuccess?.map ?? new Map(),
  );

  useEffect(() => {
    const saved = localStorage.getItem('iroc_language') as Language;
    if (saved === 'EN' || saved === 'DE') {
      setLanguage(saved);
    } else if (saved !== null) {
      // Keep persisted state aligned with the documented German fallback.
      localStorage.setItem('iroc_language', 'DE');
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language.toLowerCase();
  }, [language]);

  // Load CMS content once on mount
  useEffect(() => {
    fetchCmsMap().then((result) => {
      const map = commitCmsResult(result);
      if (map && map.size > 0) setCmsMap(map);
    });
  }, []);

  // Subscribe to cross-tab CMS invalidation events so the page re-renders with
  // fresh content after an admin save — without requiring a page reload.
  // Uses cache:'no-store' to bypass the 30-second browser HTTP cache.
  // Passes the current map as a fallback so a transient API error doesn't wipe
  // all CMS content from the page.
  useEffect(() => {
    let alive = true;

    const refreshCmsMap = () => {
      forceFetchCmsMap().then((result) => {
        const map = commitCmsResult(result);
        if (alive && map) setCmsMap(map);
      });
    };

    const onInvalidate = refreshCmsMap;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshCmsMap();
      }
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refreshCmsMap();
    };

    cmsInvalidationListeners.add(onInvalidate);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      alive = false;
      cmsInvalidationListeners.delete(onInvalidate);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('iroc_language', lang);
  };

  const t = (de: string, en: string): string => {
    const override = cmsMap.get(de);
    if (override) {
      const val = language === 'DE' ? override.de : override.en;
      // Treat an empty CMS override as "no override" — fall back to the
      // hardcoded string so an admin accidentally blanking a field never
      // leaves a blank gap on the page.
      if (val !== '') return val;
    }
    return language === 'DE' ? de : en;
  };

  const tJSX = (de: React.ReactNode, en: React.ReactNode): React.ReactNode => {
    // For JSX nodes we can't do text-based CMS lookup — return as-is
    return language === 'DE' ? de : en;
  };

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage: handleSetLanguage, t, tJSX, cmsMap, setCmsMap }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
