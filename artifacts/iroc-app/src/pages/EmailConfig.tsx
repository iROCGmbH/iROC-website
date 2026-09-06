import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Mail, Save, Loader2, CheckCircle, AlertCircle,
  Eye, EyeOff, Send, Server, Globe, Stethoscope, Bot, ShieldAlert,
  Trash2, LockKeyhole, ShieldCheck, RefreshCw,
} from 'lucide-react';
import { adminDelete, adminGet, adminPost, adminPut } from '@/lib/admin-fetch';
import { MICROSOFT_MAILBOX_ROLES, type MicrosoftMailboxPurpose } from '@/lib/microsoft-mailbox-roles';

import { EmailSignatureDesigner } from '@/components/email-signatures/EmailSignatureDesigner';

// ── Types ─────────────────────────────────────────────────────────────────────

type SmtpKey = 'smtp_host' | 'smtp_port' | 'smtp_user' | 'smtp_pass' | 'smtp_from';

interface EmailSetting {
  key: string;
  label: string;
  email: string;
  defaultEmail: string;
}

interface SallySettings {
  sally_from_name: string;
  sally_from_email: string;
  sally_escalation_email: string;
  [key: string]: string; // other Sally keys we must preserve on save
}

type MailboxPurpose = MicrosoftMailboxPurpose;
type MailboxAccess = 'read' | 'read_write';
interface MicrosoftMailbox {
  id: number;
  email: string;
  display_name: string | null;
  purpose: MailboxPurpose;
  access_level: MailboxAccess;
  enabled: boolean;
  authorization_status: 'awaiting_authorization' | 'connected' | 'error' | 'disabled';
  authorization_error?: string | null;
  last_authorized_at?: string | null;
}

type EmailDeliveryProvider = 'smtp' | 'microsoft365';
interface EmailDeliverySetting {
  purpose: MicrosoftMailboxPurpose;
  provider: EmailDeliveryProvider;
  microsoftMailbox: {
    id: number;
    email: string;
    displayName: string | null;
    authorizationStatus: string;
    accessLevel: MailboxAccess;
    enabled: boolean;
  } | null;
}

const EMPTY_MAILBOX = {
  email: '', display_name: '', purpose: 'general' as MailboxPurpose,
  access_level: 'read' as MailboxAccess, enabled: true,
};

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3 pb-1 border-b">
        <div className="p-1.5 bg-primary/10 rounded-lg shrink-0">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="font-semibold text-base">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatusBadge({ status }: { status: 'ok' | 'error' | null }) {
  if (!status) return null;
  return status === 'ok'
    ? <span className="flex items-center gap-1.5 text-sm text-green-600"><CheckCircle className="w-4 h-4" />Saved</span>
    : <span className="flex items-center gap-1.5 text-sm text-destructive"><AlertCircle className="w-4 h-4" />Error</span>;
}

// ── Section 1: SMTP ────────────────────────────────────────────────────────────

const SMTP_FIELDS: {
  key: SmtpKey;
  labelDe: string;
  labelEn: string;
  placeholder: string;
  type: string;
  descDe: string;
  descEn: string;
}[] = [
  { key: 'smtp_host',  labelDe: 'SMTP-Server (Host)', labelEn: 'SMTP Host',            placeholder: 'mail.i-roc.de',           type: 'text',     descDe: 'Hostname des ausgehenden Mailservers.',                          descEn: 'Outgoing mail server hostname.' },
  { key: 'smtp_port',  labelDe: 'SMTP-Port',          labelEn: 'SMTP Port',            placeholder: '587',                     type: 'number',   descDe: '587 für STARTTLS, 465 für SSL/TLS.',                            descEn: '587 for STARTTLS, 465 for SSL/TLS.' },
  { key: 'smtp_user',  labelDe: 'Benutzername',       labelEn: 'Username',             placeholder: 'info@i-roc.de',           type: 'text',     descDe: 'Anmeldekennung des Postfachs (meist die E-Mail-Adresse).',      descEn: 'Mailbox login (usually the email address).' },
  { key: 'smtp_pass',  labelDe: 'Passwort',           labelEn: 'Password',             placeholder: '',                        type: 'password', descDe: 'Leer lassen, um gespeichertes Passwort beizubehalten.',         descEn: 'Leave blank to keep the existing password.' },
  { key: 'smtp_from',  labelDe: 'Absenderadresse',    labelEn: 'Sender Address (From)', placeholder: 'iROC GmbH <info@i-roc.de>', type: 'text',   descDe: 'Absender-Adresse im E-Mail-Client des Empfängers.',             descEn: 'Sender shown in the recipient\'s email client.' },
];

function SmtpSection() {
  const { token } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const { lang } = useLanguage();
  const { toast } = useToast();

  const [values, setValues] = useState<Record<SmtpKey, string>>({
    smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from: '',
  });
  const [passIsSet, setPassIsSet] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<'ok' | 'error' | null>(null);

  useEffect(() => {
    if (!token) return;
    const requestToken = token;
    fetch('/api/website-settings').then(r => r.ok ? r.json() : {}).then((d: Record<string, string>) => {
      if (tokenRef.current !== requestToken) return;
      setValues({ smtp_host: d.smtp_host || '', smtp_port: d.smtp_port || '587', smtp_user: d.smtp_user || '', smtp_pass: '', smtp_from: d.smtp_from || '' });
      setPassIsSet(!!d.smtp_pass);
    }).catch(() => {});
  }, [token]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true); setResult(null);
    try {
      const keys: SmtpKey[] = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_from'];
      if (values.smtp_pass.trim()) keys.push('smtp_pass');
      await Promise.all(keys.map(k => adminPost('/api/admin/website-settings', token, { key: k, value: values[k].trim() })));
      setResult('ok');
      if (values.smtp_pass.trim()) { setPassIsSet(true); setValues(v => ({ ...v, smtp_pass: '' })); }
      toast({ title: lang === 'de' ? 'SMTP gespeichert' : 'SMTP saved' });
    } catch {
      setResult('error');
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' });
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-card border rounded-xl p-5 shadow-sm space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {SMTP_FIELDS.map(field => (
          <div key={field.key} className={field.key === 'smtp_from' ? 'sm:col-span-2' : ''}>
            <Label className="mb-1 block">{lang === 'de' ? field.labelDe : field.labelEn}</Label>
            <div className="relative">
              <Input
                type={field.type === 'password' ? (showPass ? 'text' : 'password') : field.type}
                value={values[field.key]}
                onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                placeholder={field.key === 'smtp_pass' && passIsSet
                  ? (lang === 'de' ? '••••••••  (gespeichert)' : '••••••••  (saved)')
                  : field.placeholder}
                className={field.type === 'password' ? 'pr-10' : ''}
              />
              {field.type === 'password' && (
                <button type="button" onClick={() => setShowPass(v => !v)}
                  aria-label={showPass
                    ? (lang === 'de' ? 'Passwort ausblenden' : 'Hide password')
                    : (lang === 'de' ? 'Passwort anzeigen' : 'Show password')}
                  aria-pressed={showPass}
                  className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{lang === 'de' ? field.descDe : field.descEn}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {lang === 'de' ? 'Speichern' : 'Save'}
        </Button>
        <StatusBadge status={result} />
      </div>
    </div>
  );
}

// ── Section 2: Notification Recipients ────────────────────────────────────────

function NotificationRecipientsSection() {
  const { token } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const { lang } = useLanguage();
  const { toast } = useToast();

  const [settings, setSettings] = useState<EmailSetting[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, 'ok' | 'error'>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    const requestToken = token;
    setLoading(true);
    adminGet<EmailSetting[]>('/api/admin/email-settings', requestToken)
      .then((data: EmailSetting[]) => {
        if (tokenRef.current !== requestToken) return;
        setSettings(data);
        const map: Record<string, string> = {};
        data.forEach(s => { map[s.key] = s.email; });
        setEdits(map);
      }).catch(() => {}).finally(() => {
        if (tokenRef.current === requestToken) setLoading(false);
      });
  }, [token]);

  const handleSave = async (key: string) => {
    if (!token) return;
    setSaving(s => ({ ...s, [key]: true }));
    setResults(r => { const n = { ...r }; delete n[key]; return n; });
    try {
      await adminPost('/api/admin/email-settings', token, { key, email: edits[key]?.trim() || '' });
      setSettings(prev => prev.map(s => s.key === key ? { ...s, email: edits[key]?.trim() || '' } : s));
      setResults(r => ({ ...r, [key]: 'ok' }));
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      setResults(r => ({ ...r, [key]: 'error' }));
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' });
    } finally { setSaving(s => ({ ...s, [key]: false })); }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="grid gap-3 max-w-2xl">
      {settings.map(s => (
        <div key={s.key} className="bg-card border rounded-xl p-4 shadow-sm space-y-2.5">
          <div>
            <p className="text-sm font-medium">{s.label}</p>
            <p className="text-xs text-muted-foreground">{lang === 'de' ? 'Standard:' : 'Default:'} {s.defaultEmail}</p>
          </div>
          <div className="flex gap-2">
            <Input type="email" value={edits[s.key] ?? ''} onChange={e => setEdits(v => ({ ...v, [s.key]: e.target.value }))}
              placeholder={s.defaultEmail} className="flex-1" />
            <Button size="sm" onClick={() => handleSave(s.key)} disabled={saving[s.key]} className="gap-1.5 shrink-0">
              {saving[s.key] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {lang === 'de' ? 'Speichern' : 'Save'}
            </Button>
          </div>
          <StatusBadge status={results[s.key] ?? null} />
        </div>
      ))}
    </div>
  );
}

// ── Section 3 & 4: Website Settings Emails ────────────────────────────────────

interface SimpleEmailField {
  key: string;
  labelDe: string;
  labelEn: string;
  descDe: string;
  descEn: string;
  placeholder: string;
}

const IROC_WS_EMAIL_FIELDS: SimpleEmailField[] = [
  { key: 'ws_contact_email',      labelDe: 'Kontaktformular-Empfänger', labelEn: 'Contact Form Recipient',  descDe: 'Empfänger für Nachrichten aus dem Website-Kontaktformular.', descEn: 'Recipient for website contact form messages.',     placeholder: 'info@i-roc.de' },
  { key: 'iroc_announcement_from', labelDe: 'Ankündigungs-Absender',    labelEn: 'Announcement Sender',     descDe: 'Absenderadresse für Ankündigungs-E-Mails an Ärzte.',         descEn: 'Sender address for doctor announcement emails.',   placeholder: 'iROC GmbH <info@i-roc.de>' },
  { key: 'datev_bookkeeper_email', labelDe: 'DATEV-Export-Empfänger',   labelEn: 'DATEV Export Recipient',  descDe: 'E-Mail-Adresse, an die DATEV-Exporte versendet werden.',     descEn: 'Address that receives DATEV export emails.',       placeholder: 'buchhaltung@i-roc.de' },
];

const SPIRECUT_EMAIL_FIELDS: SimpleEmailField[] = [
  { key: 'sp_contact_email_de',  labelDe: 'Spirecut-patient Kontakt (Deutsch)', labelEn: 'Spirecut-patient Contact (German)', descDe: 'Bearbeitet die Kontakt-E-Mail auf der deutschsprachigen Spirecut-patient Website.', descEn: 'Edits the contact email shown on the German Spirecut-patient website.', placeholder: 'info@spirecut.de' },
  { key: 'sp_contact_email_com', labelDe: 'Spirecut-patient Kontakt (International)', labelEn: 'Spirecut-patient Contact (International)', descDe: 'Bearbeitet die Kontakt-E-Mail auf der englischsprachigen Spirecut-patient Website.', descEn: 'Edits the contact email shown on the English Spirecut-patient website.', placeholder: 'info@spirecut.com' },
];

function WebsiteSettingsEmailSection({ fields }: { fields: SimpleEmailField[] }) {
  const { token } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const { lang } = useLanguage();
  const { toast } = useToast();

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, 'ok' | 'error'>>({});

  useEffect(() => {
    if (!token) return;
    const requestToken = token;
    fetch('/api/website-settings').then(r => r.ok ? r.json() : {})
      .then((d: Record<string, string>) => {
        if (tokenRef.current !== requestToken) return;
        const m: Record<string, string> = {};
        fields.forEach(f => { m[f.key] = d[f.key] || ''; });
        setValues(m);
      }).catch(() => {});
  }, [token, fields]);

  const handleSave = async (key: string) => {
    if (!token) return;
    setSaving(s => ({ ...s, [key]: true }));
    setResults(r => { const n = { ...r }; delete n[key]; return n; });
    try {
      await adminPost('/api/admin/website-settings', token, { key, value: (values[key] ?? '').trim() });
      setResults(r => ({ ...r, [key]: 'ok' }));
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      setResults(r => ({ ...r, [key]: 'error' }));
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' });
    } finally { setSaving(s => ({ ...s, [key]: false })); }
  };

  return (
    <div className="grid gap-3 max-w-2xl">
      {fields.map(f => (
        <div key={f.key} className="bg-card border rounded-xl p-4 shadow-sm space-y-2.5">
          <div>
            <p className="text-sm font-medium">{lang === 'de' ? f.labelDe : f.labelEn}</p>
            <p className="text-xs text-muted-foreground">{lang === 'de' ? f.descDe : f.descEn}</p>
          </div>
          <div className="flex gap-2">
            <Input type="email" value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder} className="flex-1" />
            <Button size="sm" onClick={() => handleSave(f.key)} disabled={saving[f.key]} className="gap-1.5 shrink-0">
              {saving[f.key] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {lang === 'de' ? 'Speichern' : 'Save'}
            </Button>
          </div>
          <StatusBadge status={results[f.key] ?? null} />
        </div>
      ))}
    </div>
  );
}

// ── Section 5: Sally AI Agent Emails ──────────────────────────────────────────

const SALLY_EMAIL_FIELDS: SimpleEmailField[] = [
  { key: 'sally_from_name',        labelDe: 'Absender-Name (Sally)',  labelEn: 'Sender Name (Sally)',       descDe: 'Der Anzeigename für alle ausgehenden Sally-E-Mails.',       descEn: 'Display name for all outgoing Sally emails.',      placeholder: 'Sally' },
  { key: 'sally_from_email',       labelDe: 'Absender-E-Mail',       labelEn: 'Sender Email',              descDe: 'Absenderadresse für Sally-Nachrichten (muss beim SMTP-Konto erlaubt sein).', descEn: 'From address for Sally messages (must be authorised on the SMTP account).', placeholder: 'sally@i-roc.de' },
  { key: 'sally_escalation_email', labelDe: 'Eskalations-Empfänger', labelEn: 'Escalation Recipient',     descDe: 'E-Mail-Adresse, die bei kritischen Fehlern oder Eskalationen benachrichtigt wird.', descEn: 'Email address notified on escalations or critical issues.', placeholder: 'info@i-roc.de' },
];

function SallyEmailSection() {
  const { token } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const { lang } = useLanguage();
  const { toast } = useToast();

  // We load ALL Sally settings so we can save them all back without losing non-email fields.
  const [allSettings, setAllSettings] = useState<SallySettings>({
    sally_from_name: 'Sally', sally_from_email: '', sally_escalation_email: 'info@i-roc.de',
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<'ok' | 'error' | null>(null);

  useEffect(() => {
    if (!token) return;
    const requestToken = token;
    adminGet<Record<string, string>>('/api/admin/sally/settings', requestToken)
      .then(s => {
        if (tokenRef.current === requestToken) setAllSettings(prev => ({ ...prev, ...s }) as SallySettings);
      })
      .catch(() => {});
  }, [token]);

  const update = (key: string, value: string) => {
    setAllSettings(prev => ({ ...prev, [key]: value }));
    setResult(null);
  };

  const handleSave = async () => {
    if (!token) return;
    setSaving(true); setResult(null);
    try {
      await adminPut('/api/admin/sally/settings', token, allSettings);
      setResult('ok');
      toast({ title: lang === 'de' ? 'Sally-E-Mail-Einstellungen gespeichert' : 'Sally email settings saved' });
    } catch {
      setResult('error');
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler' : 'Error' });
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-card border rounded-xl p-5 shadow-sm space-y-4 max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-2">
        {SALLY_EMAIL_FIELDS.map(f => (
          <div key={f.key} className={f.key === 'sally_escalation_email' ? 'sm:col-span-2' : ''}>
            <Label className="mb-1 block">{lang === 'de' ? f.labelDe : f.labelEn}</Label>
            <Input
              type={f.key === 'sally_from_name' ? 'text' : 'email'}
              value={(allSettings[f.key] as string) ?? ''}
              onChange={e => update(f.key, e.target.value)}
              placeholder={f.placeholder}
            />
            <p className="text-xs text-muted-foreground mt-1">{lang === 'de' ? f.descDe : f.descEn}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {lang === 'de' ? 'Speichern' : 'Save'}
        </Button>
        <StatusBadge status={result} />
      </div>
    </div>
  );
}

// ── Microsoft 365 mailbox connections ──────────────────────────────────────────

function Microsoft365MailboxesSection() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const langRef = useRef(lang);
  const toastRef = useRef(toast);
  const tokenRef = useRef(token);
  langRef.current = lang;
  toastRef.current = toast;
  tokenRef.current = token;
  const [mailboxes, setMailboxes] = useState<MicrosoftMailbox[]>([]);
  const [draft, setDraft] = useState(EMPTY_MAILBOX);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('microsoft');
    if (!result) return;
    const mailboxId = params.get('mailbox');
    toast({
      variant: result === 'connected' ? 'default' : 'destructive',
      title: result === 'connected'
        ? (lang === 'de' ? 'Microsoft-365-Postfach verbunden' : 'Microsoft 365 mailbox connected')
        : (lang === 'de' ? 'Microsoft-365-Autorisierung fehlgeschlagen' : 'Microsoft 365 authorization failed'),
      description: mailboxId
        ? (lang === 'de' ? `Postfach #${mailboxId} wurde aktualisiert.` : `Mailbox #${mailboxId} was updated.`)
        : undefined,
    });
    window.history.replaceState({}, '', window.location.pathname);
  }, [lang, toast]);

  const load = useCallback(async () => {
    if (!token) return;
    const requestToken = token;
    setLoading(true);
    try {
      const items = await adminGet<MicrosoftMailbox[]>('/api/admin/microsoft-365-mailboxes', requestToken);
      if (tokenRef.current === requestToken) setMailboxes(items);
    }
    catch {
      if (tokenRef.current === requestToken) toastRef.current({ variant: 'destructive', title: langRef.current === 'de' ? 'Postfächer konnten nicht geladen werden' : 'Could not load mailboxes' });
    }
    finally { if (tokenRef.current === requestToken) setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const reset = () => { setDraft(EMPTY_MAILBOX); setEditingId(null); setSaveError(null); };
  const save = async () => {
    if (!token) return;
    setSaveError(null);
    setSaving(true);
    try {
      const result = editingId
        ? await adminPut<MicrosoftMailbox>(`/api/admin/microsoft-365-mailboxes/${editingId}`, token, draft)
        : await adminPost<MicrosoftMailbox>('/api/admin/microsoft-365-mailboxes', token, draft);
      setMailboxes(items => editingId ? items.map(item => item.id === result.id ? result : item) : [...items, result]);
      reset();
      toast({ title: lang === 'de' ? 'Microsoft-365-Postfach gespeichert' : 'Microsoft 365 mailbox saved' });
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const message = rawMessage === 'This mailbox is already configured for the selected purpose.'
        ? (lang === 'de'
            ? 'Dieses Postfach ist für den ausgewählten Verwendungszweck bereits eingerichtet.'
            : rawMessage)
        : rawMessage;
      setSaveError(message);
      toast({ variant: 'destructive', title: lang === 'de' ? 'Speichern fehlgeschlagen' : 'Save failed', description: message });
    } finally { setSaving(false); }
  };

  const remove = async (id: number) => {
    if (!token || !window.confirm(lang === 'de' ? 'Dieses Postfach wirklich entfernen?' : 'Remove this mailbox?')) return;
    try {
      await adminDelete(`/api/admin/microsoft-365-mailboxes/${id}`, token);
      setMailboxes(items => items.filter(item => item.id !== id));
      if (editingId === id) reset();
    } catch { toast({ variant: 'destructive', title: lang === 'de' ? 'Entfernen fehlgeschlagen' : 'Could not remove mailbox' }); }
  };

  const connect = async (mailbox: MicrosoftMailbox) => {
    if (!token || !mailbox.enabled) return;
    setConnectingId(mailbox.id);
    try {
      const result = await adminPost<{ authorization_url: string }>(
        `/api/admin/microsoft-365-mailboxes/${mailbox.id}/connect`,
        token,
        {},
      );
      window.location.assign(result.authorization_url);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'Autorisierung konnte nicht gestartet werden' : 'Could not start authorization',
        description: String(err),
      });
      setConnectingId(null);
    }
  };

  const purposeLabel = (purpose: MailboxPurpose) => {
    const option = MICROSOFT_MAILBOX_ROLES.find(item => item.value === purpose);
    return option ? (lang === 'de' ? option.labelDe : option.labelEn) : purpose;
  };
  const statusLabel = (mailbox: MicrosoftMailbox) => {
    if (!mailbox.enabled || mailbox.authorization_status === 'disabled') return lang === 'de' ? 'Deaktiviert' : 'Disabled';
    if (mailbox.authorization_status === 'connected') return lang === 'de' ? 'Verbunden' : 'Connected';
    if (mailbox.authorization_status === 'error') return lang === 'de' ? 'Autorisierung ungültig' : 'Authorization invalid';
    return lang === 'de' ? 'Autorisierung ausstehend' : 'Authorization pending';
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        <div className="flex gap-2"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{lang === 'de'
            ? 'iROC speichert keine Exchange-Passwörter. Jeder Zugang wird später über die sichere Microsoft-365-Anmeldung freigegeben.'
            : 'iROC never stores Exchange passwords. Each mailbox is authorized later through secure Microsoft 365 sign-in.'}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">{editingId ? (lang === 'de' ? 'Postfach bearbeiten' : 'Edit mailbox') : (lang === 'de' ? 'Microsoft-365-Postfach hinzufügen' : 'Add Microsoft 365 mailbox')}</p>
          {editingId && <Button variant="ghost" size="sm" onClick={reset}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</Button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>{lang === 'de' ? 'E-Mail-Adresse' : 'Email address'}</Label><Input type="email" value={draft.email} onChange={e => { setSaveError(null); setDraft(d => ({ ...d, email: e.target.value })); }} placeholder="invoices@i-roc.de" /></div>
          <div><Label>{lang === 'de' ? 'Anzeigename (optional)' : 'Display name (optional)'}</Label><Input value={draft.display_name} onChange={e => { setSaveError(null); setDraft(d => ({ ...d, display_name: e.target.value })); }} placeholder={lang === 'de' ? 'z. B. Buchhaltung' : 'e.g. Accounting'} /></div>
          <div><Label>{lang === 'de' ? 'Verwendungszweck' : 'Purpose'}</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.purpose} onChange={e => { setSaveError(null); setDraft(d => ({ ...d, purpose: e.target.value as MailboxPurpose })); }}>
               {MICROSOFT_MAILBOX_ROLES.map(option => <option key={option.value} value={option.value}>{lang === 'de' ? option.labelDe : option.labelEn}</option>)}
            </select>
             <p className="mt-1 text-xs text-muted-foreground">
               {lang === 'de'
                 ? 'Alle Rollen aus dem E-Mail-Versand können hier einem Microsoft-365-Postfach zugeordnet und anschließend autorisiert werden.'
                 : 'Every role used by email sending can be assigned to a Microsoft 365 mailbox here and authorized afterwards.'}
             </p>
          </div>
          <div><Label>{lang === 'de' ? 'Berechtigung' : 'Permission'}</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.access_level} onChange={e => { setSaveError(null); setDraft(d => ({ ...d, access_level: e.target.value as MailboxAccess })); }}>
              <option value="read">{lang === 'de' ? 'Nur lesen' : 'Read only'}</option>
              <option value="read_write">{lang === 'de' ? 'Lesen und schreiben' : 'Read and write'}</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={e => { setSaveError(null); setDraft(d => ({ ...d, enabled: e.target.checked })); }} />{lang === 'de' ? 'Postfach aktivieren' : 'Enable mailbox'}</label>
        <Button onClick={save} disabled={saving || !draft.email.trim()} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{lang === 'de' ? 'Postfach speichern' : 'Save mailbox'}</Button>
        {saveError && (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </p>
        )}
      </div>

      {loading ? <div className="flex justify-center py-5"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : mailboxes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">{lang === 'de' ? 'Noch keine Microsoft-365-Postfächer konfiguriert.' : 'No Microsoft 365 mailboxes configured yet.'}</div>
      ) : <div className="space-y-3">{mailboxes.map(mailbox => (
        <div key={mailbox.id} className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-medium">{mailbox.display_name || mailbox.email}</p><p className="text-sm text-muted-foreground">{mailbox.display_name ? mailbox.email : purposeLabel(mailbox.purpose)}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${mailbox.authorization_status === 'connected' ? 'bg-emerald-100 text-emerald-800' : mailbox.authorization_status === 'error' ? 'bg-red-100 text-red-800' : mailbox.enabled ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'}`}>{statusLabel(mailbox)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-muted px-2 py-1">{purposeLabel(mailbox.purpose)}</span>
            <span className="rounded bg-muted px-2 py-1">{mailbox.access_level === 'read' ? (lang === 'de' ? 'Nur lesen' : 'Read only') : (lang === 'de' ? 'Lesen & schreiben' : 'Read & write')}</span>
            {!mailbox.enabled && <span className="text-muted-foreground">{lang === 'de' ? 'Keine Mailaktionen möglich' : 'No mail actions allowed'}</span>}
          </div>
          {mailbox.authorization_error && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
              {lang === 'de'
                ? 'Der Microsoft-365-Zugriff ist abgelaufen, widerrufen oder unvollständig. Bitte dieses Postfach erneut autorisieren.'
                : 'Microsoft 365 access has expired, been revoked, or is incomplete. Please authorize this mailbox again.'}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={!mailbox.enabled || connectingId === mailbox.id} onClick={() => connect(mailbox)} className="gap-1.5" title={lang === 'de' ? 'Sichere Microsoft-365-Anmeldung öffnen' : 'Open secure Microsoft 365 sign-in'}>
              {connectingId === mailbox.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {mailbox.authorization_status === 'connected' ? (lang === 'de' ? 'Erneut verbinden' : 'Reconnect') : (lang === 'de' ? 'Microsoft autorisieren' : 'Authorize Microsoft')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setEditingId(mailbox.id); setDraft({ email: mailbox.email, display_name: mailbox.display_name ?? '', purpose: mailbox.purpose, access_level: mailbox.access_level, enabled: mailbox.enabled }); }} className="gap-1.5"><RefreshCw className="h-4 w-4" />{lang === 'de' ? 'Bearbeiten' : 'Edit'}</Button>
            <Button size="sm" variant="ghost" onClick={() => remove(mailbox.id)} className="gap-1.5 text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" />{lang === 'de' ? 'Entfernen' : 'Remove'}</Button>
          </div>
        </div>
      ))}</div>}
    </div>
  );
}

// ── Automated email transport ─────────────────────────────────────────────────

function EmailDeliverySection() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const langRef = useRef(lang);
  const toastRef = useRef(toast);
  const tokenRef = useRef(token);
  langRef.current = lang;
  toastRef.current = toast;
  tokenRef.current = token;
  const [settings, setSettings] = useState<EmailDeliverySetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testPurpose, setTestPurpose] = useState<MicrosoftMailboxPurpose>('general');
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);

  const refreshSettings = useCallback(async () => {
    if (!token) return;
    const requestToken = token;
    const latest = await adminGet<EmailDeliverySetting[]>('/api/admin/email-delivery-settings', requestToken);
    if (tokenRef.current === requestToken) setSettings(latest);
    return latest;
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    const requestToken = token;
    setLoading(true);
    try {
      await refreshSettings();
    } catch {
      if (tokenRef.current !== requestToken) return;
      toastRef.current({
        variant: 'destructive',
        title: langRef.current === 'de' ? 'Versandeinstellungen konnten nicht geladen werden' : 'Could not load delivery settings',
      });
    } finally {
      if (tokenRef.current === requestToken) setLoading(false);
    }
  }, [token, refreshSettings]);
  useEffect(() => { void load(); }, [load]);

  const updateProvider = async (purpose: MicrosoftMailboxPurpose, provider: EmailDeliveryProvider) => {
    if (!token) return;
    const previous = settings.find(item => item.purpose === purpose)?.provider ?? 'smtp';
    setSettings(items => items.map(item => item.purpose === purpose ? { ...item, provider } : item));
    setSaving(purpose);
    try {
      await adminPost('/api/admin/email-delivery-settings', token, { purpose, provider });
      toast({ title: lang === 'de' ? 'Versandart gespeichert' : 'Delivery method saved' });
    } catch (err) {
      setSettings(items => items.map(item => item.purpose === purpose ? { ...item, provider: previous } : item));
      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'Versandart konnte nicht gespeichert werden' : 'Could not save delivery method',
        description: String(err),
      });
    } finally {
      setSaving(null);
    }
  };

  const roleLabel = (purpose: MicrosoftMailboxPurpose) => {
    const role = MICROSOFT_MAILBOX_ROLES.find(item => item.value === purpose);
    return role ? (lang === 'de' ? role.labelDe : role.labelEn) : purpose;
  };

  const selectedTestSetting = settings.find(item => item.purpose === testPurpose);

  const handleTest = async () => {
    const recipient = testEmail.trim();
    if (!token || !recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return;
    setTestSending(true);
    try {
      let latestSettings: EmailDeliverySetting[] | undefined;
      try {
        latestSettings = await refreshSettings();
      } catch {
        toast({
          variant: 'destructive',
          title: lang === 'de' ? 'Versandrollen konnten nicht aktualisiert werden' : 'Could not refresh delivery roles',
          description: lang === 'de'
            ? 'Der Test wurde nicht gesendet. Bitte versuchen Sie es erneut.'
            : 'The test was not sent. Please try again.',
        });
        return;
      }

      const latestSelectedSetting = latestSettings?.find(item => item.purpose === testPurpose);
      if (!latestSelectedSetting) {
        setTestPurpose(latestSettings?.[0]?.purpose ?? 'general');
        toast({
          variant: 'destructive',
          title: lang === 'de' ? 'Versandrolle nicht verfügbar' : 'Delivery role unavailable',
          description: lang === 'de'
            ? 'Die ausgewählte Versandrolle ist nicht mehr verfügbar. Bitte wählen Sie eine aktuelle Rolle.'
            : 'The selected delivery role is no longer available. Please choose a current role.',
        });
        return;
      }

      await adminPost('/api/admin/email-delivery-test', token, { purpose: testPurpose, to: recipient });
      toast({
        title: lang === 'de' ? 'Test-E-Mail gesendet' : 'Test email sent',
        description: recipient,
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: lang === 'de' ? 'Test-E-Mail fehlgeschlagen' : 'Test email failed',
        description: String(err),
      });
    } finally {
      setTestSending(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex gap-2">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{lang === 'de'
            ? 'SMTP ist die ausdrückliche Fallback-Versandart. Wenn Microsoft 365 gewählt ist, wird bei einer Autorisierungs- oder Graph-Fehlermeldung nicht zusätzlich über SMTP gesendet, damit keine doppelten E-Mails entstehen.'
            : 'SMTP is the explicit fallback delivery method. When Microsoft 365 is selected, authorization or Graph failures are not also sent through SMTP, avoiding duplicate emails.'}</p>
        </div>
      </div>
      <div className="rounded-xl border bg-card divide-y">
        {settings.map(item => {
          const mailbox = item.microsoftMailbox;
          const mailboxReady = mailbox?.enabled
            && mailbox.authorizationStatus === 'connected'
            && mailbox.accessLevel === 'read_write';
          return (
            <div key={item.purpose} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{roleLabel(item.purpose)}</p>
                <p className="text-xs text-muted-foreground">
                  {item.provider === 'microsoft365'
                    ? mailboxReady
                      ? `${lang === 'de' ? 'Microsoft 365:' : 'Microsoft 365:'} ${mailbox.email}`
                      : (lang === 'de' ? 'Kein verbundenes Microsoft-365-Versandpostfach mit Schreibrecht.' : 'No connected Microsoft 365 sending mailbox with send permission.')
                    : (lang === 'de' ? 'SMTP-Fallback aktiv' : 'SMTP fallback active')}
                </p>
              </div>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-56"
                value={item.provider}
                disabled={saving === item.purpose}
                onChange={event => void updateProvider(item.purpose, event.target.value as EmailDeliveryProvider)}
                aria-label={`${roleLabel(item.purpose)} ${lang === 'de' ? 'Versandart' : 'delivery method'}`}
              >
                <option value="smtp">{lang === 'de' ? 'SMTP (Fallback)' : 'SMTP (fallback)'}</option>
                <option value="microsoft365">Microsoft 365</option>
              </select>
            </div>
          );
        })}
      </div>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div>
          <p className="font-medium">{lang === 'de' ? 'Versandrolle testen' : 'Test a delivery role'}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {lang === 'de'
              ? 'Sendet eine klar gekennzeichnete Test-E-Mail über die ausgewählte Rolle und deren aktuell konfigurierte Versandart. Verwenden Sie nur eine von Ihnen kontrollierte Adresse.'
              : 'Sends a clearly labeled test email through the selected role and its currently configured delivery method. Use only an address you control.'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div>
            <Label htmlFor="email-delivery-test-role">{lang === 'de' ? 'Versandrolle' : 'Delivery role'}</Label>
            <select
              id="email-delivery-test-role"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={testPurpose}
              onChange={event => setTestPurpose(event.target.value as MicrosoftMailboxPurpose)}
            >
              {settings.map(item => <option key={item.purpose} value={item.purpose}>{roleLabel(item.purpose)}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="email-delivery-test-recipient">{lang === 'de' ? 'Ihre Testadresse' : 'Your test address'}</Label>
            <Input
              id="email-delivery-test-recipient"
              type="email"
              value={testEmail}
              onChange={event => setTestEmail(event.target.value)}
              placeholder="admin@example.com"
            />
          </div>
          <Button
            onClick={() => void handleTest()}
            disabled={testSending || !testEmail.trim() || !selectedTestSetting}
            variant="outline"
            className="gap-2"
          >
            {testSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {lang === 'de' ? 'Test senden' : 'Send test'}
          </Button>
        </div>
        {selectedTestSetting && (
          <p className="text-xs text-muted-foreground">
            {lang === 'de' ? 'Aktive Versandart:' : 'Active delivery method:'}{' '}
            {selectedTestSetting.provider === 'microsoft365'
              ? `Microsoft 365${selectedTestSetting.microsoftMailbox ? ` · ${selectedTestSetting.microsoftMailbox.email}` : ''}`
              : (lang === 'de' ? 'SMTP-Fallback' : 'SMTP fallback')}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {lang === 'de'
            ? 'Adressen aus Kunden-, Patienten-, Lead- und Lieferantenkontakten werden serverseitig abgelehnt.'
            : 'Addresses from customer, patient, lead, and supplier contacts are rejected by the server.'}
        </p>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function EmailConfig() {
  const { lang } = useLanguage();

  return (
    <div className="space-y-10 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Mail className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'E-Mail-Konfiguration' : 'Email Configuration'}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Alle E-Mail-Einstellungen – SMTP-Server, Empfänger, KI-Agenten und App-Adressen – an einem Ort.'
              : 'All email settings — SMTP server, recipients, AI agents, and app addresses — in one place.'}
          </p>
        </div>
      </div>

      {/* 1. SMTP */}
      <Section
        icon={Mail}
        title={lang === 'de' ? 'Microsoft 365 – Postfachverbindungen' : 'Microsoft 365 — Mailbox Connections'}
        description={lang === 'de'
          ? 'Postfächer für alle E-Mail-Rollen registrieren und autorisieren. Die Versandart wird unten pro Rolle ausgewählt.'
          : 'Register and authorize mailboxes for every email role. Select the delivery method for each role below.'}
      >
        <Microsoft365MailboxesSection />
      </Section>

      <Section
        icon={Send}
        title={lang === 'de' ? 'Automatischer E-Mail-Versand' : 'Automated Email Delivery'}
        description={lang === 'de'
          ? 'Wählen Sie für Website, Bestellungen, Schulungen, Rechnungen, DATEV, Ankündigungen, Sally, Tori und Benachrichtigungen Microsoft 365 oder SMTP als Fallback.'
          : 'Choose Microsoft 365 or SMTP fallback for website, orders, training, invoices, DATEV, announcements, Sally, Tori, and notifications.'}
      >
        <EmailDeliverySection />
      </Section>

      {/* 2. SMTP */}
      <Section
        icon={Server}
        title={lang === 'de' ? 'Ausgehender E-Mail-Server (SMTP)' : 'Outgoing Email Server (SMTP)'}
        description={lang === 'de'
          ? 'SMTP bleibt als ausdrücklich auswählbarer Fallback für jede Versandrolle verfügbar. Zugangsdaten vom Hosting-Anbieter für das Postfach info@i-roc.de.'
          : 'SMTP remains an explicitly selectable fallback for every delivery role. Use the credentials from your hosting provider for the info@i-roc.de mailbox.'}
      >
        <SmtpSection />
      </Section>

      {/* 2. iROC Website – Notification Recipients */}
      <Section
        icon={Globe}
        title={lang === 'de' ? 'iROC Website – Benachrichtigungsempfänger' : 'iROC Website — Notification Recipients'}
        description={lang === 'de'
          ? 'E-Mail-Adressen, an die Website-Benachrichtigungen gesendet werden (Bestellungen, Schulungsanmeldungen, Kontaktanfragen).'
          : 'Email addresses that receive website notifications (orders, training registrations, contact requests).'}
      >
        <NotificationRecipientsSection />
      </Section>

      {/* 3. iROC Website – Content Emails */}
      <Section
        icon={Globe}
        title={lang === 'de' ? 'iROC Website – Weitere E-Mail-Adressen' : 'iROC Website — Additional Email Addresses'}
        description={lang === 'de'
          ? 'Absender- und Empfängeradressen für Website-Inhalte und interne Workflows.'
          : 'Sender and recipient addresses used for website content and internal workflows.'}
      >
        <WebsiteSettingsEmailSection fields={IROC_WS_EMAIL_FIELDS} />
      </Section>

      {/* 4. Spirecut – Contact Emails */}
      <Section
        icon={Stethoscope}
        title={lang === 'de' ? 'Spirecut – Kontakt-E-Mail-Adressen' : 'Spirecut — Contact Email Addresses'}
        description={lang === 'de'
          ? 'E-Mail-Adressen, die auf der Spirecut-Patienten-Website als Kontaktadressen angezeigt werden.'
          : 'Email addresses shown as contact addresses on the Spirecut patient website.'}
      >
        <WebsiteSettingsEmailSection fields={SPIRECUT_EMAIL_FIELDS} />
      </Section>

      {/* 5. Sally AI Agent */}
      <Section
        icon={Bot}
        title={lang === 'de' ? 'Sally – KI-Verkaufsagentin' : 'Sally — AI Sales Agent'}
        description={lang === 'de'
          ? 'Absender- und Eskalationsadressen für alle ausgehenden Sally-E-Mails.'
          : 'Sender and escalation addresses for all outgoing Sally emails.'}
      >
        <SallyEmailSection />
      </Section>

      {/* 6. Email Signatures */}
      <Section
        icon={Mail}
        title={lang === 'de' ? 'E-Mail-Signaturen' : 'Email Signatures'}
        description={lang === 'de'
          ? 'Konfigurieren Sie dynamische E-Mail-Signaturen für verschiedene Absendergruppen.'
          : 'Configure dynamic email signatures for different sender groups.'}
      >
        <EmailSignatureDesigner />
      </Section>

      {/* Security note */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        <p>
          {lang === 'de'
            ? 'SMTP-Zugangsdaten werden verschlüsselt gespeichert und sind nur für den Systemversand zugänglich. Das Passwort wird niemals im Klartext zurückgegeben.'
            : 'SMTP credentials are stored encrypted and only accessible to the mail system. The password is never returned in plaintext.'}
        </p>
      </div>
    </div>
  );
}
