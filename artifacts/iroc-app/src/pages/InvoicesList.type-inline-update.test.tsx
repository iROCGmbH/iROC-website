/**
 * InvoicesList – type label updates after inline type edit
 *
 * Confirms that when InvoiceEdit saves a changed invoice type and the list
 * query is invalidated (queryClient.invalidateQueries with getListIrocInvoicesQueryKey),
 * the invoice list row immediately reflects the new type label — no full page
 * reload required.
 *
 * Technique: useListIrocInvoices is backed by a mutable reference so that
 * re-rendering the component after updating the mock data simulates the
 * refetch that follows a query invalidation.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoicesList from "./InvoicesList";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "de" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/invoices", vi.fn()],
  useParams:   () => ({}),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mutable store — updated between renders to simulate a post-invalidation refetch
let mockInvoiceStore: ReturnType<typeof makeInvoice>[] = [];

const makeInvoice = (id: number, invoiceType: string) => ({
  id,
  invoiceNumber: `RE-2024-00${id}`,
  customerName:  "Test Kunde",
  issueDate:     "2024-01-15",
  dueDate:       "2024-02-15",
  status:        "draft",
  total:         "100.00",
  invoiceType,
});

vi.mock("@workspace/api-client-react", () => ({
  useListIrocInvoices: () => ({
    // Each render reads the current value of mockInvoiceStore
    data:     mockInvoiceStore,
    isLoading: false,
    refetch:   vi.fn(),
  }),
  updateIrocInvoiceStatus:     vi.fn(),
  getListIrocInvoicesQueryKey: () => ["iroc-invoices"],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, Wrapper };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoicesList – type label updates after inline edit (no page reload)", () => {
  it("shows updated type label after list query is re-fetched with new type", () => {
    // Seed: invoice starts as "domestic"
    mockInvoiceStore = [makeInvoice(1, "domestic")];

    const { Wrapper } = buildWrapper();
    const { rerender } = render(
      <Wrapper>
        <InvoicesList />
      </Wrapper>
    );

    // Initial render: domestic type → "Inland"
    expect(screen.getByText("Inland")).toBeInTheDocument();
    expect(screen.queryByText("EU")).not.toBeInTheDocument();

    // Simulate: InvoiceEdit saves the invoice with invoiceType="eu", then calls
    //   queryClient.invalidateQueries({ queryKey: getListIrocInvoicesQueryKey() })
    // The list query refetches and now returns the updated invoice.
    mockInvoiceStore = [makeInvoice(1, "eu")];

    rerender(
      <Wrapper>
        <InvoicesList />
      </Wrapper>
    );

    // After refetch: type label must show "EU", not the stale "Inland"
    expect(screen.getByText("EU")).toBeInTheDocument();
    expect(screen.queryByText("Inland")).not.toBeInTheDocument();
  });

  it("updates from lecture-eu label to export label after type change", () => {
    mockInvoiceStore = [makeInvoice(2, "lecture-eu")];

    const { Wrapper } = buildWrapper();
    const { rerender } = render(
      <Wrapper>
        <InvoicesList />
      </Wrapper>
    );

    expect(screen.getByText("Vortrag EU")).toBeInTheDocument();
    expect(screen.queryByText("Export")).not.toBeInTheDocument();

    // Simulate post-save refetch: type changed to "export"
    mockInvoiceStore = [makeInvoice(2, "export")];
    rerender(
      <Wrapper>
        <InvoicesList />
      </Wrapper>
    );

    expect(screen.getByText("Export")).toBeInTheDocument();
    expect(screen.queryByText("Vortrag EU")).not.toBeInTheDocument();
  });

  it("raw type string never leaks into the row even after a type update", () => {
    mockInvoiceStore = [makeInvoice(3, "domestic")];

    const { Wrapper } = buildWrapper();
    const { rerender } = render(
      <Wrapper>
        <InvoicesList />
      </Wrapper>
    );

    // Switch to lecture-noneu — must show label, not raw string
    mockInvoiceStore = [makeInvoice(3, "lecture-noneu")];
    rerender(
      <Wrapper>
        <InvoicesList />
      </Wrapper>
    );

    expect(screen.getByText("Vortrag Nicht-EU")).toBeInTheDocument();
    expect(screen.queryByText("lecture-noneu")).not.toBeInTheDocument();
  });
});
