import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileArchive, Send, CheckCircle2, AlertCircle, Loader2,
  CalendarDays, Mail, BookOpen, Save, Download, History, ShieldCheck, Receipt,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { adminPost } from "@/lib/admin-fetch";

// ── Types ─────────────────────────────────────────────────────────────────────
type Preset = "this_month" | "last_month" | "custom";

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  issueDate: string;
  total: string;
  vatRate: string;
  status: "sent" | "paid";
  invoiceType: string | null;
  customerName: string;
}

interface ExportRecord {
  id: number;
  exportedAt: string;
  bookkeeperEmail: string;
  invoiceCount: number;
  status: "pending" | "sent" | "failed";
  invoiceNumbers?: string[];
}

interface ExportHistoryPage {
  exports: ExportRecord[];
  hasMore: boolean;
}

interface ExportResponse {
  error?: string;
  details?: string[];
  invoiceNumbers?: string[];
  exported?: number;
  skipped?: string[];
  exportRecord?: ExportRecord;
}

type ExportStatus = "idle" | "processing" | "success" | "error";

interface Expense {
  id: number;
  vendor_name: string | null;
  invoice_date: string | null;
  invoice_number: string | null;
  category: string | null;
  net_amount: string | null;
  tax_amount: string | null;
  gross_amount: string | null;
  currency: string;
  net_amount_eur: string | null;
  tax_amount_eur: string | null;
  gross_amount_eur: string | null;
  exchange_rate: string | null;
  exchange_rate_date: string | null;
  conversion_status: "not_needed" | "converted" | "manual" | "unavailable";
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getPresetRange(preset: Preset): { from: string; to: string } {
  const now = new Date();
  if (preset === "this_month") {
    return {
      from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      to:   isoDate(now),
    };
  }
  if (preset === "last_month") {
    return {
      from: isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to:   isoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  return { from: "", to: "" };
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function DatevExport() {
  const { token } = useAuth();
  const { lang }  = useLanguage();
  const { toast } = useToast();

  const de = lang === "de";

  // Date range state
  const [preset, setPreset]       = useState<Preset>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");

  const { from, to } = preset === "custom"
    ? { from: customFrom, to: customTo }
    : getPresetRange(preset);

  // Invoice list
  const [invoices, setInvoices]     = useState<InvoiceRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError]   = useState<string | null>(null);

  // Selection
  const [selected, setSelected]     = useState<Set<number>>(new Set());

  // Previously exported invoice IDs
  const [exportedIds, setExportedIds] = useState<Set<number>>(new Set());
  const [newOnly, setNewOnly] = useState(false);

  // Export history
  const [exportHistory, setExportHistory] = useState<ExportRecord[]>([]);
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyEmail, setHistoryEmail] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<number>>(new Set());
  const exportedIdsRequest = useRef(0);
  const historyRequest = useRef(0);

  // Bookkeeper email
  const [email, setEmail]           = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);

  // Export (email)
  const [status, setStatus]         = useState<ExportStatus>("idle");
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<{ exported: number; skipped: string[] } | null>(null);

  // Exemption reasons for 0 % VAT invoices (invoiceId → reason string)
  const [exemptionReasons, setExemptionReasons] = useState<Record<number, string>>({});

  // Re-export confirmation state (when server returns 409)
  const [reexportPending, setReexportPending] = useState<{
    invoiceNumbers: string[];
    ids: number[];
    exemptionReasons: Record<number, string>;
    action: "email" | "download";
    email?: string;
  } | null>(null);

  // Download ZIP
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "processing" | "error">("idle");
  const [downloadError, setDownloadError]   = useState<string | null>(null);
  const [downloadSkipped, setDownloadSkipped] = useState<string[]>([]);

  // Expenses
  const [expenses, setExpenses]             = useState<Expense[]>([]);
  const [expLoading, setExpLoading]         = useState(false);
  const [expError, setExpError]             = useState<string | null>(null);
  const [expSelected, setExpSelected]       = useState<Set<number>>(new Set());

  // ── Load default bookkeeper email ─────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch("/api/iroc/datev/settings", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : {})
      .then((d: { bookkeeperEmail?: string }) => {
        if (d.bookkeeperEmail) setEmail(d.bookkeeperEmail);
      })
      .catch(() => {});
  }, [token]);

  // ── Load previously exported IDs and export history ───────────────────────
  async function loadExportedIds() {
    if (!token) return;
    const request = ++exportedIdsRequest.current;
    try {
      const response = await fetch("/api/iroc/datev/exported-ids", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json() as { ids?: number[] };
      if (request === exportedIdsRequest.current) {
        setExportedIds(new Set(data.ids ?? []));
      }
    } catch {
      // The invoice list remains usable when the informational export badge
      // cannot be refreshed.
    }
  }

  async function loadExportHistory({
    append = false,
    offset = append ? exportHistory.length : 0,
    filters = { from: historyFrom, to: historyTo, email: historyEmail },
  }: {
    append?: boolean;
    offset?: number;
    filters?: { from: string; to: string; email: string };
  } = {}) {
    if (!token) return;
    if (filters.from && filters.to && filters.from > filters.to) {
      setHistoryError(de ? "Das Startdatum muss vor dem Enddatum liegen." : "The start date must be before the end date.");
      return;
    }

    const request = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError(null);
    const params = new URLSearchParams({
      limit: "20",
      offset: String(offset),
    });
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.email.trim()) params.set("email", filters.email.trim());

    try {
      const response = await fetch(`/api/iroc/datev/exports?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as ExportHistoryPage | ExportRecord[];
      // Accept the previous array response during a rolling server deployment.
      // The API returns the paginated envelope once all services are updated.
      const page = Array.isArray(payload)
        ? { exports: payload, hasMore: false }
        : payload;
      if (request !== historyRequest.current) return;

      setExportHistory((current) => append ? [...current, ...page.exports] : page.exports);
      setHistoryHasMore(page.hasMore);
      if (!append) setExpandedHistoryIds(new Set());
    } catch (err) {
      if (request === historyRequest.current) {
        setHistoryError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  }

  async function loadExportMeta() {
    await Promise.all([loadExportedIds(), loadExportHistory()]);
  }

  useEffect(() => {
    void loadExportMeta();
  // The loader intentionally captures the current filter state for the initial
  // metadata refresh; adding it here would rerun the refresh after its own
  // state updates and duplicate the requests.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Load expense list ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !from || !to) { setExpenses([]); setExpSelected(new Set()); return; }
    setExpLoading(true);
    setExpError(null);
    fetch(`/api/admin/expenses?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((rows: Expense[]) => {
        setExpenses(rows);
        setExpSelected(new Set(rows.map(r => r.id)));
      })
      .catch((e: Error) => setExpError(e.message))
      .finally(() => setExpLoading(false));
  }, [token, from, to]);

  // ── Load invoice list ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !from || !to) {
      setInvoices([]);
      setSelected(new Set());
      return;
    }
    setLoadingList(true);
    setListError(null);
    fetch(`/api/iroc/datev/invoices?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rows: InvoiceRow[]) => {
        setInvoices(rows);
        setSelected(new Set(rows.map((r) => r.id)));
      })
      .catch((e: Error) => setListError(e.message))
      .finally(() => setLoadingList(false));
  }, [token, from, to]);

  // ── Selection helpers ─────────────────────────────────────────────────────
  const visibleInvoices = useMemo(
    () => newOnly ? invoices.filter((invoice) => !exportedIds.has(invoice.id)) : invoices,
    [exportedIds, invoices, newOnly],
  );

  useEffect(() => {
    setNewOnly(false);
  }, [from, to]);

  useEffect(() => {
    if (!newOnly) return;
    setSelected((current) => {
      const next = new Set([...current].filter((id) => !exportedIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [exportedIds, newOnly]);

  const someSelected = visibleInvoices.some((r) => selected.has(r.id));

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleNewOnly() {
    if (!newOnly) {
      setSelected((current) => new Set(
        [...current].filter((id) => !exportedIds.has(id)),
      ));
    }
    setNewOnly((current) => !current);
  }

  // 0 % VAT invoices that are currently selected — need an exemption reason
  const zeroVatSelected = useMemo(
    () => visibleInvoices.filter((inv) => selected.has(inv.id) && parseFloat(inv.vatRate) === 0),
    [selected, visibleInvoices],
  );

  // ── Auto-fill exemption reasons for lecture invoice types ─────────────────
  const LECTURE_EU_REASON =
    "Sonstige Leistung an EU-Unternehmer \u2013 Steuerschuldnerschaft des Leistungsempf\u00e4ngers gem. \u00a73a Abs. 2 UStG i.V.m. \u00a713b UStG (Reverse Charge)";
  const LECTURE_NONEU_REASON =
    "Sonstige Leistung an Drittlandsunternehmer \u2013 nicht steuerbar in Deutschland gem. \u00a73a Abs. 2 UStG";

  useEffect(() => {
    if (zeroVatSelected.length === 0) return;
    setExemptionReasons((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const inv of zeroVatSelected) {
        if (next[inv.id]) continue; // admin already set or auto-filled — keep it
        if (inv.invoiceType === "lecture-eu") {
          next[inv.id] = LECTURE_EU_REASON;
          changed = true;
        } else if (inv.invoiceType === "lecture-noneu") {
          next[inv.id] = LECTURE_NONEU_REASON;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [zeroVatSelected]);

  // ── Summary ───────────────────────────────────────────────────────────────
  const { count, totalGross } = useMemo(() => {
    let gross = 0;
    let count = 0;
    for (const inv of visibleInvoices) {
      if (selected.has(inv.id)) {
        gross += parseFloat(inv.total);
        count++;
      }
    }
    return { count, totalGross: gross };
  }, [selected, visibleInvoices]);

  // ── Save email as default ─────────────────────────────────────────────────
  async function handleSaveEmail() {
    if (!token || !email.trim()) return;
    setSavingEmail(true);
    try {
      await adminPost("/api/iroc/datev/settings", token, { bookkeeperEmail: email.trim() });
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 3000);
      toast({ title: de ? "E-Mail gespeichert" : "Email saved" });
    } catch {
      toast({ variant: "destructive", title: de ? "Fehler beim Speichern" : "Error saving" });
    } finally {
      setSavingEmail(false);
    }
  }

  // ── Download ZIP ──────────────────────────────────────────────────────────
  async function submitDownload(
    ids: number[],
    force: boolean,
    reasons: Record<number, string>,
  ) {
    if (!token) return;
    setDownloadStatus("processing");
    setDownloadError(null);
    setDownloadSkipped([]);

    try {
      const res = await fetch("/api/iroc/datev/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          invoiceIds: ids,
          force,
          exemptionReasons: reasons,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as ExportResponse;
        if (res.status === 409 && data.error === "already_exported") {
          setDownloadStatus("idle");
          setReexportPending({
            invoiceNumbers: data.invoiceNumbers ?? [],
            ids,
            exemptionReasons: reasons,
            action: "download",
          });
          return;
        }

        const msg = Array.isArray(data.details)
          ? data.details.join("\n")
          : (data.error ?? `HTTP ${res.status}`);
        throw new Error(msg);
      }

      // Derive filename from Content-Disposition or fall back to a default
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? `DATEV_Export_${new Date().toISOString().slice(0, 10)}.zip`;
      const skipped = (res.headers.get("X-DATEV-Skipped") ?? "")
        .split(",")
        .map((invoiceNumber) => invoiceNumber.trim())
        .filter(Boolean);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setDownloadStatus("idle");
      setDownloadSkipped(skipped);
      toast({
        title: de ? "ZIP heruntergeladen" : "ZIP downloaded",
        ...(skipped.length > 0
          ? {
              description: de
                ? `Übersprungen (keine Positionen): ${skipped.join(", ")}`
                : `Skipped (no line items): ${skipped.join(", ")}`,
            }
          : {}),
      });
    } catch (err: unknown) {
      setDownloadStatus("error");
      setDownloadError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDownload() {
    if (!token) return;
    if (count === 0) {
      toast({ variant: "destructive", title: de ? "Keine Rechnungen ausgewählt" : "No invoices selected" });
      return;
    }
    await submitDownload(Array.from(selected), false, exemptionReasons);
  }

  // ── Export (shared logic) ─────────────────────────────────────────────────
  async function submitExport(
    ids: number[],
    emailAddr: string,
    force: boolean,
    reasons: Record<number, string>,
  ) {
    setStatus("processing");
    setErrorMsg(null);
    setExportResult(null);

    try {
      const res = await fetch("/api/iroc/datev/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          invoiceIds:       ids,
          bookkeeperEmail:  emailAddr,
          saveEmail:        false,
          force,
          exemptionReasons: reasons,
        }),
      });

      const data = await res.json() as ExportResponse;

      if (res.status === 409 && data.error === "already_exported") {
        // Server detected previously exported invoices — prompt for confirmation
        setStatus("idle");
        setReexportPending({
          invoiceNumbers: data.invoiceNumbers ?? [],
          email: emailAddr,
          ids,
          exemptionReasons: reasons,
          action: "email",
        });
        return;
      }

      if (!res.ok) {
        const msg = Array.isArray(data.details)
          ? data.details.join("\n")
          : (data.error ?? `HTTP ${res.status}`);
        throw new Error(msg);
      }

      setStatus("success");
      setExportResult({ exported: data.exported ?? 0, skipped: data.skipped ?? [] });
      // Refresh the current history view rather than prepending blindly: an
      // active date/email filter may intentionally exclude this new export.
      void loadExportMeta();
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  async function handleExport() {
    if (!token) return;
    if (count === 0) {
      toast({ variant: "destructive", title: de ? "Keine Rechnungen ausgewählt" : "No invoices selected" });
      return;
    }
    if (!email.trim()) {
      toast({ variant: "destructive", title: de ? "Buchhaltungs-E-Mail fehlt" : "Bookkeeper email required" });
      return;
    }
    await submitExport(Array.from(selected), email.trim(), false, exemptionReasons);
  }

  // ── Confirm re-export ─────────────────────────────────────────────────────
  async function handleConfirmReexport() {
    if (!token || !reexportPending) return;
    const { ids, email: emailAddr, exemptionReasons: pendingReasons, action } = reexportPending;
    setReexportPending(null);
    if (action === "download") {
      await submitDownload(ids, true, pendingReasons);
      return;
    }
    await submitExport(ids, emailAddr ?? "", true, pendingReasons);
  }

  function applyHistoryFilters() {
    void loadExportHistory({
      filters: { from: historyFrom, to: historyTo, email: historyEmail },
    });
  }

  function clearHistoryFilters() {
    const filters = { from: "", to: "", email: "" };
    setHistoryFrom(filters.from);
    setHistoryTo(filters.to);
    setHistoryEmail(filters.email);
    void loadExportHistory({ filters });
  }

  function toggleHistoryInvoices(exportId: number) {
    setExpandedHistoryIds((current) => {
      const next = new Set(current);
      if (next.has(exportId)) next.delete(exportId); else next.add(exportId);
      return next;
    });
  }

  // ── Expense selection helpers ─────────────────────────────────────────────
  const expAllSelected  = expenses.length > 0 && expenses.every(e => expSelected.has(e.id));
  const expSomeSelected = expenses.some(e => expSelected.has(e.id));
  function toggleExpAll() {
    setExpSelected(expAllSelected ? new Set() : new Set(expenses.map(e => e.id)));
  }
  function toggleExp(id: number) {
    setExpSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const expSelectedItems = expenses.filter(e => expSelected.has(e.id));
  const expTotalGross = expSelectedItems.reduce((s, e) => s + (
    parseFloat(e.gross_amount_eur ?? (e.currency === "EUR" ? e.gross_amount ?? "0" : "0")) || 0
  ), 0);

  // ── Expense CSV download (server-side DATEV v700 builder) ────────────────
  const [expDownloading, setExpDownloading] = useState(false);

  async function handleExpenseDownload() {
    if (!token) return;
    if (expSelectedItems.length === 0) {
      toast({ variant: "destructive", title: de ? "Keine Ausgaben ausgewählt" : "No expenses selected" });
      return;
    }
    setExpDownloading(true);
    try {
      const res = await fetch("/api/admin/expenses/datev-export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ expenseIds: expSelectedItems.map(e => e.id) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `DATEV_Ausgaben_${from ?? ""}${to ? `_${to}` : ""}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: de ? "CSV heruntergeladen" : "CSV downloaded" });
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: de ? "Export fehlgeschlagen" : "Export failed",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setExpDownloading(false);
    }
  }

  // ── Preset buttons ────────────────────────────────────────────────────────
  const presets: { id: Preset; labelDe: string; labelEn: string }[] = [
    { id: "this_month",  labelDe: "Aktueller Monat", labelEn: "This Month" },
    { id: "last_month",  labelDe: "Letzter Monat",   labelEn: "Last Month" },
    { id: "custom",      labelDe: "Benutzerdefiniert", labelEn: "Custom Range" },
  ];

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <FileArchive className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">
            {de ? "DATEV-Export" : "DATEV Export"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Rechnungen als DATEV-konformes ZIP-Archiv per E-Mail versenden"
              : "Export invoices as a DATEV-compliant ZIP archive via email"}
          </p>
        </div>
      </div>

      {/* ── Date range picker ──────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b">
          <CalendarDays className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">{de ? "Zeitraum" : "Date Range"}</h2>
        </div>

        <div className="flex flex-wrap gap-2">
          {presets.map(({ id, labelDe, labelEn }) => (
            <button
              key={id}
              onClick={() => { setPreset(id); setStatus("idle"); setExportResult(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                preset === id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              {de ? labelDe : labelEn}
            </button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                {de ? "Von" : "From"}
              </label>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => { setCustomFrom(e.target.value); setStatus("idle"); }}
                className="w-40 h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                {de ? "Bis" : "To"}
              </label>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => { setCustomTo(e.target.value); setStatus("idle"); }}
                className="w-40 h-8 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Invoice list ──────────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">
              {de ? "Rechnungen" : "Invoices"}
              {!loadingList && invoices.length > 0 && (
                <span className="ml-2 text-muted-foreground font-normal">
                  ({visibleInvoices.length})
                </span>
              )}
            </h2>
          </div>
          {invoices.length > 0 && (
            <Button
              type="button"
              variant={newOnly ? "default" : "outline"}
              size="sm"
              aria-pressed={newOnly}
              onClick={toggleNewOnly}
            >
              {de ? "Nur neue" : "New only"}
            </Button>
          )}
        </div>

        {loadingList ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : listError ? (
          <div className="p-6 flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {listError}
          </div>
        ) : !from || !to ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {de
              ? "Bitte Zeitraum auswählen, um Rechnungen zu laden."
              : "Select a date range to load invoices."}
          </div>
        ) : invoices.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {de
              ? "Keine versendeten oder bezahlten Rechnungen im gewählten Zeitraum."
              : "No sent or paid invoices in the selected period."}
          </div>
        ) : visibleInvoices.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {de
              ? "Keine neuen Rechnungen im gewählten Zeitraum."
              : "No new invoices in the selected period."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-3 text-left font-medium text-muted-foreground">
                    {de ? "Rechnungsnr." : "Invoice #"}
                  </th>
                  <th className="p-3 text-left font-medium text-muted-foreground">
                    {de ? "Datum" : "Date"}
                  </th>
                  <th className="p-3 text-left font-medium text-muted-foreground">
                    {de ? "Kunde" : "Customer"}
                  </th>
                  <th className="p-3 text-left font-medium text-muted-foreground">
                    {de ? "MwSt." : "VAT"}
                  </th>
                  <th className="p-3 text-right font-medium text-muted-foreground">
                    {de ? "Brutto" : "Gross"}
                  </th>
                  <th className="p-3 text-center font-medium text-muted-foreground">
                    {de ? "Status" : "Status"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleInvoices.map((inv) => {
                  const wasExported = exportedIds.has(inv.id);
                  return (
                    <tr
                      key={inv.id}
                      className={`border-b transition-colors cursor-pointer hover:bg-muted/20 ${
                        selected.has(inv.id) ? "bg-primary/5" : ""
                      }`}
                      onClick={() => toggle(inv.id)}
                    >
                      <td className="p-3 font-mono font-medium">
                        <div className="flex items-center gap-2">
                          {inv.invoiceNumber}
                          {wasExported && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">
                              {de ? "Bereits exportiert" : "Already exported"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">{inv.issueDate}</td>
                      <td className="p-3 max-w-[200px] truncate">{inv.customerName}</td>
                      <td className="p-3 text-muted-foreground">
                        {parseFloat(inv.vatRate).toFixed(0)} %
                      </td>
                      <td className="p-3 text-right font-medium tabular-nums">
                        {formatMoney(parseFloat(inv.total))}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          inv.status === "paid"
                            ? "bg-green-100 text-green-700"
                            : "bg-blue-100 text-blue-700"
                        }`}>
                          {inv.status === "paid"
                            ? (de ? "Bezahlt" : "Paid")
                            : (de ? "Versendet" : "Sent")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {someSelected && (
                <tfoot>
                  <tr className="bg-muted/40">
                    <td colSpan={4} className="p-3 text-sm font-medium">
                      {count} {de ? "ausgewählt" : "selected"}
                    </td>
                    <td className="p-3 text-right font-bold tabular-nums">
                      {formatMoney(totalGross)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* ── Expenses section ──────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">
              {de ? "Ausgaben (Eingangsrechnungen)" : "Expenses (Purchase Invoices)"}
              {!expLoading && expenses.length > 0 && (
                <span className="ml-2 text-muted-foreground font-normal">({expenses.length})</span>
              )}
            </h2>
          </div>
          {expenses.length > 0 && (
            <button
              onClick={toggleExpAll}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expAllSelected
                ? (de ? "Alle abwählen" : "Deselect all")
                : (de ? "Alle auswählen" : "Select all")}
            </button>
          )}
        </div>

        {expLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
          </div>
        ) : expError ? (
          <div className="p-6 flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />{expError}
          </div>
        ) : !from || !to ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {de ? "Bitte Zeitraum auswählen." : "Select a date range to load expenses."}
          </div>
        ) : expenses.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            {de ? "Keine Ausgaben im gewählten Zeitraum." : "No expenses in the selected period."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="p-3 text-left font-medium text-muted-foreground">{de ? "Lieferant" : "Vendor"}</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">{de ? "Datum" : "Date"}</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">{de ? "Belegnr." : "Invoice #"}</th>
                  <th className="p-3 text-left font-medium text-muted-foreground">{de ? "Kategorie" : "Category"}</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">{de ? "Netto" : "Net"}</th>
                  <th className="p-3 text-right font-medium text-muted-foreground">{de ? "Brutto" : "Gross"}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => {
                   const net = parseFloat(e.net_amount_eur ?? (e.currency === "EUR" ? e.net_amount ?? "0" : "0")) || 0;
                   const gross = parseFloat(e.gross_amount_eur ?? (e.currency === "EUR" ? e.gross_amount ?? "0" : "0")) || 0;
                  return (
                    <tr
                      key={e.id}
                      className={`border-b transition-colors cursor-pointer hover:bg-muted/20 ${expSelected.has(e.id) ? "bg-primary/5" : ""}`}
                      onClick={() => toggleExp(e.id)}
                    >
                      <td className="p-3 font-medium max-w-[160px] truncate">{e.vendor_name ?? "—"}</td>
                      <td className="p-3 text-muted-foreground tabular-nums">{e.invoice_date ?? "—"}</td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">{e.invoice_number ?? "—"}</td>
                      <td className="p-3 text-muted-foreground">{e.category ?? "—"}</td>
                       <td className="p-3 text-right tabular-nums">
                         {formatMoney(net)}
                         {e.currency !== "EUR" && <div className="text-xs text-muted-foreground">{e.net_amount ?? "—"} {e.currency}</div>}
                       </td>
                       <td className="p-3 text-right tabular-nums font-medium">
                         {formatMoney(gross)}
                         {e.currency !== "EUR" && <div className="text-xs font-normal text-muted-foreground">{e.gross_amount ?? "—"} {e.currency}</div>}
                       </td>
                    </tr>
                  );
                })}
              </tbody>
              {expSomeSelected && (
                <tfoot>
                  <tr className="bg-muted/40">
                    <td colSpan={4} className="p-3 text-sm font-medium">
                      {expSelected.size} {de ? "ausgewählt" : "selected"}
                    </td>
                    <td colSpan={2} className="p-3 text-right font-bold tabular-nums">
                      {formatMoney(expTotalGross)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* Download button */}
        {expenses.length > 0 && (
          <div className="p-4 border-t flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleExpenseDownload}
              disabled={expSelected.size === 0 || expDownloading}
            >
              {expDownloading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />}
              {de
                ? `DATEV-CSV herunterladen${expSelected.size > 0 ? ` (${expSelected.size})` : ""}`
                : `Download DATEV CSV${expSelected.size > 0 ? ` (${expSelected.size})` : ""}`}
            </Button>
            <p className="text-xs text-muted-foreground">
              {de
                 ? "Erzeugt einen DATEV-Buchungsstapel v700 (SKR04). Bei Fremdwährungsbelegen werden gespeicherte EUR-Snapshots verwendet."
                 : "Generates a DATEV Buchungsstapel v700 (SKR04). Saved EUR snapshots are used for foreign-currency documents."}
            </p>
          </div>
        )}
      </div>

      {/* ── EU / Export exemption reasons (0 % VAT only) ──────────────────── */}
      {zeroVatSelected.length > 0 && (
        <div className="bg-card border rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">
              {de ? "Steuerbefreiungsgrund (0 % MwSt.)" : "Tax Exemption Reason (0 % VAT)"}
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {de
              ? "Für Rechnungen mit 0 % MwSt. können Sie einen DATEV-Steuerbefreiungsgrund angeben, damit der DATEV-Importer sie nicht ablehnt."
              : "For invoices with 0 % VAT you can provide a DATEV exemption reason so the DATEV importer does not reject them."}
          </p>
          <div className="space-y-3">
            {zeroVatSelected.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm font-medium w-36 shrink-0">
                  {inv.invoiceNumber}
                </span>
                <Select
                  value={exemptionReasons[inv.id] ?? ""}
                  onValueChange={(val) =>
                    setExemptionReasons((prev) => ({ ...prev, [inv.id]: val }))
                  }
                >
                  <SelectTrigger className="flex-1 min-w-[260px] h-9 text-sm">
                    <SelectValue
                      placeholder={
                        de ? "Grund auswählen (optional)" : "Select reason (optional)"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)">
                      {de
                        ? "Innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)"
                        : "Intra-EU supply (§ 4 Nr. 1b UStG)"}
                    </SelectItem>
                    <SelectItem value="Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1a UStG)">
                      {de
                        ? "Ausfuhrlieferung (§ 4 Nr. 1a UStG)"
                        : "Export delivery outside EU (§ 4 Nr. 1a UStG)"}
                    </SelectItem>
                    <SelectItem value="Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)">
                      {de
                        ? "Umkehrung der Steuerschuldnerschaft / Reverse Charge (§ 13b UStG)"
                        : "Reverse charge (§ 13b UStG)"}
                    </SelectItem>
                    <SelectItem value="Sonstige Leistung an EU-Unternehmer – Steuerschuldnerschaft des Leistungsempfängers gem. §3a Abs. 2 UStG i.V.m. §13b UStG (Reverse Charge)">
                      {de
                        ? "Vortrag/Referentenleistung – EU-Unternehmer (§3a Abs. 2 UStG, Reverse Charge)"
                        : "Lecture / speaking fee – EU business (§3a (2) UStG, Reverse Charge)"}
                    </SelectItem>
                    <SelectItem value="Sonstige Leistung an Drittlandsunternehmer – nicht steuerbar in Deutschland gem. §3a Abs. 2 UStG">
                      {de
                        ? "Vortrag/Referentenleistung – Drittland (§3a Abs. 2 UStG, nicht steuerbar)"
                        : "Lecture / speaking fee – Non-EU business (§3a (2) UStG, not taxable)"}
                    </SelectItem>
                    <SelectItem value="Steuerfreie Leistung (§ 4 Nr. 14 UStG)">
                      {de
                        ? "Steuerfreie Heilbehandlung (§ 4 Nr. 14 UStG)"
                        : "Tax-exempt medical service (§ 4 Nr. 14 UStG)"}
                    </SelectItem>
                    <SelectItem value="Kleinunternehmerregelung (§ 19 UStG)">
                      {de
                        ? "Kleinunternehmerregelung (§ 19 UStG)"
                        : "Small-business exemption (§ 19 UStG)"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Bookkeeper email ───────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b">
          <Mail className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">
            {de ? "Buchhaltungs-E-Mail" : "Bookkeeper Email"}
          </h2>
        </div>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="buchhaltung@kanzlei.de"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailSaved(false); }}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveEmail}
            disabled={savingEmail || !email.trim()}
            className="gap-1.5 shrink-0"
          >
            {savingEmail
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : emailSaved
                ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                : <Save className="w-4 h-4" />}
            {de ? "Als Standard" : "Save Default"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {de
            ? "Die ZIP-Datei wird als E-Mail-Anhang an diese Adresse gesendet. Mit 'Als Standard' wird die Adresse für zukünftige Exporte gespeichert."
            : "The ZIP archive will be emailed to this address. 'Save Default' stores it for future exports."}
        </p>
      </div>

      {/* ── Export button & status ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <Button
            size="lg"
            className="gap-2 w-full sm:w-auto"
            onClick={handleExport}
            disabled={status === "processing" || downloadStatus === "processing" || count === 0 || !email.trim()}
          >
            {status === "processing" ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {de ? "Exportiere…" : "Processing export…"}
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                {de
                  ? `${count > 0 ? `${count} Rechnungen` : "Rechnungen"} per E-Mail exportieren`
                  : `Export ${count > 0 ? `${count} invoice${count !== 1 ? "s" : ""}` : "invoices"} via Email`}
              </>
            )}
          </Button>

          <Button
            size="lg"
            variant="outline"
            className="gap-2 w-full sm:w-auto"
            onClick={handleDownload}
            disabled={downloadStatus === "processing" || status === "processing" || count === 0}
            title={de
              ? "Vorschau-Download — markiert keine Rechnungen als exportiert"
              : "Preview download — does not mark invoices as exported"}
          >
            {downloadStatus === "processing" ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {de ? "Erstelle ZIP…" : "Building ZIP…"}
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                {de ? "ZIP-Vorschau herunterladen" : "Download ZIP (Preview)"}
              </>
            )}
          </Button>
          <p className="w-full text-xs text-muted-foreground mt-1">
            {de
              ? "Der ZIP-Download dient nur zur Vorschau und markiert keine Rechnungen als exportiert. Nur der E-Mail-Export erstellt einen Eintrag im Exportverlauf."
              : "The ZIP download is for preview only and does not mark invoices as exported. Only the email export creates a history entry."}
          </p>
        </div>

        {status === "success" && exportResult && (
          <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-800 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-green-600" />
            <div>
              <p className="font-semibold">
                {de
                  ? `E-Mail erfolgreich gesendet! ${exportResult.exported} Rechnung${exportResult.exported !== 1 ? "en" : ""} exportiert.`
                  : `Email sent successfully! ${exportResult.exported} invoice${exportResult.exported !== 1 ? "s" : ""} exported.`}
              </p>
              <p className="text-green-700 mt-0.5">
                {de ? `Empfänger: ${email}` : `Recipient: ${email}`}
              </p>
              {exportResult.skipped.length > 0 && (
                <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  <p className="font-medium mb-1">
                    {de ? "Übersprungen:" : "Skipped:"}
                  </p>
                  {exportResult.skipped.map((s, i) => <p key={i}>• {s}</p>)}
                </div>
              )}
            </div>
          </div>
        )}

        {status === "error" && errorMsg && (
          <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                {de ? "E-Mail-Export fehlgeschlagen" : "Email export failed"}
              </p>
              <pre className="mt-1 text-xs whitespace-pre-wrap font-sans">{errorMsg}</pre>
            </div>
          </div>
        )}

        {downloadStatus === "error" && downloadError && (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm"
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">
                {de ? "Download fehlgeschlagen" : "Download failed"}
              </p>
              <pre className="mt-1 text-xs whitespace-pre-wrap font-sans">{downloadError}</pre>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setDownloadError(null);
                setDownloadStatus("idle");
              }}
              aria-label={de ? "Download-Fehler schließen" : "Dismiss download error"}
            >
              {de ? "Schließen" : "Dismiss"}
            </Button>
          </div>
        )}

        {downloadSkipped.length > 0 && (
          <div
            role="status"
            className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm"
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-semibold">
                {de ? "Einige Rechnungen wurden übersprungen" : "Some invoices were skipped"}
              </p>
              <p className="mt-0.5">
                {de
                  ? "Diese Rechnungen enthalten keine Positionen und sind nicht im ZIP enthalten:"
                  : "These invoices have no line items and are not included in the ZIP:"}
              </p>
              <p className="mt-1 font-mono">{downloadSkipped.join(", ")}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Re-export confirmation dialog ──────────────────────────────────── */}
      {reexportPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-card border rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-base">
                  {de ? "Bereits exportierte Rechnungen" : "Previously exported invoices"}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {de
                    ? "Die folgenden Rechnungen wurden bereits in einem früheren DATEV-Export gesendet:"
                    : "The following invoices were already included in a previous DATEV export:"}
                </p>
                <ul className="mt-2 text-sm font-mono space-y-0.5 max-h-40 overflow-y-auto">
                  {reexportPending.invoiceNumbers.map((n) => (
                    <li key={n} className="text-amber-700">{n}</li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground mt-3">
                  {de
                    ? reexportPending.action === "download"
                      ? "Trotzdem fortfahren und das ZIP erneut herunterladen?"
                      : "Trotzdem fortfahren und erneut exportieren?"
                    : reexportPending.action === "download"
                      ? "Do you want to proceed and download the ZIP again?"
                      : "Do you want to proceed and export them again?"}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setReexportPending(null); setStatus("idle"); }}
              >
                {de ? "Abbrechen" : "Cancel"}
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleConfirmReexport}
              >
                {reexportPending.action === "download"
                  ? <Download className="w-4 h-4" />
                  : <Send className="w-4 h-4" />}
                {reexportPending.action === "download"
                  ? (de ? "Trotzdem herunterladen" : "Download anyway")
                  : (de ? "Trotzdem exportieren" : "Export anyway")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export history ─────────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">
              {de ? "Exportverlauf" : "Export History"}
            </h2>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              {de ? "Von" : "From"}
              <Input
                type="date"
                value={historyFrom}
                onChange={(event) => setHistoryFrom(event.target.value)}
                className="h-8 w-36 text-sm"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              {de ? "Bis" : "To"}
              <Input
                type="date"
                value={historyTo}
                onChange={(event) => setHistoryTo(event.target.value)}
                className="h-8 w-36 text-sm"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              {de ? "Empfänger" : "Recipient"}
              <Input
                type="email"
                value={historyEmail}
                onChange={(event) => setHistoryEmail(event.target.value)}
                placeholder={de ? "E-Mail suchen" : "Search email"}
                className="h-8 w-48 text-sm"
              />
            </label>
            <Button size="sm" onClick={applyHistoryFilters} disabled={historyLoading}>
              {de ? "Filtern" : "Filter"}
            </Button>
            {(historyFrom || historyTo || historyEmail) && (
              <Button size="sm" variant="ghost" onClick={clearHistoryFilters} disabled={historyLoading}>
                {de ? "Zurücksetzen" : "Clear"}
              </Button>
            )}
          </div>
        </div>

        {historyLoading && exportHistory.length === 0 ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3].map((item) => <Skeleton key={item} className="h-10 w-full" />)}
          </div>
        ) : historyError ? (
          <div className="p-5 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {historyError}
          </div>
        ) : exportHistory.length === 0 ? (
          <div className="p-7 text-center text-sm text-muted-foreground">
            {historyFrom || historyTo || historyEmail
              ? (de ? "Keine Exporte entsprechen diesen Filtern." : "No exports match these filters.")
              : (de ? "Noch keine DATEV-Exporte vorhanden." : "No DATEV exports yet.")}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="p-3 text-left font-medium text-muted-foreground">
                      {de ? "Datum" : "Date"}
                    </th>
                    <th className="p-3 text-left font-medium text-muted-foreground">
                      {de ? "Empfänger" : "Recipient"}
                    </th>
                    <th className="p-3 text-center font-medium text-muted-foreground">
                      {de ? "Status" : "Status"}
                    </th>
                    <th className="p-3 text-right font-medium text-muted-foreground">
                      {de ? "Rechnungen" : "Invoices"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {exportHistory.map((rec) => {
                    const invoiceNumbers = rec.invoiceNumbers ?? [];
                    const canExpandInvoices = invoiceNumbers.length > 0;
                    const invoicesExpanded = expandedHistoryIds.has(rec.id);
                    return (
                      <Fragment key={rec.id}>
                        <tr className="border-b hover:bg-muted/20 transition-colors">
                          <td className="p-3 text-muted-foreground tabular-nums">
                            {new Date(rec.exportedAt).toLocaleString(de ? "de-DE" : "en-GB", {
                              day: "2-digit", month: "2-digit", year: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </td>
                          <td className="p-3">{rec.bookkeeperEmail}</td>
                          <td className="p-3 text-center">
                            {rec.status === "sent" && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                {de ? "Gesendet" : "Sent"}
                              </span>
                            )}
                            {rec.status === "pending" && (
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700"
                                title={de
                                  ? "Export gestartet, Lieferstatus unbekannt. Prüfen Sie die Zustellung vor „Trotzdem exportieren“."
                                  : "Export started, delivery status unknown. Confirm non-delivery before choosing “Export anyway”."}
                              >
                                {de ? "Ausstehend" : "Pending"}
                              </span>
                            )}
                            {rec.status === "failed" && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                {de ? "Fehlgeschlagen" : "Failed"}
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium">
                            {canExpandInvoices ? (
                              <button
                                type="button"
                                className="text-primary hover:underline underline-offset-2"
                                onClick={() => toggleHistoryInvoices(rec.id)}
                                aria-expanded={invoicesExpanded}
                              >
                                <span>{rec.invoiceCount}</span>{" "}
                                <span className="font-normal">{de ? "anzeigen" : "view"}</span>
                              </button>
                            ) : (
                              rec.invoiceCount
                            )}
                          </td>
                        </tr>
                        {invoicesExpanded && (
                          <tr className="border-b bg-muted/20">
                            <td colSpan={4} className="px-3 py-2">
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                {de ? "Enthaltene Rechnungsnummern" : "Included invoice numbers"}
                              </p>
                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-mono">
                                {invoiceNumbers.map((invoiceNumber) => (
                                  <span key={invoiceNumber}>{invoiceNumber}</span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {historyHasMore && (
              <div className="p-3 border-t flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void loadExportHistory({ append: true, offset: exportHistory.length })}
                  disabled={historyLoading}
                >
                  {historyLoading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : (de ? "Weitere laden" : "Load more")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
