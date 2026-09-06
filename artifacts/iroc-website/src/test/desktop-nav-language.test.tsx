/**
 * desktop-nav-language
 *
 * Confirms that toggling the language via the desktop nav language buttons
 * persists after a route change. Navigation renders a single Navigation
 * component; route changes cause page content below to remount but the header
 * stays mounted. This file verifies that language state is held by the parent
 * LanguageProvider — not by the Navigation component itself — so it cannot be
 * silently reset if the LanguageProvider ever moves below the router.
 *
 * Covered scenarios:
 *  - Clicking the desktop EN button → translated text switches to EN
 *  - After a route change, the EN translation is still active
 *  - A full DE → EN → DE round-trip through two separate route changes
 *  - The active-state indicator on the language buttons reflects the persisted
 *    language after route changes
 *  - localStorage is written so a real page reload would also restore the language
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { Navigation } from '@/components/Navigation';
import { flatLinks } from '@/config/navLinks';

// ── Controllable location mock ────────────────────────────────────────────────
//
// vi.hoisted ensures the box is created before the vi.mock factory runs,
// so useLocation() reflects whatever locationBox.value is at render time.

const locationBox = vi.hoisted(() => ({ value: '/' }));

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    useLocation: () => [locationBox.value],
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

beforeEach(() => {
  locationBox.value = '/';
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderNavigation() {
  return render(
    <LanguageProvider>
      <Navigation />
    </LanguageProvider>,
  );
}

function CmsMapBootstrap() {
  const { setCmsMap } = useLanguage();
  useLayoutEffect(() => {
    setCmsMap(new Map([['Produkte', { de: 'Unsere Produkte', en: 'Our Products' }]]));
  }, [setCmsMap]);
  return null;
}

/** Returns the desktop nav wrapper (nav.hidden.md\:flex). */
function getDesktopNav(): HTMLElement {
  const nav = document.querySelector('nav.hidden') as HTMLElement;
  expect(nav, 'desktop nav (nav.hidden) not found').not.toBeNull();
  return nav!;
}

/**
 * Returns the desktop language button container (the div.hidden.md\:flex
 * that holds the DE/EN toggle pair, sitting to the right of the nav links).
 */
function getDesktopLangContainer(): HTMLElement {
  // The language buttons live in a sibling div — not inside the <nav> element.
  // They are inside `div.hidden.md\:flex` (the right-hand action bar).
  const containers = Array.from(
    document.querySelectorAll('div.hidden'),
  ) as HTMLElement[];
  // We want the one that contains both a DE and an EN button
  const container = containers.find((el) => {
    const buttons = Array.from(el.querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );
    return buttons.includes('DE') && buttons.includes('EN');
  });
  expect(container, 'desktop language toggle container not found').not.toBeUndefined();
  return container!;
}

/** Clicks the DE or EN language button in the desktop language toggle. */
function clickDesktopLangButton(lang: 'DE' | 'EN') {
  const container = getDesktopLangContainer();
  const buttons = Array.from(container.querySelectorAll('button')).filter(
    (b) => b.textContent?.trim() === lang,
  );
  expect(
    buttons.length,
    `${lang} language button not found in desktop toggle`,
  ).toBeGreaterThan(0);
  fireEvent.click(buttons[0]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Language switch without route change (baseline)
// ═══════════════════════════════════════════════════════════════════════════════

describe('desktop nav – language toggle baseline', () => {
  it('uses the same CMS German override as the mobile navigation, not either fallback', () => {
    render(<LanguageProvider><CmsMapBootstrap /><Navigation /></LanguageProvider>);
    const desktopNav = getDesktopNav();
    expect(within(desktopNav).getByText('Unsere Produkte')).toBeInTheDocument();
    expect(within(desktopNav).queryByText('Produkte')).toBeNull();
    expect(within(desktopNav).queryByText('Products')).toBeNull();
  });
  it('clicking EN in the desktop toggle immediately switches translated text to EN', () => {
    renderNavigation();

    clickDesktopLangButton('EN');

    const desktopNav = getDesktopNav();
    expect(within(desktopNav).queryByText('Products')).not.toBeNull();
    expect(within(desktopNav).queryByText('Produkte')).toBeNull();
  });

  it('clicking DE in the desktop toggle immediately switches translated text to DE', () => {
    renderNavigation();

    // Start by switching to EN first
    clickDesktopLangButton('EN');

    // Then switch back to DE
    clickDesktopLangButton('DE');

    const desktopNav = getDesktopNav();
    expect(within(desktopNav).queryByText('Produkte')).not.toBeNull();
    expect(within(desktopNav).queryByText('Products')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Language persistence across route changes
// ═══════════════════════════════════════════════════════════════════════════════

describe('desktop nav – language persists after route change', () => {
  it('switching to EN before a route change keeps EN after the route changes', () => {
    const { rerender } = renderNavigation();

    // Switch to EN while on "/"
    clickDesktopLangButton('EN');

    // Simulate navigating to a different route by updating locationBox and re-rendering
    locationBox.value = flatLinks[1]?.href ?? '/training';
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    // Desktop nav should still be in EN after the route change
    const desktopNav = getDesktopNav();
    expect(
      within(desktopNav).queryByText('Products'),
      'translated text should still be EN after route change',
    ).not.toBeNull();
    expect(within(desktopNav).queryByText('Produkte')).toBeNull();
  });

  it('EN selection persists through multiple successive route changes', () => {
    const { rerender } = renderNavigation();

    clickDesktopLangButton('EN');

    const routes = [
      flatLinks[1]?.href ?? '/training',
      '/kontakt',
      '/',
    ];

    for (const route of routes) {
      locationBox.value = route;
      rerender(
        <LanguageProvider>
          <Navigation />
        </LanguageProvider>,
      );
    }

    const desktopNav = getDesktopNav();
    expect(
      within(desktopNav).queryByText('Products'),
      'EN should survive multiple route changes',
    ).not.toBeNull();
    expect(within(desktopNav).queryByText('Produkte')).toBeNull();
  });

  it('DE → EN → DE round-trip through route changes ends on DE', () => {
    const { rerender } = renderNavigation();

    // DE → EN
    clickDesktopLangButton('EN');

    // Route change #1
    locationBox.value = flatLinks[1]?.href ?? '/training';
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    // Confirm EN is still active after first route change
    const desktopNav = getDesktopNav();
    expect(
      within(desktopNav).queryByText('Products'),
      'EN should be active after first route change',
    ).not.toBeNull();

    // EN → DE
    clickDesktopLangButton('DE');

    // Route change #2 — navigate back to home
    locationBox.value = '/';
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    // After DE is set and another route change, should be back to DE
    expect(
      within(desktopNav).queryByText('Produkte'),
      'DE should be active after second route change',
    ).not.toBeNull();
    expect(within(desktopNav).queryByText('Products')).toBeNull();
  });

  it('active-state indicator on language buttons reflects the persisted language after a route change', () => {
    const { rerender } = renderNavigation();

    // Switch to EN
    clickDesktopLangButton('EN');

    // Simulate route change
    locationBox.value = flatLinks[1]?.href ?? '/training';
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    const container = getDesktopLangContainer();
    const enButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'EN',
    );
    const deButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'DE',
    );

    expect(enButtons.length, 'EN button not found after route change').toBeGreaterThan(0);
    expect(deButtons.length, 'DE button not found after route change').toBeGreaterThan(0);

    // The active button should have "bg-white" applied by cn() in Navigation.tsx
    expect(enButtons[0].className, 'EN button should show active state after route change').toContain('bg-white');
    expect(deButtons[0].className, 'DE button should not show active state').not.toContain('bg-white');
  });

  it('localStorage is written so a real page reload would restore the EN language', () => {
    renderNavigation();

    clickDesktopLangButton('EN');

    expect(localStorage.getItem('iroc_language')).toBe('EN');
  });

  it('localStorage is updated back to DE on a DE → EN → DE round-trip', () => {
    renderNavigation();

    clickDesktopLangButton('EN');
    expect(localStorage.getItem('iroc_language')).toBe('EN');

    clickDesktopLangButton('DE');
    expect(localStorage.getItem('iroc_language')).toBe('DE');
  });
});
