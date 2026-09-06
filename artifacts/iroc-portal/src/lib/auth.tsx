import { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { useLocation } from 'wouter';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { PortalCustomer } from '@workspace/api-client-react';

interface AuthContextType {
  token: string | null;
  customer: PortalCustomer | null;
  login: (token: string, customer: PortalCustomer) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'iroc_portal_token';
const CUSTOMER_KEY = 'iroc_portal_customer';
export const PORTAL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

// ── Module-level initialisation ───────────────────────────────────────────────
// Called synchronously when the module is first imported — before any React
// rendering happens.  React Query fires its first requests on the initial
// render, so the getter must already be set at that point; a useEffect would
// fire too late and every query would go out without an Authorization header,
// receiving 401 and caching an error state.
setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [customer, setCustomer] = useState<PortalCustomer | null>(() => {
    const saved = localStorage.getItem(CUSTOMER_KEY);
    try {
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [, setLocation] = useLocation();

  const login = useCallback((newToken: string, newCustomer: PortalCustomer) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(newCustomer));
    setToken(newToken);
    setCustomer(newCustomer);
    setAuthTokenGetter(() => newToken);
    setLocation('/dashboard');
  }, [setLocation]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CUSTOMER_KEY);
    setToken(null);
    setCustomer(null);
    setAuthTokenGetter(() => null);
    setLocation('/');
  }, [setLocation]);

  useEffect(() => {
    if (!token) return;

    let lastActivityAt = Date.now();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const clearTimer = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    };

    const scheduleLogout = () => {
      clearTimer();
      const remaining = Math.max(0, PORTAL_IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt));
      timeoutId = setTimeout(() => {
        if (Date.now() - lastActivityAt >= PORTAL_IDLE_TIMEOUT_MS) {
          logout();
        } else {
          scheduleLogout();
        }
      }, remaining);
    };

    const recordActivity = () => {
      lastActivityAt = Date.now();
      scheduleLogout();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        if (Date.now() - lastActivityAt >= PORTAL_IDLE_TIMEOUT_MS) {
          logout();
        } else {
          scheduleLogout();
        }
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'touchstart',
      'scroll',
      'mousemove',
    ];
    activityEvents.forEach(event => window.addEventListener(event, recordActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityChange);
    scheduleLogout();

    return () => {
      clearTimer();
      activityEvents.forEach(event => window.removeEventListener(event, recordActivity));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [token, logout]);

  return (
    <AuthContext.Provider value={{ token, customer, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
