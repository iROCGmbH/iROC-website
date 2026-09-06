import { Router, type IRouter } from "express";
import { lookup as dnsLookup } from "node:dns/promises";
import { db } from "@workspace/db";
import { trainedDoctorsTable, doctorCertificationsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { geocodeSearch, toCountryCode, lookupPostalAddress, lookupInstitutionMultiple } from "../lib/geocode";

const router: IRouter = Router();

router.get("/doctors", async (req, res) => {
  const instrumentFilter = req.query.instrument as string | undefined;

  let doctors = await db.select().from(trainedDoctorsTable);
  let certs = await db.select().from(doctorCertificationsTable);

  if (instrumentFilter) {
    const matchingDoctorIds = new Set(
      certs
        .filter((c) => c.instrument === instrumentFilter)
        .map((c) => c.doctorId)
    );
    doctors = doctors.filter((d) => matchingDoctorIds.has(d.id));
    certs = certs.filter((c) => matchingDoctorIds.has(c.doctorId));
  }

  const certsByDoctor = new Map<number, { instrument: string; certifiedDate: string }[]>();
  for (const c of certs) {
    if (!certsByDoctor.has(c.doctorId)) certsByDoctor.set(c.doctorId, []);
    certsByDoctor.get(c.doctorId)!.push({ instrument: c.instrument, certifiedDate: c.certifiedDate });
  }

  const result = doctors.map((r) => ({
    id: r.id,
    title: r.title ?? null,
    firstName: r.firstName,
    lastName: r.lastName,
    specialty: r.specialty ?? null,
    institutionName: r.institutionName ?? null,
    city: r.city,
    postalCode: r.postalCode ?? null,
    country: r.country,
    phone: r.phone ?? null,
    email: r.email ?? null,
    websiteUrl: r.websiteUrl ?? null,
    lat: r.lat ?? null,
    lon: r.lon ?? null,
    certifications: certsByDoctor.get(r.id) ?? [],
  }));

  res.json(result);
});

/**
 * Postal-code → city/country lookup for address suggestion.
 * GET /api/lookup-postal?postalCode=80331&countryCode=DE
 * Returns { city, state, countryCode, postcode, displayName }
 */
router.get("/lookup-postal", async (req, res) => {
  const postalCode = (req.query.postalCode as string ?? "").trim();
  const countryCode = (req.query.countryCode as string ?? "DE").trim();
  if (!postalCode || postalCode.length < 3) {
    return res.status(400).json({ error: "postalCode required (min 3 chars)" });
  }
  // Accept any 2-letter ISO code; fall back to "de" if unrecognised
  const cc = countryCode.length === 2 ? countryCode.toLowerCase() : "de";
  const result = await lookupPostalAddress(postalCode, cc);
  if (!result) return res.status(404).json({ error: "not found" });
  return res.json(result);
});

/** Proxy geocoding requests to Nominatim so the browser never calls it directly. */
router.get("/geocode-postal", async (req, res) => {
  const postal = (req.query.postal as string ?? "").trim();
  const country = (req.query.country as string ?? "").trim();
  if (!postal || !country) {
    return res.status(400).json({ error: "postal and country are required" });
  }
  const cc = toCountryCode(country);
  if (!cc) return res.status(400).json({ error: "unrecognised country" });

  const coords = await geocodeSearch(postal, cc);
  if (!coords) return res.status(404).json({ error: "not found" });
  return res.json(coords);
});

/**
 * Institution-name → address suggestions (up to 5 matches).
 * GET /api/lookup-institution?name=ATOMOS+Klinik&countryCode=DE
 * Returns InstitutionLookupResult[]  (always an array, may be empty)
 */
router.get("/lookup-institution", async (req, res) => {
  const name        = (req.query.name        as string ?? "").trim();
  const countryCode = (req.query.countryCode as string ?? "").trim();
  if (!name || name.length < 3) {
    return res.status(400).json({ error: "name required (min 3 chars)" });
  }
  const results = await lookupInstitutionMultiple(name, countryCode || undefined, 5);
  return res.json(results);          // always array; empty = no match
});

// ── VAT ID lookup ─────────────────────────────────────────────────────────────

/** Regexes that match VAT/USt-IdNr formats for DACH + EU. */
const VAT_REGEXES: RegExp[] = [
  /\bDE\s*\d{3}\s*\d{3}\s*\d{3}\b/gi,   // Germany: DE + 9 digits
  /\bATU\s*\d{4}\s*\d{4}\b/gi,           // Austria: ATU + 8 digits
  /\bCHE[-\s]?\d{3}[.\s]\d{3}[.\s]\d{3}\b/gi, // Switzerland: CHE-xxx.xxx.xxx
  /\b[A-Z]{2}\s*[0-9A-Z]{8,12}\b/g,     // Generic EU VAT (catch-all)
];

/**
 * Keywords that commonly label a VAT / tax-ID field in impressum text.
 * Covers DE / AT / CH and the major EU country variants.
 *
 *  DE: USt-IdNr. · USt.-ID · UStIDNr · Umsatzsteuer-Identifikationsnummer · MwSt-Nr.
 *  AT: UID · UID-Nr. · UID-Nummer · ATU (prefix itself)
 *  CH: MWST-Nr. · MWST-Nummer · Mehrwertsteuernummer · CHE (prefix)
 *  EU: VAT ID/No/Number · TVA · BTW · IVA · ALV · Moms · MVA · PDV · PVM
 */
const VAT_KEYWORDS = new RegExp(
  [
    // German / Austrian
    "ust[.\\-\\s]*id(?:nr)?\\.?",
    "umsatzsteuer[\\-\\s]*(?:id(?:entifikationsnummer|nr?)?\\.?|identifikations[\\-\\s]*nr?\\.?)",
    "mwst[.\\-\\s]*(?:nr|nummer)",
    "mehrwertsteuer[\\-\\s]*(?:nr|nummer|id)",
    "uid[.\\-\\s]*(?:nr|nummer)",
    "steuer[\\-\\s]*(?:id|identifikationsnummer)",
    // Swiss
    "mwst[\\-\\s]*nr",
    // English
    "vat[\\s\\-]*(?:id|number|no\\.?|nr\\.?|reg(?:istration)?)",
    "tax[\\s\\-]*(?:id|identification|reg(?:istration)?)[\\s\\-]*(?:number|nr)?\\.?",
    // Other EU (French, Dutch/Belgian, Spanish/Italian, Finnish, Scandinavian, Balkan, Baltic)
    "t\\.?v\\.?a\\.?(?:[\\s\\-]*(?:intracom(?:munautaire)?|nr|no))?",
    "btw[\\-\\s]*(?:nr|nummer)",
    "iva[\\-\\s]*(?:nr|n[úu]mero)",
    "alv[\\-\\s]*(?:nr|tunnus)",
    "moms[\\-\\s]*(?:nr|nummer)",
    "mva[\\-\\s]*(?:nr|nummer)",
    "pdv[\\-\\s]*(?:br(?:oj)?)?",
    "pvm[\\-\\s]*(?:kodas)?",
    "km[\\-\\s]*(?:szám|nr)",
  ].join("|"),
  "i",
);

/** Placeholder / example IDs that documentation pages love to quote. */
function isPlaceholderVat(id: string): boolean {
  const digits = id.replace(/\D/g, "");
  if (/123456789?|987654321?|12345678/.test(digits)) return true;
  if (/^(\d)\1+$/.test(digits))                      return true; // all same digit
  return false;
}

/** Extract all recognisable VAT IDs from a block of plain text, keyword-annotated first. */
function extractVatIds(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const keyworded: string[] = [];
  const generic:   string[] = [];

  for (const line of lines) {
    const isKeywordLine = VAT_KEYWORDS.test(line);
    for (const re of VAT_REGEXES) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const raw = m[0].replace(/\s/g, "").toUpperCase();
        if (isPlaceholderVat(raw)) continue;
        (isKeywordLine ? keyworded : generic).push(raw);
      }
    }
  }
  // Keyword-annotated matches first; generic candidates only when they carry a
  // known national prefix (avoids matching random uppercase tokens).
  const ordered = [...keyworded, ...generic.filter(c => /^(DE\d|ATU|CHE)/.test(c))];
  return [...new Set(ordered)];
}

/** Extract the first recognisable VAT ID from a block of plain text. */
function extractVatId(text: string): string | null {
  return extractVatIds(text)[0] ?? null;
}

/** Expected VAT prefix per country — used to prefer the right ID when a page
 *  quotes several (e.g. a directory listing multiple companies). */
const VAT_PREFIX_BY_COUNTRY: Record<string, RegExp> = {
  DE: /^DE\d/, AT: /^ATU/, CH: /^CHE/,
};

/** Strip HTML tags and collapse whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** True when an IP (v4 or v6) is loopback / private / link-local / CGNAT / metadata. */
function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const low = ip.toLowerCase();
    if (low.startsWith("::ffff:")) return isPrivateIp(low.slice(7)); // v4-mapped
    return low === "::" || low === "::1"
        || low.startsWith("fe80") // link-local
        || low.startsWith("fc") || low.startsWith("fd"); // unique-local fc00::/7
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true; // be safe
  return p[0] === 0 || p[0] === 10 || p[0] === 127
      || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)  // CGNAT
      || (p[0] === 169 && p[1] === 254)               // link-local / cloud metadata
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168);
}

/**
 * SSRF guard: reject non-HTTP(S) URLs and any hostname that resolves to a
 * private / loopback / link-local address (covers DNS-based bypasses).
 */
async function isSafeUrl(raw: string): Promise<boolean> {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const h = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
    if (/^localhost$/i.test(h)) return false;
    // Literal IP → check directly; hostname → resolve ALL addresses and check each.
    if (/^[\d.]+$/.test(h) || h.includes(":")) return !isPrivateIp(h);
    const addrs = await dnsLookup(h, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every(a => !isPrivateIp(a.address));
  } catch { return false; }
}

/**
 * Fetch a URL with a timeout; returns null on any error.
 * Follows at most 3 redirects MANUALLY, re-validating every destination
 * against the SSRF guard (fetch's automatic redirects would skip validation).
 */
async function safeFetch(url: string, timeoutMs = 6000): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await isSafeUrl(current))) return null;
    try {
      const res = await fetch(current, {
        signal:   AbortSignal.timeout(timeoutMs),
        redirect: "manual",
        headers:  { "User-Agent": "Mozilla/5.0 (compatible; iROC-bot/1.0)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        current = new URL(loc, current).href; // resolve relative redirects
        continue;
      }
      if (!res.ok) return null;
      // Cap response size at 2 MB — impressum pages are small.
      const text = await res.text();
      return text.length > 2_000_000 ? text.slice(0, 2_000_000) : text;
    } catch { return null; }
  }
  return null; // too many redirects
}

/** Candidate impressum-style paths to try, in priority order. */
const IMPRESSUM_PATHS = [
  "/impressum", "/impressum.html", "/impressum/",
  "/legal-notice", "/legal", "/datenschutz-und-impressum",
  "/en/legal-notice", "/en/impressum",
  "/de/impressum",
];

/**
 * Scrape a website for its VAT ID.
 * Tries impressum paths first, then the homepage itself.
 */
async function scrapeWebsiteVat(websiteRaw: string): Promise<string | null> {
  let base: string;
  try {
    // Normalise: ensure scheme present
    const url = websiteRaw.startsWith("http") ? websiteRaw : `https://${websiteRaw}`;
    base = new URL(url).origin;
  } catch { return null; }

  for (const path of IMPRESSUM_PATHS) {
    const html = await safeFetch(base + path);
    if (!html) continue;
    const text = stripHtml(html);
    const vatId = extractVatId(text);
    if (vatId) return vatId;
  }

  // Last resort: homepage
  const homeHtml = await safeFetch(base + "/");
  if (homeHtml) {
    const vatId = extractVatId(stripHtml(homeHtml));
    if (vatId) return vatId;
  }
  return null;
}

/**
 * SerpApi search fallback: look for VAT ID in Google's knowledge graph
 * or organic snippets for a query like `"Klinik XY" Impressum USt-IdNr`.
 */
async function serpVatSearch(institutionName: string, country?: string, city?: string): Promise<string | null> {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;

  // Plain keyword queries work far better than heavily-quoted OR queries
  // (which often return zero results). Include the city when known — it
  // disambiguates same-named entities (e.g. Spirecut AG Muttenz vs SA Fribourg).
  const nameAndCity = city ? `${institutionName} ${city}` : institutionName;
  const queries: string[] = [];
  if (country === "CH")      queries.push(`${nameAndCity} UID MWST`);
  else if (country === "AT") queries.push(`${nameAndCity} UID-Nummer Umsatzsteuer`);
  else if (country === "DE") queries.push(`${nameAndCity} USt-IdNr Impressum`);
  queries.push(`${nameAndCity} UID Mehrwertsteuer USt-IdNr VAT`);

  const preferRe  = country ? VAT_PREFIX_BY_COUNTRY[country] : undefined;
  const cityLower = (city ?? "").toLowerCase();
  let fallback: string | null = null;

  for (const q of queries) {
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&hl=de&num=8&api_key=${key}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const data = await res.json() as Record<string, unknown>;

      // Collect text blocks — each organic result stays its own block so we can
      // attribute an ID to the entity mentioned alongside it.
      const blocks: string[] = [];
      const kg = data["knowledge_graph"] as Record<string, string> | undefined;
      if (kg) blocks.push(Object.values(kg).filter((v): v is string => typeof v === "string").join("\n"));
      const organics = (data["organic_results"] as { snippet?: string; title?: string }[] | undefined) ?? [];
      for (const r of organics) blocks.push([r.title ?? "", r.snippet ?? ""].join("\n"));

      // Pass 1: blocks that mention the city (best entity match).
      // Pass 2: all blocks.
      const passes = cityLower
        ? [blocks.filter(b => b.toLowerCase().includes(cityLower)), blocks]
        : [blocks];
      for (const pass of passes) {
        const ids = extractVatIds(pass.join("\n"));
        if (!ids.length) continue;
        if (preferRe) {
          // HARD rule for known DACH countries: only accept an ID with the
          // matching national prefix. A wrong-country VAT ID on an invoice is
          // worse than an empty field the user fills in manually.
          const match = ids.find(id => preferRe.test(id));
          if (match) return match;
        } else {
          fallback ??= ids[0];
        }
      }
    } catch { /* try next query */ }
  }
  return fallback;
}

/**
 * GET /api/lookup-vat
 *   ?website=https://example.com        (optional — scrape impressum)
 *   &institutionName=ATOMOS+Klinik      (optional — used for SerpApi fallback)
 *   &country=AT                         (optional — for context only)
 *
 * Returns { vatId: string } | { vatId: null }
 */
router.get("/lookup-vat", async (req, res) => {
  const website         = (req.query.website         as string ?? "").trim();
  const institutionName = (req.query.institutionName as string ?? "").trim();
  const country         = (req.query.country         as string ?? "").trim().toUpperCase();
  const city            = (req.query.city            as string ?? "").trim();

  if (!website && !institutionName) {
    return res.status(400).json({ error: "website or institutionName required" });
  }

  // Step 1 – SerpApi search (primary — most reliable, country- and city-aware)
  if (institutionName) {
    const vatId = await serpVatSearch(institutionName, country || undefined, city || undefined);
    if (vatId) return res.json({ vatId });
  }

  // Step 2 – scrape the institution's own website impressum
  if (website) {
    const vatId = await scrapeWebsiteVat(website);
    if (vatId) return res.json({ vatId });
  }

  return res.json({ vatId: null });
});

export default router;
