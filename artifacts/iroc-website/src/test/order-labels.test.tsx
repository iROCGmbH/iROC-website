/**
 * Tests for Order page — verifies that form labels, button text, and section
 * headings switch correctly between DE and EN when the language is toggled.
 *
 * The Order page renders two sub-forms (ExistingCustomerForm / NewCustomerForm).
 * Both are tested independently.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import Order from '@/pages/Order';

// ── mocks ─────────────────────────────────────────────────────────────────────

// wouter — Order reads the query string via useSearch()
vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    useSearch: () => '',
    Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
      <a href={href}>{children}</a>
    ),
  };
});

// API mutations — we don't care about submission behaviour here
vi.mock('@workspace/api-client-react', () => ({
  useSubmitOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useRegisterCustomer: () => ({ mutate: vi.fn(), isPending: false }),
  OrderInputCustomerType: { existing: 'existing', new: 'new' },
  OrderInputInstrument: { spirecut: 'spirecut', ministem: 'ministem' },
  CustomerRegistrationInputInstrument: { spirecut: 'spirecut', ministem: 'ministem', both: 'both' },
}));

// Toast — not under test
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// HumanCheck — stub out the captcha widget
vi.mock('@/components/HumanCheck', () => ({
  useHumanCheck: () => ({ verified: false, reset: vi.fn() }),
  HumanCheckWidget: () => <div data-testid="human-check" />,
}));

// Suppress the fetch for public products — not under test
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => null,
  } as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  return (
    <button onClick={() => setLanguage(language === 'DE' ? 'EN' : 'DE')}>
      toggle-lang
    </button>
  );
}

function renderOrder() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <LanguageToggle />
        <Order />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

// ── Existing-customer form (shown by default) ─────────────────────────────────

describe('Order page – ExistingCustomerForm – language switching', () => {
  it('renders German page heading "Bestellung" by default', () => {
    renderOrder();
    expect(screen.getByRole('heading', { name: 'Bestellung' })).toBeInTheDocument();
  });

  it('renders German customer-type button "Bestehender Kunde" by default', () => {
    renderOrder();
    expect(screen.getByRole('button', { name: 'Bestehender Kunde' })).toBeInTheDocument();
  });

  it('renders German customer-type button "Neuer Kunde" by default', () => {
    renderOrder();
    expect(screen.getByRole('button', { name: 'Neuer Kunde' })).toBeInTheDocument();
  });

  it('renders German field label "Kundennummer" by default', () => {
    renderOrder();
    expect(screen.getAllByText(/Kundennummer \*/).length).toBeGreaterThan(0);
  });

  it('renders German submit button "Bestellung senden" by default', () => {
    renderOrder();
    expect(screen.getByRole('button', { name: 'Bestellung senden' })).toBeInTheDocument();
  });

  it('switches heading to "Order" on EN', async () => {
    renderOrder();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByRole('heading', { name: 'Order' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bestellung' })).not.toBeInTheDocument();
  });

  it('switches customer-type buttons to English on EN', async () => {
    renderOrder();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByRole('button', { name: 'Existing Customer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Customer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bestehender Kunde' })).not.toBeInTheDocument();
  });

  it('switches field label to "Customer Number" on EN', async () => {
    renderOrder();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getAllByText(/Customer Number \*/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Kundennummer \*/)).not.toBeInTheDocument();
  });

  it('switches submit button to "Submit Order" on EN', async () => {
    renderOrder();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByRole('button', { name: 'Submit Order' })).toBeInTheDocument();
  });

  it('switches the e-invoicing notice to English on EN', async () => {
    renderOrder();
    expect(screen.getByText('Hinweis zur E-Rechnung')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Information on electronic invoicing')).toBeInTheDocument();
    expect(screen.getByText(/businesses with prior-year turnover exceeding €800,000/i)).toBeInTheDocument();
    expect(screen.queryByText('Hinweis zur E-Rechnung')).not.toBeInTheDocument();
  });
});

// ── New-customer form ─────────────────────────────────────────────────────────

describe('Order page – NewCustomerForm – language switching', () => {
  /** Switch to the "Neuer Kunde" tab. */
  async function openNewCustomerForm() {
    renderOrder();
    await userEvent.click(screen.getByRole('button', { name: 'Neuer Kunde' }));
  }

  it('shows German field label "Anrede" in DE mode', async () => {
    await openNewCustomerForm();
    expect(screen.getByText(/Anrede/)).toBeInTheDocument();
  });

  it('shows German field label "Vorname" in DE mode', async () => {
    await openNewCustomerForm();
    expect(screen.getByText(/Vorname/)).toBeInTheDocument();
  });

  it('shows German field label "Name der Institution" in DE mode', async () => {
    await openNewCustomerForm();
    expect(screen.getByText('Name der Institution')).toBeInTheDocument();
  });

  it('switches "Anrede" → "Salutation" on EN', async () => {
    await openNewCustomerForm();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText(/Salutation/)).toBeInTheDocument();
    expect(screen.queryByText(/^Anrede/)).not.toBeInTheDocument();
  });

  it('switches "Vorname" → "First Name" on EN', async () => {
    await openNewCustomerForm();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText(/First Name/)).toBeInTheDocument();
    expect(screen.queryByText(/^Vorname/)).not.toBeInTheDocument();
  });

  it('switches "Name der Institution" → "Institution Name" on EN', async () => {
    await openNewCustomerForm();
    await userEvent.click(screen.getByRole('button', { name: 'toggle-lang' }));
    expect(screen.getByText('Institution Name')).toBeInTheDocument();
    expect(screen.queryByText('Name der Institution')).not.toBeInTheDocument();
  });
});
