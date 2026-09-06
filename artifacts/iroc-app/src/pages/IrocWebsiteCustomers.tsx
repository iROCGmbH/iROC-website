import { useState, useEffect, useRef } from 'react';
import { useSearch } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Building2, Loader2, Globe, Search, Trash2, ChevronUp, ChevronDown, Pencil, X, KeyRound } from 'lucide-react';
import { adminGet, adminDelete, adminPatch, adminPost } from '@/lib/admin-fetch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';


interface Customer {
  id: number;
  customerNr: string | null;
  reorderCode: string | null;
  salutation: string | null;
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  specialty: string | null;
  institutionName: string | null;
  institutionType: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  fax: string | null;
  email: string;
  website: string | null;
  referenceNumber: string | null;
  isPublicAuthority: boolean;
  defaultBuyerReference: string | null;
  ustIdNr: string | null;
  instrument: string;
  certifications?: string[];
  notes: string | null;
  shippingFirstName: string | null;
  shippingLastName: string | null;
  shippingInstitutionName: string | null;
  shippingAddress: string | null;
  shippingPostalCode: string | null;
  shippingCity: string | null;
  shippingCountry: string | null;
  shippingPhone: string | null;
  shippingEmail: string | null;
  createdAt: string;
}

type EditState = Omit<Customer, 'createdAt' | 'certifications'> & {
  certifications: string[];
};

const fieldCls = 'flex flex-col gap-1';
const labelCls = 'text-xs font-semibold text-muted-foreground uppercase tracking-wide';
const inputCls = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function customerCertifications(customer: Pick<Customer, 'certifications' | 'instrument'>): string[] {
  if (customer.certifications && customer.certifications.length > 0) return customer.certifications;
  if (customer.instrument === 'both') return ['spirecut', 'ministem'];
  return customer.instrument.split(',').map((value) => value.trim()).filter(Boolean);
}

export default function IrocWebsiteCustomers() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { irocUrl } = useSiteUrls();
  const { toast } = useToast();
  const searchString = useSearch();
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const urlParams = new URLSearchParams(searchString);
  const highlightId = Number(urlParams.get('highlight') ?? 0) || null;
  const urlSearch = urlParams.get('search') ?? '';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(urlSearch);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  useEffect(() => {
    if (!token) return;
    adminGet<Customer[]>('/api/admin/customers', token)
      .then(setCustomers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  // Auto-expand and scroll to the highlighted customer once data is loaded
  useEffect(() => {
    if (!highlightId || loading) return;
    setExpanded(highlightId);
    // Give the DOM a tick to render the expanded row before scrolling
    requestAnimationFrame(() => {
      const el = rowRefs.current.get(highlightId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [highlightId, loading]);

  const handleDelete = async (id: number) => {
    if (!confirm(lang === 'de' ? 'Diesen Kunden wirklich löschen?' : 'Really delete this customer?')) return;
    try {
      await adminDelete(`/api/admin/customers/${id}`, token!);
      setCustomers((c) => c.filter((x) => x.id !== id));
      toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Löschen' : 'Error deleting' });
    }
  };

  const openEdit = (c: Customer) => setEditing({
    ...c,
    certifications: customerCertifications(c),
  });

  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const handleRegenerateCode = async (id: number) => {
    if (!token) return;
    if (!confirm(lang === 'de'
      ? 'Neuen Bestellcode generieren? Der alte Code wird ungültig.'
      : 'Generate a new reorder code? The old code becomes invalid.')) return;
    setRegeneratingId(id);
    try {
      const { reorderCode } = await adminPost<{ reorderCode: string }>(`/api/iroc/website-customers/${id}/reorder-code`, token, {});
      setCustomers(cs => cs.map(c => c.id === id ? { ...c, reorderCode } : c));
      toast({ title: lang === 'de' ? 'Neuer Bestellcode generiert' : 'New reorder code generated' });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' });
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleEditSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || !token) return;
    setEditSaving(true);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {};
    for (const key of fd.keys()) payload[key] = (fd.get(key) as string) || null;
    payload.certifications = editing.certifications;
    payload.isPublicAuthority = editing.isPublicAuthority;
    try {
      const updated = await adminPatch<Customer>(`/api/admin/customers/${editing.id}`, token, payload);
      setCustomers(cs => cs.map(c => c.id === editing.id ? { ...c, ...updated } : c));
      setEditing(null);
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error saving' });
    } finally {
      setEditSaving(false);
    }
  };

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      `${c.firstName ?? ''} ${c.lastName ?? ''}`.toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.institutionName ?? '').toLowerCase().includes(q) ||
      (c.city ?? '').toLowerCase().includes(q) ||
      (c.customerNr ?? '').toLowerCase().includes(q);
    const isMissing = !c.reorderCode?.trim();
    return matchesSearch && (!showMissingOnly || isMissing);
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim().toLowerCase();
    const bv = `${b.firstName ?? ''} ${b.lastName ?? ''}`.trim().toLowerCase();
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const allIds = sorted.map((c) => c.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const missingCustomers = customers.filter((c) => !c.reorderCode?.trim());
  const selectedMissingIds = [...selectedIds].filter((id) =>
    customers.some((c) => c.id === id && !c.reorderCode?.trim()),
  );
  const toggleSelect = (id: number) => setSelectedIds((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(allIds));

  const handleBackfillCodes = async () => {
    if (!token || selectedMissingIds.length === 0) return;
    const count = selectedMissingIds.length;
    const confirmed = confirm(lang === 'de'
      ? `${count} Kunden ohne Bestellcode mit einem eindeutigen Code ausstatten? Bereits vorhandene Codes bleiben unverändert.`
      : `Assign a unique reorder code to ${count} customer(s) without one? Existing codes will not be changed.`);
    if (!confirmed) return;

    setBackfilling(true);
    try {
      const result = await adminPost<{
        assigned: number;
        skipped: number;
        notFound: number;
      }>('/api/iroc/website-customers/reorder-codes', token, { customerIds: selectedMissingIds });
      const refreshed = await adminGet<Customer[]>('/api/admin/customers', token);
      setCustomers(refreshed);
      setSelectedIds(new Set());
      const skipped = result.skipped + result.notFound;
      toast({
        title: lang === 'de'
          ? `${result.assigned} Bestellcode(s) zugewiesen${skipped ? `, ${skipped} übersprungen` : ''}`
          : `${result.assigned} reorder code(s) assigned${skipped ? `, ${skipped} skipped` : ''}`,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'Bestellcodes konnten nicht zugewiesen werden' : 'Could not assign reorder codes',
      });
    } finally {
      setBackfilling(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!token || selectedIds.size === 0) return;
    if (!confirm(lang === 'de' ? `${selectedIds.size} Kunden wirklich löschen?` : `Really delete ${selectedIds.size} customer(s)?`)) return;
    setDeleting(true);
    for (const id of selectedIds) {
      await adminDelete(`/api/admin/customers/${id}`, token!).catch(() => {});
    }
    setCustomers((c) => c.filter((x) => !selectedIds.has(x.id)));
    setSelectedIds(new Set());
    setDeleting(false);
    toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Website-Kunden' : 'Website Customers'}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de' ? 'Registrierungen über das Bestellformular' : 'Registrations via the order form'}
          </p>
        </div>
        <a href={irocUrl} target="_blank" rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
          <Globe className="w-4 h-4" />
          {lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
        </a>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          { label: lang === 'de' ? 'Gesamt' : 'Total', value: customers.length },
          { label: 'Spirecut®', value: customers.filter((c) => c.instrument === 'spirecut').length },
          { label: 'MiniStem®', value: customers.filter((c) => c.instrument === 'ministem').length },
          { label: lang === 'de' ? 'Ohne Bestellcode' : 'Missing code', value: missingCustomers.length },
        ].map((s) => (
          <div key={s.label} className="bg-card border rounded-xl p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-primary">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search + sort + bulk */}
      <div className="flex items-center gap-2 flex-wrap">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={lang === 'de' ? 'Name, E-Mail, Institution …' : 'Name, email, institution …'}
          className="max-w-sm" />
        <button onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1 bg-card">
          {lang === 'de' ? 'Name' : 'Name'} {sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <span className="text-sm text-muted-foreground">{sorted.length} {lang === 'de' ? 'Einträge' : 'entries'}</span>
        <Button
          variant={showMissingOnly ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowMissingOnly((value) => !value)}
          className="h-7 gap-1.5 text-xs"
        >
          <KeyRound className="h-3.5 w-3.5" />
          {showMissingOnly
            ? (lang === 'de' ? 'Alle Kunden' : 'All customers')
            : (lang === 'de' ? `Ohne Bestellcode (${missingCustomers.length})` : `Missing code (${missingCustomers.length})`)}
        </Button>
        {selectedIds.size > 0 && (
          <>
            <span className="ml-2 text-sm font-medium text-destructive">{selectedIds.size} {lang === 'de' ? 'ausgewählt' : 'selected'}</span>
            <Button size="sm" variant="destructive" disabled={deleting} onClick={handleBulkDelete} className="gap-1.5 h-7">
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? (lang === 'de' ? 'Lösche…' : 'Deleting…') : `${lang === 'de' ? 'Löschen' : 'Delete'} (${selectedIds.size})`}
            </Button>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground">
              {lang === 'de' ? 'Aufheben' : 'Clear'}
            </button>
          </>
        )}
        {selectedMissingIds.length > 0 && (
          <Button
            size="sm"
            variant="default"
            disabled={backfilling}
            onClick={handleBackfillCodes}
            className="h-7 gap-1.5 text-xs"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {backfilling
              ? (lang === 'de' ? 'Zuweisen…' : 'Assigning…')
              : (lang === 'de' ? `Bestellcodes zuweisen (${selectedMissingIds.length})` : `Assign missing codes (${selectedMissingIds.length})`)}
          </Button>
        )}
        {allIds.length > 0 && (
          <Button variant="outline" size="sm" onClick={toggleAll} className="ml-auto h-7 gap-1.5 text-xs">
            {allSelected ? (lang === 'de' ? 'Auswahl aufheben' : 'Deselect all') : (lang === 'de' ? 'Alle auswählen' : 'Select all')}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          {sorted.length === 0 ? (
            <p className="text-center py-16 text-muted-foreground text-sm">
              {lang === 'de' ? 'Keine Einträge gefunden.' : 'No entries found.'}
            </p>
          ) : (
            <div className="divide-y">
              {sorted.map((c) => (
                <div
                  key={c.id}
                  ref={(el) => { if (el) rowRefs.current.set(c.id, el); else rowRefs.current.delete(c.id); }}
                  className={`px-5 py-4 transition-colors cursor-pointer ${
                    highlightId === c.id
                      ? 'bg-indigo-50 ring-2 ring-indigo-300 ring-inset'
                      : selectedIds.has(c.id)
                      ? 'bg-muted/40'
                      : 'hover:bg-muted/20'
                  }`}
                  onClick={() => toggleSelect(c.id)}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={selectedIds.has(c.id)}
                      onCheckedChange={() => toggleSelect(c.id)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={lang === 'de' ? `Kunde ${c.id} auswählen` : `Select customer ${c.id}`}
                    />
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded shrink-0 ${c.instrument === 'spirecut' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                      {c.instrument}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">
                        {[c.title, c.firstName, c.lastName].filter(Boolean).join(' ')}
                        {c.customerNr && <span className="ml-2 text-xs text-muted-foreground font-mono">#{c.customerNr}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[c.email, c.institutionName, c.city, c.country].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground hidden md:block shrink-0">
                      {new Date(c.createdAt).toLocaleDateString('de-DE')}
                    </span>
                    <button onClick={e => { e.stopPropagation(); setExpanded(expanded === c.id ? null : c.id); }}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted">
                      {expanded === c.id ? '▲' : '▼'}
                    </button>
                    <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); openEdit(c); }}
                      className="text-muted-foreground hover:text-foreground shrink-0" title={lang === 'de' ? 'Bearbeiten' : 'Edit'}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {expanded === c.id && (
                    <div className="mt-3 pt-3 border-t space-y-2 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-muted-foreground">{lang === 'de' ? 'Bestellcode:' : 'Reorder Code:'}</span>
                        <span className="font-mono font-bold text-sm bg-muted px-2 py-0.5 rounded">
                          {c.reorderCode ?? '—'}
                        </span>
                        <Button size="sm" variant="outline" className="h-6 text-xs"
                          disabled={regeneratingId === c.id}
                          onClick={() => handleRegenerateCode(c.id)}>
                          {regeneratingId === c.id
                            ? (lang === 'de' ? 'Generiere…' : 'Generating…')
                            : (lang === 'de' ? 'Neu generieren' : 'Regenerate')}
                        </Button>
                        <span className="text-muted-foreground">
                          {lang === 'de'
                            ? 'Wird auf Rechnungen gedruckt; für Bestellungen mit Kundennummer.'
                            : 'Printed on invoices; used together with the customer number for reorders.'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                        {[
                          [lang === 'de' ? 'E-Mail' : 'Email', c.email],
                          [lang === 'de' ? 'Telefon' : 'Phone', c.phone],
                          [lang === 'de' ? 'Rechnungsadresse' : 'Billing Address', c.address],
                          ['PLZ', c.postalCode],
                          [lang === 'de' ? 'Stadt' : 'City', c.city],
                          [lang === 'de' ? 'Land' : 'Country', c.country],
                          [lang === 'de' ? 'Fachgebiet' : 'Specialty', c.specialty],
                          [lang === 'de' ? 'Institution' : 'Institution', c.institutionName],
                          ['USt-IdNr.', c.ustIdNr],
                          [lang === 'de' ? 'Notizen' : 'Notes', c.notes],
                        ].map(([label, val]) =>
                          val ? (
                            <div key={label as string}>
                              <span className="text-muted-foreground">{label}: </span>
                              <span className="font-medium">{val}</span>
                            </div>
                          ) : null
                        )}
                      </div>
                      {(c.shippingFirstName || c.shippingAddress) && (
                        <div className="pt-1 border-t">
                          <p className="text-muted-foreground font-semibold mb-1">{lang === 'de' ? 'Lieferadresse:' : 'Shipping Address:'}</p>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                            {[
                              [lang === 'de' ? 'Vorname' : 'First Name', c.shippingFirstName],
                              [lang === 'de' ? 'Nachname' : 'Last Name', c.shippingLastName],
                              [lang === 'de' ? 'Institution' : 'Institution', c.shippingInstitutionName],
                              [lang === 'de' ? 'Straße' : 'Street', c.shippingAddress],
                              ['PLZ', c.shippingPostalCode],
                              [lang === 'de' ? 'Stadt' : 'City', c.shippingCity],
                              [lang === 'de' ? 'Land' : 'Country', c.shippingCountry],
                              ['E-Mail', c.shippingEmail],
                              [lang === 'de' ? 'Telefon' : 'Phone', c.shippingPhone],
                            ].map(([label, val]) =>
                              val ? (
                                <div key={label as string}>
                                  <span className="text-muted-foreground">{label}: </span>
                                  <span className="font-medium">{val}</span>
                                </div>
                              ) : null
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{lang === 'de' ? 'Kunden bearbeiten' : 'Edit Customer'}</h2>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleEditSave} className="space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1">{lang === 'de' ? 'Kontakt' : 'Contact'}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Kunden-Nr.' : 'Customer Nr.'}</label><input name="customerNr" defaultValue={editing.customerNr ?? ''} className={inputCls} /></div>
                <div className={fieldCls}>
                  <label className={labelCls}>{lang === 'de' ? 'Anrede' : 'Salutation'}</label>
                  <select name="salutation" defaultValue={editing.salutation ?? ''} className={inputCls}>
                    <option value="">—</option>
                    <option value="Herr">{lang === 'de' ? 'Herr' : 'Mr'}</option>
                    <option value="Frau">{lang === 'de' ? 'Frau' : 'Mrs'}</option>
                    <option value="Divers">{lang === 'de' ? 'Divers' : 'Diverse'}</option>
                  </select>
                </div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Akad. Titel' : 'Degree'}</label><input name="title" defaultValue={editing.title ?? ''} className={inputCls} placeholder="Dr., Prof., …" /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Vorname' : 'First Name'}</label><input name="firstName" defaultValue={editing.firstName ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Nachname' : 'Last Name'}</label><input name="lastName" defaultValue={editing.lastName ?? ''} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className={`${fieldCls} md:col-span-2`}><label className={labelCls}>{lang === 'de' ? 'Institution / Praxis' : 'Institution / Practice'}</label><input name="institutionName" defaultValue={editing.institutionName ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Fachgebiet' : 'Specialty'}</label><input name="specialty" defaultValue={editing.specialty ?? ''} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className={fieldCls}><label className={labelCls}>E-Mail *</label><input name="email" type="email" defaultValue={editing.email} required className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Telefon' : 'Phone'}</label><input name="phone" defaultValue={editing.phone ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>Fax</label><input name="fax" defaultValue={editing.fax ?? ''} className={inputCls} /></div>
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1 mt-2">{lang === 'de' ? 'Rechnungsadresse' : 'Billing Address'}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className={`${fieldCls} md:col-span-2`}><label className={labelCls}>{lang === 'de' ? 'Straße' : 'Street'}</label><input name="address" defaultValue={editing.address ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>PLZ</label><input name="postalCode" defaultValue={editing.postalCode ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Stadt' : 'City'}</label><input name="city" defaultValue={editing.city ?? ''} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Land' : 'Country'}</label><input name="country" defaultValue={editing.country ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>USt-IdNr.</label><input name="ustIdNr" defaultValue={editing.ustIdNr ?? ''} className={inputCls} /></div>
                <div className={fieldCls}>
                  <label className={labelCls}>{lang === 'de' ? 'Zertifizierungen' : 'Certifications'}</label>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                    {[
                      ['spirecut', 'Spirecut®'],
                      ['ministem', 'MiniStem®'],
                    ].map(([value, label]) => (
                      <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editing.certifications.includes(value)}
                          onChange={(event) => setEditing((current) => {
                            if (!current) return current;
                            const certifications = new Set(current.certifications);
                            if (event.target.checked) certifications.add(value);
                            else certifications.delete(value);
                            return { ...current, certifications: [...certifications].sort() };
                          })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {lang === 'de'
                      ? 'Mehrfachauswahl ermöglicht den Zugriff auf beide Produktkataloge.'
                      : 'Selecting both grants access to both product catalogs.'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t pt-3">
                <div className="flex items-start gap-2 pt-1">
                  <input
                    id="is-public-authority"
                    type="checkbox"
                    checked={editing.isPublicAuthority}
                    onChange={(event) => setEditing((current) => current
                      ? { ...current, isPublicAuthority: event.target.checked }
                      : current)}
                  />
                  <label htmlFor="is-public-authority" className="text-sm leading-tight cursor-pointer">
                    {lang === 'de'
                      ? 'Öffentlicher Auftraggeber / B2G'
                      : 'Public authority recipient / B2G'}
                  </label>
                </div>
                <div className={fieldCls}>
                  <label className={labelCls}>
                    {lang === 'de'
                      ? 'Standard-Käuferreferenz / Leitweg-ID'
                      : 'Default buyer reference / Leitweg-ID'}
                  </label>
                  <input
                    name="defaultBuyerReference"
                    defaultValue={editing.defaultBuyerReference ?? ''}
                    className={inputCls}
                  />
                </div>
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b pb-1 mt-2">{lang === 'de' ? 'Lieferadresse (falls abweichend)' : 'Shipping Address (if different)'}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Vorname' : 'First Name'}</label><input name="shippingFirstName" defaultValue={editing.shippingFirstName ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Nachname' : 'Last Name'}</label><input name="shippingLastName" defaultValue={editing.shippingLastName ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Institution' : 'Institution'}</label><input name="shippingInstitutionName" defaultValue={editing.shippingInstitutionName ?? ''} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className={`${fieldCls} md:col-span-2`}><label className={labelCls}>{lang === 'de' ? 'Straße' : 'Street'}</label><input name="shippingAddress" defaultValue={editing.shippingAddress ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>PLZ</label><input name="shippingPostalCode" defaultValue={editing.shippingPostalCode ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Stadt' : 'City'}</label><input name="shippingCity" defaultValue={editing.shippingCity ?? ''} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Land' : 'Country'}</label><input name="shippingCountry" defaultValue={editing.shippingCountry ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>E-Mail</label><input name="shippingEmail" type="email" defaultValue={editing.shippingEmail ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Telefon' : 'Phone'}</label><input name="shippingPhone" defaultValue={editing.shippingPhone ?? ''} className={inputCls} /></div>
              </div>
              <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Notizen' : 'Notes'}</label><input name="notes" defaultValue={editing.notes ?? ''} className={inputCls} /></div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={editSaving}>{lang === 'de' ? 'Speichern' : 'Save'}</Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
