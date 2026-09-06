/**
 * Tests for Dashboard — "services" category label rendering in New Orders.
 *
 * Confirms that when the dashboard API returns a categoryTotals entry with
 * category === "services", the New Orders panel renders:
 *   - "Dienstleistungen" in German (lang = "de")
 *   - "Services"         in English (lang = "en")
 *
 * rather than displaying the raw "services" string.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dashboard from "./Dashboard";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

// useLanguage is overridden per-test via mockImplementation; provide a default.
const mockUseLang = vi.fn(() => ({ lang: "de" as "de" | "en" }));
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => mockUseLang(),
}));

// useListIrocInvoices is only used by the inline invoice status table and is
// not exercised by these tests.
vi.mock("@workspace/api-client-react", () => ({
  useListIrocInvoices: () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
}));

// wouter's <Link> needs no routing context for this shallow render.
vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLocation: () => ["/", vi.fn()],
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OTHER_DASH_RESPONSE = {
  totalCustomers: 1,
  totalProducts:  1,
  totalInvoices:  1,
  lowStockCount:  0,
  unreadNotifications: 0,
  revenueTotal:   "0",
  revenueSent:    "0",
  availableYears: [2026],
  invoicesByStatus: { draft: 1, sent: 0, paid: 0, cancelled: 0 },
  pendingQuotes:  0,
  pendingTrainings: 0,
  recentOrders: [
    {
      id:              1,
      name:            "Anna Example",
      institutionName: "Example Clinic",
      email:           "anna@example.com",
      instrument:      "spirecut",
      createdAt:       "2026-01-15T10:00:00Z",
      openOrderCount:  1,
      categoryTotals:  [{ category: "other", total: "200.00" }],
    },
  ],
  recentTrainings: [],
};

const SERVICES_DASH_RESPONSE = {
  totalCustomers: 1,
  totalProducts:  1,
  totalInvoices:  1,
  lowStockCount:  0,
  unreadNotifications: 0,
  revenueTotal:   "0",
  revenueSent:    "0",
  availableYears: [2026],
  invoicesByStatus: { draft: 1, sent: 0, paid: 0, cancelled: 0 },
  pendingQuotes:  0,
  pendingTrainings: 0,
  recentOrders: [
    {
      id:              1,
      name:            "Anna Example",
      institutionName: "Example Clinic",
      email:           "anna@example.com",
      instrument:      "spirecut",
      createdAt:       "2026-01-15T10:00:00Z",
      openOrderCount:  1,
      categoryTotals:  [{ category: "services", total: "750.00" }],
    },
  ],
  recentTrainings: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
}

function Wrapper({ client, children }: { client: QueryClient; children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function installDashFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
    ok:   true,
    json: async () => SERVICES_DASH_RESPONSE,
  } as Response));
}

afterEach(() => {
  vi.restoreAllMocks();
  mockUseLang.mockImplementation(() => ({ lang: "de" }));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Dashboard — services category label in New Orders panel", () => {

  it('renders "Dienstleistungen" for the services category when lang is "de"', async () => {
    mockUseLang.mockReturnValue({ lang: "de" });
    installDashFetch();

    const qc = makeQueryClient();
    render(<Dashboard />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    // Wait for the New Orders panel to load (customer name appears).
    await waitFor(() =>
      expect(screen.getByText("Anna Example")).toBeInTheDocument()
    );

    // The raw string "services" must never appear as a label.
    expect(screen.queryByText(/^services:$/i)).toBeNull();

    // The localised label must be present.
    expect(screen.getByText(/Dienstleistungen/)).toBeInTheDocument();
  });

  it('renders "Services" for the services category when lang is "en"', async () => {
    mockUseLang.mockReturnValue({ lang: "en" });
    installDashFetch();

    const qc = makeQueryClient();
    render(<Dashboard />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    await waitFor(() =>
      expect(screen.getByText("Anna Example")).toBeInTheDocument()
    );

    // The raw lowercase "services" string must not appear — only the
    // localised label "Services:" (capital S) should be rendered.
    expect(screen.queryByText(/^services:$/)).toBeNull();

    // The localised label must be present.
    expect(screen.getByText(/^Services:$/)).toBeInTheDocument();
  });
});

// ── Tests: "other" category label ────────────────────────────────────────────

function installOtherFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
    ok:   true,
    json: async () => OTHER_DASH_RESPONSE,
  } as Response));
}

describe("Dashboard — other category label in New Orders panel", () => {

  it('renders "Sonstige" for the other category when lang is "de"', async () => {
    mockUseLang.mockReturnValue({ lang: "de" });
    installOtherFetch();

    const qc = makeQueryClient();
    render(<Dashboard />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    // Wait for the New Orders panel to load (customer name appears).
    await waitFor(() =>
      expect(screen.getByText("Anna Example")).toBeInTheDocument()
    );

    // The raw string "other" must never appear as a label.
    expect(screen.queryByText(/^other:$/i)).toBeNull();

    // The localised label must be present.
    expect(screen.getByText(/Sonstige/)).toBeInTheDocument();
  });

  it('renders "Other" for the other category when lang is "en"', async () => {
    mockUseLang.mockReturnValue({ lang: "en" });
    installOtherFetch();

    const qc = makeQueryClient();
    render(<Dashboard />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    await waitFor(() =>
      expect(screen.getByText("Anna Example")).toBeInTheDocument()
    );

    // The raw lowercase "other" string must not appear — only the
    // localised label "Other:" (capital O) should be rendered.
    expect(screen.queryByText(/^other:$/)).toBeNull();

    // The localised label must be present.
    expect(screen.getByText(/^Other:$/)).toBeInTheDocument();
  });
});
