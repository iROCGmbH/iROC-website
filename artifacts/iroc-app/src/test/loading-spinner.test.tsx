/**
 * Guards against the blank-flash regression where the Suspense fallback
 * is accidentally reverted to `null` instead of `<LoadingSpinner />`.
 *
 * Three layers of protection:
 *  1. Structural: App.tsx must declare the LoadingSpinner fallback.
 *  2. Config: every registered app route must be a React.lazy() component.
 *  3. DOM: a forever-suspending child inside that Suspense renders the
 *     spinner element instead of an empty body.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { APP_ROUTES } from '@/config/routeConfig';

describe('App.tsx Suspense configuration', () => {
  it('declares LoadingSpinner as the Suspense fallback', () => {
    const appSrc = readFileSync(
      resolve(import.meta.dirname, '..', 'App.tsx'),
      'utf8',
    );

    expect(appSrc).toMatch(/fallback=\{<LoadingSpinner\s*\/>\}/);
  });

  it('imports LoadingSpinner from the app loading-spinner component', () => {
    const appSrc = readFileSync(
      resolve(import.meta.dirname, '..', 'App.tsx'),
      'utf8',
    );

    expect(appSrc).toMatch(
      /import.*LoadingSpinner.*from ['"]@\/components\/LoadingSpinner['"]/,
    );
  });
});

describe('APP_ROUTES – all entries are lazy-loaded', () => {
  const REACT_LAZY = Symbol.for('react.lazy');

  it.each(APP_ROUTES)(
    'route "$path" uses React.lazy()',
    ({ path, component }) => {
      expect(
        (component as unknown as { $$typeof: symbol }).$$typeof,
        `Route "${path}" component must be wrapped in React.lazy() – ` +
          `found $$typeof=${String(
            (component as unknown as { $$typeof: symbol }).$$typeof,
          )}`,
      ).toBe(REACT_LAZY);
    },
  );
});

function AlwaysSuspends(): never {
  throw new Promise<void>(() => { /* never resolves */ });
}

describe('LoadingSpinner – appears in DOM while Suspense is pending', () => {
  it('renders a status element instead of a blank body', () => {
    const { container } = render(
      <Suspense fallback={<LoadingSpinner />}>
        <AlwaysSuspends />
      </Suspense>,
    );

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the spinner inside the visible centering wrapper', () => {
    render(
      <Suspense fallback={<LoadingSpinner />}>
        <AlwaysSuspends />
      </Suspense>,
    );

    const spinner = screen.getByRole('status');
    const wrapper = spinner.closest('div');
    expect(wrapper).toBeInTheDocument();
    expect(wrapper?.className).toMatch(/min-h/);
  });
});