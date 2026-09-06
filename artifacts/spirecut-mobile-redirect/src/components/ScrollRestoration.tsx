/**
 * ScrollRestoration
 *
 * • Forward navigation  → instantly scroll to the top of the new page.
 * • Back / forward (popstate) → restore the exact scroll position the user
 *   had on that page the last time they visited it.
 *
 * Must be rendered inside <WouterRouter> so useLocation works.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';

// Module-level state so it persists across re-renders.
const saved = new Map<string, number>();
let isPop = false;

if (typeof window !== 'undefined') {
  // popstate fires before the new route renders, so we flag it here.
  window.addEventListener('popstate', () => { isPop = true; });
}

export function ScrollRestoration() {
  const [location] = useLocation();
  // Track the previous path so we save the right position.
  const prevPath = useRef(location);

  // Continuously save scroll position for the current path.
  useEffect(() => {
    const onScroll = () => saved.set(location, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location]);

  // When the location changes, either restore or reset.
  useEffect(() => {
    if (prevPath.current === location) return;
    prevPath.current = location;

    if (isPop) {
      isPop = false;
      const y = saved.get(location) ?? 0;
      // rAF ensures the new page content is in the DOM before we scroll.
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }));
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      // Reset keyboard focus so it doesn't stay on the nav link just clicked.
      requestAnimationFrame(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        // Move focus to <main> if available, otherwise <body>, so screen
        // readers announce the new page from the top.
        const main = document.querySelector<HTMLElement>('main') ?? document.body;
        main.tabIndex = -1;
        main.focus({ preventScroll: true });
      });
    }
  }, [location]);

  return null;
}
