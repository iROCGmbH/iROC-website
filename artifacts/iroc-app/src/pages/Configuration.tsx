import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Settings, Globe, ExternalLink, Save, CheckCircle, AlertCircle, Loader2,
  LayoutDashboard, Mail, ArrowRight, KeyRound, Phone, Eye, EyeOff,
} from 'lucide-react';
import { adminPatch, adminPost } from '@/lib/admin-fetch';
import { invalidateSiteUrlsCache } from '@/hooks/use-site-urls';
import { NavTreeEditor } from '@/components/NavTreeEditor';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetIrocMeQueryKey,
  useGetIrocMe,
  type ChangeIrocPasswordResponse,
  type UpdateIrocSessionResponse,
} from '@workspace/api-client-react';

const IROC_DEV_URL = `${window.location.origin}/iroc-website`;
const SPIRECUT_DEV_URL = `${window.location.origin}/spirecut-patient`;

type ConfigKey =
  | 'config_iroc_website_url'
  | 'config_spirecut_website_url'
  | 'invoice_contact_email'
  | 'invoice_contact_phone';

interface SiteConfig {
  label: string;
  key: ConfigKey;
  placeholder: string;
  devDefault: string;
  description: string;
}

const SITES: SiteConfig[] = [
  {
    label: 'iROC Website URL',
    key: 'config_iroc_website_url',
    placeholder: 'https://i-roc.de',
    devDefault: IROC_DEV_URL,
    description:
      'Die öffentliche URL der iROC GmbH Website (z. B. nach dem Deployment). Wird als Ziel des "Website öffnen"-Buttons im Sidebar verwendet.',
  },
  {
    label: 'Spirecut Website URL',
    key: 'config_spirecut_website_url',
    placeholder: 'https://spirecut.de',
    devDefault: SPIRECUT_DEV_URL,
    description:
      'Die öffentliche URL der Spirecut Patienten-Website. Wird als Ziel des "Website öffnen"-Buttons im Sidebar verwendet.',
  },
];

const CONTACT_DEFAULTS: Record<'invoice_contact_email' | 'invoice_contact_phone', string> = {
  invoice_contact_email: 'info@i-roc.de',
  invoice_contact_phone: '+49 (0)89 600 60 805',
};

export default function Configuration() {
  const { token, username: authUsername, setAuth } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Admin profile ─────────────────────────────────────────────────────────────
  const { data: me } = useGetIrocMe({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: getGetIrocMeQueryKey(),
    },
  });
  const [usernameEdit, setUsernameEdit] = useState(authUsername ?? '');
  const [usernameDirty, setUsernameDirty] = useState(false);
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [usernameResult, setUsernameResult] = useState<'ok' | 'error'>();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState({
    current: false,
    next: false,
    confirmation: false,
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordResult, setPasswordResult] = useState<'ok' | 'error'>();

  useEffect(() => {
    if (!usernameDirty) {
      setUsernameEdit(me?.username ?? authUsername ?? '');
    }
  }, [authUsername, me?.username, usernameDirty]);

  // ── Website URLs ─────────────────────────────────────────────────────────────
  const [values, setValues] = useState<Record<ConfigKey, string>>({
    config_iroc_website_url: '',
    config_spirecut_website_url: '',
    ...CONTACT_DEFAULTS,
  });
  const [edits, setEdits] = useState<Record<ConfigKey, string>>({
    config_iroc_website_url: '',
    config_spirecut_website_url: '',
    ...CONTACT_DEFAULTS,
  });
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, 'ok' | 'error'>>({});

  // ── Load ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch(`/api/website-settings`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, string>) => {
        setValues({
          config_iroc_website_url: data['config_iroc_website_url'] || '',
          config_spirecut_website_url: data['config_spirecut_website_url'] || '',
          invoice_contact_email: data['invoice_contact_email'] ?? CONTACT_DEFAULTS.invoice_contact_email,
          invoice_contact_phone: data['invoice_contact_phone'] ?? CONTACT_DEFAULTS.invoice_contact_phone,
        });
        setEdits({
          config_iroc_website_url: data['config_iroc_website_url'] || '',
          config_spirecut_website_url: data['config_spirecut_website_url'] || '',
          invoice_contact_email: data['invoice_contact_email'] ?? CONTACT_DEFAULTS.invoice_contact_email,
          invoice_contact_phone: data['invoice_contact_phone'] ?? CONTACT_DEFAULTS.invoice_contact_phone,
        });
      })
      .catch(() => {});
  }, [token]);

  // ── Save website URL ──────────────────────────────────────────────────────────
  const handleSave = async (key: ConfigKey) => {
    if (!token) return;
    setSaving((s) => ({ ...s, [key]: true }));
    setResults((r) => { const n = { ...r }; delete n[key]; return n; });
    try {
      await adminPost(`/api/admin/website-settings`, token, { key, value: edits[key].trim() });
      setValues((v) => ({ ...v, [key]: edits[key].trim() }));
      setResults((r) => ({ ...r, [key]: 'ok' }));
      invalidateSiteUrlsCache();
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      setResults((r) => ({ ...r, [key]: 'error' }));
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Error saving' });
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  const handleUsernameSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;

    const nextUsername = usernameEdit.trim();
    if (!nextUsername) {
      setUsernameResult('error');
      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'Benutzername darf nicht leer sein' : 'Username cannot be empty',
      });
      return;
    }

    setUsernameSaving(true);
    setUsernameResult(undefined);
    try {
      const updated = await adminPatch<UpdateIrocSessionResponse>(
        '/api/iroc/me',
        token,
        { username: nextUsername },
      );
      setAuth(updated.token, updated.username);
      queryClient.setQueryData(getGetIrocMeQueryKey(), {
        authenticated: updated.authenticated,
        username: updated.username,
      });
      setUsernameEdit(updated.username);
      setUsernameDirty(false);
      setUsernameResult('ok');
      toast({ title: lang === 'de' ? 'Benutzername gespeichert' : 'Username saved' });
    } catch (error) {
      setUsernameResult('error');
      const message = error instanceof Error ? error.message : '';
      const isConflict = message.toLowerCase().includes('already in use');
      toast({
        variant: 'destructive',
        title: isConflict
          ? (lang === 'de' ? 'Benutzername bereits vergeben' : 'Username is already in use')
          : (lang === 'de' ? 'Fehler beim Speichern' : 'Error saving'),
      });
    } finally {
      setUsernameSaving(false);
    }
  };

  const handlePasswordSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;

    if (newPassword !== passwordConfirmation) {
      setPasswordResult('error');
      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'Passwörter stimmen nicht überein' : 'Passwords do not match',
      });
      return;
    }

    setPasswordSaving(true);
    setPasswordResult(undefined);
    try {
      await adminPatch<ChangeIrocPasswordResponse>(
        '/api/iroc/password',
        token,
        { currentPassword, newPassword },
      );
      setCurrentPassword('');
      setNewPassword('');
      setPasswordConfirmation('');
      setPasswordResult('ok');
      toast({ title: lang === 'de' ? 'Passwort gespeichert' : 'Password saved' });
    } catch (error) {
      setPasswordResult('error');
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      const title = message.includes('current password')
        ? (lang === 'de' ? 'Aktuelles Passwort ist falsch' : 'Current password is incorrect')
        : (lang === 'de' ? 'Fehler beim Speichern' : 'Error saving');
      toast({ variant: 'destructive', title });
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Settings className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">
            {lang === 'de' ? 'Konfiguration' : 'Configuration'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Website-URLs und Navigationsbaum konfigurieren'
              : 'Configure website URLs and navigation tree'}
          </p>
        </div>
      </div>

      {/* ── Admin profile ──────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Settings className="w-5 h-5 text-primary" />
          {lang === 'de' ? 'Administratorprofil' : 'Administrator Profile'}
        </h2>
        <div className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
          <div>
            <p className="font-medium">{lang === 'de' ? 'Benutzername' : 'Username'}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {lang === 'de'
                ? 'Dieser Name wird für die Anmeldung verwendet und im Seitenmenü angezeigt.'
                : 'This name is used for login and shown in the sidebar.'}
            </p>
          </div>
          <form onSubmit={handleUsernameSave} className="flex gap-2">
            <Input
              id="admin-username"
              value={usernameEdit}
              onChange={(event) => {
                setUsernameEdit(event.target.value);
                setUsernameDirty(true);
                setUsernameResult(undefined);
              }}
              autoComplete="username"
              maxLength={100}
              required
              className="flex-1"
            />
            <Button type="submit" disabled={usernameSaving} size="sm" className="gap-2 shrink-0">
              {usernameSaving
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Save className="w-4 h-4" />}
              {lang === 'de' ? 'Speichern' : 'Save'}
            </Button>
          </form>
          {usernameResult === 'ok' && (
            <p className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" />
              {lang === 'de' ? 'Benutzername gespeichert' : 'Username saved'}
            </p>
          )}
          {usernameResult === 'error' && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="w-4 h-4" />
              {lang === 'de' ? 'Benutzername konnte nicht gespeichert werden' : 'Username could not be saved'}
            </p>
          )}
        </div>
      </section>

      {/* ── Password ───────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" />
          {lang === 'de' ? 'Passwort ändern' : 'Change Password'}
        </h2>
        <div className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
          <div>
            <p className="font-medium">{lang === 'de' ? 'Passwort ändern' : 'Change password'}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {lang === 'de'
                ? 'Geben Sie Ihr aktuelles Passwort ein und wählen Sie ein neues Passwort mit mindestens 8 Zeichen.'
                : 'Enter your current password and choose a new password with at least 8 characters.'}
            </p>
          </div>
          <form onSubmit={handlePasswordSave} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                {
                  key: 'current' as const,
                  placeholder: lang === 'de' ? 'Aktuelles Passwort' : 'Current password',
                  value: currentPassword,
                  onChange: setCurrentPassword,
                  autoComplete: 'current-password',
                },
                {
                  key: 'next' as const,
                  placeholder: lang === 'de' ? 'Neues Passwort' : 'New password',
                  value: newPassword,
                  onChange: setNewPassword,
                  autoComplete: 'new-password',
                },
                {
                  key: 'confirmation' as const,
                  placeholder: lang === 'de' ? 'Neues Passwort bestätigen' : 'Confirm new password',
                  value: passwordConfirmation,
                  onChange: setPasswordConfirmation,
                  autoComplete: 'new-password',
                },
              ]).map((field) => (
                <div key={field.key} className="relative">
                  <Input
                    type={visiblePasswords[field.key] ? 'text' : 'password'}
                    placeholder={field.placeholder}
                    value={field.value}
                    onChange={(event) => {
                      field.onChange(event.target.value);
                      setPasswordResult(undefined);
                    }}
                    autoComplete={field.autoComplete}
                    minLength={field.key === 'current' ? undefined : 8}
                    required
                    disabled={passwordSaving}
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setVisiblePasswords((current) => ({
                      ...current,
                      [field.key]: !current[field.key],
                    }))}
                    aria-label={visiblePasswords[field.key]
                      ? (lang === 'de' ? `${field.placeholder} ausblenden` : `Hide ${field.placeholder.toLowerCase()}`)
                      : (lang === 'de' ? `${field.placeholder} anzeigen` : `Show ${field.placeholder.toLowerCase()}`)}
                    aria-pressed={visiblePasswords[field.key]}
                    className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {visiblePasswords[field.key]
                      ? <EyeOff className="h-4 w-4" />
                      : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={passwordSaving} size="sm" className="gap-2">
                {passwordSaving
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <KeyRound className="w-4 h-4" />}
                {lang === 'de' ? 'Passwort speichern' : 'Save password'}
              </Button>
            </div>
          </form>
          {passwordResult === 'ok' && (
            <p className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" />
              {lang === 'de' ? 'Passwort gespeichert' : 'Password saved'}
            </p>
          )}
          {passwordResult === 'error' && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="w-4 h-4" />
              {lang === 'de' ? 'Passwort konnte nicht gespeichert werden' : 'Password could not be saved'}
            </p>
          )}
        </div>
      </section>

      {/* ── Email config callout ───────────────────────────────────────────────── */}
      <Link href="/email-config">
        <div className="flex items-center gap-4 bg-primary/5 border border-primary/20 rounded-xl p-4 hover:bg-primary/10 transition-colors cursor-pointer group">
          <div className="p-2 bg-primary/10 rounded-lg shrink-0">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">
              {lang === 'de' ? 'E-Mail-Konfiguration' : 'Email Configuration'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {lang === 'de'
                ? 'SMTP-Server, Empfänger, Sally-E-Mails und Spirecut-Adressen an einem Ort verwalten.'
                : 'Manage SMTP server, recipients, Sally emails and Spirecut addresses in one place.'}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-primary shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </Link>

      {/* ── Invoice PDF contacts ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Phone className="w-5 h-5 text-primary" />
          {lang === 'de' ? 'Rechnungs-PDF-Kontakte' : 'Invoice PDF Contacts'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {lang === 'de'
            ? 'Diese Kontaktdaten erscheinen in der zweizeiligen Kopfzeile aller Rechnungs-PDFs.'
            : 'These contact details appear in the two-row header of all invoice PDFs.'}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              key: 'invoice_contact_email' as const,
              label: lang === 'de' ? 'Rücksendeanfrage an — E-Mail' : 'Return request email',
              placeholder: 'info@i-roc.de',
              type: 'email',
            },
            {
              key: 'invoice_contact_phone' as const,
              label: lang === 'de' ? 'Rückfragen an — Telefon' : 'Customer service phone',
              placeholder: '+49 (0)89 600 60 805',
              type: 'tel',
            },
          ].map((field) => (
            <div key={field.key} className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
              <div>
                <p className="font-medium">{field.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {lang === 'de' ? 'Leer lassen, um den Standardwert zu verwenden.' : 'Leave blank to use the default value.'}
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  type={field.type}
                  value={edits[field.key]}
                  onChange={(event) => setEdits((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={field.placeholder}
                  className="min-w-0 flex-1"
                />
                <Button
                  onClick={() => handleSave(field.key)}
                  disabled={saving[field.key]}
                  size="sm"
                  className="gap-2 shrink-0"
                >
                  {saving[field.key]
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Save className="w-4 h-4" />}
                  {lang === 'de' ? 'Speichern' : 'Save'}
                </Button>
              </div>
              {results[field.key] === 'ok' && (
                <p className="flex items-center gap-1.5 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  {lang === 'de' ? 'Gespeichert' : 'Saved'}
                </p>
              )}
              {results[field.key] === 'error' && (
                <p className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4" />
                  {lang === 'de' ? 'Fehler beim Speichern' : 'Error saving'}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Website URLs ──────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          {lang === 'de' ? 'Website-URLs' : 'Website URLs'}
        </h2>
        <div className="grid gap-4">
          {SITES.map((site) => {
            const effectiveUrl = values[site.key] || site.devDefault;
            return (
              <div key={site.key} className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
                <div>
                  <p className="font-medium">{site.label}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{site.description}</p>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="url"
                    value={edits[site.key]}
                    onChange={(e) => setEdits((v) => ({ ...v, [site.key]: e.target.value }))}
                    placeholder={site.placeholder}
                    className="flex-1"
                  />
                  <Button
                    onClick={() => handleSave(site.key)}
                    disabled={saving[site.key]}
                    size="sm"
                    className="gap-2 shrink-0"
                  >
                    {saving[site.key]
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Save className="w-4 h-4" />}
                    {lang === 'de' ? 'Speichern' : 'Save'}
                  </Button>
                </div>
                {results[site.key] === 'ok' && (
                  <p className="flex items-center gap-1.5 text-sm text-green-600">
                    <CheckCircle className="w-4 h-4" />
                    {lang === 'de' ? 'Gespeichert' : 'Saved'}
                  </p>
                )}
                {results[site.key] === 'error' && (
                  <p className="flex items-center gap-1.5 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    {lang === 'de' ? 'Fehler beim Speichern' : 'Error saving'}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {lang === 'de' ? 'Aktuell:' : 'Current:'}
                  </span>
                  <a
                    href={effectiveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {effectiveUrl}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {!values[site.key] && (
                    <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                      Fallback (Dev)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Nav Tree ──────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          {lang === 'de' ? 'Navigationsbaum' : 'Navigation Tree'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {lang === 'de'
            ? 'Gruppen des Sidebar-Menüs anpassen: umbenennen, umsortieren, Routen verschieben oder ausblenden.'
            : 'Customise the sidebar menu groups: rename, reorder, move routes between groups, or hide them.'}
        </p>
        <NavTreeEditor />
      </section>
    </div>
  );
}
