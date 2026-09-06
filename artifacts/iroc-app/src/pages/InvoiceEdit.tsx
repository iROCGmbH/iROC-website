import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { useListIrocProducts, useListIrocProductGroups, useGetIrocInvoice, getGetIrocInvoiceQueryKey, getListIrocInvoicesQueryKey } from "@workspace/api-client-react";
import { computeDefaultInvoiceTax, computeDefaultVatNote, isEuCountryCode } from "@workspace/api-zod";
import { adminGet, adminPost, adminPut } from "@/lib/admin-fetch";
import { inferInvoiceOriginCountry, inferInvoiceSupplyKind, resolveInvoiceDestinationCountry } from "@/lib/invoice-tax";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Plus, Trash2, Save, Search, X, Loader2, Globe, Building2, Gift, AlertTriangle, FileText, Pencil } from "lucide-react";
import { Link } from "wouter";
import { formatMoney } from "@/lib/utils";
import { InvoiceShippingPanel } from "@/components/InvoiceShippingPanel";
import { IROC_DASHBOARD_QUERY_KEY } from "@/lib/query-keys";
import { resolvePaymentTerms, type PaymentTermCode } from "@workspace/spirecut-shared";
import type { AppInvoiceFull, AppInvoiceInput } from "@workspace/api-client-react";
import { LocalizedDateInput } from "@/components/LocalizedDateInput";

// ── Types (shared with InvoiceNew) ────────────────────────────────────────────

interface CombinedCustomer {
  source: "iroc" | "website";
  id: number;
  salutation: string | null;
  title: string | null;
  name: string;
  company: string | null;
  email: string | null;
  country: string | null;
  shippingCountry: string | null;
  city: string | null;
  address: string | null;
  postalCode: string | null;
  isEu: boolean | null;
  vatId: string | null;
  isPublicAuthority: boolean;
  defaultBuyerReference: string | null;
  irocCustomerId: number | null;
  customerNr: string | null;
}

interface ResolvedCustomer {
  websiteCustomerId: number;
  name: string;
  company: string | null;
  country: string | null;
  shippingCountry: string | null;
  isEu: boolean;
  vatId?: string | null;
  isPublicAuthority: boolean;
  defaultBuyerReference: string | null;
}

interface InvoiceItemForm {
  id: string;
  productId: number | null;
  productName: string;
  /** true when the admin has manually edited the name so it no longer matches nameDe or nameEn */
  nameCustomized: boolean;
  /** true when a loaded name predates a catalog update and may simply be stale */
  nameMayBeOutdated: boolean;
  sku: string;
  description: string;
  lotNumber: string;
  hsCode: string;
  countryOfOrigin: string;
  weightKg: string;
  unitPrice: string;
  discountPercent: string;
  vatRate: string;
  isDemo: boolean;
  quantity: number;
}

/**
 * Build the item payload shared by invoice saves and offer PDFs.
 *
 * `productName` is the customer-facing value from the form. It must not be
 * rebuilt from the selected catalog product here because admins can
 * intentionally customize a linked product's name.
 */
function toInvoiceItemInput(item: InvoiceItemForm, invoiceType: string) {
  return {
    productId: item.productId,
    productName: item.productName,
    sku: item.sku || null,
    description: item.description || null,
    lotNumber: item.lotNumber || null,
    hsCode: item.hsCode || null,
    countryOfOrigin: item.countryOfOrigin || null,
    weightKg: item.weightKg || null,
    unitPrice: parseFloat(item.unitPrice).toFixed(2),
    discountPercent: (!item.isDemo && item.discountPercent && parseFloat(item.discountPercent) > 0)
      ? item.discountPercent
      : null,
    vatRate: invoiceType === "domestic" ? item.vatRate : "0",
    isDemo: item.isDemo,
    quantity: item.quantity,
  };
}

interface InventoryLot {
  id: number;
  productId: number;
  lotNumber: string;
  quantityReceived: number;
  quantityUsed: number;
}

type EditableInvoice = AppInvoiceFull & {
  websiteCustomerId?: number | null;
  vatNote?: string | null;
  customer: AppInvoiceFull["customer"] & {
    shippingCountry?: string | null;
    isPublicAuthority?: boolean;
  };
};

// ── Customer Combobox (same as InvoiceNew) ────────────────────────────────────

function CustomerCombobox({
  value,
  onChange,
  token,
}: {
  value: ResolvedCustomer | null;
  onChange: (resolved: ResolvedCustomer | null) => void;
  token: string;
}) {
  const { lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<CombinedCustomer[]>([]);
  const [customerLoadState, setCustomerLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [importing, setImporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadCustomers = useCallback(async () => {
    if (!token) {
      setCustomers([]);
      setCustomerLoadState("idle");
      return;
    }

    setCustomerLoadState("loading");
    try {
      const data = await adminGet<CombinedCustomer[]>("/api/iroc/customers-combined", token);
      if (!Array.isArray(data)) throw new Error("Invalid customer response");
      setCustomers([...data].sort((a, b) => {
        if (!a.customerNr && !b.customerNr) return a.name.localeCompare(b.name);
        if (!a.customerNr) return 1;
        if (!b.customerNr) return -1;
        return a.customerNr.localeCompare(b.customerNr, undefined, { numeric: true });
      }));
      setCustomerLoadState("ready");
    } catch {
      setCustomers([]);
      setCustomerLoadState("error");
    }
  }, [token]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = customers.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [
      c.name,
      c.email,
      c.company,
      c.vatId,
      c.salutation,
      c.title,
      c.customerNr,
      c.address,
      c.postalCode,
      c.city,
      c.country,
    ].some(field => field?.toLowerCase().includes(q));
  });

  const handleSelect = async (customer: CombinedCustomer) => {
    if (customer.source === "website") {
      onChange({
        websiteCustomerId: customer.id,
        name: customer.name,
        company: customer.company,
        country: customer.country,
        shippingCountry: customer.shippingCountry,
        isEu: isEuCountryCode(customer.shippingCountry ?? customer.country),
        isPublicAuthority: customer.isPublicAuthority,
        defaultBuyerReference: customer.defaultBuyerReference,
      });
      setOpen(false); setSearch(""); return;
    }
    setImporting(true);
    try {
      const wc = await adminPost<{ id: number; firstName: string; lastName: string; country: string | null; shippingCountry: string | null; isEu?: boolean }>(
        "/api/iroc/website-customers/from-iroc", token, { irocCustomerId: customer.irocCustomerId }
      );
      onChange({
        websiteCustomerId: wc.id,
        name: `${wc.firstName} ${wc.lastName}`.trim(),
        company: null, country: wc.country, shippingCountry: wc.shippingCountry,
        isEu: isEuCountryCode(wc.shippingCountry ?? wc.country),
        isPublicAuthority: false, defaultBuyerReference: null,
      });
      setOpen(false); setSearch("");
    } catch { alert(lang === "de" ? "Kunde konnte nicht importiert werden" : "Failed to import customer"); }
    finally { setImporting(false); }
  };

  return (
    <div ref={containerRef} className="relative">
      {value ? (
        <div className="flex items-center justify-between p-2 border rounded-md bg-background">
          <div className="flex items-center gap-2 text-sm">
            {value.isEu ? <Globe className="h-4 w-4 text-muted-foreground" /> : <Building2 className="h-4 w-4 text-muted-foreground" />}
            <span className="font-medium">{value.name}</span>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange(null)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input value={search} onChange={e => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={lang === "de" ? "Kunden suchen…" : "Search customer…"} className="pl-9" />
          {importing && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      )}
      {open && !value && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg max-h-64 overflow-y-auto">
          {customerLoadState === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {lang === "de" ? "Kunden werden geladen…" : "Loading customers…"}
            </div>
          ) : customerLoadState === "error" ? (
            <div role="alert" className="space-y-3 p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {lang === "de" ? "Kundenliste konnte nicht geladen werden." : "Customer list could not be loaded."}
              </div>
              <p className="text-xs text-muted-foreground">
                {lang === "de" ? "Bitte Verbindung prüfen und erneut versuchen." : "Check the connection and try again."}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadCustomers()}>
                {lang === "de" ? "Erneut versuchen" : "Try again"}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">{lang === "de" ? "Keine Kunden gefunden" : "No customers found"}</div>
          ) : filtered.map(c => (
            <button key={`${c.source}-${c.id}`} type="button"
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent text-left text-sm"
              onClick={() => handleSelect(c)}>
              {c.source === "website" ? <Globe className="h-4 w-4 text-muted-foreground shrink-0" /> : <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />}
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {[c.salutation, c.title, c.name].filter(Boolean).join(" ")}
                </div>
                {c.company && <div className="text-xs text-foreground/70 truncate">{c.company}</div>}
                <div className="text-xs text-muted-foreground truncate">
                  {[c.customerNr, c.email, c.postalCode, c.city, c.country].filter(Boolean).join(" · ")}
                  {c.vatId && ` · ${c.vatId}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InvoiceEdit() {
  const { id } = useParams();
  const shippingPanelRef = useRef<HTMLDivElement>(null);
  const invoiceId = parseInt(id || "0", 10);
  const { lang } = useLanguage();
  const { token } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: invoice, isLoading } = useGetIrocInvoice<EditableInvoice>(invoiceId, {
    query: { enabled: !!invoiceId, queryKey: getGetIrocInvoiceQueryKey(invoiceId) }
  });

  useEffect(() => {
    if (invoice?.status === "draft" && new URLSearchParams(window.location.search).get("shipping") === "1") {
      window.setTimeout(() => shippingPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    }
  }, [invoice?.status]);

  const { data: products } = useListIrocProducts();
  const { data: productGroups } = useListIrocProductGroups();
  const [inventoryLots, setInventoryLots] = useState<InventoryLot[]>([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);

  // Form state
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<ResolvedCustomer | null>(null);
  const [invoiceType, setInvoiceType] = useState<"domestic" | "eu" | "export" | "noneu" | "lecture-eu" | "lecture-noneu">("domestic");
  const [invoiceLang, setInvoiceLang] = useState<"de" | "en">("de");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [buyerReference, setBuyerReference] = useState("");
  const [sellerVatId, setSellerVatId] = useState("DE455683037");
  const [buyerVatId, setBuyerVatId] = useState("");
  const [paymentTermCode, setPaymentTermCode] = useState<PaymentTermCode>("prepayment");
  const [isB2g, setIsB2g] = useState(false);
  const [shippingMethod, setShippingMethod] = useState("DHL Express");
  const [reasonForExport, setReasonForExport] = useState("Permanent Sale / Commercial");
  const [termsOfDelivery, setTermsOfDelivery] = useState("DAP (Delivered At Place)");
  const [deliveryCosts, setDeliveryCosts] = useState("0.00");
  const [insuranceCosts, setInsuranceCosts] = useState("0.00");
  const [notes, setNotes] = useState("");
  const [vatNote, setVatNote] = useState("");
  const [isVatNoteManual, setIsVatNoteManual] = useState(false);
  // Existing invoices retain their saved tax treatment. Choosing a different
  // customer or the reset action explicitly reapplies the automatic type, rate,
  // and legal footnote.
  const [isTaxTreatmentManual, setIsTaxTreatmentManual] = useState(true);
  const [items, setItems] = useState<InvoiceItemForm[]>([]);
  const requiresShipmentCustoms = invoiceType === "export"
    || invoiceType === "noneu"
    || invoiceType === "lecture-noneu"
    || selectedCustomer?.isEu === false;
  // vatRateOverride: percentage value (7, 19, or 0). Initialised from saved invoice.vatRate on load.
  const [vatRateOverride, setVatRateOverride] = useState<number>(19);
  const resolvedPaymentTerms = resolvePaymentTerms({
    issueDate,
    paymentTermCode,
    dueDate,
    language: invoiceLang,
  });

  useEffect(() => {
    if (initialized) setDueDate(resolvedPaymentTerms.dueDate);
  }, [initialized, resolvedPaymentTerms.dueDate]);

  // Keep vatNote in sync with type/lang changes unless the admin has manually edited it
  useEffect(() => {
    if (!isVatNoteManual) setVatNote(computeDefaultVatNote(invoiceType, invoiceLang));
  }, [invoiceType, invoiceLang, isVatNoteManual]);

  useEffect(() => {
    if (!initialized || isTaxTreatmentManual) return;
    const defaultTax = computeDefaultInvoiceTax({
      destinationCountry: resolveInvoiceDestinationCountry(
        selectedCustomer?.shippingCountry,
        selectedCustomer?.country,
      ),
      originCountry: inferInvoiceOriginCountry(items),
      supplyKind: inferInvoiceSupplyKind(items, products, productGroups),
      lang: invoiceLang,
    });
    setInvoiceType(defaultTax.invoiceType);
    setVatRateOverride(defaultTax.vatRate);
    if (!isVatNoteManual) setVatNote(defaultTax.vatNote);
  }, [
    initialized,
    selectedCustomer?.country,
    selectedCustomer?.shippingCountry,
    items,
    products,
    productGroups,
    invoiceLang,
    isTaxTreatmentManual,
    isVatNoteManual,
  ]);

  // Retranslate linked product names/descriptions when the invoice language is switched.
  // We pre-seed prevInvoiceLangRef in the initialization effect so the initial
  // setInvoiceLang() call (loading saved data) is not treated as a user change.
  // Items whose productName no longer matches nameDe or nameEn are treated as manually edited
  // and are skipped (nameCustomized flag is set so the inline notice appears). Legacy invoice
  // items have no name snapshot, so a product updated after the invoice was created is treated
  // as a possibly stale catalog name instead of being reported as manually edited.
  const prevInvoiceLangEditRef = useRef<string | null>(null);
  const productsForLangEditRef = useRef(products);
  useEffect(() => { productsForLangEditRef.current = products; }, [products]);
  useEffect(() => {
    const prev = prevInvoiceLangEditRef.current;
    prevInvoiceLangEditRef.current = invoiceLang;
    if (prev === null || prev === invoiceLang) return; // mount or no real change
    const prods = productsForLangEditRef.current;
    if (!prods || prods.length === 0) return;
    setItems(prev => prev.map(item => {
      if (!item.productId) return item;
      const product = prods.find(p => p.id === item.productId);
      if (!product) return item;
      // Already flagged as customized in this session — skip retranslation
      if (item.nameCustomized) return item;
      // Detect if the current name is custom (e.g. loaded from DB with a prior manual edit)
      const isCustom = item.productName !== product.nameDe && item.productName !== product.nameEn;
      if (isCustom) {
        const productUpdatedAt = product.updatedAt ? Date.parse(product.updatedAt) : NaN;
        const invoiceCreatedAt = invoice?.createdAt ? Date.parse(invoice.createdAt) : NaN;
        const mayBeOutdated =
          Number.isFinite(productUpdatedAt) &&
          Number.isFinite(invoiceCreatedAt) &&
          productUpdatedAt > invoiceCreatedAt;
        // Leave the name alone. A legacy item cannot carry the old catalog
        // snapshot, so timestamps provide the safest available distinction.
        return {
          ...item,
          nameCustomized: true,
          nameMayBeOutdated: mayBeOutdated,
        };
      }
      return {
        ...item,
        productName: invoiceLang === "de" ? product.nameDe : product.nameEn,
        description: (invoiceLang === "de" ? product.descriptionDe : product.descriptionEn) || "",
        nameMayBeOutdated: false,
      };
    }));
  }, [invoiceLang, invoice?.createdAt]);

  // When invoice type changes, keep a valid domestic rate or reset to 0 for non-domestic
  useEffect(() => {
    if (invoiceType === "domestic") {
      setVatRateOverride(prev => (prev === 7 || prev === 19) ? prev : 19);
    } else {
      setVatRateOverride(0);
    }
  }, [invoiceType]);

  // Load inventory lots
  useEffect(() => {
    if (!token) return;
    adminGet<InventoryLot[]>("/api/iroc/inventory", token)
      .then(data => { setInventoryLots(data); setInventoryLoaded(true); })
      .catch(() => {}); // on failure, inventoryLoaded stays false and no stock filtering is applied
  }, [token]);

  // Pre-populate form once invoice is loaded (only once)
  useEffect(() => {
    if (!invoice || initialized) return;
    setInitialized(true);

    // Customer
    const wcId = invoice.websiteCustomerId ?? null;
    if (wcId) {
      const c = invoice.customer;
      const country = c.country ?? null;
      setSelectedCustomer({
        websiteCustomerId: wcId,
        name: c.name,
        company: c.company ?? null,
        country,
        shippingCountry: c.shippingCountry ?? null,
        isEu: isEuCountryCode(c.shippingCountry ?? country),
        vatId: c.vatId ?? null,
        isPublicAuthority: Boolean(c.isPublicAuthority),
        defaultBuyerReference: c.defaultBuyerReference ?? null,
      });
    }

    setInvoiceType(invoice.invoiceType ?? "domestic");
    // Pre-seed the retranslation ref so the initialization setInvoiceLang call
    // is not treated as a user-driven language change.
    prevInvoiceLangEditRef.current = invoice.language ?? "de";
    setInvoiceLang(invoice.language ?? "de");
    setIssueDate(invoice.issueDate ?? "");
    setDueDate(invoice.dueDate ?? "");
    setOrderNumber(invoice.orderNumber ?? "");
    setReferenceNumber(invoice.referenceNumber ?? "");
    setBuyerReference(invoice.buyerReference ?? "");
    setSellerVatId(invoice.sellerVatId ?? "DE455683037");
    setBuyerVatId(invoice.buyerVatId ?? invoice.customer.vatId ?? "");
    const savedPaymentTerms = resolvePaymentTerms({
      issueDate: invoice.issueDate ?? "",
      paymentTermCode: invoice.paymentTermCode,
      paymentTerms: invoice.paymentTerms,
      dueDate: invoice.dueDate,
      language: invoice.language,
    });
    setPaymentTermCode(savedPaymentTerms.paymentTermCode);
    setDueDate(savedPaymentTerms.dueDate);
    setIsB2g(invoice.isB2g ?? false);
    setShippingMethod(invoice.shippingMethod ?? "DHL Express");
    setReasonForExport(invoice.reasonForExport ?? "Permanent Sale / Commercial");
    setTermsOfDelivery(invoice.termsOfDelivery ?? "DAP (Delivered At Place)");
    setDeliveryCosts(parseFloat(invoice.deliveryCosts).toFixed(2));
    setInsuranceCosts(parseFloat(invoice.insuranceCosts ?? "0").toFixed(2));
    const savedVatRate = parseFloat(invoice.vatRate ?? "19");
    setVatRateOverride(isNaN(savedVatRate) ? 19 : savedVatRate);
    setNotes(invoice.notes ?? "");
    const savedVatNote = invoice.vatNote;
    if (savedVatNote) {
      setVatNote(savedVatNote);
      setIsVatNoteManual(true);
    } else {
      // No override stored — compute from invoice type and language
      const iType = invoice.invoiceType ?? "domestic";
      const iLang = invoice.language ?? "de";
      setVatNote(computeDefaultVatNote(iType, iLang));
      setIsVatNoteManual(false);
    }

    setItems(
      invoice.items.map(item => ({
        id: String(item.id),
        productId: item.productId ?? null,
        productName: item.productName,
        // nameCustomized starts false; the retranslation effect will detect and flag
        // any custom name (not matching nameDe/nameEn) if the admin switches language.
        nameCustomized: false,
        nameMayBeOutdated: false,
        sku: item.sku ?? "",
        description: item.description ?? "",
        lotNumber: item.lotNumber ?? "",
        hsCode: item.hsCode ?? "",
        countryOfOrigin: item.countryOfOrigin ?? "",
        weightKg: item.weightKg ?? "",
        unitPrice: parseFloat(item.unitPrice).toFixed(2),
        discountPercent: item.discountPercent ?? "0",
        vatRate: item.vatRate ?? invoice.vatRate ?? "19",
        isDemo: item.isDemo ?? false,
        quantity: item.quantity,
      }))
    );
  }, [invoice, initialized]);

  // Redirect if paid or cancelled
  useEffect(() => {
    if (invoice && (invoice.status === "paid" || invoice.status === "cancelled")) setLocation(`/invoices/${invoiceId}`);
  }, [invoice, invoiceId, setLocation]);

  // API save error — shown inline below the header when the PUT fails
  const [saveError, setSaveError] = useState<string | null>(null);

  const [offerPending, setOfferPending] = useState(false);
  const handleOfferPdf = async () => {
    if (!selectedCustomer) return alert(lang === "de" ? "Bitte Kunden wählen" : "Select a customer");
    if (items.length === 0) return alert(lang === "de" ? "Mindestens eine Position hinzufügen" : "Add at least one item");
    if (paymentTermCode === "custom" && !dueDate) return alert(lang === "de" ? "Bitte ein Fälligkeitsdatum angeben" : "Please provide a due date");
    if (isB2g && !buyerReference.trim()) return alert("Bitte Käuferreferenz / Leitweg-ID angeben. / Please provide the buyer reference / Leitweg-ID.");
    if (!token) return;
    setOfferPending(true);
    try {
      const res = await fetch("/api/iroc/invoices/offer-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          websiteCustomerId: selectedCustomer.websiteCustomerId,
          invoiceType,
          language: invoiceLang,
          issueDate,
          dueDate: dueDate || null,
          orderNumber: orderNumber || null,
          referenceNumber: referenceNumber || null,
          shippingMethod: requiresShipmentCustoms ? (shippingMethod || null) : null,
          reasonForExport: requiresShipmentCustoms ? (reasonForExport || null) : null,
          termsOfDelivery: requiresShipmentCustoms ? (termsOfDelivery || null) : null,
          deliveryCosts: parseFloat(deliveryCosts).toFixed(2),
          vatRate: vatRate.toFixed(2),
          notes: notes || null,
          vatNote: vatNote.trim() || null,
          items: items.map(i => toInvoiceItemInput(i, invoiceType)),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoiceLang === "en" ? "Offer" : "Angebot"}_${issueDate || new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert(lang === "de" ? "Angebots-PDF konnte nicht erstellt werden" : "Failed to generate offer PDF");
    } finally {
      setOfferPending(false);
    }
  };

  // Non-domestic types always submit 0 %. This guards the outgoing payload even
  // if a previously selected domestic 7 % rate has not yet been reset in state.
  const vatRate = invoiceType === "domestic" ? vatRateOverride : 0;

  const handleAddItem = () => {
    setItems([...items, {
      id: Math.random().toString(), productId: null, productName: "", sku: "",
      description: "", lotNumber: "", hsCode: "", countryOfOrigin: "Germany",
      weightKg: "", unitPrice: "0.00", discountPercent: "0", isDemo: false, quantity: 1,
      vatRate: String(vatRate),
      nameCustomized: false,
      nameMayBeOutdated: false,
    }]);
  };

  const handleRemoveItem = (id: string) => setItems(items.filter(i => i.id !== id));

  const handleProductSelect = async (index: number, pid: string) => {
    const product = products?.find(p => p.id === parseInt(pid));
    const newItems = [...items];
    if (product) {
      const itemId = newItems[index].id;
      newItems[index] = {
        ...newItems[index],
        productId: product.id,
        productName: invoiceLang === "de" ? product.nameDe : product.nameEn,
        nameCustomized: false, // fresh product selection — name is canonical
        nameMayBeOutdated: false,
        sku: product.sku || "",
        unitPrice: product.unitPrice,
        description: (invoiceLang === "de" ? product.descriptionDe : product.descriptionEn) || "",
        lotNumber: "",
        discountPercent: "0", // reset first; will be overwritten if a prior discount exists
      };
      setItems(newItems);
      setIsTaxTreatmentManual(false);

      // Pre-fill last discount used for this customer + product pair
      if (selectedCustomer?.websiteCustomerId && token) {
        try {
          const result = await adminGet<{ discountPercent: string | null }>(
            `/api/iroc/invoice-items/last-discount?websiteCustomerId=${selectedCustomer.websiteCustomerId}&productId=${product.id}`,
            token,
          );
          if (result.discountPercent && parseFloat(result.discountPercent) > 0) {
            setItems(prev => prev.map(it =>
              it.id === itemId ? { ...it, discountPercent: result.discountPercent! } : it,
            ));
          }
        } catch {
          // silently ignore — discount stays at 0
        }
      }
    } else {
      newItems[index] = { ...newItems[index], productId: null, lotNumber: "" };
      setItems(newItems);
      setIsTaxTreatmentManual(false);
    }
  };

  const updateItem = (
    index: number,
    field: keyof InvoiceItemForm,
    value: InvoiceItemForm[keyof InvoiceItemForm],
  ) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    if (field === "isDemo" && value === true) newItems[index].discountPercent = "0";
    // Detect manual productName edits on linked items
    if (field === "productName" && newItems[index].productId !== null) {
      const prod = productsForLangEditRef.current?.find(p => p.id === newItems[index].productId);
      if (prod) {
        const isCanonical = value === prod.nameDe || value === prod.nameEn;
        newItems[index].nameCustomized = !isCanonical;
        newItems[index].nameMayBeOutdated = false;
      }
    }
    setItems(newItems);
    if (field === "countryOfOrigin" || field === "productName") setIsTaxTreatmentManual(false);
  };

  /** Reset the item's productName to the current language's canonical name and clear the customized flag. */
  const resetItemName = (index: number) => {
    const item = items[index];
    if (!item.productId) return;
    const prod = productsForLangEditRef.current?.find(p => p.id === item.productId);
    if (!prod) return;
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      productName: invoiceLang === "de" ? prod.nameDe : prod.nameEn,
      nameCustomized: false,
      nameMayBeOutdated: false,
    };
    setItems(newItems);
  };

  const calcLineTotal = (item: InvoiceItemForm) => {
    if (item.isDemo) return 0;
    const disc = parseFloat(item.discountPercent || "0") || 0;
    return parseFloat(item.unitPrice || "0") * (1 - disc / 100) * item.quantity;
  };

  const subtotal  = items.reduce((acc, item) => acc + calcLineTotal(item), 0);
  const delivery  = parseFloat(deliveryCosts || "0");
  const insurance = parseFloat(insuranceCosts || "0");
  const vatAmount = (subtotal + delivery + insurance) * vatRate / 100;
  const total     = subtotal + delivery + insurance + vatAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return alert(lang === "de" ? "Bitte Kunden wählen" : "Select a customer");
    if (items.length === 0) return alert(lang === "de" ? "Mindestens eine Position hinzufügen" : "Add at least one item");
    if (!token) return;

    setSaveError(null);
    setSaving(true);
    try {
      const payload: AppInvoiceInput = {
        websiteCustomerId: selectedCustomer.websiteCustomerId,
        invoiceType,
        language: invoiceLang,
        issueDate,
        dueDate: resolvedPaymentTerms.dueDate || null,
        orderNumber: orderNumber || null,
        referenceNumber: referenceNumber || null,
        buyerReference: isB2g ? (buyerReference || null) : null,
        sellerVatId: sellerVatId || null,
        buyerVatId: buyerVatId || null,
        paymentTerms: resolvedPaymentTerms.description,
        paymentTermCode: resolvedPaymentTerms.paymentTermCode,
        isB2g,
        shippingMethod: requiresShipmentCustoms ? (shippingMethod || null) : null,
        reasonForExport: requiresShipmentCustoms ? (reasonForExport || null) : null,
        termsOfDelivery: requiresShipmentCustoms ? (termsOfDelivery || null) : null,
        deliveryCosts: parseFloat(deliveryCosts).toFixed(2),
        vatRate: vatRate.toFixed(2),
        notes: notes || null,
        // A reset default is rendered in the form but must remain null in the
        // database so the PDF recomputes it from invoice type and language.
        vatNote: isVatNoteManual ? (vatNote.trim() || null) : null,
        items: items.map(i => toInvoiceItemInput(i, invoiceType)),
      };
      await adminPut(`/api/iroc/invoices/${invoiceId}`, token, payload);
      await queryClient.invalidateQueries({ queryKey: getGetIrocInvoiceQueryKey(invoiceId) });
      await queryClient.invalidateQueries({ queryKey: getListIrocInvoicesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: IROC_DASHBOARD_QUERY_KEY });
      setLocation(`/invoices/${invoiceId}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : (lang === "de" ? "Speichern fehlgeschlagen." : "Failed to save changes."));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-[500px]" /></div>;
  }
  if (!invoice) return <div>{lang === "de" ? "Rechnung nicht gefunden" : "Invoice not found"}</div>;

  return (
    <form onSubmit={handleSubmit} className="space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild type="button">
            <Link href={`/invoices/${invoiceId}`}><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {lang === "de" ? "Rechnung bearbeiten" : "Edit Invoice"}
            </h1>
            <p className="text-sm text-muted-foreground font-mono mt-0.5">{invoice.invoiceNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={handleOfferPdf} disabled={
            offerPending ||
            items.length === 0 ||
            !selectedCustomer ||
            (invoiceType === "domestic" && vatRateOverride === 0)
          }>
            {offerPending
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <FileText className="h-4 w-4 mr-2" />}
            {lang === "de" ? "Angebot (PDF)" : "Offer (PDF)"}
          </Button>
          <Button type="submit" disabled={
            saving ||
            items.length === 0 ||
            !selectedCustomer ||
            (invoiceType === "domestic" && vatRateOverride === 0)
          }>
            <Save className="h-4 w-4 mr-2" />
            {saving ? (lang === "de" ? "Speichern…" : "Saving…") : t("save", lang)}
          </Button>
        </div>
      </div>

      {saveError && (
        <p role="alert" className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {saveError}
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>{lang === "de" ? "Rechnungsdetails" : "Invoice Details"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {/* Invoice number — read-only */}
            <div className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50 border">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {lang === "de" ? "Rechnungsnr." : "Invoice No."}
              </span>
              <span className="font-mono font-semibold text-sm">{invoice.invoiceNumber}</span>
            </div>

            <div className="space-y-2">
              <Label>{t("customer", lang)} *</Label>
              <CustomerCombobox
                value={selectedCustomer}
                onChange={(customer) => {
                  setSelectedCustomer(customer);
                  setBuyerVatId(customer?.vatId ?? "");
                  setIsB2g(customer?.isPublicAuthority ?? false);
                  setBuyerReference(customer?.defaultBuyerReference ?? "");
                  setIsTaxTreatmentManual(false);
                  setIsVatNoteManual(false);
                }}
                token={token || ""}
              />
              {selectedCustomer && (
                <p className="text-xs text-muted-foreground pl-1">
                  {[selectedCustomer.company, selectedCustomer.country].filter(Boolean).join(" · ")}
                  {selectedCustomer.isEu && <Badge variant="outline" className="ml-2 text-[10px] py-0">EU</Badge>}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("issue_date", lang)} *</Label>
                <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Zahlungsbedingungen" : "Payment terms"}</Label>
                <select aria-label={lang === "de" ? "Zahlungsbedingungen" : "Payment terms"} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={paymentTermCode} onChange={e => setPaymentTermCode(e.target.value as PaymentTermCode)}>
                  <option value="prepayment">{lang === "de" ? "Vorkasse" : "Payment in advance"}</option>
                  <option value="immediate">{lang === "de" ? "Sofort fällig" : "Due immediately"}</option>
                  <option value="net7">{lang === "de" ? "7 Tage netto" : "Net 7 days"}</option>
                  <option value="net14">{lang === "de" ? "14 Tage netto" : "Net 14 days"}</option>
                  <option value="net30">{lang === "de" ? "30 Tage netto" : "Net 30 days"}</option>
                  <option value="net60">{lang === "de" ? "60 Tage netto" : "Net 60 days"}</option>
                  <option value="custom">{lang === "de" ? "Individuelles Fälligkeitsdatum" : "Custom due date"}</option>
                </select>
                {paymentTermCode === "custom" && (
                  <LocalizedDateInput
                    required
                    ariaLabel={lang === "de" ? "Individuelles Fälligkeitsdatum" : "Custom due date"}
                    language={lang}
                    value={dueDate}
                    onChange={setDueDate}
                  />
                )}
                <p className="text-xs text-muted-foreground">{resolvedPaymentTerms.description}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{lang === "de" ? "Auftragsnummer" : "Order No."}</Label>
                <Input value={orderNumber} onChange={e => setOrderNumber(e.target.value)} placeholder={lang === "de" ? "z. B. 2026-0044" : "e.g. 2026-0044"} />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Ihre Referenz" : "Reference No."}</Label>
                <Input value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 flex items-center gap-2">
                <input id="is-b2g" type="checkbox" checked={isB2g} onChange={e => setIsB2g(e.target.checked)} />
                <Label htmlFor="is-b2g">Öffentlicher Auftraggeber / Public authority (B2G)</Label>
              </div>
              {isB2g && <div className="space-y-2">
                <Label>Käuferreferenz / Buyer reference / Leitweg-ID *</Label>
                <Input required value={buyerReference} onChange={e => setBuyerReference(e.target.value)} />
              </div>}
              <div className="space-y-2">
                <Label>{lang === "de" ? "USt-ID Verkäufer" : "Seller VAT ID"}</Label>
                <Input value={sellerVatId} onChange={e => setSellerVatId(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "USt-ID Käufer" : "Buyer VAT ID"}</Label>
                <Input value={buyerVatId} onChange={e => setBuyerVatId(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("type", lang)} *</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={invoiceType} onChange={e => {
                    setInvoiceType(e.target.value as typeof invoiceType);
                    setIsTaxTreatmentManual(true);
                  }}>
                  <option value="domestic">{lang === "de" ? "Inland (19 % MwSt.)" : "Domestic (19% VAT)"}</option>
                  <option value="eu">{lang === "de" ? "EU – Waren / Reverse Charge (0 %)" : "EU – Goods / Reverse Charge (0%)"}</option>
                  <option value="export">{lang === "de" ? "Export – Handelsrechnung (0 %)" : "Export – Commercial Invoice (0%)"}</option>
                  <option value="noneu">{lang === "de" ? "Nicht-EU Standardrechnung (0 %)" : "Non-EU Standard Invoice (0%)"}</option>
                  <option value="lecture-eu">{lang === "de" ? "Dienstleistung (Schulung / Beratung) – EU (0 %, §3a Abs. 2 UStG)" : "Service (Teaching / Consulting) – EU (0%, §3a (2) UStG)"}</option>
                  <option value="lecture-noneu">{lang === "de" ? "Dienstleistung (Schulung / Beratung) – Nicht-EU (0 %, §3a Abs. 2 UStG)" : "Service (Teaching / Consulting) – Non-EU (0%, §3a (2) UStG)"}</option>
                </select>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {lang === "de"
                      ? "Standard: Zielland, Ursprungsland und Waren/Dienstleistung."
                      : "Default: destination, origin, and goods/service."}
                  </span>
                  {isTaxTreatmentManual && (
                    <button
                      type="button"
                      className="shrink-0 underline hover:text-primary"
                      onClick={() => {
                        setIsVatNoteManual(false);
                        setIsTaxTreatmentManual(false);
                      }}
                    >
                      {lang === "de" ? "Automatik verwenden" : "Use automatic default"}
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t("language", lang)} *</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={invoiceLang} onChange={e => setInvoiceLang(e.target.value as typeof invoiceLang)}>
                  <option value="de">{lang === "de" ? "Deutsch (DE)" : "German (DE)"}</option>
                  <option value="en">{lang === "de" ? "Englisch (EN)" : "English (EN)"}</option>
                </select>
              </div>
            </div>

            {requiresShipmentCustoms && (
              <div className="space-y-3 pt-2 border-t">
                <p className="text-sm text-muted-foreground">
                  {lang === "de"
                    ? "Für Sendcloud außerhalb der EU sind diese Angaben und die Zollfelder jeder Position erforderlich. Als Entwurf speichern, bevor Sie Versandtarife abrufen."
                    : "For Sendcloud shipments outside the EU, these fields and each line's customs data are required. Save the draft before retrieving shipping rates."}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "Exportgrund" : "Reason for Export"}</Label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={reasonForExport} onChange={e => setReasonForExport(e.target.value)}>
                      <option value="Permanent Sale / Commercial">Permanent sale / commercial goods</option>
                      <option value="Commercial Sample">Commercial sample</option>
                      <option value="Gift">Gift</option>
                      <option value="Return Goods">Return goods</option>
                      <option value="Documents">Documents</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>{lang === "de" ? "Versandart" : "Shipping Method"}</Label>
                    <Input value={shippingMethod} onChange={e => setShippingMethod(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{lang === "de" ? "Lieferbedingungen (Incoterm)" : "Terms of Delivery (Incoterm)"}</Label>
                  <Input value={termsOfDelivery} onChange={e => setTermsOfDelivery(e.target.value)}
                    placeholder={lang === "de" ? "z. B. DAP (Delivered At Place)" : "e.g. DAP (Delivered At Place)"} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {invoice.status === "draft" && (!invoice.sourceOrderId || invoice.isPortalOrder) && (
          <div ref={shippingPanelRef} id="sendcloud-shipping" className="md:col-span-2">
            <InvoiceShippingPanel
              invoiceId={invoiceId}
              shipment={invoice.shipment}
              invoiceTotals={{
                deliveryCosts,
                insuranceCosts,
                vatAmount: vatAmount.toFixed(2),
                total: total.toFixed(2),
              }}
              onInvoiceTotalsChanged={(totals) => {
                setDeliveryCosts(totals.deliveryCosts);
                setInsuranceCosts(totals.insuranceCosts);
              }}
            />
          </div>
        )}

        <Card>
          <CardHeader><CardTitle>{lang === "de" ? "Finanzen & Notizen" : "Financials & Notes"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {invoiceType === "domestic" && (
              <div className="space-y-2">
                <Label>{lang === "de" ? "MwSt.-Satz" : "VAT Rate"}</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={vatRateOverride}
                  onChange={e => {
                    setVatRateOverride(Number(e.target.value));
                    setIsTaxTreatmentManual(true);
                  }}
                >
                  <option value={19}>19 % (Regelsteuersatz / Standard rate)</option>
                  <option value={7}>7 % (Ermäßigter Steuersatz / Reduced rate)</option>
                </select>
                {vatRateOverride === 0 && (
                  <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                    <span aria-hidden="true">⚠</span>
                    {lang === "de"
                      ? "Inlandsrechnungen erfordern 7 % oder 19 % MwSt. — 0 % ist nicht zulässig."
                      : "Domestic invoices require 7 % or 19 % VAT — 0 % is not permitted."}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("delivery_costs", lang)}</Label>
              <Input type="number" step="0.01" min="0" value={deliveryCosts} onChange={e => setDeliveryCosts(e.target.value)} />
            </div>
            {insurance > 0 && (
              <div className="space-y-1 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm dark:border-sky-900 dark:bg-sky-950/30">
                <p className="font-medium text-sky-900 dark:text-sky-100">Sendcloud insurance</p>
                <p className="text-sky-800 dark:text-sky-200">{formatMoney(insurance)} is included in the invoice VAT and total.</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("notes", lang)}</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder={lang === "de" ? "Optionale Notizen für die Rechnung…" : "Optional notes to appear on invoice…"} className="h-24" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>{lang === "de" ? "** Fußnotentext (Steuer)" : "** VAT footnote text"}</Label>
                {isVatNoteManual && (
                  <button type="button"
                    onClick={() => { setIsVatNoteManual(false); setVatNote(computeDefaultVatNote(invoiceType, invoiceLang)); }}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors">
                    ↩ {lang === "de" ? "Zurücksetzen" : "Reset to default"}
                  </button>
                )}
              </div>
              <Textarea
                value={vatNote}
                onChange={e => { setVatNote(e.target.value); setIsVatNoteManual(true); }}
                className="h-16 text-xs font-mono resize-none"
              />
              <p className="text-[11px] text-muted-foreground">
                {lang === "de"
                  ? "Erscheint als kursive Fußnote auf der Rechnung. Wird automatisch nach Rechnungstyp gesetzt."
                  : "Appears as italic footnote on the invoice. Auto-set from invoice type — freely editable."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>{t("items", lang)}</CardTitle>
          <Button type="button" onClick={handleAddItem} variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-2" />{t("add_item", lang)}
          </Button>
        </CardHeader>
        <div className="overflow-y-auto max-h-[50vh] sticky-header-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28%]">{lang === "de" ? "Produkt" : "Product"}</TableHead>
                <TableHead>{lang === "de" ? "Beschreibung" : "Description"}</TableHead>
                <TableHead className="w-[70px] text-right">{lang === "de" ? "Menge" : "Qty"}</TableHead>
                <TableHead className="w-[160px] text-right">{lang === "de" ? "Preis / Rabatt" : "Price / Discount"}</TableHead>
                <TableHead className="w-[110px] text-right">{lang === "de" ? "Gesamt" : "Total"}</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                    {lang === "de" ? "Noch keine Positionen" : "No items added"}
                  </TableCell>
                </TableRow>
              ) : items.map((item, i) => (
                <TableRow key={item.id} className={`align-top ${item.isDemo ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}>
                  <TableCell className="min-w-[180px]">
                    <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm mb-2"
                      value={item.productId || ""} onChange={e => handleProductSelect(i, e.target.value)}>
                      <option value="">{lang === "de" ? "Eigene Position…" : "Custom Item…"}</option>
                      {(() => {
                        // Groups come from the admin-managed table (dynamic keys/labels/order)
                        const GROUP_BG: Record<string, string> = { spirecut: "#dbeafe", ministem: "#dcfce7", cellenis: "#fef9c3", other: "#fef9c3" };
                        const groupRows = (productGroups && productGroups.length > 0)
                          ? [...productGroups].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
                          : [
                              { key: "spirecut", nameEn: "Spirecut", nameDe: "Spirecut" },
                              { key: "ministem", nameEn: "MiniStem", nameDe: "MiniStem" },
                              { key: "cellenis", nameEn: "Cellenis\u00ae", nameDe: "Cellenis\u00ae" },
                            ];
                        // Only offer products that are actually available: service-group
                        // products (no stock tracking), products with remaining inventory,
                        // or the product already selected on this row.
                        const serviceKeys = new Set(
                          (productGroups ?? [])
                            .filter(g => (g as { isService?: boolean }).isService)
                            .map(g => g.key),
                        );
                        if (!productGroups || productGroups.length === 0) serviceKeys.add("services");
                        const stockByProduct: Record<number, number> = {};
                        for (const lot of inventoryLots) {
                          stockByProduct[lot.productId] =
                            (stockByProduct[lot.productId] ?? 0) + (lot.quantityReceived - lot.quantityUsed);
                        }
                        const grouped: Record<string, NonNullable<typeof products>> = {};
                        for (const g of groupRows) grouped[g.key] = [];
                        for (const p of products ?? []) {
                          const cat = (p as {category?: string}).category ?? "cellenis";
                          const inStock = !inventoryLoaded || (stockByProduct[p.id] ?? 0) > 0;
                          if (!inStock && !serviceKeys.has(cat) && p.id !== item.productId) continue;
                          (grouped[cat] ??= []).push(p);
                        }
                        const orderedKeys = [
                          ...groupRows.map(g => g.key),
                          ...Object.keys(grouped).filter(k => !groupRows.some(g => g.key === k)).sort(),
                        ];
                        return orderedKeys.map(key => {
                          const g = groupRows.find(x => x.key === key);
                          const label = g ? (lang === "de" ? g.nameDe : g.nameEn) : key;
                          const bg = GROUP_BG[key] ?? "#f3f4f6";
                          return (grouped[key]?.length ?? 0) > 0 && (
                            <optgroup key={key} label={label}>
                              {grouped[key]!.sort((a, b) => a.nameEn.localeCompare(b.nameEn)).map(p => (
                                <option key={p.id} value={p.id} style={{ backgroundColor: bg }}>
                                  {(lang === "de" ? ((p as { nameDe?: string }).nameDe || p.nameEn) : p.nameEn)}{p.sku ? ` — ${p.sku}` : ""}
                                </option>
                              ))}
                            </optgroup>
                          );
                        });
                      })()}
                    </select>
                    <Input value={item.productName} onChange={e => updateItem(i, "productName", e.target.value)}
                      placeholder={lang === "de" ? "Produktname" : "Product Name"} className="h-8 mb-1" required />
                    {item.nameCustomized && item.productId !== null && (
                      <div className="flex items-center gap-1 mb-1">
                        {item.nameMayBeOutdated ? (
                          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Pencil className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                        )}
                        <span className="text-[10px] text-amber-700 dark:text-amber-400 leading-tight flex-1">
                          {item.nameMayBeOutdated
                            ? (lang === "de"
                              ? "Katalogname seit dieser Rechnung geändert – möglicherweise veraltet"
                              : "Catalog name changed since this invoice – name may be outdated")
                            : (lang === "de"
                              ? "Manuell bearbeitet – wird nicht übersetzt"
                              : "Manually edited – won't be retranslated")}
                        </span>
                        <button
                          type="button"
                          onClick={() => resetItemName(i)}
                          className="text-[10px] text-muted-foreground hover:text-primary transition-colors whitespace-nowrap"
                          title={lang === "de" ? "Auf Standardnamen zurücksetzen" : "Reset to canonical name"}
                        >
                          ↩ {lang === "de" ? "Zurücksetzen" : "Reset"}
                        </button>
                      </div>
                    )}
                    <Input value={item.sku} onChange={e => updateItem(i, "sku", e.target.value)}
                      placeholder="SKU / Art.-Nr. *" className="h-7 text-xs text-muted-foreground" />
                  </TableCell>
                  <TableCell className="min-w-[140px]">
                    <Input value={item.description} onChange={e => updateItem(i, "description", e.target.value)}
                      placeholder={requiresShipmentCustoms ? (lang === "de" ? "Beschreibung *" : "Description *") : (lang === "de" ? "Beschreibung" : "Description")} className="h-8 mb-1" />
                    {item.productId != null ? (() => {
                      const availableLots = inventoryLots.filter(
                        lot => lot.productId === item.productId && (lot.quantityReceived - lot.quantityUsed) > 0
                      );
                      return (
                        <select value={item.lotNumber} onChange={e => updateItem(i, "lotNumber", e.target.value)}
                          className="flex h-7 w-full rounded-md border border-input bg-background px-2 text-xs text-muted-foreground mb-1">
                          <option value="">{lang === "de" ? "— Keine Charge —" : "— No lot —"}</option>
                          {availableLots.map(lot => (
                            <option key={lot.id} value={lot.lotNumber}>
                              {lot.lotNumber} ({lang === "de" ? "verf." : "avail:"} {lot.quantityReceived - lot.quantityUsed})
                            </option>
                          ))}
                          {/* Show current lot even if no longer in available list */}
                          {item.lotNumber && !availableLots.find(l => l.lotNumber === item.lotNumber) && (
                            <option value={item.lotNumber}>{item.lotNumber} (current)</option>
                          )}
                          {availableLots.length === 0 && !item.lotNumber && (
                            <option value="" disabled>{lang === "de" ? "Keine Chargen auf Lager" : "No lots in stock"}</option>
                          )}
                        </select>
                      );
                    })() : (
                      <Input value={item.lotNumber} onChange={e => updateItem(i, "lotNumber", e.target.value)}
                        placeholder={lang === "de" ? "Chargennummer" : "Lot / Charge No."} className="h-7 text-xs text-muted-foreground mb-1" />
                    )}
                    {requiresShipmentCustoms && (
                      <>
                        <Input value={item.hsCode} onChange={e => updateItem(i, "hsCode", e.target.value)}
                          placeholder="HS Code * (6–10 digits)" pattern="[0-9. -]{6,14}" className="h-7 text-xs text-muted-foreground mb-1" />
                        <Input value={item.countryOfOrigin} onChange={e => updateItem(i, "countryOfOrigin", e.target.value)}
                          placeholder={lang === "de" ? "Ursprung ISO (z. B. DE) *" : "Origin ISO (e.g. DE) *"} maxLength={2} className="h-7 text-xs text-muted-foreground mb-1 uppercase" />
                        <Input type="number" min="0.001" step="0.001" value={item.weightKg} onChange={e => updateItem(i, "weightKg", e.target.value)}
                          placeholder={lang === "de" ? "Gewicht (kg) *" : "Weight (kg) *"} className="h-7 text-xs text-muted-foreground" />
                      </>
                    )}
                  </TableCell>
                  <TableCell className="w-[70px]">
                    <Input type="number" min="1" step="1" value={item.quantity}
                      onChange={e => updateItem(i, "quantity", parseInt(e.target.value) || 1)}
                      className="h-8 text-right" required />
                  </TableCell>
                  <TableCell className="w-[150px]">
                    <Input type="number" min="0" step="0.01" value={item.unitPrice}
                      onChange={e => updateItem(i, "unitPrice", e.target.value)}
                      className={`h-8 text-right mb-1 ${item.isDemo ? "text-muted-foreground" : ""}`} required />
                    {/* Below-recommended-price warning */}
                    {(() => {
                      if (item.isDemo || !item.productId) return null;
                      const prod = products?.find(p => p.id === item.productId);
                      const rec = parseFloat(prod?.recommendedPrice ?? "0");
                      if (!rec) return null;
                      const disc = parseFloat(item.discountPercent || "0") / 100;
                      const effective = parseFloat(item.unitPrice || "0") * (1 - disc);
                      if (effective >= rec) return null;
                      return (
                        <div className="flex items-center gap-1 mb-1 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          <span className="text-[10px] font-medium leading-tight">
                            {lang === "de" ? `Unter empf. VK €${rec.toFixed(2)}` : `Below rec. price €${rec.toFixed(2)}`}
                          </span>
                        </div>
                      );
                    })()}
                    {!item.isDemo && (
                      <div className="flex items-center gap-1 mb-1">
                        <Input type="number" min="0" max="100" step="0.1" value={item.discountPercent}
                          onChange={e => updateItem(i, "discountPercent", e.target.value)}
                          className="h-7 text-right text-xs" placeholder="0" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{lang === "de" ? "% Rabatt" : "% off"}</span>
                      </div>
                    )}
                    {invoiceType === "domestic" && (
                      <div className="flex items-center gap-1 mb-1">
                        <select
                          aria-label={lang === "de" ? "Mehrwertsteuer der Position" : "Line VAT rate"}
                          value={item.vatRate}
                          onChange={e => updateItem(i, "vatRate", e.target.value)}
                          className="h-7 rounded-md border bg-background px-2 text-xs"
                        >
                          <option value="19">19 %</option>
                          <option value="7">7 %</option>
                        </select>
                        <span className="text-xs text-muted-foreground">VAT</span>
                      </div>
                    )}
                    <label className={`flex items-center gap-1.5 cursor-pointer select-none mt-1 ${item.isDemo ? "text-amber-600" : "text-muted-foreground"}`}>
                      <input type="checkbox" checked={item.isDemo}
                        onChange={e => updateItem(i, "isDemo", e.target.checked)}
                        className="h-3.5 w-3.5 accent-amber-500" />
                      <Gift className="h-3 w-3" />
                      <span className="text-[11px] font-medium">{lang === "de" ? "Demo / Gratis" : "Demo / Free"}</span>
                    </label>
                  </TableCell>
                  <TableCell className="text-right font-medium w-[110px] pt-2">
                    {item.isDemo ? (
                      <div>
                        <div className="line-through text-muted-foreground text-xs">
                          {formatMoney(parseFloat(item.unitPrice || "0") * item.quantity)}
                        </div>
                        <Badge variant="outline" className="text-[10px] py-0 border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-950/20">
                          <Gift className="h-2.5 w-2.5 mr-1" />{lang === "de" ? "Gratis" : "Free"}
                        </Badge>
                      </div>
                    ) : (() => {
                      const disc = parseFloat(item.discountPercent || "0") || 0;
                      const gross = parseFloat(item.unitPrice || "0") * item.quantity;
                      const net = gross * (1 - disc / 100);
                      return (
                        <div>
                          {disc > 0 && <div className="line-through text-muted-foreground text-xs">{formatMoney(gross)}</div>}
                          <div>{formatMoney(net)}</div>
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="w-[40px] pt-2">
                    <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveItem(item.id)}
                      className="h-8 w-8 text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="p-6 bg-muted/10 border-t flex flex-col items-end gap-2 text-sm">
          <div className="flex w-64 justify-between">
            <span className="text-muted-foreground">{t("subtotal", lang)}:</span>
            <span className="font-medium">{formatMoney(subtotal)}</span>
          </div>
          <div className="flex w-64 justify-between">
            <span className="text-muted-foreground">{t("delivery_costs", lang)}:</span>
            <span className="font-medium">{formatMoney(parseFloat(deliveryCosts || "0"))}</span>
          </div>
          {insurance > 0 && (
            <div className="flex w-64 justify-between">
              <span className="text-muted-foreground">Sendcloud insurance:</span>
              <span className="font-medium">{formatMoney(insurance)}</span>
            </div>
          )}
          <div className="flex w-64 justify-between">
            <span className="text-muted-foreground">{lang === "de" ? "MwSt." : "VAT"} ({vatRate.toFixed(0)}%):</span>
            <span className="font-medium">{formatMoney(vatAmount)}</span>
          </div>
          <div className="flex w-64 justify-between text-lg font-bold pt-2 border-t mt-2">
            <span>{t("total", lang)}:</span>
            <span className="text-primary">{formatMoney(total)}</span>
          </div>
        </div>
      </Card>
    </form>
  );
}
