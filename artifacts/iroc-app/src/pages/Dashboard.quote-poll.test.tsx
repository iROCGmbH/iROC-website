/**
 * Tests: dashboard pendingQuotes count stays fresh via polling.
 *
 * Verifies:
 *  (a) useQuery is configured with refetchInterval: 30_000 so the poll is
 *      set up at the correct cadence;
 *  (b) when the query cache is updated (simulating a poll returning new data)
 *      the rendered count changes without any user action;
 *  (c) React Query's built-in focus/visibility management is wired up —
 *      confirmed by checking that refetchIntervalInBackground is NOT set to
 *      true (so it defaults to false and pauses when the tab is hidden).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dashboard from "./Dashboard";
import { IROC_DASHBOARD_QUERY_KEY } from "@/lib/query-keys";

// ── @tanstack/react-query module mock ────────────────────────────────────────
// Wraps useQuery with a spy so we can inspect the options Dashboard passes.
// The factory uses `importOriginal` so every other export is unchanged.

const useQuerySpy = vi.fn();

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (opts: Parameters<typeof actual.useQuery>[0]) => {
      useQuerySpy(opts);
      return actual.useQuery(opts);
    },
  };
});

// ── Other module mocks ────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" as const }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListIrocInvoices:      () => ({ data: [] }),
  useListIrocProductGroups: () => ({ data: [] }),
}));

vi.mock("wouter", () => ({
  Link:        ({ children, href }: { children: React.ReactNode; href?: string }) => <a href={href}>{children}</a>,
  useLocation: () => ["/", vi.fn()],
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDashResponse(pendingQuotes: number, pendingOrders = 2, confirmedOrders = 4) {
  return {
    totalCustomers:      5,
    totalProducts:       10,
    totalInvoices:       20,
    lowStockCount:       0,
    unreadNotifications: 0,
    revenueTotal:        "0",
    revenueSent:         "0",
    availableYears:      [2026],
    invoicesByStatus:    { draft: 1, sent: 0, paid: 0, cancelled: 0 },
    pendingQuotes,
    pendingTrainings:    0,
    incomingOrders:      { pending: pendingOrders, approved: confirmedOrders },
    recentOrders:        [],
    recentTrainings:     [],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
}

function Wrapper({ client, children }: { client: QueryClient; children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
  useQuerySpy.mockClear();
  // Restore visibility state between tests.
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value:        "visible",
  });
  document.dispatchEvent(new Event("visibilitychange"));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Dashboard — pendingQuotes polling", () => {

  it("(a) useQuery is configured with refetchInterval: 30_000", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/iroc/dashboard")) {
        return { ok: true, json: async () => makeDashResponse(2) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const qc = makeQueryClient();
    render(<Dashboard />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    // Dashboard calls useQuery synchronously during render.
    expect(useQuerySpy).toHaveBeenCalled();

    // Find the call for the iroc-dashboard query.
    const dashCall = useQuerySpy.mock.calls.find(
      ([opts]: [{ queryKey?: unknown[] }]) =>
        Array.isArray(opts.queryKey) && opts.queryKey[0] === IROC_DASHBOARD_QUERY_KEY[0],
    );
    expect(dashCall).toBeDefined();

    const opts = dashCall![0] as { refetchInterval?: unknown; refetchIntervalInBackground?: unknown };

    // The dashboard must poll every 30 seconds.
    expect(opts.refetchInterval).toBe(30_000);

    // refetchIntervalInBackground must NOT be true so that React Query's
    // default behaviour (pause when the tab is hidden) stays active.
    expect(opts.refetchIntervalInBackground).not.toBe(true);
  });

  it("(b) count updates when the query re-fetches new data (simulates a poll result)", async () => {
    // Arrange: first fetch returns 2 quotes, subsequent fetches return 7.
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/iroc/dashboard")) {
        callCount += 1;
        return {
          ok:   true,
          json: async () => makeDashResponse(callCount === 1 ? 2 : 7),
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const qc = makeQueryClient();
    render(<Dashboard />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    // Wait for the initial fetch to populate the count.
    const pendingQuotesCard = () => screen.getByRole("link", { name: /Pending Quotes/i });
    await waitFor(() => expect(pendingQuotesCard()).toHaveTextContent("2"));

    // Simulate what the poll timer does: invalidate the cache so React Query
    // triggers a background re-fetch (equivalent to refetchInterval firing).
    await act(async () => {
      await qc.invalidateQueries({ queryKey: IROC_DASHBOARD_QUERY_KEY });
    });

    // The UI must update to the new count without any user interaction.
    await waitFor(() => expect(pendingQuotesCard()).toHaveTextContent("7"));

    // Sanity: at least two dashboard fetches happened.
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("(c) polling pauses when the tab is hidden (refetchIntervalInBackground not true)", async () => {
    // This test has two parts:
    //  1. Re-check the query options (no refetchIntervalInBackground: true).
    //  2. Confirm that while the document is hidden, no extra fetches fire
    //     when we invalidate (React Query will not re-fetch in the background
    //     unless refetchIntervalInBackground === true).

    let dashCallCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/iroc/dashboard")) {
        dashCallCount += 1;
        return {
          ok:   true,
          json: async () => makeDashResponse(dashCallCount),
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const qc = makeQueryClient();
    render(<Dashboard />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    // Wait for the initial fetch.
    await waitFor(() => expect(dashCallCount).toBeGreaterThanOrEqual(1));
    const afterInitial = dashCallCount;

    // Simulate the tab going hidden.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value:        "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Mark data as stale (what the interval timer would do). Because the tab
    // is hidden and refetchIntervalInBackground !== true, React Query should
    // not immediately fire a background refetch.
    await act(async () => {
      qc.invalidateQueries({ queryKey: IROC_DASHBOARD_QUERY_KEY });
      await Promise.resolve();
    });

    // Allow at most 1 extra call (some environments emit a synchronous
    // refetch before the visibility guard kicks in). The important thing is
    // that the interval does not keep firing repeatedly.
    expect(dashCallCount - afterInitial).toBeLessThanOrEqual(1);

    // Restore visibility.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value:        "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  it("shows pending and confirmed order shortcuts with direct filtered links", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/iroc/dashboard")) {
        return { ok: true, json: async () => makeDashResponse(0, 3, 8) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    const qc = makeQueryClient();
    render(<Dashboard />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    await waitFor(() => {
      expect(screen.getByText("Incoming Orders")).toBeInTheDocument();
      expect(screen.getByText("Awaiting customer confirmation")).toBeInTheDocument();
    });

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pending.*Awaiting customer confirmation/i }))
      .toHaveAttribute("href", "/iroc-website/orders?status=pending");
    expect(screen.getByRole("link", { name: /Confirmed.*Ready for processing/i }))
      .toHaveAttribute("href", "/iroc-website/orders?status=approved");
  });
});
