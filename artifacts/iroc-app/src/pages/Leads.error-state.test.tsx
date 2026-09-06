/**
 * Confirms the Leads page shows a visible error message when the server fails
 * instead of silently rendering an empty list, and that it recovers
 * automatically when the network comes back.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Network rejection (fetch rejects with an error) → error message rendered,
 *    "No leads found" empty-state text is NOT shown.
 * 2. Non-ok HTTP response (server returns 500) → error message rendered,
 *    "No leads found" empty-state text is NOT shown.
 * 3. Manual QueryClient refetch after server recovers → error clears, rows visible.
 * 4. Window-focus event after network outage → React Query's refetchOnWindowFocus
 *    triggers automatically, no admin action required; error clears, rows visible.
 * 5. Window online event after network outage → React Query's onlineManager
 *    triggers automatically, no admin action required; error clears, rows visible.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Leads from "./Leads";
import { LEADS_QUERY_KEY } from "@/lib/query-keys";

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** QueryClient with no retries so failures surface immediately in tests. */
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderLeads() {
  const qc = makeQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <Leads />
    </QueryClientProvider>,
  );
  return qc;
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Leads page – error state", () => {
  it("shows an error message when the fetch rejects (network error)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    renderLeads();

    await waitFor(() =>
      expect(
        screen.getByText(/Failed to load leads/i),
      ).toBeInTheDocument(),
    );

    // Should NOT silently show the empty-state text
    expect(screen.queryByText(/No leads found/i)).not.toBeInTheDocument();
  });

  it("shows an error message when the server returns a non-ok response (500)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    } as unknown as Response);

    renderLeads();

    await waitFor(() =>
      expect(
        screen.getByText(/Failed to load leads/i),
      ).toBeInTheDocument(),
    );

    // Should NOT silently show the empty-state text
    expect(screen.queryByText(/No leads found/i)).not.toBeInTheDocument();
  });

  it("clears the error and shows lead rows after the server recovers and a retry succeeds", async () => {
    const mockLead = {
      id: 1,
      salutation: "Herr",
      medicalTitle: null,
      firstName: "Max",
      lastName: "Mustermann",
      specialty: "Orthopädie",
      zipCode: null,
      city: null,
      country: "Deutschland",
      email: "max@example.com",
      phone: null,
      website: null,
      contactWhere: null,
      firstContactDate: null,
      notes: null,
      status: "new",
      createdAt: "2024-01-15T10:00:00.000Z",
    };

    // First call rejects (server down), second call succeeds (server recovered)
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [mockLead],
      } as unknown as Response);

    const qc = renderLeads();

    // Wait for the error state to appear
    await waitFor(() =>
      expect(screen.getByText(/Failed to load leads/i)).toBeInTheDocument(),
    );

    // Trigger a manual refetch to simulate the server recovering
    await act(async () => {
      await qc.refetchQueries({ queryKey: LEADS_QUERY_KEY });
    });

    // Error message should be gone
    await waitFor(() =>
      expect(screen.queryByText(/Failed to load leads/i)).not.toBeInTheDocument(),
    );

    // Lead row should be visible (buildDisplayName renders the full "Herr Max Mustermann")
    expect(screen.getByText(/Mustermann/i)).toBeInTheDocument();

    // Empty-state should not appear
    expect(screen.queryByText(/No leads found/i)).not.toBeInTheDocument();
  });

  it("clears the error and shows lead rows when the window regains focus (refetchOnWindowFocus)", async () => {
    const mockLead = {
      id: 1,
      salutation: "Herr",
      medicalTitle: null,
      firstName: "Max",
      lastName: "Mustermann",
      specialty: "Orthopädie",
      zipCode: null,
      city: null,
      country: "Deutschland",
      email: "max@example.com",
      phone: null,
      website: null,
      contactWhere: null,
      firstContactDate: null,
      notes: null,
      status: "new",
      createdAt: "2024-01-15T10:00:00.000Z",
    };

    // First call rejects (network down); second call succeeds (network recovered)
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [mockLead],
      } as unknown as Response);

    // Use a QueryClient with refetchOnWindowFocus enabled (the default) so
    // that a window focus event triggers the automatic retry without any
    // admin interaction.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
    });
    render(
      <QueryClientProvider client={qc}>
        <Leads />
      </QueryClientProvider>,
    );

    // Wait for the error banner to appear after the first (failing) fetch
    await waitFor(() =>
      expect(screen.getByText(/Failed to load leads/i)).toBeInTheDocument(),
    );

    // Simulate the window regaining focus after the network outage.
    // React Query v5 listens to the native "visibilitychange" event on window
    // to trigger refetchOnWindowFocus — no user click or manual refetch is
    // needed.  In jsdom, document.visibilityState defaults to "visible" so
    // dispatching visibilitychange makes the focusManager call onFocus() →
    // isFocused() === true → the stale query is automatically refetched.
    await act(async () => {
      window.dispatchEvent(new Event("visibilitychange"));
    });

    // The error banner should disappear automatically
    await waitFor(() =>
      expect(
        screen.queryByText(/Failed to load leads/i),
      ).not.toBeInTheDocument(),
    );

    // The recovered lead row should be visible
    expect(screen.getByText(/Mustermann/i)).toBeInTheDocument();

    // Empty-state must not be shown
    expect(screen.queryByText(/No leads found/i)).not.toBeInTheDocument();
  });

  it("clears the error and shows lead rows when the network comes back online", async () => {
    const mockLead = {
      id: 1,
      salutation: "Herr",
      medicalTitle: null,
      firstName: "Max",
      lastName: "Mustermann",
      specialty: "Orthopädie",
      zipCode: null,
      city: null,
      country: "Deutschland",
      email: "max@example.com",
      phone: null,
      website: null,
      contactWhere: null,
      firstContactDate: null,
      notes: null,
      status: "new",
      createdAt: "2024-01-15T10:00:00.000Z",
    };

    // First call rejects (network down); second call succeeds (network recovered)
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [mockLead],
      } as unknown as Response);

    const qc = makeQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <Leads />
      </QueryClientProvider>,
    );

    // Wait for the error state so the failed query is stale and eligible for
    // React Query's online recovery refetch.
    await waitFor(() =>
      expect(screen.getByText(/Failed to load leads/i)).toBeInTheDocument(),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Simulate a mobile browser reporting that connectivity was lost and then
    // restored. QueryClientProvider subscribes to onlineManager, so the native
    // online event should refetch without a manual QueryClient refetch.
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() =>
      expect(
        screen.queryByText(/Failed to load leads/i),
      ).not.toBeInTheDocument(),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Mustermann/i)).toBeInTheDocument();
    expect(screen.queryByText(/No leads found/i)).not.toBeInTheDocument();
  });
});
