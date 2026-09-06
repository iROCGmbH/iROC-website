import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { APP_ROUTES } from "@/config/routeConfig";
import Sally from "./Sally";

const routeState = vi.hoisted(() => ({
  tab: undefined as string | undefined,
  location: "/sally",
  setLocation: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => [routeState.location, routeState.setLocation],
  useParams: () => ({ tab: routeState.tab }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  adminPut: vi.fn(),
  adminDelete: vi.fn(),
}));

vi.mock("./SallyEmailQueue", () => ({
  default: () => <div data-testid="sally-email-queue">SallyEmailQueue surface</div>,
}));

import { adminGet, adminPost, adminPut, adminDelete } from "@/lib/admin-fetch";

function renderSally() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Sally />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  routeState.tab = undefined;
  routeState.location = "/sally";
  vi.clearAllMocks();
  vi.mocked(adminGet).mockResolvedValue([]);
  vi.mocked(adminPost).mockResolvedValue({});
  vi.mocked(adminPut).mockResolvedValue({});
  vi.mocked(adminDelete).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("Sally tab routing", () => {
  it("registers all supported Sally routes, including the dedicated email queue route", () => {
    const paths = APP_ROUTES.map(route => route.path);

    expect(paths).toEqual(expect.arrayContaining([
      "/sally",
      "/sally/:tab",
      "/sally/email-queue",
    ]));
    expect(paths.indexOf("/sally/email-queue")).toBeLessThan(paths.indexOf("/sally/:tab"));
  });

  it.each([
    ["leads", /No leads found/i],
    ["doctors", /No doctors found/i],
    ["email-queue", "sally-email-queue"],
    ["settings", /Automation controls/i],
  ] as const)("renders the %s tab for its supported route slug", async (tab, content) => {
    routeState.tab = tab;
    renderSally();

    if (typeof content === "string") {
      expect(await screen.findByTestId(content)).toBeInTheDocument();
    } else {
      expect(await screen.findByText(content)).toBeInTheDocument();
    }
  });

  it.each([undefined, "unknown-tab"])(
    "falls back to Leads for an absent or unsupported slug (%s)",
    async tab => {
      routeState.tab = tab;
      renderSally();

      expect(await screen.findByText("No leads found")).toBeInTheDocument();
    },
  );

  it("updates the URL when selecting tabs and renders the selected tab content", async () => {
    const user = userEvent.setup();
    renderSally();

    expect(await screen.findByText("No leads found")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Doctors" }));
    expect(routeState.setLocation).toHaveBeenCalledWith("/sally/doctors");
    expect(await screen.findByText("No doctors found")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Email Queue" }));
    expect(routeState.setLocation).toHaveBeenCalledWith("/sally/email-queue");
    expect(await screen.findByTestId("sally-email-queue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(routeState.setLocation).toHaveBeenCalledWith("/sally/settings");
    await waitFor(() => expect(screen.getByText("Automation controls")).toBeInTheDocument());
  });
});