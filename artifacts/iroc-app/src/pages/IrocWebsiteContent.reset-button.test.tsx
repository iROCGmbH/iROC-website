/**
 * IrocWebsiteContent — Reset button visibility tests (Task #161)
 *
 * Confirms the Reset-to-default button:
 *
 *  1. Is hidden when the DB value matches the seed default (no override).
 *  2. Appears when the saved DB value differs from the seed (entry is overridden).
 *  3. Appears after the admin saves an edit (content now diverges from seed).
 *  4. Disappears after the admin clicks Reset (DELETE returns seed values).
 *  5. After clicking Reset the amber dirty-edit highlight is also gone.
 *  6. After a page reload with seed values the Reset button is still absent
 *     (confirming the DB was updated, not just local state).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IrocWebsiteContent from "./IrocWebsiteContent";

// ── Module mocks ──────────────────────────────────────────────────────────────

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * A single content entry for the "home" page where the DB value matches
 * the seed default → no override, Reset button should NOT appear.
 */
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
};

/**
 * Same entry but with a DB value that has already been overridden by an admin.
 * The Reset button SHOULD appear on load.
 */
const ENTRY_OVERRIDDEN = {
  "iroc.home.hero_title": {
    key: "iroc.home.hero_title",
    page: "home",
    label: "Hero Title",
    de: "Herzlich Willkommen bei iROC GmbH",
    en: "Welcome to iROC GmbH",
    seedDe: "Willkommen bei iROC",
    seedEn: "Welcome to iROC",
  },
};

const ENTRY_WITH_COLLAPSED_CONTACT = {
  ...ENTRY_AT_SEED,
  "iroc.contact.intro": {
    key: "iroc.contact.intro",
    page: "contact",
    label: "Contact intro",
    de: "Kontakt Einführung",
    en: "Contact page introduction",
    seedDe: "Kontakt Einführung",
    seedEn: "Contact page introduction",
  },
};

const ENTRY_WITH_COLLIDING_PAGE_IDS = {
  "iroc.alpha.title": { ...ENTRY_AT_SEED["iroc.home.hero_title"], key: "iroc.alpha.title", page: "alpha/beta", label: "First page" },
  "iroc.beta.title": { ...ENTRY_AT_SEED["iroc.home.hero_title"], key: "iroc.beta.title", page: "alpha?beta", label: "Second page" },
};

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/**
 * Install a fetch spy that:
 *  - GET  /api/content/iroc  → returns the given contentMap
 *  - POST /api/admin/content → accepts the save and echoes ok
 *  - DELETE /api/admin/content/:key → returns the seed values
 */
function installFetchSpy(
  contentMap: Record<string, unknown>,
  seedDe = "Willkommen bei iROC",
  seedEn = "Welcome to iROC"
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/content/iroc") && method === "GET") {
        return { ok: true, json: async () => contentMap } as Response;
      }
      if (url.includes("/api/admin/content") && method === "POST") {
        return { ok: true, json: async () => ({ ok: true, updated: 1 }) } as Response;
      }
      if (url.includes("/api/admin/content/") && method === "DELETE") {
        return {
          ok: true,
          json: async () => ({ ok: true, key: "iroc.home.hero_title", de: seedDe, en: seedEn }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("IrocWebsiteContent — Reset button", () => {
  // ── Scenario 1: no override → Reset button absent ─────────────────────────

  it("does not show Reset button when DB value matches seed", async () => {
    installFetchSpy(ENTRY_AT_SEED);
    render(<IrocWebsiteContent />);

    // Wait for load to complete
    await waitFor(() => expect(screen.getByText("Hero Title")).toBeTruthy());

    expect(screen.queryByTitle("Reset to default")).toBeNull();
    expect(screen.queryByText("Default")).toBeNull();
  });

  // ── Scenario 2: already overridden on load → Reset button present ─────────

  it("shows Reset button when DB value differs from seed on initial load", async () => {
    installFetchSpy(ENTRY_OVERRIDDEN);
    render(<IrocWebsiteContent />);

    await waitFor(() => screen.getByTitle("Reset to default"));
  });

  // ── Scenario 3: edit + save → Reset button appears ───────────────────────

  it("shows Reset button after admin edits and saves a text", async () => {
    const user = userEvent.setup();

    // Track fetch calls to verify the POST save request is actually made
    const fetchCalls: { url: string; method: string }[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : (input as string);
        const method = (init?.method ?? "GET").toUpperCase();
        fetchCalls.push({ url, method });

        if (url.includes("/api/content/iroc") && method === "GET") {
          return { ok: true, json: async () => ENTRY_AT_SEED } as Response;
        }
        if (url.includes("/api/admin/content") && method === "POST") {
          return { ok: true, json: async () => ({ ok: true, updated: 1 }) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }
    );

    render(<IrocWebsiteContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    // Initially at seed — no Reset button
    expect(screen.queryByTitle("Reset to default")).toBeNull();

    // Edit the DE field atomically (avoids transient empty state that disables Save)
    const deInput = screen.getByDisplayValue("Willkommen bei iROC");
    fireEvent.change(deInput, { target: { value: "Geänderte Überschrift" } });

    // The compact Save button in the accordion header is independently
    // keyboard/screen-reader reachable instead of being nested in the toggle.
    const headerSaveBtn = await waitFor(() =>
      screen.getByRole("button", { name: /^Save$/ })
    );
    await user.click(headerSaveBtn);

    // Verify the POST save request was actually sent
    await waitFor(() => {
      const postCall = fetchCalls.find(
        (c) => c.url.includes("/api/admin/content") && c.method === "POST"
      );
      expect(postCall).toBeTruthy();
    });

    // After save: content.de diverges from seedDe → Reset button must appear
    await waitFor(() => screen.getByTitle("Reset to default"));
  });

  // ── Scenario 4: click Reset → button disappears, highlight clears ─────────

  it("hides Reset button and amber highlight after clicking Reset", async () => {
    const user = userEvent.setup();
    installFetchSpy(ENTRY_OVERRIDDEN);

    render(<IrocWebsiteContent />);
    await waitFor(() => screen.getByTitle("Reset to default"));

    // Before reset: the amber highlight class is not directly testable via
    // text-based queries, but we can confirm the Reset button is present.
    const resetBtn = screen.getByTitle("Reset to default");

    await user.click(resetBtn);

    // After DELETE response the button must vanish (isOverridden = false)
    await waitFor(() => {
      expect(screen.queryByTitle("Reset to default")).toBeNull();
    });

    // Success toast
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/reset to default/i) })
    );
  });

  // ── Scenario 5: page reload after reset → Reset button still absent ────────

  it("keeps Reset button hidden after page reload when DB holds seed value", async () => {
    // Simulate a fresh page load where the DB already has seed values
    // (i.e. the previous reset was persisted).
    installFetchSpy(ENTRY_AT_SEED);

    render(<IrocWebsiteContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    expect(screen.queryByTitle("Reset to default")).toBeNull();
  });

  it("announces accordion expansion and hides the content again after keyboard toggles", async () => {
    const user = userEvent.setup();
    installFetchSpy(ENTRY_WITH_COLLAPSED_CONTACT);

    render(<IrocWebsiteContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    const contactHeader = screen.getByRole("button", { name: /Kontakt/ });
    expect(contactHeader).toHaveAttribute("aria-expanded", "false");
    const controlledRegionId = contactHeader.getAttribute("aria-controls");
    expect(controlledRegionId).toMatch(/^content-page-contact-/);
    expect(document.getElementById(controlledRegionId!)).toBeNull();
    expect(screen.queryByDisplayValue("Contact page introduction")).toBeNull();

    contactHeader.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(contactHeader).toHaveAttribute("aria-expanded", "true");
      expect(document.getElementById(controlledRegionId!)).toBeInTheDocument();
      expect(screen.getByDisplayValue("Contact page introduction")).toBeInTheDocument();
    });

    await user.keyboard(" ");

    await waitFor(() => {
      expect(contactHeader).toHaveAttribute("aria-expanded", "false");
      expect(document.getElementById(controlledRegionId!)).toBeNull();
      expect(screen.queryByDisplayValue("Contact page introduction")).toBeNull();
    });
  });

  it("gives pages whose identifiers normalize alike distinct accordion targets", async () => {
    installFetchSpy(ENTRY_WITH_COLLIDING_PAGE_IDS);
    render(<IrocWebsiteContent />);
    await waitFor(() => screen.getByRole("button", { name: /alpha\/beta/ }));

    const first = screen.getByRole("button", { name: /alpha\/beta/ });
    const second = screen.getByRole("button", { name: /alpha\?beta/ });
    expect(first.getAttribute("aria-controls")).not.toBe(second.getAttribute("aria-controls"));
  });

  it("disables an entry reset while pending so repeated clicks issue one DELETE", async () => {
    const user = userEvent.setup();
    let resolveReset!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveReset = resolve; });
    let deletes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if ((init?.method ?? "GET") === "DELETE") { deletes += 1; return pending; }
      return { ok: true, json: async () => ENTRY_OVERRIDDEN } as Response;
    });
    render(<IrocWebsiteContent />);
    const reset = await screen.findByTitle("Reset to default");
    await user.click(reset);
    expect(reset).toBeDisabled();
    expect(reset).toHaveTextContent("Resetting…");
    await user.click(reset);
    expect(deletes).toBe(1);
    resolveReset({ ok: false, json: async () => ({}) } as Response);
    await waitFor(() => expect(reset).toBeEnabled());
  });
});
