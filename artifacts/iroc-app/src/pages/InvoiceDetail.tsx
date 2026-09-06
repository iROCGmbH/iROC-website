import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { formatDate, formatMoney, getInvoiceTypeLabel } from "@/lib/utils";
import { useGetIrocInvoice, useUpdateIrocInvoiceStatus, useDeleteIrocInvoice, useListIrocProducts, useCreateIrocInvoiceCorrection, getGetIrocInvoiceQueryKey, getListIrocInvoicesQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Download, Trash2, Mail, CheckCircle, RotateCcw, Gift, Percent, FileText, Eye, Truck, Pencil, Ban, Send, AlertTriangle, BellOff, Bell } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { IROC_DASHBOARD_QUERY_KEY } from "@/lib/query-keys";
import type { AppInvoiceFull } from "@workspace/api-client-react";

type InvoiceDetailData = AppInvoiceFull & {
  websiteCustomerId?: number | null;
  reminderSuppressed?: boolean;
  customer: AppInvoiceFull["customer"] & {
    shippingEmail?: string | null;
  };
  corrections?: Array<{ id: number; invoiceNumber: string; status: string }>;
};

export default function InvoiceDetail() {
  const { id } = useParams();
  const invoiceId = parseInt(id || "0", 10);
  const { lang } = useLanguage();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { toast } = useToast();

  // ── Invoice email dialog ───────────────────────────────────────────────────
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailTo, setEmailTo]                 = useState("");
  const [emailSubject, setEmailSubject]       = useState("");
  const [emailBody, setEmailBody]             = useState("");
  const [emailSending, setEmailSending]       = useState(false);

  // ── PDF export-override dialog ─────────────────────────────────────────────
  const [pdfDialogOpen, setPdfDialogOpen]           = useState(false);
  const [pdfDownloading, setPdfDownloading]         = useState(false);
  const [pdfPreviewing, setPdfPreviewing]           = useState(false);
  const [dnDownloading, setDnDownloading]           = useState(false);
  const [dnPreviewing, setDnPreviewing]             = useState(false);
  const [pdfInvoiceFormat, setPdfInvoiceFormat]     = useState<"commercial" | "standard">("commercial");
  const [pdfReasonForExport, setPdfReasonForExport] = useState("");
  const [pdfShippingMethod, setPdfShippingMethod]   = useState("");
  const [pdfTermsOfDelivery, setPdfTermsOfDelivery] = useState("");

  // ── Duplicate / Korrekturrechnung ─────────────────────────────────────────
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [returnedQuantities, setReturnedQuantities] = useState<Record<number, number>>({});

  // ── Reminder suppression ──────────────────────────────────────────────────
  const [togglingSuppress, setTogglingSuppress] = useState(false);

  const handleToggleSuppression = async (currentlySuppressed: boolean) => {
    const token = localStorage.getItem("iroc_token");
    setTogglingSuppress(true);
    try {
      const res = await fetch(`/api/iroc/invoices/${invoiceId}/reminder-suppressed`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ suppressed: !currentlySuppressed }),
      });
      if (!res.ok) throw new Error("Toggle failed");
      queryClient.invalidateQueries({ queryKey: getGetIrocInvoiceQueryKey(invoiceId) });
      toast({
        title: !currentlySuppressed
          ? (lang === "de" ? "Erinnerungen unterdrückt" : "Reminders suppressed")
          : (lang === "de" ? "Erinnerungen wieder aktiv" : "Reminders re-enabled"),
      });
    } catch {
      toast({ title: lang === "de" ? "Fehler beim Ändern" : "Failed to update", variant: "destructive" });
    } finally {
      setTogglingSuppress(false);
    }
  };

  // ── Pending payment reminders ─────────────────────────────────────────────
  const [cancellingReminder, setCancellingReminder] = useState<number | null>(null);

  interface PendingReminder {
    id: number;
    recipient_email: string;
    subject: string;
    created_at: string;
    status: string;
  }

  const { data: pendingReminders = [], refetch: refetchReminders } = useQuery<PendingReminder[]>({
    queryKey: ["invoice-pending-reminders", invoiceId],
    queryFn: async () => {
      const token = localStorage.getItem("iroc_token");
      const res = await fetch(`/api/iroc/invoices/${invoiceId}/pending-reminders`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!invoiceId,
    refetchInterval: 30_000,
  });

  const handleCancelReminder = async (queueId: number) => {
    if (!confirm(lang === "de" ? "Diesen ausstehenden Zahlungserinnerung stornieren?" : "Cancel this pending payment reminder?")) return;
    const token = localStorage.getItem("iroc_token");
    setCancellingReminder(queueId);
    try {
      const res = await fetch(`/api/admin/sally/email-queue/${queueId}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Cancel failed");
      toast({ title: lang === "de" ? "Erinnerung storniert" : "Reminder cancelled" });
      refetchReminders();
    } catch {
      toast({ title: lang === "de" ? "Fehler beim Stornieren" : "Failed to cancel reminder", variant: "destructive" });
    } finally {
      setCancellingReminder(null);
    }
  };

  // ── Unlinked invoice item product picker ─────────────────────────────────────
  const [linkProductItem, setLinkProductItem] = useState<{
    id: number;
    productName: string;
    sku: string | null | undefined;
  } | null>(null);
  const [linkProductSearch, setLinkProductSearch] = useState("");
  const [linkingProductItemId, setLinkingProductItemId] = useState<number | null>(null);
  const [unlinkingProductItemId, setUnlinkingProductItemId] = useState<number | null>(null);

  // ── Legacy customer edit state ─────────────────────────────────────────────
  const [lcEditOpen, setLcEditOpen]     = useState(false);
  const [lcSaving, setLcSaving]         = useState(false);
  const [lcSalutation, setLcSalutation] = useState("");
  const [lcTitle, setLcTitle]           = useState("");
  const [lcName, setLcName]             = useState("");
  const [lcCompany, setLcCompany]       = useState("");
  const [lcAddress, setLcAddress]       = useState("");
  const [lcPostal, setLcPostal]         = useState("");
  const [lcCity, setLcCity]             = useState("");
  const [lcCountry, setLcCountry]       = useState("");
  const [lcVatId, setLcVatId]           = useState("");
  const [lcEmail, setLcEmail]           = useState("");
  const [lcPhone, setLcPhone]           = useState("");
  const [lcNotes, setLcNotes]           = useState("");

  const { data: invoice, isLoading } = useGetIrocInvoice<InvoiceDetailData>(invoiceId, {
    query: { enabled: !!invoiceId, queryKey: getGetIrocInvoiceQueryKey(invoiceId) }
  });
  const { data: products = [] } = useListIrocProducts();
  const correctionMutation = useCreateIrocInvoiceCorrection({
    mutation: {
      onSuccess: async (created) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetIrocInvoiceQueryKey(invoiceId) }),
          queryClient.invalidateQueries({ queryKey: getListIrocInvoicesQueryKey() }),
        ]);
        setCorrectionOpen(false);
        setLocation(`/invoices/${created.id}`);
      },
      onError: (error) => toast({
        title: lang === "de" ? "Rechnungskorrektur konnte nicht erstellt werden" : "Invoice correction could not be created",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      }),
    },
  });

  const openCorrection = () => {
    setCorrectionReason("");
    setReturnedQuantities(Object.fromEntries((invoice?.items ?? []).map(item => [item.id, 0])));
    setCorrectionOpen(true);
  };
  const submitCorrection = () => {
    const items = Object.entries(returnedQuantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([invoiceItemId, quantity]) => ({ invoiceItemId: Number(invoiceItemId), quantity }));
    if (!correctionReason.trim() || !items.length) return;
    correctionMutation.mutate({ id: invoiceId, data: { reason: correctionReason.trim(), items } });
  };

  const deleteMutation = useDeleteIrocInvoice({
    mutation: { onSuccess: () => setLocation("/invoices") }
  });

  const updateStatusMutation = useUpdateIrocInvoiceStatus({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getGetIrocInvoiceQueryKey(invoiceId) });
        await queryClient.invalidateQueries({ queryKey: getListIrocInvoicesQueryKey() });
        await queryClient.invalidateQueries({ queryKey: IROC_DASHBOARD_QUERY_KEY });
      }
    }
  });

  // ── Legacy customer edit ────────────────────────────────────────────────────
  const openLegacyCustomerEdit = () => {
    const c = invoice?.customer;
    setLcSalutation(c?.salutation ?? "");
    setLcTitle(c?.title ?? "");
    setLcName(c?.name ?? "");
    setLcCompany(c?.company ?? "");
    setLcAddress(c?.address ?? "");
    setLcPostal(c?.postalCode ?? "");
    setLcCity(c?.city ?? "");
    setLcCountry(c?.country ?? "");
    setLcVatId(c?.vatId ?? "");
    setLcEmail(c?.email ?? "");
    setLcPhone(c?.phone ?? "");
    setLcNotes(c?.notes ?? "");
    setLcEditOpen(true);
  };

  const handleLegacyCustomerSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const legacyId = invoice?.customerId;
    if (!legacyId) return;
    const token = localStorage.getItem("iroc_token");
    setLcSaving(true);
    try {
      const res = await fetch(`/api/iroc/customers/${legacyId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          salutation: lcSalutation || null,
          title:      lcTitle      || null,
          name:       lcName       || "—",
          company:    lcCompany    || null,
          address:    lcAddress    || null,
          postalCode: lcPostal     || null,
          city:       lcCity       || null,
          country:    lcCountry    || "Germany",
          vatId:      lcVatId      || null,
          isEu:       false,
          email:      lcEmail      || null,
          phone:      lcPhone      || null,
          notes:      lcNotes      || null,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      await queryClient.invalidateQueries({ queryKey: getGetIrocInvoiceQueryKey(invoiceId) });
      setLcEditOpen(false);
    } catch {
      alert(lang === "de" ? "Speichern fehlgeschlagen" : "Failed to save customer");
    } finally {
      setLcSaving(false);
    }
  };

  const openProductLinkDialog = (item: NonNullable<typeof invoice>["items"][number]) => {
    setLinkProductItem({ id: item.id, productName: item.productName, sku: item.sku });
    setLinkProductSearch("");
  };

  const handleLinkProduct = async (productId: number) => {
    if (!linkProductItem) return;
    const token = localStorage.getItem("iroc_token");
    setLinkingProductItemId(linkProductItem.id);
    try {
      const res = await fetch(`/api/iroc/invoices/${invoiceId}/items/${linkProductItem.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ productId }),
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Failed to link product");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetIrocInvoiceQueryKey(invoiceId) }),
        queryClient.invalidateQueries({ queryKey: getListIrocInvoicesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: IROC_DASHBOARD_QUERY_KEY }),
      ]);
      toast({
        title: lang === "de" ? "Produkt verknüpft" : "Product linked",
        description: lang === "de"
          ? "Die Dashboard-Kategorien werden beim nächsten Laden aktualisiert."
          : "Dashboard categories will update the next time they load.",
      });
      setLinkProductItem(null);
      setLinkProductSearch("");
    } catch (err) {
      toast({
        title: lang === "de" ? "Verknüpfen fehlgeschlagen" : "Failed to link product",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLinkingProductItemId(null);
    }
  };

  const handleUnlinkProduct = async (item: NonNullable<typeof invoice>["items"][number]) => {
    const confirmed = window.confirm(
      lang === "de"
        ? `Produktverknüpfung für „${item.productName}“ entfernen?`
        : `Unlink the product from "${item.productName}"?`,
    );
    if (!confirmed) return;

    const token = localStorage.getItem("iroc_token");
    setUnlinkingProductItemId(item.id);
    try {
      const res = await fetch(`/api/iroc/invoices/${invoiceId}/items/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ productId: null }),
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Failed to unlink product");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetIrocInvoiceQueryKey(invoiceId) }),
        queryClient.invalidateQueries({ queryKey: getListIrocInvoicesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: IROC_DASHBOARD_QUERY_KEY }),
      ]);
      toast({
        title: lang === "de" ? "Produktverknüpfung entfernt" : "Product unlinked",
        description: lang === "de"
          ? "Der Artikel wird im Dashboard wieder unter „Sonstige“ gruppiert."
          : "The item will be grouped under “Other” on the dashboard again.",
      });
    } catch (err) {
      toast({
        title: lang === "de" ? "Entfernen fehlgeschlagen" : "Failed to unlink product",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUnlinkingProductItemId(null);
    }
  };

  // ── Email helpers ─────────────────────────────────────────────────────────
  const openEmailDialog = () => {
    const num = invoice?.invoiceNumber ?? "";
    const invoiceLanguage = invoice?.language === "en" ? "en" : "de";
    const billingEmail = lcEmail || "";
    const shippingEmail = invoice?.customer?.shippingEmail ?? "";
    const recipients = [billingEmail, shippingEmail]
      .map(e => e.trim())
      .filter(Boolean)
      .filter((e, i, arr) => arr.indexOf(e) === i) // deduplicate
      .join(", ");
    setEmailTo(recipients);
    setEmailSubject(invoiceLanguage === "de" ? `Rechnung ${num}` : `Invoice ${num}`);
    setEmailBody(invoiceLanguage === "de"
      ? `Sehr geehrte Damen und Herren,\n\nim Anhang finden Sie Ihre Rechnung ${num}.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen,\niROC GmbH`
      : `Dear Sir or Madam,\n\nPlease find attached invoice ${num}.\n\nIf you have any questions, please do not hesitate to contact us.\n\nBest regards,\niROC GmbH`);
    setEmailDialogOpen(true);
  };

  const handleSendByEmail = async () => {
    if (!emailTo || !emailSubject || !emailBody) return;
    setEmailSending(true);
    try {
      const token = localStorage.getItem("iroc_token");
      const r = await fetch(`/api/iroc/invoices/${invoiceId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ to: emailTo, subject: emailSubject, body: emailBody }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: lang === "de" ? "E-Mail gesendet" : "Email sent", description: emailTo });
      setEmailDialogOpen(false);
    } catch (err) {
      toast({ title: lang === "de" ? "Fehler" : "Error", description: String(err), variant: "destructive" });
    } finally {
      setEmailSending(false);
    }
  };

  // ── PDF helpers ─────────────────────────────────────────────────────────────
  const buildPdfParams = (overrides: {
    invoiceFormat?: "commercial" | "standard";
    reasonForExport?: string;
    shippingMethod?: string;
    termsOfDelivery?: string;
  }) => {
    const params = new URLSearchParams();
    if (overrides.invoiceFormat === "standard") params.set("invoiceFormat", "standard");
    if (overrides.reasonForExport) params.set("reasonForExport", overrides.reasonForExport);
    if (overrides.shippingMethod)  params.set("shippingMethod",  overrides.shippingMethod);
    if (overrides.termsOfDelivery) params.set("termsOfDelivery", overrides.termsOfDelivery);
    const qs = params.toString();
    return `/api/iroc/invoices/${invoiceId}/pdf${qs ? `?${qs}` : ""}`;
  };

  const fetchPdfBlob = async (url: string) => {
    const token = localStorage.getItem("iroc_token");
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("PDF fetch failed");
    return res.blob();
  };

  const handleDownloadPdf = async (overrides?: {
    invoiceFormat?: "commercial" | "standard";
    reasonForExport?: string;
    shippingMethod?: string;
    termsOfDelivery?: string;
  }) => {
    setPdfDownloading(true);
    try {
      const url  = buildPdfParams(overrides ?? {});
      const blob = await fetchPdfBlob(url);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = invoice?.invoiceNumber ? `${invoice.invoiceNumber}.pdf` : `invoice-${invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
      setPdfDialogOpen(false);
    } catch {
      alert(lang === "de" ? "PDF konnte nicht geladen werden." : "Failed to download PDF.");
    } finally {
      setPdfDownloading(false);
    }
  };

  const handlePreviewPdf = async (overrides?: {
    invoiceFormat?: "commercial" | "standard";
    reasonForExport?: string;
    shippingMethod?: string;
    termsOfDelivery?: string;
  }) => {
    setPdfPreviewing(true);
    try {
      const url  = buildPdfParams(overrides ?? {});
      const blob = await fetchPdfBlob(url);
      const objUrl = URL.createObjectURL(blob);
      window.open(objUrl, "_blank");
      // revoke after a short delay so the tab has time to load
      setTimeout(() => URL.revokeObjectURL(objUrl), 30_000);
    } catch {
      alert(lang === "de" ? "Vorschau konnte nicht geladen werden." : "Failed to load PDF preview.");
    } finally {
      setPdfPreviewing(false);
    }
  };

  const fetchDnBlob = async () => {
    const token = localStorage.getItem("iroc_token");
    const res = await fetch(`/api/iroc/invoices/${invoiceId}/delivery-note`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Delivery note fetch failed");
    return res.blob();
  };

  const handleDownloadDeliveryNote = async () => {
    setDnDownloading(true);
    try {
      const blob = await fetchDnBlob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = invoice?.invoiceNumber ? `LS-${invoice.invoiceNumber}.pdf` : `delivery-note-${invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      alert(lang === "de" ? "Lieferschein konnte nicht geladen werden." : "Failed to download delivery note.");
    } finally {
      setDnDownloading(false);
    }
  };

  const handlePreviewDeliveryNote = async () => {
    setDnPreviewing(true);
    try {
      const blob = await fetchDnBlob();
      const objUrl = URL.createObjectURL(blob);
      window.open(objUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(objUrl), 30_000);
    } catch {
      alert(lang === "de" ? "Vorschau konnte nicht geladen werden." : "Failed to load delivery note preview.");
    } finally {
      setDnPreviewing(false);
    }
  };

  const openPdfDialog = () => {
    setPdfInvoiceFormat("commercial");
    setPdfReasonForExport(invoice?.reasonForExport || "Permanent Sale / Commercial");
    setPdfShippingMethod(invoice?.shippingMethod || "DHL Express");
    setPdfTermsOfDelivery(invoice?.termsOfDelivery || "DAP (Delivered At Place)");
    setPdfDialogOpen(true);
  };

  const currentPdfOverrides = () =>
    pdfInvoiceFormat === "standard"
      ? { invoiceFormat: "standard" as const }
      : {
          invoiceFormat:   "commercial" as const,
          reasonForExport: pdfReasonForExport,
          shippingMethod:  pdfShippingMethod,
          termsOfDelivery: pdfTermsOfDelivery,
        };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-[600px]" /></div>;
  }

  if (!invoice) return <div>{lang === "de" ? "Rechnung nicht gefunden" : "Invoice not found"}</div>;

  const isExportInvoice = invoice.invoiceType === "export";

  return (
    <div className="space-y-6">
      {/* ── PDF download / preview dialog (export invoices) ── */}
      <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {lang === "de" ? "Rechnungs-PDF herunterladen" : "Download Invoice PDF"}
            </DialogTitle>
          </DialogHeader>

          {/* Format toggle */}
          <div className="space-y-2">
            <Label>{lang === "de" ? "Dokumentformat" : "Document format"}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["commercial", "standard"] as const).map(fmt => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setPdfInvoiceFormat(fmt)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors text-left ${
                    pdfInvoiceFormat === fmt
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {fmt === "commercial" ? "Commercial Invoice" : "Standard Invoice (Rechnung)"}
                </button>
              ))}
            </div>
            {pdfInvoiceFormat === "standard" && (
              <p className="text-xs text-muted-foreground pt-0.5">
                {lang === "de"
                  ? "Erzeugt ein reguläres DE/EN-Rechnungslayout — 0 % USt., § 4 Nr. 1a UStG Export-Fußnote. Keine Exportfelder."
                  : "Produces a regular DE/EN invoice layout — 0 % VAT, § 4 No. 1a UStG export footnote. No export fields."}
              </p>
            )}
          </div>

          {/* Export-specific fields — only for Commercial Invoice */}
          {pdfInvoiceFormat === "commercial" && (
            <div className="space-y-3 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {lang === "de"
                  ? "Überschreibt nur diesen Download — die gespeicherte Rechnung wird nicht geändert."
                  : "Override for this download only — the saved invoice is not changed."}
              </p>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Grund für Export" : "Reason for Export"}</Label>
                <Input
                  value={pdfReasonForExport}
                  onChange={e => setPdfReasonForExport(e.target.value)}
                  placeholder="e.g. Permanent Sale / Commercial"
                />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Versandart" : "Shipping Method"}</Label>
                <Input
                  value={pdfShippingMethod}
                  onChange={e => setPdfShippingMethod(e.target.value)}
                  placeholder="e.g. DHL Express"
                />
              </div>
              <div className="space-y-2">
                <Label>{lang === "de" ? "Lieferbedingungen (Incoterm)" : "Terms of Delivery (Incoterm)"}</Label>
                <Input
                  value={pdfTermsOfDelivery}
                  onChange={e => setPdfTermsOfDelivery(e.target.value)}
                  placeholder="e.g. DAP (Delivered At Place)"
                />
              </div>
            </div>
          )}

          <DialogFooter className="mt-2 gap-2">
            <Button variant="outline" onClick={() => setPdfDialogOpen(false)}>{t("cancel", lang)}</Button>
            <Button
              variant="outline"
              onClick={() => handlePreviewPdf(currentPdfOverrides())}
              disabled={pdfPreviewing || pdfDownloading}
            >
              <Eye className="h-4 w-4 mr-2" />
              {pdfPreviewing ? (lang === "de" ? "Wird geöffnet…" : "Opening…") : (lang === "de" ? "Vorschau" : "Preview")}
            </Button>
            <Button
              onClick={() => handleDownloadPdf(currentPdfOverrides())}
              disabled={pdfDownloading || pdfPreviewing}
            >
              <Download className="h-4 w-4 mr-2" />
              {pdfDownloading ? (lang === "de" ? "Wird erstellt…" : "Generating…") : (lang === "de" ? "Herunterladen" : "Download")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Invoice email dialog ── */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle><Mail className="h-4 w-4 inline mr-2" />{lang === "de" ? "Rechnung per E-Mail senden" : "Send Invoice by Email"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>{lang === "de" ? "An" : "To"}</Label>
              <Input value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="kunde@beispiel.de" type="email" />
            </div>
            <div className="space-y-1">
              <Label>{lang === "de" ? "Betreff" : "Subject"}</Label>
              <Input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{lang === "de" ? "Nachricht" : "Message"}</Label>
              <Textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={7} className="font-mono text-xs" />
            </div>
            <p className="text-xs text-muted-foreground">{lang === "de" ? "Die Rechnung wird als PDF-Anhang beigefügt." : "The invoice PDF will be attached automatically."}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>{lang === "de" ? "Abbrechen" : "Cancel"}</Button>
            <Button onClick={handleSendByEmail} disabled={emailSending || !emailTo || !emailSubject || !emailBody}>
              <Send className="h-4 w-4 mr-2" />{emailSending ? (lang === "de" ? "Sende…" : "Sending…") : (lang === "de" ? "Senden" : "Send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{lang === "de" ? "Rechnungskorrektur für zurückgesendete Produkte" : "Invoice correction for returned products"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {lang === "de"
                ? "Es wird ein separat nummerierter Entwurf mit negativen Netto-, Umsatzsteuer- und Bruttobeträgen erstellt. Die Originalrechnung bleibt unverändert."
                : "A separately numbered draft with negative net, VAT and gross amounts will be created. The original invoice remains unchanged."}
            </p>
            <div className="space-y-2">
              {(invoice?.items ?? []).map(item => (
                <div key={item.id} className="grid grid-cols-[1fr_7rem] items-center gap-3 rounded border p-2">
                  <div><p className="font-medium">{item.productName}</p><p className="text-xs text-muted-foreground">{lang === "de" ? "Berechnet" : "Invoiced"}: {item.quantity} · {formatMoney(item.lineTotal)}</p></div>
                  <Input aria-label={`${lang === "de" ? "Rückgabemenge" : "Returned quantity"} ${item.productName}`} type="number" min={0} max={item.quantity}
                    value={returnedQuantities[item.id] ?? 0}
                    onChange={e => setReturnedQuantities(values => ({ ...values, [item.id]: Math.max(0, Math.min(item.quantity, Number(e.target.value) || 0)) }))} />
                </div>
              ))}
            </div>
            <div className="space-y-1"><Label>{lang === "de" ? "Grund der Korrektur" : "Reason for correction"}</Label><Textarea aria-label={lang === "de" ? "Grund der Korrektur" : "Reason for correction"} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} required /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectionOpen(false)} disabled={correctionMutation.isPending}>{lang === "de" ? "Abbrechen" : "Cancel"}</Button>
            <Button onClick={submitCorrection} disabled={correctionMutation.isPending || !correctionReason.trim() || !Object.values(returnedQuantities).some(q => q > 0)}>
              {correctionMutation.isPending ? (lang === "de" ? "Wird erstellt…" : "Creating…") : (lang === "de" ? "Rechnungskorrektur erstellen" : "Create invoice correction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Unlinked item product picker ── */}
      <Dialog
        open={linkProductItem !== null}
        onOpenChange={open => {
          if (!open && linkingProductItemId === null) {
            setLinkProductItem(null);
            setLinkProductSearch("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{lang === "de" ? "Produkt verknüpfen" : "Link product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {lang === "de" ? "Artikel:" : "Item:"}{" "}
              <span className="font-medium text-foreground">{linkProductItem?.productName}</span>
              {linkProductItem?.sku && <span className="font-mono"> · {linkProductItem.sku}</span>}
            </p>
            <Input
              autoFocus
              value={linkProductSearch}
              onChange={e => setLinkProductSearch(e.target.value)}
              placeholder={lang === "de" ? "Nach SKU oder Name suchen…" : "Search by SKU or name…"}
              aria-label={lang === "de" ? "Nach SKU oder Name suchen" : "Search by SKU or name"}
            />
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {products
                .filter(product => {
                  const search = linkProductSearch.trim().toLowerCase();
                  if (!search) return true;
                  return [product.sku, product.nameEn, product.nameDe]
                    .some(value => value.toLowerCase().includes(search));
                })
                .map(product => (
                  <button
                    key={product.id}
                    type="button"
                    className="flex w-full items-start justify-between gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => handleLinkProduct(product.id)}
                    disabled={linkingProductItemId !== null}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {lang === "de" ? product.nameDe : product.nameEn}
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">{product.sku}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {linkingProductItemId === linkProductItem?.id
                        ? (lang === "de" ? "Speichert…" : "Saving…")
                        : (lang === "de" ? "Auswählen" : "Select")}
                    </span>
                  </button>
                ))}
              {products.filter(product => {
                const search = linkProductSearch.trim().toLowerCase();
                if (!search) return true;
                return [product.sku, product.nameEn, product.nameDe]
                  .some(value => value.toLowerCase().includes(search));
              }).length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {lang === "de" ? "Keine Produkte gefunden." : "No products found."}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setLinkProductItem(null);
                setLinkProductSearch("");
              }}
              disabled={linkingProductItemId !== null}
            >
              {t("cancel", lang)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Header row ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/invoices"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight font-mono">{invoice.invoiceNumber}</h1>
          <Badge
            variant={invoice.status === "paid" ? "success" : invoice.status === "sent" ? "default" : invoice.status === "cancelled" ? "destructive" : "secondary"}
            className={invoice.status === "cancelled" ? "opacity-75" : ""}
          >
            {t(invoice.status, lang)}
          </Badge>
          {invoice.correctionOfInvoiceId && (
            <Badge variant="outline" className="border-blue-300 text-blue-700">
              {lang === "de" ? "Rechnungskorrektur" : "Invoice correction"}
            </Badge>
          )}
          {invoice.sallyGenerated && (
            <Badge className="bg-pink-100 text-pink-800 hover:bg-pink-100 dark:bg-pink-900 dark:text-pink-200" title={lang === "de" ? "Von Sally automatisch erstellt" : "Auto-created by Sally"}>
              Sally
            </Badge>
          )}
          {invoice.reminderSuppressed && (
            <Badge variant="outline" className="border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400 gap-1">
              <BellOff className="h-3 w-3" />
              {lang === "de" ? "Erinnerungen unterdrückt" : "Reminders suppressed"}
            </Badge>
          )}
          {invoice.sourceOrderId && (
            <Link href="/iroc-website/orders" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
              {lang === "de" ? `Aus Bestellung #${invoice.sourceOrderId}` : `From order #${invoice.sourceOrderId}`}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
          {invoice.status === 'draft' && (
            <Button variant="outline" asChild>
              <Link href={`/invoices/${invoiceId}/edit`}>
                <Pencil className="h-4 w-4 mr-2" />
                {lang === "de" ? "Bearbeiten" : "Edit"}
              </Link>
            </Button>
          )}
          {(invoice.status === "sent" || invoice.status === "paid") && !invoice.correctionOfInvoiceId && (
            <Button variant="outline" onClick={openCorrection} className="text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700">
              <RotateCcw className="h-4 w-4 mr-2" />{lang === "de" ? "Rechnungskorrektur" : "Invoice correction"}
            </Button>
          )}
          {invoice.status === 'draft' && (
            <Button
              variant="outline"
              onClick={() => updateStatusMutation.mutate({ id: invoiceId, data: { status: 'sent' } })}
              disabled={updateStatusMutation.isPending}
            >
              <Mail className="h-4 w-4 mr-2" /> {lang === "de" ? "Als gesendet markieren" : "Mark Sent"}
            </Button>
          )}
          {invoice.status === 'sent' && !invoice.correctionOfInvoiceId && (
            <>
              <Button
                variant="outline"
                onClick={() => updateStatusMutation.mutate({ id: invoiceId, data: { status: 'draft' } })}
                disabled={updateStatusMutation.isPending}
                className="text-muted-foreground"
              >
                <RotateCcw className="h-4 w-4 mr-2" /> {lang === "de" ? "Zurück zu Entwurf" : "Revert to Draft"}
              </Button>
              <Button
                variant="outline"
                className="text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                onClick={() => updateStatusMutation.mutate({ id: invoiceId, data: { status: 'paid' } })}
                disabled={updateStatusMutation.isPending}
              >
                <CheckCircle className="h-4 w-4 mr-2" /> {lang === "de" ? "Als bezahlt markieren" : "Mark Paid"}
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={() => handleToggleSuppression(!!invoice.reminderSuppressed)}
                      disabled={togglingSuppress}
                      className={invoice.reminderSuppressed
                        ? "text-slate-500 border-slate-300 hover:bg-slate-50 hover:text-slate-700"
                        : "text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700"}
                    >
                      {invoice.reminderSuppressed
                        ? <><Bell className="h-4 w-4 mr-2" />{lang === "de" ? "Erinnerungen aktivieren" : "Re-enable Reminders"}</>
                        : <><BellOff className="h-4 w-4 mr-2" />{lang === "de" ? "Erinnerungen unterdrücken" : "Suppress Reminders"}</>}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {invoice.reminderSuppressed
                      ? (lang === "de" ? "Automatische Zahlungserinnerungen wieder aktivieren" : "Re-enable automatic payment reminders for this invoice")
                      : (lang === "de" ? "Keine weiteren automatischen Zahlungserinnerungen für diese Rechnung senden" : "Stop automatic payment reminders for this invoice")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
          {invoice.status === 'paid' && !invoice.correctionOfInvoiceId && (
            <>
              <Button
                variant="outline"
                onClick={() => updateStatusMutation.mutate({ id: invoiceId, data: { status: 'draft' } })}
                disabled={updateStatusMutation.isPending}
                className="text-muted-foreground"
              >
                <RotateCcw className="h-4 w-4 mr-2" /> {lang === "de" ? "Zurück zu Entwurf" : "Revert to Draft"}
              </Button>
              <Button
                variant="outline"
                onClick={() => updateStatusMutation.mutate({ id: invoiceId, data: { status: 'sent' } })}
                disabled={updateStatusMutation.isPending}
                className="text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700"
              >
                <RotateCcw className="h-4 w-4 mr-2" /> {lang === "de" ? "Zurück zu Gesendet" : "Revert to Sent"}
              </Button>
            </>
          )}
          {(invoice.status === 'draft' || (!invoice.correctionOfInvoiceId && (invoice.status === 'sent' || invoice.status === 'paid'))) && (
            <Button
              variant="outline"
              onClick={() => {
                const msg = lang === "de"
                  ? "Rechnung stornieren? Der Lagerbestand wird wiederhergestellt. Erstellen Sie anschließend eine Korrekturrechnung."
                  : "Cancel this invoice? Stock will be restored. You can then create a correction invoice.";
                if (confirm(msg)) updateStatusMutation.mutate({ id: invoiceId, data: { status: 'cancelled' } });
              }}
              disabled={updateStatusMutation.isPending}
              className="text-rose-600 border-rose-200 hover:bg-rose-50 hover:text-rose-700"
            >
              <Ban className="h-4 w-4 mr-2" />
              {lang === "de" ? "Stornieren" : "Cancel Invoice"}
            </Button>
          )}
          {invoice.status === 'cancelled' && (
            <>
              <Button
                variant="outline"
                onClick={() => updateStatusMutation.mutate({ id: invoiceId, data: { status: 'draft' } })}
                disabled={updateStatusMutation.isPending}
                className="text-orange-600 border-orange-200 hover:bg-orange-50 hover:text-orange-700"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {lang === "de" ? "Wiedereröffnen" : "Reopen to Draft"}
              </Button>
            </>
          )}
          {/* Preview button — non-export invoices can preview directly */}
          {!isExportInvoice && (
            <Button
              variant="outline"
              onClick={() => handlePreviewPdf()}
              disabled={pdfPreviewing || pdfDownloading}
            >
              <Eye className="h-4 w-4 mr-2" />
              {pdfPreviewing ? (lang === "de" ? "Wird geöffnet…" : "Opening…") : (lang === "de" ? "PDF-Vorschau" : "Preview PDF")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={isExportInvoice ? openPdfDialog : () => handleDownloadPdf()}
            disabled={pdfDownloading || pdfPreviewing}
          >
            <Download className="h-4 w-4 mr-2" />
            {pdfDownloading ? (lang === "de" ? "Wird erstellt…" : "Generating…") : t("download_pdf", lang)}
          </Button>
          <Button
            variant="outline"
            onClick={openEmailDialog}
            disabled={emailSending}
            title={lang === "de" ? "Per E-Mail senden" : "Send by email"}
          >
            <Send className="h-4 w-4 mr-2" />
            {lang === "de" ? "Per E-Mail" : "Send Email"}
          </Button>
          <Button
            variant="outline"
            onClick={handlePreviewDeliveryNote}
            disabled={dnPreviewing || dnDownloading}
          >
            <Eye className="h-4 w-4 mr-2" />
            {dnPreviewing ? (lang === "de" ? "Wird geöffnet…" : "Opening…") : (lang === "de" ? "Lieferschein Vorschau" : "Preview Note")}
          </Button>
          <Button
            variant="outline"
            onClick={handleDownloadDeliveryNote}
            disabled={dnDownloading || dnPreviewing}
          >
            <Truck className="h-4 w-4 mr-2" />
            {dnDownloading ? (lang === "de" ? "Wird erstellt…" : "Generating…") : (lang === "de" ? "Lieferschein" : "Delivery Note")}
          </Button>
          {invoice.status === 'draft' && (
            <Button
              variant="destructive"
              size="icon"
              title={lang === "de" ? "Entwurf löschen" : "Delete draft"}
              onClick={() => { if (confirm(lang === "de" ? "Diesen Rechnungsentwurf löschen?" : "Delete this draft invoice?")) deleteMutation.mutate({ id: invoiceId }); }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* ── Legacy customer edit dialog ── */}
      {invoice.customerId && !invoice.websiteCustomerId && (
        <Dialog open={lcEditOpen} onOpenChange={setLcEditOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{lang === "de" ? "Kundendaten bearbeiten (Legacy)" : "Edit Customer (Legacy)"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleLegacyCustomerSave} className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{lang === "de" ? "Anrede" : "Salutation"}</Label>
                  <Input value={lcSalutation} onChange={e => setLcSalutation(e.target.value)} placeholder="Herr / Frau / Mr. / Ms." />
                </div>
                <div className="space-y-1">
                  <Label>{lang === "de" ? "Titel / Grad" : "Title / Degree"}</Label>
                  <Input value={lcTitle} onChange={e => setLcTitle(e.target.value)} placeholder="Dr. med / Prof." />
                </div>
              </div>
              <div className="space-y-1">
                <Label>{t("name", lang)} *</Label>
                <Input required value={lcName} onChange={e => setLcName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{lang === "de" ? "Unternehmen" : "Company"}</Label>
                <Input value={lcCompany} onChange={e => setLcCompany(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{lang === "de" ? "Adresse" : "Address"}</Label>
                <Input value={lcAddress} onChange={e => setLcAddress(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{lang === "de" ? "PLZ" : "Postal Code"}</Label>
                  <Input value={lcPostal} onChange={e => setLcPostal(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{lang === "de" ? "Stadt" : "City"}</Label>
                  <Input value={lcCity} onChange={e => setLcCity(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>{lang === "de" ? "Land" : "Country"}</Label>
                <Input value={lcCountry} onChange={e => setLcCountry(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("vat_id", lang)}</Label>
                <Input value={lcVatId} onChange={e => setLcVatId(e.target.value)} placeholder="DE123456789" />
              </div>
              <div className="space-y-1">
                <Label>E-Mail</Label>
                <Input type="email" value={lcEmail} onChange={e => setLcEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{lang === "de" ? "Telefon" : "Phone"}</Label>
                <Input value={lcPhone} onChange={e => setLcPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("notes", lang)}</Label>
                <Input value={lcNotes} onChange={e => setLcNotes(e.target.value)} />
              </div>
              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setLcEditOpen(false)}>{lang === "de" ? "Abbrechen" : "Cancel"}</Button>
                <Button type="submit" disabled={lcSaving}>{lcSaving ? (lang === "de" ? "Speichert…" : "Saving…") : t("save", lang)}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Pending payment reminders banner ── */}
      {pendingReminders.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {lang === "de"
                  ? `${pendingReminders.length === 1 ? "1 ausstehende Zahlungserinnerung" : `${pendingReminders.length} ausstehende Zahlungserinnerungen`} in der Warteschlange`
                  : `${pendingReminders.length === 1 ? "1 pending payment reminder" : `${pendingReminders.length} pending payment reminders`} queued`}
              </p>
              {pendingReminders.map(reminder => (
                <div key={reminder.id} className="flex items-center justify-between gap-2 rounded-sm bg-amber-100 dark:bg-amber-900/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-amber-900 dark:text-amber-200 truncate">{reminder.subject}</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {lang === "de" ? "An" : "To"}: {reminder.recipient_email}
                      {" · "}
                      {new Date(reminder.created_at).toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-amber-300 bg-white text-amber-800 hover:bg-amber-50 hover:text-amber-900 dark:bg-transparent dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/50"
                    disabled={cancellingReminder === reminder.id}
                    onClick={() => handleCancelReminder(reminder.id)}
                  >
                    <Ban className="h-3 w-3 mr-1" />
                    {cancellingReminder === reminder.id
                      ? (lang === "de" ? "Storniert…" : "Cancelling…")
                      : (lang === "de" ? "Stornieren" : "Cancel")}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Customer / Invoice details cards ── */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle>{t("customer", lang)}</CardTitle>
            {invoice.customerId && !invoice.websiteCustomerId && (
              <Button variant="ghost" size="icon" title={lang === "de" ? "Kundendaten bearbeiten" : "Edit customer"} onClick={openLegacyCustomerEdit}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {/* Show salutation + title + name on the same line (mirrors PDF layout) */}
            <p className="font-semibold text-base">
              {[invoice.customer.salutation, invoice.customer.title, invoice.customer.name].filter(Boolean).join(" ")}
            </p>
            {invoice.customer.company && <p>{invoice.customer.company}</p>}
            <p>{invoice.customer.address}</p>
            <p>{[invoice.customer.postalCode, invoice.customer.city].filter(Boolean).join(" ")}</p>
            <p>{invoice.customer.country}</p>
            {invoice.customer.vatId && <p className="mt-2 text-muted-foreground">{t("vat_id", lang)}: {invoice.customer.vatId}</p>}
            {invoice.customerId && !invoice.websiteCustomerId && (
              <p className="mt-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                {lang === "de" ? "Legacy-Kunde · Anrede/Titel können bearbeitet werden" : "Legacy customer · salutation/title can be edited above"}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{lang === "de" ? "Rechnungsdetails" : "Invoice Details"}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {invoice.correctionOfInvoiceId && invoice.referenceNumber && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{lang === "de" ? "Originalrechnung" : "Original invoice"}</span>
                <Link className="font-mono text-blue-600 hover:underline" href={`/invoices/${invoice.correctionOfInvoiceId}`}>{invoice.referenceNumber}</Link>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("issue_date", lang)}</span>
              <span className="font-medium">{formatDate(invoice.issueDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("due_date", lang)}</span>
              <span className="font-medium">{invoice.dueDate ? formatDate(invoice.dueDate) : "-"}</span>
            </div>
            {invoice.orderNumber && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{lang === "de" ? "Auftragsnummer" : "Order No."}</span>
                <span className="font-medium font-mono">{invoice.orderNumber}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("type", lang)}</span>
              <span className="font-medium">{getInvoiceTypeLabel(invoice.invoiceType, lang)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("language", lang)}</span>
              <span className="font-medium uppercase">{invoice.language}</span>
            </div>
            {isExportInvoice && invoice.shippingMethod && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{lang === "de" ? "Versand" : "Shipping"}</span>
                <span className="font-medium">{invoice.shippingMethod}</span>
              </div>
            )}
            {isExportInvoice && invoice.termsOfDelivery && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Incoterm</span>
                <span className="font-medium">{invoice.termsOfDelivery}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {!!invoice.corrections?.length && (
        <Card>
          <CardHeader><CardTitle>{lang === "de" ? "Rechnungskorrekturen" : "Invoice corrections"}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {invoice.corrections.map(correction => (
              <Link key={correction.id} href={`/invoices/${correction.id}`} className="rounded border px-3 py-2 font-mono text-sm text-blue-600 hover:bg-muted hover:underline">
                {correction.invoiceNumber} · {t(correction.status, lang)}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {invoice.shipment && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Sendcloud shipment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <div>
                <span className="text-muted-foreground">Status: </span>
                <span className="font-medium">{invoice.shipment.status.replace(/_/g, " ")}</span>
              </div>
              {invoice.shipment.trackingNumber && (
                <div>
                  <span className="text-muted-foreground">Tracking: </span>
                  <span className="font-medium font-mono">{invoice.shipment.trackingNumber}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">{lang === "de" ? "Versandkosten" : "Delivery cost"}: </span>
                <span className="font-medium">{formatMoney(invoice.shipment.deliveryCosts)}</span>
              </div>
              {Number(invoice.shipment.insuranceCosts) > 0 && (
                <div>
                  <span className="text-muted-foreground">{lang === "de" ? "Versicherung" : "Insurance"}: </span>
                  <span className="font-medium">{formatMoney(invoice.shipment.insuranceCosts)}</span>
                </div>
              )}
            </div>
            {invoice.shipment.labelUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={invoice.shipment.labelUrl} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4 mr-2" />
                  Open shipping label
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Line items table ── */}
      <Card className="overflow-hidden">
        <div className="overflow-y-auto max-h-[60vh] sticky-header-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("product", lang)}</TableHead>
              <TableHead className="text-right">{t("quantity", lang)}</TableHead>
              <TableHead className="text-right">{t("unit_price", lang)}</TableHead>
              <TableHead className="text-right">{t("total", lang)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.items.map(item => {
              const disc = parseFloat(item.discountPercent || "0") || 0;
              const grossUnit = parseFloat(item.unitPrice);
              const hasDiscount = disc > 0 && !item.isDemo;
              const noProductLink = !item.productId;
              return (
                <TableRow key={item.id} className={item.isDemo ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium flex-wrap">
                      {item.productName}
                      {item.isDemo && (
                        <Badge variant="outline" className="text-[10px] py-0 border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-950/20">
                          <Gift className="h-2.5 w-2.5 mr-1" />Demo
                        </Badge>
                      )}
                      {hasDiscount && (
                        <Badge variant="secondary" className="text-[10px] py-0">
                          <Percent className="h-2.5 w-2.5 mr-0.5" />{disc.toFixed(0)}% off
                        </Badge>
                      )}
                      {noProductLink ? (
                        <>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-[10px] py-0 border-orange-400 text-orange-600 bg-orange-50 dark:bg-orange-950/20 cursor-default">
                                  <AlertTriangle className="h-2.5 w-2.5 mr-1" />{lang === "de" ? "Keine Produktverknüpfung" : "No product link"}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-56 text-xs">
                                {lang === "de"
                                  ? 'Dieser Artikel hat kein verknüpftes Produkt. Das Dashboard gruppiert ihn unter "Sonstige" — verknüpfen Sie ihn mit einem Produkt für korrekte Kategoriesummen.'
                                  : 'This item has no linked product. The dashboard will group it under "Other" — link it to a product to get accurate category totals.'}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px] border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/40"
                            onClick={() => openProductLinkDialog(item)}
                            disabled={linkingProductItemId !== null}
                          >
                            {lang === "de" ? "Verknüpfen" : "Link product"}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
                          onClick={() => handleUnlinkProduct(item)}
                          disabled={linkingProductItemId !== null || unlinkingProductItemId !== null}
                        >
                          {unlinkingProductItemId === item.id
                            ? (lang === "de" ? "Entfernt…" : "Unlinking…")
                            : (lang === "de" ? "Produktverknüpfung entfernen" : "Unlink product")}
                        </Button>
                      )}
                    </div>
                    {item.sku && <div className="text-xs text-muted-foreground font-mono">{item.sku}</div>}
                    {item.lotNumber && <div className="text-xs text-muted-foreground">LOT: {item.lotNumber}</div>}
                    {item.description && <div className="text-xs text-muted-foreground">{item.description}</div>}
                    {isExportInvoice && (item.hsCode || item.countryOfOrigin || item.weightKg) && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {`HS ${item.hsCode || "—"} · ${item.countryOfOrigin || "—"} · ${item.weightKg || "—"} kg`}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">
                    {item.isDemo ? (
                      <span className="text-muted-foreground line-through text-xs">{formatMoney(item.unitPrice)}</span>
                    ) : hasDiscount ? (
                      <div>
                        <div className="line-through text-xs text-muted-foreground">{formatMoney(grossUnit)}</div>
                        <div>{formatMoney(grossUnit * (1 - disc / 100))}</div>
                      </div>
                    ) : (
                      formatMoney(item.unitPrice)
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {item.isDemo ? (
                      <span className="text-amber-600 font-bold">€ 0.00</span>
                    ) : (
                      formatMoney(item.lineTotal)
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="text-right">{t("subtotal", lang)}</TableCell>
              <TableCell className="text-right">{formatMoney(invoice.subtotal)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={3} className="text-right">{t("delivery_costs", lang)}</TableCell>
              <TableCell className="text-right">{formatMoney(invoice.deliveryCosts)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={3} className="text-right">{lang === "de" ? "Versicherungskosten" : "Insurance costs"}</TableCell>
              <TableCell className="text-right">{formatMoney(invoice.insuranceCosts)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={3} className="text-right">
                VAT ({(parseFloat(invoice.vatRate) * 100).toFixed(0)}%)
              </TableCell>
              <TableCell className="text-right">{formatMoney(invoice.vatAmount)}</TableCell>
            </TableRow>
            <TableRow className="text-base font-bold bg-muted/50">
              <TableCell colSpan={3} className="text-right">{t("total", lang)}</TableCell>
              <TableCell className="text-right text-primary">{formatMoney(invoice.total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        </div>
      </Card>

      {invoice.notes && (
        <Card>
          <CardHeader><CardTitle>{t("notes", lang)}</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
