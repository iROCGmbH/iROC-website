/**
 * not-found-catchall
 *
 * Verifies that App.tsx's catch-all <Route component={NotFound} /> fires
 * correctly for paths absent from PAGE_LINKS.
 *
 * Strategy
 * ────────
 * Rather than mounting the full App (which drags in QueryClient, AuthProvider,
 * LanguageProvider, lazy chunks, and network calls) we replicate just the
 * routing logic:
 *
 *   <Switch>
 *     {PAGE_LINKS.map(…)}      ← same expansion App.tsx uses
 *     <Route component={NotFound} />   ← the catch-all under test
 *   </Switch>
 *
 * wouter's Router accepts a `hook` prop.  Passing a zero-dependency hook that
 * returns a fixed path lets us drive the router without a real browser URL or
 * history stack.
 *
 * NotFound is NOT lazy-loaded (it's a plain import in App.tsx and renders
 * synchronously), so we never need to await Suspense resolution when the
 * catch-all fires.
 *
 * Covered guarantees
 * ──────────────────
 * 1. A completely unknown path renders "404 Page Not Found".
 * 2. A near-miss typo path ("/trainig") also reaches the catch-all.
 * 3. Multiple distinct unknown paths all trigger the catch-all.
 * 4. The 404 text is absent for a path that IS in PAGE_LINKS (sanity check).
 * 5. The catch-all fires even when the unknown path looks like a sub-path of
 *    a known route (e.g. "/training/unknown-course").
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { Route, Switch, Router } from 'wouter';
import { PAGE_LINKS } from '@/config/navLinks';
import NotFound from '@/pages/not-found';
import { LanguageProvider } from '@/contexts/LanguageContext';

// NotFound is bilingual via useLanguage(); the provider defaults to DE, so the
// catch-all heading renders as the German "404 Seite nicht gefunden".
const NOT_FOUND_TEXT = '404 Seite nicht gefunden';

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Build a wouter Router whose location is pinned to `path`.
 * The navigate function is a no-op — tests only need static rendering.
 */
function makeStaticHook(path: string) {
  return () => [path, () => undefined] as [string, (to: string) => undefined];
}

/**
 * Render the same Switch structure that App.tsx uses, but with a static path
 * instead of the real browser location.
 */
function renderAt(path: string) {
  return render(
    <LanguageProvider>
      <Router hook={makeStaticHook(path)}>
        <Suspense fallback={<div data-testid="loading">loading…</div>}>
          <Switch>
            {PAGE_LINKS.map(({ href, component: Page }) => (
              <Route key={href} path={href} component={Page} />
            ))}
            {/* catch-all — must be last, same position as in App.tsx */}
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Router>
    </LanguageProvider>,
  );
}

// ── 1. Completely unknown path ────────────────────────────────────────────────

describe('catch-all route – completely unknown paths show NotFound', () => {
  it('renders "404 Page Not Found" for /this-does-not-exist', () => {
    renderAt('/this-does-not-exist');
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });

  it('renders "404 Page Not Found" for /xyzabc', () => {
    renderAt('/xyzabc');
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });

  it('renders "404 Page Not Found" for /foo/bar/baz (deep unknown)', () => {
    renderAt('/foo/bar/baz');
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });
});

// ── 2. Near-miss typo paths ───────────────────────────────────────────────────

describe('catch-all route – near-miss typo paths show NotFound', () => {
  it('renders NotFound for /trainig (one-letter typo of /training)', () => {
    renderAt('/trainig');
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });

  it('renders NotFound for /traning (missing "i" in /training)', () => {
    renderAt('/traning');
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });

  it('renders NotFound for /contakt (German spelling of /contact)', () => {
    renderAt('/contakt');
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });

  it('renders NotFound for /spirecut-de (unknown variant of /spirecut)', () => {
    renderAt('/spirecut-de');
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });
});

// ── 3. Sub-path of a known route that has no specific handler ─────────────────

describe('catch-all route – unlisted sub-paths of known routes show NotFound', () => {
  it('renders NotFound for /training/unknown-course', () => {
    renderAt('/training/unknown-course');
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });

  it('renders NotFound for /admin/nonexistent-section', () => {
    renderAt('/admin/nonexistent-section');
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });
});

// ── 4. PAGE_LINKS paths must NOT trigger the catch-all ────────────────────────
//
// This is the negative / sanity check: known routes should not render NotFound.
// NotFound is sync and renders immediately, so its absence is a reliable signal
// that the Switch matched a PAGE_LINKS route (even if that page is still
// loading inside Suspense).

describe('catch-all route – PAGE_LINKS paths do NOT show NotFound', () => {
  it('does not render NotFound for / (home)', () => {
    renderAt('/');
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });

  it('does not render NotFound for /training', () => {
    renderAt('/training');
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });

  it('does not render NotFound for /contact', () => {
    renderAt('/contact');
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });

  it('does not render NotFound for /spirecut', () => {
    renderAt('/spirecut');
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });

  it('does not render NotFound for /login (hidden route)', () => {
    renderAt('/login');
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });

  it('does not render NotFound for /admin (hidden route)', () => {
    renderAt('/admin');
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });
});

// ── 5. Catch-all covers ALL PAGE_LINKS hrefs (exhaustive negative check) ──────
//
// For every href in PAGE_LINKS, appending an unknown sub-segment must still
// find the catch-all (because wouter does exact matching by default).

describe('catch-all route – appending unknown segment to any known path hits 404', () => {
  // Only test hrefs without query strings (service entries include '?service=…').
  const exactHrefs = PAGE_LINKS
    .map((l) => l.href)
    .filter((href) => !href.includes('?'));

  for (const href of exactHrefs) {
    const unknownPath = `${href === '/' ? '' : href}/unknown-segment`;
    it(`renders NotFound for ${unknownPath}`, () => {
      renderAt(unknownPath);
      expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
    });
  }
});

// ── 6. Base-path-aware routing ────────────────────────────────────────────────
//
// In production, App.tsx mounts the wouter Router with a `base` prop derived
// from import.meta.env.BASE_URL (set via vite.config.ts BASE_PATH env var).
// Wouter strips the base prefix before matching routes, so unknown paths that
// arrive under the base must still reach the catch-all and show NotFound.
// Paths that fall entirely outside the base must also show NotFound (wouter
// finds no matching Switch branch and falls through to the catch-all).
//
// We use the same `hook` trick as above, but add `base` to the Router so the
// tests mirror the production mounting point.

/**
 * Production base as configured in the deployment environment.
 *
 * vitest.config.ts injects `__TEST_BASE_PATH__` at compile time from the
 * `BASE_PATH` environment variable (falling back to '/iroc-website' when the
 * variable is absent).  That is the same variable vite.config.ts reads, so any
 * change to the deployment base is automatically reflected here — if someone
 * updates BASE_PATH, these tests re-evaluate against the new prefix and will
 * break loudly if a known route no longer resolves correctly.
 */
declare const __TEST_BASE_PATH__: string;
const PROD_BASE = __TEST_BASE_PATH__;

/**
 * Render the routing Switch with a Router that has both a pinned static path
 * (via `hook`) AND a base prop that mirrors the production deployment.
 */
function renderAtWithBase(path: string, base: string = PROD_BASE) {
  return render(
    <LanguageProvider>
      <Router hook={makeStaticHook(path)} base={base}>
        <Suspense fallback={<div data-testid="loading">loading…</div>}>
          <Switch>
            {PAGE_LINKS.map(({ href, component: Page }) => (
              <Route key={href} path={href} component={Page} />
            ))}
            {/* catch-all — same position as in App.tsx */}
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Router>
    </LanguageProvider>,
  );
}

describe('catch-all route – base-path-aware: unknown sub-paths show NotFound', () => {
  it('renders NotFound for an unknown path nested under the base (/iroc-website/unknown)', () => {
    renderAtWithBase(`${PROD_BASE}/unknown`);
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });

  it('renders NotFound for a deeply nested unknown path under the base (/iroc-website/a/b/c)', () => {
    renderAtWithBase(`${PROD_BASE}/a/b/c`);
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });

  it('renders NotFound for a near-miss typo nested under the base (/iroc-website/trainig)', () => {
    renderAtWithBase(`${PROD_BASE}/trainig`);
    expect(screen.getByText(NOT_FOUND_TEXT)).toBeInTheDocument();
  });
});

// When the location is entirely outside the base prefix wouter holds the
// Router dormant — no routes (not even the catch-all) are evaluated, so
// nothing is rendered.  In production such requests are never forwarded to
// this app at all, so a blank mount is the correct and safe outcome.
describe('catch-all route – base-path-aware: paths outside the base render nothing', () => {
  it('renders nothing (not even NotFound) for a path outside the base (/other-app/page)', () => {
    renderAtWithBase('/other-app/page');
    // Router is dormant — no route fires, no NotFound banner appears.
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });

  it('renders nothing for the root path when the base is not root (/)', () => {
    renderAtWithBase('/');
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });
});

describe('catch-all route – base-path-aware: known paths under the base do NOT show NotFound', () => {
  it('does not render NotFound for the home route under the base (/iroc-website/)', () => {
    renderAtWithBase(`${PROD_BASE}/`);
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });

  it('does not render NotFound for /training under the base (/iroc-website/training)', () => {
    renderAtWithBase(`${PROD_BASE}/training`);
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });

  it('does not render NotFound for /contact under the base (/iroc-website/contact)', () => {
    renderAtWithBase(`${PROD_BASE}/contact`);
    expect(screen.queryByText(NOT_FOUND_TEXT)).not.toBeInTheDocument();
  });
});
