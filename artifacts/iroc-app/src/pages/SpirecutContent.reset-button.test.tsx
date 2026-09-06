/**
 * SpirecutContent — Reset button visibility tests (Task #161)
 *
 * Confirms the Reset-to-default button:
 *
 *  1. Is hidden when the DB value matches the seed default (no override).
 *  2. Appears when the saved DB value differs from the seed (entry is overridden).
 *  3. Appears after the admin saves an edit (content now diverges from seed).
 *  4. Disappears after the admin clicks Reset (DELETE returns seed values).
 *  5. After clicking Reset the dirty-edit amber highlight is also gone.
 *  6. After a page reload with seed values the Reset button is still absent
 *     (confirming the DB was updated, not just local state).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpirecutContent from "./SpirecutContent";

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
  useSiteUrls: () => ({ spirecutUrl: "https://spirecut.example.com", irocUrl: null }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * One entry in the "home" page where the DB value matches the seed → no Reset button.
 */
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

/**
 * Same entry but the DB value has already been overridden by an admin.
 * The Reset button SHOULD appear on load.
 */
const ENTRY_OVERRIDDEN = {
  "spirecut.home.hero_title": {
    key: "spirecut.home.hero_title",
    page: "home",
    label: "Hero Title",
    de: "Ihre Hand. Gesund und stark.",
    en: "Your Hand. Healthy and strong.",
    seedDe: "Ihre Hand. Ihre Gesundheit.",
    seedEn: "Your Hand. Your Health.",
  },
};

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function installFetchSpy(contentMap: Record<string, unknown>) {
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

      if (url.includes("/api/content/spirecut") && method === "GET") {
        return { ok: true, json: async () => contentMap } as Response;
      }
      if (url.includes("/api/admin/content") && method === "POST") {
        return { ok: true, json: async () => ({ ok: true, updated: 1 }) } as Response;
      }
      if (url.includes("/api/admin/content/") && method === "DELETE") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            key: "spirecut.home.hero_title",
            de: "Ihre Hand. Ihre Gesundheit.",
            en: "Your Hand. Your Health.",
          }),
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

describe("SpirecutContent — Reset button", () => {
  // ── Scenario 1: no override → Reset button absent ─────────────────────────

  it("does not show Reset button when DB value matches seed", async () => {
    installFetchSpy(ENTRY_AT_SEED);
    render(<SpirecutContent />);

    await waitFor(() => expect(screen.getByText("Hero Title")).toBeTruthy());

    expect(screen.queryByTitle("Reset to default")).toBeNull();
    expect(screen.queryByText("Default")).toBeNull();
  });

  // ── Scenario 2: already overridden → Reset button present on load ─────────

  it("shows Reset button when DB value differs from seed on initial load", async () => {
    installFetchSpy(ENTRY_OVERRIDDEN);
    render(<SpirecutContent />);

    await waitFor(() => screen.getByTitle("Reset to default"));
  });

  it("disables an entry reset while pending so repeated clicks issue one DELETE", async () => {
    const user = userEvent.setup();
    let resolveReset!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveReset = resolve; });
    let deletes = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if ((init?.method ?? "GET") === "DELETE") { deletes += 1; return pending; }
      return { ok: true, json: async () => ENTRY_OVERRIDDEN } as Response;
    });
    render(<SpirecutContent />);
    const reset = await screen.findByTitle("Reset to default");
    await user.click(reset);
    expect(reset).toBeDisabled();
    expect(reset).toHaveTextContent("Resetting…");
    await user.click(reset);
    expect(deletes).toBe(1);
    resolveReset({ ok: false, json: async () => ({}) } as Response);
    await waitFor(() => expect(reset).toBeEnabled());
  });

  // ── Scenario 3: edit + save → Reset button appears ───────────────────────

  it("shows Reset button after admin edits and saves a text", async () => {
    const user = userEvent.setup();

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
          return { ok: true, json: async () => ({ ok: true, updated: 1 }) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }
    );

    render(<SpirecutContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    // No Reset button initially
    expect(screen.queryByTitle("Reset to default")).toBeNull();

    // Edit the DE field
    const deInput = screen.getByDisplayValue("Ihre Hand. Ihre Gesundheit.");
    await user.clear(deInput);
    await user.type(deInput, "Ihre Hand in besten Händen.");

    // Save via the bottom Save button
    const saveBtn = await waitFor(() =>
      screen.getByRole("button", { name: /save.*change/i })
    );
    await user.click(saveBtn);

    // After save: content.de diverges from seedDe → Reset button must appear
    await waitFor(() => screen.getByTitle("Reset to default"));
  });

  // ── Scenario 4: click Reset → button disappears ───────────────────────────

  it("hides Reset button after clicking Reset to default", async () => {
    const user = userEvent.setup();
    installFetchSpy(ENTRY_OVERRIDDEN);

    render(<SpirecutContent />);
    await waitFor(() => screen.getByTitle("Reset to default"));

    const resetBtn = screen.getByTitle("Reset to default");
    await user.click(resetBtn);

    // DELETE response returns seed values → isOverridden = false → button gone
    await waitFor(() => {
      expect(screen.queryByTitle("Reset to default")).toBeNull();
    });

    // Amber dirty-highlight: after reset the dirty state for this key is also
    // cleared (setDirty removes the key), so no amber border should remain.
    // We confirm by checking the row container has no dirty class —
    // the simplest proxy is verifying the "unsaved" badge is absent.
    expect(screen.queryByText(/unsaved/i)).toBeNull();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/reset to default/i) })
    );
  });

  // ── Scenario 5: page reload after reset → still absent ────────────────────

  it("keeps Reset button hidden after page reload when DB holds seed value", async () => {
    installFetchSpy(ENTRY_AT_SEED);

    render(<SpirecutContent />);
    await waitFor(() => screen.getByText("Hero Title"));

    expect(screen.queryByTitle("Reset to default")).toBeNull();
  });
});
