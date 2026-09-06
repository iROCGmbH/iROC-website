import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import Home from "./Home";
import {
  DEFAULT_SENTINEL,
  HIDDEN_SENTINEL,
  invalidateMediaCache,
} from "@/hooks/useMedia";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { returnObjects?: boolean }) =>
      options?.returnObjects ? [] : key,
  }),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/WebAppInstallSection", () => ({
  WebAppInstallSection: () => null,
}));

const placements = [
  {
    key: "instrument-ct-top",
    alt: "home.instrumentCtAlt",
    fallback: `${import.meta.env.BASE_URL}sono-instrument-ct.png`,
  },
  {
    key: "instrument-tf-top",
    alt: "home.instrumentTfAlt",
    fallback: `${import.meta.env.BASE_URL}sono-instrument-tf.png`,
  },
  {
    key: "instrument-ct-condition",
    alt: "home.ctInstrumentAlt",
    fallback: `${import.meta.env.BASE_URL}sono-instrument-ct.png`,
  },
  {
    key: "instrument-tf-condition",
    alt: "home.tfInstrumentAlt",
    fallback: `${import.meta.env.BASE_URL}sono-instrument-tf.png`,
  },
] as const;

let mediaMap: Record<string, string> = {};

function installFetchMock() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/patient-media")) {
      return { ok: true, json: async () => mediaMap } as Response;
    }
    return {
      ok: true,
      json: async () => ({ total: 0, averageRating: null, quotes: [] }),
    } as Response;
  });
}

function renderHomepage(nextMedia: Record<string, string>) {
  mediaMap = nextMedia;
  invalidateMediaCache();
  return render(<Home />);
}

async function waitForHomepageImages() {
  await waitFor(() => {
    for (const placement of placements) {
      expect(screen.getByAltText(placement.alt)).toBeInTheDocument();
    }
  });
}

beforeEach(() => {
  installFetchMock();
  mediaMap = {};
  invalidateMediaCache();
});

afterEach(() => {
  cleanup();
  invalidateMediaCache();
  vi.restoreAllMocks();
});

describe("Spirecut patient homepage instrument media", () => {
  it.each(placements)(
    "applies $key only to its matching homepage placement",
    async (placement) => {
      const customUrl = `https://cdn.example.test/${placement.key}.png`;
      renderHomepage({ [placement.key]: customUrl });

      await waitForHomepageImages();

      expect(screen.getByAltText(placement.alt)).toHaveAttribute(
        "src",
        customUrl,
      );
      for (const otherPlacement of placements) {
        if (otherPlacement.key === placement.key) continue;
        expect(screen.getByAltText(otherPlacement.alt)).not.toHaveAttribute(
          "src",
          customUrl,
        );
      }
    },
  );

  it("prefers a split key over its legacy instrument key", async () => {
    renderHomepage({
      "instrument-ct-top": "https://cdn.example.test/ct-top.png",
      "instrument-tf-top": "https://cdn.example.test/tf-top.png",
      "instrument-ct-condition": "https://cdn.example.test/ct-condition.png",
      "instrument-tf-condition": "https://cdn.example.test/tf-condition.png",
      "instrument-ct": "https://cdn.example.test/legacy-ct.png",
      "instrument-tf": "https://cdn.example.test/legacy-tf.png",
    });

    await waitForHomepageImages();

    expect(screen.getByAltText("home.instrumentCtAlt")).toHaveAttribute(
      "src",
      "https://cdn.example.test/ct-top.png",
    );
    expect(screen.getByAltText("home.ctInstrumentAlt")).toHaveAttribute(
      "src",
      "https://cdn.example.test/ct-condition.png",
    );
    expect(screen.getByAltText("home.instrumentTfAlt")).toHaveAttribute(
      "src",
      "https://cdn.example.test/tf-top.png",
    );
    expect(screen.getByAltText("home.tfInstrumentAlt")).toHaveAttribute(
      "src",
      "https://cdn.example.test/tf-condition.png",
    );
  });

  it("uses the matching legacy instrument key when a split key is absent", async () => {
    renderHomepage({
      "instrument-ct": "https://cdn.example.test/legacy-ct.png",
      "instrument-tf": "https://cdn.example.test/legacy-tf.png",
    });

    await waitForHomepageImages();

    expect(screen.getByAltText("home.instrumentCtAlt")).toHaveAttribute(
      "src",
      "https://cdn.example.test/legacy-ct.png",
    );
    expect(screen.getByAltText("home.ctInstrumentAlt")).toHaveAttribute(
      "src",
      "https://cdn.example.test/legacy-ct.png",
    );
    expect(screen.getByAltText("home.instrumentTfAlt")).toHaveAttribute(
      "src",
      "https://cdn.example.test/legacy-tf.png",
    );
    expect(screen.getByAltText("home.tfInstrumentAlt")).toHaveAttribute(
      "src",
      "https://cdn.example.test/legacy-tf.png",
    );
  });

  it("hides only the placement whose split key is hidden", async () => {
    renderHomepage({
      "instrument-ct-top": HIDDEN_SENTINEL,
    });

    await waitFor(() => {
      expect(screen.queryByAltText("home.instrumentCtAlt")).toBeNull();
      expect(screen.getByAltText("home.ctInstrumentAlt")).toBeInTheDocument();
    });

    expect(screen.getByAltText("home.ctInstrumentAlt")).toHaveAttribute(
      "src",
      `${import.meta.env.BASE_URL}sono-instrument-ct.png`,
    );
  });

  it("returns to the bundled image after a split-key reset", async () => {
    const { rerender } = renderHomepage({
      "instrument-ct-top": "https://cdn.example.test/temporary-ct.png",
    });

    await waitFor(() =>
      expect(screen.getByAltText("home.instrumentCtAlt")).toHaveAttribute(
        "src",
        "https://cdn.example.test/temporary-ct.png",
      ),
    );

    mediaMap = { "instrument-ct-top": DEFAULT_SENTINEL };
    invalidateMediaCache();
    rerender(<Home />);

    await waitFor(() =>
      expect(screen.getByAltText("home.instrumentCtAlt")).toHaveAttribute(
        "src",
        `${import.meta.env.BASE_URL}sono-instrument-ct.png`,
      ),
    );

    mediaMap = {};
    invalidateMediaCache();
    rerender(<Home />);
    await waitFor(() =>
      expect(screen.getByAltText("home.instrumentCtAlt")).toHaveAttribute(
        "src",
        `${import.meta.env.BASE_URL}sono-instrument-ct.png`,
      ),
    );
  });
});