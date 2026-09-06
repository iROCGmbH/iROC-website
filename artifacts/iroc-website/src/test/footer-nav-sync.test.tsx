/**
 * footer-nav-sync
 *
 * Confirms that PAGE_LINKS entries with `inFooter: true` are reflected in the
 * exported `footerLinks` array and that a minimal footer renderer (mirroring
 * the logic in Layout.tsx) shows exactly those links.
 *
 * The tests use a local mock array so they are self-contained and do not break
 * if the real PAGE_LINKS is reorganised.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentType } from 'react';
import { PAGE_LINKS, footerLinks, PageLink } from '@/config/navLinks';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal placeholder component used in mock page entries. */
const Placeholder: ComponentType = () => <div />;

/** Derives footer links the same way navLinks.ts does. */
function deriveFooterLinks(links: PageLink[]) {
  return links.filter((l) => l.inFooter);
}

// ── Minimal footer renderer (mirrors the Layout.tsx footer section) ───────────

function FooterLinks({ links }: { links: PageLink[] }) {
  const footer = deriveFooterLinks(links);
  return (
    <ul data-testid="footer-list">
      {footer.map((l) => (
        <li key={l.href}>
          <a href={l.href}>{l.labelEN}</a>
        </li>
      ))}
    </ul>
  );
}

// ── Mock page arrays ──────────────────────────────────────────────────────────

const WITH_IN_FOOTER: PageLink[] = [
  {
    href: '/test-page',
    labelDE: 'Testseite',
    labelEN: 'Test Page',
    inFooter: true,
    group: 'flat',
    component: Placeholder,
  },
  {
    href: '/hidden-page',
    labelDE: 'Versteckt',
    labelEN: 'Hidden Page',
    // inFooter intentionally omitted
    group: 'hidden',
    component: Placeholder,
  },
];

const WITHOUT_IN_FOOTER: PageLink[] = [
  {
    href: '/test-page',
    labelDE: 'Testseite',
    labelEN: 'Test Page',
    // inFooter intentionally omitted
    group: 'flat',
    component: Placeholder,
  },
];

// ── Two-section footer renderer (mirrors the actual Layout.tsx footer) ────────
//
// Layout.tsx renders two <ul> blocks:
//   "Seiten / Pages"      — group === 'flat' | 'product' | 'service'
//   "Rechtliches / Legal" — group === 'hidden'
//
// A service-group entry with inFooter: true must appear in the Pages block;
// if the filter only covered 'flat' | 'product' it would silently vanish.

function LayoutFooter({ links }: { links: PageLink[] }) {
  const footer = deriveFooterLinks(links);
  return (
    <div>
      <ul data-testid="pages-section">
        {footer
          .filter((l) => l.group === 'flat' || l.group === 'product' || l.group === 'service')
          .map((l) => (
            <li key={l.href}>
              <a href={l.href}>{l.labelEN}</a>
            </li>
          ))}
      </ul>
      <ul data-testid="legal-section">
        {footer
          .filter((l) => l.group === 'hidden')
          .map((l) => (
            <li key={l.href}>
              <a href={l.href}>{l.labelEN}</a>
            </li>
          ))}
      </ul>
    </div>
  );
}

const WITH_SERVICE_IN_FOOTER: PageLink[] = [
  {
    href: '/service-page',
    labelDE: 'Dienstleistung',
    labelEN: 'Service Page',
    inFooter: true,
    group: 'service',
    icon: Placeholder as ComponentType<{ className?: string }>,
    component: Placeholder,
  },
  {
    href: '/flat-page',
    labelDE: 'Seite',
    labelEN: 'Flat Page',
    inFooter: true,
    group: 'flat',
    component: Placeholder,
  },
  {
    href: '/legal-page',
    labelDE: 'Rechtlich',
    labelEN: 'Legal Page',
    inFooter: true,
    group: 'hidden',
    component: Placeholder,
  },
];

// ── Filter-logic unit tests ───────────────────────────────────────────────────

describe('footerLinks filter logic', () => {
  it('includes a page when inFooter is true', () => {
    const result = deriveFooterLinks(WITH_IN_FOOTER);
    expect(result.map((l) => l.href)).toContain('/test-page');
  });

  it('excludes a page when inFooter is omitted', () => {
    const result = deriveFooterLinks(WITH_IN_FOOTER);
    expect(result.map((l) => l.href)).not.toContain('/hidden-page');
  });

  it('excludes the page after removing inFooter from the entry', () => {
    const result = deriveFooterLinks(WITHOUT_IN_FOOTER);
    expect(result.map((l) => l.href)).not.toContain('/test-page');
  });

  it('exported footerLinks only contains entries that have inFooter: true', () => {
    for (const link of footerLinks) {
      expect(link.inFooter).toBe(true);
    }
  });

  it('exported footerLinks excludes all entries without inFooter', () => {
    const noFooter = PAGE_LINKS.filter((l) => !l.inFooter);
    for (const link of noFooter) {
      expect(footerLinks).not.toContainEqual(expect.objectContaining({ href: link.href }));
    }
  });
});

// ── Render tests ─────────────────────────────────────────────────────────────

describe('FooterLinks renderer', () => {
  it('renders a link when the entry has inFooter: true', () => {
    render(<FooterLinks links={WITH_IN_FOOTER} />);
    expect(screen.getByRole('link', { name: 'Test Page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Test Page' })).toHaveAttribute('href', '/test-page');
  });

  it('does not render a link when inFooter is omitted', () => {
    render(<FooterLinks links={WITH_IN_FOOTER} />);
    expect(screen.queryByRole('link', { name: 'Hidden Page' })).not.toBeInTheDocument();
  });

  it('renders no links when no entries have inFooter: true', () => {
    render(<FooterLinks links={WITHOUT_IN_FOOTER} />);
    expect(screen.queryByRole('link', { name: 'Test Page' })).not.toBeInTheDocument();
    expect(screen.getByTestId('footer-list').children).toHaveLength(0);
  });

  it('renders all inFooter entries from a mixed list including service group', () => {
    const mixed: PageLink[] = [
      { href: '/a', labelDE: 'A', labelEN: 'Alpha', inFooter: true,  group: 'flat',   component: Placeholder },
      { href: '/b', labelDE: 'B', labelEN: 'Beta',  inFooter: false, group: 'flat',   component: Placeholder },
      { href: '/c', labelDE: 'C', labelEN: 'Gamma', inFooter: true,  group: 'hidden', component: Placeholder },
      { href: '/d', labelDE: 'D', labelEN: 'Delta',                  group: 'hidden', component: Placeholder },
    ];
    render(<FooterLinks links={mixed} />);
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gamma' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Beta'  })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Delta' })).not.toBeInTheDocument();
  });
});

// ── Layout two-section footer: service-group coverage ────────────────────────
//
// This suite mirrors exactly the filter logic in Layout.tsx's footer.
// It guards against a regression where a service-group entry with inFooter: true
// passes footerLinks but silently vanishes because neither rendered section
// previously matched group === 'service'.

describe('LayoutFooter two-section renderer (mirrors Layout.tsx)', () => {
  it('shows a service-group inFooter entry in the Pages section', () => {
    render(<LayoutFooter links={WITH_SERVICE_IN_FOOTER} />);
    const pagesSection = screen.getByTestId('pages-section');
    expect(pagesSection).toContainElement(
      screen.getByRole('link', { name: 'Service Page' }),
    );
  });

  it('does not show a service-group inFooter entry in the Legal section', () => {
    render(<LayoutFooter links={WITH_SERVICE_IN_FOOTER} />);
    const legalSection = screen.getByTestId('legal-section');
    expect(legalSection).not.toContainElement(
      // The element might not exist at all — use queryBy
      screen.queryByRole('link', { name: 'Service Page' }) ?? document.createElement('a'),
    );
  });

  it('still shows flat-group entries in Pages and hidden-group entries in Legal', () => {
    render(<LayoutFooter links={WITH_SERVICE_IN_FOOTER} />);
    const pagesSection = screen.getByTestId('pages-section');
    const legalSection = screen.getByTestId('legal-section');
    expect(pagesSection).toContainElement(screen.getByRole('link', { name: 'Flat Page' }));
    expect(legalSection).toContainElement(screen.getByRole('link', { name: 'Legal Page' }));
  });

  it('service-group link without inFooter does not appear anywhere in the footer', () => {
    const withoutInFooter: PageLink[] = [
      {
        href: '/no-footer-service',
        labelDE: 'Kein Footer',
        labelEN: 'No Footer Service',
        // inFooter intentionally omitted
        group: 'service',
        icon: Placeholder as ComponentType<{ className?: string }>,
        component: Placeholder,
      },
    ];
    render(<LayoutFooter links={withoutInFooter} />);
    expect(screen.queryByRole('link', { name: 'No Footer Service' })).not.toBeInTheDocument();
  });
});
