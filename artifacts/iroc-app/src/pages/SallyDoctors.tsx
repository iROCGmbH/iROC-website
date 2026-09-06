import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminGet, adminPost, adminPut, adminDelete } from '@/lib/admin-fetch';
import { SALLY_DOCTORS_KEY, SALLY_IMPORT_DOCTORS_KEY } from '@/lib/query-keys';
import { Card, CardContent } from '@/components/ui/card';
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
import { Plus, MoreHorizontal, Pencil, Ban, Trash2, Stethoscope, Download } from 'lucide-react';

interface SallyDoctor {
  id: number;
  name: string;
  email: string;
  last_purchase_date: string | null;
  avg_items_per_order: number;
  is_cancelled: boolean;
  created_at: string;
}

interface ImportDoctorCandidate {
  tableId: number;
  source: 'trained_doctor' | 'website_customer';
  fullName: string;
  email: string;
  specialty: string | null;
  institutionName: string | null;
  city: string | null;
}

type Filter = 'active' | 'cancelled' | 'all';

function blank() {
  return { name: '', email: '', last_purchase_date: '', avg_items_per_order: 0, is_cancelled: false };
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function SallyDoctors() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SallyDoctor | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState(blank());

  // Import state — key is `${source}:${tableId}`
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
    mutationFn: (body: typeof form) => adminPost('/api/admin/sally/doctors', token!, {
      ...body,
      lastPurchaseDate: body.last_purchase_date || null,
      avgItemsPerOrder: body.avg_items_per_order,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_DOCTORS_KEY }); setIsNew(false); toast({ title: lang === 'de' ? 'Arzt hinzugefügt' : 'Doctor added' }); },
    onError: () => toast({ title: lang === 'de' ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<SallyDoctor> & { avgItemsPerOrder?: number; lastPurchaseDate?: string | null } }) =>
      adminPut(`/api/admin/sally/doctors/${id}`, token!, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_DOCTORS_KEY }); setEditing(null); toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' }); },
    onError: () => toast({ title: lang === 'de' ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminDelete(`/api/admin/sally/doctors/${id}`, token!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: SALLY_DOCTORS_KEY }); toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' }); },
    onError: () => toast({ title: lang === 'de' ? 'Fehler' : 'Error', variant: 'destructive' }),
  });

  const importMut = useMutation({
    mutationFn: (keys: string[]) => {
      const items = keys.map(k => {
        const [source, id] = k.split(':');
        return { source, tableId: parseInt(id) };
      });
      return adminPost('/api/admin/sally/import/doctors', token!, { items });
    },
    onSuccess: (data: { ok: boolean; imported: number }) => {
      qc.invalidateQueries({ queryKey: SALLY_DOCTORS_KEY });
      qc.invalidateQueries({ queryKey: SALLY_IMPORT_DOCTORS_KEY });
      setImportOpen(false);
      setSelectedKeys(new Set());
      toast({ title: lang === 'de' ? `${data.imported} Arzt/Ärzte importiert` : `${data.imported} doctor(s) imported` });
    },
    onError: () => toast({ title: lang === 'de' ? 'Import fehlgeschlagen' : 'Import failed', variant: 'destructive' }),
  });

  function candidateKey(c: ImportDoctorCandidate) { return `${c.source}:${c.tableId}`; }

  function toggleAll(checked: boolean) {
    setSelectedKeys(checked ? new Set(importCandidates.map(candidateKey)) : new Set());
  }
  function toggleOne(key: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const filtered = doctors.filter(d => {
    if (filter === 'active' && d.is_cancelled) return false;
    if (filter === 'cancelled' && !d.is_cancelled) return false;
    if (search) {
      const q = search.toLowerCase();
      return d.name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q);
    }
    return true;
  });

  function openEdit(doc: SallyDoctor) {
    setEditing(doc);
    setForm({
      name: doc.name, email: doc.email,
      last_purchase_date: doc.last_purchase_date ?? '',
      avg_items_per_order: doc.avg_items_per_order,
      is_cancelled: doc.is_cancelled,
    });
  }

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'active', label: lang === 'de' ? 'Aktiv' : 'Active' },
    { key: 'cancelled', label: lang === 'de' ? 'Abgebrochen' : 'Cancelled' },
    { key: 'all', label: lang === 'de' ? 'Alle' : 'All' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Stethoscope className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{lang === 'de' ? 'Sally – Zertifizierte Ärzte' : 'Sally – Certified Doctors'}</h1>
            <p className="text-sm text-muted-foreground">{lang === 'de' ? 'Bestellverlauf & Check-in-Verwaltung' : 'Purchase history & check-in management'}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setImportOpen(true); setSelectedKeys(new Set()); }}>
            <Download className="w-4 h-4 mr-1.5" />
            {lang === 'de' ? 'Aus iROC importieren' : 'Import from iROC'}
          </Button>
          <Button onClick={() => { setIsNew(true); setForm(blank()); }}>
            <Plus className="w-4 h-4 mr-1.5" />
            {lang === 'de' ? 'Arzt hinzufügen' : 'Add Doctor'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === f.key ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {f.label}
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({doctors.filter(d => f.key === 'all' ? true : f.key === 'active' ? !d.is_cancelled : d.is_cancelled).length})
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
                <TableHead>{lang === 'de' ? 'Letzter Kauf' : 'Last Purchase'}</TableHead>
                <TableHead>{lang === 'de' ? 'Tage her' : 'Days ago'}</TableHead>
                <TableHead>{lang === 'de' ? 'Ø Artikel/Bestellung' : 'Avg Items/Order'}</TableHead>
                <TableHead>{lang === 'de' ? 'Status' : 'Status'}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">{lang === 'de' ? 'Laden…' : 'Loading…'}</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">{lang === 'de' ? 'Keine Ärzte gefunden' : 'No doctors found'}</TableCell></TableRow>
              ) : filtered.map(doc => {
                const days = daysSince(doc.last_purchase_date);
                return (
                  <TableRow key={doc.id} className={doc.is_cancelled ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{doc.name}</TableCell>
                    <TableCell className="text-muted-foreground">{doc.email}</TableCell>
                    <TableCell>{formatDate(doc.last_purchase_date)}</TableCell>
                    <TableCell>
                      {days == null ? '—' : (
                        <span className={days >= 60 ? 'text-orange-600 font-medium' : ''}>
                          {days}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={doc.avg_items_per_order < 5 ? 'text-amber-600 font-medium' : ''}>
                        {doc.avg_items_per_order.toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {doc.is_cancelled
                        ? <Badge variant="destructive">{lang === 'de' ? 'Abgebrochen' : 'Cancelled'}</Badge>
                        : <Badge variant="outline">{lang === 'de' ? 'Aktiv' : 'Active'}</Badge>}
                    </TableCell>
                    <TableCell className="w-10">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="w-8 h-8"><MoreHorizontal className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(doc)}>
                            <Pencil className="w-4 h-4 mr-2" />{lang === 'de' ? 'Bearbeiten' : 'Edit'}
                          </DropdownMenuItem>
                          {!doc.is_cancelled && (
                            <DropdownMenuItem onClick={() => updateMut.mutate({ id: doc.id, body: { is_cancelled: true } })} className="text-orange-600">
                              <Ban className="w-4 h-4 mr-2" />{lang === 'de' ? 'Abbrechen' : 'Cancel'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => { if (confirm(lang === 'de' ? 'Wirklich löschen?' : 'Delete?')) deleteMut.mutate(doc.id); }} className="text-destructive">
                            <Trash2 className="w-4 h-4 mr-2" />{lang === 'de' ? 'Löschen' : 'Delete'}
                          </DropdownMenuItem>
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
          <DialogHeader>
            <DialogTitle>{lang === 'de' ? 'Zertifizierte Ärzte aus iROC importieren' : 'Import certified doctors from iROC'}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {importLoading ? (
              <p className="text-sm text-muted-foreground text-center py-8">{lang === 'de' ? 'Laden…' : 'Loading…'}</p>
            ) : importCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {lang === 'de' ? 'Alle iROC-Ärzte sind bereits in Sally vorhanden.' : 'All iROC doctors are already in Sally.'}
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                  <Checkbox
                    id="select-all-doctors"
                    checked={selectedKeys.size === importCandidates.length && importCandidates.length > 0}
                    onCheckedChange={(v) => toggleAll(!!v)}
                  />
                  <label htmlFor="select-all-doctors" className="text-sm font-medium cursor-pointer">
                    {lang === 'de' ? `Alle auswählen (${importCandidates.length})` : `Select all (${importCandidates.length})`}
                  </label>
                </div>
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {importCandidates.map(c => {
                    const key = candidateKey(c);
                    return (
                    <div key={key} className="flex items-center gap-3 px-2 py-2 rounded hover:bg-muted/50">
                      <Checkbox
                        id={`doctor-${key}`}
                        checked={selectedKeys.has(key)}
                        onCheckedChange={() => toggleOne(key)}
                      />
                      <label htmlFor={`doctor-${key}`} className="flex-1 cursor-pointer grid grid-cols-3 gap-2 text-sm">
                        <span className="font-medium truncate">{c.fullName}</span>
                        <span className="text-muted-foreground truncate">{c.email}</span>
                        <span className="text-muted-foreground truncate">{[c.city, c.specialty].filter(Boolean).join(' · ') || '—'}</span>
                      </label>
                    </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setSelectedKeys(new Set()); }}>
              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
            </Button>
            <Button
              disabled={selectedKeys.size === 0 || importMut.isPending}
              onClick={() => importMut.mutate(Array.from(selectedKeys))}
            >
              {importMut.isPending
                ? (lang === 'de' ? 'Importiere…' : 'Importing…')
                : (lang === 'de' ? `${selectedKeys.size} importieren` : `Import ${selectedKeys.size}`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit dialog */}
      <Dialog open={isNew || !!editing} onOpenChange={open => { if (!open) { setIsNew(false); setEditing(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? (lang === 'de' ? 'Arzt hinzufügen' : 'Add Doctor') : (lang === 'de' ? 'Arzt bearbeiten' : 'Edit Doctor')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{lang === 'de' ? 'Name' : 'Name'} *</Label>
                <Input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} placeholder="Dr. Max Mustermann" />
              </div>
              <div className="space-y-1.5">
                <Label>E-Mail *</Label>
                <Input type="email" value={form.email} onChange={e => setForm(v => ({ ...v, email: e.target.value }))} placeholder="arzt@klinik.de" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{lang === 'de' ? 'Letzter Kaufdatum' : 'Last Purchase Date'}</Label>
                <Input type="date" value={form.last_purchase_date} onChange={e => setForm(v => ({ ...v, last_purchase_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>{lang === 'de' ? 'Ø Artikel/Bestellung' : 'Avg Items/Order'}</Label>
                <Input type="number" min="0" step="0.1" value={form.avg_items_per_order}
                  onChange={e => setForm(v => ({ ...v, avg_items_per_order: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsNew(false); setEditing(null); }}>
              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
            </Button>
            <Button
              disabled={!form.name.trim() || !form.email.trim() || createMut.isPending || updateMut.isPending}
              onClick={() => {
                const body = {
                  name: form.name, email: form.email,
                  lastPurchaseDate: form.last_purchase_date || null,
                  avgItemsPerOrder: form.avg_items_per_order,
                };
                if (isNew) createMut.mutate(form);
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
