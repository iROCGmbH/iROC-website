import { useState, useMemo, useEffect, useRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useListTrainedDoctors } from '@workspace/api-client-react';
import { MapPin, Stethoscope, Search, Globe, Loader2, X, ExternalLink } from 'lucide-react';
import { cn } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// ─── Haversine distance in km ─────────────────────────────────────────────────
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Nominatim geocoding (free, no auth) ──────────────────────────────────────
type Coords = { lat: number; lon: number };
const geocodeCache = new Map<string, Coords | null>();

async function geocode(query: string): Promise<Coords | null> {
  if (geocodeCache.has(query)) return geocodeCache.get(query)!;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'de,en' } });
    const data = await res.json();
    const coords = data[0] ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
    geocodeCache.set(query, coords);
    return coords;
  } catch {
    geocodeCache.set(query, null);
    return null;
  }
}

async function geocodeZip(zip: string, country: string): Promise<Coords | null> {
  const cacheKey = `zip:${zip}:${country}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;
  try {
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&country=${encodeURIComponent(country)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'de,en' } });
    const data = await res.json();
    const coords = data[0] ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
    geocodeCache.set(cacheKey, coords);
    if (!coords) return geocode(`${zip}, ${country}`);
    return coords;
  } catch {
    return null;
  }
}

// ─── Product badge colours ────────────────────────────────────────────────────
const PRODUCT_COLORS: Record<string, string> = {
  spirecut: 'bg-blue-100 text-blue-700',
  ministem: 'bg-green-100 text-green-700',
};
function productLabel(instrument: string) {
  const map: Record<string, string> = { spirecut: 'Spirecut®', ministem: 'MiniStem®' };
  return map[instrument] ?? instrument;
}
function productColor(instrument: string) {
  return PRODUCT_COLORS[instrument] ?? 'bg-purple-100 text-purple-700';
}

// ─── Country name translations (stored in DE, displayed in EN) ───────────────
const COUNTRY_EN: Record<string, string> = {
  'Deutschland':   'Germany',
  'Österreich':    'Austria',
  'Schweiz':       'Switzerland',
  'Frankreich':    'France',
  'Italien':       'Italy',
  'Niederlande':   'Netherlands',
  'Belgien':       'Belgium',
  'Polen':         'Poland',
  'Tschechien':    'Czech Republic',
  'Vereinigtes Königreich': 'United Kingdom',
  'Spanien':       'Spain',
  'Portugal':      'Portugal',
  'Ungarn':        'Hungary',
  'Rumänien':      'Romania',
  'Kroatien':      'Croatia',
  'Slowenien':     'Slovenia',
  'Slowakei':      'Slovakia',
  // pass-through: already-English entries stay as-is
};
function translateCountry(name: string, lang: string): string {
  if (lang === 'en') return COUNTRY_EN[name] ?? name;
  return name;
}

// ─── All known instrument keys for filtering ──────────────────────────────────
const BASE_PRODUCTS = ['spirecut', 'ministem'];

export default function Doctors() {
  const { t, language } = useLanguage();
  const lang = language.toLowerCase(); // 'de' | 'en'
  const [instrumentFilter, setInstrumentFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [zipInput, setZipInput] = useState('');
  const [zipCountry, setZipCountry] = useState('Deutschland');
  const [searchCoords, setSearchCoords] = useState<Coords | null>(null);
  const [doctorCoords, setDoctorCoords] = useState<Map<number, Coords | null>>(new Map());
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [zipError, setZipError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: doctors = [], isLoading } = useListTrainedDoctors(undefined, {
    query: { queryKey: ['doctors-all'] },
  });

  // Derive unique countries and instruments from data
  const countries = useMemo(() => {
    const set = new Set(doctors.map((d) => d.country));
    return Array.from(set).sort();
  }, [doctors]);

  const allProducts = useMemo(() => {
    const set = new Set<string>(BASE_PRODUCTS);
    doctors.forEach((d) => d.certifications.forEach((c) => set.add(c.instrument)));
    return Array.from(set);
  }, [doctors]);

  // Geocode all doctor cities whenever the list changes
  useEffect(() => {
    if (doctors.length === 0) return;
    const missing = doctors.filter((d) => !doctorCoords.has(d.id));
    if (missing.length === 0) return;
    const run = async () => {
      const updates = new Map(doctorCoords);
      await Promise.all(
        missing.map(async (d) => {
          const q = d.postalCode ? `${d.postalCode}, ${d.city}, ${d.country}` : `${d.city}, ${d.country}`;
          updates.set(d.id, await geocode(q));
        })
      );
      setDoctorCoords(new Map(updates));
    };
    run();
  }, [doctors]);

  // Zip search handler (debounced)
  function handleZipInput(value: string) {
    setZipInput(value);
    setZipError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) { setSearchCoords(null); return; }
    debounceRef.current = setTimeout(async () => {
      setIsGeocoding(true);
      const coords = await geocodeZip(value.trim(), zipCountry);
      setIsGeocoding(false);
      if (coords) { setSearchCoords(coords); setZipError(''); }
      else { setSearchCoords(null); setZipError(t('PLZ nicht gefunden', 'Postcode not found')); }
    }, 600);
  }

  function clearZipSearch() { setZipInput(''); setSearchCoords(null); setZipError(''); }

  // Filter + sort
  const displayed = useMemo(() => {
    let list = doctors;
    if (instrumentFilter !== 'all') {
      list = list.filter((d) => d.certifications.some((c) => c.instrument === instrumentFilter));
    }
    if (countryFilter !== 'all') {
      list = list.filter((d) => d.country === countryFilter);
    }
    if (searchCoords) {
      return list
        .map((d) => {
          const dc = doctorCoords.get(d.id);
          const dist = dc ? haversine(searchCoords.lat, searchCoords.lon, dc.lat, dc.lon) : Infinity;
          return { ...d, _dist: dist };
        })
        .sort((a, b) => a._dist - b._dist);
    }
    return list.map((d) => ({ ...d, _dist: undefined as number | undefined }));
  }, [doctors, instrumentFilter, countryFilter, searchCoords, doctorCoords]);

  return (
    <div className="py-20 bg-muted/10 min-h-screen">
      <div className="container mx-auto px-4 max-w-5xl">

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">{t('Zertifizierte Ärzte', 'Certified Doctors')}</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            {t(
              'Finden Sie einen zertifizierten Spezialisten in Ihrer Nähe, der in der Anwendung unserer Instrumente geschult ist.',
              'Find a certified specialist near you who is trained in the use of our instruments.'
            )}
          </p>
        </div>

        {/* Product filter tabs */}
        <div className="flex justify-center gap-3 mb-8 flex-wrap">
          <button
            onClick={() => setInstrumentFilter('all')}
            className={cn(
              'px-6 py-2 rounded-full font-medium transition-all text-sm',
              instrumentFilter === 'all' ? 'bg-primary text-white shadow-md' : 'bg-white text-muted-foreground border hover:bg-slate-50'
            )}
          >
            {t('Alle', 'All')}
          </button>
          {allProducts.map((p) => (
            <button
              key={p}
              onClick={() => setInstrumentFilter(p)}
              className={cn(
                'px-6 py-2 rounded-full font-medium transition-all text-sm',
                instrumentFilter === p ? 'bg-primary text-white shadow-md' : 'bg-white text-muted-foreground border hover:bg-slate-50'
              )}
            >
              {productLabel(p)}
            </button>
          ))}
        </div>

        {/* Search panel */}
        <div className="bg-white border rounded-2xl shadow-sm p-6 mb-10 grid md:grid-cols-2 gap-6">
          {/* Country filter */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              <Globe className="w-3.5 h-3.5" /> {t('Land / Country', 'Country')}
            </label>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">{t('Alle Länder', 'All countries')}</option>
              {countries.map((c) => <option key={c} value={c}>{translateCountry(c, lang)}</option>)}
            </select>
          </div>

          {/* Zip search */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              <Search className="w-3.5 h-3.5" /> {t('Nächster Standort (PLZ)', 'Nearest location (postcode)')}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  placeholder={t('z.B. 85609', 'e.g. SW1A 1AA')}
                  value={zipInput}
                  onChange={(e) => handleZipInput(e.target.value)}
                  className={cn('pr-8', zipError && 'border-destructive')}
                />
                {isGeocoding && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
                {zipInput && !isGeocoding && (
                  <button onClick={clearZipSearch} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <select
                value={zipCountry}
                onChange={(e) => { setZipCountry(e.target.value); if (zipInput) handleZipInput(zipInput); }}
                className="h-10 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {['Deutschland', 'Österreich', 'Schweiz', 'France', 'Italy', 'Netherlands', 'Belgium', 'Poland', 'Czech Republic', 'United Kingdom'].map((c) => (
                  <option key={c} value={c}>{translateCountry(c, lang)}</option>
                ))}
              </select>
            </div>
            {zipError && <p className="text-xs text-destructive mt-1">{zipError}</p>}
            {searchCoords && !zipError && (
              <p className="text-xs text-green-600 mt-1">
                {t('Sortiert nach Entfernung von PLZ', 'Sorted by distance from postcode')} {zipInput}
              </p>
            )}
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayed.map((doctor) => (
              <div key={doctor.id} className="bg-white rounded-2xl p-6 border shadow-sm hover:shadow-md transition-shadow flex flex-col">
                {/* Instrument badges */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {doctor.certifications.map((c) => (
                    <span key={c.instrument} className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', productColor(c.instrument))}>
                      {productLabel(c.instrument)}
                    </span>
                  ))}
                  {doctor._dist !== undefined && doctor._dist !== Infinity && (
                    <span className="ml-auto text-xs text-muted-foreground font-medium self-center">
                      ~{doctor._dist < 10 ? doctor._dist.toFixed(1) : Math.round(doctor._dist)} km
                    </span>
                  )}
                </div>

                <h3 className="text-lg font-bold mb-1">
                  {doctor.websiteUrl ? (
                    <a
                      href={doctor.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary transition-colors inline-flex items-center gap-1.5 group"
                    >
                      {doctor.title ? `${doctor.title} ` : ''}{doctor.firstName} {doctor.lastName}
                      <ExternalLink className="w-3.5 h-3.5 text-primary/50 group-hover:text-primary transition-colors shrink-0" />
                    </a>
                  ) : (
                    <>{doctor.title ? `${doctor.title} ` : ''}{doctor.firstName} {doctor.lastName}</>
                  )}
                </h3>
                {doctor.specialty && (
                  <p className="text-muted-foreground text-sm mb-3 flex items-center gap-1.5">
                    <Stethoscope className="w-3.5 h-3.5 shrink-0" /> {doctor.specialty}
                  </p>
                )}

                <div className="mt-auto space-y-1.5 text-sm pt-3 border-t">
                  {doctor.institutionName && <div className="font-medium text-slate-800">{doctor.institutionName}</div>}
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    {doctor.postalCode ? `${doctor.postalCode} ` : ''}{doctor.city}
                    {(lang === 'en' || doctor.country !== 'Deutschland') && `, ${translateCountry(doctor.country, lang)}`}
                  </div>
                </div>
              </div>
            ))}

            {displayed.length === 0 && (
              <div className="col-span-full text-center py-20 text-muted-foreground">
                <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>{t('Keine Ärzte mit diesen Filterkriterien gefunden.', 'No doctors found matching your filters.')}</p>
                <Button variant="outline" className="mt-4"
                  onClick={() => { setCountryFilter('all'); clearZipSearch(); setInstrumentFilter('all'); }}>
                  {t('Filter zurücksetzen', 'Reset filters')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
