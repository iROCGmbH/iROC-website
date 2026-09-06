/**
 * service-icon-guard
 *
 * Three groups of tests:
 *
 * 1. navLinks static check — every PAGE_LINKS entry with group === "service"
 *    must have a non-null icon field.  A missing icon is caught here before
 *    Navigation.tsx ever renders.
 *
 * 2. Navigation dropdown smoke test — confirms the Services section renders
 *    without throwing when given the real PAGE_LINKS service entries (each
 *    already equipped with an icon).
 *
 * 3. Guard-catches-omission — a minimal ServiceDropdown that mirrors the
 *    Navigation.tsx render loop is fed a mock entry whose icon is omitted,
 *    demonstrating that the static check in group 1 would catch exactly this
 *    scenario before it reaches production.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentType } from 'react';
import { PAGE_LINKS, serviceLinks, PageLink, ServicePageLink } from '@/config/navLinks';
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

function openDropdown() {
  const toggle = screen.getByRole('button', { name: /Produkte/i });
  fireEvent.click(toggle);
}

/** Minimal placeholder used in mock PageLink entries. */
const Placeholder: ComponentType<{ className?: string }> = () => <svg />;

/** Builds a minimal service PageLink with the given icon value. */
function makeServiceEntry(overrides: {
  href: string;
  labelDE: string;
  labelEN: string;
  icon?: ComponentType<{ className?: string }>;
  subDE?: string;
  subEN?: string;
  inFooter?: boolean;
}): ServicePageLink {
  return {
    group: 'service',
    component: Placeholder as ComponentType,
    icon: Placeholder,
    ...overrides,
  };
}

/**
 * Minimal ServiceDropdown — mirrors the exact render loop Navigation.tsx uses
 * for the Services section.
 * Accepts the wider PageLink[] so the "throws without icon" test can pass an
 * unsafely-cast entry; the non-null assertion `l.icon!` reproduces the runtime
 * crash that the discriminated-union type now prevents at compile time.
 */
function ServiceDropdown({ entries }: { entries: PageLink[] }) {
  return (
    <ul data-testid="service-dropdown">
      {entries.map((l) => {
        const Icon = l.icon!;
        return (
          <li key={l.href}>
            <a href={l.href}>
              <Icon className="w-4 h-4" />
              <span>{l.labelEN}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. navLinks static check — every service entry must have an icon
// ═══════════════════════════════════════════════════════════════════════════════

describe('navLinks static check – service entries must have icon', () => {
  it('every PAGE_LINKS service entry has an icon field that is not null or undefined', () => {
    const serviceEntries = PAGE_LINKS.filter((l) => l.group === 'service');
    for (const entry of serviceEntries) {
      expect(
        entry.icon,
        `Service entry "${entry.href}" is missing the required icon field`,
      ).toBeDefined();
      expect(
        entry.icon,
        `Service entry "${entry.href}" has a null icon field`,
      ).not.toBeNull();
    }
  });

  it('every exported serviceLinks entry has an icon field', () => {
    for (const entry of serviceLinks) {
      expect(
        entry.icon,
        `serviceLinks entry "${entry.href}" is missing the required icon field`,
      ).toBeDefined();
    }
  });

  it('the Post-Training Support entry has an icon', () => {
    const entry = PAGE_LINKS.find((l) => l.href === '/order?service=support');
    expect(entry).toBeDefined();
    expect(entry!.icon).toBeDefined();
    expect(entry!.icon).not.toBeNull();
  });

  it('the Practice Marketing entry has an icon', () => {
    const entry = PAGE_LINKS.find((l) => l.href === '/order?service=marketing');
    expect(entry).toBeDefined();
    expect(entry!.icon).toBeDefined();
    expect(entry!.icon).not.toBeNull();
  });

  it('the icon field is a callable React component (function or forwardRef object) for every service entry', () => {
    // Lucide-react icons are React.forwardRef components; typeof evaluates to
    // 'object' for forwardRef wrappers and 'function' for plain function components.
    // Both are valid — the key invariant is that the value is not null/undefined.
    const serviceEntries = PAGE_LINKS.filter((l) => l.group === 'service');
    for (const entry of serviceEntries) {
      const iconType = typeof entry.icon;
      expect(
        iconType === 'function' || iconType === 'object',
        `Service entry "${entry.href}" icon has unexpected type "${iconType}" — expected a React component`,
      ).toBe(true);
    }
  });

  it('non-service entries are not required to have an icon — flat entries may omit it', () => {
    const flatEntries = PAGE_LINKS.filter((l) => l.group === 'flat');
    // This is a documentation test: flat entries do not carry icons, which is fine.
    // We just confirm there is at least one flat entry to make the assertion meaningful.
    expect(flatEntries.length).toBeGreaterThan(0);
  });

  it('there is at least one service entry (guard is not vacuously true)', () => {
    const serviceEntries = PAGE_LINKS.filter((l) => l.group === 'service');
    expect(serviceEntries.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Navigation dropdown — smoke test with real service entries
// ═══════════════════════════════════════════════════════════════════════════════

describe('Navigation dropdown – renders without error using real service entries', () => {
  it('opens the dropdown without throwing', () => {
    expect(() => {
      renderNavigation();
      openDropdown();
    }).not.toThrow();
  });

  it('Services section heading is visible after opening the dropdown', () => {
    renderNavigation();
    openDropdown();
    // Navigation.tsx renders a "Services" heading inside the dropdown panel
    expect(screen.getByText('Services')).toBeInTheDocument();
  });

  it('all real service entries appear in the dropdown', () => {
    renderNavigation();
    openDropdown();

    for (const entry of serviceLinks) {
      const link = document.querySelector(`a[href="${entry.href}"]`);
      expect(
        link,
        `Service entry "${entry.href}" is missing from the rendered dropdown`,
      ).not.toBeNull();
    }
  });

  it('each service link in the dropdown contains an SVG icon element', () => {
    renderNavigation();
    openDropdown();

    for (const entry of serviceLinks) {
      const link = document.querySelector(`a[href="${entry.href}"]`);
      expect(link).not.toBeNull();
      // The icon renders as an SVG inside each service link
      const svg = link!.querySelector('svg');
      expect(
        svg,
        `Service entry "${entry.href}" link does not contain an SVG icon`,
      ).not.toBeNull();
    }
  });

  it('the Post-Training Support link is rendered and contains an icon', () => {
    renderNavigation();
    openDropdown();

    const link = document.querySelector('a[href="/order?service=support"]');
    expect(link).not.toBeNull();
    expect(link!.querySelector('svg')).not.toBeNull();
  });

  it('the Practice Marketing link is rendered and contains an icon', () => {
    renderNavigation();
    openDropdown();

    const link = document.querySelector('a[href="/order?service=marketing"]');
    expect(link).not.toBeNull();
    expect(link!.querySelector('svg')).not.toBeNull();
  });

  it('the number of SVG icons in the Services section equals the number of service entries', () => {
    renderNavigation();
    openDropdown();

    // Collect only the service-link anchors (identified by their known hrefs)
    const serviceHrefs = serviceLinks.map((l) => l.href);
    const serviceAnchors = Array.from(document.querySelectorAll('a')).filter(
      (a) => serviceHrefs.includes(a.getAttribute('href') ?? ''),
    );

    const iconsFound = serviceAnchors.filter((a) => a.querySelector('svg') !== null);
    expect(iconsFound.length).toBe(serviceLinks.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Guard catches the omission — mock entry without icon triggers the check
// ═══════════════════════════════════════════════════════════════════════════════

describe('guard catches omission – mock service entry without icon fails the static check', () => {
  // A service entry that intentionally omits the icon field.
  // The @ts-expect-error below is the compile-time proof: the discriminated union
  // requires icon when group === 'service', so TypeScript rejects this object.
  // @ts-expect-error — icon is missing; this line should always show a TS error
  const ENTRY_WITHOUT_ICON: PageLink = {
    href: '/order?service=missing-icon',
    labelDE: 'Kein Icon',
    labelEN: 'No Icon Service',
    group: 'service',
    component: Placeholder as ComponentType,
    // icon is deliberately omitted — this is the invalid case
  };

  /** A valid service entry for contrast. */
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

  it('a filter that checks for defined icons does NOT include the entry without icon', () => {
    const entries = [ENTRY_WITH_ICON, ENTRY_WITHOUT_ICON];
    const valid = entries.filter((l) => l.icon != null);
    expect(valid).not.toContainEqual(ENTRY_WITHOUT_ICON);
  });

  it('a filter that checks for defined icons DOES include the entry with icon', () => {
    const entries = [ENTRY_WITH_ICON, ENTRY_WITHOUT_ICON];
    const valid = entries.filter((l) => l.icon != null);
    expect(valid).toContainEqual(ENTRY_WITH_ICON);
  });

  it('the static icon check fails when applied to the entry without icon', () => {
    // This is the same assertion as group 1 but applied to our mock — confirms
    // the check is capable of catching the omission.
    expect(ENTRY_WITHOUT_ICON.icon).toBeUndefined();
    // Explicitly: the guard (l.icon != null) would be FALSE for this entry
    expect(ENTRY_WITHOUT_ICON.icon != null).toBe(false);
  });

  it('ServiceDropdown renders without throwing when given entries that all have icons', () => {
    expect(() =>
      render(
        <LanguageProvider>
          <ServiceDropdown entries={[ENTRY_WITH_ICON]} />
        </LanguageProvider>,
      ),
    ).not.toThrow();
  });

  it('ServiceDropdown renders the icon SVG for an entry that has an icon', () => {
    render(
      <LanguageProvider>
        <ServiceDropdown entries={[ENTRY_WITH_ICON]} />
      </LanguageProvider>,
    );
    const link = document.querySelector(`a[href="${ENTRY_WITH_ICON.href}"]`);
    expect(link).not.toBeNull();
    expect(link!.querySelector('svg')).not.toBeNull();
  });

  it('ServiceDropdown throws when forced to render an entry whose icon is undefined (l.icon!)', () => {
    // Navigation.tsx uses `const Icon = l.icon!` — calling a non-function throws.
    // This test documents exactly that runtime failure.
    expect(() =>
      render(
        <LanguageProvider>
          <ServiceDropdown entries={[ENTRY_WITHOUT_ICON]} />
        </LanguageProvider>,
      ),
    ).toThrow();
  });

  it('real PAGE_LINKS service entries all pass the icon guard — none match the missing-icon mock', () => {
    const realServiceEntries = PAGE_LINKS.filter((l) => l.group === 'service');
    const missing = realServiceEntries.filter((l) => l.icon == null);
    expect(missing).toHaveLength(0);
  });
});
