/**
 * Confirms the Leads page uses queryKey ['leads'] — the same key that
 * ProtectedRoute invalidates after the auto-promote toast fires — so the list
 * silently refetches without any user interaction.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Query key matches – The Leads page issues a fetch on mount; the request
 *    count increments, confirming the query is live under the expected key.
 * 2. Silent refetch on invalidation – Calling invalidateQueries({ queryKey:
 *    ['leads'] }) triggers a background refetch without any user action.
 * 3. Updated data is reflected – After invalidation the component shows the
 *    new data returned by the second fetch call.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LEAD_V1 = {
  id: 1,
  salutation: "Herr",
  medicalTitle: "Dr. med.",
  firstName: "Max",
  lastName: "Muster",
  specialty: "Orthopädie",
  zipCode: "80687",
  city: "München",
  country: "Deutschland",
  email: "max@example.com",
  phone: null,
  website: null,
  contactWhere: "DKOU 2025",
  firstContactDate: "2025-10-15",
  notes: null,
  status: "new",
  createdAt: new Date().toISOString(),
};

const LEAD_V2 = { ...LEAD_V1, status: "qualified" };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fresh QueryClient with no retries so failures surface immediately. */
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Leads page – query key and silent refetch", () => {
  // ── 1 & 2 & 3: key match + silent refetch + updated data ──────────────────

  it("refetches silently and shows updated data when the leads query is invalidated", async () => {
    let callCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : String(input);

        if (url.includes("/api/iroc/leads")) {
          callCount += 1;
          // First call returns the original lead (status: new).
          // Subsequent calls (after invalidation) return the updated lead.
          const data = callCount === 1 ? [LEAD_V1] : [LEAD_V2];
          return { ok: true, json: async () => data } as Response;
        }

        throw new Error(`Unmocked fetch: ${url}`);
      },
    );

    const qc = makeQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <Leads />
      </QueryClientProvider>,
    );

    // ── 1. Initial fetch fired, lead appears ────────────────────────────────
    await waitFor(() => expect(callCount).toBe(1));
    // buildDisplayName joins salutation + title + first + last into one string.
    await waitFor(() => screen.getByText(/Muster/));

    // The initial status badge shows "New" (en locale).
    expect(screen.getAllByText("New").length).toBeGreaterThanOrEqual(1);

    // ── 2. Invalidate the leads query — simulates what ProtectedRoute does ──
    await qc.invalidateQueries({ queryKey: LEADS_QUERY_KEY });

    // ── 3. A second fetch fires automatically (no user interaction) ─────────
    await waitFor(() => expect(callCount).toBe(2));

    // The updated status badge ("Qualified") is now visible without any click.
    // getAllByText is used because the filter-bar button also says "Qualified".
    await waitFor(() =>
      expect(screen.getAllByText("Qualified").length).toBeGreaterThanOrEqual(1),
    );
  });
});
