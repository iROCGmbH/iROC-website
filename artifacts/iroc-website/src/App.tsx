import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { Layout } from '@/components/Layout';
import { PAGE_LINKS } from '@/config/navLinks';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ScrollRestoration } from '@/components/ScrollRestoration';
import { AppLaunchTransition } from '@/components/AppLaunchTransition';
import { LocalizedDatePickerProvider } from '../../../lib/localized-date-picker/src';

const NotFound = lazy(() => import('@/pages/not-found'));

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Suspense fallback={<LoadingSpinner />}>
        <Switch>
          {PAGE_LINKS.map(({ href, component: Page }) => (
            <Route key={href} path={href} component={Page} />
          ))}
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <LocalizedDatePickerProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <LanguageProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
                <ScrollRestoration />
                <AppLaunchTransition>
                  <Router />
                </AppLaunchTransition>
              </WouterRouter>
              <Toaster />
            </LanguageProvider>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </LocalizedDatePickerProvider>
  );
}

export default App;
