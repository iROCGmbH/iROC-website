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

const saved = new Map<string, number>();
let isPop = false;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => { isPop = true; });
}

export function ScrollRestoration() {
  const [location] = useLocation();
  const prevPath = useRef(location);

  useEffect(() => {
    const onScroll = () => saved.set(location, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location]);

  useEffect(() => {
    if (prevPath.current === location) return;
    prevPath.current = location;

    if (isPop) {
      isPop = false;
      const y = saved.get(location) ?? 0;
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }));
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [location]);

  return null;
}
