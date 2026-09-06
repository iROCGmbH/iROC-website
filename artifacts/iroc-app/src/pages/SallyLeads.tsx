import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminGet, adminPost, adminPut, adminDelete } from '@/lib/admin-fetch';
import { SALLY_IMPORT_LEADS_KEY, SALLY_LEADS_KEY } from '@/lib/query-keys';
import {
  Card, CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, MoreHorizontal, Pencil, CheckSquare, Ban, Trash2, UserSearch, Download, RefreshCw } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

interface SallyLead {
  id: number;
  name: string;
  email: string;
  product_interest_group: string;
  first_contact_date: string | null;
  training_registered: boolean;
  is_cancelled: boolean;
  created_at: string;
}

interface ImportLeadCandidate {
  id: number;
  full_name: string;
  email: string;
  specialty: string | null;
  first_contact_date: string | null;
  status: string;
}

type Filter = 'active' | 'cancelled' | 'registered' | 'all';

function blank(): Omit<SallyLead, 'id' | 'created_at'> {
  return {
    name: '', email: '', product_interest_group: '',
    first_contact_date: new Date().toISOString().slice(0, 10),
    training_registered: false, is_cancelled: false,
  };
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function toLeadPayload(form: ReturnType<typeof blank>) {
  return {
    name: form.name,
    email: form.email,
    productInterestGroup: form.product_interest_group,
    firstContactDate: form.first_contact_date || undefined,
    trainingRegistered: form.training_registered,
    isCancelled: form.is_cancelled,
  };
}

export default function SallyLeads() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SallyLead | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(blank());

  // Import state
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
    mutationFn: (body: ReturnType<typeof toLeadPayload>) => adminPost('/api/admin/sally/leads', token!, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_LEADS_KEY }); setIsNew(false); toast({ title: lang === 'de' ? 'Lead hinzugefügt' : 'Lead added' }); },
    onError: () => toast({ title: lang === 'de' ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<ReturnType<typeof toLeadPayload>> }) =>
      adminPut(`/api/admin/sally/leads/${id}`, token!, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_LEADS_KEY }); setEditing(null); toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' }); },
    onError: () => toast({ title: lang === 'de' ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminDelete(`/api/admin/sally/leads/${id}`, token!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_LEADS_KEY }); toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' }); },
    onError: () => toast({ title: lang === 'de' ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const importMut = useMutation({
    mutationFn: (ids: number[]) => adminPost('/api/admin/sally/import/leads', token!, { ids }),
    onSuccess: (data: { ok: boolean; imported: number }) => {
      qc.invalidateQueries({ queryKey: SALLY_LEADS_KEY });
      qc.invalidateQueries({ queryKey: SALLY_IMPORT_LEADS_KEY });
      setImportOpen(false);
      setSelectedIds(new Set());
      toast({ title: lang === 'de' ? `${data.imported} Lead(s) importiert` : `${data.imported} lead(s) imported` });
    },
    onError: () => toast({ title: lang === 'de' ? 'Import fehlgeschlagen' : 'Import failed', variant: 'destructive' }),
  });

  const reclassifyMut = useMutation({
    mutationFn: () => adminPost('/api/admin/sally/leads/reclassify', token!, {}),
    onSuccess: (data: { ok: boolean; updated: number }) => {
      qc.invalidateQueries({ queryKey: SALLY_LEADS_KEY });
      toast({
        title: lang === 'de'
          ? `${data.updated} Lead(s) neu klassifiziert`
          : `${data.updated} lead(s) re-classified`,
      });
    },
    onError: () => toast({ title: lang === 'de' ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(importCandidates.map(c => c.id)) : new Set());
  }
  function toggleOne(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

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
    setForm({
      name: lead.name, email: lead.email,
      product_interest_group: lead.product_interest_group,
      first_contact_date: lead.first_contact_date ?? '',
      training_registered: lead.training_registered,
      is_cancelled: lead.is_cancelled,
    });
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'active', label: lang === 'de' ? 'Aktiv' : 'Active' },
    { key: 'registered', label: lang === 'de' ? 'Registriert' : 'Registered' },
    { key: 'cancelled', label: lang === 'de' ? 'Abgebrochen' : 'Cancelled' },
    { key: 'all', label: lang === 'de' ? 'Alle' : 'All' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserSearch className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{lang === 'de' ? 'Sally – Leads' : 'Sally – Leads'}</h1>
            <p className="text-sm text-muted-foreground">{lang === 'de' ? 'Interessenten & Follow-up-Verwaltung' : 'Prospect & follow-up management'}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={reclassifyMut.isPending}
            onClick={() => {
              if (confirm(lang === 'de'
                ? 'Alle Leads mit nicht-kanonischer Produktgruppe neu klassifizieren?'
                : 'Re-classify all leads with a non-canonical product group?'))
                reclassifyMut.mutate();
            }}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${reclassifyMut.isPending ? 'animate-spin' : ''}`} />
            {lang === 'de' ? 'Neu klassifizieren' : 'Re-classify'}
          </Button>
          <Button variant="outline" onClick={() => { setImportOpen(true); setSelectedIds(new Set()); }}>
            <Download className="w-4 h-4 mr-1.5" />
            {lang === 'de' ? 'Aus iROC importieren' : 'Import from iROC'}
          </Button>
          <Button onClick={() => { setIsNew(true); setForm(blank()); }}>
            <Plus className="w-4 h-4 mr-1.5" />
            {lang === 'de' ? 'Lead hinzufügen' : 'Add Lead'}
          </Button>
        </div>
      </div>

      {/* Filter + Search bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === f.key ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {f.label}
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({leads.filter(l =>
                  f.key === 'all' ? true :
                  f.key === 'active' ? (!l.is_cancelled && !l.training_registered) :
                  f.key === 'cancelled' ? l.is_cancelled :
                  l.training_registered
                ).length})
              </span>
            </button>
          ))}
        </div>
        <div className="flex-1">
          <Input placeholder={lang === 'de' ? 'Suchen…' : 'Search…'} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{lang === 'de' ? 'Name' : 'Name'}</TableHead>
                <TableHead>E-Mail</TableHead>
                <TableHead>{lang === 'de' ? 'Produktgruppe' : 'Product Group'}</TableHead>
                <TableHead>{lang === 'de' ? 'Erstkontakt' : 'First Contact'}</TableHead>
                <TableHead>{lang === 'de' ? 'Schulung' : 'Training'}</TableHead>
                <TableHead>{lang === 'de' ? 'Status' : 'Status'}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  {lang === 'de' ? 'Laden…' : 'Loading…'}
                </TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  {lang === 'de' ? 'Keine Leads gefunden' : 'No leads found'}
                </TableCell></TableRow>
              ) : filtered.map(lead => (
                <TableRow key={lead.id} className={lead.is_cancelled ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{lead.name}</TableCell>
                  <TableCell className="text-muted-foreground">{lead.email}</TableCell>
                  <TableCell>{
                    lead.product_interest_group === 'spirecut' ? `Spirecut (${lang === 'de' ? 'Handchirurgie' : 'Hand Surgery'})` :
                    lead.product_interest_group === 'ministem' ? 'MiniStem / Jointechlabs (MFAT / SVF)' :
                    lead.product_interest_group === 'cellenis' ? `Cellenis / Estar Medical (PRP, PRF, ${lang === 'de' ? 'Exosomen' : 'Exosomes'})` :
                    lead.product_interest_group || '—'
                  }</TableCell>
                  <TableCell>{formatDate(lead.first_contact_date)}</TableCell>
                  <TableCell>
                    {lead.training_registered
                      ? <Badge variant="default" className="bg-green-100 text-green-800">{lang === 'de' ? 'Ja' : 'Yes'}</Badge>
                      : <Badge variant="secondary">{lang === 'de' ? 'Nein' : 'No'}</Badge>}
                  </TableCell>
                  <TableCell>
                    {lead.is_cancelled
                      ? <Badge variant="destructive">{lang === 'de' ? 'Abgebrochen' : 'Cancelled'}</Badge>
                      : <Badge variant="outline">{lang === 'de' ? 'Aktiv' : 'Active'}</Badge>}
                  </TableCell>
                  <TableCell className="w-10">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="w-8 h-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(lead)}>
                          <Pencil className="w-4 h-4 mr-2" />{lang === 'de' ? 'Bearbeiten' : 'Edit'}
                        </DropdownMenuItem>
                        {!lead.training_registered && (
                          <DropdownMenuItem onClick={() => updateMut.mutate({ id: lead.id, body: { trainingRegistered: true } })}>
                            <CheckSquare className="w-4 h-4 mr-2" />{lang === 'de' ? 'Als registriert markieren' : 'Mark as registered'}
                          </DropdownMenuItem>
                        )}
                        {!lead.is_cancelled && (
                          <DropdownMenuItem onClick={() => updateMut.mutate({ id: lead.id, body: { isCancelled: true } })} className="text-orange-600">
                            <Ban className="w-4 h-4 mr-2" />{lang === 'de' ? 'Abbrechen' : 'Cancel'}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => { if (confirm(lang === 'de' ? 'Wirklich löschen?' : 'Delete?')) deleteMut.mutate(lead.id); }} className="text-destructive">
                          <Trash2 className="w-4 h-4 mr-2" />{lang === 'de' ? 'Löschen' : 'Delete'}
                        </DropdownMenuItem>
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
          <DialogHeader>
            <DialogTitle>{lang === 'de' ? 'Leads aus iROC importieren' : 'Import leads from iROC'}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {importLoading ? (
              <p className="text-sm text-muted-foreground text-center py-8">{lang === 'de' ? 'Laden…' : 'Loading…'}</p>
            ) : importCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {lang === 'de' ? 'Alle iROC-Leads sind bereits in Sally vorhanden.' : 'All iROC leads are already in Sally.'}
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                  <Checkbox
                    id="select-all-leads"
                    checked={selectedIds.size === importCandidates.length && importCandidates.length > 0}
                    onCheckedChange={(v) => toggleAll(!!v)}
                  />
                  <label htmlFor="select-all-leads" className="text-sm font-medium cursor-pointer">
                    {lang === 'de' ? `Alle auswählen (${importCandidates.length})` : `Select all (${importCandidates.length})`}
                  </label>
                </div>
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {importCandidates.map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-muted/50">
                      <Checkbox
                        id={`lead-${c.id}`}
                        checked={selectedIds.has(c.id)}
                        onCheckedChange={() => toggleOne(c.id)}
                      />
                      <label htmlFor={`lead-${c.id}`} className="flex-1 cursor-pointer grid grid-cols-3 gap-2 text-sm">
                        <span className="font-medium truncate">{c.full_name}</span>
                        <span className="text-muted-foreground truncate">{c.email}</span>
                        <span className="text-muted-foreground truncate">{c.specialty || '—'}</span>
                      </label>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setSelectedIds(new Set()); }}>
              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
            </Button>
            <Button
              disabled={selectedIds.size === 0 || importMut.isPending}
              onClick={() => importMut.mutate(Array.from(selectedIds))}
            >
              {importMut.isPending
                ? (lang === 'de' ? 'Importiere…' : 'Importing…')
                : (lang === 'de' ? `${selectedIds.size} importieren` : `Import ${selectedIds.size}`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit dialog */}
      <Dialog open={isNew || !!editing} onOpenChange={open => { if (!open) { setIsNew(false); setEditing(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? (lang === 'de' ? 'Lead hinzufügen' : 'Add Lead') : (lang === 'de' ? 'Lead bearbeiten' : 'Edit Lead')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{lang === 'de' ? 'Name' : 'Name'} *</Label>
                <Input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} placeholder="Dr. Anna Müller" />
              </div>
              <div className="space-y-1.5">
                <Label>E-Mail *</Label>
                <Input type="email" value={form.email} onChange={e => setForm(v => ({ ...v, email: e.target.value }))} placeholder="name@praxis.de" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{lang === 'de' ? 'Produktgruppe' : 'Product Group'}</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.product_interest_group}
                onChange={e => setForm(v => ({ ...v, product_interest_group: e.target.value }))}
              >
                <option value="">{lang === 'de' ? 'Allgemein / nicht zugeordnet' : 'General / unassigned'}</option>
                <option value="spirecut">Spirecut ({lang === 'de' ? 'Handchirurgie' : 'Hand Surgery'})</option>
                <option value="ministem">MiniStem / Jointechlabs (MFAT / SVF)</option>
                <option value="cellenis">Cellenis / Estar Medical (PRP, PRF, {lang === 'de' ? 'Exosomen' : 'Exosomes'})</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>{lang === 'de' ? 'Erstkontaktdatum' : 'First Contact Date'}</Label>
              <Input
                type="date"
                value={form.first_contact_date ?? ''}
                onChange={e => setForm(v => ({ ...v, first_contact_date: e.target.value }))}
                onInput={e => setForm(v => ({ ...v, first_contact_date: e.currentTarget.value }))}
              />
            </div>
            {editing && (
              <div className="flex items-center gap-3">
                <Switch checked={form.training_registered} onCheckedChange={v => setForm(f => ({ ...f, training_registered: v }))} id="tr-switch" />
                <Label htmlFor="tr-switch">{lang === 'de' ? 'Schulung registriert' : 'Training registered'}</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsNew(false); setEditing(null); }}>
              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
            </Button>
            <Button
              disabled={!form.name.trim() || !form.email.trim() || createMut.isPending || updateMut.isPending}
              onClick={() => {
                const body = toLeadPayload(form);
                if (isNew) createMut.mutate(body);
                else if (editing) updateMut.mutate({ id: editing.id, body });
              }}
            >
              {lang === 'de' ? 'Speichern' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
