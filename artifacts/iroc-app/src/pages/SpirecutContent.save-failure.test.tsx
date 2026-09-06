/**
 * SpirecutContent — failed-save recovery regression test.
 *
 * A failed save must not discard the local edit. The request is deferred here
 * so the test also observes the button's in-flight disabled state.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { render, screen, waitFor } from "@testing-library/react";
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
  "spirecut.home.hero_subtitle": {
    key: "spirecut.home.hero_subtitle",
    page: "home",
    label: "Hero Subtitle",
    de: "Innovative Handchirurgie",
    en: "Innovative hand surgery",
    seedDe: "Innovative Handchirurgie",
    seedEn: "Innovative hand surgery",
  },
  "spirecut.faq.title": {
    key: "spirecut.faq.title",
    page: "faq",
    label: "FAQ Title",
    de: "Häufige Fragen",
    en: "Frequently asked questions",
    seedDe: "Häufige Fragen",
    seedEn: "Frequently asked questions",
  },
};

function installRetryableSave() {
  let resolveFirstSave!: (response: Response) => void;
  const firstSave = new Promise<Response>((resolve) => {
    resolveFirstSave = resolve;
  });
  const postBodies: unknown[] = [];
  let postCount = 0;

  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/content/spirecut") && method === "GET") {
        return { ok: true, json: async () => ENTRY_AT_SEED } as Response;
      }
      if (url.includes("/api/admin/content") && method === "POST") {
        postBodies.push(JSON.parse(String(init?.body)));
        postCount += 1;
        return postCount === 1
          ? firstSave
          : ({ ok: true, json: async () => ({}) } as Response);
      }
      return { ok: true, json: async () => ({}) } as Response;
    }
  );

  return { resolveFirstSave, postBodies };
}

function installConcurrentSaves() {
  let resolveHomeSave!: (response: Response) => void;
  let resolveFaqSave!: (response: Response) => void;
  let homeSaveAttempts = 0;
  const homeSave = new Promise<Response>((resolve) => {
    resolveHomeSave = resolve;
  });
  const faqSave = new Promise<Response>((resolve) => {
    resolveFaqSave = resolve;
  });
  const postBodies: unknown[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/content/spirecut") && method === "GET") {
        return { ok: true, json: async () => ENTRY_AT_SEED } as Response;
      }
      if (url.includes("/api/admin/content") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        postBodies.push(body);
        const key = body.updates[0]?.key as string;
        if (key.includes(".home.")) {
          homeSaveAttempts += 1;
          return homeSaveAttempts === 1
            ? homeSave
            : ({ ok: true, json: async () => ({}) } as Response);
        }
        return faqSave;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }
  );

  return { resolveHomeSave, resolveFaqSave, postBodies };
}

function getSaveButton() {
  return screen.getByRole("button", { name: /save.*change/i }) as HTMLButtonElement;
}

function getPage(label: string) {
  const page = screen.getByText(label).closest("div.border") as HTMLElement | null;
  if (!page) throw new Error(`Expected the ${label} page container`);
  return page;
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});



describe("SpirecutContent — failed save recovery", () => {
  it("keeps the edit for a retry after a failed request and clears it after success", async () => {
    const user = userEvent.setup();
    const { resolveFirstSave, postBodies } = installRetryableSave();

    render(<SpirecutContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    const input = screen.getByDisplayValue("Your Hand. Your Health.");
    fireEvent.change(input, { target: { value: "Updated English heading" } });

    const saveButton = getSaveButton();
    expect(screen.getByText("1 unsaved")).toBeInTheDocument();

    const dirtyRow = input.closest("div.border-l-4");
    expect(dirtyRow).toBeTruthy();
    if (!dirtyRow) throw new Error("Expected the edited row to be highlighted");
    expect(dirtyRow).toHaveClass("border-l-amber-400", "bg-amber-50/30");

    await user.click(saveButton);
    await waitFor(() => {
      const savingButtons = screen
        .getAllByRole("button", { name: /saving/i })
        .filter((button) => (button as HTMLButtonElement).disabled);
      expect(savingButtons).toHaveLength(2);
      for (const button of savingButtons) expect(button).toBeDisabled();
    });

    resolveFirstSave({ ok: false, status: 500 } as Response);

    await waitFor(() => {
      expect(getSaveButton()).toBeEnabled();
      expect(screen.getByText("1 unsaved")).toBeInTheDocument();
      expect(dirtyRow).toHaveClass("border-l-amber-400", "bg-amber-50/30");
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Save failed", variant: "destructive" })
    );

    await user.click(getSaveButton());

    await waitFor(() => {
      expect(screen.queryByText("1 unsaved")).not.toBeInTheDocument();
      expect(dirtyRow).not.toHaveClass("border-l-amber-400", "bg-amber-50/30");
    });
    expect(input).toHaveValue("Updated English heading");
    expect(postBodies).toEqual([
      {
        updates: [
          {
            key: "spirecut.home.hero_title",
            de: "Ihre Hand. Ihre Gesundheit.",
            en: "Updated English heading",
          },
        ],
      },
      {
        updates: [
          {
            key: "spirecut.home.hero_title",
            de: "Ihre Hand. Ihre Gesundheit.",
            en: "Updated English heading",
          },
        ],
      },
    ]);
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Saved" }));
  });

  it("keeps a newer edit made while the first save is in flight", async () => {
    const user = userEvent.setup();
    const { resolveFirstSave, postBodies } = installRetryableSave();

    render(<SpirecutContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    const input = screen.getByDisplayValue("Your Hand. Your Health.");
    fireEvent.change(input, { target: { value: "First English heading" } });
    await user.click(getSaveButton());
    await waitFor(() => expect(postBodies).toHaveLength(1));

    fireEvent.change(input, { target: { value: "Newer English heading" } });
    resolveFirstSave({ ok: true, status: 200 } as Response);

    await waitFor(() => {
      expect(screen.getByText("1 unsaved")).toBeInTheDocument();
      expect(input).toHaveValue("Newer English heading");
      expect(getSaveButton()).toBeEnabled();
    });

    await user.click(getSaveButton());
    await waitFor(() => expect(screen.queryByText("1 unsaved")).not.toBeInTheDocument());
    expect(postBodies).toEqual([
      {
        updates: [
          {
            key: "spirecut.home.hero_title",
            de: "Ihre Hand. Ihre Gesundheit.",
            en: "First English heading",
          },
        ],
      },
      {
        updates: [
          {
            key: "spirecut.home.hero_title",
            de: "Ihre Hand. Ihre Gesundheit.",
            en: "Newer English heading",
          },
        ],
      },
    ]);
  });

  it("keeps a second row edit dirty while the first row save is in flight", async () => {
    const user = userEvent.setup();
    const { resolveFirstSave, postBodies } = installRetryableSave();

    render(<SpirecutContent />);
    await waitFor(() => screen.getByText("Hero Subtitle"));

    const firstInput = screen.getByDisplayValue("Your Hand. Your Health.");
    const secondInput = screen.getByDisplayValue("Innovative hand surgery");
    fireEvent.change(firstInput, { target: { value: "First English heading" } });
    await user.click(getSaveButton());
    await waitFor(() => expect(postBodies).toHaveLength(1));

    fireEvent.change(secondInput, { target: { value: "Newer English subtitle" } });
    const firstRow = firstInput.closest("div.border-l-4");
    const secondRow = secondInput.closest("div.border-l-4");
    expect(firstRow).toBeTruthy();
    expect(secondRow).toBeTruthy();
    if (!firstRow || !secondRow) throw new Error("Expected both edited rows to be highlighted");

    resolveFirstSave({ ok: true, status: 200 } as Response);

    await waitFor(() => {
      expect(screen.getByText("1 unsaved")).toBeInTheDocument();
      expect(firstRow).not.toHaveClass("border-l-amber-400", "bg-amber-50/30");
      expect(secondRow).toHaveClass("border-l-amber-400", "bg-amber-50/30");
      expect(secondInput).toHaveValue("Newer English subtitle");
      expect(getSaveButton()).toBeEnabled();
    });

    await user.click(getSaveButton());
    await waitFor(() => expect(screen.queryByText("1 unsaved")).not.toBeInTheDocument());

    expect(secondRow).not.toHaveClass("border-l-amber-400", "bg-amber-50/30");
    expect(postBodies).toEqual([
      {
        updates: [
          {
            key: "spirecut.home.hero_title",
            de: "Ihre Hand. Ihre Gesundheit.",
            en: "First English heading",
          },
        ],
      },
      {
        updates: [
          {
            key: "spirecut.home.hero_subtitle",
            de: "Innovative Handchirurgie",
            en: "Newer English subtitle",
          },
        ],
      },
    ]);
  });

  it("keeps an edit on a different page dirty while the first page save is in flight", async () => {
    const user = userEvent.setup();
    const { resolveFirstSave, postBodies } = installRetryableSave();

    render(<SpirecutContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    const firstInput = screen.getByDisplayValue("Your Hand. Your Health.");
    fireEvent.change(firstInput, { target: { value: "First page heading" } });
    await user.click(getSaveButton());
    await waitFor(() => expect(postBodies).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /FAQ/ }));
    const secondInput = await screen.findByDisplayValue("Frequently asked questions");
    fireEvent.change(secondInput, { target: { value: "Second page heading" } });
    const secondRow = secondInput.closest("div.border-l-4");
    expect(secondRow).toBeTruthy();
    if (!secondRow) throw new Error("Expected the second-page edit to be highlighted");

    resolveFirstSave({ ok: true, status: 200 } as Response);

    await waitFor(() => {
      expect(screen.getAllByText("1 unsaved")).toHaveLength(1);
      expect(firstInput).toHaveValue("First page heading");
      expect(secondInput).toHaveValue("Second page heading");
      expect(secondRow).toHaveClass(
        "border-l-amber-400",
        "bg-amber-50/30"
  );
 });

    await user.click(getSaveButton());

    await waitFor(() => {
      expect(screen.queryByText("1 unsaved")).not.toBeInTheDocument();
      expect(secondRow).not.toHaveClass(
        "border-l-amber-400",
        "bg-amber-50/30"
      );
    });
    expect(postBodies).toEqual([
      {
        updates: [
          {
            key: "spirecut.home.hero_title",
            de: "Ihre Hand. Ihre Gesundheit.",
            en: "First page heading",
          },
        ],
      },
      {
        updates: [
          {
            key: "spirecut.faq.title",
            de: "Häufige Fragen",
            en: "Second page heading",
          },
        ],
      },
    ]);
  });

  it("keeps concurrent page saves independently saving and resolving", async () => {
    const user = userEvent.setup();
    const { resolveHomeSave, resolveFaqSave, postBodies } = installConcurrentSaves();

    render(<SpirecutContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    const homePage = getPage("Startseite");
    const homeInput = screen.getByDisplayValue("Your Hand. Your Health.");
    fireEvent.change(homeInput, { target: { value: "Updated home heading" } });
    await user.click(within(homePage).getByRole("button", { name: /save.*change/i }));
    await waitFor(() => expect(postBodies).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /FAQ/ }));
    const faqPage = getPage("FAQ");
    const faqInput = await screen.findByDisplayValue("Frequently asked questions");
    fireEvent.change(faqInput, { target: { value: "Updated FAQ heading" } });
    await user.click(within(faqPage).getByRole("button", { name: /save.*change/i }));

    await waitFor(() => expect(postBodies).toHaveLength(2));
    for (const page of [homePage, faqPage]) {
      const savingButtons = within(page)
        .getAllByRole("button", { name: /saving/i })
        .filter((button) => (button as HTMLButtonElement).disabled);
      expect(savingButtons).toHaveLength(2);
    }

    // Resolve the second page first. Its failure must not clear the first page's
    // in-flight state, and it must leave only its own edit dirty.
    resolveFaqSave({ ok: false, status: 500 } as Response);
    await waitFor(() => {
      const homeSavingButtons = within(homePage)
        .getAllByRole("button", { name: /saving/i })
        .filter((button) => (button as HTMLButtonElement).disabled);
      expect(homeSavingButtons).toHaveLength(2);
      expect(within(faqPage).queryAllByRole("button", { name: /saving/i })).toHaveLength(0);
      expect(within(faqPage).getByText("1 unsaved")).toBeInTheDocument();
      expect(within(faqPage).getByRole("button", { name: /save.*change/i })).toBeEnabled();
    });

    resolveHomeSave({ ok: true, status: 200 } as Response);
    await waitFor(() => {
      expect(within(homePage).queryByText("1 unsaved")).not.toBeInTheDocument();
      expect(within(homePage).queryAllByRole("button", { name: /saving/i })).toHaveLength(0);
      expect(within(faqPage).getByText("1 unsaved")).toBeInTheDocument();
      expect(within(faqPage).getByRole("button", { name: /save.*change/i })).toBeEnabled();
    });

    expect(homeInput).toHaveValue("Updated home heading");
    expect(faqInput).toHaveValue("Updated FAQ heading");
    expect(postBodies).toEqual([
      {
        updates: [
          {
            key: "spirecut.home.hero_title",
            de: "Ihre Hand. Ihre Gesundheit.",
            en: "Updated home heading",
          },
        ],
      },
      {
        updates: [
          {
            key: "spirecut.faq.title",
            de: "Häufige Fragen",
            en: "Updated FAQ heading",
          },
        ],
      },
    ]);
  });

  it.each([
    {
      order: "home first",
      homeResponse: { ok: true, status: 200 },
      faqResponse: { ok: false, status: 500 },
    },
    {
      order: "FAQ first",
      homeResponse: { ok: false, status: 500 },
      faqResponse: { ok: true, status: 200 },
    },
  ])(
    "keeps a newer home edit dirty when concurrent saves resolve $order",
    async ({ homeResponse, faqResponse }) => {
      const user = userEvent.setup();
      const { resolveHomeSave, resolveFaqSave, postBodies } = installConcurrentSaves();

      render(<SpirecutContent />);
      await waitFor(() => screen.getByText("Hero Title"));

      const homePage = getPage("Startseite");
      const homeInput = screen.getByDisplayValue("Your Hand. Your Health.");
      fireEvent.change(homeInput, { target: { value: "First home heading" } });
      await user.click(within(homePage).getByRole("button", { name: /save.*change/i }));
      await waitFor(() => expect(postBodies).toHaveLength(1));

      await user.click(screen.getByRole("button", { name: /FAQ/ }));
      const faqPage = getPage("FAQ");
      const faqInput = await screen.findByDisplayValue("Frequently asked questions");
      fireEvent.change(faqInput, { target: { value: "First FAQ heading" } });
      await user.click(within(faqPage).getByRole("button", { name: /save.*change/i }));
      await waitFor(() => expect(postBodies).toHaveLength(2));

      fireEvent.change(homeInput, { target: { value: "Newer home heading" } });

      if (homeResponse.ok) {
        resolveHomeSave(homeResponse as Response);
      } else {
        resolveFaqSave(faqResponse as Response);
      }

      await waitFor(() => {
        expect(homeInput).toHaveValue("Newer home heading");
        expect(within(homePage).getByText("1 unsaved")).toBeInTheDocument();
      });

      if (homeResponse.ok) {
        resolveFaqSave(faqResponse as Response);
      } else {
        resolveHomeSave(homeResponse as Response);
      }

      await waitFor(() => {
        expect(homeInput).toHaveValue("Newer home heading");
        expect(within(homePage).getByText("1 unsaved")).toBeInTheDocument();
        expect(within(homePage).getByRole("button", { name: /save.*change/i })).toBeEnabled();
      });

      await user.click(within(homePage).getByRole("button", { name: /save.*change/i }));
      await waitFor(() => {
        expect(within(homePage).queryByText("1 unsaved")).not.toBeInTheDocument();
      });

      expect(homeInput).toHaveValue("Newer home heading");
      expect(postBodies).toEqual([
        {
          updates: [
            {
              key: "spirecut.home.hero_title",
              de: "Ihre Hand. Ihre Gesundheit.",
              en: "First home heading",
            },
          ],
        },
        {
          updates: [
            {
              key: "spirecut.faq.title",
              de: "Häufige Fragen",
              en: "First FAQ heading",
            },
          ],
        },
        {
          updates: [
            {
              key: "spirecut.home.hero_title",
              de: "Ihre Hand. Ihre Gesundheit.",
              en: "Newer home heading",
            },
          ],
        },
      ]);
    }
  );

  it("keeps a newer edit when a page reset resolves during a pending save", async () => {
    const user = userEvent.setup();
    let resolveSave!: (response: Response) => void;
    let resolveReset!: (response: Response) => void;
    const save = new Promise<Response>((resolve) => { resolveSave = resolve; });
    const reset = new Promise<Response>((resolve) => { resolveReset = resolve; });
    const overridden = {
      ...ENTRY_AT_SEED,
      "spirecut.home.hero_title": {
        ...ENTRY_AT_SEED["spirecut.home.hero_title"],
        en: "Published override",
      },
    };
    let saveCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return { ok: true, json: async () => overridden } as Response;
      if (String(_input).includes("bulk-reset")) return reset;
      if (method === "POST") {
        saveCount += 1;
        return saveCount === 1 ? save : ({ ok: true, json: async () => ({}) } as Response);
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SpirecutContent />);
    const input = await screen.findByDisplayValue("Published override");
    fireEvent.change(input, { target: { value: "Saving draft" } });
    await user.click(screen.getByRole("button", { name: /save.*change/i }));
    await user.click(screen.getByTitle("Reset all overridden texts on this page to defaults"));
    fireEvent.change(input, { target: { value: "Newer local draft" } });

    resolveReset({
      ok: true,
      json: async () => ({
        results: [{ key: "spirecut.home.hero_title", de: "Ihre Hand. Ihre Gesundheit.", en: "Your hand. Your health." }],
      }),
    } as Response);
    resolveSave({ ok: true, json: async () => ({}) } as Response);

    await waitFor(() => {
      expect(input).toHaveValue("Newer local draft");
      expect(screen.getByText("1 unsaved")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /save.*change/i }));
    await waitFor(() => expect(screen.queryByText("1 unsaved")).not.toBeInTheDocument());
    expect(input).toHaveValue("Newer local draft");

    await user.click(screen.getByTitle("Reset all overridden texts on this page to defaults"));
    await waitFor(() => expect(input).toHaveValue("Your hand. Your health."));
    expect(screen.queryByText("1 unsaved")).not.toBeInTheDocument();
  });
});