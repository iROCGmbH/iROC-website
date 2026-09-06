/**
 * InvoiceNew — invoice type must survive the submit path
 *
 * These tests exercise the form far enough to submit a real create-invoice
 * mutation. They protect against a regression where the visible lecture-EU
 * selection is accidentally replaced with the domestic type in the payload.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceNew from "./InvoiceNew";

const createState = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "de" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/invoices/new", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListIrocProducts: () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
  useCreateIrocInvoice: () => ({ mutate: createState.mutate, isPending: false }),
}));

const CUSTOMER = {
  source: "website",
  id: 10,
  customerNr: "2026-0001",
  salutation: "Herr",
  title: null,
  name: "Max Mustermann",
  company: null,
  email: "max@example.com",
  country: "DE",
  shippingCountry: "DE",
  city: "München",
  address: "Musterstraße 1",
  postalCode: "80331",
  isEu: false,
  vatId: null,
  irocCustomerId: null,
};

function installFetchSpy() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = input instanceof Request
      ? input.url
      : input instanceof URL
      ? input.toString()
      : String(input);

    if (url.includes("/api/iroc/customers-combined")) {
      return { ok: true, json: async () => [CUSTOMER] } as Response;
    }
    if (url.includes("/api/iroc/inventory")) {
      return { ok: true, json: async () => [] } as Response;
    }
    if (url.includes("/api/iroc/invoices/next-number")) {
      return { ok: true, json: async () => ({ nextNumber: "2026-9999" }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })}>
      {children}
    </QueryClientProvider>
  );
}

async function renderReadyInvoiceForm() {
  installFetchSpy();
  render(<InvoiceNew />, { wrapper: Wrapper });

  const customerSearch = await screen.findByPlaceholderText(/Kunden suchen/i);
  fireEvent.focus(customerSearch);
  fireEvent.click(await screen.findByText(/Max Mustermann/i));

  fireEvent.click(screen.getByRole("button", { name: /Artikel hinzufügen/i }));
  fireEvent.change(screen.getByPlaceholderText("Produktname"), {
    target: { value: "Schulung" },
  });

  return screen.getByDisplayValue(/Inland \(19 % MwSt\.\)/i) as HTMLSelectElement;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  createState.mutate.mockReset();
});

describe("InvoiceNew — submitted invoice type", () => {
  it("submits lecture-eu when the admin selects lecture-eu", async () => {
    const typeSelect = await renderReadyInvoiceForm();

    fireEvent.change(typeSelect, { target: { value: "lecture-eu" } });
    fireEvent.click(screen.getByRole("button", { name: /Erstellen/i }));

    await waitFor(() => expect(createState.mutate).toHaveBeenCalledTimes(1));
    expect(createState.mutate.mock.calls[0][0].data.invoiceType).toBe("lecture-eu");
    expect(createState.mutate.mock.calls[0][0].data.invoiceType).not.toBe("domestic");
  });

  it("still submits lecture-eu after switching to another type and back", async () => {
    const typeSelect = await renderReadyInvoiceForm();

    fireEvent.change(typeSelect, { target: { value: "domestic" } });
    fireEvent.change(typeSelect, { target: { value: "lecture-eu" } });
    expect(typeSelect.value).toBe("lecture-eu");

    fireEvent.click(screen.getByRole("button", { name: /Erstellen/i }));

    await waitFor(() => expect(createState.mutate).toHaveBeenCalledTimes(1));
    expect(createState.mutate.mock.calls[0][0].data.invoiceType).toBe("lecture-eu");
    expect(createState.mutate.mock.calls[0][0].data.invoiceType).not.toBe("domestic");
  });
});