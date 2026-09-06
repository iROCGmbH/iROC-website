import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { ToastAction } from '@/components/ui/toast';
import { Activity, AlertTriangle, Loader2, Globe, Trash2, Pencil, X, Settings2, Eye, Download, RefreshCw } from 'lucide-react';
import { usePostopFormConfig } from '@/hooks/use-postop-form-config';
import { PostopFormEditor } from '@/components/PostopFormEditor';
import * as XLSX from 'xlsx';

interface PostopRow {
  id: string;
  procedure: string;
  procedureLabelDe?: string;
  procedureLabelEn?: string;
  operationMonth: string;
  rating: number;
  ageRange?: string;
  gender?: string;
  occupation?: string;
  diseases?: string[];
  operatedParts?: string[];
  experience?: string;
  submittedAt: string;
}

interface UnreadablePostopRecord {
  key: string;
  reason: 'invalid_json';
}

const PROCEDURE_COLORS: string[] = [
  'bg-blue-100 text-blue-700',
  'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
];

function isValidRating(r: unknown): r is number {
  return typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 5;
}

function getStaleListWarningCopy(lang: 'de' | 'en') {
  return lang === 'de'
    ? {
        toastTitle: 'Bewertung gespeichert, Liste nicht aktualisiert',
        toastDescription: 'Die angezeigten Daten können veraltet sein. Bitte laden Sie die Liste erneut.',
        bannerTitle: 'Liste nicht aktualisiert:',
        bannerDescription: 'Die Bewertung wurde gespeichert, aber die angezeigten Daten können veraltet sein. Bitte laden Sie die Liste erneut.',
        reloadLabel: 'Erneut laden',
      }
    : {
        toastTitle: 'Rating saved, list not refreshed',
        toastDescription: 'The displayed data may be out of date. Please reload the list.',
        bannerTitle: 'List not refreshed:',
        bannerDescription: 'The rating was saved, but the displayed data may be out of date. Please reload the list.',
        reloadLabel: 'Reload data',
      };
}

export default function SpirecutPostop() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { spirecutUrl } = useSiteUrls();
  const { toast } = useToast();
  const { config: formConfig } = usePostopFormConfig();
  const langRef = useRef(lang);
  langRef.current = lang;

  const [view, setView] = useState<'data' | 'settings'>('data');
  const [rows, setRows] = useState<PostopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsSkippedInvalid, setStatsSkippedInvalid] = useState<number | null>(null);
  const [statsUnavailable, setStatsUnavailable] = useState(false);
  const [unreadableCount, setUnreadableCount] = useState<number | null>(null);
  const [unreadableRecords, setUnreadableRecords] = useState<UnreadablePostopRecord[]>([]);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [recoveryJson, setRecoveryJson] = useState('');
  const [recoverySaving, setRecoverySaving] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const reloadRequestIdRef = useRef(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const bulkRetryInProgressRef = useRef(new Set<string>());
  const rowDeleteInProgressRef = useRef(new Set<string>());
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [filterProc, setFilterProc] = useState<string>('all');

  // Edit-rating dialog state
  const [editRow, setEditRow] = useState<PostopRow | null>(null);
  const [editRating, setEditRating] = useState<number>(1);
  const [editSaving, setEditSaving] = useState(false);
  const editDialogRef = useRef<HTMLDivElement>(null);
  const editTriggerRef = useRef<HTMLElement | null>(null);

  // View-detail dialog state
  const [viewRow, setViewRow] = useState<PostopRow | null>(null);
  const viewDialogRef = useRef<HTMLDivElement>(null);
  const viewTriggerRef = useRef<HTMLElement | null>(null);

  // Build dynamic label/color maps from config
  const procedureLabelMap = useMemo<Record<string, string>>(
    () => Object.fromEntries(
      formConfig.procedures.map(p => [p.key, lang === 'de' ? p.labelDe : p.labelEn])
    ),
    [formConfig.procedures, lang],
  );
  const procedureColorMap = useMemo<Record<string, string>>(
    () => Object.fromEntries(
      formConfig.procedures.map((p, i) => [p.key, PROCEDURE_COLORS[i % PROCEDURE_COLORS.length]])
    ),
    [formConfig.procedures],
  );
  const getProcedureLabel = useCallback((row: Pick<PostopRow, 'procedure' | 'procedureLabelDe' | 'procedureLabelEn'>): string => {
    const archivedLabel = lang === 'de' ? row.procedureLabelDe : row.procedureLabelEn;
    const fallbackArchivedLabel = lang === 'de' ? row.procedureLabelEn : row.procedureLabelDe;
    return archivedLabel?.trim() || fallbackArchivedLabel?.trim() || procedureLabelMap[row.procedure] || row.procedure;
  }, [lang, procedureLabelMap]);
  const procedureFilterOptions = useMemo(() => [
    ...formConfig.procedures.map((procedure) => ({
      key: procedure.key,
      label: lang === 'de' ? procedure.labelDe : procedure.labelEn,
    })),
    ...Array.from(new Set(rows.map((row) => row.procedure)))
      .filter((key) => !formConfig.procedures.some((procedure) => procedure.key === key))
      .map((key) => {
        const row = rows.find((candidate) => candidate.procedure === key)!;
        return { key, label: getProcedureLabel(row) };
      }),
  ], [formConfig.procedures, getProcedureLabel, lang, rows]);

  // Prefer the aggregate endpoint because it is the same source used for the
  // public rating stats. Keep the row-derived value as a fallback while the
  // stats request is loading or if an older server cannot serve it.
  const localSkippedInvalid = rows.filter((r) => !isValidRating(r.rating)).length;
  const skippedInvalid = statsSkippedInvalid ?? localSkippedInvalid;

  const fetchRows = useCallback(async ({ showRefreshError = false }: { showRefreshError?: boolean } = {}) => {
    if (!token) return false;
    const requestId = ++reloadRequestIdRef.current;
    const isCurrentRequest = () => requestId === reloadRequestIdRef.current;
    if (showRefreshError) setRefreshError(false);
    setLoading(true);
    let refreshed = false;
    try {
      const response = await fetch(`/api/admin/patient-postop-diagnostics`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      // Accept the legacy array shape during a rolling deployment while the
      // diagnostics endpoint is being introduced.
      if (isCurrentRequest()) {
        if (Array.isArray(payload)) {
          setRows(payload);
        } else {
          const diagnostic = payload as { submissions?: unknown; unreadableCount?: unknown; unreadable?: unknown };
          setRows(Array.isArray(diagnostic.submissions) ? diagnostic.submissions : []);
          if (
            typeof diagnostic.unreadableCount === 'number' &&
            Number.isInteger(diagnostic.unreadableCount) &&
            diagnostic.unreadableCount >= 0
          ) {
            setUnreadableCount(diagnostic.unreadableCount);
          }
          setUnreadableRecords(
            Array.isArray(diagnostic.unreadable)
              ? diagnostic.unreadable.filter(
                  (record): record is UnreadablePostopRecord =>
                    Boolean(record) &&
                    typeof record === 'object' &&
                    typeof (record as { key?: unknown }).key === 'string' &&
                    (record as { reason?: unknown }).reason === 'invalid_json',
                )
              : [],
          );
        }
      }
      if (isCurrentRequest()) {
        if (showRefreshError) setRefreshError(false);
        refreshed = true;
      }
    } catch {
      if (showRefreshError && isCurrentRequest()) setRefreshError(true);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }

    fetch(`/api/patient-postop-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((stats: unknown) => {
        if (!isCurrentRequest()) return;
        const count = (stats as { skippedInvalid?: unknown })?.skippedInvalid;
        if (typeof count === 'number' && Number.isInteger(count) && count >= 0) {
          setStatsSkippedInvalid(count);
          setStatsUnavailable(false);
        }
      })
      .catch(() => {
        // The row-derived fallback keeps the warning useful during a partial outage.
        if (isCurrentRequest()) setStatsUnavailable(true);
      });

    return refreshed;
  }, [token]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    if (filterProc !== 'all' && !procedureFilterOptions.some((procedure) => procedure.key === filterProc)) {
      setFilterProc('all');
    }
  }, [filterProc, procedureFilterOptions]);

  const handleDelete = async (id: string) => {
    if (!token) return;
    if (rowDeleteInProgressRef.current.has(id)) {
      toast({
        title: langRef.current === 'de'
          ? 'Löschvorgang läuft bereits'
          : 'Deletion is already in progress',
      });
      return;
    }
    rowDeleteInProgressRef.current.add(id);
    toast({
      title: langRef.current === 'de' ? 'Löschen läuft…' : 'Deleting…',
    });
    try {
      const res = await fetch(`/api/admin/patient-postop/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Server returned non-2xx');
      setRows((r) => r.filter((x) => x.id !== id));
      setStatsSkippedInvalid(null);
      setSelectedIds((s) => { const n = new Set(s); n.delete(id); return n; });
      toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' });
    } catch {
      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'Fehler' : 'Error',
        description: lang === 'de' ? 'Löschen fehlgeschlagen.' : 'Deletion failed.',
        action: (
          <ToastAction altText={lang === 'de' ? 'Erneut versuchen' : 'Retry'} onClick={() => { void handleDelete(id); }}>
            {lang === 'de' ? 'Erneut versuchen' : 'Retry'}
          </ToastAction>
        ),
      });
    } finally {
      rowDeleteInProgressRef.current.delete(id);
    }
  };

  const restoreUnreadableRecord = async () => {
    if (!token || !recoveryKey || recoverySaving) return;
    setRecoverySaving(true);
    setRecoveryError(null);
    try {
      let submission: unknown;
      try {
        submission = JSON.parse(recoveryJson);
      } catch {
        throw new Error(langRef.current === 'de' ? 'Die Sicherung enthält kein gültiges JSON.' : 'The backup does not contain valid JSON.');
      }
      const id = recoveryKey.slice('patient_postop_'.length);
      const response = await fetch(`/api/admin/patient-postop-recovery/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifiedBackup: true, submission }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: unknown };
        throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
      }
      setRecoveryKey(null);
      setRecoveryJson('');
      await fetchRows();
      toast({ title: langRef.current === 'de' ? 'Einsendung wiederhergestellt' : 'Submission restored' });
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setRecoverySaving(false);
    }
  };

  const deletePostopRows = async (ids: string[]) => {
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`/api/admin/patient-postop/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            setRows((r) => r.filter((x) => x.id !== id));
            setStatsSkippedInvalid(null);
            setSelectedIds((s) => { const n = new Set(s); n.delete(id); return n; });
          }
          return { id, ok: res.ok };
        } catch {
          return { id, ok: false };
        }
      })
    );
    return results.filter((r) => !r.ok).map((r) => r.id);
  };

  const retryBulkDelete = async (failedIds: string[], deleteAll: boolean) => {
    const retryKey = [...new Set(failedIds)].sort().join('\u0000');
    if (bulkRetryInProgressRef.current.has(retryKey)) {
      toast({
        title: langRef.current === 'de'
          ? 'Erneuter Löschversuch läuft bereits'
          : 'Retry is already in progress',
      });
      return;
    }

    bulkRetryInProgressRef.current.add(retryKey);
    toast({
      title: langRef.current === 'de'
        ? 'Erneuter Löschversuch läuft…'
        : 'Retrying deletion…',
    });

    try {
      const remainingFailedIds = await deletePostopRows(failedIds);
      if (remainingFailedIds.length > 0) {
        toast({
          variant: 'destructive',
          title: lang === 'de'
            ? `${remainingFailedIds.length} Eintrag/Einträge konnte(n) nicht gelöscht werden`
            : `${remainingFailedIds.length} entr${remainingFailedIds.length === 1 ? 'y' : 'ies'} could not be deleted`,
          action: (
            <ToastAction
              altText={lang === 'de' ? 'Erneut versuchen' : 'Retry'}
              onClick={() => { void retryBulkDelete(remainingFailedIds, deleteAll); }}
            >
              {lang === 'de' ? 'Erneut versuchen' : 'Retry'}
            </ToastAction>
          ),
        });
      } else {
        toast({
          title: deleteAll
            ? (lang === 'de' ? 'Alle Einträge gelöscht' : 'All entries deleted')
            : (lang === 'de' ? 'Ausgewählte Einträge gelöscht' : 'Selected entries deleted'),
        });
      }
    } finally {
      bulkRetryInProgressRef.current.delete(retryKey);
    }
  };

  const handleDeleteSelected = async () => {
    if (!token || selectedIds.size === 0) return;
    const failedIds = await deletePostopRows([...selectedIds]);
    setStatsSkippedInvalid(null);
    if (failedIds.length > 0) {
      toast({
        variant: 'destructive',
        title: lang === 'de'
          ? `${failedIds.length} Eintrag/Einträge konnte(n) nicht gelöscht werden`
          : `${failedIds.length} entr${failedIds.length === 1 ? 'y' : 'ies'} could not be deleted`,
        action: (
          <ToastAction
            altText={lang === 'de' ? 'Erneut versuchen' : 'Retry'}
            onClick={() => { void retryBulkDelete(failedIds, false); }}
          >
            {lang === 'de' ? 'Erneut versuchen' : 'Retry'}
          </ToastAction>
        ),
      });
    } else {
      toast({ title: lang === 'de' ? 'Ausgewählte Einträge gelöscht' : 'Selected entries deleted' });
    }
  };

  const handleDeleteAll = async () => {
    if (!token) return;
    const failedIds = await deletePostopRows(rows.map((row) => row.id));
    setStatsSkippedInvalid(null);
    setConfirmDeleteAll(false);
    if (failedIds.length > 0) {
      toast({
        variant: 'destructive',
        title: lang === 'de'
          ? `${failedIds.length} Eintrag/Einträge konnte(n) nicht gelöscht werden`
          : `${failedIds.length} entr${failedIds.length === 1 ? 'y' : 'ies'} could not be deleted`,
        action: (
          <ToastAction
            altText={lang === 'de' ? 'Erneut versuchen' : 'Retry'}
            onClick={() => { void retryBulkDelete(failedIds, true); }}
          >
            {lang === 'de' ? 'Erneut versuchen' : 'Retry'}
          </ToastAction>
        ),
      });
    } else {
      toast({ title: lang === 'de' ? 'Alle Einträge gelöscht' : 'All entries deleted' });
    }
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const closeEditDialog = useCallback(() => {
    setEditRow(null);
    // Return focus to the element that triggered the dialog
    if (editTriggerRef.current) {
      editTriggerRef.current.focus();
      editTriggerRef.current = null;
    }
  }, []);

  const openEditDialog = (row: PostopRow, trigger?: HTMLElement | null) => {
    editTriggerRef.current = trigger ?? (document.activeElement as HTMLElement | null);
    setEditRow(row);
    const raw = Number(row.rating);
    setEditRating(Number.isFinite(raw) ? Math.max(1, Math.min(5, Math.round(raw))) : 1);
  };

  const closeViewDialog = useCallback(() => {
    setViewRow(null);
    // Return focus to the element that triggered the dialog
    if (viewTriggerRef.current) {
      viewTriggerRef.current.focus();
      viewTriggerRef.current = null;
    }
  }, []);

  const openViewDialog = (row: PostopRow, trigger?: HTMLElement | null) => {
    viewTriggerRef.current = trigger ?? (document.activeElement as HTMLElement | null);
    setViewRow(row);
  };

  // Focus trap + Escape key for view-detail dialog
  useEffect(() => {
    if (!viewRow) return;
    const dialog = viewDialogRef.current;
    if (!dialog) return;

    // Move focus into the dialog on open
    const firstFocusable = dialog.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeViewDialog();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [viewRow, closeViewDialog]);

  // Focus trap + Escape key for edit-rating dialog
  useEffect(() => {
    if (!editRow) return;
    const dialog = editDialogRef.current;
    if (!dialog) return;

    // Move focus into the dialog on open
    const firstFocusable = dialog.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeEditDialog();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editRow, closeEditDialog]);

  const handleSaveRating = async () => {
    if (!token || !editRow) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/patient-postop/${editRow.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: editRating }),
      });
      if (res.status === 401) throw new Error('__SESSION_EXPIRED__');
      if (!res.ok) {
        const err: unknown = await res.json().catch(() => ({}));
        const errorMessage = (
          typeof err === "object" &&
          err !== null &&
          "error" in err &&
          typeof err.error === "string"
        ) ? err.error : "Request failed";
        throw new Error(errorMessage);
      }
      closeEditDialog();
      const refreshed = await fetchRows({ showRefreshError: true });
      if (refreshed) {
        toast({ title: langRef.current === 'de' ? 'Bewertung korrigiert' : 'Rating corrected' });
      } else {
        const warningCopy = getStaleListWarningCopy(langRef.current);
        toast({
          variant: 'destructive',
          title: warningCopy.toastTitle,
          description: warningCopy.toastDescription,
        });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Request failed";
      if (message === '__SESSION_EXPIRED__') {
        toast({ variant: 'destructive', title: langRef.current === 'de' ? 'Sitzung abgelaufen' : 'Session expired', description: langRef.current === 'de' ? 'Bitte Seite neu laden und erneut versuchen.' : 'Please reload the page and try again.' });
      } else {
        toast({ variant: 'destructive', title: langRef.current === 'de' ? 'Fehler beim Speichern' : 'Save failed', description: message });
      }
    } finally {
      setEditSaving(false);
    }
  };

  // ── Excel export ────────────────────────────────────────────────────────────
  const handleExport = () => {
    const source = filterProc === 'all' ? rows : filtered;
    const data: Array<Record<string, string | number>> = source.map((row) => ({
      [lang === 'de' ? 'Eingriff' : 'Procedure']: getProcedureLabel(row),
      [lang === 'de' ? 'Bewertung' : 'Rating']: isValidRating(row.rating) ? row.rating : `Ungültig: ${row.rating}`,
      [lang === 'de' ? 'OP-Monat' : 'Op Month']: row.operationMonth
        ? new Date(row.operationMonth + 'T00:00:00Z').toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
        : '',
      [lang === 'de' ? 'Altersgruppe' : 'Age Range']: row.ageRange ?? '',
      [lang === 'de' ? 'Geschlecht' : 'Gender']: row.gender ?? '',
      [lang === 'de' ? 'Beruf' : 'Occupation']: row.occupation ?? '',
      [lang === 'de' ? 'Erkrankungen' : 'Diseases']: (row.diseases ?? []).join(', '),
      [lang === 'de' ? 'Operierte Bereiche' : 'Operated Parts']: (row.operatedParts ?? []).join(', '),
      [lang === 'de' ? 'Erfahrung' : 'Experience']: row.experience ?? '',
      [lang === 'de' ? 'Eingegangen' : 'Submitted']: new Date(row.submittedAt).toLocaleDateString('de-DE'),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    // Auto-width
    const colWidths = Object.keys(data[0] ?? {}).map((key) => ({
      wch: Math.max(key.length, ...data.map((r) => String(r[key] ?? '').length)) + 2,
    }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, lang === 'de' ? 'Postoperative Daten' : 'Postoperative Data');
    const filename = `postop-data-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast({ title: lang === 'de' ? `${source.length} Einträge exportiert` : `Exported ${source.length} entries` });
  };

  const filtered = filterProc === 'all' ? rows : rows.filter((r) => r.procedure === filterProc);
  const avgRating = rows.length > 0 ? (rows.reduce((sum, r) => sum + r.rating, 0) / rows.length).toFixed(1) : '–';
  const staleListWarning = getStaleListWarningCopy(lang);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg"><Activity className="w-5 h-5 text-primary" /></div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Postoperative Daten' : 'Postoperative Data'}</h1>
          <p className="text-sm text-muted-foreground">{lang === 'de' ? 'Patientenfeedback nach dem Eingriff' : 'Patient feedback after the procedure'}</p>
        </div>
        <a href={`${spirecutUrl}/postoperative-entwicklung`} target="_blank" rel="noopener noreferrer" className="ml-auto flex max-w-full min-w-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
          <Globe className="w-4 h-4" />{lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
        </a>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => setView('data')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'data' ? 'bg-white shadow-sm text-foreground dark:bg-card' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {lang === 'de' ? 'Einsendungen' : 'Submissions'}
        </button>
        <button
          onClick={() => setView('settings')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${view === 'settings' ? 'bg-white shadow-sm text-foreground dark:bg-card' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Settings2 className="w-3.5 h-3.5" />
          {lang === 'de' ? 'Formular' : 'Form Settings'}
        </button>
      </div>

      {/* ── Form Settings tab ─────────────────────────────────────────────────── */}
      {view === 'settings' && <PostopFormEditor />}

      {/* ── Submissions tab ───────────────────────────────────────────────────── */}
      {view === 'data' && (
        <>
          {/* Stats */}
          <div className="grid min-w-0 grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: lang === 'de' ? 'Gesamt' : 'Total', value: rows.length, color: '' },
              { label: lang === 'de' ? 'Ø Bewertung' : 'Avg Rating', value: avgRating, color: 'text-amber-600' },
              ...formConfig.procedures.slice(0, 2).map(p => ({
                label: lang === 'de' ? p.labelDe : p.labelEn,
                value: rows.filter(r => r.procedure === p.key).length,
                color: 'text-blue-600',
              })),
            ].map((s) => (
              <div key={s.label} className="min-w-0 bg-card border rounded-xl p-4 text-center shadow-sm">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Invalid-rating warning */}
          {skippedInvalid > 0 && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 w-4 h-4 flex-shrink-0 text-amber-500" />
              <span>
                <strong>{skippedInvalid}</strong>{' '}
                {lang === 'de'
                  ? skippedInvalid === 1
                    ? 'Eintrag wurde wegen einer ungültigen Bewertung aus der Statistik ausgeschlossen.'
                    : 'Einträge wurden wegen ungültiger Bewertungen aus der Statistik ausgeschlossen.'
                  : skippedInvalid === 1
                    ? 'submission was excluded from statistics due to an invalid rating.'
                    : 'submissions were excluded from statistics due to invalid ratings.'}{' '}
                {lang === 'de'
                  ? 'Nutzen Sie das Bewertungskorrektur-Tool (Stift-Symbol), um die Bewertung zu korrigieren.'
                  : 'Use the rating-correction tool (pencil icon) to fix them.'}
              </span>
            </div>
          )}

          {/* Aggregate-statistics outage */}
          {statsUnavailable && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 w-4 h-4 flex-shrink-0 text-amber-500" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                <span className="min-w-0 flex-1">
                  <strong>{lang === 'de' ? 'Statistik vorübergehend nicht verfügbar.' : 'Statistics temporarily unavailable.'}</strong>{' '}
                  {lang === 'de'
                    ? 'Die Warnanzahl wird ersatzweise aus den sichtbaren Einsendungen berechnet.'
                    : 'The warning count is being calculated from the visible submissions as a fallback.'}
                </span>
                <Button variant="outline" size="sm" onClick={() => { void fetchRows(); }} className="h-8 shrink-0 gap-1.5">
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {loading
                    ? (lang === 'de' ? 'Wird neu geladen…' : 'Reloading…')
                    : (lang === 'de' ? 'Erneut laden' : 'Reload data')}
                </Button>
              </div>
            </div>
          )}

          {/* Unreadable-record warning */}
          {unreadableCount !== null && unreadableCount > 0 && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 w-4 h-4 flex-shrink-0 text-red-500" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                <span className="min-w-0 flex-1">
                  <strong>{unreadableCount}</strong>{' '}
                  {lang === 'de'
                    ? unreadableCount === 1
                      ? 'gespeicherte Einsendung konnte nicht gelesen werden und fehlt in den Statistiken.'
                      : 'gespeicherte Einsendungen konnten nicht gelesen werden und fehlen in den Statistiken.'
                    : unreadableCount === 1
                      ? 'saved submission could not be read and is missing from the statistics.'
                      : 'saved submissions could not be read and are missing from the statistics.'}{' '}
                  {lang === 'de'
                    ? 'Stellen Sie jeden Datensatz nur aus einer geprüften Datensicherung wieder her.'
                    : 'Restore each record only from a verified data backup.'}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { void fetchRows(); }}
                  className="h-8 shrink-0 gap-1.5 border-red-300 bg-white text-red-800 hover:bg-red-100"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {loading
                    ? (lang === 'de' ? 'Wird neu geladen…' : 'Reloading…')
                    : (lang === 'de' ? 'Erneut laden' : 'Reload data')}
                </Button>
                {unreadableRecords.map((record) => (
                  <Button
                    key={record.key}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRecoveryKey(record.key);
                      setRecoveryJson('');
                      setRecoveryError(null);
                    }}
                    className="h-8 max-w-full shrink-0"
                  >
                    {lang === 'de' ? 'Aus Sicherung wiederherstellen' : 'Restore from backup'} ({record.key})
                  </Button>
                ))}
              </div>
            </div>
          )}

          {recoveryKey && (
            <div role="group" aria-label={lang === 'de' ? 'Wiederherstellung aus Datensicherung' : 'Backup recovery'} className="space-y-3 rounded-xl border border-red-300 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-900">
                {lang === 'de' ? 'Geprüfte JSON-Sicherung einfügen' : 'Paste verified JSON backup'}: {recoveryKey}
              </p>
              <textarea
                value={recoveryJson}
                onChange={(event) => setRecoveryJson(event.target.value)}
                aria-label={lang === 'de' ? 'JSON aus geprüfter Datensicherung' : 'JSON from verified backup'}
                className="min-h-40 w-full rounded-md border bg-white p-3 font-mono text-xs text-foreground"
              />
              {recoveryError && <p role="alert" className="text-sm text-red-800">{recoveryError}</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { void restoreUnreadableRecord(); }} disabled={recoverySaving || !recoveryJson.trim()}>
                  {recoverySaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {lang === 'de' ? 'Geprüfte Sicherung wiederherstellen' : 'Restore verified backup'}
                </Button>
                <Button variant="outline" onClick={() => setRecoveryKey(null)} disabled={recoverySaving}>
                  {lang === 'de' ? 'Abbrechen' : 'Cancel'}
                </Button>
              </div>
            </div>
          )}

          {/* Refresh failure warning */}
          {refreshError && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 w-4 h-4 flex-shrink-0 text-red-500" />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                <span className="min-w-0 flex-1">
                  <strong>{staleListWarning.bannerTitle}</strong>{' '}
                  {staleListWarning.bannerDescription}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { void fetchRows({ showRefreshError: true }); }}
                  className="h-8 shrink-0 gap-1.5 border-red-300 bg-white text-red-800 hover:bg-red-100"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {staleListWarning.reloadLabel}
                </Button>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex min-w-0 flex-wrap gap-3 items-center">
            {/* Filter by procedure */}
            <div className="flex max-w-full min-w-0 flex-wrap rounded-md border overflow-hidden">
              <button
                onClick={() => setFilterProc('all')}
                className={`min-w-0 max-w-full flex-1 whitespace-normal break-words px-3 py-1.5 text-left text-xs font-medium leading-tight transition-colors ${filterProc === 'all' ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                {lang === 'de' ? 'Alle' : 'All'}
              </button>
              {procedureFilterOptions.map(p => (
                <button
                  key={p.key}
                  onClick={() => setFilterProc(p.key)}
                  className={`min-w-0 max-w-full flex-1 whitespace-normal break-words px-3 py-1.5 text-left text-xs font-medium leading-tight transition-colors ${filterProc === p.key ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:text-foreground'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2 sm:ml-auto sm:w-auto sm:justify-end">
              {/* Select all / Deselect all */}
              <Button variant="outline" size="sm" onClick={() => setSelectedIds(selectedIds.size === filtered.length && filtered.length > 0 ? new Set() : new Set(filtered.map(r => r.id)))} className="h-7 gap-1.5 text-xs">
                {selectedIds.size === filtered.length && filtered.length > 0
                  ? (lang === 'de' ? 'Auswahl aufheben' : 'Deselect all')
                  : (lang === 'de' ? 'Alle auswählen' : 'Select all')}
              </Button>

              {/* Bulk delete selected */}
              {selectedIds.size > 0 && (
                <Button variant="destructive" size="sm" onClick={handleDeleteSelected} className="gap-1.5">
                  <Trash2 className="w-4 h-4" />
                  {lang === 'de' ? `${selectedIds.size} löschen` : `Delete ${selectedIds.size}`}
                </Button>
              )}

              {/* Excel export */}
              <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0} className="gap-1.5">
                <Download className="w-4 h-4" />
                {lang === 'de' ? 'Excel' : 'Excel'}
              </Button>

              {/* Delete all */}
              {!confirmDeleteAll ? (
                <Button variant="outline" size="sm" onClick={() => setConfirmDeleteAll(true)} className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10">
                  <Trash2 className="w-4 h-4" />
                  {lang === 'de' ? 'Alle löschen' : 'Delete all'}
                </Button>
              ) : (
                <div className="flex w-full min-w-0 max-w-full flex-wrap gap-2 items-center sm:w-auto">
                  <span className="text-xs text-destructive font-medium">{lang === 'de' ? 'Wirklich alle löschen?' : 'Really delete all?'}</span>
                  <Button variant="destructive" size="sm" onClick={handleDeleteAll}>{lang === 'de' ? 'Ja, alle löschen' : 'Yes, delete all'}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteAll(false)}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</Button>
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              {lang === 'de' ? 'Keine Einträge vorhanden.' : 'No entries yet.'}
            </div>
          ) : (
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto overflow-y-auto max-h-[60vh] sticky-header-table-muted">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="bg-muted/40 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{lang === 'de' ? 'Eingriff' : 'Procedure'}</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{lang === 'de' ? 'Bewertung' : 'Rating'}</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{lang === 'de' ? 'OP-Monat' : 'Op Month'}</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">{lang === 'de' ? 'Eingegangen' : 'Submitted'}</th>
                      <th className="w-24 min-w-[96px] px-2 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((row) => {
                      const valid = isValidRating(row.rating);
                      return (
                        <tr
                          key={row.id}
                          className={`hover:bg-muted/30 transition-colors cursor-pointer ${!valid ? 'bg-amber-50/70' : selectedIds.has(row.id) ? 'bg-primary/5' : ''}`}
                          onClick={() => toggleSelect(row.id)}
                        >
                          <td className="px-4 py-3">
                            <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${procedureColorMap[row.procedure] ?? 'bg-gray-100 text-gray-700'}`}>
                              {getProcedureLabel(row)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              data-postop-edit={row.id}
                              onClick={e => { e.stopPropagation(); openEditDialog(row, e.currentTarget); }}
                              title={lang === 'de' ? 'Bewertung korrigieren' : 'Correct rating'}
                              aria-label={valid
                                ? (lang === 'de' ? 'Bewertung korrigieren' : 'Correct rating')
                                : (lang === 'de' ? 'Ungültige Bewertung korrigieren' : 'Correct invalid rating')}
                              className={valid
                                ? 'flex items-center gap-1 text-xs hover:text-primary transition-colors cursor-pointer'
                                : 'flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded hover:bg-amber-100 hover:border-amber-400 transition-colors cursor-pointer'}
                            >
                              {valid ? (
                                <>
                                  <span aria-hidden="true">{'★'.repeat(row.rating)}{'☆'.repeat(5 - row.rating)}</span>
                                  <span className="text-xs text-muted-foreground ml-1">{row.rating}/5</span>
                                </>
                              ) : (
                                <span>{lang === 'de' ? 'Ungültig' : 'Invalid'}: {String(row.rating)}</span>
                              )}
                              <Pencil className="w-3 h-3 flex-shrink-0" />
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {row.operationMonth
                              ? new Date(row.operationMonth + 'T00:00:00Z').toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
                              : '–'}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                            {new Date(row.submittedAt).toLocaleDateString('de-DE')}
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-0.5 justify-end">
                              {/* View all data */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={e => { e.stopPropagation(); openViewDialog(row, e.currentTarget); }}
                                title={lang === 'de' ? 'Alle Daten anzeigen' : 'View all data'}
                                aria-label={lang === 'de' ? 'Alle Daten anzeigen' : 'View all data'}
                                className="h-11 w-11 text-muted-foreground hover:text-foreground"
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              {/* Delete */}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={e => { e.stopPropagation(); if (confirm(lang === 'de' ? 'Löschen?' : 'Delete?')) handleDelete(row.id); }}
                                className="h-11 w-11 text-destructive hover:text-destructive hover:bg-destructive/10"
                                title={lang === 'de' ? 'Löschen' : 'Delete'}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── View-detail modal ──────────────────────────────────────────────────── */}
      {viewRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeViewDialog(); }}
        >
          <div
            ref={viewDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="view-detail-dialog-title"
            className="bg-card border rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div className="flex items-center gap-3">
                <h2 id="view-detail-dialog-title" className="font-semibold text-base">
                  {lang === 'de' ? 'Eintragsdetails' : 'Entry details'}
                </h2>
                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${procedureColorMap[viewRow.procedure] ?? 'bg-gray-100 text-gray-700'}`}>
                  {getProcedureLabel(viewRow)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {new Date(viewRow.submittedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </span>
              </div>
              <button onClick={closeViewDialog} className="text-muted-foreground hover:text-foreground p-2 rounded-lg" aria-label={lang === 'de' ? 'Schließen' : 'Close'}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {/* Rating */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{lang === 'de' ? 'Bewertung' : 'Rating'}</p>
                {isValidRating(viewRow.rating) ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xl text-amber-500 tracking-widest">{'★'.repeat(viewRow.rating)}{'☆'.repeat(5 - viewRow.rating)}</span>
                    <span className="text-sm font-semibold">{viewRow.rating} / 5</span>
                  </div>
                ) : (
                  <span className="text-sm text-amber-600 font-medium">{lang === 'de' ? 'Ungültig' : 'Invalid'}: {String(viewRow.rating)}</span>
                )}
              </div>

              {/* Grid of fields */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {[
                  { label: lang === 'de' ? 'OP-Monat' : 'Op Month', value: viewRow.operationMonth ? new Date(viewRow.operationMonth + 'T00:00:00Z').toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '–' },
                  { label: lang === 'de' ? 'Altersgruppe' : 'Age Range', value: viewRow.ageRange ?? '–' },
                  { label: lang === 'de' ? 'Geschlecht' : 'Gender', value: viewRow.gender ?? '–' },
                  { label: lang === 'de' ? 'Beruf' : 'Occupation', value: viewRow.occupation ?? '–' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                    <p className="text-sm font-medium">{value}</p>
                  </div>
                ))}
              </div>

              {/* Diseases */}
              {(viewRow.diseases ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{lang === 'de' ? 'Vorerkrankungen' : 'Pre-existing Conditions'}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {viewRow.diseases!.map((d) => (
                      <span key={d} className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100">{d}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Operated parts */}
              {(viewRow.operatedParts ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{lang === 'de' ? 'Operierte Bereiche' : 'Operated Parts'}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {viewRow.operatedParts!.map((p) => (
                      <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{p}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Experience */}
              {viewRow.experience && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{lang === 'de' ? 'Erfahrungsbericht' : 'Experience'}</p>
                  <p className="text-sm leading-relaxed bg-muted/40 rounded-lg px-4 py-3 whitespace-pre-wrap">{viewRow.experience}</p>
                </div>
              )}

              {/* No extra data */}
              {!viewRow.ageRange && !viewRow.gender && !viewRow.occupation &&
               !(viewRow.diseases ?? []).length && !(viewRow.operatedParts ?? []).length && !viewRow.experience && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {lang === 'de' ? 'Keine weiteren Daten erfasst.' : 'No additional data collected.'}
                </p>
              )}
            </div>

            {/* Footer actions */}
            <div className="px-6 py-4 border-t flex flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:items-center">
              <Button variant="outline" size="sm" onClick={closeViewDialog}>
                {lang === 'de' ? 'Schließen' : 'Close'}
              </Button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button size="sm" variant="outline" onClick={() => { const tableBtn = document.querySelector<HTMLElement>(`[data-postop-edit="${viewRow.id}"]`); setViewRow(null); viewTriggerRef.current = null; openEditDialog(viewRow, tableBtn); }} className="w-full gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50 sm:w-auto">
                  <Pencil className="w-3.5 h-3.5" />
                  {lang === 'de' ? 'Bewertung korrigieren' : 'Correct rating'}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => { const rowId = viewRow.id; closeViewDialog(); if (confirm(lang === 'de' ? 'Löschen?' : 'Delete?')) handleDelete(rowId); }} className="w-full gap-1.5 sm:w-auto">
                  <Trash2 className="w-3.5 h-3.5" />
                  {lang === 'de' ? 'Löschen' : 'Delete'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit-rating modal ─────────────────────────────────────────────────── */}
      {editRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeEditDialog(); }}
        >
          <div
            ref={editDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-rating-dialog-title"
            className="bg-card border rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="edit-rating-dialog-title" className="font-semibold text-base">{lang === 'de' ? 'Bewertung korrigieren' : 'Correct Rating'}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{lang === 'de' ? `Eingereicht: ${new Date(editRow.submittedAt).toLocaleDateString('de-DE')}` : `Submitted: ${new Date(editRow.submittedAt).toLocaleDateString('de-DE')}`}</p>
              </div>
              <button onClick={closeEditDialog} className="text-muted-foreground hover:text-foreground transition-colors -mt-1 -mr-1 p-2 rounded-lg" aria-label={lang === 'de' ? 'Schließen' : 'Close'}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-700">
              {lang === 'de' ? 'Rohwert' : 'Raw value'}: <code className="font-mono font-bold">{String(editRow.rating)}</code>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium" id="edit-rating-stars-label">{lang === 'de' ? 'Korrigierte Bewertung' : 'Corrected rating'}</p>
              <div className="flex gap-1" role="group" aria-labelledby="edit-rating-stars-label">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setEditRating(n)}
                    aria-label={lang === 'de' ? `${n} ${n === 1 ? 'Stern' : 'Sterne'}` : `${n} ${n === 1 ? 'star' : 'stars'}`}
                    aria-pressed={editRating === n}
                    className={`flex-1 min-h-[44px] py-2 rounded-lg border text-sm font-semibold transition-colors ${editRating === n ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="text-center text-lg tracking-widest text-amber-500 select-none" aria-hidden="true">{'★'.repeat(editRating)}{'☆'.repeat(5 - editRating)}</div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1" onClick={closeEditDialog} disabled={editSaving}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</Button>
              <Button size="sm" className="flex-1" onClick={handleSaveRating} disabled={editSaving}>
                {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : (lang === 'de' ? 'Speichern' : 'Save')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
