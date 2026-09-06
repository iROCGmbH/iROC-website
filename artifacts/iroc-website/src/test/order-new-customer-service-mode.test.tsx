/**
 * Confirms that when the URL carries ?service=support (or ?service=marketing)
 * and the user switches to the "Neuer Kunde" tab, NewCustomerForm pre-selects
 * service mode — not product mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import Order from '@/pages/Order';

// ── mocks ─────────────────────────────────────────────────────────────────────

// wouter — controlled query-string
let mockSearch = '';
vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    useSearch: () => mockSearch,
    Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
      <a href={href}>{children}</a>
    ),
  };
});

// Capture the mutate spy so submission tests can inspect calls
let registerMutate = vi.fn();

vi.mock('@workspace/api-client-react', () => ({
  useSubmitOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useRegisterCustomer: () => ({ mutate: registerMutate, isPending: false }),
  OrderInputCustomerType: { existing: 'existing', new: 'new' },
  OrderInputInstrument: { spirecut: 'spirecut', ministem: 'ministem' },
  CustomerRegistrationInputInstrument: {
    spirecut: 'spirecut',
    ministem: 'ministem',
    both: 'both',
    post_training_support: 'post_training_support',
    practice_marketing_support: 'practice_marketing_support',
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// captcha: default not-verified; set captchaVerified = true in specific tests
let captchaVerified = false;
vi.mock('@/components/HumanCheck', () => ({
  useHumanCheck: () => ({ verified: captchaVerified, reset: vi.fn() }),
  HumanCheckWidget: () => <div data-testid="human-check" />,
}));

// CountrySelect — render as a plain native select so tests can set the value
vi.mock('@/components/CountrySelect', () => ({
  CountrySelect: ({ value, onChange }: { value: string; onChange: (code: string) => void }) => (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      data-testid="country-select"
    >
      <option value="">--</option>
      <option value="DE">Germany</option>
    </select>
  ),
}));

beforeEach(() => {
  registerMutate = vi.fn();
  captchaVerified = false;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => null,
  } as Response);
});

afterEach(() => {
  mockSearch = '';
  vi.restoreAllMocks();
});

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── tests ─────────────────────────────────────────────────────────────────────

describe('NewCustomerForm — service mode from URL param', () => {
  it('shows "Serviceanfrage" order type button pre-selected when ?service=support and user switches to Neuer Kunde', async () => {
    mockSearch = '?service=support';
    renderOrder();

    // Switch to the new-customer tab
    await userEvent.click(screen.getByRole('button', { name: 'Neuer Kunde' }));

    // The "Auftragsart" section should be present and "Serviceanfrage" should be
    // the active (primary-styled) button — verified by its presence
    expect(screen.getByRole('button', { name: 'Serviceanfrage' })).toBeInTheDocument();
    // The service banner for Post-Training Support should be visible
    expect(screen.getAllByText(/Post-Training Support/).length).toBeGreaterThan(0);
    // Product editor should NOT be present
    expect(screen.queryByText('Produkte')).not.toBeInTheDocument();
  });

  it('shows "Serviceanfrage" pre-selected when ?service=marketing and user switches to Neuer Kunde', async () => {
    mockSearch = '?service=marketing';
    renderOrder();

    await userEvent.click(screen.getByRole('button', { name: 'Neuer Kunde' }));

    expect(screen.getByRole('button', { name: 'Serviceanfrage' })).toBeInTheDocument();
    expect(screen.getAllByText(/Praxis-Marketing Support/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Produkte')).not.toBeInTheDocument();
  });

  it('defaults to product mode when no ?service= param is present', async () => {
    mockSearch = '';
    renderOrder();

    await userEvent.click(screen.getByRole('button', { name: 'Neuer Kunde' }));

    // Product mode: the "Produkte" section is visible
    expect(screen.getByText('Produkte')).toBeInTheDocument();
    // Service banner should not be visible
    expect(screen.queryByText(/Post-Training Support/)).not.toBeInTheDocument();
  });

  /** Fill the minimum required fields so react-hook-form lets the submit through. */
  async function fillRequiredFields(container: HTMLElement) {
    const q = (name: string) => container.querySelector<HTMLElement>(`[name="${name}"]`)!;
    await userEvent.type(q('institutionName'), 'Musterklinik');
    await userEvent.type(q('address'), 'Musterstraße 1');
    await userEvent.type(q('postalCode'), '10115');
    await userEvent.type(q('city'), 'Berlin');
    await userEvent.selectOptions(screen.getByTestId('country-select'), 'DE');
    await userEvent.type(q('phone'), '+49123456789');
    await userEvent.type(q('email'), 'test@example.com');
    await userEvent.click(q('privacyConsent'));
  }

  it('submits with instrument=post_training_support when ?service=support', async () => {
    mockSearch = '?service=support';
    captchaVerified = true;
    const { container } = renderOrder();

    await userEvent.click(screen.getByRole('button', { name: 'Neuer Kunde' }));
    await fillRequiredFields(container);

    await userEvent.click(screen.getByRole('button', { name: /Registrierung senden/i }));

    expect(registerMutate).toHaveBeenCalledOnce();
    const callArg = registerMutate.mock.calls[0][0];
    expect(callArg.data.instrument).toBe('post_training_support');
  });

  it('submits with instrument=practice_marketing_support when ?service=marketing', async () => {
    mockSearch = '?service=marketing';
    captchaVerified = true;
    const { container } = renderOrder();

    await userEvent.click(screen.getByRole('button', { name: 'Neuer Kunde' }));
    await fillRequiredFields(container);

    await userEvent.click(screen.getByRole('button', { name: /Registrierung senden/i }));

    expect(registerMutate).toHaveBeenCalledOnce();
    const callArg = registerMutate.mock.calls[0][0];
    expect(callArg.data.instrument).toBe('practice_marketing_support');
  });

  it('can switch from pre-selected service mode back to product mode', async () => {
    mockSearch = '?service=support';
    renderOrder();

    await userEvent.click(screen.getByRole('button', { name: 'Neuer Kunde' }));

    // Starts in service mode
    expect(screen.queryByText('Produkte')).not.toBeInTheDocument();

    // Switch back to product order
    await userEvent.click(screen.getByRole('button', { name: 'Produktbestellung' }));

    // Now product editor is visible and service banner is gone
    expect(screen.getByText('Produkte')).toBeInTheDocument();
    expect(screen.queryByText(/Post-Training Support/)).not.toBeInTheDocument();
  });
});
