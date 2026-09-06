/**
 * desktop-nav-active
 *
 * Confirms that the desktop Navigation bar correctly applies the active-state
 * class ("border-b-2") based on the current route:
 *
 *   1. When the route matches a flat link, that link receives the active class
 *      and the Products button does not.
 *   2. When the route matches a product link, the Products button receives
 *      the active class and no flat link does.
 *   3. When the route matches nothing, no flat link and no Products button
 *      receives the active class.
 *
 * The active class used in Navigation.tsx is "border-b-2" (applied together
 * with "text-primary" when the link is active). We detect it on the rendered
 * anchor elements and the Products toggle button inside the desktop nav
 * (nav.hidden.md\:flex).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Navigation } from '@/components/Navigation';
import { flatLinks, productLinks } from '@/config/navLinks';

// ── Controllable location mock ────────────────────────────────────────────────
//
// vi.hoisted ensures the box is created before the vi.mock factory runs.

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

/** Returns the desktop nav element (nav.hidden). */
function getDesktopNav(): HTMLElement {
  const nav = document.querySelector('nav.hidden') as HTMLElement;
  expect(nav, 'desktop nav (nav.hidden) not found').not.toBeNull();
  return nav;
}

/** Returns the Products toggle button inside the desktop nav. */
function getDesktopProductsButton(): HTMLButtonElement {
  const nav = getDesktopNav();
  const btn = Array.from(nav.querySelectorAll('button')).find(
    (b) => b.textContent?.includes('Produkte') || b.textContent?.includes('Products'),
  ) as HTMLButtonElement | undefined;
  expect(btn, 'desktop Products toggle button not found').not.toBeUndefined();
  return btn!;
}

/**
 * Returns all desktop flat-link anchors (both the Home link at flatLinks[0]
 * and the remaining links rendered by flatLinks.slice(1)).
 */
function getDesktopFlatAnchors(): HTMLAnchorElement[] {
  const nav = getDesktopNav();
  const flatHrefs = new Set(flatLinks.map((l) => l.href));
  return Array.from(nav.querySelectorAll('a')).filter(
    (a) => flatHrefs.has(a.getAttribute('href') ?? ''),
  ) as HTMLAnchorElement[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Flat link active state
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – desktop nav flat link active state', () => {
  it('the Home link is active when the route is "/"', () => {
    locationBox.value = '/';
    renderNavigation();
    const nav = getDesktopNav();
    const homeAnchor = nav.querySelector(`a[href="${flatLinks[0].href}"]`) as HTMLAnchorElement;
    expect(homeAnchor, 'Home anchor not found in desktop nav').not.toBeNull();
    expect(homeAnchor.className, 'Home link should have border-b-2 when route is "/"').toContain('border-b-2');
  });

  it('the Home link is NOT active when the route is a different flat link', () => {
    const otherFlat = flatLinks[1]; // e.g. /training
    locationBox.value = otherFlat.href;
    renderNavigation();
    const nav = getDesktopNav();
    const homeAnchor = nav.querySelector(`a[href="${flatLinks[0].href}"]`) as HTMLAnchorElement;
    expect(homeAnchor, 'Home anchor not found in desktop nav').not.toBeNull();
    expect(homeAnchor.className, 'Home link should NOT be active when route differs').not.toContain('border-b-2');
  });

  it('a non-home flat link is active when the route matches it', () => {
    const target = flatLinks[1]; // e.g. /training
    locationBox.value = target.href;
    renderNavigation();
    const nav = getDesktopNav();
    const anchor = nav.querySelector(`a[href="${target.href}"]`) as HTMLAnchorElement;
    expect(anchor, `anchor for ${target.href} not found in desktop nav`).not.toBeNull();
    expect(anchor.className, `${target.href} link should have border-b-2 when active`).toContain('border-b-2');
  });

  it('a non-home flat link is NOT active when the route does not match it', () => {
    // Route is Home; flatLinks[1] should be inactive
    const inactive = flatLinks[1];
    locationBox.value = '/';
    renderNavigation();
    const nav = getDesktopNav();
    const anchor = nav.querySelector(`a[href="${inactive.href}"]`) as HTMLAnchorElement;
    expect(anchor, `anchor for ${inactive.href} not found in desktop nav`).not.toBeNull();
    expect(anchor.className, `${inactive.href} link should NOT be active when route is /`).not.toContain('border-b-2');
  });

  it('only the matching flat link carries the active class — others do not', () => {
    const active = flatLinks[1];
    locationBox.value = active.href;
    renderNavigation();
    const anchors = getDesktopFlatAnchors();
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? '';
      if (href === active.href) {
        expect(anchor.className, `${href} should be active`).toContain('border-b-2');
      } else {
        expect(anchor.className, `${href} should NOT be active`).not.toContain('border-b-2');
      }
    }
  });

  it('the Products button does NOT carry the active class when the route is a flat link', () => {
    locationBox.value = flatLinks[0].href; // /
    renderNavigation();
    const btn = getDesktopProductsButton();
    expect(btn.className, 'Products button should not be active on a flat route').not.toContain('border-b-2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Products button active state
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – desktop nav Products button active state', () => {
  it('the Products button is active when the route matches a product link', () => {
    const productHref = productLinks[0].href;
    locationBox.value = productHref;
    renderNavigation();
    const btn = getDesktopProductsButton();
    expect(btn.className, `Products button should be active when route is ${productHref}`).toContain('border-b-2');
  });

  it('the Products button is active for every productLink href', () => {
    for (const link of productLinks) {
      locationBox.value = link.href;
      const { unmount } = renderNavigation();
      const btn = getDesktopProductsButton();
      expect(btn.className, `Products button should be active for product route ${link.href}`).toContain('border-b-2');
      unmount();
    }
  });

  it('the Products button is NOT active when the route is a flat link', () => {
    locationBox.value = flatLinks[0].href; // /
    renderNavigation();
    const btn = getDesktopProductsButton();
    expect(btn.className, 'Products button should not be active on home route').not.toContain('border-b-2');
  });

  it('no flat link is active when the route matches a product link', () => {
    locationBox.value = productLinks[0].href;
    renderNavigation();
    const anchors = getDesktopFlatAnchors();
    for (const anchor of anchors) {
      expect(
        anchor.className,
        `flat link ${anchor.getAttribute('href')} should not be active on a product route`,
      ).not.toContain('border-b-2');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-navigation: active state updates correctly across sequential navigations
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – desktop nav active state updates on sequential navigation', () => {
  it('navigating from one flat link to another transfers the active class correctly', () => {
    const first = flatLinks[0]; // /
    const second = flatLinks[1]; // e.g. /training

    locationBox.value = first.href;
    const { rerender } = render(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    // Before navigation: first route is active
    const firstAnchorBefore = getDesktopNav().querySelector(
      `a[href="${first.href}"]`,
    ) as HTMLAnchorElement;
    expect(
      firstAnchorBefore.className,
      `${first.href} should be active before navigation`,
    ).toContain('border-b-2');

    // Navigate to second route
    locationBox.value = second.href;
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    // After navigation: first route loses the active class, second route gains it
    const firstAnchorAfter = getDesktopNav().querySelector(
      `a[href="${first.href}"]`,
    ) as HTMLAnchorElement;
    const secondAnchor = getDesktopNav().querySelector(
      `a[href="${second.href}"]`,
    ) as HTMLAnchorElement;
    expect(
      firstAnchorAfter.className,
      `${first.href} should lose border-b-2 after navigating away`,
    ).not.toContain('border-b-2');
    expect(
      secondAnchor.className,
      `${second.href} should gain border-b-2 after navigating to it`,
    ).toContain('border-b-2');
  });

  it('navigating from a product route to a flat route deactivates Products and activates the flat link', () => {
    const productHref = productLinks[0].href;
    const flatLink = flatLinks[1]; // e.g. /training (non-home flat link)

    // Start at a product route — Products button should be active
    locationBox.value = productHref;
    const { rerender } = render(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    const btnBefore = getDesktopProductsButton();
    expect(
      btnBefore.className,
      `Products button should be active when route is ${productHref}`,
    ).toContain('border-b-2');

    // Navigate to a flat route
    locationBox.value = flatLink.href;
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    // Products button should lose border-b-2
    const btnAfter = getDesktopProductsButton();
    expect(
      btnAfter.className,
      'Products button should lose border-b-2 after navigating to a flat route',
    ).not.toContain('border-b-2');

    // The flat link should gain border-b-2
    const flatAnchor = getDesktopNav().querySelector(
      `a[href="${flatLink.href}"]`,
    ) as HTMLAnchorElement;
    expect(flatAnchor, `anchor for ${flatLink.href} not found in desktop nav`).not.toBeNull();
    expect(
      flatAnchor.className,
      `${flatLink.href} should gain border-b-2 after navigating to it`,
    ).toContain('border-b-2');
  });

  it('navigating from a flat route to a product route deactivates the flat link and activates Products', () => {
    const flatLink = flatLinks[1]; // e.g. /training (non-home flat link)
    const productHref = productLinks[0].href;

    // Start at a flat route — flat link should be active, Products button should not
    locationBox.value = flatLink.href;
    const { rerender } = render(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    const flatAnchorBefore = getDesktopNav().querySelector(
      `a[href="${flatLink.href}"]`,
    ) as HTMLAnchorElement;
    expect(flatAnchorBefore, `anchor for ${flatLink.href} not found in desktop nav`).not.toBeNull();
    expect(
      flatAnchorBefore.className,
      `${flatLink.href} should be active before navigation`,
    ).toContain('border-b-2');

    const btnBefore = getDesktopProductsButton();
    expect(
      btnBefore.className,
      'Products button should not be active on a flat route',
    ).not.toContain('border-b-2');

    // Navigate to a product route
    locationBox.value = productHref;
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    // Flat link should lose border-b-2
    const flatAnchorAfter = getDesktopNav().querySelector(
      `a[href="${flatLink.href}"]`,
    ) as HTMLAnchorElement;
    expect(
      flatAnchorAfter.className,
      `${flatLink.href} should lose border-b-2 after navigating to a product route`,
    ).not.toContain('border-b-2');

    // Products button should gain border-b-2
    const btnAfter = getDesktopProductsButton();
    expect(
      btnAfter.className,
      `Products button should gain border-b-2 after navigating to ${productHref}`,
    ).toContain('border-b-2');
  });

  it('cycling through all flatLinks in sequence shows only the current route as active', () => {
    locationBox.value = flatLinks[0].href;
    const { rerender } = render(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    const flatHrefs = new Set(flatLinks.map((l) => l.href));

    for (const activeLink of flatLinks) {
      locationBox.value = activeLink.href;
      rerender(
        <LanguageProvider>
          <Navigation />
        </LanguageProvider>,
      );

      const nav = getDesktopNav();
      const anchors = Array.from(nav.querySelectorAll('a')).filter((a) =>
        flatHrefs.has(a.getAttribute('href') ?? ''),
      ) as HTMLAnchorElement[];

      for (const anchor of anchors) {
        const href = anchor.getAttribute('href') ?? '';
        if (href === activeLink.href) {
          expect(
            anchor.className,
            `${href} should carry border-b-2 when it is the current route`,
          ).toContain('border-b-2');
        } else {
          expect(
            anchor.className,
            `${href} should NOT carry border-b-2 when current route is ${activeLink.href}`,
          ).not.toContain('border-b-2');
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// No active state when route matches nothing
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – desktop nav no active state for unknown route', () => {
  it('no flat link carries the active class for an unknown route', () => {
    locationBox.value = '/this-page-does-not-exist';
    renderNavigation();
    const anchors = getDesktopFlatAnchors();
    for (const anchor of anchors) {
      expect(
        anchor.className,
        `flat link ${anchor.getAttribute('href')} should not be active on unknown route`,
      ).not.toContain('border-b-2');
    }
  });

  it('the Products button does not carry the active class for an unknown route', () => {
    locationBox.value = '/this-page-does-not-exist';
    renderNavigation();
    const btn = getDesktopProductsButton();
    expect(btn.className, 'Products button should not be active on unknown route').not.toContain('border-b-2');
  });

  it('neither flat links nor the Products button are active for an unknown route', () => {
    locationBox.value = '/no-such-route';
    renderNavigation();
    const anchors = getDesktopFlatAnchors();
    for (const anchor of anchors) {
      expect(anchor.className).not.toContain('border-b-2');
    }
    const btn = getDesktopProductsButton();
    expect(btn.className).not.toContain('border-b-2');
  });
});
