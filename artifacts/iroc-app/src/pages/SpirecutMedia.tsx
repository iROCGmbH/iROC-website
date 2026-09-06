import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { ImageIcon, Loader2, Globe, Upload, Trash2, EyeOff, Eye, CheckCircle, AlertCircle } from 'lucide-react';

const HIDDEN_SENTINEL = '__hidden__';
const DEFAULT_SENTINEL = '__default__';
const MEDIA_UPDATE_CHANNEL = 'spirecut-patient-media-updates';

function notifyMediaUpdated() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(MEDIA_UPDATE_CHANNEL);
  channel.postMessage('updated');
  channel.close();
}

// The spirecut-patient artifact is always served at /spirecut-patient/ regardless
// of which app is loading this page — use an absolute path, not BASE_URL-relative.
const PATIENT_BASE = '/spirecut-patient';

interface MediaSlot {
  key: string;
  labelDe: string;
  labelEn: string;
  fallback: string;
  legacyKey?: string;
}

const MEDIA_SLOTS: readonly MediaSlot[] = [
  { key: 'hero-home',     labelDe: 'Startseite – Hero-Bild',          labelEn: 'Homepage – Hero Image',          fallback: `${PATIENT_BASE}/spirecut-hero.jpg` },
  { key: 'instrument-ct-top',       labelDe: 'Patienteninformation – Karpaltunnel – Instrument',   labelEn: 'Patient Information – Carpal Tunnel – Instrument',  fallback: `${PATIENT_BASE}/sono-instrument-ct.png`, legacyKey: 'instrument-ct' },
  { key: 'instrument-tf-top',       labelDe: 'Patienteninformation – Schnappfinger – Instrument',  labelEn: 'Patient Information – Trigger Finger – Instrument', fallback: `${PATIENT_BASE}/sono-instrument-tf.png`, legacyKey: 'instrument-tf' },
  { key: 'instrument-ct-condition', labelDe: 'Behandelte Beschwerden – Karpaltunnel – Instrument', labelEn: 'Conditions Treated – Carpal Tunnel – Instrument', fallback: `${PATIENT_BASE}/sono-instrument-ct.png`, legacyKey: 'instrument-ct' },
  { key: 'instrument-tf-condition', labelDe: 'Behandelte Beschwerden – Schnappfinger – Instrument', labelEn: 'Conditions Treated – Trigger Finger – Instrument', fallback: `${PATIENT_BASE}/sono-instrument-tf.png`, legacyKey: 'instrument-tf' },
  { key: 'hero-ct',       labelDe: 'Karpaltunnelsyndrom – Hero-Bild',  labelEn: 'Carpal Tunnel Syndrome – Hero',  fallback: `${PATIENT_BASE}/kts-hero-a.jpg` },
  { key: 'hero-tf',       labelDe: 'Schnappfinger – Hero-Bild',        labelEn: 'Trigger Finger – Hero Image',    fallback: `${PATIENT_BASE}/tf-hero-user.png` },
] as const;

type MediaMap = Record<string, string>;

function resolveRawValue(slot: MediaSlot, media: MediaMap): string | undefined {
  return media[slot.key] ?? (slot.legacyKey ? media[slot.legacyKey] : undefined);
}

function resolveUrl(slot: MediaSlot, media: MediaMap): string {
  const raw = resolveRawValue(slot, media);
  if (!raw || raw === HIDDEN_SENTINEL || raw === DEFAULT_SENTINEL) return slot.fallback;
  if (raw.startsWith('/objects/')) return `/api/storage${raw}`;
  return raw;
}

interface MediaCardProps {
  slot: MediaSlot;
  lang: string;
  token: string;
  media: MediaMap;
  onUpdate: (key: string, url: string) => void;
  onDelete: (key: string) => void;
}

function MediaCard({ slot, lang, token, media, onUpdate, onDelete }: MediaCardProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<'ok' | 'error' | null>(null);

  const currentUrl = resolveUrl(slot, media);
  const ownValue = media[slot.key];
  const legacyValue = slot.legacyKey ? media[slot.legacyKey] : undefined;
  const inheritedValue = !ownValue ? legacyValue : undefined;
  const hasOverride = !!ownValue && ownValue !== HIDDEN_SENTINEL && ownValue !== DEFAULT_SENTINEL;
  const hasOwnVisibleValue = !!ownValue && ownValue !== HIDDEN_SENTINEL;
  const isHidden = ownValue === HIDDEN_SENTINEL || inheritedValue === HIDDEN_SENTINEL;
  const isInherited = !ownValue && !!inheritedValue && inheritedValue !== HIDDEN_SENTINEL;

  const handleUpload = async (file: File) => {
    setUploading(true); setResult(null);
    try {
      const { uploadURL, objectPath } = await fetch(`/api/storage/uploads/request-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      }).then((r) => { if (!r.ok) throw new Error(); return r.json(); });

      await fetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
        .then((r) => { if (!r.ok) throw new Error(); });

      await fetch(`/api/admin/patient-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: slot.key, url: objectPath }),
      }).then((r) => { if (!r.ok) throw new Error(); });

      onUpdate(slot.key, objectPath);
      notifyMediaUpdated();
      setResult('ok');
      toast({ title: lang === 'de' ? 'Bild hochgeladen' : 'Image uploaded' });
    } catch {
      setResult('error');
      toast({ variant: 'destructive', title: lang === 'de' ? 'Upload-Fehler' : 'Upload error' });
    } finally {
      setUploading(false);
    }
  };

  const handleHide = async () => {
    await fetch(`/api/admin/patient-media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ key: slot.key, url: HIDDEN_SENTINEL }),
    });
    onUpdate(slot.key, HIDDEN_SENTINEL);
    notifyMediaUpdated();
  };

  const handleShow = async () => {
    if (slot.legacyKey && legacyValue === HIDDEN_SENTINEL) {
      await fetch(`/api/admin/patient-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: slot.key, url: DEFAULT_SENTINEL }),
      });
      onUpdate(slot.key, DEFAULT_SENTINEL);
      return;
    }

    onDelete(slot.key);
  };

  return (
    <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
      {/* Preview */}
      <div className="aspect-video bg-muted relative overflow-hidden">
        {isHidden ? (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <EyeOff className="w-8 h-8" />
          </div>
        ) : (
          <img src={currentUrl} alt={lang === 'de' ? slot.labelDe : slot.labelEn} className="w-full h-full object-cover" />
        )}
        {hasOverride && !isHidden && (
          <span className="absolute top-2 right-2 bg-green-600 text-white text-xs px-2 py-0.5 rounded font-medium">
            {lang === 'de' ? 'Benutzerdefiniert' : 'Custom'}
          </span>
        )}
        {isInherited && (
          <span className="absolute top-2 left-2 bg-slate-700/85 text-white text-xs px-2 py-0.5 rounded font-medium">
            {lang === 'de' ? 'Legacy-Fallback' : 'Legacy fallback'}
          </span>
        )}
      </div>

      {/* Info & actions */}
      <div className="p-4 space-y-3">
        <div>
          <p className="font-medium text-sm">{lang === 'de' ? slot.labelDe : slot.labelEn}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="gap-1.5"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {lang === 'de' ? 'Hochladen' : 'Upload'}
          </Button>

          {hasOwnVisibleValue && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(slot.key)}
              className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4" />
              {slot.legacyKey && legacyValue
                ? (lang === 'de' ? 'Legacy wiederherstellen' : 'Restore legacy')
                : (lang === 'de' ? 'Zurücksetzen' : 'Reset')}
            </Button>
          )}

          {!isHidden && (
            <Button size="sm" variant="ghost" onClick={handleHide} className="gap-1.5 text-muted-foreground">
              <EyeOff className="w-4 h-4" />
              {lang === 'de' ? 'Ausblenden' : 'Hide'}
            </Button>
          )}

          {isHidden && (
            <Button size="sm" variant="ghost" onClick={handleShow} className="gap-1.5 text-muted-foreground">
              <Eye className="w-4 h-4" />
              {lang === 'de' ? 'Einblenden' : 'Show'}
            </Button>
          )}
        </div>

        {result === 'ok' && (
          <p className="flex items-center gap-1.5 text-xs text-green-600">
            <CheckCircle className="w-3.5 h-3.5" /> {lang === 'de' ? 'Hochgeladen' : 'Uploaded'}
          </p>
        )}
        {result === 'error' && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5" /> {lang === 'de' ? 'Fehler' : 'Error'}
          </p>
        )}
      </div>
    </div>
  );
}

export default function SpirecutMedia() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { spirecutUrl } = useSiteUrls();
  const [media, setMedia] = useState<MediaMap>({});

  useEffect(() => {
    if (!token) return;
    fetch(`/api/patient-media`)
      .then((r) => r.ok ? r.json() : {})
      .then(setMedia)
      .catch(() => {});
  }, [token]);

  const handleDelete = async (key: string) => {
    if (!token) return;
    await fetch(`/api/admin/patient-media/${key}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setMedia((m) => { const n = { ...m }; delete n[key]; return n; });
    notifyMediaUpdated();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg"><ImageIcon className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'Medien & Bilder' : 'Media & Images'}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de' ? 'Hero-Bilder und Instrumentfotos für beide Spirecut-Angebote' : 'Hero images and instrument photos for both Spirecut experiences'}
          </p>
        </div>
        <a href={`${spirecutUrl}/praktische-informationen`} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
          <Globe className="w-4 h-4" />{lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
        </a>
      </div>

      <p className="text-sm text-muted-foreground">
        {lang === 'de'
          ? 'Laden Sie neue Bilder hoch, um die Standardbilder zu ersetzen. Gelöschte Einstellungen verwenden automatisch das Standardbild.'
          : 'Upload new images to replace the defaults. Deleted settings automatically fall back to the default image.'}
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {MEDIA_SLOTS.map((slot) => (
          <MediaCard
            key={slot.key}
            slot={slot}
            lang={lang}
            token={token!}
            media={media}
            onUpdate={(key, url) => setMedia((m) => ({ ...m, [key]: url }))}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
