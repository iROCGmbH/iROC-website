import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { adminGet, adminPut, adminPost } from '@/lib/admin-fetch';
import { Button } from '@/components/ui/button';
import { Loader2, Save, Trash2, Plus, Image as ImageIcon, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type EmailAddressOption = {
  id: string;
  email: string;
  displayName: string;
  descriptionDe: string;
  descriptionEn: string;
  brand: 'iroc' | 'spirecut';
  source: 'smtp' | 'website_setting' | 'sally' | 'microsoft365';
};

export type EmailSignatureColumn = {
  id: string;
  titleDe: string;
  titleEn: string;
  bodyDe: string;
  bodyEn: string;
};

export type EmailSignatureProfile = {
  group: 'admin' | 'sally' | 'tori';
  enabled: boolean;
  addressId: string;
  thankYouDe: string;
  thankYouEn: string;
  writerName: string;
  writerRoleDe: string;
  writerRoleEn: string;
  writerEmail: string;
  writerPhone: string;
  logoPath: string;
  columns: EmailSignatureColumn[];
};

type GroupOptions = 'admin' | 'sally' | 'tori';

export const EMAIL_SIGNATURE_LOGO_MAX_BYTES = 512 * 1024;
export const EMAIL_SIGNATURE_LOGO_MAX_WIDTH = 600;
export const EMAIL_SIGNATURE_LOGO_MAX_HEIGHT = 200;

const logoAdjustmentMessage = (lang: 'de' | 'en') =>
  lang === 'de'
    ? 'Bitte verwenden Sie ein Bild mit höchstens 512 KB und 600 × 200 px oder kleiner.'
    : 'Please use an image no larger than 512 KB and 600 × 200 px.';

function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The image could not be read.'));
    };
    image.src = url;
  });
}

async function prepareEmailSignatureLogo(file: File): Promise<File> {
  const dimensions = await loadImageDimensions(file);
  const scale = Math.min(
    1,
    EMAIL_SIGNATURE_LOGO_MAX_WIDTH / dimensions.width,
    EMAIL_SIGNATURE_LOGO_MAX_HEIGHT / dimensions.height,
  );
  if (scale === 1 && file.size <= EMAIL_SIGNATURE_LOGO_MAX_BYTES) return file;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(dimensions.width * scale));
  canvas.height = Math.max(1, Math.round(dimensions.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The image could not be read.'));
      image.src = url;
    });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.size > EMAIL_SIGNATURE_LOGO_MAX_BYTES) {
      throw new Error('The resized image is still too large.');
    }
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'signature-logo'}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DEFAULT_PROFILE = (group: GroupOptions): EmailSignatureProfile => ({
  group,
  enabled: false,
  addressId: '',
  thankYouDe: '',
  thankYouEn: '',
  writerName: '',
  writerRoleDe: '',
  writerRoleEn: '',
  writerEmail: '',
  writerPhone: '',
  logoPath: '',
  columns: [],
});

export function EmailSignatureDesigner() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addresses, setAddresses] = useState<EmailAddressOption[]>([]);
  const [profiles, setProfiles] = useState<Record<GroupOptions, EmailSignatureProfile>>({
    admin: DEFAULT_PROFILE('admin'),
    sally: DEFAULT_PROFILE('sally'),
    tori: DEFAULT_PROFILE('tori'),
  });
  const [activeGroup, setActiveGroup] = useState<GroupOptions>('admin');
  const [previewLang, setPreviewLang] = useState<'de' | 'en'>(lang);

  const activeProfile = profiles[activeGroup];

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    adminGet<{ addresses: EmailAddressOption[]; signatures: EmailSignatureProfile[] }>(
      '/api/admin/email-signatures',
      token
    )
      .then((data) => {
        setAddresses(data.addresses);
        setProfiles((currentProfiles) => {
          const newProfiles = { ...currentProfiles };
          for (const sig of data.signatures) {
            if (sig.group === 'admin' || sig.group === 'sally' || sig.group === 'tori') {
              newProfiles[sig.group] = sig;
            }
          }
          return newProfiles;
        });
      })
      .catch((err) => {
        toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Laden' : 'Error loading', description: String(err) });
      })
      .finally(() => setLoading(false));
  }, [token, lang, toast]);

  const updateActiveProfile = (updater: (prev: EmailSignatureProfile) => EmailSignatureProfile) => {
    setProfiles((prev) => ({
      ...prev,
      [activeGroup]: updater(prev[activeGroup]),
    }));
  };

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const savedProfile = await adminPut<EmailSignatureProfile>(
        `/api/admin/email-signatures/${activeGroup}`,
        token,
        activeProfile
      );
      setProfiles((prev) => ({ ...prev, [activeGroup]: savedProfile }));
      toast({ title: lang === 'de' ? 'Signatur gespeichert' : 'Signature saved' });
    } catch (err) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Speichern fehlgeschlagen' : 'Save failed', description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    
    if (!file.type.startsWith('image/')) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Ungültiges Dateiformat' : 'Invalid file format', description: lang === 'de' ? 'Bitte wählen Sie ein Bild aus.' : 'Please select an image file.' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    if (file.size > EMAIL_SIGNATURE_LOGO_MAX_BYTES) {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Logo muss angepasst werden' : 'Logo needs adjustment', description: logoAdjustmentMessage(lang) });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploadingLogo(true);
    try {
      const preparedFile = await prepareEmailSignatureLogo(file);
      const { uploadURL, objectPath } = await adminPost<{ uploadURL: string; objectPath: string }>(
        '/api/storage/uploads/request-url/logo',
        token,
        { name: preparedFile.name, size: preparedFile.size, contentType: preparedFile.type }
      );
      const res = await fetch(uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': preparedFile.type },
        body: preparedFile,
      });
      if (!res.ok) throw new Error('Upload to storage failed');
      updateActiveProfile((p) => ({ ...p, logoPath: objectPath }));
    } catch (err) {
      const message = err instanceof Error && (
        err.message === 'The resized image is still too large.' ||
        err.message === 'The image could not be read.'
      )
        ? logoAdjustmentMessage(lang)
        : String(err);
      toast({ variant: 'destructive', title: lang === 'de' ? 'Logo muss angepasst werden' : 'Logo needs adjustment', description: message });
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12 bg-card border rounded-xl" data-testid="container-loading">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const groupLabels: Record<GroupOptions, string> = {
    admin: lang === 'de' ? 'Admin' : 'Admin',
    sally: lang === 'de' ? 'Sally KI' : 'Sally AI',
    tori: lang === 'de' ? 'Tori KI' : 'Tori AI',
  };

  return (
    <div className="bg-card border rounded-xl shadow-sm flex flex-col md:flex-row items-stretch">
      <div className="w-full md:w-[45%] flex flex-col border-b md:border-b-0 md:border-r rounded-t-xl md:rounded-tr-none md:rounded-l-xl">
        <div className="p-4 border-b flex items-center justify-between bg-muted/30">
          <div className="flex gap-2">
            {(['admin', 'sally', 'tori'] as GroupOptions[]).map((grp) => (
              <button
                type="button"
                key={grp}
                data-testid={`btn-group-${grp}`}
                aria-label={lang === 'de' ? `${groupLabels[grp]} Profil laden` : `Load ${groupLabels[grp]} profile`}
                title={lang === 'de' ? `${groupLabels[grp]} Profil laden` : `Load ${groupLabels[grp]} profile`}
                onClick={() => setActiveGroup(grp)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  activeGroup === grp
                    ? 'bg-background shadow-sm border text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                {groupLabels[grp]}
              </button>
            ))}
          </div>
          <Button type="button" onClick={handleSave} disabled={saving} size="sm" className="gap-2" data-testid="btn-save-profile">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {lang === 'de' ? 'Speichern' : 'Save'}
          </Button>
        </div>
        
        <div className="p-5 flex-1 space-y-6">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold cursor-pointer" htmlFor="enable-sig">
              {lang === 'de' ? 'Signatur aktivieren' : 'Enable signature'}
            </Label>
            <Switch
              id="enable-sig"
              data-testid="switch-enable"
              checked={activeProfile.enabled}
              onCheckedChange={(checked) => updateActiveProfile((p) => ({ ...p, enabled: checked }))}
            />
          </div>

          <div className="space-y-3">
            <Label>{lang === 'de' ? 'Verknüpfte E-Mail-Adresse' : 'Linked Email Address'}</Label>
            {addresses.length === 0 ? (
              <div className="text-sm text-muted-foreground border border-dashed rounded-md p-3 text-center" data-testid="empty-addresses">
                {lang === 'de' ? 'Keine Adressen verfügbar' : 'No addresses available'}
              </div>
            ) : (
              <Select
                value={activeProfile.addressId}
                onValueChange={(val) => updateActiveProfile((p) => ({ ...p, addressId: val }))}
              >
                <SelectTrigger data-testid="select-address">
                  <SelectValue placeholder={lang === 'de' ? 'Adresse wählen...' : 'Select address...'} />
                </SelectTrigger>
                <SelectContent>
                  {addresses.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.email} {a.displayName ? `(${a.displayName})` : ''} - {lang === 'de' ? a.descriptionDe : a.descriptionEn} [{a.brand.toUpperCase()}]
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground border-b pb-1">
              {lang === 'de' ? 'Schlusstext & Absender' : 'Closing & Sender'}
            </h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{lang === 'de' ? 'Dankestext (DE)' : 'Thank You (DE)'}</Label>
                <Input
                  data-testid="input-thankyou-de"
                  value={activeProfile.thankYouDe}
                  onChange={(e) => updateActiveProfile((p) => ({ ...p, thankYouDe: e.target.value }))}
                  placeholder="Freundliche Grüße,"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{lang === 'de' ? 'Dankestext (EN)' : 'Thank You (EN)'}</Label>
                <Input
                  data-testid="input-thankyou-en"
                  value={activeProfile.thankYouEn}
                  onChange={(e) => updateActiveProfile((p) => ({ ...p, thankYouEn: e.target.value }))}
                  placeholder="Best regards,"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>{lang === 'de' ? 'Name' : 'Name'}</Label>
                <Input
                  data-testid="input-writer-name"
                  value={activeProfile.writerName}
                  onChange={(e) => updateActiveProfile((p) => ({ ...p, writerName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>{lang === 'de' ? 'E-Mail' : 'Email'}</Label>
                <Input
                  type="email"
                  data-testid="input-writer-email"
                  value={activeProfile.writerEmail}
                  onChange={(e) => updateActiveProfile((p) => ({ ...p, writerEmail: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{lang === 'de' ? 'Rolle (DE)' : 'Role (DE)'}</Label>
                <Input
                  data-testid="input-writer-role-de"
                  value={activeProfile.writerRoleDe}
                  onChange={(e) => updateActiveProfile((p) => ({ ...p, writerRoleDe: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{lang === 'de' ? 'Rolle (EN)' : 'Role (EN)'}</Label>
                <Input
                  data-testid="input-writer-role-en"
                  value={activeProfile.writerRoleEn}
                  onChange={(e) => updateActiveProfile((p) => ({ ...p, writerRoleEn: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{lang === 'de' ? 'Telefon' : 'Phone'}</Label>
              <Input
                data-testid="input-writer-phone"
                value={activeProfile.writerPhone}
                onChange={(e) => updateActiveProfile((p) => ({ ...p, writerPhone: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground border-b pb-1">
              {lang === 'de' ? 'Logo & Branding' : 'Logo & Branding'}
            </h3>
            <div className="flex items-start gap-4">
              <div className="w-24 h-24 border rounded-md bg-muted/30 flex items-center justify-center relative overflow-hidden shrink-0">
                {activeProfile.logoPath ? (
                  <img
                    src={activeProfile.logoPath.startsWith('http') ? activeProfile.logoPath : `/api/storage/${activeProfile.logoPath.replace(/^\/+/, '')}`}
                    alt="Logo preview"
                    className="w-full h-full object-contain p-2"
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  ref={fileInputRef}
                  onChange={handleLogoUpload}
                  disabled={uploadingLogo}
                  className="w-full"
                  data-testid="input-logo-upload"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingLogo || !activeProfile.logoPath}
                    onClick={() => updateActiveProfile((p) => ({ ...p, logoPath: '' }))}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {lang === 'de' ? 'Entfernen' : 'Clear'}
                  </Button>
                  {uploadingLogo && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground ml-auto" />}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between border-b pb-1">
              <h3 className="font-medium text-sm text-muted-foreground">
                {lang === 'de' ? 'Spalten (Firmeninfos)' : 'Columns (Company Info)'}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                data-testid="btn-add-column"
                disabled={activeProfile.columns.length >= 4}
                onClick={() => {
                  updateActiveProfile((p) => ({
                    ...p,
                    columns: [
                      ...p.columns,
                      { id: Date.now().toString(), titleDe: '', titleEn: '', bodyDe: '', bodyEn: '' },
                    ],
                  }));
                }}
              >
                <Plus className="w-3 h-3 mr-1" />
                {lang === 'de' ? 'Hinzufügen' : 'Add'}
              </Button>
            </div>
            
            <div className="space-y-4">
              {activeProfile.columns.map((col, idx) => (
                <div key={col.id} className="border rounded-md p-3 relative bg-card shadow-sm group">
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      disabled={idx === 0}
                      aria-label={lang === 'de' ? 'Spalte nach oben verschieben' : 'Move column up'}
                      title={lang === 'de' ? 'Spalte nach oben verschieben' : 'Move column up'}
                      onClick={() => {
                        updateActiveProfile((p) => {
                          const cols = [...p.columns];
                          [cols[idx - 1], cols[idx]] = [cols[idx], cols[idx - 1]];
                          return { ...p, columns: cols };
                        });
                      }}
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      disabled={idx === activeProfile.columns.length - 1}
                      aria-label={lang === 'de' ? 'Spalte nach unten verschieben' : 'Move column down'}
                      title={lang === 'de' ? 'Spalte nach unten verschieben' : 'Move column down'}
                      onClick={() => {
                        updateActiveProfile((p) => {
                          const cols = [...p.columns];
                          [cols[idx + 1], cols[idx]] = [cols[idx], cols[idx + 1]];
                          return { ...p, columns: cols };
                        });
                      }}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      data-testid={`btn-remove-column-${idx}`}
                      aria-label={lang === 'de' ? 'Spalte entfernen' : 'Remove column'}
                      title={lang === 'de' ? 'Spalte entfernen' : 'Remove column'}
                      onClick={() => {
                        updateActiveProfile((p) => ({
                          ...p,
                          columns: p.columns.filter((c) => c.id !== col.id),
                        }));
                      }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  
                  <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{lang === 'de' ? 'Titel (DE)' : 'Title (DE)'}</Label>
                        <Input
                          className="h-8 text-sm"
                          data-testid={`input-column-title-de-${idx}`}
                          value={col.titleDe}
                          onChange={(e) => {
                            updateActiveProfile((p) => {
                              const cols = [...p.columns];
                              cols[idx] = { ...cols[idx], titleDe: e.target.value };
                              return { ...p, columns: cols };
                            });
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{lang === 'de' ? 'Titel (EN)' : 'Title (EN)'}</Label>
                        <Input
                          className="h-8 text-sm"
                          data-testid={`input-column-title-en-${idx}`}
                          value={col.titleEn}
                          onChange={(e) => {
                            updateActiveProfile((p) => {
                              const cols = [...p.columns];
                              cols[idx] = { ...cols[idx], titleEn: e.target.value };
                              return { ...p, columns: cols };
                            });
                          }}
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{lang === 'de' ? 'Inhalt (DE)' : 'Body (DE)'}</Label>
                        <Textarea
                          className="min-h-[60px] text-sm py-1.5"
                          data-testid={`textarea-column-body-de-${idx}`}
                          value={col.bodyDe}
                          onChange={(e) => {
                            updateActiveProfile((p) => {
                              const cols = [...p.columns];
                              cols[idx] = { ...cols[idx], bodyDe: e.target.value };
                              return { ...p, columns: cols };
                            });
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{lang === 'de' ? 'Inhalt (EN)' : 'Body (EN)'}</Label>
                        <Textarea
                          className="min-h-[60px] text-sm py-1.5"
                          data-testid={`textarea-column-body-en-${idx}`}
                          value={col.bodyEn}
                          onChange={(e) => {
                            updateActiveProfile((p) => {
                              const cols = [...p.columns];
                              cols[idx] = { ...cols[idx], bodyEn: e.target.value };
                              return { ...p, columns: cols };
                            });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {activeProfile.columns.length === 0 && (
                <div className="text-sm text-muted-foreground text-center p-4 border border-dashed rounded-md">
                  {lang === 'de' ? 'Keine Spalten angelegt' : 'No columns added'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="w-full md:w-[55%] bg-slate-50 dark:bg-slate-900 rounded-b-xl md:rounded-bl-none md:rounded-r-xl relative">
        <div className="md:sticky md:top-4 flex flex-col max-h-[calc(100vh-2rem)] border-t md:border-t-0 bg-slate-50 dark:bg-slate-900 rounded-b-xl md:rounded-bl-none md:rounded-r-xl">
          <div className="p-4 border-b flex items-center justify-between bg-muted/30">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              {lang === 'de' ? 'Live-Vorschau' : 'Live Preview'}
              {!activeProfile.enabled && (
                <span className="bg-destructive/10 text-destructive text-[10px] px-2 py-0.5 rounded-full font-medium">
                  {lang === 'de' ? 'Deaktiviert' : 'Disabled'}
                </span>
              )}
            </h2>
            <div className="flex bg-background border rounded-md overflow-hidden text-xs">
              <button
                type="button"
                className={`px-3 py-1 ${previewLang === 'de' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                onClick={() => setPreviewLang('de')}
                data-testid="btn-preview-de"
                aria-label={lang === 'de' ? 'Vorschau auf Deutsch umschalten' : 'Switch preview to German'}
                title={lang === 'de' ? 'Vorschau auf Deutsch umschalten' : 'Switch preview to German'}
              >
                DE
              </button>
              <button
                type="button"
                className={`px-3 py-1 ${previewLang === 'en' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                onClick={() => setPreviewLang('en')}
                data-testid="btn-preview-en"
                aria-label={lang === 'de' ? 'Vorschau auf Englisch umschalten' : 'Switch preview to English'}
                title={lang === 'de' ? 'Vorschau auf Englisch umschalten' : 'Switch preview to English'}
              >
                EN
              </button>
            </div>
          </div>

          <div className="p-8 overflow-y-auto flex justify-center pb-24">
            <div className="bg-white dark:bg-slate-950 p-6 rounded-lg shadow-sm border text-sm font-sans text-slate-800 dark:text-slate-200 w-full max-w-2xl min-w-0 h-fit">
            <div className="mb-4 whitespace-pre-line" data-testid="preview-thankyou">
              {previewLang === 'de' ? (activeProfile.thankYouDe || '—') : (activeProfile.thankYouEn || '—')}
            </div>

            <div className="font-semibold text-base mb-0.5" data-testid="preview-writername">
              {activeProfile.writerName || '—'}
            </div>
            
            <div className="text-slate-600 dark:text-slate-400 mb-4" data-testid="preview-writerrole">
              {previewLang === 'de' ? activeProfile.writerRoleDe : activeProfile.writerRoleEn}
            </div>
            
            <div className="flex gap-4 items-center mb-6">
              {activeProfile.logoPath && (
                <img
                  src={activeProfile.logoPath.startsWith('http') ? activeProfile.logoPath : `/api/storage/${activeProfile.logoPath.replace(/^\/+/, '')}`}
                  alt="Logo"
                    className="max-h-12 max-w-full object-contain"
                />
              )}
              <div className="space-y-0.5 text-[13px] text-slate-600 dark:text-slate-400 border-l pl-4 border-slate-200 dark:border-slate-800">
                {activeProfile.writerEmail && <div>E: {activeProfile.writerEmail}</div>}
                {activeProfile.writerPhone && <div>T: {activeProfile.writerPhone}</div>}
                {activeProfile.addressId && (
                  <div>
                    {(() => {
                      const addr = addresses.find((a) => a.id === activeProfile.addressId);
                      return addr ? (
                        <>
                          <span className="font-medium text-slate-900 dark:text-slate-100">{addr.email}</span>
                          <span className="text-slate-400 ml-2">[{addr.brand.toUpperCase()}]</span>
                        </>
                      ) : (
                        '—'
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>

            {activeProfile.columns.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-200 dark:border-slate-800 text-[12px] text-slate-500 dark:text-slate-400">
                {activeProfile.columns.map((col, idx) => (
                  <div key={col.id} className="space-y-1 min-w-0 break-words" data-testid={`preview-column-${idx}`}>
                    <div className="font-medium text-slate-700 dark:text-slate-300">
                      {previewLang === 'de' ? col.titleDe : col.titleEn}
                    </div>
                    <div className="whitespace-pre-line leading-relaxed">
                      {previewLang === 'de' ? col.bodyDe : col.bodyEn}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
  );
}
