import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, ChevronRight, Save, RefreshCw, Globe, RotateCcw } from 'lucide-react';
import { useSiteUrls } from '@/hooks/use-site-urls';

interface ContentEntry {
  key: string;
  page: string;
  label: string;
  de: string;
  en: string;
  seedDe: string;
  seedEn: string;
}

type ContentMap = Record<string, ContentEntry>;
type DirtyMap = Record<string, { de: string; en: string }>;

const PAGE_LABELS: Record<string, string> = {
  seo: '🔍 SEO & Google-Texte',
  nav: 'Navigation',
  footer: 'Footer',
  doctorBar: 'Ärztebalken',
  home: 'Startseite',
  ct: 'Karpaltunnelsyndrom',
  tf: 'Schnappfinger (Triggerfinger)',
  how: 'So funktioniert es',
  findDoctor: 'Arzt finden',
  praktisch: 'Praktische Informationen',
  postop: 'Postoperative Entwicklung',
  faq: 'FAQ',
  kontakt: 'Kontakt',
  notFound: '404-Seite',
};

export default function SpirecutContent() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const { spirecutUrl } = useSiteUrls();

  const [content, setContent] = useState<ContentMap>({});
  const [dirty, setDirty] = useState<DirtyMap>({});
  const [loading, setLoading] = useState(true);
  const [savingPages, setSavingPages] = useState<Set<string>>(new Set());
  const [resettingPages, setResettingPages] = useState<Set<string>>(new Set());
  const [resettingKeys, setResettingKeys] = useState<Set<string>>(new Set());
  const [openPages, setOpenPages] = useState<Set<string>>(new Set(['home']));
  const operationVersionRef = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/content/spirecut');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ContentMap = await res.json();
      setContent(data);
      setDirty({});
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Laden' : 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, [lang, toast]);

  useEffect(() => { load(); }, [load]);

  // Group entries by page
  const pages = Object.entries(content).reduce<Record<string, ContentEntry[]>>(
    (acc, [key, entry]) => {
      const p = entry.page;
      if (!acc[p]) acc[p] = [];
      acc[p].push({ ...entry, key });
      return acc;
    },
    {}
  );

  const getValue = (key: string, field: 'de' | 'en') =>
    dirty[key]?.[field] ?? content[key]?.[field] ?? '';

  const markDirty = (key: string, field: 'de' | 'en', value: string) => {
    setDirty((prev) => ({
      ...prev,
      [key]: {
        de: prev[key]?.de ?? content[key]?.de ?? '',
        en: prev[key]?.en ?? content[key]?.en ?? '',
        [field]: value,
      },
    }));
  };

  const isDirty = (key: string) => key in dirty;

  /** True when the saved DB value for this key differs from its seed default */
  const isOverridden = (entry: ContentEntry) =>
    entry.de !== entry.seedDe || entry.en !== entry.seedEn;

  const resetToDefault = async (entry: ContentEntry) => {
    if (resettingKeys.has(entry.key)) return;
    const dirtyAtStart = dirty[entry.key];
    const operationVersion = (operationVersionRef.current[entry.key] ?? 0) + 1;
    operationVersionRef.current[entry.key] = operationVersion;
    setResettingKeys((prev) => new Set(prev).add(entry.key));
    try {
      const res = await fetch(`/api/admin/content/${encodeURIComponent(entry.key)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { de: string; en: string };

      // Update saved content to seed value and clear any pending dirty edit
      setContent((prev) => ({
        ...prev,
        ...(operationVersionRef.current[entry.key] === operationVersion
          ? { [entry.key]: { ...prev[entry.key], de: data.de, en: data.en, seedDe: data.de, seedEn: data.en } }
          : {}),
      }));
      setDirty((prev) => {
        if (operationVersionRef.current[entry.key] !== operationVersion) return prev;
        const next = { ...prev };
        const current = prev[entry.key];
        if (!current || (current.de === dirtyAtStart?.de && current.en === dirtyAtStart?.en)) {
          delete next[entry.key];
        }
        return next;
      });

      toast({ title: lang === 'de' ? 'Auf Standard zurückgesetzt' : 'Reset to default' });
      broadcastInvalidate();
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Zurücksetzen' : 'Reset failed' });
    } finally {
      setResettingKeys((prev) => {
        const next = new Set(prev);
        next.delete(entry.key);
        return next;
      });
    }
  };

  const broadcastInvalidate = () => {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('spirecut-cms-content-invalidate');
      bc.postMessage('invalidate');
      bc.close();
    }
  };

  const resetPageToDefaults = async (page: string, entries: ContentEntry[]) => {
    const overridden = entries.filter((e) => isOverridden(e));
    if (overridden.length === 0) return;
    const confirmed = window.confirm(
      lang === 'de'
        ? `Alle ${overridden.length} überschriebenen Texte auf dieser Seite zurücksetzen?`
        : `Reset all ${overridden.length} overridden texts on this page to defaults?`
    );
    if (!confirmed) return;

    const dirtyAtStart = Object.fromEntries(overridden.map((entry) => [entry.key, dirty[entry.key]]));
    const versions: Record<string, number> = {};
    for (const entry of overridden) {
      versions[entry.key] = (operationVersionRef.current[entry.key] ?? 0) + 1;
      operationVersionRef.current[entry.key] = versions[entry.key];
    }
    setResettingPages((prev) => new Set(prev).add(page));
    try {
      const res = await fetch('/api/admin/content/bulk-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ keys: overridden.map((e) => e.key) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { results: { key: string; de: string; en: string }[] };
      setContent((prev) => {
        const next = { ...prev };
        for (const r of data.results) {
          if (operationVersionRef.current[r.key] !== versions[r.key]) continue;
          next[r.key] = { ...next[r.key], de: r.de, en: r.en, seedDe: r.de, seedEn: r.en };
        }
        return next;
      });
      setDirty((prev) => {
        const next = { ...prev };
        for (const e of overridden) {
          if (operationVersionRef.current[e.key] !== versions[e.key]) continue;
          const current = prev[e.key];
          const initial = dirtyAtStart[e.key];
          if (!current || (current.de === initial?.de && current.en === initial?.en)) {
            delete next[e.key];
          }
        }
        return next;
      });
      toast({ title: lang === 'de' ? 'Seite auf Standard zurückgesetzt' : 'Page reset to defaults' });
      broadcastInvalidate();
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Zurücksetzen' : 'Reset failed' });
    } finally {
      setResettingPages((prev) => { const s = new Set(prev); s.delete(page); return s; });
    }
  };

  /** True when any dirty entry in the page has an empty DE or EN field */
  const hasEmptyField = (entries: ContentEntry[]) =>
    entries.some((e) => isDirty(e.key) && (getValue(e.key, 'de').trim() === '' || getValue(e.key, 'en').trim() === ''));

  const savePage = async (page: string, entries: ContentEntry[]) => {
    const updates = entries
      .filter((e) => isDirty(e.key))
      .map((e) => ({ key: e.key, de: getValue(e.key, 'de'), en: getValue(e.key, 'en') }));

    if (updates.length === 0) return;

    // Warn the admin that blank fields fall back to the hardcoded default.
    if (hasEmptyField(entries)) {
      const confirmed = window.confirm(
        lang === 'de'
          ? 'Ein oder mehrere Felder sind leer. Leere Felder werden durch den Standard-Text der jeweiligen Sprache ersetzt. Trotzdem speichern?'
          : 'One or more fields are blank. Leaving a field blank will restore the default text for that language. Continue saving?'
      );
      if (!confirmed) return;
    }
    const versions = Object.fromEntries(updates.map((update) => {
      const version = (operationVersionRef.current[update.key] ?? 0) + 1;
      operationVersionRef.current[update.key] = version;
      return [update.key, version];
    }));

    setSavingPages((prev) => new Set(prev).add(page));
    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setContent((prev) => {
        const next = { ...prev };
        for (const u of updates) {
          if ((operationVersionRef.current[u.key] ?? 0) === versions[u.key]) {
            next[u.key] = { ...next[u.key], de: u.de, en: u.en };
          }
        }
        return next;
      });
      setDirty((prev) => {
        const next = { ...prev };
        for (const update of updates) {
          if ((operationVersionRef.current[update.key] ?? 0) !== versions[update.key]) continue;
          const current = prev[update.key];
          if (current && (current.de !== update.de || current.en !== update.en)) {
            // Keep a newer local edit that was made while this request was in flight.
            next[update.key] = current;
          } else {
            delete next[update.key];
          }
        }
        return next;
      });

      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
      broadcastInvalidate();
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Save failed' });
    } finally {
      setSavingPages((prev) => { const s = new Set(prev); s.delete(page); return s; });
    }
  };

  const togglePage = (page: string) =>
    setOpenPages((prev) => {
      const next = new Set(prev);
      next.has(page) ? next.delete(page) : next.add(page);
      return next;
    });

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
        <RefreshCw className="h-4 w-4 animate-spin" /> {lang === 'de' ? 'Laden…' : 'Loading…'}
      </div>
    );
  }

  // Sort pages by the PAGE_LABELS order
  const pageOrder = Object.keys(PAGE_LABELS);
  const sortedPages = Object.entries(pages).sort(
    ([a], [b]) => (pageOrder.indexOf(a) - pageOrder.indexOf(b))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Texte – Spirecut Patientenwebsite' : 'Content – Spirecut Patient Website'}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {lang === 'de'
              ? 'Bearbeiten Sie alle Texte der Patientenwebsite. Änderungen sind sofort live.'
              : 'Edit all texts on the patient website. Changes go live immediately.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> {lang === 'de' ? 'Aktualisieren' : 'Refresh'}
          </button>
          <a
            href={spirecutUrl || '/spirecut-patient'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Globe className="h-4 w-4" /> {lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
          </a>
        </div>
      </div>

      <div className="space-y-3">
        {sortedPages.map(([page, entries]) => {
          const isOpen = openPages.has(page);
          const dirtyCount = entries.filter((e) => isDirty(e.key)).length;
          const isSaving = savingPages.has(page);
          const isResetting = resettingPages.has(page);
          const overriddenCount = entries.filter((e) => isOverridden(e)).length;

          return (
            <div key={page} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => togglePage(page)}
                className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/60 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="font-semibold text-sm">
                    {PAGE_LABELS[page] ?? page}
                  </span>
                  <span className="text-xs text-muted-foreground">({entries.length})</span>
                  {dirtyCount > 0 && (
                    <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">
                      {dirtyCount} {lang === 'de' ? 'ungespeichert' : 'unsaved'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {overriddenCount > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); resetPageToDefaults(page, entries); }}
                      disabled={isResetting}
                      title={lang === 'de' ? 'Alle überschriebenen Texte auf dieser Seite zurücksetzen' : 'Reset all overridden texts on this page to defaults'}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-muted-foreground/30 text-muted-foreground text-xs font-semibold rounded-md hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {isResetting
                        ? (lang === 'de' ? 'Zurücksetzen…' : 'Resetting…')
                        : (lang === 'de' ? `Alle zurücksetzen (${overriddenCount})` : `Reset all (${overriddenCount})`)}
                    </button>
                  )}
                  {dirtyCount > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); savePage(page, entries); }}
                      disabled={isSaving}
                      title={hasEmptyField(entries) ? (lang === 'de' ? 'Leere Felder werden durch den Standard-Text ersetzt' : 'Blank fields will restore the default text') : undefined}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      <Save className="h-3 w-3" />
                      {isSaving ? (lang === 'de' ? 'Speichern…' : 'Saving…') : (lang === 'de' ? 'Speichern' : 'Save')}
                    </button>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="divide-y">
                  {entries.map((entry) => {
                    const changed = isDirty(entry.key);
                    return (
                      <div
                        key={entry.key}
                        className={`px-4 py-4 ${changed ? 'border-l-4 border-l-amber-400 bg-amber-50/30' : ''}`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {entry.label}
                          </p>
                          {isOverridden(entry) && (
                            <button
                              onClick={() => resetToDefault(entry)}
                              disabled={resettingKeys.has(entry.key)}
                              title={lang === 'de' ? 'Auf Standard zurücksetzen' : 'Reset to default'}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {resettingKeys.has(entry.key)
                                ? (lang === 'de' ? 'Zurücksetzen…' : 'Resetting…')
                                : (lang === 'de' ? 'Standard' : 'Default')}
                            </button>
                          )}
                        </div>
                        <div className="grid md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-blue-700 mb-1 block">🇩🇪 Deutsch</label>
                            {(() => {
                              const deVal = getValue(entry.key, 'de');
                              const deEmpty = isDirty(entry.key) && deVal.trim() === '';
                               const errorCls = deEmpty ? 'border-amber-400 focus:ring-amber-400' : '';
                              return (
                                <>
                                  {deVal.length > 120 ? (
                                    <textarea
                                      value={deVal}
                                      onChange={(e) => markDirty(entry.key, 'de', e.target.value)}
                                      rows={4}
                                      className={`w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-y ${errorCls}`}
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      value={deVal}
                                      onChange={(e) => markDirty(entry.key, 'de', e.target.value)}
                                      className={`w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary ${errorCls}`}
                                    />
                                  )}
                                  {deEmpty && (
                                    <p className="text-xs text-amber-700 mt-1">
                                      {lang === 'de' ? 'Leeres DE-Feld stellt den Standard-Text wieder her.' : 'Leaving this blank will restore the default DE text.'}
                                    </p>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                          <div>
                            <label className="text-xs font-medium text-emerald-700 mb-1 block">🇬🇧 English</label>
                            {(() => {
                              const enVal = getValue(entry.key, 'en');
                              const enEmpty = isDirty(entry.key) && enVal.trim() === '';
                              const errorCls = enEmpty ? 'border-amber-400 focus:ring-amber-400' : '';
                              return (
                                <>
                                  {enVal.length > 120 ? (
                                    <textarea
                                      value={enVal}
                                      onChange={(e) => markDirty(entry.key, 'en', e.target.value)}
                                      rows={4}
                                      className={`w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-y ${errorCls}`}
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      value={enVal}
                                      onChange={(e) => markDirty(entry.key, 'en', e.target.value)}
                                      className={`w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary ${errorCls}`}
                                    />
                                  )}
                                  {enEmpty && (
                                    <p className="text-xs text-amber-700 mt-1">
                                      {lang === 'de' ? 'Leeres EN-Feld stellt den Standard-Text wieder her.' : 'Leaving this blank will restore the default EN text.'}
                                    </p>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {dirtyCount > 0 && (
                    <div className="px-4 py-3 bg-muted/20 flex items-center justify-end gap-3">
                      {hasEmptyField(entries) && (
                        <p className="text-xs text-amber-700">
                          {lang === 'de'
                            ? 'Leere Felder werden durch den Standard-Text der jeweiligen Sprache ersetzt.'
                            : 'Leaving a field blank will restore the default text for that language.'}
                        </p>
                      )}
                      <button
                        onClick={() => savePage(page, entries)}
                        disabled={isSaving}
                        title={hasEmptyField(entries) ? (lang === 'de' ? 'Leere Felder werden durch den Standard-Text ersetzt' : 'Blank fields will restore the default text') : undefined}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        <Save className="h-4 w-4" />
                        {isSaving
                          ? (lang === 'de' ? 'Speichern…' : 'Saving…')
                          : (lang === 'de' ? `${dirtyCount} Änderung(en) speichern` : `Save ${dirtyCount} change(s)`)}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
