import { type ComponentType, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { LocalizedDatePickerProvider } from '../../../lib/localized-date-picker/src';
import NotFound from '@/pages/not-found';
import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Resources from '@/pages/resources';
import Invoices from '@/pages/invoices';
import Order from '@/pages/order';
import Training from '@/pages/training';
import Profile from '@/pages/profile';
import {
  Route,
  Switch,
  useLocation,
  Redirect,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component }: { component: ComponentType }) {
  const { isAuthenticated } = useAuth();
  
  if (!isAuthenticated) {
    return <Redirect to="/" />;
  }
  
  return <Component />;
}

function Router() {
  const { isAuthenticated } = useAuth();

  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/">
          {isAuthenticated ? <Redirect to="/dashboard" /> : <Login />}
        </Route>
        <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
        <Route path="/resources"><ProtectedRoute component={Resources} /></Route>
        <Route path="/invoices"><ProtectedRoute component={Invoices} /></Route>
        <Route path="/order"><ProtectedRoute component={Order} /></Route>
        <Route path="/training"><ProtectedRoute component={Training} /></Route>
        <Route path="/profile"><ProtectedRoute component={Profile} /></Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <LocalizedDatePickerProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <LanguageProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <AuthProvider>
                <Router />
              </AuthProvider>
            </WouterRouter>
            <Toaster />
          </LanguageProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </LocalizedDatePickerProvider>
  );
}

export default App;
