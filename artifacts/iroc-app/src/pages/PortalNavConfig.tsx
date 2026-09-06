import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { Save, RefreshCw, Info, GripVertical, Home, ShoppingBag, GraduationCap, FileText, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { adminRequest } from '@/lib/admin-fetch';

interface PortalTab {
  id: string;
  labelDe: string;
  labelEn: string;
  href: string;
  icon: React.ReactNode;
  required?: boolean; // cannot be hidden
}

const PORTAL_TABS: PortalTab[] = [
  { id: 'dashboard', labelDe: 'Übersicht',    labelEn: 'Home',     href: '/dashboard', icon: <Home className="w-5 h-5" />,        required: true },
  { id: 'order',     labelDe: 'Bestellen',    labelEn: 'Order',    href: '/order',     icon: <ShoppingBag className="w-5 h-5" /> },
  { id: 'training',  labelDe: 'Schulung',     labelEn: 'Training', href: '/training',  icon: <GraduationCap className="w-5 h-5" /> },
  { id: 'invoices',  labelDe: 'Rechnungen',   labelEn: 'Invoices', href: '/invoices',  icon: <FileText className="w-5 h-5" /> },
  { id: 'profile',   labelDe: 'Profil',       labelEn: 'Profile',  href: '/profile',   icon: <User className="w-5 h-5" /> },
];

interface TabConfig {
  id: string;
  visible: boolean;
}

export default function PortalNavConfig() {
  const { token } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const { lang } = useLanguage();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tabConfig, setTabConfig] = useState<TabConfig[]>(
    PORTAL_TABS.map(t => ({ id: t.id, visible: true }))
  );

  const load = useCallback(async () => {
    if (!token) return;
    const requestToken = token;
    setLoading(true);
    try {
      const res = await adminRequest('/api/admin/portal-settings', requestToken);
      if (!res.ok) throw new Error();
      const data: Record<string, string> = await res.json();
      if (tokenRef.current !== requestToken) return;
      if (data.portal_nav_config) {
        const stored: TabConfig[] = JSON.parse(data.portal_nav_config);
        // Merge stored config with defaults (in case new tabs were added)
        setTabConfig(
          PORTAL_TABS.map(tab => {
            const found = stored.find(s => s.id === tab.id);
            return { id: tab.id, visible: tab.required ? true : (found?.visible ?? true) };
          })
        );
      }
    } catch {
      if (tokenRef.current !== requestToken) return;
      // Non-fatal: use defaults
    } finally {
      if (tokenRef.current === requestToken) setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const toggleTab = (id: string, visible: boolean) => {
    setTabConfig(prev => prev.map(t => t.id === id ? { ...t, visible } : t));
  };

  const save = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const res = await adminRequest('/api/admin/portal-settings', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'portal_nav_config', value: JSON.stringify(tabConfig) }),
      });
      if (!res.ok) throw new Error();
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved', description: lang === 'de' ? 'Navigation wurde aktualisiert.' : 'Navigation updated.' });
    } catch {
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const visibleCount = tabConfig.filter(t => t.visible).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          {lang === 'de' ? 'Arztportal – Navigation' : 'Doctor Portal – Navigation'}
        </h2>
        <p className="text-slate-500 mt-1">
          {lang === 'de'
            ? 'Wählen Sie, welche Tabs in der unteren Navigationsleiste des Portals erscheinen.'
            : 'Choose which tabs appear in the portal\'s bottom navigation bar.'}
        </p>
      </div>

      <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
        <div>
          {lang === 'de'
            ? 'Änderungen werden im Arztportal beim nächsten Laden wirksam. Mindestens 2 Tabs müssen sichtbar sein.'
            : 'Changes take effect on next portal load. At least 2 tabs must remain visible.'}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {PORTAL_TABS.map((tab, idx) => {
            const cfg = tabConfig.find(t => t.id === tab.id);
            const isVisible = cfg?.visible ?? true;
            const canHide = !tab.required && visibleCount > 2;
            const id = `tab-${tab.id}`;

            return (
              <div
                key={tab.id}
                className={`flex items-center gap-4 p-4 bg-white border rounded-xl transition-colors ${
                  isVisible ? 'border-slate-200' : 'border-slate-100 opacity-50'
                }`}
              >
                {/* Drag handle (visual only) */}
                <GripVertical className="w-4 h-4 text-slate-300 shrink-0" />

                {/* Tab number */}
                <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>

                {/* Icon */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isVisible ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-400'}`}>
                  {tab.icon}
                </div>

                {/* Labels */}
                <div className="flex-1">
                  <p className="font-medium text-slate-900">
                    {lang === 'de' ? tab.labelDe : tab.labelEn}
                    {tab.required && (
                      <span className="ml-2 text-xs text-slate-400 font-normal">
                        ({lang === 'de' ? 'Pflichtfeld' : 'required'})
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">{tab.href}</p>
                </div>

                {/* Toggle */}
                <div className="flex items-center gap-2">
                  <Label htmlFor={id} className="text-sm text-slate-500">
                    {isVisible ? (lang === 'de' ? 'Sichtbar' : 'Visible') : (lang === 'de' ? 'Versteckt' : 'Hidden')}
                  </Label>
                  <Switch
                    id={id}
                    checked={isVisible}
                    disabled={tab.required || (!isVisible && visibleCount <= 2) || (!canHide && isVisible && visibleCount <= 2)}
                    onCheckedChange={v => toggleTab(tab.id, v)}
                  />
                </div>
              </div>
            );
          })}

          {/* Preview row */}
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
              {lang === 'de' ? 'Vorschau – untere Navigationsleiste' : 'Preview – bottom navigation bar'}
            </p>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex h-16 divide-x divide-slate-100">
                {tabConfig.filter(t => t.visible).map(t => {
                  const tab = PORTAL_TABS.find(p => p.id === t.id)!;
                  return (
                    <div key={t.id} className="flex-1 flex flex-col items-center justify-center gap-1 text-primary">
                      {tab.icon}
                      <span className="text-[9px] font-medium">{lang === 'de' ? tab.labelDe : tab.labelEn}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={save} disabled={saving}>
              {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {lang === 'de' ? 'Navigation speichern' : 'Save Navigation'}
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
