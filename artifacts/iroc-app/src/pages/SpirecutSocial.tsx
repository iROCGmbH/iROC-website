import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useSiteUrls } from '@/hooks/use-site-urls';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link2, Save, CheckCircle, AlertCircle, Loader2, Globe, Instagram, Youtube, Linkedin } from 'lucide-react';
import { adminPost } from '@/lib/admin-fetch';


// Custom TikTok icon since lucide doesn't have it
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.54V6.79a4.85 4.85 0 01-1.01-.1z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', Icon: Instagram,    placeholder: 'https://www.instagram.com/…' },
  { key: 'youtube',   label: 'YouTube',   Icon: Youtube,      placeholder: 'https://www.youtube.com/…' },
  { key: 'linkedin',  label: 'LinkedIn',  Icon: Linkedin,     placeholder: 'https://www.linkedin.com/…' },
  { key: 'tiktok',    label: 'TikTok',    Icon: TikTokIcon,   placeholder: 'https://www.tiktok.com/…' },
  { key: 'facebook',  label: 'Facebook',  Icon: FacebookIcon, placeholder: 'https://www.facebook.com/…' },
] as const;

export default function SpirecutSocial() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { spirecutUrl } = useSiteUrls();
  const { toast } = useToast();

  const [socials, setSocials] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, 'ok' | 'error'>>({});

  useEffect(() => {
    if (!token) return;
    fetch(`/api/patient-social`)
      .then((r) => r.ok ? r.json() : {})
      .then((data: Record<string, string>) => { setSocials(data); setEdits(data); })
      .catch(() => {});
  }, [token]);

  const handleSave = async (key: string) => {
    if (!token) return;
    const url = edits[key]?.trim() ?? '';
    setSaving((s) => ({ ...s, [key]: true }));
    setResults((r) => { const n = { ...r }; delete n[key]; return n; });
    try {
      await adminPost('/api/admin/patient-social', token, { key, url });
      setSocials((s) => ({ ...s, [key]: url }));
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
          <Link2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Social Links</h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Social-Media-Links in der Navigationsleiste der Spirecut-Website'
              : 'Social media links shown in the Spirecut website navigation'}
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

      <div className="grid gap-4 max-w-2xl">
        {PLATFORMS.map(({ key, label, Icon, placeholder }) => (
          <div key={key} className="bg-card border rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <Icon className="w-5 h-5 text-muted-foreground" />
              <span className="font-semibold">{label}</span>
            </div>
            <div className="flex gap-2">
              <Input
                type="url"
                value={edits[key] ?? ''}
                onChange={(e) => setEdits((s) => ({ ...s, [key]: e.target.value }))}
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
            {results[key] === 'error' && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" /> {lang === 'de' ? 'Fehler' : 'Error'}
              </p>
            )}
            {socials[key] && (
              <p className="text-xs text-muted-foreground truncate">
                {lang === 'de' ? 'Aktuell:' : 'Current:'}{' '}
                <a href={socials[key]} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                  {socials[key]}
                </a>
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
