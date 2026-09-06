import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { invalidateLogoCache } from '@/hooks/use-iroc-logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Settings, Save, CheckCircle, AlertCircle, Loader2, Globe, Phone, MapPin, Link2,
  Megaphone, ExternalLink, ShieldAlert,
   UploadCloud, Image as ImageIcon, X, SlidersHorizontal, Smartphone,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { adminPost } from '@/lib/admin-fetch';


type WsKey =
  | 'ws_logo_url'
  | 'ws_contact_email' | 'ws_contact_phone' | 'ws_contact_fax'
  | 'ws_address_street' | 'ws_address_postal' | 'ws_address_city'
  | 'ws_address_country_de' | 'ws_address_country_en'
  | 'ws_hero_image_url' | 'ws_maps_embed_url' | 'ws_maps_directions_url'
  | 'ws_social_linkedin' | 'ws_social_facebook' | 'ws_social_instagram' | 'ws_social_youtube'
  | 'ws_spirecut_company_url' | 'ws_ministem_company_url'
  | 'ws_webapp_url'
  | 'iroc_announcement_from'
  | 'datev_bookkeeper_email'
  | 'ws_gate_enabled' | 'ws_gate_title_de' | 'ws_gate_title_en' | 'ws_gate_body_de' | 'ws_gate_body_en' | 'ws_gate_link_url';

const WS_DEFAULTS: Record<WsKey, string> = {
  ws_logo_url:            '',
  ws_contact_email:       'info@i-roc.de',
  ws_contact_phone:       '+49 89 4625993 70',
  ws_contact_fax:         '+49 89 21530 334',
  ws_address_street:      'St.-Emmeram-Str. 26',
  ws_address_postal:      '85609',
  ws_address_city:        'Aschheim',
  ws_address_country_de:  'Deutschland',
  ws_address_country_en:  'Germany',
  ws_hero_image_url:      '',
  ws_maps_embed_url:      '',
  ws_maps_directions_url: '',
  ws_social_linkedin:      '',
  ws_social_facebook:      '',
  ws_social_instagram:     '',
  ws_social_youtube:       '',
  ws_spirecut_company_url: 'https://www.spirecut.com',
  ws_ministem_company_url: 'https://www.jointechlabs.com',
  ws_webapp_url: 'https://portal.i-roc.de',
  iroc_announcement_from:  '',
  datev_bookkeeper_email:  '',
  ws_gate_enabled:   'true',
  ws_gate_title_de:  'Diese Website richtet sich ausschlie\u00dflich an \u00c4rzte und medizinische Fachkr\u00e4fte.',
  ws_gate_title_en:  'This website is intended exclusively for medical doctors and healthcare professionals.',
  ws_gate_body_de:   'Sind Sie kein Arzt oder keine medizinische Fachkraft? Dann besuchen Sie bitte unsere Patientenwebsite.',
  ws_gate_body_en:   'Are you not a medical doctor or healthcare professional? Please visit our patient website instead.',
  ws_gate_link_url:  'https://www.spirecut.de',
};

interface FieldDef {
  key: WsKey;
  labelDe: string;
  labelEn: string;
  type?: string;
  placeholder?: string;
}

const WEBSITE_SECTIONS: { titleDe: string; titleEn: string; icon: React.ElementType; fields: FieldDef[] }[] = [
  {
    titleDe: 'Kontakt', titleEn: 'Contact', icon: Phone,
    fields: [
      { key: 'ws_contact_email',   labelDe: 'E-Mail',   labelEn: 'Email',   type: 'email', placeholder: 'info@i-roc.de' },
      { key: 'ws_contact_phone',   labelDe: 'Telefon',  labelEn: 'Phone',   placeholder: '+49 89 …' },
      { key: 'ws_contact_fax',     labelDe: 'Fax',      labelEn: 'Fax',     placeholder: '+49 89 …' },
    ],
  },
  {
    titleDe: 'Adresse', titleEn: 'Address', icon: MapPin,
    fields: [
      { key: 'ws_address_street',     labelDe: 'Straße',              labelEn: 'Street',           placeholder: 'St.-Emmeram-Str. 26' },
      { key: 'ws_address_postal',     labelDe: 'PLZ',                 labelEn: 'Postal Code',      placeholder: '85609' },
      { key: 'ws_address_city',       labelDe: 'Stadt',               labelEn: 'City',             placeholder: 'Aschheim' },
      { key: 'ws_address_country_de', labelDe: 'Land (DE)',           labelEn: 'Country (DE)',     placeholder: 'Deutschland' },
      { key: 'ws_address_country_en', labelDe: 'Land (EN)',           labelEn: 'Country (EN)',     placeholder: 'Germany' },
    ],
  },
  {
    titleDe: 'Hero & Maps', titleEn: 'Hero & Maps', icon: Globe,
    fields: [
      { key: 'ws_hero_image_url',      labelDe: 'Hero-Bild URL',             labelEn: 'Hero Image URL',         type: 'url', placeholder: 'https://…' },
      { key: 'ws_maps_embed_url',      labelDe: 'Google Maps Embed URL',     labelEn: 'Google Maps Embed URL', type: 'url', placeholder: 'https://www.google.com/maps/embed?…' },
      { key: 'ws_maps_directions_url', labelDe: 'Google Maps Directions URL', labelEn: 'Google Maps Directions URL', type: 'url', placeholder: 'https://maps.google.com/?q=…' },
    ],
  },
  {
    titleDe: 'Social Media', titleEn: 'Social Media', icon: Link2,
    fields: [
      { key: 'ws_social_linkedin',  labelDe: 'LinkedIn',  labelEn: 'LinkedIn',  type: 'url', placeholder: 'https://www.linkedin.com/…' },
      { key: 'ws_social_facebook',  labelDe: 'Facebook',  labelEn: 'Facebook',  type: 'url', placeholder: 'https://www.facebook.com/…' },
      { key: 'ws_social_instagram', labelDe: 'Instagram', labelEn: 'Instagram', type: 'url', placeholder: 'https://www.instagram.com/…' },
      { key: 'ws_social_youtube',   labelDe: 'YouTube',   labelEn: 'YouTube',   type: 'url', placeholder: 'https://www.youtube.com/…' },
    ],
  },
  {
    titleDe: 'Produkt-Websites', titleEn: 'Product Websites', icon: ExternalLink,
    fields: [
      { key: 'ws_spirecut_company_url' as WsKey, labelDe: 'Spirecut — Hersteller-Website', labelEn: 'Spirecut — Manufacturer Website', type: 'url', placeholder: 'https://www.spirecut.com' },
      { key: 'ws_ministem_company_url' as WsKey, labelDe: 'MiniStem — Hersteller-Website', labelEn: 'MiniStem — Manufacturer Website', type: 'url', placeholder: 'https://www.jointechlabs.com' },
    ],
  },
  {
    titleDe: 'Arztportal als Web-App', titleEn: 'Doctor Portal Web App', icon: Smartphone,
    fields: [
      {
        key: 'ws_webapp_url',
        labelDe: 'iROC Arztportal — Web-App / QR-Ziel-URL',
        labelEn: 'iROC Doctor Portal — Web-App / QR destination URL',
        type: 'url',
        placeholder: 'https://portal.i-roc.de',
      },
    ],
  },
];

const CONFIG_SECTIONS: { titleDe: string; titleEn: string; icon: React.ElementType; fields: FieldDef[] }[] = [
  {
    titleDe: 'Ankündigungs-E-Mails', titleEn: 'Announcement Emails', icon: Megaphone,
    fields: [
      { key: 'iroc_announcement_from', labelDe: 'Absender-E-Mail (Von)', labelEn: 'Sender Email (From)', type: 'email', placeholder: 'info@i-roc.de' },
    ],
  },
  {
    titleDe: 'DATEV / Buchhaltung', titleEn: 'DATEV / Accounting', icon: Settings,
    fields: [
      { key: 'datev_bookkeeper_email', labelDe: 'Buchhaltungs-E-Mail (DATEV-Empfänger)', labelEn: 'Bookkeeper Email (DATEV recipient)', type: 'email', placeholder: 'buchhaltung@kanzlei.de' },
    ],
  },
];

const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB

export default function IrocWebsiteSettings() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { irocUrl } = useSiteUrls();
  const { toast } = useToast();

  const [values, setValues] = useState<Record<WsKey, string>>({ ...WS_DEFAULTS });
  const [edits, setEdits] = useState<Record<WsKey, string>>({ ...WS_DEFAULTS });
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, 'ok' | 'error'>>({});

  // ── Logo upload state ──────────────────────────────────────────────────────
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoDragging, setLogoDragging] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/website-settings`)
      .then((r) => r.ok ? r.json() : {})
      .then((data: Partial<Record<WsKey, string>>) => {
        const loaded = { ...WS_DEFAULTS, ...data };
        setValues(loaded);
        setEdits(loaded);
        if (loaded.ws_logo_url) setLogoPreview(loaded.ws_logo_url);
      })
      .catch(() => {});
  }, [token]);

  const handleLogoFile = useCallback(async (file: File) => {
    if (!token) return;
    const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|avif|ico|bmp|tiff?)$/i;
    const typeOk = file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name);
    if (!typeOk) {
      setLogoError(lang === 'de' ? 'Bitte eine Bilddatei hochladen.' : 'Please upload an image file.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(lang === 'de' ? 'Datei darf maximal 5 MB groß sein.' : 'File must be smaller than 5 MB.');
      return;
    }
    setLogoError(null);
    setLogoUploading(true);
    const localUrl = URL.createObjectURL(file);
    setLogoPreview(localUrl);
    let uploadedObjectPath: string | null = null;
    try {
      const { uploadURL, objectPath } = await adminPost<{ uploadURL: string; objectPath: string }>(
        '/api/storage/uploads/request-url/logo',
        token,
        { name: file.name, size: file.size, contentType: file.type },
      );
      uploadedObjectPath = objectPath;

      const putRes = await fetch(uploadURL, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!putRes.ok) throw new Error('Upload failed');

      const servingUrl = `${window.location.origin}/api/storage${objectPath}`;
      await adminPost('/api/admin/website-settings', token, {
        key: 'ws_logo_url',
        value: servingUrl,
        objectPath,
      });

      setValues(v => ({ ...v, ws_logo_url: servingUrl }));
      setEdits(v => ({ ...v, ws_logo_url: servingUrl }));
      setLogoPreview(servingUrl);
      invalidateLogoCache();
      toast({ title: lang === 'de' ? 'Logo gespeichert' : 'Logo saved' });
    } catch {
      setLogoPreview(values.ws_logo_url || null);
      if (uploadedObjectPath) {
        adminPost('/api/admin/logo-upload-cleanup', token, { objectPath: uploadedObjectPath }).catch(() => {});
      }
      setLogoError(lang === 'de' ? 'Fehler beim Hochladen.' : 'Upload failed.');
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Hochladen' : 'Upload failed' });
    } finally {
      setLogoUploading(false);
      URL.revokeObjectURL(localUrl);
    }
  }, [token, lang, values.ws_logo_url, toast]);

  const handleRemoveLogo = useCallback(async () => {
    if (!token) return;
    setSaving(s => ({ ...s, ws_logo_url: true }));
    try {
      await adminPost('/api/admin/website-settings', token, { key: 'ws_logo_url', value: '' });
      setValues(v => ({ ...v, ws_logo_url: '' }));
      setEdits(v => ({ ...v, ws_logo_url: '' }));
      setLogoPreview(null);
      invalidateLogoCache();
      toast({ title: lang === 'de' ? 'Logo entfernt' : 'Logo removed' });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' });
    } finally {
      setSaving(s => ({ ...s, ws_logo_url: false }));
    }
  }, [token, lang, toast]);

  const handleSave = async (key: WsKey) => {
    if (!token) return;
    setSaving((s) => ({ ...s, [key]: true }));
    setResults((r) => { const n = { ...r }; delete n[key]; return n; });
    try {
      await adminPost('/api/admin/website-settings', token, { key, value: edits[key]?.trim() ?? '' });
      setValues((v) => ({ ...v, [key]: edits[key]?.trim() ?? '' }));
      setResults((r) => ({ ...r, [key]: 'ok' }));
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      setResults((r) => ({ ...r, [key]: 'error' }));
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Error saving' });
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  const renderField = ({ key, labelDe, labelEn, type = 'text', placeholder }: FieldDef) => (
    <div key={key} className="space-y-2">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {lang === 'de' ? labelDe : labelEn}
      </label>
      <div className="flex gap-2">
        <Input
          type={type}
          value={edits[key] ?? ''}
          onChange={(e) => setEdits((v) => ({ ...v, [key]: e.target.value }))}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button size="sm" onClick={() => handleSave(key)} disabled={saving[key]} className="gap-1.5 shrink-0">
          {saving[key] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {lang === 'de' ? 'Speichern' : 'Save'}
        </Button>
      </div>
      {results[key] === 'ok' && (
        <p className="flex items-center gap-1.5 text-xs text-green-600">
          <CheckCircle className="w-3.5 h-3.5" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}
        </p>
      )}
      {results[key] === 'error' && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5" /> {lang === 'de' ? 'Fehler' : 'Error'}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg"><Settings className="w-5 h-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'iROC Website Einstellungen' : 'iROC Website Settings'}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de' ? 'Logo, Kontakt, Adresse, Social Media und Systemkonfiguration' : 'Logo, contact, address, social media, and system configuration'}
          </p>
        </div>
        <a href={irocUrl} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
          <Globe className="w-4 h-4" />{lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
        </a>
      </div>

      <Tabs defaultValue="configuration" className="space-y-6">
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="configuration" className="gap-1.5">
            <SlidersHorizontal className="w-4 h-4" />
            {lang === 'de' ? 'Konfiguration' : 'Configuration'}
          </TabsTrigger>
          <TabsTrigger value="website" className="gap-1.5">
            <Globe className="w-4 h-4" />
            {lang === 'de' ? 'Website' : 'Website'}
          </TabsTrigger>
          <TabsTrigger value="gate" className="gap-1.5">
            <ShieldAlert className="w-4 h-4" />
            {lang === 'de' ? 'Medical Gate' : 'Medical Gate'}
          </TabsTrigger>
        </TabsList>

        {/* ── Configuration tab ──────────────────────────────────────────────── */}
        <TabsContent value="configuration" className="space-y-6 max-w-3xl">

          {/* Logo uploader */}
          <div className="bg-card border rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <ImageIcon className="w-4 h-4 text-primary" />
              <h2 className="font-semibold">{lang === 'de' ? 'iROC Logo' : 'iROC Logo'}</h2>
              <span className="ml-auto text-xs text-muted-foreground">
                {lang === 'de' ? 'PNG, SVG, WEBP · max. 5 MB' : 'PNG, SVG, WEBP · max 5 MB'}
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              {lang === 'de'
                ? 'Das Logo erscheint in der Navigation, im Footer, im Arztportal und im Anmeldebildschirm der App. Größe und Abstände werden automatisch angepasst.'
                : 'The logo appears in the navigation, footer, doctor portal, and app login screen. Size and margins adjust automatically after upload.'}
            </p>

            {/* App coverage badges */}
            <div className="flex flex-wrap gap-2">
              {['iROC Website', 'iROC App', lang === 'de' ? 'Arztportal' : 'Doctor Portal', 'Spirecut App'].map(label => (
                <span key={label} className="inline-flex items-center gap-1 text-xs bg-primary/8 text-primary rounded-full px-2.5 py-0.5 border border-primary/20">
                  <CheckCircle className="w-3 h-3" /> {label}
                </span>
              ))}
            </div>

            {/* Current logo preview */}
            {logoPreview && (
              <div className="flex items-center gap-4 p-3 bg-muted/40 rounded-lg border">
                <div className="h-16 flex items-center px-3 bg-white rounded border shadow-sm">
                  <img
                    src={logoPreview}
                    alt="iROC Logo"
                    className="max-h-full w-auto object-contain"
                    style={{ maxWidth: 200 }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    {lang === 'de' ? 'Aktuelles Logo' : 'Current logo'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{logoPreview}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveLogo}
                  disabled={saving['ws_logo_url'] || logoUploading}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0 gap-1.5"
                >
                  {saving['ws_logo_url'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  {lang === 'de' ? 'Entfernen' : 'Remove'}
                </Button>
              </div>
            )}

            {/* Drag-and-drop zone */}
            <div
              className={[
                'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-colors cursor-pointer select-none',
                logoDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30',
                logoUploading ? 'pointer-events-none opacity-60' : '',
              ].join(' ')}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setLogoDragging(true); }}
              onDragLeave={() => setLogoDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setLogoDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) handleLogoFile(file);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = ''; }}
              />

              {logoUploading ? (
                <>
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-sm font-medium text-primary">
                    {lang === 'de' ? 'Wird hochgeladen…' : 'Uploading…'}
                  </p>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <UploadCloud className="w-6 h-6 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">
                      {lang === 'de' ? 'Logo hierher ziehen oder klicken zum Auswählen' : 'Drag logo here or click to browse'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {lang === 'de' ? 'Transparenter Hintergrund empfohlen (PNG oder SVG)' : 'Transparent background recommended (PNG or SVG)'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {logoError && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="w-3.5 h-3.5" /> {logoError}
              </p>
            )}
          </div>

          {/* System config sections */}
          {CONFIG_SECTIONS.map(({ titleDe, titleEn, icon: Icon, fields }) => (
            <div key={titleEn} className="bg-card border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b">
                <Icon className="w-4 h-4 text-primary" />
                <h2 className="font-semibold">{lang === 'de' ? titleDe : titleEn}</h2>
              </div>
              {fields.map(renderField)}
            </div>
          ))}
        </TabsContent>

        {/* ── Website tab ────────────────────────────────────────────────────── */}
        <TabsContent value="website" className="space-y-6 max-w-3xl">
          {WEBSITE_SECTIONS.map(({ titleDe, titleEn, icon: Icon, fields }) => (
            <div key={titleEn} className="bg-card border rounded-xl p-6 shadow-sm space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b">
                <Icon className="w-4 h-4 text-primary" />
                <h2 className="font-semibold">{lang === 'de' ? titleDe : titleEn}</h2>
              </div>
              {fields.map(renderField)}
            </div>
          ))}
        </TabsContent>

        {/* ── Medical Gate tab ───────────────────────────────────────────────── */}
        <TabsContent value="gate" className="space-y-6 max-w-3xl">
          <div className="bg-card border rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <ShieldAlert className="w-4 h-4 text-primary" />
              <h2 className="font-semibold">
                {lang === 'de' ? 'Arztpflicht-Banner (Medical Gate)' : 'Medical Professional Gate'}
              </h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === 'de'
                ? 'Dieses Banner erscheint beim ersten Besuch der iROC-Website und fragt Besucher, ob sie Ärzte sind. Nicht-Ärzte werden zu www.spirecut.de weitergeleitet.'
                : 'This banner appears on the first visit to the iROC website and asks visitors whether they are doctors. Non-doctors are directed to www.spirecut.de.'}
            </p>

            {/* Enabled toggle */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {lang === 'de' ? 'Banner aktiviert' : 'Banner enabled'}
              </label>
              <div className="flex gap-2">
                <select
                  value={edits['ws_gate_enabled'] ?? 'true'}
                  onChange={(e) => setEdits((v) => ({ ...v, ws_gate_enabled: e.target.value }))}
                  className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="true">{lang === 'de' ? 'Ja – Banner anzeigen' : 'Yes – show banner'}</option>
                  <option value="false">{lang === 'de' ? 'Nein – Banner ausblenden' : 'No – hide banner'}</option>
                </select>
                <Button size="sm" onClick={() => handleSave('ws_gate_enabled')} disabled={saving['ws_gate_enabled']} className="gap-1.5 shrink-0">
                  {saving['ws_gate_enabled'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {lang === 'de' ? 'Speichern' : 'Save'}
                </Button>
              </div>
              {results['ws_gate_enabled'] === 'ok' && <p className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle className="w-3.5 h-3.5" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}</p>}
              {results['ws_gate_enabled'] === 'error' && <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertCircle className="w-3.5 h-3.5" /> {lang === 'de' ? 'Fehler' : 'Error'}</p>}
            </div>

            {/* Text fields — title + body in DE and EN */}
            {(
              [
                { key: 'ws_gate_title_de' as WsKey, labelDe: 'Titel (Deutsch)',  labelEn: 'Title (German)',  rows: 2 },
                { key: 'ws_gate_title_en' as WsKey, labelDe: 'Titel (Englisch)', labelEn: 'Title (English)', rows: 2 },
                { key: 'ws_gate_body_de'  as WsKey, labelDe: 'Text (Deutsch)',   labelEn: 'Body (German)',   rows: 3 },
                { key: 'ws_gate_body_en'  as WsKey, labelDe: 'Text (Englisch)',  labelEn: 'Body (English)',  rows: 3 },
              ] as { key: WsKey; labelDe: string; labelEn: string; rows: number }[]
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
                {results[key] === 'ok' && <p className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle className="w-3.5 h-3.5" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}</p>}
                {results[key] === 'error' && <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertCircle className="w-3.5 h-3.5" /> {lang === 'de' ? 'Fehler' : 'Error'}</p>}
              </div>
            ))}

            {/* Link URL */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {lang === 'de' ? 'Link-URL (Nicht-Ärzte werden hierhin weitergeleitet)' : 'Link URL (non-doctors are directed here)'}
              </label>
              <div className="flex gap-2">
                <Input
                  type="url"
                  value={edits['ws_gate_link_url'] ?? ''}
                  onChange={(e) => setEdits((v) => ({ ...v, ws_gate_link_url: e.target.value }))}
                  placeholder="https://www.spirecut.de"
                  className="flex-1"
                />
                <Button size="sm" onClick={() => handleSave('ws_gate_link_url')} disabled={saving['ws_gate_link_url']} className="gap-1.5 shrink-0">
                  {saving['ws_gate_link_url'] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {lang === 'de' ? 'Speichern' : 'Save'}
                </Button>
              </div>
              {results['ws_gate_link_url'] === 'ok' && <p className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle className="w-3.5 h-3.5" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}</p>}
              {results['ws_gate_link_url'] === 'error' && <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertCircle className="w-3.5 h-3.5" /> {lang === 'de' ? 'Fehler' : 'Error'}</p>}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
