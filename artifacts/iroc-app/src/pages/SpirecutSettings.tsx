import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Settings, Save, CheckCircle, AlertCircle, Loader2, Globe, Video, Mail, ShieldAlert, Smartphone } from 'lucide-react';
import { adminGet, adminPost } from '@/lib/admin-fetch';
import { Textarea } from '@/components/ui/textarea';


type SpKey = 'sp_video_ct_url' | 'sp_video_tf_url' | 'sp_contact_email_de' | 'sp_contact_email_com'
           | 'sp_video_praktisch_1_url' | 'sp_video_praktisch_2_url'
           | 'sp_video_praktisch_1_title' | 'sp_video_praktisch_2_title'
           | 'sp_webapp_url'
           | 'sp_gate_enabled' | 'sp_gate_title_de' | 'sp_gate_title_en' | 'sp_gate_body_de' | 'sp_gate_body_en' | 'sp_gate_link_url';

type FieldDef = { key: SpKey; label: string; labelDe: string; placeholder: string; type: 'url' | 'email' | 'text'; icon: React.ElementType; group: string };

const FIELDS: FieldDef[] = [
  { key: 'sp_video_ct_url',              group: 'how',       label: 'Carpal Tunnel – How-It-Works Video URL',         labelDe: 'Karpaltunnel – Erklärungsvideo URL',                   placeholder: 'https://www.youtube.com/embed/…',          type: 'url',   icon: Video },
  { key: 'sp_video_tf_url',              group: 'how',       label: 'Trigger Finger – How-It-Works Video URL',        labelDe: 'Schnappfinger – Erklärungsvideo URL',                  placeholder: 'https://www.youtube.com/embed/…',          type: 'url',   icon: Video },
  { key: 'sp_video_praktisch_1_title',   group: 'praktisch', label: 'Practical Info – Video 1 Title',                 labelDe: 'Prakt. Informationen – Video 1 Titel',                 placeholder: 'z. B. Karpaltunnelsyndrom – Eingriff',     type: 'text',  icon: Video },
  { key: 'sp_video_praktisch_1_url',     group: 'praktisch', label: 'Practical Info – Video 1 URL',                   labelDe: 'Prakt. Informationen – Video 1 URL',                   placeholder: 'https://www.youtube.com/embed/…',          type: 'url',   icon: Video },
  { key: 'sp_video_praktisch_2_title',   group: 'praktisch', label: 'Practical Info – Video 2 Title',                 labelDe: 'Prakt. Informationen – Video 2 Titel',                 placeholder: 'z. B. Schnappfinger – Eingriff',           type: 'text',  icon: Video },
  { key: 'sp_video_praktisch_2_url',     group: 'praktisch', label: 'Practical Info – Video 2 URL',                   labelDe: 'Prakt. Informationen – Video 2 URL',                   placeholder: 'https://www.youtube.com/embed/…',          type: 'url',   icon: Video },
  { key: 'sp_contact_email_de',          group: 'contact',   label: 'Spirecut-patient Website Contact (German)',       labelDe: 'Spirecut-patient Website-Kontakt (Deutsch)',            placeholder: 'info@spirecut.de',                         type: 'email', icon: Mail  },
  { key: 'sp_contact_email_com',         group: 'contact',   label: 'Spirecut-patient Website Contact (International)', labelDe: 'Spirecut-patient Website-Kontakt (International)',       placeholder: 'info@spirecut.com',                        type: 'email', icon: Mail  },
  { key: 'sp_webapp_url',                 group: 'webapp',    label: 'Spirecut Patient Web App / QR Destination URL',   labelDe: 'Spirecut Patienten-Web-App / QR-Ziel-URL',              placeholder: 'Leer = aktuelle Website / Empty = current website', type: 'url', icon: Smartphone },
];

const GROUP_LABELS: Record<string, { de: string; en: string }> = {
  how:       { de: 'So funktioniert es – Videos',          en: 'How It Works – Videos' },
  praktisch: { de: 'Praktische Informationen – Videos',    en: 'Practical Information – Videos' },
  contact:   { de: 'Kontakt-E-Mail-Adressen',              en: 'Contact Email Addresses' },
  webapp:    { de: 'Web-App / QR-Code',                    en: 'Web App / QR Code' },
};

const SP_DEFAULTS: Record<SpKey, string> = {
  sp_video_ct_url:             'https://www.youtube.com/embed/jDStbSFduO8?rel=0',
  sp_video_tf_url:             'https://www.youtube.com/embed/QbOlsFMTbJo?rel=0',
  sp_contact_email_de:         'info@spirecut.de',
  sp_contact_email_com:        'info@spirecut.com',
  sp_video_praktisch_1_url:    '',
  sp_video_praktisch_2_url:    '',
  sp_video_praktisch_1_title:  '',
  sp_video_praktisch_2_title:  '',
  sp_webapp_url: '',
  sp_gate_enabled:  'true',
  sp_gate_title_de: 'Diese Website richtet sich an Patienten und Interessierte.',
  sp_gate_title_en: 'This website is intended for patients and interested individuals.',
  sp_gate_body_de:  'Sind Sie Arzt oder medizinisches Fachpersonal? Dann besuchen Sie bitte die iROC GmbH Website.',
  sp_gate_body_en:  'Are you a medical doctor or healthcare professional? Please visit the iROC GmbH website instead.',
  sp_gate_link_url: 'https://www.i-roc.de',
};
const PRAKTISCH_TITLE_KEYS = new Set<SpKey>(['sp_video_praktisch_1_title', 'sp_video_praktisch_2_title']);

type SpirecutSettingsResponse = {
  settings: Record<string, string>;
  repair?: {
    legacyPracticalVideoTitlesRepaired?: number;
    legacyPracticalVideoTitlesAcknowledged?: number;
  };
};

export default function SpirecutSettings() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { spirecutUrl } = useSiteUrls();
  const { toast } = useToast();

  const [values, setValues] = useState<Record<SpKey, string>>({ ...SP_DEFAULTS });
  const [edits, setEdits] = useState<Record<SpKey, string>>({ ...SP_DEFAULTS });
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, 'ok' | 'error' | 'normalized'>>({});
  const [legacyTitleRepairCount, setLegacyTitleRepairCount] = useState(0);
  const [legacyTitleRepairAcknowledged, setLegacyTitleRepairAcknowledged] = useState(0);
  const [acknowledgingRepairs, setAcknowledgingRepairs] = useState(false);

  useEffect(() => {
    if (!token) return;
    adminGet<SpirecutSettingsResponse>('/api/admin/spirecut-settings', token)
      .then(({ settings: data, repair }) => {
        const loaded = { ...SP_DEFAULTS, ...data } as Record<SpKey, string>;
        setValues(loaded);
        setEdits(loaded);
        setLegacyTitleRepairCount(repair?.legacyPracticalVideoTitlesRepaired ?? 0);
        setLegacyTitleRepairAcknowledged(repair?.legacyPracticalVideoTitlesAcknowledged ?? 0);
      })
      .catch(() => {});
  }, [token]);

  const handleSave = async (key: SpKey) => {
    if (!token) return;
    const rawValue = edits[key] ?? '';
    const isPraktischTitle = PRAKTISCH_TITLE_KEYS.has(key);
    const normalizedValue = isPraktischTitle
      ? (rawValue.trim() ? rawValue : '')
      : rawValue.trim();
    const wasBlankTitleNormalized = isPraktischTitle && rawValue.length > 0 && !rawValue.trim();
    setSaving((s) => ({ ...s, [key]: true }));
    setResults((r) => { const n = { ...r }; delete n[key]; return n; });
    try {
      await adminPost('/api/admin/spirecut-settings', token, { key, value: normalizedValue });
      setValues((v) => ({ ...v, [key]: normalizedValue }));
      if (wasBlankTitleNormalized) {
        setEdits((v) => ({ ...v, [key]: '' }));
        setResults((r) => ({ ...r, [key]: 'normalized' }));
      } else {
        setResults((r) => ({ ...r, [key]: 'ok' }));
      }
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      setResults((r) => ({ ...r, [key]: 'error' }));
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Error saving' });
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  const acknowledgeLegacyTitleRepairs = async () => {
    if (!token) return;
    setAcknowledgingRepairs(true);
    try {
      const result = await adminPost<{ acknowledged: number }>(
        '/api/admin/spirecut-settings/acknowledge-title-repairs',
        token,
        {},
      );
      setLegacyTitleRepairAcknowledged(result.acknowledged);
      toast({ title: lang === 'de' ? 'Hinweis bestätigt' : 'Notice acknowledged' });
    } catch {
      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'Bestätigung fehlgeschlagen' : 'Acknowledgement failed',
      });
    } finally {
      setAcknowledgingRepairs(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Spirecut Einstellungen' : 'Spirecut Settings'}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de' ? 'Video-URLs, Kontakt-E-Mail-Adressen und Chatbot' : 'Video URLs, contact email addresses, and chatbot'}
          </p>
        </div>
        <a
          href={spirecutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <Globe className="w-4 h-4" />
          {lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
        </a>
      </div>

      {legacyTitleRepairCount > legacyTitleRepairAcknowledged && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">
            {lang === 'de'
              ? `Beim Laden wurden ${legacyTitleRepairCount} historische Titel für praktische Videos automatisch bereinigt.`
              : `${legacyTitleRepairCount} legacy practical video title${legacyTitleRepairCount === 1 ? '' : 's'} were automatically repaired while loading.`}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={acknowledgingRepairs}
            onClick={acknowledgeLegacyTitleRepairs}
          >
            {lang === 'de' ? 'Hinweis bestätigen' : 'Acknowledge notice'}
          </Button>
        </div>
      )}

      <div className="space-y-8 max-w-2xl">
        {Object.entries(GROUP_LABELS).map(([group, groupLabel]) => (
          <div key={group}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {lang === 'de' ? groupLabel.de : groupLabel.en}
            </h2>
            <div className="grid gap-4">
              {FIELDS.filter(f => f.group === group).map(({ key, label, labelDe, placeholder, type, icon: Icon }) => (
          <div key={key} className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-muted-foreground" />
              <p className="font-medium text-sm">{lang === 'de' ? labelDe : label}</p>
            </div>
            <div className="flex gap-2">
              <Input
                type={type}
                value={edits[key] ?? ''}
                onChange={(e) => setEdits((v) => ({ ...v, [key]: e.target.value }))}
                placeholder={placeholder}
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={() => handleSave(key)}
                disabled={saving[key]}
                className="gap-1.5 shrink-0"
              >
                {saving[key] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {lang === 'de' ? 'Speichern' : 'Save'}
              </Button>
            </div>
            {results[key] === 'ok' && (
              <p className="flex items-center gap-1.5 text-sm text-green-600">
                <CheckCircle className="w-4 h-4" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}
              </p>
            )}
            {results[key] === 'normalized' && (
              <p className="flex items-center gap-1.5 text-sm text-amber-600" role="status">
                <AlertCircle className="w-4 h-4" />
                {lang === 'de'
                  ? 'Der Titel enthielt nur Leerzeichen und wurde als leer gespeichert.'
                  : 'The title contained only whitespace and was saved as empty.'}
              </p>
            )}
            {results[key] === 'error' && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" /> {lang === 'de' ? 'Fehler' : 'Error'}
              </p>
            )}
            {values[key] && values[key] !== SP_DEFAULTS[key] && (
              <p className="text-xs text-muted-foreground">
                {lang === 'de' ? 'Aktuell:' : 'Current:'} <span className="font-medium">{values[key]}</span>
              </p>
            )}
          </div>
              ))}
            </div>
          </div>
        ))}

        {/* ── Patient Gate ─────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            {lang === 'de' ? 'Patienten-Banner (Patient Gate)' : 'Patient Gate Banner'}
          </h2>
          <div className="bg-card border rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-muted-foreground" />
              <p className="font-medium text-sm">
                {lang === 'de'
                  ? 'Erscheint beim ersten Besuch der Spirecut-Patientenwebsite. Ärzte werden zu www.i-roc.de weitergeleitet.'
                  : 'Shown on the first visit to the Spirecut patient website. Medical professionals are directed to www.i-roc.de.'}
              </p>
            </div>

            {/* Enabled toggle */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {lang === 'de' ? 'Banner aktiviert' : 'Banner enabled'}
              </label>
              <div className="flex gap-2">
                <select
                  value={edits['sp_gate_enabled'] ?? 'true'}
                  onChange={(e) => setEdits((v) => ({ ...v, sp_gate_enabled: e.target.value }))}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="true">{lang === 'de' ? 'Ja – Banner anzeigen' : 'Yes – show banner'}</option>
                  <option value="false">{lang === 'de' ? 'Nein – Banner ausblenden' : 'No – hide banner'}</option>
                </select>
                <Button size="sm" onClick={() => handleSave('sp_gate_enabled')} disabled={saving['sp_gate_enabled']} className="gap-1.5 shrink-0">
                  {saving['sp_gate_enabled'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {lang === 'de' ? 'Speichern' : 'Save'}
                </Button>
              </div>
              {results['sp_gate_enabled'] === 'ok' && <p className="flex items-center gap-1.5 text-sm text-green-600"><CheckCircle className="w-4 h-4" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}</p>}
              {results['sp_gate_enabled'] === 'error' && <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertCircle className="w-4 h-4" /> {lang === 'de' ? 'Fehler' : 'Error'}</p>}
            </div>

            {/* Title + body fields DE / EN */}
            {(
              [
                { key: 'sp_gate_title_de' as SpKey, labelDe: 'Titel (Deutsch)',  labelEn: 'Title (German)',  rows: 2 },
                { key: 'sp_gate_title_en' as SpKey, labelDe: 'Titel (Englisch)', labelEn: 'Title (English)', rows: 2 },
                { key: 'sp_gate_body_de'  as SpKey, labelDe: 'Text (Deutsch)',   labelEn: 'Body (German)',   rows: 3 },
                { key: 'sp_gate_body_en'  as SpKey, labelDe: 'Text (Englisch)',  labelEn: 'Body (English)',  rows: 3 },
              ] as { key: SpKey; labelDe: string; labelEn: string; rows: number }[]
            ).map(({ key, labelDe, labelEn, rows }) => (
              <div key={key} className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {lang === 'de' ? labelDe : labelEn}
                </label>
                <div className="flex gap-2 items-start">
                  <Textarea
                    rows={rows}
                    value={edits[key] ?? ''}
                    onChange={(e) => setEdits((v) => ({ ...v, [key]: e.target.value }))}
                    className="flex-1 resize-y text-sm"
                  />
                  <Button size="sm" onClick={() => handleSave(key)} disabled={saving[key]} className="gap-1.5 shrink-0 mt-0.5">
                    {saving[key] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {lang === 'de' ? 'Speichern' : 'Save'}
                  </Button>
                </div>
                {results[key] === 'ok' && <p className="flex items-center gap-1.5 text-sm text-green-600"><CheckCircle className="w-4 h-4" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}</p>}
                {results[key] === 'error' && <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertCircle className="w-4 h-4" /> {lang === 'de' ? 'Fehler' : 'Error'}</p>}
              </div>
            ))}

            {/* Link URL */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {lang === 'de' ? 'Link-URL (Ärzte werden hierhin weitergeleitet)' : 'Link URL (medical professionals are directed here)'}
              </label>
              <div className="flex gap-2">
                <Input
                  type="url"
                  value={edits['sp_gate_link_url'] ?? ''}
                  onChange={(e) => setEdits((v) => ({ ...v, sp_gate_link_url: e.target.value }))}
                  placeholder="https://www.i-roc.de"
                  className="flex-1"
                />
                <Button size="sm" onClick={() => handleSave('sp_gate_link_url')} disabled={saving['sp_gate_link_url']} className="gap-1.5 shrink-0">
                  {saving['sp_gate_link_url'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {lang === 'de' ? 'Speichern' : 'Save'}
                </Button>
              </div>
              {results['sp_gate_link_url'] === 'ok' && <p className="flex items-center gap-1.5 text-sm text-green-600"><CheckCircle className="w-4 h-4" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}</p>}
              {results['sp_gate_link_url'] === 'error' && <p className="flex items-center gap-1.5 text-sm text-destructive"><AlertCircle className="w-4 h-4" /> {lang === 'de' ? 'Fehler' : 'Error'}</p>}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
