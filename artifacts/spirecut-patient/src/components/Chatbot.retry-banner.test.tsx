/**
 * Chatbot.retry-banner.test.tsx
 *
 * Confirms the amber error banner disappears after a successful retry, and
 * that the chat contains exactly one user message and one assistant reply
 * (no duplicates) after the retry completes.
 *
 * Strategy
 * ─────────
 * 1. Mock fetch so the first message request yields a retryable stream error
 *    (`{ error: "test", retryable: true }`).
 * 2. Open the chat, send a message, and assert the amber banner + Retry button
 *    are visible.
 * 3. Switch the fetch mock so the next request succeeds with a normal SSE reply.
 * 4. Click Retry and wait for the stream to finish.
 * 5. Assert:
 *    - The amber banner is gone.
 *    - The chat shows exactly one user bubble and one assistant bubble.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import Chatbot from './Chatbot';

// ── Mock ChatbotPDF ───────────────────────────────────────────────────────────
vi.mock('./ChatbotPDF', () => ({
  ChatbotPDFDownload: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href="#" data-testid="pdf-download-link" className={className}>
      {children}
    </a>
  ),
}));

// ── Mock react-i18next ────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => key,
  }),
}));

// ── jsdom stub ────────────────────────────────────────────────────────────────
Element.prototype.scrollIntoView = vi.fn();

// ── SSE stream helpers ────────────────────────────────────────────────────────

function makeErrorStream(retryable: boolean): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(
        enc.encode(`data: ${JSON.stringify({ error: 'test', retryable })}\n`)
      );
      controller.close();
    },
  });
}

function makeSuccessStream(content: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ content })}\n`));
      controller.enqueue(enc.encode('data: {"done":true}\n'));
      controller.close();
    },
  });
}

// ── fetch mock factory ────────────────────────────────────────────────────────

/**
 * Sets up a fetch mock where:
 *  - /api/patient-settings → {}
 *  - POST /api/gemini/conversations → { id: 1 }
 *  - POST /api/gemini/conversations/1/messages → determined by `messageHandler`
 */
function setupFetchMock(
  messageHandler: () => Response | Promise<Response>
): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/patient-settings')) {
        return { ok: true, json: async () => ({}) } as Response;
      }

      if (
        url.includes('/api/gemini/conversations') &&
        init?.method === 'POST' &&
        !url.match(/\/conversations\/\d+\/messages$/)
      ) {
        return { ok: true, json: async () => ({ id: 1 }) } as Response;
      }

      if (url.match(/\/api\/gemini\/conversations\/\d+\/messages$/)) {
        return messageHandler();
      }

      return { ok: true, json: async () => ({}) } as Response;
    }
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Chatbot – retry error banner clears after successful retry', () => {
  it('banner disappears and exactly one user + one assistant bubble remain after retry', async () => {
    // ── Phase 1: first request yields a retryable stream error ────────────────
    let callCount = 0;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/api/patient-settings')) {
          return { ok: true, json: async () => ({}) } as Response;
        }

        if (
          url.includes('/api/gemini/conversations') &&
          init?.method === 'POST' &&
          !url.match(/\/conversations\/\d+\/messages$/)
        ) {
          return { ok: true, json: async () => ({ id: 1 }) } as Response;
        }

        if (url.match(/\/api\/gemini\/conversations\/\d+\/messages$/)) {
          callCount++;
          if (callCount === 1) {
            // First call: retryable error
            return {
              ok: true,
              body: makeErrorStream(true),
            } as unknown as Response;
          }
          // Second call (retry): success
          return {
            ok: true,
            body: makeSuccessStream('Spirecut® is a minimally invasive procedure.'),
          } as unknown as Response;
        }

        return { ok: true, json: async () => ({}) } as Response;
      }
    );

    render(<Chatbot />);

    // Open the chat panel
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);

    // Send a message
    fireEvent.change(textarea, { target: { value: 'What is Spirecut?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // ── Assert: amber banner with Retry button is visible ─────────────────────
    await waitFor(() => {
      expect(
        screen.getByText(/spiro is temporarily unavailable/i)
      ).toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /retry/i });
    expect(retryButton).toBeInTheDocument();

    // ── Phase 2: click Retry — second request succeeds ────────────────────────
    await act(async () => {
      fireEvent.click(retryButton);
      // Allow the async generator loop to finish processing
      await new Promise((r) => setTimeout(r, 50));
    });

    // ── Assert: banner is gone ─────────────────────────────────────────────────
    await waitFor(() => {
      expect(
        screen.queryByText(/spiro is temporarily unavailable/i)
      ).toBeNull();
    });

    // No Retry button in the DOM
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();

    // ── Assert: exactly one user bubble and one assistant bubble ───────────────
    await waitFor(() => {
      expect(
        screen.getByText('Spirecut® is a minimally invasive procedure.')
      ).toBeInTheDocument();
    });

    // User message appears exactly once
    const userBubbles = screen.getAllByText('What is Spirecut?');
    expect(userBubbles).toHaveLength(1);

    // Assistant content appears exactly once
    const assistantBubbles = screen.getAllByText(
      'Spirecut® is a minimally invasive procedure.'
    );
    expect(assistantBubbles).toHaveLength(1);

    expect(fetchSpy).toHaveBeenCalledTimes(
      // patient-settings (1) + create conversation (1) + first message (1) + retry message (1)
      4
    );
  });

  it('banner stays visible if the retry also fails', async () => {
    let callCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/api/patient-settings')) {
          return { ok: true, json: async () => ({}) } as Response;
        }

        if (
          url.includes('/api/gemini/conversations') &&
          init?.method === 'POST' &&
          !url.match(/\/conversations\/\d+\/messages$/)
        ) {
          return { ok: true, json: async () => ({ id: 1 }) } as Response;
        }

        if (url.match(/\/api\/gemini\/conversations\/\d+\/messages$/)) {
          callCount++;
          // Both calls fail with a retryable error
          return {
            ok: true,
            body: makeErrorStream(true),
          } as unknown as Response;
        }

        return { ok: true, json: async () => ({}) } as Response;
      }
    );

    render(<Chatbot />);

    // Open chat
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);

    // Send a message — first request fails
    fireEvent.change(textarea, { target: { value: 'What is Spirecut?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // Banner appears
    await waitFor(() => {
      expect(
        screen.getByText(/spiro is temporarily unavailable/i)
      ).toBeInTheDocument();
    });

    // Click retry — second request also fails
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      await new Promise((r) => setTimeout(r, 50));
    });

    // Banner must still be visible after the failed retry
    await waitFor(() => {
      expect(
        screen.getByText(/spiro is temporarily unavailable/i)
      ).toBeInTheDocument();
    });

    expect(callCount).toBe(2);
  });

  it('non-retryable error banner shows no Retry button', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/api/patient-settings')) {
          return { ok: true, json: async () => ({}) } as Response;
        }

        if (
          url.includes('/api/gemini/conversations') &&
          init?.method === 'POST' &&
          !url.match(/\/conversations\/\d+\/messages$/)
        ) {
          return { ok: true, json: async () => ({ id: 1 }) } as Response;
        }

        if (url.match(/\/api\/gemini\/conversations\/\d+\/messages$/)) {
          // Non-retryable error
          return {
            ok: true,
            body: makeErrorStream(false),
          } as unknown as Response;
        }

        return { ok: true, json: async () => ({}) } as Response;
      }
    );

    render(<Chatbot />);

    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);

    fireEvent.change(textarea, { target: { value: 'What is Spirecut?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // Non-retryable banner uses a different message
    await waitFor(() => {
      expect(
        screen.getByText(/error fetching response/i)
      ).toBeInTheDocument();
    });

    // No Retry button for non-retryable errors
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});
