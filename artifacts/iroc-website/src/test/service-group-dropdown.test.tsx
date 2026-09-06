/**
 * service-group-dropdown
 *
 * Two groups of tests:
 *
 * 1. Navigation dropdown — confirms every serviceLinks entry is rendered
 *    inside the Services section of the dropdown with the exact query-string
 *    href defined in navLinks.ts (e.g. "/order?service=support").
 *
 * 2. Order page service param — confirms that when the Order page is loaded
 *    with ?service=support or ?service=marketing the component shows the
 *    "Service Request" heading and the correct ServiceBanner, not the
 *    product-order form.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { Navigation } from '@/components/Navigation';
import Order from '@/pages/Order';
import { serviceLinks } from '@/config/navLinks';

// ── Shared mocks ──────────────────────────────────────────────────────────────

// wouter — Navigation uses useLocation; Order uses useSearch
// We expose a mutable ref so individual tests can override useSearch.
let mockSearch = '';

// Mutable spy + flag so individual describe blocks can override behaviour
// without needing vi.mocked (which doesn't work on plain factory functions).
let mutateSpy = vi.fn();
let captchaVerified = false;

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    useLocation: () => ['/'],
    useSearch: () => mockSearch,
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

// API mutations — useSubmitOrder returns the module-level mutateSpy so tests
// that need to assert on the call can replace it in their own beforeEach.
vi.mock('@workspace/api-client-react', () => ({
  useSubmitOrder: () => ({ mutate: mutateSpy, isPending: false }),
  useRegisterCustomer: () => ({ mutate: vi.fn(), isPending: false }),
  OrderInputCustomerType: { existing: 'existing', new: 'new' },
  OrderInputInstrument: { spirecut: 'spirecut', ministem: 'ministem' },
  CustomerRegistrationInputInstrument: {
    spirecut: 'spirecut',
    ministem: 'ministem',
    both: 'both',
  },
}));

// Toast — not under test
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// HumanCheck — captchaVerified is false by default; individual tests can flip it.
vi.mock('@/components/HumanCheck', () => ({
  useHumanCheck: () => ({ verified: captchaVerified, reset: vi.fn() }),
  HumanCheckWidget: () => <div data-testid="human-check" />,
}));

// Suppress public-products fetch — not under test
beforeEach(() => {
  mockSearch = '';
  mutateSpy = vi.fn();
  captchaVerified = false;
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
  // The dropdown toggle button is labelled "Produkte" in DE (default language)
  const toggle = screen.getByRole('button', { name: /Produkte/i });
  fireEvent.click(toggle);
}

function renderOrder() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <Order />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Navigation dropdown — service link hrefs
// ═══════════════════════════════════════════════════════════════════════════════

describe('Navigation dropdown – service links are rendered with correct hrefs', () => {
  it('renders the correct number of service links in the dropdown', () => {
    renderNavigation();
    openDropdown();

    // Every serviceLink href should appear exactly once inside the dropdown.
    // We check by href attribute to be robust against label changes.
    const allAnchors = document.querySelectorAll('a');
    const serviceHrefs = serviceLinks.map((l) => l.href);
    const rendered = Array.from(allAnchors)
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && serviceHrefs.includes(h));

    expect(rendered.length).toBe(serviceLinks.length);
  });

  it('renders the Post-Training Support link with href "/order?service=support"', () => {
    renderNavigation();
    openDropdown();

    const link = document.querySelector('a[href="/order?service=support"]');
    expect(link).not.toBeNull();
  });

  it('renders the Practice Marketing link with href "/order?service=marketing"', () => {
    renderNavigation();
    openDropdown();

    const link = document.querySelector('a[href="/order?service=marketing"]');
    expect(link).not.toBeNull();
  });

  it('every serviceLinks entry has its exact href rendered in the dropdown', () => {
    renderNavigation();
    openDropdown();

    for (const sl of serviceLinks) {
      const link = document.querySelector(`a[href="${sl.href}"]`);
      expect(link).not.toBeNull();
    }
  });

  it('service links carry query-string params — not bare /order paths', () => {
    renderNavigation();
    openDropdown();

    // None of the service links should be rendered as a bare "/order" href
    for (const sl of serviceLinks) {
      expect(sl.href).toMatch(/\?service=/);
      const link = document.querySelector(`a[href="${sl.href}"]`);
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toContain('?service=');
    }
  });

  it('Post-Training Support link label is visible in the dropdown (DE)', () => {
    renderNavigation();
    openDropdown();

    expect(screen.getByText('Post-Training Support')).toBeInTheDocument();
  });

  it('Practice Marketing link label is visible in the dropdown (DE)', () => {
    renderNavigation();
    openDropdown();

    expect(screen.getByText('Praxis-Marketing')).toBeInTheDocument();
  });

  it('dropdown closes when a service link is clicked (onClick fires)', () => {
    renderNavigation();
    openDropdown();

    const link = document.querySelector(
      'a[href="/order?service=support"]',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();

    // After click the dropdown should be gone from the DOM
    fireEvent.click(link);
    expect(
      document.querySelector('a[href="/order?service=support"]'),
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Order page — ?service= param controls the shown section
// ═══════════════════════════════════════════════════════════════════════════════

describe('Order page – ?service=support param shows service-request section', () => {
  beforeEach(() => {
    mockSearch = '?service=support';
  });

  it('renders "Serviceanfrage" heading (DE) when service=support', () => {
    renderOrder();
    expect(
      screen.getByRole('heading', { name: 'Serviceanfrage' }),
    ).toBeInTheDocument();
  });

  it('does not render "Bestellung" heading when service=support', () => {
    renderOrder();
    expect(
      screen.queryByRole('heading', { name: 'Bestellung' }),
    ).not.toBeInTheDocument();
  });

  it('shows the "Serviceanfrage" order-type button as active (service mode pre-selected)', () => {
    renderOrder();
    // The order-type toggle inside ExistingCustomerForm should have
    // "Serviceanfrage" in the active (primary) style — we confirm it is present.
    expect(
      screen.getByRole('button', { name: 'Serviceanfrage' }),
    ).toBeInTheDocument();
  });

  it('shows the Post-Training Support banner when service=support', () => {
    renderOrder();
    // The ServiceBanner for post_training_support renders this text.
    // getAllByText is used because the same string also appears in the <select> option.
    const matches = screen.getAllByText(/Post-Training Support/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('does not show the product line-items editor when service=support', () => {
    renderOrder();
    // The product editor contains "Bestellte Produkte" label
    expect(
      screen.queryByText(/Bestellte Produkte/),
    ).not.toBeInTheDocument();
  });

  it('shows the submit button text "Anfrage senden" when service=support', () => {
    renderOrder();
    expect(
      screen.getByRole('button', { name: 'Anfrage senden' }),
    ).toBeInTheDocument();
  });
});

describe('Order page – ?service=marketing param shows service-request section', () => {
  beforeEach(() => {
    mockSearch = '?service=marketing';
  });

  it('renders "Serviceanfrage" heading (DE) when service=marketing', () => {
    renderOrder();
    expect(
      screen.getByRole('heading', { name: 'Serviceanfrage' }),
    ).toBeInTheDocument();
  });

  it('does not render "Bestellung" heading when service=marketing', () => {
    renderOrder();
    expect(
      screen.queryByRole('heading', { name: 'Bestellung' }),
    ).not.toBeInTheDocument();
  });

  it('shows the Practice Marketing banner when service=marketing', () => {
    renderOrder();
    // The ServiceBanner for practice_marketing_support renders this text.
    // getAllByText is used because the same string also appears in the <select> option.
    const matches = screen.getAllByText(/Praxis-Marketing Support/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('does not show the product line-items editor when service=marketing', () => {
    renderOrder();
    expect(
      screen.queryByText(/Bestellte Produkte/),
    ).not.toBeInTheDocument();
  });

  it('shows the submit button text "Anfrage senden" when service=marketing', () => {
    renderOrder();
    expect(
      screen.getByRole('button', { name: 'Anfrage senden' }),
    ).toBeInTheDocument();
  });
});

describe('Order page – no service param shows product-order section', () => {
  beforeEach(() => {
    mockSearch = '';
  });

  it('renders "Bestellung" heading (DE) when no service param', () => {
    renderOrder();
    expect(
      screen.getByRole('heading', { name: 'Bestellung' }),
    ).toBeInTheDocument();
  });

  it('does not render "Serviceanfrage" heading when no service param', () => {
    renderOrder();
    expect(
      screen.queryByRole('heading', { name: 'Serviceanfrage' }),
    ).not.toBeInTheDocument();
  });

  it('shows the product line-items editor when no service param', () => {
    renderOrder();
    expect(screen.getByText(/Bestellte Produkte/)).toBeInTheDocument();
  });

  it('shows the submit button text "Bestellung senden" when no service param', () => {
    renderOrder();
    expect(
      screen.getByRole('button', { name: 'Bestellung senden' }),
    ).toBeInTheDocument();
  });
});

describe('Order page – unknown service param falls back to product mode', () => {
  beforeEach(() => {
    mockSearch = '?service=unknown';
  });

  it('renders "Bestellung" heading for unknown service param', () => {
    renderOrder();
    expect(
      screen.getByRole('heading', { name: 'Bestellung' }),
    ).toBeInTheDocument();
  });

  it('shows the product line-items editor for unknown service param', () => {
    renderOrder();
    expect(screen.getByText(/Bestellte Produkte/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Order page — in-session service dropdown toggle swaps the ServiceBanner
// ═══════════════════════════════════════════════════════════════════════════════

describe('Order page – switching service dropdown from support to marketing replaces the banner', () => {
  beforeEach(() => {
    mockSearch = '?service=support';
  });

  it('initially shows the Post-Training Support banner description', () => {
    renderOrder();
    // The ServiceBanner description for post_training_support is unique to that banner.
    expect(
      screen.getByText(/Kontinuierliche Unterstützung/),
    ).toBeInTheDocument();
  });

  it('does not initially show the Practice Marketing banner description', () => {
    renderOrder();
    expect(
      screen.queryByText(/Individuelle Werbematerialien/),
    ).not.toBeInTheDocument();
  });

  it('swaps to the Practice Marketing banner after changing the select', () => {
    renderOrder();

    // The select currently shows "Post-Training Support & Begleitung"
    const select = screen.getByDisplayValue(/Post-Training Support/);
    fireEvent.change(select, { target: { value: 'practice_marketing_support' } });

    // Practice Marketing banner description is now visible
    expect(
      screen.getByText(/Individuelle Werbematerialien/),
    ).toBeInTheDocument();
    // Post-Training Support banner description is gone
    expect(
      screen.queryByText(/Kontinuierliche Unterstützung/),
    ).not.toBeInTheDocument();
  });

  it('does not show the product line-items editor after switching to marketing', () => {
    renderOrder();

    const select = screen.getByDisplayValue(/Post-Training Support/);
    fireEvent.change(select, { target: { value: 'practice_marketing_support' } });

    expect(
      screen.queryByText(/Bestellte Produkte/),
    ).not.toBeInTheDocument();
  });
});

describe('Order page – switching service dropdown from marketing to support replaces the banner', () => {
  beforeEach(() => {
    mockSearch = '?service=marketing';
  });

  it('initially shows the Practice Marketing banner description', () => {
    renderOrder();
    // The ServiceBanner description for practice_marketing_support is unique to that banner.
    expect(
      screen.getByText(/Individuelle Werbematerialien/),
    ).toBeInTheDocument();
  });

  it('does not initially show the Post-Training Support banner description', () => {
    renderOrder();
    expect(
      screen.queryByText(/Kontinuierliche Unterstützung/),
    ).not.toBeInTheDocument();
  });

  it('swaps to the Post-Training Support banner after changing the select', () => {
    renderOrder();

    // The select currently shows "Praxis-Marketing Support"
    const select = screen.getByDisplayValue(/Praxis-Marketing Support/);
    fireEvent.change(select, { target: { value: 'post_training_support' } });

    // Post-Training Support banner description is now visible
    expect(
      screen.getByText(/Kontinuierliche Unterstützung/),
    ).toBeInTheDocument();
    // Practice Marketing banner description is gone
    expect(
      screen.queryByText(/Individuelle Werbematerialien/),
    ).not.toBeInTheDocument();
  });

  it('does not show the product line-items editor after switching to support', () => {
    renderOrder();

    const select = screen.getByDisplayValue(/Praxis-Marketing Support/);
    fireEvent.change(select, { target: { value: 'post_training_support' } });

    expect(
      screen.queryByText(/Bestellte Produkte/),
    ).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Order page — heading updates live when the URL search string changes
//    (no full page reload — component re-renders because useSearch() is reactive)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Order page – heading updates live when URL search string changes', () => {
  it('switches heading from "Bestellung" to "Serviceanfrage" when search changes to ?service=support', () => {
    mockSearch = '';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Order />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    // Initial state: product mode
    expect(screen.getByRole('heading', { name: 'Bestellung' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Serviceanfrage' })).not.toBeInTheDocument();

    // Simulate the router updating the search string (e.g. user clicks a service link)
    mockSearch = '?service=support';
    rerender(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Order />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    // Heading must have switched without a full reload
    expect(screen.getByRole('heading', { name: 'Serviceanfrage' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bestellung' })).not.toBeInTheDocument();
  });

  it('switches heading back to "Bestellung" when search changes from ?service=support to ""', () => {
    mockSearch = '?service=support';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Order />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    // Initial state: service mode
    expect(screen.getByRole('heading', { name: 'Serviceanfrage' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bestellung' })).not.toBeInTheDocument();

    // Simulate the router navigating back to the bare /order path
    mockSearch = '';
    rerender(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Order />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    // Heading must have reverted and the product form must be back
    expect(screen.getByRole('heading', { name: 'Bestellung' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Serviceanfrage' })).not.toBeInTheDocument();
  });

  it('shows the product line-items editor after search reverts from ?service=support to ""', () => {
    mockSearch = '?service=support';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Order />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    // Service mode: no product editor
    expect(screen.queryByText(/Bestellte Produkte/)).not.toBeInTheDocument();

    // Revert to product mode via URL change
    mockSearch = '';
    rerender(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Order />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    // Product editor must now be visible
    expect(screen.getByText(/Bestellte Produkte/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Order page — instrument passed to submitOrder reflects the *last* service
//    type selected, not the initial one from the URL
// ═══════════════════════════════════════════════════════════════════════════════

/** Fill the minimum required ExistingCustomerForm fields so the zod schema passes. */
function fillExistingCustomerRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText('2026-0001'), {
    target: { value: '2026-0001' },
  });
  fireEvent.change(screen.getByPlaceholderText('ABCD2345'), {
    target: { value: 'ABCD1234' },
  });
  const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
  fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
  const checkbox = document.getElementById('privacy-ext') as HTMLInputElement;
  fireEvent.click(checkbox);
}

describe('Order page – instrument sent to submitOrder reflects last selected service (support → marketing)', () => {
  beforeEach(() => {
    mockSearch = '?service=support';
    // mutateSpy is already freshly reset by the outer beforeEach; just enable captcha.
    captchaVerified = true;
  });

  it('sends instrument: practice_marketing_support after switching the select from support', async () => {
    renderOrder();

    // Switch service dropdown from post_training_support → practice_marketing_support
    const select = screen.getByDisplayValue(/Post-Training Support/);
    fireEvent.change(select, { target: { value: 'practice_marketing_support' } });

    fillExistingCustomerRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Anfrage senden' }));

    await waitFor(() => {
      expect(mutateSpy).toHaveBeenCalledOnce();
      expect(mutateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ instrument: 'practice_marketing_support' }),
        }),
      );
    });
  });

  it('does NOT send instrument: post_training_support when the select was changed to marketing', async () => {
    renderOrder();

    const select = screen.getByDisplayValue(/Post-Training Support/);
    fireEvent.change(select, { target: { value: 'practice_marketing_support' } });

    fillExistingCustomerRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Anfrage senden' }));

    await waitFor(() => {
      expect(mutateSpy).toHaveBeenCalledOnce();
    });

    const calledWith = mutateSpy.mock.calls[0][0] as { data: { instrument: string } };
    expect(calledWith.data.instrument).not.toBe('post_training_support');
  });
});

describe('Order page – instrument sent to submitOrder reflects last selected service (marketing → support)', () => {
  beforeEach(() => {
    mockSearch = '?service=marketing';
    captchaVerified = true;
  });

  it('sends instrument: post_training_support after switching the select from marketing', async () => {
    renderOrder();

    // Switch service dropdown from practice_marketing_support → post_training_support
    const select = screen.getByDisplayValue(/Praxis-Marketing Support/);
    fireEvent.change(select, { target: { value: 'post_training_support' } });

    fillExistingCustomerRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Anfrage senden' }));

    await waitFor(() => {
      expect(mutateSpy).toHaveBeenCalledOnce();
      expect(mutateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ instrument: 'post_training_support' }),
        }),
      );
    });
  });

  it('does NOT send instrument: practice_marketing_support when the select was changed to support', async () => {
    renderOrder();

    const select = screen.getByDisplayValue(/Praxis-Marketing Support/);
    fireEvent.change(select, { target: { value: 'post_training_support' } });

    fillExistingCustomerRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Anfrage senden' }));

    await waitFor(() => {
      expect(mutateSpy).toHaveBeenCalledOnce();
    });

    const calledWith = mutateSpy.mock.calls[0][0] as { data: { instrument: string } };
    expect(calledWith.data.instrument).not.toBe('practice_marketing_support');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Order page — order-type button toggle: service mode → product mode
//    Clicking the "Produktbestellung" button while in service mode must hide
//    the ServiceBanner and restore the product line-items editor.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Order page – clicking Produktbestellung button while in service mode hides ServiceBanner', () => {
  beforeEach(() => {
    mockSearch = '?service=support';
  });

  it('shows the ServiceBanner initially when loaded with ?service=support', () => {
    renderOrder();
    expect(screen.getByText(/Kontinuierliche Unterstützung/)).toBeInTheDocument();
  });

  it('hides the ServiceBanner after clicking the Produktbestellung button', () => {
    renderOrder();

    // Confirm banner is visible before the click
    expect(screen.getByText(/Kontinuierliche Unterstützung/)).toBeInTheDocument();

    // Click the "Produktbestellung" order-type toggle button
    fireEvent.click(screen.getByRole('button', { name: 'Produktbestellung' }));

    // ServiceBanner must be gone
    expect(screen.queryByText(/Kontinuierliche Unterstützung/)).not.toBeInTheDocument();
  });

  it('shows the product line-items editor after clicking the Produktbestellung button', () => {
    renderOrder();

    // Service mode: no product editor
    expect(screen.queryByText(/Bestellte Produkte/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Produktbestellung' }));

    // Product editor must now be visible
    expect(screen.getByText(/Bestellte Produkte/)).toBeInTheDocument();
  });

  it('hides the service-type select after clicking the Produktbestellung button', () => {
    renderOrder();

    // In service mode the service-type <select> is rendered
    expect(screen.getByDisplayValue(/Post-Training Support/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Produktbestellung' }));

    // The service-type select must be gone
    expect(screen.queryByDisplayValue(/Post-Training Support/)).not.toBeInTheDocument();
  });
});

describe('Order page – clicking Produktbestellung button while in service=marketing mode hides ServiceBanner', () => {
  beforeEach(() => {
    mockSearch = '?service=marketing';
  });

  it('hides the Practice Marketing banner after clicking the Produktbestellung button', () => {
    renderOrder();

    // Confirm the marketing banner is visible before the click
    expect(screen.getByText(/Individuelle Werbematerialien/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Produktbestellung' }));

    // Marketing banner must be gone
    expect(screen.queryByText(/Individuelle Werbematerialien/)).not.toBeInTheDocument();
  });

  it('shows the product line-items editor after clicking the Produktbestellung button', () => {
    renderOrder();

    expect(screen.queryByText(/Bestellte Produkte/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Produktbestellung' }));

    expect(screen.getByText(/Bestellte Produkte/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Order page — symmetric toggle: product → service → product
//    Starting from product mode, clicking "Serviceanfrage" switches to service
//    mode, then clicking "Produktbestellung" switches back to product mode.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Order page – product → service → product toggle via order-type buttons', () => {
  beforeEach(() => {
    mockSearch = '';
  });

  it('starts in product mode with the product editor visible', () => {
    renderOrder();
    expect(screen.getByText(/Bestellte Produkte/)).toBeInTheDocument();
    expect(screen.queryByText(/Kontinuierliche Unterstützung/)).not.toBeInTheDocument();
  });

  it('shows the ServiceBanner after clicking Serviceanfrage button', () => {
    renderOrder();

    fireEvent.click(screen.getByRole('button', { name: 'Serviceanfrage' }));

    // Default service type is post_training_support → its banner must appear
    expect(screen.getByText(/Kontinuierliche Unterstützung/)).toBeInTheDocument();
    // Product editor must be gone
    expect(screen.queryByText(/Bestellte Produkte/)).not.toBeInTheDocument();
  });

  it('hides the ServiceBanner again after clicking Produktbestellung button', () => {
    renderOrder();

    // Go to service mode
    fireEvent.click(screen.getByRole('button', { name: 'Serviceanfrage' }));
    expect(screen.getByText(/Kontinuierliche Unterstützung/)).toBeInTheDocument();

    // Return to product mode
    fireEvent.click(screen.getByRole('button', { name: 'Produktbestellung' }));

    // Banner must be gone
    expect(screen.queryByText(/Kontinuierliche Unterstützung/)).not.toBeInTheDocument();
  });

  it('restores the product line-items editor after returning to product mode', () => {
    renderOrder();

    // Switch to service
    fireEvent.click(screen.getByRole('button', { name: 'Serviceanfrage' }));
    expect(screen.queryByText(/Bestellte Produkte/)).not.toBeInTheDocument();

    // Switch back to product
    fireEvent.click(screen.getByRole('button', { name: 'Produktbestellung' }));
    expect(screen.getByText(/Bestellte Produkte/)).toBeInTheDocument();
  });

  it('does not show the service-type select after returning to product mode', () => {
    renderOrder();

    // Switch to service — service select appears
    fireEvent.click(screen.getByRole('button', { name: 'Serviceanfrage' }));
    expect(screen.getByDisplayValue(/Post-Training Support/)).toBeInTheDocument();

    // Switch back to product — service select must be gone
    fireEvent.click(screen.getByRole('button', { name: 'Produktbestellung' }));
    expect(screen.queryByDisplayValue(/Post-Training Support/)).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Order page — subtitle updates live when the URL search string changes
//    The <p> subtitle beneath the <h1> heading is also driven directly by
//    preMode (derived from useSearch()), so it must switch reactively on URL
//    change without a full page reload.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Order page – subtitle updates live when URL search string changes', () => {
  it('switches subtitle from product description to service description when search changes to ?service=support', () => {
    mockSearch = '';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Order />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    // Initial state: product mode subtitle is visible
    expect(
      screen.getByText('Bestellen Sie unsere Instrumente für Ihre Praxis oder Klinik.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Füllen Sie das Formular aus, wir melden uns bei Ihnen.'),
    ).not.toBeInTheDocument();

    // Simulate the router updating the search string (e.g. user clicks a service link)
    mockSearch = '?service=support';
    rerender(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Order />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    // Subtitle must have switched to the service description without a full reload
    expect(
      screen.getByText('Füllen Sie das Formular aus, wir melden uns bei Ihnen.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Bestellen Sie unsere Instrumente für Ihre Praxis oder Klinik.'),
    ).not.toBeInTheDocument();
  });

  it('switches subtitle back to product description when search changes from ?service=support to ""', () => {
    mockSearch = '?service=support';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Order />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    // Initial state: service mode subtitle is visible
    expect(
      screen.getByText('Füllen Sie das Formular aus, wir melden uns bei Ihnen.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Bestellen Sie unsere Instrumente für Ihre Praxis oder Klinik.'),
    ).not.toBeInTheDocument();

    // Simulate navigating back to the bare /order path
    mockSearch = '';
    rerender(
      <QueryClientProvider client={qc}>
        <LanguageProvider>
          <Order />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    // Subtitle must have reverted to the product description
    expect(
      screen.getByText('Bestellen Sie unsere Instrumente für Ihre Praxis oder Klinik.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Füllen Sie das Formular aus, wir melden uns bei Ihnen.'),
    ).not.toBeInTheDocument();
  });
});
