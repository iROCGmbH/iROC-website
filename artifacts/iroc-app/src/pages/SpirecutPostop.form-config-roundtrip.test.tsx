import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PostopFormConfig } from "@workspace/spirecut-shared";
import { getDefaultPostopFormConfig } from "@workspace/spirecut-shared";
import SpirecutPostop from "./SpirecutPostop";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const mockLanguage = vi.hoisted(() => ({ current: "de" as "de" | "en" }));
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: mockLanguage.current }),
}));

vi.mock("@/hooks/use-site-urls", () => ({
  useSiteUrls: () => ({ spirecutUrl: "https://spirecut.example.com" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function TestHarness({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SpirecutPostop />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  mockLanguage.current = "de";
});

describe("SpirecutPostop – postoperative form config round trip", () => {
  it("shows saved German and English procedure labels in submissions without a reload", async () => {
    const user = userEvent.setup();
    const initialConfig = getDefaultPostopFormConfig();
    let persistedConfig: PostopFormConfig = initialConfig;
    let putBody: unknown;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

      if (url.includes("/api/iroc/postop-form-config")) {
        if (method === "PUT") {
          putBody = JSON.parse(String(init?.body));
          persistedConfig = putBody as PostopFormConfig;
          return {
            ok: true,
            json: async () => persistedConfig,
          } as Response;
        }

        return {
          ok: true,
          json: async () => persistedConfig,
        } as Response;
      }

      if (method === "GET" && url.includes("/api/admin/patient-postop-diagnostics")) {
        return {
          ok: true,
          json: async () => ({
            submissions: [{
              id: "submission-1",
              procedure: "ct",
              operationMonth: "2025-01",
              rating: 5,
              submittedAt: "2025-01-15T10:00:00.000Z",
            }],
            unreadableCount: 0,
          }),
        } as Response;
      }

      if (method === "GET" && url.includes("/api/patient-postop-stats")) {
        return {
          ok: true,
          json: async () => ({ skippedInvalid: 0 }),
        } as Response;
      }

      throw new Error(`Unmocked fetch: ${method} ${url}`);
    });

    const queryClient = makeQueryClient();
    const { rerender } = render(<TestHarness queryClient={queryClient} />);

    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    await user.click(screen.getByRole("button", { name: "Formular" }));
    await screen.findByText("Eingriffe");

    const germanLabel = screen.getAllByTitle("Label (Deutsch)")[0];
    const englishLabel = screen.getAllByTitle("Label (English)")[0];
    await user.clear(germanLabel);
    await user.type(germanLabel, "Neues Karpaltunnel-Verfahren");
    await user.clear(englishLabel);
    await user.type(englishLabel, "New Carpal Tunnel Procedure");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => {
      expect(putBody).toEqual(expect.objectContaining({
        procedures: expect.arrayContaining([
          expect.objectContaining({
            key: "ct",
            labelDe: "Neues Karpaltunnel-Verfahren",
            labelEn: "New Carpal Tunnel Procedure",
          }),
        ]),
      }));
    });

    await user.click(screen.getByRole("button", { name: "Einsendungen" }));
    expect(screen.getByRole("button", { name: "Neues Karpaltunnel-Verfahren" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Neues Karpaltunnel-Verfahren");

    mockLanguage.current = "en";
    rerender(<TestHarness queryClient={queryClient} />);

    expect(screen.getByRole("button", { name: "New Carpal Tunnel Procedure" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("New Carpal Tunnel Procedure");
  });
});