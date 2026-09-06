/**
 * geocode.ts — Nominatim + Photon geocoding helpers.
 *
 * Nominatim ToS : max 1 req/sec, meaningful User-Agent.
 * Photon (komoot): same courtesy rate-limit, no key required.
 *
 * All geocoding is proxied through the server so the browser never calls
 * these services directly.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const PHOTON    = "https://photon.komoot.io/api";
const UA        = "SpirecutDoctorFinder/1.0 (spirecut.de)";

// Nominatim enforces rate-limiting delays, so allow slightly more time than SerpApi.
const OSM_FETCH_TIMEOUT_MS = 8_000;

// ── Shared result types ───────────────────────────────────────────────────────

export interface PostalLookupResult {
  city:        string;
  state:       string;
  countryCode: string; // uppercase ISO alpha-2, e.g. "DE"
  postcode:    string;
  displayName: string;
}

export interface InstitutionLookupResult {
  address:     string; // "Musterstr. 1" — may be empty
  postalCode:  string;
  city:        string;
  countryCode: string; // uppercase ISO alpha-2, e.g. "DE"
  displayName: string;
}

// ── Country-code normaliser ───────────────────────────────────────────────────

/** Normalise country name / ISO code → 2-letter lowercase code. Returns "" when unrecognised. */
export function toCountryCode(country: string): string {
  const l = country.toLowerCase().trim();
  if (["deutschland", "germany",      "de"].includes(l)) return "de";
  if (["österreich",  "austria",      "at"].includes(l)) return "at";
  if (["schweiz",     "switzerland",  "ch"].includes(l)) return "ch";
  if (["frankreich",  "france",       "fr"].includes(l)) return "fr";
  if (["niederlande", "netherlands",  "nl"].includes(l)) return "nl";
  if (["belgien",     "belgium",      "be"].includes(l)) return "be";
  if (["luxemburg",   "luxembourg",   "lu"].includes(l)) return "lu";
  if (["liechtenstein",               "li"].includes(l)) return "li";
  if (l.length === 2) return l;
  return "";
}

// ── Nominatim rate-limiter (1 req / 1100 ms) ─────────────────────────────────

let lastNominatimReq = 0;

async function nominatimFetch(url: string): Promise<unknown[] | null> {
  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimReq));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimReq = Date.now();
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(OSM_FETCH_TIMEOUT_MS) });
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// ── Photon rate-limiter (separate; 1 req / 1100 ms) ──────────────────────────

let lastPhotonReq = 0;

interface PhotonProps {
  name?:        string;
  street?:      string;
  housenumber?: string;
  postcode?:    string;
  city?:        string;
  district?:    string;
  state?:       string;
  country?:     string;
  countrycode?: string;
}

async function photonFetch(url: string): Promise<PhotonProps[] | null> {
  const wait = Math.max(0, 1100 - (Date.now() - lastPhotonReq));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastPhotonReq = Date.now();
  try {
    const resp = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(OSM_FETCH_TIMEOUT_MS) });
    if (!resp.ok) return null;
    const json = await resp.json() as { features?: { properties: PhotonProps }[] };
    return json.features?.map((f) => f.properties) ?? null;
  } catch {
    return null;
  }
}

/**
 * Quality check: decide if a Photon result is actually relevant to the query.
 * If the result has a name field that shares NO query word with the result text,
 * it is almost certainly a spurious phonetic match → reject it.
 */
function isRelevantPhoton(props: PhotonProps, query: string): boolean {
  if (!props.name) return true; // pure location result (city/postcode), always accept
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const haystack = [props.name, props.city, props.district, props.state, props.country]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return queryWords.some((w) => haystack.includes(w));
}

/** Convert a valid PhotonProps into an InstitutionLookupResult, or null if useless. */
function photonToResult(props: PhotonProps, query: string): InstitutionLookupResult | null {
  // When Photon returns the municipality itself (e.g. "Aschheim"), the place name
  // sits in `name` with no `city` field. Use `name` as city fallback only when
  // there is no street (i.e. the result IS a location, not a named building).
  const city = props.city ?? props.district ?? (!props.street ? props.name : "") ?? "";
  if (!city && !props.postcode) return null;
  if (!isRelevantPhoton(props, query)) return null;
  const street = [props.street, props.housenumber].filter(Boolean).join(" ");
  return {
    address:     street,
    postalCode:  props.postcode ?? "",
    city,
    countryCode: (props.countrycode ?? "").toUpperCase(),
    displayName: [...new Set(
      [props.name ?? query, city, (props.countrycode ?? "").toUpperCase()].filter(Boolean)
    )].join(", "),
  };
}

/**
 * Core Photon fetcher — returns up to `max` `InstitutionLookupResult`s.
 * Uses a DACH geographic bias (lat=47.5, lon=13).
 * Prefers results with a postcode (concrete POI address) over region-only hits.
 * When `allowedCountries` is given, results from other countries are dropped.
 */
async function _photonResults(
  query:            string,
  allowedCountries?: string[],
  max = 5,
): Promise<InstitutionLookupResult[]> {
  const fetchLimit = Math.min(max * 3, 15);
  const url =
    `${PHOTON}?q=${encodeURIComponent(query)}&limit=${fetchLimit}&lang=de&lat=47.5&lon=13&zoom=6`;
  const features = await photonFetch(url);
  if (!features?.length) return [];

  const allowed = allowedCountries?.map((c) => c.toLowerCase());
  const accept = (p: PhotonProps) =>
    !allowed || !p.countrycode || allowed.includes(p.countrycode.toLowerCase());

  const results: InstitutionLookupResult[] = [];
  const seen = new Set<string>();
  const tryAdd = (p: PhotonProps) => {
    if (results.length >= max || !accept(p)) return;
    const r = photonToResult(p, query);
    if (!r) return;
    const key = r.displayName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(r);
  };

  // First pass: prefer items that have a postcode
  features.filter((p) => p.postcode && isRelevantPhoton(p, query)).forEach(tryAdd);
  // Second pass: anything else that is relevant
  features.filter((p) => isRelevantPhoton(p, query)).forEach(tryAdd);
  return results;
}

/** Single Photon search — returns the first result or null. */
async function photonSearch(
  query:            string,
  allowedCountries?: string[],
): Promise<InstitutionLookupResult | null> {
  const r = await _photonResults(query, allowedCountries, 1);
  return r[0] ?? null;
}

/** Multi Photon search — returns up to `max` results. */
async function photonSearchMultiple(
  query:            string,
  allowedCountries?: string[],
  max = 5,
): Promise<InstitutionLookupResult[]> {
  return _photonResults(query, allowedCountries, max);
}

// ── Medical type-indicator words ──────────────────────────────────────────────

/**
 * Words that indicate the query already carries a medical/institution type.
 * When NONE of these appear in the user's query, we augment it by appending
 * common suffixes ("Klinik", "Praxis", …) before giving up.
 */
const MEDICAL_TYPE_WORDS = new Set([
  "klinik", "kliniken", "praxis", "zentrum", "centrum", "institut", "institute",
  "krankenhaus", "spital", "ambulanz", "ambulatorium",
  "chirurgie", "orthopädie", "anästhesie", "radiologie", "onkologie",
  "medizin", "medizinische", "medizinischer", "medizinisches",
  "augenklinik", "augenzentrum",
  "clinic", "medical", "hospital", "practice", "centre", "center", "health",
  "arzt", "ärzte", "doctor", "doctors",
]);

/** Suffixes tried in order when the bare query has no medical type word. */
const MEDICAL_AUGMENT_SUFFIXES = ["Klinik", "Praxis", "Krankenhaus", "Zentrum", "Centrum"];

// ── Institution-name stop-words (skip when extracting location candidates) ───

const INST_STOP = new Set([
  "klinik", "kliniken", "praxis", "zentrum", "centrum", "institut", "institute",
  "krankenhaus", "ambulanz", "ambulatorium", "gemeinschaft", "gesellschaft",
  "universitäts", "universitätsklinikum", "universität", "university",
  "chirurgie", "orthopädie", "anästhesie", "radiologie", "onkologie",
  "medizin", "medizinische", "medizinisches", "medizinischer",
  "clinic", "medical", "hospital", "practice", "centre", "center", "health",
  "gmbh", "beim", "oder", "und", "für", "der", "die", "das", "des",
  "arzt", "ärzte", "doctor", "doctors",
]);

/**
 * Extract words from an institution name that are likely location names or
 * brand acronyms: properly capitalised, not in the stop-list, ≥ 3 chars.
 * Also splits on hyphens so "ROC-ASCHHEIM" yields ["ROC", "ASCHHEIM"].
 * Returns candidates in reverse order so the last word (often the city) is tried first.
 */
function locationCandidates(institutionName: string): string[] {
  return institutionName
    .split(/[\s,;.()/\-]+/)
    .filter((w) => w.length >= 3)
    .filter((w) => !INST_STOP.has(w.toLowerCase()))
    .filter((w) => /^[A-ZÄÖÜ]/.test(w))
    .reverse();
}

/**
 * True if every character of the word is an ASCII uppercase letter or digit —
 * i.e. it looks like an acronym ("ROC", "MRT", "LMU") rather than a proper name.
 */
function isAcronym(word: string): boolean {
  return word.length <= 6 && /^[A-Z0-9]+$/.test(word);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Lookup postal code → structured address (city, state, country).
 *
 * Smart country fallback:
 *  • German postal codes are always 5 digits (01001–99999).
 *    If a 4-digit code is entered but the countryCode is "DE" (often the form default),
 *    the search is immediately redirected to AT + CH + LI — no wasted request.
 *  • If the primary lookup fails and DE was the original country, a DACH fallback is tried.
 */
export async function lookupPostalAddress(
  postal:      string,
  countryCode: string,
): Promise<PostalLookupResult | null> {
  const cc = toCountryCode(countryCode) || countryCode.toLowerCase().slice(0, 2) || "de";

  // German postal codes are 5 digits. A 4-digit code cannot be German.
  const effectiveCc =
    postal.replace(/\s/g, "").length === 4 && cc === "de" ? "at,ch,li,lu" : cc;

  const doLookup = async (codes: string): Promise<PostalLookupResult | null> => {
    const url =
      `${NOMINATIM}?postalcode=${encodeURIComponent(postal)}&countrycodes=${codes}` +
      `&format=json&limit=1&addressdetails=1`;
    const data = await nominatimFetch(url) as Array<{
      address?: {
        city?: string; town?: string; village?: string; municipality?: string;
        state?: string; country_code?: string; postcode?: string;
      };
    }> | null;
    if (!data?.length || !data[0].address) return null;
    const addr = data[0].address;
    const city = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? "";
    if (!city && !addr.postcode) return null;
    return {
      city,
      state:       addr.state ?? "",
      countryCode: (addr.country_code ?? codes.split(",")[0]).toUpperCase(),
      postcode:    addr.postcode ?? postal,
      displayName: [city, addr.state].filter(Boolean).join(", "),
    };
  };

  const primary = await doLookup(effectiveCc);
  if (primary) return primary;

  // Fallback: if we used a specific single country and got nothing, try the broader DACH block
  if (!effectiveCc.includes(",") && effectiveCc !== "de,at,ch,li,lu") {
    return doLookup("de,at,ch,li,lu");
  }
  return null;
}

// ── Nominatim POI helper ──────────────────────────────────────────────────────

/**
 * Relevance check for a Nominatim free-text result.
 * Requires that at least ONE query word longer than 3 chars appears as a
 * complete word (not just a substring) somewhere in the display name.
 * This prevents "ROC" from matching "LA-Regio" via substring.
 */
function isRelevantNominatim(displayName: string, query: string): boolean {
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (queryWords.length === 0) return true;  // very short query — always accept
  const resultWords = new Set(
    displayName.toLowerCase().split(/[\s,;.()/\-]+/).filter(Boolean),
  );
  return queryWords.some((qw) =>
    [...resultWords].some((rw) => rw === qw || rw.startsWith(qw + "-")),
  );
}

type NominatimRow = {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: {
    amenity?: string; road?: string; house_number?: string; postcode?: string;
    city?: string; town?: string; village?: string; municipality?: string;
    suburb?: string; state?: string; country_code?: string;
  };
};

/**
 * Core Nominatim free-text fetcher — returns up to `max` results.
 * Prefers results that carry a street address (real POI over bare district).
 * Applies whole-word relevance check to prevent false substring matches.
 */
async function _nominatimResults(
  query:     string,
  countries?: string,
  max = 5,
): Promise<InstitutionLookupResult[]> {
  const codes     = countries ?? "de,at,ch,li,lu";
  const fetchLimit = Math.min(max * 3, 15);
  const url =
    `${NOMINATIM}?q=${encodeURIComponent(query)}&countrycodes=${codes}` +
    `&format=json&addressdetails=1&limit=${fetchLimit}`;
  const data = await nominatimFetch(url) as NominatimRow[] | null;
  if (!data?.length) return [];

  // Prefer results with a road (= named POI with a real address)
  const ranked = [...data].sort((a, b) => (b.address?.road ? 1 : 0) - (a.address?.road ? 1 : 0));

  const results: InstitutionLookupResult[] = [];
  const seen = new Set<string>();

  for (const item of ranked) {
    if (results.length >= max) break;
    const addr = item.address;
    if (!addr) continue;
    const city = addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? addr.suburb ?? "";
    if (!city && !addr.postcode) continue;
    if (!isRelevantNominatim(item.display_name ?? "", query)) continue;
    const street     = [addr.road, addr.house_number].filter(Boolean).join(" ");
    // Build a compact "Name, City, CC" displayName instead of using the raw OSM parts
    const osmParts   = (item.display_name ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const placeName  = osmParts[0] ?? query;
    const displayName = [...new Set([placeName, city, (addr.country_code ?? "").toUpperCase()].filter(Boolean))].join(", ");
    // Deduplicate by postcode + normalised street; fall back to displayName
    const key = [addr.postcode, street.toLowerCase()].filter(Boolean).join("|") || displayName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ address: street, postalCode: addr.postcode ?? "", city, countryCode: (addr.country_code ?? "").toUpperCase(), displayName });
  }
  return results;
}

/** Single Nominatim free-text search — returns the first result or null. */
async function nominatimPlaceSearch(query: string, countries?: string): Promise<InstitutionLookupResult | null> {
  const r = await _nominatimResults(query, countries, 1);
  return r[0] ?? null;
}

/** Multi Nominatim free-text search — returns up to `max` results. */
async function nominatimPlaceSearchMultiple(query: string, countries?: string, max = 5): Promise<InstitutionLookupResult[]> {
  return _nominatimResults(query, countries, max);
}

// ── Web-search fallback helpers ───────────────────────────────────────────────

/**
 * Parse a DACH address from free-form text.
 *
 * Strategy:
 *  1. Scan lines for a 5-digit (DE) or 4-digit (AT/CH) postcode followed by a city.
 *  2. Try to extract the street from the same line (text before the postcode)
 *     or the previous line.
 *
 * Returns the first plausible address found, or null.
 */
/**
 * Detect the country of an address from explicit country mentions in the text.
 * Used to disambiguate 4-digit postcodes (AT and CH both use them).
 */
export function detectCountryFromText(text: string): "DE" | "AT" | "CH" | null {
  const t = text.toLowerCase();
  if (/\b(schweiz|switzerland|suisse|svizzera)\b|\bche[-\s]?\d/.test(t)) return "CH";
  if (/\b(österreich|oesterreich|austria|autriche)\b/.test(t))           return "AT";
  if (/\b(deutschland|germany|allemagne)\b/.test(t))                     return "DE";
  return null;
}

export function parseDachAddress(text: string, fallbackName: string, countryHint?: string): InstitutionLookupResult | null {
  const lines = text.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match a DACH postcode (DE = 5 digits, AT/CH = 4 digits) followed by a city name.
    const m = line.match(
      /\b(\d{5}|\d{4})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s\-]{1,28}?)(?:\s*$|[,;.|<\t])/,
    );
    if (!m) continue;

    const postcode = m[1];
    const rawCity  = m[2].trim();

    // Sanity guards — reject noise matches
    if (/^\d/.test(rawCity) || rawCity.length > 35) continue;
    if (/\d{4,5}$/.test(rawCity))                   continue; // over-captured
    const pcNum = parseInt(postcode, 10);
    if (postcode.length === 5 && pcNum < 1001)            continue; // invalid DE PLZ
    if (postcode.length === 4 && (pcNum < 1000 || pcNum > 9999)) continue;

    // Country: 5-digit → DE. 4-digit → AT or CH; use the explicit hint, then
    // country mentions in the text itself, then default AT.
    const countryCode = postcode.length === 5
      ? "DE"
      : (countryHint === "CH" || countryHint === "AT" ? countryHint : null)
        ?? detectCountryFromText(text)
        ?? "AT";
    const city        = rawCity.replace(/\s+/g, " ");

    // Extract street: prefer the text before the postcode on the same line.
    // Scan backwards for the last address-like fragment (contains a digit and is ≤70 chars).
    let street = "";
    const pcIdx  = m.index ?? 0;
    const rawBefore = line.slice(0, pcIdx).trim().replace(/[,;.]+$/, "");
    // If the whole prefix is a plausible street, use it directly.
    // If it's too long (e.g. a full sentence), try to extract just the trailing street fragment
    // by looking for the last segment that contains a house number.
    if (rawBefore.length > 0 && /\d/.test(rawBefore)) {
      if (rawBefore.length <= 70) {
        street = rawBefore;
      } else {
        // Try to pull the last street-looking fragment from a long line.
        // Split on sentence boundaries (". " preceded by a word ≥4 chars, not an abbreviation)
        // so "St.-Emmeram-Str. 28" is kept intact rather than split at "Str. ".
        const fragments = rawBefore.split(/(?<=[a-zäöüA-ZÄÖÜ]{4,})\.\s+/);
        const candidate = fragments[fragments.length - 1].trim().replace(/[,;.]+$/, "");
        if (candidate.length > 0 && candidate.length <= 70 && /\d/.test(candidate)) {
          street = candidate;
        }
      }
    }
    // … or the entire previous line when it looks like a street address.
    if (!street && i > 0) {
      const prev = lines[i - 1].replace(/[,;]+$/, "").trim();
      if (prev.length > 3 && prev.length <= 70 && /\d/.test(prev)) {
        street = prev;
      }
    }

    const displayName = [...new Set(
      [fallbackName, city, countryCode].filter(Boolean),
    )].join(", ");

    return { address: street, postalCode: postcode, city, countryCode, displayName };
  }
  return null;
}


// ── SerpApi web-search fallback ───────────────────────────────────────────────

const SERPAPI = "https://serpapi.com/search";

interface SerpApiOrganic {
  title?:   string;
  snippet?: string;
  link?:    string;
}

// In-memory cache: avoids burning SerpApi quota on repeated type-ahead lookups.
const WEB_SEARCH_TTL_MS     = 10 * 60 * 1000; // 10 minutes
const WEB_SEARCH_CACHE_MAX  = 500;
const WEB_SEARCH_TIMEOUT_MS = 5_000;          // abort Exa/SerpApi fetch after this many ms
const webSearchCache = new Map<string, { r: InstitutionLookupResult | null; ts: number }>();

/**
 * Use SerpApi (Google Search) to find an address for a clinic/institution
 * that isn't indexed in OpenStreetMap.
 *
 * Address priority:
 *  1. Google knowledge-graph listing (`knowledge_graph.adresse` for hl=de) —
 *     the verified business address, e.g. "St.-Emmeram-Straße 5, 85609 Aschheim".
 *  2. Organic result snippets — parsed with `parseDachAddress()`. These can quote
 *     stale third-party directories with wrong house numbers, hence lower priority.
 *
 * Requires the SERPAPI_KEY environment variable; returns null silently when the
 * key is absent, the request fails/times out, or no DACH address can be parsed.
 */
export async function webSearchFallback(
  name:              string,
  allowedCountries?: string[], // lowercase ISO codes, e.g. ["de","at"]
): Promise<InstitutionLookupResult | null> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;

  const cacheKey = `${name.toLowerCase()}|${(allowedCountries ?? []).join(",")}`;
  const cached = webSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < WEB_SEARCH_TTL_MS) return cached.r;

  const url =
    `${SERPAPI}?engine=google&q=${encodeURIComponent(`${name} Adresse`)}` +
    `&hl=de&gl=de&num=5&api_key=${encodeURIComponent(key)}`;

  let organic: SerpApiOrganic[] = [];
  let kgAddress = "";
  let kgType    = "";
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal:  AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
    });
    if (!resp.ok) return null; // do NOT cache HTTP errors — could be a transient quota/5xx
    const json = await resp.json() as {
      organic_results?: SerpApiOrganic[];
      // Google's business listing — the address field name is localized ("adresse" for hl=de).
      knowledge_graph?: { address?: string; adresse?: string; type?: string };
    };
    organic   = json.organic_results ?? [];
    kgAddress = json.knowledge_graph?.adresse ?? json.knowledge_graph?.address ?? "";
    kgType    = json.knowledge_graph?.type ?? ""; // e.g. "Hersteller … in Muttenz, Schweiz"
  } catch {
    return null; // network error / timeout — not cached either
  }

  // Country hint: scan the knowledge-graph type line AND all snippets for explicit
  // country mentions ("Schweiz", "Switzerland", …). This is what disambiguates
  // AT vs CH — both use 4-digit postcodes.
  const organicBlob = organic
    .flatMap((r) => [r.title ?? "", r.snippet ?? ""])
    .filter(Boolean)
    .join("\n");
  const countryHint = detectCountryFromText([kgType, kgAddress, organicBlob].join("\n")) ?? undefined;

  // Prefer the knowledge-graph address (Google's verified listing).
  let result = kgAddress ? parseDachAddress(kgAddress, name, countryHint) : null;

  // Fall back to scanning organic snippets + titles only when there is no KG listing.
  if (!result && organicBlob) {
    result = parseDachAddress(organicBlob, name, countryHint);
  }

  // Country filtering: parseDachAddress labels 4-digit postcodes "AT" (AT and CH are
  // both 4-digit). If the caller restricted countries, relabel AT→CH when only CH is
  // allowed, and drop results outside the allowed set entirely.
  if (result && allowedCountries?.length) {
    const cc = result.countryCode.toLowerCase();
    if (cc === "at" && !allowedCountries.includes("at") && allowedCountries.includes("ch")) {
      result = { ...result, countryCode: "CH" };
    } else if (!allowedCountries.includes(cc)) {
      result = null;
    }
  }

  // Cache successful API responses (including "no address found") to save quota.
  if (webSearchCache.size >= WEB_SEARCH_CACHE_MAX) {
    const oldest = webSearchCache.keys().next().value;
    if (oldest !== undefined) webSearchCache.delete(oldest);
  }
  webSearchCache.set(cacheKey, { r: result, ts: Date.now() });
  return result;
}

// ── Institution pipeline ──────────────────────────────────────────────────────

/**
 * Shared pipeline logic for institution search.
 * Fills `out` with up to `max` deduplicated results.
 * Returns when `out.length >= max` or all steps exhausted.
 */
async function _institutionPipeline(
  name:       string,
  dachCodes:  string[],
  countryCsv: string,
  out:        InstitutionLookupResult[],
  seen:       Set<string>,
  max:        number,
): Promise<void> {
  const add = (items: InstitutionLookupResult[]) => {
    for (const r of items) {
      if (out.length >= max) return;
      // Deduplicate by postcode + normalised address; fall back to displayName.
      // This prevents Photon and Nominatim returning the same POI under different names.
      const key = [r.postalCode, r.address.toLowerCase()].filter(Boolean).join("|")
               || r.displayName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  };

  // Step 0: If the name contains hyphens, try with spaces instead first.
  // "ROC-ASCHHEIM" → "ROC ASCHHEIM" — OSM often stores the spaced variant.
  if (name.includes("-")) {
    const spaced = name.replace(/-/g, " ");
    add(await photonSearchMultiple(spaced, dachCodes, max));
    if (out.length >= max) return;
    add(await nominatimPlaceSearchMultiple(spaced, countryCsv, max - out.length));
    if (out.length >= max) return;
  }

  // Step 1: Photon full-name (DACH-filtered)
  add(await photonSearchMultiple(name, dachCodes, max));
  if (out.length >= max) return;

  // Step 2: Nominatim POI search
  add(await nominatimPlaceSearchMultiple(name, countryCsv, max - out.length));
  if (out.length >= max) return;

  // Step 3: Word-extraction — each capitalised non-stop word via Photon + Nominatim.
  // For acronym-style words (short all-caps, e.g. "ROC") also try medical augmentation
  // so "ROC-ASCHHEIM" → "ROC" → "ROC Klinik" / "ROC Zentrum" / "ROC Centrum" can find
  // "ROC regeneratives centrum" even though the bare acronym alone returns nothing useful.
  const candidates = locationCandidates(name);
  for (const word of candidates) {
    if (out.length >= max) return;
    add(await photonSearchMultiple(word, dachCodes, max - out.length));
    if (out.length >= max) return;
    add(await nominatimPlaceSearchMultiple(word, countryCsv, max - out.length));
    if (out.length >= max) return;

    if (isAcronym(word)) {
      for (const suffix of MEDICAL_AUGMENT_SUFFIXES) {
        if (out.length >= max) return;
        const aug = `${word} ${suffix}`;
        add(await photonSearchMultiple(aug, dachCodes, max - out.length));
        if (out.length >= max) return;
        add(await nominatimPlaceSearchMultiple(aug, countryCsv, max - out.length));
        if (out.length >= max) return;
      }
    }
  }
  if (out.length >= max) return;

  // Step 4: Bare brand name (no medical type word) → augment the full name with suffixes.
  const lowerName = name.toLowerCase();
  const hasMedicalType = [...MEDICAL_TYPE_WORDS].some((w) => lowerName.includes(w));
  if (!hasMedicalType) {
    for (const suffix of MEDICAL_AUGMENT_SUFFIXES) {
      if (out.length >= max) return;
      const aug = `${name} ${suffix}`;
      add(await photonSearchMultiple(aug, dachCodes, max - out.length));
      if (out.length >= max) return;
      add(await nominatimPlaceSearchMultiple(aug, countryCsv, max - out.length));
    }
  }
}

/**
 * Search for an institution by name and return its best address.
 *
 * Strategy — in order:
 *  1. Photon full-name (OSM place search, DACH bias, prefers results with postcode)
 *  2. Nominatim free-text (POI / amenity search — finds clinics/hospitals in OSM)
 *  3. Word-extraction fallback — each capitalised non-stop word searched via Photon
 *     (handles city-in-name cases like "ROC Aschheim" → "Aschheim" → AT postcode)
 *
 * This order means branded clinic names ("ATOMOS Klinik", "Beta Klinik") are found
 * by Photon or Nominatim before we fall back to guessing from words.
 */
/** Return the single best match for an institution name (used internally). */
export async function lookupInstitution(
  name:         string,
  countryCode?: string,
): Promise<InstitutionLookupResult | null> {
  const r = await lookupInstitutionMultiple(name, countryCode, 1);
  return r[0] ?? null;
}

/**
 * Return up to `max` (default 5) address matches for an institution name.
 * Results are deduplicated by display name and ordered by match quality.
 */
export async function lookupInstitutionMultiple(
  name:         string,
  countryCode?: string,
  max = 5,
): Promise<InstitutionLookupResult[]> {
  if (!name || name.length < 3) return [];
  const cc         = countryCode ? toCountryCode(countryCode) : "";
  const countryCsv = cc || "de,at,ch,li,lu";
  const dachCodes  = countryCsv.split(",").map((s) => s.trim());

  const out:  InstitutionLookupResult[] = [];
  const seen: Set<string>               = new Set();

  // Step 1 (PRIMARY): SerpApi web search — Google's knowledge graph is the most
  // reliable source for business addresses AND for the correct country
  // (it distinguishes AT from CH, which raw postcodes cannot).
  const webResult = await webSearchFallback(name, dachCodes);
  if (webResult) {
    const keyAddr = [webResult.postalCode, webResult.address.toLowerCase()].filter(Boolean).join("|")
                 || webResult.displayName.toLowerCase();
    seen.add(keyAddr);
    seen.add(webResult.displayName.toLowerCase());
    out.push(webResult);
  }

  // Step 2: OSM pipeline (Photon/Nominatim) fills the remaining suggestion slots.
  await _institutionPipeline(name, dachCodes, countryCsv, out, seen, max);

  // Rank by relevance to the typed name, then enforce the caller's `max` contract.
  return rankByRelevance(out, name).slice(0, max);
}

/**
 * Sort results so entries whose displayName matches the typed institution name
 * rank above generic location hits.
 *
 * Scoring per query word (≥3 chars, split on spaces AND hyphens):
 *  • exact word match in the displayName → 2 points
 *  • prefix match ("aschheim" → "aschheimer") → 1 point
 *
 * "ROC-Aschheim" → the SerpApi entry "ROC-Aschheim, Aschheim, DE" (roc + aschheim
 * both exact = 4) ranks above OSM's "Aschheim, DE" (2) and street hits like
 * "Aschheimer Straße, Feldkirchen, DE" (prefix only = 1).
 * The sort is stable, so equally-scored results keep their pipeline order.
 */
/** Tokenize a query into meaningful words using the SAME separator class as
 *  displayName tokenization, so punctuation in pasted names ("Klinik,") never
 *  produces unmatchable tokens. */
function queryWords(query: string): string[] {
  return query.toLowerCase().split(/[\s,;.()/\-]+/).filter((w) => w.length >= 3);
}

/** Score a result against the query words: exact word match = 2, prefix match = 1. */
function relevanceScore(r: InstitutionLookupResult, qWords: string[]): number {
  const words = new Set(
    r.displayName.toLowerCase().split(/[\s,;.()/\-]+/).filter(Boolean),
  );
  let s = 0;
  for (const qw of qWords) {
    if (words.has(qw)) s += 2;
    else if ([...words].some((w) => w.startsWith(qw))) s += 1;
  }
  return s;
}

function rankByRelevance(
  results: InstitutionLookupResult[],
  query:   string,
): InstitutionLookupResult[] {
  const qWords = queryWords(query);
  if (qWords.length === 0) return results;
  return results
    .map((r, i) => ({ r, s: relevanceScore(r, qWords), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

// ── Internal coordinate helpers ───────────────────────────────────────────────

export type DoctorGeocodeResult =
  | {
      status: "suggestion";
      lat: number;
      lon: number;
      displayName: string;
    }
  | {
      status: "not_found" | "ambiguous";
      candidates?: Array<{ lat: number; lon: number; displayName: string }>;
    };

function normalizeLocationPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Suggest a practice location without changing the stored doctor record.
 *
 * The structured postal-code + city query is deliberately stricter than the
 * background postal-only lookup: a postal code can cover multiple places, so
 * an admin must be shown a single unambiguous suggestion before saving.
 */
export async function geocodeDoctorLocation(
  postalCode: string | null,
  city: string | null,
  country: string,
): Promise<DoctorGeocodeResult> {
  const postal = postalCode?.trim() ?? "";
  const place = city?.trim() ?? "";
  const cc = toCountryCode(country);
  if (!postal || !place || !cc) return { status: "not_found" };

  const url =
    `${NOMINATIM}?postalcode=${encodeURIComponent(postal)}&city=${encodeURIComponent(place)}` +
    `&countrycodes=${cc}&format=json&limit=5&addressdetails=1`;
  const data = await nominatimFetch(url) as NominatimRow[] | null;
  if (!data?.length) return { status: "not_found" };

  const normalizedPostal = normalizeLocationPart(postal);
  const normalizedCity = normalizeLocationPart(place);
  const candidates = data
    .map((row) => {
      const lat = Number(row.lat);
      const lon = Number(row.lon);
      const address = row.address;
      const resultCity = normalizeLocationPart(
        address?.city ?? address?.town ?? address?.village ?? address?.municipality ?? address?.suburb ?? "",
      );
      const resultPostal = normalizeLocationPart(address?.postcode ?? "");
      const displayName = row.display_name?.trim() || [place, country].filter(Boolean).join(", ");

      // If Nominatim supplies either field, it must agree with the submitted
      // address. Missing fields are tolerated because OSM data is incomplete.
      const postalMatches = !resultPostal || resultPostal === normalizedPostal;
      const cityMatches = !resultCity || resultCity === normalizedCity;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !postalMatches || !cityMatches) return null;
      return { lat, lon, displayName };
    })
    .filter((candidate): candidate is { lat: number; lon: number; displayName: string } => candidate !== null)
    .filter((candidate, index, all) =>
      all.findIndex((other) => other.lat === candidate.lat && other.lon === candidate.lon) === index,
    );

  if (candidates.length === 0) return { status: "not_found" };
  if (candidates.length > 1) {
    return { status: "ambiguous", candidates: candidates.slice(0, 5) };
  }
  return { status: "suggestion", ...candidates[0] };
}

async function nominatimLookup(
  postal:      string,
  countryCode: string,
): Promise<{ lat: number; lon: number } | null> {
  const url =
    `${NOMINATIM}?postalcode=${encodeURIComponent(postal)}&countrycodes=${countryCode}` +
    `&format=json&limit=1&addressdetails=0`;
  const data = await nominatimFetch(url) as { lat: string; lon: string }[] | null;
  if (!data?.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

export async function geocodeSearch(
  postalCode:  string,
  countryCode: string,
): Promise<{ lat: number; lon: number } | null> {
  const cc = toCountryCode(countryCode);
  if (!cc) return null;
  return nominatimLookup(postalCode.trim(), cc);
}
