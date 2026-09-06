/**
 * Tests: bell badge resets to zero after the admin reads all notifications
 *
 * What & Why
 * ──────────
 * The Notifications page calls markAllReadMutation and on success invalidates
 * the shared notifications query (getListIrocNotificationsQueryKey).  Layout.tsx
 * derives its bell-badge count from the same query:
 *
 *   unreadCount = notifications?.filter(n => !n.isRead).length || 0
 *
 * A regression here would leave the badge permanently non-zero even after the
 * admin has marked everything read.
 *
 * Covered scenarios
 * ─────────────────
 * 1. "Mark all read" button is enabled when unread notifications are present.
 * 2. Clicking "Mark all read" calls queryClient.invalidateQueries with the
 *    notifications query key (the mechanism that triggers the refetch).
 * 3. LIFECYCLE: renders Layout+Notifications together, clicks "Mark all read",
 *    simulates the server returning all-read data (no remount), and asserts
 *    the bell badge dot disappears from the already-mounted Layout header.
 * 4. The button is disabled when there are no unread notifications.
 * 5. LIFECYCLE: renders Layout with no notifications, advances the polling
 *    interval, and asserts a newly returned unread notification adds the badge
 *    without remounting the Layout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Notifications from "./Notifications";
import Layout from "@/components/Layout";
import type { NavConfig } from "@/lib/nav-config";

// ── Hoisted mutable refs ──────────────────────────────────────────────────────
// vi.hoisted runs before vi.mock, making these refs accessible inside the mock
// factory AND in test bodies — the standard Vitest pattern for reactive mocks.

type Notif = {
  id: number;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  productId: number | null;
};

const mocks = vi.hoisted(() => ({
  /** Current notification list returned by the mock hook. Mutate in tests. */
  notifications: { value: [] as Notif[] },
  /** Number of times the mocked notifications query has fetched. */
  fetchCount: { value: 0 },
  /** onSuccess callback captured from the component's mutation options. */
  onSuccess: { value: undefined as (() => void) | undefined },
  /** One-shot transient query failure used by the recovery regression. */
  failNext: { value: false },
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

// useListIrocNotifications uses real useQuery so that setQueryData / invalidate
// in tests trigger genuine re-renders — the only way to test the badge
// disappearing without remounting the tree.
vi.mock("@workspace/api-client-react", async () => {
  const { useQuery } = await import("@tanstack/react-query");

  return {
    useListIrocNotifications: (options: {
      query?: {
        enabled?: boolean;
        refetchInterval?: number;
        refetchIntervalInBackground?: boolean;
        refetchOnWindowFocus?: boolean | "always";
        queryKey?: readonly unknown[];
      };
    } = {}) =>
      useQuery({
        queryKey: ["iroc-notifications"],
        queryFn: () => {
          mocks.fetchCount.value += 1;
          if (mocks.failNext.value) {
            mocks.failNext.value = false;
            return Promise.reject(new Error("temporary notifications failure"));
          }
          return Promise.resolve(mocks.notifications.value);
        },
        // Never auto-stale so tests control every refetch explicitly.
        staleTime: Infinity,
        ...options.query,
      }),

    useGetIrocMe: () => ({ data: { username: "admin" }, isError: false }),

    useMarkIrocNotificationRead: () => ({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    }),

    useMarkAllIrocNotificationsRead: (
      opts: { mutation?: { onSuccess?: () => void } } = {},
    ) => {
      // Capture the callback so we can confirm it was wired up.
      mocks.onSuccess.value = opts.mutation?.onSuccess;
      return {
        // Simulate an immediate successful API response.
        mutate: (_: unknown) => {
          mocks.onSuccess.value?.();
        },
        isPending: false,
      };
    },

    getListIrocNotificationsQueryKey: () => ["iroc-notifications"],
    getGetIrocMeQueryKey: () => ["iroc-me"],
  };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token", logout: vi.fn() }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en", toggleLang: vi.fn() }),
}));

vi.mock("@/lib/i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("@/assets/iroc-logo.png", () => ({ default: "iroc-logo.png" }));

vi.mock("wouter", () => ({
  useLocation: () => ["/notifications", vi.fn()],
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const EMPTY_NAV: NavConfig = [];

vi.mock("@/hooks/use-nav-config", () => ({
  useNavConfig: () => ({ config: EMPTY_NAV }),
  NAV_CONFIG_QUERY_KEY: ["nav-config"],
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminDelete: vi.fn().mockResolvedValue({ ok: true }),
  adminPost: vi.fn().mockResolvedValue({ ok: true }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNotif(id: number, isRead: boolean): Notif {
  return {
    id,
    type: "low_stock",
    message: JSON.stringify({ de: "Lagermeldung", en: "Stock alert" }),
    isRead,
    createdAt: new Date().toISOString(),
    productId: null,
  };
}

const UNREAD_NOTIFICATIONS: Notif[] = [
  makeNotif(1, false),
  makeNotif(2, false),
  makeNotif(3, false),
];

const ALL_READ_NOTIFICATIONS: Notif[] = [
  makeNotif(1, true),
  makeNotif(2, true),
  makeNotif(3, true),
];

/** CSS selector for the bell-badge dot rendered by Layout.tsx. */
const BADGE_SELECTOR = ".bg-destructive.rounded-full";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderLayoutWithNotificationsPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <Layout>
        <Notifications />
      </Layout>
    </QueryClientProvider>,
  );
}

function renderNotificationsPage(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <Notifications />
    </QueryClientProvider>,
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  mocks.notifications.value = [...UNREAD_NOTIFICATIONS];
  mocks.fetchCount.value = 0;
  mocks.onSuccess.value = undefined;
  mocks.failNext.value = false;
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("fetch must not be called in these unit tests"),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Notifications bell badge — resets to zero after mark all read", () => {
  // ── 1. Button enabled when unread notifications exist ─────────────────────

  it("enables the Mark all read button when there are unread notifications", async () => {
    const qc = makeQueryClient();
    qc.setQueryData(["iroc-notifications"], UNREAD_NOTIFICATIONS);
    renderNotificationsPage(qc);

    const btn = await screen.findByRole("button", { name: /mark_all_read/i });
    expect(btn).not.toBeDisabled();
  });

  // ── 2. Clicking Mark all read invalidates the notifications query ──────────

  it("invalidates the notifications query with the correct key after Mark all read is clicked", async () => {
    const qc = makeQueryClient();
    qc.setQueryData(["iroc-notifications"], UNREAD_NOTIFICATIONS);

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderNotificationsPage(qc);

    const btn = await screen.findByRole("button", { name: /mark_all_read/i });
    await userEvent.click(btn);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["iroc-notifications"] }),
      );
    });
  });

  // ── 3. LIFECYCLE: badge disappears in the same mounted tree ───────────────
  //
  // This test renders Layout+Notifications together, clicks "Mark all read",
  // then simulates the server returning all-read data via setQueryData (which
  // is exactly what the post-invalidation refetch does in production).
  // The badge must disappear without unmounting or remounting the tree.

  it("removes the bell badge dot from the mounted Layout header after Mark all read and the query returns all-read data", async () => {
    const qc = makeQueryClient();
    // Seed the cache so the hook has unread data on the very first render.
    qc.setQueryData(["iroc-notifications"], UNREAD_NOTIFICATIONS);

    renderLayoutWithNotificationsPage(qc);

    // Badge dot must be visible initially (unreadCount > 0).
    await waitFor(() => {
      expect(document.querySelector(BADGE_SELECTOR)).not.toBeNull();
    });

    // Click "Mark all read" — the mock calls onSuccess immediately, which
    // calls invalidate() → queryClient.invalidateQueries in the component.
    const btn = screen.getByRole("button", { name: /mark_all_read/i });
    await userEvent.click(btn);

    // Simulate the server response: the refetch returns all notifications as
    // read.  setQueryData is the synchronous equivalent of a successful
    // network round-trip, triggering the useQuery subscriber in Layout.
    act(() => {
      mocks.notifications.value = [...ALL_READ_NOTIFICATIONS];
      qc.setQueryData(["iroc-notifications"], ALL_READ_NOTIFICATIONS);
    });

    // The badge dot must be gone — unreadCount is now 0 — without remount.
    await waitFor(() => {
      expect(document.querySelector(BADGE_SELECTOR)).toBeNull();
    });
  });

  // ── 4. Button disabled when all notifications are already read ────────────

  it("disables the Mark all read button when all notifications are already read", async () => {
    mocks.notifications.value = [...ALL_READ_NOTIFICATIONS];
    const qc = makeQueryClient();
    qc.setQueryData(["iroc-notifications"], ALL_READ_NOTIFICATIONS);
    renderNotificationsPage(qc);

    const btn = await screen.findByRole("button", { name: /mark_all_read/i });
    expect(btn).toBeDisabled();
  });

  // ── 5. LIFECYCLE: hidden polling pauses, visible tab catches up ───────────

  it("pauses hidden-tab polling and adds the badge after returning to the visible tab without remounting", async () => {
    vi.useFakeTimers();
    mocks.notifications.value = [];

    const qc = makeQueryClient();
    const { container } = renderLayoutWithNotificationsPage(qc);

    // Let the initial empty response settle. The header starts without a badge.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector(BADGE_SELECTOR)).toBeNull();
    expect(mocks.fetchCount.value).toBe(1);

    // The server now has a new unread notification. Only the polling request
    // should observe it once the tab is visible again; no cache update or
    // remount is performed by the test.
    mocks.notifications.value = [makeNotif(4, false)];

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Polling should not make requests while the document is hidden.
    expect(mocks.fetchCount.value).toBe(1);
    expect(container.querySelector(BADGE_SELECTOR)).toBeNull();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => {
      window.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.fetchCount.value).toBe(2);
    expect(container.querySelector(BADGE_SELECTOR)).not.toBeNull();
  });

  it("recovers from a transient poll failure and shows unread notifications without remounting Layout", async () => {
    mocks.notifications.value = [makeNotif(9, false)];
    mocks.failNext.value = true;
    const qc = makeQueryClient();
    const { container } = renderLayoutWithNotificationsPage(qc);

    await waitFor(() => expect(mocks.fetchCount.value).toBe(1));
    expect(container.querySelector(BADGE_SELECTOR)).toBeNull();

    await act(async () => {
      await qc.refetchQueries({ queryKey: ["iroc-notifications"] });
    });

    expect(mocks.fetchCount.value).toBe(2);
    await waitFor(() => {
      expect(container.querySelector(BADGE_SELECTOR)).not.toBeNull();
    });
  });
});
