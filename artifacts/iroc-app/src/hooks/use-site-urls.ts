/**
 * useSiteUrls — returns the configured public URLs for both websites.
 *
 * Reads config_iroc_website_url and config_spirecut_website_url from
 * /api/website-settings (the same store the Configuration page writes to).
 * Falls back to the local dev artifact paths when no URL has been saved yet.
 *
 * Uses the module-level singleton pattern so all open pages share one fetch.
 * Call invalidateSiteUrlsCache() after any save in Configuration so the next
 * navigation picks up the new values.
 */

const IROC_DEV     = '/iroc-website';
const SPIRECUT_DEV = '/spirecut-patient';

interface SiteUrls {
  irocUrl:     string;   // base URL, no trailing slash
  spirecutUrl: string;
}

const DEFAULTS: SiteUrls = { irocUrl: IROC_DEV, spirecutUrl: SPIRECUT_DEV };

let cache: SiteUrls | null = null;
let fetchPromise: Promise<SiteUrls> | null = null;

function fetchSiteUrls(): Promise<SiteUrls> {
  if (cache) return Promise.resolve(cache);
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch('/api/website-settings')
    .then(r => r.ok ? r.json() : {})
    .catch(() => ({}))
    .then((data: Record<string, string>) => {
      cache = {
        irocUrl:     (data['config_iroc_website_url']     || IROC_DEV    ).replace(/\/$/, ''),
        spirecutUrl: (data['config_spirecut_website_url'] || SPIRECUT_DEV).replace(/\/$/, ''),
      };
      fetchPromise = null;
      return cache;
    });
  return fetchPromise;
}

export function invalidateSiteUrlsCache(): void {
  cache = null;
  fetchPromise = null;
}

import { useState, useEffect } from 'react';

export function useSiteUrls(): SiteUrls {
  const [urls, setUrls] = useState<SiteUrls>(cache ?? DEFAULTS);
  useEffect(() => {
    let cancelled = false;
    fetchSiteUrls().then(u => { if (!cancelled) setUrls(u); });
    return () => { cancelled = true; };
  }, []);
  return urls;
}
