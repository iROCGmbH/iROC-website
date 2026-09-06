/**
 * mobile-nav-active
 *
 * Confirms that the Products section in the mobile navigation keeps its active
 * state in sync when the current route changes between product and flat pages.
 * The mobile menu has its own markup, so desktop active-state tests do not cover
 * this indicator.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Navigation } from '@/components/Navigation';
import { flatLinks, productLinks } from '@/config/navLinks';

// ── Controllable location mock ────────────────────────────────────────────────

const locationBox = vi.hoisted(() => ({ value: '/' }));

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    useLocation: () => [locationBox.value],
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
  locationBox.value = '/';
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

function openMobileMenu() {
  const toggle = document.querySelector('button.md\\:hidden') as HTMLButtonElement;
  expect(toggle, 'mobile toggle button not found').not.toBeNull();
  fireEvent.click(toggle);
}

function getMobilePanel(): HTMLElement {
  const panel = document.querySelector('div.md\\:hidden') as HTMLElement;
  expect(panel, 'mobile menu panel not found — is it open?').not.toBeNull();
  return panel;
}

function getMobileProductsButton(): HTMLElement {
  const panel = getMobilePanel();
  const button = Array.from(panel.querySelectorAll('p')).find(
    (element) => element.textContent?.trim() === 'Produkte' || element.textContent?.trim() === 'Products',
  );
  expect(button, 'mobile Products button not found').not.toBeUndefined();
  return button!;
}

describe('real Navigation – mobile Products active state updates on sequential navigation', () => {
  it('navigating from a product route to a flat route removes border-b-2 from Products', () => {
    const productHref = productLinks[0].href;
    const flatHref = flatLinks[1].href;

    locationBox.value = productHref;
    const { rerender } = renderNavigation();
    openMobileMenu();

    expect(
      getMobileProductsButton().className,
      `mobile Products button should be active when route is ${productHref}`,
    ).toContain('border-b-2');

    locationBox.value = flatHref;
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );
    openMobileMenu();

    expect(
      getMobileProductsButton().className,
      'mobile Products button should lose border-b-2 after navigating to a flat route',
    ).not.toContain('border-b-2');
  });

  it('navigating from a flat route to a product route adds border-b-2 to Products', () => {
    const flatHref = flatLinks[1].href;
    const productHref = productLinks[0].href;

    locationBox.value = flatHref;
    const { rerender } = renderNavigation();
    openMobileMenu();

    expect(
      getMobileProductsButton().className,
      'mobile Products button should not be active on a flat route',
    ).not.toContain('border-b-2');

    locationBox.value = productHref;
    rerender(
      <LanguageProvider>
        <Navigation />
      </LanguageProvider>,
    );
    openMobileMenu();

    expect(
      getMobileProductsButton().className,
      `mobile Products button should gain border-b-2 after navigating to ${productHref}`,
    ).toContain('border-b-2');
  });
});