import { Link } from 'wouter';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/contexts/LanguageContext';
import { usePortalSettings } from '@/hooks/use-portal-settings';
import { Layout } from '@/components/layout';
import { BookOpen, FileText, ShoppingCart, GraduationCap, ArrowRight } from 'lucide-react';

const MENU_ITEMS = [
  {
    title: { de: 'Bestellung aufgeben', en: 'Place Order' },
    description: {
      de: 'Instrumente & Verbrauchsmaterialien',
      en: 'Instruments & Supplies',
    },
    href: '/order',
    icon: ShoppingCart,
    color: 'bg-primary text-white',
    iconColor: 'text-white',
    featured: true,
  },
  {
    title: { de: 'Schulung', en: 'Training' },
    description: {
      de: 'Anmeldung & Termine',
      en: 'Registration & Dates',
    },
    href: '/training',
    icon: GraduationCap,
    color: 'bg-violet-50 hover:bg-violet-100',
    iconColor: 'text-violet-600',
    featured: false,
  },
  {
    title: { de: 'Dokumente & Lehrportal', en: 'Docs & Teaching' },
    description: {
      de: 'Videos, Präsentationen, Rechnungen',
      en: 'Videos, Presentations, Invoices',
    },
    href: '/resources',
    icon: BookOpen,
    color: 'bg-blue-50 hover:bg-blue-100',
    iconColor: 'text-blue-600',
    featured: false,
  },
];

export default function Dashboard() {
  const { customer } = useAuth();
  const { language, t } = useLanguage();
  const lang = language === 'DE' ? 'de' : 'en';
  const { data: portalSettings } = usePortalSettings();

  const welcomeText =
    (language === 'DE'
      ? portalSettings?.portal_welcome_de
      : portalSettings?.portal_welcome_en) || t('Guten Tag', 'Good day');
  const subtitleText =
    language === 'DE'
      ? portalSettings?.portal_subtitle_de
      : portalSettings?.portal_subtitle_en;

  // Build display name from separate fields
  const displayName = [customer?.title, customer?.lastName]
    .filter(Boolean)
    .join(' ');

  return (
    <Layout title={t('Home', 'Home')}>
      {/* Large Greeting Header */}
      <div className="mb-8 pt-4">
        <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight leading-tight">
          {welcomeText}{displayName ? `,\n${displayName}` : ''}
        </h2>
        <p className="text-base text-slate-500 mt-2 font-medium">
          {subtitleText || t('Willkommen in der iROC app', 'Welcome to the iROC app')}
        </p>
      </div>

      {/* Main Actions Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MENU_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block group relative overflow-hidden rounded-3xl transition-all duration-300 active:scale-[0.98] ${
              item.featured
                ? 'sm:col-span-2 shadow-lg shadow-primary/20'
                : 'shadow-sm border border-slate-100'
            } ${item.color}`}
          >
            <div className={`p-6 sm:p-8 flex flex-col h-full ${item.featured ? 'min-h-[140px]' : 'min-h-[160px]'}`}>
              <div className="flex items-start justify-between">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 mb-4 ${
                  item.featured ? 'bg-white/20' : 'bg-white shadow-sm'
                }`}>
                  <item.icon className={`w-6 h-6 ${item.iconColor}`} />
                </div>
                {item.featured && (
                  <ArrowRight className="w-6 h-6 text-white/70 group-hover:text-white transition-colors" />
                )}
              </div>

              <div className="mt-auto">
                <h3 className={`font-bold text-xl tracking-tight mb-1 ${
                  item.featured ? 'text-white' : 'text-slate-900'
                }`}>
                  {item.title[lang]}
                </h3>
                <p className={`text-sm font-medium ${
                  item.featured ? 'text-white/80' : 'text-slate-500'
                }`}>
                  {item.description[lang]}
                </p>
              </div>
            </div>

            {/* Decorative background element for featured card */}
            {item.featured && (
              <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-white/5 rounded-full blur-3xl pointer-events-none" />
            )}
          </Link>
        ))}
      </div>

      {/* Quick Access to Invoices specifically */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-900">{t('Schnellzugriff', 'Quick Access')}</h3>
        </div>
        <Link href="/invoices" className="block active:scale-[0.98] transition-transform">
          <div className="bg-white border border-slate-100 rounded-3xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center shrink-0">
              <FileText className="w-6 h-6 text-emerald-600" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-slate-900">{t('Meine Rechnungen', 'My Invoices')}</h4>
              <p className="text-sm font-medium text-slate-500">{t('Verlauf einsehen', 'View history')}</p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-300" />
          </div>
        </Link>
      </div>
    </Layout>
  );
}
