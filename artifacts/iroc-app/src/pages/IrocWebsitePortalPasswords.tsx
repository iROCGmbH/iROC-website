import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KeyRound, Eye, EyeOff, Loader2, Link } from 'lucide-react';
import { adminGet, adminPost } from '@/lib/admin-fetch';
import { IROC_PORTAL_PASSWORDS_QUERY_KEY } from '@/lib/query-keys';

interface PortalPasswordStatus {
  spirecutSet: boolean;
  ministemSet: boolean;
  spirecutUrl: string;
  ministemUrl: string;
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  showLabel,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  showLabel: string;
  hideLabel: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        <Input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? hideLabel : showLabel}
          aria-pressed={show}
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function PortalCard({
  name,
  instrument,
  isSet,
  savedUrl,
  de,
  onSavePassword,
  onSaveUrl,
  isSavingPassword,
  isSavingUrl,
}: {
  name: string;
  instrument: 'spirecut' | 'ministem';
  isSet: boolean;
  savedUrl: string;
  de: boolean;
  onSavePassword: (pw: string) => void;
  onSaveUrl: (url: string) => void;
  isSavingPassword: boolean;
  isSavingUrl: boolean;
}) {
  const [pw, setPw] = useState('');
  const [url, setUrl] = useState(savedUrl);

  // Sync url field when savedUrl changes from server
  if (url === '' && savedUrl !== '') setUrl(savedUrl);

  return (
    <div className="bg-card border rounded-xl p-6 space-y-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-amber-50 rounded-lg">
            <KeyRound className="w-4 h-4 text-amber-600" />
          </div>
          <span className="text-sm font-bold">{name} Portal</span>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded font-medium ${
            isSet ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}
        >
          {isSet
            ? de ? 'Benutzerdefiniert' : 'Custom'
            : de
              ? `Standard (${instrument}2024)`
              : `Default (${instrument}2024)`}
        </span>
      </div>

      {/* Portal URL */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {de ? 'Portal-URL (Login-Link)' : 'Portal URL (Login Link)'}
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="pl-8"
            />
          </div>
          <Button
            variant="outline"
            disabled={!url.trim() || isSavingUrl}
            onClick={() => onSaveUrl(url.trim())}
            className="shrink-0"
          >
            {isSavingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : (de ? 'Speichern' : 'Save')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {de
            ? 'Wird automatisch in Zertifikats-E-Mails eingefügt.'
            : 'Automatically included in certificate emails.'}
        </p>
      </div>

      {/* Password */}
      <PasswordField
        label={de ? 'Neues Passwort' : 'New Password'}
        value={pw}
        onChange={setPw}
        placeholder={de ? 'Mind. 8 Zeichen' : 'At least 8 characters'}
        showLabel={de ? 'Passwort anzeigen' : 'Show password'}
        hideLabel={de ? 'Passwort ausblenden' : 'Hide password'}
      />
      <Button
        className="w-full"
        disabled={pw.length < 8 || isSavingPassword}
        onClick={() => { onSavePassword(pw); setPw(''); }}
      >
        {isSavingPassword ? (
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
        ) : (
          <KeyRound className="w-4 h-4 mr-2" />
        )}
        {de ? `${name} Passwort setzen` : `Set ${name} Password`}
      </Button>
    </div>
  );
}

export default function IrocWebsitePortalPasswords() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const de = lang === 'de';

  const { data: status } = useQuery<PortalPasswordStatus>({
    queryKey: IROC_PORTAL_PASSWORDS_QUERY_KEY,
    queryFn: () => adminGet<PortalPasswordStatus>('/api/admin/portal-passwords', token!),
    enabled: !!token,
  });

  const setPassword = useMutation({
    mutationFn: ({ instrument, password }: { instrument: string; password: string }) =>
      adminPost('/api/admin/portal-passwords', token!, { instrument, password }),
    onSuccess: (_data, variables) => {
      const name = variables.instrument === 'spirecut' ? 'Spirecut®' : 'MiniStem®';
      toast({ title: `${name} ${de ? 'Passwort aktualisiert' : 'password updated'}` });
      qc.invalidateQueries({ queryKey: IROC_PORTAL_PASSWORDS_QUERY_KEY });
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: de ? 'Fehler' : 'Error', description: err.message }),
  });

  const setUrl = useMutation({
    mutationFn: ({ instrument, url }: { instrument: string; url: string }) =>
      adminPost('/api/admin/portal-urls', token!, { instrument, url }),
    onSuccess: (_data, variables) => {
      const name = variables.instrument === 'spirecut' ? 'Spirecut®' : 'MiniStem®';
      toast({ title: `${name} ${de ? 'Portal-URL gespeichert' : 'portal URL saved'}` });
      qc.invalidateQueries({ queryKey: IROC_PORTAL_PASSWORDS_QUERY_KEY });
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: de ? 'Fehler' : 'Error', description: err.message }),
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {de ? 'Portal-Zugangsdaten' : 'Portal Credentials'}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {de
            ? 'Login-URL und Passwörter für den Arzt-Bereich – werden automatisch in Zertifikats-E-Mails eingefügt.'
            : 'Login URL and passwords for the doctor portal — automatically included in certificate emails.'}
        </p>
      </div>

      {/* Cards */}
      <div className="grid md:grid-cols-2 gap-6">
        <PortalCard
          name="Spirecut®"
          instrument="spirecut"
          isSet={status?.spirecutSet ?? false}
          savedUrl={status?.spirecutUrl ?? ''}
          de={de}
          onSavePassword={(pw) => setPassword.mutate({ instrument: 'spirecut', password: pw })}
          onSaveUrl={(url) => setUrl.mutate({ instrument: 'spirecut', url })}
          isSavingPassword={setPassword.isPending && setPassword.variables?.instrument === 'spirecut'}
          isSavingUrl={setUrl.isPending && setUrl.variables?.instrument === 'spirecut'}
        />
        <PortalCard
          name="MiniStem®"
          instrument="ministem"
          isSet={status?.ministemSet ?? false}
          savedUrl={status?.ministemUrl ?? ''}
          de={de}
          onSavePassword={(pw) => setPassword.mutate({ instrument: 'ministem', password: pw })}
          onSaveUrl={(url) => setUrl.mutate({ instrument: 'ministem', url })}
          isSavingPassword={setPassword.isPending && setPassword.variables?.instrument === 'ministem'}
          isSavingUrl={setUrl.isPending && setUrl.variables?.instrument === 'ministem'}
        />
      </div>

      {/* Info note */}
      <p className="text-xs text-muted-foreground">
        {de
          ? 'Das Passwort muss mindestens 8 Zeichen lang sein. Nach dem Speichern ist es sofort aktiv.'
          : 'The password must be at least 8 characters. It takes effect immediately after saving.'}
      </p>
    </div>
  );
}
