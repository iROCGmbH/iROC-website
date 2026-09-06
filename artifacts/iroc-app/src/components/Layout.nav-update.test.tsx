/**
 * Tests: sidebar reflects nav-config changes immediately after saveConfig
 *
 * The live-update contract:
 *   saveConfig (useNavConfig) calls queryClient.setQueryData after a
 *   successful PUT, so Layout (which reads the same query) re-renders with
 *   the new config without any page reload.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Rename a group → new label appears in the sidebar without remount.
 * 2. Old label is no longer present after the rename.
 * 3. Toggle a route invisible → route disappears from the sidebar without remount.
 * 4. A route that stays visible is still shown after the visibility toggle save.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./Layout";
import { NAV_CONFIG_QUERY_KEY } from "@/hooks/use-nav-config";
import type { NavConfig } from "@/lib/nav-config";

// ── Module mocks (hoisted) ────────────────────────────────────────────────────

vi.mock("@/assets/iroc-logo.png", () => ({ default: "iroc-logo.png" }));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetIrocMe:                    () => ({ data: { username: "admin" }, isError: false }),
  useListIrocNotifications:        () => ({ data: [] }),
  getGetIrocMeQueryKey:            () => ["iroc-me"],
  getListIrocNotificationsQueryKey: () => ["iroc-notifications"],
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token", logout: vi.fn() }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en", toggleLang: vi.fn() }),
}));

vi.mock("@/lib/i18n", () => ({
  t: (key: string) => key,
}));

// ── Fixture nav configs ───────────────────────────────────────────────────────

const INITIAL_CONFIG: NavConfig = [
  {
    id: "finance",
    labelDe: "Finanzen",
    labelEn: "Finance",
    icon: "DollarSign",
    items: [
      { slug: "/invoices", visible: true },
      { slug: "/reports",  visible: true },
    ],
  },
];

/** Same group, renamed EN label. */
const RENAMED_CONFIG: NavConfig = [
  {
    id: "finance",
    labelDe: "Buchhaltung",
    labelEn: "Accounting",
    icon: "DollarSign",
    items: [
      { slug: "/invoices", visible: true },
      { slug: "/reports",  visible: true },
    ],
  },
];

/** Same group, /reports hidden. */
const HIDDEN_ITEM_CONFIG: NavConfig = [
  {
    id: "finance",
    labelDe: "Finanzen",
    labelEn: "Finance",
    icon: "DollarSign",
    items: [
      { slug: "/invoices", visible: true },
      { slug: "/reports",  visible: false },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a fresh QueryClient with nav-config pre-seeded. */
function buildClient(config: NavConfig): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // Pre-seed so useNavConfig's useQuery returns this data synchronously
  // (staleTime is 10 min in the hook, so no refetch will be attempted).
  qc.setQueryData(NAV_CONFIG_QUERY_KEY, config);
  return qc;
}

function renderLayout(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <Layout>
        <div data-testid="page-content">Page</div>
      </Layout>
    </QueryClientProvider>,
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  // Open the "finance" group so its child items are visible in the sidebar.
  localStorage.setItem("iroc_nav_groups", JSON.stringify({ finance: true }));
  // Suppress fetch — all network hooks are mocked; any stray fetch is a bug.
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch should not be called in this test"));
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("iroc_nav_groups");
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Layout sidebar – live update after nav config save", () => {
  // Layout renders NavLinks twice: once for the desktop sidebar and once for
  // the mobile drawer.  Both are present in the jsdom DOM at all times
  // (the mobile drawer is hidden with CSS, not conditionally rendered).
  // We therefore use getAllBy* / queryAllBy* throughout.

  // ── 1. Group rename — new label appears ────────────────────────────────────

  it("shows the renamed group label immediately after setQueryData", async () => {
    const qc = buildClient(INITIAL_CONFIG);
    renderLayout(qc);

    // Both sidebars show "Finance" initially.
    expect(screen.getAllByText("Finance").length).toBeGreaterThanOrEqual(1);

    // Simulate what saveConfig does after a successful PUT.
    act(() => { qc.setQueryData(NAV_CONFIG_QUERY_KEY, RENAMED_CONFIG); });

    // The new label must appear in the sidebar without any page reload.
    await waitFor(() =>
      expect(screen.getAllByText("Accounting").length).toBeGreaterThanOrEqual(1),
    );
  });

  // ── 2. Group rename — old label is gone ───────────────────────────────────

  it("removes the old group label from the sidebar after the rename", async () => {
    const qc = buildClient(INITIAL_CONFIG);
    renderLayout(qc);

    act(() => { qc.setQueryData(NAV_CONFIG_QUERY_KEY, RENAMED_CONFIG); });

    // "Finance" must no longer appear anywhere in the sidebar.
    await waitFor(() =>
      expect(screen.queryAllByText("Finance")).toHaveLength(0),
    );
  });

  // ── 3. Route visibility toggle — hidden route disappears ──────────────────

  it("hides a route from the sidebar immediately after it is toggled invisible", async () => {
    const qc = buildClient(INITIAL_CONFIG);
    renderLayout(qc);
    fireEvent.click(screen.getAllByRole("button", { name: "Finance" })[0]);

    // With the group open both routes appear as links (×2 due to dual sidebar).
    expect(screen.getAllByRole("link", { name: /Invoices/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: /Reports/i }).length).toBeGreaterThanOrEqual(1);

    // Simulate saveConfig writing a config where /reports is hidden.
    act(() => { qc.setQueryData(NAV_CONFIG_QUERY_KEY, HIDDEN_ITEM_CONFIG); });

    // The Reports link must be completely absent from both sidebars.
    await waitFor(() =>
      expect(screen.queryAllByRole("link", { name: /Reports/i })).toHaveLength(0),
    );
  });

  // ── 4. Sibling route stays visible ────────────────────────────────────────

  it("keeps the still-visible route in the sidebar after a sibling is hidden", async () => {
    const qc = buildClient(INITIAL_CONFIG);
    renderLayout(qc);
    fireEvent.click(screen.getAllByRole("button", { name: "Finance" })[0]);

    act(() => { qc.setQueryData(NAV_CONFIG_QUERY_KEY, HIDDEN_ITEM_CONFIG); });

    // /invoices was NOT hidden — it must still appear in at least one sidebar.
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: /Invoices/i }).length).toBeGreaterThanOrEqual(1),
    );
  });

  // ── 5. Group disappears when all its routes are invisible ─────────────────

  it("removes a group from the sidebar when all its routes are hidden", async () => {
    const allHiddenConfig: NavConfig = [
      {
        id: "finance",
        labelDe: "Finanzen",
        labelEn: "Finance",
        icon: "DollarSign",
        items: [
          { slug: "/invoices", visible: false },
          { slug: "/reports",  visible: false },
        ],
      },
    ];

    const qc = buildClient(INITIAL_CONFIG);
    renderLayout(qc);

    // Group toggle buttons are present initially.
    expect(screen.getAllByText("Finance").length).toBeGreaterThanOrEqual(1);

    act(() => { qc.setQueryData(NAV_CONFIG_QUERY_KEY, allHiddenConfig); });

    // Layout skips groups with no visible items — the group header must vanish.
    await waitFor(() =>
      expect(screen.queryAllByText("Finance")).toHaveLength(0),
    );
  });
});
