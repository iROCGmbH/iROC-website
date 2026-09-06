import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpirecutMedia from "./SpirecutMedia";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const languageState = vi.hoisted(() => ({ lang: "en" }));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => languageState,
}));

vi.mock("@/hooks/use-site-urls", () => ({
  useSiteUrls: () => ({ spirecutUrl: "https://spirecut.example.test" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const splitCards = [
  {
    key: "instrument-ct-top",
    en: "Patient Information – Carpal Tunnel – Instrument",
    de: "Patienteninformation – Karpaltunnel – Instrument",
  },
  {
    key: "instrument-tf-top",
    en: "Patient Information – Trigger Finger – Instrument",
    de: "Patienteninformation – Schnappfinger – Instrument",
  },
  {
    key: "instrument-ct-condition",
    en: "Conditions Treated – Carpal Tunnel – Instrument",
    de: "Behandelte Beschwerden – Karpaltunnel – Instrument",
  },
  {
    key: "instrument-tf-condition",
    en: "Conditions Treated – Trigger Finger – Instrument",
    de: "Behandelte Beschwerden – Schnappfinger – Instrument",
  },
] as const;

function cardFor(label: string) {
  return screen
    .getByText(label)
    .closest(".bg-card") as HTMLElement;
}

afterEach(() => {
  languageState.lang = "en";
  vi.restoreAllMocks();
});

describe("iROC Spirecut media split cards", () => {
  it("keeps the four bilingual split placement cards", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    const { rerender } = render(<SpirecutMedia />);

    await waitFor(() => {
      for (const card of splitCards) {
        expect(screen.getByText(card.en)).toBeInTheDocument();
      }
    });

    languageState.lang = "de";
    rerender(<SpirecutMedia />);
    for (const card of splitCards) {
      expect(screen.getByText(card.de)).toBeInTheDocument();
    }
  });

  it("sends hide mutations with the matching split key for every card", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    const user = userEvent.setup();

    render(<SpirecutMedia />);
    await waitFor(() =>
      expect(screen.getByText(splitCards[0].en)).toBeInTheDocument(),
    );

    for (const card of splitCards) {
      await user.click(
        within(cardFor(card.en)).getByRole("button", { name: "Hide" }),
      );

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/patient-media",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            key: card.key,
            url: "__hidden__",
          }),
        }),
      );
    }
  });
});