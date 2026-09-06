import { useState, useEffect, useReducer } from "react";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Search, Globe, CalendarDays, MapPin, Trash2, Loader2, BookmarkPlus, Check, Square,
} from "lucide-react";
import { adminGet, adminPost, adminDelete } from "@/lib/admin-fetch";

// ── Themes ────────────────────────────────────────────────────────────────────

const ALL_THEMES = [
  "Orthobiology",
  "PRP",
  "Peptide",
  "Exosome",
  "Stem Cell",
  "MFAT",
  "SVF",
  "Regeneration",
  "Hand Surgery",
  "Ultrasound-guided orthopedic instruments",
  "Young & Student Surgeon Congresses",
  "Outpatient Surgeries",
  "Orthopedic",
  "MiniStem",
  "Spirecut",
  "Minimal Invasive",
  "Aptissen",
] as const;

// ── Locations ─────────────────────────────────────────────────────────────────

interface LocationOption {
  value: string;   // country code / key used in the prompt
  label: string;   // display name (DE)
  labelEn: string; // display name (EN)
  flag: string;
}

const ALL_LOCATIONS: LocationOption[] = [
  { value: "Germany",        label: "Deutschland",          labelEn: "Germany",        flag: "🇩🇪" },
  { value: "Austria",        label: "Österreich",           labelEn: "Austria",        flag: "🇦🇹" },
  { value: "Switzerland",    label: "Schweiz",              labelEn: "Switzerland",    flag: "🇨🇭" },
  { value: "France",         label: "Frankreich",           labelEn: "France",         flag: "🇫🇷" },
  { value: "Italy",          label: "Italien",              labelEn: "Italy",          flag: "🇮🇹" },
  { value: "Spain",          label: "Spanien",              labelEn: "Spain",          flag: "🇪🇸" },
  { value: "Netherlands",    label: "Niederlande",          labelEn: "Netherlands",    flag: "🇳🇱" },
  { value: "Belgium",        label: "Belgien",              labelEn: "Belgium",        flag: "🇧🇪" },
  { value: "Poland",         label: "Polen",                labelEn: "Poland",         flag: "🇵🇱" },
  { value: "Czech Republic", label: "Tschechien",           labelEn: "Czech Republic", flag: "🇨🇿" },
  { value: "Hungary",        label: "Ungarn",               labelEn: "Hungary",        flag: "🇭🇺" },
  { value: "Sweden",         label: "Schweden",             labelEn: "Sweden",         flag: "🇸🇪" },
  { value: "Denmark",        label: "Dänemark",             labelEn: "Denmark",        flag: "🇩🇰" },
  { value: "Norway",         label: "Norwegen",             labelEn: "Norway",         flag: "🇳🇴" },
  { value: "United Kingdom", label: "UK / Großbritannien",  labelEn: "UK",             flag: "🇬🇧" },
  { value: "International",  label: "International",        labelEn: "International",  flag: "🌍" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface CongressResult {
  name: string;
  specialtyFocus: string;
  startDate: string;
  endDate: string;
  location: string;
  website: string;
}

interface SavedCongressEvent {
  id: number;
  title: string;
  specialtyFocus: string | null;
  location: string | null;
  eventDate: string;
  endDate: string | null;
  externalUrl: string;
  mediaUrl: string | null;
  isActive: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dateRange(start: string, end?: string | null) {
  const s = fmtDate(start);
  if (!end || end === start) return s;
  return `${s} – ${fmtDate(end)}`;
}

const CONGRESS_QK = ["iroc-congress-events"];

// ── Module-level search store (persists across navigation) ────────────────────

interface SearchStore {
  searching: boolean;
  results: CongressResult[] | null;
  pendingErrorMsg: string | null;
}

let _searchStore: SearchStore = { searching: false, results: null, pendingErrorMsg: null };
let _searchAbort: AbortController | null = null;
const _searchListeners = new Set<() => void>();

function _notifySearch() {
  _searchListeners.forEach((fn) => fn());
}

// ── Page component ────────────────────────────────────────────────────────────

export default function UpcomingEvents() {
  const { lang } = useLanguage();
  const { token } = useAuth();
  const { toast } = useToast();
  const de = lang === "de";

  // Subscribe to module-level search store — search survives navigation
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    _searchListeners.add(forceUpdate);
    // If search errored while we were away, surface the toast now
    if (_searchStore.pendingErrorMsg) {
      toast({
        title: de ? "Suche fehlgeschlagen" : "Search failed",
        description: _searchStore.pendingErrorMsg,
        variant: "destructive",
      });
      _searchStore = { ..._searchStore, pendingErrorMsg: null };
    }
    return () => { _searchListeners.delete(forceUpdate); };
  }, [de, toast]);

  const searching = _searchStore.searching;
  const results   = _searchStore.results;

  // UI-only state (doesn't need to persist)
  const [selectedThemes, setSelectedThemes] = useState<string[]>([...ALL_THEMES]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(["Germany", "Austria"]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [customQuery, setCustomQuery] = useState("");

  // Save-dialog state
  const [savingResult, setSavingResult] = useState<CongressResult | null>(null);
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // Saved congress events
  const { data: savedEvents = [], refetch: refetchSaved } = useQuery({
    queryKey: CONGRESS_QK,
    queryFn: () => adminGet<SavedCongressEvent[]>("/api/iroc/congress", token!),
    enabled: !!token,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminDelete(`/api/iroc/congress/${id}`, token!),
    onSuccess: () => {
      refetchSaved();
      toast({ title: de ? "Kongress entfernt" : "Congress removed" });
    },
    onError: (err) => toast({ title: de ? "Fehler" : "Error", description: String(err), variant: "destructive" }),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function toggleTheme(t: string) {
    setSelectedThemes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  function toggleLocation(v: string) {
    setSelectedLocations((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  }

  function handleStop() {
    _searchAbort?.abort();
  }

  async function handleSearch() {
    if (!token || selectedThemes.length === 0) return;
    // Cancel any in-flight request first
    _searchAbort?.abort();
    const controller = new AbortController();
    _searchAbort = controller;

    _searchStore = { searching: true, results: null, pendingErrorMsg: null };
    _notifySearch();

    try {
      const data = await adminPost<{ results: CongressResult[]; year: number }>(
        "/api/iroc/congress/search",
        token,
        {
          year,
          themes: selectedThemes,
          locations: selectedLocations,
          query: customQuery.trim() || undefined,
        },
        { signal: controller.signal },
      );
      const today = new Date().toISOString().split("T")[0];
      const upcoming = (data.results ?? []).filter(
        (r) => !r.startDate || r.startDate >= today,
      );
      _searchStore = { searching: false, results: upcoming, pendingErrorMsg: null };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled — clear results quietly
        _searchStore = { searching: false, results: null, pendingErrorMsg: null };
      } else {
        // Store the error; if the component is mounted the useEffect will toast it on next mount
        const msg = String(err);
        if (_searchListeners.size > 0) {
          toast({ title: de ? "Suche fehlgeschlagen" : "Search failed", description: msg, variant: "destructive" });
          _searchStore = { searching: false, results: [], pendingErrorMsg: null };
        } else {
          _searchStore = { searching: false, results: [], pendingErrorMsg: msg };
        }
      }
    } finally {
      _notifySearch();
    }
  }

  async function handleSave() {
    if (!savingResult || !token) return;
    setSaving(true);
    try {
      await adminPost("/api/iroc/congress", token, {
        name: savingResult.name,
        specialtyFocus: savingResult.specialtyFocus || undefined,
        startDate: savingResult.startDate,
        endDate: savingResult.endDate || undefined,
        location: savingResult.location || undefined,
        website: savingResult.website,
        logoUrl: logoUrl.trim() || undefined,
      });
      toast({
        title: de ? "Auf Website veröffentlicht" : "Published to website",
        description: savingResult.name,
      });
      setSavingResult(null);
      setLogoUrl("");
      refetchSaved();
    } catch (err) {
      toast({ title: de ? "Fehler" : "Error", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const isAlreadySaved = (name: string) =>
    savedEvents.some((e) => e.title.toLowerCase() === name.toLowerCase());

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Search className="w-6 h-6" />
          {de ? "Kongress- & Konferenz-Finder" : "Congress & Conference Finder"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {de
            ? "Suche nach medizinischen Kongressen und speichere sie auf der iROC-Website."
            : "Search for medical congresses and publish them to the iROC website."}
        </p>
      </div>

      {/* ── Search Panel ── */}
      <Card>
        <CardContent className="pt-5 space-y-5">
          {/* Location chips */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                {de ? "Länder / Regionen" : "Countries / Regions"}
              </Label>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setSelectedLocations(ALL_LOCATIONS.map((l) => l.value))}
                  className="text-primary hover:underline"
                >
                  {de ? "Alle" : "All"}
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  onClick={() => setSelectedLocations(["Germany", "Austria"])}
                  className="text-muted-foreground hover:underline"
                >
                  {de ? "DE/AT" : "DE/AT"}
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  onClick={() => setSelectedLocations([])}
                  className="text-muted-foreground hover:underline"
                >
                  {de ? "Keine" : "None"}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_LOCATIONS.map((loc) => {
                const active = selectedLocations.includes(loc.value);
                return (
                  <button
                    key={loc.value}
                    onClick={() => toggleLocation(loc.value)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-input hover:border-primary hover:text-foreground"
                    }`}
                  >
                    <span>{loc.flag}</span>
                    <span>{de ? loc.label : loc.labelEn}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Theme chips */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{de ? "Themen" : "Themes"}</Label>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setSelectedThemes([...ALL_THEMES])}
                  className="text-primary hover:underline"
                >
                  {de ? "Alle" : "All"}
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  onClick={() => setSelectedThemes([])}
                  className="text-muted-foreground hover:underline"
                >
                  {de ? "Keine" : "None"}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {ALL_THEMES.map((theme) => (
                <button
                  key={theme}
                  onClick={() => toggleTheme(theme)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    selectedThemes.includes(theme)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-input hover:border-primary hover:text-foreground"
                  }`}
                >
                  {theme}
                </button>
              ))}
            </div>
          </div>

          {/* Year + custom query + button */}
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1 w-28">
              <Label>{de ? "Jahr" : "Year"}</Label>
              <Input
                type="number"
                value={year}
                min={2024}
                max={2030}
                onChange={(e) =>
                  setYear(parseInt(e.target.value) || new Date().getFullYear())
                }
              />
            </div>
            <div className="space-y-1 flex-1 min-w-[180px]">
              <Label>
                {de ? "Zusätzliche Suche (optional)" : "Additional search terms (optional)"}
              </Label>
              <Input
                value={customQuery}
                onChange={(e) => setCustomQuery(e.target.value)}
                placeholder={
                  de
                    ? "z.B. FESSH, München, Regenerative Medicine"
                    : "e.g. FESSH, Munich, Regenerative Medicine"
                }
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                onClick={handleSearch}
                disabled={searching || selectedThemes.length === 0}
              >
                {searching ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {de ? "Suche läuft…" : "Searching…"}
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    {de ? "Suchen" : "Search"}
                  </>
                )}
              </Button>
              {searching && (
                <Button variant="outline" onClick={handleStop}>
                  <Square className="w-3.5 h-3.5 mr-1.5 fill-current" />
                  {de ? "Stopp" : "Stop"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Results Table ── */}
      {results !== null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {results.length === 0
                ? de
                  ? "Keine Ergebnisse gefunden"
                  : "No results found"
                : `${results.length} ${de ? "Kongresse gefunden" : "congresses found"} · ${year}`}
            </CardTitle>
          </CardHeader>
          {results.length > 0 && (
            <CardContent className="p-0">
              <div className="sticky-header-table overflow-y-auto max-h-[60vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">
                        {de ? "Kongress" : "Congress Name"}
                      </TableHead>
                      <TableHead>{de ? "Fachgebiet / Fokus" : "Focus Specialty"}</TableHead>
                      <TableHead className="whitespace-nowrap">
                        {de ? "Offizielle Termine" : "Official Dates"}
                      </TableHead>
                      <TableHead>{de ? "Ort" : "Location"}</TableHead>
                      <TableHead>
                        {de ? "Anmeldung & Info" : "Registration & More Info"}
                      </TableHead>
                      <TableHead className="w-[110px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r, i) => {
                      const saved = isAlreadySaved(r.name);
                      return (
                        <TableRow key={i} className={saved ? "opacity-50" : ""}>
                          <TableCell className="font-medium">
                            <span className="line-clamp-2 text-sm">{r.name}</span>
                          </TableCell>
                          <TableCell>
                            {r.specialtyFocus && (
                              <Badge variant="secondary" className="text-xs whitespace-nowrap">
                                {r.specialtyFocus}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                            {dateRange(r.startDate, r.endDate)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.location ? (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <MapPin className="w-3 h-3 shrink-0" />
                                {r.location}
                              </span>
                            ) : (
                              "–"
                            )}
                          </TableCell>
                          <TableCell>
                            {r.website ? (
                              <a
                                href={r.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-primary text-sm hover:underline"
                              >
                                <Globe className="w-3 h-3 shrink-0" />
                                {de ? "Website öffnen" : "Open website"}
                              </a>
                            ) : (
                              "–"
                            )}
                          </TableCell>
                          <TableCell>
                            {saved ? (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Check className="w-3 h-3 text-green-500" />
                                {de ? "Gespeichert" : "Saved"}
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 px-2"
                                onClick={() => {
                                  setSavingResult(r);
                                  setLogoUrl("");
                                }}
                              >
                                <BookmarkPlus className="w-3 h-3 mr-1" />
                                {de ? "Speichern" : "Save"}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Saved Congress Events ── */}
      {savedEvents.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="w-4 h-4" />
              {de ? "Auf Website veröffentlichte Kongresse" : "Congresses Published to Website"}
              <Badge variant="secondary">{savedEvents.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="sticky-header-table overflow-y-auto max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de ? "Kongress" : "Congress"}</TableHead>
                  <TableHead>{de ? "Fachgebiet" : "Specialty"}</TableHead>
                  <TableHead className="whitespace-nowrap">
                    {de ? "Datum" : "Date"}
                  </TableHead>
                  <TableHead>{de ? "Ort" : "Location"}</TableHead>
                  <TableHead>{de ? "Website" : "Website"}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {savedEvents.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell className="font-medium text-sm">{ev.title}</TableCell>
                    <TableCell>
                      {ev.specialtyFocus && (
                        <Badge variant="secondary" className="text-xs">
                          {ev.specialtyFocus}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {dateRange(ev.eventDate, ev.endDate)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {ev.location && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <MapPin className="w-3 h-3" />
                          {ev.location}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <a
                        href={ev.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary text-sm hover:underline"
                      >
                        <Globe className="w-3 h-3" />
                        Website
                      </a>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (
                            confirm(
                              de
                                ? `"${ev.title}" von der Website entfernen?`
                                : `Remove "${ev.title}" from website?`,
                            )
                          ) {
                            deleteMutation.mutate(ev.id);
                          }
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Save Dialog ── */}
      {savingResult && (
        <Dialog open onOpenChange={() => setSavingResult(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <BookmarkPlus className="w-4 h-4" />
                {de ? "Kongress auf Website veröffentlichen" : "Publish Congress to Website"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              {/* Summary */}
              <div className="bg-muted rounded-lg p-3 space-y-1">
                <p className="font-semibold">{savingResult.name}</p>
                <p className="text-muted-foreground">
                  {savingResult.location && `${savingResult.location} · `}
                  {dateRange(savingResult.startDate, savingResult.endDate)}
                </p>
                {savingResult.specialtyFocus && (
                  <Badge variant="secondary" className="text-xs">
                    {savingResult.specialtyFocus}
                  </Badge>
                )}
              </div>
              {/* Logo URL */}
              <div className="space-y-1">
                <Label>
                  {de ? "Event-Logo URL (optional)" : "Event Logo URL (optional)"}
                </Label>
                <Input
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://congress-example.org/logo.png"
                />
                <p className="text-xs text-muted-foreground">
                  {de
                    ? "Das Logo erscheint auf der iROC-Website im Events-Tab. Leer lassen für Platzhalter."
                    : "The logo appears on the iROC website under Events. Leave blank for the default placeholder."}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSavingResult(null)}>
                {de ? "Abbrechen" : "Cancel"}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <BookmarkPlus className="w-4 h-4 mr-2" />
                )}
                {de ? "Auf Website veröffentlichen" : "Publish to Website"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
