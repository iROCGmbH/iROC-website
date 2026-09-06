import React, { useState, useMemo, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { formatMoney } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { adminGet } from "@/lib/admin-fetch";
import { useListIrocProducts } from "@workspace/api-client-react";
import { useProductGroupHelpers } from "@/lib/product-groups";
import { IROC_SALES_SUMMARY_QUERY_KEY, LEADS_QUERY_KEY } from "@/lib/query-keys";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  BarChart3, TrendingUp, TrendingDown, Package, Boxes, AlertTriangle,
  Users, UserSearch, ChevronDown, ChevronRight, Printer, ShoppingCart,
  Activity, Warehouse, FileText, DollarSign, Receipt,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PeriodType = "monthly" | "quarterly" | "halfyearly" | "yearly";

type SalesItem = {
  itemId: number;
  invoiceId: number;
  productName: string;
  sku: string | null;
  quantity: number;
  lineTotal: string;
  isDemo: boolean;
  issueDate: string;
  status: "draft" | "sent" | "paid";
  invoiceTotal: string;
  customerName: string;
  category: string;
};

interface InventoryLot {
  id: number;
  productId: number;
  productSku: string | null;
  productNameEn: string | null;
  productNameDe: string | null;
  productCategory: string | null;
  productPurchasePrice: string | null;
  lotNumber: string;
  purchaseDate: string;
  expirationDate: string | null;
  description: string | null;
  quantityReceived: number;
  quantityUsed: number;
}

interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  salutation: string;
  medicalTitle: string | null;
  status: string;
  createdAt: string;
  email: string | null;
}

interface IrocProduct {
  id: number;
  sku: string;
  nameEn: string | null;
  nameDe: string | null;
  category: string | null;
  unitPrice: string | null;
  purchasePrice: string | null;
}

// ── Period helpers ────────────────────────────────────────────────────────────

const MONTH_ABR: Record<number, string> = {
  0: "Jan", 1: "Feb", 2: "Mar", 3: "Apr", 4: "May", 5: "Jun",
  6: "Jul", 7: "Aug", 8: "Sep", 9: "Oct", 10: "Nov", 11: "Dec",
};
const MONTH_ABR_DE: Record<number, string> = {
  0: "Jan", 1: "Feb", 2: "Mär", 3: "Apr", 4: "Mai", 5: "Jun",
  6: "Jul", 7: "Aug", 8: "Sep", 9: "Okt", 10: "Nov", 11: "Dez",
};

function calendarDateParts(dateStr: string): { year: number; month: number } | null {
  const match = dateStr.trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month };
}

export function dateToPeriodKey(dateStr: string, type: PeriodType): string {
  const parts = calendarDateParts(dateStr);
  if (!parts) return "";
  const { year, month } = parts;
  switch (type) {
    case "monthly":    return `${MONTH_ABR[month]} ${year}`;
    case "quarterly":  return `Q${Math.ceil((month + 1) / 3)} ${year}`;
    case "halfyearly": return `H${month < 6 ? 1 : 2} ${year}`;
    case "yearly":     return `${year}`;
  }
}

function periodKeyToLabel(key: string, type: PeriodType, lang: string): string {
  if (!key) return "";
  if (type === "monthly" && lang === "de") {
    const parts = key.split(" ");
    if (parts.length === 2) {
      const monIdx = Object.entries(MONTH_ABR).find(([, v]) => v === parts[0])?.[0];
      if (monIdx !== undefined) return `${MONTH_ABR_DE[parseInt(monIdx)]} ${parts[1]}`;
    }
  }
  return key;
}

export function prevPeriodKey(key: string, type: PeriodType): string {
  if (!key) return "";
  switch (type) {
    case "monthly": {
      const [mon, yr] = key.split(" ");
      const year = parseInt(yr);
      const m = parseInt(Object.entries(MONTH_ABR).find(([, v]) => v === mon)?.[0] ?? "0");
      if (m === 0) return `${MONTH_ABR[11]} ${year - 1}`;
      return `${MONTH_ABR[m - 1]} ${year}`;
    }
    case "quarterly": {
      const [q, yr] = key.split(" ");
      const qNum = parseInt(q.slice(1));
      const year = parseInt(yr);
      if (qNum === 1) return `Q4 ${year - 1}`;
      return `Q${qNum - 1} ${year}`;
    }
    case "halfyearly": {
      const [h, yr] = key.split(" ");
      const year = parseInt(yr);
      return h === "H1" ? `H2 ${year - 1}` : `H1 ${year}`;
    }
    case "yearly":
      return `${parseInt(key) - 1}`;
  }
}

function periodSortVal(key: string, type: PeriodType): number {
  switch (type) {
    case "monthly": {
      const [mon, yr] = key.split(" ");
      const m = parseInt(Object.entries(MONTH_ABR).find(([, v]) => v === mon)?.[0] ?? "0");
      return parseInt(yr) * 12 + m;
    }
    case "quarterly": {
      const [q, yr] = key.split(" ");
      return parseInt(yr) * 4 + parseInt(q.slice(1));
    }
    case "halfyearly": {
      const [h, yr] = key.split(" ");
      return parseInt(yr) * 2 + (h === "H2" ? 2 : 1);
    }
    case "yearly":
      return parseInt(key);
  }
}

export function sortPeriodKeys(keys: string[], type: PeriodType): string[] {
  return [...keys].sort((a, b) => periodSortVal(b, type) - periodSortVal(a, type));
}

export function filterItemsByPeriod<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  type: PeriodType,
  periodKey: string,
): T[] {
  if (!periodKey) return [];
  return items.filter(item => {
    const date = getDate(item);
    return !!date && dateToPeriodKey(date, type) === periodKey;
  });
}

// ── Expense type ──────────────────────────────────────────────────────────────

type Expense = {
  id: number;
  vendor_name: string | null;
  invoice_date: string | null;
  invoice_number: string | null;
  category: string | null;
  net_amount: string | null;
  tax_amount: string | null;
  gross_amount: string | null;
  currency: string;
};

// ── Category helpers ──────────────────────────────────────────────────────────

const useCatHelpers = useProductGroupHelpers;

// ── Shared small components ───────────────────────────────────────────────────

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (current === 0 && previous === 0) return null;
  if (previous === 0) {
    return (
      <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-400">
        New
      </Badge>
    );
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const up = pct >= 0;
  return (
    <Badge
      variant="outline"
      className={`text-[10px] flex items-center gap-0.5 w-fit ${
        up
          ? "text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-400"
          : "text-rose-600 border-rose-300 bg-rose-50 dark:bg-rose-950 dark:text-rose-400"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}{pct.toFixed(1)}%
    </Badge>
  );
}

function KpiCard({
  title, value, previousValue, showComparison, delta, icon: Icon, accent, lang,
}: {
  title: string;
  value: string | number;
  previousValue?: React.ReactNode;
  showComparison?: boolean;
  delta?: React.ReactNode;
  icon?: React.ElementType;
  accent?: string;
  lang?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground font-medium leading-tight">{title}</p>
            {showComparison && previousValue !== undefined ? (
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="min-w-0 border-r pr-2">
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "de" ? "Aktuell" : "Current"}
                  </p>
                  <p className={`text-lg font-bold truncate ${accent ?? ""}`}>{value}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "de" ? "Vorherig" : "Previous"}
                  </p>
                  <p className="text-lg font-bold truncate">{previousValue}</p>
                </div>
              </div>
            ) : (
              <p className={`text-xl font-bold mt-1 truncate ${accent ?? ""}`}>{value}</p>
            )}
          </div>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
        </div>
        {delta && <div className="mt-2">{delta}</div>}
      </CardContent>
    </Card>
  );
}

function ReportSection({
  id, title, icon: Icon, children,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => window.location.hash === `#${id}`);
  return (
    <div id={id} className="border rounded-lg bg-card">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/30 transition-colors rounded-lg print:pointer-events-none"
      >
        <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
        <span className="text-base font-semibold flex-1">{title}</span>
        <span className="print:hidden">
          {open
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </span>
      </button>
      {/* Always keep children in the DOM so print can reach them even when collapsed.
          The `report-section-body` class is targeted by print CSS to force display:block. */}
      <div className={`report-section-body px-5 pb-5 border-t${open ? "" : " hidden"}`}>
        {children}
      </div>
    </div>
  );
}

// ── Sales section ─────────────────────────────────────────────────────────────

// allPeriodItems includes demo items so we can identify mixed invoices.
// Gross revenue only counts invoices that contain NO demo lines (pure non-demo invoices).
function calcSalesMetrics(allPeriodItems: SalesItem[]) {
  const demoInvoiceIds = new Set(allPeriodItems.filter(i => i.isDemo).map(i => i.invoiceId));
  const nonDemo = allPeriodItems.filter(i => !i.isDemo);
  const paid = nonDemo.filter(i => i.status === "paid");
  const sent = nonDemo.filter(i => i.status === "sent");

  // Net revenue = sum of non-demo paid line totals
  const netRevenue = paid.reduce((s, i) => s + parseFloat(i.lineTotal), 0);

  // Gross revenue = invoiceTotal only for invoices that have zero demo lines
  const pureNonDemoPaidMap = new Map<number, number>();
  for (const item of paid) {
    if (!demoInvoiceIds.has(item.invoiceId) && !pureNonDemoPaidMap.has(item.invoiceId)) {
      pureNonDemoPaidMap.set(item.invoiceId, parseFloat(item.invoiceTotal));
    }
  }
  const grossRevenue = [...pureNonDemoPaidMap.values()].reduce((s, v) => s + v, 0);
  const paidCount = new Set(paid.map(i => i.invoiceId)).size;
  const sentCount = new Set(sent.map(i => i.invoiceId)).size;

  const catMap: Record<string, { revenue: number; qty: number }> = {};
  for (const item of paid) {
    (catMap[item.category] ??= { revenue: 0, qty: 0 });
    catMap[item.category].revenue += parseFloat(item.lineTotal);
    catMap[item.category].qty += item.quantity;
  }
  return { netRevenue, grossRevenue, paidCount, sentCount, catMap };
}

function SalesSection({ items, prevItems, lang, showComparison }: {
  items: SalesItem[];
  prevItems: SalesItem[];
  lang: string;
  showComparison: boolean;
}) {
  const curr = useMemo(() => calcSalesMetrics(items), [items]);
  const prev = useMemo(() => calcSalesMetrics(prevItems), [prevItems]);
  const cats = useCatHelpers(lang);
  const categories = Object.keys(curr.catMap).sort((a, b) => cats.order(a) - cats.order(b) || a.localeCompare(b));
  const comparisonCategories = [...new Set([...categories, ...Object.keys(prev.catMap)])]
    .sort((a, b) => cats.order(a) - cats.order(b) || a.localeCompare(b));
  const visibleCategories = showComparison ? comparisonCategories : categories;

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title={lang === "de" ? "Netto-Umsatz (bezahlt)" : "Net Revenue (paid)"}
          value={formatMoney(curr.netRevenue)}
          previousValue={formatMoney(prev.netRevenue)}
          showComparison={showComparison}
          icon={DollarSign}
          lang={lang}
          delta={<DeltaBadge current={curr.netRevenue} previous={prev.netRevenue} />}
        />
        <KpiCard
          title={lang === "de" ? "Brutto-Umsatz (bezahlt)" : "Gross Revenue (paid)"}
          value={formatMoney(curr.grossRevenue)}
          previousValue={formatMoney(prev.grossRevenue)}
          showComparison={showComparison}
          icon={ShoppingCart}
          lang={lang}
          delta={<DeltaBadge current={curr.grossRevenue} previous={prev.grossRevenue} />}
        />
        <KpiCard
          title={lang === "de" ? "Bezahlte Rechnungen" : "Paid Invoices"}
          value={curr.paidCount}
          previousValue={prev.paidCount}
          showComparison={showComparison}
          icon={FileText}
          lang={lang}
          delta={<DeltaBadge current={curr.paidCount} previous={prev.paidCount} />}
        />
        <KpiCard
          title={lang === "de" ? "Ausstehend (versandt)" : "Outstanding (sent)"}
          value={curr.sentCount}
          previousValue={prev.sentCount}
          showComparison={showComparison}
          icon={Activity}
          lang={lang}
        />
      </div>

      {visibleCategories.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              {showComparison && (
                <TableRow className="bg-muted/40">
                  <TableHead rowSpan={2}>{lang === "de" ? "Kategorie" : "Category"}</TableHead>
                  <TableHead colSpan={3} className="text-center border-l">
                    {lang === "de" ? "Aktuell" : "Current"}
                  </TableHead>
                  <TableHead colSpan={3} className="text-center border-l">
                    {lang === "de" ? "Vorherig" : "Previous"}
                  </TableHead>
                  <TableHead rowSpan={2} className="text-right print:hidden">Δ</TableHead>
                </TableRow>
              )}
              <TableRow>
                {!showComparison && <TableHead>{lang === "de" ? "Kategorie" : "Category"}</TableHead>}
                <TableHead className="text-right">{lang === "de" ? "Menge" : "Qty"}</TableHead>
                <TableHead className="text-right">{lang === "de" ? "Anteil" : "Share"}</TableHead>
                <TableHead className="text-right">{lang === "de" ? "Netto-Umsatz" : "Net Revenue"}</TableHead>
                {showComparison && (
                  <>
                    <TableHead className="text-right border-l">{lang === "de" ? "Menge" : "Qty"}</TableHead>
                    <TableHead className="text-right">{lang === "de" ? "Anteil" : "Share"}</TableHead>
                    <TableHead className="text-right">{lang === "de" ? "Netto-Umsatz" : "Net Revenue"}</TableHead>
                  </>
                )}
                {!showComparison && <TableHead className="text-right print:hidden">Δ</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCategories.map(cat => {
                const { revenue = 0, qty = 0 } = curr.catMap[cat] ?? {};
                const prevRevenue = prev.catMap[cat]?.revenue ?? 0;
                const prevQty = prev.catMap[cat]?.qty ?? 0;
                const share = curr.netRevenue > 0 ? (revenue / curr.netRevenue) * 100 : 0;
                const prevShare = prev.netRevenue > 0 ? (prevRevenue / prev.netRevenue) * 100 : 0;
                return (
                  <TableRow key={cat}>
                    <TableCell className="font-medium text-sm">{cats.label(cat)}</TableCell>
                    <TableCell className="text-right text-sm">{qty}</TableCell>
                    <TableCell className="text-right text-sm">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden print:hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${share}%` }} />
                        </div>
                        <span className="text-muted-foreground text-xs w-10 text-right">{share.toFixed(1)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium text-sm">{formatMoney(revenue)}</TableCell>
                    {showComparison && (
                      <>
                        <TableCell className="text-right text-sm border-l">{prevQty}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{prevShare.toFixed(1)}%</TableCell>
                        <TableCell className="text-right font-medium text-sm">{formatMoney(prevRevenue)}</TableCell>
                      </>
                    )}
                    <TableCell className="text-right print:hidden">
                      <DeltaBadge current={revenue} previous={prevRevenue} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold text-sm">{lang === "de" ? "Gesamt" : "Total"}</TableCell>
                  <TableCell className="text-right font-bold text-sm">
                    {categories.reduce((s, c) => s + curr.catMap[c].qty, 0)}
                </TableCell>
                <TableCell />
                <TableCell className="text-right font-bold text-sm">{formatMoney(curr.netRevenue)}</TableCell>
                  {showComparison && (
                    <>
                      <TableCell className="text-right font-bold text-sm border-l">
                        {Object.values(prev.catMap).reduce((s, c) => s + c.qty, 0)}
                      </TableCell>
                      <TableCell />
                      <TableCell className="text-right font-bold text-sm">{formatMoney(prev.netRevenue)}</TableCell>
                    </>
                  )}
                <TableCell className="print:hidden" />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      {visibleCategories.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {lang === "de" ? "Keine bezahlten Umsätze in diesem Zeitraum." : "No paid revenue in this period."}
        </p>
      )}
    </div>
  );
}

// ── Inventory section ─────────────────────────────────────────────────────────

function InventorySection({ lots, products, lang }: {
  lots: InventoryLot[];
  products: IrocProduct[];
  lang: string;
}) {
  // Purchase price per product: prefer lot's joined productPurchasePrice, fall back to product record
  const productPurchasePriceMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of products) {
      const pp = parseFloat(p.purchasePrice ?? "0") || 0;
      if (pp > 0) m.set(p.id, pp);
    }
    return m;
  }, [products]);

  const activeLots = useMemo(
    () => lots.filter(l => l.quantityReceived - l.quantityUsed > 0),
    [lots],
  );

  const rows = useMemo(() => activeLots.map(lot => {
    const remaining = lot.quantityReceived - lot.quantityUsed;
    const name = (lang === "de" ? lot.productNameDe : lot.productNameEn) ?? lot.productSku ?? "—";
    // Prefer the price stored on the lot (from the product at time of addition), then product map
    const price = parseFloat(lot.productPurchasePrice ?? "0") || (productPurchasePriceMap.get(lot.productId) ?? 0);
    const total = remaining * price;
    return { lot, name, remaining, price, total };
  }), [activeLots, productPurchasePriceMap, lang]);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const totalUnits = rows.reduce((s, r) => s + r.remaining, 0);

  const stats = useMemo(() => ({
    totalSkus: new Set(activeLots.map(l => l.productId)).size,
    totalUnits,
    stockValue: grandTotal,
    lowStockLots: lots.filter(l => {
      const rem = l.quantityReceived - l.quantityUsed;
      return rem > 0 && rem <= 5;
    }),
  }), [activeLots, totalUnits, grandTotal, lots]);

  // Annual inventory report: always Dec 31 of the current calendar year
  const reportYear = new Date().getFullYear();
  const reportDate = `31.12.${reportYear}`;

  return (
    <div className="space-y-4 pt-4">
      <p className="text-xs text-muted-foreground -mt-1">
        {lang === "de"
          ? "Aktueller Lagerbestand — keine Periodenfilterung"
          : "Current stock snapshot — no period filter applied"}
      </p>

      {/* KPI summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title={lang === "de" ? "SKUs auf Lager" : "SKUs in Stock"} value={stats.totalSkus} icon={Package} />
        <KpiCard title={lang === "de" ? "Einheiten gesamt" : "Total Units"} value={stats.totalUnits} icon={Boxes} />
        <KpiCard title={lang === "de" ? "Lagerwert (EK)" : "Stock Value (Cost)"} value={formatMoney(stats.stockValue)} icon={ShoppingCart} />
        <KpiCard title={lang === "de" ? "Niedriger Bestand" : "Low Stock"} value={stats.lowStockLots.length} icon={AlertTriangle} accent={stats.lowStockLots.length > 0 ? "text-destructive" : ""} />
      </div>

      {/* Formal Inventarverzeichnis table */}
      <div className="border rounded-lg overflow-hidden print:border-black">
        {/* Report header */}
        <div className="px-4 py-3 bg-muted/30 border-b print:bg-white print:border-b print:border-black">
          <h3 className="font-bold text-sm">
            {lang === "de"
              ? `Inventarverzeichnis zum Stichtag ${reportDate}`
              : `Inventory Register as of ${reportDate}`}
          </h3>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-semibold">{lang === "de" ? "Produkt" : "Product"}</TableHead>
              <TableHead className="font-semibold">{lang === "de" ? "Beschreibung" : "SKU"}</TableHead>
              <TableHead className="font-mono font-semibold">LOT-Nr.</TableHead>
              <TableHead className="text-right font-semibold">{lang === "de" ? "Zustand" : "Qty"}</TableHead>
              <TableHead className="text-right font-semibold">{lang === "de" ? "Einzelpreis" : "Unit Cost"}</TableHead>
              <TableHead className="text-right font-semibold">{lang === "de" ? "Summe" : "Total"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8 text-sm">
                  {lang === "de" ? "Kein aktiver Bestand" : "No active inventory"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map(({ lot, name, remaining, price, total }) => (
                <TableRow key={lot.id}>
                  <TableCell className="font-medium text-sm">{name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground font-mono">{lot.productSku ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{lot.lotNumber}</TableCell>
                  <TableCell className="text-right text-sm font-semibold">{remaining}</TableCell>
                  <TableCell className="text-right text-sm">
                    {price > 0 ? formatMoney(price) : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold">
                    {price > 0 ? formatMoney(total) : <span className="text-muted-foreground text-xs">—</span>}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} className="font-bold text-sm">{lang === "de" ? "Summe" : "Grand Total"}</TableCell>
              <TableCell className="text-right font-bold text-sm">{formatMoney(grandTotal)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>

        {/* Signature block */}
        <div className="px-4 py-6 border-t print:border-t print:border-black">
          <div className="flex items-end gap-8 flex-wrap">
            <div className="space-y-1 min-w-[280px]">
              <img
                src={`${import.meta.env.BASE_URL}iroc-signature.png`}
                alt="Unterschrift Geschäftsführung"
                className="h-12 object-contain object-left"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <div className="border-t pt-2 text-xs text-muted-foreground">
                {lang === "de"
                  ? `Aschheim, ${reportDate} – Unterschrift Geschäftsführung / iROC GmbH`
                  : `Aschheim, ${reportDate} – Signature Management / iROC GmbH`}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Low-stock alert panel */}
      {stats.lowStockLots.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
              {lang === "de" ? "Artikel mit niedrigem Bestand (≤ 5)" : "Low-stock items (≤ 5)"}
            </p>
          </div>
          <Table>
            <TableBody>
              {stats.lowStockLots.map(lot => {
                const remaining = lot.quantityReceived - lot.quantityUsed;
                const name = (lang === "de" ? lot.productNameDe : lot.productNameEn) ?? lot.productSku ?? "—";
                return (
                  <TableRow key={lot.id}>
                    <TableCell className="text-sm font-medium">{name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">LOT {lot.lotNumber}</TableCell>
                    <TableCell className="text-right text-sm font-semibold text-destructive">{remaining}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── Leads section ─────────────────────────────────────────────────────────────

const LEAD_STATUS_EN: Record<string, string> = { new: "New", contacted: "Contacted", registered: "Registered", qualified: "Qualified", converted: "Converted" };
const LEAD_STATUS_DE: Record<string, string> = { new: "Neu", contacted: "Kontaktiert", registered: "Angemeldet", qualified: "Qualifiziert", converted: "Konvertiert" };

function LeadsSection({ leads, prevLeads, totalLeads, lang, showComparison }: {
  leads: Lead[];
  prevLeads: Lead[];
  totalLeads: number;
  lang: string;
  showComparison: boolean;
}) {
  const converted = leads.filter(l => l.status === "converted").length;
  const prevConverted = prevLeads.filter(l => l.status === "converted").length;
  const convRate = leads.length > 0 ? (converted / leads.length) * 100 : 0;
  const prevConvRate = prevLeads.length > 0 ? (prevConverted / prevLeads.length) * 100 : 0;

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of leads) m[l.status] = (m[l.status] ?? 0) + 1;
    return m;
  }, [leads]);
  const prevStatusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of prevLeads) m[l.status] = (m[l.status] ?? 0) + 1;
    return m;
  }, [prevLeads]);

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title={lang === "de" ? "Neue Leads (Zeitraum)" : "New Leads (period)"}
          value={leads.length}
          previousValue={prevLeads.length}
          showComparison={showComparison}
          icon={UserSearch}
          lang={lang}
          delta={<DeltaBadge current={leads.length} previous={prevLeads.length} />}
        />
        <KpiCard
          title={lang === "de" ? "Konvertiert" : "Converted"}
          value={converted}
          previousValue={prevConverted}
          showComparison={showComparison}
          icon={TrendingUp}
          lang={lang}
          delta={<DeltaBadge current={converted} previous={prevConverted} />}
        />
        <KpiCard
          title={lang === "de" ? "Konvertierungsrate" : "Conversion Rate"}
          value={`${convRate.toFixed(1)}%`}
          previousValue={`${prevConvRate.toFixed(1)}%`}
          showComparison={showComparison}
          icon={TrendingUp}
          lang={lang}
          delta={<DeltaBadge current={convRate} previous={prevConvRate} />}
        />
        <KpiCard
          title={lang === "de" ? "Leads gesamt" : "All-time Leads"}
          value={totalLeads}
          icon={UserSearch}
        />
      </div>

      {(leads.length > 0 || (showComparison && prevLeads.length > 0)) && (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              {showComparison && (
                <TableRow className="bg-muted/40">
                  <TableHead rowSpan={2}>{lang === "de" ? "Status" : "Status"}</TableHead>
                  <TableHead colSpan={2} className="text-center border-l">{lang === "de" ? "Aktuell" : "Current"}</TableHead>
                  <TableHead colSpan={2} className="text-center border-l">{lang === "de" ? "Vorherig" : "Previous"}</TableHead>
                  <TableHead rowSpan={2} className="text-right print:hidden">Δ</TableHead>
                </TableRow>
              )}
              <TableRow>
                {!showComparison && <TableHead>{lang === "de" ? "Status" : "Status"}</TableHead>}
                <TableHead className="text-right">{lang === "de" ? "Anzahl" : "Count"}</TableHead>
                <TableHead className="text-right">{lang === "de" ? "Anteil" : "Share"}</TableHead>
                {showComparison && (
                  <>
                    <TableHead className="text-right border-l">{lang === "de" ? "Anzahl" : "Count"}</TableHead>
                    <TableHead className="text-right">{lang === "de" ? "Anteil" : "Share"}</TableHead>
                  </>
                )}
                {!showComparison && <TableHead className="text-right print:hidden">Δ</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {["new", "contacted", "registered", "qualified", "converted"].map(status => {
                const count = statusCounts[status] ?? 0;
                const prevCount = prevStatusCounts[status] ?? 0;
                const share = leads.length > 0 ? (count / leads.length) * 100 : 0;
                return (
                  <TableRow key={status}>
                    <TableCell className="text-sm font-medium">
                      {lang === "de" ? LEAD_STATUS_DE[status] : LEAD_STATUS_EN[status]}
                    </TableCell>
                    <TableCell className="text-right text-sm">{count}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">{share.toFixed(1)}%</TableCell>
                    {showComparison && (
                      <>
                        <TableCell className="text-right text-sm border-l">{prevCount}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {prevLeads.length > 0 ? ((prevCount / prevLeads.length) * 100).toFixed(1) : "0.0"}%
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-right print:hidden">
                      <DeltaBadge current={count} previous={prevCount} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold text-sm">{lang === "de" ? "Gesamt" : "Total"}</TableCell>
                <TableCell className="text-right font-bold text-sm">{leads.length}</TableCell>
                <TableCell />
                {showComparison && (
                  <>
                    <TableCell className="text-right font-bold text-sm border-l">{prevLeads.length}</TableCell>
                    <TableCell />
                  </>
                )}
                <TableCell className="print:hidden" />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      {leads.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {lang === "de" ? "Keine neuen Leads in diesem Zeitraum." : "No leads created in this period."}
        </p>
      )}
    </div>
  );
}

// ── Customers section ─────────────────────────────────────────────────────────

function findNewCustomers(periodItems: SalesItem[], allItems: SalesItem[]) {
  const periodInvoiceIds = new Set(periodItems.map(i => i.invoiceId));
  return [...new Set(periodItems.filter(i => i.status !== "draft").map(i => i.customerName))].filter(name =>
    !allItems.some(i => i.customerName === name && !periodInvoiceIds.has(i.invoiceId)),
  );
}

function CustomersSection({ items, prevItems, allItems, lang, showComparison }: {
  items: SalesItem[];
  prevItems: SalesItem[];
  allItems: SalesItem[];
  lang: string;
  showComparison: boolean;
}) {
  const currentCustomers = useMemo(
    () => new Set(items.filter(i => i.status !== "draft").map(i => i.customerName)),
    [items],
  );
  const allCustomers = useMemo(
    () => new Set(allItems.filter(i => i.status !== "draft").map(i => i.customerName)),
    [allItems],
  );
  const previousCustomers = useMemo(
    () => new Set(prevItems.filter(i => i.status !== "draft").map(i => i.customerName)),
    [prevItems],
  );

  // New customers = appear in the period but have no invoice outside it.
  const newCustomers = useMemo(() => findNewCustomers(items, allItems), [items, allItems]);
  const previousNewCustomers = useMemo(() => findNewCustomers(prevItems, allItems), [prevItems, allItems]);
  const comparisonCustomers = [...new Set([...currentCustomers, ...previousCustomers])].sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard
          title={lang === "de" ? "Kunden im Zeitraum" : "Customers in Period"}
          value={currentCustomers.size}
          previousValue={previousCustomers.size}
          showComparison={showComparison}
          icon={Users}
          lang={lang}
        />
        <KpiCard
          title={lang === "de" ? "Neukunden (Erstrechnung)" : "New Customers (1st invoice)"}
          value={newCustomers.length}
          previousValue={previousNewCustomers.length}
          showComparison={showComparison}
          icon={Users}
          lang={lang}
          accent={newCustomers.length > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}
        />
        <KpiCard
          title={lang === "de" ? "Kunden gesamt (alle Zeiten)" : "Total Customers (all-time)"}
          value={allCustomers.size}
          icon={Users}
        />
      </div>

      {showComparison ? (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead>{lang === "de" ? "Kunde" : "Customer"}</TableHead>
                <TableHead className="text-right">{lang === "de" ? "Aktuell" : "Current"}</TableHead>
                <TableHead className="text-right">{lang === "de" ? "Vorherig" : "Previous"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisonCustomers.length > 0 ? comparisonCustomers.map(name => (
                <TableRow key={name}>
                  <TableCell className="text-sm font-medium">{name}</TableCell>
                  <TableCell className="text-right text-sm">{currentCustomers.has(name) ? "✓" : "—"}</TableCell>
                  <TableCell className="text-right text-sm">{previousCustomers.has(name) ? "✓" : "—"}</TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6 text-sm">
                    {lang === "de" ? "Keine Kunden in diesen Zeiträumen." : "No customers in these periods."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      ) : newCustomers.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/30 border-b">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
              {lang === "de" ? "Neukunden in diesem Zeitraum" : "New customers this period"}
            </p>
          </div>
          <div className="divide-y">
            {newCustomers.slice(0, 10).map(name => (
              <div key={name} className="px-4 py-2.5 text-sm font-medium flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {name}
              </div>
            ))}
            {newCustomers.length > 10 && (
              <div className="px-4 py-2 text-xs text-muted-foreground">
                +{newCustomers.length - 10} {lang === "de" ? "weitere" : "more"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Top products section ──────────────────────────────────────────────────────

type ProductSalesSummary = {
  name: string;
  qty: number;
  revenue: number;
  category: string;
};

export function buildTopProductComparisonRows(
  currentProducts: ProductSalesSummary[],
  previousProducts: ProductSalesSummary[],
) {
  const currentTopNames = currentProducts.slice(0, 5).map(product => product.name);
  const previousTopNames = previousProducts.slice(0, 5).map(product => product.name);
  const currentProductMap = new Map(currentProducts.map(product => [product.name, product]));
  const previousProductMap = new Map(previousProducts.map(product => [product.name, product]));

  return [...new Set([...currentTopNames, ...previousTopNames])].map(name => ({
    name,
    category: currentProductMap.get(name)?.category ?? previousProductMap.get(name)?.category ?? "Other",
    current: currentProductMap.get(name),
    previous: previousProductMap.get(name),
  }));
}

function buildProductRows(source: SalesItem[]) {
  const paid = source.filter(i => i.status === "paid");
  const map: Record<string, Omit<ProductSalesSummary, "name">> = {};
  for (const item of paid) {
    (map[item.productName] ??= { qty: 0, revenue: 0, category: item.category });
    map[item.productName].qty += item.quantity;
    map[item.productName].revenue += parseFloat(item.lineTotal);
  }
  return Object.entries(map)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue);
}

function buildProfitRows(source: SalesItem[], bySkuMap: Map<string, number>, byNameMap: Map<string, number>) {
  const paid = source.filter(i => i.status === "paid");
  const map: Record<string, { qty: number; revenue: number; sku: string | null; category: string }> = {};
  for (const item of paid) {
    (map[item.productName] ??= { qty: 0, revenue: 0, sku: item.sku, category: item.category });
    map[item.productName].qty += item.quantity;
    map[item.productName].revenue += parseFloat(item.lineTotal);
  }
  return Object.entries(map)
    .map(([name, v]) => {
      const unitCost =
        (v.sku && bySkuMap.get(v.sku.toLowerCase())) ||
        byNameMap.get(name.toLowerCase()) ||
        0;
      const totalCost = v.qty * unitCost;
      const profit = v.revenue - totalCost;
      const margin = v.revenue > 0 ? (profit / v.revenue) * 100 : 0;
      return { name, qty: v.qty, revenue: v.revenue, totalCost, profit, margin, unitCost, category: v.category };
    })
    .sort((a, b) => b.profit - a.profit);
}

function TopProductsSection({ items, prevItems, lang, showComparison }: {
  items: SalesItem[];
  prevItems: SalesItem[];
  lang: string;
  showComparison: boolean;
}) {
  const cats = useCatHelpers(lang);
  const allProducts = useMemo(() => buildProductRows(items), [items]);
  const allPreviousProducts = useMemo(() => buildProductRows(prevItems), [prevItems]);
  const topProducts = allProducts.slice(0, 5);
  const previousTopProducts = allPreviousProducts.slice(0, 5);

  if (topProducts.length === 0 && (!showComparison || previousTopProducts.length === 0)) {
    return (
      <p className="pt-4 text-sm text-muted-foreground">
        {lang === "de" ? "Keine Umsätze in diesem Zeitraum." : "No revenue in this period."}
      </p>
    );
  }

  // The displayed rows are each period's top five, but their comparison values
  // must come from the full period totals. A product can rank outside the top
  // five in one period and still have meaningful sales there.
  const comparisonProducts = buildTopProductComparisonRows(allProducts, allPreviousProducts);
  const visibleProducts = showComparison
    ? comparisonProducts
    : topProducts.map(product => ({ name: product.name, category: product.category, current: product, previous: undefined }));
  const maxRevenue = topProducts[0]?.revenue ?? 0;

  return (
    <div className="pt-4 border rounded-md overflow-hidden">
      <Table>
        <TableHeader>
          {showComparison && (
            <TableRow className="bg-muted/40">
              <TableHead rowSpan={2} className="w-8">#</TableHead>
              <TableHead rowSpan={2}>{lang === "de" ? "Produkt" : "Product"}</TableHead>
              <TableHead rowSpan={2}>{lang === "de" ? "Kategorie" : "Category"}</TableHead>
              <TableHead colSpan={2} className="text-center border-l">{lang === "de" ? "Aktuell" : "Current"}</TableHead>
              <TableHead colSpan={2} className="text-center border-l">{lang === "de" ? "Vorherig" : "Previous"}</TableHead>
            </TableRow>
          )}
          <TableRow>
            {!showComparison && <><TableHead className="w-8">#</TableHead><TableHead>{lang === "de" ? "Produkt" : "Product"}</TableHead><TableHead>{lang === "de" ? "Kategorie" : "Category"}</TableHead></>}
            <TableHead className="text-right">{lang === "de" ? "Menge" : "Qty"}</TableHead>
            <TableHead className="text-right">{lang === "de" ? "Netto-Umsatz" : "Net Revenue"}</TableHead>
            {showComparison && (
              <>
                <TableHead className="text-right border-l">{lang === "de" ? "Menge" : "Qty"}</TableHead>
                <TableHead className="text-right">{lang === "de" ? "Netto-Umsatz" : "Net Revenue"}</TableHead>
              </>
            )}
            <TableHead className="w-[120px] print:hidden" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleProducts.map((p, idx) => {
            const current = p.current;
            const previous = p.previous;
            const name = p.name;
            const category = p.category;
            const currentRevenue = current?.revenue ?? 0;
            const pct = maxRevenue > 0 ? (currentRevenue / maxRevenue) * 100 : 0;
            return (
              <TableRow key={name}>
                <TableCell className="text-sm text-muted-foreground font-medium">{idx + 1}</TableCell>
                <TableCell className="text-sm font-medium">{name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{cats.label(category)}</TableCell>
                <TableCell className="text-right text-sm">{current?.qty ?? 0}</TableCell>
                <TableCell className="text-right text-sm font-semibold">{formatMoney(currentRevenue)}</TableCell>
                {showComparison && (
                  <>
                    <TableCell className="text-right text-sm border-l">{previous?.qty ?? 0}</TableCell>
                    <TableCell className="text-right text-sm font-semibold">{formatMoney(previous?.revenue ?? 0)}</TableCell>
                  </>
                )}
                <TableCell className="print:hidden">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Profit section ────────────────────────────────────────────────────────────

function ProfitSection({ items, prevItems, products, lang, showComparison }: {
  items: SalesItem[];
  prevItems: SalesItem[];
  products: IrocProduct[];
  lang: string;
  showComparison: boolean;
}) {
  // Build lookup maps: SKU → purchasePrice, name → purchasePrice
  const bySkuMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      const price = parseFloat(p.purchasePrice ?? "0") || 0;
      if (price > 0 && p.sku) m.set(p.sku.toLowerCase(), price);
    }
    return m;
  }, [products]);

  const byNameMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      const price = parseFloat(p.purchasePrice ?? "0") || 0;
      if (price <= 0) continue;
      if (p.nameEn) m.set(p.nameEn.toLowerCase(), price);
      if (p.nameDe) m.set(p.nameDe.toLowerCase(), price);
    }
    return m;
  }, [products]);

  const rows = useMemo(() => buildProfitRows(items, bySkuMap, byNameMap), [items, bySkuMap, byNameMap]);
  const previousRows = useMemo(() => buildProfitRows(prevItems, bySkuMap, byNameMap), [prevItems, bySkuMap, byNameMap]);

  const totals = useMemo(() => ({
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    cost: rows.reduce((s, r) => s + r.totalCost, 0),
    profit: rows.reduce((s, r) => s + r.profit, 0),
  }), [rows]);
  const previousTotals = useMemo(() => ({
    revenue: previousRows.reduce((s, r) => s + r.revenue, 0),
    cost: previousRows.reduce((s, r) => s + r.totalCost, 0),
    profit: previousRows.reduce((s, r) => s + r.profit, 0),
  }), [previousRows]);
  const totalMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;
  const previousMargin = previousTotals.revenue > 0 ? (previousTotals.profit / previousTotals.revenue) * 100 : 0;
  const hasUnpricedRows = [...rows, ...previousRows].some(r => r.unitCost === 0);
  const previousRowMap = new Map(previousRows.map(row => [row.name, row]));
  const currentRowMap = new Map(rows.map(row => [row.name, row]));
  const visibleRows = showComparison
    ? [...new Set([...rows.map(row => row.name), ...previousRows.map(row => row.name)])]
        .map(name => ({
          name,
          category: currentRowMap.get(name)?.category ?? previousRowMap.get(name)?.category ?? "Other",
          current: currentRowMap.get(name),
          previous: previousRowMap.get(name),
        }))
    : rows.map(row => ({ name: row.name, category: row.category, current: row, previous: undefined }));

  if (rows.length === 0 && (!showComparison || previousRows.length === 0)) {
    return (
      <p className="pt-4 text-sm text-muted-foreground">
        {lang === "de" ? "Keine bezahlten Umsätze in diesem Zeitraum." : "No paid revenue in this period."}
      </p>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title={lang === "de" ? "Brutto-Umsatz" : "Gross Revenue"}
          value={formatMoney(totals.revenue)}
          previousValue={formatMoney(previousTotals.revenue)}
          showComparison={showComparison}
          icon={BarChart3}
          lang={lang}
        />
        <KpiCard
          title={lang === "de" ? "Einkaufskosten" : "Purchase Costs"}
          value={formatMoney(totals.cost)}
          previousValue={formatMoney(previousTotals.cost)}
          showComparison={showComparison}
          icon={ShoppingCart}
          lang={lang}
        />
        <KpiCard
          title={lang === "de" ? "Gewinn (gesamt)" : "Total Profit"}
          value={formatMoney(totals.profit)}
          previousValue={formatMoney(previousTotals.profit)}
          showComparison={showComparison}
          icon={TrendingUp}
          lang={lang}
          accent={totals.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}
        />
        <KpiCard
          title={lang === "de" ? "Gewinnmarge" : "Profit Margin"}
          value={`${totalMargin.toFixed(1)}%`}
          previousValue={`${previousMargin.toFixed(1)}%`}
          showComparison={showComparison}
          icon={Activity}
          lang={lang}
          accent={totalMargin >= 40 ? "text-emerald-600 dark:text-emerald-400" : totalMargin >= 15 ? "text-amber-600 dark:text-amber-400" : "text-destructive"}
        />
      </div>

      {/* Per-product table */}
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            {showComparison && (
              <TableRow className="bg-muted/40">
                <TableHead rowSpan={2}>{lang === "de" ? "Produkt" : "Product"}</TableHead>
                <TableHead colSpan={5} className="text-center border-l">{lang === "de" ? "Aktuell" : "Current"}</TableHead>
                <TableHead colSpan={5} className="text-center border-l">{lang === "de" ? "Vorherig" : "Previous"}</TableHead>
              </TableRow>
            )}
            <TableRow>
              {!showComparison && <TableHead>{lang === "de" ? "Produkt" : "Product"}</TableHead>}
              <TableHead className="text-right">{lang === "de" ? "Menge" : "Qty"}</TableHead>
              <TableHead className="text-right">{lang === "de" ? "Brutto-Umsatz" : "Gross Revenue"}</TableHead>
              <TableHead className="text-right">{lang === "de" ? "EK-Kosten" : "Purchase Costs"}</TableHead>
              <TableHead className="text-right">{lang === "de" ? "Gewinn" : "Profit"}</TableHead>
              <TableHead className="text-right">{lang === "de" ? "Marge" : "Margin"}</TableHead>
              {showComparison && (
                <>
                  <TableHead className="text-right border-l">{lang === "de" ? "Menge" : "Qty"}</TableHead>
                  <TableHead className="text-right">{lang === "de" ? "Brutto-Umsatz" : "Gross Revenue"}</TableHead>
                  <TableHead className="text-right">{lang === "de" ? "EK-Kosten" : "Purchase Costs"}</TableHead>
                  <TableHead className="text-right">{lang === "de" ? "Gewinn" : "Profit"}</TableHead>
                  <TableHead className="text-right">{lang === "de" ? "Marge" : "Margin"}</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map(({ name, current, previous }) => (
              <TableRow key={name}>
                <TableCell className="text-sm font-medium">{name}</TableCell>
                <TableCell className="text-right text-sm">{current?.qty ?? 0}</TableCell>
                <TableCell className="text-right text-sm">{formatMoney(current?.revenue ?? 0)}</TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {current && current.unitCost > 0
                    ? formatMoney(current.totalCost)
                    : <span className="text-xs italic opacity-50">{lang === "de" ? "k. EK" : "no cost"}</span>}
                </TableCell>
                <TableCell className={`text-right text-sm font-semibold ${(current?.profit ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                  {formatMoney(current?.profit ?? 0)}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {current && current.revenue > 0 && current.unitCost > 0 ? `${current.margin.toFixed(1)}%` : "—"}
                </TableCell>
                {showComparison && (
                  <>
                    <TableCell className="text-right text-sm border-l">{previous?.qty ?? 0}</TableCell>
                    <TableCell className="text-right text-sm">{formatMoney(previous?.revenue ?? 0)}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {previous && previous.unitCost > 0
                        ? formatMoney(previous.totalCost)
                        : <span className="text-xs italic opacity-50">{lang === "de" ? "k. EK" : "no cost"}</span>}
                    </TableCell>
                    <TableCell className={`text-right text-sm font-semibold ${(previous?.profit ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                      {formatMoney(previous?.profit ?? 0)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {previous && previous.revenue > 0 && previous.unitCost > 0 ? `${previous.margin.toFixed(1)}%` : "—"}
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold text-sm" colSpan={2}>{lang === "de" ? "Gesamt" : "Total"}</TableCell>
              <TableCell className="text-right font-bold text-sm">{formatMoney(totals.revenue)}</TableCell>
              <TableCell className="text-right font-bold text-sm">{formatMoney(totals.cost)}</TableCell>
              <TableCell className={`text-right font-bold text-sm ${totals.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                {formatMoney(totals.profit)}
              </TableCell>
              <TableCell className="text-right font-bold text-sm">
                {totalMargin.toFixed(1)}%
              </TableCell>
              {showComparison && (
                <>
                  <TableCell className="text-right font-bold text-sm border-l">
                    {previousRows.reduce((sum, row) => sum + row.qty, 0)}
                  </TableCell>
                  <TableCell className="text-right font-bold text-sm">{formatMoney(previousTotals.revenue)}</TableCell>
                  <TableCell className="text-right font-bold text-sm">{formatMoney(previousTotals.cost)}</TableCell>
                  <TableCell className={`text-right font-bold text-sm ${previousTotals.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                    {formatMoney(previousTotals.profit)}
                  </TableCell>
                  <TableCell className="text-right font-bold text-sm">{previousMargin.toFixed(1)}%</TableCell>
                </>
              )}
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {hasUnpricedRows && (
        <p className="text-xs text-muted-foreground">
          * {lang === "de"
            ? "Produkte ohne hinterlegten Einkaufspreis werden mit €\u00a00 bewertet — Gewinn für diese Positionen ist unvollständig."
            : "Products without a recorded purchase price are treated as \u20ac0 cost — profit for those rows is incomplete."}
        </p>
      )}
    </div>
  );
}

// ── Expenses section ──────────────────────────────────────────────────────────

const EXPENSE_CATEGORIES = [
  "Office Supplies", "Software", "Travel", "Medical Equipment",
  "Consulting", "Utilities", "Advertising", "Other",
];

function ExpensesSection({ expenses, prevExpenses, lang, showComparison }: {
  expenses: Expense[];
  prevExpenses: Expense[];
  lang: string;
  showComparison: boolean;
}) {
  const toNum = (v: string | null) => parseFloat(v ?? "0") || 0;

  const totalGross   = expenses.reduce((s, e) => s + toNum(e.gross_amount), 0);
  const totalNet     = expenses.reduce((s, e) => s + toNum(e.net_amount), 0);
  const totalTax     = expenses.reduce((s, e) => s + toNum(e.tax_amount), 0);
  const count        = expenses.length;

  const prevGross = prevExpenses.reduce((s, e) => s + toNum(e.gross_amount), 0);
  const prevNet   = prevExpenses.reduce((s, e) => s + toNum(e.net_amount), 0);
  const prevTax   = prevExpenses.reduce((s, e) => s + toNum(e.tax_amount), 0);
  const prevCount = prevExpenses.length;

  const catMap = useMemo(() => {
    const m: Record<string, { gross: number; net: number; count: number }> = {};
    for (const e of expenses) {
      const cat = e.category ?? "Other";
      (m[cat] ??= { gross: 0, net: 0, count: 0 });
      m[cat].gross += toNum(e.gross_amount);
      m[cat].net   += toNum(e.net_amount);
      m[cat].count += 1;
    }
    return m;
  }, [expenses]);

  const prevCatMap = useMemo(() => {
    const m: Record<string, { gross: number; net: number; count: number }> = {};
    for (const e of prevExpenses) {
      const cat = e.category ?? "Other";
      (m[cat] ??= { gross: 0, net: 0, count: 0 });
      m[cat].gross += toNum(e.gross_amount);
      m[cat].net += toNum(e.net_amount);
      m[cat].count += 1;
    }
    return m;
  }, [prevExpenses]);

  const categories = EXPENSE_CATEGORIES.filter(c => catMap[c]);
  // Also include any category not in the predefined list
  const extraCats  = Object.keys(catMap).filter(c => !EXPENSE_CATEGORIES.includes(c));
  const allCats    = [...categories, ...extraCats];
  const prevExtraCats = Object.keys(prevCatMap).filter(c => !EXPENSE_CATEGORIES.includes(c) && !extraCats.includes(c));
  const comparisonCats = [...new Set([
    ...allCats,
    ...EXPENSE_CATEGORIES.filter(c => !!prevCatMap[c]),
    ...prevExtraCats,
  ])];
  const visibleCats = showComparison ? comparisonCats : allCats;

  return (
    <div className="space-y-4 pt-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          title={lang === "de" ? "Bruttoausgaben" : "Total Gross"}
          value={formatMoney(totalGross)}
          previousValue={formatMoney(prevGross)}
          showComparison={showComparison}
          icon={Receipt}
          lang={lang}
          delta={<DeltaBadge current={totalGross} previous={prevGross} />}
          accent={totalGross > 0 ? "text-destructive" : ""}
        />
        <KpiCard
          title={lang === "de" ? "Nettoausgaben" : "Total Net"}
          value={formatMoney(totalNet)}
          previousValue={formatMoney(prevNet)}
          showComparison={showComparison}
          icon={DollarSign}
          lang={lang}
          delta={<DeltaBadge current={totalNet} previous={prevNet} />}
        />
        <KpiCard
          title={lang === "de" ? "MwSt. gesamt" : "Total VAT"}
          value={formatMoney(totalTax)}
          previousValue={formatMoney(prevTax)}
          showComparison={showComparison}
          icon={FileText}
          lang={lang}
        />
        <KpiCard
          title={lang === "de" ? "Belege" : "Records"}
          value={count}
          previousValue={prevCount}
          showComparison={showComparison}
          icon={Package}
          lang={lang}
          delta={<DeltaBadge current={count} previous={prevCount} />}
        />
      </div>

      {/* Category breakdown */}
      {visibleCats.length > 0 ? (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              {showComparison && (
                <TableRow className="bg-muted/40">
                  <TableHead rowSpan={2}>{lang === "de" ? "Kategorie" : "Category"}</TableHead>
                  <TableHead colSpan={4} className="text-center border-l">{lang === "de" ? "Aktuell" : "Current"}</TableHead>
                  <TableHead colSpan={4} className="text-center border-l">{lang === "de" ? "Vorherig" : "Previous"}</TableHead>
                  <TableHead rowSpan={2} className="text-right print:hidden">Δ</TableHead>
                </TableRow>
              )}
              <TableRow>
                {!showComparison && <TableHead>{lang === "de" ? "Kategorie" : "Category"}</TableHead>}
                <TableHead className="text-right">{lang === "de" ? "Belege" : "Records"}</TableHead>
                <TableHead className="text-right">{lang === "de" ? "Anteil" : "Share"}</TableHead>
                <TableHead className="text-right">{lang === "de" ? "Netto" : "Net"}</TableHead>
                <TableHead className="text-right">{lang === "de" ? "Brutto" : "Gross"}</TableHead>
                {showComparison && (
                  <>
                    <TableHead className="text-right border-l">{lang === "de" ? "Belege" : "Records"}</TableHead>
                    <TableHead className="text-right">{lang === "de" ? "Anteil" : "Share"}</TableHead>
                    <TableHead className="text-right">{lang === "de" ? "Netto" : "Net"}</TableHead>
                    <TableHead className="text-right">{lang === "de" ? "Brutto" : "Gross"}</TableHead>
                  </>
                )}
                {!showComparison && <TableHead className="text-right print:hidden">Δ</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCats.map(cat => {
                const { gross = 0, net = 0, count: cnt = 0 } = catMap[cat] ?? {};
                const prevGrossVal = prevCatMap[cat]?.gross ?? 0;
                const prevNetVal = prevCatMap[cat]?.net ?? 0;
                const prevCountVal = prevCatMap[cat]?.count ?? 0;
                const share = totalGross > 0 ? (gross / totalGross) * 100 : 0;
                const prevShare = prevGross > 0 ? (prevGrossVal / prevGross) * 100 : 0;
                return (
                  <TableRow key={cat}>
                    <TableCell className="font-medium text-sm">{cat}</TableCell>
                    <TableCell className="text-right text-sm">{cnt}</TableCell>
                    <TableCell className="text-right text-sm">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden print:hidden">
                          <div className="h-full bg-destructive/60 rounded-full" style={{ width: `${share}%` }} />
                        </div>
                        <span className="text-muted-foreground text-xs w-10 text-right">{share.toFixed(1)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">{formatMoney(net)}</TableCell>
                    <TableCell className="text-right font-medium text-sm">{formatMoney(gross)}</TableCell>
                    {showComparison && (
                      <>
                        <TableCell className="text-right text-sm border-l">{prevCountVal}</TableCell>
                        <TableCell className="text-right text-sm">
                          {prevShare.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatMoney(prevNetVal)}</TableCell>
                        <TableCell className="text-right font-medium text-sm">{formatMoney(prevGrossVal)}</TableCell>
                      </>
                    )}
                    <TableCell className="text-right print:hidden">
                      <DeltaBadge current={gross} previous={prevGrossVal} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold text-sm">{lang === "de" ? "Gesamt" : "Total"}</TableCell>
                <TableCell className="text-right font-bold text-sm">{count}</TableCell>
                <TableCell />
                <TableCell className="text-right font-bold text-sm">{formatMoney(totalNet)}</TableCell>
                <TableCell className="text-right font-bold text-sm">{formatMoney(totalGross)}</TableCell>
                {showComparison && (
                  <>
                    <TableCell className="text-right font-bold text-sm border-l">{prevCount}</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-bold text-sm">{formatMoney(prevNet)}</TableCell>
                    <TableCell className="text-right font-bold text-sm">{formatMoney(prevGross)}</TableCell>
                  </>
                )}
                <TableCell className="print:hidden" />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {lang === "de" ? "Keine Ausgaben in diesem Zeitraum." : "No expenses in this period."}
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Reports() {
  const { token } = useAuth();
  const { lang } = useLanguage();

  const [periodType, setPeriodType] = useState<PeriodType>("quarterly");
  const [periodRef, setPeriodRef] = useState<string>("");
  const [showComparison, setShowComparison] = useState(false);

  // ── Print section selector ────────────────────────────────────────────────────
  const ALL_SECTIONS = useMemo(() => [
    { id: "report-inventory",   labelDe: "Inventar",      labelEn: "Inventory",     icon: Warehouse  },
    { id: "report-sales",       labelDe: "Umsatz",        labelEn: "Sales",         icon: BarChart3  },
    { id: "report-expenses",    labelDe: "Ausgaben",      labelEn: "Expenses",      icon: Receipt    },
    { id: "report-leads",       labelDe: "Leads",         labelEn: "Leads",         icon: UserSearch },
    { id: "report-customers",   labelDe: "Kunden",        labelEn: "Customers",     icon: Users      },
    { id: "report-top-products",labelDe: "Top Produkte",  labelEn: "Top Products",  icon: Package    },
    { id: "report-profit",      labelDe: "Gewinn",        labelEn: "Profit",        icon: TrendingUp },
  ], []);

  const [printOpen, setPrintOpen] = useState(false);
  const [printSections, setPrintSections] = useState<Set<string>>(
    () => new Set(["report-inventory", "report-sales", "report-expenses", "report-leads", "report-customers", "report-top-products", "report-profit"])
  );
  // The Print click can follow several checkbox events before React commits a
  // render. Keep the current selection synchronously so the filter installed
  // for an export is always based on every just-made choice.
  const printSectionsRef = useRef(printSections);

  const setSelectedPrintSections = (next: Set<string>) => {
    printSectionsRef.current = next;
    setPrintSections(next);
  };

  const toggleSection = (id: string) => {
    const next = new Set(printSectionsRef.current);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedPrintSections(next);
  };

  const triggerPrint = () => {
    // Snapshot the synchronously maintained selection before replacing a
    // previous export's filter. This avoids a batched checkbox update leaving
    // the new print job with a partial selection.
    const selected = printSectionsRef.current;
    const hidden = ALL_SECTIONS.map(s => s.id).filter(id => !selected.has(id));
    const cssRules = hidden.map(id => `#${id} { display: none !important; }`).join("\n");
    document.getElementById("print-section-filter")?.remove();
    const style = document.createElement("style");
    style.id = "print-section-filter";
    style.textContent = cssRules ? `@media print {\n${cssRules}\n}` : "";
    document.head.appendChild(style);
    setPrintOpen(false);
    // Wait long enough for the Radix dialog exit animation (~200 ms) to fully
    // complete before triggering the browser print dialog.
    setTimeout(() => {
      const cleanup = () => {
        // A later export may already have installed its own filter. Never let
        // this export's delayed lifecycle cleanup remove that newer selection.
        if (document.getElementById("print-section-filter") === style) style.remove();
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup);
      setTimeout(cleanup, 10000); // fallback
      window.print();
    }, 450);
  };

  // ── Data fetching ─────────────────────────────────────────────────────────────

  const { data: salesItems = [], isLoading: salesLoading } = useQuery<SalesItem[]>({
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

  const { data: lots = [] } = useQuery<InventoryLot[]>({
    queryKey: ["iroc-inventory"],
    queryFn: () => adminGet<InventoryLot[]>("/api/iroc/inventory", token!),
    enabled: !!token,
  });

  const { data: leads = [] } = useQuery<Lead[]>({
    queryKey: LEADS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/iroc/leads", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!token,
  });

  const { data: products = [] } = useListIrocProducts() as { data: IrocProduct[] | undefined };

  const { data: expenses = [] } = useQuery<Expense[]>({
    queryKey: ["iroc-expenses-report"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/admin/expenses", {
        signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!token,
  });

  // ── Period options ────────────────────────────────────────────────────────────
  // Union of sales invoice dates, lead creation dates, AND expense invoice dates.

  const periodOptions = useMemo(() => {
    const keys = new Set<string>();
    const addDate = (date: string | null | undefined) => {
      if (!date) return;
      const key = dateToPeriodKey(date, periodType);
      if (key) keys.add(key);
    };
    for (const i of salesItems.filter(i => !i.isDemo)) {
      addDate(i.issueDate);
    }
    for (const l of leads) {
      const dateStr = l.createdAt?.slice(0, 10);
      addDate(dateStr);
    }
    for (const e of expenses) {
      addDate(e.invoice_date);
    }
    return sortPeriodKeys([...keys], periodType);
  }, [salesItems, leads, expenses, periodType]);

  // Auto-select most recent period when options change or type changes
  useEffect(() => {
    if (periodOptions.length > 0 && (!periodRef || !periodOptions.includes(periodRef))) {
      setPeriodRef(periodOptions[0]);
    }
  }, [periodOptions, periodRef]);

  const activePeriod = periodOptions.includes(periodRef) ? periodRef : (periodOptions[0] ?? "");
  const prevPeriod = prevPeriodKey(activePeriod, periodType);

  // ── Filtered datasets ─────────────────────────────────────────────────────────

  // Pass ALL items (including demo) to SalesSection — calcSalesMetrics handles
  // demo filtering internally so gross/net revenue are computed consistently.
  const currentSalesItems = useMemo(
    () => filterItemsByPeriod(salesItems, i => i.issueDate, periodType, activePeriod),
    [salesItems, periodType, activePeriod],
  );

  const prevSalesItems = useMemo(
    () => filterItemsByPeriod(salesItems, i => i.issueDate, periodType, prevPeriod),
    [salesItems, periodType, prevPeriod],
  );

  // Non-demo items for Customers / TopProducts sections
  const nonDemoItems = useMemo(() => salesItems.filter(i => !i.isDemo), [salesItems]);

  const currentNonDemoItems = useMemo(
    () => filterItemsByPeriod(nonDemoItems, i => i.issueDate, periodType, activePeriod),
    [nonDemoItems, periodType, activePeriod],
  );

  const prevNonDemoItems = useMemo(
    () => filterItemsByPeriod(nonDemoItems, i => i.issueDate, periodType, prevPeriod),
    [nonDemoItems, periodType, prevPeriod],
  );

  const currentLeads = useMemo(
    () => filterItemsByPeriod(leads, l => l.createdAt?.slice(0, 10), periodType, activePeriod),
    [leads, periodType, activePeriod],
  );

  const prevLeads = useMemo(
    () => filterItemsByPeriod(leads, l => l.createdAt?.slice(0, 10), periodType, prevPeriod),
    [leads, periodType, prevPeriod],
  );

  const currentExpenses = useMemo(
    () => filterItemsByPeriod(expenses, e => e.invoice_date, periodType, activePeriod),
    [expenses, periodType, activePeriod],
  );

  const prevExpenses = useMemo(
    () => filterItemsByPeriod(expenses, e => e.invoice_date, periodType, prevPeriod),
    [expenses, periodType, prevPeriod],
  );

  const isLoading = salesLoading;

  const PERIOD_TYPE_LABELS: Record<PeriodType, { de: string; en: string }> = {
    monthly:    { de: "Monatlich",    en: "Monthly"    },
    quarterly:  { de: "Quartal",      en: "Quarterly"  },
    halfyearly: { de: "Halbjährlich", en: "Half-yearly" },
    yearly:     { de: "Jährlich",     en: "Yearly"     },
  };

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Title block — hidden when printing; the print-only header below replaces it */}
        <div className="flex items-center gap-3 print:hidden">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {lang === "de" ? "Berichte" : "Reports"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {lang === "de"
                ? "Periodischer Geschäftsüberblick"
                : "Periodic business snapshot"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 print:hidden"
          onClick={() => setPrintOpen(true)}
        >
          <Printer className="h-4 w-4" />
          {lang === "de" ? "Drucken / PDF" : "Print / PDF"}
        </Button>

        {/* ── Print selection dialog ──────────────────────────────────────── */}
        <Dialog open={printOpen} onOpenChange={setPrintOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Printer className="h-4 w-4" />
                {lang === "de" ? "Bericht drucken" : "Print Report"}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground -mt-1">
              {lang === "de"
                ? "Wähle die Abschnitte aus, die gedruckt werden sollen."
                : "Select the sections you want to include in the printout."}
            </p>
            <div className="space-y-3 py-2">
              {ALL_SECTIONS.map(({ id, labelDe, labelEn, icon: Icon }) => (
                <div key={id} className="flex items-center gap-3">
                  <Checkbox
                    id={`print-chk-${id}`}
                    checked={printSections.has(id)}
                    onCheckedChange={() => toggleSection(id)}
                  />
                  <Label
                    htmlFor={`print-chk-${id}`}
                    className="flex items-center gap-2 cursor-pointer text-sm font-medium"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {lang === "de" ? labelDe : labelEn}
                  </Label>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setSelectedPrintSections(new Set(ALL_SECTIONS.map(s => s.id)))}
              >
                {lang === "de" ? "Alle" : "All"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setSelectedPrintSections(new Set())}
              >
                {lang === "de" ? "Keine" : "None"}
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPrintOpen(false)}>
                {lang === "de" ? "Abbrechen" : "Cancel"}
              </Button>
              <Button
                disabled={printSections.size === 0}
                onClick={triggerPrint}
                className="gap-2"
              >
                <Printer className="h-4 w-4" />
                {lang === "de" ? "Drucken" : "Print"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* ── Period selector ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap print:hidden">
        {/* Period type toggle */}
        <div className="flex bg-muted rounded-md p-0.5 gap-0.5">
          {(["monthly", "quarterly", "halfyearly", "yearly"] as PeriodType[]).map(pt => (
            <button
              key={pt}
              onClick={() => { setPeriodType(pt); setPeriodRef(""); }}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                periodType === pt
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {PERIOD_TYPE_LABELS[pt][lang === "de" ? "de" : "en"]}
            </button>
          ))}
        </div>

        {/* Period reference dropdown */}
        <Select
          value={activePeriod}
          onValueChange={v => setPeriodRef(v)}
          disabled={periodOptions.length === 0}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={lang === "de" ? "Zeitraum…" : "Period…"} />
          </SelectTrigger>
          <SelectContent>
            {periodOptions.map(p => (
              <SelectItem key={p} value={p}>
                {periodKeyToLabel(p, periodType, lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activePeriod && (
          <span className="text-sm text-muted-foreground">
            {lang === "de" ? "Vergleich mit:" : "vs."}{" "}
            <span className="font-medium text-foreground">
              {periodKeyToLabel(prevPeriod, periodType, lang) || "—"}
            </span>
          </span>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <Checkbox
            id="show-report-comparison"
            checked={showComparison}
            onCheckedChange={checked => setShowComparison(checked === true)}
          />
          <Label htmlFor="show-report-comparison" className="cursor-pointer text-sm font-medium">
            {lang === "de" ? "Vergleich anzeigen" : "Show comparison"}
          </Label>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Inventory is a point-in-time snapshot — always shown regardless of period */}
          <ReportSection id="report-inventory" title={lang === "de" ? "Inventar" : "Inventory"} icon={Warehouse}>
            <InventorySection lots={lots} products={products ?? []} lang={lang} />
          </ReportSection>

          {/* Period-based sections — shown once a period is available */}
          {activePeriod ? (
            <>
              <ReportSection id="report-sales" title={lang === "de" ? "Umsatz" : "Sales"} icon={BarChart3}>
                <SalesSection
                  items={currentSalesItems}
                  prevItems={prevSalesItems}
                  lang={lang}
                  showComparison={showComparison}
                />
              </ReportSection>

              <ReportSection id="report-expenses" title={lang === "de" ? "Ausgaben" : "Expenses"} icon={Receipt}>
                <ExpensesSection
                  expenses={currentExpenses}
                  prevExpenses={prevExpenses}
                  lang={lang}
                  showComparison={showComparison}
                />
              </ReportSection>

              <ReportSection id="report-leads" title="Leads" icon={UserSearch}>
                <LeadsSection
                  leads={currentLeads}
                  prevLeads={prevLeads}
                  totalLeads={leads.length}
                  lang={lang}
                  showComparison={showComparison}
                />
              </ReportSection>

              <ReportSection id="report-customers" title={lang === "de" ? "Kunden" : "Customers"} icon={Users}>
                <CustomersSection
                  items={currentNonDemoItems}
                  prevItems={prevNonDemoItems}
                  allItems={nonDemoItems}
                  lang={lang}
                  showComparison={showComparison}
                />
              </ReportSection>

              <ReportSection id="report-top-products" title={lang === "de" ? "Top Produkte" : "Top Products"} icon={Package}>
                <TopProductsSection
                  items={currentNonDemoItems}
                  prevItems={prevNonDemoItems}
                  lang={lang}
                  showComparison={showComparison}
                />
              </ReportSection>

              <ReportSection id="report-profit" title={lang === "de" ? "Gewinn" : "Profit"} icon={TrendingUp}>
                <ProfitSection
                  items={currentNonDemoItems}
                  prevItems={prevNonDemoItems}
                  products={products}
                  lang={lang}
                  showComparison={showComparison}
                />
              </ReportSection>
            </>
          ) : (
            <div className="border rounded-lg bg-card flex items-center justify-center h-32 text-muted-foreground text-sm">
              {lang === "de"
                ? "Keine periodenbasierten Daten verfügbar"
                : "No period-based data available yet"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
