/**
 * InvoiceEdit — domestic zero-VAT inline warning
 *
 * What & Why
 * ──────────
 * The domestic VAT selector only offers 7 % and 19 %; there is no 0 % option.
 * However if the effective vatRateOverride reaches 0 while the form is in
 * domestic mode (e.g. corrupted saved data, or the brief render between a type
 * switch and its correcting useEffect), an inline role="alert" warning must be
 * visible so the admin sees the problem before submitting.
 *
 * Strategy
 * ────────
 * InvoiceEdit is used here because it initialises vatRateOverride directly
 * from the saved invoice's vatRate field.  Setting vatRate to "0.00" on a
 * domestic invoice gives us vatRateOverride === 0 without needing to manipulate
 * private component state.
 *
 * The module-level mock exports a getter so each test can point to a different
 * fixture without a second vi.mock() call (which vitest hoists and would
 * override the first mock).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceEdit from "./InvoiceEdit";

// ── Mutable fixture pointer ───────────────────────────────────────────────────

/**
 * The mock factory reads from this object each time the hook is called, so
 * individual tests can swap the active fixture without a second vi.mock().
 */
const invoiceState = {
  data: null as Record<string, unknown> | null,
  isLoading: false,
};

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/invoices/99/edit", vi.fn()],
  useParams:   () => ({ id: "99" }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts:         () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
  useGetIrocInvoice:           () => ({ ...invoiceState }),
  getGetIrocInvoiceQueryKey:   (id: number) => ["iroc", "invoices", id],
  getListIrocInvoicesQueryKey: () => ["iroc", "invoices"],
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_FIXTURE = {
  id: 99, invoiceNumber: "2026-0099", status: "draft", invoiceType: "domestic",
  language: "en", issueDate: "2026-08-01", dueDate: null, orderNumber: null,
  referenceNumber: null, shippingMethod: null, reasonForExport: null,
  termsOfDelivery: null, deliveryCosts: "0.00", notes: null, vatNote: null,
  websiteCustomerId: null, customer: { name: "", country: null, company: null },
  items: [],
};

/** Domestic invoice with vatRate=0 — edge-case / corrupted record. */
const ZERO_VAT_FIXTURE  = { ...BASE_FIXTURE, vatRate: "0.00"  };

/** Domestic invoice with vatRate=0 AND a populated customer + item, so the
 *  submit button would otherwise be enabled — confirms the VAT guard alone
 *  is responsible for disabling the button. */
const ZERO_VAT_FULL_FIXTURE = {
  ...BASE_FIXTURE,
  vatRate:           "0.00",
  websiteCustomerId: 10,
  customer: { name: "Test Kunde", country: "Deutschland", company: null },
  items: [
    {
      id: 1, productId: null, productName: "iROC Device", sku: null,
      description: null, lotNumber: null, hsCode: null, countryOfOrigin: null,
      weightKg: null, unitPrice: "1000.00", discountPercent: null,
      isDemo: false, quantity: 1,
    },
  ],
};

/** Domestic invoice with vatRate=19 — normal record, no warning expected. */
const VALID_VAT_FIXTURE = { ...BASE_FIXTURE, vatRate: "19.00" };

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  invoiceState.data      = null;
  invoiceState.isLoading = false;
});

afterEach(() => vi.restoreAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoiceEdit — domestic zero-VAT inline warning", () => {
  it("renders a role=alert warning when vatRate=0 on a domestic invoice", async () => {
    invoiceState.data = ZERO_VAT_FIXTURE;

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, json: async () => [],
    } as unknown as Response);

    render(<InvoiceEdit />, { wrapper: Wrapper });

    // Wait for init effect to populate the form from the invoice fixture, then
    // assert that the inline warning badge is present and carries the right text.
    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/0 % is not permitted/i);
  });

  it("does not render the zero-VAT warning when vatRate=19 on a domestic invoice", async () => {
    invoiceState.data = VALID_VAT_FIXTURE;

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, json: async () => [],
    } as unknown as Response);

    render(<InvoiceEdit />, { wrapper: Wrapper });

    // Give React time to run effects and settle.
    await screen.findByDisplayValue(/Regelsteuersatz/i);

    // The zero-VAT warning must not be present for a valid 19 % domestic invoice.
    expect(screen.queryByText(/0 % is not permitted/i)).not.toBeInTheDocument();
  });

  it("disables the save button when vatRate=0 on a domestic invoice with customer and items", async () => {
    // Use a fixture that has a populated customer and items so the save button
    // would otherwise be enabled — only the domestic-0% guard should disable it.
    invoiceState.data = ZERO_VAT_FULL_FIXTURE;

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, json: async () => [],
    } as unknown as Response);

    render(<InvoiceEdit />, { wrapper: Wrapper });

    // Wait for the zero-VAT warning to confirm the form has loaded in the
    // invalid state.
    await screen.findByRole("alert");

    // The save button must be disabled.
    const saveButton = screen.getByRole("button", { name: /save|speichern/i });
    expect(saveButton).toBeDisabled();
  });
});
