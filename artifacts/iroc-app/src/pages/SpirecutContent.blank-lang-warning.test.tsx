/**
 * SpirecutContent — blank-language validation and recovery tests.
 *
 * A failed partial edit must stay local to the dirty state: the admin can
 * refill the cleared translation and save without refreshing the page.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpirecutContent from "./SpirecutContent";

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

vi.mock("@/hooks/use-site-urls", () => ({
  useSiteUrls: () => ({ spirecutUrl: "https://spirecut.example.com", irocUrl: null }),
}));

const ENTRY_AT_SEED = {
  "spirecut.home.hero_title": {
    key: "spirecut.home.hero_title",
    page: "home",
    label: "Hero Title",
    de: "Ihre Hand. Ihre Gesundheit.",
    en: "Your Hand. Your Health.",
    seedDe: "Ihre Hand. Ihre Gesundheit.",
    seedEn: "Your Hand. Your Health.",
  },
};

function installFetchSpy() {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });

      if (url.includes("/api/content/spirecut") && method === "GET") {
        return { ok: true, json: async () => ENTRY_AT_SEED } as Response;
      }
      if (url.includes("/api/admin/content") && method === "POST") {
        return { ok: true, json: async () => ({ ok: true, updated: 1 }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }
  );
  return calls;
}

function getSaveButton() {
  return screen.getByRole("button", { name: /save.*change/i }) as HTMLButtonElement;
}

function getHeaderSaveButton() {
  return screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
}

async function renderEditor() {
  const view = render(<SpirecutContent />);
  await waitFor(() => screen.getByText("Hero Title"));
  return view;
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});

describe("SpirecutContent — blank language validation", () => {
  it.each([
    ["DE", "Ihre Hand. Ihre Gesundheit.", /restore the default DE text/i],
    ["EN", "Your Hand. Your Health.", /restore the default EN text/i],
  ])("marks a cleared %s field and keeps save enabled", async (_language, value, message) => {
    installFetchSpy();
    await renderEditor();

    const input = screen.getByDisplayValue(value);
    fireEvent.change(input, { target: { value: "" } });

    await waitFor(() => {
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(input).toHaveClass("border-amber-400");
      expect(getSaveButton()).toBeEnabled();
    });
  });

  it("keeps a cleared field recoverable after cancelling the compact header warning", async () => {
    const user = userEvent.setup();
    const fetchCalls = installFetchSpy();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderEditor();

    const input = screen.getByDisplayValue("Ihre Hand. Ihre Gesundheit.");
    fireEvent.change(input, { target: { value: "" } });
    await user.click(getHeaderSaveButton());

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringMatching(/restore the default text for that language/i)
    );
    expect(input).toHaveValue("");
    expect(screen.getByText(/leaving this blank will restore the default DE text/i)).toBeInTheDocument();
    expect(fetchCalls.filter((call) => call.method === "POST")).toHaveLength(0);

    fireEvent.change(input, { target: { value: "Wiederhergestellte Überschrift" } });
    expect(screen.queryByText(/leaving this blank will restore the default DE text/i)).not.toBeInTheDocument();
    await user.click(getSaveButton());

    await waitFor(() => {
      expect(fetchCalls.filter((call) => call.method === "POST")).toHaveLength(1);
      expect(fetchCalls.find((call) => call.method === "POST")?.body).toEqual({
        updates: [
          {
            key: "spirecut.home.hero_title",
            de: "Wiederhergestellte Überschrift",
            en: "Your Hand. Your Health.",
          },
        ],
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/saved/i) })
      );
    });
  });

  it.each([
    ["DE", "Ihre Hand. Ihre Gesundheit.", "Your Hand. Your Health."],
    ["EN", "Your Hand. Your Health.", "Ihre Hand. Ihre Gesundheit."],
  ])("persists a confirmed blank %s translation without reloading", async (
    language,
    clearedValue,
    untouchedValue,
  ) => {
    const user = userEvent.setup();
    const fetchCalls = installFetchSpy();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderEditor();

    const clearedInput = screen.getByDisplayValue(clearedValue);
    fireEvent.change(clearedInput, { target: { value: "" } });
    await user.click(getHeaderSaveButton());

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/continue saving/i));
      expect(fetchCalls.filter((call) => call.method === "POST")).toHaveLength(1);
      expect(fetchCalls.find((call) => call.method === "POST")?.body).toEqual({
        updates: [
          {
            key: "spirecut.home.hero_title",
            de: language === "DE" ? "" : untouchedValue,
            en: language === "EN" ? "" : untouchedValue,
          },
        ],
      });
      expect(clearedInput).toHaveValue("");
      expect(screen.getByDisplayValue(untouchedValue)).toBeInTheDocument();
      expect(screen.queryByText(/leaving this blank will restore the default (DE|EN) text/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/1 unsaved/i)).not.toBeInTheDocument();
      expect(fetchCalls.filter((call) => call.method === "GET")).toHaveLength(1);
    });
  });

  it("refills EN and saves without a page refresh", async () => {
    const user = userEvent.setup();
    const fetchCalls = installFetchSpy();
    await renderEditor();

    const enInput = screen.getByDisplayValue("Your Hand. Your Health.");
    fireEvent.change(enInput, { target: { value: "" } });
    fireEvent.change(enInput, { target: { value: "Updated English heading" } });
    await waitFor(() => expect(getSaveButton()).toBeEnabled());
    await user.click(getSaveButton());

    await waitFor(() => {
      expect(fetchCalls.filter((call) => call.method === "POST")).toHaveLength(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/saved/i) })
      );
    });
  });

  it("refills DE and saves without a page refresh", async () => {
    const user = userEvent.setup();
    const fetchCalls = installFetchSpy();
    await renderEditor();

    const deInput = screen.getByDisplayValue("Ihre Hand. Ihre Gesundheit.");
    fireEvent.change(deInput, { target: { value: "" } });
    fireEvent.change(deInput, { target: { value: "Aktualisierte Überschrift" } });
    await waitFor(() => expect(getSaveButton()).toBeEnabled());
    await user.click(getSaveButton());

    await waitFor(() => {
      expect(fetchCalls.filter((call) => call.method === "POST")).toHaveLength(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/saved/i) })
      );
    });
  });

  it.each([
    ["DE", "Ihre Hand. Ihre Gesundheit."],
    ["EN", "Your Hand. Your Health."],
  ])("does not persist a cleared %s field across reload", async (_language, value) => {
    const fetchCalls = installFetchSpy();
    const view = await renderEditor();

    fireEvent.change(screen.getByDisplayValue(value), { target: { value: "" } });
    expect(fetchCalls.filter((call) => call.method === "POST")).toHaveLength(0);

    view.unmount();
    await renderEditor();

    expect(screen.getByDisplayValue(value)).toBeInTheDocument();
    expect(fetchCalls.filter((call) => call.method === "GET")).toHaveLength(2);
  });
});