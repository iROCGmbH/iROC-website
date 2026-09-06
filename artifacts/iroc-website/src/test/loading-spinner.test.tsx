/**
 * Guards against the blank-flash regression where the Suspense fallback
 * is accidentally reverted to `null` instead of `<LoadingSpinner />`.
 *
 * Three layers of protection:
 *  1. Structural: App.tsx must declare `<Suspense fallback={<LoadingSpinner />}>`
 *  2. Config: every PAGE_LINKS entry must be a React.lazy() component
 *  3. DOM: a forever-suspending child inside that Suspense renders the spinner
 *     element in the DOM (role="status"), never a blank body
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { PAGE_LINKS } from '@/config/navLinks';

// ── 1. Structural guard: App.tsx uses LoadingSpinner as the fallback ──────────

describe('App.tsx Suspense configuration', () => {
  it('declares <Suspense fallback={<LoadingSpinner />}>', () => {
    // Read the source file as text so the assertion survives any bundle
    // optimisation and doesn't require spinning up the full React tree.
    const appSrc = readFileSync(
      resolve(import.meta.dirname, '..', 'App.tsx'),
      'utf8',
    );

    // The fallback prop must reference LoadingSpinner, not null or undefined.
    expect(appSrc).toMatch(/fallback=\{<LoadingSpinner\s*\/>\}/);
  });

  it('imports LoadingSpinner from @/components/LoadingSpinner', () => {
    const appSrc = readFileSync(
      resolve(import.meta.dirname, '..', 'App.tsx'),
      'utf8',
    );
    expect(appSrc).toMatch(/import.*LoadingSpinner.*from ['"]@\/components\/LoadingSpinner['"]/);
  });
});

// ── 2. Config guard: every PAGE_LINKS entry must be a lazy() component ────────

describe('PAGE_LINKS – all entries are lazy-loaded', () => {
  // React.lazy() sets $$typeof to the react.lazy symbol so the renderer knows
  // to treat it as a lazy reference.  Plain function components or class
  // components do NOT have this symbol.
  const REACT_LAZY = Symbol.for('react.lazy');

  // Deduplicate by component reference: /order and /order?service=* share Order.
  const uniqueComponents = [...new Map(PAGE_LINKS.map((l) => [l.component, l])).values()];

  it.each(uniqueComponents)(
    'PAGE_LINK "$href" uses React.lazy()',
    ({ href, component }) => {
      expect(
        (component as unknown as { $$typeof: symbol }).$$typeof,
        `Route "${href}" component must be wrapped in React.lazy() – ` +
          `found $$typeof=${String(
            (component as unknown as { $$typeof: symbol }).$$typeof,
          )}`,
      ).toBe(REACT_LAZY);
    },
  );
});

// ── 3. DOM guard: spinner element is present during the loading phase ─────────

/**
 * A component that throws a never-resolving Promise, keeping the Suspense
 * boundary in its "loading" state for the duration of the test.
 * Return type is `never` so TypeScript accepts it as a valid JSX component.
 */
function AlwaysSuspends(): never {
  throw new Promise<void>(() => { /* never resolves */ });
}

describe('LoadingSpinner – appears in DOM while Suspense is pending', () => {
  it('renders role="status" element (not a blank body) as the fallback', () => {
    render(
      <Suspense fallback={<LoadingSpinner />}>
        <AlwaysSuspends />
      </Suspense>,
    );

    // Spinner renders <Loader2Icon role="status" aria-label="Loading" />
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('the fallback container is visible (min-height wrapper present)', () => {
    render(
      <Suspense fallback={<LoadingSpinner />}>
        <AlwaysSuspends />
      </Suspense>,
    );

    const spinner = screen.getByRole('status');
    // Spinner must live inside the centering wrapper div
    const wrapper = spinner.closest('div');
    expect(wrapper).toBeInTheDocument();
    // The wrapper carries the min-h-[60vh] class defined in LoadingSpinner.tsx
    expect(wrapper?.className).toMatch(/min-h/);
  });

  it('does NOT render a blank body (no content at all) while suspended', () => {
    const { container } = render(
      <Suspense fallback={<LoadingSpinner />}>
        <AlwaysSuspends />
      </Suspense>,
    );

    // Container must have some child nodes — not empty
    expect(container.firstChild).not.toBeNull();
    // And the spinner status element must be the thing shown
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
