import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useProductGroupHelpers } from "@/lib/product-groups";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { formatMoney, formatDate } from "@/lib/utils";
import { useListIrocInvoices } from "@workspace/api-client-react";
import { IROC_DASHBOARD_QUERY_KEY } from "@/lib/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, Package, FileText, AlertTriangle, TrendingUp, CheckCircle,
  Clock, MessageSquareQuote, CalendarDays, Hourglass, X,
  ShoppingBag, GraduationCap, Ban, Receipt, TrendingDown, Scale,
  PackageCheck, Warehouse,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { adminRequest } from "@/lib/admin-fetch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecentOrder {
  id: number;
  name: string;
  institutionName: string | null;
  email: string;
  instrument: string;
  createdAt: string;
  openOrderCount: number;
  categoryTotals: { category: string; total: string }[];
}

interface RecentTraining {
  id: number;
  name: string;
  email: string;
  instrument: string;
  trainingDateInfo: string | null;
  createdAt: string;
}

interface DashData {
  totalCustomers: number;
  totalProducts: number;
  totalInvoices: number;
  lowStockCount: number;
  unreadNotifications: number;
  revenueTotal: string;
  revenueSent: string;
  availableYears: number[];
  invoicesByStatus: { draft: number; sent: number; paid: number; cancelled: number };
  pendingQuotes: number | null;
  pendingTrainings: number;
  incomingOrders?: { pending: number; approved: number };
  recentOrders: RecentOrder[];
  recentTrainings: RecentTraining[];
}

interface Expense {
  id: number;
  vendor_name: string | null;
  invoice_date: string | null;
  invoice_number: string | null;
  category: string | null;
  gross_amount: string | null;
  net_amount: string | null;
  tax_amount: string | null;
  currency: string | null;
}

type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled";

interface PendingLot {
  lot_id: number;
  product_id: number;
  product_sku: string | null;
  product_name_de: string | null;
  product_name_en: string | null;
  lot_number: string | null;
  purchase_date: string | null;
  quantity_received: number;
  description: string | null;
  expense_id: number | null;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  unit_price: string | null;
  line_total: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function yearRange(year: string | null): { from: string; to: string } | null {
  if (!year || year === "all") {
    // Return null → caller omits date params so the API returns all-time data,
    // matching the unbounded revenue figure from /api/iroc/dashboard.
    return null;
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------

function MetricCard({
  title, value, icon: Icon, description, alert, accent, href, subValue,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  description?: string;
  alert?: boolean;
  accent?: "amber" | "emerald" | "rose" | "blue" | "violet";
  href?: string;
  subValue?: string;
}) {
  const accentCls =
    accent === "amber"   ? "bg-amber-50/50   dark:bg-amber-950/20   border-amber-100   dark:border-amber-900"   :
    accent === "emerald" ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900" :
    accent === "rose"    ? "bg-rose-50/50    dark:bg-rose-950/20    border-rose-100    dark:border-rose-900"    :
    accent === "blue"    ? "bg-blue-50/50    dark:bg-blue-950/20    border-blue-100    dark:border-blue-900"    :
    accent === "violet"  ? "bg-violet-50/50  dark:bg-violet-950/20  border-violet-100  dark:border-violet-900"  :
    "";

  const iconCls =
    alert             ? "text-destructive"                            :
    accent === "amber"   ? "text-amber-500"                          :
    accent === "emerald" ? "text-emerald-500"                        :
    accent === "rose"    ? "text-rose-500"                           :
    accent === "blue"    ? "text-blue-500"                           :
    accent === "violet"  ? "text-violet-500"                         :
    "text-muted-foreground";

  const valueCls =
    alert             ? "text-destructive"  :
    accent === "rose" ? "text-rose-600 dark:text-rose-400"   :
    "";

  const inner = (
    <Card className={`${accentCls} ${href ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${iconCls}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${valueCls}`}>{value}</div>
        {subValue && <p className="text-xs font-medium text-muted-foreground mt-0.5">{subValue}</p>}
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function StatusBadge({ status, lang }: { status: string; lang: "en" | "de" }) {
  switch (status) {
    case "paid":      return <Badge variant="success">{t("paid", lang)}</Badge>;
    case "sent":      return <Badge className="bg-blue-500 hover:bg-blue-600 text-white">{t("sent", lang)}</Badge>;
    case "cancelled": return <Badge variant="destructive" className="opacity-75">{t("cancelled", lang)}</Badge>;
    default:          return <Badge variant="secondary">{t("draft", lang)}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Inline invoice table shown when a status block is clicked
// ---------------------------------------------------------------------------

function InlineInvoiceTable({
  status, invoices, lang, onClose,
}: {
  status: InvoiceStatus;
  invoices: Array<{ id: number; invoiceNumber: string; customerName?: string | null; issueDate: string; total: string; status: string }>;
  lang: "en" | "de";
  onClose: () => void;
}) {
  const labelMap: Record<InvoiceStatus, string> = {
    draft:     t("draft", lang),
    sent:      t("sent", lang),
    paid:      t("paid", lang),
    cancelled: t("cancelled", lang),
  };

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <h3 className="text-sm font-semibold">
          {lang === "de" ? "Rechnungen" : "Invoices"} — {labelMap[status]}
          <span className="ml-2 text-muted-foreground font-normal">({invoices.length})</span>
        </h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t("close", lang)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">{t("no_data", lang)}</p>
      ) : (
        <div className="sticky-header-table overflow-y-auto max-h-80">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[150px]">{t("invoice_number", lang)}</TableHead>
                <TableHead>{t("customer", lang)}</TableHead>
                <TableHead>{t("issue_date", lang)}</TableHead>
                <TableHead>{t("status", lang)}</TableHead>
                <TableHead className="text-right">{t("total", lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map(inv => (
                <TableRow key={inv.id} className="hover:bg-muted/30">
                  <TableCell className="font-mono text-sm font-medium">
                    <Link href={`/invoices/${inv.id}`} className="hover:underline">
                      {inv.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{inv.customerName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(inv.issueDate)}</TableCell>
                  <TableCell><StatusBadge status={inv.status} lang={lang} /></TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(inv.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending Deliveries panel (inline, shown when the metric card is clicked)
// ---------------------------------------------------------------------------

function PendingDeliveriesPanel({
  lots, lang, onReceive, onClose, receiving,
}: {
  lots: PendingLot[];
  lang: "en" | "de";
  onReceive: (lotId: number) => void;
  onClose: () => void;
  receiving: Set<number>;
}) {
  const de = lang === "de";
  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-amber-50/60 dark:bg-amber-950/20">
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <Warehouse className="h-4 w-4" />
          {de ? "Ausstehende Lieferungen" : "Pending Deliveries"}
          <span className="ml-1 text-muted-foreground font-normal">({lots.length})</span>
        </h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t("close", lang)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {lots.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {de ? "Keine ausstehenden Lieferungen" : "No pending deliveries"}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de ? "Produkt" : "Product"}</TableHead>
                <TableHead>{de ? "Los-Nr." : "Lot #"}</TableHead>
                <TableHead className="text-right">{de ? "Menge" : "Qty"}</TableHead>
                <TableHead>{de ? "Lieferant" : "Supplier"}</TableHead>
                <TableHead>{de ? "Rechnung" : "Invoice"}</TableHead>
                <TableHead>{de ? "Bestellt am" : "Ordered"}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.map(lot => (
                <TableRow key={lot.lot_id} className="hover:bg-muted/30">
                  <TableCell>
                    <p className="text-sm font-medium">{de ? lot.product_name_de : lot.product_name_en}</p>
                    {lot.product_sku && (
                      <p className="text-xs text-muted-foreground font-mono">{lot.product_sku}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-mono">{lot.lot_number ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{lot.quantity_received}</TableCell>
                  <TableCell className="text-sm">{lot.vendor_name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{lot.invoice_number ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {lot.purchase_date ? formatDate(lot.purchase_date) : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                      disabled={receiving.has(lot.lot_id)}
                      onClick={() => onReceive(lot.lot_id)}
                    >
                      <PackageCheck className="h-3 w-3" />
                      {receiving.has(lot.lot_id)
                        ? (de ? "Wird verbucht…" : "Saving…")
                        : (de ? "Eingetroffen" : "Mark Received")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { lang } = useLanguage();
  const de = lang === "de";
  const { label: groupLabel } = useProductGroupHelpers(lang);
  const { token } = useAuth();
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<InvoiceStatus | null>(null);

  // expenses state
  const [expenses, setExpenses]       = useState<Expense[]>([]);
  const [expLoading, setExpLoading]   = useState(false);
  const [expTotal, setExpTotal]       = useState(0);
  const [expCount, setExpCount]       = useState(0);
  const [expError, setExpError]       = useState(false);

  // pending deliveries state
  const [pendingLots, setPendingLots]         = useState<PendingLot[]>([]);
  const [pendingLotsLoading, setPendingLotsLoading] = useState(false);
  const [showPendingLots, setShowPendingLots] = useState(false);
  const [receiving, setReceiving]             = useState<Set<number>>(new Set());

  // ── Metrics query ──────────────────────────────────────────────────────────
  const queryKey = [...IROC_DASHBOARD_QUERY_KEY, selectedYear];
  const url =
    selectedYear === "all"
      ? "/api/iroc/dashboard"
      : `/api/iroc/dashboard?year=${selectedYear}`;

  const { data: dash, isLoading } = useQuery<DashData>({
    queryKey,
    enabled: !!token,
    queryFn: async ({ signal }) => {
      const res = await adminRequest(url, token!, {
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<DashData>;
    },
    refetchInterval: 30_000,
  });

  // ── Invoice list (for inline status table) ─────────────────────────────────
  const { data: allInvoices } = useListIrocInvoices();

  const invoicesForStatus = (status: InvoiceStatus) =>
    (allInvoices ?? [])
      .filter(inv => inv.status === status)
      .filter(inv => selectedYear === "all" || inv.issueDate.startsWith(selectedYear))
      .sort((a, b) => b.invoiceNumber.localeCompare(a.invoiceNumber));

  const handleStatusClick = (status: InvoiceStatus) => {
    setSelectedStatus(prev => (prev === status ? null : status));
  };

  // ── Pending inventory lots fetch (not year-aware — always current) ────────
  useEffect(() => {
    if (!token) return;
    let active = true;
    setPendingLotsLoading(true);
    adminRequest("/api/admin/inventory-lots/pending", token)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((rows: PendingLot[]) => { if (active) setPendingLots(rows); })
      .catch(() => { /* silent — widget just shows 0 */ })
      .finally(() => { if (active) setPendingLotsLoading(false); });
    return () => { active = false; };
  }, [token]);

  const markAsReceived = async (lotId: number) => {
    setReceiving(prev => new Set(prev).add(lotId));
    try {
      const res = await adminRequest(`/api/admin/inventory-lots/${lotId}/receive`, token ?? '', {
        method: "PATCH",
      });
      if (res.ok) {
        setPendingLots(prev => prev.filter(l => l.lot_id !== lotId));
      }
    } finally {
      setReceiving(prev => { const s = new Set(prev); s.delete(lotId); return s; });
    }
  };

  // ── Expense fetch (period-aware) ───────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    // Reset immediately so stale values from the previous period don't linger
    // while the new fetch is in flight.
    setExpLoading(true);
    setExpError(false);
    setExpenses([]);
    setExpTotal(0);
    setExpCount(0);

    // `active` guards every promise continuation so that if the year changes
    // while a fetch is in flight, none of the old request's callbacks
    // (success, error, or finally) can write into the component's state
    // after the new effect run has already started.
    let active = true;
    const controller = new AbortController();
    const range = yearRange(selectedYear);
    const expUrl = range
      ? `/api/admin/expenses?from=${range.from}&to=${range.to}`
      : "/api/admin/expenses";

    adminRequest(expUrl, token, {
      signal: controller.signal,
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((rows: Expense[]) => {
        if (!active) return;
        setExpenses(rows.slice(0, 5)); // keep last 5 for recent list
        const total = rows.reduce((s, e) => s + (parseFloat(e.gross_amount ?? "0") || 0), 0);
        setExpTotal(total);
        setExpCount(rows.length);
      })
      .catch(err => {
        if (!active) return; // cleaned up — discard entirely
        if (err instanceof Error && err.name === "AbortError") return;
        setExpError(true);
      })
      .finally(() => {
        if (!active) return; // don't flip loading off for the new in-flight request
        setExpLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, selectedYear]);

  const pendingQuotes  = dash?.pendingQuotes ?? null;
  const availableYears = dash?.availableYears ?? [];
  const hasPendingTrainings = (dash?.pendingTrainings ?? 0) > 0;

  // ── Derived financial figures ──────────────────────────────────────────────
  const revenue     = parseFloat(dash?.revenueTotal ?? "0") || 0;
  const outstanding = parseFloat(dash?.revenueSent  ?? "0") || 0;
  const netPnl      = revenue - expTotal;

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">{t("dashboard", lang)}</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[120px] rounded-xl" />)}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-[120px] rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!dash) return null;

  const yearLabel = selectedYear === "all" ? t("all_years", lang) : selectedYear;
  const periodLabel = selectedYear === "all"
    ? (de ? "Alle Jahre" : "All time")
    : yearLabel;

  return (
    <div className="space-y-8">

      {/* ── Header + year selector ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-3xl font-bold tracking-tight">{t("dashboard", lang)}</h1>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedYear} onValueChange={v => { setSelectedYear(v); setSelectedStatus(null); }}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("all_years", lang)}</SelectItem>
              {availableYears.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Financial overview ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          {de ? "Finanzen" : "Financials"}
          <span className="ml-2 font-normal normal-case tracking-normal">— {periodLabel}</span>
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title={de ? "Umsatz (bezahlt)" : "Revenue (paid)"}
            value={formatMoney(revenue)}
            icon={TrendingUp}
            description={de ? "Bezahlte Rechnungen" : "Paid invoices"}
            accent="emerald"
            href="/reports#report-sales"
          />
          <MetricCard
            title={de ? "Ausstehend" : "Outstanding"}
            value={formatMoney(outstanding)}
            icon={Hourglass}
            description={de ? "Versendete Rechnungen" : "Sent, awaiting payment"}
            accent="amber"
          />
          <MetricCard
            title={de ? "Ausgaben" : "Expenses"}
            value={expLoading ? "…" : expError ? "—" : formatMoney(expTotal)}
            icon={TrendingDown}
            description={
              expError
                ? (de ? "Fehler beim Laden der Ausgaben" : "Could not load expenses")
                : (de ? `${expCount} Eingangsrechnungen` : `${expCount} purchase invoice${expCount !== 1 ? "s" : ""}`)
            }
            alert={expError}
            accent="rose"
            href="/expenses"
          />
          <MetricCard
            title={de ? "Nettoergebnis" : "Net P&L"}
            value={expLoading ? "…" : expError ? "—" : formatMoney(netPnl)}
            icon={Scale}
            description={de ? "Umsatz minus Ausgaben" : "Revenue minus expenses"}
            accent={expError ? undefined : netPnl >= 0 ? "emerald" : "rose"}
            href="/reports#report-expenses"
          />
        </div>
      </section>

      {/* ── Operations ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          {de ? "Überblick" : "Overview"}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title={t("customers", lang)}
            value={dash.totalCustomers}
            icon={Users}
            href="/customers"
          />
          <MetricCard
            title={t("products", lang)}
            value={dash.totalProducts}
            icon={Package}
            alert={dash.lowStockCount > 0}
            description={dash.lowStockCount > 0 ? `${dash.lowStockCount} ${t("low_stock", lang).toLowerCase()}` : undefined}
            href="/products"
          />
          <MetricCard
            title={t("invoices", lang)}
            value={dash.totalInvoices}
            icon={FileText}
            description={selectedYear !== "all" ? yearLabel : undefined}
            href="/invoices"
          />
          {/* Pending Deliveries — clickable, toggles inline panel */}
          <div
            className="cursor-pointer"
            onClick={() => setShowPendingLots(v => !v)}
          >
            <MetricCard
              title={de ? "Ausstehende Lieferungen" : "Pending Deliveries"}
              value={pendingLotsLoading ? "…" : pendingLots.length}
              icon={Warehouse}
              accent={pendingLots.length > 0 ? "amber" : undefined}
              description={
                pendingLots.length > 0
                  ? (de ? "Klicken zum Verbuchen" : "Click to mark as received")
                  : (de ? "Alle Lieferungen eingegangen" : "All deliveries received")
              }
            />
          </div>
        </div>

        {/* Inline pending-deliveries panel */}
        {showPendingLots && (
          <div className="mt-4">
            <PendingDeliveriesPanel
              lots={pendingLots}
              lang={lang}
              onReceive={markAsReceived}
              onClose={() => setShowPendingLots(false)}
              receiving={receiving}
            />
          </div>
        )}
      </section>

      {/* ── Incoming order shortcut ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          {de ? "Website-Bestellungen" : "Website Orders"}
        </h2>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-blue-500" />
              {de ? "Eingehende Bestellungen" : "Incoming Orders"}
            </CardTitle>
            <Link href="/iroc-website/orders?status=all">
              <span className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                {de ? "Alle →" : "View all →"}
              </span>
            </Link>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-3 sm:grid-cols-2">
              <Link href="/iroc-website/orders?status=pending">
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 transition-shadow hover:shadow-md dark:border-amber-900 dark:bg-amber-950/20">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      {de ? "Ausstehend" : "Pending"}
                    </p>
                    <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-amber-800 dark:text-amber-300">
                    {dash.incomingOrders?.pending ?? 0}
                  </p>
                  <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-400/80">
                    {de ? "Warten auf Kundenbestätigung" : "Awaiting customer confirmation"}
                  </p>
                </div>
              </Link>
              <Link href="/iroc-website/orders?status=approved">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 transition-shadow hover:shadow-md dark:border-emerald-900 dark:bg-emerald-950/20">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                      {de ? "Bestätigt" : "Confirmed"}
                    </p>
                    <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-emerald-800 dark:text-emerald-300">
                    {dash.incomingOrders?.approved ?? 0}
                  </p>
                  <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-400/80">
                    {de ? "Bereit zur Bearbeitung" : "Ready for processing"}
                  </p>
                </div>
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── Alerts ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {pendingQuotes !== null && pendingQuotes > 0 && (
          <Link href="/spirecut-quotes">
            <Card className="cursor-pointer border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900 hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  {t("pending_quotes", lang)}
                </CardTitle>
                <MessageSquareQuote className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{pendingQuotes}</div>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">{t("pending_quotes_desc", lang)}</p>
              </CardContent>
            </Card>
          </Link>
        )}
        <Link href="/iroc-website/registrations">
          <Card className={`cursor-pointer hover:shadow-md transition-shadow ${
            hasPendingTrainings
              ? "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900"
              : "border-border bg-muted/30"
          }`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className={`text-sm font-medium ${
                hasPendingTrainings ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
              }`}>
                {de ? "Ausstehende Schulungen" : "Pending Trainings"}
              </CardTitle>
              <GraduationCap className={`h-4 w-4 ${
                hasPendingTrainings ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
              }`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${
                hasPendingTrainings ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
              }`}>
                {dash.pendingTrainings}
              </div>
              <p className={`text-xs mt-1 ${
                hasPendingTrainings ? "text-emerald-600 dark:text-emerald-500" : "text-muted-foreground"
              }`}>
                {de ? "Nicht zertifizierte Registrierungen" : "Non-certified registrations"}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* ── Invoice status — clickable blocks ──────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          {de ? "Rechnungsstatus" : "Invoice Status"}
          {selectedYear !== "all" && (
            <span className="ml-2 font-normal normal-case tracking-normal">— {yearLabel}</span>
          )}
          <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground/60">
            {de ? "(anklicken zum Filtern)" : "(click to filter)"}
          </span>
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Draft */}
          <Card
            className={`cursor-pointer transition-all hover:shadow-md bg-muted/30 ${selectedStatus === "draft" ? "ring-2 ring-primary" : ""}`}
            onClick={() => handleStatusClick("draft")}
          >
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="p-3 bg-muted rounded-full">
                <Clock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("draft", lang)}</p>
                <p className="text-2xl font-bold">{dash.invoicesByStatus.draft}</p>
              </div>
            </CardContent>
          </Card>

          {/* Sent */}
          <Card
            className={`cursor-pointer transition-all hover:shadow-md bg-blue-50/50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900 ${selectedStatus === "sent" ? "ring-2 ring-blue-500" : ""}`}
            onClick={() => handleStatusClick("sent")}
          >
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
                <AlertTriangle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">{t("sent", lang)}</p>
                <p className="text-2xl font-bold">{dash.invoicesByStatus.sent}</p>
                {Number(dash.revenueSent) > 0 && (
                  <p className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">{formatMoney(dash.revenueSent)}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Paid */}
          <Card
            className={`cursor-pointer transition-all hover:shadow-md bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900 ${selectedStatus === "paid" ? "ring-2 ring-emerald-500" : ""}`}
            onClick={() => handleStatusClick("paid")}
          >
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="p-3 bg-emerald-100 dark:bg-emerald-900 rounded-full">
                <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{t("paid", lang)}</p>
                <p className="text-2xl font-bold">{dash.invoicesByStatus.paid}</p>
                {Number(dash.revenueTotal) > 0 && (
                  <p className="text-xs text-emerald-500 dark:text-emerald-400 mt-0.5">{formatMoney(dash.revenueTotal)}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Cancelled */}
          <Card
            className={`cursor-pointer transition-all hover:shadow-md bg-rose-50/50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900 ${selectedStatus === "cancelled" ? "ring-2 ring-rose-500" : ""}`}
            onClick={() => handleStatusClick("cancelled")}
          >
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="p-3 bg-rose-100 dark:bg-rose-900 rounded-full">
                <Ban className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{t("cancelled", lang)}</p>
                <p className="text-2xl font-bold">{dash.invoicesByStatus.cancelled}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Inline invoice table — shown when a status is selected */}
        {selectedStatus && (
          <div className="mt-4">
            <InlineInvoiceTable
              status={selectedStatus}
              invoices={invoicesForStatus(selectedStatus)}
              lang={lang}
              onClose={() => setSelectedStatus(null)}
            />
          </div>
        )}
      </section>

      {/* ── Recent activity (3-col) ────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          {de ? "Letzte Aktivitäten" : "Recent Activity"}
        </h2>
        <div className="grid gap-6 lg:grid-cols-3">

          {/* New Orders */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-blue-500" />
                {de ? "Neue Bestellungen" : "New Orders"}
              </CardTitle>
              <Link href="/invoices?status=pending">
                <span className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  {de ? "Alle →" : "View all →"}
                </span>
              </Link>
            </CardHeader>
            <CardContent className="pt-0">
              {!dash.recentOrders || dash.recentOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {de ? "Noch keine Bestellungen" : "No orders yet"}
                </p>
              ) : (
                <div className="divide-y">
                  {dash.recentOrders.map(order => {
                    const categoryTotals = Array.isArray(order.categoryTotals)
                      ? order.categoryTotals
                      : [];
                    return (
                      <Link
                        key={order.id}
                        href={`/invoices?status=pending&websiteCustomerId=${order.id}`}
                        className="block py-2.5 first:pt-0 last:pb-0 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{order.name}</p>
                            {order.institutionName && (
                              <p className="text-xs text-muted-foreground truncate">{order.institutionName}</p>
                            )}
                            <p className="text-xs text-muted-foreground truncate">{order.email}</p>
                            {categoryTotals.length > 0 && (
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                                {categoryTotals.map(ct => (
                                  <span key={ct.category} className="text-xs font-medium text-foreground">
                                    <span className="text-muted-foreground capitalize mr-1">
                                      {groupLabel(ct.category)}:
                                    </span>
                                    {formatMoney(ct.total)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="shrink-0 text-right flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-xs capitalize">{order.instrument}</Badge>
                              <Badge className="text-xs bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300 border-0">
                                {order.openOrderCount} {de ? "offen" : "open"}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</p>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Expenses */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Receipt className="h-4 w-4 text-rose-500" />
                {de ? "Letzte Ausgaben" : "Recent Expenses"}
              </CardTitle>
              <Link href="/expenses">
                <span className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                  {de ? "Alle →" : "View all →"}
                </span>
              </Link>
            </CardHeader>
            <CardContent className="pt-0">
              {expLoading ? (
                <div className="space-y-2 py-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : expError ? (
                <p className="text-sm text-destructive py-4 text-center">
                  {de ? "Fehler beim Laden der Ausgaben" : "Could not load expenses"}
                </p>
              ) : expenses.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {de ? "Keine Ausgaben im Zeitraum" : "No expenses in period"}
                </p>
              ) : (
                <div className="divide-y">
                  {expenses.map(e => (
                    <div key={e.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{e.vendor_name ?? (de ? "Unbekannt" : "Unknown")}</p>
                        <p className="text-xs text-muted-foreground">{e.category ?? "—"}{e.invoice_date ? ` · ${formatDate(e.invoice_date)}` : ""}</p>
                      </div>
                      <p className="text-sm font-semibold text-rose-600 dark:text-rose-400 shrink-0 tabular-nums">
                        {formatMoney(parseFloat(e.gross_amount ?? "0") || 0)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {expCount > 5 && (
                <p className="text-xs text-muted-foreground text-center pt-3 border-t mt-2">
                  {de ? `+${expCount - 5} weitere` : `+${expCount - 5} more`}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Training */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-emerald-500" />
                {de ? "Bevorstehende Schulungen" : "Upcoming Training"}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {!dash.recentTrainings || dash.recentTrainings.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {de ? "Keine bevorstehenden Schulungen" : "No upcoming trainings"}
                </p>
              ) : (
                <div className="divide-y">
                  {dash.recentTrainings.map(reg => (
                    <div key={reg.id} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{reg.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{reg.email}</p>
                          {reg.trainingDateInfo && (
                            <p className="text-xs text-muted-foreground truncate">{reg.trainingDateInfo}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <Badge variant="outline" className="text-xs capitalize">{reg.instrument}</Badge>
                          <p className="text-xs text-muted-foreground mt-1">{formatDate(reg.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </section>

    </div>
  );
}
