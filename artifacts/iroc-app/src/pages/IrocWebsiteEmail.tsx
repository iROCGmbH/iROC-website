import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Save, CheckCircle, AlertCircle, Loader2, Globe } from 'lucide-react';
import { adminPost } from '@/lib/admin-fetch';


interface EmailSetting {
  key: string;
  label: string;
  email: string;
  defaultEmail: string;
}

export default function IrocWebsiteEmail() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { irocUrl } = useSiteUrls();
  const { toast } = useToast();

  const [settings, setSettings] = useState<EmailSetting[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, 'ok' | 'error'>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/admin/email-settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : [])
      .then((data: EmailSetting[]) => {
        setSettings(data);
        const map: Record<string, string> = {};
        data.forEach((s) => { map[s.key] = s.email; });
        setEdits(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const handleSave = async (key: string) => {
    if (!token) return;
    setSaving((s) => ({ ...s, [key]: true }));
    setResults((r) => { const n = { ...r }; delete n[key]; return n; });
    try {
      await adminPost(`/api/admin/email-settings`, token, { key, email: edits[key]?.trim() || '' });
      setSettings((prev) => prev.map((s) => s.key === key ? { ...s, email: edits[key]?.trim() || '' } : s));
      setResults((r) => ({ ...r, [key]: 'ok' }));
      toast({ title: lang === 'de' ? 'Gespeichert' : 'Saved' });
    } catch {
      setResults((r) => ({ ...r, [key]: 'error' }));
      toast({ variant: 'destructive', title: lang === 'de' ? 'Fehler beim Speichern' : 'Error saving' });
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Mail className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{lang === 'de' ? 'E-Mail Adressen' : 'Email Addresses'}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Empfänger-E-Mail-Adressen für verschiedene Benachrichtigungstypen'
              : 'Recipient email addresses for various notification types'}
          </p>
        </div>
        <a
          href={`${irocUrl}/contact`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <Globe className="w-4 h-4" />
          {lang === 'de' ? 'Website öffnen →' : 'Open Website →'}
        </a>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 max-w-2xl">
          {settings.map((s) => (
            <div key={s.key} className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
              <div>
                <p className="font-medium text-sm">{s.label}</p>
                <p className="text-xs text-muted-foreground">
                  {lang === 'de' ? 'Standard:' : 'Default:'} {s.defaultEmail}
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={edits[s.key] ?? ''}
                  onChange={(e) => setEdits((v) => ({ ...v, [s.key]: e.target.value }))}
                  placeholder={s.defaultEmail}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => handleSave(s.key)}
                  disabled={saving[s.key]}
                  className="gap-1.5 shrink-0"
                >
                  {saving[s.key] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {lang === 'de' ? 'Speichern' : 'Save'}
                </Button>
              </div>
              {results[s.key] === 'ok' && (
                <p className="flex items-center gap-1.5 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4" /> {lang === 'de' ? 'Gespeichert' : 'Saved'}
                </p>
              )}
              {results[s.key] === 'error' && (
                <p className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4" /> {lang === 'de' ? 'Fehler' : 'Error'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
