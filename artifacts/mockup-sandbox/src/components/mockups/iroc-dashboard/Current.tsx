import { useState } from "react";
import {
  AlertTriangle, Ban, CalendarDays, CheckCircle, Clock, FileText, GraduationCap,
  Hourglass, MessageSquareQuote, Package, PackageCheck, Receipt, Scale,
  ShoppingBag, TrendingDown, TrendingUp, Users, Warehouse, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import "./_group.css";

type Status = "draft" | "sent" | "paid" | "cancelled";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));

const invoices = [
  { number: "INV-2025-042", customer: "St. Elisabeth Hospital", issued: "2025-05-21", total: 4820, status: "paid" as Status },
  { number: "INV-2025-041", customer: "Handchirurgie Köln", issued: "2025-05-18", total: 2150, status: "sent" as Status },
  { number: "INV-2025-040", customer: "Orthopädie am Park", issued: "2025-05-13", total: 3150, status: "draft" as Status },
  { number: "INV-2025-039", customer: "Klinikum München", issued: "2025-05-09", total: 1890, status: "cancelled" as Status },
];

const expenses = [
  { vendor: "MedTech Supplies GmbH", category: "Inventory", date: "2025-05-20", total: 3260 },
  { vendor: "DHL Express", category: "Shipping", date: "2025-05-17", total: 184.5 },
  { vendor: "Klein & Partner", category: "Services", date: "2025-05-12", total: 890 },
  { vendor: "Office Depot", category: "Office supplies", date: "2025-05-06", total: 117.4 },
];

function MetricCard({ title, value, icon: Icon, description, tone, onClick }: {
  title: string; value: string | number; icon: typeof Users; description?: string;
  tone?: "amber" | "emerald" | "rose"; onClick?: () => void;
}) {
  const styles = tone === "amber" ? "bg-amber-50/50 border-amber-100" : tone === "emerald" ? "bg-emerald-50/50 border-emerald-100" : tone === "rose" ? "bg-rose-50/50 border-rose-100" : "";
  const icon = tone === "amber" ? "text-amber-500" : tone === "emerald" ? "text-emerald-500" : tone === "rose" ? "text-rose-500" : "text-muted-foreground";
  return <Card onClick={onClick} className={`${styles} ${onClick ? "cursor-pointer transition-shadow hover:shadow-md" : ""}`}>
    <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle><Icon className={`h-4 w-4 ${icon}`} /></CardHeader>
    <CardContent><div className={`text-2xl font-bold ${tone === "rose" ? "text-rose-600" : ""}`}>{value}</div>{description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</CardContent>
  </Card>;
}

function StatusCard({ status, count, amount, selected, onClick }: { status: Status; count: number; amount?: number; selected: boolean; onClick: () => void }) {
  const props = {
    draft: { label: "Draft", icon: Clock, color: "bg-muted text-muted-foreground", card: "bg-muted/30", ring: "ring-primary" },
    sent: { label: "Sent", icon: AlertTriangle, color: "bg-blue-100 text-blue-600", card: "bg-blue-50/50 border-blue-100", ring: "ring-blue-500" },
    paid: { label: "Paid", icon: CheckCircle, color: "bg-emerald-100 text-emerald-600", card: "bg-emerald-50/50 border-emerald-100", ring: "ring-emerald-500" },
    cancelled: { label: "Cancelled", icon: Ban, color: "bg-rose-100 text-rose-600", card: "bg-rose-50/50 border-rose-100", ring: "ring-rose-500" },
  }[status];
  const Icon = props.icon;
  return <Card onClick={onClick} className={`cursor-pointer transition-all hover:shadow-md ${props.card} ${selected ? `ring-2 ${props.ring}` : ""}`}>
    <CardContent className="flex items-center gap-4 pt-6"><div className={`rounded-full p-3 ${props.color}`}><Icon className="h-5 w-5" /></div><div><p className="text-sm font-medium">{props.label}</p><p className="text-2xl font-bold">{count}</p>{amount !== undefined && <p className="mt-0.5 text-xs text-muted-foreground">{money(amount)}</p>}</div></CardContent>
  </Card>;
}

export function Current() {
  const [year, setYear] = useState("All years");
  const [status, setStatus] = useState<Status | null>(null);
  const [deliveries, setDeliveries] = useState([{ id: 1, product: "iROC One CT Instrument", sku: "IROC-CT-01", lot: "CT-2504-17", qty: 12, vendor: "MedTech Supplies" }, { id: 2, product: "iROC One TF Instrument", sku: "IROC-TF-02", lot: "TF-2505-02", qty: 8, vendor: "Surgical Partners" }]);
  const revenue = 48620, expenseTotal = 4451.9;
  const filtered = invoices.filter((invoice) => invoice.status === status);
  return <main className="iroc-dashboard min-h-screen bg-background p-5 text-foreground sm:p-8">
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-bold tracking-tight">Dashboard</h1><label className="flex items-center gap-2 text-muted-foreground"><CalendarDays className="h-4 w-4" /><select aria-label="Select year" value={year} onChange={(e) => { setYear(e.target.value); setStatus(null); }} className="h-9 w-36 rounded-md border bg-card px-3 text-sm text-foreground outline-none ring-offset-background focus:ring-2 focus:ring-ring"><option>All years</option><option>2025</option><option>2024</option></select></label></header>

      <section><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Financials <span className="normal-case font-normal tracking-normal">— {year === "All years" ? "All time" : year}</span></h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Revenue (paid)" value={money(revenue)} icon={TrendingUp} description="Paid invoices" tone="emerald" />
        <MetricCard title="Outstanding" value={money(8120)} icon={Hourglass} description="Sent, awaiting payment" tone="amber" />
        <MetricCard title="Expenses" value={money(expenseTotal)} icon={TrendingDown} description="7 purchase invoices" tone="rose" />
        <MetricCard title="Net P&L" value={money(revenue - expenseTotal)} icon={Scale} description="Revenue minus expenses" tone="emerald" />
      </div></section>

      <section><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Overview</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Customers" value={284} icon={Users} />
        <MetricCard title="Products" value={76} icon={Package} description="3 low stock" tone="rose" />
        <MetricCard title="Invoices" value={148} icon={FileText} description={year === "All years" ? undefined : year} />
        <MetricCard title="Pending Deliveries" value={deliveries.length} icon={Warehouse} description={deliveries.length ? "Click to mark as received" : "All deliveries received"} tone={deliveries.length ? "amber" : undefined} onClick={() => document.getElementById("deliveries")?.classList.toggle("hidden")} />
      </div>
      <div id="deliveries" className="mt-4 hidden overflow-hidden rounded-lg border bg-card"><div className="flex items-center justify-between border-b bg-amber-50/60 px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-amber-800"><Warehouse className="h-4 w-4" />Pending Deliveries <span className="font-normal text-muted-foreground">({deliveries.length})</span></h3><button onClick={() => document.getElementById("deliveries")?.classList.add("hidden")} aria-label="Close"><X className="h-4 w-4 text-muted-foreground" /></button></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/30 text-xs text-muted-foreground"><tr><th className="p-3">Product</th><th>Lot #</th><th className="text-right">Qty</th><th>Supplier</th><th className="p-3"></th></tr></thead><tbody>{deliveries.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="p-3"><p className="font-medium">{item.product}</p><p className="font-mono text-xs text-muted-foreground">{item.sku}</p></td><td className="font-mono">{item.lot}</td><td className="text-right font-medium">{item.qty}</td><td>{item.vendor}</td><td className="p-3 text-right"><Button size="sm" variant="outline" className="h-7 border-emerald-300 text-xs text-emerald-700 hover:bg-emerald-50" onClick={() => setDeliveries((items) => items.filter((delivery) => delivery.id !== item.id))}><PackageCheck className="mr-1 h-3 w-3" />Mark Received</Button></td></tr>)}</tbody></table></div></div></section>

      <section><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Website Orders</h2><Card><CardHeader className="flex flex-row items-center justify-between pb-3"><CardTitle className="flex items-center gap-2 text-base font-semibold"><ShoppingBag className="h-4 w-4 text-blue-500" />Incoming Orders</CardTitle><a href="#all" className="text-xs text-muted-foreground">View all →</a></CardHeader><CardContent className="grid gap-3 pt-0 sm:grid-cols-2"><div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4"><div className="flex justify-between text-sm font-medium text-amber-800">Pending <Clock className="h-4 w-4" /></div><p className="mt-2 text-2xl font-bold text-amber-800">6</p><p className="mt-1 text-xs text-amber-700">Awaiting customer confirmation</p></div><div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4"><div className="flex justify-between text-sm font-medium text-emerald-800">Confirmed <CheckCircle className="h-4 w-4" /></div><p className="mt-2 text-2xl font-bold text-emerald-800">9</p><p className="mt-1 text-xs text-emerald-700">Ready for processing</p></div></CardContent></Card></section>

      <section className="grid gap-4 sm:grid-cols-2"><MetricCard title="Pending Quotes" value={4} icon={MessageSquareQuote} description="Quotes awaiting review" tone="amber" /><MetricCard title="Pending Trainings" value={3} icon={GraduationCap} description="Non-certified registrations" tone="emerald" /></section>
      <section><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Invoice Status <span className="normal-case font-normal tracking-normal">(click to filter)</span></h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatusCard status="draft" count={11} selected={status === "draft"} onClick={() => setStatus(status === "draft" ? null : "draft")} /><StatusCard status="sent" count={8} amount={8120} selected={status === "sent"} onClick={() => setStatus(status === "sent" ? null : "sent")} /><StatusCard status="paid" count={121} amount={revenue} selected={status === "paid"} onClick={() => setStatus(status === "paid" ? null : "paid")} /><StatusCard status="cancelled" count={8} selected={status === "cancelled"} onClick={() => setStatus(status === "cancelled" ? null : "cancelled")} /></div>
      {status && <div className="mt-4 overflow-hidden rounded-lg border bg-card"><div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3"><h3 className="text-sm font-semibold">Invoices — {status} <span className="font-normal text-muted-foreground">({filtered.length})</span></h3><button onClick={() => setStatus(null)} aria-label="Close"><X className="h-4 w-4 text-muted-foreground" /></button></div><table className="w-full text-left text-sm"><thead className="border-b bg-muted/30 text-xs text-muted-foreground"><tr><th className="p-3">Invoice number</th><th>Customer</th><th>Issue date</th><th>Status</th><th className="p-3 text-right">Total</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.number}><td className="p-3 font-mono font-medium">{item.number}</td><td>{item.customer}</td><td className="text-muted-foreground">{date(item.issued)}</td><td><Badge variant="outline" className="capitalize">{item.status}</Badge></td><td className="p-3 text-right font-medium">{money(item.total)}</td></tr>)}</tbody></table></div>}</section>

      <section><h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Recent Activity</h2><div className="grid gap-6 lg:grid-cols-3">
        <Card><CardHeader className="flex flex-row items-center justify-between pb-3"><CardTitle className="flex gap-2 text-base"><ShoppingBag className="h-4 w-4 text-blue-500" />New Orders</CardTitle><span className="text-xs text-muted-foreground">View all →</span></CardHeader><CardContent className="space-y-3 pt-0">{[["Dr. Anna Weber", "Universitätsklinikum Hamburg", "CT", "2 open"], ["Martin Keller", "Handzentrum Berlin", "TF", "1 open"]].map(([name, clinic, instrument, open]) => <div key={name} className="flex justify-between border-b pb-3 last:border-0"><div><p className="text-sm font-medium">{name}</p><p className="text-xs text-muted-foreground">{clinic}</p><p className="text-xs text-muted-foreground">orders@clinic.de</p></div><div className="text-right"><Badge variant="outline">{instrument}</Badge><p className="mt-1 text-xs text-blue-600">{open}</p></div></div>)}</CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-3"><CardTitle className="flex gap-2 text-base"><Receipt className="h-4 w-4 text-rose-500" />Recent Expenses</CardTitle><span className="text-xs text-muted-foreground">View all →</span></CardHeader><CardContent className="space-y-3 pt-0">{expenses.map((item) => <div key={item.vendor} className="flex justify-between border-b pb-3 last:border-0"><div><p className="text-sm font-medium">{item.vendor}</p><p className="text-xs text-muted-foreground">{item.category} · {date(item.date)}</p></div><p className="text-sm font-semibold text-rose-600">{money(item.total)}</p></div>)}</CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="flex gap-2 text-base"><GraduationCap className="h-4 w-4 text-emerald-500" />Upcoming Training</CardTitle></CardHeader><CardContent className="space-y-3 pt-0">{[["Dr. Lukas Schmidt", "lukas.schmidt@clinic.de", "CT", "12 June 2025"], ["Dr. Eva Braun", "eva.braun@hospital.de", "TF", "26 June 2025"]].map(([name, email, instrument, when]) => <div key={name} className="flex justify-between border-b pb-3 last:border-0"><div><p className="text-sm font-medium">{name}</p><p className="text-xs text-muted-foreground">{email}</p><p className="text-xs text-muted-foreground">{when}</p></div><Badge variant="outline">{instrument}</Badge></div>)}</CardContent></Card>
      </div></section>
    </div>
  </main>;
}