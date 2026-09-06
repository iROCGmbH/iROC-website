import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { Save, RefreshCw, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { adminRequest } from '@/lib/admin-fetch';

interface PortalSettings {
  portal_welcome_de?: string;
  portal_welcome_en?: string;
  portal_subtitle_de?: string;
  portal_subtitle_en?: string;
}

const DEFAULTS: Required<PortalSettings> = {
  portal_welcome_de: 'Willkommen',
  portal_welcome_en: 'Welcome',
  portal_subtitle_de: 'Wählen Sie eine Option aus dem Menü unten.',
  portal_subtitle_en: 'Select an option from the menu below.',
};

export default function PortalDesign() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const langRef = useRef(lang);
  const toastRef = useRef(toast);
  const tokenRef = useRef(token);
  langRef.current = lang;
  toastRef.current = toast;
  tokenRef.current = token;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<PortalSettings>({});

  const load = useCallback(async () => {
    if (!token) return;
    const requestToken = token;
    setLoading(true);
    try {
      const res = await adminRequest('/api/admin/portal-settings', requestToken);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = await res.json();
      if (tokenRef.current !== requestToken) return;
      setSettings(next);
    } catch {
      if (tokenRef.current !== requestToken) return;
      toastRef.current({ variant: 'destructive', title: langRef.current === 'de' ? 'Fehler beim Laden' : 'Load failed' });
    } finally {
      if (tokenRef.current === requestToken) setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const saveAll = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await Promise.all(
        (Object.keys(settings) as (keyof PortalSettings)[]).map(key =>
          adminRequest('/api/admin/portal-settings', token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: settings[key] ?? '' }),
          })
        )
      );
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const val = (key: keyof PortalSettings) => settings[key] ?? '';
  const set = (key: keyof PortalSettings, value: string) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          {lang === 'de' ? 'Arztportal – Design & Einstellungen' : 'Doctor Portal – Design & Settings'}
        </h2>
        <p className="text-slate-500 mt-1">
          {lang === 'de'
            ? 'Passen Sie die Texte und das Erscheinungsbild des Arztportals an.'
            : 'Customise the text and appearance of the doctor portal.'}
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
        <div>
          {lang === 'de'
            ? 'Änderungen werden im Arztportal beim nächsten Laden der Seite übernommen. Leer lassen = Standardtext wird verwendet.'
            : 'Changes take effect in the doctor portal on the next page load. Leave blank to use the default text.'}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Welcome Message */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {lang === 'de' ? 'Begrüßungstext' : 'Welcome Message'}
              </CardTitle>
              <CardDescription>
                {lang === 'de'
                  ? `Wird auf der Startseite des Portals angezeigt (Standard: "${DEFAULTS.portal_welcome_de}" / "${DEFAULTS.portal_welcome_en}")`
                  : `Shown on the portal home screen (default: "${DEFAULTS.portal_welcome_de}" / "${DEFAULTS.portal_welcome_en}")`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Deutsch</Label>
                  <Input
                    value={val('portal_welcome_de')}
                    onChange={e => set('portal_welcome_de', e.target.value)}
                    placeholder={DEFAULTS.portal_welcome_de}
                  />
                </div>
                <div className="space-y-2">
                  <Label>English</Label>
                  <Input
                    value={val('portal_welcome_en')}
                    onChange={e => set('portal_welcome_en', e.target.value)}
                    placeholder={DEFAULTS.portal_welcome_en}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Portal Subtitle */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {lang === 'de' ? 'Untertitel / Beschreibung' : 'Subtitle / Description'}
              </CardTitle>
              <CardDescription>
                {lang === 'de'
                  ? 'Kurzer Text unterhalb des Begrüßungstexts auf der Startseite des Portals.'
                  : 'Short text below the welcome message on the portal home screen.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Deutsch</Label>
                  <Textarea
                    value={val('portal_subtitle_de')}
                    onChange={e => set('portal_subtitle_de', e.target.value)}
                    placeholder={DEFAULTS.portal_subtitle_de}
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>English</Label>
                  <Textarea
                    value={val('portal_subtitle_en')}
                    onChange={e => set('portal_subtitle_en', e.target.value)}
                    placeholder={DEFAULTS.portal_subtitle_en}
                    rows={3}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Live preview */}
          <Card className="bg-gradient-to-br from-slate-50 to-slate-100">
            <CardHeader>
              <CardTitle className="text-sm text-slate-500 font-medium uppercase tracking-wider">
                {lang === 'de' ? 'Vorschau – Startseite Arztportal' : 'Preview – Portal Home Screen'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm max-w-sm mx-auto">
                <div className="mb-4">
                  <p className="text-xl font-bold text-slate-900">
                    {val('portal_welcome_de') || DEFAULTS.portal_welcome_de},&nbsp;
                    <span className="text-primary">Dr. Mustermann</span>
                  </p>
                  <p className="text-sm text-slate-500 mt-1">
                    {val('portal_subtitle_de') || DEFAULTS.portal_subtitle_de}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {['Lehrportal', 'Rechnungen', 'Bestellung', 'Schulung'].map(item => (
                    <div key={item} className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-500 font-medium">{item}</div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Save button */}
          <div className="flex items-center gap-3">
            <Button onClick={saveAll} disabled={saving}>
              {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {lang === 'de' ? 'Alle Änderungen speichern' : 'Save all changes'}
            </Button>
            <Button variant="outline" onClick={load} disabled={loading || saving}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {lang === 'de' ? 'Zurücksetzen' : 'Reload'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
