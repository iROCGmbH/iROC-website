import { Link, useLocation } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/button';
import logoNew from '../assets/iroc-new-logo.svg';
import { Menu, X, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { flatLinks, productLinks, serviceLinks } from '@/config/navLinks';

/**
 * Strips a trailing slash from a pathname so active-link comparisons work
 * whether or not the browser or router preserves the slash.
 * The root "/" is left intact so the Home link always matches.
 */
function normalizePath(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function Navigation() {
  const { t, language, setLanguage } = useLanguage();
  const { isAuthenticated } = useAuth();
  const [rawLocation] = useLocation();
  // Normalize once so every comparison below is trailing-slash-tolerant.
  const location = normalizePath(rawLocation);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const productsRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (productsRef.current && !productsRef.current.contains(e.target as Node)) {
        setProductsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Close overlays on route change
  useEffect(() => {
    setProductsOpen(false);
    setMobileMenuOpen(false);
  }, [location]);

  // History traversal can restore a document before the router has published
  // its next pathname. Close immediately on popstate as well.
  useEffect(() => {
    const closeHistoryOverlays = () => {
      setProductsOpen(false);
      setMobileMenuOpen(false);
    };
    window.addEventListener('popstate', closeHistoryOverlays);
    return () => window.removeEventListener('popstate', closeHistoryOverlays);
  }, []);

  const isProductsActive =
    productLinks.some((l) => l.href === location) ||
    (location === '/order' && typeof window !== 'undefined' && window.location.search.includes('service='));

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-20 flex items-center justify-between">
        <Link href="/">
            <div className="h-[72px] w-[220px] flex items-center">
              <img
                src={logoNew}
                alt="iROC GmbH — Innovative & Regenerative medical Oriented Consultation"
                className="h-14 w-full object-contain object-left"
              />
            </div>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-6">
          {/* Home */}
          <Link href="/" className={cn(
            "text-sm font-medium transition-colors hover:text-primary",
            location === '/' ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
          )}>
            {t(flatLinks[0].labelDE, flatLinks[0].labelEN)}
          </Link>

          {/* Products + Services dropdown */}
          <div className="relative" ref={productsRef}>
            <button
              onClick={() => setProductsOpen((o) => !o)}
              className={cn(
                "flex items-center gap-1 text-sm font-medium transition-colors hover:text-primary",
                isProductsActive ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
              )}
            >
              {t('Produkte', 'Products')}
              <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", productsOpen && "rotate-180")} />
            </button>

            {productsOpen && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-72 bg-white rounded-xl shadow-xl border overflow-hidden z-50">
                {/* Products */}
                <div className="px-4 pt-3 pb-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                    {t('Produkte', 'Products')}
                  </p>
                </div>
                {productLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setProductsOpen(false)}
                    className="flex flex-col px-4 py-2.5 hover:bg-primary/5 transition-colors"
                  >
                    <span className="text-sm font-semibold text-foreground">{t(l.labelDE, l.labelEN)}</span>
                    <span className="text-xs text-muted-foreground">{t(l.subDE ?? '', l.subEN ?? '')}</span>
                  </Link>
                ))}

                {/* Divider */}
                <div className="mx-4 my-2 border-t" />

                {/* Services */}
                <div className="px-4 pb-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                    {t('Services', 'Services')}
                  </p>
                </div>
                {serviceLinks.map((l) => {
                  const Icon = l.icon;
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setProductsOpen(false)}
                      className="flex items-start gap-3 px-4 py-2.5 hover:bg-primary/5 transition-colors"
                    >
                      <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <span className="text-sm font-semibold text-foreground block">{t(l.labelDE, l.labelEN)}</span>
                        <span className="text-xs text-muted-foreground">{t(l.subDE ?? '', l.subEN ?? '')}</span>
                      </div>
                    </Link>
                  );
                })}
                <div className="pb-2" />
              </div>
            )}
          </div>

          {/* Remaining flat links (skip Home which is index 0) */}
          {flatLinks.slice(1).map((link) => (
            <Link key={link.href} href={link.href} className={cn(
              "text-sm font-medium transition-colors hover:text-primary",
              location === link.href ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
            )}>
              {t(link.labelDE, link.labelEN)}
            </Link>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-4">
          <div className="flex bg-muted rounded-md p-1">
            <button
              onClick={() => setLanguage('DE')}
              // eslint-disable-next-line no-restricted-syntax -- active-state styling for language toggle button, not user-visible text
              className={cn("px-2 py-1 text-xs font-semibold rounded-sm transition-colors", language === 'DE' ? "bg-white shadow-sm text-primary" : "text-muted-foreground")}
            >
              DE
            </button>
            <button
              onClick={() => setLanguage('EN')}
              // eslint-disable-next-line no-restricted-syntax -- active-state styling for language toggle button, not user-visible text
              className={cn("px-2 py-1 text-xs font-semibold rounded-sm transition-colors", language === 'EN' ? "bg-white shadow-sm text-primary" : "text-muted-foreground")}
            >
              EN
            </button>
          </div>

          <Button asChild variant="outline" size="sm" className="font-semibold text-primary border-primary/20 hover:bg-primary/5">
            <Link href={isAuthenticated ? "/portal" : "/login"}>
              {isAuthenticated ? t('Zum Portal', 'Go to Portal') : t('Anmelden', 'Log in')}
            </Link>
          </Button>
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden p-2 text-primary"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? t('Menü schließen', 'Close menu') : t('Menü öffnen', 'Open menu')}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <div id="mobile-navigation" className="md:hidden border-t bg-white absolute w-full py-4 px-4 flex flex-col gap-1 shadow-lg">
          <Link href="/" onClick={() => setMobileMenuOpen(false)} className={cn(
            "py-2 text-base font-medium transition-colors",
            location === '/' ? "text-primary" : "text-muted-foreground"
          )}>
            {t(flatLinks[0].labelDE, flatLinks[0].labelEN)}
          </Link>

          {/* Products section */}
          <p className={cn(
            "text-xs font-semibold uppercase tracking-widest mt-3 mb-1",
            isProductsActive ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
          )}>
            {t('Produkte', 'Products')}
          </p>
          {productLinks.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMobileMenuOpen(false)} className={cn(
              "py-2 pl-3 text-base font-medium",
              location === l.href ? "text-primary" : "text-muted-foreground"
            )}>
              {t(l.labelDE, l.labelEN)}
            </Link>
          ))}

          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mt-3 mb-1">
            {t('Services', 'Services')}
          </p>
          {serviceLinks.map((l) => {
            const Icon = l.icon;
            return (
              <Link key={l.href} href={l.href} onClick={() => setMobileMenuOpen(false)} className="py-2 pl-3 text-base font-medium text-muted-foreground flex items-center gap-2">
                <Icon className="w-4 h-4 text-primary" />
                {t(l.labelDE, l.labelEN)}
              </Link>
            );
          })}

          <div className="border-t mt-2 pt-2 flex flex-col gap-2">
            {flatLinks.slice(1).map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMobileMenuOpen(false)} className={cn(
                "py-2 text-base font-medium",
                location === link.href ? "text-primary" : "text-muted-foreground"
              )}>
                {t(link.labelDE, link.labelEN)}
              </Link>
            ))}
          </div>

          <div className="flex gap-4 items-center pt-4 border-t">
            <div className="flex bg-muted rounded-md p-1">
              <button
                onClick={() => setLanguage('DE')}
                // eslint-disable-next-line no-restricted-syntax -- active-state styling for language toggle button, not user-visible text
              className={cn("px-3 py-1.5 text-sm font-semibold rounded-sm", language === 'DE' ? "bg-white shadow-sm text-primary" : "text-muted-foreground")}
              >
                DE
              </button>
              <button
                onClick={() => setLanguage('EN')}
                // eslint-disable-next-line no-restricted-syntax -- active-state styling for language toggle button, not user-visible text
                className={cn("px-3 py-1.5 text-sm font-semibold rounded-sm", language === 'EN' ? "bg-white shadow-sm text-primary" : "text-muted-foreground")}
              >
                EN
              </button>
            </div>
            <Button asChild variant="default" size="sm" className="w-full">
              <Link href={isAuthenticated ? "/portal" : "/login"} onClick={() => setMobileMenuOpen(false)}>
                {isAuthenticated ? t('Zum Portal', 'Go to Portal') : t('Anmelden', 'Log in')}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
