/**
 * mobile-nav
 *
 * Renders the real Navigation component, opens the mobile slide-in panel,
 * and verifies that every page-group section (flat, product, service) is
 * present and correct — and that hidden entries never appear as nav links.
 *
 * A regression here (e.g. a missing map call or deleted JSX block in the
 * mobile branch of Navigation.tsx) will cause these tests to fail while
 * the desktop tests remain green.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Navigation } from '@/components/Navigation';
import {
  PAGE_LINKS,
  flatLinks,
  productLinks,
  serviceLinks,
} from '@/config/navLinks';

// ── Shared mocks ──────────────────────────────────────────────────────────────

// wouter — Navigation uses useLocation and Link
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

// AuthContext — Navigation reads isAuthenticated
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

/** Opens the mobile slide-in panel by clicking the hamburger toggle button. */
function openMobileMenu() {
  const mobileToggle = document
    .querySelector('button.md\\:hidden') as HTMLButtonElement;
  expect(mobileToggle, 'mobile toggle button not found').not.toBeNull();
  fireEvent.click(mobileToggle);
}

/**
 * Returns the mobile slide-in panel element.
 * The panel has class "md:hidden" and is a div (not a button).
 */
function getMobilePanel(): Element {
  // The panel is the div.md:hidden rendered inside the header when the menu is open.
  const panel = document.querySelector('div.md\\:hidden');
  expect(panel, 'mobile menu panel not found — is it open?').not.toBeNull();
  return panel!;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile menu — flat links
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – mobile menu flat links', () => {
  it('Home link (flatLinks[0]) appears in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const anchor = panel.querySelector(`a[href="${flatLinks[0].href}"]`);
    expect(anchor, `flatLinks[0] (${flatLinks[0].href}) not found in mobile panel`).not.toBeNull();
  });

  it('every flat link href is present in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    for (const link of flatLinks) {
      const anchor = panel.querySelector(`a[href="${link.href}"]`);
      expect(anchor, `flat link ${link.href} not found in mobile panel`).not.toBeNull();
    }
  });

  it('mobile panel flat links count matches flatLinks length', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const flatHrefs = flatLinks.map((l) => l.href);
    const rendered = Array.from(panel.querySelectorAll('a')).filter(
      (a) => flatHrefs.includes(a.getAttribute('href') ?? ''),
    );
    expect(rendered.length).toBe(flatLinks.length);
  });

  it('remaining flat links (flatLinks.slice(1)) are all present in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    for (const link of flatLinks.slice(1)) {
      const anchor = panel.querySelector(`a[href="${link.href}"]`);
      expect(anchor, `remaining flat link ${link.href} missing from mobile panel`).not.toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile menu — product links
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – mobile menu product links', () => {
  it('Products section heading is present in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    // "Produkte" appears as the section heading inside the mobile panel
    const heading = Array.from(panel.querySelectorAll('p, span, h2, h3')).find(
      (el) => el.textContent?.includes('Produkte'),
    );
    expect(heading, 'Products heading not found in mobile panel').not.toBeUndefined();
  });

  it('every productLinks href is present in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    for (const link of productLinks) {
      const anchor = panel.querySelector(`a[href="${link.href}"]`);
      expect(anchor, `product link ${link.href} not found in mobile panel`).not.toBeNull();
    }
  });

  it('mobile panel product link count matches productLinks length', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const productHrefs = productLinks.map((l) => l.href);
    const rendered = Array.from(panel.querySelectorAll('a')).filter(
      (a) => productHrefs.includes(a.getAttribute('href') ?? ''),
    );
    expect(rendered.length).toBe(productLinks.length);
  });

  it('product links are not mixed into the flat section (no shared hrefs)', () => {
    renderNavigation();
    openMobileMenu();
    const flatHrefs = new Set(flatLinks.map((l) => l.href));
    for (const link of productLinks) {
      expect(flatHrefs.has(link.href), `product link ${link.href} incorrectly shares href with flat section`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile menu — service links
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – mobile menu service links', () => {
  it('Services section heading is present in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const heading = Array.from(panel.querySelectorAll('p, span, h2, h3')).find(
      (el) => el.textContent?.includes('Services'),
    );
    expect(heading, 'Services heading not found in mobile panel').not.toBeUndefined();
  });

  it('every serviceLinks href is present in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    for (const link of serviceLinks) {
      const anchor = panel.querySelector(`a[href="${link.href}"]`);
      expect(anchor, `service link ${link.href} not found in mobile panel`).not.toBeNull();
    }
  });

  it('mobile panel service link count matches serviceLinks length', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const serviceHrefs = serviceLinks.map((l) => l.href);
    const rendered = Array.from(panel.querySelectorAll('a')).filter(
      (a) => serviceHrefs.includes(a.getAttribute('href') ?? ''),
    );
    expect(rendered.length).toBe(serviceLinks.length);
  });

  it('service links are not mixed into the product section (no shared hrefs)', () => {
    renderNavigation();
    openMobileMenu();
    const productHrefs = new Set(productLinks.map((l) => l.href));
    for (const link of serviceLinks) {
      expect(productHrefs.has(link.href), `service link ${link.href} incorrectly shares href with product section`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile menu — hidden entries (nav sections only)
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – mobile menu hidden entries', () => {
  it('hidden PAGE_LINKS entries do not appear as nav-section links in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();

    // The hrefs that legitimately appear as utility controls (login/portal CTA button
    // and logo) rather than as nav-section items. These are intentional and not
    // dropped nav entries.
    const utilityHrefs = new Set([
      flatLinks[0].href,     // Home — also used by the logo link
      '/login',              // Login CTA button (not a nav section item)
      '/portal',             // Portal CTA button (not a nav section item)
    ]);

    // Nav-section link hrefs are flat + product + service
    const navSectionHrefs = new Set([
      ...flatLinks.map((l) => l.href),
      ...productLinks.map((l) => l.href),
      ...serviceLinks.map((l) => l.href),
    ]);

    const hiddenEntries = PAGE_LINKS.filter((l) => l.group === 'hidden');
    for (const entry of hiddenEntries) {
      // Skip utility hrefs — they appear intentionally as non-section controls
      if (utilityHrefs.has(entry.href)) continue;
      // Skip hrefs that are already in the nav sections (not expected to be hidden)
      if (navSectionHrefs.has(entry.href)) continue;

      const anchor = panel.querySelector(`a[href="${entry.href}"]`);
      expect(anchor, `hidden entry ${entry.href} should not appear in mobile panel`).toBeNull();
    }
  });

  it('none of the three nav sections contain training sub-page links', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    // /training/spirecut and /training/ministem are hidden sub-pages
    expect(panel.querySelector('a[href="/training/spirecut"]')).toBeNull();
    expect(panel.querySelector('a[href="/training/ministem"]')).toBeNull();
  });

  it('legal pages (impressum, agb) do not appear in the mobile nav panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    expect(panel.querySelector('a[href="/impressum"]')).toBeNull();
    expect(panel.querySelector('a[href="/agb"]')).toBeNull();
  });

  it('admin page does not appear in the mobile nav panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    expect(panel.querySelector('a[href="/admin"]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mobile menu — toggle behaviour
// ═══════════════════════════════════════════════════════════════════════════════

describe('real Navigation – mobile menu toggle', () => {
  it('mobile panel is not in the DOM before the toggle is clicked', () => {
    renderNavigation();
    // Before opening, the panel div should not exist
    expect(document.querySelector('div.md\\:hidden')).toBeNull();
  });

  it('changing the route closes an open mobile panel', () => {
    const { rerender } = renderNavigation();
    openMobileMenu();
    expect(document.querySelector('div.md\\:hidden')).not.toBeNull();

    locationBox.value = flatLinks[1].href;
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );

    expect(document.querySelector('div.md\\:hidden')).toBeNull();
  });

  it('browser back and forward history transitions close an open mobile panel', async () => {
    window.history.replaceState({}, '', '/');
    window.history.pushState({}, '', flatLinks[1].href);

    renderNavigation();
    openMobileMenu();

    window.history.back();
    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
      expect(document.querySelector('div.md\\:hidden')).toBeNull();
    });

    openMobileMenu();
    window.history.forward();
    await waitFor(() => {
      expect(window.location.pathname).toBe(flatLinks[1].href);
      expect(document.querySelector('div.md\\:hidden')).toBeNull();
    });
  });

  it('browser back and forward transitions close the desktop product dropdown', async () => {
    window.history.replaceState({}, '', '/');
    window.history.pushState({}, '', flatLinks[1].href);
    renderNavigation();
    const desktopProducts = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Produkte',
    )!;
    fireEvent.click(desktopProducts);
    expect(document.querySelector('.shadow-xl')).not.toBeNull();

    window.history.back();
    await waitFor(() => expect(document.querySelector('.shadow-xl')).toBeNull());
    fireEvent.click(desktopProducts);
    window.history.forward();
    await waitFor(() => expect(document.querySelector('.shadow-xl')).toBeNull());
  });

  it('mobile panel renders all three sections after the toggle is clicked', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    expect(panel.querySelector(`a[href="${flatLinks[0].href}"]`)).not.toBeNull();
    expect(panel.querySelector(`a[href="${productLinks[0].href}"]`)).not.toBeNull();
    expect(panel.querySelector(`a[href="${serviceLinks[0].href}"]`)).not.toBeNull();
  });

  it('clicking a non-home flat link closes the mobile panel', () => {
    // Use flatLinks[1] (e.g. /training) so we avoid the logo which also links to /
    const testLink = flatLinks[1];
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const anchor = panel.querySelector(`a[href="${testLink.href}"]`) as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    fireEvent.click(anchor);
    expect(document.querySelector('div.md\\:hidden')).toBeNull();
  });

  it('clicking a product link closes the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const anchor = panel.querySelector(`a[href="${productLinks[0].href}"]`) as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    fireEvent.click(anchor);
    expect(document.querySelector('div.md\\:hidden')).toBeNull();
  });

  it('clicking a service link closes the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const anchor = panel.querySelector(`a[href="${serviceLinks[0].href}"]`) as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    fireEvent.click(anchor);
    expect(document.querySelector('div.md\\:hidden')).toBeNull();
  });

  it('opening the mobile menu shows section headings for all three groups', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();

    // Products heading
    const productsHeading = Array.from(panel.querySelectorAll('p, span, h2, h3')).find(
      (el) => el.textContent?.includes('Produkte'),
    );
    expect(productsHeading, 'Products section heading not visible in mobile panel').not.toBeUndefined();

    // Services heading
    const servicesHeading = Array.from(panel.querySelectorAll('p, span, h2, h3')).find(
      (el) => el.textContent?.includes('Services'),
    );
    expect(servicesHeading, 'Services section heading not visible in mobile panel').not.toBeUndefined();

    // Flat section: at least flatLinks[0] (Home) is present
    const homeAnchor = panel.querySelector(`a[href="${flatLinks[0].href}"]`);
    expect(homeAnchor, 'Home flat link not visible in mobile panel').not.toBeNull();
  });

  it('clicking the X close button removes the mobile panel from the DOM', () => {
    renderNavigation();
    openMobileMenu();
    // Confirm it is open
    expect(document.querySelector('div.md\\:hidden')).not.toBeNull();

    // The toggle button now shows the X icon — click it again to close
    const mobileToggle = document.querySelector('button.md\\:hidden') as HTMLButtonElement;
    expect(mobileToggle, 'mobile toggle button not found').not.toBeNull();
    fireEvent.click(mobileToggle);

    // Panel must be gone
    expect(document.querySelector('div.md\\:hidden')).toBeNull();
  });
});
