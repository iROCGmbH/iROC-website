import { useRef, useState, lazy } from 'react';
import { Link } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ClipboardList, Loader2, Globe, ChevronDown, ChevronUp, BadgeCheck, CheckCircle2, Trash2, Pencil, Download, UserPlus, Calendar, Users, UserCheck } from 'lucide-react';
import { adminGet, adminPost, adminDelete, adminPatch, adminHeaders, adminUrl } from '@/lib/admin-fetch';
import { formatTrainingDateInfo, type CertInstrument } from '@/lib/certificate-utils';
import { CountrySelect } from '@/components/CountrySelect';
import { IROC_DASHBOARD_QUERY_KEY, IROC_REGISTRATIONS_QUERY_KEY, LEADS_QUERY_KEY } from '@/lib/query-keys';

const CertificatePicker = lazy(() =>
  import('@/components/CertificatePDF').then(({ CertificatePicker: Component }) => ({
    default: Component,
  })),
);

interface Registration {
  id: number;
  salutation: string | null;
  medicalDegree: string | null;
  firstName: string;
  lastName: string;
  specialty: string | null;
  institutionName: string | null;
  city: string | null;
  country: string | null;
  email: string;
  phone: string | null;
  instrument: string;
  trainingDateInfo: string | null;
  certifiedDoctorId: number | null;
  status: string;
  confirmedAt: string | null;
  createdAt: string;
  isCustomer: boolean;
  customerId: number | null;
}

const inputCls = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const labelCls = 'text-xs font-semibold text-muted-foreground uppercase tracking-wide';
const fieldCls = 'flex flex-col gap-1';

/** Extract an ISO date string (YYYY-MM-DD) from trainingDateInfo for sorting */
function extractSortDate(info: string | null): string {
  if (!info) return '';
  const m = info.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/** Format any ISO date string as DD.MM.YYYY */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function RegistrationRow({
  reg, token, lang, onCertified, onUpdated, isSelected, onToggle,
}: {
  reg: Registration; token: string; lang: string; onCertified: () => void; onUpdated: () => void;
  isSelected: boolean; onToggle: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [certInstrument, setCertInstrument] = useState<'spirecut' | 'ministem'>(reg.instrument as 'spirecut' | 'ministem');
  const [certDate, setCertDate] = useState(new Date().toISOString().slice(0, 10));
  const [editCountry, setEditCountry] = useState(reg.country ?? '');

  const certify = useMutation({
    mutationFn: () => adminPost(`/api/admin/training-registrations/${reg.id}/certify`, token, { instrument: certInstrument, certifiedDate: certDate }),
    onSuccess: () => { toast({ title: lang === 'de' ? 'Zertifiziert' : 'Certified' }); onCertified(); },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' }),
  });

  const confirmRegistration = useMutation({
    mutationFn: () => adminPost<{
      registrationId: number;
      status: 'confirmed';
      confirmedAt: string | null;
      leadId: number;
      leadCreated: boolean;
    }>(`/api/admin/training-registrations/${reg.id}/confirm`, token, {}),
    onSuccess: (data) => {
      toast({
        title: lang === 'de' ? 'Anmeldung bestätigt' : 'Registration confirmed',
        description: data.leadCreated
          ? (lang === 'de' ? 'Der Kontakt wurde als angemeldet in Leads angelegt.' : 'The contact was added to Leads as registered.')
          : (lang === 'de' ? 'Der bestehende Kontakt wurde aktualisiert.' : 'The existing contact was updated.'),
      });
      onUpdated();
    },
    onError: (error) => toast({
      variant: 'destructive',
      title: lang === 'de' ? 'Bestätigung fehlgeschlagen' : 'Confirmation failed',
      description: error instanceof Error ? error.message : undefined,
    }),
  });

  const handleEditSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEditSaving(true);
    const fd = new FormData(e.currentTarget);
    try {
      await adminPatch(`/api/admin/training-registrations/${reg.id}`, token, {
        medicalDegree: (fd.get('medicalDegree') as string) || null,
        firstName: fd.get('firstName') as string,
        lastName: fd.get('lastName') as string,
        specialty: (fd.get('specialty') as string) || null,
        institutionName: (fd.get('institutionName') as string) || null,
        city: (fd.get('city') as string) || null,
        country: editCountry || null,
        phone: (fd.get('phone') as string) || null,
        email: fd.get('email') as string,
        instrument: fd.get('instrument') as string,
      });
      setEditMode(false);
      setExpanded(false);
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
      onUpdated();
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' });
    } finally {
      setEditSaving(false);
    }
  };

  const isCertified = !!reg.certifiedDoctorId;

  // Format the training date for display (consistent DD.MM.YYYY)
  const trainingDateDisplay = reg.trainingDateInfo
    ? (formatTrainingDateInfo(reg.trainingDateInfo, lang === 'de' ? 'de' : 'en') ?? fmtDate(extractSortDate(reg.trainingDateInfo)))
    : null;

  return (
    <div
      className={`border-b transition-colors cursor-pointer ${isCertified ? 'bg-green-50/40' : ''} ${isSelected ? 'bg-muted/40' : 'hover:bg-muted/30'}`}
      onClick={onToggle}
    >
      <div className="flex items-center gap-3 px-5 py-4">
        <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded shrink-0 ${reg.instrument === 'spirecut' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
          {reg.instrument}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm flex items-center flex-wrap gap-1.5">
            {reg.medicalDegree ? `${reg.medicalDegree} ` : ''}{reg.firstName} {reg.lastName}
            {isCertified && <BadgeCheck className="inline w-4 h-4 text-green-600 shrink-0" />}
            {reg.status === 'pending' ? (
              <span className="inline-flex items-center text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0"
                title={lang === 'de' ? 'Teilnehmer hat die Anmeldung noch nicht per E-Mail bestätigt' : 'Participant has not yet confirmed via email'}>
                {lang === 'de' ? 'Unbestätigt' : 'Unconfirmed'}
              </span>
            ) : (
              <span className="inline-flex items-center text-xs font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0"
                title={lang === 'de' ? 'Anmeldung per E-Mail bestätigt' : 'Confirmed via email'}>
                {lang === 'de' ? 'Bestätigt' : 'Confirmed'}
              </span>
            )}
            {reg.isCustomer && reg.customerId != null && (
              <Link
                href={`/customers/${reg.customerId}`}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors shrink-0"
                title={lang === 'de' ? 'Zum Kundendatensatz' : 'Go to customer record'}
              >
                <Users className="w-3 h-3" />
                {lang === 'de' ? 'In Kundenliste' : 'In Customers'}
              </Link>
            )}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {[reg.specialty, reg.institutionName, reg.city, reg.country].filter(Boolean).join(' · ')}
          </p>
          {trainingDateDisplay && (
            <p className="text-xs text-amber-700 mt-0.5 flex items-center gap-1">
              <Calendar className="w-3 h-3 shrink-0" />
              {trainingDateDisplay}
            </p>
          )}
        </div>
        {/* Registration date — same DD.MM.YYYY format */}
        <span className="text-xs text-muted-foreground hidden md:flex items-center gap-1 shrink-0">
          <Calendar className="w-3 h-3" />
          {fmtDate(reg.createdAt)}
        </span>
        <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); setEditMode(true); setExpanded(true); }}
          className="text-muted-foreground hover:text-foreground shrink-0" title={lang === 'de' ? 'Bearbeiten' : 'Edit'}>
          <Pencil className="w-4 h-4" />
        </Button>
        {reg.status === 'pending' && (
          <Button
            variant="outline"
            size="sm"
            disabled={confirmRegistration.isPending}
            onClick={e => { e.stopPropagation(); confirmRegistration.mutate(); }}
            className="gap-1.5 shrink-0 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            title={lang === 'de' ? 'Anmeldung bestätigen und als Lead übernehmen' : 'Confirm registration and add as lead'}
          >
            {confirmRegistration.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <UserCheck className="w-4 h-4" />}
            <span className="hidden lg:inline">{lang === 'de' ? 'Bestätigen' : 'Confirm'}</span>
          </Button>
        )}
        <button onClick={e => { e.stopPropagation(); setEditMode(false); setExpanded((v) => !v); }}
          className="text-muted-foreground hover:text-foreground p-1 rounded">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="px-5 pb-5 pt-3 border-t bg-muted/20 space-y-4">
          {editMode ? (
            /* ── Edit form ── */
            <form onSubmit={handleEditSave} className="space-y-3">
              <p className="text-xs font-semibold text-primary">{lang === 'de' ? 'Daten bearbeiten' : 'Edit details'}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Titel/Grad' : 'Degree/Title'}</label><input name="medicalDegree" defaultValue={reg.medicalDegree ?? ''} className={inputCls} placeholder="Dr. med." /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Vorname' : 'First Name'} *</label><input name="firstName" defaultValue={reg.firstName} required className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Nachname' : 'Last Name'}</label><input name="lastName" defaultValue={reg.lastName} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Fachgebiet' : 'Specialty'}</label><input name="specialty" defaultValue={reg.specialty ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Arbeitsplatz' : 'Workplace'}</label><input name="institutionName" defaultValue={reg.institutionName ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Stadt' : 'City'}</label><input name="city" defaultValue={reg.city ?? ''} className={inputCls} /></div>
                <div className={fieldCls}>
                  <label className={labelCls}>{lang === 'de' ? 'Land' : 'Country'}</label>
                  <CountrySelect
                    value={editCountry}
                    onChange={setEditCountry}
                    lang={lang === 'de' ? 'de' : 'en'}
                  />
                </div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Telefon' : 'Phone'}</label><input name="phone" defaultValue={reg.phone ?? ''} className={inputCls} /></div>
                <div className={fieldCls}><label className={labelCls}>E-Mail *</label><input name="email" type="email" defaultValue={reg.email} required className={inputCls} /></div>
              </div>
              <div className={fieldCls}>
                <label className={labelCls}>Instrument *</label>
                <select name="instrument" defaultValue={reg.instrument} required className={inputCls}>
                  <option value="spirecut">Spirecut®</option>
                  <option value="ministem">MiniStem®</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={editSaving}>{lang === 'de' ? 'Speichern' : 'Save'}</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setEditMode(false)}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</Button>
              </div>
            </form>
          ) : (
            /* ── Detail view ── */
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                {([
                  [lang === 'de' ? 'E-Mail' : 'Email', reg.email],
                  [lang === 'de' ? 'Telefon' : 'Phone', reg.phone],
                  [lang === 'de' ? 'Fachgebiet' : 'Specialty', reg.specialty],
                  [lang === 'de' ? 'Arbeitsplatz' : 'Workplace', reg.institutionName],
                  [lang === 'de' ? 'Stadt' : 'City', reg.city],
                  [lang === 'de' ? 'Land' : 'Country', reg.country],
                ] as [string, string | null][]).map(([label, val]) =>
                  val ? (
                    <div key={label}>
                      <span className="text-muted-foreground">{label}: </span>
                      <span className="font-medium">{val}</span>
                    </div>
                  ) : null
                )}
              </div>

              {isCertified ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-green-700 text-sm bg-green-100 rounded-lg px-4 py-2.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {lang === 'de' ? `Zertifiziert (Arzt-ID #${reg.certifiedDoctorId})` : `Certified (Doctor ID #${reg.certifiedDoctorId})`}
                  </div>
                  <div className="border rounded-xl p-4 bg-card space-y-2">
                    <p className="text-xs font-semibold text-primary flex items-center gap-2">
                      <BadgeCheck className="w-4 h-4" />
                      {lang === 'de' ? 'Zertifikat herunterladen' : 'Download Certificate'}
                    </p>
                    <CertificatePicker
                      salutation={reg.salutation}
                      medicalDegree={reg.medicalDegree}
                      firstName={reg.firstName}
                      lastName={reg.lastName}
                      city={reg.city}
                      defaultInstrument={(reg.instrument === 'ministem' ? 'ministem' : 'spirecut') as CertInstrument}
                      trainingDateInfo={reg.trainingDateInfo}
                      defaultCertDate={
                        reg.trainingDateInfo
                          ? (reg.trainingDateInfo.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date().toISOString().slice(0, 10))
                          : new Date().toISOString().slice(0, 10)
                      }
                      hideDatePicker={true}
                    />
                  </div>
                </div>
              ) : (
                <div className="border rounded-xl p-4 bg-card space-y-3">
                  <p className="text-sm font-semibold text-primary flex items-center gap-2">
                    <BadgeCheck className="w-4 h-4" />
                    {lang === 'de' ? 'Als zertifizierten Arzt übernehmen' : 'Add as certified doctor'}
                  </p>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Instrument</label>
                      <select value={certInstrument} onChange={(e) => setCertInstrument(e.target.value as 'spirecut' | 'ministem')}
                        className="h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                        <option value="spirecut">Spirecut®</option>
                        <option value="ministem">MiniStem®</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                        {lang === 'de' ? 'Zertifizierungsdatum' : 'Certification Date'}
                      </label>
                      <input type="date" value={certDate} onChange={(e) => setCertDate(e.target.value)}
                        className="h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                    </div>
                    <Button size="sm" disabled={certify.isPending} onClick={() => certify.mutate()} className="gap-2">
                      {certify.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
                      {lang === 'de' ? 'Zertifizieren' : 'Certify'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function IrocWebsiteRegistrations() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const langRef = useRef(lang);
  langRef.current = lang;
  const { irocUrl } = useSiteUrls();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'pending' | 'certified' | 'imported'>('all');
  const [productFilter, setProductFilter] = useState<'all' | 'spirecut' | 'ministem'>('all');
  const [search, setSearch] = useState('');
  // Sort by training date descending (latest first) by default
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'workplace'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: IROC_REGISTRATIONS_QUERY_KEY,
    queryFn: () => adminGet<Registration[]>('/api/admin/training-registrations', token!),
    enabled: !!token,
  });

  const importFromDoctors = useMutation({
    mutationFn: () => adminPost<{ imported: number; skipped: number }>(
      '/api/admin/training-registrations/import-from-doctors', token!, {}
    ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: IROC_REGISTRATIONS_QUERY_KEY });
      toast({
        title: lang === 'de' ? `${data.imported} importiert, ${data.skipped} übersprungen` : `${data.imported} imported, ${data.skipped} skipped`,
      });
    },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Import fehlgeschlagen' : 'Import failed' }),
  });

  const filtered = registrations.filter((r) => {
    const matchStatus =
      filter === 'all' ||
      (filter === 'pending' && !r.certifiedDoctorId) ||
      (filter === 'certified' && !!r.certifiedDoctorId) ||
      (filter === 'imported' && r.isCustomer);
    const matchProduct = productFilter === 'all' || r.instrument === productFilter;
    const q = search.toLowerCase();
    return matchStatus && matchProduct && (!q || `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q) || (r.city ?? '').toLowerCase().includes(q) || (r.institutionName ?? '').toLowerCase().includes(q));
  });

  const sorted = [...filtered].sort((a, b) => {
    let av: string;
    let bv: string;
    if (sortBy === 'date') {
      // Sort by training date; fall back to createdAt if no training date
      av = extractSortDate(a.trainingDateInfo) || a.createdAt.slice(0, 10);
      bv = extractSortDate(b.trainingDateInfo) || b.createdAt.slice(0, 10);
    } else if (sortBy === 'workplace') {
      av = (a.institutionName ?? '').toLowerCase();
      bv = (b.institutionName ?? '').toLowerCase();
    } else {
      av = `${a.firstName} ${a.lastName}`.toLowerCase();
      bv = `${b.firstName} ${b.lastName}`.toLowerCase();
    }
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const allIds = sorted.map((r) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const toggleSelect = (id: number) => setSelectedIds((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(allIds));

  const handleBulkDelete = async () => {
    if (!token || selectedIds.size === 0) return;
    if (!confirm(lang === 'de' ? `${selectedIds.size} Registrierungen wirklich löschen?` : `Really delete ${selectedIds.size} registration(s)?`)) return;
    setBulkDeleting(true);
    for (const id of selectedIds) await adminDelete(`/api/admin/training-registrations/${id}`, token!).catch(() => {});
    setSelectedIds(new Set());
    setBulkDeleting(false);
    qc.invalidateQueries({ queryKey: IROC_REGISTRATIONS_QUERY_KEY });
    toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' });
  };

  /** Import selected registrations as new website customers */
  const handleBulkImport = async () => {
    if (!token || selectedIds.size === 0) return;
    const toImport = registrations.filter(r => selectedIds.has(r.id));
    if (!confirm(
      lang === 'de'
        ? `${toImport.length} Anmeldung(en) als Kunden importieren?`
        : `Import ${toImport.length} registration(s) as customers?`
    )) return;

    setBulkImporting(true);
    let imported = 0;
    const duplicates: { name: string; email: string; customerId: number }[] = [];
    const alreadyImported: string[] = [];
    const inProgress: string[] = [];
    const failedNames: string[] = [];

    for (const reg of toImport) {
      const fullName = [reg.firstName, reg.lastName].filter(Boolean).join(' ');
      try {
        const res = await fetch(adminUrl('/api/iroc/website-customers'), {
          method: 'POST',
          headers: adminHeaders(token),
          body: JSON.stringify({
            firstName:       reg.firstName,
            lastName:        reg.lastName,
            sourceRegistrationId: reg.id,
            institutionName: reg.institutionName ?? undefined,
            email:           reg.email,
            phone:           reg.phone ?? undefined,
            city:            reg.city ?? undefined,
            country:         reg.country ?? undefined,
            specialty:       reg.specialty ?? undefined,
            instrument:      reg.instrument,
          }),
        });
        if (res.status === 409) {
          let body: { error?: string; existingId?: number } = {};
          try { body = await res.json(); } catch { /* ignore */ }
          if (body.error === 'customer_import_in_progress') {
            inProgress.push(fullName);
          } else if (body.error === 'customer_already_imported') {
            alreadyImported.push(fullName);
          } else {
            duplicates.push({ name: fullName, email: reg.email, customerId: body.existingId ?? 0 });
          }
        } else if (!res.ok) {
          failedNames.push(fullName);
        } else {
          imported++;
        }
      } catch {
        failedNames.push(fullName);
      }
    }

    setBulkImporting(false);
    setSelectedIds(new Set());
    // The badge is derived from the registration endpoint's customer left join.
    // Refresh it immediately so imported rows reflect their new customer state
    // without requiring the admin to reload the page.
    qc.invalidateQueries({ queryKey: IROC_REGISTRATIONS_QUERY_KEY });
    qc.invalidateQueries({ queryKey: ['iroc-website-customers'] });

    const hasDuplicates = duplicates.length > 0;
    const hasAlreadyImported = alreadyImported.length > 0;
    const hasInProgress = inProgress.length > 0;
    const hasFailures = failedNames.length > 0;
    const feedbackLang = langRef.current;

    if (!hasDuplicates && !hasAlreadyImported && !hasInProgress && !hasFailures) {
      toast({
        title: feedbackLang === 'de'
          ? `${imported} Kunde(n) erfolgreich importiert`
          : `${imported} customer(s) imported successfully`,
      });
    } else {
      const summaryParts: string[] = [];
      if (imported > 0) {
        summaryParts.push(feedbackLang === 'de' ? `${imported} importiert` : `${imported} imported`);
      }
      if (hasDuplicates) {
        summaryParts.push(
          feedbackLang === 'de'
            ? `${duplicates.length} übersprungen (E-Mail bereits vorhanden)`
            : `${duplicates.length} skipped (email already exists)`
        );
      }
      if (hasAlreadyImported) {
        summaryParts.push(
          feedbackLang === 'de'
            ? `${alreadyImported.length} bereits importiert: ${alreadyImported.join(', ')}`
            : `${alreadyImported.length} already imported: ${alreadyImported.join(', ')}`
        );
      }
      if (hasInProgress) {
        summaryParts.push(
          feedbackLang === 'de'
            ? `${inProgress.length} bereits in Bearbeitung: ${inProgress.join(', ')}`
            : `${inProgress.length} already in progress: ${inProgress.join(', ')}`
        );
      }
      if (hasFailures) {
        summaryParts.push(
          feedbackLang === 'de'
            ? `${failedNames.length} fehlgeschlagen: ${failedNames.join(', ')}`
            : `${failedNames.length} failed: ${failedNames.join(', ')}`
        );
      }
      toast({
        variant: !hasFailures && !hasInProgress ? 'default' : 'destructive',
        title: feedbackLang === 'de' ? 'Import abgeschlossen' : 'Import complete',
        description: (
          <div className="space-y-1.5 mt-1">
            {summaryParts.length > 0 && (
              <p className="text-xs text-muted-foreground">{summaryParts.join(' · ')}</p>
            )}
            {hasDuplicates && (
              <div className="space-y-1">
                {duplicates.map(({ name, email, customerId }) => (
                  <div key={email} className="flex items-center gap-2 text-xs">
                    <span className="truncate max-w-[140px]" title={name}>{name}</span>
                    <Link
                      href={
                        customerId > 0
                          ? `/iroc-website/customers?highlight=${customerId}`
                          : `/iroc-website/customers?search=${encodeURIComponent(email)}`
                      }
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors font-semibold shrink-0"
                      title={
                        lang === 'de'
                          ? `Zum Kundendatensatz springen (ID: ${customerId})`
                          : `Jump to customer record (ID: ${customerId})`
                      }
                    >
                      <Users className="w-3 h-3" />
                      {lang === 'de' ? 'Kundendatensatz' : 'View customer'}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        ),
      });
    }
  };

  const handleCertified = () => {
    qc.invalidateQueries({ queryKey: IROC_REGISTRATIONS_QUERY_KEY });
    qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
    // The dashboard's pendingTrainings metric is derived from the same
    // registration row. Refresh it immediately instead of waiting for the
    // dashboard's 30-second polling interval.
    qc.invalidateQueries({ queryKey: IROC_DASHBOARD_QUERY_KEY });
  };

  const cycleSortBy = (col: 'date' | 'name' | 'workplace') => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir(col === 'date' ? 'desc' : 'asc');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg"><ClipboardList className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Schulungsanmeldungen' : 'Training Registrations'}</h1>
          <p className="text-sm text-muted-foreground">{lang === 'de' ? 'Anmeldungen prüfen und Ärzte zertifizieren' : 'Review registrations and certify doctors'}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={importFromDoctors.isPending}
            onClick={() => importFromDoctors.mutate()}
            className="gap-1.5"
            title={lang === 'de' ? 'Alle zertifizierten Ärzte als Registrierungen importieren' : 'Import all certified doctors as registrations'}
          >
            {importFromDoctors.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {lang === 'de' ? 'Ärzte importieren' : 'Import Doctors'}
          </Button>
          <a href={`${irocUrl}/training`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
            <Globe className="w-4 h-4" />{lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
          </a>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: lang === 'de' ? 'Gesamt' : 'Total', value: registrations.length, color: '' },
          { label: lang === 'de' ? 'Ausstehend' : 'Pending', value: registrations.filter((r) => !r.certifiedDoctorId).length, color: 'text-amber-600' },
          { label: lang === 'de' ? 'Zertifiziert' : 'Certified', value: registrations.filter((r) => !!r.certifiedDoctorId).length, color: 'text-green-600' },
          {
            label: lang === 'de' ? 'Importiert' : 'Imported',
            value: registrations.filter((r) => r.isCustomer === true).length,
            color: 'text-indigo-600',
            onClick: () => setFilter('imported'),
          },
        ].map((s) => {
          const card = (
            <>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </>
          );
          return s.onClick ? (
            <button
              key={s.label}
              type="button"
              onClick={s.onClick}
              className="bg-card border border-indigo-200 rounded-xl p-4 text-center shadow-sm hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
            >
              {card}
            </button>
          ) : (
            <div key={s.label} className="bg-card border rounded-xl p-4 text-center shadow-sm">
              {card}
            </div>
          );
        })}
      </div>

      <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b flex flex-wrap gap-3 items-center">
          <Button variant="outline" size="sm" onClick={toggleAll} className="h-7 gap-1.5 text-xs shrink-0">
            {allSelected ? (lang === 'de' ? 'Auswahl aufheben' : 'Deselect all') : (lang === 'de' ? 'Alle auswählen' : 'Select all')}
          </Button>
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === 'de' ? 'Name, E-Mail, Arbeitsplatz …' : 'Name, email, workplace …'} className="w-48" />

          {/* Sort by date */}
          <button
            onClick={() => cycleSortBy('date')}
            className={`flex items-center gap-1 text-xs border rounded px-2 py-1 transition-colors
              ${sortBy === 'date' ? 'bg-primary text-white border-primary' : 'text-muted-foreground hover:text-foreground bg-card'}`}
          >
            <Calendar className="w-3 h-3" />
            {lang === 'de' ? 'Datum' : 'Date'}
            {sortBy === 'date' && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
          </button>

          {/* Sort by name */}
          <button
            onClick={() => cycleSortBy('name')}
            className={`flex items-center gap-1 text-xs border rounded px-2 py-1 transition-colors
              ${sortBy === 'name' ? 'bg-primary text-white border-primary' : 'text-muted-foreground hover:text-foreground bg-card'}`}
          >
            {lang === 'de' ? 'Name' : 'Name'}
            {sortBy === 'name' && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
          </button>

          {/* Sort by workplace */}
          <button
            onClick={() => cycleSortBy('workplace')}
            className={`flex items-center gap-1 text-xs border rounded px-2 py-1 transition-colors
              ${sortBy === 'workplace' ? 'bg-primary text-white border-primary' : 'text-muted-foreground hover:text-foreground bg-card'}`}
          >
            {lang === 'de' ? 'Arbeitsplatz' : 'Workplace'}
            {sortBy === 'workplace' && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
          </button>

          {selectedIds.size > 0 && (
            <>
              <span className="text-sm font-medium text-muted-foreground">{selectedIds.size} {lang === 'de' ? 'ausgewählt' : 'selected'}</span>

              {/* Import to Customers */}
              <Button
                size="sm"
                variant="outline"
                disabled={bulkImporting}
                onClick={handleBulkImport}
                className="gap-1.5 h-7 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                {bulkImporting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <UserPlus className="h-3.5 w-3.5" />}
                {bulkImporting
                  ? (lang === 'de' ? 'Importiere…' : 'Importing…')
                  : `${lang === 'de' ? 'In Kundenliste' : 'Import to Customers'} (${selectedIds.size})`}
              </Button>

              {/* Bulk delete */}
              <Button size="sm" variant="destructive" disabled={bulkDeleting} onClick={handleBulkDelete} className="gap-1.5 h-7">
                <Trash2 className="h-3.5 w-3.5" />
                {bulkDeleting ? (lang === 'de' ? 'Lösche…' : 'Deleting…') : `${lang === 'de' ? 'Löschen' : 'Delete'} (${selectedIds.size})`}
              </Button>

              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground">
                {lang === 'de' ? 'Aufheben' : 'Clear'}
              </button>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-md border overflow-hidden">
              {(['all', 'spirecut', 'ministem'] as const).map((f) => (
                <button key={f} onClick={() => setProductFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${productFilter === f ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:text-foreground'}`}>
                  { f === 'all' ? (lang === 'de' ? 'Alle Produkte' : 'All Products') : f === 'spirecut' ? 'Spirecut®' : 'MiniStem®' }
                </button>
              ))}
            </div>
            <div className="flex rounded-md border overflow-hidden">
              {(['all', 'pending', 'certified', 'imported'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === f
                      ? f === 'imported' ? 'bg-indigo-600 text-white' : 'bg-primary text-white'
                      : 'bg-card text-muted-foreground hover:text-foreground'
                  }`}>
                  {{
                    all: lang === 'de' ? 'Alle' : 'All',
                    pending: lang === 'de' ? 'Ausstehend' : 'Pending',
                    certified: lang === 'de' ? 'Zertifiziert' : 'Certified',
                    imported: lang === 'de' ? 'Importiert' : 'Imported',
                  }[f]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : sorted.length === 0 ? (
          <p className="text-center py-16 text-muted-foreground text-sm">
            {lang === 'de' ? 'Keine Einträge für diesen Filter.' : 'No entries for this filter.'}
          </p>
        ) : (
          sorted.map((reg) => (
            <RegistrationRow
              key={reg.id}
              reg={reg}
              token={token!}
              lang={lang}
              onCertified={handleCertified}
              onUpdated={handleCertified}
              isSelected={selectedIds.has(reg.id)}
              onToggle={() => toggleSelect(reg.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
