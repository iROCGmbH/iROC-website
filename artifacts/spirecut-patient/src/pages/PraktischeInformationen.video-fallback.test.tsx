/**
 * Tests: PraktischeInformationen video-section fallback
 *
 * Verifies that:
 *  - When both praktisch video URLs are valid YouTube embeds, both iframes render
 *    and the video section is visible.
 *  - When a video URL is empty (SP_DEFAULTS provides ""), that slot's iframe is
 *    hidden (the slot is not rendered at all).
 *  - When a video URL is a non-YouTube URL (toEmbedUrl returns ""), the iframe
 *    is hidden (slot suppressed).
 *  - When both URLs are empty/invalid, the entire video section is hidden.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PraktischeInformationen from "./PraktischeInformationen";
import { invalidateSpirecutSettingsCache } from "@/hooks/useSpirecutSettings";

// ── BroadcastChannel stub ────────────────────────────────────────────────────
class MockBroadcastChannel {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  close() {}
}

// ── i18n stub ────────────────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { returnObjects?: boolean }) => {
      if (key === "praktisch.beforeItems" && opts?.returnObjects) return [];
      if (key === "praktisch.afterItems" && opts?.returnObjects) return [];
      return key;
    },
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_P1_EMBED = "https://www.youtube.com/embed/P1ID?rel=0";
const VALID_P2_EMBED = "https://www.youtube.com/embed/P2ID?rel=0";

/**
 * Stub fetch so useSpirecutSettings returns a controlled set of settings.
 * SP_DEFAULTS leave both praktisch URLs as "", so we must explicitly set them
 * to non-empty values to test the "both present" case.
 */
function mockSettings(overrides: Record<string, string> = {}) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      sp_video_ct_url: "https://www.youtube.com/embed/CTID?rel=0",
      sp_video_tf_url: "https://www.youtube.com/embed/TFID?rel=0",
      sp_video_praktisch_1_url: VALID_P1_EMBED,
      sp_video_praktisch_2_url: VALID_P2_EMBED,
      ...overrides,
    }),
  } as Response);
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
    MockBroadcastChannel;
  invalidateSpirecutSettingsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  invalidateSpirecutSettingsCache();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("PraktischeInformationen – video section fallback", () => {
  it("renders both iframes when both praktisch embed URLs are valid", async () => {
    mockSettings();
    render(<PraktischeInformationen />);

    // Wait for the hook to fetch and re-render
    await new Promise((r) => setTimeout(r, 50));
    // Allow DOM to settle
    await screen.findByText("praktisch.videosTitle", {}, { timeout: 3_000 });

    expect(document.querySelectorAll("iframe")).toHaveLength(2);
    const [iframe1, iframe2] = Array.from(document.querySelectorAll("iframe"));
    expect(iframe1.getAttribute("src")).toBe(VALID_P1_EMBED);
    expect(iframe2.getAttribute("src")).toBe(VALID_P2_EMBED);
  });

  it("renders stored praktisch video titles instead of the translated fallbacks", async () => {
    mockSettings({
      sp_video_praktisch_1_title: "Individuelle Anleitung 1",
      sp_video_praktisch_2_title: "Individuelle Anleitung 2",
    });
    render(<PraktischeInformationen />);

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Individuelle Anleitung 1",
      }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Individuelle Anleitung 2",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "praktisch.video1Title" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "praktisch.video2Title" })).toBeNull();
  });

  it("uses translated praktisch video titles when stored titles are empty or whitespace-only", async () => {
    mockSettings({
      sp_video_praktisch_1_title: "   ",
      sp_video_praktisch_2_title: "     ",
    });
    render(<PraktischeInformationen />);

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "praktisch.video1Title",
      }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "praktisch.video2Title",
      }),
    ).toBeTruthy();
  });

  it("hides slot 1 and shows only slot 2 when sp_video_praktisch_1_url is a non-YouTube URL", async () => {
    mockSettings({ sp_video_praktisch_1_url: "https://vimeo.com/123456789" });
    render(<PraktischeInformationen />);

    // Video section should still appear (video2 is valid)
    await screen.findByText("praktisch.videosTitle", {}, { timeout: 3_000 });

    // Only the second iframe should be rendered
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(document.querySelectorAll("iframe")[0].getAttribute("src")).toBe(VALID_P2_EMBED);
  });

  it("hides slot 2 and shows only slot 1 when sp_video_praktisch_2_url is a non-YouTube URL", async () => {
    mockSettings({ sp_video_praktisch_2_url: "https://dailymotion.com/video/x7abc" });
    render(<PraktischeInformationen />);

    await screen.findByText("praktisch.videosTitle", {}, { timeout: 3_000 });

    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(document.querySelectorAll("iframe")[0].getAttribute("src")).toBe(VALID_P1_EMBED);
  });

  it("hides the entire video section when both praktisch URLs are non-YouTube", async () => {
    mockSettings({
      sp_video_praktisch_1_url: "https://vimeo.com/111",
      sp_video_praktisch_2_url: "https://vimeo.com/222",
    });
    render(<PraktischeInformationen />);

    // Give the hook time to fetch and re-render
    await new Promise((r) => setTimeout(r, 100));

    // No iframes — the video section is fully suppressed
    expect(document.querySelectorAll("iframe")).toHaveLength(0);

    // The video section heading should NOT be in the DOM
    expect(screen.queryByText("praktisch.videosTitle")).toBeNull();
  });

  it("hides the entire video section when SP_DEFAULTS provides empty strings for both praktisch URLs", async () => {
    // The API returns empty strings — SP_DEFAULTS for praktisch URLs is ""
    // so toEmbedUrl("") returns "" and hasVideos is false.
    mockSettings({
      sp_video_praktisch_1_url: "",
      sp_video_praktisch_2_url: "",
    });
    render(<PraktischeInformationen />);

    await new Promise((r) => setTimeout(r, 100));

    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    expect(screen.queryByText("praktisch.videosTitle")).toBeNull();
  });
});
