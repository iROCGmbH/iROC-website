import { useEffect, useState } from 'react';
import { ExternalLink, Globe2, Loader2, Settings } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';

const DEFAULT_APP_URL = 'https://portal.i-roc.de';

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function IrocBrowserApp() {
  const { token } = useAuth();
  const { lang } = useLanguage();
  const [appUrl, setAppUrl] = useState(DEFAULT_APP_URL);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let active = true;

    fetch('/api/website-settings', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : {}))
      .then((settings: { ws_webapp_url?: unknown }) => {
        if (active) setAppUrl(validHttpUrl(settings.ws_webapp_url) ?? DEFAULT_APP_URL);
      })
      .catch(() => {
        // The configured production portal remains a safe fallback.
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  const isFallback = appUrl === DEFAULT_APP_URL;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <Globe2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">iROC Browser APP</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lang === 'de'
              ? 'Öffnen Sie die konfigurierte iROC Browser APP in einem eigenen Browser-Tab.'
              : 'Open the configured iROC Browser APP in its own browser tab.'}
          </p>
        </div>
      </div>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Globe2 className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">
              {lang === 'de' ? 'iROC Browser APP öffnen' : 'Open iROC Browser APP'}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {lang === 'de'
                ? 'Das Ziel wird in den iROC Website-Einstellungen gepflegt und unabhängig vom iROC Adminbereich geöffnet.'
                : 'The destination is managed in iROC Website Settings and opens independently from the iROC admin area.'}
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-dashed bg-muted/30 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {lang === 'de' ? 'Aktuelles Ziel' : 'Current destination'}
          </p>
          {loading ? (
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {lang === 'de' ? 'Ziel wird geladen…' : 'Loading destination…'}
            </div>
          ) : (
            <>
              <p className="mt-2 break-all text-sm">{appUrl}</p>
              {isFallback && (
                <p className="mt-2 text-xs text-amber-700">
                  {lang === 'de'
                    ? 'Standardziel, solange kein anderes Ziel konfiguriert ist.'
                    : 'Default destination until another destination is configured.'}
                </p>
              )}
            </>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild className="gap-2">
            <a href={appUrl} target="_blank" rel="noopener noreferrer">
              {lang === 'de' ? 'iROC APP öffnen' : 'Open iROC APP'}
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link href="/iroc-website/settings">
              <Settings className="h-4 w-4" />
              {lang === 'de' ? 'Ziel konfigurieren' : 'Configure destination'}
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}