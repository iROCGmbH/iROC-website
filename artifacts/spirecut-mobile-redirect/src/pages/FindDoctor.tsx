import { useState, useCallback } from "react";
import { MapPin, Globe, ChevronRight, Loader2, AlertCircle, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDoctors, Doctor } from "@/hooks/useDoctors";
import {
  DOCTOR_RADIUS_OPTIONS,
  filterDoctorsByRadius,
  type DoctorRadiusKm,
} from "@workspace/spirecut-shared";

async function geocodePostal(postal: string, country: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(`/api/geocode-postal?postal=${encodeURIComponent(postal)}&country=${encodeURIComponent(country)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Country helpers
// ---------------------------------------------------------------------------

const GERMANY_LABELS = ["Deutschland", "Germany", "DE"];
const AUSTRIA_LABELS = ["Österreich", "Austria", "AT"];

function countryBucket(country: string): "de" | "at" | "other" {
  if (GERMANY_LABELS.some((l) => country.toLowerCase() === l.toLowerCase())) return "de";
  if (AUSTRIA_LABELS.some((l) => country.toLowerCase() === l.toLowerCase())) return "at";
  return "other";
}

function sortByCity(a: Doctor, b: Doctor): number {
  return a.city.localeCompare(b.city, "de");
}

// ---------------------------------------------------------------------------
// PracticeCard
// ---------------------------------------------------------------------------

function PracticeCard({ doctor, distanceKm }: { doctor: Doctor; distanceKm?: number }) {
  const { t } = useTranslation();
  const name = doctor.institutionName ?? [doctor.title, doctor.firstName, doctor.lastName].filter(Boolean).join(" ");
  const doctorName = doctor.institutionName
    ? [doctor.title, doctor.firstName, doctor.lastName].filter(Boolean).join(" ")
    : null;
  const address = [doctor.postalCode, doctor.city].filter(Boolean).join(" ");

  return (
    <div className="bg-white rounded-lg p-6 border border-gray-200 hover:border-primary/40 hover:shadow-sm transition-all group flex flex-col h-full">
      <div className="mb-4 flex-1">
        <h3 className="text-base font-bold text-gray-900 mb-1">{name}</h3>

        {doctorName && (
          <p className="text-gray-500 text-sm mb-3">{doctorName}</p>
        )}

        {address && (
          <div className="flex items-start mt-3 text-gray-500">
            <MapPin className="h-4 w-4 mr-2 shrink-0 text-primary mt-0.5" />
            <span className="text-sm leading-tight">{address}</span>
          </div>
        )}

        {distanceKm !== undefined && (
          <div className="mt-2">
            <span className="inline-block text-xs font-medium bg-primary/10 text-primary rounded-full px-2.5 py-0.5">
              ~{Math.round(distanceKm)} km
            </span>
          </div>
        )}
      </div>

      {doctor.websiteUrl && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <a
            href={doctor.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            <Globe className="h-4 w-4 mr-2 shrink-0" />
            {t("findDoctor.practiceWebsite")}
            <ChevronRight className="h-4 w-4 ml-auto opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CountrySection (for non-search view)
// ---------------------------------------------------------------------------

function CountrySection({ titleKey, doctors }: { titleKey: string; doctors: Doctor[] }) {
  const { t } = useTranslation();
  if (doctors.length === 0) return null;
  return (
    <div className="mb-16">
      <div className="flex items-center gap-4 mb-8">
        <h2 className="text-xl font-bold text-gray-900">{t(titleKey)}</h2>
        <div className="flex-1 h-px bg-gray-200" />
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {doctors.map((d) => (
          <PracticeCard key={d.id} doctor={d} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radius options
// ---------------------------------------------------------------------------

type RadiusKm = DoctorRadiusKm | null;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FindDoctor() {
  const { t } = useTranslation();
  const { doctors, loading, error } = useDoctors();

  // Search state
  const [zipInput, setZipInput] = useState("");
  const [radiusKm, setRadiusKm] = useState<RadiusKm>(50);
  const [countryFilter, setCountryFilter] = useState<"all" | "de" | "at">("all");

  // Search result state
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ lat: number; lon: number; label: string } | null>(null);

  // All unique countries present in data (for filter dropdown)
  const availableCountries = (() => {
    const buckets = new Set(doctors.map((d) => countryBucket(d.country)));
    return buckets;
  })();

  // Compute visible doctors with optional distance
  const doctorsWithDistance: { doctor: Doctor; distanceKm?: number }[] = (() => {
    let list = doctors;

    // Country filter (applied in both search and non-search mode)
    if (countryFilter !== "all") {
      list = list.filter((d) => countryBucket(d.country) === countryFilter);
    }

    if (!origin) {
      return list.map((d) => ({ doctor: d }));
    }

    return radiusKm == null
      ? filterDoctorsByRadius(list, origin, null)
      : filterDoctorsByRadius(list, origin, radiusKm);
  })();

  // Grouped for non-search display
  const de = doctors
    .filter((d) => countryBucket(d.country) === "de" && (countryFilter === "all" || countryFilter === "de"))
    .sort(sortByCity);
  const at = doctors
    .filter((d) => countryBucket(d.country) === "at" && (countryFilter === "all" || countryFilter === "at"))
    .sort(sortByCity);
  const other = doctors
    .filter((d) => countryBucket(d.country) === "other" && countryFilter === "all")
    .sort(sortByCity);

  const handleSearch = useCallback(async () => {
    const zip = zipInput.trim();
    if (!zip) return;
    setSearching(true);
    setSearchError(null);

    // Determine country to geocode against
    const geoCountry =
      countryFilter === "de" ? "de" :
      countryFilter === "at" ? "at" :
      "de"; // default to DE for "all"

    const coords = await geocodePostal(zip, geoCountry);
    setSearching(false);
    if (!coords) {
      setSearchError(t("findDoctor.zipNotFound"));
      setOrigin(null);
    } else {
      setOrigin({ ...coords, label: zip });
    }
  }, [zipInput, countryFilter, t]);

  const handleClear = () => {
    setZipInput("");
    setOrigin(null);
    setSearchError(null);
  };

  const showSearchResults = origin !== null;

  return (
    <div className="flex flex-col w-full bg-white">
      {/* Hero */}
      <section className="bg-gray-900 text-white pt-20 pb-20">
        <div className="container mx-auto px-4 lg:px-8 max-w-4xl text-center">
          <h1 className="text-4xl lg:text-5xl font-bold text-white mb-5">
            {t("findDoctor.heroTitle")}
          </h1>
          <div className="w-10 h-0.5 bg-primary mx-auto mb-6" />
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            {t("findDoctor.heroDesc")}
          </p>
        </div>
      </section>

      {/* Search bar */}
      <section className="bg-gray-50 border-b border-gray-200">
        <div className="container mx-auto px-4 lg:px-8 py-6 max-w-4xl">
          <div className="flex flex-wrap gap-3 items-end">
            {/* ZIP input */}
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {t("findDoctor.zipLabel")}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={zipInput}
                  onChange={(e) => setZipInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder={t("findDoctor.zipPlaceholder")}
                  className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                />
                {zipInput && (
                  <button
                    onClick={handleClear}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={t("findDoctor.clearSearch")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Radius */}
            <div className="min-w-[130px]">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {t("findDoctor.radiusLabel")}
              </label>
              <select
                value={radiusKm ?? "all"}
                onChange={(e) => setRadiusKm(e.target.value === "all" ? null : Number(e.target.value) as RadiusKm)}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              >
                {DOCTOR_RADIUS_OPTIONS.map((r) => (
                  <option key={r} value={r}>{r} km</option>
                ))}
                <option value="all">{t("findDoctor.radiusAll")}</option>
              </select>
            </div>

            {/* Country filter */}
            <div className="min-w-[130px]">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                {t("findDoctor.countryLabel")}
              </label>
              <select
                value={countryFilter}
                onChange={(e) => {
                  setCountryFilter(e.target.value as "all" | "de" | "at");
                  setOrigin(null); // clear search when country changes
                  setSearchError(null);
                }}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              >
                <option value="all">{t("findDoctor.countryAll")}</option>
                {availableCountries.has("de") && <option value="de">{t("findDoctor.germany")}</option>}
                {availableCountries.has("at") && <option value="at">{t("findDoctor.austria")}</option>}
              </select>
            </div>

            {/* Search button */}
            <button
              onClick={handleSearch}
              disabled={!zipInput.trim() || searching}
              className="h-10 px-5 rounded-lg bg-primary text-white text-sm font-semibold flex items-center gap-2 hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 self-end"
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {t("findDoctor.searchBtn")}
            </button>

            {/* Clear search */}
            {showSearchResults && (
              <button
                onClick={handleClear}
                className="h-10 px-4 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-100 transition-colors shrink-0 self-end"
              >
                {t("findDoctor.clearSearch")}
              </button>
            )}
          </div>

          {/* Search error */}
          {searchError && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {searchError}
            </p>
          )}

          {/* Active search summary */}
          {showSearchResults && !searchError && (
            <p className="mt-3 text-sm text-gray-500">
              {doctorsWithDistance.length === 0
                ? t("findDoctor.noResults", { zip: origin!.label, radius: radiusKm ?? "∞" })
                : t("findDoctor.resultsSummary", {
                    count: doctorsWithDistance.length,
                    zip: origin!.label,
                    radius: radiusKm ?? "∞",
                  })}
            </p>
          )}
        </div>
      </section>

      <div className="container mx-auto px-4 lg:px-8 py-16">
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center gap-3 py-24 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t("findDoctor.loading")}</span>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex items-center justify-center gap-3 py-24 text-red-500">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm">{t("findDoctor.error")}</span>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Search results — flat grid sorted by distance */}
            {showSearchResults && (
              <>
                {doctorsWithDistance.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-3">
                    <MapPin className="h-8 w-8 opacity-30" />
                    <p className="text-sm">{t("findDoctor.noResultsHint")}</p>
                  </div>
                ) : (
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {doctorsWithDistance.map(({ doctor, distanceKm }) => (
                      <PracticeCard key={doctor.id} doctor={doctor} distanceKm={distanceKm} />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Non-search view — grouped by country */}
            {!showSearchResults && (
              <>
                <CountrySection titleKey="findDoctor.germany" doctors={de} />
                <CountrySection titleKey="findDoctor.austria" doctors={at} />
                {other.length > 0 && (
                  <CountrySection titleKey="findDoctor.otherCountries" doctors={other} />
                )}
                {de.length === 0 && at.length === 0 && other.length === 0 && (
                  <div className="flex items-center justify-center py-24 text-gray-400">
                    <span className="text-sm">{t("findDoctor.noResultsHint")}</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
