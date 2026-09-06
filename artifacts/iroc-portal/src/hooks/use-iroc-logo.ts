/**
 * useIrocLogo — fetches the dynamic iROC logo URL for the portal.
 */
import { useState, useEffect } from 'react';

const cache: { url: string | null; fetched: boolean } = { url: null, fetched: false };
const listeners = new Set<(url: string | null) => void>();

function fetchLogo() {
  if (cache.fetched) return;
  // website-settings is a public endpoint, no auth needed
  fetch('/api/website-settings')
    .then((r) => (r.ok ? r.json() : {}))
    .then((data: Record<string, string>) => {
      cache.url = data.ws_logo_url?.trim() || null;
      cache.fetched = true;
      listeners.forEach((fn) => fn(cache.url));
    })
    .catch(() => { cache.fetched = true; });
}

export function useIrocLogo(): string | null {
  const [logoUrl, setLogoUrl] = useState<string | null>(cache.fetched ? cache.url : null);
  useEffect(() => {
    if (cache.fetched) { setLogoUrl(cache.url); return; }
    const handler = (url: string | null) => setLogoUrl(url);
    listeners.add(handler);
    fetchLogo();
    return () => { listeners.delete(handler); };
  }, []);
  return logoUrl;
}
