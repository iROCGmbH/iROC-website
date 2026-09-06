/**
 * IrocWebsiteContent — blank-language validation and recovery tests.
 *
 * A failed partial edit must stay local to the dirty state: the admin can
 * refill the cleared translation and save without refreshing the page.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IrocWebsiteContent from "./IrocWebsiteContent";

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
  useSiteUrls: () => ({ irocUrl: "https://example.com", spirecutUrl: null }),
}));

const ENTRY_AT_SEED = {
  "iroc.home.hero_title": {
    key: "iroc.home.hero_title",
    page: "home",
    label: "Hero Title",
    de: "Willkommen bei iROC",
    en: "Welcome to iROC",
    seedDe: "Willkommen bei iROC",
    seedEn: "Welcome to iROC",
  },
  "iroc.impressum.intro": {
    key: "iroc.impressum.intro",
    page: "impressum",
    label: "Impressum intro",
    de: "Impressum Einführung",
    en: "Impressum introduction",
    seedDe: "Impressum Einführung",
    seedEn: "Impressum introduction",
  },
  "iroc.agb.title": {
    key: "iroc.agb.title",
    page: "agb",
    label: "AGB title",
    de: "Allgemeine Verkaufsbedingungen",
    en: "General Terms and Conditions",
    seedDe: "Allgemeine Verkaufsbedingungen",
    seedEn: "General Terms and Conditions",
  },
};

function installFetchSpy() {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  let serverContent: Record<
    string,
    (typeof ENTRY_AT_SEED)[keyof typeof ENTRY_AT_SEED]
  > = { ...ENTRY_AT_SEED };
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

      if (url.includes("/api/content/iroc") && method === "GET") {
        return { ok: true, json: async () => serverContent } as Response;
      }
      if (url.includes("/api/admin/content/new-entry") && method === "POST") {
        const page = (body as { page: string }).page;
        const key = `iroc.${page}.custom_p_persisted`;
        const newEntry = {
          key,
          page,
          label: (body as { label: string }).label,
          de: (body as { de: string }).de,
          en: (body as { en: string }).en,
          seedDe: (body as { de: string }).de,
          seedEn: (body as { en: string }).en,
        };
        serverContent = { ...serverContent, [key]: newEntry };
        return {
          ok: true,
          json: async () => ({ key, de: newEntry.de, en: newEntry.en }),
        } as Response;
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
  const view = render(<IrocWebsiteContent />);
  await waitFor(() => screen.getByText("Hero Title"));
  return view;
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});

describe("IrocWebsiteContent — blank language validation", () => {
  it.each([
    ["DE", "Willkommen bei iROC", /restore the default DE text/i],
    ["EN", "Welcome to iROC", /restore the default EN text/i],
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

    const input = screen.getByDisplayValue("Willkommen bei iROC");
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
            key: "iroc.home.hero_title",
            de: "Wiederhergestellte Überschrift",
            en: "Welcome to iROC",
          },
        ],
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/saved/i) })
      );
    });
  });

  it.each([
    ["DE", "Willkommen bei iROC", "Welcome to iROC"],
    ["EN", "Welcome to iROC", "Willkommen bei iROC"],
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
            key: "iroc.home.hero_title",
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

  it("does not warn about a blank add-section draft when saving an existing entry", async () => {
    const user = userEvent.setup();
    const fetchCalls = installFetchSpy();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    await renderEditor();
    await user.click(screen.getByRole("button", { name: /Impressum/ }));

    fireEvent.change(screen.getByDisplayValue("Impressum introduction"), {
      target: { value: "Updated Impressum introduction" },
    });
    await user.click(screen.getByRole("button", { name: /^Add section$/i }));

    expect(screen.getByPlaceholderText("Enter German text…")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter English text…")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save 1 change/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(fetchCalls.filter((call) => call.method === "POST")).toHaveLength(1);
    });
  });

  it("keeps the AGB blank add-section draft out of the existing-entry save warning", async () => {
    const user = userEvent.setup();
    const fetchCalls = installFetchSpy();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    await renderEditor();
    await user.click(screen.getByRole("button", { name: /AGB/ }));

    fireEvent.change(screen.getByDisplayValue("General Terms and Conditions"), {
      target: { value: "Updated General Terms and Conditions" },
    });
    await user.click(screen.getByRole("button", { name: /^Add section$/i }));

    expect(screen.getByPlaceholderText("Enter German text…")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter English text…")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save 1 change/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(fetchCalls.find((call) => call.method === "POST")?.body).toEqual({
        updates: [
          {
            key: "iroc.agb.title",
            de: "Allgemeine Verkaufsbedingungen",
            en: "Updated General Terms and Conditions",
          },
        ],
      });
    });
  });

  it("persists a newly added AGB section after the editor reloads", async () => {
    const user = userEvent.setup();
    const fetchCalls = installFetchSpy();
    const view = await renderEditor();

    await user.click(screen.getByRole("button", { name: /AGB/ }));
    await user.click(screen.getByRole("button", { name: /^Add section$/i }));
    fireEvent.change(screen.getByPlaceholderText("Enter German text…"), {
      target: { value: "Neue AGB-Klausel" },
    });
    fireEvent.change(screen.getByPlaceholderText("Enter English text…"), {
      target: { value: "New terms clause" },
    });
    await user.click(screen.getByRole("button", { name: /^Add section$/i }));

    await waitFor(() => {
      expect(fetchCalls.find((call) => call.url.includes("/new-entry"))?.body).toEqual({
        site: "iroc",
        page: "agb",
        type: "paragraph",
        label: "Neue AGB-Klausel",
        de: "Neue AGB-Klausel",
        en: "New terms clause",
      });
      expect(screen.getByDisplayValue("Neue AGB-Klausel")).toBeInTheDocument();
      expect(screen.getByDisplayValue("New terms clause")).toBeInTheDocument();
    });

    view.unmount();
    await renderEditor();
    await user.click(screen.getByRole("button", { name: /AGB/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Neue AGB-Klausel")).toBeInTheDocument();
      expect(screen.getByDisplayValue("New terms clause")).toBeInTheDocument();
      expect(fetchCalls.filter((call) => call.method === "GET")).toHaveLength(2);
    });
  });

  it("persists a newly added Impressum section after the editor reloads", async () => {
    const user = userEvent.setup();
    const fetchCalls = installFetchSpy();
    const view = await renderEditor();

    await user.click(screen.getByRole("button", { name: /Impressum/ }));
    await user.click(screen.getByRole("button", { name: /^Add section$/i }));
    fireEvent.change(screen.getByPlaceholderText("Enter German text…"), {
      target: { value: "Neue Impressum-Angabe" },
    });
    fireEvent.change(screen.getByPlaceholderText("Enter English text…"), {
      target: { value: "New legal notice detail" },
    });
    await user.click(screen.getByRole("button", { name: /^Add section$/i }));

    await waitFor(() => {
      expect(fetchCalls.find((call) => call.url.includes("/new-entry"))?.body).toEqual({
        site: "iroc",
        page: "impressum",
        type: "paragraph",
        label: "Neue Impressum-Angabe",
        de: "Neue Impressum-Angabe",
        en: "New legal notice detail",
      });
      expect(screen.getByDisplayValue("Neue Impressum-Angabe")).toBeInTheDocument();
      expect(screen.getByDisplayValue("New legal notice detail")).toBeInTheDocument();
    });

    view.unmount();
    await renderEditor();
    await user.click(screen.getByRole("button", { name: /Impressum/ }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Neue Impressum-Angabe")).toBeInTheDocument();
      expect(screen.getByDisplayValue("New legal notice detail")).toBeInTheDocument();
      expect(fetchCalls.filter((call) => call.method === "GET")).toHaveLength(2);
    });
  });

  it("refills EN and saves without a page refresh", async () => {
    const user = userEvent.setup();
    const fetchCalls = installFetchSpy();
    await renderEditor();

    const enInput = screen.getByDisplayValue("Welcome to iROC");
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

    const deInput = screen.getByDisplayValue("Willkommen bei iROC");
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
    ["DE", "Willkommen bei iROC"],
    ["EN", "Welcome to iROC"],
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