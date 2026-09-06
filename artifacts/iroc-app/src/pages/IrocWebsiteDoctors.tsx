import { useState, useRef, useEffect, lazy } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Users, Plus, Trash2, Loader2, Globe, Pencil, X, Search, ChevronUp, ChevronDown, Download, Mail, Send, MapPin, Map as MapIcon, ExternalLink, AlertTriangle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { adminGet, adminPost, adminDelete, adminPatch } from '@/lib/admin-fetch';
import type { CertInstrument, CertLang } from '@/lib/certificate-utils';
import { formatCertDate, formatTrainingDateInfo, getAssetBase } from '@/lib/certificate-utils';
import { recipientLanguageForCountry } from '@/lib/recipient-language';
import { hasUsableDoctorCoordinates } from '@workspace/spirecut-shared';

const QK = ['iroc-doctors'];

const CertificatePicker = lazy(() =>
  import('@/components/CertificatePDF').then(({ CertificatePicker: Component }) => ({
    default: Component,
  })),
);

interface Certification { instrument: string; certifiedDate: string; }
interface Doctor {
  id: number;
  title: string | null;
  firstName: string;
  lastName: string;
  specialty: string | null;
  institutionName: string | null;
  city: string;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  lat?: number | null;
  lon?: number | null;
  certifications: Certification[];
}

interface DoctorGeocodeSuggestion {
  lat: number;
  lon: number;
  displayName: string;
}

interface DoctorGeocodeResponse {
  status: 'suggestion' | 'not_found' | 'ambiguous';
  lat?: number;
  lon?: number;
  displayName?: string;
  candidates?: Array<{ lat: number; lon: number; displayName: string }>;
}

function coordinateValue(value: FormDataEntryValue | null): number | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function openStreetMapPreviewUrl({ lat, lon }: Pick<DoctorGeocodeSuggestion, 'lat' | 'lon'>): string {
  const padding = 0.005;
  const left = Math.max(-180, lon - padding);
  const right = Math.min(180, lon + padding);
  const bottom = Math.max(-90, lat - padding);
  const top = Math.min(90, lat + padding);
  const bbox = [left, bottom, right, top].map((value) => value.toFixed(6)).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

function CertRow({ cert, onChange, onRemove }: { cert: Certification; onChange: (c: Certification) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={cert.instrument}
        onChange={(e) => onChange({ ...cert, instrument: e.target.value })}
        className="h-8 px-2 rounded border border-input bg-background text-xs"
      >
        <option value="spirecut">Spirecut®</option>
        <option value="ministem">MiniStem®</option>
      </select>
      <input
        type="date"
        value={cert.certifiedDate}
        onChange={(e) => onChange({ ...cert, certifiedDate: e.target.value })}
        className="h-8 px-2 rounded border border-input bg-background text-xs"
      />
      <button onClick={onRemove} className="text-destructive hover:bg-destructive/10 rounded p-1"><X className="w-3 h-3" /></button>
    </div>
  );
}

export default function IrocWebsiteDoctors() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { irocUrl } = useSiteUrls();
  const { toast } = useToast();
  const qc = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [certs, setCerts] = useState<Certification[]>([{ instrument: 'spirecut', certifiedDate: new Date().toISOString().slice(0, 10) }]);
  const [editing, setEditing] = useState<Doctor | null>(null);
  const [editCerts, setEditCerts] = useState<Certification[]>([]);
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [certExpandedIds, setCertExpandedIds] = useState<Set<number>>(new Set());
  const [geocodeReview, setGeocodeReview] = useState<{
    doctor: Doctor;
    candidates: DoctorGeocodeSuggestion[];
    selectedIndex: number;
  } | null>(null);
  const [showGeocodeMap, setShowGeocodeMap] = useState(false);
  const [geocodeMapFailed, setGeocodeMapFailed] = useState(false);

  // ── Certificate email dialog ───────────────────────────────────────────────
  const [certEmailDoctor, setCertEmailDoctor] = useState<Doctor | null>(null);
  const [certEmailTo, setCertEmailTo]         = useState('');
  const [certEmailSubject, setCertEmailSubject] = useState('');
  const [certEmailBody, setCertEmailBody]     = useState('');
  const [certEmailInstrument, setCertEmailInstrument] = useState<CertInstrument>('spirecut');
  const [certEmailLang, setCertEmailLang]     = useState<CertLang>('de');
  const [certEmailDate, setCertEmailDate]     = useState(new Date().toISOString().slice(0, 10));
  const [certEmailSending, setCertEmailSending] = useState(false);
  const [certEmailSvf, setCertEmailSvf]         = useState(false);
  const [portalCreds, setPortalCreds]         = useState<{ url: string; password: string } | null>(null);
  const [portalCredsLoading, setPortalCredsLoading] = useState(false);

  // Fetch portal credentials whenever the dialog is open or instrument changes
  useEffect(() => {
    if (!certEmailDoctor || !token) { setPortalCreds(null); return; }
    setPortalCredsLoading(true);
    adminGet<{ url: string; password: string }>(
      `/api/admin/portal-credentials/${certEmailInstrument}`, token
    )
      .then(data => setPortalCreds(data))
      .catch(() => setPortalCreds(null))
      .finally(() => setPortalCredsLoading(false));
  }, [certEmailDoctor, certEmailInstrument, token]);

  const { data: doctors = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => fetch(`/api/doctors`).then((r) => r.json()) as Promise<Doctor[]>,
  });

  const addDoc = useMutation({
    mutationFn: (data: Record<string, unknown>) => adminPost('/api/admin/doctors', token!, data),
    onSuccess: () => { toast({ title: lang === 'de' ? 'Arzt hinzugefügt' : 'Doctor added' }); qc.invalidateQueries({ queryKey: QK }); formRef.current?.reset(); setCerts([{ instrument: 'spirecut', certifiedDate: new Date().toISOString().slice(0, 10) }]); },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' }),
  });

  const delDoc = useMutation({
    mutationFn: (id: number) => adminDelete(`/api/admin/doctors/${id}`, token!),
    onSuccess: () => { toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' }); qc.invalidateQueries({ queryKey: QK }); },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Löschen' : 'Error deleting' }),
  });

  const updateDoc = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => adminPatch(`/api/admin/doctors/${id}`, token!, data),
    onSuccess: () => { toast({ title: lang === 'de' ? 'Aktualisiert' : 'Updated' }); qc.invalidateQueries({ queryKey: QK }); setEditing(null); },
    onError: () => toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' }),
  });

  const geocodeDoc = useMutation({
    mutationFn: (id: number) => adminPost<DoctorGeocodeResponse>(`/api/admin/doctors/${id}/geocode`, token!, {}),
    onSuccess: (result, id) => {
      setShowGeocodeMap(false);
      setGeocodeMapFailed(false);
      const doctor = doctors.find((candidate) => candidate.id === id);
      if (!doctor) return;
      if (result.status === 'suggestion' && result.lat != null && result.lon != null && result.displayName) {
        setGeocodeReview({
          doctor,
          candidates: [{
            lat: result.lat,
            lon: result.lon,
            displayName: result.displayName,
          }],
          selectedIndex: 0,
        });
        return;
      }

      const ambiguous = result.status === 'ambiguous';
      if (ambiguous && result.candidates?.length) {
        setGeocodeReview({
          doctor,
          candidates: result.candidates,
          selectedIndex: 0,
        });
        return;
      }

      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'Kein eindeutiger Standortvorschlag' : 'No unambiguous location suggestion',
        description: ambiguous
          ? (lang === 'de'
            ? 'Mehrere Treffer gefunden, aber keine Kandidaten konnten angezeigt werden. Bitte PLZ und Stadt prüfen und die Koordinaten manuell eingeben.'
            : 'Multiple matches found, but no candidates could be displayed. Check the postal code and city, then enter the coordinates manually.')
          : (lang === 'de'
            ? 'Kein Treffer gefunden. Bitte PLZ, Stadt und Land prüfen und die Koordinaten manuell eingeben.'
            : 'No match found. Check the postal code, city, and country, then enter the coordinates manually.'),
      });
    },
    onError: () => toast({
      variant: 'destructive',
      title: lang === 'de' ? 'Standortvorschlag fehlgeschlagen' : 'Location suggestion failed',
      description: lang === 'de'
        ? 'Bitte PLZ, Stadt und Land prüfen und die Koordinaten manuell eingeben.'
        : 'Check the postal code, city, and country, then enter the coordinates manually.',
    }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (certs.length === 0) { toast({ variant: 'destructive', title: lang === 'de' ? 'Mindestens eine Zertifizierung erforderlich' : 'At least one certification required' }); return; }
    const fd = new FormData(e.currentTarget);
    addDoc.mutate({
      title: (fd.get('title') as string) || null,
      firstName: fd.get('firstName') as string,
      lastName: fd.get('lastName') as string,
      specialty: (fd.get('specialty') as string) || null,
      institutionName: (fd.get('institutionName') as string) || null,
      postalCode: (fd.get('postalCode') as string) || null,
      city: fd.get('city') as string,
      country: fd.get('country') as string,
      phone: (fd.get('phone') as string) || null,
      email: (fd.get('email') as string) || null,
      websiteUrl: (fd.get('websiteUrl') as string) || null,
      lat: coordinateValue(fd.get('lat')),
      lon: coordinateValue(fd.get('lon')),
      certifications: certs,
    });
  };

  const openEdit = (doc: Doctor) => { setEditing(doc); setEditCerts(doc.certifications.map((c) => ({ ...c }))); };

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    if (editCerts.length === 0) { toast({ variant: 'destructive', title: lang === 'de' ? 'Mindestens eine Zertifizierung erforderlich' : 'At least one certification required' }); return; }
    const fd = new FormData(e.currentTarget);
    updateDoc.mutate({ id: editing.id, data: {
      title: (fd.get('title') as string) || null,
      firstName: fd.get('firstName') as string,
      lastName: fd.get('lastName') as string,
      specialty: (fd.get('specialty') as string) || null,
      institutionName: (fd.get('institutionName') as string) || null,
      postalCode: (fd.get('postalCode') as string) || null,
      city: fd.get('city') as string,
      country: fd.get('country') as string,
      phone: (fd.get('phone') as string) || null,
      email: (fd.get('email') as string) || null,
      websiteUrl: (fd.get('websiteUrl') as string) || null,
       lat: coordinateValue(fd.get('lat')),
       lon: coordinateValue(fd.get('lon')),
      certifications: editCerts,
    }});
  };

  const filtered = doctors.filter((d) => {
    const q = search.toLowerCase();
    return !q || `${d.firstName} ${d.lastName}`.toLowerCase().includes(q) || (d.city ?? '').toLowerCase().includes(q) || (d.institutionName ?? '').toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = `${a.firstName} ${a.lastName}`.toLowerCase();
    const bv = `${b.firstName} ${b.lastName}`.toLowerCase();
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const allIds = sorted.map((d) => d.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const toggleSelect = (id: number) => setSelectedIds((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(allIds));

  const handleBulkDelete = async () => {
    if (!token || selectedIds.size === 0) return;
    if (!confirm(lang === 'de' ? `${selectedIds.size} Ärzte wirklich löschen?` : `Really delete ${selectedIds.size} doctor(s)?`)) return;
    setBulkDeleting(true);
    for (const id of selectedIds) await adminDelete(`/api/admin/doctors/${id}`, token!).catch(() => {});
    setSelectedIds(new Set());
    setBulkDeleting(false);
    qc.invalidateQueries({ queryKey: QK });
    toast({ title: lang === 'de' ? 'Gelöscht' : 'Deleted' });
  };

  const openCertEmailDialog = (doc: Doctor) => {
    const firstName = doc.firstName;
    const lastName = doc.lastName;
    const firstCert = doc.certifications[0];
    const defaultInstrument: CertInstrument = firstCert?.instrument === 'ministem' ? 'ministem' : 'spirecut';
    const defaultDate = firstCert?.certifiedDate ?? new Date().toISOString().slice(0, 10);
    const recipientLanguage = recipientLanguageForCountry(doc.country);
    setCertEmailDoctor(doc);
    setCertEmailTo(doc.email ?? '');
    setCertEmailInstrument(defaultInstrument);
    setCertEmailLang(recipientLanguage);
    setCertEmailDate(defaultDate);
    setCertEmailSvf(false);
    if (recipientLanguage === 'en') {
      setCertEmailSubject(`iROC Certificate – ${firstName} ${lastName}`);
      setCertEmailBody(`Dear ${firstName} ${lastName},\n\nPlease find attached your iROC certificate.\n\nIf you have any questions, please do not hesitate to contact us.\n\nBest regards,\niROC GmbH`);
    } else {
      setCertEmailSubject(`iROC Zertifikat – ${firstName} ${lastName}`);
      setCertEmailBody(`Sehr geehrte/r ${firstName} ${lastName},\n\nim Anhang finden Sie Ihr iROC Zertifikat.\n\nBei Fragen stehen wir Ihnen gerne zur Verfügung.\n\nMit freundlichen Grüßen,\niROC GmbH`);
    }
  };

  const handleCertEmailSend = async () => {
    if (!certEmailDoctor || !certEmailTo || !certEmailSubject || !certEmailBody) return;
    setCertEmailSending(true);
    try {
      const assetBase = getAssetBase();
      const trainingDateDE = formatTrainingDateInfo(certEmailDate, 'de') ?? formatCertDate(certEmailDate, 'de');
      const trainingDateEN = formatTrainingDateInfo(certEmailDate, 'en') ?? formatCertDate(certEmailDate, 'en');
      const trainingDateDisplay = certEmailLang === 'en' ? trainingDateEN : trainingDateDE;
      const footerDate = formatCertDate(certEmailDate, certEmailLang);
      const doc = certEmailDoctor;
      const [{ pdf }, { CertificateDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/CertificatePDF'),
      ]);
      const blob = await pdf(
        <CertificateDocument
          salutation={null}
          medicalDegree={doc.title}
          firstName={doc.firstName}
          lastName={doc.lastName}
          city={doc.city}
          instrument={certEmailInstrument}
          trainingDateDisplay={trainingDateDisplay}
          footerDate={footerDate}
          assetBase={assetBase}
          lang={certEmailLang}
          svf={certEmailSvf}
        />
      ).toBlob();
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const filename = `Zertifikat_${doc.firstName}_${doc.lastName}_${certEmailInstrument}_${certEmailLang.toUpperCase()}.pdf`.replace(/\s+/g, '_');
      await adminPost(`/api/admin/doctors/${doc.id}/email-certificate`, token!, {
        to: certEmailTo,
        subject: certEmailSubject,
        body: certEmailBody,
        pdfBase64: base64,
        filename,
        instrument: certEmailInstrument,
      });
      toast({ title: lang === 'de' ? 'Zertifikat gesendet' : 'Certificate sent', description: certEmailTo });
      setCertEmailDoctor(null);
    } catch (err) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error', description: String(err) });
    } finally {
      setCertEmailSending(false);
    }
  };

  const fieldCls = "flex flex-col gap-1";
  const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide";
  const reviewedCandidate = geocodeReview
    ? geocodeReview.candidates[geocodeReview.selectedIndex] ?? geocodeReview.candidates[0]
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg"><Users className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Zertifizierte Ärzte' : 'Certified Doctors'}</h1>
          <p className="text-sm text-muted-foreground">{lang === 'de' ? `${doctors.length} Einträge` : `${doctors.length} entries`}</p>
        </div>
        <a href={`${irocUrl}/doctors`} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
          <Globe className="w-4 h-4" />{lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
        </a>
      </div>

      {/* Add form */}
      <div className="bg-card border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-primary font-semibold">
          <Plus className="w-4 h-4" /> {lang === 'de' ? 'Neuen Arzt hinzufügen' : 'Add New Doctor'}
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Titel (optional)' : 'Title (optional)'}</label><Input name="title" placeholder="Dr. med." /></div>
            <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Vorname' : 'First Name'}</label><Input name="firstName" required /></div>
            <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Nachname' : 'Last Name'}</label><Input name="lastName" required /></div>
            <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Fachgebiet (optional)' : 'Specialty (optional)'}</label><Input name="specialty" /></div>
            <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Praxis / Klinik (optional)' : 'Practice / Clinic (optional)'}</label><Input name="institutionName" /></div>
            <div className={fieldCls}><label className={labelCls}>PLZ (optional)</label><Input name="postalCode" /></div>
            <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Stadt' : 'City'}</label><Input name="city" required /></div>
            <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Land' : 'Country'}</label><Input name="country" required defaultValue="Deutschland" /></div>
            <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Telefon (optional)' : 'Phone (optional)'}</label><Input name="phone" type="tel" autoComplete="tel" /></div>
            <div className={fieldCls}><label className={labelCls}>E-Mail (optional)</label><Input name="email" type="email" /></div>
            <div className={fieldCls}><label className={labelCls}>Website URL (optional)</label><Input name="websiteUrl" type="url" /></div>
            <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Breitengrad (optional)' : 'Latitude (optional)'}</label><Input name="lat" type="number" step="any" min="-90" max="90" placeholder="z. B. 48.1351" /></div>
            <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Längengrad (optional)' : 'Longitude (optional)'}</label><Input name="lon" type="number" step="any" min="-180" max="180" placeholder="z. B. 11.5820" /></div>
          </div>
          <div className="space-y-2">
            <label className={labelCls}>{lang === 'de' ? 'Zertifizierungen' : 'Certifications'}</label>
            {certs.map((c, i) => (
              <CertRow key={i} cert={c} onChange={(nc) => setCerts((v) => v.map((x, j) => j === i ? nc : x))} onRemove={() => setCerts((v) => v.filter((_, j) => j !== i))} />
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setCerts((v) => [...v, { instrument: 'spirecut', certifiedDate: new Date().toISOString().slice(0, 10) }])}>
              + {lang === 'de' ? 'Zertifizierung hinzufügen' : 'Add certification'}
            </Button>
          </div>
          <Button type="submit" disabled={addDoc.isPending} className="gap-2">
            {addDoc.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {lang === 'de' ? 'Arzt hinzufügen' : 'Add doctor'}
          </Button>
        </form>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{lang === 'de' ? 'Arzt bearbeiten' : 'Edit Doctor'}</h2>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Titel' : 'Title'}</label><Input name="title" defaultValue={editing.title ?? ''} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Vorname' : 'First Name'}</label><Input name="firstName" defaultValue={editing.firstName} required /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Nachname' : 'Last Name'}</label><Input name="lastName" defaultValue={editing.lastName} required /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Fachgebiet' : 'Specialty'}</label><Input name="specialty" defaultValue={editing.specialty ?? ''} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Institution' : 'Institution'}</label><Input name="institutionName" defaultValue={editing.institutionName ?? ''} /></div>
                <div className={fieldCls}><label className={labelCls}>PLZ</label><Input name="postalCode" defaultValue={editing.postalCode ?? ''} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Stadt' : 'City'}</label><Input name="city" defaultValue={editing.city} required /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Land' : 'Country'}</label><Input name="country" defaultValue={editing.country} required /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Telefon' : 'Phone'}</label><Input name="phone" type="tel" autoComplete="tel" defaultValue={editing.phone ?? ''} /></div>
                <div className={fieldCls}><label className={labelCls}>E-Mail</label><Input name="email" type="email" defaultValue={editing.email ?? ''} /></div>
                <div className={fieldCls}><label className={labelCls}>Website</label><Input name="websiteUrl" type="url" defaultValue={editing.websiteUrl ?? ''} /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Breitengrad' : 'Latitude'}</label><Input name="lat" type="number" step="any" min="-90" max="90" defaultValue={editing.lat ?? ''} placeholder="-90 bis 90" /></div>
                <div className={fieldCls}><label className={labelCls}>{lang === 'de' ? 'Längengrad' : 'Longitude'}</label><Input name="lon" type="number" step="any" min="-180" max="180" defaultValue={editing.lon ?? ''} placeholder="-180 bis 180" /></div>
              </div>
              <div className="space-y-2">
                <label className={labelCls}>{lang === 'de' ? 'Zertifizierungen' : 'Certifications'}</label>
                {editCerts.map((c, i) => (
                  <CertRow key={i} cert={c} onChange={(nc) => setEditCerts((v) => v.map((x, j) => j === i ? nc : x))} onRemove={() => setEditCerts((v) => v.filter((_, j) => j !== i))} />
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setEditCerts((v) => [...v, { instrument: 'spirecut', certifiedDate: new Date().toISOString().slice(0, 10) }])}>
                  + {lang === 'de' ? 'Hinzufügen' : 'Add'}
                </Button>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={updateDoc.isPending} className="gap-2">
                  {updateDoc.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {lang === 'de' ? 'Speichern' : 'Save'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Dialog open={!!geocodeReview} onOpenChange={(open) => { if (!open) { setGeocodeReview(null); setShowGeocodeMap(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              {geocodeReview && geocodeReview.candidates.length > 1
                ? (lang === 'de' ? 'Standort auswählen' : 'Choose a location')
                : (lang === 'de' ? 'Standortvorschlag prüfen' : 'Review location suggestion')}
            </DialogTitle>
          </DialogHeader>
          {geocodeReview && reviewedCandidate && (
            <div className="space-y-4">
              <div>
                <p className="font-medium" data-testid="text-geocode-doctor">
                  {[geocodeReview.doctor.title, geocodeReview.doctor.firstName, geocodeReview.doctor.lastName].filter(Boolean).join(' ')}
                </p>
                <p className="text-sm text-muted-foreground" data-testid="text-geocode-address">
                  {[geocodeReview.doctor.postalCode, geocodeReview.doctor.city, geocodeReview.doctor.country].filter(Boolean).join(' · ')}
                </p>
              </div>
              {geocodeReview.candidates.length > 1 && (
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium">
                      {lang === 'de' ? 'Mögliche Standorte' : 'Possible locations'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {lang === 'de'
                        ? 'Wählen Sie den passenden Treffer aus und prüfen Sie ihn vor dem Speichern.'
                        : 'Choose the matching result and review it before saving.'}
                    </p>
                  </div>
                  <RadioGroup
                    value={String(geocodeReview.selectedIndex)}
                    onValueChange={(value) => {
                      const selectedIndex = Number(value);
                      if (!Number.isInteger(selectedIndex)) return;
                      setGeocodeReview((current) => current
                        ? { ...current, selectedIndex }
                        : current);
                    }}
                    aria-label={lang === 'de' ? 'Mögliche Standorte' : 'Possible locations'}
                    className="max-h-56 overflow-y-auto rounded-lg border p-2"
                  >
                    {geocodeReview.candidates.map((candidate, index) => (
                      <label
                        key={`${candidate.lat}-${candidate.lon}-${index}`}
                        htmlFor={`geocode-candidate-${index}`}
                        data-testid={`geocode-candidate-${index}`}
                        className="flex cursor-pointer items-start gap-3 rounded-md p-2 text-sm hover:bg-muted/60"
                      >
                        <RadioGroupItem
                          value={String(index)}
                          id={`geocode-candidate-${index}`}
                          className="mt-0.5 shrink-0"
                        />
                        <span className="min-w-0">
                          <span className="block break-words">{candidate.displayName}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {candidate.lat.toFixed(6)}, {candidate.lon.toFixed(6)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              )}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {geocodeReview.candidates.length > 1
                    ? (lang === 'de' ? 'Ausgewählter Ort' : 'Selected place')
                    : (lang === 'de' ? 'Gefundener Ort' : 'Matched place')}
                </p>
                <p className="text-sm" data-testid="text-geocode-display-name">{reviewedCandidate.displayName}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{lang === 'de' ? 'Breitengrad' : 'Latitude'}</p>
                    <p className="font-mono text-sm" data-testid="text-geocode-latitude">{reviewedCandidate.lat.toFixed(6)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{lang === 'de' ? 'Längengrad' : 'Longitude'}</p>
                    <p className="font-mono text-sm" data-testid="text-geocode-longitude">{reviewedCandidate.lon.toFixed(6)}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="button-toggle-geocode-map"
                  onClick={() => {
                    setGeocodeMapFailed(false);
                    setShowGeocodeMap((visible) => !visible);
                  }}
                  className="w-full justify-center gap-2"
                >
                  <MapIcon className="w-4 h-4" />
                  {showGeocodeMap
                    ? (lang === 'de' ? 'Karte ausblenden' : 'Hide map')
                    : (lang === 'de' ? 'Karte anzeigen' : 'Show map')}
                </Button>
                {showGeocodeMap && (
                  <div
                    className="overflow-hidden rounded-lg border bg-muted"
                    data-testid="geocode-map-preview"
                    onErrorCapture={() => setGeocodeMapFailed(true)}
                  >
                    <iframe
                      key={openStreetMapPreviewUrl(reviewedCandidate)}
                      title={lang === 'de' ? 'Kartenvorschau des ausgewählten Standorts' : 'Map preview of the selected location'}
                      src={openStreetMapPreviewUrl(reviewedCandidate)}
                      loading="lazy"
                      className="h-56 w-full border-0"
                    />
                    {geocodeMapFailed && (
                      <div role="alert" className="space-y-1 border-t bg-amber-50 px-3 py-3 text-sm text-amber-900">
                        <p className="font-medium">
                          {lang === 'de'
                            ? 'Die Kartenvorschau konnte nicht geladen werden.'
                            : 'The map preview could not be loaded.'}
                        </p>
                        <p className="font-mono text-xs">
                          {reviewedCandidate.lat.toFixed(6)}, {reviewedCandidate.lon.toFixed(6)}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 border-t bg-background px-3 py-2 text-xs text-muted-foreground">
                      <span>© OpenStreetMap contributors</span>
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${reviewedCandidate.lat.toFixed(6)}&mlon=${reviewedCandidate.lon.toFixed(6)}#map=16/${reviewedCandidate.lat.toFixed(6)}/${reviewedCandidate.lon.toFixed(6)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
                      >
                        {lang === 'de' ? 'Größere Karte' : 'Open larger map'}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {lang === 'de'
                  ? 'Bitte prüfen Sie die Koordinaten. Beim Übernehmen öffnet sich das Bearbeitungsformular; gespeichert wird erst nach Klick auf „Speichern“.'
                  : 'Please review the coordinates. Using them opens the edit form; they are only saved after you click “Save”.'}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGeocodeReview(null); setShowGeocodeMap(false); }}>
              {lang === 'de' ? 'Abbrechen' : 'Cancel'}
            </Button>
            <Button
              data-testid="button-use-geocode-suggestion"
              onClick={() => {
                if (!geocodeReview || !reviewedCandidate) return;
                const { doctor } = geocodeReview;
                setGeocodeReview(null);
                openEdit({ ...doctor, lat: reviewedCandidate.lat, lon: reviewedCandidate.lon });
              }}
            >
              {lang === 'de' ? 'Auswahl übernehmen' : 'Use selected coordinates'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Certificate email dialog ── */}
      <Dialog open={!!certEmailDoctor} onOpenChange={(open) => { if (!open) setCertEmailDoctor(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-4 h-4" />{lang === 'de' ? 'Zertifikat per E-Mail senden' : 'Send Certificate by Email'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{lang === 'de' ? 'Produkt' : 'Product'}</Label>
                <select value={certEmailInstrument} onChange={e => setCertEmailInstrument(e.target.value as CertInstrument)} className="h-8 px-2 rounded border border-input bg-background text-xs">
                  <option value="spirecut">Spirecut®</option>
                  <option value="ministem">MiniStem®</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sprache</Label>
                <select
                  value={certEmailLang}
                  disabled
                  title={lang === 'de' ? 'Automatisch nach Empfängerland' : 'Automatically selected by recipient country'}
                  className="h-8 px-2 rounded border border-input bg-muted text-xs"
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{lang === 'de' ? 'Zertifikat-Datum' : 'Cert. Date'}</Label>
                <input type="date" value={certEmailDate} onChange={e => setCertEmailDate(e.target.value)} className="h-8 px-2 rounded border border-input bg-background text-xs" />
              </div>
            </div>
            {certEmailInstrument === 'ministem' && (
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox checked={certEmailSvf} onCheckedChange={(v) => setCertEmailSvf(!!v)} />
                {lang === 'de' ? 'SVF-Version des Zertifikats' : 'SVF version of certificate'}
              </label>
            )}
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{lang === 'de' ? 'An' : 'To'}</Label>
              <Input value={certEmailTo} onChange={e => setCertEmailTo(e.target.value)} type="email" placeholder="arzt@klinik.de" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{lang === 'de' ? 'Betreff' : 'Subject'}</Label>
              <Input value={certEmailSubject} onChange={e => setCertEmailSubject(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{lang === 'de' ? 'Nachricht' : 'Message'}</Label>
              <Textarea value={certEmailBody} onChange={e => setCertEmailBody(e.target.value)} rows={5} className="font-mono text-xs" />
            </div>

            {/* Bilingual portal credentials block — shown as read-only preview of what gets appended */}
            <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-700 p-3 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                {lang === 'de' ? 'Automatisch angehängt / Auto-appended' : 'Automatically appended / Automatisch angehängt'}
              </p>
              {portalCredsLoading ? (
                <p className="text-xs text-muted-foreground italic">{lang === 'de' ? 'Lade Portal-Zugangsdaten…' : 'Loading portal credentials…'}</p>
              ) : portalCreds ? (
                <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
{`──────────────────────────────
Portal-Zugang (${certEmailInstrument === 'spirecut' ? 'Spirecut®' : 'MiniStem®'}):${portalCreds.url ? `\nLogin-URL: ${portalCreds.url}` : ''}
Passwort: ${portalCreds.password}

Portal Access (${certEmailInstrument === 'spirecut' ? 'Spirecut®' : 'MiniStem®'}):${portalCreds.url ? `\nLogin URL: ${portalCreds.url}` : ''}
Password: ${portalCreds.password}
──────────────────────────────`}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground italic">{lang === 'de' ? 'Keine Portal-Zugangsdaten gefunden.' : 'No portal credentials found.'}</p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">{lang === 'de' ? 'Das Zertifikat-PDF wird generiert und als Anhang beigefügt.' : 'The certificate PDF will be generated and attached automatically.'}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCertEmailDoctor(null)}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</Button>
            <Button onClick={handleCertEmailSend} disabled={certEmailSending || !certEmailTo || !certEmailSubject}>
              <Send className="w-4 h-4 mr-2" />{certEmailSending ? (lang === 'de' ? 'Sende…' : 'Sending…') : (lang === 'de' ? 'Senden' : 'Send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Doctor list */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={lang === 'de' ? 'Name, Stadt …' : 'Name, city …'} className="max-w-xs" />
          <button
            onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1 bg-card"
          >
            {lang === 'de' ? 'Name' : 'Name'} {sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {allIds.length > 0 && (
            <Button variant="outline" size="sm" onClick={toggleAll} className="h-7 gap-1.5 text-xs">
              {allSelected ? (lang === 'de' ? 'Auswahl aufheben' : 'Deselect all') : (lang === 'de' ? 'Alle auswählen' : 'Select all')}
            </Button>
          )}
          {selectedIds.size > 0 && (
            <>
              <span className="text-sm font-medium text-destructive">{selectedIds.size} {lang === 'de' ? 'ausgewählt' : 'selected'}</span>
              <Button size="sm" variant="destructive" disabled={bulkDeleting} onClick={handleBulkDelete} className="gap-1.5 h-7">
                <Trash2 className="h-3.5 w-3.5" />
                {bulkDeleting ? (lang === 'de' ? 'Lösche…' : 'Deleting…') : `${lang === 'de' ? 'Löschen' : 'Delete'} (${selectedIds.size})`}
              </Button>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground">
                {lang === 'de' ? 'Aufheben' : 'Clear'}
              </button>
            </>
          )}
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
            {sorted.length === 0 ? (
              <p className="text-center py-12 text-muted-foreground text-sm">{lang === 'de' ? 'Keine Einträge' : 'No entries'}</p>
            ) : (
              <div className="divide-y">
                {sorted.map((doc) => {
                  const certExpanded = certExpandedIds.has(doc.id);
                  const toggleCert = () => setCertExpandedIds((prev) => {
                    const next = new Set(prev);
                    next.has(doc.id) ? next.delete(doc.id) : next.add(doc.id);
                    return next;
                  });
                  const firstCert = doc.certifications[0];
                  const defaultInstrument: CertInstrument = (firstCert?.instrument === 'ministem' ? 'ministem' : 'spirecut');
                  const defaultCertDate = firstCert?.certifiedDate ?? new Date().toISOString().slice(0, 10);

                  return (
                    <div key={doc.id} className={`border-b last:border-b-0 transition-colors ${selectedIds.has(doc.id) ? 'bg-muted/40' : ''}`}>
                      <div
                        className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => toggleSelect(doc.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{[doc.title, doc.firstName, doc.lastName].filter(Boolean).join(' ')}</p>
                          <p className="text-xs text-muted-foreground">
                            {[doc.specialty, doc.institutionName, doc.city, doc.country].filter(Boolean).join(' · ')}
                          </p>
                          <div className="mt-1 flex items-center gap-1.5 text-xs">
                            {hasUsableDoctorCoordinates(doc) ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                                <MapPin className="h-3 w-3" />
                                {lang === 'de' ? 'Standortdaten vorhanden' : 'Location data available'}
                              </span>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400" role="status">
                                  <AlertTriangle className="h-3 w-3" />
                                  {lang === 'de' ? 'Standortdaten fehlen oder sind ungültig' : 'Location data missing or invalid'}
                                </span>
                                <Button
                                  data-testid={`button-geocode-doctor-${doc.id}`}
                                  variant="outline"
                                  size="sm"
                                  className="h-7 gap-1 text-xs"
                                  disabled={geocodeDoc.isPending}
                                  onClick={(e) => { e.stopPropagation(); geocodeDoc.mutate(doc.id); }}
                                >
                                  {geocodeDoc.isPending && geocodeDoc.variables === doc.id
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <MapPin className="h-3 w-3" />}
                                  {geocodeDoc.isPending && geocodeDoc.variables === doc.id
                                    ? (lang === 'de' ? 'Suche…' : 'Searching…')
                                    : (lang === 'de' ? 'Standort vorschlagen' : 'Suggest location')}
                                </Button>
                              </div>
                            )}
                          </div>
                          {(doc.phone || doc.email) && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[doc.phone, doc.email].filter(Boolean).join(' · ')}
                            </p>
                          )}
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {doc.certifications.map((c, i) => (
                              <span key={i} className={`text-xs px-1.5 py-0.5 rounded font-medium ${c.instrument === 'spirecut' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                {c.instrument === 'spirecut' ? 'Spirecut®' : 'MiniStem®'} {c.certifiedDate}
                              </span>
                            ))}
                          </div>
                        </div>
                        <Button
                          variant="ghost" size="sm"
                          onClick={e => { e.stopPropagation(); toggleCert(); }}
                          className={`shrink-0 gap-1 text-xs ${certExpanded ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                          title={lang === 'de' ? 'Zertifikat herunterladen' : 'Download certificate'}
                        >
                          <Download className="w-4 h-4" />
                          <span className="hidden sm:inline">{lang === 'de' ? 'Zertifikat' : 'Certificate'}</span>
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          onClick={e => { e.stopPropagation(); openCertEmailDialog(doc); }}
                          className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
                          title={lang === 'de' ? 'Zertifikat per E-Mail senden' : 'Email certificate'}
                        >
                          <Mail className="w-4 h-4" />
                          <span className="hidden sm:inline">{lang === 'de' ? 'E-Mail' : 'Email'}</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); openEdit(doc); }} className="text-muted-foreground hover:text-foreground shrink-0">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); if (confirm(lang === 'de' ? 'Löschen?' : 'Delete?')) delDoc.mutate(doc.id); }} className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      {certExpanded && (
                        <div className="px-5 pb-5 pt-3 border-t bg-muted/10">
                          <p className="text-xs font-semibold text-primary mb-3 flex items-center gap-1.5">
                            <Download className="w-3.5 h-3.5" />
                            {lang === 'de' ? 'Zertifikat herunterladen' : 'Download Certificate'}
                          </p>
                          <CertificatePicker
                            salutation={null}
                            medicalDegree={doc.title}
                            firstName={doc.firstName}
                            lastName={doc.lastName}
                            city={doc.city}
                            defaultInstrument={defaultInstrument}
                            trainingDateInfo={defaultCertDate}
                            defaultCertDate={defaultCertDate}
                            hideDatePicker={false}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
