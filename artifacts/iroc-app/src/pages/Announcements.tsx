/**
 * Announcements — bulk individual email sender
 *
 * 1. Pick customers from a searchable, filterable table
 * 2. Compose subject + free-text body
 * 3. Send each email individually (not BCC)
 * 4. Review per-recipient results
 */
import { useState, useEffect, useMemo } from "react";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { adminGet, adminPost } from "@/lib/admin-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Megaphone, Search, ChevronLeft, ChevronRight, Send, CheckCircle2,
  XCircle, Loader2, Users, Mail, AlertCircle, Settings,
} from "lucide-react";
import { Link } from "wouter";

interface WebsiteCustomer {
  id: number;
  customerNr: string | null;
  firstName: string | null;
  lastName: string | null;
  institutionName: string | null;
  specialty: string | null;
  email: string;
  instrument: string;
}

interface SendResult {
  customerId: number;
  email: string;
  status: "sent" | "failed";
  error?: string;
}

const INSTRUMENT_LABELS: Record<string, string> = {
  spirecut: "Spirecut®",
  ministem: "MiniStem®",
  both: "Both",
  other: "Other",
  post_training_support: "Post-Training",
  practice_marketing_support: "Marketing",
};

type Step = "pick" | "compose" | "results";

export default function Announcements() {
  const { lang } = useLanguage();
  const { token } = useAuth();
  const de = lang === "de";

  // ── Data ───────────────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<WebsiteCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromEmail, setFromEmail] = useState("info@i-roc.de");

  useEffect(() => {
    if (!token) return;
    Promise.all([
      adminGet<WebsiteCustomer[]>("/api/iroc/website-customers", token)
        .then(setCustomers)
        .catch(() => {}),
      fetch("/api/website-settings")
        .then((r) => r.ok ? r.json() : {})
        .then((d: Record<string, string>) => { if (d.iroc_announcement_from) setFromEmail(d.iroc_announcement_from); })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [token]);

  // ── Step 1: Pick customers ─────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("pick");
  const [search, setSearch] = useState("");
  const [instrumentFilter, setInstrumentFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const instruments = useMemo(
    () => ["all", ...Array.from(new Set(customers.map((c) => c.instrument)))],
    [customers]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return customers.filter((c) => {
      const matchSearch =
        !q ||
        c.email.toLowerCase().includes(q) ||
        (c.firstName ?? "").toLowerCase().includes(q) ||
        (c.lastName ?? "").toLowerCase().includes(q) ||
        (c.institutionName ?? "").toLowerCase().includes(q);
      const matchInstrument = instrumentFilter === "all" || c.instrument === instrumentFilter;
      return matchSearch && matchInstrument;
    });
  }, [customers, search, instrumentFilter]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));

  function toggleAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((c) => next.delete(c.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((c) => next.add(c.id));
        return next;
      });
    }
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Step 2: Compose ────────────────────────────────────────────────────────
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // ── Step 3: Results ────────────────────────────────────────────────────────
  const [results, setResults] = useState<SendResult[]>([]);
  const [summary, setSummary] = useState<{ sent: number; failed: number } | null>(null);

  async function handleSend() {
    if (!token || !subject.trim() || !body.trim() || selectedIds.size === 0) return;
    setSending(true);
    try {
      const data = await adminPost<{ sent: number; failed: number; results: SendResult[] }>(
        "/api/iroc/announcements/send",
        token,
        { customerIds: Array.from(selectedIds), subject: subject.trim(), body: body.trim() }
      );
      setResults(data.results ?? []);
      setSummary({ sent: data.sent ?? 0, failed: data.failed ?? 0 });
      setStep("results");
    } catch {
      // show inline error
    } finally {
      setSending(false);
    }
  }

  function resetAll() {
    setStep("pick");
    setSubject("");
    setBody("");
    setResults([]);
    setSummary(null);
    setSelectedIds(new Set());
  }

  // ── Render: Step indicator ─────────────────────────────────────────────────
  const steps: { key: Step; label: string }[] = [
    { key: "pick",    label: de ? "1. Empfänger wählen" : "1. Choose Recipients" },
    { key: "compose", label: de ? "2. E-Mail verfassen" : "2. Compose Email" },
    { key: "results", label: de ? "3. Ergebnis" : "3. Results" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Megaphone className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">
            {de ? "Ankündigungen" : "Announcements"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {de
              ? "Individuelle E-Mails an ausgewählte Kunden senden"
              : "Send individual emails to selected customers"}
          </p>
        </div>
      </div>

      {/* Step tabs */}
      <div className="flex gap-1 border-b pb-0">
        {steps.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => step !== "results" && key !== "results" && setStep(key)}
            disabled={key === "results" && step !== "results"}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              step === key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Step 1: Pick ── */}
      {step === "pick" && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={de ? "Suchen …" : "Search …"}
                className="pl-8"
              />
            </div>
            <select
              value={instrumentFilter}
              onChange={(e) => setInstrumentFilter(e.target.value)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">{de ? "Alle Instrumente" : "All instruments"}</option>
              {instruments.filter((i) => i !== "all").map((i) => (
                <option key={i} value={i}>{INSTRUMENT_LABELS[i] ?? i}</option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={toggleAll} disabled={loading || filtered.length === 0} className="h-7 gap-1.5 text-xs shrink-0">
              {allFilteredSelected ? (de ? "Auswahl aufheben" : "Deselect all") : (de ? "Alle auswählen" : "Select all")}
            </Button>
            {selectedIds.size > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Users className="w-3.5 h-3.5" />
                {selectedIds.size} {de ? "ausgewählt" : "selected"}
              </Badge>
            )}
          </div>

          {/* Table */}
          <div className="border rounded-xl sticky-header-table overflow-y-auto max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de ? "Name / Institution" : "Name / Institution"}</TableHead>
                  <TableHead>{de ? "E-Mail" : "Email"}</TableHead>
                  <TableHead>{de ? "Instrument" : "Instrument"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 3 }).map((_, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : filtered.length === 0
                  ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                        {de ? "Keine Kunden gefunden" : "No customers found"}
                      </TableCell>
                    </TableRow>
                  )
                  : filtered.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer hover:bg-muted/40"
                      data-state={selectedIds.has(c.id) ? "selected" : undefined}
                      onClick={() => toggleOne(c.id)}
                    >
                      <TableCell>
                        <div className="font-medium text-sm">
                          {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                        </div>
                        {c.institutionName && (
                          <div className="text-xs text-muted-foreground">{c.institutionName}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{c.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {INSTRUMENT_LABELS[c.instrument] ?? c.instrument}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => setStep("compose")}
              disabled={selectedIds.size === 0}
              className="gap-2"
            >
              <ChevronRight className="w-4 h-4" />
              {de ? `Weiter mit ${selectedIds.size} Empfänger${selectedIds.size !== 1 ? "n" : ""}` : `Continue with ${selectedIds.size} recipient${selectedIds.size !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Compose ── */}
      {step === "compose" && (
        <div className="space-y-5 max-w-2xl">
          {/* From / To summary */}
          <div className="bg-muted/40 border rounded-xl p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-16 text-muted-foreground font-medium shrink-0">
                {de ? "Von:" : "From:"}
              </span>
              <span className="font-mono">{fromEmail}</span>
              <Link href="/iroc-website/settings" className="ml-auto text-xs text-primary hover:underline flex items-center gap-1">
                <Settings className="w-3 h-3" />
                {de ? "Ändern" : "Change"}
              </Link>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-16 text-muted-foreground font-medium shrink-0 mt-0.5">
                {de ? "An:" : "To:"}
              </span>
              <div className="flex flex-wrap gap-1">
                {Array.from(selectedIds)
                  .slice(0, 6)
                  .map((id) => {
                    const c = customers.find((x) => x.id === id);
                    return c ? (
                      <Badge key={id} variant="secondary" className="text-xs font-normal">
                        {c.email}
                      </Badge>
                    ) : null;
                  })}
                {selectedIds.size > 6 && (
                  <Badge variant="secondary" className="text-xs font-normal">
                    +{selectedIds.size - 6} {de ? "weitere" : "more"}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Notice */}
          <div className="flex gap-2 text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-blue-500 mt-0.5" />
            {de
              ? `Jede E-Mail wird einzeln gesendet – kein Gruppen-Versand. ${selectedIds.size} E-Mail${selectedIds.size !== 1 ? "s werden" : " wird"} verschickt.`
              : `Each email is sent individually – no group sending. ${selectedIds.size} email${selectedIds.size !== 1 ? "s" : ""} will be sent.`}
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {de ? "Betreff" : "Subject"}
            </label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={de ? "z. B. Frohe Weihnachten von iROC" : "e.g. Season's Greetings from iROC"}
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {de ? "Nachricht" : "Message"}
            </label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder={de ? "Schreiben Sie hier Ihre Nachricht …" : "Write your message here …"}
              className="font-mono text-sm resize-y"
            />
            <p className="text-xs text-muted-foreground">
              {de ? "Reiner Text – keine HTML-Formatierung" : "Plain text – no HTML formatting"}
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep("pick")} className="gap-2">
              <ChevronLeft className="w-4 h-4" />
              {de ? "Zurück" : "Back"}
            </Button>
            <Button
              onClick={handleSend}
              disabled={!subject.trim() || !body.trim() || sending}
              className="gap-2"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending
                ? (de ? "Wird gesendet …" : "Sending …")
                : (de ? `${selectedIds.size} E-Mail${selectedIds.size !== 1 ? "s" : ""} senden` : `Send ${selectedIds.size} email${selectedIds.size !== 1 ? "s" : ""}`)}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Results ── */}
      {step === "results" && summary && (
        <div className="space-y-5 max-w-2xl">
          {/* Summary banner */}
          <div className={`rounded-xl border p-4 flex items-center gap-4 ${
            summary.failed === 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
          }`}>
            {summary.failed === 0 ? (
              <CheckCircle2 className="w-8 h-8 text-green-600 shrink-0" />
            ) : (
              <AlertCircle className="w-8 h-8 text-amber-600 shrink-0" />
            )}
            <div>
              <p className="font-semibold">
                {summary.failed === 0
                  ? (de ? "Alle E-Mails erfolgreich gesendet" : "All emails sent successfully")
                  : (de ? "Einige E-Mails konnten nicht gesendet werden" : "Some emails failed to send")}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                <span className="text-green-700 font-medium">{summary.sent}</span>
                {de ? " gesendet" : " sent"}
                {summary.failed > 0 && (
                  <> · <span className="text-red-600 font-medium">{summary.failed}</span>
                  {de ? " fehlgeschlagen" : " failed"}</>
                )}
              </p>
            </div>
          </div>

          {/* Per-recipient table */}
          <div className="border rounded-xl sticky-header-table overflow-y-auto max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de ? "E-Mail" : "Email"}</TableHead>
                  <TableHead>{de ? "Status" : "Status"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.customerId}>
                    <TableCell className="font-mono text-sm">{r.email}</TableCell>
                    <TableCell>
                      {r.status === "sent" ? (
                        <span className="flex items-center gap-1.5 text-green-700 text-sm">
                          <CheckCircle2 className="w-4 h-4" />
                          {de ? "Gesendet" : "Sent"}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-red-600 text-sm">
                          <XCircle className="w-4 h-4" />
                          {de ? "Fehler" : "Failed"}
                          {r.error && <span className="text-xs text-muted-foreground">({r.error})</span>}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Button variant="outline" onClick={resetAll} className="gap-2">
            <Mail className="w-4 h-4" />
            {de ? "Neue Ankündigung" : "New Announcement"}
          </Button>
        </div>
      )}
    </div>
  );
}
