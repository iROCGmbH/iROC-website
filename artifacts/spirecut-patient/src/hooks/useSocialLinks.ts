const DEFAULTS = {
  instagram: "https://www.instagram.com/spirecut_officiel/",
  youtube: "https://www.youtube.com/@Spirecut",
  linkedin: "https://www.linkedin.com/company/spirecut/",
  tiktok: "https://www.tiktok.com/@spirecut",
  facebook: "https://www.facebook.com/spirecut",
};

export type SocialLinks = typeof DEFAULTS;
export type SocialKey = keyof SocialLinks;

let cache: SocialLinks | null = null;
let fetchPromise: Promise<SocialLinks> | null = null;

export async function fetchSocialLinks(): Promise<SocialLinks> {
  if (cache) return cache;
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch("/api/patient-social")
    .then((r) => (r.ok ? r.json() : DEFAULTS))
    .catch(() => DEFAULTS)
    .then((data: SocialLinks) => {
      cache = { ...DEFAULTS, ...data };
      fetchPromise = null;
      return cache!;
    });
  return fetchPromise;
}

export function invalidateSocialCache() {
  cache = null;
  fetchPromise = null;
}

export { DEFAULTS as SOCIAL_DEFAULTS };
