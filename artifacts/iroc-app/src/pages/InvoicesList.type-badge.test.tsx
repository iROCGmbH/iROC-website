/**
 * InvoicesList – invoice-type badge labelling
 *
 * Confirms that lecture-eu and lecture-noneu invoices render a human-readable
 * type badge ("Vortrag EU" / "Vortrag Nicht-EU") in the list, and that no
 * raw type string (e.g. "lecture-eu") leaks through.
 *
 * The other standard types (domestic, eu, export, noneu) are also exercised so
 * the same helper is confirmed end-to-end.
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
    data: [
      makeInvoice(1, "domestic"),
      makeInvoice(2, "eu"),
      makeInvoice(3, "export"),
      makeInvoice(4, "noneu"),
      makeInvoice(5, "lecture-eu"),
      makeInvoice(6, "lecture-noneu"),
    ],
    isLoading: false,
    refetch:   vi.fn(),
  }),
  updateIrocInvoiceStatus:      vi.fn(),
  getListIrocInvoicesQueryKey:  () => ["iroc-invoices"],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InvoicesList />
    </QueryClientProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InvoicesList – type badge labels (German)", () => {
  it("shows 'Vortrag EU' for lecture-eu invoices", () => {
    renderList();
    expect(screen.getByText("Vortrag EU")).toBeInTheDocument();
  });

  it("shows 'Vortrag Nicht-EU' for lecture-noneu invoices", () => {
    renderList();
    expect(screen.getByText("Vortrag Nicht-EU")).toBeInTheDocument();
  });

  it("does not render the raw string 'lecture-eu'", () => {
    renderList();
    expect(screen.queryByText("lecture-eu")).not.toBeInTheDocument();
  });

  it("does not render the raw string 'lecture-noneu'", () => {
    renderList();
    expect(screen.queryByText("lecture-noneu")).not.toBeInTheDocument();
  });

  it("shows 'Inland' for domestic invoices", () => {
    renderList();
    expect(screen.getByText("Inland")).toBeInTheDocument();
  });

  it("shows 'EU' for eu invoices", () => {
    renderList();
    expect(screen.getByText("EU")).toBeInTheDocument();
  });

  it("shows 'Export' for export invoices", () => {
    renderList();
    expect(screen.getByText("Export")).toBeInTheDocument();
  });

  it("shows 'Nicht-EU' for noneu invoices", () => {
    renderList();
    expect(screen.getByText("Nicht-EU")).toBeInTheDocument();
  });
});
