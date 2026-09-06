import React, { useState, useMemo } from "react";
import { useProductGroupHelpers } from "@/lib/product-groups";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { formatMoney } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { IROC_SALES_SUMMARY_QUERY_KEY } from "@/lib/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Users, Package, TrendingUp, CalendarDays, ChevronDown, ChevronRight } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type SalesItem = {
  itemId: number;
  invoiceId: number;
  productName: string;
  sku: string | null;
  quantity: number;
  lineTotal: string;
  isDemo: boolean;
  issueDate: string;       // YYYY-MM-DD
  status: "draft" | "sent" | "paid";
  invoiceTotal: string;
  customerName: string;
  category: string;
};

type ProductLine = string; // "all" or a product-group key

type Tab = "product-customer" | "product-quarter" | "paid-customer" | "revenue-quarter";

// ── Category helpers ──────────────────────────────────────────────────────────

const LINE_ACTIVE_BG: Record<string, string> = {
  spirecut: "bg-blue-600 text-white",
  ministem: "bg-emerald-600 text-white",
  cellenis: "bg-amber-500 text-white",
  other: "bg-amber-500 text-white",
  services: "bg-violet-600 text-white",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toQuarter(dateStr: string): string {
  const d = new Date(dateStr);
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${q} ${d.getFullYear()}`;
}

function sortQuarters(quarters: string[]): string[] {
  return [...quarters].sort((a, b) => {
    const [qa, ya] = a.split(" ");
    const [qb, yb] = b.split(" ");
    const yearDiff = parseInt(ya) - parseInt(yb);
    if (yearDiff !== 0) return yearDiff;
    return parseInt(qa.slice(1)) - parseInt(qb.slice(1));
  });
}

// ── Sub-view: Product / Customer ──────────────────────────────────────────────
// Grouped table: product headers, customer rows below each.

function ProductCustomerView({
  items, lang,
}: { items: SalesItem[]; lang: string }) {
  const { label: catLabel, order: catOrder } = useProductGroupHelpers(lang);
  const nonDemo = items.filter(i => !i.isDemo);
  // Start with all groups collapsed (empty set = nothing expanded)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (cat: string) => setExpandedGroups(prev => {
    const next = new Set(prev);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    return next;
  });

  // Group: { productName → { customerName → { qty, revenue } } }
  const { byProduct, productCategory } = useMemo(() => {
    const map: Record<string, Record<string, { qty: number; revenue: number }>> = {};
    const catMap: Record<string, string> = {};
    for (const item of nonDemo) {
      (map[item.productName] ??= {})[item.customerName] ??= { qty: 0, revenue: 0 };
      map[item.productName][item.customerName].qty += item.quantity;
      map[item.productName][item.customerName].revenue += parseFloat(item.lineTotal);
      catMap[item.productName] = item.category;
    }
    return { byProduct: map, productCategory: catMap };
  }, [nonDemo]);

  const products = Object.keys(byProduct).sort((a, b) => {
    const oa = catOrder(productCategory[a]);
    const ob = catOrder(productCategory[b]);
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  if (products.length === 0) {
    return <EmptyState lang={lang} />;
  }

  return (
    <div className="border rounded-md bg-card sticky-header-table overflow-y-auto max-h-[60vh]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[220px] sticky top-0 bg-card z-10">
              {lang === "de" ? "Produkt / Kunde" : "Product / Customer"}
            </TableHead>
            <TableHead className="text-right sticky top-0 bg-card z-10">{lang === "de" ? "Menge" : "Qty"}</TableHead>
            <TableHead className="text-right sticky top-0 bg-card z-10">{lang === "de" ? "Umsatz (netto)" : "Revenue (net)"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(() => {
            let lastCat: string | null = null;
            return products.flatMap(product => {
              const cat = productCategory[product] ?? "other";
              const isExpanded = expandedGroups.has(cat);
              const rows: React.ReactNode[] = [];
              if (cat !== lastCat) {
                lastCat = cat;
                rows.push(
                  <TableRow
                    key={`grp-${cat}`}
                    className="bg-muted/20 hover:bg-muted/30 border-t cursor-pointer select-none"
                    onClick={() => toggleGroup(cat)}
                  >
                    <TableCell colSpan={3} className="py-1.5 px-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70">
                      <span className="flex items-center gap-1.5">
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />}
                        {catLabel(cat)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              }
              if (!isExpanded) return rows;
              const customerRows = Object.entries(byProduct[product])
                .sort(([, a], [, b]) => b.revenue - a.revenue);
              const productQty     = customerRows.reduce((s, [, v]) => s + v.qty, 0);
              const productRevenue = customerRows.reduce((s, [, v]) => s + v.revenue, 0);
              rows.push(
                // Product header row
                <TableRow key={`hdr-${product}`} className="bg-muted/40 hover:bg-muted/40">
                  <TableCell className="font-semibold text-sm py-2" colSpan={1}>
                    {product}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-sm py-2">
                    {productQty}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-sm py-2">
                    {formatMoney(productRevenue)}
                  </TableCell>
                </TableRow>,
                // Customer detail rows
                ...customerRows.map(([customer, { qty, revenue }]) => (
                  <TableRow key={`${product}-${customer}`}>
                    <TableCell className="pl-8 text-sm text-muted-foreground">{customer}</TableCell>
                    <TableCell className="text-right text-sm">{qty}</TableCell>
                    <TableCell className="text-right text-sm">{formatMoney(revenue)}</TableCell>
                  </TableRow>
                ))
              );
              return rows;
            });
          })()}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-bold">{lang === "de" ? "Gesamt" : "Total"}</TableCell>
            <TableCell className="text-right font-bold">
              {nonDemo.reduce((s, i) => s + i.quantity, 0)}
            </TableCell>
            <TableCell className="text-right font-bold">
              {formatMoney(nonDemo.reduce((s, i) => s + parseFloat(i.lineTotal), 0))}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

// ── Sub-view: Product / Quarter ───────────────────────────────────────────────
// True cross-table: products as rows, quarters as columns.

function ProductQuarterView({
  items, lang,
}: { items: SalesItem[]; lang: string }) {
  const { label: catLabel, order: catOrder } = useProductGroupHelpers(lang);
  const nonDemo = items.filter(i => !i.isDemo);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (cat: string) => setExpandedGroups(prev => {
    const next = new Set(prev);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    return next;
  });

  const { products, quarters, map, productCategory } = useMemo(() => {
    const m: Record<string, Record<string, { qty: number; revenue: number }>> = {};
    const catMap: Record<string, string> = {};
    for (const item of nonDemo) {
      const q = toQuarter(item.issueDate);
      (m[item.productName] ??= {})[q] ??= { qty: 0, revenue: 0 };
      m[item.productName][q].qty += item.quantity;
      m[item.productName][q].revenue += parseFloat(item.lineTotal);
      catMap[item.productName] = item.category;
    }
    const sortedProducts = Object.keys(m).sort((a, b) => {
      const oa = catOrder(catMap[a]);
      const ob = catOrder(catMap[b]);
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });
    return {
      products: sortedProducts,
      quarters: sortQuarters([...new Set(nonDemo.map(i => toQuarter(i.issueDate)))]),
      map: m,
      productCategory: catMap,
    };
  }, [nonDemo, catOrder]);

  if (products.length === 0) {
    return <EmptyState lang={lang} />;
  }

  return (
    <div className="border rounded-md bg-card sticky-header-table overflow-y-auto max-h-[60vh]">
      <Table>
        <TableHeader className="sticky top-0 z-30 bg-card">
          <TableRow>
            <TableHead className="min-w-[180px] sticky left-0 bg-card z-30">
              {lang === "de" ? "Produkt" : "Product"}
            </TableHead>
            {quarters.map(q => (
              <TableHead key={q} className="text-center min-w-[110px]">{q}</TableHead>
            ))}
            <TableHead className="text-right min-w-[100px]">
              {lang === "de" ? "Gesamt" : "Total"}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(() => {
            let lastCat: string | null = null;
            return products.flatMap(product => {
              const cat = productCategory[product] ?? "other";
              const isExpanded = expandedGroups.has(cat);
              const rows: React.ReactNode[] = [];
              if (cat !== lastCat) {
                lastCat = cat;
                rows.push(
                  <TableRow
                    key={`grp-${cat}`}
                    className="bg-muted/20 hover:bg-muted/30 border-t cursor-pointer select-none"
                    onClick={() => toggleGroup(cat)}
                  >
                    <TableCell
                      colSpan={quarters.length + 2}
                      className="py-1.5 px-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70 sticky left-0"
                    >
                      <span className="flex items-center gap-1.5">
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />}
                        {catLabel(cat)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              }
              if (!isExpanded) return rows;
              const rowTotal   = quarters.reduce((s, q) => s + (map[product]?.[q]?.qty ?? 0), 0);
              const rowRevenue = quarters.reduce((s, q) => s + (map[product]?.[q]?.revenue ?? 0), 0);
              rows.push(
                <TableRow key={product}>
                  <TableCell className="font-medium text-sm sticky left-0 bg-card z-10">
                    {product}
                  </TableCell>
                  {quarters.map(q => {
                    const cell = map[product]?.[q];
                    return (
                      <TableCell key={q} className="text-center text-sm">
                        {cell ? (
                          <div>
                            <div className="font-medium">{cell.qty}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {formatMoney(cell.revenue)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right text-sm font-semibold">
                    <div>{rowTotal}</div>
                    <div className="text-[11px] font-normal text-muted-foreground">
                      {formatMoney(rowRevenue)}
                    </div>
                  </TableCell>
                </TableRow>
              );
              return rows;
            });
          })()}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-bold sticky left-0 bg-muted z-10">
              {lang === "de" ? "Gesamt" : "Total"}
            </TableCell>
            {quarters.map(q => {
              const qTotal = products.reduce((s, p) => s + (map[p]?.[q]?.qty ?? 0), 0);
              const qRev   = products.reduce((s, p) => s + (map[p]?.[q]?.revenue ?? 0), 0);
              return (
                <TableCell key={q} className="text-center font-bold text-sm">
                  <div>{qTotal}</div>
                  <div className="text-[11px] font-normal">{formatMoney(qRev)}</div>
                </TableCell>
              );
            })}
            <TableCell className="text-right font-bold text-sm">
              <div>{nonDemo.reduce((s, i) => s + i.quantity, 0)}</div>
              <div className="text-[11px] font-normal">
                {formatMoney(nonDemo.reduce((s, i) => s + parseFloat(i.lineTotal), 0))}
              </div>
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

// ── Sub-view: Paid Amount / Customer ─────────────────────────────────────────

function PaidCustomerView({
  items, lang,
}: { items: SalesItem[]; lang: string }) {
  // Deduplicate invoices to avoid summing line-item totals multiple times
  const rows = useMemo(() => {
    const seen = new Set<number>();
    const map: Record<string, { total: number; count: number }> = {};
    for (const item of items) {
      if (item.status !== "paid" || seen.has(item.invoiceId)) continue;
      seen.add(item.invoiceId);
      (map[item.customerName] ??= { total: 0, count: 0 });
      map[item.customerName].total += parseFloat(item.invoiceTotal);
      map[item.customerName].count += 1;
    }
    return Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [items]);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  if (rows.length === 0) return <EmptyState lang={lang} />;

  return (
    <div className="border rounded-md bg-card sticky-header-table overflow-y-auto max-h-[60vh]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{lang === "de" ? "Kunde" : "Customer"}</TableHead>
            <TableHead className="text-right">{lang === "de" ? "Rechnungen" : "Invoices"}</TableHead>
            <TableHead className="text-right">
              {lang === "de" ? "Bezahlter Betrag" : "Amount Paid"}
            </TableHead>
            <TableHead className="text-right w-[160px]">
              {lang === "de" ? "Anteil" : "Share"}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => {
            const pct = grandTotal > 0 ? (row.total / grandTotal) * 100 : 0;
            return (
              <TableRow key={row.name}>
                <TableCell className="font-medium text-sm">{row.name}</TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">{row.count}</TableCell>
                <TableCell className="text-right font-medium text-sm">
                  {formatMoney(row.total)}
                </TableCell>
                <TableCell className="text-right text-sm">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground w-10 text-right">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-bold">{lang === "de" ? "Gesamt" : "Total"}</TableCell>
            <TableCell className="text-right font-bold">
              {rows.reduce((s, r) => s + r.count, 0)}
            </TableCell>
            <TableCell className="text-right font-bold">{formatMoney(grandTotal)}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

// ── Sub-view: Revenue / Quarter ───────────────────────────────────────────────

function RevenueQuarterView({
  items, lang,
}: { items: SalesItem[]; lang: string }) {
  const { rows, grandTotal } = useMemo(() => {
    const seen = new Set<number>();
    const map: Record<string, { total: number; count: number }> = {};
    for (const item of items) {
      if (item.status !== "paid" || seen.has(item.invoiceId)) continue;
      seen.add(item.invoiceId);
      const q = toQuarter(item.issueDate);
      (map[q] ??= { total: 0, count: 0 });
      map[q].total += parseFloat(item.invoiceTotal);
      map[q].count += 1;
    }
    const sorted = sortQuarters(Object.keys(map)).map(q => ({ quarter: q, ...map[q] }));
    return { rows: sorted, grandTotal: sorted.reduce((s, r) => s + r.total, 0) };
  }, [items]);

  const maxTotal = rows.length > 0 ? Math.max(...rows.map(r => r.total)) : 1;

  if (rows.length === 0) return <EmptyState lang={lang} />;

  return (
    <div className="border rounded-md bg-card sticky-header-table overflow-y-auto max-h-[60vh]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{lang === "de" ? "Quartal" : "Quarter"}</TableHead>
            <TableHead className="text-right">{lang === "de" ? "Rechnungen" : "Invoices"}</TableHead>
            <TableHead className="text-right">{lang === "de" ? "Umsatz" : "Revenue"}</TableHead>
            <TableHead className="w-[200px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => {
            const pct = maxTotal > 0 ? (row.total / maxTotal) * 100 : 0;
            return (
              <TableRow key={row.quarter}>
                <TableCell className="font-medium text-sm">{row.quarter}</TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">{row.count}</TableCell>
                <TableCell className="text-right font-medium text-sm">
                  {formatMoney(row.total)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-10 text-right">
                      {grandTotal > 0 ? ((row.total / grandTotal) * 100).toFixed(1) : "0.0"}%
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-bold">{lang === "de" ? "Gesamt" : "Total"}</TableCell>
            <TableCell className="text-right font-bold">
              {rows.reduce((s, r) => s + r.count, 0)}
            </TableCell>
            <TableCell className="text-right font-bold">{formatMoney(grandTotal)}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ lang }: { lang: string }) {
  return (
    <div className="border rounded-md bg-card flex items-center justify-center h-48 text-muted-foreground text-sm">
      {lang === "de" ? "Keine Daten für den gewählten Zeitraum" : "No data for the selected period"}
    </div>
  );
}

// ── Summary stat cards ────────────────────────────────────────────────────────

function StatCard({
  title, value, sub, icon: Icon,
}: { title: string; value: string | number; sub?: string; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold whitespace-nowrap overflow-hidden text-ellipsis">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SalesSummary() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const [tab, setTab]         = useState<Tab>("product-customer");
  const [year, setYear]       = useState<string>("all");
  const [line, setLine]       = useState<ProductLine>("all");
  const { groups, label: groupLabel } = useProductGroupHelpers(lang);
  const lineOptions: ProductLine[] = [
    "all",
    ...(groups.length > 0
      ? [...groups].sort((a, b) => a.sortOrder - b.sortOrder).map(g => g.key)
      : ["spirecut", "ministem", "cellenis", "services"]),
  ];

  const { data: items = [], isLoading } = useQuery<SalesItem[]>({
    queryKey: IROC_SALES_SUMMARY_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/iroc/sales-summary", {
        signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!token,
  });

  // Available years from data
  const years = useMemo(() => {
    const ys = new Set(items.map(i => i.issueDate.slice(0, 4)));
    return [...ys].sort().reverse();
  }, [items]);

  // Year + product-line filtered items
  const filtered = useMemo(
    () => items
      .filter(i => year === "all" || i.issueDate.startsWith(year))
      .filter(i => line === "all" || i.category === line),
    [items, year, line],
  );

  // Top-level KPIs (paid invoices, deduplicated)
  const kpis = useMemo(() => {
    const seen = new Set<number>();
    let paidRevenue = 0;
    let paidCount   = 0;
    const customerSet = new Set<string>();
    const productSet  = new Set<string>();
    for (const item of filtered) {
      productSet.add(item.productName);
      if (item.status === "paid") {
        customerSet.add(item.customerName);
        if (!seen.has(item.invoiceId)) {
          seen.add(item.invoiceId);
          paidRevenue += parseFloat(item.invoiceTotal);
          paidCount   += 1;
        }
      }
    }
    return { paidRevenue, paidCount, customerCount: customerSet.size, productCount: productSet.size };
  }, [filtered]);

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "product-customer", label: lang === "de" ? "Produkt / Kunde"    : "Product / Customer",  icon: Package  },
    { id: "product-quarter",  label: lang === "de" ? "Produkt / Quartal"  : "Product / Quarter",   icon: CalendarDays },
    { id: "paid-customer",    label: lang === "de" ? "Betrag / Kunde"     : "Paid / Customer",     icon: Users    },
    { id: "revenue-quarter",  label: lang === "de" ? "Umsatz / Quartal"   : "Revenue / Quarter",   icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">

      {/* Header + year filter */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {lang === "de" ? "Verkaufsübersicht" : "Sales Summary"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {lang === "de"
                ? "Umsatz nach Produkt, Kunde und Quartal"
                : "Revenue by product, customer and quarter"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Product line filter */}
          {lineOptions.map(pl => (
            <button
              key={pl}
              onClick={() => setLine(pl)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                line === pl
                  ? LINE_ACTIVE_BG[pl] ?? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {pl === "all" ? (lang === "de" ? "Alle" : "All") : groupLabel(pl)}
            </button>
          ))}
          <CalendarDays className="h-4 w-4 text-muted-foreground ml-2" />
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-32 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{lang === "de" ? "Alle Jahre" : "All Years"}</SelectItem>
              {years.map(y => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title={lang === "de" ? "Bezahlter Umsatz" : "Paid Revenue"}
            value={formatMoney(kpis.paidRevenue)}
            icon={TrendingUp}
          />
          <StatCard
            title={lang === "de" ? "Bezahlte Rechnungen" : "Paid Invoices"}
            value={kpis.paidCount}
            icon={BarChart3}
          />
          <StatCard
            title={lang === "de" ? "Kunden" : "Customers"}
            value={kpis.customerCount}
            sub={lang === "de" ? "mit bezahlten Rechnungen" : "with paid invoices"}
            icon={Users}
          />
          <StatCard
            title={lang === "de" ? "Produkte" : "Products"}
            value={kpis.productCount}
            sub={lang === "de" ? "im Zeitraum verkauft" : "sold in period"}
            icon={Package}
          />
        </div>
      )}

      {/* Tab buttons */}
      <div className="flex flex-wrap gap-2">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : (
        <>
          {tab === "product-customer" && <ProductCustomerView items={filtered} lang={lang} />}
          {tab === "product-quarter"  && <ProductQuarterView  items={filtered} lang={lang} />}
          {tab === "paid-customer"    && <PaidCustomerView    items={filtered} lang={lang} />}
          {tab === "revenue-quarter"  && <RevenueQuarterView  items={filtered} lang={lang} />}
        </>
      )}
    </div>
  );
}
