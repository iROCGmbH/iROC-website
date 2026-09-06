import { useState } from "react";
import { useProductGroupHelpers } from "@/lib/product-groups";
import { useLocation, useParams } from "wouter";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/utils";
import {
  useGetIrocProduct, useDeleteIrocProduct, useAdjustIrocProductStock,
  useUpdateIrocProduct, getGetIrocProductQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Trash2, Package, AlertTriangle, Plus, Minus, Pencil } from "lucide-react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";

// Visual styles per known group key; unknown keys get the neutral fallback.
const CATEGORY_BG: Record<string, string> = {
  spirecut: "bg-blue-50 text-blue-700 border-blue-200",
  ministem: "bg-green-50 text-green-700 border-green-200",
  cellenis: "bg-amber-50 text-amber-700 border-amber-200",
  services: "border-violet-400/60 text-violet-600",
};
const FALLBACK_KEYS = ["spirecut", "ministem", "cellenis", "services"];
const CATEGORY_BADGE_STYLE: Record<string, { variant: "default" | "secondary" | "outline"; className?: string }> = {
  spirecut: { variant: "default" },
  ministem: { variant: "secondary" },
  services: { variant: "outline", className: "border-violet-400/60 text-violet-600 bg-violet-50" },
};

interface EditForm {
  nameEn: string;
  nameDe: string;
  sku: string;
  unitPrice: string;
  descriptionEn: string;
  descriptionDe: string;
  lowStockThreshold: string;
  category: string;
}

export default function ProductDetail() {
  const { id } = useParams();
  const productId = parseInt(id || "0", 10);
  const { lang } = useLanguage();
  const { groups, label: groupLabel } = useProductGroupHelpers(lang);
  const categoryOptions = (groups.length > 0
    ? [...groups].sort((a, b) => a.sortOrder - b.sortOrder).map(g => g.key)
    : FALLBACK_KEYS
  ).map(key => ({
    value: key,
    label: groupLabel(key),
    bg: CATEGORY_BG[key] ?? "bg-muted text-foreground border-border",
  }));
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: product, isLoading } = useGetIrocProduct(productId, {
    query: { enabled: !!productId, queryKey: getGetIrocProductQueryKey(productId) }
  });

  const deleteMutation = useDeleteIrocProduct({
    mutation: { onSuccess: () => setLocation("/products") }
  });

  const adjustStockMutation = useAdjustIrocProductStock({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetIrocProductQueryKey(productId) });
        setStockOpen(false);
      }
    }
  });

  const updateMutation = useUpdateIrocProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetIrocProductQueryKey(productId) });
        setEditOpen(false);
      }
    }
  });

  const [stockOpen, setStockOpen] = useState(false);
  const [newStock, setNewStock] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    nameEn: "", nameDe: "", sku: "", unitPrice: "",
    descriptionEn: "", descriptionDe: "",
    lowStockThreshold: "", category: "cellenis",
  });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-[400px]" /></div>;
  }

  if (!product) return <div>{lang === "de" ? "Produkt nicht gefunden" : "Product not found"}</div>;

  const isLowStock = product.stockQuantity <= product.lowStockThreshold;
  const productCategory = product.category;
  const catStyle = CATEGORY_BADGE_STYLE[productCategory] ?? { variant: "outline" as const };
  const isService = productCategory === "services";

  const openEditDialog = () => {
    setEditForm({
      nameEn:            product.nameEn ?? "",
      nameDe:            product.nameDe ?? "",
      sku:               product.sku ?? "",
      unitPrice:         product.unitPrice ?? "",
      descriptionEn:     product.descriptionEn ?? "",
      descriptionDe:     product.descriptionDe ?? "",
      lowStockThreshold: product.lowStockThreshold?.toString() ?? "0",
      category:          product.category,
    });
    setEditOpen(true);
  };

  const handleSaveEdit = () => {
    updateMutation.mutate({
      id: productId,
      data: {
        nameEn:            editForm.nameEn.trim(),
        nameDe:            editForm.nameDe.trim(),
        sku:               editForm.sku.trim(),
        unitPrice:         editForm.unitPrice.trim(),
        descriptionEn:     editForm.descriptionEn.trim() || null,
        descriptionDe:     editForm.descriptionDe.trim() || null,
        lowStockThreshold: parseInt(editForm.lowStockThreshold || "0", 10),
        category:          editForm.category,
      }
    });
  };

  const handleAdjustStock = (e: React.FormEvent) => {
    e.preventDefault();
    adjustStockMutation.mutate({ id: productId, data: { quantity: parseInt(newStock, 10) } });
  };

  const field = (k: keyof EditForm) => ({
    value: editForm[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setEditForm(f => ({ ...f, [k]: e.target.value })),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/products"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {lang === "de" ? product.nameDe : product.nameEn}
            </h1>
            <div className="text-sm font-mono text-muted-foreground mt-1 flex items-center gap-2">
              <Package className="h-3 w-3" /> SKU: {product.sku}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openEditDialog}>
            <Pencil className="h-4 w-4 mr-2" />{lang === "de" ? "Bearbeiten" : "Edit"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => { if (confirm("Delete this product?")) deleteMutation.mutate({ id: productId }); }}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4 mr-2" />{t("delete", lang)}
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Prices — use the same source fields and net/gross terminology as
                the product list so an administrator never has to infer which
                price is being shown on either screen. */}
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">
                {lang === "de" ? "Verkaufspreis (netto)" : "Sell Price (net)"}
              </div>
              <div className="text-3xl font-bold">{formatMoney(product.unitPrice)}</div>
            </div>
            <div className="border-t pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">
                  {lang === "de" ? "Verkaufspreis (brutto)" : "Sell Price (gross)"}
                </div>
                <div className="text-lg font-semibold">
                  {product.unitPriceBrutto ? formatMoney(product.unitPriceBrutto) : "—"}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">
                  {lang === "de" ? "Einkaufspreis" : "Purchase Price"}
                </div>
                <div className="text-lg font-semibold">
                  {product.purchasePrice && parseFloat(product.purchasePrice) > 0
                    ? formatMoney(product.purchasePrice)
                    : "—"}
                </div>
              </div>
              {product.recommendedPrice && parseFloat(product.recommendedPrice) > 0 && (
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    {lang === "de" ? "Empfohlener Verkaufspreis (netto)" : "Recommended Sell Price (net)"}
                  </div>
                  <div className="text-lg font-semibold">{formatMoney(product.recommendedPrice)}</div>
                </div>
              )}
            </div>

            {/* Category */}
            <div className="border-t pt-4">
              <div className="text-sm font-medium text-muted-foreground mb-1">
                {lang === "de" ? "Produktgruppe" : "Product Group"}
              </div>
              <Badge variant={catStyle.variant} className={catStyle.className}>
                {groupLabel(productCategory)}
              </Badge>
            </div>

            {/* Names */}
            <div className="border-t pt-4 grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Name (EN)</div>
                <div className="text-sm">{product.nameEn}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Name (DE)</div>
                <div className="text-sm">{product.nameDe}</div>
              </div>
            </div>

            {/* Descriptions */}
            <div className="border-t pt-4 space-y-3">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Description (EN)</div>
                <p className="text-sm text-muted-foreground">{product.descriptionEn || "—"}</p>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Description (DE)</div>
                <p className="text-sm text-muted-foreground">{product.descriptionDe || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {!isService && (
          <Card>
            <CardHeader>
              <CardTitle>{t("stock", lang)}</CardTitle>
              <CardDescription>
                {lang === "de" ? `Warnschwelle: ${product.lowStockThreshold} Einheiten` : `Alert threshold: ${product.lowStockThreshold} units`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-4xl font-bold ${isLowStock ? 'text-destructive' : ''}`}>
                    {product.stockQuantity}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {lang === "de" ? "Einheiten auf Lager" : "units in stock"}
                  </div>
                </div>
                {isLowStock && (
                  <Badge variant="destructive" className="flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" />
                    {t("low_stock", lang)}
                  </Badge>
                )}
              </div>

              <Dialog open={stockOpen} onOpenChange={(open) => {
                setStockOpen(open);
                if (open) setNewStock(product.stockQuantity.toString());
              }}>
                <DialogTrigger asChild>
                  <Button className="w-full" variant="outline">{lang === "de" ? "Bestand anpassen" : "Adjust Stock"}</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{lang === "de" ? "Absolute Bestandsmenge festlegen" : "Set Absolute Stock Quantity"}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleAdjustStock} className="space-y-4 pt-4">
                    <div className="flex items-center gap-4">
                      <Button
                        type="button" variant="outline" size="icon"
                        onClick={() => setNewStock(String(Math.max(0, parseInt(newStock || "0") - 1)))}
                      ><Minus className="h-4 w-4" /></Button>
                      <Input
                        type="number" className="text-center font-bold text-lg"
                        value={newStock} onChange={e => setNewStock(e.target.value)} min="0"
                      />
                      <Button
                        type="button" variant="outline" size="icon"
                        onClick={() => setNewStock(String(parseInt(newStock || "0") + 1))}
                      ><Plus className="h-4 w-4" /></Button>
                    </div>
                    <DialogFooter className="mt-6">
                      <Button variant="outline" type="button" onClick={() => setStockOpen(false)}>{t("cancel", lang)}</Button>
                      <Button type="submit" disabled={adjustStockMutation.isPending}>{t("save", lang)}</Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Edit product dialog ───────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{lang === "de" ? "Produkt bearbeiten" : "Edit Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2 overflow-y-auto flex-1 pr-1">

            {/* Names */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Name (EN) *</Label>
                <Input {...field("nameEn")} placeholder="Product name in English" />
              </div>
              <div className="space-y-1.5">
                <Label>Name (DE) *</Label>
                <Input {...field("nameDe")} placeholder="Produktname auf Deutsch" />
              </div>
            </div>

            {/* SKU + Price */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>SKU / Art.-Nr. *</Label>
                <Input {...field("sku")} placeholder="e.g. SP-CT-01" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>{lang === "de" ? "Preis (€) *" : "Unit Price (€) *"}</Label>
                <Input {...field("unitPrice")} placeholder="0.00" />
              </div>
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label>{lang === "de" ? "Produktgruppe *" : "Product Group *"}</Label>
              <div className="grid grid-cols-3 gap-3">
                {categoryOptions.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEditForm(f => ({ ...f, category: opt.value }))}
                    className={`rounded-lg border-2 px-3 py-3 text-sm font-medium transition-colors ${
                      editForm.category === opt.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Descriptions */}
            <div className="space-y-1.5">
              <Label>Description (EN)</Label>
              <Textarea {...field("descriptionEn")} placeholder="Optional product description in English" rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Description (DE)</Label>
              <Textarea {...field("descriptionDe")} placeholder="Optionale Produktbeschreibung auf Deutsch" rows={2} />
            </div>

            {/* Low stock threshold */}
            <div className="space-y-1.5">
              <Label>{lang === "de" ? "Meldebestand (Warnschwelle)" : "Low Stock Threshold"}</Label>
              <Input
                type="number" min="0"
                {...field("lowStockThreshold")}
                placeholder="5"
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                {lang === "de"
                  ? "Ab dieser Menge wird eine Niedrigbestandswarnung ausgelöst."
                  : "A low-stock alert fires when quantity drops to or below this number."}
              </p>
            </div>
          </div>

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t("cancel", lang)}</Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending || !editForm.nameEn.trim() || !editForm.nameDe.trim() || !editForm.sku.trim() || !editForm.unitPrice.trim()}
            >
              {updateMutation.isPending
                ? (lang === "de" ? "Speichern…" : "Saving…")
                : t("save", lang)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
