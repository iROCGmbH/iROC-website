/**
 * Shared patient-facing contracts used by both Spirecut browser experiences.
 *
 * The website and browser APP intentionally keep separate visual shells, but
 * their patient data, navigation contract, and failure handling must not drift.
 */

export const SPIRECUT_NAV_ROUTE_HREFS = [
  "/",
  "/arzt-finden",
  "/karpaltunnelsyndrom",
  "/schnappfinger",
  "/praktische-informationen",
  "/postoperative-entwicklung",
  "/patient-testimonials",
  "/faq",
  "/kontakt",
] as const;

export type SpirecutNavRouteHref = (typeof SPIRECUT_NAV_ROUTE_HREFS)[number];

/** Legacy URLs that remain usable when shared patient navigation evolves. */
export const SPIRECUT_LEGACY_ROUTE_MAP: Readonly<Record<string, string>> = {
  "/karpaltunnel": "/karpaltunnelsyndrom",
  "/schnappfinger": "/schnappfinger",
  "/faq": "/faq",
  "/arzt": "/arzt-finden",
  "/how-it-works": "/so-funktioniert-es",
  "/postop": "/postoperative-entwicklung",
};

export function resolveSpirecutLegacyRoute(location: string): string | undefined {
  const normalized = location.replace(/\/+$/, "") || "/";
  return SPIRECUT_LEGACY_ROUTE_MAP[normalized];
}

// ── Patient settings ────────────────────────────────────────────────────────

export interface SpirecutSettings {
  sp_video_ct_url: string;
  sp_video_tf_url: string;
  sp_contact_email_de: string;
  sp_contact_email_com: string;
  sp_video_praktisch_1_url: string;
  sp_video_praktisch_2_url: string;
  sp_video_praktisch_1_title: string;
  sp_video_praktisch_2_title: string;
  sp_webapp_url: string;
  sp_gate_enabled: string;
  sp_gate_title_de: string;
  sp_gate_title_en: string;
  sp_gate_body_de: string;
  sp_gate_body_en: string;
  sp_gate_link_url: string;
}

export const SP_DEFAULTS: SpirecutSettings = {
  sp_video_ct_url: "https://www.youtube.com/embed/jDStbSFduO8?rel=0",
  sp_video_tf_url: "https://www.youtube.com/embed/QbOlsFMTbJo?rel=0",
  sp_contact_email_de: "info@spirecut.de",
  sp_contact_email_com: "info@spirecut.com",
  sp_video_praktisch_1_url: "",
  sp_video_praktisch_2_url: "",
  sp_video_praktisch_1_title: "",
  sp_video_praktisch_2_title: "",
  sp_webapp_url: "",
  sp_gate_enabled: "true",
  sp_gate_title_de: "Diese Website richtet sich an Patienten und Interessierte.",
  sp_gate_title_en: "This website is intended for patients and interested individuals.",
  sp_gate_body_de:
    "Sind Sie Arzt oder medizinisches Fachpersonal? Dann besuchen Sie bitte die iROC GmbH Website.",
  sp_gate_body_en:
    "Are you a medical doctor or healthcare professional? Please visit the iROC GmbH website instead.",
  sp_gate_link_url: "https://www.i-roc.de",
};

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const YOUTU_BE_HOST = "youtu.be";

/** Convert a trusted YouTube watch/short URL into an embeddable URL. */
export function toEmbedUrl(raw: string): string {
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  const host = url.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host) && url.pathname.startsWith("/embed/")) return raw;

  if (host === YOUTU_BE_HOST) {
    const id = url.pathname.slice(1).match(/^([A-Za-z0-9_-]+)/)?.[1];
    if (id) return `https://www.youtube.com/embed/${id}`;
  }

  if (YOUTUBE_HOSTS.has(host)) {
    const videoId = url.searchParams.get("v");
    if (videoId && /^[A-Za-z0-9_-]+$/.test(videoId)) {
      return `https://www.youtube.com/embed/${videoId}`;
    }
  }

  return "";
}

export interface SpirecutSettingsStore {
  getSnapshot(): SpirecutSettings;
  load(): Promise<SpirecutSettings>;
  subscribe(listener: () => void): () => void;
  invalidate(): void;
}

/**
 * Create the browser-side settings store. Keeping fetch/cache/invalidation in
 * this package means both apps handle transient API failures and admin updates
 * identically; React lifecycle wiring stays in each app's tiny hook adapter.
 */
export function createSpirecutSettingsStore(): SpirecutSettingsStore {
  let cache: SpirecutSettings | null = null;
  let lastKnownGoodCache: SpirecutSettings | null = null;
  let fetchPromise: Promise<SpirecutSettings> | null = null;
  let refreshPending = false;
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | null | undefined;

  function getChannel(): BroadcastChannel | null {
    if (channel !== undefined) return channel;
    if (typeof BroadcastChannel === "undefined") {
      channel = null;
      return channel;
    }
    channel = new BroadcastChannel("spirecut-sp-settings-invalidate");
    channel.onmessage = () => {
      refreshPending = true;
      fetchPromise = null;
      listeners.forEach((listener) => listener());
    };
    return channel;
  }

  async function load(): Promise<SpirecutSettings> {
    if (cache && !refreshPending) return cache;
    if (fetchPromise) return fetchPromise;

    const request = fetch("/api/patient-settings")
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error(`HTTP ${response.status}`)),
      )
      .then((data: Partial<SpirecutSettings>) => {
        const nonEmpty = Object.fromEntries(
          Object.entries(data).filter(
            ([, value]) =>
              typeof value === "string" && value.trim() !== "",
          ),
        ) as Partial<SpirecutSettings>;
        cache = { ...SP_DEFAULTS, ...nonEmpty };
        lastKnownGoodCache = cache;
        refreshPending = false;
        fetchPromise = null;
        return cache;
      })
      .catch(() => {
        fetchPromise = null;
        if (lastKnownGoodCache) {
          cache = lastKnownGoodCache;
          return lastKnownGoodCache;
        }
        cache = SP_DEFAULTS;
        return SP_DEFAULTS;
      });

    fetchPromise = request;
    return request;
  }

  function invalidate() {
    refreshPending = true;
    fetchPromise = null;
    listeners.forEach((listener) => listener());
    getChannel()?.postMessage("invalidate");
  }

  // Create the listener before the first hook mounts so a second browser tab
  // can invalidate this tab even when its settings are still loading.
  getChannel();

  return {
    getSnapshot: () => cache ?? SP_DEFAULTS,
    load,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate,
  };
}

// ── Patient media ───────────────────────────────────────────────────────────

export const MEDIA_UPDATE_CHANNEL = "spirecut-patient-media-updates";
export const HIDDEN_SENTINEL = "__hidden__";
export const DEFAULT_SENTINEL = "__default__";

export type PatientMediaMap = Record<string, string>;

export interface SpirecutMediaStore {
  load(): Promise<PatientMediaMap>;
  subscribe(listener: () => void): () => void;
  invalidate(): void;
}

export function resolvePatientMediaUrl(
  raw: string | undefined,
  fallback: string,
): string | null {
  if (!raw || raw === DEFAULT_SENTINEL) return fallback;
  if (raw === HIDDEN_SENTINEL) return null;
  if (raw.startsWith("/objects/")) return `/api/storage${raw}`;
  return raw;
}

/**
 * Shared media delivery behavior: never cache failed/invalid responses,
 * validate API data, and notify every mounted consumer after admin updates.
 */
export function createSpirecutMediaStore(): SpirecutMediaStore {
  let cache: PatientMediaMap | null = null;
  let fetchPromise: Promise<PatientMediaMap> | null = null;
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | null | undefined;

  function clearCache() {
    cache = null;
    fetchPromise = null;
    listeners.forEach((listener) => listener());
  }

  function getChannel(): BroadcastChannel | null {
    if (channel !== undefined) return channel;
    if (typeof BroadcastChannel === "undefined") {
      channel = null;
      return channel;
    }
    channel = new BroadcastChannel(MEDIA_UPDATE_CHANNEL);
    channel.onmessage = clearCache;
    return channel;
  }

  async function load(): Promise<PatientMediaMap> {
    if (cache) return cache;
    if (fetchPromise) return fetchPromise;

    const request = fetch("/api/patient-media", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load patient media (${response.status})`);
        }
        return response.json();
      })
      .then((data: unknown) => {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Invalid patient media response");
        }
        const media: PatientMediaMap = {};
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "string") media[key] = value;
        }
        cache = media;
        fetchPromise = null;
        return media;
      })
      .catch((error: unknown) => {
        fetchPromise = null;
        throw error;
      });

    fetchPromise = request;
    return request;
  }

  function invalidate() {
    clearCache();
    getChannel()?.postMessage("updated");
  }

  getChannel();

  return {
    load,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate,
  };
}