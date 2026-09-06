/**
 * Tests for the TestimonialsBlock component.
 *
 * Verifies that:
 *   - The section is completely absent from the DOM when quotes is empty
 *   - The section renders correctly with one approved quote
 *   - The section renders correctly with two approved quotes
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { TestimonialsBlock, FeedbackStrip } from "./Home";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Quote {
  text: string;
  procedure: string;
  rating: number;
}

function mockFetch(quotes: Quote[], total = quotes.length) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      total,
      averageRating: total > 0 ? 4.8 : null,
      quotes,
    }),
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TestimonialsBlock – no approved quotes", () => {
  it("renders nothing when the API returns an empty quotes array", async () => {
    mockFetch([]);

    const { container } = render(<TestimonialsBlock />);

    // Allow the async fetch to resolve
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/patient-postop-stats");
    });

    // The section must be absent from the DOM
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("heading", { name: /patienten/i })).toBeNull();
  });

  it("renders nothing before the fetch completes (initial loading state)", () => {
    // fetch never resolves during this synchronous check
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));

    const { container } = render(<TestimonialsBlock />);

    // data is null → component returns null immediately
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the API returns quotes=[] and total > 0 (all pending)", async () => {
    // All submissions exist but none are approved yet
    mockFetch([], /* total */ 12);

    const { container } = render(<TestimonialsBlock />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(container.firstChild).toBeNull();
  });
});

describe("TestimonialsBlock – one approved quote", () => {
  const singleQuote: Quote = {
    text: "Sehr zufrieden mit dem Ergebnis der Operation.",
    procedure: "ct",
    rating: 5,
  };

  it("renders the testimonials section heading", async () => {
    mockFetch([singleQuote]);

    render(<TestimonialsBlock />);

    await waitFor(() =>
      expect(screen.getByText("Was unsere Patienten sagen")).toBeInTheDocument()
    );
  });

  it("renders the quote text", async () => {
    mockFetch([singleQuote]);

    render(<TestimonialsBlock />);

    await waitFor(() =>
      expect(
        screen.getByText(singleQuote.text)
      ).toBeInTheDocument()
    );
  });

  it("renders the procedure label for ct", async () => {
    mockFetch([singleQuote]);

    render(<TestimonialsBlock />);

    await waitFor(() =>
      expect(screen.getByText("Karpaltunnelsyndrom")).toBeInTheDocument()
    );
  });

  it("renders a star rating for the quote", async () => {
    mockFetch([singleQuote]);

    render(<TestimonialsBlock />);

    await waitFor(() =>
      expect(screen.getByLabelText("5 von 5 Sternen")).toBeInTheDocument()
    );
  });
});

describe("TestimonialsBlock – two approved quotes", () => {
  const twoQuotes: Quote[] = [
    {
      text: "Tolle Erfahrung, kann ich nur empfehlen.",
      procedure: "ct",
      rating: 5,
    },
    {
      text: "Schnelle Erholung und professionelles Team.",
      procedure: "tf",
      rating: 4,
    },
  ];

  it("renders both quote texts", async () => {
    mockFetch(twoQuotes);

    render(<TestimonialsBlock />);

    await waitFor(() =>
      expect(screen.getByText(twoQuotes[0].text)).toBeInTheDocument()
    );

    expect(screen.getByText(twoQuotes[1].text)).toBeInTheDocument();
  });

  it("renders the procedure labels for both ct and tf", async () => {
    mockFetch(twoQuotes);

    render(<TestimonialsBlock />);

    await waitFor(() =>
      expect(screen.getByText("Karpaltunnelsyndrom")).toBeInTheDocument()
    );

    expect(
      screen.getByText("Schnappfinger (Triggerfinger)")
    ).toBeInTheDocument();
  });

  it("renders two blockquote elements", async () => {
    mockFetch(twoQuotes);

    render(<TestimonialsBlock />);

    await waitFor(() => {
      const blockquotes = document.querySelectorAll("blockquote");
      expect(blockquotes.length).toBe(2);
    });
  });
});

// ── FeedbackStrip tests ───────────────────────────────────────────────────────

describe("FeedbackStrip – threshold guard", () => {
  it("renders nothing when total < 5", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ total: 4, averageRating: 4.5, quotes: [] }),
    } as Response);

    const { container } = render(<FeedbackStrip />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/patient-postop-stats"));

    expect(container.firstChild).toBeNull();
  });

  it("renders the rating and count once total >= 5", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ total: 10, averageRating: 4.8, quotes: [] }),
    } as Response);

    render(<FeedbackStrip />);

    await waitFor(() =>
      expect(screen.getByText("⭐ 4.8 / 5 — 10 Patienten")).toBeInTheDocument()
    );
  });

  it("renders nothing when averageRating is null even if total >= 5", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ total: 7, averageRating: null, quotes: [] }),
    } as Response);

    const { container } = render(<FeedbackStrip />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/patient-postop-stats"));

    expect(container.firstChild).toBeNull();
  });
});

describe("TestimonialsBlock – rotation with 3+ quotes", () => {
  const threeQuotes: Quote[] = [
    { text: "Quote A – erste Meinung.", procedure: "ct", rating: 5 },
    { text: "Quote B – zweite Meinung.", procedure: "tf", rating: 4 },
    { text: "Quote C – dritte Meinung.", procedure: "ct", rating: 5 },
  ];

  const fourQuotes: Quote[] = [
    { text: "Quote A – erste Meinung.", procedure: "ct", rating: 5 },
    { text: "Quote B – zweite Meinung.", procedure: "tf", rating: 4 },
    { text: "Quote C – dritte Meinung.", procedure: "ct", rating: 5 },
    { text: "Quote D – vierte Meinung.", procedure: "tf", rating: 3 },
  ];

  beforeEach(() => {
    // Only fake timers (setInterval/setTimeout), NOT Promise microtasks,
    // so mocked fetch Promises still resolve normally.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Flush all pending Promise microtasks so that useEffect / setState settle. */
  async function flushAsync() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("initially shows the first pair (quotes[0] and quotes[1])", async () => {
    mockFetch(threeQuotes);
    render(<TestimonialsBlock />);
    await flushAsync();

    expect(screen.getByText(threeQuotes[0].text)).toBeInTheDocument();
    expect(screen.getByText(threeQuotes[1].text)).toBeInTheDocument();
    expect(screen.queryByText(threeQuotes[2].text)).toBeNull();
  });

  it("shows the second pair after one 6-second interval", async () => {
    mockFetch(threeQuotes);
    render(<TestimonialsBlock />);
    await flushAsync();

    // idx=0: [A, B] verified; now advance one interval → idx=1: [B, C]
    act(() => { vi.advanceTimersByTime(6000); });

    expect(screen.getByText(threeQuotes[1].text)).toBeInTheDocument();
    expect(screen.getByText(threeQuotes[2].text)).toBeInTheDocument();
    expect(screen.queryByText(threeQuotes[0].text)).toBeNull();
  });

  it("wraps back to the first pair after the last pair is shown", async () => {
    mockFetch(threeQuotes);
    render(<TestimonialsBlock />);
    await flushAsync();

    // With 3 quotes, modulo is Math.max(1, 3-1)=2, so idx cycles 0→1→0
    // Advance two intervals → idx wraps back to 0: [A, B]
    act(() => { vi.advanceTimersByTime(12000); });

    expect(screen.getByText(threeQuotes[0].text)).toBeInTheDocument();
    expect(screen.getByText(threeQuotes[1].text)).toBeInTheDocument();
    expect(screen.queryByText(threeQuotes[2].text)).toBeNull();
  });

  it("cycles through all pairs with 4 quotes without showing undefined", async () => {
    mockFetch(fourQuotes);
    render(<TestimonialsBlock />);
    await flushAsync();

    // idx=0: [A, B]
    expect(screen.getByText(fourQuotes[0].text)).toBeInTheDocument();
    expect(screen.getByText(fourQuotes[1].text)).toBeInTheDocument();

    // idx=1: [B, C]
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByText(fourQuotes[1].text)).toBeInTheDocument();
    expect(screen.getByText(fourQuotes[2].text)).toBeInTheDocument();

    // idx=2: [C, D]
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByText(fourQuotes[2].text)).toBeInTheDocument();
    expect(screen.getByText(fourQuotes[3].text)).toBeInTheDocument();

    // idx wraps to 0: [A, B]
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByText(fourQuotes[0].text)).toBeInTheDocument();
    expect(screen.getByText(fourQuotes[1].text)).toBeInTheDocument();
    expect(screen.queryByText(fourQuotes[2].text)).toBeNull();
    expect(screen.queryByText(fourQuotes[3].text)).toBeNull();
  });

  it("always renders exactly two blockquote elements during rotation", async () => {
    mockFetch(threeQuotes);
    render(<TestimonialsBlock />);
    await flushAsync();

    expect(document.querySelectorAll("blockquote").length).toBe(2);

    act(() => { vi.advanceTimersByTime(6000); });
    expect(document.querySelectorAll("blockquote").length).toBe(2);

    act(() => { vi.advanceTimersByTime(6000); });
    expect(document.querySelectorAll("blockquote").length).toBe(2);
  });
});

describe("TestimonialsBlock – fetch error", () => {
  it("renders nothing when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));

    const { container } = render(<TestimonialsBlock />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());

    // Error is swallowed; component stays hidden
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the API responds with a non-ok status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
    } as Response);

    const { container } = render(<TestimonialsBlock />);

    await waitFor(() => expect(fetch).toHaveBeenCalled());

    expect(container.firstChild).toBeNull();
  });
});
