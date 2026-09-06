import { ReactNode } from 'react';
import { useLocation, Link } from 'wouter';
import { useAuth } from '@/lib/auth';
const irocLogoFallback = `${import.meta.env.BASE_URL}iroc-new-logo.svg`;
import { useLanguage } from '@/contexts/LanguageContext';
import { LogOut, ChevronLeft, Globe } from 'lucide-react';
import { BottomNav } from '@/components/BottomNav';
import { InstallBanner } from '@/components/InstallBanner';

export function Layout({
  children,
  title,
  backTo,
}: {
  children: ReactNode;
  title: string;
  backTo?: string;
}) {
  const { logout } = useAuth();
  const [, setLocation] = useLocation();
  const { language, toggleLanguage } = useLanguage();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-50 selection:bg-primary/20">
      {/* ── Glassmorphism header ── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl text-slate-900 border-b border-slate-200/50"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex items-center h-14 px-4 max-w-2xl mx-auto gap-3">
          {/* Left: back button OR logo */}
          {backTo ? (
            <button
              className="text-slate-900 bg-slate-100 hover:bg-slate-200 w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors -ml-1"
              onClick={() => setLocation(backTo)}
              aria-label="Back"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : (
            <Link href="/dashboard" className="flex items-center">
              <img
                src={irocLogoFallback}
                alt="iROC GmbH — Innovative & Regenerative medical Oriented Consultation"
                className="h-10 w-[190px] object-contain object-left"
              />
            </Link>
          )}

          {/* Title — grows to fill space, centered visually if possible */}
          <h1 className="flex-1 font-bold text-lg tracking-tight truncate text-slate-900 text-center">
            {backTo ? title : ''}
          </h1>

          {/* Right controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              className="text-slate-600 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 h-9 px-3 rounded-full font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5 transition-colors"
              onClick={toggleLanguage}
              title={language === 'DE' ? 'Switch to English' : 'Zu Deutsch wechseln'}
            >
              <Globe className="w-3.5 h-3.5" />
              {language}
            </button>
            <button
              className="text-slate-600 bg-slate-100 hover:bg-slate-200 hover:text-red-600 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
              onClick={logout}
              title={language === 'DE' ? 'Abmelden' : 'Logout'}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <main
        className="flex-1 w-full max-w-2xl mx-auto px-4"
        style={{
          paddingTop: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
          paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        {children}
      </main>

      {/* ── Bottom navigation ── */}
      <BottomNav />

      {/* ── PWA install guide ── */}
      <InstallBanner />
    </div>
  );
}
