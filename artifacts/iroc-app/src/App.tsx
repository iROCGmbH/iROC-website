import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Router as WouterRouter, useLocation } from 'wouter';
import { useEffect } from 'react';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { isSyncStatusFired, markSyncStatusFired } from '@/lib/sync-session';
import { LocalizedDatePickerProvider } from '../../../lib/localized-date-picker/src';
export { _resetSyncStatusFiredForTesting } from '@/lib/sync-session';
import { LEADS_QUERY_KEY } from '@/lib/query-keys';

import Layout from '@/components/Layout';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { APP_ROUTES } from '@/config/routeConfig';
import { RouteSwitch } from '@/components/RouteSwitch';
export { RouteSwitch } from '@/components/RouteSwitch';

export const queryClient = new QueryClient();

// Configure Orval API Client
setAuthTokenGetter(() => {
  return localStorage.getItem('iroc_token');
});

export function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const [, setLocation] = useLocation();
  const { token } = useAuth();

  useEffect(() => {
    if (!token) {
      setLocation('/login');
      return;
    }
    // Sync lead statuses at most once per login session. ProtectedRoute is
    // recreated on every route change, so without this guard the call fires on
    // every navigation. The flag is reset by useAuth.logout() so re-login
    // correctly fires a fresh sync without a full page reload.
    if (isSyncStatusFired()) return;
    markSyncStatusFired();
    fetch('/api/iroc/leads/sync-status', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then((data: { updated?: number; contacted?: number; registered?: number; qualified?: number; converted?: number } | null) => {
        if (!data) return;
        const { updated = 0, contacted = 0, registered = 0, qualified = 0, converted = 0 } = data;
        if (updated > 0) {
          const lang = (localStorage.getItem('iroc_lang') as 'de' | 'en') || 'en';
          const leadLabel = (count: number) => {
            if (lang === 'de') return count === 1 ? 'Lead' : 'Leads';
            return count === 1 ? 'lead' : 'leads';
          };
          const parts: string[] = [];
          if (contacted > 0) {
            parts.push(lang === 'de' ? `${contacted} ${leadLabel(contacted)} → Kontaktiert` : `${contacted} ${leadLabel(contacted)} → Contacted`);
          }
          if (registered > 0) {
            parts.push(lang === 'de' ? `${registered} ${leadLabel(registered)} → Angemeldet` : `${registered} ${leadLabel(registered)} → Registered`);
          }
          if (qualified > 0) {
            parts.push(lang === 'de' ? `${qualified} ${leadLabel(qualified)} → Qualifiziert` : `${qualified} ${leadLabel(qualified)} → Qualified`);
          }
          if (converted > 0) {
            parts.push(lang === 'de' ? `${converted} ${leadLabel(converted)} → Konvertiert` : `${converted} ${leadLabel(converted)} → Converted`);
          }
          toast({
            title: lang === 'de' ? 'Leads automatisch aktualisiert' : 'Leads auto-promoted',
            description: parts.join(' · '),
          });
          queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
        }
      })
      .catch(() => { /* non-critical – ignore errors */ });
  }, [token, setLocation]);

  if (!token) return null;

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

export function Router() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <RouteSwitch
        routes={APP_ROUTES}
        renderProtected={(Page) => <ProtectedRoute component={Page} />}
      />
    </Suspense>
  );
}
function App() {
  return (
    <LocalizedDatePickerProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </LocalizedDatePickerProvider>
  );
}

export default App;
