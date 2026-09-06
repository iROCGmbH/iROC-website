import { useState, useMemo, useEffect } from "react";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import {
  Card, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus, Search, MoreHorizontal, Pencil, Trash2, Mail, UserSearch, X, CheckSquare, FileText, Loader2, Download,
} from "lucide-react";
import { LEADS_QUERY_KEY } from "@/lib/query-keys";
import { recipientLanguageForCountry } from "@/lib/recipient-language";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Lead {
  id: number;
  salutation: string;
  medicalTitle: string | null;
  firstName: string;
  lastName: string;
  specialty: string | null;
  institutionName: string | null;
  zipCode: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  contactWhere: string | null;
  firstContactDate: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
  trainingOfferSaved: boolean;
  trainingOfferDownloadAvailable: boolean;
}

const SALUTATIONS = ["Herr", "Frau", "Divers"];
const MEDICAL_TITLES = ["", "Dr. med.", "Prof. Dr.", "PD Dr.", "Prof. Dr. med.", "Dr. med. univ."];
const STATUSES = ["new", "contacted", "registered", "qualified", "converted"];
const BULK_STATUSES = STATUSES.filter(status => status !== "registered");
const EDITABLE_STATUSES: Record<string, string[]> = {
  new: ["new", "contacted", "converted"],
  contacted: ["new", "contacted", "converted"],
  registered: ["registered", "qualified"],
  qualified: ["qualified", "converted"],
  converted: ["converted"],
};

const STATUS_LABELS: Record<string, { de: string; en: string }> = {
  new:       { de: "Neu",          en: "New" },
  contacted: { de: "Kontaktiert",  en: "Contacted" },
  registered:{ de: "Angemeldet",   en: "Registered" },
  qualified: { de: "Qualifiziert", en: "Qualified" },
  converted: { de: "Konvertiert",  en: "Converted" },
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  new:       "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
  contacted: "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200",
  registered:"border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
  qualified: "border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200",
  converted: "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
};

const STATUS_SORT_ORDER: Record<string, number> = {
  registered: 0,
  qualified: 1,
  contacted: 2,
  new: 3,
  converted: 4,
};

const LEAD_TEXT_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDisplayName(lead: Lead) {
  const parts = [lead.salutation, lead.medicalTitle, lead.firstName, lead.lastName].filter(Boolean);
  return parts.join(" ");
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function compareLeadText(a: string | null, b: string | null) {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return LEAD_TEXT_COLLATOR.compare(left, right);
}

export function sortLeadsByStatusDateCountryCity(leads: Lead[]) {
  return [...leads].sort((a, b) => {
    const statusOrder = (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99);
    if (statusOrder !== 0) return statusOrder;

    const addedDateOrder = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (addedDateOrder !== 0) return addedDateOrder;

    const countryOrder = compareLeadText(a.country, b.country);
    if (countryOrder !== 0) return countryOrder;

    const cityOrder = compareLeadText(a.city, b.city);
    if (cityOrder !== 0) return cityOrder;

    return a.id - b.id;
  });
}

// ── Blank lead ────────────────────────────────────────────────────────────────

type LeadFormData = Omit<Lead, "id" | "createdAt" | "trainingOfferSaved" | "trainingOfferDownloadAvailable">;
type LeadUpdateData = LeadFormData & Pick<Lead, "id" | "createdAt">;

function blankLead(): LeadFormData {
  return {
    salutation: "Herr", medicalTitle: null, firstName: "", lastName: "",
    specialty: null, institutionName: null, zipCode: null, city: null, country: "Deutschland",
    email: null, phone: null, website: null, contactWhere: null,
    firstContactDate: null, notes: null, status: "new",
  };
}

// ── LeadForm ──────────────────────────────────────────────────────────────────

function LeadForm({
  value,
  onChange,
  lang,
}: {
  value: LeadFormData;
  onChange: (v: LeadFormData) => void;
  lang: "de" | "en";
}) {
  const set = (k: keyof typeof value, v: string | null) => onChange({ ...value, [k]: v || null });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {/* Anrede */}
      <div className="space-y-1">
        <Label>{t("salutation", lang)}</Label>
        <Select value={value.salutation} onValueChange={v => onChange({ ...value, salutation: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {SALUTATIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Titel */}
      <div className="space-y-1">
        <Label>{t("medical_title", lang)}</Label>
        <Select value={value.medicalTitle ?? ""} onValueChange={v => onChange({ ...value, medicalTitle: v || null })}>
          <SelectTrigger><SelectValue placeholder={lang === "de" ? "Kein Titel" : "No title"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">{lang === "de" ? "Kein Titel" : "No title"}</SelectItem>
            {MEDICAL_TITLES.filter(Boolean).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Vorname */}
      <div className="space-y-1">
        <Label>{lang === "de" ? "Vorname" : "First Name"}</Label>
        <Input value={value.firstName} onChange={e => onChange({ ...value, firstName: e.target.value })} />
      </div>

      {/* Nachname */}
      <div className="space-y-1">
        <Label>{lang === "de" ? "Nachname *" : "Last Name *"}</Label>
        <Input value={value.lastName} onChange={e => onChange({ ...value, lastName: e.target.value })} required />
      </div>

      {/* Fachrichtung */}
      <div className="space-y-1">
        <Label>{t("specialty", lang)}</Label>
        <Input value={value.specialty ?? ""} onChange={e => set("specialty", e.target.value)} placeholder={lang === "de" ? "z. B. Orthopädie" : "e.g. Orthopaedics"} />
      </div>

      {/* Institution */}
      <div className="space-y-1">
        <Label>{lang === "de" ? "Institution / Klinik" : "Institution / Clinic"}</Label>
        <Input value={value.institutionName ?? ""} onChange={e => set("institutionName", e.target.value)} placeholder={lang === "de" ? "z. B. Charité Berlin" : "e.g. University Hospital"} />
      </div>

      {/* E-Mail */}
      <div className="space-y-1">
        <Label>{t("email", lang)}</Label>
        <Input type="email" value={value.email ?? ""} onChange={e => set("email", e.target.value)} />
      </div>

      {/* Telefon */}
      <div className="space-y-1">
        <Label>{lang === "de" ? "Telefon" : "Phone"}</Label>
        <Input value={value.phone ?? ""} onChange={e => set("phone", e.target.value)} />
      </div>

      {/* Website */}
      <div className="space-y-1">
        <Label>Website</Label>
        <Input value={value.website ?? ""} onChange={e => set("website", e.target.value)} placeholder="https://" />
      </div>

      {/* PLZ */}
      <div className="space-y-1">
        <Label>{t("zip_code", lang)}</Label>
        <Input value={value.zipCode ?? ""} onChange={e => set("zipCode", e.target.value)} />
      </div>

      {/* Stadt */}
      <div className="space-y-1">
        <Label>{t("city", lang)}</Label>
        <Input value={value.city ?? ""} onChange={e => set("city", e.target.value)} />
      </div>

      {/* Land */}
      <div className="space-y-1">
        <Label>{t("country", lang)}</Label>
        <Input value={value.country ?? ""} onChange={e => set("country", e.target.value)} />
      </div>

      {/* Kontaktiert bei */}
      <div className="space-y-1">
        <Label>{t("contact_where", lang)}</Label>
        <Input value={value.contactWhere ?? ""} onChange={e => set("contactWhere", e.target.value)} placeholder={lang === "de" ? "z. B. DKOU 2025" : "e.g. DKOU 2025"} />
      </div>

      {/* Erstkontakt-Datum */}
      <div className="space-y-1">
        <Label>{lang === "de" ? "Datum Erstkontakt" : "First Contact Date"}</Label>
        <Input
          type="date"
          value={value.firstContactDate ?? ""}
          onChange={e => onChange({ ...value, firstContactDate: e.target.value || null })}
        />
      </div>

      {/* Status */}
      <div className="space-y-1">
        <Label>{t("status", lang)}</Label>
        <Select value={value.status} onValueChange={v => onChange({ ...value, status: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(EDITABLE_STATUSES[value.status] ?? BULK_STATUSES).map(s => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]?.[lang] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Notizen */}
      <div className="space-y-1 sm:col-span-2">
        <Label>{t("notes", lang)}</Label>
        <Textarea rows={3} value={value.notes ?? ""} onChange={e => set("notes", e.target.value)} />
      </div>
    </div>
  );
}

// ── Email Dialog ──────────────────────────────────────────────────────────────

type EmailProduct = "Spirecut" | "MiniStem";

function buildEmailTemplate(
  lead: Lead,
  lang: "de" | "en",
  product: EmailProduct,
  signature = "",
) {
  const nameWithTitle = [lead.medicalTitle, lead.lastName].filter(Boolean).join(" ");
  const legalSignature = signature ? `\n\n${signature}` : "";

  if (lang === "en") {
    const salutation = lead.salutation === "Frau" ? "Ms" : lead.salutation === "Herr" ? "Mr" : null;
    const greeting = salutation ? `Dear ${salutation} ${nameWithTitle}` : `Dear ${nameWithTitle || "Sir or Madam"}`;
    return {
      subject: `Invitation to ${product} Training`,
      body: `${greeting},

Thank you for your interest in ${product}. We would like to warmly invite you to register for one of our training days and get to know the ${product} system.

Please register on our website via the following link:

https://www.i-roc.de/en/

If you have any questions, please do not hesitate to contact us.

Best regards,
Your iROC Team${legalSignature}`,
    };
  }

  const anrede = lead.salutation === "Frau" ? "geehrte Frau" : lead.salutation === "Herr" ? "geehrter Herr" : "geehrte/r";
  return {
    subject: `Einladung zur ${product} Schulung`,
    body: `Sehr ${anrede} ${nameWithTitle},

vielen Dank für Ihr Interesse an ${product}. Wir möchten Sie herzlich einladen, sich für einen unserer Schulungstage zu registrieren und das ${product}-System kennenzulernen.

Bitte registrieren Sie sich auf unserer Website unter folgendem Link:

https://www.i-roc.de/

Bei Fragen stehen wir Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen,
Ihr iROC-Team${legalSignature}`,
  };
}

function EmailDialog({
  lead,
  onClose,
  token,
  onSent,
}: {
  lead: Lead;
  onClose: () => void;
  token: string | null;
  onSent: () => void;
}) {
  const { lang } = useLanguage();
  const { toast } = useToast();
  const [product, setProduct] = useState<EmailProduct>("Spirecut");
  const templateLang = recipientLanguageForCountry(lead.country);
  const { data: signature = "" } = useQuery<string>({
    queryKey: ["iroc-impressum-signature", templateLang],
    queryFn: async () => {
      const response = await fetch(`/api/iroc/impressum-signature?language=${templateLang}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Failed to fetch legal signature");
      return (await response.json() as { signature: string }).signature;
    },
    enabled: !!token,
  });
  const tpl = buildEmailTemplate(lead, templateLang, product, signature);
  const [subject, setSubject] = useState(tpl.subject);
  const [body, setBody] = useState(tpl.body);
  const [sending, setSending] = useState(false);

  // Regenerate subject + body whenever product changes
  useEffect(() => {
    const t = buildEmailTemplate(lead, templateLang, product, signature);
    setSubject(t.subject);
    setBody(t.body);
  }, [lead, product, templateLang, signature]);

  async function send() {
    if (!lead.email) return;
    setSending(true);
    try {
      const r = await fetch(`/api/iroc/leads/${lead.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subject, body }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: lang === "de" ? "E-Mail gesendet" : "Email sent", description: lead.email });
      onSent();
      onClose();
    } catch (err) {
      toast({ title: lang === "de" ? "Fehler" : "Error", description: String(err), variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {lang === "de" ? "Einladung senden" : "Send Invite"} – {buildDisplayName(lead)}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {lang === "de" ? "An:" : "To:"} {lead.email}
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{lang === "de" ? "Produkt" : "Product"}</Label>
            <div className="flex gap-2">
              {(["Spirecut", "MiniStem"] as EmailProduct[]).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProduct(p)}
                  className={`px-4 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                    product === p
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-input text-foreground hover:bg-muted"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>{lang === "de" ? "Betreff" : "Subject"}</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{lang === "de" ? "Nachricht" : "Message"}</Label>
            <Textarea rows={14} value={body} onChange={e => setBody(e.target.value)} className="font-mono text-xs" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel", lang)}</Button>
          <Button onClick={send} disabled={sending || !lead.email}>
            <Mail className="h-4 w-4 mr-2" />
            {sending ? (lang === "de" ? "Senden…" : "Sending…") : t("send_invite", lang)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Leads() {
  const { lang } = useLanguage();
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [emailLead, setEmailLead] = useState<Lead | null>(null);
  const [formData, setFormData] = useState<LeadFormData>(blankLead());

  const [, navigate] = useLocation();
  const [invoiceLoadingId, setInvoiceLoadingId] = useState<number | null>(null);
  const [offerDownloadLoadingId, setOfferDownloadLoadingId] = useState<number | null>(null);
  const [offerConversionLoadingId, setOfferConversionLoadingId] = useState<number | null>(null);

  // ── Bulk selection ────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkTargetStatus, setBulkTargetStatus] = useState<string>("contacted");

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const { data: leads = [], isLoading, isError } = useQuery<Lead[]>({
    queryKey: LEADS_QUERY_KEY,
    queryFn: async () => {
      const r = await fetch("/api/iroc/leads", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to fetch leads");
      return r.json();
    },
    enabled: !!token,
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (data: LeadFormData) => {
      const r = await fetch("/api/iroc/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      setAddOpen(false);
      setFormData(blankLead());
      toast({ title: lang === "de" ? "Lead erstellt" : "Lead created" });
    },
    onError: (err) => toast({ title: lang === "de" ? "Fehler" : "Error", description: String(err), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: LeadUpdateData) => {
      const r = await fetch(`/api/iroc/leads/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      setEditLead(null);
      toast({ title: lang === "de" ? "Lead gespeichert" : "Lead saved" });
    },
    onError: (err) => toast({ title: lang === "de" ? "Fehler" : "Error", description: String(err), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/iroc/leads/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      toast({ title: lang === "de" ? "Lead gelöscht" : "Lead deleted" });
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: number[]; status: string }) => {
      const r = await fetch("/api/iroc/leads/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids, status }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      setSelectedIds(new Set());
      toast({
        title: lang === "de" ? "Status aktualisiert" : "Status updated",
        description: lang === "de"
          ? `${vars.ids.length} Lead(s) → ${STATUS_LABELS[vars.status]?.de ?? vars.status}`
          : `${vars.ids.length} lead(s) → ${STATUS_LABELS[vars.status]?.en ?? vars.status}`,
      });
    },
    onError: (err) => toast({ title: lang === "de" ? "Fehler" : "Error", description: String(err), variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const r = await fetch("/api/iroc/leads/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (_data, ids) => {
      qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      setSelectedIds(new Set());
      toast({
        title: lang === "de" ? "Leads gelöscht" : "Leads deleted",
        description: lang === "de" ? `${ids.length} Lead(s) gelöscht` : `${ids.length} lead(s) deleted`,
      });
    },
    onError: (err) => toast({ title: lang === "de" ? "Fehler" : "Error", description: String(err), variant: "destructive" }),
  });

  // ── Filtered list ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const matchingLeads = leads
      .filter(l => {
        if (statusFilter !== "all" && l.status !== statusFilter) return false;
        if (!q) return true;
        return (
          l.lastName.toLowerCase().includes(q) ||
          l.firstName.toLowerCase().includes(q) ||
          (l.email ?? "").toLowerCase().includes(q) ||
          (l.city ?? "").toLowerCase().includes(q) ||
          (l.specialty ?? "").toLowerCase().includes(q) ||
          (l.contactWhere ?? "").toLowerCase().includes(q) ||
          (l.institutionName ?? "").toLowerCase().includes(q)
        );
      });
    return sortLeadsByStatusDateCountryCity(matchingLeads);
  }, [leads, search, statusFilter]);

  // ── Status counts ────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length };
    for (const l of leads) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [leads]);

  // ── Selection helpers ─────────────────────────────────────────────────────────
  const filteredIds = useMemo(() => filtered.map(l => l.id), [filtered]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.has(id));

  function toggleAll() {
    if (allFilteredSelected) {
      // deselect all filtered
      setSelectedIds(prev => {
        const next = new Set(prev);
        filteredIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      // select all filtered
      setSelectedIds(prev => new Set([...prev, ...filteredIds]));
    }
  }

  function toggleOne(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openEdit(lead: Lead) {
    setEditLead(lead);
    setFormData({
      salutation: lead.salutation, medicalTitle: lead.medicalTitle, firstName: lead.firstName,
      lastName: lead.lastName, specialty: lead.specialty, institutionName: lead.institutionName,
      zipCode: lead.zipCode, city: lead.city, country: lead.country, email: lead.email,
      phone: lead.phone, website: lead.website, contactWhere: lead.contactWhere,
      firstContactDate: lead.firstContactDate, notes: lead.notes, status: lead.status,
    });
  }

  function openAdd() {
    setFormData(blankLead());
    setAddOpen(true);
  }

  async function handleCreateInvoice(lead: Lead) {
    if (!token) return;
    if (!lead.email) {
      toast({ variant: "destructive", title: lang === "de" ? "Kein E-Mail beim Lead" : "Lead has no email address" });
      return;
    }
    setInvoiceLoadingId(lead.id);
    try {
      const res = await fetch(`/api/iroc/leads/${lead.id}/invoice-config`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const { websiteCustomerId, allowedGroups, customerCreated, isOffer, trainingDate, trainingOfferId, leadName } = await res.json() as {
        websiteCustomerId: number | null;
        allowedGroups: string;
        customerCreated: boolean;
        isOffer: boolean;
        trainingDate: string | null;
        trainingOfferId?: number;
        leadName?: string;
      };
      if (customerCreated) {
        toast({ title: lang === "de" ? "Neuer Kunde angelegt" : "New customer created", description: lead.email });
      }
      const params = new URLSearchParams({
        allowedGroups,
        isOffer: String(isOffer),
        ...(trainingDate ? { trainingDate } : {}),
        ...(isOffer ? { leadId: String(lead.id), leadName: leadName ?? buildDisplayName(lead) } : {}),
        ...(!isOffer && websiteCustomerId ? { websiteCustomerId: String(websiteCustomerId) } : {}),
        ...(trainingOfferId ? { trainingOfferId: String(trainingOfferId) } : {}),
      });
      navigate(`/invoices/new?${params.toString()}`);
    } catch (e) {
      toast({ variant: "destructive", title: lang === "de" ? "Fehler" : "Error", description: (e as Error).message });
    } finally {
      setInvoiceLoadingId(null);
    }
  }

  async function handleDownloadTrainingOffer(lead: Lead) {
    if (!token) return;
    setOfferDownloadLoadingId(lead.id);
    try {
      const res = await fetch(`/api/iroc/leads/${lead.id}/training-offer-pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${lang === "en" ? "Offer" : "Angebot"}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        variant: "destructive",
        title: lang === "de" ? "Fehler" : "Error",
        description: error instanceof Error
          ? error.message
          : (lang === "de" ? "Angebot konnte nicht heruntergeladen werden." : "Could not download the offer."),
      });
    } finally {
      setOfferDownloadLoadingId(null);
    }
  }

  async function handleConvertAcceptedOfferToInvoice(lead: Lead) {
    if (!token) return;
    const confirmed = confirm(
      lang === "de"
        ? "Als angenommen markieren und die Rechnung erstellen? Dabei wird ein Kunde mit Kundennummer angelegt, falls noch keiner besteht."
        : "Mark this offer as accepted and create the invoice? A customer with a customer number will be created if needed.",
    );
    if (!confirmed) return;

    setOfferConversionLoadingId(lead.id);
    try {
      const qualification = await fetch(`/api/iroc/leads/${lead.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "qualified" }),
      });
      if (!qualification.ok) {
        const error = await qualification.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error ?? `HTTP ${qualification.status}`);
      }
      await qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      await handleCreateInvoice({ ...lead, status: "qualified" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: lang === "de" ? "Fehler" : "Error",
        description: error instanceof Error
          ? error.message
          : (lang === "de" ? "Angebot konnte nicht in eine Rechnung umgewandelt werden." : "Could not convert the offer to an invoice."),
      });
    } finally {
      setOfferConversionLoadingId(null);
    }
  }

  const selectionCount = selectedIds.size;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <UserSearch className="h-7 w-7 text-primary" />
            {lang === "de" ? "Leads" : "Leads"}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {lang === "de"
              ? "Potenzielle Kunden verwalten und kontaktieren"
              : "Manage and contact potential customers"}
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-2" />
          {t("add_lead", lang)}
        </Button>
      </div>

      {/* Status filter bar */}
      <div className="flex flex-wrap gap-2">
        {["all", ...STATUSES].map(s => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setSelectedIds(new Set()); }}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
              statusFilter === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            {s === "all" ? (lang === "de" ? "Alle" : "All") : (STATUS_LABELS[s]?.[lang] ?? s)}
            <span className="ml-1.5 text-xs opacity-70">({counts[s] ?? 0})</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={lang === "de" ? "Suchen…" : "Search…"}
          value={search}
          onChange={e => { setSearch(e.target.value); setSelectedIds(new Set()); }}
        />
      </div>

      {/* Select all / Deselect all */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={toggleAll} className="h-7 gap-1.5 text-xs">
          {allFilteredSelected
            ? (lang === "de" ? "Auswahl aufheben" : "Deselect all")
            : (lang === "de" ? "Alle auswählen" : "Select all")}
        </Button>
      </div>

      {/* Bulk action bar — visible only when rows are selected */}
      {selectionCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckSquare className="h-4 w-4 text-primary" />
            <span>
              {lang === "de"
                ? `${selectionCount} Lead${selectionCount !== 1 ? "s" : ""} ausgewählt`
                : `${selectionCount} lead${selectionCount !== 1 ? "s" : ""} selected`}
            </span>
          </div>

          <div className="flex items-center gap-2 ml-2">
            <span className="text-xs text-muted-foreground">
              {lang === "de" ? "Status setzen:" : "Set status:"}
            </span>
            <Select value={bulkTargetStatus} onValueChange={setBulkTargetStatus}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BULK_STATUSES.map(s => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {STATUS_LABELS[s]?.[lang] ?? s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={bulkStatusMutation.isPending}
              onClick={() => bulkStatusMutation.mutate({ ids: [...selectedIds], status: bulkTargetStatus })}
            >
              {bulkStatusMutation.isPending
                ? (lang === "de" ? "Wird gespeichert…" : "Saving…")
                : (lang === "de" ? "Anwenden" : "Apply")}
            </Button>
          </div>

          <Button
            size="sm"
            variant="destructive"
            className="h-8 text-xs ml-auto"
            disabled={bulkDeleteMutation.isPending}
            onClick={() => {
              const msg = lang === "de"
                ? `${selectionCount} Lead${selectionCount !== 1 ? "s" : ""} wirklich löschen?`
                : `Delete ${selectionCount} lead${selectionCount !== 1 ? "s" : ""}?`;
              if (confirm(msg)) bulkDeleteMutation.mutate([...selectedIds]);
            }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {bulkDeleteMutation.isPending
              ? (lang === "de" ? "Wird gelöscht…" : "Deleting…")
              : (lang === "de" ? "Löschen" : "Delete")}
          </Button>

          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSelectedIds(new Set())}
            title={lang === "de" ? "Auswahl aufheben" : "Clear selection"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">{lang === "de" ? "Wird geladen…" : "Loading…"}</p>
          ) : isError ? (
            <p className="text-center py-8 text-destructive">
              {lang === "de"
                ? "Leads konnten nicht geladen werden. Bitte Seite neu laden."
                : "Failed to load leads. Please refresh the page."}
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              {lang === "de" ? "Keine Leads gefunden" : "No leads found"}
            </p>
          ) : (
            <div className="sticky-header-table overflow-y-auto max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{lang === "de" ? "Name" : "Name"}</TableHead>
                  <TableHead>{t("specialty", lang)}</TableHead>
                  <TableHead>{t("city", lang)}</TableHead>
                  <TableHead>{t("email", lang)}</TableHead>
                  <TableHead>{t("contact_where", lang)}</TableHead>
                  <TableHead>{t("status", lang)}</TableHead>
                  <TableHead>{lang === "de" ? "Hinzugefügt" : "Added"}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(lead => (
                  <TableRow
                    key={lead.id}
                    data-state={selectedIds.has(lead.id) ? "selected" : undefined}
                    className={`cursor-pointer ${selectedIds.has(lead.id) ? "bg-primary/5" : ""}`}
                    onClick={() => toggleOne(lead.id)}
                  >
                    <TableCell>
                      <div className="font-medium">{buildDisplayName(lead)}</div>
                      {lead.phone && <div className="text-xs text-muted-foreground">{lead.phone}</div>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{lead.specialty ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {[lead.zipCode, lead.city].filter(Boolean).join(" ") || "—"}
                      {lead.country && lead.country !== "Deutschland" && (
                        <div className="text-xs text-muted-foreground">{lead.country}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {lead.email
                        ? <a href={`mailto:${lead.email}`} className="text-primary hover:underline">{lead.email}</a>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{lead.contactWhere ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_BADGE_CLASSES[lead.status] ?? ""}
                      >
                        {STATUS_LABELS[lead.status]?.[lang] ?? lead.status}
                      </Badge>
                      {lead.firstContactDate && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {new Date(lead.firstContactDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(lead.createdAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={lang === "de" ? "Aktionen" : "Actions"}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(lead)}>
                            <Pencil className="h-4 w-4 mr-2" />{t("edit", lang)}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleCreateInvoice(lead)}
                            disabled={
                              invoiceLoadingId === lead.id
                              || !lead.email
                              || (lead.status === "registered" && lead.trainingOfferSaved)
                            }
                          >
                            {invoiceLoadingId === lead.id
                              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              : <FileText className="h-4 w-4 mr-2" />}
                            {lead.status === "registered" && lead.trainingOfferSaved
                              ? (lang === "de" ? "Angebot gespeichert" : "Offer saved")
                              : (lead.status === "qualified" || lead.status === "converted")
                              ? (lang === "de" ? "Rechnung erstellen" : "Create Invoice")
                              : (lang === "de" ? "Angebot erstellen" : "Create Offer")}
                          </DropdownMenuItem>
                          {lead.status === "registered" && (
                            <>
                            {lead.trainingOfferSaved && (
                              <DropdownMenuItem
                                onClick={() => handleConvertAcceptedOfferToInvoice(lead)}
                                disabled={offerConversionLoadingId === lead.id}
                              >
                                {offerConversionLoadingId === lead.id
                                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  : <FileText className="h-4 w-4 mr-2" />}
                                {offerConversionLoadingId === lead.id
                                  ? (lang === "de" ? "Wird vorbereitet…" : "Preparing…")
                                  : (lang === "de" ? "Angenommenes Angebot in Rechnung umwandeln" : "Convert accepted offer to invoice")}
                              </DropdownMenuItem>
                            )}
                            {lead.trainingOfferDownloadAvailable ? (
                              <DropdownMenuItem
                                onClick={e => {
                                  e.stopPropagation();
                                  handleDownloadTrainingOffer(lead);
                                }}
                                disabled={offerDownloadLoadingId === lead.id}
                              >
                                {offerDownloadLoadingId === lead.id
                                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  : <Download className="h-4 w-4 mr-2" />}
                                {offerDownloadLoadingId === lead.id
                                  ? (lang === "de" ? "Wird heruntergeladen…" : "Downloading…")
                                  : (lang === "de" ? "Angebot erneut herunterladen" : "Download offer again")}
                              </DropdownMenuItem>
                            ) : lead.trainingOfferSaved ? (
                              <DropdownMenuItem disabled>
                                <Download className="h-4 w-4 mr-2" />
                                {lang === "de"
                                  ? "Archiviertes Angebot nicht erneut verfügbar"
                                  : "Archived offer cannot be re-downloaded"}
                              </DropdownMenuItem>
                            ) : null}
                            </>
                          )}
                          <DropdownMenuItem
                            onClick={() => setEmailLead(lead)}
                            disabled={!lead.email}
                          >
                            <Mail className="h-4 w-4 mr-2" />{t("send_invite", lang)}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              if (confirm(lang === "de" ? "Lead wirklich löschen?" : "Delete this lead?")) {
                                deleteMutation.mutate(lead.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />{t("delete", lang)}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      {addOpen && (
        <Dialog open onOpenChange={setAddOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("add_lead", lang)}</DialogTitle>
            </DialogHeader>
            <LeadForm value={formData} onChange={setFormData} lang={lang} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>{t("cancel", lang)}</Button>
              <Button
                onClick={() => createMutation.mutate(formData)}
                disabled={!formData.lastName || createMutation.isPending}
              >
                {createMutation.isPending ? (lang === "de" ? "Speichern…" : "Saving…") : t("create", lang)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Dialog */}
      {editLead && (
        <Dialog open onOpenChange={() => setEditLead(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("edit", lang)}: {buildDisplayName(editLead)}</DialogTitle>
            </DialogHeader>
            <LeadForm value={formData} onChange={setFormData} lang={lang} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditLead(null)}>{t("cancel", lang)}</Button>
              <Button
                onClick={() => updateMutation.mutate({ ...formData, id: editLead.id, createdAt: editLead.createdAt })}
                disabled={!formData.lastName || updateMutation.isPending}
              >
                {updateMutation.isPending ? (lang === "de" ? "Speichern…" : "Saving…") : t("save", lang)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Email Dialog */}
      {emailLead && (
        <EmailDialog
          lead={emailLead}
          onClose={() => setEmailLead(null)}
          token={token}
          onSent={() => qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY })}
        />
      )}
    </div>
  );
}
