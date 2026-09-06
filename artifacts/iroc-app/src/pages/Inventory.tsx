import { useState, useEffect, useCallback, Fragment, useMemo } from "react";
import { Link } from "wouter";
import { useProductGroupHelpers } from "@/lib/product-groups";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { adminGet, adminPost, adminDelete, adminPatch } from "@/lib/admin-fetch";
import { useListIrocProducts } from "@workspace/api-client-react";
import { convertToEUR, PURCHASE_CURRENCIES, type ConversionResult } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, AlertTriangle, Package, Boxes, Search, ChevronUp, ChevronDown, Pencil, Clock, Eye, Truck, CheckCircle2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";

interface InventoryLot {
  id: number;
  productId: number;
  productSku: string | null;
  productNameEn: string | null;
  productNameDe: string | null;
  productDescriptionEn: string | null;
  productDescriptionDe: string | null;
  productCategory: string | null;
  productPurchasePrice: string | null;
  lotNumber: string;
  purchaseDate: string;
  expirationDate: string | null;
  description: string | null;
  quantityReceived: number;
  quantityUsed: number;
}


/** Returns true if the date is within 6 months from today */
function isExpiringSoon(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const exp = new Date(dateStr);
  const sixMonths = new Date();
  sixMonths.setMonth(sixMonths.getMonth() + 6);
  return exp <= sixMonths && exp >= new Date();
}

/** Returns true if the date is already past */
function isExpired(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

export default function Inventory() {
  const { lang } = useLanguage();
  const groupHelpers = useProductGroupHelpers(lang);
  const catOrder = groupHelpers.order;
  const { token } = useAuth();
  const { data: products } = useListIrocProducts();

  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"lot" | "purchaseDate" | "expirationDate">("purchaseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pending deliveries
  interface PendingLot {
    lot_id: number;
    product_id: number;
    lot_number: string;
    purchase_date: string;
    quantity_received: number;
    description: string | null;
    product_sku: string | null;
    product_name_de: string | null;
    product_name_en: string | null;
    vendor_name: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    expense_id: number | null;
  }
  const [pendingLots, setPendingLots] = useState<PendingLot[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [receivingId, setReceivingId] = useState<number | null>(null);

  const loadPending = useCallback(() => {
    if (!token) return;
    setPendingLoading(true);
    adminGet<PendingLot[]>("/api/admin/inventory-lots/pending", token)
      .then(data => setPendingLots(data))
      .catch(() => {})
      .finally(() => setPendingLoading(false));
  }, [token]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const handleMarkReceived = async (lotId: number) => {
    if (!token) return;
    setReceivingId(lotId);
    try {
      await adminPatch(`/api/admin/inventory-lots/${lotId}/receive`, token, {});
    } catch (error) {
      if (error instanceof Error && error.message === "Lot not found or already received") {
        alert(lang === "de"
          ? "Diese Lieferung wurde bereits als erhalten markiert."
          : "This delivery has already been marked as received.");
      } else {
        alert(lang === "de" ? "Fehler beim Empfangen" : "Failed to mark as received");
      }
    } finally {
      // Another admin may have received this lot first. Always reload both
      // collections so this screen reflects the server's current stock state.
      loadPending();
      load();
      setReceivingId(null);
    }
  };

  // Edit state
  const [editLot, setEditLot] = useState<InventoryLot | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Create form state
  const [formProductId, setFormProductId] = useState<string>("");
  const [formLotNumber, setFormLotNumber] = useState("");
  const [formPurchaseDate, setFormPurchaseDate] = useState(new Date().toISOString().split("T")[0]);
  const [formExpirationDate, setFormExpirationDate] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formQuantity, setFormQuantity] = useState("");
  const [formPurchasePrice, setFormPurchasePrice] = useState("");
  const [formCurrency, setFormCurrency] = useState("EUR");
  const [formConversion, setFormConversion] = useState<ConversionResult | null>(null);
  const [formConvertingPrice, setFormConvertingPrice] = useState(false);

  // Derived: selected product's discount %
  const selectedProduct = useMemo(
    () => products?.find(p => p.id === parseInt(formProductId || "0")),
    [formProductId, products],
  );
  const productDiscount = parseFloat(selectedProduct?.purchaseDiscount ?? "0") || 0;
  // Discount is applied to the raw price in original currency first, then converted to EUR.
  // formConversion.eurAmount already IS the effective EUR cost (discount baked in before conversion).
  const formEffectiveCost = formConversion?.eurAmount ?? null;

  // Auto-fill: back-calculate gross price from stored effective cost + product discount
  useEffect(() => {
    if (!formProductId) {
      setFormPurchasePrice(""); setFormCurrency("EUR"); setFormConversion(null); return;
    }
    const effectiveCost = parseFloat(selectedProduct?.purchasePrice ?? "0") || 0;
    const disc = parseFloat(selectedProduct?.purchaseDiscount ?? "0") || 0;
    const grossPrice = disc > 0 ? effectiveCost / (1 - disc / 100) : effectiveCost;
    setFormCurrency("EUR");
    setFormPurchasePrice(grossPrice > 0 ? grossPrice.toFixed(2) : "");
    setFormConversion(grossPrice > 0
      ? { eurAmount: grossPrice, rateDate: "", rate: 1 }
      : null);
  // Intentionally only reacts to product selection, not catalog price refreshes,
  // so an admin's in-progress price edit is not overwritten.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formProductId]);

  // Currency conversion: discount applied in original currency first, then converted to EUR
  useEffect(() => {
    const raw = parseFloat(formPurchasePrice);
    if (!raw || isNaN(raw) || raw <= 0) { setFormConversion(null); return; }
    const discountedRaw = productDiscount > 0 ? raw * (1 - productDiscount / 100) : raw;
    if (formCurrency === "EUR") {
      setFormConversion({ eurAmount: discountedRaw, rateDate: formPurchaseDate, rate: 1 });
      return;
    }
    if (!formPurchaseDate) { setFormConversion(null); return; }
    let cancelled = false;
    setFormConvertingPrice(true);
    const timer = setTimeout(async () => {
      const result = await convertToEUR(discountedRaw, formCurrency, formPurchaseDate);
      if (!cancelled) {
        setFormConversion(result);
        setFormConvertingPrice(false);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); setFormConvertingPrice(false); };
  }, [formPurchasePrice, formCurrency, formPurchaseDate, productDiscount]);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    adminGet<InventoryLot[]>("/api/iroc/inventory", token)
      .then(data => setLots(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    try {
      // Use the EUR effective cost (after discount) as the stored purchasePrice
      const storePurchasePrice = formEffectiveCost !== null
        ? formEffectiveCost.toFixed(2)
        : (formPurchasePrice.trim() || null);
      await adminPost("/api/iroc/inventory", token, {
        productId: parseInt(formProductId),
        lotNumber: formLotNumber.trim() || "N/A",
        purchaseDate: formPurchaseDate,
        expirationDate: formExpirationDate || null,
        description: formDescription || null,
        quantityReceived: parseInt(formQuantity),
        purchasePrice: storePurchasePrice,
      });
      setOpen(false);
      setFormProductId(""); setFormLotNumber("");
      setFormPurchaseDate(new Date().toISOString().split("T")[0]);
      setFormExpirationDate(""); setFormCurrency("EUR");
      setFormDescription(""); setFormQuantity(""); setFormPurchasePrice(""); setFormConversion(null);
      load();
    } catch {
      alert("Failed to add inventory");
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token || !editLot) return;
    setEditSaving(true);
    const fd = new FormData(e.currentTarget);
    try {
      await adminPatch(`/api/iroc/inventory/${editLot.id}`, token, {
        lotNumber: fd.get("lotNumber"),
        purchaseDate: fd.get("purchaseDate"),
        expirationDate: (fd.get("expirationDate") as string) || null,
        quantityReceived: parseInt(fd.get("quantityReceived") as string),
        quantityUsed: parseInt(fd.get("quantityUsed") as string),
        description: (fd.get("description") as string) || null,
      });
      setEditLot(null);
      load();
    } catch {
      alert(lang === "de" ? "Speichern fehlgeschlagen" : "Failed to save");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!token || !confirm(lang === "de" ? "Diesen Eintrag löschen?" : "Delete this inventory record? This cannot be undone.")) return;
    try {
      await adminDelete(`/api/iroc/inventory/${id}`, token);
      load();
    } catch {
      alert("Failed to delete");
    }
  };

  // Filter
  const filtered = lots.filter(l => {
    const q = search.toLowerCase();
    const name = (lang === "de" ? l.productNameDe : l.productNameEn) ?? "";
    const productDescription = (lang === "de" ? l.productDescriptionDe : l.productDescriptionEn) ?? "";
    return (
      name.toLowerCase().includes(q) ||
      productDescription.toLowerCase().includes(q) ||
      l.lotNumber.toLowerCase().includes(q) ||
      l.productSku?.toLowerCase().includes(q) ||
      l.description?.toLowerCase().includes(q)
    );
  });

  // Sort: primary = availability (remaining > 0 first), secondary = category group, tertiary = user sort key
  const sorted = [...filtered].sort((a, b) => {
    const remA = a.quantityReceived - a.quantityUsed;
    const remB = b.quantityReceived - b.quantityUsed;

    // 1. Available first
    const availA = remA > 0 ? 0 : 1;
    const availB = remB > 0 ? 0 : 1;
    if (availA !== availB) return availA - availB;

    // 2. Category group within same availability tier
    const catA = catOrder(a.productCategory);
    const catB = catOrder(b.productCategory);
    if (catA !== catB) return catA - catB;

    // 3. User-selected sort key
    if (sortKey === "purchaseDate") {
      const av = a.purchaseDate ?? "";
      const bv = b.purchaseDate ?? "";
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    if (sortKey === "expirationDate") {
      const av = a.expirationDate ?? "9999-99-99";
      const bv = b.expirationDate ?? "9999-99-99";
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const av = a.lotNumber.toLowerCase();
    const bv = b.lotNumber.toLowerCase();
    return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const handleSort = (key: "lot" | "purchaseDate" | "expirationDate") => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Bulk select helpers
  const allIds = sorted.map(l => l.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const toggleSelect = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(allIds));

  const handleBulkDelete = async () => {
    if (!token || selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} inventory record(s)? This cannot be undone.`)) return;
    setDeleting(true);
    for (const id of selectedIds) await adminDelete(`/api/iroc/inventory/${id}`, token).catch(() => {});
    setSelectedIds(new Set());
    setDeleting(false);
    load();
  };

  // Stats
  const totalLots = lots.length;
  const totalUnits = lots.reduce((s, l) => s + l.quantityReceived - l.quantityUsed, 0);
  const lowStockLots = lots.filter(l => (l.quantityReceived - l.quantityUsed) <= 5 && l.quantityReceived > 0);
  const expiringSoonCount = lots.filter(l => isExpiringSoon(l.expirationDate) || isExpired(l.expirationDate)).length;

  // Products with no lots at all — shown as grayed-out rows so nothing is invisible
  // Services products are excluded: they have no physical stock to track
  const lotsProductIds = new Set(lots.map(l => l.productId));
  const filteredNoLots = (products ?? [])
    .filter(p => !lotsProductIds.has(p.id))
    .filter(p => p.category !== "services")
    .filter(p => {
      const q = search.toLowerCase();
      return !q ||
        (p.nameEn ?? "").toLowerCase().includes(q) ||
        (p.nameDe ?? "").toLowerCase().includes(q) ||
        (lang === "de" ? p.descriptionDe : p.descriptionEn)?.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q);
    });

  // Opens the Add dialog pre-filled for a specific product
  const openAddForProduct = (productId: number) => {
    setFormProductId(String(productId));
    setFormLotNumber("");
    setFormPurchaseDate(new Date().toISOString().split("T")[0]);
    setFormExpirationDate("");
    setFormDescription("");
    setFormQuantity("");
    setFormCurrency("EUR");
    setFormConversion(null);
    // formPurchasePrice is auto-filled by the product-selection useEffect
    setOpen(true);
  };

  // Category label helper (dynamic, from admin-managed product groups)
  const categoryLabel = (cat: string | null) => groupHelpers.label(cat);

  // Detect category group changes for visual dividers
  const getGroupKey = (lot: InventoryLot) => {
    const remaining = lot.quantityReceived - lot.quantityUsed;
    const avail = remaining > 0 ? "available" : "unavailable";
    const cat = lot.productCategory ?? "cellenis";
    return `${avail}-${cat}`;
  };

  const SortIcon = ({ col }: { col: "lot" | "purchaseDate" | "expirationDate" }) =>
    sortKey === col
      ? (sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />)
      : <ChevronUp className="h-3.5 w-3.5 opacity-20" />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {lang === "de" ? "Inventar" : "Inventory"}
        </h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="shrink-0">
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">
                {lang === "de" ? "Inventar hinzufügen" : "Add Inventory"}
              </span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <DialogTitle>{lang === "de" ? "Neuer Inventar-Eintrag" : "New Inventory Purchase"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-4 overflow-y-auto flex-1 pr-1">
              <div className="space-y-2">
                <Label>{lang === "de" ? "Produkt" : "Product"} *</Label>
                <select
                  value={formProductId}
                  onChange={e => setFormProductId(e.target.value)}
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">{lang === "de" ? "Produkt wählen…" : "Select product…"}</option>
                  {products?.filter(p => p.category !== "services").map(p => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {lang === "de" ? p.nameDe : p.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>LOT {lang === "de" ? "Nummer" : "Number"}</Label>
                <Input value={formLotNumber} onChange={e => setFormLotNumber(e.target.value)} placeholder={lang === "de" ? "z. B. 2025074121 (leer = N/A)" : "e.g. 2025074121 (leave blank if none)"} />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Kaufdatum" : "Purchase Date"} *</Label>
                <Input type="date" value={formPurchaseDate} onChange={e => setFormPurchaseDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Ablaufdatum" : "Expiration Date"}</Label>
                <Input
                  type="date"
                  value={formExpirationDate}
                  onChange={e => setFormExpirationDate(e.target.value)}
                  placeholder={lang === "de" ? "Kein Ablaufdatum" : "No expiration"}
                />
                <p className="text-xs text-muted-foreground">
                  {lang === "de"
                    ? "Leer lassen falls kein Ablaufdatum. Einträge mit Ablauf in unter 6 Monaten werden orange markiert."
                    : "Leave blank if no expiration date. Lots expiring within 6 months will be flagged in orange."}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Menge" : "Amount"} *</Label>
                <Input type="number" min="0" step="1" value={formQuantity} onChange={e => setFormQuantity(e.target.value)} placeholder="0" required />
              </div>
              {/* Purchase price with currency conversion */}
              <div className="space-y-2">
                <Label>{lang === "de" ? "Einkaufspreis (Listenpreis)" : "Purchase Price (list price)"}</Label>
                <div className="flex gap-2">
                  {/* Currency selector — shadcn Select */}
                  <Select
                    value={formCurrency}
                    onValueChange={v => { setFormCurrency(v); setFormConversion(null); }}
                  >
                    <SelectTrigger className="w-[100px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PURCHASE_CURRENCIES.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Raw price in chosen currency */}
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formPurchasePrice}
                    onChange={e => setFormPurchasePrice(e.target.value)}
                    placeholder={lang === "de" ? "z. B. 285.00" : "e.g. 285.00"}
                  />
                </div>

                {/* EUR conversion + effective cost breakdown */}
                {formPurchasePrice && parseFloat(formPurchasePrice) > 0 && (
                  <div className="rounded-md bg-muted/40 border px-3 py-2 space-y-1 text-xs">

                    {/* Conversion row (non-EUR only) */}
                    {formCurrency !== "EUR" && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>{lang === "de" ? "Umrechnung in €:" : "Converted to €:"}</span>
                        <span className="font-medium">
                          {formConvertingPrice
                            ? <span className="animate-pulse">{lang === "de" ? "Lade…" : "Loading…"}</span>
                            : formConversion !== null
                              ? `€ ${formConversion.eurAmount.toFixed(2)}`
                              : <span className="text-destructive">{lang === "de" ? "Kurs nicht verfügbar" : "Rate unavailable"}</span>}
                        </span>
                      </div>
                    )}

                    {/* Exchange rate detail */}
                    {formCurrency !== "EUR" && formConversion !== null && !formConvertingPrice && (
                      <div className="flex justify-between text-muted-foreground/70">
                        <span>{lang === "de" ? "Kurs (ECB):" : "Rate (ECB):"}</span>
                        <span>
                          1 {formCurrency} = {formConversion.rate.toFixed(5)} EUR
                          {formConversion.rateDate ? ` · ${formConversion.rateDate}` : ""}
                        </span>
                      </div>
                    )}

                    {/* Manufacturer discount row */}
                    {productDiscount > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>
                          {lang === "de"
                            ? `Herstellerrabatt (${productDiscount}%):`
                            : `Manufacturer discount (${productDiscount}%):`}
                        </span>
                        <span className="font-medium text-green-600 dark:text-green-400">
                          {formConversion !== null
                            ? `−€ ${(formConversion.eurAmount * productDiscount / 100).toFixed(2)}`
                            : "—"}
                        </span>
                      </div>
                    )}

                    {/* Effective cost */}
                    <div className="flex justify-between border-t pt-1 mt-1">
                      <span className="font-semibold">
                        {lang === "de" ? "Effektiver EK (Einzelpreis):" : "Effective cost (unit price):"}
                      </span>
                      <span className="font-bold text-primary">
                        {formEffectiveCost !== null
                          ? `€ ${formEffectiveCost.toFixed(2)}`
                          : formConversion !== null
                            ? `€ ${formConversion.eurAmount.toFixed(2)}`
                            : "—"}
                      </span>
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {lang === "de"
                    ? "Wird nach Währungsumrechnung und Rabatt als Einzelpreis gespeichert."
                    : "Stored as unit cost after currency conversion and discount."}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Beschreibung" : "Description"}</Label>
                <Textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder={lang === "de" ? "Optionale Anmerkungen…" : "Optional notes…"} className="h-20" />
              </div>
              <DialogFooter className="mt-6 shrink-0">
                <Button variant="outline" type="button" onClick={() => setOpen(false)}>{lang === "de" ? "Abbrechen" : "Cancel"}</Button>
                <Button type="submit" disabled={saving}>{lang === "de" ? "Speichern" : "Save"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="flex flex-col items-center text-center p-3 pt-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4 sm:pt-6 sm:pb-6 sm:text-left">
            <div className="hidden sm:flex h-10 w-10 rounded-lg bg-primary/10 items-center justify-center shrink-0">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold leading-none">{totalLots}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight mt-1 break-words">
                {lang === "de" ? "LOT-Einträge" : "Lot Records"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center text-center p-3 pt-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4 sm:pt-6 sm:pb-6 sm:text-left">
            <div className="hidden sm:flex h-10 w-10 rounded-lg bg-green-500/10 items-center justify-center shrink-0">
              <Boxes className="h-5 w-5 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold leading-none">{totalUnits}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight mt-1 break-words">
                {lang === "de" ? "auf Lager" : "In Stock"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center text-center p-3 pt-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4 sm:pt-6 sm:pb-6 sm:text-left">
            <div className={`hidden sm:flex h-10 w-10 rounded-lg items-center justify-center shrink-0 ${lowStockLots.length > 0 ? "bg-destructive/10" : "bg-muted"}`}>
              <AlertTriangle className={`h-5 w-5 ${lowStockLots.length > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold leading-none">{lowStockLots.length}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight mt-1 break-words">
                {lang === "de" ? "Niedr. Best." : "Low Stock"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center text-center p-3 pt-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4 sm:pt-6 sm:pb-6 sm:text-left">
            <div className={`hidden sm:flex h-10 w-10 rounded-lg items-center justify-center shrink-0 ${expiringSoonCount > 0 ? "bg-orange-500/10" : "bg-muted"}`}>
              <Clock className={`h-5 w-5 ${expiringSoonCount > 0 ? "text-orange-500" : "text-muted-foreground"}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold leading-none">{expiringSoonCount}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight mt-1 break-words">
                {lang === "de" ? "Läuft ab" : "Expiring"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Awaiting Delivery */}
      {(pendingLoading || pendingLots.length > 0) && (
        <div className="border rounded-md bg-card overflow-hidden">
          {/* Section header */}
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
            onClick={() => setPendingOpen(o => !o)}
          >
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-amber-500" />
              <span className="font-semibold text-sm">
                {lang === "de" ? "Ausstehende Lieferungen" : "Awaiting Delivery"}
              </span>
              {!pendingLoading && (
                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300/40 text-xs">
                  {pendingLots.length}
                </Badge>
              )}
            </div>
            {pendingOpen
              ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {pendingOpen && (
            <div className="border-t">
              {pendingLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2].map(i => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : pendingLots.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {lang === "de" ? "Keine ausstehenden Lieferungen" : "No pending deliveries"}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{lang === "de" ? "Produkt" : "Product"}</TableHead>
                      <TableHead>{lang === "de" ? "LOT Nr." : "LOT No."}</TableHead>
                      <TableHead className="text-right">{lang === "de" ? "Menge" : "Qty"}</TableHead>
                      <TableHead>{lang === "de" ? "Lieferant" : "Supplier"}</TableHead>
                      <TableHead>{lang === "de" ? "Rechnung" : "Invoice Ref."}</TableHead>
                      <TableHead className="w-[150px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingLots.map(pl => {
                      const productName = (lang === "de" ? pl.product_name_de : pl.product_name_en) ?? pl.product_sku ?? "—";
                      return (
                        <TableRow key={pl.lot_id}>
                          <TableCell>
                            <div className="font-medium text-sm">{productName}</div>
                            {pl.product_sku && <div className="text-[11px] text-muted-foreground font-mono">{pl.product_sku}</div>}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{pl.lot_number || "—"}</TableCell>
                          <TableCell className="text-right font-medium">{pl.quantity_received}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{pl.vendor_name || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {pl.invoice_number
                              ? <span className="font-mono">{pl.invoice_number}</span>
                              : "—"}
                            {pl.invoice_date && (
                              <span className="text-[11px] text-muted-foreground block">{formatDate(pl.invoice_date)}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 text-xs border-green-500/40 text-green-700 dark:text-green-400 hover:bg-green-500/10"
                              disabled={receivingId === pl.lot_id}
                              onClick={() => handleMarkReceived(pl.lot_id)}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {receivingId === pl.lot_id
                                ? (lang === "de" ? "Speichere…" : "Saving…")
                                : (lang === "de" ? "Als erhalten markieren" : "Mark as Received")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2 bg-card border rounded-md p-1 max-w-sm">
        <Search className="h-4 w-4 ml-2 text-muted-foreground" />
        <Input
          placeholder={lang === "de" ? "Suchen…" : "Search…"}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-2 bg-transparent"
        />
      </div>

      {/* Select-all + bulk delete bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={toggleAll} className="h-7 gap-1.5 text-xs">
          {allSelected ? (lang === "de" ? "Auswahl aufheben" : "Deselect all") : (lang === "de" ? "Alle auswählen" : "Select all")}
        </Button>
        {selectedIds.size > 0 && (
          <>
            <span className="font-medium text-destructive text-sm">{selectedIds.size} {lang === "de" ? "ausgewählt" : "selected"}</span>
            <Button size="sm" variant="destructive" disabled={deleting} onClick={handleBulkDelete} className="gap-1.5 h-7">
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? (lang === "de" ? "Lösche…" : "Deleting…") : `${lang === "de" ? "Löschen" : "Delete"} (${selectedIds.size})`}
            </Button>
          </>
        )}
      </div>

      {/* Table */}
      <div className="border rounded-md bg-card">
        <div className="overflow-y-auto max-h-[60vh] sticky-header-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer select-none hover:bg-muted/50 w-[140px]" onClick={() => handleSort("lot")}>
                <div className="flex items-center gap-1">LOT {lang === "de" ? "Nr." : "No."}<SortIcon col="lot" /></div>
              </TableHead>
              <TableHead>{lang === "de" ? "Produkt" : "Product"}</TableHead>
              <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("purchaseDate")}>
                <div className="flex items-center gap-1">{lang === "de" ? "Kaufdatum" : "Purchase Date"}<SortIcon col="purchaseDate" /></div>
              </TableHead>
              <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("expirationDate")}>
                <div className="flex items-center gap-1">{lang === "de" ? "Ablaufdatum" : "Expiration"}<SortIcon col="expirationDate" /></div>
              </TableHead>
              <TableHead>{lang === "de" ? "Beschreibung" : "Description"}</TableHead>
              <TableHead className="text-right">{lang === "de" ? "Eingang" : "Received"}</TableHead>
              <TableHead className="text-right">{lang === "de" ? "Verkauft" : "Sold"}</TableHead>
              <TableHead className="text-right">{lang === "de" ? "Verbleibend" : "Remaining"}</TableHead>
              <TableHead className="w-[90px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              [1,2,3,4,5].map(i => (
                <TableRow key={i}>
                  {[1,2,3,4,5,6,7,8,9].map(j => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  {lang === "de" ? "Keine Inventareinträge" : "No inventory records"}
                </TableCell>
              </TableRow>
            ) : (
              (() => {
                let lastGroupKey = "";
                return sorted.map(lot => {
                  const remaining = lot.quantityReceived - lot.quantityUsed;
                  const isLow = remaining <= 5 && lot.quantityReceived > 0;
                  const productName = (lang === "de" ? lot.productNameDe : lot.productNameEn) ?? "—";
                  const productDescription = (lang === "de"
                    ? lot.productDescriptionDe
                    : lot.productDescriptionEn) ?? "";
                  const expSoon = isExpiringSoon(lot.expirationDate);
                  const expired = isExpired(lot.expirationDate);
                  const groupKey = getGroupKey(lot);
                  const showDivider = groupKey !== lastGroupKey;
                  lastGroupKey = groupKey;

                  const isAvailable = remaining > 0;

                  return (
                    <Fragment key={lot.id}>
                      {showDivider && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={10} className="py-1.5 px-4">
                            <div className="flex items-center gap-2">
                              <span className={`text-[11px] font-semibold uppercase tracking-wider ${isAvailable ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>
                                {isAvailable
                                  ? (lang === "de" ? "Verfügbar" : "Available")
                                  : (lang === "de" ? "Nicht verfügbar" : "Unavailable")}
                              </span>
                              <span className="text-[11px] text-muted-foreground">·</span>
                              <span className="text-[11px] text-muted-foreground">{categoryLabel(lot.productCategory)}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow
                        data-state={selectedIds.has(lot.id) ? "selected" : undefined}
                        className={`cursor-pointer ${remaining === 0 ? "opacity-40" : ""}`}
                        onClick={() => toggleSelect(lot.id)}
                      >
                        <TableCell className="font-mono text-sm font-medium">{lot.lotNumber}</TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{productName}</div>
                          {lot.productSku && <div className="text-[11px] text-muted-foreground font-mono">{lot.productSku}</div>}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{formatDate(lot.purchaseDate)}</TableCell>
                        <TableCell>
                          {lot.expirationDate ? (
                            <div className="flex items-center gap-1.5">
                              <span className={`text-sm ${expired ? "text-destructive font-medium" : expSoon ? "text-orange-500 font-medium" : "text-muted-foreground"}`}>
                                {formatDate(lot.expirationDate)}
                              </span>
                              {expired && (
                                <span title={lang === "de" ? "Abgelaufen" : "Expired"}><AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" /></span>
                              )}
                              {!expired && expSoon && (
                                <span title={lang === "de" ? "Läuft bald ab (< 6 Monate)" : "Expiring soon (< 6 months)"}><Clock className="h-3.5 w-3.5 text-orange-500 shrink-0" /></span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[240px]">
                          <div className="whitespace-pre-wrap">{productDescription || "—"}</div>
                          {lot.description && (
                            <div className="mt-1 text-xs text-muted-foreground/70 whitespace-pre-wrap">
                              {lang === "de" ? "LOT-Notiz: " : "Lot note: "}{lot.description}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">{lot.quantityReceived}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{lot.quantityUsed}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className={`font-bold text-sm ${remaining === 0 ? "text-muted-foreground" : isLow ? "text-destructive" : "text-green-600"}`}>
                              {remaining}
                            </span>
                            {isLow && remaining > 0 && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                            {remaining === 0 && (
                              <Badge variant="outline" className="text-[10px] py-0">{lang === "de" ? "Leer" : "Empty"}</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" asChild title={lang === "de" ? "Produkt ansehen" : "View product"}>
                              <Link href={`/products/${lot.productId}`} onClick={e => e.stopPropagation()}><Eye className="h-4 w-4" /></Link>
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8"
                              onClick={e => { e.stopPropagation(); setEditLot(lot); }}
                              title={lang === "de" ? "Bearbeiten" : "Edit"}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={e => { e.stopPropagation(); handleDelete(lot.id); }}
                              title={lang === "de" ? "Löschen" : "Delete"}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                });
              })()
            )}
            {/* Products that have never had a lot recorded */}
            {!loading && filteredNoLots.map(p => {
              const productName = (lang === "de" ? p.nameDe : p.nameEn) ?? p.sku;
              const productDescription = (lang === "de" ? p.descriptionDe : p.descriptionEn) ?? "";
              return (
                <TableRow key={`nolot-${p.id}`} className="opacity-50">
                  <TableCell className="font-mono text-sm text-muted-foreground">—</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{productName}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{p.sku}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">—</TableCell>
                  <TableCell className="text-muted-foreground text-sm">—</TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {productDescription || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] py-0">
                      {lang === "de" ? "Kein Eintrag" : "No lots"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                  <TableCell className="text-right text-muted-foreground font-bold">0</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => openAddForProduct(p.id)}
                        title={lang === "de" ? "Los hinzufügen" : "Add lot"}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editLot} onOpenChange={open => { if (!open) setEditLot(null); }}>
        <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {lang === "de" ? "Inventar bearbeiten" : "Edit Inventory Lot"}
              {editLot && <span className="ml-2 text-sm font-mono text-muted-foreground">({editLot.lotNumber})</span>}
            </DialogTitle>
          </DialogHeader>
          {editLot && (
            <form key={editLot.id} onSubmit={handleEditSave} className="space-y-4 pt-4 overflow-y-auto flex-1 pr-1">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                  {lang === "de" ? "Produkt" : "Product"}
                </Label>
                <p className="text-sm font-medium border rounded-md px-3 py-2 bg-muted/40">
                  {(lang === "de" ? editLot.productNameDe : editLot.productNameEn) ?? "—"}
                  {editLot.productSku && <span className="ml-2 text-xs font-mono text-muted-foreground">{editLot.productSku}</span>}
                </p>
              </div>
              <div className="space-y-2">
                <Label>LOT {lang === "de" ? "Nummer" : "Number"} *</Label>
                <Input name="lotNumber" defaultValue={editLot.lotNumber} required />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Kaufdatum" : "Purchase Date"} *</Label>
                <Input type="date" name="purchaseDate" defaultValue={editLot.purchaseDate} required />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Ablaufdatum" : "Expiration Date"}</Label>
                <Input
                  type="date"
                  name="expirationDate"
                  defaultValue={editLot.expirationDate ?? ""}
                />
                <p className="text-xs text-muted-foreground">
                  {lang === "de"
                    ? "Leer lassen falls kein Ablaufdatum."
                    : "Leave blank if no expiration date."}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Menge eingegangen" : "Quantity Received"} *</Label>
                <Input type="number" min="0" step="1" name="quantityReceived" defaultValue={editLot.quantityReceived} required />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Verkauft (Menge)" : "Sold (Qty)"}</Label>
                <Input type="number" min="0" step="1" name="quantityUsed" defaultValue={editLot.quantityUsed} required />
                <p className="text-xs text-muted-foreground">
                  {lang === "de"
                    ? "Wird automatisch aus Rechnungen berechnet. Hier manuell überschreiben falls nötig."
                    : "Auto-calculated from invoices. Override manually here if needed."}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Beschreibung" : "Description"}</Label>
                <Textarea name="description" defaultValue={editLot.description ?? ""} className="h-20" placeholder={lang === "de" ? "Optionale Anmerkungen…" : "Optional notes…"} />
              </div>
              <DialogFooter className="mt-6 shrink-0">
                <Button variant="outline" type="button" onClick={() => setEditLot(null)}>{lang === "de" ? "Abbrechen" : "Cancel"}</Button>
                <Button type="submit" disabled={editSaving}>{lang === "de" ? "Speichern" : "Save"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
