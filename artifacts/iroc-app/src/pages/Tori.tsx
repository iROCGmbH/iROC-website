import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { adminGet } from "@/lib/admin-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Bot, Send, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
  Package, Wrench, RotateCcw, Mail, Building2, Hash, ShoppingCart,
  Banknote, Info, Sparkles, Brain, ShoppingBag, Check, Trash2,
  Eye, BadgeAlert, Star, ClipboardCheck, Upload, FileText, Loader2, X, Copy,
  TrendingUp, Layers, Archive, RefreshCw, ChevronRight, Boxes, AlertOctagon,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { Link } from "wouter";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = "analysis" | "approvals" | "contracts" | "reorder" | "finance" | "history" | "merchandise" | "learning";

interface ToriLineItem {
  name: string;
  sku: string | null;
  quantity: number | null;
  unit_price: number | null;
  currency: string | null;
}

interface ToriAnalysis {
  classification: { type: "product" | "service"; usage: "resale" | "company_usage" | "none" };
  vendor: { name: string | null; email: string | null; country?: string | null };
  line_items: ToriLineItem[];
  missing_info: string[];
  tori_notes: string;
}

interface ChatMessage { role: "user" | "assistant"; content: string; }

interface LearningLog {
  id: number;
  learned_context: string;
  is_universal_rule: boolean;
  vendor_hint: string | null;
  category_hint: string | null;
  admin_correction: string;
  admin_notes: string | null;
  created_at: string;
}

interface ReorderDraft {
  id: number;
  product_name: string | null;
  product_sku: string | null;
  vendor_email: string;
  vendor_country: string | null;
  quantity_to_order: number | null;
  contract_price: string | null;
  sales_milestone_achieved: boolean;
  email_to: string;
  email_subject: string;
  email_body_markdown: string;
  status: "pending" | "sending" | "unconfirmed" | "approved";
  email_send_error: string | null;
  email_sent_at: string | null;
  email_message_id: string | null;
  send_attempt_id: string | null;
  send_claimed_at: string | null;
  email_last_attempt_at: string | null;
  send_attempt_count: number;
  delivery_provider: string | null;
  email_content_sha256: string | null;
  reconciled_at: string | null;
  reconciliation_action: string | null;
  created_at: string;
  stock_quantity: number | null;
  low_stock_threshold: number | null;
}

interface LowStockProduct {
  id: number;
  sku: string;
  name_de: string;
  name_en: string;
  stock_quantity: number;
  low_stock_threshold: number;
  purchase_price: string | null;
}

// Finance tab
interface Expense {
  id: number;
  vendor_name: string | null;
  invoice_date: string | null;
  invoice_number: string | null;
  category: "product" | "service" | "company_usage" | null;
  net_amount: string | number | null;
  tax_amount: string | number | null;
  gross_amount: string | number | null;
  currency: string;
  source: string | null;
  notes: string | null;
  shipping_cost: string | number | null;
  created_at: string;
}
interface ExpenseItem {
  id: number;
  expense_id: number;
  product_name_raw: string | null;
  product_name_local: string | null;
  lot_number: string | null;
  quantity: number | null;
  unit_price: string | number | null;
  discount_rate: string | number | null;
  line_total: string | number | null;
  sort_order: number;
}

interface FinanceHistoryItem {
  record_id: number;
  record_type: "expense" | "invoice";
  party_name: string | null;
  document_number: string | null;
  order_number: string | null;
  document_date: string | null;
  category: string | null;
  source: string | null;
  currency: string;
  net_amount: string | number | null;
  tax_amount: string | number | null;
  total_amount: string | number | null;
  file_object_path: string | null;
  notes: string | null;
  status: string | null;
  created_at: string;
}

interface FinanceHistoryResponse {
  items: FinanceHistoryItem[];
  count: number;
  page?: number;
  page_size?: number;
  total?: number;
}

function formatFinanceHistoryMoney(amount: string | number | null, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "EUR";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: safeCurrency,
  }).format(value);
}

// Merchandise tab
interface InventoryLot {
  id: number;
  product_id: number;
  lot_number: string | null;
  purchase_date: string | null;
  expiration_date: string | null;
  description: string | null;
  quantity_received: number;
  quantity_used: number;
  status: "pending" | "active" | "depleted";
  created_at: string;
  // joined from product
  sku: string;
  name_en: string;
  name_de: string;
  category: string | null;
  purchase_price: string | null;
}

// Pipeline / Approvals types

interface ProposedLineItem {
  name: string;
  sku: string | null;
  quantity: number | null;
  unit_price: number | null;
  currency: string | null;
  line_total: number | null;
  discount_rate: number | null;
  matched_product_id: number | null;
  matched_product_name: string | null;
  is_new_product: boolean;
  suggested_product: { name_de: string; name_en: string; sku: string | null; category: string | null } | null;
  lot_number: string | null;
  compliance: {
    ok: boolean | null;
    expected_price: number | null;
    tier_description: string | null;
    notes: string | null;
  };
}

interface PendingAction {
  id: number;
  invoice_text: string | null;
  proposed_expense: {
    vendor_name: string | null;
    vendor_country?: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    net_amount: number | null;
    tax_amount: number | null;
    gross_amount: number | null;
    currency: string;
    shipping_cost: number | null;
    category: "product" | "service" | "company_usage" | null;
  } | null;
  proposed_items: ProposedLineItem[] | null;
  missing_fields: string[] | null;
  compliance_summary: {
    has_contract: boolean;
    all_prices_correct: boolean | null;
    issues: string[];
  } | null;
  status: "pending" | "approved" | "rejected";
  admin_notes: string | null;
  executed_expense_id: number | null;
  created_at: string;
}

interface ToriContract {
  id: number;
  vendor_name: string;
  discount_tiers: Array<{
    from_qty: number;
    to_qty: number | null;
    unit_price: number;
    currency: string;
    discount_pct: number | null;
    notes: string | null;
  }> | null;
  products_covered: string[] | null;
  effective_from: string | null;
  notes: string | null;
  source_object_path: string | null;
  source_file_name: string | null;
  source_file_size: string | number | null;
  source_page_count: number | null;
  analysis_json: Record<string, unknown> | null;
  analyzed_at: string | null;
  analysis_status: "pending" | "analyzing" | "analyzed" | "failed";
  analysis_error: string | null;
  created_at: string;
}

interface PdfTextWarning {
  code: "PDF_TEXT_NOT_EXTRACTABLE";
  reason: "image_only_or_scanned_pdf";
  extracted_character_count: number;
  guidance: string;
}

interface PdfTextWarningResponse {
  error: string;
  warning?: PdfTextWarning;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseAnalysis(reply: string): ToriAnalysis | null {
  const match = reply.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try { return JSON.parse(match[1]) as ToriAnalysis; } catch { return null; }
}

function formatMoney(amount: number | string | null, currency?: string | null) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (n == null || isNaN(n)) return "—";
  const cur = currency ?? "EUR";
  try { return new Intl.NumberFormat("de-DE", { style: "currency", currency: cur }).format(n); }
  catch { return `${n} ${cur}`; }
}

function getPdfTextWarning(response: PdfTextWarningResponse): PdfTextWarning | null {
  return response.warning?.code === "PDF_TEXT_NOT_EXTRACTABLE" ? response.warning : null;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ClassificationBadge({ analysis }: { analysis: ToriAnalysis }) {
  const { type, usage } = analysis.classification;
  if (type === "service")
    return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 gap-1.5 text-sm px-3 py-1"><Wrench className="h-3.5 w-3.5" />Service</Badge>;
  if (usage === "resale")
    return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 gap-1.5 text-sm px-3 py-1"><ShoppingCart className="h-3.5 w-3.5" />Product — Resale</Badge>;
  return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 gap-1.5 text-sm px-3 py-1"><Package className="h-3.5 w-3.5" />Product — Company Usage</Badge>;
}

function AnalysisResult({ analysis }: { analysis: ToriAnalysis }) {
  const isResale = analysis.classification.usage === "resale";
  return (
    <div className="space-y-4">
      <Card className="border-0 bg-muted/30">
        <CardContent className="pt-4 pb-3 flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Classification</span>
          <ClassificationBadge analysis={analysis} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />Vendor</CardTitle></CardHeader>
        <CardContent className="pt-0 pb-4 space-y-1">
          <p className="text-sm font-medium">{analysis.vendor.name ?? <span className="text-muted-foreground italic">Unknown</span>}</p>
          {analysis.vendor.email
            ? <a href={`mailto:${analysis.vendor.email}`} className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1 hover:underline"><Mail className="h-3 w-3" />{analysis.vendor.email}</a>
            : <p className="text-xs text-muted-foreground italic">No email detected</p>}
           {analysis.vendor.country && <p className="text-xs text-muted-foreground">{analysis.vendor.country}</p>}
        </CardContent>
      </Card>

      {isResale && (
        <Card>
          <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Hash className="h-4 w-4 text-muted-foreground" />Line Items<Badge variant="secondary" className="text-xs">{analysis.line_items.length}</Badge></CardTitle></CardHeader>
          <CardContent className="pt-0 pb-0 overflow-x-auto">
            {analysis.line_items.length === 0
              ? <p className="text-sm text-muted-foreground italic pb-4">No line items extracted</p>
              : <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit Price</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {analysis.line_items.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm font-medium">{item.name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{item.sku ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{item.quantity ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums"><span className="flex items-center justify-end gap-1"><Banknote className="h-3 w-3 text-muted-foreground" />{formatMoney(item.unit_price, item.currency)}</span></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>}
          </CardContent>
        </Card>
      )}

      {analysis.missing_info.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" />Missing / Unclear Information</CardTitle></CardHeader>
          <CardContent className="pt-0 pb-4 space-y-1.5">
            {analysis.missing_info.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0 mt-2" />
                <span className="text-destructive/80">{issue}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="bg-violet-50/50 dark:bg-violet-950/20 border-violet-100 dark:border-violet-900">
        <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm font-semibold flex items-center gap-2 text-violet-700 dark:text-violet-400"><Sparkles className="h-4 w-4" />Tori&apos;s Reasoning</CardTitle></CardHeader>
        <CardContent className="pt-0 pb-4"><p className="text-sm text-violet-800 dark:text-violet-300 leading-relaxed">{analysis.tori_notes}</p></CardContent>
      </Card>
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const parsed = !isUser ? parseAnalysis(msg.content) : null;
  const plainText = msg.content.replace(/```json[\s\S]*?```/g, "").trim();
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {!isUser && <div className="shrink-0 w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center"><Bot className="h-4 w-4 text-violet-600 dark:text-violet-400" /></div>}
      <div className={cn("max-w-[85%] space-y-3", isUser && "items-end")}>
        {isUser
          ? <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">{msg.content}</div>
          : parsed
            ? <AnalysisResult analysis={parsed} />
            : <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm whitespace-pre-wrap">{plainText || msg.content}</div>}
      </div>
    </div>
  );
}

// ── Tab: Invoice Analysis ──────────────────────────────────────────────────────

function AnalysisTab({ onGoToApprovals }: { onGoToApprovals?: () => void }) {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const de = lang === "de";

  const [invoiceText, setInvoiceText]         = useState("");
  const [contractContext, setContractContext]   = useState("");
  const [learningLogs, setLearningLogs]         = useState("");
  const [showContract, setShowContract]         = useState(false);
  const [showLogs, setShowLogs]                 = useState(false);
  const [history, setHistory]                   = useState<ChatMessage[]>([]);
  const [followUp, setFollowUp]                 = useState("");
  const [loading, setLoading]                   = useState(false);
  const [pdfUploading, setPdfUploading]               = useState(false);
  const [pdfFileName, setPdfFileName]                 = useState<string | null>(null);
  const [invoicePdfUploading, setInvoicePdfUploading] = useState(false);
  const [invoicePdfFileName, setInvoicePdfFileName]   = useState<string | null>(null);
  const bottomRef                                     = useRef<HTMLDivElement>(null);
  const controllerRef                                 = useRef<AbortController | null>(null);
  const pdfInputRef                                   = useRef<HTMLInputElement>(null);
  const invoicePdfInputRef                            = useRef<HTMLInputElement>(null);
  const pipelineFileRef                               = useRef<HTMLInputElement>(null);
  const [pipelineLoading, setPipelineLoading]   = useState(false);
  const [pipelineResult, setPipelineResult]     = useState<{ action_id: number } | null>(null);
  const [pipelineWarning, setPipelineWarning]   = useState<PdfTextWarning | null>(null);

  async function handlePipelineAnalyze(file: File) {
    setPipelineLoading(true);
    setPipelineResult(null);
    setPipelineWarning(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/iroc/tori/analyze-invoice", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json() as (
        { action: { id: number }; analysis: unknown }
        | PdfTextWarningResponse
      );
      if (!res.ok) {
        const warning = getPdfTextWarning(data as PdfTextWarningResponse);
        if (warning) {
          setPipelineWarning(warning);
          return;
        }
        throw new Error((data as PdfTextWarningResponse).error ?? `HTTP ${res.status}`);
      }
      const pipelineData = data as { action: { id: number }; analysis: unknown };
      setPipelineResult({ action_id: pipelineData.action.id });
      toast({
        title: de ? "Analyse abgeschlossen" : "Analysis complete",
        description: de ? `Aktion #${pipelineData.action.id} — öffne 'Genehmigungen' zum Überprüfen.` : `Action #${pipelineData.action.id} — open Approvals to review.`,
      });
    } catch (err) {
      toast({
        title: de ? "Analysefehler" : "Analysis error",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    } finally { setPipelineLoading(false); }
  }

  async function handlePdfUpload(file: File) {
    if (!file) return;
    setPdfUploading(true);
    setPdfFileName(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/iroc/tori/extract-pdf", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const { error } = await res.json() as { error: string };
        throw new Error(error ?? `HTTP ${res.status}`);
      }
      const { text, pages } = await res.json() as { text: string; pages: number };
      setContractContext(text.trim());
      setShowContract(true);
      toast({ title: de ? "PDF extrahiert" : "PDF extracted", description: de ? `${pages} Seiten gelesen` : `${pages} pages read` });
    } catch (err) {
      setPdfFileName(null);
      toast({ title: de ? "PDF-Fehler" : "PDF error", description: err instanceof Error ? err.message : "Could not read PDF", variant: "destructive" });
    } finally { setPdfUploading(false); }
  }

  async function handleInvoicePdfUpload(file: File) {
    if (!file) return;
    setInvoicePdfUploading(true);
    setInvoicePdfFileName(file.name);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/iroc/tori/extract-pdf", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const { error } = await res.json() as { error: string };
        throw new Error(error ?? `HTTP ${res.status}`);
      }
      const { text, pages } = await res.json() as { text: string; pages: number };
      setInvoiceText(text.trim());
      toast({ title: de ? "PDF extrahiert" : "PDF extracted", description: de ? `${pages} Seiten gelesen` : `${pages} pages read` });
    } catch (err) {
      setInvoicePdfFileName(null);
      toast({ title: de ? "PDF-Fehler" : "PDF error", description: err instanceof Error ? err.message : "Could not read PDF", variant: "destructive" });
    } finally { setInvoicePdfUploading(false); }
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, loading]);

  async function callTori(message: string, includeContext: boolean) {
    if (loading) return;
    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setHistory(prev => [...prev, { role: "user", content: message }]);
    try {
      const res = await fetch("/api/iroc/tori/chat", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message, history,
          invoiceText:     includeContext ? invoiceText     : undefined,
          contractContext: includeContext ? contractContext  : undefined,
          learningLogs:    includeContext ? learningLogs     : undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { reply } = await res.json() as { reply: string };
      setHistory(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast({ title: de ? "Fehler" : "Error", description: de ? "Tori konnte nicht antworten." : "Tori could not respond.", variant: "destructive" });
      setHistory(prev => prev.slice(0, -1));
    } finally { setLoading(false); }
  }

  const hasConversation = history.length > 0;

  return (
    <div className="flex gap-6 min-h-0 flex-1 overflow-hidden">
      {/* Left: Input */}
      <div className="w-[340px] shrink-0 flex flex-col gap-3 overflow-y-auto pb-4">
        {/* ── AI Pipeline upload ── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{de ? "KI-Pipeline" : "AI Pipeline"}</p>
          <input
            ref={pipelineFileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePipelineAnalyze(f); e.target.value = ""; }}
          />
          <button
            type="button"
            onClick={() => pipelineFileRef.current?.click()}
            disabled={pipelineLoading || loading}
            className="w-full flex items-center justify-center gap-2 py-4 border-2 border-dashed border-violet-300 dark:border-violet-700 rounded-lg bg-violet-50/30 dark:bg-violet-950/10 hover:bg-violet-100/40 dark:hover:bg-violet-950/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-violet-700 dark:text-violet-400"
          >
            {pipelineLoading
              ? <><Loader2 className="h-4 w-4 animate-spin" />{de ? "Tori analysiert\u2026" : "Tori analyzing\u2026"}</>
              : <><Upload className="h-4 w-4" />{de ? "Rechnung hochladen & analysieren" : "Upload invoice & analyze"}</>}
          </button>
          {pipelineResult && !pipelineLoading && (
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300 truncate">
                  {de ? `Aktion #${pipelineResult.action_id} bereit` : `Action #${pipelineResult.action_id} ready`}
                </span>
              </div>
              {onGoToApprovals && (
                <button type="button" onClick={onGoToApprovals}
                  className="text-xs text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-200 font-medium flex items-center gap-1 shrink-0">
                  {de ? "\u00d6ffnen" : "Open"}<ChevronRight className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {pipelineWarning && !pipelineLoading && (
            <div role="alert" className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  {de ? "Tori kann diese PDF nicht analysieren" : "Tori can’t analyze this PDF"}
                </p>
                <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                  {de
                    ? "Die PDF enthält kaum auslesbaren Text und ist wahrscheinlich ein Scan oder Bild. Lade eine durchsuchbare Text-PDF hoch oder füge den Rechnungstext manuell ein."
                    : "This PDF contains very little readable text and is likely a scan or image. Upload a searchable text PDF or paste the invoice text manually."}
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="relative"><div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div><div className="relative flex justify-center"><span className="bg-background px-2 text-xs text-muted-foreground">{de ? "oder manuell" : "or manually"}</span></div></div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{de ? "Rechnungstext (Raw)" : "Invoice Text (Raw)"}</label>
          {/* Invoice PDF upload */}
          <input
            ref={invoicePdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleInvoicePdfUpload(f); e.target.value = ""; }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => invoicePdfInputRef.current?.click()}
              disabled={loading || invoicePdfUploading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-400 hover:bg-violet-100/60 dark:hover:bg-violet-950/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {invoicePdfUploading
                ? <><Loader2 className="h-3 w-3 animate-spin" />{de ? "Lese PDF\u2026" : "Reading PDF\u2026"}</>
                : <><Upload className="h-3 w-3" />{de ? "PDF hochladen" : "Upload PDF"}</>}
            </button>
            {invoicePdfFileName && !invoicePdfUploading && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                <FileText className="h-3 w-3 shrink-0 text-violet-400" />
                <span className="truncate max-w-[130px]">{invoicePdfFileName}</span>
                <button type="button" onClick={() => { setInvoicePdfFileName(null); setInvoiceText(""); }} className="shrink-0 text-muted-foreground/60 hover:text-destructive transition-colors"><X className="h-3 w-3" /></button>
              </span>
            )}
          </div>
          <Textarea placeholder={de ? "Rohen Rechnungstext hier einf\u00fcgen\u2026" : "Paste raw invoice text extracted from PDF\u2026"} value={invoiceText} onChange={e => setInvoiceText(e.target.value)} className="min-h-[200px] font-mono text-xs resize-none" disabled={loading || invoicePdfUploading} />
        </div>

        {/* Contract context */}
        <div className="border rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted/40 transition-colors" onClick={() => setShowContract(v => !v)}>
            <span className="flex items-center gap-2"><Info className="h-3.5 w-3.5" />{de ? "Vertragsregeln (optional)" : "Distribution Contract Rules (optional)"}</span>
            {showContract ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showContract && (
            <div className="px-3 pb-3 space-y-2 mt-2">
              {/* PDF upload */}
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfUpload(f); e.target.value = ""; }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={loading || pdfUploading}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-400 hover:bg-violet-100/60 dark:hover:bg-violet-950/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pdfUploading
                    ? <><Loader2 className="h-3 w-3 animate-spin" />{de ? "Lese PDF\u2026" : "Reading PDF\u2026"}</>
                    : <><Upload className="h-3 w-3" />{de ? "PDF hochladen" : "Upload PDF"}</>}
                </button>
                {pdfFileName && !pdfUploading && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                    <FileText className="h-3 w-3 shrink-0 text-violet-400" />
                    <span className="truncate max-w-[130px]">{pdfFileName}</span>
                    <button type="button" onClick={() => { setPdfFileName(null); setContractContext(""); }} className="shrink-0 text-muted-foreground/60 hover:text-destructive transition-colors"><X className="h-3 w-3" /></button>
                  </span>
                )}
              </div>
              <Textarea
                placeholder={de ? "Vertragsregeln einf\u00fcgen oder PDF hochladen\u2026" : "Paste contract rules or upload a PDF\u2026"}
                value={contractContext}
                onChange={e => setContractContext(e.target.value)}
                className="min-h-[100px] text-xs resize-none"
                disabled={loading || pdfUploading}
              />
            </div>
          )}
        </div>

        {/* Learning logs */}
        <div className="border rounded-lg overflow-hidden">
          <button className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted/40 transition-colors" onClick={() => setShowLogs(v => !v)}>
            <span className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5" />{de ? "Lernprotokoll (optional)" : "Admin Learning Logs (optional)"}</span>
            {showLogs ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showLogs && <div className="px-3 pb-3"><Textarea placeholder={de ? "Admin-Korrekturen einf\u00fcgen\u2026" : "Paste past admin corrections\u2026"} value={learningLogs} onChange={e => setLearningLogs(e.target.value)} className="min-h-[100px] text-xs resize-none mt-2" disabled={loading} /></div>}
        </div>

        <Button onClick={() => { if (!invoiceText.trim()) { toast({ title: de ? "Kein Rechnungstext" : "No invoice text", variant: "destructive" }); return; } setHistory([]); callTori(de ? "Analysiere diese Rechnung." : "Analyze this invoice.", true); }} disabled={loading || !invoiceText.trim()} className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white">
          <Sparkles className="h-4 w-4" />
          {loading ? (de ? "Analysiere\u2026" : "Analyzing\u2026") : (de ? "Rechnung analysieren" : "Analyze Invoice")}
        </Button>

        {hasConversation && (
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground w-full" onClick={() => { if (controllerRef.current) controllerRef.current.abort(); setHistory([]); setInvoiceText(""); setLoading(false); }}>
            <RotateCcw className="h-3.5 w-3.5" />{de ? "Neu starten" : "Reset"}
          </Button>
        )}
      </div>

      {/* Right: Chat */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto space-y-6 pb-4">
          {!hasConversation && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-16">
              <div className="w-16 h-16 rounded-2xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center"><Bot className="h-8 w-8 text-violet-500" /></div>
              <div>
                <h2 className="text-lg font-semibold">{de ? "Hallo, ich bin Tori" : "Hi, I\u2019m Tori"}</h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">{de ? "F\u00fcge einen Rechnungstext ein und klicke auf Analysieren." : "Paste an invoice text and click Analyze to get started."}</p>
              </div>
              <div className="grid gap-2 text-left max-w-sm w-full mt-2">
                {[
                  de ? "Klassifizierung: Service, Eigennutzung oder Wiederverkauf" : "Classifies as service, company usage, or resale",
                  de ? "Extrahiert Positionen mit SKU, Menge & Preis" : "Extracts line items with SKU, qty & price",
                  de ? "Erkennt Lieferant und E-Mail-Kontakt" : "Detects vendor name and contact email",
                  de ? "Meldet fehlende oder unlesbare Angaben" : "Flags missing or unreadable fields",
                ].map((text, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />{text}
                  </div>
                ))}
              </div>
            </div>
          )}
          {history.map((msg, i) => <ChatBubble key={i} msg={msg} />)}
          {loading && (
            <div className="flex gap-3">
              <div className="shrink-0 w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center"><Bot className="h-4 w-4 text-violet-600 dark:text-violet-400" /></div>
              <div className="space-y-2 flex-1 max-w-sm"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {hasConversation && (
          <div className="pt-3 border-t">
            <div className="flex gap-2">
              <Textarea placeholder={de ? "Nachfrage\u2026 (Enter zum Senden)" : "Ask a follow-up\u2026 (Enter to send)"} value={followUp} onChange={e => setFollowUp(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (followUp.trim()) { const m = followUp.trim(); setFollowUp(""); callTori(m, false); } } }} className="min-h-[56px] max-h-[120px] resize-none text-sm" disabled={loading} />
              <Button size="icon" onClick={() => { if (followUp.trim()) { const m = followUp.trim(); setFollowUp(""); callTori(m, false); } }} disabled={loading || !followUp.trim()} className="shrink-0 self-end h-10 w-10 bg-violet-600 hover:bg-violet-700"><Send className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Learning Loop ─────────────────────────────────────────────────────────

function LearningTab() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const de = lang === "de";

  const [originalOutput, setOriginalOutput] = useState("");
  const [adminCorrection, setAdminCorrection] = useState("");
  const [adminNotes, setAdminNotes]           = useState("");
  const [isUniversal, setIsUniversal]         = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [logs, setLogs]                       = useState<LearningLog[]>([]);
  const [logsLoading, setLogsLoading]         = useState(true);
  const [reflection, setReflection]           = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch("/api/iroc/tori/learning-logs", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setLogs(await res.json() as LearningLog[]);
    } finally { setLogsLoading(false); }
  }, [token]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  async function handleSubmit() {
    if (!adminCorrection.trim()) { toast({ title: de ? "Korrektur fehlt" : "Correction required", variant: "destructive" }); return; }
    setSubmitting(true); setReflection(null);
    try {
      const res = await fetch("/api/iroc/tori/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ originalOutput: originalOutput || undefined, adminCorrection, adminNotes: adminNotes || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tori_reflection: string };
      setReflection(data.tori_reflection);
      setOriginalOutput(""); setAdminCorrection(""); setAdminNotes(""); setIsUniversal(false);
      toast({ title: de ? "Gelernt!" : "Learned!", description: de ? "Tori hat die Korrektur gespeichert." : "Tori has saved the correction." });
      fetchLogs();
    } catch {
      toast({ title: de ? "Fehler" : "Error", variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  return (
    <div className="flex gap-6 min-h-0 flex-1 overflow-hidden">
      {/* Left: Correction form */}
      <div className="w-[340px] shrink-0 flex flex-col gap-4 overflow-y-auto pb-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{de ? "Neue Korrektur einreichen" : "Submit a Correction"}</p>
          <p className="text-xs text-muted-foreground">{de ? "Zeig Tori, was sie falsch gemacht hat." : "Show Tori what she got wrong so she can improve."}</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{de ? "Tori\u2019s urspr\u00fcngliche Ausgabe (optional)" : "Original Tori Output (optional)"}</label>
          <Textarea placeholder={de ? "JSON-Ausgabe von Tori einf\u00fcgen\u2026" : "Paste Tori\u2019s original JSON output\u2026"} value={originalOutput} onChange={e => setOriginalOutput(e.target.value)} className="min-h-[90px] font-mono text-xs resize-none" disabled={submitting} />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{de ? "Was h\u00e4tte Tori tun sollen? *" : "What should Tori have done? *"}</label>
          <Textarea placeholder={de ? "z.B. Dieses Produkt ist Wiederverkauf, nicht Eigennutzung, weil\u2026" : "e.g. This product is resale, not company usage, because\u2026"} value={adminCorrection} onChange={e => setAdminCorrection(e.target.value)} className="min-h-[110px] text-sm resize-none" disabled={submitting} />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">{de ? "Zus\u00e4tzliche Notizen" : "Additional Notes"}</label>
          <Textarea placeholder={de ? "Kontext oder Erinnerungen\u2026" : "Extra context or reminders\u2026"} value={adminNotes} onChange={e => setAdminNotes(e.target.value)} className="min-h-[70px] text-sm resize-none" disabled={submitting} />
        </div>

        <div className="flex items-center gap-2">
          <Switch id="universal" checked={isUniversal} onCheckedChange={setIsUniversal} disabled={submitting} />
          <Label htmlFor="universal" className="text-xs">{de ? "Universelle Regel (gilt f\u00fcr alle Lieferanten)" : "Universal rule (applies to all vendors)"}</Label>
        </div>

        <Button onClick={handleSubmit} disabled={submitting || !adminCorrection.trim()} className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white">
          <Brain className="h-4 w-4" />
          {submitting ? (de ? "Tori lernt\u2026" : "Tori is learning\u2026") : (de ? "Korrektur einreichen" : "Submit Correction")}
        </Button>

        {reflection && (
          <Card className="bg-violet-50/50 dark:bg-violet-950/20 border-violet-100 dark:border-violet-900">
            <CardHeader className="pb-1 pt-3"><CardTitle className="text-xs font-semibold text-violet-700 dark:text-violet-400 flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" />{de ? "Tori\u2019s Selbstreflexion" : "Tori\u2019s Self-Reflection"}</CardTitle></CardHeader>
            <CardContent className="pt-0 pb-3"><p className="text-xs text-violet-800 dark:text-violet-300 leading-relaxed italic">{reflection}</p></CardContent>
          </Card>
        )}
      </div>

      {/* Right: Learned rules log */}
      <div className="flex-1 overflow-y-auto pb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{de ? "Gespeicherte Lernregeln" : "Stored Learning Rules"} <span className="font-normal normal-case tracking-normal">({logs.length})</span></p>
        {logsLoading ? (
          <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Brain className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">{de ? "Noch keine Lernregeln." : "No learning rules yet."}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map(log => (
              <Card key={log.id} className={cn("transition-colors", log.is_universal_rule && "border-amber-300 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/20")}>
                <CardContent className="pt-4 pb-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {log.is_universal_rule && <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs gap-1"><Star className="h-2.5 w-2.5" />Universal</Badge>}
                      {log.vendor_hint && <Badge variant="outline" className="text-xs">{log.vendor_hint}</Badge>}
                      {log.category_hint && <Badge variant="secondary" className="text-xs">{log.category_hint}</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{formatDate(log.created_at)}</span>
                  </div>
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300 leading-snug">{log.learned_context}</p>
                  <p className="text-xs text-muted-foreground border-t pt-2 mt-2"><span className="font-medium">{de ? "Korrektur:" : "Correction:"}</span> {log.admin_correction}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Reorder Queue ─────────────────────────────────────────────────────────

function ReorderTab() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const de = lang === "de";

  const [lowStock, setLowStock]               = useState<LowStockProduct[]>([]);
  const [queue, setQueue]                     = useState<ReorderDraft[]>([]);
  const [loadingData, setLoadingData]         = useState(true);
  const [drafting, setDrafting]               = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<LowStockProduct | null>(null);
  const [vendorEmail, setVendorEmail]         = useState("");
  const [vendorCountry, setVendorCountry]     = useState("");
  const [contractPrice, setContractPrice]     = useState("");
  const [milestoneAchieved, setMilestoneAchieved] = useState(false);
  const [previewDraft, setPreviewDraft]       = useState<ReorderDraft | null>(null);
  const [approvingId, setApprovingId]         = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [stockRes, queueRes] = await Promise.all([
        fetch("/api/iroc/products?low_stock=true", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/iroc/tori/reorder-queue", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (stockRes.ok) {
        const all = await stockRes.json() as LowStockProduct[];
        setLowStock(all.filter(p => p.stock_quantity <= p.low_stock_threshold));
      }
      if (queueRes.ok) setQueue(await queueRes.json() as ReorderDraft[]);
    } finally { setLoadingData(false); }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleDraftReorder() {
    if (!selectedProduct || !vendorEmail.trim()) { toast({ title: de ? "Pflichtfelder fehlen" : "Required fields missing", variant: "destructive" }); return; }
    setDrafting(true);
    try {
      const res = await fetch("/api/iroc/tori/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          productId: selectedProduct.id,
          vendorEmail: vendorEmail.trim(),
          vendorCountry: vendorCountry.trim() || undefined,
          contractPrice: contractPrice ? parseFloat(contractPrice) : undefined,
          salesMilestoneAchieved: milestoneAchieved,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: de ? "E-Mail-Entwurf erstellt" : "Draft created", description: de ? "In der Genehmigungswarteschlange." : "Placed in approval queue." });
      setSelectedProduct(null); setVendorEmail(""); setVendorCountry(""); setContractPrice(""); setMilestoneAchieved(false);
      fetchData();
    } catch {
      toast({ title: de ? "Fehler" : "Error", variant: "destructive" });
    } finally { setDrafting(false); }
  }

  async function handleApprove(id: number) {
    if (approvingId !== null) return;
    setApprovingId(id);
    try {
      const res = await fetch(`/api/iroc/tori/reorder-queue/${id}/approve`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const failure = await res.json() as { code?: string };
        throw new Error(failure.code ?? "supplier-email-send-failed");
      }
      const approved = await res.json() as ReorderDraft;
      setQueue(prev => prev.map(d => d.id === id ? approved : d));
      toast({
        title: de ? "Genehmigt und gesendet" : "Approved and sent",
        description: de ? "Die Lieferanten-E-Mail wurde gesendet." : "The supplier email was sent.",
      });
    } catch (error) {
      await fetchData();
      const unconfirmed = error instanceof Error && error.message === "TORI_REORDER_DELIVERY_UNCONFIRMED";
      toast({
        title: unconfirmed
          ? (de ? "Zustellung unbestätigt – nicht erneut senden" : "Delivery unconfirmed — do not retry")
          : (de ? "E-Mail konnte nicht gesendet werden" : "Email could not be sent"),
        description: unconfirmed
          ? (de
            ? "Prüfen Sie Lieferant oder Postfach und lösen Sie den Status anschließend manuell auf."
            : "Check with the supplier or mailbox, then resolve the status manually.")
          : (de
            ? "Vor dem Versand ist ein Fehler aufgetreten. Der Entwurf kann erneut versucht werden."
            : "A pre-send check failed. The draft can be retried."),
        variant: "destructive",
      });
    } finally {
      setApprovingId(null);
    }
  }

  async function handleDelete(id: number) {
    const res = await fetch(`/api/iroc/tori/reorder-queue/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) { setQueue(prev => prev.filter(d => d.id !== id)); toast({ title: de ? "Gel\u00f6scht" : "Deleted" }); }
  }

  async function handleReconcile(id: number, action: "confirm_delivered" | "retry_confirmed_not_delivered") {
    if (approvingId !== null) return;
    setApprovingId(id);
    try {
      const res = await fetch(`/api/iroc/tori/reorder-queue/${id}/reconcile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action,
          acknowledgedDuplicateRisk: action === "retry_confirmed_not_delivered",
        }),
      });
      if (!res.ok) throw new Error("reconciliation-failed");
      const updated = await res.json() as ReorderDraft;
      setQueue(previous => previous.map(draft => draft.id === id ? updated : draft));
      toast({
        title: action === "confirm_delivered"
          ? (de ? "Zustellung bestätigt" : "Delivery confirmed")
          : (de ? "Entwurf für erneuten Versuch freigegeben" : "Draft released for retry"),
      });
    } catch {
      toast({
        title: de ? "Status konnte nicht aufgelöst werden" : "Could not resolve delivery status",
        variant: "destructive",
      });
    } finally {
      setApprovingId(null);
    }
  }

  const pendingQueue = queue.filter(d => d.status === "pending");
  const recoveryQueue = queue.filter(d => d.status === "sending" || d.status === "unconfirmed");
  const approvedQueue = queue.filter(d => d.status === "approved");
  const sentDateTimeFormatter = new Intl.DateTimeFormat(de ? "de-DE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="flex gap-6 min-h-0 flex-1 overflow-hidden">
      {/* Left: Low-stock + draft form */}
      <div className="w-[340px] shrink-0 flex flex-col gap-4 overflow-y-auto pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">{de ? "Produkte unter Mindestbestand" : "Low-Stock Products"}</p>
          {loadingData ? <Skeleton className="h-24 w-full rounded-lg" /> : lowStock.length === 0
            ? <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg">{de ? "Alle Produkte ausreichend auf Lager." : "All products sufficiently stocked."}</div>
            : <div className="space-y-2 max-h-52 overflow-y-auto">
                {lowStock.map(p => (
                  <button key={p.id} onClick={() => { setSelectedProduct(prev => prev?.id === p.id ? null : p); setVendorEmail(""); setVendorCountry(""); setContractPrice(""); setMilestoneAchieved(false); }} className={cn("w-full text-left border rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-muted/50", selectedProduct?.id === p.id && "border-violet-400 bg-violet-50/50 dark:bg-violet-950/20")}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">{p.name_de}</span>
                      <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300 text-xs shrink-0 ml-2">{p.stock_quantity}/{p.low_stock_threshold}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{p.sku}</p>
                  </button>
                ))}
              </div>}
        </div>

        {selectedProduct && (
          <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
            <p className="text-xs font-semibold text-violet-700 dark:text-violet-400 flex items-center gap-1.5"><ShoppingBag className="h-3.5 w-3.5" />{de ? "Bestellung f\u00fcr:" : "Reorder for:"} <span className="font-normal text-foreground">{selectedProduct.name_de}</span></p>

            <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">{de ? "Lieferanten-E-Mail *" : "Vendor Email *"}</label><Input placeholder="vendor@example.com" value={vendorEmail} onChange={e => setVendorEmail(e.target.value)} className="text-sm h-8" disabled={drafting} /></div>
            <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">{de ? "Lieferantenland (optional)" : "Supplier country (optional)"}</label><Input placeholder={de ? "z. B. Deutschland" : "e.g. Germany"} value={vendorCountry} onChange={e => setVendorCountry(e.target.value)} className="text-sm h-8" disabled={drafting} /></div>
            <div className="space-y-1"><label className="text-xs font-medium text-muted-foreground">{de ? "Vertragspreis (EUR)" : "Contract Price (EUR)"}</label><Input type="number" placeholder={selectedProduct.purchase_price ?? "0.00"} value={contractPrice} onChange={e => setContractPrice(e.target.value)} className="text-sm h-8" disabled={drafting} /></div>

            <div className="flex items-center gap-2">
              <Switch id="milestone" checked={milestoneAchieved} onCheckedChange={setMilestoneAchieved} disabled={drafting} />
              <Label htmlFor="milestone" className="text-xs">{de ? "Verkaufsmeilenstein erreicht" : "Sales milestone achieved"}</Label>
              {milestoneAchieved && <Star className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
            </div>

            <Button onClick={handleDraftReorder} disabled={drafting || !vendorEmail.trim()} className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm h-8">
              <Send className="h-3.5 w-3.5" />
              {drafting ? (de ? "Entwurf wird erstellt\u2026" : "Drafting\u2026") : (de ? "E-Mail entwerfen" : "Draft Email")}
            </Button>
          </div>
        )}
      </div>

      {/* Right: Queue */}
      <div className="flex-1 overflow-y-auto pb-4 space-y-6">
        {recoveryQueue.length > 0 && (
          <section aria-labelledby="tori-reorder-recovery-heading">
            <p id="tori-reorder-recovery-heading" className="text-xs font-semibold uppercase tracking-widest text-destructive mb-3">
              {de ? "Zustellung manuell prüfen" : "Manual delivery review"} ({recoveryQueue.length})
            </p>
            <div className="space-y-3">
              {recoveryQueue.map(d => (
                <Card key={d.id} className="border-destructive/50 bg-destructive/5">
                  <CardContent className="pt-4 pb-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold">{d.product_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{d.email_to}</p>
                    </div>
                    <div role="status" aria-live="polite" data-testid={`status-reorder-unconfirmed-${d.id}`} className="text-sm text-destructive">
                      <p className="font-semibold">{de ? "Zustellung unbestätigt – nicht erneut senden" : "Delivery unconfirmed — do not retry"}</p>
                      <p className="text-xs mt-1">
                        {de
                          ? "Die Nachricht könnte zugestellt worden sein. Prüfen Sie Lieferant oder gesendete E-Mails, bevor Sie fortfahren."
                          : "The message may have been delivered. Check with the supplier or sent mailbox before continuing."}
                      </p>
                      {d.send_attempt_id && <p className="font-mono text-xs mt-1">{de ? "Versuch" : "Attempt"}: {d.send_attempt_id}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => void handleReconcile(d.id, "confirm_delivered")}
                        disabled={approvingId !== null}
                        aria-label={de ? `Zustellung für ${d.product_name ?? d.id} bestätigen` : `Confirm delivery for ${d.product_name ?? d.id}`}
                        data-testid={`button-confirm-reorder-delivery-${d.id}`}
                      >
                        <Check className="h-3.5 w-3.5" />{de ? "Zustellung bestätigen" : "Confirm delivered"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleReconcile(d.id, "retry_confirmed_not_delivered")}
                        disabled={approvingId !== null}
                        aria-label={de ? `Nichtzustellung bestätigen und erneuten Versuch für ${d.product_name ?? d.id} erlauben` : `Confirm non-delivery and allow retry for ${d.product_name ?? d.id}`}
                        data-testid={`button-release-reorder-retry-${d.id}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />{de ? "Nicht zugestellt – erneuten Versuch erlauben" : "Not delivered — allow retry"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
        {/* Pending */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{de ? "Wartet auf Genehmigung" : "Awaiting Approval"} <span className="font-normal normal-case tracking-normal">({pendingQueue.length})</span></p>
          {loadingData ? <Skeleton className="h-32 w-full rounded-lg" /> : pendingQueue.length === 0
            ? <div className="text-center py-8 text-sm text-muted-foreground border rounded-lg border-dashed">{de ? "Keine ausstehenden Entw\u00fcrfe." : "No pending drafts."}</div>
            : <div className="space-y-3">
                {pendingQueue.map(d => (
                  <Card key={d.id} className="border-amber-200 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/10">
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{d.product_name ?? "—"} {d.product_sku && <span className="font-mono text-xs text-muted-foreground">({d.product_sku})</span>}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Mail className="h-3 w-3" />{d.email_to}</p>
                        </div>
                        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs shrink-0">Pending</Badge>
                      </div>
                      <p className="text-xs font-medium text-muted-foreground">{d.email_subject}</p>
                      {d.email_send_error && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          {de ? "E-Mail-Versand fehlgeschlagen. Erneut versuchen." : "Email sending failed. Retry to send."}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setPreviewDraft(d)}><Eye className="h-3 w-3" />{de ? "Vorschau" : "Preview"}</Button>
                        <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleApprove(d.id)} disabled={approvingId !== null} aria-label={de ? `Genehmigen und an ${d.email_to} senden` : `Approve and send to ${d.email_to}`} data-testid={`button-send-reorder-${d.id}`}><Check className="h-3 w-3" />{approvingId === d.id ? (de ? "Wird gesendet\u2026" : "Sending\u2026") : (de ? "Genehmigen und senden" : "Approve and send")}</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => handleDelete(d.id)}><Trash2 className="h-3 w-3" />{de ? "L\u00f6schen" : "Delete"}</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>}
        </div>

        {/* Approved */}
        {approvedQueue.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{de ? "Genehmigt" : "Approved"} <span className="font-normal normal-case tracking-normal">({approvedQueue.length})</span></p>
            <div className="space-y-2">
              {approvedQueue.map(d => (
                <Card key={d.id} className="border-emerald-200 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/10">
                  <CardContent className="pt-3 pb-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{d.product_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.email_to} &middot; {de ? "Gesendet am:" : "Sent at:"}{" "}
                        {d.email_sent_at ? sentDateTimeFormatter.format(new Date(d.email_sent_at)) : "—"}
                      </p>
                       {d.email_message_id && <p className="mt-1 text-xs text-muted-foreground font-mono break-all">
                         {de ? "E-Mail-Referenz:" : "Email reference:"} {d.email_message_id}
                       </p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-xs gap-1"><ClipboardCheck className="h-3 w-3" />Approved</Badge>
                       {d.email_message_id && <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={async () => {
                         try {
                           await navigator.clipboard.writeText(d.email_message_id!);
                           toast({ title: de ? "E-Mail-Referenz kopiert" : "Email reference copied" });
                         } catch {
                           toast({ variant: "destructive", title: de ? "E-Mail-Referenz konnte nicht kopiert werden" : "Could not copy email reference" });
                         }
                       }}><Copy className="h-3 w-3" />{de ? "Referenz kopieren" : "Copy reference"}</Button>}
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPreviewDraft(d)}><Eye className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => handleDelete(d.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Email preview dialog */}
      <Dialog open={!!previewDraft} onOpenChange={open => { if (!open) setPreviewDraft(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" />{previewDraft?.email_subject}</DialogTitle></DialogHeader>
          {previewDraft && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5"><span className="font-medium">To:</span>{previewDraft.email_to}</div>
              {previewDraft.sales_milestone_achieved && <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 gap-1"><Star className="h-3 w-3" />{de ? "Meilenstein erreicht" : "Milestone Achieved"}</Badge>}
              <div className="border rounded-lg p-4 bg-muted/30">
                <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{previewDraft.email_body_markdown}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab: Finance ───────────────────────────────────────────────────────────────

type ExpenseFilter = "all" | "product" | "service" | "company_usage";

function FinanceTab() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const de = lang === "de";

  const [expenses, setExpenses]         = useState<Expense[]>([]);
  const [loading, setLoading]           = useState(true);
  const [filter, setFilter]             = useState<ExpenseFilter>("all");
  const [search, setSearch]             = useState("");
  const [expandedId, setExpandedId]     = useState<number | null>(null);
  const [itemsCache, setItemsCache]     = useState<Record<number, ExpenseItem[]>>({});
  const [itemsLoading, setItemsLoading] = useState<number | null>(null);

  const fetchExpenses = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = filter !== "all" ? `?category=${filter}` : "";
      const data = await adminGet<Expense[]>(`/api/admin/expenses${params}`, token);
      setExpenses(Array.isArray(data) ? data : []);
    } catch { setExpenses([]); }
    finally { setLoading(false); }
  }, [token, filter]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  async function loadItems(expenseId: number) {
    if (itemsCache[expenseId]) {
      setExpandedId(prev => prev === expenseId ? null : expenseId);
      return;
    }
    if (!token) return;
    setItemsLoading(expenseId);
    try {
      const data = await adminGet<ExpenseItem[]>(`/api/admin/expenses/${expenseId}/items`, token);
      setItemsCache(prev => ({ ...prev, [expenseId]: Array.isArray(data) ? data : [] }));
      setExpandedId(expenseId);
    } catch { /* silent */ }
    finally { setItemsLoading(null); }
  }

  const filtered = expenses.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (e.vendor_name ?? "").toLowerCase().includes(q) ||
      (e.invoice_number ?? "").toLowerCase().includes(q)
    );
  });

  // Summary stats
  const total = filtered.reduce((s, e) => s + (parseFloat(String(e.gross_amount ?? 0)) || 0), 0);
  const countByCategory = {
    product:       expenses.filter(e => e.category === "product").length,
    service:       expenses.filter(e => e.category === "service").length,
    company_usage: expenses.filter(e => e.category === "company_usage").length,
    unknown:       expenses.filter(e => !e.category).length,
  };

  const CATEGORY_CONFIG: Record<string, { labelDe: string; labelEn: string; color: string; badge: string }> = {
    product:       { labelDe: "Produkt (Wiederverkauf)", labelEn: "Product (Resale)",       color: "bg-emerald-100 text-emerald-800", badge: "emerald" },
    service:       { labelDe: "Dienstleistung",          labelEn: "Service",                color: "bg-blue-100 text-blue-800",      badge: "blue" },
    company_usage: { labelDe: "Eigenbedarf",             labelEn: "Company Usage",          color: "bg-amber-100 text-amber-800",    badge: "amber" },
  };

  const FILTERS: { key: ExpenseFilter; labelDe: string; labelEn: string }[] = [
    { key: "all",          labelDe: "Alle",              labelEn: "All" },
    { key: "product",      labelDe: "Produkt",           labelEn: "Product" },
    { key: "service",      labelDe: "Dienstleistung",    labelEn: "Service" },
    { key: "company_usage",labelDe: "Eigenbedarf",       labelEn: "Company Usage" },
  ];

  return (
    <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto pb-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        {[
          { icon: TrendingUp,  labelDe: "Gesamt (Brutto)",     labelEn: "Total (Gross)",      value: formatMoney(total, "EUR"), color: "text-emerald-600" },
          { icon: ShoppingCart,labelDe: "Produkt",             labelEn: "Product",            value: countByCategory.product,  color: "text-emerald-600" },
          { icon: Wrench,      labelDe: "Dienstleistung",      labelEn: "Service",            value: countByCategory.service,  color: "text-blue-600" },
          { icon: Package,     labelDe: "Eigenbedarf",         labelEn: "Company Usage",      value: countByCategory.company_usage, color: "text-amber-600" },
        ].map((s, i) => (
          <Card key={i} className="border shadow-sm">
            <CardContent className="pt-3 pb-3 flex items-center gap-3">
              <div className={`shrink-0 w-8 h-8 rounded-lg bg-muted flex items-center justify-center`}>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{de ? s.labelDe : s.labelEn}</p>
                <p className="text-base font-bold tabular-nums">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center shrink-0">
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === f.key ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {de ? f.labelDe : f.labelEn}
              {f.key !== "all" && <span className="ml-1 text-muted-foreground">({countByCategory[f.key as keyof typeof countByCategory] ?? 0})</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-1 min-w-0">
          <Input
            placeholder={de ? "Lieferant oder Rechnungsnr. suchen…" : "Search vendor or invoice #…"}
            value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 h-8 text-sm" />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={fetchExpenses} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="shrink-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6" />
                <TableHead>{de ? "Lieferant" : "Vendor"}</TableHead>
                <TableHead>{de ? "Rechnungsnr." : "Invoice #"}</TableHead>
                <TableHead>{de ? "Datum" : "Date"}</TableHead>
                <TableHead>{de ? "Kategorie" : "Category"}</TableHead>
                <TableHead className="text-right">{de ? "Netto" : "Net"}</TableHead>
                <TableHead className="text-right">{de ? "Brutto" : "Gross"}</TableHead>
                <TableHead>{de ? "Quelle" : "Source"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [1,2,3,4,5].map(i => (
                  <TableRow key={i}>
                    {[...Array(8)].map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-16 text-muted-foreground">
                    <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p>{de ? "Keine Ausgaben gefunden" : "No expenses found"}</p>
                  </TableCell>
                </TableRow>
              ) : filtered.map(exp => {
                const cat = exp.category ? CATEGORY_CONFIG[exp.category] : null;
                const isExpanded = expandedId === exp.id;
                const items = itemsCache[exp.id];
                return (
                  <>
                    <TableRow key={exp.id}
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => loadItems(exp.id)}>
                      <TableCell className="pr-0">
                        {itemsLoading === exp.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          : <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />}
                      </TableCell>
                      <TableCell className="font-medium max-w-[160px] truncate">{exp.vendor_name ?? <span className="italic text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{exp.invoice_number ?? "—"}</TableCell>
                      <TableCell className="text-sm">{exp.invoice_date ? formatDate(exp.invoice_date) : "—"}</TableCell>
                      <TableCell>
                        {cat ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cat.color}`}>
                            {de ? cat.labelDe : cat.labelEn}
                          </span>
                        ) : <span className="text-xs text-muted-foreground italic">{de ? "Unbekannt" : "Unknown"}</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{formatMoney(exp.net_amount, exp.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">{formatMoney(exp.gross_amount, exp.currency)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground capitalize">{exp.source ?? "—"}</TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${exp.id}-items`} className="bg-muted/20">
                        <TableCell colSpan={8} className="py-0">
                          <div className="px-4 py-3">
                            {!items || items.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">{de ? "Keine Einzelpositionen" : "No line items"}</p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted-foreground border-b">
                                    <th className="text-left pb-1 font-medium">{de ? "Position" : "Item"}</th>
                                    <th className="text-left pb-1 font-medium">{de ? "Los-Nr." : "Lot #"}</th>
                                    <th className="text-right pb-1 font-medium">{de ? "Menge" : "Qty"}</th>
                                    <th className="text-right pb-1 font-medium">{de ? "Einzelpreis" : "Unit Price"}</th>
                                    <th className="text-right pb-1 font-medium">{de ? "Rabatt" : "Discount"}</th>
                                    <th className="text-right pb-1 font-medium">{de ? "Gesamt" : "Total"}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40">
                                  {items.map(item => (
                                    <tr key={item.id} className="text-foreground/80">
                                      <td className="py-1.5 pr-4 font-medium">{item.product_name_local || item.product_name_raw || "—"}</td>
                                      <td className="py-1.5 pr-4 font-mono text-muted-foreground">{item.lot_number ?? "—"}</td>
                                      <td className="py-1.5 text-right tabular-nums">{item.quantity ?? "—"}</td>
                                      <td className="py-1.5 text-right tabular-nums">{formatMoney(item.unit_price, exp.currency)}</td>
                                      <td className="py-1.5 text-right tabular-nums">
                                        {item.discount_rate
                                          ? `${(parseFloat(String(item.discount_rate)) * 100).toFixed(0)}%`
                                          : "—"}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums font-medium">{formatMoney(item.line_total, exp.currency)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {exp.notes && (
                              <p className="mt-2 text-xs text-muted-foreground border-t pt-2">
                                <span className="font-medium">{de ? "Notizen:" : "Notes:"}</span> {exp.notes}
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab: Finance history ───────────────────────────────────────────────────────

type HistoryPeriod = "all" | "month" | "quarter" | "year";
type HistoryRecordType = "all" | "expense" | "invoice";

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function currentYearValue(): string {
  return String(new Date().getFullYear());
}

function currentQuarterValue(): string {
  const now = new Date();
  return `Q${Math.floor(now.getMonth() / 3) + 1}`;
}

function HistoryTypeBadge({ item, de }: { item: FinanceHistoryItem; de: boolean }) {
  if (item.record_type === "invoice") {
    return <Badge variant="outline" className="border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300">{de ? "Rechnung" : "Invoice"}</Badge>;
  }
  return <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300">{de ? "Ausgabe" : "Expense"}</Badge>;
}

function FinanceHistoryTab() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const de = lang === "de";
  const [period, setPeriod] = useState<HistoryPeriod>("all");
  const [recordType, setRecordType] = useState<HistoryRecordType>("all");
  const [month, setMonth] = useState(currentMonthValue);
  const [quarterYear, setQuarterYear] = useState(currentYearValue);
  const [quarter, setQuarter] = useState(currentQuarterValue);
  const [year, setYear] = useState(currentYearValue);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<FinanceHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  const fetchHistory = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(false);
    try {
       const params = new URLSearchParams({ period, page: String(page), page_size: String(pageSize) });
       if (recordType !== "all") params.set("type", recordType);
      if (period === "month") params.set("value", month);
      if (period === "quarter") params.set("value", `${quarterYear}-${quarter}`);
      if (period === "year") params.set("value", year);
      if (search.trim()) params.set("search", search.trim());
      const data = await adminGet<FinanceHistoryResponse>(`/api/iroc/tori/finance-history?${params.toString()}`, token);
      setItems(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total ?? data?.count ?? 0));
    } catch {
      setItems([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [month, page, period, quarter, quarterYear, recordType, search, token, year]);

  useEffect(() => {
    setPage(1);
  }, [month, period, quarter, quarterYear, recordType, search, year]);

  useEffect(() => {
    // Load a newly opened history view immediately. Only text entry is
    // debounced, avoiding a request for every search keystroke while keeping
    // the saved-document list responsive when filters or the tab change.
    if (!search) {
      void fetchHistory();
      return;
    }
    const timer = window.setTimeout(() => { void fetchHistory(); }, 250);
    return () => window.clearTimeout(timer);
  }, [fetchHistory, search]);

  const expenseCount = items.filter(item => item.record_type === "expense").length;
  const invoiceCount = items.filter(item => item.record_type === "invoice").length;

  return (
    <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto pb-4">
      <div>
        <h2 className="text-lg font-semibold">{de ? "Dokumenthistorie" : "Document History"}</h2>
        <p className="text-xs text-muted-foreground">
          {de
            ? "Gespeicherte Ausgaben und Rechnungen durchsuchen. Ausstehende Tori-Prüfungen bleiben unter Genehmigungen."
            : "Search saved expenses and invoices. Pending Tori reviews remain under Approvals."}
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-[150px] flex-1">
          <Label htmlFor="tori-history-period" className="mb-1.5 block text-xs">
            {de ? "Zeitraum" : "Period"}
          </Label>
          <Select value={period} onValueChange={value => setPeriod(value as HistoryPeriod)}>
            <SelectTrigger id="tori-history-period" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{de ? "Alle Zeit" : "All time"}</SelectItem>
              <SelectItem value="month">{de ? "Monat" : "Month"}</SelectItem>
              <SelectItem value="quarter">{de ? "Quartal" : "Quarter"}</SelectItem>
              <SelectItem value="year">{de ? "Jahr" : "Year"}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[150px] flex-1">
          <Label htmlFor="tori-history-type" className="mb-1.5 block text-xs">
            {de ? "Dokumenttyp" : "Document type"}
          </Label>
          <Select value={recordType} onValueChange={value => setRecordType(value as HistoryRecordType)}>
            <SelectTrigger id="tori-history-type" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{de ? "Alle Dokumente" : "All documents"}</SelectItem>
              <SelectItem value="invoice">{de ? "Rechnungen" : "Invoices"}</SelectItem>
              <SelectItem value="expense">{de ? "Ausgaben" : "Expenses"}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {period === "month" && (
          <div className="min-w-[150px] flex-1">
            <Label htmlFor="tori-history-month" className="mb-1.5 block text-xs">{de ? "Monat auswählen" : "Select month"}</Label>
            <Input id="tori-history-month" type="month" value={month} onChange={event => setMonth(event.target.value)} className="h-9" />
          </div>
        )}

        {period === "quarter" && (
          <>
            <div className="min-w-[115px] flex-1">
              <Label htmlFor="tori-history-quarter-year" className="mb-1.5 block text-xs">{de ? "Jahr" : "Year"}</Label>
              <Input id="tori-history-quarter-year" type="number" min="1900" max="2200" value={quarterYear} onChange={event => setQuarterYear(event.target.value)} className="h-9" />
            </div>
            <div className="min-w-[125px] flex-1">
              <Label htmlFor="tori-history-quarter" className="mb-1.5 block text-xs">{de ? "Quartal" : "Quarter"}</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger id="tori-history-quarter" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Q1">{de ? "Q1 (Jan–Mär)" : "Q1 (Jan–Mar)"}</SelectItem>
                  <SelectItem value="Q2">{de ? "Q2 (Apr–Jun)" : "Q2 (Apr–Jun)"}</SelectItem>
                  <SelectItem value="Q3">{de ? "Q3 (Jul–Sep)" : "Q3 (Jul–Sep)"}</SelectItem>
                  <SelectItem value="Q4">{de ? "Q4 (Okt–Dez)" : "Q4 (Oct–Dec)"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {period === "year" && (
          <div className="min-w-[115px] flex-1">
            <Label htmlFor="tori-history-year" className="mb-1.5 block text-xs">{de ? "Jahr auswählen" : "Select year"}</Label>
            <Input id="tori-history-year" type="number" min="1900" max="2200" value={year} onChange={event => setYear(event.target.value)} className="h-9" />
          </div>
        )}

        <div className="min-w-[220px] flex-[2]">
          <Label htmlFor="tori-history-search" className="mb-1.5 block text-xs">{de ? "Exakte Suche" : "Exact search"}</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="tori-history-search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder={de ? "Lieferant, Kunde, Rechnungs- oder Bestellnr." : "Vendor, customer, invoice or order #"}
              className="h-9 pl-8"
            />
          </div>
        </div>

        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void fetchHistory()} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          {de ? "Aktualisieren" : "Refresh"}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: de ? "Treffer" : "Results", value: items.length, color: "text-violet-600" },
          { label: de ? "Ausgaben" : "Expenses", value: expenseCount, color: "text-amber-600" },
          { label: de ? "Rechnungen" : "Invoices", value: invoiceCount, color: "text-blue-600" },
        ].map(stat => (
          <Card key={stat.label} className="border shadow-sm">
            <CardContent className="py-3">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className={cn("text-lg font-bold tabular-nums", stat.color)}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shrink-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de ? "Typ" : "Type"}</TableHead>
                <TableHead>{de ? "Lieferant / Kunde" : "Vendor / Customer"}</TableHead>
                <TableHead>{de ? "Rechnungsnr." : "Invoice #"}</TableHead>
                <TableHead>{de ? "Bestellnr." : "Order #"}</TableHead>
                <TableHead>{de ? "Datum" : "Date"}</TableHead>
                <TableHead className="text-right">{de ? "Betrag" : "Amount"}</TableHead>
                <TableHead>{de ? "Status / Quelle" : "Status / Source"}</TableHead>
                <TableHead className="w-[70px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [1, 2, 3, 4].map(row => (
                  <TableRow key={row}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(cell => <TableCell key={cell}><Skeleton className="h-4 w-full" /></TableCell>)}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-destructive" role="alert">
                    <p>{de ? "Dokumenthistorie konnte nicht geladen werden." : "Document history could not be loaded."}</p>
                    <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={() => void fetchHistory()}>
                      <RotateCcw className="h-3.5 w-3.5" />{de ? "Erneut versuchen" : "Retry"}
                    </Button>
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-16 text-center text-muted-foreground">
                    <Archive className="mx-auto mb-3 h-10 w-10 opacity-20" />
                    <p>{de ? "Keine gespeicherten Dokumente gefunden." : "No saved documents found."}</p>
                    <p className="mt-1 text-xs">{de ? "Passen Sie Zeitraum oder Suche an." : "Adjust the period or search."}</p>
                  </TableCell>
                </TableRow>
              ) : items.map(item => (
                <TableRow key={`${item.record_type}-${item.record_id}`} className="hover:bg-muted/40">
                  <TableCell><HistoryTypeBadge item={item} de={de} /></TableCell>
                  <TableCell className="max-w-[180px] truncate font-medium" title={item.party_name ?? undefined}>{item.party_name || "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.document_number || "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{item.order_number || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">{item.document_date ? formatDate(item.document_date) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">{formatFinanceHistoryMoney(item.total_amount, item.currency)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.record_type === "invoice"
                      ? (item.status || "—")
                      : (item.source || item.category || "—")}
                  </TableCell>
                  <TableCell>
                    {item.record_type === "invoice" ? (
                      <Button variant="ghost" size="sm" className="h-8 px-2" asChild title={de ? "Rechnung öffnen" : "Open invoice"}>
                        <Link href={`/invoices/${item.record_id}`}><Eye className="h-4 w-4" /></Link>
                      </Button>
                    ) : item.file_object_path ? (
                      <Button variant="ghost" size="sm" className="h-8 px-2" asChild title={de ? "Original öffnen" : "Open original"}>
                        <a href={`/api/storage${item.file_object_path}`} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" /></a>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {total > pageSize && (
        <nav className="flex items-center justify-end gap-2" aria-label={de ? "Seitennavigation der Dokumenthistorie" : "Document history pagination"}>
          <Button variant="outline" size="sm" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={loading || page === 1} aria-label={de ? "Vorherige Seite" : "Previous page"}>
            {de ? "Zurück" : "Previous"}
          </Button>
          <span role="status" className="text-xs text-muted-foreground">
            {de ? `Seite ${page} von ${Math.ceil(total / pageSize)}` : `Page ${page} of ${Math.ceil(total / pageSize)}`}
          </span>
          <Button variant="outline" size="sm" onClick={() => setPage(value => value + 1)} disabled={loading || page * pageSize >= total} aria-label={de ? "Nächste Seite" : "Next page"}>
            {de ? "Weiter" : "Next"}
          </Button>
        </nav>
      )}
    </div>
  );
}

// ── Tab: Merchandise ───────────────────────────────────────────────────────────

type LotFilter = "all" | "pending" | "active" | "depleted";

function MerchandiseTab() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const de = lang === "de";

  const [lots, setLots]         = useState<InventoryLot[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<LotFilter>("all");
  const [search, setSearch]     = useState("");

  const fetchLots = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/iroc/inventory", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setLots(await res.json() as InventoryLot[]);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchLots(); }, [fetchLots]);

  const filtered = lots.filter(l => {
    if (filter !== "all" && l.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (l.name_de ?? "").toLowerCase().includes(q) ||
        (l.name_en ?? "").toLowerCase().includes(q) ||
        (l.sku ?? "").toLowerCase().includes(q) ||
        (l.lot_number ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  function expiryStatus(lot: InventoryLot): "expired" | "soon" | "ok" | null {
    if (!lot.expiration_date) return null;
    const exp = new Date(lot.expiration_date).getTime();
    if (exp < now) return "expired";
    if (exp - now < thirtyDays) return "soon";
    return "ok";
  }

  const STATUS_CONFIG: Record<string, { labelDe: string; labelEn: string; color: string }> = {
    pending:  { labelDe: "Ausstehend", labelEn: "Pending",  color: "bg-gray-100 text-gray-700" },
    active:   { labelDe: "Aktiv",      labelEn: "Active",   color: "bg-emerald-100 text-emerald-800" },
    depleted: { labelDe: "Aufgebraucht",labelEn: "Depleted",color: "bg-red-100 text-red-700" },
  };

  const counts = {
    pending:  lots.filter(l => l.status === "pending").length,
    active:   lots.filter(l => l.status === "active").length,
    depleted: lots.filter(l => l.status === "depleted").length,
    expiring: lots.filter(l => expiryStatus(l) === "soon" || expiryStatus(l) === "expired").length,
  };

  const LOT_FILTERS: { key: LotFilter; labelDe: string; labelEn: string }[] = [
    { key: "all",      labelDe: "Alle",          labelEn: "All" },
    { key: "active",   labelDe: "Aktiv",         labelEn: "Active" },
    { key: "pending",  labelDe: "Ausstehend",    labelEn: "Pending" },
    { key: "depleted", labelDe: "Aufgebraucht",  labelEn: "Depleted" },
  ];

  return (
    <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto pb-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        {[
          { icon: Layers,       labelDe: "Aktive Lose",    labelEn: "Active Lots",     value: counts.active,   color: "text-emerald-600" },
          { icon: Archive,      labelDe: "Ausstehend",     labelEn: "Pending",         value: counts.pending,  color: "text-gray-500" },
          { icon: Boxes,        labelDe: "Aufgebraucht",   labelEn: "Depleted",        value: counts.depleted, color: "text-red-500" },
          { icon: AlertOctagon, labelDe: "Läuft bald ab", labelEn: "Expiring Soon",   value: counts.expiring, color: counts.expiring > 0 ? "text-amber-600" : "text-muted-foreground" },
        ].map((s, i) => (
          <Card key={i} className="border shadow-sm">
            <CardContent className="pt-3 pb-3 flex items-center gap-3">
              <div className="shrink-0 w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{de ? s.labelDe : s.labelEn}</p>
                <p className="text-base font-bold tabular-nums">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center shrink-0">
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          {LOT_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === f.key ? "bg-white shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {de ? f.labelDe : f.labelEn}
              {f.key !== "all" && <span className="ml-1 text-muted-foreground">({counts[f.key as keyof typeof counts] ?? 0})</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-1 min-w-0">
          <Input
            placeholder={de ? "Produkt, SKU oder Los-Nr. suchen…" : "Search product, SKU or lot #…"}
            value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 h-8 text-sm" />
          <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0" onClick={fetchLots} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="shrink-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de ? "Produkt" : "Product"}</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>{de ? "Los-Nr." : "Lot #"}</TableHead>
                <TableHead>{de ? "Gekauft" : "Purchased"}</TableHead>
                <TableHead>{de ? "Läuft ab" : "Expires"}</TableHead>
                <TableHead className="text-right">{de ? "Erhalten" : "Received"}</TableHead>
                <TableHead className="text-right">{de ? "Verbraucht" : "Used"}</TableHead>
                <TableHead className="text-right">{de ? "Rest" : "Remaining"}</TableHead>
                <TableHead>{de ? "Status" : "Status"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [1,2,3,4,5].map(i => (
                  <TableRow key={i}>
                    {[...Array(9)].map((_, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-16 text-muted-foreground">
                    <Boxes className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p>{de ? "Keine Inventarlose gefunden" : "No inventory lots found"}</p>
                  </TableCell>
                </TableRow>
              ) : filtered.map(lot => {
                const remaining = lot.quantity_received - lot.quantity_used;
                const expiry = expiryStatus(lot);
                const statusCfg = STATUS_CONFIG[lot.status ?? ""] ?? {
                  labelDe: lot.status ?? "—", labelEn: lot.status ?? "—",
                  color: "bg-gray-100 text-gray-600",
                };
                return (
                  <TableRow key={lot.id} className={cn(
                    expiry === "expired" && "bg-red-50/40 dark:bg-red-950/10",
                    expiry === "soon"    && "bg-amber-50/40 dark:bg-amber-950/10",
                  )}>
                    <TableCell className="font-medium max-w-[160px]">
                      <div className="truncate">{de ? lot.name_de : lot.name_en}</div>
                      {lot.category && <div className="text-xs text-muted-foreground truncate capitalize">{lot.category}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{lot.sku}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{lot.lot_number ?? "—"}</TableCell>
                    <TableCell className="text-sm">{lot.purchase_date ? formatDate(lot.purchase_date) : "—"}</TableCell>
                    <TableCell>
                      {lot.expiration_date ? (
                        <span className={cn(
                          "text-sm flex items-center gap-1",
                          expiry === "expired" && "text-red-600 font-medium",
                          expiry === "soon"    && "text-amber-600 font-medium",
                        )}>
                          {(expiry === "expired" || expiry === "soon") && <AlertOctagon className="h-3 w-3 shrink-0" />}
                          {formatDate(lot.expiration_date)}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{lot.quantity_received}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{lot.quantity_used}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      <span className={remaining <= 0 ? "text-red-600" : remaining <= 5 ? "text-amber-600" : ""}>{remaining}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusCfg.color}`}>
                        {de ? statusCfg.labelDe : statusCfg.labelEn}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tab: Approvals ────────────────────────────────────────────────────────────

function ApprovalsTab({ onOpenAnalysis }: { onOpenAnalysis?: () => void }) {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const de = lang === "de";

  const [actions, setActions]             = useState<PendingAction[]>([]);
  const [loading, setLoading]             = useState(true);
  const [expandedId, setExpandedId]       = useState<number | null>(null);
  const [approving, setApproving]         = useState<number | null>(null);
  const [reanalyzing, setReanalyzing]     = useState<number | null>(null);
  const [rejectingId, setRejectingId]     = useState<number | null>(null);
  const [rejectNote, setRejectNote]       = useState("");
  const [rejectBusy, setRejectBusy]       = useState(false);
  const [editedExp, setEditedExp]         = useState<Record<number, Record<string, string>>>({});
  const [editedItems, setEditedItems]     = useState<Record<number, ProposedLineItem[]>>({});

  const fetchActions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/iroc/tori/pending-actions", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setActions(await res.json() as PendingAction[]);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchActions(); }, [fetchActions]);

  function setExpField(actionId: number, key: string, val: string) {
    setEditedExp(prev => ({ ...prev, [actionId]: { ...(prev[actionId] ?? {}), [key]: val } }));
  }

  function getExp(action: PendingAction) {
    const base = action.proposed_expense ?? {};
    const overrides = editedExp[action.id] ?? {};
    return { ...base, ...overrides } as typeof base & Record<string, string>;
  }

  function getItems(action: PendingAction): ProposedLineItem[] {
    return editedItems[action.id] ?? (action.proposed_items ?? []);
  }

  function updateItem(actionId: number, idx: number, patch: Partial<ProposedLineItem>) {
    const base = editedItems[actionId] ?? (actions.find(a => a.id === actionId)?.proposed_items ?? []);
    const updated = base.map((item, i) => i === idx ? { ...item, ...patch } : item);
    setEditedItems(prev => ({ ...prev, [actionId]: updated }));
  }

  async function handleApprove(action: PendingAction) {
    setApproving(action.id);
    try {
      const body: Record<string, unknown> = {};
      if (editedExp[action.id]) body.proposed_expense = getExp(action);
      if (editedItems[action.id]) body.proposed_items = getItems(action);

      const res = await fetch(`/api/iroc/tori/pending-actions/${action.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json() as { error: string }; throw new Error(e.error); }
      const result = await res.json() as { expense_id: number; lots_created: number[]; reorders_queued: string[] };
      let desc = de ? `Ausgabe #${result.expense_id} erstellt` : `Expense #${result.expense_id} created`;
      if (result.reorders_queued.length > 0) {
        desc += ` \u2014 ${de ? "Nachbestellungen" : "Reorders"}: ${result.reorders_queued.join(", ")}`;
      }
      toast({ title: de ? "Genehmigt & gebucht!" : "Approved & committed!", description: desc });
      fetchActions();
      setExpandedId(null);
    } catch (err) {
      toast({ title: de ? "Fehler" : "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally { setApproving(null); }
  }

  async function handleReanalyze(action: PendingAction) {
    setReanalyzing(action.id);
    try {
      const saveRes = await fetch(`/api/iroc/tori/pending-actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          proposed_expense: getExp(action),
          proposed_items: getItems(action),
        }),
      });
      if (!saveRes.ok) {
        const error = await saveRes.json() as { error?: string };
        throw new Error(error.error ?? "Failed to save corrections");
      }

      const reanalyzeRes = await fetch(`/api/iroc/tori/pending-actions/${action.id}/re-analyze`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!reanalyzeRes.ok) {
        const error = await reanalyzeRes.json() as { error?: string };
        throw new Error(error.error ?? "Re-analysis failed");
      }

      const { action: updatedAction } = await reanalyzeRes.json() as { action: PendingAction };
      setActions(previous => previous.map(current => current.id === updatedAction.id ? updatedAction : current));
      setEditedExp(previous => {
        const { [action.id]: _savedEdits, ...remaining } = previous;
        return remaining;
      });
      setEditedItems(previous => {
        const { [action.id]: _savedEdits, ...remaining } = previous;
        return remaining;
      });
      toast({
        title: de ? "Analyse aktualisiert" : "Analysis updated",
        description: de ? "Die Korrekturen wurden in die erneute Analyse einbezogen." : "Your corrections were included in the new analysis.",
      });
    } catch (err) {
      toast({
        title: de ? "Analysefehler" : "Analysis error",
        description: err instanceof Error ? err.message : "Failed",
        variant: "destructive",
      });
    } finally {
      setReanalyzing(null);
    }
  }

  async function handleReject(id: number) {
    setRejectBusy(true);
    try {
      const res = await fetch(`/api/iroc/tori/pending-actions/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ admin_notes: rejectNote }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: de ? "Abgelehnt" : "Rejected" });
      setRejectingId(null); setRejectNote(""); fetchActions();
    } catch {
      toast({ title: de ? "Fehler" : "Error", variant: "destructive" });
    } finally { setRejectBusy(false); }
  }

  const pending  = actions.filter(a => a.status === "pending");
  const approved = actions.filter(a => a.status === "approved");

  return (
    <div className="flex flex-col gap-6 min-h-0 flex-1 overflow-y-auto pb-4">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {de ? "Ausstehende Genehmigungen" : "Pending Approvals"}
          {pending.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-600 text-white text-[11px] font-bold">{pending.length}</span>
          )}
        </p>
        <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={fetchActions} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2].map(i => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}</div>
      ) : pending.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3 border rounded-xl border-dashed">
          <ClipboardCheck className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{de ? "Keine ausstehenden Genehmigungen." : "No pending approvals."}</p>
          {onOpenAnalysis && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-violet-600 dark:text-violet-400 mt-1" onClick={onOpenAnalysis}>
              <Upload className="h-3.5 w-3.5" />{de ? "Rechnung analysieren" : "Analyze an invoice"}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map(action => {
            const exp = getExp(action);
            const items = getItems(action);
            const compliance = action.compliance_summary;
            const missing = action.missing_fields ?? [];
            const isExpanded = expandedId === action.id;

            return (
              <Card key={action.id} className={cn(
                "border transition-all",
                compliance?.all_prices_correct === false && "border-red-200 dark:border-red-800",
                compliance?.all_prices_correct === true && "border-emerald-200 dark:border-emerald-800",
              )}>
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-xl"
                  onClick={() => setExpandedId(isExpanded ? null : action.id)}
                >
                  <div className={cn(
                    "shrink-0 w-2.5 h-2.5 rounded-full",
                    compliance?.all_prices_correct === true ? "bg-emerald-500" :
                    compliance?.all_prices_correct === false ? "bg-red-500" : "bg-gray-400"
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{exp?.vendor_name ?? <span className="italic text-muted-foreground">{de ? "Unbekannter Lieferant" : "Unknown vendor"}</span>}</p>
                    <p className="text-xs text-muted-foreground">
                      {exp?.invoice_number && <span>#{exp.invoice_number} \u00b7 </span>}
                      {exp?.invoice_date && <span>{formatDate(exp.invoice_date)} \u00b7 </span>}
                      {exp?.gross_amount && <span className="font-medium">{formatMoney(Number(exp.gross_amount), exp?.currency ?? "EUR")}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs">
                      {de ? "Ausstehend" : "Pending"}
                    </Badge>
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </div>

                {isExpanded && (
                  <CardContent className="pt-0 pb-4 px-4 border-t space-y-5">
                    {/* Compliance issues */}
                    {compliance?.all_prices_correct === false && (compliance.issues ?? []).length > 0 && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 mt-4">
                        <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-semibold text-red-700 dark:text-red-400">{de ? "Preis-Compliance-Fehler" : "Price Compliance Issues"}</p>
                          {compliance.issues.map((issue, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{issue}</p>)}
                        </div>
                      </div>
                    )}

                    {/* Missing fields */}
                    {missing.length > 0 && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 mt-4">
                        <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">{de ? "Fehlende Angaben" : "Missing Information"}</p>
                          {missing.map((f, i) => <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{f}</p>)}
                        </div>
                      </div>
                    )}

                    {/* Editable expense fields */}
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{de ? "Rechnungsdaten" : "Invoice Details"}</p>
                      <div className="grid grid-cols-2 gap-2.5">
                        {([
                          { k: "vendor_name",    label: de ? "Lieferant" : "Vendor" },
                          { k: "invoice_number", label: de ? "Rechnungsnr." : "Invoice #" },
                          { k: "invoice_date",   label: de ? "Datum" : "Date" },
                          { k: "currency",       label: de ? "W\u00e4hrung" : "Currency" },
                          { k: "net_amount",     label: de ? "Nettobetrag" : "Net Amount" },
                          { k: "tax_amount",     label: de ? "Steuerbetrag" : "Tax Amount" },
                          { k: "gross_amount",   label: de ? "Bruttobetrag" : "Gross Amount" },
                          { k: "shipping_cost",  label: de ? "Versandkosten" : "Shipping" },
                        ] as { k: keyof typeof exp & string; label: string }[]).map(({ k, label }) => (
                          <div key={k} className="space-y-1">
                            <label className="text-xs text-muted-foreground font-medium">{label}</label>
                            <Input
                              value={(editedExp[action.id]?.[k] ?? String(exp?.[k] ?? "")) || ""}
                              onChange={e => setExpField(action.id, k, e.target.value)}
                              className="h-7 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Line items */}
                    {items.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">{de ? "Positionen" : "Line Items"}</p>
                        <div className="overflow-x-auto -mx-4 px-4">
                          <table className="w-full text-xs min-w-[560px]">
                            <thead>
                              <tr className="border-b text-muted-foreground">
                                <th className="text-left pb-1.5 pr-3 font-medium">{de ? "Produkt" : "Product"}</th>
                                <th className="text-left pb-1.5 pr-2 font-medium w-20">ID</th>
                                <th className="text-right pb-1.5 pr-2 font-medium w-16">{de ? "Menge" : "Qty"}</th>
                                <th className="text-right pb-1.5 pr-2 font-medium w-24">{de ? "Einzelpreis" : "Unit Price"}</th>
                                <th className="text-left pb-1.5 pr-2 font-medium w-24">{de ? "Los-Nr." : "Lot #"}</th>
                                <th className="text-center pb-1.5 font-medium w-12">{de ? "OK?" : "OK?"}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/40">
                              {items.map((item, idx) => (
                                <tr key={idx} className={cn(item.compliance?.ok === false && "bg-red-50/50 dark:bg-red-950/10")}>
                                  <td className="py-2 pr-3">
                                    <div className="font-medium">{item.matched_product_name || item.name}</div>
                                    {item.is_new_product && <Badge className="text-[10px] bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 py-0 px-1 mt-0.5">{de ? "Neu" : "New"}</Badge>}
                                    {item.sku && <div className="text-muted-foreground font-mono">{item.sku}</div>}
                                  </td>
                                  <td className="py-2 pr-2">
                                    <Input type="number" placeholder="ID"
                                      value={item.matched_product_id != null ? String(item.matched_product_id) : ""}
                                      onChange={e => updateItem(action.id, idx, { matched_product_id: e.target.value ? Number(e.target.value) : null })}
                                      className="h-6 text-xs w-20" />
                                  </td>
                                  <td className="py-2 pr-2">
                                    <Input type="number"
                                      value={item.quantity != null ? String(item.quantity) : ""}
                                      onChange={e => updateItem(action.id, idx, { quantity: e.target.value ? Number(e.target.value) : null })}
                                      className="h-6 text-xs w-16 text-right" />
                                  </td>
                                  <td className="py-2 pr-2">
                                    <Input type="number"
                                      value={item.unit_price != null ? String(item.unit_price) : ""}
                                      onChange={e => updateItem(action.id, idx, { unit_price: e.target.value ? Number(e.target.value) : null })}
                                      className="h-6 text-xs w-24 text-right" />
                                    {item.compliance?.ok === false && item.compliance.expected_price != null && (
                                      <div className="text-red-500 text-[10px] mt-0.5">{de ? "Erw." : "Exp."}: {formatMoney(item.compliance.expected_price, item.currency)}</div>
                                    )}
                                  </td>
                                  <td className="py-2 pr-2">
                                    <Input placeholder="LOT-XXX"
                                      value={item.lot_number ?? ""}
                                      onChange={e => updateItem(action.id, idx, { lot_number: e.target.value || null })}
                                      className="h-6 text-xs w-24" />
                                  </td>
                                  <td className="py-2 text-center">
                                    {item.compliance?.ok === true  && <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />}
                                    {item.compliance?.ok === false && <span title={item.compliance.notes ?? undefined}><AlertTriangle className="h-4 w-4 text-red-500 mx-auto" /></span>}
                                    {item.compliance?.ok == null  && <span className="text-muted-foreground/40 text-base">—</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => handleReanalyze(action)}
                        disabled={approving === action.id || reanalyzing === action.id}
                      >
                        {reanalyzing === action.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <RefreshCw className="h-4 w-4" />}
                        {reanalyzing === action.id
                          ? (de ? "Analysiert erneut…" : "Re-analyzing…")
                          : (de ? "Erneut analysieren" : "Re-analyze")}
                      </Button>
                      <Button
                        className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => handleApprove(action)}
                        disabled={approving === action.id || reanalyzing === action.id}
                      >
                        {approving === action.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        {approving === action.id ? (de ? "Wird gebucht\u2026" : "Committing\u2026") : (de ? "Genehmigen & buchen" : "Approve & commit")}
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => setRejectingId(action.id)}
                        disabled={!!approving || reanalyzing === action.id}
                      >
                        <X className="h-4 w-4" />{de ? "Ablehnen" : "Reject"}
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Completed */}
      {approved.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{de ? "Abgeschlossen" : "Completed"} ({approved.length})</p>
          <div className="space-y-2">
            {approved.map(action => (
              <Card key={action.id} className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/20 dark:bg-emerald-950/10">
                <CardContent className="pt-3 pb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{action.proposed_expense?.vendor_name ?? "\u2014"}</p>
                    <p className="text-xs text-muted-foreground">
                      {action.proposed_expense?.invoice_number && `#${action.proposed_expense.invoice_number} \u00b7 `}
                      {formatDate(action.created_at)} \u00b7 {de ? "Ausgabe" : "Expense"} #{action.executed_expense_id}
                    </p>
                  </div>
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-xs gap-1 shrink-0">
                    <ClipboardCheck className="h-3 w-3" />{de ? "Gebucht" : "Committed"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={rejectingId !== null} onOpenChange={open => { if (!open) { setRejectingId(null); setRejectNote(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{de ? "Ablehnen best\u00e4tigen" : "Confirm Rejection"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)}
              placeholder={de ? "Grund f\u00fcr Ablehnung (optional)\u2026" : "Reason for rejection (optional)\u2026"}
              className="text-sm min-h-[80px] resize-none" />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setRejectingId(null); setRejectNote(""); }}>{de ? "Abbrechen" : "Cancel"}</Button>
              <Button className="flex-1 bg-destructive hover:bg-destructive/90 text-white"
                onClick={() => rejectingId !== null && handleReject(rejectingId)} disabled={rejectBusy}>
                {rejectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {de ? "Ablehnen" : "Reject"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab: Contracts ─────────────────────────────────────────────────────────────

function ContractsTab() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const de = lang === "de";

  const [contracts, setContracts]   = useState<ToriContract[]>([]);
  const [loading, setLoading]       = useState(true);
  const [uploading, setUploading]   = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [dragging, setDragging]     = useState(false);
  const fileInputRef                = useRef<HTMLInputElement>(null);

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/iroc/tori/contracts", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setContracts(await res.json() as ToriContract[]);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchContracts(); }, [fetchContracts]);

  async function handleUpload(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: de ? "Ungültige Datei" : "Invalid file", description: de ? "Bitte eine PDF-Datei auswählen." : "Please select a PDF file.", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: de ? "Datei zu groß" : "File too large", description: de ? "PDF-Dateien dürfen maximal 20 MB groß sein." : "PDF files may be up to 20 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const uploadRequest = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: "application/pdf" }),
      });
      if (!uploadRequest.ok) throw new Error(de ? "PDF-Speicher konnte nicht vorbereitet werden." : "Could not prepare PDF storage.");
      const { uploadURL, objectPath } = await uploadRequest.json() as { uploadURL: string; objectPath: string };
      const uploadRes = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file });
      if (!uploadRes.ok) throw new Error(de ? "PDF konnte nicht gespeichert werden." : "Could not save PDF.");

      const res = await fetch("/api/iroc/tori/contracts", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceObjectPath: objectPath,
          sourceFileName: file.name,
          sourceFileSize: file.size,
        }),
      });
      const data = await res.json() as ToriContract | PdfTextWarningResponse;
      if (!res.ok) throw new Error((data as PdfTextWarningResponse).error);
      const contract = data as ToriContract;
      setContracts(prev => [contract, ...prev.filter(item => item.id !== contract.id)]);
      setExpandedId(contract.id);
      toast({
        title: de ? "Vertrag gespeichert" : "Contract saved",
        description: de ? "Die PDF ist gespeichert. Tori analysiert sie jetzt." : "The PDF is saved. Tori is analyzing it now.",
      });
      try {
        await analyzeContract(contract.id);
      } catch (analysisError) {
        toast({
          title: de ? "Vertrag gespeichert, Analyse fehlgeschlagen" : "Contract saved, analysis failed",
          description: analysisError instanceof Error ? analysisError.message : (de
            ? "Die Analyse kann in der Vertragskarte erneut gestartet werden."
            : "The analysis can be retried from the contract card."),
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({ title: de ? "Fehler" : "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally { setUploading(false); }
  }

  async function analyzeContract(id: number) {
    setContracts(prev => prev.map(contract =>
      contract.id === id ? { ...contract, analysis_status: "analyzing", analysis_error: null } : contract
    ));
    const res = await fetch(`/api/iroc/tori/contracts/${id}/analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as ToriContract | PdfTextWarningResponse;
    if (!res.ok) {
      await fetchContracts();
      throw new Error((data as PdfTextWarningResponse).error);
    }
    const analyzed = data as ToriContract;
    setContracts(prev => prev.map(contract => contract.id === id ? analyzed : contract));
    toast({
      title: de ? "Vertrag analysiert" : "Contract analyzed",
      description: `${analyzed.vendor_name} · ${(analyzed.discount_tiers ?? []).length} ${de ? "Preisstaffeln" : "pricing tiers"}`,
    });
  }

  async function retryAnalysis(id: number) {
    try {
      await analyzeContract(id);
    } catch (err) {
      toast({
        title: de ? "Analyse fehlgeschlagen" : "Analysis failed",
        description: err instanceof Error ? err.message : (de ? "Bitte erneut versuchen." : "Please try again."),
        variant: "destructive",
      });
    }
  }

  async function handleDelete(id: number) {
    const res = await fetch(`/api/iroc/tori/contracts/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) { setContracts(prev => prev.filter(c => c.id !== id)); toast({ title: de ? "Gel\u00f6scht" : "Deleted" }); }
  }

  return (
    <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto pb-4">
      {/* Upload section */}
      <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        onDragEnter={event => { event.preventDefault(); if (!uploading) setDragging(true); }}
        onDragOver={event => { event.preventDefault(); }}
        onDragLeave={event => { event.preventDefault(); setDragging(false); }}
        onDrop={event => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file && !uploading) void handleUpload(file);
        }}
        className={cn("w-full flex flex-col items-center gap-2 py-10 border-2 border-dashed rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0",
          dragging ? "border-violet-600 bg-violet-100 dark:bg-violet-950/40" : "border-violet-300 dark:border-violet-700 bg-violet-50/30 dark:bg-violet-950/10 hover:bg-violet-100/40 dark:hover:bg-violet-950/20")}
      >
        {uploading ? (
          <><Loader2 className="h-6 w-6 text-violet-500 animate-spin" /><span className="text-sm text-violet-600 dark:text-violet-400">{de ? "Vertrag wird analysiert\u2026" : "Analyzing contract\u2026"}</span></>
        ) : (
          <>
            <FileText className="h-7 w-7 text-violet-400" />
            <span className="text-sm font-semibold text-violet-700 dark:text-violet-400">{de ? "Lieferantenvertrag hochladen (PDF)" : "Upload Supplier Contract (PDF)"}</span>
            <span className="text-xs text-muted-foreground">{de ? "PDF hierher ziehen oder klicken · Tori speichert und analysiert den vollständigen Vertrag" : "Drag PDF here or click · Tori saves and analyzes the complete contract"}</span>
          </>
        )}
      </button>

      {/* Contracts list */}
      <div className="shrink-0">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          {de ? "Gespeicherte Vertr\u00e4ge" : "Stored Contracts"} ({contracts.length})
        </p>
        {loading ? (
          <div className="space-y-3">{[1,2].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
        ) : contracts.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground border rounded-xl border-dashed">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p>{de ? "Noch keine Vertr\u00e4ge hochgeladen." : "No contracts uploaded yet."}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {contracts.map(contract => {
              const tiers = contract.discount_tiers ?? [];
              const isExpanded = expandedId === contract.id;
              return (
                <Card key={contract.id}>
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : contract.id)}
                  >
                    <div className="shrink-0 w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                      <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{contract.vendor_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {tiers.length} {de ? "Preisstaffeln" : "price tiers"}
                        {contract.effective_from && ` \u00b7 ${de ? "ab" : "from"} ${formatDate(contract.effective_from)}`}
                      </p>
                    </div>
                    {contract.analysis_status !== "analyzed" && (
                      <Badge
                        variant={contract.analysis_status === "failed" ? "destructive" : "secondary"}
                        className="gap-1.5 shrink-0"
                      >
                        {contract.analysis_status === "failed" ? (
                          de ? "Analyse fehlgeschlagen" : "Analysis failed"
                        ) : (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {de ? "Wird analysiert" : "Analyzing"}
                          </>
                        )}
                      </Badge>
                    )}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{formatDate(contract.created_at)}</span>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <CardContent className="pt-0 pb-4 px-4 border-t space-y-4">
                      {(contract.products_covered ?? []).length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs font-medium text-muted-foreground mb-2">{de ? "Abgedeckte Produkte" : "Products Covered"}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(contract.products_covered ?? []).map((p, i) => <Badge key={i} variant="secondary" className="text-xs">{p}</Badge>)}
                          </div>
                        </div>
                      )}

                      {tiers.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">{de ? "Preisstaffeln" : "Discount Tiers"}</p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b text-muted-foreground">
                                  <th className="text-left pb-1.5 pr-4 font-medium">{de ? "Von (Menge)" : "From (Qty)"}</th>
                                  <th className="text-left pb-1.5 pr-4 font-medium">{de ? "Bis (Menge)" : "To (Qty)"}</th>
                                  <th className="text-right pb-1.5 pr-4 font-medium">{de ? "Einzelpreis" : "Unit Price"}</th>
                                  <th className="text-right pb-1.5 pr-4 font-medium">{de ? "Rabatt %" : "Discount %"}</th>
                                  <th className="text-left pb-1.5 font-medium">{de ? "Notizen" : "Notes"}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/40">
                                {tiers.map((tier, i) => (
                                  <tr key={i} className="text-foreground/80">
                                    <td className="py-2 pr-4 font-mono font-medium">{tier.from_qty.toLocaleString()}</td>
                                    <td className="py-2 pr-4 font-mono">{tier.to_qty != null ? tier.to_qty.toLocaleString() : "\u221e"}</td>
                                    <td className="py-2 pr-4 text-right font-semibold">{formatMoney(tier.unit_price, tier.currency)}</td>
                                    <td className="py-2 pr-4 text-right">{tier.discount_pct != null ? `${tier.discount_pct}%` : "\u2014"}</td>
                                    <td className="py-2 text-muted-foreground">{tier.notes ?? "\u2014"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {contract.notes && (
                        <p className="text-xs text-muted-foreground italic border-t pt-3">{contract.notes}</p>
                      )}

                      {contract.analysis_status === "failed" && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                          <p className="text-xs text-destructive">
                            {contract.analysis_error || (de
                              ? "Die Analyse konnte nicht abgeschlossen werden."
                              : "The analysis could not be completed.")}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => void retryAnalysis(contract.id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {de ? "Analyse erneut versuchen" : "Retry analysis"}
                          </Button>
                        </div>
                      )}

                      {contract.source_object_path && (
                        <a
                          href={`/api/storage${contract.source_object_path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300 hover:underline"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          {de ? "Gespeicherte Original-PDF öffnen" : "Open stored original PDF"}
                          {contract.source_page_count ? ` · ${contract.source_page_count} ${de ? "Seiten" : "pages"}` : ""}
                        </a>
                      )}

                      <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => handleDelete(contract.id)}>
                        <Trash2 className="h-3.5 w-3.5" />{de ? "Vertrag l\u00f6schen" : "Delete Contract"}
                      </Button>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Tori() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const de = lang === "de";
  const [tab, setTab]               = useState<Tab>("analysis");
  const [pendingCount, setPending]  = useState(0);

  // Poll pending-actions count every 30 s
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch("/api/iroc/tori/pending-actions?status=pending", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) { const rows = await res.json() as unknown[]; setPending(rows.length); }
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [token]);

  const tabs: { id: Tab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "analysis",    label: de ? "Rechnungsanalyse"     : "Invoice Analysis", icon: Sparkles },
    { id: "approvals",   label: de ? "Genehmigungen"        : "Approvals",        icon: ClipboardCheck, badge: pendingCount },
    { id: "contracts",   label: de ? "Vertr\u00e4ge"        : "Contracts",        icon: FileText },
    { id: "reorder",     label: de ? "Bestellwarteschlange" : "Reorder Queue",    icon: ShoppingBag },
    { id: "finance",     label: de ? "Finanzen"             : "Finance",          icon: TrendingUp },
    { id: "history",     label: de ? "Historie"              : "History",         icon: Archive },
    { id: "merchandise", label: de ? "Waren & Inventar"     : "Merchandise",      icon: Boxes },
    { id: "learning",    label: de ? "Lernschleife"         : "Learning Loop",    icon: Brain },
  ];

  return (
    <div className="h-full flex flex-col gap-0">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b mb-4 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center shadow-sm"><Bot className="h-5 w-5 text-white" /></div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Tori</h1>
          <p className="text-xs text-muted-foreground">{de ? "KI-Betriebsagentin \u2014 Inventar, Lieferanten & Rechnungsanalyse" : "AI Operations Agent \u2014 Inventory, Suppliers & Invoice Analysis"}</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <BadgeAlert className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-xs text-muted-foreground">{de ? "Alle Aktionen ben\u00f6tigen Admin-Genehmigung" : "All actions require admin approval"}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 shrink-0 border-b pb-0 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0",
              tab === t.id
                ? "border-violet-600 text-violet-700 dark:text-violet-400"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30",
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-violet-600 text-white text-[10px] font-bold leading-none">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "analysis"    && <AnalysisTab onGoToApprovals={() => setTab("approvals")} />}
        {tab === "approvals"   && <ApprovalsTab onOpenAnalysis={() => setTab("analysis")} />}
        {tab === "contracts"   && <ContractsTab />}
        {tab === "reorder"     && <ReorderTab />}
        {tab === "finance"     && <FinanceTab />}
        {tab === "history"     && <FinanceHistoryTab />}
        {tab === "merchandise" && <MerchandiseTab />}
        {tab === "learning"    && <LearningTab />}
      </div>
    </div>
  );
}
