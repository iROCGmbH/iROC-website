import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpirecutTestimonials from "./SpirecutTestimonials";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "de" }),
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  toast.mockClear();
});

describe("SpirecutTestimonials", () => {
  it("loads the bilingual empty state and opens a complete new-story form", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    render(<SpirecutTestimonials />);

    await waitFor(() => expect(screen.getByText("Keine Berichte vorhanden")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /bericht hinzufügen/i }));

    expect(screen.getByText("Neuer Erfahrungsbericht")).toBeInTheDocument();
    expect(screen.getByText("Titel (DE) *")).toBeInTheDocument();
    expect(screen.getByText("Title (EN) *")).toBeInTheDocument();
    expect(screen.getByText("Eingriff / Kategorie (DE)")).toBeInTheDocument();
    expect(screen.getByText("Procedure / Category (EN)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("https://www.youtube.com/watch?v=...")).toBeInTheDocument();
  });

  it("flags a non-YouTube URL before it can be saved", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);

    render(<SpirecutTestimonials />);
    await waitFor(() => expect(screen.getByText("Keine Berichte vorhanden")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /bericht hinzufügen/i }));
    await userEvent.type(screen.getByPlaceholderText("https://www.youtube.com/watch?v=..."), "https://example.com/video");

    expect(screen.getByText("Keine gültige YouTube-URL erkannt.")).toBeInTheDocument();
  });
});