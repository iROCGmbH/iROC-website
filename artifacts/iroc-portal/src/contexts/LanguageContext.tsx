/**
 * LanguageContext for the iROC Doctor Portal.
 * Mirrors the iroc-website LanguageContext pattern.
 * Persists selection in localStorage `iroc_portal_language`.
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

type Lang = 'DE' | 'EN';

interface LanguageContextValue {
  language: Lang;
  toggleLanguage: () => void;
  t: (de: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = 'iroc_portal_language';

function getInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'DE' || stored === 'EN') return stored;
    // Default based on browser language
    return navigator.language?.startsWith('de') ? 'DE' : 'EN';
  } catch {
    return 'EN';
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Lang>(getInitialLang);

  useEffect(() => {
    document.documentElement.lang = language.toLowerCase();
  }, [language]);

  const toggleLanguage = useCallback(() => {
    setLanguage(prev => {
      const next: Lang = prev === 'DE' ? 'EN' : 'DE';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const t = useCallback((de: string, en: string) => language === 'DE' ? de : en, [language]);

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
