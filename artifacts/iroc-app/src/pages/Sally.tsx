import { lazy, useState, useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminGet, adminPost, adminPut, adminDelete } from '@/lib/admin-fetch';
import {
  SALLY_LEADS_KEY,
  SALLY_DOCTORS_KEY,
  SALLY_EMAIL_QUEUE_KEY,
  SALLY_IMPORT_LEADS_KEY,
  SALLY_IMPORT_DOCTORS_KEY,
} from '@/lib/query-keys';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus, MoreHorizontal, Pencil, CheckSquare, Ban, Trash2,
  UserSearch, Download, RefreshCw, Stethoscope, Mail, CheckCircle2,
  X, Eye, Reply, Languages, PlayCircle, Loader2, CheckCircle, AlertCircle,
  Save, Settings, User, Globe, Wifi, WifiOff, EyeOff, GraduationCap, Info, PauseCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// The queue has its own route and is also a tab inside Sally. Keep its
// reconciliation/export UI out of the general Sally chunk until the tab is
// actually opened.
const SallyEmailQueue = lazy(() => import('./SallyEmailQueue'));

// ── Shared helpers ─────────────────────────────────────────────────────────────

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Types ──────────────────────────────────────────────────────────────────────

type SallyTab = 'leads' | 'doctors' | 'email-queue' | 'settings';

interface SallyLead {
  id: number; name: string; email: string; product_interest_group: string;
  first_contact_date: string | null; training_registered: boolean;
  is_cancelled: boolean; created_at: string;
}
interface ImportLeadCandidate {
  id: number; full_name: string; email: string; specialty: string | null;
  first_contact_date: string | null; status: string;
}
interface SallyDoctor {
  id: number; name: string; email: string; last_purchase_date: string | null;
  avg_items_per_order: number; is_cancelled: boolean; created_at: string;
}
interface ImportDoctorCandidate {
  tableId: number; source: 'trained_doctor' | 'website_customer';
  fullName: string; email: string; specialty: string | null;
  institutionName: string | null; city: string | null;
}
interface QueueItem {
  id: number; recipient_email: string; subject: string; body: string;
  trigger_type: string; status: 'pending' | 'sent' | 'cancelled';
  related_lead_id: number | null; related_doctor_id: number | null;
  related_order_id: number | null; created_at: string;
  message_id: string | null; in_reply_to: string | null;
  detected_language: string | null; detected_formality: 'formal' | 'informal' | null;
  inbound_from: string | null; inbound_body: string | null;
  escalation_forward_status: 'succeeded' | 'failed' | 'retrying' | 'uncertain' | null;
}
interface Lesson {
  id: number; context: string; lesson: string; original_text: string;
  corrected_text: string; created_at: string;
}
type LangOption = 'de' | 'en' | 'both';
type LeadFilter = 'active' | 'cancelled' | 'registered' | 'all';
type DoctorFilter = 'active' | 'cancelled' | 'all';
type QueueFilter = 'pending' | 'sent' | 'cancelled' | 'all';

// ── Email queue constants ──────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, { de: string; en: string; color: string }> = {
  first_contact:      { de: 'Erstkontakt',          en: 'First Contact',      color: 'bg-blue-100 text-blue-800' },
  '4_week_followup':  { de: '4-Wochen Follow-up',   en: '4-Week Follow-up',   color: 'bg-purple-100 text-purple-800' },
  '2_month_reminder': { de: '2-Monats-Erinnerung',  en: '2-Month Reminder',   color: 'bg-indigo-100 text-indigo-800' },
  doctor_checkin:     { de: 'Arzt Check-in',         en: 'Doctor Check-in',    color: 'bg-teal-100 text-teal-800' },
  doctor_promo:       { de: '6-Monats-Promo',        en: '6-Month Promo',      color: 'bg-amber-100 text-amber-800' },
  inbound_reply:      { de: 'Antwort-Entwurf',       en: 'Reply Draft',        color: 'bg-rose-100 text-rose-800' },
  order_missing_info: { de: 'Bestellung: R\u00fcckfrage', en: 'Order: Missing Info', color: 'bg-orange-100 text-orange-800' },
  invoice_dispatch:   { de: 'Versandbestätigung',    en: 'Dispatch Notice',    color: 'bg-emerald-100 text-emerald-800' },
  invoice_dispatch_shipping: { de: 'Versandbestätigung (Lieferadresse)', en: 'Dispatch Notice (Shipping)', color: 'bg-emerald-100 text-emerald-800' },
};
const STATUS_LABELS: Record<string, { de: string; en: string }> = {
  pending:   { de: 'Ausstehend',  en: 'Pending' },
  sent:      { de: 'Gesendet',    en: 'Sent' },
  cancelled: { de: 'Abgebrochen', en: 'Cancelled' },
};
const LANG_NAMES: Record<string, string> = { de: 'DE', en: 'EN', fr: 'FR', es: 'ES', it: 'IT', nl: 'NL' };

// ── Tab: Leads ─────────────────────────────────────────────────────────────────

function LeadsTab() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const de = lang === 'de';

  const blankLead = () => ({
    name: '', email: '', product_interest_group: '',
    first_contact_date: new Date().toISOString().slice(0, 10),
    training_registered: false, is_cancelled: false,
  });

  const [filter, setFilter] = useState<LeadFilter>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SallyLead | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(blankLead());
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { data: leads = [], isLoading } = useQuery<SallyLead[]>({
    queryKey: SALLY_LEADS_KEY,
    queryFn: () => adminGet('/api/admin/sally/leads', token!),
    enabled: !!token,
  });

  const { data: importCandidates = [], isLoading: importLoading } = useQuery<ImportLeadCandidate[]>({
    queryKey: SALLY_IMPORT_LEADS_KEY,
    queryFn: () => adminGet('/api/admin/sally/import/leads', token!),
    enabled: !!token && importOpen,
    staleTime: 0,
  });

  const createMut = useMutation({
    mutationFn: (body: ReturnType<typeof blankLead>) => adminPost('/api/admin/sally/leads', token!, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_LEADS_KEY }); setIsNew(false); toast({ title: de ? 'Lead hinzugef\u00fcgt' : 'Lead added' }); },
    onError: () => toast({ title: de ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<SallyLead> }) =>
      adminPut(`/api/admin/sally/leads/${id}`, token!, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_LEADS_KEY }); setEditing(null); toast({ title: de ? 'Gespeichert' : 'Saved' }); },
    onError: () => toast({ title: de ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminDelete(`/api/admin/sally/leads/${id}`, token!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_LEADS_KEY }); toast({ title: de ? 'Gel\u00f6scht' : 'Deleted' }); },
    onError: () => toast({ title: de ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const importMut = useMutation({
    mutationFn: (ids: number[]) => adminPost('/api/admin/sally/import/leads', token!, { ids }),
    onSuccess: (data: { ok: boolean; imported: number }) => {
      qc.invalidateQueries({ queryKey: SALLY_LEADS_KEY });
      qc.invalidateQueries({ queryKey: SALLY_IMPORT_LEADS_KEY });
      setImportOpen(false); setSelectedIds(new Set());
      toast({ title: de ? `${data.imported} Lead(s) importiert` : `${data.imported} lead(s) imported` });
    },
    onError: () => toast({ title: de ? 'Import fehlgeschlagen' : 'Import failed', variant: 'destructive' }),
  });

  const reclassifyMut = useMutation({
    mutationFn: () => adminPost('/api/admin/sally/leads/reclassify', token!, {}),
    onSuccess: (data: { ok: boolean; updated: number }) => {
      qc.invalidateQueries({ queryKey: SALLY_LEADS_KEY });
      toast({ title: de ? `${data.updated} Lead(s) neu klassifiziert` : `${data.updated} lead(s) re-classified` });
    },
    onError: () => toast({ title: de ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const LEAD_FILTERS: { key: LeadFilter; label: string }[] = [
    { key: 'active',     label: de ? 'Aktiv'       : 'Active' },
    { key: 'registered', label: de ? 'Registriert' : 'Registered' },
    { key: 'cancelled',  label: de ? 'Abgebrochen' : 'Cancelled' },
    { key: 'all',        label: de ? 'Alle'        : 'All' },
  ];

  const filtered = leads.filter(l => {
    if (filter === 'active' && (l.is_cancelled || l.training_registered)) return false;
    if (filter === 'cancelled' && !l.is_cancelled) return false;
    if (filter === 'registered' && !l.training_registered) return false;
    if (search) {
      const q = search.toLowerCase();
      return l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q) || l.product_interest_group.toLowerCase().includes(q);
    }
    return true;
  });

  function openEdit(lead: SallyLead) {
    setEditing(lead);
    setForm({ name: lead.name, email: lead.email, product_interest_group: lead.product_interest_group,
      first_contact_date: lead.first_contact_date ?? '', training_registered: lead.training_registered, is_cancelled: lead.is_cancelled });
  }

  return (
    <div className="p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 bg-muted p-1 rounded-lg shrink-0">
          {LEAD_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === f.key ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {f.label}
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({leads.filter(l => f.key === 'all' ? true : f.key === 'active' ? (!l.is_cancelled && !l.training_registered) : f.key === 'cancelled' ? l.is_cancelled : l.training_registered).length})
              </span>
            </button>
          ))}
        </div>
        <Input placeholder={de ? 'Suchen\u2026' : 'Search\u2026'} value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[160px]" />
        <div className="flex gap-2 ml-auto shrink-0">
          <Button variant="outline" size="sm" disabled={reclassifyMut.isPending}
            onClick={() => { if (confirm(de ? 'Alle Leads mit nicht-kanonischer Produktgruppe neu klassifizieren?' : 'Re-classify all leads with a non-canonical product group?')) reclassifyMut.mutate(); }}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${reclassifyMut.isPending ? 'animate-spin' : ''}`} />
            {de ? 'Neu klassifizieren' : 'Re-classify'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setImportOpen(true); setSelectedIds(new Set()); }}>
            <Download className="w-4 h-4 mr-1.5" />{de ? 'Importieren' : 'Import'}
          </Button>
          <Button size="sm" onClick={() => { setIsNew(true); setForm(blankLead()); }}>
            <Plus className="w-4 h-4 mr-1.5" />{de ? 'Lead hinzuf\u00fcgen' : 'Add Lead'}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de ? 'Name' : 'Name'}</TableHead>
                <TableHead>E-Mail</TableHead>
                <TableHead>{de ? 'Produktgruppe' : 'Product Group'}</TableHead>
                <TableHead>{de ? 'Erstkontakt' : 'First Contact'}</TableHead>
                <TableHead>{de ? 'Schulung' : 'Training'}</TableHead>
                <TableHead>{de ? 'Status' : 'Status'}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">{de ? 'Laden\u2026' : 'Loading\u2026'}</TableCell></TableRow>
                : filtered.length === 0
                ? <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">{de ? 'Keine Leads gefunden' : 'No leads found'}</TableCell></TableRow>
                : filtered.map(lead => (
                  <TableRow key={lead.id} className={lead.is_cancelled ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{lead.name}</TableCell>
                    <TableCell className="text-muted-foreground">{lead.email}</TableCell>
                    <TableCell>{
                      lead.product_interest_group === 'spirecut' ? `Spirecut (${de ? 'Handchirurgie' : 'Hand Surgery'})` :
                      lead.product_interest_group === 'ministem' ? 'MiniStem / Jointechlabs (MFAT / SVF)' :
                      lead.product_interest_group === 'cellenis' ? `Cellenis / Estar Medical (PRP, PRF, ${de ? 'Exosomen' : 'Exosomes'})` :
                      lead.product_interest_group || '—'
                    }</TableCell>
                    <TableCell>{formatDate(lead.first_contact_date)}</TableCell>
                    <TableCell>{lead.training_registered
                      ? <Badge variant="default" className="bg-green-100 text-green-800">{de ? 'Ja' : 'Yes'}</Badge>
                      : <Badge variant="secondary">{de ? 'Nein' : 'No'}</Badge>}
                    </TableCell>
                    <TableCell>{lead.is_cancelled
                      ? <Badge variant="destructive">{de ? 'Abgebrochen' : 'Cancelled'}</Badge>
                      : <Badge variant="outline">{de ? 'Aktiv' : 'Active'}</Badge>}
                    </TableCell>
                    <TableCell className="w-10">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="w-8 h-8"><MoreHorizontal className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(lead)}><Pencil className="w-4 h-4 mr-2" />{de ? 'Bearbeiten' : 'Edit'}</DropdownMenuItem>
                          {!lead.training_registered && (
                            <DropdownMenuItem onClick={() => updateMut.mutate({ id: lead.id, body: { training_registered: true } })}><CheckSquare className="w-4 h-4 mr-2" />{de ? 'Als registriert markieren' : 'Mark as registered'}</DropdownMenuItem>
                          )}
                          {!lead.is_cancelled && (
                            <DropdownMenuItem onClick={() => updateMut.mutate({ id: lead.id, body: { is_cancelled: true } })} className="text-orange-600"><Ban className="w-4 h-4 mr-2" />{de ? 'Abbrechen' : 'Cancel'}</DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => { if (confirm(de ? 'Wirklich l\u00f6schen?' : 'Delete?')) deleteMut.mutate(lead.id); }} className="text-destructive"><Trash2 className="w-4 h-4 mr-2" />{de ? 'L\u00f6schen' : 'Delete'}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={open => { if (!open) { setImportOpen(false); setSelectedIds(new Set()); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{de ? 'Leads aus iROC importieren' : 'Import leads from iROC'}</DialogTitle></DialogHeader>
          <div className="py-2">
            {importLoading ? <p className="text-sm text-muted-foreground text-center py-8">{de ? 'Laden\u2026' : 'Loading\u2026'}</p>
              : importCandidates.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">{de ? 'Alle iROC-Leads sind bereits in Sally vorhanden.' : 'All iROC leads are already in Sally.'}</p>
              : <>
                <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                  <Checkbox id="select-all-leads" checked={selectedIds.size === importCandidates.length && importCandidates.length > 0}
                    onCheckedChange={v => setSelectedIds(v ? new Set(importCandidates.map(c => c.id)) : new Set())} />
                  <label htmlFor="select-all-leads" className="text-sm font-medium cursor-pointer">
                    {de ? `Alle ausw\u00e4hlen (${importCandidates.length})` : `Select all (${importCandidates.length})`}
                  </label>
                </div>
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {importCandidates.map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-muted/50">
                      <Checkbox id={`lead-${c.id}`} checked={selectedIds.has(c.id)}
                        onCheckedChange={() => setSelectedIds(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                      <label htmlFor={`lead-${c.id}`} className="flex-1 cursor-pointer grid grid-cols-3 gap-2 text-sm">
                        <span className="font-medium truncate">{c.full_name}</span>
                        <span className="text-muted-foreground truncate">{c.email}</span>
                        <span className="text-muted-foreground truncate">{c.specialty || '—'}</span>
                      </label>
                    </div>
                  ))}
                </div>
              </>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setSelectedIds(new Set()); }}>{de ? 'Abbrechen' : 'Cancel'}</Button>
            <Button disabled={selectedIds.size === 0 || importMut.isPending} onClick={() => importMut.mutate(Array.from(selectedIds))}>
              {importMut.isPending ? (de ? 'Importiere\u2026' : 'Importing\u2026') : (de ? `${selectedIds.size} importieren` : `Import ${selectedIds.size}`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit dialog */}
      <Dialog open={isNew || !!editing} onOpenChange={open => { if (!open) { setIsNew(false); setEditing(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isNew ? (de ? 'Lead hinzuf\u00fcgen' : 'Add Lead') : (de ? 'Lead bearbeiten' : 'Edit Lead')}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>{de ? 'Name' : 'Name'} *</Label><Input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} placeholder="Dr. Anna M\u00fcller" /></div>
              <div className="space-y-1.5"><Label>E-Mail *</Label><Input type="email" value={form.email} onChange={e => setForm(v => ({ ...v, email: e.target.value }))} placeholder="name@praxis.de" /></div>
            </div>
            <div className="space-y-1.5">
              <Label>{de ? 'Produktgruppe' : 'Product Group'}</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.product_interest_group} onChange={e => setForm(v => ({ ...v, product_interest_group: e.target.value }))}>
                <option value="">{de ? 'Allgemein / nicht zugeordnet' : 'General / unassigned'}</option>
                <option value="spirecut">Spirecut ({de ? 'Handchirurgie' : 'Hand Surgery'})</option>
                <option value="ministem">MiniStem / Jointechlabs (MFAT / SVF)</option>
                <option value="cellenis">Cellenis / Estar Medical (PRP, PRF, {de ? 'Exosomen' : 'Exosomes'})</option>
              </select>
            </div>
            <div className="space-y-1.5"><Label>{de ? 'Erstkontaktdatum' : 'First Contact Date'}</Label><Input type="date" value={form.first_contact_date ?? ''} onChange={e => setForm(v => ({ ...v, first_contact_date: e.target.value }))} /></div>
            {editing && (
              <div className="flex items-center gap-3">
                <Switch checked={form.training_registered} onCheckedChange={v => setForm(f => ({ ...f, training_registered: v }))} id="tr-switch" />
                <Label htmlFor="tr-switch">{de ? 'Schulung registriert' : 'Training registered'}</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsNew(false); setEditing(null); }}>{de ? 'Abbrechen' : 'Cancel'}</Button>
            <Button disabled={!form.name.trim() || !form.email.trim() || createMut.isPending || updateMut.isPending}
              onClick={() => { if (isNew) createMut.mutate(form); else if (editing) updateMut.mutate({ id: editing.id, body: form }); }}>
              {de ? 'Speichern' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab: Doctors ───────────────────────────────────────────────────────────────

function DoctorsTab() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const de = lang === 'de';

  const blankDoc = () => ({ name: '', email: '', last_purchase_date: '', avg_items_per_order: 0, is_cancelled: false });

  const [filter, setFilter] = useState<DoctorFilter>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SallyDoctor | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(blankDoc());
  const [importOpen, setImportOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const { data: doctors = [], isLoading } = useQuery<SallyDoctor[]>({
    queryKey: SALLY_DOCTORS_KEY,
    queryFn: () => adminGet('/api/admin/sally/doctors', token!),
    enabled: !!token,
  });

  const { data: importCandidates = [], isLoading: importLoading } = useQuery<ImportDoctorCandidate[]>({
    queryKey: SALLY_IMPORT_DOCTORS_KEY,
    queryFn: () => adminGet('/api/admin/sally/import/doctors', token!),
    enabled: !!token && importOpen,
    staleTime: 0,
  });

  const createMut = useMutation({
    mutationFn: (body: ReturnType<typeof blankDoc>) => adminPost('/api/admin/sally/doctors', token!, {
      ...body, lastPurchaseDate: body.last_purchase_date || null, avgItemsPerOrder: body.avg_items_per_order,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_DOCTORS_KEY }); setIsNew(false); toast({ title: de ? 'Arzt hinzugef\u00fcgt' : 'Doctor added' }); },
    onError: () => toast({ title: de ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<SallyDoctor> & { avgItemsPerOrder?: number; lastPurchaseDate?: string | null } }) =>
      adminPut(`/api/admin/sally/doctors/${id}`, token!, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_DOCTORS_KEY }); setEditing(null); toast({ title: de ? 'Gespeichert' : 'Saved' }); },
    onError: () => toast({ title: de ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminDelete(`/api/admin/sally/doctors/${id}`, token!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_DOCTORS_KEY }); toast({ title: de ? 'Gel\u00f6scht' : 'Deleted' }); },
    onError: () => toast({ title: de ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const importMut = useMutation({
    mutationFn: (keys: string[]) => {
      const items = keys.map(k => { const [source, id] = k.split(':'); return { source, tableId: parseInt(id) }; });
      return adminPost('/api/admin/sally/import/doctors', token!, { items });
    },
    onSuccess: (data: { ok: boolean; imported: number }) => {
      qc.invalidateQueries({ queryKey: SALLY_DOCTORS_KEY });
      qc.invalidateQueries({ queryKey: SALLY_IMPORT_DOCTORS_KEY });
      setImportOpen(false); setSelectedKeys(new Set());
      toast({ title: de ? `${data.imported} Arzt/\u00c4rzte importiert` : `${data.imported} doctor(s) imported` });
    },
    onError: () => toast({ title: de ? 'Import fehlgeschlagen' : 'Import failed', variant: 'destructive' }),
  });

  function candidateKey(c: ImportDoctorCandidate) { return `${c.source}:${c.tableId}`; }

  const DOC_FILTERS: { key: DoctorFilter; label: string }[] = [
    { key: 'active',    label: de ? 'Aktiv'       : 'Active' },
    { key: 'cancelled', label: de ? 'Abgebrochen' : 'Cancelled' },
    { key: 'all',       label: de ? 'Alle'        : 'All' },
  ];

  const filtered = doctors.filter(d => {
    if (filter === 'active' && d.is_cancelled) return false;
    if (filter === 'cancelled' && !d.is_cancelled) return false;
    if (search) { const q = search.toLowerCase(); return d.name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q); }
    return true;
  });

  function daysSince(iso: string | null) {
    if (!iso) return null;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  }

  function openEdit(doc: SallyDoctor) {
    setEditing(doc);
    setForm({ name: doc.name, email: doc.email, last_purchase_date: doc.last_purchase_date ?? '', avg_items_per_order: doc.avg_items_per_order, is_cancelled: doc.is_cancelled });
  }

  return (
    <div className="p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1 bg-muted p-1 rounded-lg shrink-0">
          {DOC_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === f.key ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {f.label}
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({doctors.filter(d => f.key === 'all' ? true : f.key === 'active' ? !d.is_cancelled : d.is_cancelled).length})
              </span>
            </button>
          ))}
        </div>
        <Input placeholder={de ? 'Suchen\u2026' : 'Search\u2026'} value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[160px]" />
        <div className="flex gap-2 ml-auto shrink-0">
          <Button variant="outline" size="sm" onClick={() => { setImportOpen(true); setSelectedKeys(new Set()); }}>
            <Download className="w-4 h-4 mr-1.5" />{de ? 'Importieren' : 'Import'}
          </Button>
          <Button size="sm" onClick={() => { setIsNew(true); setForm(blankDoc()); }}>
            <Plus className="w-4 h-4 mr-1.5" />{de ? 'Arzt hinzuf\u00fcgen' : 'Add Doctor'}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de ? 'Name' : 'Name'}</TableHead>
                <TableHead>E-Mail</TableHead>
                <TableHead>{de ? 'Letzter Kauf' : 'Last Purchase'}</TableHead>
                <TableHead>{de ? 'Tage her' : 'Days ago'}</TableHead>
                <TableHead>{de ? '\u00d8 Artikel/Bestellung' : 'Avg Items/Order'}</TableHead>
                <TableHead>{de ? 'Status' : 'Status'}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">{de ? 'Laden\u2026' : 'Loading\u2026'}</TableCell></TableRow>
                : filtered.length === 0
                ? <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">{de ? 'Keine \u00c4rzte gefunden' : 'No doctors found'}</TableCell></TableRow>
                : filtered.map(doc => {
                  const days = daysSince(doc.last_purchase_date);
                  return (
                    <TableRow key={doc.id} className={doc.is_cancelled ? 'opacity-50' : ''}>
                      <TableCell className="font-medium">{doc.name}</TableCell>
                      <TableCell className="text-muted-foreground">{doc.email}</TableCell>
                      <TableCell>{formatDate(doc.last_purchase_date)}</TableCell>
                      <TableCell>{days == null ? '—' : <span className={days >= 60 ? 'text-orange-600 font-medium' : ''}>{days}</span>}</TableCell>
                      <TableCell><span className={doc.avg_items_per_order < 5 ? 'text-amber-600 font-medium' : ''}>{doc.avg_items_per_order.toFixed(1)}</span></TableCell>
                      <TableCell>{doc.is_cancelled
                        ? <Badge variant="destructive">{de ? 'Abgebrochen' : 'Cancelled'}</Badge>
                        : <Badge variant="outline">{de ? 'Aktiv' : 'Active'}</Badge>}
                      </TableCell>
                      <TableCell className="w-10">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="w-8 h-8"><MoreHorizontal className="w-4 h-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(doc)}><Pencil className="w-4 h-4 mr-2" />{de ? 'Bearbeiten' : 'Edit'}</DropdownMenuItem>
                            {!doc.is_cancelled && (
                              <DropdownMenuItem onClick={() => updateMut.mutate({ id: doc.id, body: { is_cancelled: true } })} className="text-orange-600"><Ban className="w-4 h-4 mr-2" />{de ? 'Abbrechen' : 'Cancel'}</DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => { if (confirm(de ? 'Wirklich l\u00f6schen?' : 'Delete?')) deleteMut.mutate(doc.id); }} className="text-destructive"><Trash2 className="w-4 h-4 mr-2" />{de ? 'L\u00f6schen' : 'Delete'}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={open => { if (!open) { setImportOpen(false); setSelectedKeys(new Set()); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{de ? 'Zertifizierte \u00c4rzte aus iROC importieren' : 'Import certified doctors from iROC'}</DialogTitle></DialogHeader>
          <div className="py-2">
            {importLoading ? <p className="text-sm text-muted-foreground text-center py-8">{de ? 'Laden\u2026' : 'Loading\u2026'}</p>
              : importCandidates.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">{de ? 'Alle iROC-\u00c4rzte sind bereits in Sally vorhanden.' : 'All iROC doctors are already in Sally.'}</p>
              : <>
                <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                  <Checkbox id="select-all-doctors" checked={selectedKeys.size === importCandidates.length && importCandidates.length > 0}
                    onCheckedChange={v => setSelectedKeys(v ? new Set(importCandidates.map(candidateKey)) : new Set())} />
                  <label htmlFor="select-all-doctors" className="text-sm font-medium cursor-pointer">
                    {de ? `Alle ausw\u00e4hlen (${importCandidates.length})` : `Select all (${importCandidates.length})`}
                  </label>
                </div>
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {importCandidates.map(c => {
                    const key = candidateKey(c);
                    return (
                      <div key={key} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-muted/50">
                        <Checkbox id={`doctor-${key}`} checked={selectedKeys.has(key)}
                          onCheckedChange={() => setSelectedKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })} />
                        <label htmlFor={`doctor-${key}`} className="flex-1 cursor-pointer grid grid-cols-3 gap-2 text-sm">
                          <span className="font-medium truncate">{c.fullName}</span>
                          <span className="text-muted-foreground truncate">{c.email}</span>
                          <span className="text-muted-foreground truncate">{[c.city, c.specialty].filter(Boolean).join(' \u00b7 ') || '—'}</span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setSelectedKeys(new Set()); }}>{de ? 'Abbrechen' : 'Cancel'}</Button>
            <Button disabled={selectedKeys.size === 0 || importMut.isPending} onClick={() => importMut.mutate(Array.from(selectedKeys))}>
              {importMut.isPending ? (de ? 'Importiere\u2026' : 'Importing\u2026') : (de ? `${selectedKeys.size} importieren` : `Import ${selectedKeys.size}`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit dialog */}
      <Dialog open={isNew || !!editing} onOpenChange={open => { if (!open) { setIsNew(false); setEditing(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{isNew ? (de ? 'Arzt hinzuf\u00fcgen' : 'Add Doctor') : (de ? 'Arzt bearbeiten' : 'Edit Doctor')}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>{de ? 'Name' : 'Name'} *</Label><Input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} placeholder="Dr. Max Mustermann" /></div>
              <div className="space-y-1.5"><Label>E-Mail *</Label><Input type="email" value={form.email} onChange={e => setForm(v => ({ ...v, email: e.target.value }))} placeholder="arzt@klinik.de" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>{de ? 'Letzter Kaufdatum' : 'Last Purchase Date'}</Label><Input type="date" value={form.last_purchase_date} onChange={e => setForm(v => ({ ...v, last_purchase_date: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>{de ? '\u00d8 Artikel/Bestellung' : 'Avg Items/Order'}</Label><Input type="number" min="0" step="0.1" value={form.avg_items_per_order} onChange={e => setForm(v => ({ ...v, avg_items_per_order: parseFloat(e.target.value) || 0 }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsNew(false); setEditing(null); }}>{de ? 'Abbrechen' : 'Cancel'}</Button>
            <Button disabled={!form.name.trim() || !form.email.trim() || createMut.isPending || updateMut.isPending}
              onClick={() => {
                const body = { name: form.name, email: form.email, lastPurchaseDate: form.last_purchase_date || null, avgItemsPerOrder: form.avg_items_per_order };
                if (isNew) createMut.mutate(form); else if (editing) updateMut.mutate({ id: editing.id, body });
              }}>
              {de ? 'Speichern' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab: Email Queue ───────────────────────────────────────────────────────────

export function EmailQueueTab() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const de = lang === 'de';

  const [filter, setFilter]       = useState<QueueFilter>('pending');
  const [preview, setPreview]     = useState<QueueItem | null>(null);
  const [showInbound, setShowInbound] = useState(false);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody]       = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkCancelling, setBulkCancelling] = useState(false);

  useEffect(() => { setSelectedIds(new Set()); }, [filter]);
  useEffect(() => { if (preview) { setEditSubject(preview.subject); setEditBody(preview.body); } }, [preview]);

  const { data: emails = [], isLoading } = useQuery<QueueItem[]>({
    queryKey: [...SALLY_EMAIL_QUEUE_KEY, filter],
    queryFn: () => adminGet(`/api/admin/sally/email-queue?status=${filter}`, token!),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const allSelected = emails.length > 0 && emails.every(e => selectedIds.has(e.id));
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(emails.map(e => e.id)));
  const selectedPending = emails.filter(e => selectedIds.has(e.id) && e.status === 'pending');

  const handleBulkCancel = async () => {
    if (!token || selectedPending.length === 0) return;
    if (!confirm(de ? `${selectedPending.length} E-Mail${selectedPending.length !== 1 ? 's' : ''} wirklich abbrechen?` : `Cancel ${selectedPending.length} email${selectedPending.length !== 1 ? 's' : ''}?`)) return;
    setBulkCancelling(true);
    try {
      await Promise.all(selectedPending.map(e => adminPost(`/api/admin/sally/email-queue/${e.id}/cancel`, token!, {})));
      qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY });
      setSelectedIds(new Set());
      toast({ title: de ? 'E-Mails abgebrochen' : 'Emails cancelled' });
    } catch { toast({ title: de ? 'Fehler' : 'Error', variant: 'destructive' }); }
    finally { setBulkCancelling(false); }
  };

  const approveMut = useMutation({
    mutationFn: (id: number) => adminPost(`/api/admin/sally/email-queue/${id}/approve`, token!, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY }); setPreview(null); toast({ title: de ? 'E-Mail gesendet' : 'Email sent' }); },
    onError: (err: Error) => toast({ title: err.message, variant: 'destructive' }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) => adminPost(`/api/admin/sally/email-queue/${id}/cancel`, token!, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY }); setPreview(null); toast({ title: de ? 'E-Mail abgebrochen' : 'Email cancelled' }); },
    onError: () => toast({ title: de ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const retryEscalationMut = useMutation({
    mutationFn: (id: number) => adminPost<{ escalationForwardStatus: 'succeeded' | 'retrying' | 'uncertain' }>(`/api/admin/sally/email-queue/${id}/retry-escalation`, token!, {}),
    onSuccess: (result, id) => {
      qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY });
      setPreview(prev => prev?.id === id ? { ...prev, escalation_forward_status: result.escalationForwardStatus } : prev);
      if (result.escalationForwardStatus === 'succeeded') {
        toast({ title: de ? 'Anfrage erfolgreich an den Kundenservice weitergeleitet' : 'Inquiry successfully forwarded to customer service' });
      } else if (result.escalationForwardStatus === 'retrying') {
        toast({ title: de ? 'Die Weiterleitung läuft bereits' : 'The forward is already in progress' });
      } else {
        toast({
          title: de ? 'Zustellung nicht bestätigt – bitte nicht erneut senden' : 'Delivery unconfirmed — do not retry',
          variant: 'destructive',
        });
      }
    },
    onError: () => toast({
      title: de ? 'Weiterleitung fehlgeschlagen. Bitte erneut versuchen.' : 'Forwarding failed. Please try again.',
      variant: 'destructive',
    }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, subject, body }: { id: number; subject: string; body: string }) =>
      adminPut(`/api/admin/sally/email-queue/${id}`, token!, { subject, body }),
    onSuccess: (updated: QueueItem) => {
      qc.invalidateQueries({ queryKey: SALLY_EMAIL_QUEUE_KEY });
      setPreview(prev => prev ? { ...prev, subject: updated.subject, body: updated.body } : prev);
      toast({ title: de ? 'Entwurf gespeichert' : 'Draft saved' });
    },
    onError: (err: Error) => toast({ title: err.message, variant: 'destructive' }),
  });

  const handleApproveWithEdits = async (item: QueueItem) => {
    if (!editSubject.trim() || !editBody.trim()) return;

    if (editSubject !== item.subject || editBody !== item.body)
      await updateMut.mutateAsync({ id: item.id, subject: editSubject, body: editBody });
    approveMut.mutate(item.id);
  };

  const replyCount = emails.filter(e => e.trigger_type === 'inbound_reply' && e.status === 'pending').length;

  const QUEUE_FILTERS: { key: QueueFilter; label: string }[] = [
    { key: 'pending',   label: de ? 'Ausstehend' : 'Pending' },
    { key: 'sent',      label: de ? 'Gesendet'   : 'Sent' },
    { key: 'cancelled', label: de ? 'Abgebrochen': 'Cancelled' },
    { key: 'all',       label: de ? 'Alle'       : 'All' },
  ];

  return (
    <div className="p-6 space-y-4">
      {replyCount > 0 && filter === 'pending' && (
        <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-sm">
          <Reply className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="text-rose-800 font-medium">
            {de ? `${replyCount} eingehende Antwort${replyCount > 1 ? 'en' : ''} \u2013 KI-Entwurf zur Genehmigung bereit`
               : `${replyCount} inbound ${replyCount > 1 ? 'replies' : 'reply'} \u2014 AI draft ready for approval`}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          {QUEUE_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === f.key ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={toggleAll} disabled={emails.length === 0} className="h-8 gap-1.5 text-xs">
          {allSelected ? (de ? 'Auswahl aufheben' : 'Deselect all') : (de ? 'Alle ausw\u00e4hlen' : 'Select all')}
        </Button>
        {selectedIds.size > 0 && (
          <>
            <span className="text-sm text-muted-foreground">{selectedIds.size} {de ? 'ausgew\u00e4hlt' : 'selected'}</span>
            {selectedPending.length > 0 && (
              <Button size="sm" variant="outline" disabled={bulkCancelling} onClick={handleBulkCancel}
                className="gap-1.5 h-8 text-destructive border-destructive/40 hover:bg-destructive/10">
                <Trash2 className="w-3.5 h-3.5" />
                {bulkCancelling ? (de ? 'Breche ab\u2026' : 'Cancelling\u2026') : `${de ? 'Abbrechen' : 'Cancel'} (${selectedPending.length})`}
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
                <TableHead>{de ? 'Empf\u00e4nger' : 'Recipient'}</TableHead>
                <TableHead>{de ? 'Betreff' : 'Subject'}</TableHead>
                <TableHead>{de ? 'Typ' : 'Type'}</TableHead>
                <TableHead>{de ? 'Status' : 'Status'}</TableHead>
                <TableHead>{de ? 'Erstellt' : 'Created'}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">{de ? 'Laden\u2026' : 'Loading\u2026'}</TableCell></TableRow>
                : emails.length === 0
                ? <TableRow><TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                    <Mail className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">{filter === 'pending' ? (de ? 'Keine ausstehenden E-Mails' : 'No pending emails') : (de ? 'Keine E-Mails gefunden' : 'No emails found')}</p>
                    {filter === 'pending' && <p className="text-xs mt-1">{de ? 'Sally generiert automatisch E-Mails basierend auf Lead-Aktivit\u00e4ten.' : 'Sally generates emails automatically based on lead activity.'}</p>}
                  </TableCell></TableRow>
                : emails.map(email => {
                  const trig = TRIGGER_LABELS[email.trigger_type] ?? { de: email.trigger_type, en: email.trigger_type, color: 'bg-gray-100 text-gray-800' };
                  const isReply = email.trigger_type === 'inbound_reply';
                  const isSelected = selectedIds.has(email.id);
                  return (
                    <TableRow key={email.id} data-state={isSelected ? 'selected' : undefined}
                      className={`cursor-pointer transition-colors ${isReply && !isSelected ? 'bg-rose-50/40' : ''}`}
                      onClick={() => setSelectedIds(s => { const n = new Set(s); n.has(email.id) ? n.delete(email.id) : n.add(email.id); return n; })}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">{isReply && <Reply className="w-3.5 h-3.5 text-rose-500 shrink-0" />}<span>{email.recipient_email}</span></div>
                        {isReply && email.inbound_from && email.inbound_from !== email.recipient_email && <p className="text-xs text-muted-foreground mt-0.5">\u2190 {email.inbound_from}</p>}
                      </TableCell>
                      <TableCell className="max-w-xs"><span className="line-clamp-1">{email.subject}</span></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${trig.color}`}>{de ? trig.de : trig.en}</span>
                          {isReply && email.detected_language && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-700"><Languages className="w-3 h-3" />{LANG_NAMES[email.detected_language] ?? email.detected_language.toUpperCase()}</span>}
                          {isReply && email.detected_formality && <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100 text-slate-700">{email.detected_formality === 'formal' ? (de ? 'Formell' : 'Formal') : (de ? 'Informell' : 'Informal')}</span>}
                          {isReply && email.escalation_forward_status && (
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${email.escalation_forward_status === 'succeeded' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
                              {email.escalation_forward_status === 'succeeded'
                                ? (de ? 'An Kundenservice weitergeleitet' : 'Forwarded to customer service')
                                : email.escalation_forward_status === 'failed'
                                  ? (de ? 'Weiterleitung fehlgeschlagen' : 'Forwarding failed')
                                  : email.escalation_forward_status === 'retrying'
                                    ? (de ? 'Weiterleitung läuft' : 'Forwarding in progress')
                                    : (de ? 'Zustellung nicht bestätigt' : 'Delivery unconfirmed')}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={email.status === 'sent' ? 'default' : email.status === 'cancelled' ? 'destructive' : 'secondary'}
                          className={email.status === 'sent' ? 'bg-green-100 text-green-800' : ''}>
                          {de ? STATUS_LABELS[email.status]?.de : STATUS_LABELS[email.status]?.en}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDateTime(email.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 justify-end">
                          <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setPreview(email); setShowInbound(false); }}><Eye className="w-4 h-4" /></Button>
                           {email.status === 'pending' && isReply && email.escalation_forward_status === 'failed' && (
                             <Button size="sm" variant="outline" className="gap-1"
                               onClick={e => { e.stopPropagation(); retryEscalationMut.mutate(email.id); }}
                               disabled={retryEscalationMut.isPending}>
                               <RefreshCw className={`w-3.5 h-3.5 ${retryEscalationMut.isPending ? 'animate-spin' : ''}`} />
                               {de ? 'Weiterleiten erneut versuchen' : 'Retry forward'}
                             </Button>
                           )}
                          {email.status === 'pending' && (
                            <Button size="sm" variant="default" className="gap-1 bg-green-600 hover:bg-green-700"
                              onClick={e => { e.stopPropagation(); approveMut.mutate(email.id); }} disabled={approveMut.isPending}>
                              <CheckCircle2 className="w-3.5 h-3.5" />{de ? 'Senden' : 'Send'}
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
              {preview?.trigger_type === 'inbound_reply' ? <Reply className="w-5 h-5 text-rose-500" /> : <Mail className="w-5 h-5" />}
              {preview?.trigger_type === 'inbound_reply' ? (de ? 'Antwort-Entwurf (KI)' : 'Reply Draft (AI)') : (de ? 'E-Mail Vorschau' : 'Email Preview')}
            </DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                <span className="text-muted-foreground font-medium">{de ? 'An:' : 'To:'}</span><span>{preview.recipient_email}</span>
                {preview.trigger_type === 'inbound_reply' && preview.detected_language && (
                  <><span className="text-muted-foreground font-medium">{de ? 'Erkannt:' : 'Detected:'}</span>
                  <span className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100">{LANG_NAMES[preview.detected_language] ?? preview.detected_language.toUpperCase()}</span>
                    {preview.detected_formality && <span className="px-1.5 py-0.5 rounded text-xs bg-slate-100">{preview.detected_formality === 'formal' ? (de ? 'Formell' : 'Formal') : (de ? 'Informell' : 'Informal')}</span>}
                  </span></>
                )}
                {preview.trigger_type === 'inbound_reply' && preview.escalation_forward_status && (
                  <>
                    <span className="text-muted-foreground font-medium">{de ? 'Weiterleitung:' : 'Forwarding:'}</span>
                    <span className={preview.escalation_forward_status === 'succeeded' ? 'text-green-700' : 'text-amber-800'}>
                      {preview.escalation_forward_status === 'succeeded'
                        ? (de ? 'Erfolgreich an den Kundenservice weitergeleitet' : 'Successfully forwarded to customer service')
                        : preview.escalation_forward_status === 'failed'
                          ? (de ? 'Fehlgeschlagen – der Kundenservice hat die Anfrage nicht erhalten' : 'Failed — customer service did not receive the inquiry')
                          : preview.escalation_forward_status === 'retrying'
                            ? (de ? 'Weiterleitung läuft – ein erneuter Versuch ist gesperrt' : 'Forwarding in progress — another attempt is blocked')
                            : (de ? 'Zustellung nicht bestätigt – bitte nicht erneut senden' : 'Delivery unconfirmed — do not retry')}
                    </span>
                  </>
                )}
              </div>
              {['inbound_reply', 'order_missing_info'].includes(preview.trigger_type) && preview.status === 'pending' ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">
                    <Pencil className="w-3.5 h-3.5 shrink-0" />
                    {de ? 'KI-Entwurf \u2013 Sie k\u00f6nnen Betreff und Text vor dem Senden bearbeiten.' : 'AI draft \u2014 you can edit the subject and body before sending.'}
                  </div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">{de ? 'Betreff' : 'Subject'}</Label><Input value={editSubject} onChange={e => setEditSubject(e.target.value)} aria-invalid={!editSubject.trim()} required className="text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">{de ? 'Nachricht' : 'Body'}</Label><Textarea value={editBody} onChange={e => setEditBody(e.target.value)} aria-invalid={!editBody.trim()} required rows={10} className="text-sm font-mono leading-relaxed resize-y" /></div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <span className="text-muted-foreground font-medium">{de ? 'Betreff:' : 'Subject:'}</span><span className="font-medium">{preview.subject}</span>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-4"><pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{preview.body}</pre></div>
                </>
              )}
              {preview.trigger_type === 'inbound_reply' && preview.inbound_body && (
                <div>
                  <button type="button" onClick={() => setShowInbound(v => !v)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 mb-2">
                    <Reply className="w-3.5 h-3.5" />{showInbound ? (de ? 'Original-E-Mail ausblenden' : 'Hide original email') : (de ? 'Original-E-Mail anzeigen' : 'Show original email')}
                  </button>
                  {showInbound && (
                    <div className="bg-rose-50 border border-rose-100 rounded-lg p-4">
                      <p className="text-xs font-medium text-rose-700 mb-2">{de ? `Von: ${preview.inbound_from}` : `From: ${preview.inbound_from}`}</p>
                      <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed text-muted-foreground max-h-48 overflow-y-auto">{preview.inbound_body}</pre>
                    </div>
                  )}
                </div>
              )}
              {preview.status === 'pending' && (
                <div className="flex gap-2 justify-end pt-2 border-t">
                  {preview.trigger_type === 'inbound_reply' && preview.escalation_forward_status === 'failed' && (
                    <Button variant="outline" className="gap-1.5"
                      onClick={() => retryEscalationMut.mutate(preview.id)}
                      disabled={retryEscalationMut.isPending}>
                      <RefreshCw className={`w-4 h-4 ${retryEscalationMut.isPending ? 'animate-spin' : ''}`} />
                      {retryEscalationMut.isPending
                        ? (de ? 'Weiterleitung wird erneut versucht…' : 'Retrying forward…')
                        : (de ? 'Weiterleitung erneut versuchen' : 'Retry forward')}
                    </Button>
                  )}
                  <Button variant="outline" className="gap-1.5 text-destructive border-destructive hover:bg-destructive/10"
                    onClick={() => { if (confirm(de ? 'E-Mail abbrechen?' : 'Cancel email?')) cancelMut.mutate(preview.id); }}
                    disabled={cancelMut.isPending || updateMut.isPending}>
                    <X className="w-4 h-4" />{de ? 'Ablehnen' : 'Cancel'}
                  </Button>
                  {['inbound_reply', 'order_missing_info'].includes(preview.trigger_type) ? (
                    <>
                      {(!editSubject.trim() || !editBody.trim()) && (
                        <div role="alert" className="self-center text-xs text-destructive">
                          {!editSubject.trim() && <p>{de ? 'Betreff darf nicht leer sein' : 'Subject cannot be empty'}</p>}
                          {!editBody.trim() && <p>{de ? 'Text darf nicht leer sein' : 'Body cannot be empty'}</p>}
                        </div>
                      )}
                      <Button className="gap-1.5 bg-green-600 hover:bg-green-700" onClick={() => handleApproveWithEdits(preview)} disabled={approveMut.isPending || updateMut.isPending || !editSubject.trim() || !editBody.trim()}>
                        <CheckCircle2 className="w-4 h-4" />{de ? 'Genehmigen & Senden' : 'Approve & Send'}
                      </Button>
                    </>
                  ) : (
                    <Button className="gap-1.5 bg-green-600 hover:bg-green-700" onClick={() => approveMut.mutate(preview.id)} disabled={approveMut.isPending}>
                      <CheckCircle2 className="w-4 h-4" />{de ? 'Genehmigen & Senden' : 'Approve & Send'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Tab: Settings ──────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  sally_automation_enabled:        'true',
  sally_auto_invoice_enabled:      'true',
  sally_bulk_discount_pct:        '10',
  sally_from_name:                'Sally',
  sally_from_email:               '',
  sally_escalation_email:         'info@i-roc.de',
  sally_lang_first_contact:       'both' as LangOption,
  sally_lang_followup:            'both' as LangOption,
  sally_imap_enabled:             'false',
  sally_imap_host:                'outlook.office365.com',
  sally_imap_port:                '993',
  sally_imap_user:                '',
  sally_imap_pass:                '',
  sally_imap_oauth_client_id:     '',
  sally_imap_oauth_tenant_id:     '',
  sally_imap_oauth_client_secret: '',
};
type SallySettings = typeof DEFAULT_SETTINGS;
type CronResult = { leads: string; doctors: string; promo: string; orders?: string } | null;

function SettingsTab() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const de = lang === 'de';

  const [settings, setSettings]           = useState<SallySettings>({ ...DEFAULT_SETTINGS });
  const [showPass, setShowPass]           = useState(false);
  const [showOAuthSecret, setShowOAuthSecret] = useState(false);
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);
  const [runningCron, setRunningCron]     = useState(false);
  const [cronResult, setCronResult]       = useState<CronResult>(null);
  const [testingImap, setTestingImap]     = useState(false);
  const [imapTestResult, setImapTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [lessons, setLessons]             = useState<Lesson[]>([]);
  const [expandedLesson, setExpandedLesson] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    adminGet<Record<string, string>>('/api/admin/sally/settings', token).then(s => setSettings(prev => ({ ...prev, ...s }) as SallySettings)).catch(() => {});
    adminGet<Lesson[]>('/api/admin/sally/lessons', token).then(setLessons).catch(() => {});
  }, [token]);

  function set<K extends keyof SallySettings>(key: K, value: SallySettings[K]) { setSettings(prev => ({ ...prev, [key]: value })); }

  async function handleSave() {
    if (!token) return;
    setSaving(true); setSaved(false);
    try {
      await adminPut('/api/admin/sally/settings', token, settings);
      setSaved(true); setTimeout(() => setSaved(false), 3000);
      toast({ title: de ? 'Einstellungen gespeichert' : 'Settings saved' });
    } catch { toast({ title: de ? 'Fehler beim Speichern' : 'Save failed', variant: 'destructive' }); }
    finally { setSaving(false); }
  }

  async function handleRunCron() {
    if (!token) return;
    setRunningCron(true); setCronResult(null);
    try {
      const res = await adminPost<{ ok: boolean; results: CronResult }>('/api/admin/sally/cron/run', token, {});
      setCronResult(res.results);
      toast({ title: de ? 'Cron-Jobs ausgef\u00fchrt' : 'Cron jobs executed' });
    } catch (err) { toast({ title: String(err), variant: 'destructive' }); }
    finally { setRunningCron(false); }
  }

  async function handleTestImap() {
    if (!token) return;
    setTestingImap(true); setImapTestResult(null);
    try {
      const result = await adminPost<{ ok: boolean; message: string }>('/api/admin/sally/imap/test', token, {
        host: settings.sally_imap_host, port: parseInt(settings.sally_imap_port || '993'),
        user: settings.sally_imap_user, pass: settings.sally_imap_pass,
        ...(settings.sally_imap_oauth_client_id && settings.sally_imap_oauth_tenant_id && settings.sally_imap_oauth_client_secret
          ? { oauthClientId: settings.sally_imap_oauth_client_id, oauthTenantId: settings.sally_imap_oauth_tenant_id, oauthClientSecret: settings.sally_imap_oauth_client_secret }
          : {}),
      });
      setImapTestResult(result);
    } catch (err) { setImapTestResult({ ok: false, message: String(err) }); }
    finally { setTestingImap(false); }
  }

  const hasOAuth = !!(settings.sally_imap_oauth_client_id && settings.sally_imap_oauth_tenant_id && settings.sally_imap_oauth_client_secret);

  const LANG_OPTIONS: { value: LangOption; de: string; en: string }[] = [
    { value: 'both', de: 'Zweisprachig (DE + EN)', en: 'Bilingual (DE + EN)' },
    { value: 'de',   de: 'Nur Deutsch',            en: 'German only' },
    { value: 'en',   de: 'Nur Englisch',           en: 'English only' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Save button row */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {de ? 'Alle speichern' : 'Save all'}
          {saved && <CheckCircle className="w-4 h-4 text-green-200" />}
        </Button>
      </div>

      {/* Automation controls */}
      <Card className={settings.sally_automation_enabled !== 'true' || settings.sally_auto_invoice_enabled !== 'true' ? 'border-amber-300 dark:border-amber-800' : undefined}>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PauseCircle className="w-4 h-4" />
            {de ? 'Automatisierung steuern' : 'Automation controls'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {de
              ? 'Pausieren Sie automatische Sally-Prozesse ohne die manuelle Funktion „Jetzt ausführen“ zu deaktivieren.'
              : 'Pause Sally’s scheduled automation without disabling the manual “Run now” action.'}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start justify-between gap-4 rounded-lg border p-4 cursor-pointer">
            <span className="space-y-1">
              <span className="block font-medium">{de ? 'Alle geplanten Prozesse aktiv' : 'All scheduled processes active'}</span>
              <span className="block text-sm text-muted-foreground">
                {de
                  ? 'Pausiert Follow-ups, Erinnerungen, Inbox-Polling, Bestellprüfung und automatische Rechnungsentwürfe.'
                  : 'Pauses follow-ups, reminders, inbox polling, order review, and automatic draft invoice creation.'}
              </span>
            </span>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={settings.sally_automation_enabled === 'true'}
              onChange={e => set('sally_automation_enabled', e.target.checked ? 'true' : 'false')}
              aria-label={de ? 'Alle geplanten Prozesse aktiv' : 'All scheduled processes active'}
            />
          </label>
          <label className="flex items-start justify-between gap-4 rounded-lg border p-4 cursor-pointer">
            <span className="space-y-1">
              <span className="block font-medium">{de ? 'Automatische Rechnungsentwürfe aus Bestellungen' : 'Automatic draft invoices from orders'}</span>
              <span className="block text-sm text-muted-foreground">
                {de
                  ? 'Verhindert neue automatische Rechnungsentwürfe aus bestätigten Online- und Portal-Bestellungen. Die Bestellung bleibt erhalten.'
                  : 'Prevents new automatic draft invoices from confirmed online and Portal orders. The order is kept.'}
              </span>
            </span>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={settings.sally_auto_invoice_enabled === 'true'}
              onChange={e => set('sally_auto_invoice_enabled', e.target.checked ? 'true' : 'false')}
              aria-label={de ? 'Automatische Rechnungsentwürfe aktiv' : 'Automatic draft invoices active'}
            />
          </label>
          {settings.sally_automation_enabled !== 'true' && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              {de ? 'Automatisierung ist pausiert. Änderungen werden mit „Alle speichern“ übernommen.' : 'Automation is paused. Changes take effect when you select “Save all”.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Identity */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4" />{de ? 'Sally \u2013 Identit\u00e4t' : 'Sally \u2013 Identity'}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{de ? 'Diese Angaben erscheinen im Absender-Feld und in der E-Mail-Signatur aller von Sally versendeten Nachrichten.' : "These details appear in the sender field and email signature of every message Sally sends."}</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label htmlFor="sally-name">{de ? 'Anzeigename' : 'Display name'}</Label><Input id="sally-name" value={settings.sally_from_name} onChange={e => set('sally_from_name', e.target.value)} placeholder="Sally" /></div>
            <div className="space-y-1.5"><Label htmlFor="sally-email">{de ? 'Absender-E-Mail-Adresse' : 'From email address'}</Label><Input id="sally-email" type="email" value={settings.sally_from_email} onChange={e => set('sally_from_email', e.target.value)} placeholder="sally@example.com" /><p className="text-xs text-muted-foreground">{de ? 'Empf\u00e4nger k\u00f6nnen direkt an diese Adresse antworten.' : 'Recipients can reply directly to this address.'}</p></div>
            <div className="space-y-1.5 col-span-2"><Label htmlFor="sally-escalation-email">{de ? 'Eskalations-E-Mail (Kundenservice)' : 'Escalation email (customer service)'}</Label><Input id="sally-escalation-email" type="email" value={settings.sally_escalation_email} onChange={e => set('sally_escalation_email', e.target.value)} placeholder="info@i-roc.de" /><p className="text-xs text-muted-foreground">{de ? 'Anfragen, die Sally nicht beantworten kann, werden an diese Adresse weitergeleitet.' : 'Inquiries Sally cannot answer are forwarded to this address.'}</p></div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <p className="font-medium mb-1">{de ? 'Signatur-Vorschau:' : 'Signature preview:'}</p>
            <pre className="text-muted-foreground font-sans text-xs leading-relaxed whitespace-pre-wrap">{[settings.sally_from_name || 'Sally', 'Sales Manager | iROC GmbH', settings.sally_from_email].filter(Boolean).join('\n')}</pre>
          </div>
        </CardContent>
      </Card>

      {/* Email Language */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Globe className="w-4 h-4" />{de ? 'E-Mail-Sprache' : 'Email Language'}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{de ? 'W\u00e4hlen Sie die Sprache f\u00fcr automatisch generierte E-Mails. Antworten werden immer in der Sprache und Form beantwortet, in der sie eingegangen sind.' : 'Choose the language for automatically generated emails. Replies are always answered in the same language and tone as received.'}</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>{de ? 'Erstkontakt-E-Mails' : 'First contact emails'}</Label>
              <Select value={settings.sally_lang_first_contact} onValueChange={v => set('sally_lang_first_contact', v as LangOption)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LANG_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{de ? o.de : o.en}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>{de ? 'Follow-up & Erinnerungen' : 'Follow-ups & reminders'}</Label>
              <Select value={settings.sally_lang_followup} onValueChange={v => set('sally_lang_followup', v as LangOption)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LANG_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{de ? o.de : o.en}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-blue-50 rounded-lg p-3"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-500" /><span>{de ? 'Eingehende Antworten werden per KI analysiert. Sally antwortet automatisch in der gleichen Sprache und im gleichen Stil (formell/informell) wie die empfangene Nachricht.' : 'Inbound replies are analysed by AI. Sally automatically responds in the same language and tone (formal/informal) as the received message.'}</span></div>
        </CardContent>
      </Card>

      {/* Bulk Discount */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Mail className="w-4 h-4" />{de ? '6-Monats-Aktionsrabatt' : '6-Month Bulk Promotion Discount'}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{de ? 'Dieser Rabatt wird in den automatisch generierten Promo-E-Mails an zertifizierte \u00c4rzte verwendet, die im Durchschnitt weniger als 5 Artikel pro Bestellung kaufen.' : 'This discount is used in automatically generated promo emails sent to certified doctors who order fewer than 5 items on average.'}</p>
          <div className="flex items-center gap-3 max-w-xs">
            <div className="flex-1 space-y-1"><Label htmlFor="discount-pct">{de ? 'Rabatt (%)' : 'Discount (%)'}</Label><Input id="discount-pct" type="number" min="1" max="100" step="1" value={settings.sally_bulk_discount_pct} onChange={e => set('sally_bulk_discount_pct', e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>

      {/* IMAP */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Wifi className="w-4 h-4" />{de ? 'Posteingang (Antworten empfangen)' : 'Inbox (Receive replies)'}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{de ? 'Sally kann den konfigurierten Posteingang per IMAP \u00fcberwachen und eingehende Antworten per KI beantworten (Entwurf zur Genehmigung). F\u00fcr Microsoft 365 aktivieren Sie SMTP-AUTH und erstellen Sie ein App-Passwort.' : 'Sally can monitor the configured inbox via IMAP and draft AI replies to incoming messages for your approval. For Microsoft 365, enable SMTP AUTH and create an App Password.'}</p>
          <div className="flex items-center gap-3">
            <button type="button" role="switch" aria-checked={settings.sally_imap_enabled === 'true'}
              onClick={() => set('sally_imap_enabled', settings.sally_imap_enabled === 'true' ? 'false' : 'true')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 ${settings.sally_imap_enabled === 'true' ? 'bg-primary' : 'bg-input'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${settings.sally_imap_enabled === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="text-sm font-medium">{settings.sally_imap_enabled === 'true' ? (de ? 'IMAP-Polling aktiv' : 'IMAP polling enabled') : (de ? 'IMAP-Polling deaktiviert' : 'IMAP polling disabled')}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label htmlFor="imap-host">{de ? 'IMAP-Host' : 'IMAP host'}</Label><Input id="imap-host" value={settings.sally_imap_host} onChange={e => set('sally_imap_host', e.target.value)} placeholder="outlook.office365.com" /></div>
            <div className="space-y-1.5"><Label htmlFor="imap-port">Port</Label><Input id="imap-port" type="number" value={settings.sally_imap_port} onChange={e => set('sally_imap_port', e.target.value)} placeholder="993" /></div>
            <div className="space-y-1.5"><Label htmlFor="imap-user">{de ? 'Benutzername / E-Mail' : 'Username / email'}</Label><Input id="imap-user" type="email" value={settings.sally_imap_user} onChange={e => set('sally_imap_user', e.target.value)} placeholder="sally@example.com" /></div>
            <div className="space-y-1.5">
              <Label htmlFor="imap-pass">{de ? 'Passwort / App-Passwort' : 'Password / App password'}{hasOAuth && <span className="ml-2 text-xs text-muted-foreground font-normal">({de ? 'optional bei OAuth2' : 'optional when using OAuth2'})</span>}</Label>
              <div className="relative"><Input id="imap-pass" type={showPass ? 'text' : 'password'} value={settings.sally_imap_pass} onChange={e => set('sally_imap_pass', e.target.value)} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" className="pr-10" />
                <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
            </div>
          </div>
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2"><span className="text-sm font-medium">OAuth2 / Modern Auth ({de ? 'optional' : 'optional'})</span>{hasOAuth && <span className="text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-medium">{de ? 'Aktiv' : 'Active'}</span>}</div>
            <p className="text-xs text-muted-foreground">{de ? 'Wenn alle drei Felder ausgef\u00fcllt sind, verwendet Sally OAuth2 statt des Passworts (empfohlen f\u00fcr Microsoft 365 Tenants, die Basic Auth deaktiviert haben).' : 'When all three fields are filled, Sally uses OAuth2 instead of the password \u2014 recommended for Microsoft 365 tenants that have disabled Basic Auth.'}</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label htmlFor="imap-oauth-client-id">{de ? 'Client-ID (App-ID)' : 'Client ID (App ID)'}</Label><Input id="imap-oauth-client-id" value={settings.sally_imap_oauth_client_id} onChange={e => set('sally_imap_oauth_client_id', e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></div>
              <div className="space-y-1.5"><Label htmlFor="imap-oauth-tenant-id">{de ? 'Tenant-ID (Verzeichnis-ID)' : 'Tenant ID (Directory ID)'}</Label><Input id="imap-oauth-tenant-id" value={settings.sally_imap_oauth_tenant_id} onChange={e => set('sally_imap_oauth_tenant_id', e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></div>
              <div className="col-span-2 space-y-1.5"><Label htmlFor="imap-oauth-secret">{de ? 'Client-Secret' : 'Client secret'}</Label>
                <div className="relative"><Input id="imap-oauth-secret" type={showOAuthSecret ? 'text' : 'password'} value={settings.sally_imap_oauth_client_secret} onChange={e => set('sally_imap_oauth_client_secret', e.target.value)} placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" className="pr-10" />
                  <button type="button" onClick={() => setShowOAuthSecret(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showOAuthSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleTestImap} disabled={testingImap || !settings.sally_imap_host || !settings.sally_imap_user || (!settings.sally_imap_pass && !hasOAuth)} className="gap-2">
              {testingImap ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
              {de ? 'Verbindung testen' : 'Test connection'}
            </Button>
            {imapTestResult && <span className={`flex items-center gap-1.5 text-sm ${imapTestResult.ok ? 'text-green-600' : 'text-destructive'}`}>{imapTestResult.ok ? <CheckCircle className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}{imapTestResult.message}</span>}
          </div>
          <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-800 space-y-1">
            <p className="font-semibold">{de ? 'Microsoft 365 Setup:' : 'Microsoft 365 setup:'}</p>
            <ol className="list-decimal ml-4 space-y-0.5">
              <li>{de ? 'Aktivieren Sie IMAP in den M365-Postfacheinstellungen.' : 'Enable IMAP in the M365 mailbox settings.'}</li>
              <li>{de ? 'Basic Auth (App-Passwort): SMTP-AUTH aktivieren und ein App-Passwort erstellen.' : 'Basic Auth (App Password): Enable SMTP AUTH and create an App Password.'}</li>
              <li>{de ? 'Modern Auth (OAuth2): App in Azure AD registrieren, IMAP.AccessAsUser.All-Berechtigung erteilen, Client-ID / Tenant-ID / Secret oben eintragen.' : 'Modern Auth (OAuth2): Register an app in Azure AD, grant IMAP.AccessAsUser.All permission, then enter Client ID / Tenant ID / Secret above.'}</li>
              <li>{de ? 'Verwenden Sie outlook.office365.com:993 als Host.' : 'Use outlook.office365.com:993 as the host.'}</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Learned lessons */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><GraduationCap className="w-4 h-4" />{de ? 'Gelernte Lektionen' : 'Learned Lessons'}{lessons.length > 0 && <span className="text-xs font-normal bg-muted rounded-full px-2 py-0.5">{lessons.length}</span>}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{de ? 'Wenn Sie einen E-Mail-Entwurf von Sally vor dem Senden korrigieren, lernt Sally daraus. Diese Regeln flie\u00dfen in alle zuk\u00fcnftigen Entw\u00fcrfe ein. L\u00f6schen Sie Lektionen, die nicht mehr gelten sollen.' : "When you correct one of Sally's email drafts before sending, Sally learns from it. These rules are applied to all future drafts. Delete lessons that should no longer apply."}</p>
          {lessons.length === 0
            ? <p className="text-sm text-muted-foreground italic">{de ? 'Noch keine Lektionen gelernt.' : 'No lessons learned yet.'}</p>
            : <div className="divide-y border rounded-lg">
                {lessons.map(l => (
                  <div key={l.id} className="px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <button type="button" onClick={() => setExpandedLesson(expandedLesson === l.id ? null : l.id)} className="text-left text-sm hover:text-primary transition-colors">{l.lesson}</button>
                        <p className="text-xs text-muted-foreground mt-0.5">{l.context} \u00b7 {new Date(l.created_at).toLocaleDateString(de ? 'de-DE' : 'en-GB')}</p>
                      </div>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={async () => { try { await adminDelete(`/api/admin/sally/lessons/${l.id}`, token!); setLessons(prev => prev.filter(x => x.id !== l.id)); toast({ title: de ? 'Lektion gel\u00f6scht' : 'Lesson deleted' }); } catch { toast({ title: de ? 'Fehler beim L\u00f6schen' : 'Delete failed', variant: 'destructive' }); } }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {expandedLesson === l.id && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="bg-red-50 rounded p-2"><p className="text-xs font-medium text-red-700 mb-1">{de ? 'Original' : 'Original'}</p><pre className="text-xs whitespace-pre-wrap font-sans text-muted-foreground max-h-40 overflow-y-auto">{l.original_text}</pre></div>
                        <div className="bg-green-50 rounded p-2"><p className="text-xs font-medium text-green-700 mb-1">{de ? 'Korrigiert' : 'Corrected'}</p><pre className="text-xs whitespace-pre-wrap font-sans text-muted-foreground max-h-40 overflow-y-auto">{l.corrected_text}</pre></div>
                      </div>
                    )}
                  </div>
                ))}
              </div>}
        </CardContent>
      </Card>

      {/* Manual cron */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><PlayCircle className="w-4 h-4" />{de ? 'Automatisierung manuell ausl\u00f6sen' : 'Trigger Automation Manually'}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{de ? 'Sally pr\u00fcft t\u00e4glich alle Leads und \u00c4rzte automatisch. Sie k\u00f6nnen die Pr\u00fcfung auch manuell ausl\u00f6sen.' : 'Sally checks all leads and doctors automatically every day. You can also trigger the check manually.'}</p>
          <Button onClick={handleRunCron} disabled={runningCron} variant="outline" className="gap-2">
            {runningCron ? <><Loader2 className="w-4 h-4 animate-spin" />{de ? 'L\u00e4uft\u2026' : 'Running\u2026'}</> : <><PlayCircle className="w-4 h-4" />{de ? 'Jetzt ausf\u00fchren' : 'Run Now'}</>}
          </Button>
          {cronResult && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
              <p className="font-medium">{de ? 'Ergebnisse:' : 'Results:'}</p>
              {(['leads', 'doctors', 'promo', 'orders'] as const).filter(k => cronResult[k] !== undefined).map(k => (
                <div key={k} className="flex items-center gap-2">
                  {cronResult[k] === 'ok' ? <CheckCircle className="w-4 h-4 text-green-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
                  <span className="capitalize text-muted-foreground">{k}:</span>
                  <span className={cronResult[k] === 'ok' ? 'text-green-700' : 'text-destructive'}>{cronResult[k]}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule info */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Info className="w-4 h-4" />{de ? 'Automatischer Zeitplan' : 'Automatic Schedule'}</CardTitle></CardHeader>
        <CardContent>
          <ul className="text-sm space-y-2 text-muted-foreground">
            <li className="flex gap-2"><span className="font-medium text-foreground min-w-[200px]">{de ? '4-Wochen Follow-up:' : '4-Week Follow-up:'}</span>{de ? 'Einmalig, 4 Wochen nach Erstkontakt (wenn nicht registriert)' : 'Once, 4 weeks after first contact (if not registered)'}</li>
            <li className="flex gap-2"><span className="font-medium text-foreground min-w-[200px]">{de ? '2-Monats-Erinnerung:' : '2-Month Reminder:'}</span>{de ? 'Alle 2 Monate (bis registriert oder abgebrochen)' : 'Every 2 months (until registered or cancelled)'}</li>
            <li className="flex gap-2"><span className="font-medium text-foreground min-w-[200px]">{de ? 'Arzt Check-in:' : 'Doctor Check-in:'}</span>{de ? 'Alle 2 Monate ohne Bestellung' : 'Every 2 months without an order'}</li>
            <li className="flex gap-2"><span className="font-medium text-foreground min-w-[200px]">{de ? '6-Monats-Promo:' : '6-Month Promo:'}</span>{de ? `Alle 6 Monate f\u00fcr \u00c4rzte mit \u00d8 < 5 Artikel/Bestellung (${settings.sally_bulk_discount_pct}% Rabatt)` : `Every 6 months for doctors with avg < 5 items/order (${settings.sally_bulk_discount_pct}% discount)`}</li>
            <li className="flex gap-2"><span className="font-medium text-foreground min-w-[200px]">{de ? 'Posteingang-Polling:' : 'Inbox polling:'}</span>{de ? 'Alle 6 Stunden (wenn aktiviert)' : 'Every 6 hours (when enabled)'}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Sally page ────────────────────────────────────────────────────────────

const TABS: { id: SallyTab; labelDe: string; labelEn: string; icon: React.ElementType }[] = [
  { id: 'leads',       labelDe: 'Leads',           labelEn: 'Leads',        icon: UserSearch },
  { id: 'doctors',     labelDe: 'Zertif. \u00c4rzte', labelEn: 'Doctors',     icon: Stethoscope },
  { id: 'email-queue', labelDe: 'E-Mail-Freigabe',  labelEn: 'Email Queue',  icon: Mail },
  { id: 'settings',    labelDe: 'Einstellungen',    labelEn: 'Settings',     icon: Settings },
];

function isSallyTab(value: string | undefined): value is SallyTab {
  return value === 'leads' || value === 'doctors' || value === 'email-queue' || value === 'settings';
}

export default function Sally() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const [, setLocation] = useLocation();
  const de = lang === 'de';
  const routedTab = isSallyTab(tabParam) ? tabParam : 'leads';
  const [tab, setTab] = useState<SallyTab>(routedTab);

  useEffect(() => {
    setTab(routedTab);
  }, [routedTab]);

  const selectTab = (nextTab: SallyTab) => {
    setTab(nextTab);
    setLocation(`/sally/${nextTab}`);
  };

  // Lightweight pending-count query for the tab badge
  const { data: pendingCount = 0 } = useQuery<number>({
    queryKey: [...SALLY_EMAIL_QUEUE_KEY, 'badge-count'],
    queryFn: async () => {
      const data = await adminGet<QueueItem[]>('/api/admin/sally/email-queue?status=pending', token!);
      return Array.isArray(data) ? data.length : 0;
    },
    enabled: !!token,
    refetchInterval: 30_000,
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-0">
        <div className="flex items-center gap-3 pb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
            <UserSearch className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Sally</h1>
            <p className="text-xs text-muted-foreground">{de ? 'Sales-Spezialistin \u2014 Leads, \u00c4rzte & E-Mail-Automatisierung' : 'Sales Specialist \u2014 Leads, Doctors & Email Automation'}</p>
          </div>
          {pendingCount > 0 && (
            <button onClick={() => selectTab('email-queue')} className="ml-auto flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 hover:bg-amber-100 transition-colors">
              <Mail className="h-3.5 w-3.5" />
              {pendingCount} {de ? 'ausstehend' : 'pending'}
            </button>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b">
          {TABS.map(t => (
            <button key={t.id} onClick={() => selectTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === t.id
                  ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
              )}>
              <t.icon className="h-3.5 w-3.5" />
              {de ? t.labelDe : t.labelEn}
              {t.id === 'email-queue' && pendingCount > 0 && (
                <span className="ml-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-blue-600 text-white text-[10px] font-bold px-1">
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'leads'       && <LeadsTab />}
        {tab === 'doctors'     && <DoctorsTab />}
        {tab === 'email-queue' && <SallyEmailQueue />}
        {tab === 'settings'    && <SettingsTab />}
      </div>
    </div>
  );
}
