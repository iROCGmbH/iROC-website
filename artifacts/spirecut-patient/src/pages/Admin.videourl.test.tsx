/**
 * Unit tests: Spirecut admin video URL field validation
 *
 * Verifies that:
 *   - A malformed URL (no protocol) shows an inline error and does NOT call
 *     /api/admin/spirecut-settings
 *   - A valid embed URL clears the error, calls the API, and the
 *     useSpirecutSettings hook reflects the new value without a page reload
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import Admin from "./Admin";
import { invalidateSpirecutSettingsCache } from "@/hooks/useSpirecutSettings";

// ── BroadcastChannel stub (jsdom doesn't implement it) ────────────────────────
class MockBroadcastChannel {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  close() {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_TOKEN = "test-token-123";
const VALID_CT_URL = "https://www.youtube.com/embed/TESTID_CT?rel=0";

/**
 * Build a fetch mock that:
 *   - Returns [] for /api/patient-media and /api/patient-social
 *   - Returns [] for /api/admin/email-settings
 *   - Returns {} for /api/patient-settings
 *   - Returns 200 OK for /api/admin/spirecut-settings (so success path works)
 *   - Records every call so we can assert on them
 */
function buildFetchMock() {
  const calls: string[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push(url);

    if (url.includes("/api/patient-media"))         return { ok: true, json: async () => ({}) } as Response;
    if (url.includes("/api/patient-social"))        return { ok: true, json: async () => ({}) } as Response;
    if (url.includes("/api/admin/email-settings"))  return { ok: true, json: async () => [] } as Response;
    if (url.includes("/api/patient-settings"))      return { ok: true, json: async () => ({}) } as Response;
    if (url.includes("/api/admin/spirecut-settings")) return { ok: true, json: async () => ({}) } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  });
  return { spy, calls };
}

/** Open the Settings tab in a rendered Admin component. */
async function openSettingsTab() {
  const settingsBtn = await screen.findByRole("button", { name: /einstellungen/i });
  fireEvent.click(settingsBtn);
  // Wait for the CT video card heading to appear
  await screen.findByText("Video – Karpaltunnelsyndrom", {}, { timeout: 5_000 });
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Provide a logged-in token so the Admin panel renders instead of login screen
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) =>
    key === "sp_admin_token" ? FAKE_TOKEN : null,
  );
  // Stub BroadcastChannel so the module-level singleton in useSpirecutSettings works
  (globalThis as unknown as Record<string, unknown>).BroadcastChannel = MockBroadcastChannel;
  // Ensure the settings cache is clear between tests
  invalidateSpirecutSettingsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  invalidateSpirecutSettingsCache();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Admin – video URL validation (CT slot)", () => {
  it("shows an inline error and does NOT call the API when a URL without protocol is submitted", async () => {
    const { calls } = buildFetchMock();

    render(<Admin />);
    await openSettingsTab();

    // Locate the CT video card
    const ctCard = screen.getByText("Video – Karpaltunnelsyndrom").closest("div.bg-white")!;

    // Type a URL without https://
    const input = ctCard.querySelector<HTMLInputElement>("input[type='url']")!;
    fireEvent.change(input, { target: { value: "youtube.com/watch?v=someId" } });

    // Click Save
    const saveBtn = ctCard.querySelector("button")!;
    fireEvent.click(saveBtn);

    // Inline error must appear
    await waitFor(() =>
      expect(ctCard.textContent).toMatch(/ungültige url/i),
    );

    // The spirecut-settings endpoint must NOT have been called
    expect(calls.filter((u) => u.includes("/api/admin/spirecut-settings"))).toHaveLength(0);
  });

  it("shows an inline error and does NOT call the API for TF slot with a bad URL", async () => {
    const { calls } = buildFetchMock();

    render(<Admin />);
    await openSettingsTab();

    const tfCard = screen.getByText("Video – Schnappfinger").closest("div.bg-white")!;
    const input = tfCard.querySelector<HTMLInputElement>("input[type='url']")!;
    fireEvent.change(input, { target: { value: "not-a-url-at-all" } });

    const saveBtn = tfCard.querySelector("button")!;
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(tfCard.textContent).toMatch(/ungültige url/i),
    );

    expect(calls.filter((u) => u.includes("/api/admin/spirecut-settings"))).toHaveLength(0);
  });

  it("clears the error and calls the API when a valid embed URL is entered", async () => {
    const { calls } = buildFetchMock();

    render(<Admin />);
    await openSettingsTab();

    const ctCard = screen.getByText("Video – Karpaltunnelsyndrom").closest("div.bg-white")!;
    const input = ctCard.querySelector<HTMLInputElement>("input[type='url']")!;

    // First enter a bad URL to trigger the error
    fireEvent.change(input, { target: { value: "youtube.com/watch?v=badUrl" } });
    fireEvent.click(ctCard.querySelector("button")!);
    await waitFor(() => expect(ctCard.textContent).toMatch(/ungültige url/i));

    // Now enter a valid embed URL — error should clear immediately
    fireEvent.change(input, { target: { value: VALID_CT_URL } });
    // Error cleared on change
    expect(ctCard.querySelector("[class*='text-red']")?.textContent ?? "").not.toMatch(/ungültige url/i);

    // Click Save
    fireEvent.click(ctCard.querySelector("button")!);

    // The API should be called with the correct payload
    await waitFor(() =>
      expect(calls.filter((u) => u.includes("/api/admin/spirecut-settings"))).toHaveLength(1),
    );

    // Success indicator appears
    await waitFor(() =>
      expect(ctCard.textContent).toMatch(/gespeichert/i),
    );
  });

  it("shows a non-YouTube warning and does NOT call the API for a Vimeo URL", async () => {
    const { calls } = buildFetchMock();

    render(<Admin />);
    await openSettingsTab();

    const ctCard = screen.getByText("Video – Karpaltunnelsyndrom").closest("div.bg-white")!;
    const input = ctCard.querySelector<HTMLInputElement>("input[type='url']")!;

    // Vimeo URL is a syntactically valid URL but not YouTube
    fireEvent.change(input, { target: { value: "https://vimeo.com/123456789" } });
    fireEvent.click(ctCard.querySelector("button")!);

    // Non-YouTube-specific inline error must appear
    await waitFor(() =>
      expect(ctCard.textContent).toMatch(/nur youtube/i),
    );

    // The API must NOT have been called
    expect(calls.filter((u) => u.includes("/api/admin/spirecut-settings"))).toHaveLength(0);
  });

  it("does not show an error when the URL field is empty (optional field)", async () => {
    const { calls } = buildFetchMock();

    render(<Admin />);
    await openSettingsTab();

    const ctCard = screen.getByText("Video – Karpaltunnelsyndrom").closest("div.bg-white")!;
    const input = ctCard.querySelector<HTMLInputElement>("input[type='url']")!;

    // Clear the field
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(ctCard.querySelector("button")!);

    // No validation error — empty is allowed
    await waitFor(() =>
      expect(calls.filter((u) => u.includes("/api/admin/spirecut-settings"))).toHaveLength(1),
    );

    expect(ctCard.textContent).not.toMatch(/ungültige url/i);
  });
});

// ── toEmbedUrl unit tests ─────────────────────────────────────────────────────

describe("toEmbedUrl – YouTube link converter", () => {
  it("converts a youtube.com/watch?v= URL to embed format", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("https://www.youtube.com/watch?v=abc123")).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  it("converts a youtu.be short link to embed format", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("https://youtu.be/abc123")).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  it("passes through an already-embedded URL unchanged", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    const embed = "https://www.youtube.com/embed/abc123?rel=0";
    expect(toEmbedUrl(embed)).toBe(embed);
  });

  it("returns an empty string for empty input without throwing", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("")).toBe("");
  });

  it("strips extra query params (timestamp, playlist) from a watch URL", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("https://www.youtube.com/watch?v=abc123&t=30s&list=PLabc")).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  it("strips extra query params from a youtu.be short link", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("https://youtu.be/abc123?t=30")).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  it("returns an empty string for a Vimeo URL instead of passing it through", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("https://vimeo.com/123456789")).toBe("");
  });

  it("returns an empty string for an unrecognised domain", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("https://example.com/video/abc")).toBe("");
  });

  it("returns an empty string for a bare domain without a recognised video ID", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("https://dailymotion.com/video/x7abc")).toBe("");
  });

  it("returns an empty string for a non-YouTube domain that has a ?v= param (bypass attempt)", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("https://example.com/?v=abc123")).toBe("");
  });

  it("returns an empty string for a deceptive subdomain like youtube.com.evil.com", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("https://youtube.com.evil.com/watch?v=abc123")).toBe("");
  });

  it("returns an empty string for a domain that contains 'youtube.com/embed/' in the path but is not YouTube", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("https://notyoutube.com/embed/abc123")).toBe("");
  });

  it("returns an empty string for a malformed string that is not a URL", async () => {
    const { toEmbedUrl } = await import("@/hooks/useSpirecutSettings");
    expect(toEmbedUrl("not-a-url-at-all")).toBe("");
  });
});

// ── useSpirecutSettings hook reflects saved value ────────────────────────────

describe("useSpirecutSettings – reflects updated URL after admin saves", () => {
  it("returns the new embed URL once the cache is invalidated and re-fetched", async () => {
    const { useSpirecutSettings } = await import("@/hooks/useSpirecutSettings");

    // Seed the cache with the new URL via a mock API response
    const settingsFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        sp_video_ct_url: VALID_CT_URL,
        sp_video_tf_url: "https://www.youtube.com/embed/QbOlsFMTbJo?rel=0",
        sp_contact_email_de: "info@spirecut.de",
        sp_contact_email_com: "info@spirecut.com",
      }),
    } as Response);

    // Invalidate the module-level cache so the hook re-fetches
    invalidateSpirecutSettingsCache();

    let captured: ReturnType<typeof useSpirecutSettings> | null = null;

    function Probe() {
      captured = useSpirecutSettings();
      return null;
    }

    await act(async () => {
      render(<Probe />);
    });

    await waitFor(() =>
      expect(captured?.sp_video_ct_url).toBe(VALID_CT_URL),
    );

    settingsFetch.mockRestore();
  });
});
