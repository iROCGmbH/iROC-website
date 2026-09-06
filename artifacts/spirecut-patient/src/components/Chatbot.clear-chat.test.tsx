/**
 * Chatbot.clear-chat.test.tsx
 *
 * Confirms the PDF download button disappears immediately after the user
 * clicks "Clear chat", and that no stale PDFDownloadLink remains in the DOM.
 *
 * Strategy
 * ─────────
 * 1. Mock @react-pdf/renderer via the ChatbotPDF module boundary so we avoid
 *    canvas / worker dependencies that don't exist in jsdom.
 * 2. Mock fetch to:
 *      - /api/patient-settings → empty object (default starters used)
 *      - POST /api/gemini/conversations → { id: 1 }
 *      - POST /api/gemini/conversations/1/messages → SSE stream with one
 *        content chunk + done signal
 * 3. Open the chat panel, type a message, submit it, and wait for the
 *    streaming assistant reply to finish.
 * 4. Assert the download button is now visible.
 * 5. Click the trash/clear button.
 * 6. Assert the download button is gone and no PDFDownloadLink anchor remains.
 * 7. Verify a message sent after clearing creates and uses a new conversation,
 *    and that the old session's response is not rendered in the new session.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import Chatbot from './Chatbot';

// ── Mock ChatbotPDF ───────────────────────────────────────────────────────────
// Replace PDFDownloadLink with a plain <a> so we can query it in jsdom without
// needing canvas / react-pdf worker threads.
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

// ── jsdom stubs ───────────────────────────────────────────────────────────────
// jsdom does not implement scrollIntoView; stub it to avoid TypeError.
Element.prototype.scrollIntoView = vi.fn();

// ── SSE stream helper ─────────────────────────────────────────────────────────
function makeSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(enc.encode(line));
      }
      controller.close();
    },
  });
}

// ── fetch mock ────────────────────────────────────────────────────────────────
function setupFetchMock(
  conversationIds: number[] = [1],
  streamFactory?: (conversationId: number) => ReadableStream<Uint8Array>,
) {
  let conversationIndex = 0;

  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      // Patient settings
      if (url.includes('/api/patient-settings')) {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      // Create conversation
      if (
        url.includes('/api/gemini/conversations') &&
        init?.method === 'POST' &&
        !url.match(/\/conversations\/\d+\/messages$/)
      ) {
        const id = conversationIds[Math.min(conversationIndex++, conversationIds.length - 1)];
        return {
          ok: true,
          json: async () => ({ id }),
        } as Response;
      }

      // Stream messages
      if (url.match(/\/api\/gemini\/conversations\/\d+\/messages$/)) {
        const conversationId = Number(url.match(/\/conversations\/(\d+)\/messages$/)?.[1]);
        const response = conversationId === conversationIds[0]
          ? 'Old session response'
          : 'Fresh session response';
        const stream = streamFactory?.(conversationId) ?? makeSSEStream([
          `data: ${JSON.stringify({ content: response })}\n`,
          'data: {"done":true}\n',
        ]);
        return {
          ok: true,
          body: stream,
        } as unknown as Response;
      }

      return { ok: true, json: async () => ({}) } as Response;
    },
  );
}

function makeDeferredSSEStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    },
  });
  const encode = (line: string) => new TextEncoder().encode(line);

  return {
    stream,
    enqueue(line: string) {
      if (!controller || closed) return;
      controller.enqueue(encode(line));
    },
    close() {
      if (!controller || closed) return;
      closed = true;
      controller.close();
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Chatbot – PDF download button visibility after clear', () => {
  it('download button disappears immediately after clearing the chat', async () => {
    setupFetchMock();
    render(<Chatbot />);

    // 1. Open the chat panel
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));

    // 2. Confirm the panel is open (textarea is present)
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);
    expect(textarea).toBeInTheDocument();

    // 3. Type a message and submit
    fireEvent.change(textarea, { target: { value: 'Tell me about Spirecut' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // 4. Wait for the streaming reply to complete (download button appears)
    await waitFor(() => {
      expect(screen.getByTestId('pdf-download-link')).toBeInTheDocument();
    });

    // 5. Click the clear/trash button
    const clearBtn = screen.getByTitle(/clear chat/i);
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    // 6. Download button must be gone — no stale PDFDownloadLink anchor either
    expect(screen.queryByTestId('pdf-download-link')).toBeNull();
  });

  it('no PDFDownloadLink anchor remains in the DOM after clear', async () => {
    setupFetchMock();
    render(<Chatbot />);

    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);
    fireEvent.change(textarea, { target: { value: 'What is Spirecut?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    // Wait for download button to appear (assistant reply received)
    await waitFor(() => {
      expect(screen.getByTestId('pdf-download-link')).toBeInTheDocument();
    });

    // Clear the chat
    await act(async () => {
      fireEvent.click(screen.getByTitle(/clear chat/i));
    });

    // No anchor at all — even a detached one would show in queryAll
    expect(screen.queryAllByTestId('pdf-download-link')).toHaveLength(0);
  });

  it('download button reappears if the user sends another message after clearing', async () => {
    setupFetchMock();
    render(<Chatbot />);

    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);

    // First conversation
    fireEvent.change(textarea, { target: { value: 'First question' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => {
      expect(screen.getByTestId('pdf-download-link')).toBeInTheDocument();
    });

    // Clear
    await act(async () => {
      fireEvent.click(screen.getByTitle(/clear chat/i));
    });
    expect(screen.queryByTestId('pdf-download-link')).toBeNull();

    // Second conversation — button must come back
    fireEvent.change(textarea, { target: { value: 'Second question' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => {
      expect(screen.getByTestId('pdf-download-link')).toBeInTheDocument();
    });
  });

  it('creates and uses a fresh conversation after clearing the chat', async () => {
    const fetchMock = setupFetchMock([101, 202]);
    render(<Chatbot />);

    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);

    // First session uses conversation 101.
    fireEvent.change(textarea, { target: { value: 'First session question' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => {
      expect(screen.getByText('Old session response')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle(/clear chat/i));
    });
    expect(screen.queryByText('Old session response')).toBeNull();

    // After clear, the next message must create conversation 202 and use it.
    fireEvent.change(textarea, { target: { value: 'Fresh session question' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => {
      expect(screen.getByText('Fresh session response')).toBeInTheDocument();
    });

    const conversationCreates = fetchMock.mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url === '/api/gemini/conversations' && init?.method === 'POST';
    });
    expect(conversationCreates).toHaveLength(2);
    expect(JSON.parse(String(conversationCreates[1][1]?.body))).toMatchObject({
      title: 'Fresh session question',
    });

    const messagePosts = fetchMock.mock.calls.filter(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString();
      return /\/api\/gemini\/conversations\/\d+\/messages$/.test(url) && init?.method === 'POST';
    });
    expect(messagePosts.map(([input]) => String(input))).toEqual([
      '/api/gemini/conversations/101/messages',
      '/api/gemini/conversations/202/messages',
    ]);
    expect(JSON.parse(String(messagePosts[1][1]?.body))).toMatchObject({
      content: 'Fresh session question',
    });
    expect(screen.queryByText('Old session response')).toBeNull();
  });

  it('keeps the cleared chat empty while the old response is still streaming', async () => {
    const oldStream = makeDeferredSSEStream();
    const fetchMock = setupFetchMock([303, 404], (conversationId) => {
      if (conversationId === 303) return oldStream.stream;
      return makeSSEStream([
        `data: ${JSON.stringify({ content: 'Fresh session response' })}\n`,
        'data: {"done":true}\n',
      ]);
    });
    render(<Chatbot />);

    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);

    fireEvent.change(textarea, { target: { value: 'Old session question' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/gemini/conversations/303/messages')).toBe(true);
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle(/clear chat/i));
    });
    expect(screen.queryByText('Old session response')).toBeNull();

    // A late chunk from the cleared request must not repopulate the chat.
    await act(async () => {
      oldStream.enqueue(`data: ${JSON.stringify({ content: 'Old session response' })}\n`);
    });
    expect(screen.queryByText('Old session response')).toBeNull();

    // Clearing releases the old request's loading lock, so a new session can start.
    fireEvent.change(textarea, { target: { value: 'Fresh session question' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => {
      expect(screen.getByText('Fresh session response')).toBeInTheDocument();
    });

    expect(screen.queryByText('Old session response')).toBeNull();
    const messagePosts = fetchMock.mock.calls.filter(([input, init]) => {
      return /\/api\/gemini\/conversations\/\d+\/messages$/.test(String(input)) && init?.method === 'POST';
    });
    expect(messagePosts.map(([input]) => String(input))).toEqual([
      '/api/gemini/conversations/303/messages',
      '/api/gemini/conversations/404/messages',
    ]);

    await act(async () => {
      oldStream.close();
    });
  });

  it('aborts the in-flight chat request when the chat is cleared', async () => {
    const oldStream = makeDeferredSSEStream();
    const fetchMock = setupFetchMock([505], () => oldStream.stream);
    render(<Chatbot />);

    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);
    fireEvent.change(textarea, { target: { value: 'Cancel this request' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) =>
        String(input) === '/api/gemini/conversations/505/messages',
      )).toBe(true);
    });
    const messageRequest = fetchMock.mock.calls.find(([input]) =>
      String(input) === '/api/gemini/conversations/505/messages',
    );
    const signal = messageRequest?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    fireEvent.click(screen.getByTitle(/clear chat/i));

    expect(signal?.aborted).toBe(true);
  });
});
