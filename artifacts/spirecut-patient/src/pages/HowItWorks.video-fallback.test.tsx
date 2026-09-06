/**
 * Tests: HowItWorks video-player fallback
 *
 * Verifies that:
 *  - When both video URLs resolve to a valid embed URL, the iframes are rendered
 *  - When a video URL is empty (stored setting is blank), the iframe is hidden
 *    and a placeholder is shown instead
 *  - When a video URL is a non-YouTube URL (toEmbedUrl returns ""), the same
 *    placeholder appears instead of a broken iframe
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import HowItWorks from "./HowItWorks";
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
      if (key === "how.steps" && opts?.returnObjects) return [];
      if (key === "how.videoUnavailable") return "Video nicht verfügbar";
      return key;
    },
  }),
}));

// ── wouter stub ─────────────────────────────────────────────────────────────
vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_CT_EMBED = "https://www.youtube.com/embed/CTID?rel=0";
const VALID_TF_EMBED = "https://www.youtube.com/embed/TFID?rel=0";

/** Stub fetch so useSpirecutSettings returns a controlled set of settings. */
function mockSettings(overrides: Record<string, string> = {}) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      sp_video_ct_url: VALID_CT_EMBED,
      sp_video_tf_url: VALID_TF_EMBED,
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

describe("HowItWorks – video player fallback", () => {
  it("renders iframes when both embed URLs are valid", async () => {
    mockSettings();
    render(<HowItWorks />);

    // Wait for iframes to appear
    const iframes = await screen.findAllByRole("presentation", {}, { timeout: 3_000 }).catch(() =>
      // jsdom may not give iframes a role — query by tag instead
      Promise.resolve(document.querySelectorAll("iframe")),
    );
    // There should be exactly 2 iframes (CT + TF)
    expect(document.querySelectorAll("iframe")).toHaveLength(2);

    // No fallback placeholders should be visible
    expect(screen.queryAllByTestId("video-unavailable")).toHaveLength(0);
  });

  it("hides the CT iframe and shows a placeholder when sp_video_ct_url is empty", async () => {
    // The API returns an empty string for the CT slot; the hook strips it and
    // SP_DEFAULTS kicks in. But the task's scenario is that the STORED value is
    // something toEmbedUrl cannot turn into a valid embed (e.g. a non-YouTube
    // URL that was saved before validation was added). We simulate this by
    // returning a non-YouTube URL — useSpirecutSettings passes it through as-is
    // and toEmbedUrl in the component will then return "".
    //
    // Actually: the hook calls toEmbedUrl on the sp_video_ct_url value before
    // storing it only in the Admin. The hook itself stores the raw value
    // and toEmbedUrl is applied at render time in HowItWorks. So we return a
    // non-YouTube URL from the API to simulate a bad stored URL.
    mockSettings({ sp_video_ct_url: "https://vimeo.com/123456789" });

    render(<HowItWorks />);

    // Wait for the settings to load (hook re-renders the component)
    const placeholder = await screen.findByTestId("video-unavailable", {}, { timeout: 3_000 });
    expect(placeholder).toBeTruthy();
    expect(placeholder.textContent).toMatch(/nicht verfügbar/i);

    // Only one iframe (TF slot) should be present; CT slot renders the placeholder
    await screen.findAllByRole("img").catch(() => null); // Wait for render to settle
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(document.querySelectorAll("iframe")[0].getAttribute("src")).toBe(VALID_TF_EMBED);
  });

  it("hides the TF iframe and shows a placeholder when sp_video_tf_url resolves to empty", async () => {
    mockSettings({ sp_video_tf_url: "https://dailymotion.com/video/x7abc" });

    render(<HowItWorks />);

    const placeholder = await screen.findByTestId("video-unavailable", {}, { timeout: 3_000 });
    expect(placeholder).toBeTruthy();

    // Only the CT iframe should remain
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(document.querySelectorAll("iframe")[0].getAttribute("src")).toBe(VALID_CT_EMBED);
  });

  it("shows two placeholders when both stored URLs are non-YouTube", async () => {
    mockSettings({
      sp_video_ct_url: "https://vimeo.com/111",
      sp_video_tf_url: "https://vimeo.com/222",
    });

    render(<HowItWorks />);

    // findAllByTestId resolves as soon as the first placeholder is present.
    // Wait for the completed async settings update, which replaces both
    // default video iframes in the same render.
    await waitFor(() => {
      expect(screen.getAllByTestId("video-unavailable")).toHaveLength(2);
      expect(document.querySelectorAll("iframe")).toHaveLength(0);
    });
  });

  it("falls back to the default embed URL (from SP_DEFAULTS) when the API returns an empty string", async () => {
    // The hook strips empty strings and merges SP_DEFAULTS, so the component
    // still gets a valid YouTube embed URL and renders an iframe normally.
    mockSettings({ sp_video_ct_url: "" });

    render(<HowItWorks />);

    // Give the hook time to fetch
    await new Promise((r) => setTimeout(r, 50));

    // Both iframes should be present because SP_DEFAULTS provides the fallback
    expect(document.querySelectorAll("iframe")).toHaveLength(2);
    expect(screen.queryAllByTestId("video-unavailable")).toHaveLength(0);
  });
});
