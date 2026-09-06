/**
 * Chatbot.streaming-pdf-guard.test.tsx
 *
 * Confirms the PDF download button is hidden while the assistant reply is still
 * streaming (cursor visible) and only appears once streaming has finished.
 *
 * Strategy
 * ─────────
 * 1. Mock @react-pdf/renderer via the ChatbotPDF module boundary.
 * 2. Provide a controlled SSE stream that we can pause mid-stream so the
 *    component stays in the streaming state long enough to assert against.
 * 3. While the streaming cursor is active → download button must be absent.
 * 4. Once the stream delivers done:true → download button must appear.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates an SSE stream that sends an initial content chunk immediately, then
 * pauses until `release()` is called before delivering the done signal.
 */
function makePausableSSEStream(): {
  stream: ReadableStream<Uint8Array>;
  release: () => void;
} {
  let releaseResolve!: () => void;
  const released = new Promise<void>((res) => { releaseResolve = res; });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      // Deliver first content chunk immediately so the bubble exists + is streaming
      controller.enqueue(enc.encode('data: {"content":"Partial reply…"}\n'));
      // Wait until the test releases the hold
      await released;
      // Now deliver done
      controller.enqueue(enc.encode('data: {"done":true}\n'));
      controller.close();
    },
  });

  return { stream, release: releaseResolve };
}

function setupFetchMock(streamFactory: () => { stream: ReadableStream<Uint8Array>; release: () => void }) {
  let ctl = streamFactory();

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
        // Re-use the same controlled stream on every call
        const { stream } = ctl;
        return { ok: true, body: stream } as unknown as Response;
      }

      return { ok: true, json: async () => ({}) } as Response;
    },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Chatbot – PDF download button hidden during streaming', () => {
  it('keeps all answer fragments visible while removing repeated follow-up markers', async () => {
    const enc = new TextEncoder();
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
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(enc.encode('data: {"content":"Before <!-- SPIRO_FOLLOWUPS: [\\"First suggestion\\"] -->"}\n'));
              controller.enqueue(enc.encode('data: {"content":" between <!-- SPIRO_FOLLOWUPS: [\\"Second suggestion\\"] --> after"}\n'));
              controller.enqueue(enc.encode('data: {"done":true}\n'));
              controller.close();
            },
          });
          return { ok: true, body: stream } as unknown as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      },
    );

    render(<Chatbot />);
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);
    fireEvent.change(textarea, { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/Before\s+between\s+after/)).toBeInTheDocument();
      expect(screen.getByText('First suggestion')).toBeInTheDocument();
      expect(screen.getByText('Second suggestion')).toBeInTheDocument();
    });
    expect(screen.queryByText(/SPIRO_FOLLOWUPS/)).not.toBeInTheDocument();
  });

  it('download button is absent while streaming cursor is visible', async () => {
    const { stream, release } = makePausableSSEStream();
    // Provide the stream; wrap in a factory so setupFetchMock can reference it
    setupFetchMock(() => ({ stream, release }));

    render(<Chatbot />);

    // Open the chat panel
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);

    // Send a message
    fireEvent.change(textarea, { target: { value: 'Tell me about Spirecut' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // Wait for the streaming cursor to appear inside the assistant bubble.
    // The cursor is rendered as a <span class="animate-pulse"> sibling of the text.
    await waitFor(() => {
      const pulsing = document.querySelector('.animate-pulse');
      expect(pulsing).toBeInTheDocument();
    });

    // While the cursor is visible the download button must NOT be present
    expect(screen.queryByTestId('pdf-download-link')).toBeNull();

    // Release the stream so done:true is delivered
    await act(async () => {
      release();
      // Allow the async generator loop to finish processing
      await new Promise((r) => setTimeout(r, 50));
    });

    // Now the cursor should be gone and the download button should appear
    await waitFor(() => {
      expect(screen.getByTestId('pdf-download-link')).toBeInTheDocument();
    });

    // And the streaming cursor must be gone
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });

  it('download button never shows if a second message starts streaming while the first is done', async () => {
    // First message: instant stream (done immediately)
    const enc = new TextEncoder();
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
          if (callCount === 1) {
            // First call: complete immediately
            const s = new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(enc.encode('data: {"content":"First answer"}\n'));
                c.enqueue(enc.encode('data: {"done":true}\n'));
                c.close();
              },
            });
            return { ok: true, body: s } as unknown as Response;
          } else {
            // Second call: pause indefinitely (stays streaming)
            const s = new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(enc.encode('data: {"content":"Second answer…"}\n'));
                // never closes — stays streaming
              },
            });
            return { ok: true, body: s } as unknown as Response;
          }
        }
        return { ok: true, json: async () => ({}) } as Response;
      },
    );

    render(<Chatbot />);

    // Open chat
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);

    // First message — wait for download button to appear
    fireEvent.change(textarea, { target: { value: 'First question' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByTestId('pdf-download-link')).toBeInTheDocument();
    });

    // Second message — button should disappear while streaming
    fireEvent.change(textarea, { target: { value: 'Second question' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // Give the second stream a moment to start
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Streaming cursor active → download button must be hidden
    await waitFor(() => {
      expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('pdf-download-link')).toBeNull();
  });
});
