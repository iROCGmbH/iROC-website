/**
 * useWebsiteSettings — fetches admin-overrideable site-wide settings from the API.
 * Uses a module-level singleton so the fetch only fires once per page load.
 * BroadcastChannel ensures other open tabs re-fetch immediately after an admin saves.
 */
import { useState, useEffect } from 'react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

export interface WebsiteSettings {
  ws_logo_url:            string;
  ws_contact_email:       string;
  ws_contact_phone:       string;
  ws_contact_fax:         string;
  ws_address_street:      string;
  ws_address_postal:      string;
  ws_address_city:        string;
  ws_address_country_de:  string;
  ws_address_country_en:  string;
  ws_hero_image_url:      string;
  ws_maps_embed_url:      string;
  ws_maps_directions_url: string;
  ws_social_linkedin:      string;
  ws_social_facebook:      string;
  ws_social_instagram:     string;
  ws_social_youtube:       string;
  ws_spirecut_company_url: string;
  ws_ministem_company_url: string;
  ws_webapp_url: string;
  // Medical-professional gate
  ws_gate_enabled:   string;
  ws_gate_title_de:  string;
  ws_gate_title_en:  string;
  ws_gate_body_de:   string;
  ws_gate_body_en:   string;
  ws_gate_link_url:  string;
}

export const WS_DEFAULTS: WebsiteSettings = {
  ws_logo_url:            '',
  ws_contact_email:       'info@i-roc.de',
  ws_contact_phone:       '+49 89 4625993 70',
  ws_contact_fax:         '+49 89 21530 334',
  ws_address_street:      'St.-Emmeram-Str. 26',
  ws_address_postal:      '85609',
  ws_address_city:        'Aschheim',
  ws_address_country_de:  'Deutschland',
  ws_address_country_en:  'Germany',
  ws_hero_image_url:      'https://images.unsplash.com/photo-1551076805-e1869043e560?q=80&w=2574&auto=format&fit=crop',
  ws_maps_embed_url:      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2662.4!2d11.7!3d48.17!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2sSt.-Emmeram-Str.+26%2C+85609+Aschheim!5e0!3m2!1sde!2sde!4v1',
  ws_maps_directions_url: 'https://maps.google.com/?q=St.-Emmeram-Str.+26,+85609+Aschheim',
  ws_social_linkedin:      '',
  ws_social_facebook:      '',
  ws_social_instagram:     '',
  ws_social_youtube:       '',
  ws_spirecut_company_url: 'https://www.spirecut.com',
  ws_ministem_company_url: 'https://www.jointechlabs.com',
  ws_webapp_url: 'https://portal.i-roc.de',
  ws_gate_enabled:   'true',
  ws_gate_title_de:  'Diese Website richtet sich ausschlie\u00dflich an \u00c4rzte und medizinische Fachkr\u00e4fte.',
  ws_gate_title_en:  'This website is intended exclusively for medical doctors and healthcare professionals.',
  ws_gate_body_de:   'Sind Sie kein Arzt oder keine medizinische Fachkraft? Dann besuchen Sie bitte unsere Patientenwebsite.',
  ws_gate_body_en:   'Are you not a medical doctor or healthcare professional? Please visit our patient website instead.',
  ws_gate_link_url:  'https://www.spirecut.de',
};

let cache: WebsiteSettings | null = null;
let fetchPromise: Promise<WebsiteSettings> | null = null;

// BroadcastChannel for cross-tab invalidation (graceful fallback for environments that don't support it)
const WS_CHANNEL_NAME = 'iroc-ws-settings-invalidate';
let _bc: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!_bc) _bc = new BroadcastChannel(WS_CHANNEL_NAME);
  return _bc;
}

/** Subscribers are notified when the cache is invalidated from any tab. */
const invalidationListeners = new Set<() => void>();

// Listen for invalidation messages from other tabs
if (typeof BroadcastChannel !== 'undefined') {
  const bc = getChannel();
  if (bc) {
    bc.onmessage = () => {
      cache = null;
      fetchPromise = null;
      invalidationListeners.forEach((fn) => fn());
    };
  }
}

async function fetchWebsiteSettings(): Promise<WebsiteSettings> {
  if (cache) return cache;
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch(`${BASE_URL}/api/website-settings`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((data: Partial<WebsiteSettings>) => {
      // Filter blank values so cleared settings fall back to defaults
      // (matches the Spirecut settings hook behavior)
      const nonBlank = Object.fromEntries(
        Object.entries(data as Record<string, string>).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
      );
      cache = { ...WS_DEFAULTS, ...nonBlank };
      fetchPromise = null;
      return cache!;
    });
  return fetchPromise;
}

export function invalidateWebsiteSettingsCache() {
  cache = null;
  fetchPromise = null;
  // Notify same-tab subscribers
  invalidationListeners.forEach((fn) => fn());
  // Notify other tabs
  getChannel()?.postMessage('invalidate');
}

export function useWebsiteSettings(): WebsiteSettings {
  const [settings, setSettings] = useState<WebsiteSettings>(cache ?? WS_DEFAULTS);

  useEffect(() => {
    let alive = true;

    function loadSettings() {
      // Always re-fetch after invalidation (cache will be null at this point)
      fetchWebsiteSettings().then((s) => { if (alive) setSettings(s); });
    }

    // Initial load
    if (cache) {
      setSettings(cache);
    } else {
      loadSettings();
    }

    // Subscribe to cross-tab invalidation events
    const onInvalidate = () => {
      if (alive) loadSettings();
    };
    invalidationListeners.add(onInvalidate);

    return () => {
      alive = false;
      invalidationListeners.delete(onInvalidate);
    };
  }, []);

  return settings;
}
