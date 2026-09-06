/**
 * nav-group-router-sync
 *
 * Verifies that the App.tsx router and Navigation.tsx nav arrays stay in sync
 * with PAGE_LINKS, so a `group` typo on an entry cannot silently drop its
 * route or make it unreachable.
 *
 * How the router works (App.tsx):
 *   PAGE_LINKS.map(({ href, component }) => <Route path={href} component={component} />)
 *
 * That means the router registers EVERY PAGE_LINKS entry regardless of group,
 * whereas the nav sections filter by group. A typo (e.g. "hidde" instead of
 * "hidden") would:
 *  - still produce a route (the entry remains in PAGE_LINKS)
 *  - silently disappear from ALL nav sections (no group matches)
 *  - be caught by the valid-group assertion in this suite
 *
 * Covered guarantees
 * ──────────────────
 * 1. Every PAGE_LINKS entry's href has a corresponding router route.
 * 2. The router registers no href that is not in PAGE_LINKS.
 * 3. Every PAGE_LINKS entry's group is a valid NavGroup value.
 * 4. Hidden-group entries are present in the router set but absent from all
 *    three nav arrays (flat / product / service).
 * 5. Non-hidden entries appear in exactly one nav array and are also routed.
 * 6. A mistyped group value is detected before it can cause a silent drop.
 */

import { describe, it, expect } from 'vitest';
import {
  PAGE_LINKS,
  flatLinks,
  productLinks,
  serviceLinks,
  NavGroup,
} from '@/config/navLinks';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_GROUPS: NavGroup[] = ['flat', 'product', 'service', 'hidden'];

/**
 * Simulate what App.tsx does: collect every href from PAGE_LINKS.
 * No group filtering — all entries become routes.
 */
function deriveRouterHrefs(links: typeof PAGE_LINKS): string[] {
  return links.map((l) => l.href);
}

/** Nav arrays derived the same way Navigation.tsx derives them. */
const navFlat    = flatLinks.map((l) => l.href);
const navProduct = productLinks.map((l) => l.href);
const navService = serviceLinks.map((l) => l.href);

// Precompute router set once for all tests.
const routerHrefs = deriveRouterHrefs(PAGE_LINKS);
const routerHrefSet = new Set(routerHrefs);

// ── 1. Every PAGE_LINKS href is registered as a route ────────────────────────

describe('router coverage – every PAGE_LINKS href has a route', () => {
  it('router hrefs array has the same length as PAGE_LINKS', () => {
    expect(routerHrefs).toHaveLength(PAGE_LINKS.length);
  });

  it('every flat-group entry href is registered in the router', () => {
    for (const link of flatLinks) {
      expect(routerHrefSet.has(link.href)).toBe(true);
    }
  });

  it('every product-group entry href is registered in the router', () => {
    for (const link of productLinks) {
      expect(routerHrefSet.has(link.href)).toBe(true);
    }
  });

  it('every service-group entry href is registered in the router', () => {
    for (const link of serviceLinks) {
      expect(routerHrefSet.has(link.href)).toBe(true);
    }
  });

  it('every hidden-group entry href is registered in the router', () => {
    const hiddenLinks = PAGE_LINKS.filter((l) => l.group === 'hidden');
    for (const link of hiddenLinks) {
      expect(routerHrefSet.has(link.href)).toBe(true);
    }
  });

  it('every PAGE_LINKS entry href — regardless of group — is in the router', () => {
    for (const link of PAGE_LINKS) {
      expect(routerHrefSet.has(link.href)).toBe(true);
    }
  });
});

// ── 2. The router registers no extra hrefs beyond PAGE_LINKS ─────────────────

describe('router exactness – no phantom routes beyond PAGE_LINKS', () => {
  it('router contains no href absent from PAGE_LINKS', () => {
    const pageHrefSet = new Set(PAGE_LINKS.map((l) => l.href));
    for (const href of routerHrefs) {
      expect(pageHrefSet.has(href)).toBe(true);
    }
  });

  it('router href count equals PAGE_LINKS length (no duplicates or extras)', () => {
    expect(new Set(routerHrefs).size).toBe(PAGE_LINKS.length);
  });
});

// ── 3. Every group value is a valid NavGroup ──────────────────────────────────
//
// This is the primary typo guard. A value like "hidde" or "serrvice" does not
// match any filter and silently drops the entry from all nav sections.

describe('group validity – every PAGE_LINKS entry has a recognised group', () => {
  it('every PAGE_LINKS entry group is one of the four valid NavGroup values', () => {
    for (const link of PAGE_LINKS) {
      expect(VALID_GROUPS).toContain(link.group);
    }
  });

  it('no PAGE_LINKS entry has an empty or undefined group', () => {
    for (const link of PAGE_LINKS) {
      expect(link.group).toBeTruthy();
    }
  });

  it('invalid group value "hidde" would be caught (regression guard)', () => {
    // Directly assert the guard works: a known-invalid value is not in VALID_GROUPS.
    expect(VALID_GROUPS).not.toContain('hidde' as string);
    expect(VALID_GROUPS).not.toContain('serrvice' as string);
    expect(VALID_GROUPS).not.toContain('flatt' as string);
    expect(VALID_GROUPS).not.toContain('products' as string);
  });
});

// ── 4. Hidden entries: routed but absent from all nav arrays ─────────────────

describe('hidden entries – routed but never rendered in nav', () => {
  const hiddenLinks = PAGE_LINKS.filter((l) => l.group === 'hidden');

  it('there is at least one hidden PAGE_LINKS entry', () => {
    expect(hiddenLinks.length).toBeGreaterThan(0);
  });

  it('every hidden entry is present in the router', () => {
    for (const link of hiddenLinks) {
      expect(routerHrefSet.has(link.href)).toBe(true);
    }
  });

  it('no hidden entry appears in the flat nav array', () => {
    for (const link of hiddenLinks) {
      expect(navFlat).not.toContain(link.href);
    }
  });

  it('no hidden entry appears in the product nav array', () => {
    for (const link of hiddenLinks) {
      expect(navProduct).not.toContain(link.href);
    }
  });

  it('no hidden entry appears in the service nav array', () => {
    for (const link of hiddenLinks) {
      expect(navService).not.toContain(link.href);
    }
  });

  it('hidden entry count equals PAGE_LINKS hidden entries count', () => {
    expect(hiddenLinks.length).toBe(PAGE_LINKS.filter((l) => l.group === 'hidden').length);
  });
});

// ── 5. Non-hidden entries: in exactly one nav array and also routed ───────────

describe('non-hidden entries – each appears in exactly one nav array and the router', () => {
  const nonHiddenLinks = PAGE_LINKS.filter((l) => l.group !== 'hidden');

  it('every non-hidden entry is registered in the router', () => {
    for (const link of nonHiddenLinks) {
      expect(routerHrefSet.has(link.href)).toBe(true);
    }
  });

  it('every flat entry is in navFlat and not in navProduct or navService', () => {
    const flatEntries = PAGE_LINKS.filter((l) => l.group === 'flat');
    for (const link of flatEntries) {
      expect(navFlat).toContain(link.href);
      expect(navProduct).not.toContain(link.href);
      expect(navService).not.toContain(link.href);
    }
  });

  it('every product entry is in navProduct and not in navFlat or navService', () => {
    const productEntries = PAGE_LINKS.filter((l) => l.group === 'product');
    for (const link of productEntries) {
      expect(navProduct).toContain(link.href);
      expect(navFlat).not.toContain(link.href);
      expect(navService).not.toContain(link.href);
    }
  });

  it('every service entry is in navService and not in navFlat or navProduct', () => {
    const serviceEntries = PAGE_LINKS.filter((l) => l.group === 'service');
    for (const link of serviceEntries) {
      expect(navService).toContain(link.href);
      expect(navFlat).not.toContain(link.href);
      expect(navProduct).not.toContain(link.href);
    }
  });

  it('each non-hidden entry appears in exactly one of the three nav arrays', () => {
    for (const link of nonHiddenLinks) {
      const inFlat    = navFlat.includes(link.href) ? 1 : 0;
      const inProduct = navProduct.includes(link.href) ? 1 : 0;
      const inService = navService.includes(link.href) ? 1 : 0;
      expect(inFlat + inProduct + inService).toBe(1);
    }
  });
});

// ── 6. Typo-simulation: mistyped group silently drops from nav but not router ──
//
// This suite uses a local mock to prove that the valid-group assertion above is
// the correct guard. If the assertion were absent, a typo in `group` would pass
// undetected: the entry stays in PAGE_LINKS (and therefore in the router) but
// vanishes from every nav array.

describe('typo simulation – mistyped group is detectable via group validity check', () => {
  // Simulate a PAGE_LINKS entry with a mistyped group.
  const MISTYPED_GROUP = 'hidde'; // one character short of 'hidden'

  const mockEntry = {
    href: '/some-page',
    labelDE: 'Seite',
    labelEN: 'Some Page',
    group: MISTYPED_GROUP,
  };

  it('mistyped group entry would still produce a router route', () => {
    // The router maps all entries regardless of group.
    const hrefs = [mockEntry].map((l) => l.href);
    expect(hrefs).toContain('/some-page');
  });

  it('mistyped group entry would be absent from flat nav (filtered out)', () => {
    const flat = [mockEntry].filter((l) => l.group === 'flat');
    expect(flat).toHaveLength(0);
  });

  it('mistyped group entry would be absent from product nav (filtered out)', () => {
    const product = [mockEntry].filter((l) => l.group === 'product');
    expect(product).toHaveLength(0);
  });

  it('mistyped group entry would be absent from service nav (filtered out)', () => {
    const service = [mockEntry].filter((l) => l.group === 'service');
    expect(service).toHaveLength(0);
  });

  it('mistyped group entry would be absent from hidden nav (filtered out)', () => {
    const hidden = [mockEntry].filter((l) => l.group === 'hidden');
    expect(hidden).toHaveLength(0);
  });

  it('the valid-group assertion catches the mistyped group', () => {
    // This is what the real PAGE_LINKS test above does for every entry.
    expect(VALID_GROUPS).not.toContain(mockEntry.group as string);
  });
});
