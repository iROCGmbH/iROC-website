/**
 * mobile-nav-language
 *
 * Confirms that toggling the language via the mobile nav language buttons
 * persists after the mobile menu panel closes (unmounts). The panel is
 * conditionally rendered so these tests specifically verify that language
 * state lives in the parent LanguageProvider — not inside the panel — and
 * therefore survives the panel's unmount/remount cycle.
 *
 * Covered scenarios:
 *  - Opening the mobile menu, switching to EN, then closing the menu → language stays EN
 *  - Full DE → EN → DE round-trip via the mobile language buttons
 *  - The active-state indicator inside the mobile panel reflects the persisted language
 *    when the panel is reopened after a previous toggle
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { Navigation } from '@/components/Navigation';

// ── Shared mocks ──────────────────────────────────────────────────────────────

const mockLocation = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    useLocation: () => [mockLocation.pathname],
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

afterEach(() => {
  mockLocation.pathname = '/';
  vi.restoreAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderNavigation(pathname = '/') {
  mockLocation.pathname = pathname;
  return render(
    <LanguageProvider>
      <Navigation />
    </LanguageProvider>,
  );
}

/** Clicks the hamburger / X toggle to open or close the mobile menu. */
function clickMobileToggle() {
  const toggle = document.querySelector('button.md\\:hidden') as HTMLButtonElement;
  expect(toggle, 'mobile toggle button not found').not.toBeNull();
  fireEvent.click(toggle);
}

/**
 * Returns the currently-rendered mobile slide-in panel.
 * Must only be called while the menu is open.
 */
function getMobilePanel(): HTMLElement {
  const panel = document.querySelector('div.md\\:hidden') as HTMLElement;
  expect(panel, 'mobile menu panel not found — is it open?').not.toBeNull();
  return panel!;
}

/**
 * Clicks the language button with the given label (DE or EN) inside the
 * mobile panel.
 */
function clickMobileLangButton(lang: 'DE' | 'EN') {
  const panel = getMobilePanel();
  const buttons = Array.from(panel.querySelectorAll('button')).filter(
    (b) => b.textContent?.trim() === lang,
  );
  expect(buttons.length, `${lang} language button not found in mobile panel`).toBeGreaterThan(0);
  fireEvent.click(buttons[0]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// localStorage bootstrap – mobile nav shows the restored language immediately
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Renders LanguageProvider + Navigation with localStorage pre-set to the
 * given value (simulating a page reload after a previous language choice).
 * setup.ts calls localStorage.clear() before every test so each test starts
 * from a clean state.
 */
function renderWithLocalStorage(storedValue: string | null, pathname = '/') {
  if (storedValue !== null) {
    localStorage.setItem('iroc_language', storedValue);
  }
  mockLocation.pathname = pathname;
  return render(
    <LanguageProvider>
      <Navigation />
    </LanguageProvider>,
  );
}

/**
 * Seeds the provider with CMS content before the navigation is opened.
 * This simulates content that was already loaded when a page reload restores
 * the language preference from localStorage.
 */
function CmsMapBootstrap() {
  const { setCmsMap } = useLanguage();

  useLayoutEffect(() => {
    setCmsMap(new Map([['Produkte', { de: 'Unsere Produkte', en: 'Our Products' }]]));
  }, [setCmsMap]);

  return null;
}

describe('mobile nav – localStorage bootstrap on mount (page-reload simulation)', () => {
  it('shows English labels in the mobile panel immediately when EN is stored', () => {
    renderWithLocalStorage('EN');

    // Open the mobile menu — the panel mounts after the language was already restored
    clickMobileToggle();

    const panel = getMobilePanel();
    // The "Products" heading is rendered as a <p> in the mobile panel
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Products',
      ),
      'mobile panel should show "Products" (EN) when EN is stored in localStorage',
    ).toBe(true);
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Produkte',
      ),
      'mobile panel must not show "Produkte" (DE) when EN is stored',
    ).toBe(false);
  });

  it('shows German labels in the mobile panel immediately when DE is stored', () => {
    renderWithLocalStorage('DE');

    clickMobileToggle();

    const panel = getMobilePanel();
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Produkte',
      ),
      'mobile panel should show "Produkte" (DE) when DE is stored in localStorage',
    ).toBe(true);
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Products',
      ),
      'mobile panel must not show "Products" (EN) when DE is stored',
    ).toBe(false);
  });

  it('shows English labels in the mobile panel after reload on a non-home route', () => {
    renderWithLocalStorage('EN', '/training');

    // A hard reload on /training should restore the stored language before
    // opening the mobile panel, just as it does on the home page.
    clickMobileToggle();

    const panel = getMobilePanel();
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Products',
      ),
      'mobile panel should show "Products" (EN) on /training when EN is stored',
    ).toBe(true);
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Produkte',
      ),
      'mobile panel must not show "Produkte" (DE) on /training when EN is stored',
    ).toBe(false);
  });

  it('shows German labels in the mobile panel after reload on a non-home route', () => {
    renderWithLocalStorage('DE', '/training');

    clickMobileToggle();

    const panel = getMobilePanel();
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Produkte',
      ),
      'mobile panel should show "Produkte" (DE) on /training when DE is stored',
    ).toBe(true);
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Products',
      ),
      'mobile panel must not show "Products" (EN) on /training when DE is stored',
    ).toBe(false);
  });

  it('defaults to German when localStorage is empty', () => {
    renderWithLocalStorage(null); // setup.ts already cleared storage

    clickMobileToggle();

    const panel = getMobilePanel();
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Produkte',
      ),
      'mobile panel should default to "Produkte" (DE) when localStorage is empty',
    ).toBe(true);
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Products',
      ),
    ).toBe(false);
  });

  it('EN language button shows active-state when EN is restored from localStorage', () => {
    renderWithLocalStorage('EN');

    clickMobileToggle();

    const panel = getMobilePanel();
    const enButtons = Array.from(panel.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'EN',
    );
    const deButtons = Array.from(panel.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'DE',
    );

    expect(enButtons.length, 'EN button not found in mobile panel').toBeGreaterThan(0);
    expect(deButtons.length, 'DE button not found in mobile panel').toBeGreaterThan(0);

    // The active button carries the "bg-white" class applied by cn() in Navigation.tsx
    expect(
      enButtons[0].className,
      'EN button should carry active-state (bg-white) when EN is restored',
    ).toContain('bg-white');
    expect(
      deButtons[0].className,
      'DE button must not carry active-state when EN is the current language',
    ).not.toContain('bg-white');
  });

  it('shows the CMS English override when EN and CMS content are restored together', () => {
    localStorage.setItem('iroc_language', 'EN');

    render(
      <LanguageProvider>
        <CmsMapBootstrap />
        <Navigation />
      </LanguageProvider>,
    );

    clickMobileToggle();

    const panel = getMobilePanel();
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Our Products',
      ),
      'mobile panel should show the CMS English override when EN is restored',
    ).toBe(true);
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Products',
      ),
      'mobile panel must not show the hardcoded English fallback when a CMS override exists',
    ).toBe(false);
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Produkte',
      ),
      'mobile panel must not show the German label when EN is restored',
    ).toBe(false);
  });

  it('shows the CMS German override when DE and CMS content are restored together', () => {
    localStorage.setItem('iroc_language', 'DE');

    render(
      <LanguageProvider>
        <CmsMapBootstrap />
        <Navigation />
      </LanguageProvider>,
    );

    clickMobileToggle();

    const panel = getMobilePanel();
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Unsere Produkte',
      ),
      'mobile panel should show the CMS German override when DE is restored',
    ).toBe(true);
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Produkte',
      ),
      'mobile panel must not show the hardcoded German fallback when a CMS override exists',
    ).toBe(false);
    expect(
      Array.from(panel.querySelectorAll('p')).some((el) =>
        el.textContent?.trim() === 'Products',
      ),
      'mobile panel must not show the English label when DE is restored',
    ).toBe(false);
  });
});

// Keep coverage for a second deep-linked page separate from the /training
// reload cases above so either route can change without hiding a regression
// in the other.
describe('mobile nav – localStorage bootstrap on the contact page', () => {
  it('shows English labels in the mobile panel immediately when EN is stored', () => {
    renderWithLocalStorage('EN', '/contact');

    clickMobileToggle();

    const panel = getMobilePanel();
    expect(panel).toHaveTextContent('Contact');
    expect(panel).not.toHaveTextContent('Kontakt');
  });

  it('shows German labels in the mobile panel immediately when DE is stored', () => {
    renderWithLocalStorage('DE', '/contact');

    clickMobileToggle();

    const panel = getMobilePanel();
    expect(panel).toHaveTextContent('Kontakt');
    expect(panel).not.toHaveTextContent('Contact');
  });
});

// Keep product detail coverage separate from the home, training, and contact
// reload cases so a nested product route cannot hide a regression in them.
describe('mobile nav – localStorage bootstrap on product detail pages', () => {
  it.each([
    ['/spirecut', 'Spirecut®'],
    ['/ministem', 'MiniStem®'],
  ] as const)(
    'shows English labels immediately after reload on %s when EN is stored',
    (pathname, productLabel) => {
      renderWithLocalStorage('EN', pathname);

      clickMobileToggle();

      const panel = getMobilePanel();
      expect(panel).toHaveTextContent('Products');
      expect(panel).not.toHaveTextContent('Produkte');
      expect(panel).toHaveTextContent(productLabel);
    },
  );

  it.each([
    ['/spirecut', 'Spirecut®'],
    ['/ministem', 'MiniStem®'],
  ] as const)(
    'shows German labels immediately after reload on %s when DE is stored',
    (pathname, productLabel) => {
      renderWithLocalStorage('DE', pathname);

      clickMobileToggle();

      const panel = getMobilePanel();
      expect(panel).toHaveTextContent('Produkte');
      expect(panel).not.toHaveTextContent('Products');
      expect(panel).toHaveTextContent(productLabel);
    },
  );
});

// Keep training detail coverage separate from the overview and other nested
// routes so both deep training paths independently verify language restoration.
describe('mobile nav – localStorage bootstrap on training detail pages', () => {
  it.each(['/training/spirecut', '/training/ministem'])(
    'shows English labels immediately after reload on %s when EN is stored',
    (pathname) => {
      renderWithLocalStorage('EN', pathname);

      clickMobileToggle();

      const panel = getMobilePanel();
      expect(panel).toHaveTextContent('Products');
      expect(panel).not.toHaveTextContent('Produkte');
      expect(within(panel).queryByText('Training', { exact: true })).not.toBeNull();
      expect(within(panel).queryByText('Schulung', { exact: true })).toBeNull();
    },
  );

  it.each(['/training/spirecut', '/training/ministem'])(
    'shows German labels immediately after reload on %s when DE is stored',
    (pathname) => {
      renderWithLocalStorage('DE', pathname);

      clickMobileToggle();

      const panel = getMobilePanel();
      expect(panel).toHaveTextContent('Produkte');
      expect(panel).not.toHaveTextContent('Products');
      expect(within(panel).queryByText('Schulung', { exact: true })).not.toBeNull();
      expect(within(panel).queryByText('Training', { exact: true })).toBeNull();
    },
  );
});

describe('mobile nav – invalid stored language on training detail pages', () => {
  it.each([
    ['/training/spirecut', 'FR'],
    ['/training/ministem', '{malformed'],
  ] as const)('falls back to German on %s when %s is stored', (pathname, stored) => {
    renderWithLocalStorage(stored, pathname);
    clickMobileToggle();

    const panel = getMobilePanel();
    expect(panel).toHaveTextContent('Produkte');
    expect(panel).not.toHaveTextContent('Products');
    expect(within(panel).queryByText('Schulung', { exact: true })).not.toBeNull();
    expect(within(panel).queryByText('Training', { exact: true })).toBeNull();
    expect(localStorage.getItem('iroc_language')).toBe('DE');
  });
});

describe('language preference bootstrap', () => {
  it.each(['DE', 'EN'] as const)('preserves the valid %s preference', (language) => {
    renderWithLocalStorage(language);

    expect(localStorage.getItem('iroc_language')).toBe(language);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Language persistence after menu close
// ═══════════════════════════════════════════════════════════════════════════════

describe('mobile nav – language persists after menu closes', () => {
  it('switching to EN in the mobile panel keeps EN after the panel closes', () => {
    renderNavigation();

    // Open menu, switch language to EN
    clickMobileToggle();
    clickMobileLangButton('EN');

    // Close menu — the mobile panel unmounts
    clickMobileToggle();
    expect(document.querySelector('div.md\\:hidden'), 'panel should be closed').toBeNull();

    // The desktop nav is always rendered; its "Products" label confirms EN is active
    const desktopNav = document.querySelector('nav.hidden.md\\:flex') as HTMLElement;
    expect(desktopNav, 'desktop nav not found').not.toBeNull();
    expect(within(desktopNav).queryByText('Products')).not.toBeNull();
    expect(within(desktopNav).queryByText('Produkte')).toBeNull();
  });

  it('EN selection is reflected in localStorage so a page reload would restore it', () => {
    renderNavigation();

    clickMobileToggle();
    clickMobileLangButton('EN');
    clickMobileToggle(); // close

    expect(localStorage.getItem('iroc_language')).toBe('EN');
  });

  it('DE → EN → DE round-trip via mobile nav buttons ends on DE', () => {
    renderNavigation();

    // First toggle: DE → EN
    clickMobileToggle();
    clickMobileLangButton('EN');
    clickMobileToggle(); // close

    // Verify EN is active
    const desktopNav = document.querySelector('nav.hidden.md\\:flex') as HTMLElement;
    expect(within(desktopNav).queryByText('Products')).not.toBeNull();

    // Second toggle: EN → DE
    clickMobileToggle();
    clickMobileLangButton('DE');
    clickMobileToggle(); // close

    // Desktop nav should now be back to German
    expect(within(desktopNav).queryByText('Produkte')).not.toBeNull();
    expect(within(desktopNav).queryByText('Products')).toBeNull();
  });

  it('reopening the menu after a language switch shows the correct active indicator', () => {
    renderNavigation();

    // Switch to EN while menu is open
    clickMobileToggle();
    clickMobileLangButton('EN');

    // Close, then reopen
    clickMobileToggle();
    clickMobileToggle();

    // Inside the freshly-opened panel the EN button should carry the active-state
    // class (bg-white shadow-sm text-primary) and DE should not
    const panel = getMobilePanel();
    const enButtons = Array.from(panel.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'EN',
    );
    const deButtons = Array.from(panel.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === 'DE',
    );

    expect(enButtons.length, 'EN button not found in panel').toBeGreaterThan(0);
    expect(deButtons.length, 'DE button not found in panel').toBeGreaterThan(0);

    // Active button has the "bg-white" class added by cn() in Navigation.tsx
    expect(enButtons[0].className).toContain('bg-white');
    expect(deButtons[0].className).not.toContain('bg-white');
  });

  it('switching language in the mobile panel immediately updates translated text in the panel', () => {
    renderNavigation();
    clickMobileToggle();

    // Default is DE — panel shows "Produkte"
    const panelBefore = getMobilePanel();
    expect(
      Array.from(panelBefore.querySelectorAll('p, span')).some((el) =>
        el.textContent?.includes('Produkte'),
      ),
    ).toBe(true);

    // Switch to EN
    clickMobileLangButton('EN');

    // After switching, the same panel should now show "Products"
    const panelAfter = getMobilePanel();
    expect(
      Array.from(panelAfter.querySelectorAll('p, span')).some((el) =>
        el.textContent?.includes('Products'),
      ),
    ).toBe(true);
  });
});
