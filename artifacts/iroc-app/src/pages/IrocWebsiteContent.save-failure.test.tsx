/**
 * IrocWebsiteContent — failed-save recovery regression test.
 *
 * A failed save must not discard the local edit. The request is deferred here
 * so the test also observes the button's in-flight disabled state.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { render, screen, waitFor } from "@testing-library/react";
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
  "iroc.home.hero_subtitle": {
    key: "iroc.home.hero_subtitle",
    page: "home",
    label: "Hero Subtitle",
    de: "Innovative Handchirurgie",
    en: "Innovative hand surgery",
    seedDe: "Innovative Handchirurgie",
    seedEn: "Innovative hand surgery",
  },
  "iroc.contact.title": {
    key: "iroc.contact.title",
    page: "contact",
    label: "Contact Title",
    de: "Kontakt",
    en: "Contact",
    seedDe: "Kontakt",
    seedEn: "Contact",
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

      if (url.includes("/api/content/iroc") && method === "GET") {
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
  let resolveContactSave!: (response: Response) => void;
  let homeSaveAttempts = 0;
  const homeSave = new Promise<Response>((resolve) => {
    resolveHomeSave = resolve;
  });
  const contactSave = new Promise<Response>((resolve) => {
    resolveContactSave = resolve;
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

      if (url.includes("/api/content/iroc") && method === "GET") {
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
        return contactSave;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }
  );

  return { resolveHomeSave, resolveContactSave, postBodies };
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



describe("IrocWebsiteContent — failed save recovery", () => {
  it("keeps the edit for a retry after a failed request and clears it after success", async () => {
    const user = userEvent.setup();
    const { resolveFirstSave, postBodies } = installRetryableSave();

    render(<IrocWebsiteContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    const input = screen.getByDisplayValue("Welcome to iROC");
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
            key: "iroc.home.hero_title",
            de: "Willkommen bei iROC",
            en: "Updated English heading",
          },
        ],
      },
      {
        updates: [
          {
            key: "iroc.home.hero_title",
            de: "Willkommen bei iROC",
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

    render(<IrocWebsiteContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    const input = screen.getByDisplayValue("Welcome to iROC");
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
            key: "iroc.home.hero_title",
            de: "Willkommen bei iROC",
            en: "First English heading",
          },
        ],
      },
      {
        updates: [
          {
            key: "iroc.home.hero_title",
            de: "Willkommen bei iROC",
            en: "Newer English heading",
          },
        ],
      },
    ]);
  });

  it("keeps a second row edit dirty while the first row save is in flight", async () => {
    const user = userEvent.setup();
    const { resolveFirstSave, postBodies } = installRetryableSave();

    render(<IrocWebsiteContent />);
    await waitFor(() => screen.getByText("Hero Subtitle"));

    const firstInput = screen.getByDisplayValue("Welcome to iROC");
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
            key: "iroc.home.hero_title",
            de: "Willkommen bei iROC",
            en: "First English heading",
          },
        ],
      },
      {
        updates: [
          {
            key: "iroc.home.hero_subtitle",
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

    render(<IrocWebsiteContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    const firstInput = screen.getByDisplayValue("Welcome to iROC");
    fireEvent.change(firstInput, { target: { value: "First page heading" } });
    await user.click(getSaveButton());
    await waitFor(() => expect(postBodies).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /Kontakt/i }));
    const secondInput = await screen.findByDisplayValue("Contact");
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
            key: "iroc.home.hero_title",
            de: "Willkommen bei iROC",
            en: "First page heading",
          },
        ],
      },
      {
        updates: [
          {
            key: "iroc.contact.title",
            de: "Kontakt",
            en: "Second page heading",
          },
        ],
      },
    ]);
  });

  it("keeps concurrent page saves independently saving and resolving", async () => {
    const user = userEvent.setup();
    const { resolveHomeSave, resolveContactSave, postBodies } = installConcurrentSaves();

    render(<IrocWebsiteContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    const homePage = getPage("Startseite (Home)");
    const homeInput = screen.getByDisplayValue("Welcome to iROC");
    fireEvent.change(homeInput, { target: { value: "Updated home heading" } });
    await user.click(within(homePage).getByRole("button", { name: /save.*change/i }));
    await waitFor(() => expect(postBodies).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: /Kontakt/i }));
    const contactPage = getPage("Kontakt");
    const contactInput = await screen.findByDisplayValue("Contact");
    fireEvent.change(contactInput, { target: { value: "Updated contact heading" } });
    await user.click(within(contactPage).getByRole("button", { name: /save.*change/i }));

    await waitFor(() => expect(postBodies).toHaveLength(2));
    for (const page of [homePage, contactPage]) {
      const savingButtons = within(page)
        .getAllByRole("button", { name: /saving/i })
        .filter((button) => (button as HTMLButtonElement).disabled);
      expect(savingButtons).toHaveLength(2);
    }

    // Resolve the second page first. Its failure must not clear the first page's
    // in-flight state, and it must leave only its own edit dirty.
    resolveContactSave({ ok: false, status: 500 } as Response);
    await waitFor(() => {
      expect(within(homePage).getAllByRole("button", { name: /saving/i })).toHaveLength(2);
      expect(within(contactPage).queryAllByRole("button", { name: /saving/i })).toHaveLength(0);
      expect(within(contactPage).getByText("1 unsaved")).toBeInTheDocument();
      expect(within(contactPage).getByRole("button", { name: /save.*change/i })).toBeEnabled();
    });

    resolveHomeSave({ ok: true, status: 200 } as Response);
    await waitFor(() => {
      expect(within(homePage).queryByText("1 unsaved")).not.toBeInTheDocument();
      expect(within(homePage).queryAllByRole("button", { name: /saving/i })).toHaveLength(0);
      expect(within(contactPage).getByText("1 unsaved")).toBeInTheDocument();
      expect(within(contactPage).getByRole("button", { name: /save.*change/i })).toBeEnabled();
    });

    expect(homeInput).toHaveValue("Updated home heading");
    expect(contactInput).toHaveValue("Updated contact heading");
    expect(postBodies).toEqual([
      {
        updates: [
          {
            key: "iroc.home.hero_title",
            de: "Willkommen bei iROC",
            en: "Updated home heading",
          },
        ],
      },
      {
        updates: [
          {
            key: "iroc.contact.title",
            de: "Kontakt",
            en: "Updated contact heading",
          },
        ],
      },
    ]);
  });

  it.each([
    {
      order: "home first",
      homeResponse: { ok: true, status: 200 },
      contactResponse: { ok: false, status: 500 },
    },
    {
      order: "contact first",
      homeResponse: { ok: false, status: 500 },
      contactResponse: { ok: true, status: 200 },
    },
  ])(
    "keeps a newer home edit dirty when concurrent saves resolve $order",
    async ({ homeResponse, contactResponse }) => {
      const user = userEvent.setup();
      const { resolveHomeSave, resolveContactSave, postBodies } = installConcurrentSaves();

      render(<IrocWebsiteContent />);
      await waitFor(() => screen.getByText("Hero Title"));

      const homePage = getPage("Startseite (Home)");
      const homeInput = screen.getByDisplayValue("Welcome to iROC");
      fireEvent.change(homeInput, { target: { value: "First home heading" } });
      await user.click(within(homePage).getByRole("button", { name: /save.*change/i }));
      await waitFor(() => expect(postBodies).toHaveLength(1));

      await user.click(screen.getByRole("button", { name: /Kontakt/i }));
      const contactPage = getPage("Kontakt");
      const contactInput = await screen.findByDisplayValue("Contact");
      fireEvent.change(contactInput, { target: { value: "First contact heading" } });
      await user.click(within(contactPage).getByRole("button", { name: /save.*change/i }));
      await waitFor(() => expect(postBodies).toHaveLength(2));

      fireEvent.change(homeInput, { target: { value: "Newer home heading" } });

      if (homeResponse.ok) {
        resolveHomeSave(homeResponse as Response);
      } else {
        resolveContactSave(contactResponse as Response);
      }

      await waitFor(() => {
        expect(homeInput).toHaveValue("Newer home heading");
        expect(within(homePage).getByText("1 unsaved")).toBeInTheDocument();
      });

      if (homeResponse.ok) {
        resolveContactSave(contactResponse as Response);
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
              key: "iroc.home.hero_title",
              de: "Willkommen bei iROC",
              en: "First home heading",
            },
          ],
        },
        {
          updates: [
            {
              key: "iroc.contact.title",
              de: "Kontakt",
              en: "First contact heading",
            },
          ],
        },
        {
          updates: [
            {
              key: "iroc.home.hero_title",
              de: "Willkommen bei iROC",
              en: "Newer home heading",
            },
          ],
        },
      ]);
    }
  );

  it("keeps a newer entry edit when reset and save responses overlap", async () => {
    const user = userEvent.setup();
    let resolveSave!: (response: Response) => void;
    let resolveReset!: (response: Response) => void;
    const save = new Promise<Response>((resolve) => { resolveSave = resolve; });
    const reset = new Promise<Response>((resolve) => { resolveReset = resolve; });
    const overridden = {
      ...ENTRY_AT_SEED,
      "iroc.home.hero_title": {
        ...ENTRY_AT_SEED["iroc.home.hero_title"],
        en: "Published override",
      },
    };
    let saveCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return { ok: true, json: async () => overridden } as Response;
      if (method === "DELETE") return reset;
      if (method === "POST" && url.includes("/api/admin/content")) {
        saveCount += 1;
        return saveCount === 1 ? save : ({ ok: true, json: async () => ({}) } as Response);
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<IrocWebsiteContent />);
    const input = await screen.findByDisplayValue("Published override");
    fireEvent.change(input, { target: { value: "Saving draft" } });
    await user.click(screen.getByRole("button", { name: /save.*change/i }));
    await user.click(screen.getByTitle("Reset to default"));
    fireEvent.change(input, { target: { value: "Newer local draft" } });

    resolveReset({ ok: true, json: async () => ({ de: "Willkommen bei iROC", en: "Welcome to iROC" }) } as Response);
    resolveSave({ ok: true, json: async () => ({}) } as Response);

    await waitFor(() => {
      expect(input).toHaveValue("Newer local draft");
      expect(screen.getByText("1 unsaved")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /save.*change/i }));
    await waitFor(() => expect(screen.queryByText("1 unsaved")).not.toBeInTheDocument());
    expect(input).toHaveValue("Newer local draft");
  });

  it("ignores a late entry reset after a newer draft has been saved", async () => {
    const user = userEvent.setup();
    let resolveFirstSave!: (response: Response) => void;
    let resolveReset!: (response: Response) => void;
    const firstSave = new Promise<Response>((resolve) => { resolveFirstSave = resolve; });
    const reset = new Promise<Response>((resolve) => { resolveReset = resolve; });
    const overridden = {
      ...ENTRY_AT_SEED,
      "iroc.home.hero_title": {
        ...ENTRY_AT_SEED["iroc.home.hero_title"],
        en: "Published override",
      },
    };
    let saveCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return { ok: true, json: async () => overridden } as Response;
      if (method === "DELETE") return reset;
      if (method === "POST" && String(input).includes("/api/admin/content")) {
        saveCount += 1;
        return saveCount === 1 ? firstSave : ({ ok: true, json: async () => ({}) } as Response);
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<IrocWebsiteContent />);
    const input = await screen.findByDisplayValue("Published override");
    fireEvent.change(input, { target: { value: "Saving draft" } });
    await user.click(screen.getByRole("button", { name: /save.*change/i }));
    await user.click(screen.getByTitle("Reset to default"));
    fireEvent.change(input, { target: { value: "Newer local draft" } });

    resolveFirstSave({ ok: true, json: async () => ({}) } as Response);
    await waitFor(() => expect(screen.getByRole("button", { name: /save.*change/i })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: /save.*change/i }));
    await waitFor(() => expect(screen.queryByText("1 unsaved")).not.toBeInTheDocument());

    resolveReset({ ok: true, json: async () => ({ de: "Willkommen bei iROC", en: "Welcome to iROC" }) } as Response);
    await waitFor(() => expect(input).toHaveValue("Newer local draft"));
    expect(screen.queryByText("1 unsaved")).not.toBeInTheDocument();
  });
});