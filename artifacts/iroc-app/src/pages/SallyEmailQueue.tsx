import { useState, useEffect } from 'react';
import { useSearchParams } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminGet, adminPost, adminPut, adminRequest } from '@/lib/admin-fetch';
import {
  SALLY_EMAIL_QUEUE_KEY,
  SALLY_RECONCILIATION_ACTORS_KEY,
  SALLY_RECONCILIATION_HISTORY_KEY,
} from '@/lib/query-keys';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Mail, CheckCircle2, X, Eye, Reply, Languages, Pencil, Trash2, RotateCw,
  AlertTriangle, ShieldCheck, Download,
} from 'lucide-react';

interface QueueItem {
  id: number;
  recipient_email: string;
  subject: string;
  body: string;
  trigger_type: string;
  status: 'pending' | 'sent' | 'cancelled';
  related_lead_id: number | null;
  related_doctor_id: number | null;
  related_order_id: number | null;
  created_at: string;
  // Threading / reply fields
  message_id: string | null;
  in_reply_to: string | null;
  detected_language: string | null;
  detected_formality: 'formal' | 'informal' | null;
  inbound_from: string | null;
  inbound_body: string | null;
  escalation_forward_status: 'forwarding' | 'unconfirmed' | 'resending' | 'succeeded' | 'confirmed' | 'failed' | null;
}

interface ReconciliationAudit {
  id: number;
  queue_item_id: number;
  action: string;
  previous_status: string | null;
  resulting_status: string | null;
  actor: string;
  acknowledged_duplicate_risk: boolean;
  created_at: string;
}

type Filter = 'pending' | 'sent' | 'cancelled' | 'all';
type ReconciliationOutcome = 'all' | 'unresolved' | 'confirmed' | 'succeeded' | 'failed' | 'handled';

function isFilter(value: string | null): value is Filter {
  return value === 'pending' || value === 'sent' || value === 'cancelled' || value === 'all';
}

function isReconciliationOutcome(value: string | null): value is ReconciliationOutcome {
  return value === 'all' || value === 'unresolved' || value === 'confirmed' ||
    value === 'succeeded' || value === 'failed' || value === 'handled';
}

const TRIGGER_LABELS: Record<string, { de: string; en: string; color: string }> = {
  first_contact:      { de: 'Erstkontakt',          en: 'First Contact',      color: 'bg-blue-100 text-blue-800' },
  '4_week_followup':  { de: '4-Wochen Follow-up',   en: '4-Week Follow-up',   color: 'bg-purple-100 text-purple-800' },
  '2_month_reminder': { de: '2-Monats-Erinnerung',  en: '2-Month Reminder',   color: 'bg-indigo-100 text-indigo-800' },
  doctor_checkin:     { de: 'Arzt Check-in',         en: 'Doctor Check-in',    color: 'bg-teal-100 text-teal-800' },
  doctor_promo:       { de: '6-Monats-Promo',        en: '6-Month Promo',      color: 'bg-amber-100 text-amber-800' },
  inbound_reply:      { de: 'Antwort-Entwurf',       en: 'Reply Draft',        color: 'bg-rose-100 text-rose-800' },
  order_missing_info: { de: 'Bestellung: Rückfrage', en: 'Order: Missing Info', color: 'bg-orange-100 text-orange-800' },
  invoice_dispatch:   { de: 'Versandbestätigung',    en: 'Dispatch Notice',     color: 'bg-emerald-100 text-emerald-800' },
  invoice_dispatch_shipping: { de: 'Versandbestätigung (Lieferadresse)', en: 'Dispatch Notice (Shipping)', color: 'bg-emerald-100 text-emerald-800' },
};

const STATUS_LABELS: Record<string, { de: string; en: string }> = {
  pending:   { de: 'Ausstehend',  en: 'Pending' },
  sent:      { de: 'Gesendet',    en: 'Sent' },
  cancelled: { de: 'Abgebrochen', en: 'Cancelled' },
};

const RECONCILIATION_ACTION_LABELS: Record<string, { de: string; en: string }> = {
  confirm_delivery:   { de: 'Zustellung bestätigt', en: 'Delivery confirmed' },
  confirm_conflict:   { de: 'Bestätigung abgelehnt', en: 'Confirmation conflict' },
  resend_requested:   { de: 'Erneuter Versand angefordert', en: 'Resend requested' },
  resend_succeeded:   { de: 'Erneuter Versand erfolgreich', en: 'Resend succeeded' },
  resend_failed:      { de: 'Erneuter Versand fehlgeschlagen', en: 'Resend failed' },
  resend_unconfirmed: { de: 'Erneuter Versand unbestätigt', en: 'Resend remains unconfirmed' },
  resend_conflict:    { de: 'Erneuter Versand abgelehnt', en: 'Resend conflict' },
  retry_succeeded:    { de: 'Wiederholungsversuch erfolgreich', en: 'Retry succeeded' },
  retry_failed:       { de: 'Wiederholungsversuch fehlgeschlagen', en: 'Retry failed' },
  retry_unconfirmed:  { de: 'Wiederholungsversuch unbestätigt', en: 'Retry remains unconfirmed' },
};

const RECONCILIATION_STATUS_LABELS: Record<string, { de: string; en: string }> = {
  forwarding:  { de: 'Weiterleitung läuft', en: 'Forwarding' },
  unconfirmed: { de: 'Unbestätigt', en: 'Unconfirmed' },
  resending:   { de: 'Erneuter Versand läuft', en: 'Resending' },
  succeeded:   { de: 'Erfolgreich', en: 'Succeeded' },
  confirmed:   { de: 'Bestätigt', en: 'Confirmed' },
  failed:      { de: 'Fehlgeschlagen', en: 'Failed' },
};

const LANG_NAMES: Record<string, string> = {
  de: 'DE', en: 'EN', fr: 'FR', es: 'ES', it: 'IT', nl: 'NL',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function SallyEmailQueue() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const reconciliationOutcomeParam = searchParams.get('reconciliationOutcome');
  const filter: Filter = isFilter(statusParam) ? statusParam : 'pending';
  const reconciliationOutcome: ReconciliationOutcome =
    isReconciliationOutcome(reconciliationOutcomeParam)
      ? reconciliationOutcomeParam
      : 'all';
  const actorParam = searchParams.get('reconciliationActor');
  const normalizedActor = actorParam?.trim() ?? '';
  const actorParamValid = actorParam === null ||
    (normalizedActor.length <= 200 && !/[\u0000-\u001f\u007f]/.test(actorParam));
  const reconciliationActor = actorParamValid
    ? normalizedActor
    : '';
  const [preview, setPreview] = useState<QueueItem | null>(null);
  const [showInbound, setShowInbound] = useState(false);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody]       = useState('');
  const [isExportingHistory, setIsExportingHistory] = useState(false);

  // Row selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [bulkExporting, setBulkExporting] = useState(false);

  const updateQueueFilters = (updates: {
    status?: Filter;
    reconciliationOutcome?: ReconciliationOutcome;
    reconciliationActor?: string;
  }) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);

      if ('status' in updates) {
        if (updates.status && updates.status !== 'pending') next.set('status', updates.status);
        else next.delete('status');
      }
      if ('reconciliationOutcome' in updates) {
        if (updates.reconciliationOutcome && updates.reconciliationOutcome !== 'all') {
          next.set('reconciliationOutcome', updates.reconciliationOutcome);
        } else {
          next.delete('reconciliationOutcome');
        }
      }
      if ('reconciliationActor' in updates) {
        const actor = updates.reconciliationActor?.trim() ?? '';
        if (actor) next.set('reconciliationActor', actor);
        else next.delete('reconciliationActor');
      }

      return next;
    });
  };

  // Shared links are untrusted input. Canonicalize unsupported values before
  // they can reach the API or leave the controls showing a misleading state.
  useEffect(() => {
    if ((statusParam && !isFilter(statusParam)) ||
        (reconciliationOutcomeParam && !isReconciliationOutcome(reconciliationOutcomeParam)) ||
        !actorParamValid) {
      setSearchParams(current => {
        const next = new URLSearchParams(current);
        if (statusParam && !isFilter(statusParam)) next.delete('status');
        if (reconciliationOutcomeParam && !isReconciliationOutcome(reconciliationOutcomeParam)) {
          next.delete('reconciliationOutcome');
        }
        if (!actorParamValid) {
          next.delete('reconciliationActor');
        }
        return next;
      }, { replace: true });
    }
  }, [actorParamValid, reconciliationOutcomeParam, setSearchParams, statusParam]);

  // Clear selection when filter changes
  useEffect(() => { setSelectedIds(new Set()); }, [filter, reconciliationOutcome, reconciliationActor]);

  // Sync edit fields whenever the preview item changes
  useEffect(() => {
    if (preview) {
      setEditSubject(preview.subject);
      setEditBody(preview.body);
    }
  }, [preview]);

  const { data: emails = [], isLoading, isError: isQueueError, refetch: refetchQueue } = useQuery<QueueItem[]>({
    queryKey: [...SALLY_EMAIL_QUEUE_KEY, filter, reconciliationOutcome, reconciliationActor],
    queryFn: () => {
      const params = new URLSearchParams({ status: filter });
      if (reconciliationOutcome !== 'all') {
        params.set('reconciliationOutcome', reconciliationOutcome);
      }
      if (reconciliationActor.trim()) {
        params.set('reconciliationActor', reconciliationActor.trim());
      }
      return adminGet(`/api/admin/sally/email-queue?${params.toString()}`, token!);
    },
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const { data: reconciliationActorsData, isLoading: areReconciliationActorsLoading } = useQuery<string[]>({
    queryKey: SALLY_RECONCILIATION_ACTORS_KEY,
    queryFn: () => adminGet('/api/admin/sally/email-queue/reconciliation-actors', token!),
    enabled: !!token,
    refetchInterval: 30_000,
  });
  const reconciliationActors = (reconciliationActorsData ?? [])
    .filter((actor): actor is string => typeof actor === 'string' && actor.trim().length > 0)
    .map(actor => actor.trim());
  const actorOptions = reconciliationActor &&
    !reconciliationActors.some(actor => actor === reconciliationActor)
    ? [reconciliationActor, ...reconciliationActors]
    : reconciliationActors;

  const { data: reconciliationHistory = [], isLoading: isHistoryLoading } = useQuery<ReconciliationAudit[]>({
    queryKey: [...SALLY_RECONCILIATION_HISTORY_KEY, preview?.id],
    queryFn: () => adminGet(`/api/admin/sally/email-queue/${preview!.id}/reconciliation-history`, token!),
    enabled: !!token && preview?.trigger_type === 'inbound_reply',
    refetchInterval: preview?.trigger_type === 'inbound_reply' ? 30_000 : false,
  });

  const handleExportReconciliationHistory = async () => {
    if (!token || !preview || isExportingHistory) return;
    setIsExportingHistory(true);
    try {
      const response = await adminRequest(
        `/api/admin/sally/email-queue/${preview.id}/reconciliation-history/export`,
        token,
      );
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sally-reconciliation-${preview.id}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({
        title: lang === 'de' ? 'Abgleichverlauf exportiert' : 'Reconciliation history exported',
      });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : (lang === 'de' ? 'Export fehlgeschlagen' : 'Export failed'),
        variant: 'destructive',
      });
    } finally {
      setIsExportingHistory(false);
    }
  };

  const toggleSelect = (id: number) =>
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const allSelected = emails.length > 0 && emails.every(e => selectedIds.has(e.id));
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(emails.map(e => e.id)));

  // How many selected are still pending (eligible to cancel)
  const selectedPending = emails.filter(e => selectedIds.has(e.id) && e.status === 'pending');

  const handleBulkCancel = async () => {
    if (!token || selectedPending.length === 0) return;
    const msg = lang === 'de'
      ? `${selectedPending.length} E-Mail${selectedPending.length !== 1 ? 's' : ''} wirklich abbrechen?`
      : `Cancel ${selectedPending.length} email${selectedPending.length !== 1 ? 's' : ''}?`;
    if (!confirm(msg)) return;
    setBulkCancelling(true);
    try {
      await Promise.all(
        selectedPending.map(e => adminPost(`/api/admin/sally/email-queue/${e.id}/cancel`, token!, {}))
      );
      qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY });
      setSelectedIds(new Set());
      toast({ title: lang === 'de' ? 'E-Mails abgebrochen' : 'Emails cancelled' });
    } catch {
      toast({ title: lang === 'de' ? 'Fehler' : 'Error', variant: 'destructive' });
    } finally {
      setBulkCancelling(false);
    }
  };

  const handleBulkExport = async () => {
    if (!token || selectedIds.size === 0 || selectedIds.size > 50) return;
    setBulkExporting(true);
    try {
      const response = await adminRequest(
        '/api/admin/sally/email-queue/reconciliation-history/export',
        token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [...selectedIds] }),
        },
      );
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'sally-reconciliation-export.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({ title: lang === 'de' ? 'Abgleichverläufe exportiert' : 'Reconciliation histories exported' });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : (lang === 'de' ? 'Export fehlgeschlagen' : 'Export failed'),
        variant: 'destructive',
      });
    } finally {
      setBulkExporting(false);
    }
  };

  const approveMut = useMutation({
    mutationFn: (id: number) => adminPost(`/api/admin/sally/email-queue/${id}/approve`, token!, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY });
      setPreview(null);
      toast({ title: lang === 'de' ? 'E-Mail gesendet' : 'Email sent' });
    },
    onError: (err: Error) => toast({ title: err.message, variant: 'destructive' }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) => adminPost(`/api/admin/sally/email-queue/${id}/cancel`, token!, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY });
      setPreview(null);
      toast({ title: lang === 'de' ? 'E-Mail abgebrochen' : 'Email cancelled' });
    },
    onError: () => toast({ title: lang === 'de' ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const retryEscalationMut = useMutation({
    mutationFn: (id: number) => adminPost(`/api/admin/sally/email-queue/${id}/retry-escalation`, token!, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY });
      qc.refetchQueries({ queryKey: SALLY_RECONCILIATION_ACTORS_KEY });
      setPreview(null);
      toast({ title: lang === 'de' ? 'Eskalation weitergeleitet' : 'Escalation forwarded' });
    },
    onError: (err: Error) => toast({ title: err.message, variant: 'destructive' }),
  });

  const confirmEscalationMut = useMutation({
    mutationFn: (id: number) =>
      adminPost(`/api/admin/sally/email-queue/${id}/confirm-escalation`, token!, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY });
      qc.refetchQueries({ queryKey: SALLY_RECONCILIATION_ACTORS_KEY });
      setPreview(null);
      toast({ title: lang === 'de' ? 'Zustellung bestätigt' : 'Delivery confirmed' });
    },
    onError: (err: Error) => toast({ title: err.message, variant: 'destructive' }),
  });

  const resendEscalationMut = useMutation({
    mutationFn: (id: number) =>
      adminPost(`/api/admin/sally/email-queue/${id}/resend-escalation`, token!, {
        acknowledgeDuplicateRisk: true,
      }),
    onSuccess: (result: { escalationForwardStatus?: string }) => {
      qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY });
      qc.refetchQueries({ queryKey: SALLY_RECONCILIATION_ACTORS_KEY });
      setPreview(null);
      toast({
        title: result?.escalationForwardStatus === 'succeeded'
          ? (lang === 'de' ? 'Eskalation erneut gesendet' : 'Escalation resent')
          : (lang === 'de' ? 'Zustellung bleibt unbestätigt' : 'Delivery remains unconfirmed'),
      });
    },
    onError: (err: Error) => toast({ title: err.message, variant: 'destructive' }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, subject, body }: { id: number; subject: string; body: string }) =>
      adminPut(`/api/admin/sally/email-queue/${id}`, token!, { subject, body }),
    onSuccess: (updated: QueueItem) => {
      qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY });
      setPreview(prev => prev ? { ...prev, subject: updated.subject, body: updated.body } : prev);
      toast({ title: lang === 'de' ? 'Entwurf gespeichert' : 'Draft saved' });
    },
    onError: (err: Error) => toast({ title: err.message, variant: 'destructive' }),
  });

  // Save edits then approve in one go
  const handleApproveWithEdits = async (item: QueueItem) => {
    if (!editSubject.trim() || !editBody.trim()) return;

    const subjectChanged = editSubject !== item.subject;
    const bodyChanged    = editBody    !== item.body;
    if (subjectChanged || bodyChanged) {
      await updateMut.mutateAsync({ id: item.id, subject: editSubject, body: editBody });
    }
    approveMut.mutate(item.id);
  };

  const pendingCount = emails.filter(e => e.status === 'pending').length;
  const replyCount   = emails.filter(e => e.trigger_type === 'inbound_reply' && e.status === 'pending').length;
  const unconfirmedCount = emails.filter(e =>
    e.trigger_type === 'inbound_reply' &&
    (e.escalation_forward_status === 'forwarding' ||
      e.escalation_forward_status === 'unconfirmed' ||
      e.escalation_forward_status === 'resending'),
  ).length;

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'pending',   label: lang === 'de' ? 'Ausstehend' : 'Pending' },
    { key: 'sent',      label: lang === 'de' ? 'Gesendet' : 'Sent' },
    { key: 'cancelled', label: lang === 'de' ? 'Abgebrochen' : 'Cancelled' },
    { key: 'all',       label: lang === 'de' ? 'Alle' : 'All' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <Mail className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {lang === 'de' ? 'Sally – E-Mail-Freigabe' : 'Sally – Email Approval'}
            {pendingCount > 0 && filter === 'pending' && (
              <Badge className="bg-primary text-primary-foreground">{pendingCount}</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Genehmigen oder ablehnen Sie von Sally generierte E-Mails, bevor sie versendet werden.'
              : "Approve or cancel Sally's queued emails before they are sent."}
          </p>
        </div>
      </div>

      {/* Inbound reply alert */}
      {replyCount > 0 && filter === 'pending' && (
        <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm">
          <Reply className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="text-rose-800 font-medium">
            {lang === 'de'
              ? `${replyCount} eingehende Antwort${replyCount > 1 ? 'en' : ''} – KI-Entwurf zur Genehmigung bereit`
              : `${replyCount} inbound ${replyCount > 1 ? 'replies' : 'reply'} — AI draft ready for approval`}
          </span>
        </div>
      )}

      {unconfirmedCount > 0 && filter === 'pending' && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-amber-900">
            <p className="font-medium">
              {lang === 'de'
                ? `${unconfirmedCount} Eskalation${unconfirmedCount === 1 ? '' : 'en'} mit unbestätigter Zustellung`
                : `${unconfirmedCount} escalation${unconfirmedCount === 1 ? '' : 's'} with unconfirmed delivery`}
            </p>
            <p className="text-xs mt-0.5">
              {lang === 'de'
                ? 'Der Versanddienst kann die Nachricht angenommen haben. Prüfen Sie zuerst das Kundenservice-Postfach; erneut senden ist nur nach ausdrücklicher Bestätigung des Duplikatrisikos möglich.'
                : 'The mail provider may have accepted the message. Check the customer-service mailbox first; resending is available only after explicitly acknowledging the duplicate-delivery risk.'}
            </p>
          </div>
        </div>
      )}

      {isQueueError && (
        <div role="alert" className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            {lang === 'de'
              ? 'Die Warteschlange konnte nicht aktualisiert werden. Bereits sichtbare Warnungen bleiben erhalten.'
              : 'The queue could not be refreshed. Existing warnings remain visible.'}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetchQueue()}>
            <RotateCw className="mr-1.5 h-3.5 w-3.5" />
            {lang === 'de' ? 'Erneut versuchen' : 'Retry'}
          </Button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => updateQueueFilters({ status: f.key })}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === f.key ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* History-aware reconciliation filters */}
      <div className="flex items-end gap-3 flex-wrap rounded-lg border bg-card px-4 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="sally-reconciliation-outcome" className="text-xs text-muted-foreground">
            {lang === 'de' ? 'Zustellungsabgleich' : 'Delivery reconciliation'}
          </Label>
          <select
            id="sally-reconciliation-outcome"
            aria-label={lang === 'de' ? 'Zustellungsabgleich' : 'Delivery reconciliation'}
            value={reconciliationOutcome}
            onChange={event => updateQueueFilters({
              reconciliationOutcome: event.target.value as ReconciliationOutcome,
            })}
            className="h-9 min-w-44 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">{lang === 'de' ? 'Alle Ergebnisse' : 'All outcomes'}</option>
            <option value="unresolved">{lang === 'de' ? 'Ungeklärt' : 'Unresolved'}</option>
            <option value="confirmed">{lang === 'de' ? 'Bestätigt' : 'Confirmed'}</option>
            <option value="succeeded">{lang === 'de' ? 'Erfolgreich' : 'Succeeded'}</option>
            <option value="failed">{lang === 'de' ? 'Fehlgeschlagen' : 'Failed'}</option>
            <option value="handled">{lang === 'de' ? 'Bereits bearbeitet' : 'Previously handled'}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sally-reconciliation-actor" className="text-xs text-muted-foreground">
            {lang === 'de' ? 'Akteur aus dem Abgleichverlauf' : 'Actor from reconciliation history'}
          </Label>
          <select
            id="sally-reconciliation-actor"
            aria-label={lang === 'de' ? 'Akteur aus dem Abgleichverlauf' : 'Actor from reconciliation history'}
            value={reconciliationActor}
            onChange={event => updateQueueFilters({ reconciliationActor: event.target.value })}
            className="h-9 min-w-56 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{lang === 'de' ? 'Alle Akteure' : 'All actors'}</option>
            {actorOptions.length > 0 ? (
              actorOptions.map(actor => <option key={actor} value={actor}>{actor}</option>)
            ) : (
              <option value="__none" disabled>
                {lang === 'de' ? 'Keine Akteure im Abgleichverlauf' : 'No actors in reconciliation history'}
              </option>
            )}
          </select>
          <p className="text-[11px] text-muted-foreground">
            {areReconciliationActorsLoading
              ? (lang === 'de' ? 'Akteure werden geladen…' : 'Loading actors…')
              : actorOptions.length > 0
                ? (lang === 'de'
                  ? 'Wählen Sie einen Akteur aus dem bisherigen Abgleichverlauf.'
                  : 'Choose an actor from the existing reconciliation history.')
                : (lang === 'de'
                  ? 'Noch keine Akteure im Abgleichverlauf vorhanden.'
                  : 'No reconciliation actors have been recorded yet.')}
          </p>
        </div>
        {(reconciliationOutcome !== 'all' || reconciliationActor) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => {
              updateQueueFilters({
                reconciliationOutcome: 'all',
                reconciliationActor: '',
              });
            }}
          >
            {lang === 'de' ? 'Filter zurücksetzen' : 'Clear filters'}
          </Button>
        )}
      </div>

      {/* Selection toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="sm" onClick={toggleAll} disabled={emails.length === 0} className="h-7 gap-1.5 text-xs">
          {allSelected
            ? (lang === 'de' ? 'Auswahl aufheben' : 'Deselect all')
            : (lang === 'de' ? 'Alle auswählen' : 'Select all')}
        </Button>

        {selectedIds.size > 0 && (
          <>
            <span className="text-sm text-muted-foreground">
              {selectedIds.size} {lang === 'de' ? 'ausgewählt' : 'selected'}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkExporting || selectedIds.size > 50}
              onClick={handleBulkExport}
              className="h-7 gap-1.5"
              aria-label={lang === 'de' ? 'Ausgewählte Abgleichverläufe exportieren' : 'Export selected reconciliation histories'}
            >
              <Download className="h-3.5 w-3.5" />
              {bulkExporting
                ? (lang === 'de' ? 'Export läuft…' : 'Exporting…')
                : (lang === 'de' ? 'Abgleich exportieren' : 'Export reconciliation')}
            </Button>
            {selectedPending.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={bulkCancelling}
                onClick={handleBulkCancel}
                className="gap-1.5 h-7 text-destructive border-destructive/40 hover:bg-destructive/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {bulkCancelling
                  ? (lang === 'de' ? 'Breche ab…' : 'Cancelling…')
                  : `${lang === 'de' ? 'Abbrechen' : 'Cancel'} (${selectedPending.length})`}
              </Button>
            )}
          </>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{lang === 'de' ? 'Empfänger' : 'Recipient'}</TableHead>
                <TableHead>{lang === 'de' ? 'Betreff' : 'Subject'}</TableHead>
                <TableHead>{lang === 'de' ? 'Typ' : 'Type'}</TableHead>
                <TableHead>{lang === 'de' ? 'Status' : 'Status'}</TableHead>
                <TableHead>{lang === 'de' ? 'Erstellt' : 'Created'}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    {lang === 'de' ? 'Laden…' : 'Loading…'}
                  </TableCell>
                </TableRow>
              ) : emails.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                    <Mail className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">
                      {filter === 'pending'
                        ? (lang === 'de' ? 'Keine ausstehenden E-Mails' : 'No pending emails')
                        : (lang === 'de' ? 'Keine E-Mails gefunden' : 'No emails found')}
                    </p>
                    {filter === 'pending' && (
                      <p className="text-xs mt-1">
                        {lang === 'de'
                          ? 'Sally generiert automatisch E-Mails basierend auf Lead-Aktivitäten.'
                          : 'Sally generates emails automatically based on lead activity.'}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ) : emails.map(email => {
                const trig = TRIGGER_LABELS[email.trigger_type]
                  ?? { de: email.trigger_type, en: email.trigger_type, color: 'bg-gray-100 text-gray-800' };
                const isReply = email.trigger_type === 'inbound_reply';
                const isSelected = selectedIds.has(email.id);

                return (
                  <TableRow
                    key={email.id}
                    data-state={isSelected ? 'selected' : undefined}
                    className={`cursor-pointer transition-colors ${isReply && !isSelected ? 'bg-rose-50/40' : ''}`}
                    onClick={() => toggleSelect(email.id)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleSelect(email.id);
                      }
                    }}
                    tabIndex={0}
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={`${email.recipient_email}: ${email.subject}`}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {isReply && <Reply className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                        <span>{email.recipient_email}</span>
                      </div>
                      {isReply && email.inbound_from && email.inbound_from !== email.recipient_email && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          ← {email.inbound_from}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="line-clamp-1">{email.subject}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${trig.color}`}>
                          {lang === 'de' ? trig.de : trig.en}
                        </span>
                        {isReply && email.detected_language && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-700">
                            <Languages className="w-3 h-3" />
                            {LANG_NAMES[email.detected_language] ?? email.detected_language.toUpperCase()}
                          </span>
                        )}
                        {isReply && email.detected_formality && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-700">
                            {email.detected_formality === 'formal'
                              ? (lang === 'de' ? 'Formell' : 'Formal')
                              : (lang === 'de' ? 'Informell' : 'Informal')}
                          </span>
                        )}
                        {email.escalation_forward_status === 'failed' && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700">
                            {lang === 'de' ? 'Eskalation fehlgeschlagen' : 'Escalation failed'}
                          </span>
                        )}
                        {(email.escalation_forward_status === 'forwarding' ||
                          email.escalation_forward_status === 'unconfirmed' ||
                          email.escalation_forward_status === 'resending') && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800">
                            {email.escalation_forward_status === 'resending'
                              ? (lang === 'de' ? 'Erneuter Versand läuft – manuell prüfen' : 'Resend in progress — review manually')
                              : (lang === 'de' ? 'Weiterleitung unbestätigt – manuell prüfen' : 'Forwarding unconfirmed — review manually')}
                          </span>
                        )}
                        {email.escalation_forward_status === 'confirmed' && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-800">
                            {lang === 'de' ? 'Zustellung bestätigt' : 'Delivery confirmed'}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={email.status === 'sent' ? 'default' : email.status === 'cancelled' ? 'destructive' : 'secondary'}
                        className={email.status === 'sent' ? 'bg-green-100 text-green-800' : ''}>
                        {lang === 'de' ? STATUS_LABELS[email.status]?.de : STATUS_LABELS[email.status]?.en}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(email.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 justify-end">
                        {/* View / preview */}
                        <Button
                          size="sm" variant="ghost"
                          onClick={e => { e.stopPropagation(); setPreview(email); setShowInbound(false); }}
                          title={lang === 'de' ? 'Vorschau' : 'Preview'}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {/* Send (approve) — per-row, only for pending */}
                        {email.status === 'pending' && (
                          <Button
                            size="sm" variant="default"
                            className="gap-1 bg-green-600 hover:bg-green-700"
                            onClick={e => { e.stopPropagation(); approveMut.mutate(email.id); }}
                            disabled={approveMut.isPending}
                            title={lang === 'de' ? 'Senden' : 'Send'}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {lang === 'de' ? 'Senden' : 'Send'}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Preview dialog */}
      <Dialog open={!!preview} onOpenChange={open => !open && setPreview(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {preview?.trigger_type === 'inbound_reply'
                ? <Reply className="w-5 h-5 text-rose-500" />
                : <Mail className="w-5 h-5" />}
              {preview?.trigger_type === 'inbound_reply'
                ? (lang === 'de' ? 'Antwort-Entwurf (KI)' : 'Reply Draft (AI)')
                : (lang === 'de' ? 'E-Mail Vorschau' : 'Email Preview')}
            </DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4">
              {/* Meta */}
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <span className="text-muted-foreground font-medium">{lang === 'de' ? 'An:' : 'To:'}</span>
                <span>{preview.recipient_email}</span>

                {preview.trigger_type === 'inbound_reply' && preview.detected_language && (
                  <>
                    <span className="text-muted-foreground font-medium">{lang === 'de' ? 'Erkannt:' : 'Detected:'}</span>
                    <span className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100">
                        {(LANG_NAMES[preview.detected_language] ?? preview.detected_language.toUpperCase())}
                      </span>
                      {preview.detected_formality && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100">
                          {preview.detected_formality === 'formal'
                            ? (lang === 'de' ? 'Formell' : 'Formal')
                            : (lang === 'de' ? 'Informell' : 'Informal')}
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>

              {/* Editable subject + body for pending inbound reply drafts; read-only for everything else */}
              {['inbound_reply', 'order_missing_info'].includes(preview.trigger_type) && preview.status === 'pending' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">
                    <Pencil className="w-3.5 h-3.5 shrink-0" />
                    {lang === 'de'
                      ? 'KI-Entwurf – Sie können Betreff und Text vor dem Senden bearbeiten.'
                      : 'AI draft — you can edit the subject and body before sending.'}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{lang === 'de' ? 'Betreff' : 'Subject'}</Label>
                    <Input
                      value={editSubject}
                      onChange={e => setEditSubject(e.target.value)}
                       aria-invalid={!editSubject.trim()}
                       required
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{lang === 'de' ? 'Nachricht' : 'Body'}</Label>
                    <Textarea
                      value={editBody}
                      onChange={e => setEditBody(e.target.value)}
                       aria-invalid={!editBody.trim()}
                       required
                      rows={10}
                      className="text-sm font-mono leading-relaxed resize-y"
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground font-medium">{lang === 'de' ? 'Betreff:' : 'Subject:'}</span>
                    <span className="font-medium">{preview.subject}</span>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-4">
                    <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{preview.body}</pre>
                  </div>
                </>
              )}

              {/* Original inbound message (for reply drafts) */}
              {preview.trigger_type === 'inbound_reply' && preview.inbound_body && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowInbound(v => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 mb-2">
                    <Reply className="w-3.5 h-3.5" />
                    {showInbound
                      ? (lang === 'de' ? 'Original-E-Mail ausblenden' : 'Hide original email')
                      : (lang === 'de' ? 'Original-E-Mail anzeigen' : 'Show original email')}
                  </button>
                  {showInbound && (
                    <div className="bg-rose-50 border border-rose-100 rounded-lg p-4">
                      <p className="text-xs font-medium text-rose-700 mb-2">
                        {lang === 'de' ? `Von: ${preview.inbound_from}` : `From: ${preview.inbound_from}`}
                      </p>
                      <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed text-muted-foreground max-h-48 overflow-y-auto">
                        {preview.inbound_body}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {preview.trigger_type === 'inbound_reply' && (
                <div className="rounded-lg border bg-slate-50/60 px-3 py-3">
                  <div className="flex items-center gap-2 mb-3">
                    <ShieldCheck className="w-4 h-4 text-slate-600" />
                    <h3 className="text-sm font-medium">
                      {lang === 'de' ? 'Abgleichverlauf' : 'Reconciliation history'}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {lang === 'de' ? '(Nur Lesen)' : '(Read-only)'}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 gap-1.5 text-xs"
                      onClick={handleExportReconciliationHistory}
                      disabled={isHistoryLoading || isExportingHistory}
                      title={lang === 'de'
                        ? 'Lieferkontext und Abgleichverlauf exportieren'
                        : 'Export delivery context and reconciliation history'}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {isExportingHistory
                        ? (lang === 'de' ? 'Export läuft…' : 'Exporting…')
                        : (lang === 'de' ? 'Kontext exportieren' : 'Export context')}
                    </Button>
                  </div>
                  {isHistoryLoading ? (
                    <p className="text-xs text-muted-foreground">
                      {lang === 'de' ? 'Verlauf wird geladen…' : 'Loading history…'}
                    </p>
                  ) : reconciliationHistory.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {lang === 'de' ? 'Noch keine Abgleichaktionen.' : 'No reconciliation actions yet.'}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {reconciliationHistory.map(entry => {
                        const action = RECONCILIATION_ACTION_LABELS[entry.action]
                          ?? { de: entry.action, en: entry.action };
                        const previous = entry.previous_status
                          ? (RECONCILIATION_STATUS_LABELS[entry.previous_status]?.[lang === 'de' ? 'de' : 'en'] ?? entry.previous_status)
                          : '—';
                        const resulting = entry.resulting_status
                          ? (RECONCILIATION_STATUS_LABELS[entry.resulting_status]?.[lang === 'de' ? 'de' : 'en'] ?? entry.resulting_status)
                          : '—';
                        return (
                          <div key={entry.id} className="border-t pt-2 first:border-t-0 first:pt-0">
                            <div className="flex items-start justify-between gap-3 text-sm">
                              <span className="font-medium">
                                {lang === 'de' ? action.de : action.en}
                              </span>
                              <time className="shrink-0 text-xs text-muted-foreground" dateTime={entry.created_at}>
                                {formatDate(entry.created_at)}
                              </time>
                            </div>
                            <div className="mt-1 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                              <span>
                                {lang === 'de' ? 'Akteur: ' : 'Actor: '}
                                <strong className="font-medium text-foreground">{entry.actor}</strong>
                              </span>
                              <span>
                                {lang === 'de' ? 'Status: ' : 'Status: '}
                                <strong className="font-medium text-foreground">{previous} → {resulting}</strong>
                              </span>
                              <span>
                                {lang === 'de' ? 'Duplikatrisiko: ' : 'Duplicate risk: '}
                                <strong className="font-medium text-foreground">
                                  {entry.acknowledged_duplicate_risk
                                    ? (lang === 'de' ? 'Bestätigt' : 'Acknowledged')
                                    : (lang === 'de' ? 'Nicht erforderlich' : 'Not required')}
                                </strong>
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {preview.trigger_type === 'inbound_reply' &&
                (preview.escalation_forward_status === 'forwarding' ||
                  preview.escalation_forward_status === 'unconfirmed' ||
                  preview.escalation_forward_status === 'resending') && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">
                      {lang === 'de' ? 'Zustellung unbestätigt' : 'Delivery unconfirmed'}
                    </p>
                    <p className="text-xs mt-1 leading-relaxed">
                      {lang === 'de'
                        ? 'Die Eskalations-E-Mail kann bereits angenommen worden sein, aber der abschließende Status wurde nicht sicher gespeichert. Prüfen Sie das Kundenservice-Postfach, bevor Sie eine Aktion wählen.'
                        : 'The escalation email may already have been accepted, but its final status was not safely recorded. Check the customer-service mailbox before choosing an action.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Actions */}
              {(preview.status === 'pending' ||
                (preview.trigger_type === 'inbound_reply' &&
                  (preview.escalation_forward_status === 'forwarding' ||
                    preview.escalation_forward_status === 'unconfirmed'))) && (
                <div className="flex gap-2 justify-end pt-2 border-t">
                  {preview.status === 'pending' && (
                    <Button
                      variant="outline"
                      className="gap-1.5 text-destructive border-destructive hover:bg-destructive/10"
                      onClick={() => { if (confirm(lang === 'de' ? 'E-Mail abbrechen?' : 'Cancel email?')) cancelMut.mutate(preview.id); }}
                      disabled={cancelMut.isPending || updateMut.isPending}>
                      <X className="w-4 h-4" />
                      {lang === 'de' ? 'Ablehnen' : 'Cancel'}
                    </Button>
                  )}
                  {preview.status === 'pending' && preview.trigger_type === 'inbound_reply' && preview.escalation_forward_status === 'failed' && (
                    <Button
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => retryEscalationMut.mutate(preview.id)}
                      disabled={retryEscalationMut.isPending || updateMut.isPending}>
                      <RotateCw className="w-4 h-4" />
                      {lang === 'de' ? 'Eskalation erneut senden' : 'Retry escalation'}
                    </Button>
                  )}
                  {preview.trigger_type === 'inbound_reply' &&
                    (preview.escalation_forward_status === 'forwarding' ||
                      preview.escalation_forward_status === 'unconfirmed') && (
                    <>
                      <Button
                        variant="outline"
                        className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
                        onClick={() => confirmEscalationMut.mutate(preview.id)}
                        disabled={confirmEscalationMut.isPending || resendEscalationMut.isPending || updateMut.isPending}>
                        <ShieldCheck className="w-4 h-4" />
                        {lang === 'de' ? 'Zustellung bestätigen' : 'Confirm delivery'}
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50"
                        onClick={() => {
                          const acknowledged = confirm(lang === 'de'
                            ? 'Die ursprüngliche Eskalation kann bereits zugestellt worden sein. Erneutes Senden kann zu einer doppelten Nachricht führen. Trotzdem erneut senden?'
                            : 'The original escalation may already have been delivered. Resending can create a duplicate message. Resend anyway?');
                          if (acknowledged) resendEscalationMut.mutate(preview.id);
                        }}
                        disabled={confirmEscalationMut.isPending || resendEscalationMut.isPending || updateMut.isPending}>
                        <RotateCw className="w-4 h-4" />
                        {lang === 'de' ? 'Trotz Risiko erneut senden' : 'Resend despite risk'}
                      </Button>
                    </>
                  )}
                  {preview.status === 'pending' && ['inbound_reply', 'order_missing_info'].includes(preview.trigger_type) ? (
                     <>
                       {(!editSubject.trim() || !editBody.trim()) && (
                         <div role="alert" className="self-center text-xs text-destructive">
                           {!editSubject.trim() && (
                             <p>{lang === 'de' ? 'Betreff darf nicht leer sein' : 'Subject cannot be empty'}</p>
                           )}
                           {!editBody.trim() && (
                             <p>{lang === 'de' ? 'Text darf nicht leer sein' : 'Body cannot be empty'}</p>
                           )}
                         </div>
                       )}
                       <Button
                         className="gap-1.5 bg-green-600 hover:bg-green-700"
                         onClick={() => handleApproveWithEdits(preview)}
                         disabled={approveMut.isPending || updateMut.isPending || !editSubject.trim() || !editBody.trim()}>
                         <CheckCircle2 className="w-4 h-4" />
                         {lang === 'de' ? 'Genehmigen & Senden' : 'Approve & Send'}
                       </Button>
                     </>
                  ) : preview.status === 'pending' ? (
                    <Button
                      className="gap-1.5 bg-green-600 hover:bg-green-700"
                      onClick={() => approveMut.mutate(preview.id)}
                      disabled={approveMut.isPending}>
                      <CheckCircle2 className="w-4 h-4" />
                      {lang === 'de' ? 'Genehmigen & Senden' : 'Approve & Send'}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
