import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Layout from "./Layout";
import { NAV_CONFIG_QUERY_KEY } from "@/hooks/use-nav-config";
import type { NavConfig } from "@/lib/nav-config";

vi.mock("@/assets/iroc-logo.png", () => ({ default: "iroc-logo.png" }));

// Keep a stateful location mock so clicking a Link exercises Layout's
// location-driven drawer close and active-link behavior.
vi.mock("wouter", async () => {
  const React = await import("react");
  let navigate: (href: string) => void = () => {};

  function useLocation() {
    const [location, setLocation] = React.useState("/");
    navigate = setLocation;
    return [location, setLocation] as const;
  }

  function Link({
    href,
    children,
    className,
    style,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
  }) {
    return (
      <a
        href={href}
        className={className}
        style={style}
        onClick={(event) => {
          event.preventDefault();
          navigate(href);
        }}
      >
        {children}
      </a>
    );
  }

  return { Link, useLocation };
});

vi.mock("@workspace/api-client-react", () => ({
  useGetIrocMe: () => ({ data: { username: "admin" }, isError: false }),
  useListIrocNotifications: () => ({ data: [] }),
  getGetIrocMeQueryKey: () => ["iroc-me"],
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

const NAV_CONFIG: NavConfig = [
  {
    id: "finance",
    labelDe: "Finanzen",
    labelEn: "Finance",
    icon: "DollarSign",
    items: [
      { slug: "/invoices", visible: true },
      { slug: "/expenses", visible: true },
      { slug: "/sales-summary", visible: true },
      { slug: "/reports", visible: true },
      { slug: "/datev-export", visible: true },
    ],
  },
];

function renderLayout() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  queryClient.setQueryData(NAV_CONFIG_QUERY_KEY, NAV_CONFIG);

  return render(
    <QueryClientProvider client={queryClient}>
      <Layout>
        <div>Page</div>
      </Layout>
    </QueryClientProvider>,
  );
}

function getMobileDrawer() {
  return screen.getAllByRole("complementary")[1];
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("fetch should not be called in this test"),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Reports navigation in the mobile drawer", () => {
  it("shows Reports in the drawer and closes it while navigating to /reports", async () => {
    const user = userEvent.setup();
    renderLayout();
    const drawer = getMobileDrawer();

    await user.click(screen.getByRole("button", { name: "open_menu" }));
    expect(drawer).toHaveClass("translate-x-0");

    // Reports is reachable in the Finance section before the drawer footer,
    // without requiring the user to scroll past the list's end.
    await user.click(within(drawer).getByRole("button", { name: "Finance" }));
    const reportsLinks = within(drawer).getAllByRole("link", { name: "Reports" });
    expect(reportsLinks).toHaveLength(1);
    expect(reportsLinks[0]).toBeVisible();
    expect(reportsLinks[0]).toHaveAttribute("href", "/reports");
    expect(reportsLinks[0].closest("nav")).toHaveClass("overflow-y-auto");

    await user.click(reportsLinks[0]);

    await waitFor(() => expect(drawer).toHaveClass("-translate-x-full"));
    expect(screen.getAllByRole("link", { name: "Reports" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Reports" }).every((link) =>
      link.className.includes("bg-primary") && link.className.includes("text-white"),
    )).toBe(true);
  });
});