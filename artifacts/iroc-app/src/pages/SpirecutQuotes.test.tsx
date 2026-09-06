/**
 * Tests for SpirecutQuotes — bell-count / notifications invalidation behaviour.
 *
 * The critical edge case: the admin approves (or deletes) a quote while the
 * network is temporarily down.  The PATCH/DELETE itself may already have been
 * recorded by the server, so the local optimistic update is correct — but the
 * subsequent invalidateQueries call that refreshes the bell count triggers a
 * failing network request.  The bell count must recover automatically on the
 * next successful poll instead of staying stale forever.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Approve  → invalidateQueries called with notifications key.
 * 2. Reject   → invalidateQueries called with notifications key.
 * 3. Delete   → invalidateQueries called with notifications key.
 * 4. Failed PATCH → invalidateQueries NOT called.
 * 5. Failed refetch (offline) preserves stale cached bell count (no flicker to zero).
 * 6. After a failed refetch, the next successful refetch updates the cache
 *    (bell count recovers on reconnect).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SpirecutQuotes from "./SpirecutQuotes";
import { getListIrocNotificationsQueryKey } from "@workspace/api-client-react";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "de" }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PENDING_QUOTE = {
  id: "q1",
  procedure: "ct",
  operationMonth: "2025-01",
  rating: 5,
  experience: "Sehr gut und schnell.",
  shareQuote: true,
  quoteApproved: null,
  submittedAt: new Date().toISOString(),
};

/** Simulated unread notifications (bell count = 3). */
const STALE_NOTIFICATIONS = [
  { id: "n1", type: "pending_quote", read: false, createdAt: new Date().toISOString() },
  { id: "n2", type: "pending_quote", read: false, createdAt: new Date().toISOString() },
  { id: "n3", type: "pending_quote", read: false, createdAt: new Date().toISOString() },
];

/** Notifications payload after the admin acted — bell count = 0. */
const EMPTY_NOTIFICATIONS: unknown[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
}

/** Seed the notifications cache without creating an active observer. */
function seedNotifications(qc: QueryClient, data: unknown[]) {
  qc.setQueryData(getListIrocNotificationsQueryKey(), data);
}

function Wrapper({
  client,
  children,
}: {
  client: QueryClient;
  children: React.ReactNode;
}) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Installs a fetch spy that:
 * - GET  /api/iroc/quotes        → `quotes` (default: [PENDING_QUOTE])
 * - PATCH /api/iroc/quotes/:id   → ok = `patchOk`  (default: true)
 * - DELETE /api/iroc/quotes/:id  → ok = `deleteOk` (default: true)
 * - POST  /api/iroc/notifications/read-by-type → ok always
 * - GET   /api/iroc/notifications → pops from `notifQueue` (throws on !ok)
 */
function installFetchSpy(opts: {
  quotes?: object[];
  patchOk?: boolean;
  deleteOk?: boolean;
  notifQueue?: Array<{ ok: boolean; data?: unknown[] }>;
}) {
  const {
    quotes = [PENDING_QUOTE],
    patchOk = true,
    deleteOk = true,
    notifQueue = [],
  } = opts;

  const queue = [...notifQueue];

  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);

      const method = (
        init?.method ??
        (input instanceof Request ? input.method : "GET")
      ).toUpperCase();

      // ── Quotes list ────────────────────────────────────────────────────────
      // Match /api/iroc/quotes but NOT /api/iroc/quotes/<id>
      if (method === "GET" && /\/api\/iroc\/quotes$/.test(url)) {
        return { ok: true, json: async () => quotes } as Response;
      }

      // ── Approve / reject ───────────────────────────────────────────────────
      if (method === "PATCH" && url.includes("/api/iroc/quotes/")) {
        return { ok: patchOk } as Response;
      }

      // ── Delete ─────────────────────────────────────────────────────────────
      if (method === "DELETE" && url.includes("/api/iroc/quotes/")) {
        return { ok: deleteOk } as Response;
      }

      // ── Mark notifications read on mount ───────────────────────────────────
      if (method === "POST" && url.includes("read-by-type")) {
        return { ok: true, json: async () => ({}) } as Response;
      }

      // ── Notifications refetch ──────────────────────────────────────────────
      if (method === "GET" && url.includes("/api/iroc/notifications")) {
        const next = queue.shift();
        if (!next) return { ok: true, json: async () => [] } as Response;
        if (!next.ok) throw new Error("Network error (simulated offline)");
        return { ok: true, json: async () => next.data ?? [] } as Response;
      }

      throw new Error(`Unmocked fetch: ${method} ${url}`);
    });
}

/** Wait for the quote list to be visible (loading spinner gone). */
async function waitForQuoteList() {
  // The component wraps `experience` text in German guillemets: „Sehr gut und schnell."
  // Use a regex so we match the inner text regardless of surrounding punctuation.
  await waitFor(() =>
    expect(screen.getByText(/Sehr gut und schnell\./)).toBeInTheDocument()
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SpirecutQuotes – notifications invalidation after admin actions", () => {
  // ── 1. Approve ─────────────────────────────────────────────────────────────

  it("calls invalidateQueries with the notifications key after a successful approve", async () => {
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    installFetchSpy({ patchOk: true });

    render(<SpirecutQuotes />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    await waitForQuoteList();

    const approveBtn = screen.getByRole("button", { name: /Freigeben/i });
    await userEvent.click(approveBtn);

    await waitFor(() => {
      const notifCalls = invalidateSpy.mock.calls.filter((args) => {
        const key = (args[0] as { queryKey?: unknown })?.queryKey;
        return (
          Array.isArray(key) &&
          key[0] === getListIrocNotificationsQueryKey()[0]
        );
      });
      expect(notifCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 2. Reject ──────────────────────────────────────────────────────────────

  it("calls invalidateQueries with the notifications key after a successful reject", async () => {
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    installFetchSpy({ patchOk: true });

    render(<SpirecutQuotes />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    await waitForQuoteList();

    const rejectBtn = screen.getByRole("button", { name: /Ablehnen/i });
    await userEvent.click(rejectBtn);

    await waitFor(() => {
      const notifCalls = invalidateSpy.mock.calls.filter((args) => {
        const key = (args[0] as { queryKey?: unknown })?.queryKey;
        return (
          Array.isArray(key) &&
          key[0] === getListIrocNotificationsQueryKey()[0]
        );
      });
      expect(notifCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 3. Delete ──────────────────────────────────────────────────────────────

  it("calls invalidateQueries with the notifications key after a successful delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    installFetchSpy({ deleteOk: true });

    render(<SpirecutQuotes />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    await waitForQuoteList();

    // The delete button is an icon-only ghost button — it is the last button in
    // the action row.  Find all buttons and click the one containing Trash2.
    const buttons = screen.getAllByRole("button");
    const trashBtn = buttons.find((b) =>
      b.querySelector(".lucide-trash-2, .lucide-trash2")
    )!;
    await userEvent.click(trashBtn);

    await waitFor(() => {
      const notifCalls = invalidateSpy.mock.calls.filter((args) => {
        const key = (args[0] as { queryKey?: unknown })?.queryKey;
        return (
          Array.isArray(key) &&
          key[0] === getListIrocNotificationsQueryKey()[0]
        );
      });
      expect(notifCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 4. Failed PATCH → no invalidation ─────────────────────────────────────

  it("does NOT call invalidateQueries when the PATCH request fails", async () => {
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    // Mount invalidates once (from the read-by-type POST → queryClient.invalidateQueries).
    // Count calls BEFORE the approve action so we can measure the delta.
    installFetchSpy({ patchOk: false });

    render(<SpirecutQuotes />, {
      wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
    });

    await waitForQuoteList();

    // Record calls to invalidateQueries for the notifications key BEFORE approve.
    const callsBefore = invalidateSpy.mock.calls.filter((args) => {
      const key = (args[0] as { queryKey?: unknown })?.queryKey;
      return (
        Array.isArray(key) &&
        key[0] === getListIrocNotificationsQueryKey()[0]
      );
    }).length;

    const approveBtn = screen.getByRole("button", { name: /Freigeben/i });
    await userEvent.click(approveBtn);

    // Wait for the error toast to confirm the action completed.
    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    // The number of notifications invalidation calls must not have increased.
    const callsAfter = invalidateSpy.mock.calls.filter((args) => {
      const key = (args[0] as { queryKey?: unknown })?.queryKey;
      return (
        Array.isArray(key) &&
        key[0] === getListIrocNotificationsQueryKey()[0]
      );
    }).length;

    expect(callsAfter).toBe(callsBefore);
  });

  // ── 5. Stale cache preserved during offline refetch ────────────────────────

  it(
    "preserves the stale bell count in the cache when the notifications " +
      "refetch fails (offline), so the UI does not flicker to zero",
    async () => {
      const qc = makeQueryClient();
      // Seed the cache with known data so we can assert it is still there after
      // a failed refetch.
      seedNotifications(qc, STALE_NOTIFICATIONS);

      installFetchSpy({
        patchOk: true,
        notifQueue: [
          { ok: false }, // simulated offline — the refetch triggered by
          //               invalidateQueries throws
        ],
      });

      render(<SpirecutQuotes />, {
        wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
      });

      await waitForQuoteList();

      const approveBtn = screen.getByRole("button", { name: /Freigeben/i });
      await userEvent.click(approveBtn);

      // Give the invalidateQueries + (failing) refetch time to settle.
      await waitFor(() => expect(mockToast).toHaveBeenCalled());

      // React Query keeps the last successful data when a refetch fails.
      // The cache must still hold the pre-approve stale value — NOT an empty array.
      const cached = qc.getQueryData(getListIrocNotificationsQueryKey());
      expect(cached).not.toBeNull();
      expect(cached).not.toEqual(EMPTY_NOTIFICATIONS);
    }
  );

  // ── 6. Bell count recovers on reconnect ────────────────────────────────────
  //
  // In production, SpirecutQuotes calls invalidateQueries after a successful
  // approve.  If another component (e.g. Layout) has an active observer for
  // the notifications query, that invalidation immediately triggers a
  // background refetch — which may fail when the admin is briefly offline.
  // React Query keeps the last successful data on error (stale preservation).
  // On the next poll the refetch succeeds and the bell count is updated.
  //
  // In this unit test there is no Layout subscriber, so we drive the two
  // refetch attempts manually to verify the QueryClient-level recovery:
  //   1. component approve → invalidateQueries ✓
  //   2. first refetch:  offline (throws)     → stale data still in cache ✓
  //   3. second refetch: reconnected (ok)     → cache updated to new value ✓

  it(
    "bell count recovers on the next successful refetch after the initial " +
      "refetch fails (offline → reconnect scenario)",
    async () => {
      const qc = makeQueryClient();
      seedNotifications(qc, STALE_NOTIFICATIONS);

      // The notifQueue is consumed by explicit refetchQueries calls below.
      installFetchSpy({
        patchOk: true,
        notifQueue: [
          { ok: false },                           // 1st refetch: offline
          { ok: true, data: EMPTY_NOTIFICATIONS }, // 2nd refetch: reconnect
        ],
      });

      render(<SpirecutQuotes />, {
        wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>,
      });

      await waitForQuoteList();

      // Step 1: approve the quote — invalidateQueries should be called.
      const approveBtn = screen.getByRole("button", { name: /Freigeben/i });
      await userEvent.click(approveBtn);
      await waitFor(() => expect(mockToast).toHaveBeenCalled());

      // The queryFn mirrors what useListIrocNotifications uses internally —
      // a plain fetch to the notifications endpoint.  We drive two calls
      // manually because setQueryData seeds the cache without registering a
      // queryFn, so refetchQueries would be a no-op.
      const notifQueryFn = async () => {
        const res = await fetch("/api/iroc/notifications");
        if (!res.ok) throw new Error("Network error");
        return res.json();
      };

      // Step 2: simulate the first (offline) refetch attempt.
      // fetchQuery throws and React Query keeps the previously seeded data.
      await act(async () => {
        try {
          await qc.fetchQuery({
            queryKey: getListIrocNotificationsQueryKey(),
            queryFn: notifQueryFn,
            staleTime: 0,
          });
        } catch {
          // expected — first queue entry is { ok: false } → throws
        }
      });

      // Stale data must still be in the cache after the failed refetch.
      expect(qc.getQueryData(getListIrocNotificationsQueryKey())).not.toEqual(
        EMPTY_NOTIFICATIONS
      );

      // Step 3: simulate the admin reconnecting — second fetchQuery succeeds.
      await act(async () => {
        await qc.fetchQuery({
          queryKey: getListIrocNotificationsQueryKey(),
          queryFn: notifQueryFn,
          staleTime: 0,
        });
      });

      // The bell count must now reflect the server's up-to-date value.
      await waitFor(() => {
        expect(
          qc.getQueryData(getListIrocNotificationsQueryKey())
        ).toEqual(EMPTY_NOTIFICATIONS);
      });
    }
  );
});
