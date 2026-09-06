/**
 * settings-contact-propagation.test.tsx
 *
 * Verifies the full save → invalidate → re-render round-trip for iROC website
 * settings. When an admin saves a value and invalidateWebsiteSettingsCache() is
 * called, the Footer (in Layout) and the /contact page must immediately reflect
 * the new value without a hard refresh.
 *
 * The real useWebsiteSettings hook is used (not mocked) so the invalidation
 * path is exercised end-to-end. Heavy UI dependencies (Navigation, HumanCheck,
 * wouter) are stubbed so tests remain offline and fast.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act, renderHook } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import {
  useWebsiteSettings,
  invalidateWebsiteSettingsCache,
  WS_DEFAULTS,
} from '@/hooks/useWebsiteSettings';
import { Layout } from '@/components/Layout';
import Contact from '@/pages/Contact';

// ── stub heavy dependencies so the real useWebsiteSettings is tested ──────────

vi.mock('@/components/Navigation', () => ({
  Navigation: () => <nav data-testid="nav-stub" />,
}));

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
      <a href={href}>{children}</a>
    ),
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/components/HumanCheck', () => ({
  useHumanCheck: () => ({ verified: false, reset: vi.fn() }),
  HumanCheckWidget: () => <div data-testid="human-check" />,
}));

// ── controllable fetch fixture ────────────────────────────────────────────────

const INITIAL_PHONE  = '+49 89 4625993 70';
const UPDATED_PHONE  = '+49 89 999 000 11';
const INITIAL_STREET = 'St.-Emmeram-Str. 26';
const UPDATED_STREET = 'Musterstraße 99';
const INITIAL_CITY   = 'Aschheim';
const UPDATED_CITY   = 'München';

/**
 * Mutable pointers to the "current" values the fetch mock should return.
 * Tests update these then call invalidateWebsiteSettingsCache() to trigger
 * a re-fetch.
 */
let currentPhone  = INITIAL_PHONE;
let currentStreet = INITIAL_STREET;
let currentCity   = INITIAL_CITY;

beforeEach(() => {
  // Reset fixture values
  currentPhone  = INITIAL_PHONE;
  currentStreet = INITIAL_STREET;
  currentCity   = INITIAL_CITY;

  // Single fetch spy — reads the mutable pointers so mid-test updates work
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      ...WS_DEFAULTS,
      ws_contact_phone:  currentPhone,
      ws_address_street: currentStreet,
      ws_address_city:   currentCity,
    }),
  } as Response));

  // Clear the module-level singleton so each test starts with a cold cache
  invalidateWebsiteSettingsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── shared wrapper ────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

// ── useWebsiteSettings hook unit tests ────────────────────────────────────────

describe('useWebsiteSettings – cache invalidation re-fetch', () => {
  it('fetches and returns the initial settings from the API', async () => {
    const { result } = renderHook(() => useWebsiteSettings(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.ws_contact_phone).toBe(INITIAL_PHONE);
    });
    expect(result.current.ws_address_street).toBe(INITIAL_STREET);
    expect(result.current.ws_address_city).toBe(INITIAL_CITY);
  });

  it('re-fetches and returns the updated phone after invalidateWebsiteSettingsCache()', async () => {
    const { result } = renderHook(() => useWebsiteSettings(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.ws_contact_phone).toBe(INITIAL_PHONE));

    // Simulate the admin saving a new value
    currentPhone = UPDATED_PHONE;
    act(() => { invalidateWebsiteSettingsCache(); });

    await waitFor(() => expect(result.current.ws_contact_phone).toBe(UPDATED_PHONE));
  });

  it('re-fetches and returns updated address fields after invalidation', async () => {
    const { result } = renderHook(() => useWebsiteSettings(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.ws_address_street).toBe(INITIAL_STREET));

    currentStreet = UPDATED_STREET;
    currentCity   = UPDATED_CITY;
    act(() => { invalidateWebsiteSettingsCache(); });

    await waitFor(() => {
      expect(result.current.ws_address_street).toBe(UPDATED_STREET);
      expect(result.current.ws_address_city).toBe(UPDATED_CITY);
    });
  });

  it('notifies all active hook subscribers simultaneously', async () => {
    // Two independent instances of the hook (simulating two components)
    const { result: r1 } = renderHook(() => useWebsiteSettings(), { wrapper: Wrapper });
    const { result: r2 } = renderHook(() => useWebsiteSettings(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(r1.current.ws_contact_phone).toBe(INITIAL_PHONE);
      expect(r2.current.ws_contact_phone).toBe(INITIAL_PHONE);
    });

    currentPhone = UPDATED_PHONE;
    act(() => { invalidateWebsiteSettingsCache(); });

    await waitFor(() => {
      expect(r1.current.ws_contact_phone).toBe(UPDATED_PHONE);
      expect(r2.current.ws_contact_phone).toBe(UPDATED_PHONE);
    });
  });
});

// ── Footer (Layout component) ─────────────────────────────────────────────────

describe('Footer – propagates updated contact details after cache invalidation', () => {
  it('shows the initial phone number in the footer', async () => {
    render(
      <Wrapper>
        <Layout><div /></Layout>
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText(INITIAL_PHONE)).toBeInTheDocument();
    });
    expect(screen.getByText(INITIAL_STREET)).toBeInTheDocument();
  });

  it('shows the updated phone number immediately after cache invalidation', async () => {
    render(
      <Wrapper>
        <Layout><div /></Layout>
      </Wrapper>
    );

    await waitFor(() => expect(screen.getByText(INITIAL_PHONE)).toBeInTheDocument());

    // Admin saves a new phone number
    currentPhone = UPDATED_PHONE;
    act(() => { invalidateWebsiteSettingsCache(); });

    await waitFor(() => expect(screen.getByText(UPDATED_PHONE)).toBeInTheDocument());
    expect(screen.queryByText(INITIAL_PHONE)).not.toBeInTheDocument();
  });

  it('shows the updated street address immediately after cache invalidation', async () => {
    render(
      <Wrapper>
        <Layout><div /></Layout>
      </Wrapper>
    );

    await waitFor(() => expect(screen.getByText(INITIAL_STREET)).toBeInTheDocument());

    currentStreet = UPDATED_STREET;
    act(() => { invalidateWebsiteSettingsCache(); });

    await waitFor(() => expect(screen.getByText(UPDATED_STREET)).toBeInTheDocument());
    expect(screen.queryByText(INITIAL_STREET)).not.toBeInTheDocument();
  });

  it('shows the updated city immediately after cache invalidation', async () => {
    render(
      <Wrapper>
        <Layout><div /></Layout>
      </Wrapper>
    );

    // Initial city appears combined with postal code: "85609 Aschheim, Deutschland"
    await waitFor(() => expect(screen.getByText(/Aschheim/)).toBeInTheDocument());

    currentCity = UPDATED_CITY;
    act(() => { invalidateWebsiteSettingsCache(); });

    await waitFor(() => expect(screen.getByText(/München/)).toBeInTheDocument());
    expect(screen.queryByText(/Aschheim/)).not.toBeInTheDocument();
  });
});

// ── Contact page ──────────────────────────────────────────────────────────────

describe('Contact page – propagates updated contact details after cache invalidation', () => {
  it('shows the initial phone number on the contact page', async () => {
    render(
      <Wrapper>
        <Contact />
      </Wrapper>
    );

    // The contact page renders: "T +49 89 4625993 70"
    await waitFor(() => {
      expect(screen.getByText(`T ${INITIAL_PHONE}`)).toBeInTheDocument();
    });
  });

  it('shows updated phone on the contact page immediately after cache invalidation', async () => {
    render(
      <Wrapper>
        <Contact />
      </Wrapper>
    );

    await waitFor(() => expect(screen.getByText(`T ${INITIAL_PHONE}`)).toBeInTheDocument());

    // Admin saves a new phone number
    currentPhone = UPDATED_PHONE;
    act(() => { invalidateWebsiteSettingsCache(); });

    await waitFor(() => expect(screen.getByText(`T ${UPDATED_PHONE}`)).toBeInTheDocument());
    expect(screen.queryByText(`T ${INITIAL_PHONE}`)).not.toBeInTheDocument();
  });

  it('shows updated street address on the contact page immediately after cache invalidation', async () => {
    render(
      <Wrapper>
        <Contact />
      </Wrapper>
    );

    // The street lives inside a <p> that also contains postal code, city, and
    // country — use { exact: false } so substring matching applies.
    await waitFor(() =>
      expect(screen.getByText(INITIAL_STREET, { exact: false })).toBeInTheDocument()
    );

    currentStreet = UPDATED_STREET;
    act(() => { invalidateWebsiteSettingsCache(); });

    await waitFor(() =>
      expect(screen.getByText(UPDATED_STREET, { exact: false })).toBeInTheDocument()
    );
    expect(screen.queryByText(INITIAL_STREET, { exact: false })).not.toBeInTheDocument();
  });

  it('shows updated city on the contact page immediately after cache invalidation', async () => {
    render(
      <Wrapper>
        <Contact />
      </Wrapper>
    );

    await waitFor(() => expect(screen.getByText(/Aschheim/)).toBeInTheDocument());

    currentCity = UPDATED_CITY;
    act(() => { invalidateWebsiteSettingsCache(); });

    await waitFor(() => expect(screen.getByText(/München/)).toBeInTheDocument());
    expect(screen.queryByText(/Aschheim/)).not.toBeInTheDocument();
  });
});
