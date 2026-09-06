import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { ChevronDown, ChevronRight, Save, RefreshCw, RotateCcw, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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

/** Portal-related pages from the iroc content CMS */
const PORTAL_PAGE_LABELS: Record<string, string> = {
  login:  'Arztportal – Login',
  portal: 'Arztportal – Dashboard & Texte',
};

const PORTAL_PAGES = new Set(Object.keys(PORTAL_PAGE_LABELS));

function needsTextarea(value: string) {
  return value.length > 120 || value.includes('\n');
}

export default function PortalContent() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();

  const [content, setContent] = useState<ContentMap>({});
  const [dirty, setDirty] = useState<DirtyMap>({});
  const [loading, setLoading] = useState(true);
  const [savingPages, setSavingPages] = useState<Set<string>>(new Set());
  const [openPages, setOpenPages] = useState<Set<string>>(new Set(['login']));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/content/iroc');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ContentMap = await res.json();
      // Filter to portal-relevant pages only
      const filtered: ContentMap = {};
      for (const [key, entry] of Object.entries(data)) {
        if (PORTAL_PAGES.has(entry.page)) filtered[key] = { ...entry, key };
      }
      setContent(filtered);
      setDirty({});
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Laden' : 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, [lang, toast]);

  useEffect(() => { load(); }, [load]);

  const pages = Object.entries(content).reduce<Record<string, ContentEntry[]>>(
    (acc, [key, entry]) => {
      const p = entry.page;
      if (!acc[p]) acc[p] = [];
      acc[p].push({ ...entry, key });
      return acc;
    },
    {}
  );

  const handleChange = (key: string, field: 'de' | 'en', value: string) => {
    setDirty(prev => ({
      ...prev,
      [key]: { de: prev[key]?.de ?? content[key]?.de ?? '', en: prev[key]?.en ?? content[key]?.en ?? '', [field]: value },
    }));
  };

  const savePage = async (page: string) => {
    const entries = pages[page] ?? [];
    const updates = entries
      .filter(e => dirty[e.key])
      .map(e => ({ key: e.key, de: dirty[e.key]?.de ?? e.de, en: dirty[e.key]?.en ?? e.en }));

    if (updates.length === 0) {
      toast({ title: lang === 'de' ? 'Keine Änderungen' : 'No changes' });
      return;
    }

    setSavingPages(prev => new Set(prev).add(page));
    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error();
      setContent(prev => {
        const next = { ...prev };
        updates.forEach(u => { if (next[u.key]) next[u.key] = { ...next[u.key], de: u.de, en: u.en }; });
        return next;
      });
      setDirty(prev => {
        const next = { ...prev };
        entries.forEach(e => delete next[e.key]);
        return next;
      });
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Save failed' });
    } finally {
      setSavingPages(prev => { const s = new Set(prev); s.delete(page); return s; });
    }
  };

  const resetEntry = (key: string) => {
    setDirty(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const togglePage = (page: string) => {
    setOpenPages(prev => {
      const s = new Set(prev);
      s.has(page) ? s.delete(page) : s.add(page);
      return s;
    });
  };

  const getVal = (entry: ContentEntry, field: 'de' | 'en') =>
    dirty[entry.key]?.[field] ?? entry[field];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          {lang === 'de' ? 'Arztportal – Texte & Inhalte' : 'Doctor Portal – Text & Content'}
        </h2>
        <p className="text-slate-500 mt-1">
          {lang === 'de'
            ? 'Bearbeiten Sie die Texte des Arztportals (Login-Seite und Dashboard).'
            : 'Edit the texts shown in the doctor portal (login page and dashboard).'}
        </p>
      </div>

      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
        <div>
          {lang === 'de'
            ? 'Diese Texte werden auf der iROC Website und im Arztportal angezeigt. Änderungen sind nach der nächsten Seite sichtbar.'
            : 'These texts appear on the iROC website and in the doctor portal. Changes appear on the next page load.'}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : Object.keys(pages).length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          {lang === 'de' ? 'Keine Portal-Texte gefunden.' : 'No portal content entries found.'}
        </div>
      ) : (
        <div className="space-y-3">
          {Object.keys(pages)
            .filter(p => PORTAL_PAGES.has(p))
            .map(page => {
              const entries = pages[page] ?? [];
              const isOpen = openPages.has(page);
              const isSaving = savingPages.has(page);
              const pageDirtyCount = entries.filter(e => dirty[e.key]).length;

              return (
                <div key={page} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  {/* Page header */}
                  <button
                    type="button"
                    onClick={() => togglePage(page)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors"
                  >
                    <span className="flex-1 font-semibold text-slate-900">
                      {PORTAL_PAGE_LABELS[page] ?? page}
                    </span>
                    {pageDirtyCount > 0 && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                        {pageDirtyCount} {lang === 'de' ? 'geändert' : 'changed'}
                      </span>
                    )}
                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100">
                      <div className="divide-y divide-slate-50">
                        {entries.map(entry => {
                          const isDirty = !!dirty[entry.key];
                          return (
                            <div key={entry.key} className={`px-5 py-4 ${isDirty ? 'bg-amber-50/40' : ''}`}>
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-sm font-medium text-slate-700">{entry.label}</p>
                                {isDirty && (
                                  <button
                                    onClick={() => resetEntry(entry.key)}
                                    className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    {lang === 'de' ? 'Zurücksetzen' : 'Reset'}
                                  </button>
                                )}
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {(['de', 'en'] as const).map(field => {
                                  const value = getVal(entry, field);
                                  const Component = needsTextarea(value) ? 'textarea' : 'input';
                                  return (
                                    <div key={field}>
                                      <p className="text-xs text-slate-400 mb-1 uppercase tracking-wider">{field === 'de' ? 'Deutsch' : 'English'}</p>
                                      <Component
                                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                                        value={value}
                                        rows={Component === 'textarea' ? 3 : undefined}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                                          handleChange(entry.key, field, e.target.value)
                                        }
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
                        <Button
                          size="sm"
                          onClick={() => savePage(page)}
                          disabled={isSaving || pageDirtyCount === 0}
                        >
                          {isSaving
                            ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            : <Save className="w-3.5 h-3.5 mr-1.5" />}
                          {lang === 'de' ? 'Speichern' : 'Save'}
                          {pageDirtyCount > 0 && ` (${pageDirtyCount})`}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
