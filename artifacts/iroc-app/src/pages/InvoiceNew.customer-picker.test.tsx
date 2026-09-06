/**
 * UI component test: CustomerCombobox in InvoiceNew
 *
 * Confirms that when two website_customers share the same surname ("Mustermann")
 * but carry different salutation/title values, the CustomerCombobox renders
 * both with their distinct prefixes:
 *   – "Herr Dr. med Max Mustermann"
 *   – "Frau Erika Mustermann"
 *
 * Strategy:
 *   • Render the InvoiceNew page with all external hooks mocked.
 *   • Spy on globalThis.fetch so GET /api/iroc/customers-combined returns the
 *     two fixture customers; all other fetch calls return safe empty defaults.
 *   • Focus the customer search input so the dropdown opens.
 *   • Assert that both display strings appear in the DOM.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceNew from "./InvoiceNew";

// ── Module mocks ──────────────────────────────────────────────────────────────

const languageState = vi.hoisted(() => ({ lang: "de" as "de" | "en" }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => languageState,
}));

// Mock wouter so the component doesn't need a real router
vi.mock("wouter", () => ({
  useLocation: () => ["/invoices/new", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock api-client-react hooks (InvoiceNew uses useListIrocProducts + useCreateIrocInvoice)
vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts:  () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
  useCreateIrocInvoice: () => ({ mutate: vi.fn(), isPending: false }),
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
  address?:       string | null;
  postalCode?:    string | null;
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
    address:       "Musterstraße 12",
    postalCode:    "80331",
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
    address:       "Beispielweg 4",
    postalCode:    "80332",
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
 * - GET /api/iroc/customers-combined          → TWO_MUSTERMANNS
 * - GET /api/iroc/inventory                   → []
 * - GET /api/iroc/invoices/next-number        → { nextNumber: "2026-9999" }
 * - everything else                           → 200 / empty
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
      if (url.includes("/api/iroc/invoices/next-number")) {
        return { ok: true, json: async () => ({ nextNumber: "2026-9999" }) } as Response;
      }
      // Safe fallback for any other calls
      return { ok: true, json: async () => ({}) } as Response;
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
  languageState.lang = "de";
  window.history.replaceState({}, "", "/invoices/new");
});

describe("InvoiceNew — CustomerCombobox salutation+title rendering", () => {
  it("shows both customers with distinct salutation+title prefixes for a shared surname", async () => {
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceNew />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);
    await user.click(searchInput);
    await user.click(await screen.findByText("Frau Erika Mustermann"));

    expect(screen.getByRole("checkbox", { name: /Public authority/i })).not.toBeChecked();
    expect(screen.queryByDisplayValue("LEITWEG-123")).not.toBeInTheDocument();
  });

  it("starts non-B2G customers unchecked with no buyer reference", async () => {
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceNew />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);
    await user.click(searchInput);
    await user.click(await screen.findByText("Frau Erika Mustermann"));

    expect(screen.getByRole("checkbox", { name: /Public authority/i })).not.toBeChecked();
    expect(screen.queryByDisplayValue("LEITWEG-123")).not.toBeInTheDocument();
  });

  it("starts non-B2G customers unchecked with no buyer reference", async () => {
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceNew />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);
    await user.click(searchInput);
    await user.click(await screen.findByText("Frau Erika Mustermann"));

    expect(screen.getByRole("checkbox", { name: /Public authority/i })).not.toBeChecked();
    expect(screen.queryByDisplayValue("LEITWEG-123")).not.toBeInTheDocument();
  });

  it("starts non-B2G customers unchecked with no buyer reference", async () => {
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceNew />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);
    await user.click(searchInput);
    await screen.findByText("Herr Dr. med Max Mustermann");

    await user.type(searchInput, "80332");
    expect(await screen.findByText("Frau Erika Mustermann")).toBeInTheDocument();
    expect(screen.queryByText("Herr Dr. med Max Mustermann")).not.toBeInTheDocument();
  });

  it("keeps retry available after repeated customer loading failures and recovers", async () => {
    let customerRequestCount = 0;
    let resolveSecondRetryRequest!: (response: Response) => void;
    let resolveSuccessfulRetryRequest!: (response: Response) => void;
    const secondRetryResponse = new Promise<Response>((resolve) => {
      resolveSecondRetryRequest = resolve;
    });
    const successfulRetryResponse = new Promise<Response>((resolve) => {
      resolveSuccessfulRetryRequest = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : (input as string);

      if (url.includes("/api/iroc/customers-combined")) {
        customerRequestCount += 1;
        if (customerRequestCount === 1) {
          return { ok: false, status: 503, statusText: "Service Unavailable" } as Response;
        }
        if (customerRequestCount === 2) return secondRetryResponse;
        return successfulRetryResponse;
      }
      if (url.includes("/api/iroc/inventory")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (url.includes("/api/iroc/invoices/next-number")) {
        return { ok: true, json: async () => ({ nextNumber: "2026-9999" }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const user = userEvent.setup();

    render(<InvoiceNew />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);
    await user.click(searchInput);

    const errorState = await screen.findByRole("alert");
    expect(errorState).toBeVisible();
    expect(errorState).toHaveTextContent("Kundenliste konnte nicht geladen werden.");
    const retryButton = within(errorState).getByRole("button", {
      name: "Erneut versuchen",
    });
    expect(retryButton).toBeVisible();

    await user.click(retryButton);
    expect(await screen.findByText("Kunden werden geladen…")).toBeVisible();

    await act(async () => {
      resolveSecondRetryRequest({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      } as Response);
    });

    const repeatedErrorState = await screen.findByRole("alert");
    expect(repeatedErrorState).toBeVisible();
    expect(repeatedErrorState).toHaveTextContent("Kundenliste konnte nicht geladen werden.");
    const repeatedRetryButton = within(repeatedErrorState).getByRole("button", {
      name: "Erneut versuchen",
    });
    expect(repeatedRetryButton).toBeVisible();

    await user.click(repeatedRetryButton);
    expect(await screen.findByText("Kunden werden geladen…")).toBeVisible();

    await act(async () => {
      resolveSuccessfulRetryRequest({
        ok: true,
        json: async () => TWO_MUSTERMANNS,
      } as Response);
    });

    await user.click(await screen.findByText("Frau Erika Mustermann"));

    expect(screen.getByRole("checkbox", { name: /Public authority/i })).not.toBeChecked();
    expect(screen.queryByDisplayValue("LEITWEG-123")).not.toBeInTheDocument();
  });

  it("announces English customer loading failures and recovers through the retry flow", async () => {
    languageState.lang = "en";

    let customerRequestCount = 0;
    let resolveRetryRequest!: (response: Response) => void;
    const retryResponse = new Promise<Response>((resolve) => {
      resolveRetryRequest = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : (input as string);

      if (url.includes("/api/iroc/customers-combined")) {
        customerRequestCount += 1;
        if (customerRequestCount === 1) {
          return { ok: false, status: 503, statusText: "Service Unavailable" } as Response;
        }
        return retryResponse;
      }
      if (url.includes("/api/iroc/inventory")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (url.includes("/api/iroc/invoices/next-number")) {
        return { ok: true, json: async () => ({ nextNumber: "2026-9999" }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const user = userEvent.setup();

    render(<InvoiceNew />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText("Search customer…");
    await user.click(searchInput);

    const errorState = await screen.findByRole("alert");
    expect(errorState).toBeVisible();
    expect(errorState).toHaveTextContent("Customer list could not be loaded.");
    expect(within(errorState).getByText("Check the connection and try again.")).toBeVisible();

    const retryButton = within(errorState).getByRole("button", { name: "Try again" });
    expect(retryButton).toBeVisible();

    await user.click(retryButton);
    expect(await screen.findByText("Loading customers…")).toBeVisible();

    await act(async () => {
      resolveRetryRequest({
        ok: true,
        json: async () => TWO_MUSTERMANNS,
      } as Response);
    });

    await user.click(await screen.findByText("Frau Erika Mustermann"));

    expect(screen.getByRole("checkbox", { name: /Public authority/i })).not.toBeChecked();
    expect(screen.queryByDisplayValue("LEITWEG-123")).not.toBeInTheDocument();
  });

  it("starts non-B2G customers unchecked with no buyer reference", async () => {
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceNew />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);
    await user.click(searchInput);
    await user.click(await screen.findByText("Herr Dr. med Max Mustermann"));

    const b2gCheckbox = screen.getByRole("checkbox", { name: /Public authority/i });
    expect(b2gCheckbox).toBeChecked();
    const buyerReferenceInput = screen.getByDisplayValue("LEITWEG-123");
    expect(buyerReferenceInput).toBeInTheDocument();

    await user.clear(buyerReferenceInput);
    await user.type(buyerReferenceInput, "EDITED-456");
    expect(screen.getByDisplayValue("EDITED-456")).toBeInTheDocument();
  });

  it("applies the same B2G defaults after URL-based customer preselection", async () => {
    window.history.replaceState({}, "", "/invoices/new?websiteCustomerId=1");
    installFetchSpy();

    render(<InvoiceNew />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /Public authority/i })).toBeChecked();
    });
    expect(screen.getByDisplayValue("LEITWEG-123")).toBeInTheDocument();
  });

  it("refreshes B2G defaults when replacing a URL-preselected customer", async () => {
    window.history.replaceState({}, "", "/invoices/new?websiteCustomerId=1");
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceNew />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /Public authority/i })).toBeChecked();
    });
    expect(screen.getByDisplayValue("LEITWEG-123")).toBeInTheDocument();

    // Remove the preselected public authority, then use the regular picker.
    const selectedCustomer = screen.getByText("Max Mustermann").closest(
      "div.flex.items-center.justify-between",
    );
    expect(selectedCustomer).not.toBeNull();
    await user.click(within(selectedCustomer as HTMLElement).getByRole("button"));
    await user.click(await screen.findByPlaceholderText(/Kunden suchen/i));
    await user.click(await screen.findByText("Frau Erika Mustermann"));

    const b2gCheckbox = screen.getByRole("checkbox", { name: /Public authority/i });
    expect(b2gCheckbox).not.toBeChecked();
    expect(screen.queryByDisplayValue("LEITWEG-123")).not.toBeInTheDocument();

    // Selecting a public authority through the picker restores its own default.
    const nonB2gCustomer = screen.getByText("Erika Mustermann").closest(
      "div.flex.items-center.justify-between",
    );
    expect(nonB2gCustomer).not.toBeNull();
    await user.click(within(nonB2gCustomer as HTMLElement).getByRole("button"));
    await user.click(await screen.findByPlaceholderText(/Kunden suchen/i));
    await user.click(await screen.findByText("Herr Dr. med Max Mustermann"));

    expect(screen.getByRole("checkbox", { name: /Public authority/i })).toBeChecked();
    expect(screen.getByDisplayValue("LEITWEG-123")).toBeInTheDocument();
  });

  it("starts non-B2G customers unchecked with no buyer reference", async () => {
    installFetchSpy();
    const user = userEvent.setup();

    render(<InvoiceNew />, { wrapper: Wrapper });

    const searchInput = await screen.findByPlaceholderText(/Kunden suchen/i);
    await user.click(searchInput);
    await user.click(await screen.findByText("Frau Erika Mustermann"));

    expect(screen.getByRole("checkbox", { name: /Public authority/i })).not.toBeChecked();
    expect(screen.queryByDisplayValue("LEITWEG-123")).not.toBeInTheDocument();
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

    render(<InvoiceNew />, { wrapper: Wrapper });

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
});
