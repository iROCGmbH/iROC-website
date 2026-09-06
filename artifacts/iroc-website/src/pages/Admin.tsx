import { useState, useCallback, useRef, useEffect, lazy } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CertInstrument } from '@/lib/certificate-utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTrainingDates,
  createTrainingDate,
  deleteTrainingDate,
  listTrainedDoctors,
  createTrainedDoctor,
  updateTrainedDoctor,
  deleteTrainedDoctor,
  listResources,
  createResource,
  deleteResource,
  listTeamMembers,
  createTeamMember,
  updateTeamMember,
  deleteTeamMember,
  requestUploadUrl,
  listTrainingRegistrations,
  certifyTrainingRegistration,
} from '@workspace/api-client-react';
import type {
  TrainingDateInput,
  TrainingDateInputInstrument,
  TrainedDoctorInput,
  TrainedDoctor,
  ResourceInput,
  ResourceInputType,
  ResourceInputInstrument,
  TeamMember,
  TrainingRegistration,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  Trash2,
  CalendarPlus,
  UserPlus,
  FolderPlus,
  Calendar,
  Users,
  BookOpen,
  LogOut,
  ShieldCheck,
  Loader2,
  AlertCircle,
  KeyRound,
  Eye,
  EyeOff,
  Video,
  ImagePlus,
  Pencil,
  X,
  UserCircle2,
  ClipboardList,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  BadgeCheck,
  CalendarClock,
  Globe,
  ImageIcon,
  Mail,
  ShoppingCart,
  Download,
  Search,
  Building2,
  Settings,
  Linkedin,
  Facebook,
  Instagram,
  Youtube,
  MapPin,
  Link2,
} from 'lucide-react';
import { invalidateWebsiteSettingsCache, WS_DEFAULTS } from '@/hooks/useWebsiteSettings';
import { isValidOptionalUrl } from '@/lib/url-utils';
import { MAX_HERO_IMAGE_SIZE_BYTES } from '@workspace/spirecut-shared';

const CertificatePicker = lazy(() =>
  import('@/components/CertificatePDF').then(({ CertificatePicker: Component }) => ({
    default: Component,
  })),
);
const DoctorCertButton = lazy(() =>
  import('@/components/CertificatePDF').then(({ DoctorCertButton: Component }) => ({
    default: Component,
  })),
);

const HERO_IMAGE_ACCEPT = '.avif,.gif,.jpg,.jpeg,.png,.webp';
const HERO_IMAGE_MIME_BY_EXTENSION: Record<string, string[]> = {
  avif: ['image/avif'],
  gif: ['image/gif'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
};

function isAllowedHeroImageFile(file: File): boolean {
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return !!extension && HERO_IMAGE_MIME_BY_EXTENSION[extension]?.includes(file.type.toLowerCase());
}

// ─── helpers ────────────────────────────────────────────────────────────────

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` } as HeadersInit;
}

const INSTRUMENT_OPTS = [
  { value: 'spirecut', label: 'Spirecut®' },
  { value: 'ministem', label: 'MiniStem®' },
];
const INSTRUMENT_BOTH_OPTS_FN = (t: (de: string, en: string) => string) => [
  ...INSTRUMENT_OPTS, { value: 'both', label: t('Beide', 'Both') },
];
const RESOURCE_TYPE_OPTS_FN = (t: (de: string, en: string) => string) => [
  { value: 'presentation', label: t('Präsentation', 'Presentation') },
  { value: 'study', label: t('Studie', 'Study') },
  { value: 'video', label: 'Video' },
  { value: 'link', label: 'Link' },
  { value: 'infographic', label: 'Infographic' },
  { value: 'image', label: 'Image' },
  { value: 'protocol', label: t('Protokoll', 'Protocol') },
  { value: 'invoice', label: t('Rechnung', 'Invoice') },
  { value: 'medical_finding', label: t('Medizinischer Befund', 'Medical Finding') },
];
// ─── sub-components ─────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, count }: { icon: React.ElementType; title: string; count?: number }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-3 mb-6 pb-4 border-b">
      <div className="p-2 bg-primary/10 rounded-lg">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <h2 className="text-xl font-bold">{title}</h2>
      {count !== undefined && (
        <span className="ml-auto text-sm bg-muted rounded-full px-3 py-0.5 font-medium">{count} {t('Einträge', 'entries')}</span>
      )}
    </div>
  );
}

function FormSelect({
  name,
  label,
  options,
  required,
  defaultValue,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      <select
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function FormInput({
  name,
  label,
  type = 'text',
  placeholder,
  required,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      <Input name={name} type={type} placeholder={placeholder} required={required} defaultValue={defaultValue} />
    </div>
  );
}

// ─── tabs ────────────────────────────────────────────────────────────────────

type Tab = 'training' | 'registrations' | 'doctors' | 'resources' | 'team' | 'events' | 'email' | 'customers' | 'settings';

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const { t } = useLanguage();
  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'training',       label: t('Schulungstermine', 'Training Dates'),    icon: Calendar },
    { id: 'registrations',  label: t('Anmeldungen', 'Registrations'),          icon: ClipboardList },
    { id: 'customers',      label: t('Kunden', 'Customers'),                   icon: Building2 },
    { id: 'doctors',        label: t('Zertifizierte Ärzte', 'Certified Doctors'), icon: Users },
    { id: 'resources',      label: t('Portal-Ressourcen', 'Portal Resources'), icon: BookOpen },
    { id: 'team',           label: 'Team',                                     icon: UserCircle2 },
    { id: 'events',         label: 'Events',                                   icon: CalendarClock },
    { id: 'email',          label: t('E-Mail Adressen', 'Email Addresses'),    icon: Mail },
    { id: 'settings',       label: t('Einstellungen', 'Settings'),             icon: Settings },
  ];
  return (
    <div className="flex flex-wrap gap-1 bg-muted/50 p-1 rounded-xl mb-8 border">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-2 flex-1 justify-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
            active === t.id
              ? 'bg-white shadow-sm text-primary border border-border/60'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <t.icon className="w-4 h-4" />
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Registrations tab ───────────────────────────────────────────────────────

function RegistrationRow({
  reg,
  token,
  onCertified,
}: {
  reg: TrainingRegistration;
  token: string;
  onCertified: () => void;
}) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [certInstrument, setCertInstrument] = useState<'spirecut' | 'ministem'>(
    (reg.instrument as 'spirecut' | 'ministem') ?? 'spirecut'
  );
  const [certDate, setCertDate] = useState(new Date().toISOString().slice(0, 10));

  const certify = useMutation({
    mutationFn: () =>
      certifyTrainingRegistration(
        reg.id,
        { instrument: certInstrument, certifiedDate: certDate },
        { headers: authHeaders(token) }
      ),
    onSuccess: () => {
      toast({ title: `${reg.medicalDegree ? reg.medicalDegree + ' ' : ''}${reg.firstName} ${reg.lastName} ${t('wurde zertifiziert.', 'was certified.')}` });
      onCertified();
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Zertifizieren', 'Error certifying') }),
  });

  const isCertified = !!reg.certifiedDoctorId;

  return (
    <div className={`border-b transition-colors ${isCertified ? 'bg-green-50/40' : 'hover:bg-slate-50'}`}>
      {/* Summary row */}
      <div className="flex items-center gap-3 px-6 py-4">
        {/* Instrument badge */}
        <span className={`text-xs font-bold uppercase px-2 py-1 rounded shrink-0 ${reg.instrument === 'spirecut' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
          {reg.instrument}
        </span>

        {/* Name + info */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">
            {reg.medicalDegree ? `${reg.medicalDegree} ` : ''}{reg.firstName} {reg.lastName}
            {isCertified && <BadgeCheck className="inline w-4 h-4 text-green-600 ml-1.5 mb-0.5" />}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {[reg.specialty, reg.institutionName, reg.city, reg.country].filter(Boolean).join(' · ')}
          </p>
          {reg.trainingDateInfo && (
            <p className="text-xs text-amber-700 mt-0.5">📅 {reg.trainingDateInfo}</p>
          )}
        </div>

        {/* Date */}
        <span className="text-xs text-muted-foreground hidden md:block shrink-0">
          {new Date(reg.createdAt).toLocaleDateString('de-DE')}
        </span>

        {/* Expand button */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground p-1 rounded"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded details + certify panel */}
      {expanded && (
        <div className="px-6 pb-5 space-y-4 bg-slate-50 border-t">
          {/* Full info grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 pt-4 text-sm">
            {[
              [t('E-Mail', 'Email'), reg.email],
              [t('Telefon', 'Phone'), reg.phone],
              ['Fax', reg.fax],
              ['Website', reg.websiteUrl],
              [t('Adresse', 'Address'), reg.address],
              [t('PLZ', 'Postal Code'), reg.postalCode],
              [t('Stadt', 'City'), reg.city],
              [t('Land', 'Country'), reg.country],
              [t('Fachgebiet', 'Specialty'), reg.specialty],
              [t('Institution', 'Institution'), reg.institutionName],
              ['Instrument', reg.instrument],
              [t('Schulungstermin', 'Training Date'), reg.trainingDateInfo],
              [t('Anmerkungen', 'Notes'), reg.notes],
            ].map(([label, val]) =>
              val ? (
                <div key={label}>
                  <span className="text-xs text-muted-foreground">{label}: </span>
                  <span className="text-xs font-medium">{val}</span>
                </div>
              ) : null
            )}
          </div>

          {/* Certify action */}
          {isCertified ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-700 text-sm bg-green-100 rounded-lg px-4 py-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {t('Bereits zertifiziert (Arzt-ID', 'Already certified (Doctor ID')} #{reg.certifiedDoctorId})
              </div>
              <div className="border rounded-xl p-4 bg-white space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t('Zertifikat drucken / herunterladen', 'Print / download certificate')}
                </p>
                <CertificatePicker
                  salutation={reg.salutation ?? null}
                  medicalDegree={reg.medicalDegree ?? null}
                  firstName={reg.firstName}
                  lastName={reg.lastName}
                  city={reg.city ?? null}
                  defaultInstrument={(reg.instrument as CertInstrument) ?? 'spirecut'}
                  trainingDateInfo={reg.trainingDateInfo ?? null}
                  defaultCertDate={certDate}
                />
              </div>
            </div>
          ) : (
            <div className="border rounded-xl p-4 bg-white space-y-3">
              <p className="text-sm font-semibold text-primary flex items-center gap-2">
                <BadgeCheck className="w-4 h-4" /> {t('Als zertifizierten Arzt übernehmen', 'Add as certified doctor')}
              </p>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">{t('Instrument', 'Instrument')}</label>
                  <select
                    value={certInstrument}
                    onChange={(e) => setCertInstrument(e.target.value as 'spirecut' | 'ministem')}
                    className="h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="spirecut">Spirecut®</option>
                    <option value="ministem">MiniStem®</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">{t('Zertifizierungsdatum', 'Certification Date')}</label>
                  <input
                    type="date"
                    value={certDate}
                    onChange={(e) => setCertDate(e.target.value)}
                    className="h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={certify.isPending}
                  onClick={() => certify.mutate()}
                  className="gap-2"
                >
                  {certify.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <BadgeCheck className="w-4 h-4" />}
                  {t('Zertifizieren & übernehmen', 'Certify & add')}
                </Button>
              </div>
              <div className="flex flex-col gap-2 border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t('Zertifikat vorab herunterladen', 'Download certificate in advance')}
                </p>
                <CertificatePicker
                  salutation={reg.salutation ?? null}
                  medicalDegree={reg.medicalDegree ?? null}
                  firstName={reg.firstName}
                  lastName={reg.lastName}
                  city={reg.city ?? null}
                  defaultInstrument={(certInstrument as CertInstrument)}
                  trainingDateInfo={reg.trainingDateInfo ?? null}
                  defaultCertDate={certDate}
                  hideDatePicker
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    'Der Arzt wird automatisch in der Liste „Zertifizierte Ärzte" angelegt und ist danach auf der öffentlichen Ärzte-Seite sichtbar.',
                    'The doctor will automatically be added to the "Certified Doctors" list and will be visible on the public doctors page.'
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RegistrationsTab({ token }: { token: string }) {
  const qc = useQueryClient();
  const { t } = useLanguage();
  const QK = ['admin-registrations'];
  const [filter, setFilter] = useState<'all' | 'pending' | 'certified'>('all');
  const [search, setSearch] = useState('');

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => listTrainingRegistrations({ headers: authHeaders(token) }),
  });

  const filtered = registrations.filter((r) => {
    const matchStatus =
      filter === 'all' ||
      (filter === 'pending' && !r.certifiedDoctorId) ||
      (filter === 'certified' && !!r.certifiedDoctorId);
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) ||
      (r.email ?? '').toLowerCase().includes(q) ||
      (r.institutionName ?? '').toLowerCase().includes(q) ||
      (r.city ?? '').toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const pendingCount = registrations.filter((r) => !r.certifiedDoctorId).length;
  const certifiedCount = registrations.filter((r) => !!r.certifiedDoctorId).length;

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t('Gesamt', 'Total'), value: registrations.length, color: 'text-foreground' },
          { label: t('Ausstehend', 'Pending'), value: pendingCount, color: 'text-amber-600' },
          { label: t('Zertifiziert', 'Certified'), value: certifiedCount, color: 'text-green-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white border rounded-xl p-4 text-center shadow-sm">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* List */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="px-6 py-4 border-b flex flex-wrap gap-3 items-center">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-xl font-bold">{t('Schulungsanmeldungen', 'Training Registrations')}</h2>

          <div className="ml-auto flex flex-wrap gap-2 items-center">
            {/* Search */}
            <input
              type="text"
              placeholder={t('Name, E-Mail, Stadt…', 'Name, email, city…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 px-3 rounded-md border border-input bg-background text-sm w-48 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {/* Filter buttons */}
            <div className="flex rounded-md border overflow-hidden">
              {(['all', 'pending', 'certified'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${filter === f ? 'bg-primary text-white' : 'bg-white text-muted-foreground hover:text-foreground'}`}
                >
                  {{
                    all: t('Alle', 'All'),
                    pending: t('Ausstehend', 'Pending'),
                    certified: t('Zertifiziert', 'Certified'),
                  }[f]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-16 text-muted-foreground text-sm">
            {registrations.length === 0
              ? t('Noch keine Schulungsanmeldungen eingegangen.', 'No training registrations yet.')
              : t('Keine Einträge für diesen Filter.', 'No entries for this filter.')}
          </p>
        ) : (
          <div className="divide-y">
            {filtered.map((reg) => (
              <RegistrationRow
                key={reg.id}
                reg={reg}
                token={token}
                onCertified={() => qc.invalidateQueries({ queryKey: QK })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Training Dates tab ───────────────────────────────────────────────────────

function TrainingTab({ token }: { token: string }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const qc = useQueryClient();
  const QK = ['admin-training'];

  const { data: dates = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => getTrainingDates({ headers: authHeaders(token) }),
  });

  const add = useMutation({
    mutationFn: (data: TrainingDateInput) =>
      createTrainingDate(data, { headers: authHeaders(token) }),
    onSuccess: () => {
      toast({ title: t('Termin hinzugefügt', 'Date added') });
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Hinzufügen', 'Error adding') }),
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteTrainingDate(id, { headers: authHeaders(token) }),
    onSuccess: () => {
      toast({ title: t('Termin gelöscht', 'Date deleted') });
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Löschen', 'Error deleting') }),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    add.mutate({
      instrument: fd.get('instrument') as TrainingDateInputInstrument,
      date: fd.get('date') as string,
      time: (fd.get('time') as string) || null,
      location: fd.get('location') as string,
      locationDetail: (fd.get('locationDetail') as string) || null,
      maxParticipants: parseInt(fd.get('maxParticipants') as string, 10),
      notes: (fd.get('notes') as string) || null,
    });
    e.currentTarget.reset();
  }

  return (
    <div className="space-y-8">
      {/* Add form */}
      <div className="bg-white border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-primary font-semibold">
          <CalendarPlus className="w-4 h-4" /> {t('Neuen Termin hinzufügen', 'Add New Date')}
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <FormSelect name="instrument" label="Instrument" options={INSTRUMENT_OPTS} defaultValue="spirecut" />
          <FormInput name="date" label={t('Datum', 'Date')} type="date" required />
          <FormInput name="time" label={t('Uhrzeit (optional)', 'Time (optional)')} type="time" />
          <FormInput name="location" label={t('Ort / Stadt', 'Location / City')} placeholder={t('z.B. München', 'e.g. Munich')} required />
          <FormInput name="locationDetail" label={t('Adresse / Detail (optional)', 'Address / Detail (optional)')} placeholder={t('z.B. Hotel XY, Raum 3', 'e.g. Hotel XY, Room 3')} />
          <FormInput name="maxParticipants" label={t('Max. Teilnehmer', 'Max. participants')} type="number" defaultValue="10" required />
          <div className="col-span-2 md:col-span-3 flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Hinweise (optional)', 'Notes (optional)')}</label>
            <textarea
              name="notes"
              rows={2}
              placeholder={t('Besondere Hinweise zum Termin…', 'Special notes for this date…')}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>
          <div className="col-span-2 md:col-span-3">
            <Button type="submit" disabled={add.isPending} className="w-full">
              {add.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CalendarPlus className="w-4 h-4 mr-2" />}
              {t('Termin speichern', 'Save Date')}
            </Button>
          </div>
        </form>
      </div>

      {/* List */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <SectionHeader icon={Calendar} title={t('Alle Schulungstermine', 'All Training Dates')} count={dates.length} />
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : dates.length === 0 ? (
          <p className="text-center py-12 text-muted-foreground text-sm">{t('Keine Termine vorhanden.', 'No dates available.')}</p>
        ) : (
          <div className="divide-y">
            {[...dates].sort((a, b) => a.date.localeCompare(b.date)).map((d) => (
              <div key={d.id} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
                <span className={`text-xs font-bold uppercase px-2 py-1 rounded shrink-0 ${d.instrument === 'spirecut' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                  {d.instrument}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">
                    {new Date(d.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' })}
                    {d.time && <span className="text-muted-foreground ml-2">{d.time}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {d.location}{d.locationDetail ? ` · ${d.locationDetail}` : ''} · {d.availableSpots}/{d.maxParticipants} {t('frei', 'available')}
                  </p>
                  {d.notes && <p className="text-xs text-amber-600 mt-0.5">{d.notes}</p>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 shrink-0"
                  disabled={del.isPending}
                  onClick={() => del.mutate(d.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Known products (extend here when new products launch) ───────────────────

const KNOWN_PRODUCTS = [
  { value: 'spirecut', label: 'Spirecut®', color: 'bg-blue-100 text-blue-700' },
  { value: 'ministem', label: 'MiniStem®', color: 'bg-green-100 text-green-700' },
];

function productLabel(instrument: string) {
  return KNOWN_PRODUCTS.find((p) => p.value === instrument)?.label ?? instrument;
}
function productColor(instrument: string) {
  return KNOWN_PRODUCTS.find((p) => p.value === instrument)?.color ?? 'bg-gray-100 text-gray-700';
}

// ─── Certification row editor ─────────────────────────────────────────────────

interface CertRow { instrument: string; certifiedDate: string }

function CertificationsEditor({
  value,
  onChange,
}: {
  value: CertRow[];
  onChange: (rows: CertRow[]) => void;
}) {
  const [custom, setCustom] = useState('');

  const allProducts = [
    ...KNOWN_PRODUCTS,
    ...(custom.trim() ? [{ value: custom.trim().toLowerCase().replace(/\s+/g, '-'), label: custom.trim(), color: 'bg-purple-100 text-purple-700' }] : []),
  ];

  function toggle(instrument: string) {
    const exists = value.find((r) => r.instrument === instrument);
    if (exists) {
      onChange(value.filter((r) => r.instrument !== instrument));
    } else {
      onChange([...value, { instrument, certifiedDate: new Date().toISOString().slice(0, 10) }]);
    }
  }

  function setDate(instrument: string, date: string) {
    onChange(value.map((r) => r.instrument === instrument ? { ...r, certifiedDate: date } : r));
  }

  const { t } = useLanguage();
  return (
    <div className="col-span-2 md:col-span-3 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Zertifizierungen *', 'Certifications *')}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {allProducts.map((p) => {
          const row = value.find((r) => r.instrument === p.value);
          const checked = !!row;
          return (
            <div
              key={p.value}
              className={`border rounded-xl p-4 transition-colors ${checked ? 'border-primary bg-primary/5' : 'border-border bg-white'}`}
            >
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(p.value)}
                  className="w-4 h-4 accent-primary"
                />
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${p.color}`}>{p.label}</span>
              </label>
              {checked && (
                <div className="mt-3 flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">{t('Zertifizierungsdatum', 'Certification Date')}</label>
                  <input
                    type="date"
                    value={row!.certifiedDate}
                    onChange={(e) => setDate(p.value, e.target.value)}
                    className="h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}
            </div>
          );
        })}
        {/* Add future product */}
        <div className="border border-dashed rounded-xl p-4 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t('Weiteres Produkt hinzufügen', 'Add another product')}</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('Produktname', 'Product name')}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              disabled={!custom.trim()}
              onClick={() => {
                const key = custom.trim().toLowerCase().replace(/\s+/g, '-');
                if (!value.find((r) => r.instrument === key)) {
                  onChange([...value, { instrument: key, certifiedDate: new Date().toISOString().slice(0, 10) }]);
                }
                setCustom('');
              }}
              className="px-3 h-9 rounded-md bg-primary text-white text-sm disabled:opacity-40"
            >+</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Doctor inline card ───────────────────────────────────────────────────────

function DoctorCard({
  doc,
  token,
  onSaved,
  onDeleted,
}: {
  doc: TrainedDoctor;
  token: string;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editCerts, setEditCerts] = useState<CertRow[]>([]);

  // draft state (controlled inputs)
  const [draft, setDraft] = useState({
    title: doc.title ?? '',
    firstName: doc.firstName,
    lastName: doc.lastName,
    specialty: doc.specialty ?? '',
    institutionName: doc.institutionName ?? '',
    postalCode: doc.postalCode ?? '',
    city: doc.city,
    country: doc.country,
    websiteUrl: doc.websiteUrl ?? '',
  });

  function openEdit() {
    setDraft({
      title: doc.title ?? '',
      firstName: doc.firstName,
      lastName: doc.lastName,
      specialty: doc.specialty ?? '',
      institutionName: doc.institutionName ?? '',
      postalCode: doc.postalCode ?? '',
      city: doc.city,
      country: doc.country,
      websiteUrl: doc.websiteUrl ?? '',
    });
    setEditCerts(
      doc.certifications.map((c) => ({ instrument: c.instrument, certifiedDate: c.certifiedDate }))
    );
    setEditing(true);
  }

  const { t } = useLanguage();
  const save = useMutation({
    mutationFn: () =>
      updateTrainedDoctor(doc.id, {
        title: draft.title || null,
        firstName: draft.firstName,
        lastName: draft.lastName,
        specialty: draft.specialty || null,
        institutionName: draft.institutionName || null,
        postalCode: draft.postalCode || null,
        city: draft.city,
        country: draft.country,
        websiteUrl: draft.websiteUrl || null,
        certifications: editCerts,
      } as TrainedDoctorInput, { headers: authHeaders(token) }),
    onSuccess: () => {
      toast({ title: t('Gespeichert', 'Saved') });
      setEditing(false);
      onSaved();
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Speichern', 'Error saving') }),
  });

  const del = useMutation({
    mutationFn: () => deleteTrainedDoctor(doc.id, { headers: authHeaders(token) }),
    onSuccess: () => { toast({ title: t('Arzt gelöscht', 'Doctor deleted') }); onDeleted(); },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Löschen', 'Error deleting') }),
  });

  function field(key: keyof typeof draft, label: string, opts?: { placeholder?: string; required?: boolean }) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {label}{opts?.required && ' *'}
        </label>
        <Input
          value={draft[key]}
          placeholder={opts?.placeholder}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        />
      </div>
    );
  }

  /* ── collapsed row ── */
  if (!editing) {
    return (
      <div className="flex items-start gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary font-bold text-sm mt-0.5">
          {doc.firstName[0]}{doc.lastName[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">
            {doc.title ? `${doc.title} ` : ''}{doc.firstName} {doc.lastName}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {doc.specialty && `${doc.specialty} · `}
            {doc.institutionName && `${doc.institutionName} · `}
            {doc.postalCode ? `${doc.postalCode} ` : ''}{doc.city}, {doc.country}
          </p>
          {doc.websiteUrl && (
            <a href={doc.websiteUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline truncate block mt-0.5">
              {doc.websiteUrl}
            </a>
          )}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {doc.certifications.map((c) => (
              <span key={c.instrument} className={`text-xs font-semibold px-2 py-0.5 rounded ${productColor(c.instrument)}`}>
                {productLabel(c.instrument)} · {new Date(c.certifiedDate).toLocaleDateString('de-DE')}
              </span>
            ))}
          </div>
          {doc.certifications.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {doc.certifications.map((c) => (
                <DoctorCertButton
                  key={c.instrument}
                  title={doc.title ?? null}
                  firstName={doc.firstName}
                  lastName={doc.lastName}
                  city={doc.city}
                  instrument={c.instrument as CertInstrument}
                  certifiedDate={c.certifiedDate}
                />
              ))}
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={openEdit} className="shrink-0">
          <Pencil className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost" size="icon"
          className="text-destructive hover:bg-destructive/10 shrink-0"
          disabled={del.isPending}
          onClick={() => del.mutate()}
        >
          {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </Button>
      </div>
    );
  }

  /* ── expanded edit form ── */
  return (
    <div className="px-6 py-5 bg-slate-50 border-b space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm text-primary">
          {t('Bearbeiten:', 'Edit:')} {doc.title ? `${doc.title} ` : ''}{doc.firstName} {doc.lastName}
        </p>
        <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {field('title', t('Titel', 'Title'), { placeholder: t('z.B. Dr. med.', 'e.g. Dr. med.') })}
        {field('firstName', t('Vorname', 'First name'), { required: true })}
        {field('lastName', t('Nachname', 'Last name'), { required: true })}
        {field('specialty', t('Fachgebiet', 'Specialty'), { placeholder: t('z.B. Orthopädie', 'e.g. Orthopedics') })}
        {field('institutionName', t('Praxis / Klinik', 'Practice / clinic'), { placeholder: t('z.B. Praxis Dr. Müller', 'e.g. Dr. Smith Practice') })}
        {field('postalCode', t('PLZ', 'Postal code'), { placeholder: t('z.B. 85609', 'e.g. 85609') })}
        {field('city', t('Stadt', 'City'), { required: true })}
        {field('country', t('Land', 'Country'), { required: true })}
        {field('websiteUrl', t('Website', 'Website'), { placeholder: 'https://praxis-mustermann.de' })}
      </div>

      <CertificationsEditor value={editCerts} onChange={setEditCerts} />

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>{t('Abbrechen', 'Cancel')}</Button>
        <Button
          size="sm"
          disabled={save.isPending || !draft.firstName.trim() || !draft.lastName.trim() || !draft.city.trim() || !draft.country.trim() || editCerts.length === 0}
          onClick={() => save.mutate()}
        >
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          {t('Speichern', 'Save')}
        </Button>
      </div>
    </div>
  );
}

// ─── Doctors tab ─────────────────────────────────────────────────────────────

function DoctorsTab({ token }: { token: string }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const QK = ['admin-doctors'];

  const [certs, setCerts] = useState<CertRow[]>([{ instrument: 'spirecut', certifiedDate: new Date().toISOString().slice(0, 10) }]);
  const formRef = useRef<HTMLFormElement>(null);

  const { data: doctors = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => listTrainedDoctors(undefined, { headers: authHeaders(token) }),
  });

  const add = useMutation({
    mutationFn: (data: TrainedDoctorInput) =>
      createTrainedDoctor(data, { headers: authHeaders(token) }),
    onSuccess: () => {
      toast({ title: t('Arzt hinzugefügt', 'Doctor added') });
      qc.invalidateQueries({ queryKey: QK });
      setCerts([{ instrument: 'spirecut', certifiedDate: new Date().toISOString().slice(0, 10) }]);
      formRef.current?.reset();
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Hinzufügen', 'Error adding') }),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (certs.length === 0) {
      toast({ variant: 'destructive', title: t('Bitte mindestens eine Zertifizierung auswählen.', 'Please select at least one certification.') });
      return;
    }
    const fd = new FormData(e.currentTarget);
    add.mutate({
      title: (fd.get('title') as string) || null,
      firstName: fd.get('firstName') as string,
      lastName: fd.get('lastName') as string,
      specialty: (fd.get('specialty') as string) || null,
      institutionName: (fd.get('institutionName') as string) || null,
      postalCode: (fd.get('postalCode') as string) || null,
      city: fd.get('city') as string,
      country: fd.get('country') as string,
      websiteUrl: (fd.get('websiteUrl') as string) || null,
      certifications: certs,
    } as TrainedDoctorInput);
  }

  return (
    <div className="space-y-8">
      {/* Add form */}
      <div className="bg-white border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-primary font-semibold">
          <UserPlus className="w-4 h-4" /> {t('Neuen Arzt hinzufügen', 'Add New Doctor')}
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <FormInput name="title" label={t('Titel (optional)', 'Title (optional)')} placeholder={t('z.B. Dr. med.', 'e.g. Dr. med.')} />
          <FormInput name="firstName" label={t('Vorname', 'First Name')} required />
          <FormInput name="lastName" label={t('Nachname', 'Last Name')} required />
          <FormInput name="specialty" label={t('Fachgebiet (optional)', 'Specialty (optional)')} placeholder={t('z.B. Orthopädie', 'e.g. Orthopedics')} />
          <FormInput name="institutionName" label={t('Praxis / Klinik (optional)', 'Practice / Clinic (optional)')} placeholder={t('z.B. Praxis Dr. Müller', 'e.g. Practice Dr. Smith')} />
          <FormInput name="postalCode" label={t('PLZ (optional)', 'Postal Code (optional)')} placeholder={t('z.B. 85609', 'e.g. 85609')} />
          <FormInput name="city" label={t('Stadt', 'City')} required placeholder={t('z.B. München', 'e.g. Munich')} />
          <FormInput name="country" label={t('Land', 'Country')} required defaultValue="Deutschland" />
          <FormInput name="websiteUrl" label={t('Website (optional)', 'Website (optional)')} placeholder="https://praxis-mustermann.de" />
          <CertificationsEditor value={certs} onChange={setCerts} />
          <div className="col-span-2 md:col-span-3">
            <Button type="submit" disabled={add.isPending || certs.length === 0} className="w-full">
              {add.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
              {t('Arzt speichern', 'Save Doctor')}
            </Button>
          </div>
        </form>
      </div>

      {/* List */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <SectionHeader icon={Users} title={t('Zertifizierte Ärzte', 'Certified Doctors')} count={doctors.length} />
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : doctors.length === 0 ? (
          <p className="text-center py-12 text-muted-foreground text-sm">{t('Keine Ärzte eingetragen.', 'No doctors entered.')}</p>
        ) : (
          <div className="divide-y">
            {doctors.map((doc) => (
              <DoctorCard
                key={doc.id}
                doc={doc}
                token={token}
                onSaved={() => qc.invalidateQueries({ queryKey: QK })}
                onDeleted={() => qc.invalidateQueries({ queryKey: QK })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Resources tab ────────────────────────────────────────────────────────────

function ResourcesTab({ token }: { token: string }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const qc = useQueryClient();
  const QK = ['admin-resources'];

  const { data: resources = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => listResources(undefined, { headers: authHeaders(token) }),
  });

  const add = useMutation({
    mutationFn: (data: ResourceInput) =>
      createResource(data, { headers: authHeaders(token) }),
    onSuccess: () => {
      toast({ title: t('Ressource hinzugefügt', 'Resource added') });
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Hinzufügen', 'Error adding') }),
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteResource(id, { headers: authHeaders(token) }),
    onSuccess: () => {
      toast({ title: t('Ressource gelöscht', 'Resource deleted') });
      qc.invalidateQueries({ queryKey: QK });
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Löschen', 'Error deleting') }),
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    add.mutate({
      title: fd.get('title') as string,
      titleDe: (fd.get('titleDe') as string) || null,
      description: (fd.get('description') as string) || null,
      descriptionDe: (fd.get('descriptionDe') as string) || null,
      type: fd.get('type') as ResourceInputType,
      instrument: fd.get('instrument') as ResourceInputInstrument,
      url: fd.get('url') as string,
      thumbnailUrl: (fd.get('thumbnailUrl') as string) || null,
    });
    e.currentTarget.reset();
  }

  const typeColor: Record<string, string> = {
    presentation: 'bg-purple-100 text-purple-700',
    study: 'bg-blue-100 text-blue-700',
    video: 'bg-red-100 text-red-700',
    link: 'bg-gray-100 text-gray-700',
    infographic: 'bg-orange-100 text-orange-700',
    image: 'bg-teal-100 text-teal-700',
    protocol: 'bg-indigo-100 text-indigo-700',
    invoice: 'bg-yellow-100 text-yellow-700',
    medical_finding: 'bg-rose-100 text-rose-700',
  };

  return (
    <div className="space-y-8">
      {/* Add form */}
      <div className="bg-white border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-primary font-semibold">
          <FolderPlus className="w-4 h-4" /> {t('Neue Ressource hinzufügen', 'Add New Resource')}
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <FormInput name="title" label={t('Titel (EN)', 'Title (EN)')} required placeholder={t('Leitfaden zur chirurgischen Technik', 'Surgical Technique Guide')} />
          <FormInput name="titleDe" label={t('Titel (DE, optional)', 'Title (DE, optional)')} placeholder={t('Chirurgische Technik', 'Surgical technique')} />
          <FormSelect name="type" label={t('Typ', 'Type')} options={RESOURCE_TYPE_OPTS_FN(t)} defaultValue="presentation" />
          <FormSelect name="instrument" label={t('Instrument', 'Instrument')} options={INSTRUMENT_BOTH_OPTS_FN(t)} defaultValue="spirecut" />
          <div className="col-span-2">
            <FormInput name="url" label={t('URL / Link', 'URL / link')} type="url" required placeholder="https://…" />
          </div>
          <FormInput name="description" label={t('Beschreibung EN (optional)', 'Description EN (optional)')} placeholder={t('Kurze Beschreibung auf Englisch', 'Short description in English')} />
          <FormInput name="descriptionDe" label={t('Beschreibung DE (optional)', 'Description DE (optional)')} placeholder={t('Kurze Beschreibung auf Deutsch', 'Short description in German')} />
          <FormInput name="thumbnailUrl" label={t('Vorschaubild URL (optional)', 'Thumbnail URL (optional)')} type="url" placeholder="https://…" />
          <div className="col-span-2 md:col-span-3">
            <Button type="submit" disabled={add.isPending} className="w-full">
              {add.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FolderPlus className="w-4 h-4 mr-2" />}
              {t('Ressource speichern', 'Save Resource')}
            </Button>
          </div>
        </form>
      </div>

      {/* List */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <SectionHeader icon={BookOpen} title={t('Portal-Ressourcen', 'Portal Resources')} count={resources.length} />
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : resources.length === 0 ? (
          <p className="text-center py-12 text-muted-foreground text-sm">{t('Keine Ressourcen vorhanden.', 'No resources available.')}</p>
        ) : (
          <div className="divide-y">
            {resources.map((r) => (
              <div key={r.id} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
                <span className={`text-xs font-bold uppercase px-2 py-1 rounded shrink-0 ${typeColor[r.type] ?? 'bg-gray-100 text-gray-700'}`}>
                  {r.type}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{r.titleDe ?? r.title}</p>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate block">{r.url}</a>
                  {r.descriptionDe && <p className="text-xs text-muted-foreground mt-0.5 truncate">{r.descriptionDe}</p>}
                </div>
                <span className={`text-xs font-bold uppercase px-2 py-1 rounded shrink-0 ${r.instrument === 'spirecut' ? 'bg-blue-100 text-blue-700' : r.instrument === 'ministem' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                  {r.instrument}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 shrink-0"
                  disabled={del.isPending}
                  onClick={() => del.mutate(r.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Product Video URLs */}
      <VideoUrlsPanel token={token} />

      {/* Portal Passwords */}
      <PortalPasswordsPanel token={token} />
    </div>
  );
}

// ─── Video URLs panel ─────────────────────────────────────────────────────────

interface VideoUrlState { spirecut: string; ministem: string }

function VideoUrlsPanel({ token }: { token: string }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [spirecutUrl, setSpirecutUrl] = useState('');
  const [ministemUrl, setMiniStemUrl] = useState('');

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

  const { data: current, refetch } = useQuery<VideoUrlState>({
    queryKey: ['admin-video-urls'],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/admin/video-urls`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const save = useMutation({
    mutationFn: async ({ instrument, url }: { instrument: string; url: string }) => {
      const res = await fetch(`${BASE}/api/admin/video-urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ instrument, url }),
      });
      if (!res.ok) throw new Error('Fehler beim Speichern');
      return instrument;
    },
    onSuccess: (instrument) => {
      toast({ title: `${instrument === 'spirecut' ? 'Spirecut®' : 'MiniStem®'} ${t('Video-Link aktualisiert', 'video link updated')}` });
      if (instrument === 'spirecut') setSpirecutUrl('');
      else setMiniStemUrl('');
      refetch();
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: t('Fehler', 'Error'), description: err.message }),
  });

  function embedUrl(raw: string) {
    // Accept plain youtube URLs and convert to embed format
    const m = raw.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
    return raw;
  }

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b flex items-center gap-3">
        <div className="p-2 bg-blue-50 rounded-lg">
          <Video className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold">{t('Produkt-Videos', 'Product Videos')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('YouTube-Links für Spirecut® und MiniStem® (embed oder normaler Link werden automatisch umgewandelt)', 'YouTube links for Spirecut® and MiniStem® (embed or regular links are converted automatically)')}
          </p>
        </div>
      </div>

      <div className="p-6 grid md:grid-cols-2 gap-6">
        {/* Spirecut */}
        <div className="border rounded-xl p-5 space-y-4">
          <span className="text-sm font-bold block">Spirecut® {t('Video', 'Video')}</span>
          {current?.spirecut && (
            <p className="text-xs text-muted-foreground break-all">
              <span className="font-medium">{t('Aktuell:', 'Current:')} </span>{current.spirecut}
            </p>
          )}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Neuer Link', 'New Link')}</label>
            <Input
              value={spirecutUrl}
              onChange={(e) => setSpirecutUrl(e.target.value)}
              placeholder={t('https://www.youtube.com/watch?v=… oder embed-URL', 'https://www.youtube.com/watch?v=… or embed URL')}
            />
          </div>
          <Button
            className="w-full"
            disabled={!spirecutUrl.trim() || save.isPending}
            onClick={() => save.mutate({ instrument: 'spirecut', url: embedUrl(spirecutUrl.trim()) })}
          >
            {save.isPending && save.variables?.instrument === 'spirecut'
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : <Video className="w-4 h-4 mr-2" />}
            {t('Spirecut® Link speichern', 'Save Spirecut® Link')}
          </Button>
        </div>

        {/* MiniStem */}
        <div className="border rounded-xl p-5 space-y-4">
          <span className="text-sm font-bold block">MiniStem® {t('Video', 'Video')}</span>
          {current?.ministem ? (
            <p className="text-xs text-muted-foreground break-all">
              <span className="font-medium">{t('Aktuell:', 'Current:')} </span>{current.ministem}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground italic">{t('Noch kein Video gesetzt – Abschnitt wird nicht angezeigt.', 'No video set yet – section will not be displayed.')}</p>
          )}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Neuer Link', 'New Link')}</label>
            <Input
              value={ministemUrl}
              onChange={(e) => setMiniStemUrl(e.target.value)}
              placeholder={t('https://www.youtube.com/watch?v=… oder embed-URL', 'https://www.youtube.com/watch?v=… or embed URL')}
            />
          </div>
          <Button
            className="w-full"
            disabled={!ministemUrl.trim() || save.isPending}
            onClick={() => save.mutate({ instrument: 'ministem', url: embedUrl(ministemUrl.trim()) })}
          >
            {save.isPending && save.variables?.instrument === 'ministem'
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : <Video className="w-4 h-4 mr-2" />}
            {t('MiniStem® Link speichern', 'Save MiniStem® Link')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Portal Passwords panel ───────────────────────────────────────────────────

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  showLabel,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  showLabel: string;
  hideLabel: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className="relative">
        <Input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? hideLabel : showLabel}
          aria-pressed={show}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

interface PortalPasswordStatus {
  spirecutSet: boolean;
  ministemSet: boolean;
}

function PortalPasswordsPanel({ token }: { token: string }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [spirecutPw, setSpirecutPw] = useState('');
  const [ministemPw, setMiniStemPw] = useState('');

  const { data: status, refetch } = useQuery<PortalPasswordStatus>({
    queryKey: ['admin-portal-passwords'],
    queryFn: async () => {
      const res = await fetch('/api/admin/portal-passwords', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const setPassword = useMutation({
    mutationFn: async ({ instrument, password }: { instrument: string; password: string }) => {
      const res = await fetch('/api/admin/portal-passwords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ instrument, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Fehler');
      }
      return instrument;
    },
    onSuccess: (instrument) => {
      toast({ title: `${instrument === 'spirecut' ? 'Spirecut®' : 'MiniStem®'} ${t('Passwort aktualisiert', 'password updated')}` });
      if (instrument === 'spirecut') setSpirecutPw('');
      else setMiniStemPw('');
      refetch();
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: t('Fehler', 'Error'), description: err.message }),
  });

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b flex items-center gap-3">
        <div className="p-2 bg-amber-50 rounded-lg">
          <KeyRound className="w-5 h-5 text-amber-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold">{t('Portal-Passwörter', 'Portal Passwords')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('Login-Passwörter für den Arzt-Bereich (Spirecut® und MiniStem®)', 'Login passwords for the doctor portal (Spirecut® and MiniStem®)')}
          </p>
        </div>
      </div>

      <div className="p-6 grid md:grid-cols-2 gap-6">
        {/* Spirecut */}
        <div className="border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Spirecut® Portal</span>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${status?.spirecutSet ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {status?.spirecutSet ? t('Benutzerdefiniert', 'Custom') : t('Standard (spirecut2024)', 'Default (spirecut2024)')}
            </span>
          </div>
          <PasswordField
            label={t('Neues Passwort', 'New Password')}
            value={spirecutPw}
            onChange={setSpirecutPw}
            placeholder={t('Mind. 8 Zeichen', 'At least 8 characters')}
            showLabel={t('Passwort anzeigen', 'Show password')}
            hideLabel={t('Passwort ausblenden', 'Hide password')}
          />
          <Button
            className="w-full"
            disabled={spirecutPw.length < 8 || setPassword.isPending}
            onClick={() => setPassword.mutate({ instrument: 'spirecut', password: spirecutPw })}
          >
            {setPassword.isPending && setPassword.variables?.instrument === 'spirecut'
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : <KeyRound className="w-4 h-4 mr-2" />}
            {t('Spirecut® Passwort setzen', 'Set Spirecut® Password')}
          </Button>
        </div>

        {/* MiniStem */}
        <div className="border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">MiniStem® Portal</span>
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${status?.ministemSet ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {status?.ministemSet ? t('Benutzerdefiniert', 'Custom') : t('Standard (ministem2024)', 'Default (ministem2024)')}
            </span>
          </div>
          <PasswordField
            label={t('Neues Passwort', 'New Password')}
            value={ministemPw}
            onChange={setMiniStemPw}
            placeholder={t('Mind. 8 Zeichen', 'At least 8 characters')}
            showLabel={t('Passwort anzeigen', 'Show password')}
            hideLabel={t('Passwort ausblenden', 'Hide password')}
          />
          <Button
            className="w-full"
            disabled={ministemPw.length < 8 || setPassword.isPending}
            onClick={() => setPassword.mutate({ instrument: 'ministem', password: ministemPw })}
          >
            {setPassword.isPending && setPassword.variables?.instrument === 'ministem'
              ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
              : <KeyRound className="w-4 h-4 mr-2" />}
            {t('MiniStem® Passwort setzen', 'Set MiniStem® Password')}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Team tab ────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

function photoUrl(path: string | null | undefined) {
  if (!path) return null;
  return `${BASE_URL}/api/storage${path}`;
}

/** Upload a file → get presigned URL → PUT to GCS → return objectPath */
async function uploadPhoto(file: File, token: string): Promise<string> {
  // Step 1: request presigned URL
  const metaRes = await requestUploadUrl(
    { name: file.name, size: file.size, contentType: file.type },
    { headers: { Authorization: `Bearer ${token}` } as HeadersInit }
  );
  // Step 2: PUT directly to GCS
  const putRes = await fetch(metaRes.uploadURL, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error('Upload to storage failed');
  return metaRes.objectPath;
}

type TeamCategory = 'consulting_doctors' | 'specialists' | 'ai_agents';

interface EditState {
  id: number;
  name: string;
  role: string;
  roleDe: string;
  bio: string;
  bioDe: string;
  photoPath: string | null;
  sortOrder: number;
  category: TeamCategory;
}

function TeamMemberCard({
  member,
  token,
  onSaved,
  onDeleted,
}: {
  member: TeamMember;
  token: string;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<EditState>({
    id: member.id,
    name: member.name,
    role: member.role,
    roleDe: member.roleDe ?? '',
    bio: member.bio ?? '',
    bioDe: member.bioDe ?? '',
    photoPath: member.photoPath ?? null,
    sortOrder: member.sortOrder,
    category: (member.category as TeamCategory) ?? 'consulting_doctors',
  });

  const { t } = useLanguage();
  const save = useMutation({
    mutationFn: () =>
      updateTeamMember(member.id, {
        name: draft.name,
        role: draft.role,
        roleDe: draft.roleDe || null,
        bio: draft.bio || null,
        bioDe: draft.bioDe || null,
        photoPath: draft.photoPath,
        sortOrder: draft.sortOrder,
        category: draft.category,
      }, { headers: { Authorization: `Bearer ${token}` } as HeadersInit }),
    onSuccess: () => { toast({ title: t('Gespeichert', 'Saved') }); setEditing(false); onSaved(); },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Speichern', 'Error saving') }),
  });

  const del = useMutation({
    mutationFn: () => deleteTeamMember(member.id, { headers: { Authorization: `Bearer ${token}` } as HeadersInit }),
    onSuccess: () => { toast({ title: t('Gelöscht', 'Deleted') }); onDeleted(); },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Löschen', 'Error deleting') }),
  });

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadPhoto(file, token);
      setDraft((d) => ({ ...d, photoPath: path }));
      toast({ title: t('Foto hochgeladen', 'Photo uploaded') });
    } catch {
      toast({ variant: 'destructive', title: t('Foto-Upload fehlgeschlagen', 'Photo upload failed') });
    } finally {
      setUploading(false);
    }
  }

  const photo = photoUrl(draft.photoPath);

  if (!editing) {
    return (
      <div className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
        {/* Avatar */}
        <div className="w-12 h-12 rounded-full border-2 border-white shadow overflow-hidden bg-slate-100 flex items-center justify-center shrink-0">
          {photo ? (
            <img src={photo} alt={member.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg font-bold text-primary/30">{member.name.charAt(0)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{member.name}</p>
          <p className="text-xs text-muted-foreground">{member.role}{member.roleDe ? ` · ${member.roleDe}` : ''}</p>
        </div>
        <span className="text-xs text-muted-foreground hidden md:block">#{member.sortOrder}</span>
        <Button variant="ghost" size="icon" onClick={() => setEditing(true)} className="shrink-0">
          <Pencil className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:bg-destructive/10 shrink-0"
          disabled={del.isPending}
          onClick={() => del.mutate()}
        >
          {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </Button>
      </div>
    );
  }

  return (
    <div className="px-6 py-5 bg-slate-50 border-b space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm text-primary">{t('Bearbeiten', 'Edit')}: {member.name}</p>
        <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Photo upload */}
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full border-4 border-white shadow overflow-hidden bg-slate-200 flex items-center justify-center shrink-0">
          {photo ? (
            <img src={photo} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl font-bold text-slate-400">{draft.name.charAt(0)}</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="gap-2"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
            {uploading ? t('Wird hochgeladen…', 'Uploading…') : t('Foto hochladen', 'Upload Photo')}
          </Button>
          {draft.photoPath && (
            <button
              className="text-xs text-destructive hover:underline text-left"
              onClick={() => setDraft((d) => ({ ...d, photoPath: null }))}
            >
              {t('Foto entfernen', 'Remove Photo')}
            </button>
          )}
        </div>
      </div>

      {/* Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Name', 'Name')} *</label>
          <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Reihenfolge', 'Order')}</label>
          <Input type="number" value={draft.sortOrder} onChange={(e) => setDraft((d) => ({ ...d, sortOrder: parseInt(e.target.value) || 0 }))} />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Gruppe', 'Group')}</label>
          <select
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as TeamCategory }))}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="consulting_doctors">{t('Beratende Mediziner', 'Consulting Medical Doctors')}</option>
            <option value="specialists">{t('Spezialisten', 'Specialists')}</option>
            <option value="ai_agents">{t('Agents/Managers', 'Agents/Managers')}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Rolle (EN)', 'Role (EN)')} *</label>
          <Input value={draft.role} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Rolle (DE)', 'Role (DE)')}</label>
          <Input value={draft.roleDe} onChange={(e) => setDraft((d) => ({ ...d, roleDe: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bio (EN)</label>
          <textarea
            value={draft.bio}
            onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
            rows={2}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bio (DE)</label>
          <textarea
            value={draft.bioDe}
            onChange={(e) => setDraft((d) => ({ ...d, bioDe: e.target.value }))}
            rows={2}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={() => setEditing(false)}>{t('Abbrechen', 'Cancel')}</Button>
        <Button size="sm" disabled={save.isPending || !draft.name || !draft.role} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          {t('Speichern', 'Save')}
        </Button>
      </div>
    </div>
  );
}

function TeamTab({ token }: { token: string }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const qc = useQueryClient();
  const QK = ['admin-team'];
  const fileRef = useRef<HTMLInputElement>(null);

  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newRoleDe, setNewRoleDe] = useState('');
  const [newPhotoPath, setNewPhotoPath] = useState<string | null>(null);
  const [newSortOrder, setNewSortOrder] = useState(0);
  const [newCategory, setNewCategory] = useState<TeamCategory>('consulting_doctors');
  const [uploading, setUploading] = useState(false);

  const { data: members = [], isLoading } = useQuery({
    queryKey: QK,
    queryFn: () => listTeamMembers({ headers: { Authorization: `Bearer ${token}` } as HeadersInit }),
  });

  const add = useMutation({
    mutationFn: () =>
      createTeamMember(
        { name: newName, role: newRole, roleDe: newRoleDe || null, photoPath: newPhotoPath, sortOrder: newSortOrder, category: newCategory },
        { headers: { Authorization: `Bearer ${token}` } as HeadersInit }
      ),
    onSuccess: () => {
      toast({ title: t('Mitglied hinzugefügt', 'Member added') });
      qc.invalidateQueries({ queryKey: QK });
      setNewName(''); setNewRole(''); setNewRoleDe(''); setNewPhotoPath(null); setNewSortOrder(members.length); setNewCategory('consulting_doctors');
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler', 'Error') }),
  });

  async function handleNewPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadPhoto(file, token);
      setNewPhotoPath(path);
      toast({ title: t('Foto hochgeladen', 'Photo uploaded') });
    } catch {
      toast({ variant: 'destructive', title: t('Upload fehlgeschlagen', 'Upload failed') });
    } finally { setUploading(false); }
  }

  const newPhoto = photoUrl(newPhotoPath);

  return (
    <div className="space-y-8">
      {/* Add new member */}
      <div className="bg-white border rounded-xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5 text-primary font-semibold">
          <UserPlus className="w-4 h-4" /> {t('Neues Teammitglied hinzufügen', 'Add New Team Member')}
        </div>

        {/* New photo */}
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 rounded-full bg-slate-100 border-2 border-white shadow overflow-hidden flex items-center justify-center shrink-0">
            {newPhoto ? (
              <img src={newPhoto} alt="" className="w-full h-full object-cover" />
            ) : (
              <ImagePlus className="w-6 h-6 text-slate-400" />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleNewPhoto} />
            <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()} className="gap-2">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {t('Foto wählen', 'Choose Photo')}
            </Button>
            {newPhotoPath && (
              <button className="text-xs text-destructive hover:underline text-left" onClick={() => setNewPhotoPath(null)}>
                {t('Entfernen', 'Remove')}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Name', 'Name')} *</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('z.B. Julia Eberl', 'e.g. Julia Eberl')} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Reihenfolge', 'Order')}</label>
            <Input type="number" value={newSortOrder} onChange={(e) => setNewSortOrder(parseInt(e.target.value) || 0)} />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Gruppe', 'Group')}</label>
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as TeamCategory)}
              className="h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="consulting_doctors">{t('Beratende Mediziner', 'Consulting Medical Doctors')}</option>
              <option value="specialists">{t('Spezialisten', 'Specialists')}</option>
              <option value="ai_agents">{t('Agents/Managers', 'Agents/Managers')}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Rolle (EN)', 'Role (EN)')} *</label>
            <Input value={newRole} onChange={(e) => setNewRole(e.target.value)} placeholder="e.g. Product Manager" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Rolle (DE)', 'Role (DE)')}</label>
            <Input value={newRoleDe} onChange={(e) => setNewRoleDe(e.target.value)} placeholder={t('z.B. Produktmanager', 'e.g. Product Manager')} />
          </div>
          <div className="md:col-span-2">
            <Button
              className="w-full"
              disabled={add.isPending || !newName.trim() || !newRole.trim()}
              onClick={() => add.mutate()}
            >
              {add.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
              {t('Hinzufügen', 'Add')}
            </Button>
          </div>
        </div>
      </div>

      {/* Existing members — grouped by category */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : members.length === 0 ? (
        <p className="text-center py-12 text-muted-foreground text-sm">{t('Noch keine Teammitglieder.', 'No team members yet.')}</p>
      ) : (
        <>
          {(['consulting_doctors', 'specialists', 'ai_agents'] as TeamCategory[]).map((cat) => {
            const group = members.filter((m) => (m.category ?? 'consulting_doctors') === cat);
            if (group.length === 0) return null;
            const label = cat === 'consulting_doctors'
              ? t('Beratende Mediziner', 'Consulting Medical Doctors')
              : cat === 'specialists'
                ? t('Spezialisten', 'Specialists')
                : t('Agents/Managers', 'Agents/Managers');
            return (
              <div key={cat} className="bg-white border rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <UserCircle2 className="w-5 h-5 text-primary" />
                  </div>
                  <h2 className="text-xl font-bold">{label}</h2>
                  <span className="ml-auto text-sm bg-muted rounded-full px-3 py-0.5 font-medium">{group.length} {t('Mitglieder', 'members')}</span>
                </div>
                <div className="divide-y">
                  {group.map((m) => (
                    <TeamMemberCard
                      key={m.id}
                      member={m}
                      token={token}
                      onSaved={() => qc.invalidateQueries({ queryKey: QK })}
                      onDeleted={() => qc.invalidateQueries({ queryKey: QK })}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── Login screen ─────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const { t } = useLanguage();
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');

  const verify = useMutation({
    mutationFn: async (password: string) => {
      const res = await fetch('/api/admin/verify', {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (!res.ok) throw new Error('Unauthorized');
      return password;
    },
    onSuccess: (password) => {
      sessionStorage.setItem('iroc_admin_token', password);
      onLogin(password);
    },
    onError: () => {
      setError(t('Falsches Passwort. Bitte erneut versuchen.', 'Wrong password. Please try again.'));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    verify.mutate(pass);
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <div className="bg-white border rounded-2xl shadow-lg w-full max-w-sm p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-primary/10 rounded-full mb-4">
            <ShieldCheck className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Admin Portal</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">{t('iROC GmbH · Interner Bereich', 'iROC GmbH · Internal Area')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Admin-Passwort', 'Admin Password')}</label>
            <div className="relative">
              <Input
                type={showPass ? 'text' : 'password'}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder={t('Passwort eingeben', 'Enter password')}
                autoFocus
                required
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPass((visible) => !visible)}
                aria-label={showPass ? t('Passwort ausblenden', 'Hide password') : t('Passwort anzeigen', 'Show password')}
                aria-pressed={showPass}
                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={verify.isPending || !pass}>
            {verify.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('Wird geprüft…', 'Verifying…')}</>
            ) : (
              t('Anmelden', 'Log In')
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Admin() {
  const { t } = useLanguage();
  const [token, setToken] = useState<string>(() => sessionStorage.getItem('iroc_admin_token') ?? '');
  const [tab, setTab] = useState<Tab>('training');

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem('iroc_admin_token');
    setToken('');
  }, []);

  if (!token) {
    return <LoginScreen onLogin={setToken} />;
  }

  return (
    <div className="py-10 bg-muted/5 min-h-screen">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <ShieldCheck className="w-7 h-7 text-primary" /> {t('Admin Dashboard', 'Admin Dashboard')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t('iROC GmbH · Interne Verwaltung', 'iROC GmbH · Internal Management')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
            <LogOut className="w-4 h-4" /> {t('Abmelden', 'Log Out')}
          </Button>
        </div>

        <TabBar active={tab} onChange={setTab} />

        {tab === 'training' && <TrainingTab token={token} />}
        {tab === 'registrations' && <RegistrationsTab token={token} />}
        {tab === 'customers' && <CustomersTab token={token} />}
        {tab === 'doctors' && <DoctorsTab token={token} />}
        {tab === 'resources' && <ResourcesTab token={token} />}
        {tab === 'team' && <TeamTab token={token} />}
        {tab === 'events' && <EventsTab token={token} />}
        {tab === 'email' && <EmailSettingsTab token={token} />}
        {tab === 'settings' && <WebsiteSettingsTab token={token} />}
      </div>
    </div>
  );
}

// ─── Website Settings tab ────────────────────────────────────────────────────

type WsKey =
  | 'ws_contact_email' | 'ws_contact_phone' | 'ws_contact_fax'
  | 'ws_address_street' | 'ws_address_postal' | 'ws_address_city'
  | 'ws_address_country_de' | 'ws_address_country_en'
  | 'ws_hero_image_url' | 'ws_maps_embed_url' | 'ws_maps_directions_url'
  | 'ws_social_linkedin' | 'ws_social_facebook' | 'ws_social_instagram' | 'ws_social_youtube';

export function WebsiteSettingsTab({ token }: { token: string }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

  // local editable state — mirrors all keys
  const [vals, setVals] = useState<Record<WsKey, string>>(() => ({
    ...WS_DEFAULTS,
  }) as Record<WsKey, string>);
  const [saved, setSaved] = useState<Record<string, 'ok' | 'error' | null>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [urlErrors, setUrlErrors] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [heroUploading, setHeroUploading] = useState(false);
  const heroFileRef = useRef<HTMLInputElement>(null);

  const WS_URL_KEYS: WsKey[] = [
    'ws_hero_image_url', 'ws_maps_embed_url', 'ws_maps_directions_url',
    'ws_social_linkedin', 'ws_social_facebook', 'ws_social_instagram', 'ws_social_youtube',
  ];

  useEffect(() => {
    fetch(`${BASE}/api/website-settings`)
      .then((r) => r.ok ? r.json() : {})
      .then((data: Record<string, string>) => {
        setVals((prev) => ({ ...prev, ...data }));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [BASE]);

  const saveKey = async (key: WsKey) => {
    // Validate URL fields before sending
    if (WS_URL_KEYS.includes(key)) {
      const v = vals[key]?.trim() ?? '';
      if (!isValidOptionalUrl(v)) {
        setUrlErrors((e) => ({ ...e, [key]: t('Ungültige URL – bitte eine vollständige URL eingeben (z. B. https://…)', 'Invalid URL – please enter a full URL (e.g. https://…)') }));
        return;
      }
      setUrlErrors((e) => { const n = { ...e }; delete n[key]; return n; });
    }
    setSaving((s) => ({ ...s, [key]: true }));
    setSaved((s) => ({ ...s, [key]: null }));
    try {
      const res = await fetch(`${BASE}/api/admin/website-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key, value: vals[key] }),
      });
      if (!res.ok) throw new Error();
      invalidateWebsiteSettingsCache();
      setSaved((s) => ({ ...s, [key]: 'ok' }));
      toast({ title: t('Gespeichert', 'Saved') });
    } catch {
      setSaved((s) => ({ ...s, [key]: 'error' }));
      toast({ variant: 'destructive', title: t('Fehler', 'Error') });
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  const field = (key: WsKey, label: string, placeholder?: string, type = 'text') => (
    <div key={key} className="space-y-1">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      <div className="flex gap-2">
        <Input
          type={type}
          value={vals[key] ?? ''}
          onChange={(e) => {
            setVals((v) => ({ ...v, [key]: e.target.value }));
            setSaved((s) => ({ ...s, [key]: null }));
            setUrlErrors((er) => { const n = { ...er }; delete n[key]; return n; });
          }}
          placeholder={placeholder}
          className={`flex-1 text-sm font-mono ${urlErrors[key] ? 'border-destructive focus-visible:ring-destructive' : ''}`}
        />
        <Button size="sm" disabled={saving[key]} onClick={() => saveKey(key)} className="shrink-0">
          {saving[key] ? <Loader2 className="w-4 h-4 animate-spin" /> : t('Speichern', 'Save')}
        </Button>
      </div>
      {urlErrors[key] && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" />{urlErrors[key]}</p>}
      {!urlErrors[key] && saved[key] === 'ok' && <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{t('Gespeichert', 'Saved')}</p>}
      {!urlErrors[key] && saved[key] === 'error' && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t('Fehler', 'Error')}</p>}
    </div>
  );

  if (!loaded) return <div className="p-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;

  const SOCIAL_FIELDS: { key: WsKey; Icon: React.ElementType; label: string; placeholder: string }[] = [
    { key: 'ws_social_linkedin',  Icon: Linkedin,  label: 'LinkedIn',  placeholder: 'https://www.linkedin.com/company/…' },
    { key: 'ws_social_facebook',  Icon: Facebook,  label: 'Facebook',  placeholder: 'https://www.facebook.com/…'          },
    { key: 'ws_social_instagram', Icon: Instagram, label: 'Instagram', placeholder: 'https://www.instagram.com/…'          },
    { key: 'ws_social_youtube',   Icon: Youtube,   label: 'YouTube',   placeholder: 'https://www.youtube.com/…'            },
  ];

  return (
    <div className="space-y-6">

      {/* ── Contact info ── */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <SectionHeader icon={Mail} title={t('Kontaktdaten', 'Contact Details')} />
        <div className="p-6 grid sm:grid-cols-2 gap-4">
          {field('ws_contact_email', t('E-Mail', 'Email'), 'info@i-roc.de', 'email')}
          {field('ws_contact_phone', t('Telefon', 'Phone'), '+49 89 4625993 70')}
          {field('ws_contact_fax',   t('Fax', 'Fax'),      '+49 89 21530 334')}
        </div>
      </div>

      {/* ── Address ── */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <SectionHeader icon={MapPin} title={t('Adresse', 'Address')} />
        <div className="p-6 grid sm:grid-cols-2 gap-4">
          {field('ws_address_street',      t('Straße', 'Street'),              'St.-Emmeram-Str. 26')}
          {field('ws_address_postal',      t('PLZ', 'Postal Code'),            '85609')}
          {field('ws_address_city',        t('Stadt', 'City'),                 'Aschheim')}
          {field('ws_address_country_de',  t('Land (DE)', 'Country (DE)'),    'Deutschland')}
          {field('ws_address_country_en',  t('Land (EN)', 'Country (EN)'),    'Germany')}
        </div>
      </div>

      {/* ── Hero image ── */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <SectionHeader icon={ImageIcon} title={t('Hero-Hintergrundbild', 'Hero Background Image')} />
        <div className="p-6 space-y-4">
          <p className="text-xs text-muted-foreground">{t('URL des Hintergrundbildes auf der Startseite. Leer lassen = Standardbild.', 'URL of the background image on the home page. Leave blank = default image.')}</p>
          {field('ws_hero_image_url', t('Bild-URL', 'Image URL'), WS_DEFAULTS.ws_hero_image_url, 'url')}
          {/* Upload button */}
          <div className="flex items-center gap-3">
            <input
              ref={heroFileRef}
              type="file"
              accept={HERO_IMAGE_ACCEPT}
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!isAllowedHeroImageFile(file)) {
                  toast({ variant: 'destructive', title: t('Bitte eine PNG-, JPEG-, WebP-, GIF- oder AVIF-Bilddatei auswählen.', 'Please select a PNG, JPEG, WebP, GIF, or AVIF image file.') });
                  e.target.value = '';
                  return;
                }
                if (file.size > MAX_HERO_IMAGE_SIZE_BYTES) {
                  toast({ variant: 'destructive', title: t('Datei zu groß – max. 10 MB', 'File too large – max 10 MB') });
                  e.target.value = '';
                  return;
                }
                setHeroUploading(true);
                // Track the just-uploaded path so we can clean it up if the
                // subsequent settings-save fails (prevents orphaned GCS objects).
                let uploadedObjectPath: string | undefined;
                try {
                  // Use the dedicated hero upload endpoint (writes to hero-images/ subdir,
                  // not the shared uploads/ namespace) so cleanup is safely scoped.
                  const metaRes = await fetch(`${BASE}/api/storage/uploads/request-url/hero`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
                  });
                  if (!metaRes.ok) throw new Error('Presign failed');
                  const { uploadURL, objectPath } = await metaRes.json() as { uploadURL: string; objectPath: string };
                  // PUT the file directly to GCS
                  const putRes = await fetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
                  if (!putRes.ok) throw new Error('GCS upload failed');
                  // GCS upload succeeded — record path for orphan cleanup on save failure.
                  uploadedObjectPath = objectPath;
                  // Build an absolute URL so the server-side http/https URL validator accepts it.
                  const url = `${window.location.origin}${BASE}/api/storage${objectPath}`;
                  // POST both the display URL and the server-issued objectPath.
                  // The server uses objectPath (not the URL) to identify and delete
                  // the previously stored hero object — keeping cleanup scoped to
                  // the hero-images namespace.
                  const saveRes = await fetch(`${BASE}/api/admin/website-settings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ key: 'ws_hero_image_url', value: url, objectPath }),
                  });
                  if (!saveRes.ok) throw new Error('Settings save failed');
                  // Save succeeded — clear the cleanup guard.
                  uploadedObjectPath = undefined;
                  invalidateWebsiteSettingsCache();
                  setVals((v) => ({ ...v, ws_hero_image_url: url }));
                  setSaved((s) => ({ ...s, ws_hero_image_url: 'ok' }));
                  toast({ title: t('Bild hochgeladen & gespeichert', 'Image uploaded & saved') });
                } catch {
                  // Best-effort: if GCS upload succeeded but settings save failed,
                  // delete the orphaned object so it does not accumulate in storage.
                  if (uploadedObjectPath) {
                    fetch(`${BASE}/api/admin/hero-upload-cleanup`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ objectPath: uploadedObjectPath }),
                    }).catch(() => {}); // fire-and-forget; failure is non-critical
                  }
                  setSaved((s) => ({ ...s, ws_hero_image_url: 'error' }));
                  toast({ variant: 'destructive', title: t('Upload fehlgeschlagen', 'Upload failed') });
                } finally {
                  setHeroUploading(false);
                  if (heroFileRef.current) heroFileRef.current.value = '';
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={heroUploading}
              onClick={() => heroFileRef.current?.click()}
              className="gap-2 shrink-0"
            >
              {heroUploading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ImagePlus className="w-4 h-4" />}
              {heroUploading
                ? t('Lädt hoch…', 'Uploading…')
                : t('Bild hochladen', 'Upload image')}
            </Button>
            {vals.ws_hero_image_url && vals.ws_hero_image_url.includes('/api/storage/objects/') && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={heroUploading}
                onClick={async () => {
                  setHeroUploading(true);
                  try {
                    // POST empty value — the server reads the current URL, deletes the
                    // Object Storage object, then clears the setting.
                    const res = await fetch(`${BASE}/api/admin/website-settings`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ key: 'ws_hero_image_url', value: '' }),
                    });
                    if (!res.ok) throw new Error();
                    invalidateWebsiteSettingsCache();
                    setVals((v) => ({ ...v, ws_hero_image_url: '' }));
                    setSaved((s) => ({ ...s, ws_hero_image_url: 'ok' }));
                    toast({ title: t('Bild entfernt', 'Image removed') });
                  } catch {
                    setSaved((s) => ({ ...s, ws_hero_image_url: 'error' }));
                    toast({ variant: 'destructive', title: t('Fehler beim Entfernen', 'Error removing image') });
                  } finally {
                    setHeroUploading(false);
                  }
                }}
                className="gap-2 shrink-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
                {t('Bild entfernen', 'Remove image')}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">{t('oder URL oben einfügen', 'or paste a URL above')}</span>
          </div>
          {vals.ws_hero_image_url && (
            <div className="rounded-lg overflow-hidden border h-32 bg-muted">
              <img src={vals.ws_hero_image_url} alt={t('Vorschau des Titelbilds', 'Hero image preview')} className="w-full h-full object-cover opacity-60" />
            </div>
          )}
        </div>
      </div>

      {/* ── Google Maps ── */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <SectionHeader icon={Globe} title={t('Google Maps', 'Google Maps')} />
        <div className="p-6 space-y-4">
          {field('ws_maps_embed_url',      t('Embed-URL (iframe)', 'Embed URL (iframe)'), WS_DEFAULTS.ws_maps_embed_url, 'url')}
          {field('ws_maps_directions_url', t('Directions-Link',     'Directions Link'),   WS_DEFAULTS.ws_maps_directions_url, 'url')}
          {isValidOptionalUrl(vals.ws_maps_embed_url) && vals.ws_maps_embed_url && (
            <div className="rounded-lg overflow-hidden border h-40">
              <iframe src={vals.ws_maps_embed_url} width="100%" height="100%" style={{ border: 0 }} loading="lazy" title={t('Kartenvorschau', 'Map preview')} />
            </div>
          )}
        </div>
      </div>

      {/* ── Social media ── */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <SectionHeader icon={Link2} title={t('Social Media', 'Social Media')} />
        <p className="px-6 pt-0 pb-2 text-xs text-muted-foreground">
          {t('Leer lassen = Icon wird im Footer nicht angezeigt.', 'Leave blank = icon will not appear in the footer.')}
        </p>
        <div className="p-6 pt-2 space-y-4">
          {SOCIAL_FIELDS.map(({ key, Icon, label, placeholder }) => (
            <div key={key} className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" /> {label}
              </label>
              <div className="flex gap-2">
                <Input
                  type="url"
                  value={vals[key] ?? ''}
                  onChange={(e) => {
                    setVals((v) => ({ ...v, [key]: e.target.value }));
                    setSaved((s) => ({ ...s, [key]: null }));
                    setUrlErrors((er) => { const n = { ...er }; delete n[key]; return n; });
                  }}
                  placeholder={placeholder}
                  className={`flex-1 text-sm font-mono ${urlErrors[key] ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                <Button size="sm" disabled={saving[key]} onClick={() => saveKey(key)} className="shrink-0">
                  {saving[key] ? <Loader2 className="w-4 h-4 animate-spin" /> : t('Speichern', 'Save')}
                </Button>
              </div>
              {urlErrors[key] && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" />{urlErrors[key]}</p>}
              {!urlErrors[key] && saved[key] === 'ok' && <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{t('Gespeichert', 'Saved')}</p>}
              {!urlErrors[key] && saved[key] === 'error' && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" />{t('Fehler', 'Error')}</p>}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─── Events tab ───────────────────────────────────────────────────────────────

interface AdminEvent {
  id: number;
  title: string;
  titleDe: string | null;
  description: string | null;
  descriptionDe: string | null;
  mediaUrl: string | null;
  mediaType: string;
  externalUrl: string;
  eventDate: string;
  isActive: boolean;
  expired: boolean;
}

const EVENTS_QK = ['admin-events'];

function formatEventDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function EventsTab({ token }: { token: string }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const qc = useQueryClient();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

  const { data: events, isLoading } = useQuery<AdminEvent[]>({
    queryKey: EVENTS_QK,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/admin/events`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/admin/events/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      toast({ title: t('Event gelöscht', 'Event deleted') });
      qc.invalidateQueries({ queryKey: EVENTS_QK });
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Löschen', 'Error deleting') }),
  });

  return (
    <div className="space-y-8">
      {/* Add form */}
      <AddEventForm token={token} onCreated={() => qc.invalidateQueries({ queryKey: EVENTS_QK })} />

      {/* List */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <CalendarClock className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{t('Alle Events', 'All Events')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Abgelaufene Events werden auf der Website automatisch nach 7 Tagen ausgeblendet', 'Expired events are automatically hidden on the website after 7 days')}
            </p>
          </div>
          <span className="ml-auto text-sm bg-muted rounded-full px-3 py-0.5 font-medium">
            {events?.length ?? 0}
          </span>
        </div>

        {isLoading && (
          <div className="p-8 text-center text-muted-foreground">{t('Laden…', 'Loading…')}</div>
        )}

        {!isLoading && (!events || events.length === 0) && (
          <div className="p-12 text-center text-muted-foreground">
            <CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium">{t('Noch keine Events', 'No events yet')}</p>
          </div>
        )}

        {events && events.length > 0 && (
          <div className="divide-y">
            {events.map((ev) => (
              <div key={ev.id} className="p-5 flex gap-4 items-start">
                {/* Thumbnail */}
                <div className="w-24 h-16 rounded-lg overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center">
                  {ev.mediaUrl && ev.mediaType === 'image' ? (
                    <img src={ev.mediaUrl} alt="" className="w-full h-full object-cover" />
                  ) : ev.mediaUrl && ev.mediaType === 'video' ? (
                    <Video className="w-8 h-8 text-slate-400" />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-slate-300" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-sm truncate">{ev.title}</span>
                    {ev.expired ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium shrink-0">{t('Abgelaufen', 'Expired')}</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium shrink-0">{t('Aktiv', 'Active')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <CalendarClock className="w-3.5 h-3.5" />
                    {formatEventDate(ev.eventDate)}
                  </div>
                  <a
                    href={ev.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1 truncate max-w-xs"
                  >
                    <Globe className="w-3 h-3 shrink-0" />
                    {ev.externalUrl}
                  </a>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-destructive hover:bg-destructive/10 border-destructive/20"
                  disabled={del.isPending}
                  onClick={() => del.mutate(ev.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface NewEventDraft {
  title: string;
  titleDe: string;
  description: string;
  descriptionDe: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  externalUrl: string;
  eventDate: string;
}

const EMPTY_DRAFT: NewEventDraft = {
  title: '', titleDe: '', description: '', descriptionDe: '',
  mediaUrl: '', mediaType: 'image', externalUrl: '', eventDate: '',
};

function AddEventForm({ token, onCreated }: { token: string; onCreated: () => void }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NewEventDraft>(EMPTY_DRAFT);
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

  const set = (k: keyof NewEventDraft, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/admin/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...draft,
          mediaUrl: draft.mediaUrl.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? 'Fehler');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t('Event erstellt', 'Event created') });
      setDraft(EMPTY_DRAFT);
      setOpen(false);
      onCreated();
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: t('Fehler', 'Error'), description: err.message }),
  });

  const valid = draft.title.trim() && draft.externalUrl.trim() && draft.eventDate;

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-6 py-5 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className="p-2 bg-green-50 rounded-lg">
          <CalendarPlus className="w-5 h-5 text-green-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold">{t('Neues Event hinzufügen', 'Add New Event')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('Event mit Bild / Video und Link zur externen Seite', 'Event with image / video and link to external page')}
          </p>
        </div>
        {open ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t p-6 space-y-5">
          {/* Title row */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Titel (EN) *</label>
              <Input value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder="Event title" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Titel (DE)</label>
              <Input value={draft.titleDe} onChange={(e) => set('titleDe', e.target.value)} placeholder="Veranstaltungstitel" />
            </div>
          </div>

          {/* Description row */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Beschreibung (EN)</label>
              <textarea
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Short description…"
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Beschreibung (DE)</label>
              <textarea
                value={draft.descriptionDe}
                onChange={(e) => set('descriptionDe', e.target.value)}
                placeholder="Kurzbeschreibung…"
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>
          </div>

          {/* Media row */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Medientyp', 'Media Type')}</label>
              <select
                value={draft.mediaType}
                onChange={(e) => set('mediaType', e.target.value as 'image' | 'video')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="image">{t('Bild (Image URL)', 'Image (Image URL)')}</option>
                <option value="video">Video (YouTube embed)</option>
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {draft.mediaType === 'video' ? t('YouTube-Link / Embed-URL', 'YouTube Link / Embed URL') : t('Bild-URL', 'Image URL')}
              </label>
              <Input
                value={draft.mediaUrl}
                onChange={(e) => set('mediaUrl', e.target.value)}
                placeholder={draft.mediaType === 'video' ? 'https://www.youtube.com/watch?v=…' : 'https://example.com/image.jpg'}
              />
            </div>
          </div>

          {/* External URL + date row */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Externe Website', 'External Website')} * <span className="text-primary">({t('Link bei Klick', 'Link on click')})</span></label>
              <Input
                value={draft.externalUrl}
                onChange={(e) => set('externalUrl', e.target.value)}
                placeholder="https://example.com/event"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t('Event-Datum', 'Event Date')} * <span className="text-muted-foreground font-normal">({t('7 Tage danach automatisch ausgeblendet', 'automatically hidden 7 days after')})</span>
              </label>
              <Input
                type="date"
                value={draft.eventDate}
                onChange={(e) => set('eventDate', e.target.value)}
              />
            </div>
          </div>

          {/* Preview */}
          {draft.mediaUrl && (
            <div className="border rounded-xl overflow-hidden">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-4 pt-3 pb-2">{t('Vorschau', 'Preview')}</p>
              {draft.mediaType === 'image' ? (
                <img src={draft.mediaUrl} alt="preview" className="w-full max-h-48 object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div className="aspect-video">
                  <iframe
                    src={draft.mediaUrl.replace('watch?v=', 'embed/').replace('youtu.be/', 'www.youtube.com/embed/')}
                    className="w-full h-full"
                    allowFullScreen
                  />
                </div>
              )}
            </div>
          )}

          <Button
            className="w-full"
            disabled={!valid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('Erstelle…', 'Creating…')}</>
              : <><CalendarPlus className="w-4 h-4 mr-2" /> {t('Event erstellen', 'Create Event')}</>}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Email Settings tab ────────────────────────────────────────────────────────

interface EmailDest {
  key: string;
  label: string;
  email: string;
  defaultEmail: string;
}

const FORM_ICONS: Record<string, React.ElementType> = {
  email_dest_order_existing:    ShoppingCart,
  email_dest_order_new:         UserPlus,
  email_dest_training_spirecut: Calendar,
  email_dest_training_ministem: Calendar,
  email_dest_contact:           Mail,
};

function EmailSettingsTab({ token }: { token: string }) {
  const { t } = useLanguage();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

  const { data: settings = [], isLoading, refetch } = useQuery<EmailDest[]>({
    queryKey: ['admin-email-settings'],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/admin/email-settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{t('E-Mail Empfänger', 'Email Recipients')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('Legen Sie für jedes Formular fest, an welche E-Mail-Adresse Einreichungen weitergeleitet werden. Leer lassen = Standard', 'Set the email address for each form submissions. Leave blank = default')} (<strong>info@i-roc.de</strong>).
            </p>
          </div>
        </div>

        {isLoading && <div className="p-8 text-center text-muted-foreground">{t('Laden…', 'Loading…')}</div>}

        {!isLoading && (
          <div className="divide-y">
            {settings.map((s) => (
              <EmailDestRow
                key={s.key}
                setting={s}
                token={token}
                icon={FORM_ICONS[s.key] ?? Mail}
                onSaved={refetch}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmailDestRow({
  setting,
  token,
  icon: Icon,
  onSaved,
}: {
  setting: EmailDest;
  token: string;
  icon: React.ElementType;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [value, setValue] = useState(setting.email);
  const [saving, setSaving] = useState(false);
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

  // keep in sync if parent refetches
  useState(() => { setValue(setting.email); });

  const isDirty = value !== setting.email;
  const effectiveEmail = setting.email || setting.defaultEmail;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/admin/email-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: setting.key, email: value }),
      });
      if (!res.ok) throw new Error('Failed');
      toast({ title: t('Gespeichert', 'Saved'), description: `${setting.label} → ${value || setting.defaultEmail}` });
      onSaved();
    } catch {
      toast({ variant: 'destructive', title: t('Fehler beim Speichern', 'Error saving') });
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setValue('');
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/admin/email-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: setting.key, email: '' }),
      });
      if (!res.ok) throw new Error('Failed');
      toast({ title: t('Zurückgesetzt', 'Reset'), description: `${t('Verwendet jetzt Standard:', 'Now using default:')} ${setting.defaultEmail}` });
      onSaved();
    } catch {
      toast({ variant: 'destructive', title: t('Fehler beim Zurücksetzen', 'Error resetting') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-6 py-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center gap-3 shrink-0 sm:w-64">
        <div className="p-1.5 bg-slate-100 rounded-lg">
          <Icon className="w-4 h-4 text-slate-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{setting.label}</p>
          <p className="text-xs text-muted-foreground">
            {t('Aktiv:', 'Active:')} <span className="font-mono">{effectiveEmail}</span>
            {!setting.email && <span className="ml-1 text-amber-600">({t('Standard', 'Default')})</span>}
          </p>
        </div>
      </div>

      <div className="flex-1 flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`${t('Standard', 'Default')}: ${setting.defaultEmail}`}
          type="email"
          className="flex-1 font-mono text-sm"
        />
        {setting.email && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-muted-foreground"
            disabled={saving}
            onClick={clear}
            title={t('Auf Standard zurücksetzen', 'Reset to default')}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
        <Button
          size="sm"
          className="shrink-0"
          disabled={saving || !isDirty}
          onClick={save}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('Speichern', 'Save')}
        </Button>
      </div>
    </div>
  );
}

// ─── Customers tab ────────────────────────────────────────────────────────────

interface WebsiteCustomer {
  id: number;
  customerNr: string | null;
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
  ustIdNr: string | null;
  instrument: string;
  notes: string | null;
  privacyConsent: boolean;
  shippingName: string | null;
  shippingAddress: string | null;
  shippingPostalCode: string | null;
  shippingCity: string | null;
  shippingCountry: string | null;
  shippingPhone: string | null;
  shippingEmail: string | null;
  createdAt: string;
}

const CUSTOMERS_QK = ['admin-customers'] as const;

function exportToCSV(customers: WebsiteCustomer[]) {
  const headers = [
    'Kundennummer','ID','Anrede','Titel','Vorname','Nachname','Fachgebiet',
    'Institution','Art der Institution','Straße','PLZ','Stadt','Land',
    'Telefon','Fax','E-Mail','Website','Referenznummer','USt-IdNr',
    'Instrument','Anmerkungen','Datenschutz','Registriert am',
    'Liefername','Lieferstraße','Liefer-PLZ','Lieferstadt','Lieferland','Liefertelefon','Liefer-E-Mail',
  ];
  const rows = customers.map((c) => [
    c.customerNr ?? '',
    c.id,
    c.salutation ?? '',
    c.title ?? '',
    c.firstName ?? '',
    c.lastName ?? '',
    c.specialty ?? '',
    c.institutionName ?? '',
    c.institutionType ?? '',
    c.address ?? '',
    c.postalCode ?? '',
    c.city ?? '',
    c.country ?? '',
    c.phone ?? '',
    c.fax ?? '',
    c.email,
    c.website ?? '',
    c.referenceNumber ?? '',
    c.ustIdNr ?? '',
    c.instrument,
    (c.notes ?? '').replace(/⚠ MISMATCH[^\n]*/g, '').trim(),
    c.privacyConsent ? 'Ja' : 'Nein',
    new Date(c.createdAt).toLocaleDateString('de-DE'),
    c.shippingName ?? '',
    c.shippingAddress ?? '',
    c.shippingPostalCode ?? '',
    c.shippingCity ?? '',
    c.shippingCountry ?? '',
    c.shippingPhone ?? '',
    c.shippingEmail ?? '',
  ]);

  const escape = (v: unknown) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
  const bom = '\uFEFF'; // UTF-8 BOM so Excel opens it correctly
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `iroc-kunden-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const INSTR_LABEL: Record<string, string> = {
  spirecut: 'Spirecut®',
  ministem: 'MiniStem®',
  both:     'Beide',
};

function EditCustomerModal({
  customer,
  token,
  onClose,
  onSaved,
}: {
  customer: WebsiteCustomer;
  token: string;
  onClose: () => void;
  onSaved: (updated: WebsiteCustomer) => void;
}) {
  const { toast } = useToast();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
  const [form, setForm] = useState<Omit<WebsiteCustomer,'id'|'privacyConsent'|'createdAt'>>({
    customerNr:          customer.customerNr,
    salutation:          customer.salutation,
    title:               customer.title,
    firstName:           customer.firstName,
    lastName:            customer.lastName,
    specialty:           customer.specialty,
    institutionName:     customer.institutionName,
    institutionType:     customer.institutionType,
    address:             customer.address,
    postalCode:          customer.postalCode,
    city:                customer.city,
    country:             customer.country,
    phone:               customer.phone,
    fax:                 customer.fax,
    email:               customer.email,
    website:             customer.website,
    referenceNumber:     customer.referenceNumber,
    ustIdNr:             customer.ustIdNr,
    instrument:          customer.instrument,
    notes:               customer.notes,
    shippingName:        customer.shippingName,
    shippingAddress:     customer.shippingAddress,
    shippingPostalCode:  customer.shippingPostalCode,
    shippingCity:        customer.shippingCity,
    shippingCountry:     customer.shippingCountry,
    shippingPhone:       customer.shippingPhone,
    shippingEmail:       customer.shippingEmail,
  });

  const { t } = useLanguage();
  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/admin/customers/${customer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<WebsiteCustomer>;
    },
    onSuccess: (updated) => {
      toast({ title: t('Kunde aktualisiert', 'Customer updated') });
      onSaved(updated);
      onClose();
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Speichern', 'Error saving') }),
  });

  const f = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((p) => ({ ...p, [key]: e.target.value || null }));

  const inputCls = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm';
  const labelCls = 'text-xs font-semibold text-muted-foreground uppercase tracking-wide';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold">{t('Kunde bearbeiten', 'Edit Customer')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Mismatch banner */}
          {(customer.notes ?? '').includes('⚠ MISMATCH') && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <span className="text-base leading-none mt-0.5">⚠</span>
              <div>
                <strong className="font-semibold">{t('Felder müssen nachgepflegt werden.', 'Fields need manual follow-up.')}</strong>
                <p className="mt-0.5 text-xs text-amber-700">
                  {t('Dieser Eintrag wurde aus dem Excel-Import übernommen. Bitte fehlende Angaben (Fachgebiet, Art der Institution, Instrument, ggf. Vor-/Nachname) manuell eintragen.', 'This entry was imported from Excel. Please fill in missing fields (specialty, institution type, instrument, first/last name if applicable) manually.')}
                </p>
              </div>
            </div>
          )}

          {/* ── Kundennummer ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className={labelCls}>{t('Kundennummer', 'Customer Number')}</label>
              <input className={inputCls + ' font-mono'} value={form.customerNr ?? ''} onChange={f('customerNr')} placeholder="z.B. 2026-0001" />
            </div>
          </div>

          {/* ── Person ── */}
          <div>
            <p className={labelCls + ' mb-2'}>{t('Person', 'Person')}</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className={labelCls}>{t('Anrede', 'Salutation')}</label>
                <select value={form.salutation ?? ''} onChange={f('salutation')} className={inputCls}>
                  <option value="">–</option>
                  <option>{t('Herr', 'Mr.')}</option><option>{t('Frau', 'Ms.')}</option><option>{t('Divers', 'Non-binary')}</option><option>{t('Andere', 'Other')}</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Titel', 'Title')}</label>
                <input className={inputCls} value={form.title ?? ''} onChange={f('title')} placeholder="Dr. med, Prof., …" />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Vorname', 'First Name')}</label>
                <input className={inputCls} value={form.firstName ?? ''} onChange={f('firstName')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Nachname', 'Last Name')}</label>
                <input className={inputCls} value={form.lastName ?? ''} onChange={f('lastName')} />
              </div>
            </div>
          </div>

          {/* ── Institution ── */}
          <div>
            <p className={labelCls + ' mb-2'}>{t('Institution', 'Institution')}</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2">
                <label className={labelCls}>{t('Name der Institution', 'Institution Name')}</label>
                <input className={inputCls} value={form.institutionName ?? ''} onChange={f('institutionName')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Art der Institution', 'Institution Type')}</label>
                <select value={form.institutionType ?? ''} onChange={f('institutionType')} className={inputCls}>
                  <option value="">–</option>
                  <option>{t('Krankenhaus', 'Hospital')}</option><option>{t('Klinik', 'Clinic')}</option><option>{t('Praxis', 'Practice')}</option><option>{t('Andere', 'Other')}</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Fachgebiet', 'Specialty')}</label>
                <input className={inputCls} value={form.specialty ?? ''} onChange={f('specialty')} placeholder={t('Orthopädie, …', 'Orthopedics, …')} />
              </div>
            </div>
          </div>

          {/* ── Rechnungsadresse ── */}
          <div>
            <p className={labelCls + ' mb-2'}>{t('Rechnungsadresse', 'Billing Address')}</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2">
                <label className={labelCls}>{t('Straße', 'Street')}</label>
                <input className={inputCls} value={form.address ?? ''} onChange={f('address')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('PLZ', 'Postal Code')}</label>
                <input className={inputCls} value={form.postalCode ?? ''} onChange={f('postalCode')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Stadt', 'City')}</label>
                <input className={inputCls} value={form.city ?? ''} onChange={f('city')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Land', 'Country')}</label>
                <input className={inputCls} value={form.country ?? ''} onChange={f('country')} />
              </div>
            </div>
          </div>

          {/* ── Lieferadresse ── */}
          <div>
            <p className={labelCls + ' mb-2'}>{t('Lieferadresse', 'Shipping Address')} <span className="normal-case text-muted-foreground font-normal">({t('falls abweichend', 'if different')})</span></p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2">
                <label className={labelCls}>{t('Name / Abteilung', 'Name / Department')}</label>
                <input className={inputCls} value={form.shippingName ?? ''} onChange={f('shippingName')} />
              </div>
              <div className="space-y-1 col-span-2">
                <label className={labelCls}>{t('Straße', 'Street')}</label>
                <input className={inputCls} value={form.shippingAddress ?? ''} onChange={f('shippingAddress')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('PLZ', 'Postal Code')}</label>
                <input className={inputCls} value={form.shippingPostalCode ?? ''} onChange={f('shippingPostalCode')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Stadt', 'City')}</label>
                <input className={inputCls} value={form.shippingCity ?? ''} onChange={f('shippingCity')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Land', 'Country')}</label>
                <input className={inputCls} value={form.shippingCountry ?? ''} onChange={f('shippingCountry')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Telefon (Lieferung)', 'Phone (Shipping)')}</label>
                <input className={inputCls} value={form.shippingPhone ?? ''} onChange={f('shippingPhone')} />
              </div>
              <div className="space-y-1 col-span-2">
                <label className={labelCls}>{t('E-Mail (Lieferung)', 'Email (Shipping)')}</label>
                <input className={inputCls} type="email" value={form.shippingEmail ?? ''} onChange={f('shippingEmail')} />
              </div>
            </div>
          </div>

          {/* ── Kontakt & Sonstiges ── */}
          <div>
            <p className={labelCls + ' mb-2'}>{t('Kontakt & Sonstiges', 'Contact & Other')}</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className={labelCls}>{t('Telefon', 'Phone')}</label>
                <input className={inputCls} value={form.phone ?? ''} onChange={f('phone')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Fax</label>
                <input className={inputCls} value={form.fax ?? ''} onChange={f('fax')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('E-Mail', 'Email')} *</label>
                <input className={inputCls} type="email" value={form.email} onChange={f('email')} required />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Website</label>
                <input className={inputCls} value={form.website ?? ''} onChange={f('website')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Referenznummer', 'Reference Number')}</label>
                <input className={inputCls} value={form.referenceNumber ?? ''} onChange={f('referenceNumber')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('USt-IdNr.', 'VAT ID')}</label>
                <input className={inputCls} value={form.ustIdNr ?? ''} onChange={f('ustIdNr')} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>{t('Instrument', 'Instrument')}</label>
                <select value={form.instrument} onChange={f('instrument')} className={inputCls}>
                  <option value="spirecut">Spirecut®</option>
                  <option value="ministem">MiniStem®</option>
                  <option value="both">{t('Beide', 'Both')}</option>
                </select>
              </div>
              <div className="space-y-1 col-span-2">
                <label className={labelCls}>{t('Anmerkungen', 'Notes')}</label>
                <textarea
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y"
                  value={form.notes ?? ''}
                  onChange={f('notes')}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end px-6 pb-6">
          <Button variant="outline" onClick={onClose}>{t('Abbrechen', 'Cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t('Speichern…', 'Saving…')}</> : t('Speichern', 'Save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CustomersTab({ token }: { token: string }) {
  const { toast } = useToast();
  const { t } = useLanguage();
  const qc = useQueryClient();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<WebsiteCustomer | null>(null);

  const { data: customers = [], isLoading, isError } = useQuery<WebsiteCustomer[]>({
    queryKey: CUSTOMERS_QK,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/admin/customers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/admin/customers/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      toast({ title: t('Kunde gelöscht', 'Customer deleted') });
      qc.invalidateQueries({ queryKey: CUSTOMERS_QK });
    },
    onError: () => toast({ variant: 'destructive', title: t('Fehler beim Löschen', 'Error deleting') }),
  });

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    return (
      !q ||
      `${c.firstName ?? ''} ${c.lastName ?? ''}`.toLowerCase().includes(q) ||
      (c.customerNr ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.institutionName ?? '').toLowerCase().includes(q) ||
      (c.city ?? '').toLowerCase().includes(q) ||
      c.instrument.toLowerCase().includes(q)
    );
  });

  const handleSaved = (updated: WebsiteCustomer) => {
    qc.setQueryData<WebsiteCustomer[]>(CUSTOMERS_QK, (prev) =>
      prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev
    );
  };

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">{t('Kundendatenbank', 'Customer Database')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {customers.length} {customers.length === 1 ? t('Eintrag', 'entry') : t('Einträge', 'entries')} {t('aus dem Bestellformular (Neukunden)', 'from the order form (new customers)')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              className="pl-9 pr-3 h-9 rounded-md border border-input bg-background text-sm w-56 focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder={t('Suchen…', 'Search…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={customers.length === 0}
            onClick={() => exportToCSV(filtered.length ? filtered : customers)}
          >
            <Download className="w-4 h-4" />
            Excel / CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 text-destructive bg-destructive/10 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {t('Fehler beim Laden der Kundendaten.', 'Error loading customer data.')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Building2 className="w-10 h-10 opacity-30" />
          <p className="text-sm">{search ? t('Keine Treffer für diese Suche.', 'No results for this search.') : t('Noch keine Kunden registriert.', 'No customers registered yet.')}</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="overflow-y-auto max-h-[60vh] sticky-header-table">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <th className="px-4 py-3 whitespace-nowrap">{t('Kd.-Nr.', 'Cust. No.')}</th>
                <th className="px-4 py-3 whitespace-nowrap">{t('Name', 'Name')}</th>
                <th className="px-4 py-3 whitespace-nowrap">{t('Institution', 'Institution')}</th>
                <th className="px-4 py-3 whitespace-nowrap">{t('E-Mail', 'Email')}</th>
                <th className="px-4 py-3 whitespace-nowrap">{t('Telefon', 'Phone')}</th>
                <th className="px-4 py-3 whitespace-nowrap">{t('Stadt', 'City')}</th>
                <th className="px-4 py-3 whitespace-nowrap">{t('Instrument', 'Instrument')}</th>
                <th className="px-4 py-3 whitespace-nowrap">{t('Datum', 'Date')}</th>
                <th className="px-4 py-3 whitespace-nowrap text-right">{t('Aktionen', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((c, i) => {
                const hasMismatch = (c.notes ?? '').includes('⚠ MISMATCH');
                const displayName = [c.title, c.firstName, c.lastName].filter(Boolean).join(' ') || c.institutionName || '–';
                return (
                <tr key={c.id} className={i % 2 === 0 ? 'bg-white' : 'bg-muted/20'}>
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {c.customerNr ?? '–'}
                  </td>
                  <td className="px-4 py-3 font-medium whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {hasMismatch && (
                        <span title={t('Enthält Felder die manuell nachgepflegt werden müssen', 'Contains fields that need manual follow-up')} className="text-amber-500 shrink-0">⚠</span>
                      )}
                      {displayName}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap max-w-[180px] truncate">
                    {c.institutionName ?? '–'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <a href={`mailto:${c.email}`} className="text-primary hover:underline">
                      {c.email}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {c.phone ?? '–'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {[c.postalCode, c.city].filter(Boolean).join(' ') || '–'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      c.instrument === 'spirecut'
                        ? 'bg-blue-100 text-blue-700'
                        : c.instrument === 'ministem'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}>
                      {INSTR_LABEL[c.instrument] ?? c.instrument}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                    {new Date(c.createdAt).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setEditing(c)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title={t('Bearbeiten', 'Edit')}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(t('Kunde', 'Delete customer') + ` „${displayName}" ` + t('wirklich löschen?', 'permanently?'))) {
                            del.mutate(c.id);
                          }
                        }}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title={t('Löschen', 'Delete')}
                        disabled={del.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {editing && (
        <EditCustomerModal
          customer={editing}
          token={token}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
