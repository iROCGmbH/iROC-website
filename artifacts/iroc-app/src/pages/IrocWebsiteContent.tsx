import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, ChevronRight, Save, RefreshCw, Globe, RotateCcw, PlusCircle, Trash2, X } from 'lucide-react';
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
type ContentUpdate = { key: string; de: string; en: string };

const PAGE_LABELS: Record<string, string> = {
  home: 'Startseite (Home)',
  spirecut: 'Spirecut® Produktseite',
  ministem: 'MiniStem® Produktseite',
  contact: 'Kontakt',
  training: 'Schulungsübersicht',
  'spirecut-training': 'Spirecut-Schulungsanmeldung',
  'ministem-training': 'MiniStem-Schulungsanmeldung',
  order: 'Bestellung / Anfrage',
  impressum: 'Impressum',
  doctors: 'Zertifizierte Ärzte',
  login: 'Arztportal Login',
  portal: 'Arztportal',
  agb: 'AGB',
  team: 'Team / Our Team section',
};

/** Pages that support admin-added custom sections */
const CUSTOM_SECTION_PAGES = new Set(['impressum', 'agb']);

/** True if this entry was created via "Add section" (not a hardcoded seed entry) */
function isCustomEntry(key: string) {
  return key.includes('.custom_h_') || key.includes('.custom_p_');
}

/**
 * Returns a human-readable label for an entry in the admin UI.
 * Long multi-line values (address blocks, AGB paragraphs) would be unreadable
 * if shown verbatim, so we fall back to a prettified key segment.
 */
function displayLabel(entry: ContentEntry): string {
  if (entry.label.length > 100 || entry.label.includes('\n')) {
    const segment = entry.key.split('.').pop() ?? entry.key;
    return segment.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return entry.label;
}

/** Use a textarea when the current value is long or contains newlines */
function needsTextarea(value: string) {
  return value.length > 120 || value.includes('\n');
}

/** DOM-safe and collision-resistant accordion target for an arbitrary CMS page id. */
function contentRegionId(page: string) {
  let hash = 0;
  for (const character of page) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `content-page-${page.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Math.abs(hash).toString(36)}`;
}

interface AddSectionForm {
  page: string;
  type: 'heading' | 'paragraph';
  de: string;
  en: string;
}

export default function IrocWebsiteContent() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const { irocUrl } = useSiteUrls();

  const [content, setContent] = useState<ContentMap>({});
  const [dirty, setDirty] = useState<DirtyMap>({});
  const [loading, setLoading] = useState(true);
  const [savingPages, setSavingPages] = useState<Set<string>>(new Set());
  const [resettingPages, setResettingPages] = useState<Set<string>>(new Set());
  const [resettingKeys, setResettingKeys] = useState<Set<string>>(new Set());
  const [openPages, setOpenPages] = useState<Set<string>>(new Set(['home']));
  const [addForm, setAddForm] = useState<AddSectionForm | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const operationVersionRef = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/content/iroc');
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

  // Group entries by page, maintaining insertion order
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

  const broadcastInvalidate = () => {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('iroc-cms-content-invalidate');
      bc.postMessage('invalidate');
      bc.close();
    }
  };

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

  const deleteCustomEntry = async (entry: ContentEntry) => {
    if (!window.confirm(lang === 'de'
      ? `Abschnitt "${displayLabel(entry)}" wirklich löschen?`
      : `Really delete section "${displayLabel(entry)}"?`)) return;
    setDeletingKey(entry.key);
    try {
      const res = await fetch(`/api/admin/content/${encodeURIComponent(entry.key)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setContent((prev) => { const next = { ...prev }; delete next[entry.key]; return next; });
      setDirty((prev) => { const next = { ...prev }; delete next[entry.key]; return next; });
      toast({ title: lang === 'de' ? 'Abschnitt gelöscht' : 'Section deleted' });
      broadcastInvalidate();
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Löschen' : 'Delete failed' });
    } finally {
      setDeletingKey(null);
    }
  };

  const resetPageToDefaults = async (page: string, entries: ContentEntry[]) => {
    const overridden = entries.filter((e) => !isCustomEntry(e.key) && isOverridden(e));
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

  /** Build the updates submitted by the existing-entry Save action. */
  const getExistingEntryUpdates = (entries: ContentEntry[]): ContentUpdate[] =>
    entries
      .filter((e) => isDirty(e.key))
      .map((e) => ({ key: e.key, de: getValue(e.key, 'de'), en: getValue(e.key, 'en') }));

  /**
   * Check only existing entries that the page Save action will submit.
   * Add-section drafts live in addForm and have their own submit validation.
   */
  const hasEmptyField = (entries: ContentEntry[]) =>
    getExistingEntryUpdates(entries).some((update) => update.de.trim() === '' || update.en.trim() === '');

  const savePage = async (page: string, entries: ContentEntry[]) => {
    const updates = getExistingEntryUpdates(entries);
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

  const submitAddSection = async () => {
    if (!addForm || !addForm.de.trim() || !addForm.en.trim()) return;
    setAddSaving(true);
    try {
      const res = await fetch('/api/admin/content/new-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          site: 'iroc',
          page: addForm.page,
          type: addForm.type,
          label: addForm.de.trim().slice(0, 80),
          de: addForm.de.trim(),
          en: addForm.en.trim(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { key: string; de: string; en: string };
      // Add the new entry to local state
      setContent((prev) => ({
        ...prev,
        [data.key]: {
          key: data.key,
          page: addForm.page,
          label: data.de.slice(0, 80),
          de: data.de,
          en: data.en,
          seedDe: data.de,
          seedEn: data.en,
        },
      }));
      setAddForm(null);
      toast({ title: lang === 'de' ? 'Abschnitt hinzugefügt' : 'Section added' });
      broadcastInvalidate();
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Hinzufügen' : 'Add failed' });
    } finally {
      setAddSaving(false);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Texte – iROC Website' : 'Content – iROC Website'}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {lang === 'de'
              ? 'Bearbeiten Sie alle Texte der iROC Website. Änderungen sind sofort live.'
              : 'Edit all texts on the iROC website. Changes go live immediately.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <RefreshCw className="h-4 w-4" /> {lang === 'de' ? 'Aktualisieren' : 'Refresh'}
          </button>
          <a
            href={irocUrl || '/iroc-website'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Globe className="h-4 w-4" /> {lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
          </a>
        </div>
      </div>

      <div className="space-y-3">
        {Object.entries(pages).map(([page, entries]) => {
          const isOpen = openPages.has(page);
          const regionId = contentRegionId(page);
          const dirtyCount = entries.filter((e) => isDirty(e.key)).length;
          const isSaving = savingPages.has(page);
          const isResetting = resettingPages.has(page);
          const isAddingHere = addForm?.page === page;
          const overriddenCount = entries.filter((e) => !isCustomEntry(e.key) && isOverridden(e)).length;

          return (
            <div key={page} className="border rounded-lg overflow-hidden">
              <div className="flex flex-col gap-2 px-4 py-3 bg-muted/30 hover:bg-muted/60 transition-colors sm:flex-row sm:items-center sm:justify-between">
                <button
                  onClick={() => togglePage(page)}
                  aria-expanded={isOpen}
                  aria-controls={regionId}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
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
                </button>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {overriddenCount > 0 && (
                    <button
                      onClick={() => resetPageToDefaults(page, entries)}
                      disabled={isResetting}
                      title={lang === 'de' ? 'Alle überschriebenen Texte auf dieser Seite zurücksetzen' : 'Reset all overridden texts on this page to defaults'}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-muted-foreground/30 text-muted-foreground text-xs font-semibold rounded-md hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {isResetting
                        ? (lang === 'de' ? 'Zurücksetzen…' : 'Resetting…')
                        : (lang === 'de' ? `Alle zurücksetzen (${overriddenCount})` : `Reset all (${overriddenCount})`)}
                    </button>
                  )}
                  {dirtyCount > 0 && (
                    <button
                      onClick={() => savePage(page, entries)}
                      disabled={isSaving}
                      title={hasEmptyField(entries) ? (lang === 'de' ? 'Leere Felder werden durch den Standard-Text ersetzt' : 'Blank fields will restore the default text') : undefined}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                      <Save className="h-3 w-3" />
                      {isSaving ? (lang === 'de' ? 'Speichern…' : 'Saving…') : (lang === 'de' ? 'Speichern' : 'Save')}
                    </button>
                  )}
                </div>
              </div>

              {isOpen && (
                <div id={regionId} className="divide-y">
                  {entries.map((entry) => {
                    const changed = isDirty(entry.key);
                    const custom = isCustomEntry(entry.key);
                    const deVal = getValue(entry.key, 'de');
                    const enVal = getValue(entry.key, 'en');
                    const deEmpty = isDirty(entry.key) && deVal.trim() === '';
                    const enEmpty = isDirty(entry.key) && enVal.trim() === '';
                    const isDeleting = deletingKey === entry.key;

                    return (
                      <div
                        key={entry.key}
                        className={`px-4 py-4 ${changed ? 'border-l-4 border-l-amber-400 bg-amber-50/30' : ''}`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            {custom && (
                              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${entry.key.includes('.custom_h_') ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}>
                                {entry.key.includes('.custom_h_') ? (lang === 'de' ? 'Überschrift' : 'Heading') : (lang === 'de' ? 'Absatz' : 'Paragraph')}
                              </span>
                            )}
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              {displayLabel(entry)}
                            </p>
                          </div>
                          {custom ? (
                            <button
                              onClick={() => deleteCustomEntry(entry)}
                              disabled={isDeleting}
                              title={lang === 'de' ? 'Abschnitt löschen' : 'Delete section'}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                            >
                              <Trash2 className="h-3 w-3" />
                              {isDeleting ? '…' : (lang === 'de' ? 'Löschen' : 'Delete')}
                            </button>
                          ) : isOverridden(entry) ? (
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
                          ) : null}
                        </div>
                        <div className="grid md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-blue-700 mb-1 block">🇩🇪 Deutsch</label>
                            {needsTextarea(deVal) ? (
                              <textarea
                                value={deVal}
                                onChange={(e) => markDirty(entry.key, 'de', e.target.value)}
                                rows={4}
                                className={`w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-y ${deEmpty ? 'border-amber-400 focus:ring-amber-400' : ''}`}
                              />
                            ) : (
                              <input
                                type="text"
                                value={deVal}
                                onChange={(e) => markDirty(entry.key, 'de', e.target.value)}
                                className={`w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary ${deEmpty ? 'border-amber-400 focus:ring-amber-400' : ''}`}
                              />
                            )}
                            {deEmpty && (
                              <p className="text-xs text-amber-700 mt-1">
                                {lang === 'de' ? 'Leeres DE-Feld stellt den Standard-Text wieder her.' : 'Leaving this blank will restore the default DE text.'}
                              </p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs font-medium text-emerald-700 mb-1 block">🇬🇧 English</label>
                            {needsTextarea(enVal) ? (
                              <textarea
                                value={enVal}
                                onChange={(e) => markDirty(entry.key, 'en', e.target.value)}
                                rows={4}
                                className={`w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-y ${enEmpty ? 'border-amber-400 focus:ring-amber-400' : ''}`}
                              />
                            ) : (
                              <input
                                type="text"
                                value={enVal}
                                onChange={(e) => markDirty(entry.key, 'en', e.target.value)}
                                className={`w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary ${enEmpty ? 'border-amber-400 focus:ring-amber-400' : ''}`}
                              />
                            )}
                            {enEmpty && (
                              <p className="text-xs text-amber-700 mt-1">
                                {lang === 'de' ? 'Leeres EN-Feld stellt den Standard-Text wieder her.' : 'Leaving this blank will restore the default EN text.'}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* "Add section" inline form for impressum / agb pages */}
                  {CUSTOM_SECTION_PAGES.has(page) && (
                    <div className="px-4 py-3 bg-slate-50/60">
                      {isAddingHere ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              {lang === 'de' ? 'Neuen Abschnitt hinzufügen' : 'Add new section'}
                            </p>
                            <button
                              onClick={() => setAddForm(null)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex gap-3">
                            <div>
                              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                                {lang === 'de' ? 'Typ' : 'Type'}
                              </label>
                              <select
                                value={addForm.type}
                                onChange={(e) => setAddForm((f) => f && { ...f, type: e.target.value as 'heading' | 'paragraph' })}
                                className="text-sm border rounded-md px-2 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                              >
                                <option value="heading">{lang === 'de' ? 'Überschrift (H2)' : 'Heading (H2)'}</option>
                                <option value="paragraph">{lang === 'de' ? 'Absatz' : 'Paragraph'}</option>
                              </select>
                            </div>
                          </div>
                          <div className="grid md:grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-medium text-blue-700 mb-1 block">🇩🇪 Deutsch *</label>
                              <textarea
                                value={addForm.de}
                                onChange={(e) => setAddForm((f) => f && { ...f, de: e.target.value })}
                                rows={3}
                                placeholder={lang === 'de' ? 'Deutschen Text eingeben…' : 'Enter German text…'}
                                className="w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-medium text-emerald-700 mb-1 block">🇬🇧 English</label>
                              <textarea
                                value={addForm.en}
                                onChange={(e) => setAddForm((f) => f && { ...f, en: e.target.value })}
                                rows={3}
                                placeholder={lang === 'de' ? 'Englischen Text eingeben…' : 'Enter English text…'}
                                className="w-full text-sm border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setAddForm(null)}
                              className="px-3 py-2 text-sm rounded-md border hover:bg-muted transition-colors"
                            >
                              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
                            </button>
                            <button
                              onClick={submitAddSection}
                              disabled={addSaving || !addForm.de.trim() || !addForm.en.trim()}
                              className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                            >
                              <PlusCircle className="h-4 w-4" />
                              {addSaving ? (lang === 'de' ? 'Hinzufügen…' : 'Adding…') : (lang === 'de' ? 'Hinzufügen' : 'Add section')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddForm({ page, type: 'paragraph', de: '', en: '' })}
                          className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
                        >
                          <PlusCircle className="h-4 w-4" />
                          {lang === 'de' ? 'Abschnitt hinzufügen' : 'Add section'}
                        </button>
                      )}
                    </div>
                  )}

                  {dirtyCount > 0 && (
                    <div className="px-4 py-3 bg-muted/20 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
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
