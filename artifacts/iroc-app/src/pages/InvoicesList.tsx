import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { formatMoney, formatDate, getInvoiceTypeLabel } from "@/lib/utils";
import { useListIrocInvoices, updateIrocInvoiceStatus, getListIrocInvoicesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { adminDelete } from "@/lib/admin-fetch";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, ChevronUp, ChevronDown, Trash2, Mail, CheckCircle, RotateCcw, X, Ban, Eye, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { IROC_DASHBOARD_QUERY_KEY } from "@/lib/query-keys";

type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled";
const ALL_STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "cancelled"];

export function compareInvoiceNumbersDescending(a: string, b: string): number {
  const parse = (value: string) => {
    const match = value.match(/(\d{4})\D*(\d+)$/);
    return match ? { year: Number(match[1]), sequence: Number(match[2]) } : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (left && right) {
    return right.year - left.year || right.sequence - left.sequence;
  }
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}

export default function InvoicesList() {
  const { lang } = useLanguage();
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"number" | "type">("number");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const queryClient = useQueryClient();
  const { data: invoices, isLoading, isError, isFetching, fetchStatus, refetch } = useListIrocInvoices({
    query: {
      queryKey: getListIrocInvoicesQueryKey(),
      refetchOnWindowFocus: true,
    },
  });
  const [retrying, setRetrying] = useState(false);
  const retryObservedRef = useRef(false);
  useEffect(() => {
    if (retrying && fetchStatus === "fetching") {
      retryObservedRef.current = true;
    }
    if (
      retrying &&
      retryObservedRef.current &&
      fetchStatus === "idle" &&
      (isError || invoices)
    ) {
      retryObservedRef.current = false;
      setRetrying(false);
    }
  }, [fetchStatus, invoices, isError, retrying]);
  const handleRetry = () => {
    setRetrying(true);
    void refetch();
  };
  const retryInProgress = retrying || fetchStatus === "fetching";

  // Status filter — activated via ?status=pending from Dashboard "New Orders"
  const [statusFilter, setStatusFilter] = useState<Set<InvoiceStatus>>(() => {
    const params = new URLSearchParams(window.location.search);
    // ?status=pending pre-selects draft+sent (the "open" statuses)
    return params.get("status") === "pending"
      ? new Set<InvoiceStatus>(["draft", "sent"])
      : new Set<InvoiceStatus>();
  });
  const websiteCustomerIdFilter = (() => {
    const raw = new URLSearchParams(window.location.search).get("websiteCustomerId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  })();

  const toggleStatus = (s: InvoiceStatus) =>
    setStatusFilter(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  const filtered = invoices?.filter(inv => {
    if (statusFilter.size > 0 && !statusFilter.has(inv.status as InvoiceStatus)) return false;
    if (websiteCustomerIdFilter !== null && inv.websiteCustomerId !== websiteCustomerIdFilter) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      inv.invoiceNumber.toLowerCase().includes(q) ||
      (inv.customerName && inv.customerName.toLowerCase().includes(q))
    );
  });

  const sorted = [...(filtered ?? [])].sort((a, b) => {
    let av: string;
    let bv: string;
    if (sortField === "type") {
      av = getInvoiceTypeLabel(a.invoiceType, lang).toLowerCase();
      bv = getInvoiceTypeLabel(b.invoiceType, lang).toLowerCase();
    } else {
      return sortDir === "asc"
        ? compareInvoiceNumbersDescending(b.invoiceNumber, a.invoiceNumber)
        : compareInvoiceNumbersDescending(a.invoiceNumber, b.invoiceNumber);
    }
    return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const allIds = sorted.map(inv => inv.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const toggleSelect = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(allIds));

  // Count how many selected invoices are eligible for each status transition
  const selectedInvoices = sorted.filter(inv => selectedIds.has(inv.id));
  const eligibleForSent        = selectedInvoices.filter(inv => inv.status === "draft");
  const eligibleForPaid        = selectedInvoices.filter(inv => inv.status === "sent");
  const eligibleRevertToSent   = selectedInvoices.filter(inv => inv.status === "paid");
  const eligibleRevertToDraft  = selectedInvoices.filter(inv => inv.status === "paid");
  const eligibleForCancel      = selectedInvoices.filter(inv => inv.status === "draft" || inv.status === "sent" || inv.status === "paid");
  const eligibleReopen         = selectedInvoices.filter(inv => inv.status === "cancelled");

  const handleBulkStatus = async (eligible: typeof selectedInvoices, targetStatus: "draft" | "sent" | "paid" | "cancelled") => {
    if (eligible.length === 0) return;
    setBulkUpdating(true);
    for (const inv of eligible) {
      await updateIrocInvoiceStatus(inv.id, { status: targetStatus }).catch(() => {});
    }
    await queryClient.invalidateQueries({ queryKey: getListIrocInvoicesQueryKey() });
    await queryClient.invalidateQueries({ queryKey: IROC_DASHBOARD_QUERY_KEY });
    setBulkUpdating(false);
  };

  const handleBulkDelete = async () => {
    if (!token || selectedIds.size === 0) return;
    const selectedArr = sorted.filter(inv => selectedIds.has(inv.id));
    const deletable   = selectedArr.filter(inv => inv.status === "draft");
    const protected_  = selectedArr.filter(inv => inv.status !== "draft");

    if (protected_.length > 0 && deletable.length === 0) {
      alert(lang === "de"
        ? `${protected_.length} Rechnung(en) können nicht gelöscht werden. Gesendete, bezahlte und stornierte Rechnungen müssen gemäß § 147 AO / GoBD 10 Jahre aufbewahrt werden. Stornieren Sie die Rechnung stattdessen.`
        : `${protected_.length} invoice(s) cannot be deleted. Sent, paid, and cancelled invoices must be retained for 10 years under German GoBD law. Cancel the invoice instead.`);
      return;
    }

    const confirmMsg = protected_.length > 0
      ? (lang === "de"
        ? `${deletable.length} Entwurf(e) löschen? ${protected_.length} gesendete/bezahlte/stornierte Rechnung(en) werden übersprungen und können nicht gelöscht werden.`
        : `Delete ${deletable.length} draft(s)? ${protected_.length} sent/paid/cancelled invoice(s) will be skipped — they cannot be deleted.`)
      : (lang === "de"
        ? `${deletable.length} Entwurf(e) löschen? Dies kann nicht rückgängig gemacht werden.`
        : `Delete ${deletable.length} draft(s)? This cannot be undone.`);

    if (!confirm(confirmMsg)) return;
    setDeleting(true);
    for (const inv of deletable) await adminDelete(`/api/iroc/invoices/${inv.id}`, token).catch(() => {});
    setSelectedIds(new Set());
    setDeleting(false);
    refetch();
  };

  const getTypeBadge = (type: string | undefined | null) => {
    const label = getInvoiceTypeLabel(type ?? "", lang);
    if (!label) return null;
    const isLecture = type === "lecture-eu" || type === "lecture-noneu";
    return (
      <Badge variant="outline" className={isLecture ? "border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-300" : ""}>
        {label}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "paid":      return <Badge variant="success">{t("paid", lang)}</Badge>;
      case "sent":      return <Badge className="bg-blue-500 hover:bg-blue-600 text-white">{t("sent", lang)}</Badge>;
      case "draft":     return <Badge variant="secondary">{t("draft", lang)}</Badge>;
      case "cancelled": return <Badge variant="destructive" className="opacity-75">{t("cancelled", lang)}</Badge>;
      default:          return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("invoices", lang)}</h1>
        <Button asChild>
          <Link href="/invoices/new">
            <Plus className="h-4 w-4 mr-2" />
            {t("new_invoice", lang)}
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center space-x-2 bg-card border rounded-md p-1 max-w-sm">
          <Search className="h-4 w-4 ml-2 text-muted-foreground" />
          <Input
            placeholder={lang === "de" ? "Nummer oder Kunde suchen…" : "Search number or customer..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-2 bg-transparent"
          />
        </div>

        {/* Status filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {ALL_STATUSES.map(s => {
            const active = statusFilter.has(s);
            const labels: Record<InvoiceStatus, string> = {
              draft:     lang === "de" ? "Entwurf"   : "Draft",
              sent:      lang === "de" ? "Gesendet"  : "Sent",
              paid:      lang === "de" ? "Bezahlt"   : "Paid",
              cancelled: lang === "de" ? "Storniert" : "Cancelled",
            };
            const colors: Record<InvoiceStatus, string> = {
              draft:     active ? "bg-muted text-foreground border-border"                                               : "border-dashed text-muted-foreground",
              sent:      active ? "bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200"     : "border-dashed text-muted-foreground",
              paid:      active ? "bg-emerald-100 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200" : "border-dashed text-muted-foreground",
              cancelled: active ? "bg-rose-100 dark:bg-rose-900/40 border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200"     : "border-dashed text-muted-foreground",
            };
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${colors[s]}`}
              >
                {labels[s]}
                {active && <X className="h-3 w-3 opacity-60" />}
              </button>
            );
          })}
          {statusFilter.size > 0 && (
            <button
              onClick={() => setStatusFilter(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              {lang === "de" ? "Alle" : "All"}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={toggleAll} className="h-7 gap-1.5 text-xs">
          {allSelected ? (lang === "de" ? "Auswahl aufheben" : "Deselect all") : (lang === "de" ? "Alle auswählen" : "Select all")}
        </Button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-muted/60 border rounded-lg text-sm">
          <span className="font-medium text-foreground shrink-0">
            {selectedIds.size} {lang === "de" ? "ausgewählt" : "selected"}
          </span>

          <div className="w-px h-4 bg-border mx-1 shrink-0" />

          {/* Mark as Sent — draft → sent */}
          <Button
            size="sm"
            variant="outline"
            disabled={bulkUpdating || deleting || eligibleForSent.length === 0}
            onClick={() => handleBulkStatus(eligibleForSent, "sent")}
            className="gap-1.5 h-7 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-40"
          >
            <Mail className="h-3.5 w-3.5" />
            {lang === "de" ? "Als Gesendet" : "Mark Sent"}
            {eligibleForSent.length > 0 && <span className="ml-0.5 opacity-70">({eligibleForSent.length})</span>}
          </Button>

          {/* Mark as Paid — sent → paid */}
          <Button
            size="sm"
            variant="outline"
            disabled={bulkUpdating || deleting || eligibleForPaid.length === 0}
            onClick={() => handleBulkStatus(eligibleForPaid, "paid")}
            className="gap-1.5 h-7 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-40"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            {lang === "de" ? "Als Bezahlt" : "Mark Paid"}
            {eligibleForPaid.length > 0 && <span className="ml-0.5 opacity-70">({eligibleForPaid.length})</span>}
          </Button>

          {/* Revert to Sent — paid → sent */}
          <Button
            size="sm"
            variant="outline"
            disabled={bulkUpdating || deleting || eligibleRevertToSent.length === 0}
            onClick={() => handleBulkStatus(eligibleRevertToSent, "sent")}
            className="gap-1.5 h-7 border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {lang === "de" ? "Zurück zu Gesendet" : "Revert to Sent"}
            {eligibleRevertToSent.length > 0 && <span className="ml-0.5 opacity-70">({eligibleRevertToSent.length})</span>}
          </Button>

          {/* Revert to Draft — paid → draft */}
          <Button
            size="sm"
            variant="outline"
            disabled={bulkUpdating || deleting || eligibleRevertToDraft.length === 0}
            onClick={() => handleBulkStatus(eligibleRevertToDraft, "draft")}
            className="gap-1.5 h-7 text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {lang === "de" ? "Zurück zu Entwurf" : "Revert to Draft"}
            {eligibleRevertToDraft.length > 0 && <span className="ml-0.5 opacity-70">({eligibleRevertToDraft.length})</span>}
          </Button>

          {/* Cancel — draft/sent → cancelled */}
          <Button
            size="sm"
            variant="outline"
            disabled={bulkUpdating || deleting || eligibleForCancel.length === 0}
            onClick={() => handleBulkStatus(eligibleForCancel, "cancelled")}
            className="gap-1.5 h-7 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-40"
          >
            <Ban className="h-3.5 w-3.5" />
            {lang === "de" ? "Stornieren" : "Cancel"}
            {eligibleForCancel.length > 0 && <span className="ml-0.5 opacity-70">({eligibleForCancel.length})</span>}
          </Button>

          {/* Reopen — cancelled → draft */}
          <Button
            size="sm"
            variant="outline"
            disabled={bulkUpdating || deleting || eligibleReopen.length === 0}
            onClick={() => handleBulkStatus(eligibleReopen, "draft")}
            className="gap-1.5 h-7 border-orange-200 text-orange-700 hover:bg-orange-50 hover:text-orange-800 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {lang === "de" ? "Wiedereröffnen" : "Reopen"}
            {eligibleReopen.length > 0 && <span className="ml-0.5 opacity-70">({eligibleReopen.length})</span>}
          </Button>

          <div className="w-px h-4 bg-border mx-1 shrink-0" />

          {/* Delete */}
          <Button size="sm" variant="destructive" disabled={deleting || bulkUpdating} onClick={handleBulkDelete} className="gap-1.5 h-7">
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? (lang === "de" ? "Lösche…" : "Deleting…") : `${lang === "de" ? "Löschen" : "Delete"} (${selectedIds.size})`}
          </Button>

        </div>
      )}

      <div className="border rounded-md bg-card">
        <div className="overflow-y-auto max-h-[60vh] sticky-header-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer select-none hover:bg-muted/50 w-[150px]"
                onClick={() => { if (sortField === "number") { setSortDir(d => d === "asc" ? "desc" : "asc"); } else { setSortField("number"); setSortDir("asc"); } }}
              >
                <div className="flex items-center gap-1">
                  {t("invoice_number", lang)}
                  {sortField === "number" && (sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />)}
                </div>
              </TableHead>
              <TableHead>{t("customer", lang)}</TableHead>
              <TableHead>{t("issue_date", lang)}</TableHead>
              <TableHead
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => { if (sortField === "type") { setSortDir(d => d === "asc" ? "desc" : "asc"); } else { setSortField("type"); setSortDir("asc"); } }}
              >
                <div className="flex items-center gap-1">
                  {t("type", lang)}
                  {sortField === "type" && (sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />)}
                </div>
              </TableHead>
              <TableHead>{t("status", lang)}</TableHead>
              <TableHead className="text-right">{t("total", lang)}</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && !retryInProgress ? (
              [1,2,3,4,5].map(i => (
                <TableRow key={i}>
                  {[1,2,3,4,5,6,7].map(j => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}
                </TableRow>
              ))
            ) : isError || retryInProgress || (!invoices && !isLoading) ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-destructive" role="alert">
                   <div className="flex flex-col items-center justify-center gap-2">
                     <span>
                       {lang === "de"
                         ? "Rechnungen konnten nicht geladen werden."
                         : "Failed to load invoices."}
                     </span>
                     <Button
                       variant="outline"
                       size="sm"
                       disabled={isFetching || retryInProgress}
                       onClick={() => { void handleRetry(); }}
                       className="gap-1.5"
                     >
                       <RotateCcw className={`h-3.5 w-3.5 ${isFetching || retryInProgress ? "animate-spin" : ""}`} />
                       {isFetching || retryInProgress
                         ? (lang === "de" ? "Wird erneut geladen…" : "Retrying…")
                         : (lang === "de" ? "Erneut versuchen" : "Retry")}
                     </Button>
                   </div>
                </TableCell>
              </TableRow>
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                  {t("no_data", lang)}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map(inv => (
                <TableRow
                  key={inv.id}
                  data-state={selectedIds.has(inv.id) ? "selected" : undefined}
                  onClick={() => toggleSelect(inv.id)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium font-mono text-sm">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/invoices/${inv.id}`} className="hover:underline">
                        {inv.invoiceNumber}
                      </Link>
                      {inv.correctionOfInvoiceId && (
                        <Badge variant="outline" className="border-blue-300 text-blue-700 text-[10px] px-1.5 py-0">
                          {lang === "de" ? "Rechnungskorrektur" : "Invoice correction"}
                        </Badge>
                      )}
                      {inv.sallyGenerated && (
                        <Badge className="bg-pink-100 text-pink-800 hover:bg-pink-100 dark:bg-pink-900 dark:text-pink-200 text-[10px] px-1.5 py-0" title={lang === "de" ? "Von Sally automatisch erstellt" : "Auto-created by Sally"}>
                          Sally
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{inv.customerName}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(inv.issueDate)}</TableCell>
                  <TableCell>{getTypeBadge(inv.invoiceType)}</TableCell>
                  <TableCell>{getStatusBadge(inv.status)}</TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(inv.total)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild title={lang === "de" ? "Ansehen" : "View"}>
                      <Link href={`/invoices/${inv.id}`} onClick={e => e.stopPropagation()}><Eye className="h-4 w-4" /></Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </div>
      </div>
    </div>
  );
}
