/**
 * language-localstorage-restore
 *
 * Confirms that LanguageProvider restores the user's last-chosen language from
 * localStorage on mount — i.e. that the initialization useEffect in
 * LanguageContext.tsx (lines 138–143) works end-to-end.
 *
 * If that effect is ever accidentally removed, the language would silently
 * revert to DE for all returning EN-speaking users.
 *
 * Covered scenarios:
 *  - localStorage pre-set to 'EN' → provider renders in EN from the very first
 *    render, without the user clicking anything
 *  - localStorage pre-set to 'DE' → provider renders in DE
 *  - localStorage is empty → provider defaults to DE
 *  - localStorage contains an unrecognised value → provider defaults to DE
 */

import { describe, it, expect, vi } from 'vitest';
import { render, within } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Navigation } from '@/components/Navigation';

// ── Mock wouter so Navigation renders without a real router ───────────────────

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    useLocation: () => ['/'],
    Link: ({
      children,
      href,
      onClick,
      className,
    }: {
      children: React.ReactNode;
      href: string;
      onClick?: () => void;
      className?: string;
    }) => (
      <a href={href} onClick={onClick} className={className}>
        {children}
      </a>
    ),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderWithLocalStorage(storedValue: string | null) {
  // setup.ts calls localStorage.clear() before every test, so we start clean.
  if (storedValue !== null) {
    localStorage.setItem('iroc_language', storedValue);
  }
  return render(
    <LanguageProvider>
      <Navigation />
    </LanguageProvider>,
  );
}

/** Returns the desktop nav element (nav.hidden.md:flex). */
function getDesktopNav(): HTMLElement {
  const nav = document.querySelector('nav.hidden') as HTMLElement;
  expect(nav, 'desktop nav (nav.hidden) not found').not.toBeNull();
  return nav!;
}

// ═══════════════════════════════════════════════════════════════════════════════
// localStorage bootstrap tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('LanguageProvider – localStorage bootstrap on mount', () => {
  it('renders in EN from the first render when localStorage has EN', () => {
    renderWithLocalStorage('EN');

    const desktopNav = getDesktopNav();
    expect(
      within(desktopNav).queryByText('Products'),
      'desktop nav should show English "Products" immediately',
    ).not.toBeNull();
    expect(
      within(desktopNav).queryByText('Produkte'),
      'desktop nav must not show German "Produkte" when EN is stored',
    ).toBeNull();
  });

  it('renders in DE from the first render when localStorage has DE', () => {
    renderWithLocalStorage('DE');

    const desktopNav = getDesktopNav();
    expect(
      within(desktopNav).queryByText('Produkte'),
      'desktop nav should show German "Produkte" immediately',
    ).not.toBeNull();
    expect(
      within(desktopNav).queryByText('Products'),
      'desktop nav must not show English "Products" when DE is stored',
    ).toBeNull();
  });

  it('defaults to DE when localStorage is empty', () => {
    renderWithLocalStorage(null); // nothing written — setup.ts already cleared storage

    const desktopNav = getDesktopNav();
    expect(
      within(desktopNav).queryByText('Produkte'),
      'desktop nav should default to German "Produkte" when localStorage is empty',
    ).not.toBeNull();
    expect(within(desktopNav).queryByText('Products')).toBeNull();
  });

  it('defaults to DE when localStorage contains an unrecognised value', () => {
    renderWithLocalStorage('FR'); // not a valid Language

    const desktopNav = getDesktopNav();
    expect(
      within(desktopNav).queryByText('Produkte'),
      'desktop nav should fall back to DE for an unrecognised stored value',
    ).not.toBeNull();
    expect(within(desktopNav).queryByText('Products')).toBeNull();
  });
});
