import { useState, useEffect } from "react";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/utils";
import { adminDelete } from "@/lib/admin-fetch";
import {
  useListIrocProducts,
  useCreateIrocProduct,
  useUpdateIrocProduct,
  useDeleteIrocProduct,
  getListIrocProductsQueryKey,
  useListIrocProductGroups,
  useCreateIrocProductGroup,
  useUpdateIrocProductGroup,
  useDeleteIrocProductGroup,
  getListIrocProductGroupsQueryKey,
  type AppProductGroup,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, AlertTriangle, Pencil, Trash2, Loader2, ChevronDown, ChevronRight, Settings2, Eye } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { convertToEUR, PURCHASE_CURRENCIES, type ConversionResult } from "@/lib/currency";

/** Today's ISO date — used for ECB rate lookup on the product form (no lot date available). */
const TODAY = new Date().toISOString().split("T")[0];

/** Badge styling per group key; unknown groups fall back to outline. */
const CATEGORY_BADGE_STYLE: Record<string, { variant: "default" | "secondary" | "outline"; className?: string }> = {
  spirecut: { variant: "default" },
  ministem: { variant: "secondary" },
};
const SERVICE_BADGE_STYLE = { variant: "outline" as const, className: "border-violet-400/60 text-violet-600 dark:text-violet-400" };

function groupLabel(g: AppProductGroup | undefined, key: string, lang: string): string {
  if (g) return lang === "de" ? g.nameDe : g.nameEn;
  // Fallback labels for keys without a group row
  const legacy: Record<string, [string, string]> = {
    spirecut: ["Spirecut®", "Spirecut®"],
    ministem: ["MiniStem®", "MiniStem®"],
    cellenis: ["Cellenis\u00ae", "Cellenis\u00ae"],
    other: ["Other", "Sonstige"],
    services: ["Services", "Dienstleistungen"],
  };
  const l = legacy[key];
  return l ? (lang === "de" ? l[1] : l[0]) : key;
}

type ProductCategory = string;

interface EditState {
  id: number;
  sku: string;
  nameEn: string;
  nameDe: string;
  unitPrice: string;
  unitPriceBrutto: string;
  purchasePrice: string;
  purchaseDiscount: string;
  recommendedPrice: string;
  descriptionEn: string;
  descriptionDe: string;
  category: ProductCategory;
}

function CategoryPicker({ value, onChange, groups }: { value: ProductCategory; onChange: (v: ProductCategory) => void; groups: AppProductGroup[] }) {
  const { lang } = useLanguage();
  const keys = groups.length > 0 ? groups.map(g => g.key) : ["spirecut", "ministem", "cellenis", "services"];
  // Keep the current value selectable even if its group row disappeared
  if (value && !keys.includes(value)) keys.push(value);
  return (
    <div className="grid grid-cols-2 gap-2">
      {keys.map(cat => (
        <button
          key={cat}
          type="button"
          onClick={() => onChange(cat)}
          className={`rounded-lg border-2 px-2 py-2 text-xs font-medium transition-colors ${
            value === cat
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50"
          }`}
        >
          {groupLabel(groups.find(g => g.key === cat), cat, lang)}
        </button>
      ))}
    </div>
  );
}

// ── Product group management ─────────────────────────────────────────────────
interface GroupFormState {
  id: number | null; // null = creating
  key: string;
  nameEn: string;
  nameDe: string;
  sortOrder: string;
  isService: boolean;
}

function ManageGroupsDialog({ groups, lang }: { groups: AppProductGroup[]; lang: "en" | "de" }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<GroupFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListIrocProductGroupsQueryKey() });
    // A key rename changes product.category on all products in the group
    queryClient.invalidateQueries({ queryKey: getListIrocProductsQueryKey() });
  };
  const onError = (err: unknown) => {
    setError(err instanceof Error ? err.message : "Error");
  };
  const createGroup = useCreateIrocProductGroup({ mutation: { onSuccess: () => { invalidate(); setForm(null); setError(null); }, onError } });
  const updateGroup = useUpdateIrocProductGroup({ mutation: { onSuccess: () => { invalidate(); setForm(null); setError(null); }, onError } });
  const deleteGroup = useDeleteIrocProductGroup({ mutation: { onSuccess: () => { invalidate(); setError(null); }, onError } });

  const startCreate = () => {
    const maxOrder = groups.reduce((m, g) => Math.max(m, g.sortOrder), 0);
    setError(null);
    setForm({ id: null, key: "", nameEn: "", nameDe: "", sortOrder: String(maxOrder + 1), isService: false });
  };
  const startEdit = (g: AppProductGroup) => {
    setError(null);
    setForm({ id: g.id, key: g.key, nameEn: g.nameEn, nameDe: g.nameDe, sortOrder: String(g.sortOrder), isService: g.isService });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const data = {
      key: form.key.trim().toLowerCase(),
      nameEn: form.nameEn.trim(),
      nameDe: form.nameDe.trim(),
      sortOrder: parseInt(form.sortOrder) || 0,
      isService: form.isService,
    };
    if (form.id == null) createGroup.mutate({ data });
    else updateGroup.mutate({ id: form.id, data });
  };

  const editingOriginal = form?.id != null ? groups.find(g => g.id === form.id) : undefined;
  const keyChanged = editingOriginal != null && form != null && form.key.trim().toLowerCase() !== editingOriginal.key;

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) { setForm(null); setError(null); } }}>
      <DialogTrigger asChild>
        <Button variant="outline"><Settings2 className="h-4 w-4 mr-2" />{lang === "de" ? "Gruppen verwalten" : "Manage Groups"}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{lang === "de" ? "Produktgruppen verwalten" : "Manage Product Groups"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto flex-1 pr-1">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {form == null ? (
            <>
              <div className="border rounded-md divide-y">
                {groups.map(g => (
                  <div key={g.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{lang === "de" ? g.nameDe : g.nameEn}</span>
                        {g.isService && (
                          <Badge variant="outline" className="text-[10px] border-violet-400/60 text-violet-600 dark:text-violet-400">
                            {lang === "de" ? "Dienstleistung" : "Service"}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{g.key}</div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(g)} title={lang === "de" ? "Bearbeiten" : "Edit"}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      disabled={deleteGroup.isPending}
                      onClick={() => {
                        if (confirm(lang === "de" ? `Gruppe "${g.nameDe}" löschen?` : `Delete group "${g.nameEn}"?`)) {
                          deleteGroup.mutate({ id: g.id });
                        }
                      }}
                      title={lang === "de" ? "Löschen" : "Delete"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" onClick={startCreate} className="w-full">
                <Plus className="h-4 w-4 mr-2" />{lang === "de" ? "Neue Gruppe" : "New Group"}
              </Button>
              <p className="text-xs text-muted-foreground">
                {lang === "de"
                  ? "Gruppen ohne Produkte können gelöscht werden. Namensänderungen erscheinen automatisch in der Produktliste, in Berichten und im Bestellformular der Website."
                  : "Only empty groups can be deleted. Name changes automatically appear in the product list, reports, and the website order form."}
              </p>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label>{lang === "de" ? "Schlüssel (technisch)" : "Key (technical)"} *</Label>
                <Input value={form.key} onChange={e => setForm(fm => fm ? { ...fm, key: e.target.value } : fm)} required
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" placeholder="e.g. accessories" className="font-mono" />
                {keyChanged && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {lang === "de"
                      ? "Achtung: Änderung des Schlüssels wird auf alle Produkte dieser Gruppe übertragen."
                      : "Note: changing the key updates all products in this group."}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Name (EN) *</Label>
                  <Input value={form.nameEn} onChange={e => setForm(fm => fm ? { ...fm, nameEn: e.target.value } : fm)} required />
                </div>
                <div className="space-y-2">
                  <Label>Name (DE) *</Label>
                  <Input value={form.nameDe} onChange={e => setForm(fm => fm ? { ...fm, nameDe: e.target.value } : fm)} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Sortierung" : "Sort Order"}</Label>
                  <Input type="number" value={form.sortOrder} onChange={e => setForm(fm => fm ? { ...fm, sortOrder: e.target.value } : fm)} />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm cursor-pointer">
                  <Checkbox checked={form.isService} onCheckedChange={v => setForm(fm => fm ? { ...fm, isService: v === true } : fm)} />
                  {lang === "de" ? "Dienstleistungsgruppe (kein Lager, nicht bestellbar)" : "Service group (no stock, not orderable)"}
                </label>
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => { setForm(null); setError(null); }}>{t("cancel", lang)}</Button>
                <Button type="submit" disabled={createGroup.isPending || updateGroup.isPending}>{t("save", lang)}</Button>
              </DialogFooter>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsList() {
  const { lang } = useLanguage();
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { data: products, isLoading } = useListIrocProducts();
  const { data: groupsData } = useListIrocProductGroups();
  const groups = groupsData ?? [];
  const groupByKey = (key: string) => groups.find(g => g.key === key);
  const isServiceGroup = (key: string) => groupByKey(key)?.isService ?? key === "services";
  // Collapsed group keys — click a group header to toggle
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => setCollapsedGroups(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next;
  });
  const queryClient = useQueryClient();

  // ── Create ──────────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameDe, setNameDe] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [unitPriceBrutto, setUnitPriceBrutto] = useState("");
  // purchaseRawPrice = value the user types; purchaseCurrency = chosen currency
  const [purchaseRawPrice, setPurchaseRawPrice] = useState("");
  const [purchaseCurrency, setPurchaseCurrency] = useState("EUR");
  const [purchaseConversion, setPurchaseConversion] = useState<ConversionResult | null>(null);
  const [purchaseConverting, setPurchaseConverting] = useState(false);
  const [purchaseDiscount, setPurchaseDiscount] = useState("");
  const [recommendedPrice, setRecommendedPrice] = useState("");
  const [category, setCategory] = useState<ProductCategory>("cellenis");

  // Discount applied to raw price in original currency first, then converted to EUR.
  const createDiscount = parseFloat(purchaseDiscount || "0") || 0;
  // After the change: purchaseConversion.eurAmount already IS the effective EUR cost.
  const createEffectiveCost = purchaseConversion?.eurAmount ?? null;

  // Currency conversion for Create form — discount applied BEFORE conversion
  useEffect(() => {
    const raw = parseFloat(purchaseRawPrice);
    if (!raw || isNaN(raw) || raw <= 0) { setPurchaseConversion(null); return; }
    const disc = parseFloat(purchaseDiscount || "0") || 0;
    const discountedRaw = disc > 0 ? raw * (1 - disc / 100) : raw;
    if (purchaseCurrency === "EUR") {
      setPurchaseConversion({ eurAmount: discountedRaw, rateDate: TODAY, rate: 1 });
      return;
    }
    let cancelled = false;
    setPurchaseConverting(true);
    const timer = setTimeout(async () => {
      const result = await convertToEUR(discountedRaw, purchaseCurrency, TODAY);
      if (!cancelled) { setPurchaseConversion(result); setPurchaseConverting(false); }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); setPurchaseConverting(false); };
  }, [purchaseRawPrice, purchaseCurrency, purchaseDiscount]);

  const createMutation = useCreateIrocProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListIrocProductsQueryKey() });
        setCreateOpen(false);
        setSku(""); setNameEn(""); setNameDe(""); setUnitPrice(""); setUnitPriceBrutto("");
        setPurchaseRawPrice(""); setPurchaseCurrency("EUR"); setPurchaseConversion(null);
        setPurchaseDiscount(""); setRecommendedPrice(""); setCategory("cellenis");
      }
    }
  });

  // A non-EUR purchase price may only be saved once a conversion result exists;
  // otherwise a foreign amount would be stored as the EUR cost.
  const createNeedsConversion =
    purchaseCurrency !== "EUR" && parseFloat(purchaseRawPrice) > 0 && purchaseConversion == null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (createNeedsConversion || purchaseConverting) return;
    // Store effective EUR cost (gross EUR × (1 − discount)) in purchasePrice
    const storedPurchasePrice = createEffectiveCost != null
      ? createEffectiveCost.toFixed(2)
      : (purchaseRawPrice || undefined);
    createMutation.mutate({
      data: {
        sku, nameEn, nameDe, unitPrice,
        unitPriceBrutto: unitPriceBrutto || undefined,
        purchasePrice: storedPurchasePrice,
        purchaseCurrency,
        purchaseRawPrice: purchaseRawPrice || undefined,
        purchaseDiscount: purchaseDiscount || undefined,
        recommendedPrice: recommendedPrice || undefined,
        stockQuantity: 0, lowStockThreshold: 10, category,
      }
    });
  };

  // ── Edit ────────────────────────────────────────────────────────────────────
  const [editState, setEditState] = useState<EditState | null>(null);
  // Separate currency/raw-price state for the edit form (not inside editState object)
  const [editPurchaseCurrency, setEditPurchaseCurrency] = useState("EUR");
  const [editPurchaseRawPrice, setEditPurchaseRawPrice] = useState("");
  const [editPurchaseConversion, setEditPurchaseConversion] = useState<ConversionResult | null>(null);
  const [editPurchaseConverting, setEditPurchaseConverting] = useState(false);

  // Discount applied to raw price in original currency first, then converted to EUR.
  const editDiscount = parseFloat(editState?.purchaseDiscount || "0") || 0;
  // editPurchaseConversion.eurAmount already IS the effective EUR cost.
  const editEffectiveCost = editPurchaseConversion?.eurAmount ?? null;

  // Currency conversion for Edit form — discount applied BEFORE conversion
  useEffect(() => {
    const raw = parseFloat(editPurchaseRawPrice);
    if (!raw || isNaN(raw) || raw <= 0) { setEditPurchaseConversion(null); return; }
    const disc = parseFloat(editState?.purchaseDiscount || "0") || 0;
    const discountedRaw = disc > 0 ? raw * (1 - disc / 100) : raw;
    if (editPurchaseCurrency === "EUR") {
      setEditPurchaseConversion({ eurAmount: discountedRaw, rateDate: TODAY, rate: 1 });
      return;
    }
    let cancelled = false;
    setEditPurchaseConverting(true);
    const timer = setTimeout(async () => {
      const result = await convertToEUR(discountedRaw, editPurchaseCurrency, TODAY);
      if (!cancelled) { setEditPurchaseConversion(result); setEditPurchaseConverting(false); }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); setEditPurchaseConverting(false); };
  }, [editPurchaseRawPrice, editPurchaseCurrency, editState?.purchaseDiscount]);

  const updateMutation = useUpdateIrocProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListIrocProductsQueryKey() });
        setEditState(null);
        setEditPurchaseRawPrice(""); setEditPurchaseCurrency("EUR"); setEditPurchaseConversion(null);
      }
    }
  });

  // Snapshot of the purchase inputs as they were when the edit form opened, so an
  // unrelated edit doesn't silently reprice the stored EUR cost at today's rate.
  const [editOpenedPurchase, setEditOpenedPurchase] = useState<
    { raw: string; currency: string; discount: string; purchasePrice: string } | null
  >(null);

  const openEdit = (product: NonNullable<typeof products>[number]) => {
    const storedCurrency = product.purchaseCurrency || "EUR";
    const storedRaw = parseFloat(product.purchaseRawPrice ?? "0") || 0;
    if (storedRaw > 0) {
      // Restore exactly what the user entered: raw price in its original currency.
      // The conversion effect recomputes the EUR value automatically.
      setEditPurchaseCurrency(storedCurrency);
      setEditPurchaseRawPrice(storedRaw.toFixed(2));
      setEditPurchaseConversion(null);
    } else {
      // Legacy products without a stored raw price: back-calculate gross EUR
      // from the stored effective cost + discount.
      const effectiveCost = parseFloat(product.purchasePrice ?? "0") || 0;
      const disc = parseFloat(product.purchaseDiscount ?? "0") || 0;
      const grossPrice = disc > 0 && effectiveCost > 0
        ? effectiveCost / (1 - disc / 100)
        : effectiveCost;
      setEditPurchaseCurrency(storedCurrency);
      setEditPurchaseRawPrice(grossPrice > 0 ? grossPrice.toFixed(2) : "");
      setEditPurchaseConversion(grossPrice > 0 && storedCurrency === "EUR"
        ? { eurAmount: grossPrice, rateDate: TODAY, rate: 1 }
        : null);
    }
    setEditOpenedPurchase({
      raw: storedRaw > 0 ? storedRaw.toFixed(2) : "",
      currency: storedCurrency,
      discount: product.purchaseDiscount || "",
      purchasePrice: product.purchasePrice || "",
    });
    setEditState({
      id: product.id,
      sku: product.sku,
      nameEn: product.nameEn,
      nameDe: product.nameDe,
      unitPrice: product.unitPrice,
      unitPriceBrutto: product.unitPriceBrutto || "",
      purchasePrice: product.purchasePrice || "",
      purchaseDiscount: product.purchaseDiscount || "",
      recommendedPrice: product.recommendedPrice || "",
      descriptionEn: product.descriptionEn || "",
      descriptionDe: product.descriptionDe || "",
      category: product.category,
    });
  };

  // True when the user hasn't touched raw price, currency, or discount since opening
  // the form — in that case the stored EUR cost is preserved as-is (no repricing).
  const editPurchaseUntouched =
    editOpenedPurchase != null &&
    editOpenedPurchase.raw !== "" &&
    editPurchaseRawPrice === editOpenedPurchase.raw &&
    editPurchaseCurrency === editOpenedPurchase.currency &&
    (editState?.purchaseDiscount || "") === editOpenedPurchase.discount;

  const editNeedsConversion =
    !editPurchaseUntouched &&
    editPurchaseCurrency !== "EUR" &&
    parseFloat(editPurchaseRawPrice) > 0 &&
    editPurchaseConversion == null;

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editState) return;
    if (editNeedsConversion || (!editPurchaseUntouched && editPurchaseConverting)) return;
    // Store effective EUR cost (gross EUR × (1 − discount)) in purchasePrice.
    // If the purchase inputs are untouched, keep the historic EUR value instead of
    // repricing it at today's exchange rate.
    const storedPurchasePrice = editPurchaseUntouched
      ? (editOpenedPurchase!.purchasePrice || undefined)
      : editEffectiveCost != null
        ? editEffectiveCost.toFixed(2)
        : (editState.purchasePrice || undefined);
    updateMutation.mutate({
      id: editState.id,
      data: {
        sku: editState.sku,
        nameEn: editState.nameEn,
        nameDe: editState.nameDe,
        unitPrice: editState.unitPrice,
        // An empty gross price must explicitly clear an existing value.
        unitPriceBrutto: editState.unitPriceBrutto || null,
        purchasePrice: storedPurchasePrice,
        purchaseCurrency: editPurchaseCurrency,
        purchaseRawPrice: editPurchaseRawPrice || undefined,
        purchaseDiscount: editState.purchaseDiscount || undefined,
        recommendedPrice: editState.recommendedPrice || undefined,
        descriptionEn: editState.descriptionEn || undefined,
        descriptionDe: editState.descriptionDe || undefined,
        category: editState.category,
      }
    });
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const deleteMutation = useDeleteIrocProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListIrocProductsQueryKey() });
        setDeleteId(null);
      }
    }
  });

  const filtered = products?.filter(p =>
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    p.nameEn.toLowerCase().includes(search.toLowerCase()) ||
    p.nameDe.toLowerCase().includes(search.toLowerCase())
  );

  const LEGACY_ORDER: Record<string, number> = { spirecut: 0, ministem: 1, cellenis: 2, other: 2.5, services: 3 };
  const orderOf = (key: string) => {
    const g = groupByKey(key);
    if (g) return g.sortOrder;
    return (LEGACY_ORDER[key] ?? 90) + 100; // groups without a row sort last, in legacy order
  };
  const sorted = [...(filtered ?? [])].sort((a, b) => {
    const keyA = a.category ?? "cellenis";
    const keyB = b.category ?? "cellenis";
    const catA = orderOf(keyA);
    const catB = orderOf(keyB);
    if (catA !== catB) return catA - catB;
    // Stable tie-breaker so groups with equal sortOrder never interleave
    if (keyA !== keyB) return keyA.localeCompare(keyB);
    const nameA = (lang === "de" ? a.nameDe : a.nameEn).toLowerCase();
    const nameB = (lang === "de" ? b.nameDe : b.nameEn).toLowerCase();
    return nameA.localeCompare(nameB);
  });

  // Bulk select helpers
  const allIds = sorted.map(p => p.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const toggleSelect = (id: number) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(allIds));

  const handleBulkDelete = async () => {
    if (!token || selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} product(s)? This cannot be undone.`)) return;
    setBulkDeleting(true);
    for (const id of selectedIds) await adminDelete(`/api/iroc/products/${id}`, token).catch(() => {});
    setSelectedIds(new Set());
    setBulkDeleting(false);
    queryClient.invalidateQueries({ queryKey: getListIrocProductsQueryKey() });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("products", lang)}</h1>
        <div className="flex items-center gap-2">
        <ManageGroupsDialog groups={groups} lang={lang} />
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />{t("new_product", lang)}</Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <DialogTitle>{t("new_product", lang)}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-4 overflow-y-auto flex-1 pr-1">
              <div className="space-y-2">
                <Label>{t("sku", lang)} *</Label>
                <Input value={sku} onChange={e => setSku(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Name (EN) *</Label>
                <Input value={nameEn} onChange={e => setNameEn(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Name (DE) *</Label>
                <Input value={nameDe} onChange={e => setNameDe(e.target.value)} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t("unit_price", lang)} Netto *</Label>
                  <Input type="number" step="0.01" min="0" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Brutto {lang === "de" ? "Preis" : "Price"}</Label>
                  <Input type="number" step="0.01" min="0" value={unitPriceBrutto} onChange={e => setUnitPriceBrutto(e.target.value)} />
                </div>
              </div>
              {/* ── Purchase price with currency conversion ── */}
              <div className="space-y-2">
                <Label>{lang === "de" ? "Einkaufspreis (Listenpreis)" : "Purchase Price (list price)"}</Label>
                <div className="flex gap-2">
                  <Select value={purchaseCurrency} onValueChange={v => { setPurchaseCurrency(v); setPurchaseConversion(null); }}>
                    <SelectTrigger className="w-[100px] shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PURCHASE_CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" step="0.01" min="0" value={purchaseRawPrice}
                    onChange={e => setPurchaseRawPrice(e.target.value)} placeholder="0.00" />
                </div>
                {/* EUR conversion box — discount applied in original currency first, then converted */}
                {purchaseCurrency !== "EUR" && purchaseRawPrice && parseFloat(purchaseRawPrice) > 0 && (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-1">
                    {/* Step 1: show discount applied in original currency */}
                    {createDiscount > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>{lang === "de" ? `Rabatt (${createDiscount}%) in ${purchaseCurrency}:` : `Discount (${createDiscount}%) in ${purchaseCurrency}:`}</span>
                        <span className="font-medium">
                          {parseFloat(purchaseRawPrice).toFixed(2)} × (1 − {createDiscount}%) = <span className="text-foreground font-semibold">{(parseFloat(purchaseRawPrice) * (1 - createDiscount / 100)).toFixed(2)} {purchaseCurrency}</span>
                        </span>
                      </div>
                    )}
                    {/* Step 2: converted discounted amount to EUR */}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{lang === "de" ? "In Euro (ECB-Kurs):" : "In Euro (ECB rate):"}</span>
                      <span className="font-semibold text-foreground flex items-center gap-1">
                        {purchaseConverting
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> {lang === "de" ? "Lade…" : "Loading…"}</>
                          : purchaseConversion
                            ? <>€ {purchaseConversion.eurAmount.toFixed(2)}
                                <span className="text-muted-foreground font-normal ml-1">
                                  (1 {purchaseCurrency} = {purchaseConversion.rate.toFixed(5)} EUR · {purchaseConversion.rateDate})
                                </span>
                              </>
                            : <span className="text-destructive">{lang === "de" ? "Kurs n. verfügbar" : "Rate unavailable"}</span>}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Herstellerrabatt %" : "Manufacturer Discount %"}</Label>
                  <div className="relative">
                    <Input type="number" step="0.1" min="0" max="100" value={purchaseDiscount} onChange={e => setPurchaseDiscount(e.target.value)} className="pr-7" placeholder="0.0" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Effektiver EK (in €, nach Rabatt)" : "Effective Cost (€, after discount)"}</Label>
                  <div className="h-10 px-3 flex items-center rounded-md bg-muted/50 border text-sm font-semibold text-primary">
                    {createEffectiveCost != null
                      ? `€ ${createEffectiveCost.toFixed(2)}`
                      : <span className="text-muted-foreground font-normal">—</span>}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Empfohlener Verkaufspreis (netto)" : "Recommended Sell Price (net)"}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
                  <Input type="number" step="0.01" min="0" value={recommendedPrice} onChange={e => setRecommendedPrice(e.target.value)} className="pl-7" placeholder="0.00" />
                </div>
                <p className="text-xs text-muted-foreground">{lang === "de" ? "Unterschreitung beim Rechnungsstellen erzeugt eine Warnung." : "A warning is shown in invoices if sold below this price."}</p>
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Produktgruppe" : "Product Group"} *</Label>
                <CategoryPicker value={category} onChange={setCategory} groups={groups} />
              </div>
              <DialogFooter className="mt-6 shrink-0">
                <Button variant="outline" type="button" onClick={() => setCreateOpen(false)}>{t("cancel", lang)}</Button>
                <Button type="submit" disabled={createMutation.isPending || createNeedsConversion || purchaseConverting}>{t("save", lang)}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center space-x-2 bg-card border rounded-md p-1 max-w-sm">
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
            <Button size="sm" variant="destructive" disabled={bulkDeleting} onClick={handleBulkDelete} className="gap-1.5 h-7">
              <Trash2 className="h-3.5 w-3.5" />
              {bulkDeleting ? (lang === "de" ? "Lösche…" : "Deleting…") : `${lang === "de" ? "Löschen" : "Delete"} (${selectedIds.size})`}
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
              <TableHead className="w-[120px]">{t("sku", lang)}</TableHead>
              <TableHead>{t("name", lang)}</TableHead>
              <TableHead>{lang === "de" ? "Gruppe" : "Group"}</TableHead>
              <TableHead className="text-right">{t("price", lang)} {lang === "de" ? "Netto" : "Net"}</TableHead>
              <TableHead className="text-right">{lang === "de" ? "Brutto" : "Gross"}</TableHead>
              <TableHead className="text-right">{lang === "de" ? "Einkaufspreis" : "Purchase Price"}</TableHead>
              <TableHead className="text-right">{t("stock", lang)}</TableHead>
              <TableHead className="w-[120px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1,2,3,4,5].map(i => (
                <TableRow key={i}>
                  {[1,2,3,4,5,6,7,8].map(j => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {t("no_data", lang)}
                </TableCell>
              </TableRow>
            ) : (
              (() => {
                let lastCat: string | null = null;
                const countByCat = sorted.reduce<Record<string, number>>((acc, p) => {
                  const k = p.category ?? "cellenis"; acc[k] = (acc[k] ?? 0) + 1; return acc;
                }, {});
                return sorted.flatMap(product => {
                const isLowStock = product.stockQuantity <= product.lowStockThreshold;
                const cat = product.category ?? "cellenis";
                const group = groupByKey(cat);
                const catInfo = {
                  label: groupLabel(group, cat, lang),
                  ...(isServiceGroup(cat) ? SERVICE_BADGE_STYLE : (CATEGORY_BADGE_STYLE[cat] ?? { variant: "outline" as const })),
                };
                const isCollapsed = collapsedGroups.has(cat);
                const divider = cat !== lastCat ? (() => { lastCat = cat; return (
                  <TableRow
                    key={`grp-${cat}`}
                    className="bg-muted/30 hover:bg-muted/50 border-t cursor-pointer select-none"
                    onClick={() => toggleGroup(cat)}
                  >
                    <TableCell colSpan={8} className="py-1.5 px-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70">
                      <span className="flex items-center gap-1.5">
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {catInfo.label}
                        <span className="font-normal normal-case tracking-normal text-muted-foreground/60">({countByCat[cat] ?? 0})</span>
                      </span>
                    </TableCell>
                  </TableRow>
                ); })() : null;
                lastCat = cat;
                if (isCollapsed) return divider ? [divider] : [];
                const row = (
                  <TableRow
                    key={product.id}
                    data-state={selectedIds.has(product.id) ? "selected" : undefined}
                    onClick={() => toggleSelect(product.id)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-medium font-mono text-xs">{product.sku}</TableCell>
                    <TableCell>
                      <Link
                        href={`/products/${product.id}`}
                        className="hover:underline font-medium"
                        onClick={e => e.stopPropagation()}
                      >
                        {lang === "de" ? product.nameDe : product.nameEn}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={catInfo.variant} className={`text-[11px]${catInfo.className ? " " + catInfo.className : ""}`}>{catInfo.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatMoney(product.unitPrice)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {product.unitPriceBrutto ? formatMoney(product.unitPriceBrutto) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {product.purchasePrice && parseFloat(product.purchasePrice) > 0
                        ? formatMoney(product.purchasePrice)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {isServiceGroup(product.category ?? "cellenis") ? (
                        <span className="text-muted-foreground text-sm">—</span>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <span className={`font-medium ${isLowStock ? "text-destructive" : ""}`}>
                            {product.stockQuantity}
                          </span>
                          {isLowStock && (
                            <Badge variant="destructive" className="flex items-center gap-1 text-[10px] py-0">
                              <AlertTriangle className="h-3 w-3" />
                              {t("low_stock", lang)}
                            </Badge>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild title={lang === "de" ? "Ansehen" : "View"}>
                          <Link href={`/products/${product.id}`} onClick={e => e.stopPropagation()}><Eye className="h-4 w-4" /></Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={e => { e.stopPropagation(); openEdit(product); }}
                          title={lang === "de" ? "Bearbeiten" : "Edit"}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={e => { e.stopPropagation(); setDeleteId(product.id); }}
                          title={lang === "de" ? "Löschen" : "Delete"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
                return divider ? [divider, row] : [row];
                });
              })()
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* ── Edit Dialog ───────────────────────────────────────────────────────── */}
      <Dialog open={!!editState} onOpenChange={open => { if (!open) setEditState(null); }}>
        <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden max-w-lg">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {lang === "de" ? "Produkt bearbeiten" : "Edit Product"}
              {editState && <span className="ml-2 text-sm font-mono text-muted-foreground">({editState.sku})</span>}
            </DialogTitle>
          </DialogHeader>
          {editState && (
            <form onSubmit={handleUpdate} className="space-y-4 pt-2 overflow-y-auto flex-1 pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t("sku", lang)} *</Label>
                  <Input value={editState.sku} onChange={e => setEditState(s => s ? { ...s, sku: e.target.value } : s)} required />
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Gruppe" : "Group"}</Label>
                  <CategoryPicker value={editState.category} onChange={v => setEditState(s => s ? { ...s, category: v } : s)} groups={groups} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Name (EN) *</Label>
                  <Input value={editState.nameEn} onChange={e => setEditState(s => s ? { ...s, nameEn: e.target.value } : s)} required />
                </div>
                <div className="space-y-2">
                  <Label>Name (DE) *</Label>
                  <Input value={editState.nameDe} onChange={e => setEditState(s => s ? { ...s, nameDe: e.target.value } : s)} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t("unit_price", lang)} Netto *</Label>
                  <Input type="number" step="0.01" min="0" value={editState.unitPrice}
                    onChange={e => setEditState(s => s ? { ...s, unitPrice: e.target.value } : s)} required />
                </div>
                <div className="space-y-2">
                  <Label>Brutto {lang === "de" ? "Preis" : "Price"}</Label>
                  <Input type="number" step="0.01" min="0" value={editState.unitPriceBrutto}
                    onChange={e => setEditState(s => s ? { ...s, unitPriceBrutto: e.target.value } : s)} />
                </div>
              </div>
              {/* ── Purchase price with currency conversion ── */}
              <div className="space-y-2">
                <Label>{lang === "de" ? "Einkaufspreis (Listenpreis)" : "Purchase Price (list price)"}</Label>
                <div className="flex gap-2">
                  <Select value={editPurchaseCurrency} onValueChange={v => { setEditPurchaseCurrency(v); setEditPurchaseConversion(null); }}>
                    <SelectTrigger className="w-[100px] shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PURCHASE_CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" step="0.01" min="0" value={editPurchaseRawPrice}
                    onChange={e => setEditPurchaseRawPrice(e.target.value)} placeholder="0.00" />
                </div>
                {/* EUR conversion box — discount applied in original currency first, then converted */}
                {editPurchaseCurrency !== "EUR" && editPurchaseRawPrice && parseFloat(editPurchaseRawPrice) > 0 && (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-1">
                    {/* Step 1: discount in original currency */}
                    {editDiscount > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>{lang === "de" ? `Rabatt (${editDiscount}%) in ${editPurchaseCurrency}:` : `Discount (${editDiscount}%) in ${editPurchaseCurrency}:`}</span>
                        <span className="font-medium">
                          {parseFloat(editPurchaseRawPrice).toFixed(2)} × (1 − {editDiscount}%) = <span className="text-foreground font-semibold">{(parseFloat(editPurchaseRawPrice) * (1 - editDiscount / 100)).toFixed(2)} {editPurchaseCurrency}</span>
                        </span>
                      </div>
                    )}
                    {/* Step 2: convert discounted amount to EUR */}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{lang === "de" ? "In Euro (ECB-Kurs):" : "In Euro (ECB rate):"}</span>
                      <span className="font-semibold text-foreground flex items-center gap-1">
                        {editPurchaseConverting
                          ? <><Loader2 className="h-3 w-3 animate-spin" /> {lang === "de" ? "Lade…" : "Loading…"}</>
                          : editPurchaseConversion
                            ? <>€ {editPurchaseConversion.eurAmount.toFixed(2)}
                                <span className="text-muted-foreground font-normal ml-1">
                                  (1 {editPurchaseCurrency} = {editPurchaseConversion.rate.toFixed(5)} EUR · {editPurchaseConversion.rateDate})
                                </span>
                              </>
                            : <span className="text-destructive">{lang === "de" ? "Kurs n. verfügbar" : "Rate unavailable"}</span>}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Herstellerrabatt %" : "Manufacturer Discount %"}</Label>
                  <div className="relative">
                    <Input type="number" step="0.1" min="0" max="100" value={editState.purchaseDiscount}
                      onChange={e => setEditState(s => s ? { ...s, purchaseDiscount: e.target.value } : s)}
                      className="pr-7" placeholder="0.0" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Effektiver EK (in €, nach Rabatt)" : "Effective Cost (€, after discount)"}</Label>
                  <div className="h-10 px-3 flex items-center rounded-md bg-muted/50 border text-sm font-semibold text-primary">
                    {editEffectiveCost != null
                      ? `€ ${editEffectiveCost.toFixed(2)}`
                      : <span className="text-muted-foreground font-normal">—</span>}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Empfohlener Verkaufspreis (netto)" : "Recommended Sell Price (net)"}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
                  <Input type="number" step="0.01" min="0" value={editState.recommendedPrice}
                    onChange={e => setEditState(s => s ? { ...s, recommendedPrice: e.target.value } : s)}
                    className="pl-7" placeholder="0.00" />
                </div>
                <p className="text-xs text-muted-foreground">{lang === "de" ? "Unterschreitung beim Rechnungsstellen erzeugt eine Warnung." : "A warning is shown in invoices if sold below this price."}</p>
              </div>
              <div className="space-y-2">
                <Label>Description (EN)</Label>
                <Textarea value={editState.descriptionEn} rows={2}
                  onChange={e => setEditState(s => s ? { ...s, descriptionEn: e.target.value } : s)} />
              </div>
              <div className="space-y-2">
                <Label>Description (DE)</Label>
                <Textarea value={editState.descriptionDe} rows={2}
                  onChange={e => setEditState(s => s ? { ...s, descriptionDe: e.target.value } : s)} />
              </div>
              <DialogFooter className="mt-4 shrink-0">
                <Button variant="outline" type="button" onClick={() => setEditState(null)}>{t("cancel", lang)}</Button>
                <Button type="submit" disabled={updateMutation.isPending || editNeedsConversion || (!editPurchaseUntouched && editPurchaseConverting)}>{t("save", lang)}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ─────────────────────────────────────────────── */}
      <Dialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lang === "de" ? "Produkt löschen?" : "Delete Product?"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            {lang === "de"
              ? "Dieses Produkt wird dauerhaft gelöscht. Bestehende Rechnungspositionen bleiben erhalten."
              : "This product will be permanently deleted. Existing invoice line items will be preserved."}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t("cancel", lang)}</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => { if (deleteId !== null) deleteMutation.mutate({ id: deleteId }); }}
            >
              {lang === "de" ? "Löschen" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
