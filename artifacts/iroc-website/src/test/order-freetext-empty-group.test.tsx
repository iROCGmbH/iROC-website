/**
 * Tests for the Order form's product entry modes:
 *
 * - A group WITH public products renders a product dropdown (<select>).
 * - A group WITHOUT public products renders a free-text input, so customers
 *   can always type a product name — the free-text entry must never disappear
 *   for empty groups (previously only the hardcoded `other` category got it).
 * - The order submits correctly in both modes (serialized products string).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import Order from '@/pages/Order';

// ── mocks ─────────────────────────────────────────────────────────────────────

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

const mutateMock = vi.fn();
vi.mock('@workspace/api-client-react', () => ({
  useSubmitOrder: () => ({ mutate: mutateMock, isPending: false }),
  useRegisterCustomer: () => ({ mutate: vi.fn(), isPending: false }),
  OrderInputCustomerType: { existing: 'existing', new: 'new' },
  OrderInputInstrument: { spirecut: 'spirecut', ministem: 'ministem' },
  CustomerRegistrationInputInstrument: { spirecut: 'spirecut', ministem: 'ministem', both: 'both' },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Captcha passes so submission is not blocked
vi.mock('@/components/HumanCheck', () => ({
  useHumanCheck: () => ({ verified: true, reset: vi.fn() }),
  HumanCheckWidget: () => <div data-testid="human-check" />,
}));

// ── API fixtures ──────────────────────────────────────────────────────────────
// "spirecut" has public products → dropdown.
// "zubehoer" is an admin-created group with NO public products → free text.

const GROUPS = [
  { id: 1, key: 'spirecut', nameEn: 'Spirecut®', nameDe: 'Spirecut®', sortOrder: 1 },
  { id: 2, key: 'zubehoer', nameEn: 'Accessories Plus', nameDe: 'Zubehör Plus', sortOrder: 2 },
];

const PRODUCTS = {
  spirecut: [
    { id: 10, nameEn: 'CTS Set', nameDe: 'CTS Set', sku: 'SC-CTS' },
    { id: 11, nameEn: 'TF Set', nameDe: 'TF Set', sku: 'SC-TF' },
  ],
  zubehoer: [], // empty group — must fall back to free text
};

beforeEach(() => {
  mutateMock.mockClear();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/product-groups-public')) {
      return { ok: true, json: async () => GROUPS } as Response;
    }
    if (url.includes('/api/products-public')) {
      return { ok: true, json: async () => PRODUCTS } as Response;
    }
    return { ok: false, json: async () => null } as Response;
  });
});

afterEach(() => {
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

/** Wait until the dynamic groups arrived (the empty group appears as an option). */
async function waitForGroups() {
  await waitFor(() => {
    expect(screen.getByRole('option', { name: 'Zubehör Plus' })).toBeInTheDocument();
  });
}

/** The category <select> of the first (only) line item. */
function categorySelect(): HTMLSelectElement {
  const option = screen.getByRole('option', { name: 'Zubehör Plus' });
  return option.closest('select') as HTMLSelectElement;
}

const FREETEXT_PLACEHOLDER = 'Produktname eingeben…';

async function fillRequiredFields() {
  await userEvent.type(screen.getByPlaceholderText('2026-0001'), '2026-0001');
  await userEvent.type(screen.getByPlaceholderText('ABCD2345'), 'ABCD2345');
  const emailInput = document.querySelector('input[name="contactEmail"]') as HTMLInputElement;
  await userEvent.type(emailInput, 'doc@example.com');
  await userEvent.click(document.getElementById('privacy-ext') as HTMLInputElement);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Order form – product entry mode per group', () => {
  it('shows a product dropdown for a group with public products', async () => {
    renderOrder();
    await waitForGroups();

    // default category is spirecut → dropdown with the fetched products
    expect(screen.getByRole('option', { name: 'CTS Set' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'TF Set' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(FREETEXT_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('shows a free-text input for a group without public products', async () => {
    renderOrder();
    await waitForGroups();

    await userEvent.selectOptions(categorySelect(), 'zubehoer');

    expect(screen.getByPlaceholderText(FREETEXT_PLACEHOLDER)).toBeInTheDocument();
    // no product dropdown anymore
    expect(screen.queryByRole('option', { name: 'CTS Set' })).not.toBeInTheDocument();
  });

  it('shows free text even for a group entirely missing from the products payload', async () => {
    // simulate products endpoint not knowing the group key at all
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/product-groups-public')) {
        return { ok: true, json: async () => GROUPS } as Response;
      }
      if (url.includes('/api/products-public')) {
        return { ok: true, json: async () => ({ spirecut: PRODUCTS.spirecut }) } as Response;
      }
      return { ok: false, json: async () => null } as Response;
    });

    renderOrder();
    await waitForGroups();
    await userEvent.selectOptions(categorySelect(), 'zubehoer');

    expect(screen.getByPlaceholderText(FREETEXT_PLACEHOLDER)).toBeInTheDocument();
  });

  it('submits correctly with a dropdown-selected product', async () => {
    renderOrder();
    await waitForGroups();
    await fillRequiredFields();

    const productSelect = screen.getByRole('option', { name: 'CTS Set' }).closest('select') as HTMLSelectElement;
    await userEvent.selectOptions(productSelect, 'CTS Set');

    await userEvent.click(screen.getByRole('button', { name: 'Bestellung senden' }));

    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
    const payload = mutateMock.mock.calls[0][0].data;
    expect(payload.products).toBe('Spirecut®: CTS Set × 1');
    expect(payload.instrument).toBe('spirecut');
  });

  it('submits correctly with a free-text product for an empty group', async () => {
    renderOrder();
    await waitForGroups();
    await fillRequiredFields();

    await userEvent.selectOptions(categorySelect(), 'zubehoer');
    await userEvent.type(screen.getByPlaceholderText(FREETEXT_PLACEHOLDER), 'Sterile Handschuhe');

    await userEvent.click(screen.getByRole('button', { name: 'Bestellung senden' }));

    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
    const payload = mutateMock.mock.calls[0][0].data;
    expect(payload.products).toBe('Zubehör Plus: Sterile Handschuhe × 1');
  });
});
