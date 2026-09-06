/**
 * Tests for ProtectedRoute — sync-status toast + leads invalidation.
 *
 * The ProtectedRoute fires POST /api/iroc/leads/sync-status at most ONCE per
 * page-load session (module-level flag).  When the response contains non-zero
 * `converted` or `qualified` counts the component must:
 *   a) show a toast summarising the auto-promotions, and
 *   b) invalidate the "leads" query so the Leads page reflects the new statuses.
 *
 * Covered scenarios
 * ─────────────────
 * 1. converted > 0, qualified = 0  → toast fires (en), leads query invalidated.
 * 2. converted = 0, qualified > 0  → toast fires (de), leads query invalidated.
 * 3. converted > 0, qualified > 0  → toast fires with both parts joined by " · ".
 * 4. converted = 0, qualified = 0  → no toast, no invalidation.
 * 5. API returns a non-ok response → no toast, no invalidation (error swallowed).
 * 6. fetch throws (network error)  → no toast, no invalidation (error swallowed).
 * 7. Multiple mounts (route changes) → sync fires only once, not on every mount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ProtectedRoute, queryClient, _resetSyncStatusFiredForTesting } from "./App";
import { LEADS_QUERY_KEY } from "@/lib/query-keys";

// ── Heavy page / layout imports are irrelevant — stub them all ─────────────────
// NOTE: vi.mock factories are hoisted; no variables from outside may be
// referenced inside them.  Each factory defines its own inline stub.

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/pages/not-found",                    () => ({ default: () => null }));
vi.mock("@/pages/Dashboard",                    () => ({ default: () => null }));
vi.mock("@/pages/Login",                        () => ({ default: () => null }));
vi.mock("@/pages/CustomersList",                () => ({ default: () => null }));
vi.mock("@/pages/CustomerDetail",               () => ({ default: () => null }));
vi.mock("@/pages/ProductsList",                 () => ({ default: () => null }));
vi.mock("@/pages/ProductDetail",                () => ({ default: () => null }));
vi.mock("@/pages/Inventory",                    () => ({ default: () => null }));
vi.mock("@/pages/InvoicesList",                 () => ({ default: () => null }));
vi.mock("@/pages/InvoiceNew",                   () => ({ default: () => null }));
vi.mock("@/pages/InvoiceDetail",                () => ({ default: () => null }));
vi.mock("@/pages/InvoiceEdit",                  () => ({ default: () => null }));
vi.mock("@/pages/Notifications",                () => ({ default: () => null }));
vi.mock("@/pages/SpirecutQuotes",               () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsiteTraining",          () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsiteRegistrations",     () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsiteDoctors",           () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsiteResources",         () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsiteTeam",              () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsiteEvents",            () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsiteEmail",             () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsiteCustomers",         () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsiteSettings",          () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsitePortalPasswords",   () => ({ default: () => null }));
vi.mock("@/pages/SpirecutMedia",                () => ({ default: () => null }));
vi.mock("@/pages/SpirecutSocial",               () => ({ default: () => null }));
vi.mock("@/pages/SpirecutPostop",               () => ({ default: () => null }));
vi.mock("@/pages/SpirecutSettings",             () => ({ default: () => null }));
vi.mock("@/pages/SpirecutContent",              () => ({ default: () => null }));
vi.mock("@/pages/IrocWebsiteContent",           () => ({ default: () => null }));
vi.mock("@/pages/Configuration",                () => ({ default: () => null }));
vi.mock("@/pages/SalesSummary",                 () => ({ default: () => null }));
vi.mock("@/pages/Announcements",                () => ({ default: () => null }));
vi.mock("@/pages/Leads",                        () => ({ default: () => null }));

// ── Infrastructure stubs ───────────────────────────────────────────────────────

// wouter: useLocation returns "/" so ProtectedRoute never redirects.
vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Route:       ({ component: C }: { component: React.ComponentType }) => <C />,
  Switch:      ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Router:      ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// setAuthTokenGetter / setBaseUrl — no-ops in the test environment.
vi.mock("@workspace/api-client-react", () => ({
  setAuthTokenGetter: vi.fn(),
  setBaseUrl:         vi.fn(),
}));

// useAuth — token always present so the guard doesn't redirect.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

// ── Toast mock ─────────────────────────────────────────────────────────────────

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  toast:    (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Stub component used as ProtectedRoute's `component` prop. */
const StubPage = () => <div data-testid="stub-page" />;

/** Render ProtectedRoute inside a QueryClientProvider. */
function renderProtectedRoute() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProtectedRoute component={StubPage} />
    </QueryClientProvider>,
  );
}

/** Stub fetch for the sync-status POST. */
function stubSyncFetch(
  response:
    | { ok: true; data: { updated?: number; converted?: number; qualified?: number } }
    | { ok: false }
    | "throw",
) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);

      if (url.includes("sync-status")) {
        if (response === "throw") throw new Error("Network error (simulated)");
        if (!response.ok) return { ok: false } as Response;
        return { ok: true, json: async () => response.data } as Response;
      }
      throw new Error(`Unmocked fetch: ${url}`);
    },
  );
}

beforeEach(() => {
  // Reset the module-level session flag so each test starts fresh.
  _resetSyncStatusFiredForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
  localStorage.removeItem("iroc_lang");
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ProtectedRoute – sync-status toast and leads invalidation", () => {
  // ── 1. converted only ─────────────────────────────────────────────────────

  it("shows an English toast and invalidates leads when only converted > 0", async () => {
    localStorage.setItem("iroc_lang", "en");
    stubSyncFetch({ ok: true, data: { updated: 3, converted: 3, qualified: 0 } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderProtectedRoute();

    await waitFor(() => expect(mockToast).toHaveBeenCalledOnce());

    const [call] = mockToast.mock.calls;
    expect(call[0].title).toBe("Leads auto-promoted");
    expect(call[0].description).toBe("3 leads → Converted");

    const leadsInvalidations = invalidateSpy.mock.calls.filter(
      (args) =>
        Array.isArray((args[0] as { queryKey?: unknown })?.queryKey) &&
        (args[0] as { queryKey: unknown[] }).queryKey[0] === LEADS_QUERY_KEY[0],
    );
    expect(leadsInvalidations.length).toBeGreaterThanOrEqual(1);
  });

  // ── 2. qualified only (German locale) ─────────────────────────────────────

  it("shows a German toast and invalidates leads when only qualified > 0", async () => {
    localStorage.setItem("iroc_lang", "de");
    stubSyncFetch({ ok: true, data: { updated: 1, converted: 0, qualified: 1 } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderProtectedRoute();

    await waitFor(() => expect(mockToast).toHaveBeenCalledOnce());

    const [call] = mockToast.mock.calls;
    expect(call[0].title).toBe("Leads automatisch aktualisiert");
    expect(call[0].description).toBe("1 Lead → Qualifiziert");

    const leadsInvalidations = invalidateSpy.mock.calls.filter(
      (args) =>
        Array.isArray((args[0] as { queryKey?: unknown })?.queryKey) &&
        (args[0] as { queryKey: unknown[] }).queryKey[0] === LEADS_QUERY_KEY[0],
    );
    expect(leadsInvalidations.length).toBeGreaterThanOrEqual(1);
  });

  it("uses the German plural label for multiple converted leads", async () => {
    localStorage.setItem("iroc_lang", "de");
    stubSyncFetch({ ok: true, data: { updated: 2, converted: 2, qualified: 0 } });

    renderProtectedRoute();

    await waitFor(() => expect(mockToast).toHaveBeenCalledOnce());

    const description: string = mockToast.mock.calls[0][0].description;
    expect(description).toContain("2 Leads → Konvertiert");
  });

  it("uses the English singular label for exactly one qualified lead", async () => {
    localStorage.setItem("iroc_lang", "en");
    stubSyncFetch({ ok: true, data: { updated: 1, converted: 0, qualified: 1 } });

    renderProtectedRoute();

    await waitFor(() => expect(mockToast).toHaveBeenCalledOnce());

    const description: string = mockToast.mock.calls[0][0].description;
    expect(description).toContain("1 lead → Qualified");
  });

  // ── 3. both converted and qualified ───────────────────────────────────────

  it("joins both counts with ' · ' when both converted and qualified > 0", async () => {
    localStorage.setItem("iroc_lang", "en");
    stubSyncFetch({ ok: true, data: { updated: 6, converted: 2, qualified: 4 } });

    renderProtectedRoute();

    await waitFor(() => expect(mockToast).toHaveBeenCalledOnce());

    const description: string = mockToast.mock.calls[0][0].description;
    expect(description).toContain("2 leads → Converted");
    expect(description).toContain("4 leads → Qualified");
    expect(description).toContain(" · ");
  });

  // ── 4. zero counts → no toast, no invalidation ────────────────────────────

  it("does NOT show a toast and does NOT invalidate leads when both counts are 0", async () => {
    stubSyncFetch({ ok: true, data: { updated: 0, converted: 0, qualified: 0 } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderProtectedRoute();

    // Wait long enough for the async effect to settle.
    await new Promise((r) => setTimeout(r, 80));

    const leadsInvalidations = invalidateSpy.mock.calls.filter(
      (args) =>
        Array.isArray((args[0] as { queryKey?: unknown })?.queryKey) &&
        (args[0] as { queryKey: unknown[] }).queryKey[0] === LEADS_QUERY_KEY[0],
    );
    expect(mockToast).not.toHaveBeenCalled();
    expect(leadsInvalidations.length).toBe(0);
  });

  // ── 5. non-ok HTTP response → error swallowed ─────────────────────────────

  it("swallows a non-ok API response without showing a toast", async () => {
    stubSyncFetch({ ok: false });

    renderProtectedRoute();

    await new Promise((r) => setTimeout(r, 80));

    expect(mockToast).not.toHaveBeenCalled();
  });

  // ── 6. fetch throws → error swallowed ─────────────────────────────────────

  it("swallows a network-level fetch error without showing a toast", async () => {
    stubSyncFetch("throw");

    renderProtectedRoute();

    await new Promise((r) => setTimeout(r, 80));

    expect(mockToast).not.toHaveBeenCalled();
  });

  // ── 7. session guard — multiple mounts fire only one request ──────────────

  it("fires the sync request exactly once even when ProtectedRoute mounts multiple times", async () => {
    localStorage.setItem("iroc_lang", "en");
    const fetchSpy = stubSyncFetch({ ok: true, data: { updated: 1, converted: 1, qualified: 0 } });

    // First mount — sync should run.
    const { unmount: unmount1 } = renderProtectedRoute();
    await waitFor(() => expect(mockToast).toHaveBeenCalledOnce());
    unmount1();

    mockToast.mockClear();

    // Second mount (simulates navigating to a different route) — sync must NOT run again.
    renderProtectedRoute();
    await new Promise((r) => setTimeout(r, 80));

    const syncCalls = fetchSpy.mock.calls.filter((args) => {
      const url = args[0] instanceof Request
        ? args[0].url
        : args[0] instanceof URL
        ? args[0].toString()
        : String(args[0]);
      return url.includes("sync-status");
    });

    expect(syncCalls.length).toBe(1);
    expect(mockToast).not.toHaveBeenCalled();
  });
});
