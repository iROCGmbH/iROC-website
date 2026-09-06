/**
 * nav-active-highlight
 *
 * Renders the REAL Navigation component inside real wouter infrastructure.
 * The URL is set via window.history.pushState before each render so wouter's
 * useLocation() reads the real window.location.pathname — no useLocation mock
 * is used.
 *
 * Covers two URL edge cases:
 *
 *   1. Trailing slash  — e.g. /training/
 *      Navigation.tsx normalises the pathname before comparison
 *      (normalizePath strips a trailing slash, preserving "/").
 *      The active class IS applied for trailing-slash paths.
 *
 *   2. Query string   — e.g. /training?ref=nav
 *      wouter's useLocation() returns only window.location.pathname, so the
 *      query string is never seen by the comparison.  The active class IS
 *      applied for query-string URLs.  Tests verify this with a real URL
 *      in window.location (via pushState) rather than a mocked value.
 *
 * Approach
 * --------
 * Only wouter's Link is stubbed (to a plain anchor) so that rendering is
 * self-contained in jsdom.  useLocation is left as-is so it reads the real
 * window.location.pathname, which is controlled via pushState.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Navigation } from '@/components/Navigation';
import { flatLinks, productLinks } from '@/config/navLinks';

// ── Wouter mock: keep real useLocation; stub only Link ────────────────────────
//
// Stubbing Link prevents jsdom navigation errors while preserving the real
// useLocation hook so it reads window.location.pathname set by pushState.

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    // useLocation is NOT overridden — it uses real window.location.pathname
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Set the jsdom URL before rendering so wouter reads the correct pathname. */
function setUrl(url: string) {
  window.history.pushState({}, '', url);
}

function renderNavigation() {
  return render(
    <LanguageProvider>
      <Navigation />
    </LanguageProvider>,
  );
}

/** Opens the mobile slide-in panel. */
function openMobileMenu() {
  const toggle = document.querySelector('button.md\\:hidden') as HTMLButtonElement;
  expect(toggle, 'mobile toggle not found').not.toBeNull();
  fireEvent.click(toggle);
}

/** Returns the open mobile panel element. */
function getMobilePanel(): Element {
  const panel = document.querySelector('div.md\\:hidden');
  expect(panel, 'mobile panel not found — menu may not be open').not.toBeNull();
  return panel!;
}

/** Active CSS class applied by Navigation.tsx to the currently-active link. */
const ACTIVE_CLASS = 'text-primary';

beforeEach(() => {
  // Start each test from the root so there is no URL bleed-over
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

// ─── Baseline: exact-match active highlight ───────────────────────────────────

describe('real Navigation – active highlight baseline (exact match)', () => {
  it('flat link receives the active class when URL matches exactly', () => {
    const target = flatLinks[1]; // e.g. /training
    setUrl(target.href);
    renderNavigation();
    openMobileMenu();
    const anchor = getMobilePanel().querySelector(`a[href="${target.href}"]`);
    expect(anchor, `flat link ${target.href} not in panel`).not.toBeNull();
    expect(anchor!.className).toContain(ACTIVE_CLASS);
  });

  it('product link receives the active class when URL matches exactly', () => {
    const target = productLinks[0];
    setUrl(target.href);
    renderNavigation();
    openMobileMenu();
    const anchor = getMobilePanel().querySelector(`a[href="${target.href}"]`);
    expect(anchor, `product link ${target.href} not in panel`).not.toBeNull();
    expect(anchor!.className).toContain(ACTIVE_CLASS);
  });

  it('no product link is active when the URL is a flat page', () => {
    setUrl(flatLinks[1].href);
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    for (const link of productLinks) {
      const anchor = panel.querySelector(`a[href="${link.href}"]`);
      if (anchor) {
        expect(anchor.className, `${link.href} should not be active`).not.toContain(ACTIVE_CLASS);
      }
    }
  });
});

// ─── Trailing slash: normalization applied ────────────────────────────────────
//
// Navigation.tsx calls normalizePath() before comparisons, stripping the
// trailing slash so "/training/" activates the "/training" link.
// The home link "/" is a special case: normalizePath leaves it intact.

describe('real Navigation – trailing-slash URL activates the canonical link', () => {
  it('flat link IS highlighted when the browser URL has a trailing slash', () => {
    const target = flatLinks[1]; // e.g. /training
    setUrl(`${target.href}/`);   // /training/ — wouter delivers "/training/" as pathname
    expect(window.location.pathname).toBe(`${target.href}/`);
    renderNavigation();
    openMobileMenu();
    const anchor = getMobilePanel().querySelector(`a[href="${target.href}"]`);
    expect(anchor, `flat link ${target.href} not in panel`).not.toBeNull();
    expect(anchor!.className).toContain(ACTIVE_CLASS);
  });

  it('product link IS highlighted when the browser URL has a trailing slash', () => {
    const target = productLinks[0];
    setUrl(`${target.href}/`);
    expect(window.location.pathname).toBe(`${target.href}/`);
    renderNavigation();
    openMobileMenu();
    const anchor = getMobilePanel().querySelector(`a[href="${target.href}"]`);
    expect(anchor, `product link ${target.href} not in panel`).not.toBeNull();
    expect(anchor!.className).toContain(ACTIVE_CLASS);
  });

  it('only the canonical link is highlighted — no other link gains the active class', () => {
    const target = flatLinks[1];
    setUrl(`${target.href}/`);
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const otherHrefs = [...flatLinks, ...productLinks]
      .map((l) => l.href)
      .filter((h) => h !== target.href);
    for (const href of otherHrefs) {
      const anchor = panel.querySelector(`a[href="${href}"]`);
      if (anchor) {
        expect(anchor.className, `${href} should not be active`).not.toContain(ACTIVE_CLASS);
      }
    }
  });
});

// ─── Query string: wouter strips QS before Navigation sees it ────────────────
//
// wouter's useLocation() returns window.location.pathname, which never
// includes the query string.  These tests verify the integration end-to-end:
// pushState sets a real QS URL, jsdom's window.location.pathname is the bare
// path, wouter reads that pathname, and Navigation applies the active class.

describe('real Navigation – query-string URL activates the canonical link', () => {
  it('window.location.pathname strips the query string (wouter contract)', () => {
    setUrl(`${flatLinks[1].href}?ref=nav`);
    expect(window.location.pathname).toBe(flatLinks[1].href);
    expect(window.location.search).toBe('?ref=nav');
  });

  it('flat link IS highlighted when the URL has a query string', () => {
    const target = flatLinks[1]; // e.g. /training
    setUrl(`${target.href}?ref=nav`);
    // Confirm wouter will receive the bare pathname
    expect(window.location.pathname).toBe(target.href);
    renderNavigation();
    openMobileMenu();
    const anchor = getMobilePanel().querySelector(`a[href="${target.href}"]`);
    expect(anchor, `flat link ${target.href} not in panel`).not.toBeNull();
    expect(anchor!.className).toContain(ACTIVE_CLASS);
  });

  it('product link IS highlighted when the URL has a query string', () => {
    const target = productLinks[0];
    setUrl(`${target.href}?ref=nav`);
    expect(window.location.pathname).toBe(target.href);
    renderNavigation();
    openMobileMenu();
    const anchor = getMobilePanel().querySelector(`a[href="${target.href}"]`);
    expect(anchor, `product link ${target.href} not in panel`).not.toBeNull();
    expect(anchor!.className).toContain(ACTIVE_CLASS);
  });

  it('only the canonical link is highlighted — query string does not bleed to other links', () => {
    const target = flatLinks[1];
    setUrl(`${target.href}?ref=nav`);
    renderNavigation();
    openMobileMenu();
    const panel = getMobilePanel();
    const otherHrefs = [...flatLinks, ...productLinks]
      .map((l) => l.href)
      .filter((h) => h !== target.href);
    for (const href of otherHrefs) {
      const anchor = panel.querySelector(`a[href="${href}"]`);
      if (anchor) {
        expect(anchor.className, `${href} should not be active`).not.toContain(ACTIVE_CLASS);
      }
    }
  });

  it('combined trailing slash + query string — link IS highlighted', () => {
    const target = flatLinks[1];
    setUrl(`${target.href}/?ref=nav`);
    // pathname is /training/, search is ?ref=nav; normalizePath strips the slash
    expect(window.location.pathname).toBe(`${target.href}/`);
    renderNavigation();
    openMobileMenu();
    const anchor = getMobilePanel().querySelector(`a[href="${target.href}"]`);
    expect(anchor, `flat link ${target.href} not in panel`).not.toBeNull();
    expect(anchor!.className).toContain(ACTIVE_CLASS);
  });
});
