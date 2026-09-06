import { Suspense, lazy, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PAGE_LINKS } from '@/config/navLinks';
import { loadSpirecutCmsContent } from '@/i18n';
import { useTranslation } from 'react-i18next';
import Chatbot from '@/components/Chatbot';
import { ScrollRestoration } from '@/components/ScrollRestoration';
import { LocalizedDatePickerProvider } from '../../../lib/localized-date-picker/src';
import { resolveSpirecutLegacyRoute } from '@workspace/spirecut-shared';

// Non-nav utility pages – these are not listed in PAGE_LINKS because they
// don't appear in the navigation or footer, so they're declared here instead.
const HowItWorks = lazy(() => import('@/pages/HowItWorks'));
const Impressum = lazy(() => import('@/pages/Impressum'));
const Datenschutz = lazy(() => import('@/pages/Datenschutz'));
const Admin = lazy(() => import('@/pages/Admin'));
const NotFound = lazy(() => import('@/pages/not-found'));

function LegacyRouteRedirects() {
  const [location, navigate] = useLocation();

  useEffect(() => {
    const destination = resolveSpirecutLegacyRoute(location);

    if (destination && destination !== location) {
      navigate(`${destination}${window.location.search}`, { replace: true });
    }
  }, [location, navigate]);

  return null;
}

function Router() {
  return (
    <Layout>
      <Suspense fallback={<LoadingSpinner />}>
        <Switch>
          {/* Nav-linked pages – derived automatically from PAGE_LINKS */}
          {PAGE_LINKS.map(({ href, component: Page }) => (
            <Route key={href} path={href} component={Page} />
          ))}

          {/* Non-nav utility/admin pages */}
          <Route path="/so-funktioniert-es" component={HowItWorks} />
          <Route path="/impressum" component={Impressum} />
          <Route path="/datenschutz" component={Datenschutz} />
          <Route path="/admin" component={Admin} />

          {/* Catch-all */}
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

/** Applies CMS-managed SEO values to document meta tags and JSON-LD on every language change. */
function SeoMeta() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    // Title
    const title = 'Spirecut browser APP';
    if (title) document.title = title;

    // <meta name="description">
    const desc = t('seo.description');
    const metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (metaDesc && desc) metaDesc.content = desc;

    // <meta name="keywords">
    const kw = t('seo.keywords');
    const metaKw = document.querySelector<HTMLMetaElement>('meta[name="keywords"]');
    if (metaKw && kw) metaKw.content = kw;

    // Open Graph title / description mirror
    const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
    if (ogTitle && title) ogTitle.content = title;
    const ogDesc = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    if (ogDesc && desc) ogDesc.content = desc;

    // FAQPage JSON-LD
    const faqScript = document.getElementById('faq-schema') as HTMLScriptElement | null;
    if (faqScript) {
      const faqs = [0, 1, 2, 3].map((i) => ({
        '@type': 'Question',
        name: t(`seo.faq.${i}.q`),
        acceptedAnswer: { '@type': 'Answer', text: t(`seo.faq.${i}.a`) },
      }));
      // Append a text node instead of assigning script text through an HTML sink.
      // This keeps locale-specific structured data compatible with Trusted Types.
      faqScript.replaceChildren(document.createTextNode(JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs,
      })));
    }
  }, [t, i18n.language]);

  return null;
}

function App() {
  // Load CMS-overridden content on first mount, falling back to static JSON
  useEffect(() => { loadSpirecutCmsContent(); }, []);

  return (
    <LocalizedDatePickerProvider>
      <TooltipProvider>
        <SeoMeta />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <LegacyRouteRedirects />
          <ScrollRestoration />
          <Router />
        </WouterRouter>
        <Chatbot />
        <Toaster />
      </TooltipProvider>
    </LocalizedDatePickerProvider>
  );
}

export default App;
