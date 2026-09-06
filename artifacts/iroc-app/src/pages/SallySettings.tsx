import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { adminGet, adminPut, adminPost } from '@/lib/admin-fetch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Settings, Save, Loader2, CheckCircle, AlertCircle,
  PlayCircle, Mail, Info, User, Globe, Wifi, WifiOff, Eye, EyeOff,
  GraduationCap, Trash2,
} from 'lucide-react';
import { adminDelete } from '@/lib/admin-fetch';

type CronResult = { leads: string; doctors: string; promo: string; orders?: string } | null;

interface Lesson {
  id: number;
  context: string;
  lesson: string;
  original_text: string;
  corrected_text: string;
  created_at: string;
}
type LangOption = 'de' | 'en' | 'both';

const DEFAULT_SETTINGS = {
  sally_bulk_discount_pct:  '10',
  sally_from_name:          'Sally',
  sally_from_email:         '',
  sally_escalation_email:   'info@i-roc.de',
  sally_lang_first_contact: 'both' as LangOption,
  sally_lang_followup:      'both' as LangOption,
  sally_imap_enabled:       'false',
  sally_imap_host:          'outlook.office365.com',
  sally_imap_port:          '993',
  sally_imap_user:          '',
  sally_imap_pass:          '',
  // OAuth2 / Modern Auth
  sally_imap_oauth_client_id:     '',
  sally_imap_oauth_tenant_id:     '',
  sally_imap_oauth_client_secret: '',
};

type Settings = typeof DEFAULT_SETTINGS;

export default function SallySettings() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();

  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [showPass, setShowPass] = useState(false);
  const [showOAuthSecret, setShowOAuthSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runningCron, setRunningCron] = useState(false);
  const [cronResult, setCronResult] = useState<CronResult>(null);
  const [testingImap, setTestingImap] = useState(false);
  const [imapTestResult, setImapTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [expandedLesson, setExpandedLesson] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    adminGet<Record<string, string>>('/api/admin/sally/settings', token)
      .then(s => setSettings(prev => ({ ...prev, ...s }) as Settings))
      .catch(() => {});
    adminGet<Lesson[]>('/api/admin/sally/lessons', token)
      .then(setLessons)
      .catch(() => {});
  }, [token]);

  async function handleDeleteLesson(id: number) {
    if (!token) return;
    try {
      await adminDelete(`/api/admin/sally/lessons/${id}`, token);
      setLessons(prev => prev.filter(l => l.id !== id));
      toast({ title: lang === 'de' ? 'Lektion gelöscht' : 'Lesson deleted' });
    } catch {
      toast({ title: lang === 'de' ? 'Fehler beim Löschen' : 'Delete failed', variant: 'destructive' });
    }
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!token) return;
    setSaving(true); setSaved(false);
    try {
      await adminPut('/api/admin/sally/settings', token, settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      toast({ title: lang === 'de' ? 'Einstellungen gespeichert' : 'Settings saved' });
    } catch {
      toast({ title: lang === 'de' ? 'Fehler beim Speichern' : 'Save failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleRunCron() {
    if (!token) return;
    setRunningCron(true); setCronResult(null);
    try {
      const res = await adminPost<{ ok: boolean; results: CronResult }>('/api/admin/sally/cron/run', token, {});
      setCronResult(res.results);
      toast({ title: lang === 'de' ? 'Cron-Jobs ausgeführt' : 'Cron jobs executed' });
    } catch (err) {
      toast({ title: String(err), variant: 'destructive' });
    } finally {
      setRunningCron(false);
    }
  }

  async function handleTestImap() {
    if (!token) return;
    setTestingImap(true); setImapTestResult(null);
    try {
      const result = await adminPost<{ ok: boolean; message: string }>(
        '/api/admin/sally/imap/test', token,
        {
          host: settings.sally_imap_host,
          port: parseInt(settings.sally_imap_port || '993'),
          user: settings.sally_imap_user,
          pass: settings.sally_imap_pass,
          ...(settings.sally_imap_oauth_client_id && settings.sally_imap_oauth_tenant_id && settings.sally_imap_oauth_client_secret
            ? {
                oauthClientId:     settings.sally_imap_oauth_client_id,
                oauthTenantId:     settings.sally_imap_oauth_tenant_id,
                oauthClientSecret: settings.sally_imap_oauth_client_secret,
              }
            : {}),
        },
      );
      setImapTestResult(result);
    } catch (err) {
      setImapTestResult({ ok: false, message: String(err) });
    } finally {
      setTestingImap(false);
    }
  }

  const hasOAuth = !!(
    settings.sally_imap_oauth_client_id &&
    settings.sally_imap_oauth_tenant_id &&
    settings.sally_imap_oauth_client_secret
  );

  const LANG_OPTIONS: { value: LangOption; de: string; en: string }[] = [
    { value: 'both', de: 'Zweisprachig (DE + EN)', en: 'Bilingual (DE + EN)' },
    { value: 'de',   de: 'Nur Deutsch',            en: 'German only' },
    { value: 'en',   de: 'Nur Englisch',           en: 'English only' },
  ];

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">{lang === 'de' ? 'Sally – Einstellungen' : 'Sally – Settings'}</h1>
            <p className="text-sm text-muted-foreground">
              {lang === 'de' ? 'Identität, E-Mail-Sprachen und Posteingangskonfiguration' : 'Identity, email languages, and inbox configuration'}
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {lang === 'de' ? 'Alle speichern' : 'Save all'}
          {saved && <CheckCircle className="w-4 h-4 text-green-200" />}
        </Button>
      </div>

      {/* ── Sally Identity ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" />
            {lang === 'de' ? 'Sally – Identität' : 'Sally – Identity'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Diese Angaben erscheinen im Absender-Feld und in der E-Mail-Signatur aller von Sally versendeten Nachrichten.'
              : "These details appear in the sender field and email signature of every message Sally sends."}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sally-name">{lang === 'de' ? 'Anzeigename' : 'Display name'}</Label>
              <Input
                id="sally-name"
                value={settings.sally_from_name}
                onChange={e => set('sally_from_name', e.target.value)}
                placeholder="Sally"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sally-email">{lang === 'de' ? 'Absender-E-Mail-Adresse' : 'From email address'}</Label>
              <Input
                id="sally-email"
                type="email"
                value={settings.sally_from_email}
                onChange={e => set('sally_from_email', e.target.value)}
                placeholder="sally@example.com"
              />
              <p className="text-xs text-muted-foreground">
                {lang === 'de'
                  ? 'Empfänger können direkt an diese Adresse antworten.'
                  : 'Recipients can reply directly to this address.'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sally-escalation-email">{lang === 'de' ? 'Eskalations-E-Mail (Kundenservice)' : 'Escalation email (customer service)'}</Label>
              <Input
                id="sally-escalation-email"
                type="email"
                value={settings.sally_escalation_email}
                onChange={e => set('sally_escalation_email', e.target.value)}
                placeholder="info@i-roc.de"
              />
              <p className="text-xs text-muted-foreground">
                {lang === 'de'
                  ? 'Anfragen, die Sally nicht beantworten kann, werden an diese Adresse weitergeleitet.'
                  : 'Inquiries Sally cannot answer are forwarded to this address.'}
              </p>
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <p className="font-medium mb-1">{lang === 'de' ? 'Signatur-Vorschau:' : 'Signature preview:'}</p>
            <pre className="text-muted-foreground font-sans text-xs leading-relaxed whitespace-pre-wrap">
              {[
                settings.sally_from_name || 'Sally',
                'Sales Manager | iROC GmbH',
                settings.sally_from_email,
              ].filter(Boolean).join('\n')}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* ── Email Language ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4" />
            {lang === 'de' ? 'E-Mail-Sprache' : 'Email Language'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Wählen Sie die Sprache für automatisch generierte E-Mails. Antworten werden immer in der Sprache und Form beantwortet, in der sie eingegangen sind.'
              : 'Choose the language for automatically generated emails. Replies are always answered in the same language and tone as received.'}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{lang === 'de' ? 'Erstkontakt-E-Mails' : 'First contact emails'}</Label>
              <Select
                value={settings.sally_lang_first_contact}
                onValueChange={v => set('sally_lang_first_contact', v as LangOption)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANG_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      {lang === 'de' ? o.de : o.en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{lang === 'de' ? 'Follow-up & Erinnerungen' : 'Follow-ups & reminders'}</Label>
              <Select
                value={settings.sally_lang_followup}
                onValueChange={v => set('sally_lang_followup', v as LangOption)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANG_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      {lang === 'de' ? o.de : o.en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-blue-50 rounded-lg p-3">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-500" />
            <span>
              {lang === 'de'
                ? 'Eingehende Antworten werden per KI analysiert. Sally antwortet automatisch in der gleichen Sprache und im gleichen Stil (formell/informell) wie die empfangene Nachricht.'
                : 'Inbound replies are analysed by AI. Sally automatically responds in the same language and tone (formal/informal) as the received message.'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Bulk Discount ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="w-4 h-4" />
            {lang === 'de' ? '6-Monats-Aktionsrabatt' : '6-Month Bulk Promotion Discount'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Dieser Rabatt wird in den automatisch generierten Promo-E-Mails an zertifizierte Ärzte verwendet, die im Durchschnitt weniger als 5 Artikel pro Bestellung kaufen.'
              : 'This discount is used in automatically generated promo emails sent to certified doctors who order fewer than 5 items on average.'}
          </p>
          <div className="flex items-center gap-3 max-w-xs">
            <div className="flex-1 space-y-1">
              <Label htmlFor="discount-pct">{lang === 'de' ? 'Rabatt (%)' : 'Discount (%)'}</Label>
              <Input
                id="discount-pct"
                type="number" min="1" max="100" step="1"
                value={settings.sally_bulk_discount_pct}
                onChange={e => set('sally_bulk_discount_pct', e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── IMAP Inbox (Reply polling) ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wifi className="w-4 h-4" />
            {lang === 'de' ? 'Posteingang (Antworten empfangen)' : 'Inbox (Receive replies)'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Sally kann den konfigurierten Posteingang per IMAP überwachen und eingehende Antworten per KI beantworten (Entwurf zur Genehmigung). Für Microsoft 365 aktivieren Sie SMTP-AUTH und erstellen Sie ein App-Passwort.'
              : 'Sally can monitor the configured inbox via IMAP and draft AI replies to incoming messages for your approval. For Microsoft 365, enable SMTP AUTH and create an App Password.'}
          </p>

          {/* Enable toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={settings.sally_imap_enabled === 'true'}
              onClick={() => set('sally_imap_enabled', settings.sally_imap_enabled === 'true' ? 'false' : 'true')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 ${
                settings.sally_imap_enabled === 'true' ? 'bg-primary' : 'bg-input'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
                settings.sally_imap_enabled === 'true' ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
            <span className="text-sm font-medium">
              {settings.sally_imap_enabled === 'true'
                ? (lang === 'de' ? 'IMAP-Polling aktiv' : 'IMAP polling enabled')
                : (lang === 'de' ? 'IMAP-Polling deaktiviert' : 'IMAP polling disabled')}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="imap-host">{lang === 'de' ? 'IMAP-Host' : 'IMAP host'}</Label>
              <Input
                id="imap-host"
                value={settings.sally_imap_host}
                onChange={e => set('sally_imap_host', e.target.value)}
                placeholder="outlook.office365.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imap-port">{lang === 'de' ? 'Port' : 'Port'}</Label>
              <Input
                id="imap-port"
                type="number"
                value={settings.sally_imap_port}
                onChange={e => set('sally_imap_port', e.target.value)}
                placeholder="993"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imap-user">{lang === 'de' ? 'Benutzername / E-Mail' : 'Username / email'}</Label>
              <Input
                id="imap-user"
                type="email"
                value={settings.sally_imap_user}
                onChange={e => set('sally_imap_user', e.target.value)}
                placeholder="sally@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imap-pass">
                {lang === 'de' ? 'Passwort / App-Passwort' : 'Password / App password'}
                {hasOAuth && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    ({lang === 'de' ? 'optional bei OAuth2' : 'optional when using OAuth2'})
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="imap-pass"
                  type={showPass ? 'text' : 'password'}
                  value={settings.sally_imap_pass}
                  onChange={e => set('sally_imap_pass', e.target.value)}
                  placeholder="••••••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* OAuth2 / Modern Auth */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {lang === 'de' ? 'OAuth2 / Modern Auth (optional)' : 'OAuth2 / Modern Auth (optional)'}
              </span>
              {hasOAuth && (
                <span className="text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-medium">
                  {lang === 'de' ? 'Aktiv' : 'Active'}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {lang === 'de'
                ? 'Wenn alle drei Felder ausgefüllt sind, verwendet Sally OAuth2 statt des Passworts (empfohlen für Microsoft 365 Tenants, die Basic Auth deaktiviert haben).'
                : 'When all three fields are filled, Sally uses OAuth2 instead of the password — recommended for Microsoft 365 tenants that have disabled Basic Auth.'}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="imap-oauth-client-id">{lang === 'de' ? 'Client-ID (App-ID)' : 'Client ID (App ID)'}</Label>
                <Input
                  id="imap-oauth-client-id"
                  value={settings.sally_imap_oauth_client_id}
                  onChange={e => set('sally_imap_oauth_client_id', e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imap-oauth-tenant-id">{lang === 'de' ? 'Tenant-ID (Verzeichnis-ID)' : 'Tenant ID (Directory ID)'}</Label>
                <Input
                  id="imap-oauth-tenant-id"
                  value={settings.sally_imap_oauth_tenant_id}
                  onChange={e => set('sally_imap_oauth_tenant_id', e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="imap-oauth-secret">{lang === 'de' ? 'Client-Secret' : 'Client secret'}</Label>
                <div className="relative">
                  <Input
                    id="imap-oauth-secret"
                    type={showOAuthSecret ? 'text' : 'password'}
                    value={settings.sally_imap_oauth_client_secret}
                    onChange={e => set('sally_imap_oauth_client_secret', e.target.value)}
                    placeholder="••••••••••••"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOAuthSecret(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showOAuthSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestImap}
              disabled={
                testingImap ||
                !settings.sally_imap_host ||
                !settings.sally_imap_user ||
                (!settings.sally_imap_pass && !hasOAuth)
              }
              className="gap-2"
            >
              {testingImap
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Wifi className="w-3.5 h-3.5" />}
              {lang === 'de' ? 'Verbindung testen' : 'Test connection'}
            </Button>
            {imapTestResult && (
              <span className={`flex items-center gap-1.5 text-sm ${imapTestResult.ok ? 'text-green-600' : 'text-destructive'}`}>
                {imapTestResult.ok
                  ? <CheckCircle className="w-4 h-4" />
                  : <WifiOff className="w-4 h-4" />}
                {imapTestResult.message}
              </span>
            )}
          </div>

          <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-800 space-y-1">
            <p className="font-semibold">{lang === 'de' ? 'Microsoft 365 Setup:' : 'Microsoft 365 setup:'}</p>
            <ol className="list-decimal ml-4 space-y-0.5">
              <li>{lang === 'de' ? 'Aktivieren Sie IMAP in den M365-Postfacheinstellungen.' : 'Enable IMAP in the M365 mailbox settings.'}</li>
              <li>
                {lang === 'de'
                  ? 'Basic Auth (App-Passwort): SMTP-AUTH aktivieren und ein App-Passwort erstellen.'
                  : 'Basic Auth (App Password): Enable SMTP AUTH and create an App Password.'}
              </li>
              <li>
                {lang === 'de'
                  ? 'Modern Auth (OAuth2): App in Azure AD registrieren, IMAP.AccessAsUser.All-Berechtigung erteilen, Client-ID / Tenant-ID / Secret oben eintragen.'
                  : 'Modern Auth (OAuth2): Register an app in Azure AD, grant IMAP.AccessAsUser.All permission, then enter Client ID / Tenant ID / Secret above.'}
              </li>
              <li>{lang === 'de' ? 'Verwenden Sie outlook.office365.com:993 als Host.' : 'Use outlook.office365.com:993 as the host.'}</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* ── Learned lessons ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="w-4 h-4" />
            {lang === 'de' ? 'Gelernte Lektionen' : 'Learned Lessons'}
            {lessons.length > 0 && (
              <span className="text-xs font-normal bg-muted rounded-full px-2 py-0.5">{lessons.length}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Wenn Sie einen E-Mail-Entwurf von Sally vor dem Senden korrigieren, lernt Sally daraus. Diese Regeln fließen in alle zukünftigen Entwürfe ein. Löschen Sie Lektionen, die nicht mehr gelten sollen.'
              : "When you correct one of Sally's email drafts before sending, Sally learns from it. These rules are applied to all future drafts. Delete lessons that should no longer apply."}
          </p>
          {lessons.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {lang === 'de' ? 'Noch keine Lektionen gelernt.' : 'No lessons learned yet.'}
            </p>
          ) : (
            <div className="divide-y border rounded-lg">
              {lessons.map(l => (
                <div key={l.id} className="px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => setExpandedLesson(expandedLesson === l.id ? null : l.id)}
                        className="text-left text-sm hover:text-primary transition-colors"
                      >
                        {l.lesson}
                      </button>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {l.context} · {new Date(l.created_at).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB')}
                      </p>
                    </div>
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleDeleteLesson(l.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {expandedLesson === l.id && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="bg-red-50 rounded p-2">
                        <p className="text-xs font-medium text-red-700 mb-1">{lang === 'de' ? 'Original' : 'Original'}</p>
                        <pre className="text-xs whitespace-pre-wrap font-sans text-muted-foreground max-h-40 overflow-y-auto">{l.original_text}</pre>
                      </div>
                      <div className="bg-green-50 rounded p-2">
                        <p className="text-xs font-medium text-green-700 mb-1">{lang === 'de' ? 'Korrigiert' : 'Corrected'}</p>
                        <pre className="text-xs whitespace-pre-wrap font-sans text-muted-foreground max-h-40 overflow-y-auto">{l.corrected_text}</pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Manual cron trigger ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PlayCircle className="w-4 h-4" />
            {lang === 'de' ? 'Automatisierung manuell auslösen' : 'Trigger Automation Manually'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Sally prüft täglich alle Leads und Ärzte automatisch. Sie können die Prüfung auch manuell auslösen.'
              : 'Sally checks all leads and doctors automatically every day. You can also trigger the check manually.'}
          </p>
          <Button onClick={handleRunCron} disabled={runningCron} variant="outline" className="gap-2">
            {runningCron
              ? <><Loader2 className="w-4 h-4 animate-spin" />{lang === 'de' ? 'Läuft…' : 'Running…'}</>
              : <><PlayCircle className="w-4 h-4" />{lang === 'de' ? 'Jetzt ausführen' : 'Run Now'}</>}
          </Button>
          {cronResult && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
              <p className="font-medium">{lang === 'de' ? 'Ergebnisse:' : 'Results:'}</p>
              {(['leads', 'doctors', 'promo', 'orders'] as const).filter(k => cronResult[k] !== undefined).map(k => (
                <div key={k} className="flex items-center gap-2">
                  {cronResult[k] === 'ok'
                    ? <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                    : <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
                  <span className="capitalize text-muted-foreground">{k}:</span>
                  <span className={cronResult[k] === 'ok' ? 'text-green-700' : 'text-destructive'}>{cronResult[k]}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Schedule info ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="w-4 h-4" />
            {lang === 'de' ? 'Automatischer Zeitplan' : 'Automatic Schedule'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-sm space-y-2 text-muted-foreground">
            <li className="flex gap-2">
              <span className="font-medium text-foreground min-w-[200px]">{lang === 'de' ? '4-Wochen Follow-up:' : '4-Week Follow-up:'}</span>
              {lang === 'de' ? 'Einmalig, 4 Wochen nach Erstkontakt (wenn nicht registriert)' : 'Once, 4 weeks after first contact (if not registered)'}
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-foreground min-w-[200px]">{lang === 'de' ? '2-Monats-Erinnerung:' : '2-Month Reminder:'}</span>
              {lang === 'de' ? 'Alle 2 Monate (bis registriert oder abgebrochen)' : 'Every 2 months (until registered or cancelled)'}
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-foreground min-w-[200px]">{lang === 'de' ? 'Arzt Check-in:' : 'Doctor Check-in:'}</span>
              {lang === 'de' ? 'Alle 2 Monate ohne Bestellung' : 'Every 2 months without an order'}
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-foreground min-w-[200px]">{lang === 'de' ? '6-Monats-Promo:' : '6-Month Promo:'}</span>
              {lang === 'de'
                ? `Alle 6 Monate für Ärzte mit Ø < 5 Artikel/Bestellung (${settings.sally_bulk_discount_pct}% Rabatt)`
                : `Every 6 months for doctors with avg < 5 items/order (${settings.sally_bulk_discount_pct}% discount)`}
            </li>
            <li className="flex gap-2">
              <span className="font-medium text-foreground min-w-[200px]">{lang === 'de' ? 'Posteingang-Polling:' : 'Inbox polling:'}</span>
              {lang === 'de' ? 'Alle 6 Stunden (wenn aktiviert)' : 'Every 6 hours (when enabled)'}
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
