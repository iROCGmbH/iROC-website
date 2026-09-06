import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SpirecutSettings from "./SpirecutSettings";

const language = vi.hoisted(() => ({ lang: "en" as "en" | "de" }));
const adminGet = vi.hoisted(() => vi.fn());
const adminPost = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => language,
}));

vi.mock("@/hooks/use-site-urls", () => ({
  useSiteUrls: () => ({ spirecutUrl: "/spirecut-patient" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminGet,
  adminPost,
}));

afterEach(() => {
  language.lang = "en";
  adminGet.mockReset();
  adminPost.mockReset();
  adminPost.mockResolvedValue({ ok: true });
  vi.restoreAllMocks();
});

describe("SpirecutSettings patient gate", () => {
  it("saves a valid gate destination from the admin settings form", async () => {
    adminGet.mockResolvedValue({
      settings: {},
      repair: { legacyPracticalVideoTitlesRepaired: 0, legacyPracticalVideoTitlesAcknowledged: 0 },
    });
    const savedGateUrl = "  https://spirecut.com/medical-professionals  ";

    render(<SpirecutSettings />);

    const input = await screen.findByPlaceholderText("https://www.i-roc.de");
    fireEvent.change(input, { target: { value: savedGateUrl } });
    fireEvent.click(input.parentElement?.querySelector("button") as HTMLButtonElement);

    await waitFor(() => {
      expect(adminPost).toHaveBeenCalledWith(
        "/api/admin/spirecut-settings",
        "test-token",
        { key: "sp_gate_link_url", value: savedGateUrl.trim() },
      );
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});
