import { Link, useLocation } from 'wouter';
import { Home, ShoppingBag, GraduationCap, FileText, User } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePortalSettings } from '@/hooks/use-portal-settings';

interface Tab {
  id: string;
  href: string;
  labelDe: string;
  labelEn: string;
  icon: React.ReactNode;
  activeFor?: string[];
}

const TABS: Tab[] = [
  {
    id: 'dashboard',
    href: '/dashboard',
    labelDe: 'Home',
    labelEn: 'Home',
    icon: <Home className="w-6 h-6" />,
  },
  {
    id: 'order',
    href: '/order',
    labelDe: 'Bestellen',
    labelEn: 'Order',
    icon: <ShoppingBag className="w-6 h-6" />,
  },
  {
    id: 'training',
    href: '/training',
    labelDe: 'Schulung',
    labelEn: 'Training',
    icon: <GraduationCap className="w-6 h-6" />,
  },
  {
    id: 'invoices',
    href: '/invoices',
    labelDe: 'Dokumente',
    labelEn: 'Docs',
    icon: <FileText className="w-6 h-6" />,
    activeFor: ['/invoices', '/resources'],
  },
  {
    id: 'profile',
    href: '/profile',
    labelDe: 'Profil',
    labelEn: 'Profile',
    icon: <User className="w-6 h-6" />,
  },
];

interface NavTabConfig {
  id: string;
  visible: boolean;
}

export function BottomNav() {
  const [location] = useLocation();
  const { language } = useLanguage();
  const { data: settings } = usePortalSettings();

  // Apply admin-configured nav visibility
  let navConfig: NavTabConfig[] | null = null;
  if (settings?.portal_nav_config) {
    try { navConfig = JSON.parse(settings.portal_nav_config); } catch { /* use defaults */ }
  }

  const visibleTabs = TABS.filter(tab => {
    if (!navConfig) return true;
    const cfg = navConfig.find(c => c.id === tab.id);
    return cfg ? cfg.visible !== false : true;
  });

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-xl border-t border-slate-200/50 shadow-sm"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center h-[4.5rem] px-1 max-w-md mx-auto">
        {visibleTabs.map((tab) => {
          const active = (tab.activeFor ?? [tab.href]).some((p) => location === p || location.startsWith(p + '/'));
          return (
            <Link key={tab.href} href={tab.href} className="flex-1 min-w-0 flex justify-center py-2 h-full">
              <div
                className={[
                  'flex flex-col items-center justify-center gap-1 min-w-0 w-full transition-all duration-300',
                  active ? 'text-primary' : 'text-slate-400 hover:text-slate-600',
                ].join(' ')}
              >
                <div
                  className={[
                    'relative flex items-center justify-center transition-all duration-300',
                    active ? 'scale-110' : 'scale-100',
                  ].join(' ')}
                >
                  {tab.icon}
                  {active && (
                    <div className="absolute inset-0 bg-primary/10 rounded-full blur-md -z-10 animate-in fade-in zoom-in duration-300" />
                  )}
                </div>
                <span
                  className={[
                    'text-[10px] font-semibold leading-none tracking-wide text-center whitespace-nowrap transition-all duration-300',
                    active ? 'text-primary' : 'text-slate-500',
                  ].join(' ')}
                >
                  {language === 'DE' ? tab.labelDe : tab.labelEn}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
