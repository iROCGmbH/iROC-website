/**
 * UI component test: CustomerCombobox in InvoiceEdit
 *
 * Confirms that when two website_customers share the same surname ("Mustermann")
 * but carry different salutation/title values, the CustomerCombobox in the
 * edit flow renders both with their distinct prefixes:
 *   – "Herr Dr. med Max Mustermann"
 *   – "Frau Erika Mustermann"
 *
 * Also confirms that typing "Herr" or "Dr. med" narrows the list correctly.
 *
 * Strategy:
 *   • Render the InvoiceEdit page with all external hooks mocked.
 *   • useGetIrocInvoice returns a minimal invoice fixture (no pre-selected
 *     customer so the search input is visible from the start).
 *   • Spy on globalThis.fetch so GET /api/iroc/customers-combined returns the
 *     two fixture customers; all other fetch calls return safe empty defaults.
 *   • Focus the customer search input so the dropdown opens.
 *   • Assert that both display strings appear in the DOM.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceEdit from "./InvoiceEdit";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "de" }),
}));

// Mock wouter so the component doesn't need a real router
vi.mock("wouter", () => ({
  useLocation: () => ["/invoices/42/edit", vi.fn()],
  useParams:   () => ({ id: "42" }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

/**
 * Minimal invoice fixture that satisfies InvoiceEdit's pre-population logic.
 * websiteCustomerId is null so no customer is pre-selected and the search
 * input is visible immediately after mount.
 */
const MOCK_INVOICE = {
  id:            42,
  invoiceNumber: "2026-0042",
  status:        "draft",
  invoiceType:   "domestic",
  language:      "de",
  issueDate:     "2026-08-01",
  dueDate:       null,
  orderNumber:   null,
  referenceNumber: null,
  shippingMethod:  null,
  reasonForExport: null,
  termsOfDelivery: null,
  deliveryCosts:   "0.00",
  vatRate:         "19.00",
  notes:           null,
  vatNote:         null,
  websiteCustomerId: null,
  customer: { name: "", country: null, company: null },
  items: [],
};

// Mock api-client-react hooks used by InvoiceEdit
const invoiceState = {
  current: {
    data: MOCK_INVOICE as typeof MOCK_INVOICE | undefined,
    isLoading: false,
  },
};

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts:      () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
  useGetIrocInvoice:        () => invoiceState.current,
  getGetIrocInvoiceQueryKey: (id: number) => ["iroc", "invoices", id],
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface CustomerFixture {
  source:         "iroc" | "website";
  id:             number;
  customerNr:     string | null;
  salutation:     string | null;
  title:          string | null;
  name:           string;
  company:        string | null;
  email:          string | null;
  country:        string | null;
  city:           string | null;
  isEu:           boolean | null;
  vatId:          string | null;
  isPublicAuthority: boolean;
  defaultBuyerReference: string | null;
  irocCustomerId: number | null;
}

/** Two website_customers: same surname, different salutation + title. */
const TWO_MUSTERMANNS: CustomerFixture[] = [
  {
    source:        "website",
    id:            1,
    customerNr:    "2026-0001",
    salutation:    "Herr",
    title:         "Dr. med",
    name:          "Max Mustermann",
    company:       "Muster Klinik",
    email:         "max.mustermann@example.com",
    country:       "DE",
    city:          "München",
    isEu:          false,
    vatId:         null,
    isPublicAuthority: true,
    defaultBuyerReference: "LEITWEG-123",
    irocCustomerId: null,
  },
  {
    source:        "website",
    id:            2,
    customerNr:    "2026-0002",
    salutation:    "Frau",
    title:         null,
    name:          "Erika Mustermann",
    company:       null,
    email:         "erika.mustermann@example.com",
    country:       "DE",
    city:          "München",
    isEu:          false,
    vatId:         null,
    isPublicAuthority: false,
    defaultBuyerReference: null,
    irocCustomerId: null,
  },
];

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

/**
 * Install a fetch spy that:
 * - GET /api/iroc/customers-combined  → supplied fixture (default: TWO_MUSTERMANNS)
 * - GET /api/iroc/inventory           → []
 * - everything else                   → 200 / empty
 */
function installFetchSpy(customers: CustomerFixture[] = TWO_MUSTERMANNS) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);

      if (url.includes("/api/iroc/customers-combined")) {
        return { ok: true, json: async () => customers } as Response;
      }
      if (url.includes("/api/iroc/inventory")) {
        return { ok: true, json: async () => [] } as Response;
      }
      // Safe fallback for any other calls
      return { ok: true, json: async () => ({}) } as Response;
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  invoiceState.current = { data: MOCK_INVOICE, isLoading: false };
});

describe("InvoiceEdit — CustomerCombobox salutation+title rendering", () => {
  it("shows both customers with distinct salutation+title prefixes for a shared surname", async () => {
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceEdit />, { wrapper: Wrapper });

    // Find the customer search input and focus it to open the dropdown
    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);

    await act(async () => {
      await user.click(searchInput);
    });

    // Wait for the customers-combined fetch to complete and the dropdown to populate
    await waitFor(() => {
      expect(screen.getByText("Herr Dr. med Max Mustermann")).toBeInTheDocument();
    });

    // Both customers must appear with their distinct salutation+title prefix
    expect(screen.getByText("Herr Dr. med Max Mustermann")).toBeInTheDocument();
    expect(screen.getByText("Frau Erika Mustermann")).toBeInTheDocument();
  });

  it("filters to matching customers when typing a salutation", async () => {
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceEdit />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);

    // Wait for customers to load then type a salutation
    await act(async () => {
      await user.click(searchInput);
    });
    await waitFor(() => {
      expect(screen.getByText("Herr Dr. med Max Mustermann")).toBeInTheDocument();
    });

    await act(async () => {
      await user.type(searchInput, "Herr");
    });

    // Only the "Herr" customer should remain visible
    await waitFor(() => {
      expect(screen.getByText("Herr Dr. med Max Mustermann")).toBeInTheDocument();
    });
    expect(screen.queryByText("Frau Erika Mustermann")).not.toBeInTheDocument();
  });

  it("filters to matching customers when typing a title fragment", async () => {
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceEdit />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);

    await act(async () => {
      await user.click(searchInput);
    });
    await waitFor(() => {
      expect(screen.getByText("Herr Dr. med Max Mustermann")).toBeInTheDocument();
    });

    await act(async () => {
      await user.type(searchInput, "Dr. med");
    });

    // Only the customer with title "Dr. med" should remain visible
    await waitFor(() => {
      expect(screen.getByText("Herr Dr. med Max Mustermann")).toBeInTheDocument();
    });
    expect(screen.queryByText("Frau Erika Mustermann")).not.toBeInTheDocument();
  });

  it("preserves saved B2G values initially, then applies the new customer's defaults", async () => {
    const savedInvoice = {
      ...MOCK_INVOICE,
      buyerReference: "SAVED-REF",
      isB2g: true,
    };
    invoiceState.current = { data: savedInvoice, isLoading: false };
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceEdit />, { wrapper: Wrapper });

    expect(screen.getByRole("checkbox", { name: /Public authority/i })).toBeChecked();
    expect(screen.getByDisplayValue("SAVED-REF")).toBeInTheDocument();

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);
    await user.click(searchInput);
    await user.click(await screen.findByText("Herr Dr. med Max Mustermann"));

    expect(screen.getByRole("checkbox", { name: /Public authority/i })).toBeChecked();
    expect(screen.getByDisplayValue("LEITWEG-123")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("SAVED-REF")).not.toBeInTheDocument();
  });

  it("shows only the name when a customer has no salutation or title", async () => {
    const noPrefix: CustomerFixture[] = [
      {
        source:        "website",
        id:            3,
        customerNr:    "2026-0003",
        salutation:    null,
        title:         null,
        name:          "Klaus Mustermann",
        company:       null,
        email:         "klaus.mustermann@example.com",
        country:       "DE",
        city:          null,
        isEu:          false,
        vatId:         null,
        isPublicAuthority: false,
        defaultBuyerReference: null,
        irocCustomerId: null,
      },
    ];
    installFetchSpy(noPrefix);
    const user = userEvent.setup();

    render(<InvoiceEdit />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);
    await act(async () => {
      await user.click(searchInput);
    });

    await waitFor(() => {
      expect(screen.getByText("Klaus Mustermann")).toBeInTheDocument();
    });

    // No spurious prefix should appear
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("shows the not-found message without rendering the customer search when the invoice is unavailable", async () => {
    installFetchSpy();
    invoiceState.current = { data: undefined, isLoading: false };

    render(<InvoiceEdit />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText("Rechnung nicht gefunden")).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText(/Kunden suchen/i)).not.toBeInTheDocument();
  });

  it("shows the skeleton loader instead of the form while the invoice is loading", async () => {
    installFetchSpy();
    invoiceState.current = { data: undefined, isLoading: true };

    const { container } = render(<InvoiceEdit />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText(/Kunden suchen/i)).not.toBeInTheDocument();
  });
});
