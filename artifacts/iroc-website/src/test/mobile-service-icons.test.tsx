/**
 * mobile-service-icons
 *
 * Confirms that the mobile nav drawer renders an SVG icon for every service
 * link, mirroring the guard already applied to the desktop dropdown in
 * service-icon-guard.test.tsx.
 *
 * Three describe groups:
 *
 * 1. Mobile drawer icon presence — opens the hamburger menu and asserts each
 *    service link contains an <svg> element.
 *
 * 2. Mobile drawer icon count — verifies the total number of service icons
 *    matches serviceLinks.length so that a silently-dropped entry is caught.
 *
 * 3. Mobile render path guard — a minimal MobileServiceList that mirrors the
 *    Navigation.tsx mobile branch render loop is fed a mock entry whose icon
 *    is omitted, confirming it throws the same way the desktop path does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ComponentType } from 'react';
import { serviceLinks, PageLink, ServicePageLink } from '@/config/navLinks';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Navigation } from '@/components/Navigation';

// ── Shared mocks ──────────────────────────────────────────────────────────────

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    useLocation: () => ['/'],
    useSearch: () => '',
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
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => null,
  } as Response);
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
  const mobileToggle = document.querySelector(
    'button.md\\:hidden',
  ) as HTMLButtonElement;
  expect(mobileToggle, 'mobile toggle button not found').not.toBeNull();
  fireEvent.click(mobileToggle);
}

/** Returns the mobile slide-in panel element (must be open first). */
function getMobilePanel(): Element {
  const panel = document.querySelector('div.md\\:hidden');
  expect(panel, 'mobile menu panel not found — is the menu open?').not.toBeNull();
  return panel!;
}

/** Minimal placeholder SVG component used in mock PageLink entries. */
const Placeholder: ComponentType<{ className?: string }> = () => <svg data-testid="placeholder-icon" />;

/** Builds a minimal ServicePageLink. */
function makeServiceEntry(overrides: {
  href: string;
  labelDE: string;
  labelEN: string;
  icon?: ComponentType<{ className?: string }>;
}): ServicePageLink {
  return {
    group: 'service',
    component: Placeholder as ComponentType,
    icon: Placeholder,
    ...overrides,
  };
}

/**
 * Minimal MobileServiceList — mirrors the exact render loop from the mobile
 * branch of Navigation.tsx (lines 200-208).
 *
 * Accepts the wider PageLink[] so the "throws without icon" test can pass an
 * unsafely-cast entry; the non-null assertion `l.icon!` reproduces the runtime
 * crash that the discriminated-union type now prevents at compile time.
 */
function MobileServiceList({ entries }: { entries: PageLink[] }) {
  return (
    <ul data-testid="mobile-service-list">
      {entries.map((l) => {
        const Icon = l.icon!;
        return (
          <li key={l.href}>
            <a href={l.href} className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-primary" />
              <span>{l.labelEN}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Mobile drawer icon presence
// ═══════════════════════════════════════════════════════════════════════════════

describe('mobile drawer – each service link renders an SVG icon', () => {
  it('opening the mobile menu does not throw', () => {
    expect(() => {
      renderNavigation();
      openMobileMenu();
    }).not.toThrow();
  });

  it('the Services section heading is visible in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const heading = Array.from(panel.querySelectorAll('p, span, h2, h3')).find(
      (el) => el.textContent?.includes('Services'),
    );
    expect(heading, 'Services heading not found in mobile panel').not.toBeUndefined();
  });

  it('every service link is present in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    for (const entry of serviceLinks) {
      const anchor = panel.querySelector(`a[href="${entry.href}"]`);
      expect(
        anchor,
        `Service link "${entry.href}" is missing from the mobile panel`,
      ).not.toBeNull();
    }
  });

  it('each service link in the mobile panel contains an SVG icon element', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();

    for (const entry of serviceLinks) {
      const anchor = panel.querySelector(`a[href="${entry.href}"]`);
      expect(
        anchor,
        `Service link "${entry.href}" not found in mobile panel`,
      ).not.toBeNull();

      const svg = anchor!.querySelector('svg');
      expect(
        svg,
        `Service link "${entry.href}" in the mobile panel does not contain an SVG icon`,
      ).not.toBeNull();
    }
  });

  it('the Post-Training Support link renders an SVG icon in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();

    const anchor = panel.querySelector('a[href="/order?service=support"]');
    expect(anchor, 'Post-Training Support link missing from mobile panel').not.toBeNull();
    expect(
      anchor!.querySelector('svg'),
      'Post-Training Support link in mobile panel has no SVG icon',
    ).not.toBeNull();
  });

  it('the Practice Marketing link renders an SVG icon in the mobile panel', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();

    const anchor = panel.querySelector('a[href="/order?service=marketing"]');
    expect(anchor, 'Practice Marketing link missing from mobile panel').not.toBeNull();
    expect(
      anchor!.querySelector('svg'),
      'Practice Marketing link in mobile panel has no SVG icon',
    ).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Mobile drawer icon count
// ═══════════════════════════════════════════════════════════════════════════════

describe('mobile drawer – icon count matches service entry count', () => {
  it('the number of service anchors with SVG icons equals serviceLinks.length', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();

    const serviceHrefs = serviceLinks.map((l) => l.href);
    const serviceAnchors = Array.from(panel.querySelectorAll('a')).filter(
      (a) => serviceHrefs.includes(a.getAttribute('href') ?? ''),
    );

    const anchorsWithIcons = serviceAnchors.filter(
      (a) => a.querySelector('svg') !== null,
    );

    expect(
      anchorsWithIcons.length,
      `Expected ${serviceLinks.length} mobile service links with icons but found ${anchorsWithIcons.length}`,
    ).toBe(serviceLinks.length);
  });

  it('no service link in the mobile panel is missing its SVG icon', () => {
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();

    const serviceHrefs = serviceLinks.map((l) => l.href);
    const serviceAnchors = Array.from(panel.querySelectorAll('a')).filter(
      (a) => serviceHrefs.includes(a.getAttribute('href') ?? ''),
    );

    const anchorsWithoutIcons = serviceAnchors.filter(
      (a) => a.querySelector('svg') === null,
    );

    expect(
      anchorsWithoutIcons.length,
      `${anchorsWithoutIcons.length} mobile service link(s) are missing SVG icons`,
    ).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Mobile render path guard
// ═══════════════════════════════════════════════════════════════════════════════

describe('mobile render path guard – missing icon throws', () => {
  // A service entry that intentionally omits the icon field.
  // @ts-expect-error — icon is missing; the discriminated union requires it for group === 'service'
  const ENTRY_WITHOUT_ICON: PageLink = {
    href: '/order?service=missing-icon',
    labelDE: 'Kein Icon',
    labelEN: 'No Icon Service',
    group: 'service',
    component: Placeholder as ComponentType,
    // icon is deliberately omitted
  };

  const ENTRY_WITH_ICON = makeServiceEntry({
    href: '/order?service=with-icon',
    labelDE: 'Mit Icon',
    labelEN: 'With Icon Service',
  });

  it('the mock entry without icon has icon === undefined', () => {
    expect(ENTRY_WITHOUT_ICON.icon).toBeUndefined();
  });

  it('the mock entry with icon has icon defined', () => {
    expect(ENTRY_WITH_ICON.icon).toBeDefined();
  });

  it('MobileServiceList renders without throwing when all entries have icons', () => {
    expect(() =>
      render(
        <LanguageProvider>
          <MobileServiceList entries={[ENTRY_WITH_ICON]} />
        </LanguageProvider>,
      ),
    ).not.toThrow();
  });

  it('MobileServiceList renders an SVG for an entry that has an icon', () => {
    render(
      <LanguageProvider>
        <MobileServiceList entries={[ENTRY_WITH_ICON]} />
      </LanguageProvider>,
    );
    const anchor = document.querySelector(`a[href="${ENTRY_WITH_ICON.href}"]`);
    expect(anchor).not.toBeNull();
    expect(anchor!.querySelector('svg')).not.toBeNull();
  });

  it('MobileServiceList throws when forced to render an entry whose icon is undefined (l.icon!)', () => {
    // The mobile branch of Navigation.tsx uses `const Icon = l.icon!` — calling
    // a non-function as a component throws at render time.
    // This test documents exactly that runtime failure so the static check is
    // proven necessary.
    expect(() =>
      render(
        <LanguageProvider>
          <MobileServiceList entries={[ENTRY_WITHOUT_ICON]} />
        </LanguageProvider>,
      ),
    ).toThrow();
  });

  it('real serviceLinks entries all pass the mobile icon guard', () => {
    const missing = serviceLinks.filter((l) => l.icon == null);
    expect(
      missing,
      `${missing.length} serviceLinks entry(ies) missing icon — would crash the mobile render path`,
    ).toHaveLength(0);
  });

  it('MobileServiceList with mixed entries renders icons only for entries that have them', () => {
    // With one valid entry, one broken entry: we expect a throw since the broken
    // entry is rendered with l.icon! — this confirms the guard is not bypassed.
    expect(() =>
      render(
        <LanguageProvider>
          <MobileServiceList entries={[ENTRY_WITH_ICON, ENTRY_WITHOUT_ICON]} />
        </LanguageProvider>,
      ),
    ).toThrow();
  });
});
