/**
 * desktop-products-dropdown
 *
 * Verifies that the desktop Products/Services dropdown:
 *   1. Opens when the Products button is clicked.
 *   2. Closes when the user clicks outside the dropdown ref (mousedown).
 *   3. Closes when the user clicks a product link inside the panel.
 *   4. Closes when the user clicks a service link inside the panel.
 *
 * A regression in the productsRef + mousedown useEffect in Navigation.tsx
 * (lines 17–28) will cause tests 2–4 to fail while desktop rendering stays
 * green.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Navigation } from '@/components/Navigation';
import { productLinks, serviceLinks } from '@/config/navLinks';

// ── Shared mocks ──────────────────────────────────────────────────────────────

/**
 * Hoisted mutable location so individual tests can change the path and
 * trigger a re-render that exercises the useEffect([location]) close path.
 */
const mockLocation = vi.hoisted(() => ({ path: '/' }));

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    useLocation: () => [mockLocation.path],
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
  // Reset location so tests start at root by default
  mockLocation.path = '/';
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

/**
 * Returns the desktop Products toggle button.
 * It lives inside nav.hidden.md:flex and contains the text "Produkte" / "Products".
 */
function getDesktopProductsButton(): HTMLButtonElement {
  // The desktop nav is hidden on mobile (hidden md:flex). We find the button by
  // its text content inside that nav.
  const desktopNav = document.querySelector('nav.hidden') as HTMLElement;
  expect(desktopNav, 'desktop nav not found').not.toBeNull();

  const btn = Array.from(desktopNav.querySelectorAll('button')).find(
    (b) => b.textContent?.includes('Produkte') || b.textContent?.includes('Products'),
  ) as HTMLButtonElement | undefined;

  expect(btn, 'desktop Products toggle button not found').not.toBeUndefined();
  return btn!;
}

/**
 * Opens the desktop Products dropdown and returns the panel element.
 */
function openDesktopDropdown(): Element {
  const btn = getDesktopProductsButton();
  fireEvent.click(btn);

  // The dropdown panel is the absolute-positioned div that appears after clicking
  const panel = document.querySelector('nav.hidden div[class*="absolute"]') as Element;
  expect(panel, 'dropdown panel not found after opening').not.toBeNull();
  return panel;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Desktop dropdown — initial state (must be closed on first render)
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – desktop Products dropdown initial state', () => {
  it('productsOpen is false on first render: dropdown panel is absent from the DOM', () => {
    renderNavigation();

    // The desktop nav wrapper is always present.
    const desktopNav = document.querySelector('nav.hidden') as HTMLElement;
    expect(desktopNav, 'desktop nav not found').not.toBeNull();

    // The dropdown panel is only rendered when productsOpen === true.
    // If useState were initialised with true the panel would be in the DOM here.
    const panel = desktopNav.querySelector('div[class*="absolute"]');
    expect(
      panel,
      'dropdown panel must not be present on initial render (productsOpen initial state must be false)',
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile menu — initial state (must be closed on first render)
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – mobile menu initial state', () => {
  it('mobileMenuOpen is false on first render: mobile overlay is absent from the DOM', () => {
    renderNavigation();

    // The overlay is only rendered when mobileMenuOpen === true. The mobile
    // toggle itself is a button, so target the overlay's distinctive div classes.
    const mobileOverlay = document.querySelector(
      'div.md\\:hidden.border-t.bg-white.absolute',
    );
    expect(
      mobileOverlay,
      'mobile overlay must not be present on initial render (mobileMenuOpen initial state must be false)',
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Desktop dropdown — open / closed state
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – desktop Products dropdown open/close', () => {
  it('dropdown panel is not in the DOM before the Products button is clicked', () => {
    renderNavigation();
    const desktopNav = document.querySelector('nav.hidden') as HTMLElement;
    expect(desktopNav).not.toBeNull();
    expect(desktopNav.querySelector('div[class*="absolute"]')).toBeNull();
  });

  it('clicking the Products button shows the dropdown panel', () => {
    renderNavigation();
    const btn = getDesktopProductsButton();
    fireEvent.click(btn);
    const panel = document.querySelector('nav.hidden div[class*="absolute"]');
    expect(panel, 'dropdown panel should appear after clicking Products button').not.toBeNull();
  });

  it('clicking the Products button a second time toggles the dropdown closed', () => {
    renderNavigation();
    const btn = getDesktopProductsButton();
    fireEvent.click(btn); // open
    expect(document.querySelector('nav.hidden div[class*="absolute"]')).not.toBeNull();
    fireEvent.click(btn); // close
    expect(document.querySelector('nav.hidden div[class*="absolute"]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Desktop dropdown — closes on outside click (mousedown)
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – desktop Products dropdown closes on outside click', () => {
  it('mousedown outside the productsRef closes the dropdown', () => {
    renderNavigation();
    openDesktopDropdown();

    // Fire a mousedown on document.body — entirely outside the nav ref
    fireEvent.mouseDown(document.body);

    expect(
      document.querySelector('nav.hidden div[class*="absolute"]'),
      'dropdown should close after mousedown outside the ref',
    ).toBeNull();
  });

  it('mousedown inside the dropdown does NOT close it', () => {
    renderNavigation();
    const panel = openDesktopDropdown();

    // Fire mousedown on a node inside the panel
    fireEvent.mouseDown(panel);

    expect(
      document.querySelector('nav.hidden div[class*="absolute"]'),
      'dropdown should remain open after mousedown inside the panel',
    ).not.toBeNull();
  });

  it('mousedown on the Products button itself (inside ref) does not close via outside handler', () => {
    renderNavigation();
    openDesktopDropdown();
    const btn = getDesktopProductsButton();

    // mousedown on the button (inside ref) — the outside handler should not fire
    fireEvent.mouseDown(btn);

    // The dropdown may still be open (button is inside the ref, so outside-handler
    // won't close it). State may toggle via click separately, but mousedown alone
    // on the button should not trigger the outside-close path.
    // We just confirm no crash and the test can observe the result deterministically.
    // (The toggle button's click handler will close it on a full click, but here
    //  we only fire mousedown, so the panel remains open.)
    expect(
      document.querySelector('nav.hidden div[class*="absolute"]'),
      'mousedown on the Products button (inside ref) should not close via outside handler',
    ).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Desktop dropdown — closes when a product or service link is clicked
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – desktop Products dropdown closes on link click', () => {
  it('clicking a product link closes the dropdown', () => {
    renderNavigation();
    openDesktopDropdown();

    const panel = document.querySelector('nav.hidden div[class*="absolute"]')!;
    const anchor = panel.querySelector(
      `a[href="${productLinks[0].href}"]`,
    ) as HTMLAnchorElement;
    expect(anchor, `product link ${productLinks[0].href} not found in desktop dropdown`).not.toBeNull();

    fireEvent.click(anchor);

    expect(
      document.querySelector('nav.hidden div[class*="absolute"]'),
      'dropdown should close after clicking a product link',
    ).toBeNull();
  });

  it('clicking a service link closes the dropdown', () => {
    renderNavigation();
    openDesktopDropdown();

    const panel = document.querySelector('nav.hidden div[class*="absolute"]')!;
    const anchor = panel.querySelector(
      `a[href="${serviceLinks[0].href}"]`,
    ) as HTMLAnchorElement;
    expect(anchor, `service link ${serviceLinks[0].href} not found in desktop dropdown`).not.toBeNull();

    fireEvent.click(anchor);

    expect(
      document.querySelector('nav.hidden div[class*="absolute"]'),
      'dropdown should close after clicking a service link',
    ).toBeNull();
  });

  it('all product links are present in the desktop dropdown panel', () => {
    renderNavigation();
    const panel = openDesktopDropdown();

    for (const link of productLinks) {
      const anchor = panel.querySelector(`a[href="${link.href}"]`);
      expect(anchor, `product link ${link.href} not found in desktop dropdown`).not.toBeNull();
    }
  });

  it('all service links are present in the desktop dropdown panel', () => {
    renderNavigation();
    const panel = openDesktopDropdown();

    for (const link of serviceLinks) {
      const anchor = panel.querySelector(`a[href="${link.href}"]`);
      expect(anchor, `service link ${link.href} not found in desktop dropdown`).not.toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Desktop dropdown — closes on route change
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – desktop Products dropdown closes on route change', () => {
  it('dropdown closes when useLocation returns a new path via re-render', () => {
    // Start at root so the dropdown mock location is '/'
    mockLocation.path = '/';
    const { rerender } = renderNavigation();

    // Open the dropdown
    openDesktopDropdown();
    expect(
      document.querySelector('nav.hidden div[class*="absolute"]'),
      'dropdown should be open before navigation',
    ).not.toBeNull();

    // Simulate a route change: update the location the hook returns, then
    // re-render so Navigation's useEffect([location]) fires and closes the panel.
    mockLocation.path = '/about';
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    expect(
      document.querySelector('nav.hidden div[class*="absolute"]'),
      'dropdown should close after navigating to a new route',
    ).toBeNull();
  });

  it('dropdown stays closed on a second route change if it was already closed', () => {
    mockLocation.path = '/';
    const { rerender } = renderNavigation();

    // Navigate without ever opening the dropdown — should not crash
    mockLocation.path = '/kontakt';
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    expect(
      document.querySelector('nav.hidden div[class*="absolute"]'),
      'dropdown should remain closed after route change when it was never opened',
    ).toBeNull();
  });
});
