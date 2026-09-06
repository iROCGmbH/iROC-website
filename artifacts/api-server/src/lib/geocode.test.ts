/**
 * Unit tests for geocode.ts — parseDachAddress() and webSearchFallback().
 *
 * parseDachAddress() scans free-form web-page text (e.g. Exa search snippets)
 * and returns the first plausible DACH postcode + city (+ street when present).
 *
 * webSearchFallback() is Step 5 of _institutionPipeline: it fires only when
 * all OSM / Photon steps return zero results, calls the Exa neural search API,
 * and extracts an address from each result's text snippet via parseDachAddress().
 *
 * ── Exa smoke-test query ─────────────────────────────────────────────────────
 * The clinic name used to exercise the code path end-to-end (requires a live
 * EXA_API_KEY and network access):
 *
 *   GET /api/lookup-institution?name=Tagesklinik+Alstertal+Hamburg
 *
 * "Tagesklinik Alstertal Hamburg" is a small private day-clinic that is absent
 * from OpenStreetMap (verified 2025-08) — all OSM/Photon steps return empty,
 * so Step 5 (webSearchFallback) must supply the address.
 *
 * Expected response shape:
 *   [{ postalCode: "22417", city: "Hamburg", countryCode: "DE", address: "..." }]
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  geocodeDoctorLocation,
  lookupInstitutionMultiple,
  parseDachAddress,
  webSearchFallback,
} from "./geocode";

describe("geocodeDoctorLocation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns one reviewable suggestion from postal code, city, and country", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{
        lat: "48.137154",
        lon: "11.576124",
        display_name: "80331 München, Deutschland",
        address: {
          postcode: "80331",
          city: "München",
          country_code: "de",
        },
      }]),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await geocodeDoctorLocation("80331", "München", "Deutschland");

    expect(result).toEqual({
      status: "suggestion",
      lat: 48.137154,
      lon: 11.576124,
      displayName: "80331 München, Deutschland",
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("postalcode=80331");
    expect(url).toContain("city=M%C3%BCnchen");
    expect(url).toContain("countrycodes=de");
  });

  it("keeps multiple distinct matches ambiguous", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          lat: "48.137154",
          lon: "11.576124",
          display_name: "München Altstadt",
          address: { postcode: "80331", city: "München", country_code: "de" },
        },
        {
          lat: "48.139100",
          lon: "11.580200",
          display_name: "München Zentrum",
          address: { postcode: "80331", city: "München", country_code: "de" },
        },
      ]),
    }));

    const result = await geocodeDoctorLocation("80331", "München", "DE");

    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it("returns no suggestion when the lookup has no matching place", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }));

    await expect(
      geocodeDoctorLocation("00000", "Unbekannt", "Deutschland"),
    ).resolves.toEqual({ status: "not_found" });
  });
});

// ── parseDachAddress ──────────────────────────────────────────────────────────

describe("parseDachAddress", () => {
  it("returns the institution address when multi-address text is present", () => {
    // Simulate a page that lists the clinic's own address first, then a
    // regulatory body's address later on.  The function must pick the first
    // plausible DACH address — the clinic's.
    const text = [
      "Augenklinik München",
      "Leopoldstraße 12",
      "80802 München",
      "",
      "Zertifiziert durch:",
      "Ärztekammer Bayern",
      "Mühlbaurstraße 16",
      "81677 München",
    ].join("\n");

    const result = parseDachAddress(text, "Augenklinik München");
    expect(result).not.toBeNull();
    // Must be the clinic's postcode (first occurrence), not the regulatory body's.
    expect(result!.postalCode).toBe("80802");
    expect(result!.city).toMatch(/München/i);
    expect(result!.countryCode).toBe("DE");
    // Street should have been picked up from the previous line.
    expect(result!.address).toContain("12");
  });

  it("picks up a 4-digit AT postcode and defaults country to AT", () => {
    const text = "Klinik für Augenheilkunde\nGarnisonstraße 7\n4020 Linz";
    const result = parseDachAddress(text, "Klinik Linz");
    expect(result).not.toBeNull();
    expect(result!.postalCode).toBe("4020");
    expect(result!.countryCode).toBe("AT");
    expect(result!.city).toMatch(/Linz/i);
  });

  it("returns null when no DACH postcode is present", () => {
    const text = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
    expect(parseDachAddress(text, "Unknown")).toBeNull();
  });

  it("ignores a line whose city-capture would exceed 35 characters", () => {
    // Over-long capture after postcode should be skipped; valid shorter one picked up.
    const text = [
      "12345 " + "A".repeat(40), // too long — must be skipped
      "10115 Berlin",
    ].join("\n");
    const result = parseDachAddress(text, "Test Klinik");
    expect(result).not.toBeNull();
    expect(result!.postalCode).toBe("10115");
    expect(result!.city).toMatch(/Berlin/i);
  });

  // ── Realistic Exa-snippet shapes ────────────────────────────────────────────

  it("parses a DE address inline on one line (street, PLZ, city)", () => {
    // Exa snippets sometimes compress the address onto a single line.
    const snippet =
      "Tagesklinik Alstertal Hamburg | Kontakt\n" +
      "Adresse: Alsterkrugchaussee 269, 22417 Hamburg\n" +
      "Sprechzeiten Mo–Fr 8–18 Uhr";
    const result = parseDachAddress(snippet, "Tagesklinik Alstertal Hamburg");
    expect(result).not.toBeNull();
    expect(result!.postalCode).toBe("22417");
    expect(result!.city).toMatch(/Hamburg/i);
    expect(result!.countryCode).toBe("DE");
    expect(result!.address).toContain("269");
  });

  it("parses a DE address when postcode and city are the only address data", () => {
    // Exa may return a stripped snippet with no street.
    // Note: city must end at whitespace, comma, semicolon or end-of-line —
    // a trailing period (.) is not a valid terminator in parseDachAddress.
    const snippet =
      "Privatpraxis Dr. Maier – Ästhetische Medizin\n" +
      "70178 Stuttgart\n" +
      "Bitte vereinbaren Sie einen Termin.";
    const result = parseDachAddress(snippet, "Privatpraxis Dr. Maier");
    expect(result).not.toBeNull();
    expect(result!.postalCode).toBe("70178");
    expect(result!.city).toMatch(/Stuttgart/i);
    expect(result!.countryCode).toBe("DE");
  });

  it("parses an AT address from a realistic snippet with a 4-digit postcode", () => {
    const snippet =
      "Klinik Döbling – Ästhetische Chirurgie Wien\n" +
      "Heiligenstädter Straße 46-48\n" +
      "1190 Wien\n" +
      "Tel.: +43 1 36 000";
    const result = parseDachAddress(snippet, "Klinik Döbling");
    expect(result).not.toBeNull();
    expect(result!.postalCode).toBe("1190");
    expect(result!.city).toMatch(/Wien/i);
    expect(result!.countryCode).toBe("AT");
    expect(result!.address).toMatch(/46/);
  });

  it("sets displayName from the fallback name and city", () => {
    const snippet = "Schönheitsklinik XY\nHauptstraße 5\n80331 München";
    const result = parseDachAddress(snippet, "Schönheitsklinik XY");
    expect(result).not.toBeNull();
    expect(result!.displayName).toContain("Schönheitsklinik XY");
    expect(result!.displayName).toContain("München");
  });
});


// ── webSearchFallback (SerpApi) ───────────────────────────────────────────────

describe("webSearchFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns null when SERPAPI_KEY is not set", async () => {
    vi.stubEnv("SERPAPI_KEY", "");
    const result = await webSearchFallback("Tagesklinik Nokey Hamburg");
    expect(result).toBeNull();
  });

  it("prefers the knowledge-graph address over organic snippets", async () => {
    vi.stubEnv("SERPAPI_KEY", "test-key-abc");

    const mockResponse = {
      knowledge_graph: {
        title:   "ROC Regeneratives Centrum",
        adresse: "St.-Emmeram-Straße 5, 85609 Aschheim",
      },
      organic_results: [
        {
          title:   "Some stale directory",
          snippet: "ROC-Testclinic Privatpraxis. St.-Emmeram-Str. 28 85609 Aschheim. Branche: Orthopädie.",
        },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await webSearchFallback("ROC-Testclinic-KG");

    expect(result).not.toBeNull();
    expect(result!.postalCode).toBe("85609");
    expect(result!.city).toMatch(/Aschheim/i);
    // Must be the KG house number 5, NOT the stale directory's 28
    expect(result!.address).toContain("5");
    expect(result!.address).not.toContain("28");
  });

  it("falls back to organic snippets when there is no knowledge graph", async () => {
    vi.stubEnv("SERPAPI_KEY", "test-key-abc");

    const mockResponse = {
      organic_results: [
        {
          title:   "Tagesklinik Snippetfall – Über uns",
          snippet: "Adresse: Alsterkrugchaussee 269, 22417 Hamburg. Telefon: 040 123456",
        },
      ],
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: () => Promise.resolve(mockResponse),
    }));

    const result = await webSearchFallback("Tagesklinik Snippetfall Hamburg");

    expect(result).not.toBeNull();
    expect(result!.postalCode).toBe("22417");
    expect(result!.city).toMatch(/Hamburg/i);
    expect(result!.countryCode).toBe("DE");
    expect(result!.address).toContain("269");
  });

  it("caches the parsed result and does not re-fetch within the TTL", async () => {
    vi.stubEnv("SERPAPI_KEY", "test-key-abc");

    const fetchMock = vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve({
        knowledge_graph: { adresse: "Musterweg 7, 80331 München" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const r1 = await webSearchFallback("Cachetest Klinik München");
    const r2 = await webSearchFallback("Cachetest Klinik München");

    expect(r1).not.toBeNull();
    expect(r2).toEqual(r1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("drops results outside the allowed countries", async () => {
    vi.stubEnv("SERPAPI_KEY", "test-key-abc");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: () => Promise.resolve({
        knowledge_graph: { adresse: "Beispielgasse 3, 85609 Aschheim" }, // DE (5-digit)
      }),
    }));

    // Caller restricted to Austria only → the DE result must be dropped
    const result = await webSearchFallback("Countryfilter Klinik", ["at"]);
    expect(result).toBeNull();
  });

  it("relabels a 4-digit AT-default result as CH when only CH is allowed", async () => {
    vi.stubEnv("SERPAPI_KEY", "test-key-abc");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: () => Promise.resolve({
        knowledge_graph: { adresse: "Bahnhofstrasse 10, 8001 Zürich" },
      }),
    }));

    const result = await webSearchFallback("Zürichklinik Relabel", ["ch"]);
    expect(result).not.toBeNull();
    expect(result!.countryCode).toBe("CH");
  });

  it("returns null silently when the API returns a non-ok status", async () => {
    vi.stubEnv("SERPAPI_KEY", "test-key-abc");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 429 }));

    const result = await webSearchFallback("Tagesklinik Ratelimit Hamburg");
    expect(result).toBeNull();
  });

  it("returns null silently when the API returns 401 Unauthorized (key revoked)", async () => {
    vi.stubEnv("SERPAPI_KEY", "revoked-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }));

    const result = await webSearchFallback("Tagesklinik Revoked Hamburg");
    expect(result).toBeNull();
  });

  it("returns null silently when fetch throws a network error", async () => {
    vi.stubEnv("SERPAPI_KEY", "test-key-abc");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network error")));

    const result = await webSearchFallback("Tagesklinik Netzfehler Hamburg");
    expect(result).toBeNull();
  });

  it("returns null without throwing when fetch is delayed past the timeout", async () => {
    vi.stubEnv("SERPAPI_KEY", "test-key-abc");

    // Spy on AbortSignal.timeout so we can (a) confirm production code calls it and
    // (b) return an already-aborted signal so the test completes instantly without
    // waiting for a real 5 s delay.  AbortSignal.timeout() in Node.js does not
    // honour fake timers, so this is the correct approach.
    const alreadyAborted = AbortSignal.abort(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(alreadyAborted);

    try {
      // A fetch that reacts to the abort signal — rejects immediately when the signal
      // is already aborted (as it will be here) or when its abort event fires.
      // If the production code ever stops passing a signal, this fetch hangs forever
      // and the test times out, catching the regression.
      vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) { reject(signal.reason); return; }
          signal?.addEventListener("abort", () => reject(signal!.reason));
          // Never resolves without abort — simulates a hung remote server.
        }),
      ));

      const result = await webSearchFallback("Tagesklinik Timeout Slow");

      // Must return null (not throw) when fetch rejects with TimeoutError.
      expect(result).toBeNull();
      // Confirm the production code actually called AbortSignal.timeout().
      expect(timeoutSpy).toHaveBeenCalledOnce();
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("sends the clinic name plus 'Adresse' as the query and the api_key parameter", async () => {
    vi.stubEnv("SERPAPI_KEY", "secret-serp-key-xyz");

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok:   true,
      json: () => Promise.resolve({ organic_results: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await webSearchFallback("Queryparam Klinik");

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("serpapi.com/search");
    expect(url).toContain(encodeURIComponent("Queryparam Klinik Adresse"));
    expect(url).toContain("api_key=secret-serp-key-xyz");
  });
});

// ── Lookup-level gate: SerpApi is only called when OSM has no full name match ──

describe("lookupInstitutionMultiple — SerpApi relevance gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("calls SerpApi FIRST (primary source) and still includes OSM results", async () => {
    // SerpApi is the primary search: it runs before the OSM pipeline and its
    // result leads when it matches the typed name. OSM fills remaining slots.
    vi.stubEnv("SERPAPI_KEY", "test-key-serp");

    const serpCalled: string[] = [];

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("photon.komoot.io")) {
        return {
          ok:   true,
          json: () => Promise.resolve({
            features: [{
              properties: {
                name:        "Augenklinik München",
                city:        "München",
                postcode:    "80802",
                countrycode: "de",
                street:      "Leopoldstraße",
                housenumber: "12",
              },
            }],
          }),
        };
      }
      if (url.includes("serpapi.com")) {
        serpCalled.push(url);
        return {
          ok: true,
          json: () => Promise.resolve({
            knowledge_graph: { adresse: "Leopoldstraße 12, 80802 München" },
            organic_results: [],
          }),
        };
      }
      // Nominatim — return empty
      return { ok: true, json: () => Promise.resolve([]) };
    }));

    const results = await lookupInstitutionMultiple("Augenklinik München", undefined, 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].postalCode).toBe("80802");
    expect(results[0].city).toMatch(/München/i);

    // SerpApi is now the PRIMARY search — it must have been called
    expect(serpCalled.length).toBeGreaterThan(0);
  }, 10_000);

  it("labels a Swiss 4-digit address CH when the text mentions Switzerland", async () => {
    // "Spirecut AG" case: Muttenz 4132 is Swiss, but 4-digit postcodes default
    // to AT. The KG type line "… in Muttenz, Schweiz" must flip it to CH.
    vi.stubEnv("SERPAPI_KEY", "test-key-serp");

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("serpapi.com")) {
        return {
          ok: true,
          json: () => Promise.resolve({
            knowledge_graph: {
              type:    "Hersteller von medizinischen Geräten in Muttenz, Schweiz",
              adresse: "Hofackerstrasse 40B, 4132 Muttenz",
            },
            organic_results: [
              { title: "Contact | Spirecut", snippet: "Spirecut AG. Hofackerstrasse 40B, 4132 Muttenz Switzerland." },
            ],
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve(url.includes("photon") ? { features: [] } : []) };
    }));

    const results = await lookupInstitutionMultiple("Spirecut ag", undefined, 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].countryCode).toBe("CH");
    expect(results[0].postalCode).toBe("4132");
    expect(results[0].city).toBe("Muttenz");
  }, 10_000);

  it("returns [] without throwing when Exa/SerpApi returns 401 (key revoked mid-session)", async () => {
    vi.stubEnv("SERPAPI_KEY", "revoked-key");

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("serpapi.com")) {
        return { ok: false, status: 401 };
      }
      // All OSM calls also return empty so the result is purely from the web fallback path
      if (url.includes("photon.komoot.io")) {
        return { ok: true, json: () => Promise.resolve({ features: [] }) };
      }
      return { ok: true, json: () => Promise.resolve([]) };
    }));

    const results = await lookupInstitutionMultiple("Tagesklinik Revoked Hamburg", undefined, 5);
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  }, 10_000);

  it("returns OSM results when SerpApi fetch rejects with TimeoutError (SerpApi unreachable)", async () => {
    // Arrange: SerpApi key is present so webSearchFallback is attempted, but the
    // fetch rejects immediately with a TimeoutError (simulates SerpApi being down).
    // Photon (OSM) returns a valid hit — lookupInstitutionMultiple must still
    // surface it even though the web-search path bailed out silently.
    vi.stubEnv("SERPAPI_KEY", "test-key-timeout");

    const alreadyAborted = AbortSignal.abort(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(alreadyAborted);

    try {
      vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("serpapi.com")) {
          // Simulate the fetch honouring the already-aborted signal
          const signal = init?.signal;
          if (signal?.aborted) throw signal.reason;
          throw new DOMException("The operation timed out.", "TimeoutError");
        }
        if (url.includes("photon.komoot.io")) {
          return {
            ok:   true,
            json: () => Promise.resolve({
              features: [{
                properties: {
                  name:        "Augenklinik Hamburg",
                  city:        "Hamburg",
                  postcode:    "20095",
                  countrycode: "de",
                  street:      "Mönckebergstraße",
                  housenumber: "3",
                },
              }],
            }),
          };
        }
        // Nominatim — return empty
        return { ok: true, json: () => Promise.resolve([]) };
      }));

      const results = await lookupInstitutionMultiple("Augenklinik Hamburg", undefined, 5);

      // Must not throw and must still return the Photon/OSM result
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].postalCode).toBe("20095");
      expect(results[0].city).toMatch(/Hamburg/i);
      expect(results[0].countryCode).toBe("DE");
    } finally {
      timeoutSpy.mockRestore();
    }
  }, 10_000);

  it("calls SerpApi and ranks its named result first when OSM has only generic hits", async () => {
    // "Zentrum" appears in both INST_STOP and MEDICAL_TYPE_WORDS:
    //   • locationCandidates → [] → Step 3 = 0 calls
    //   • hasMedicalType = true → Step 4 augmentation is skipped
    // Net OSM calls: Photon + Nominatim — both return empty → gate fires.
    vi.stubEnv("SERPAPI_KEY", "test-key-serp");

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("serpapi.com")) {
        return {
          ok:   true,
          json: () => Promise.resolve({
            knowledge_graph: { adresse: "Hauptstraße 42, 80331 München" },
          }),
        };
      }
      if (url.includes("photon.komoot.io")) {
        return { ok: true, json: () => Promise.resolve({ features: [] }) };
      }
      return { ok: true, json: () => Promise.resolve([]) };
    }));

    const results = await lookupInstitutionMultiple("Zentrum", undefined, 5);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].postalCode).toBe("80331");
    expect(results[0].city).toMatch(/München/i);
    expect(results[0].countryCode).toBe("DE");
    expect(results[0].address).toContain("42");
  }, 10_000);
});
