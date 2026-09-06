/**
 * Confirms a persisted partial assistant response is rendered after a reload.
 *
 * The first mount receives a truncated stream, then the second mount fetches the
 * same conversation through GET /api/gemini/conversations/:id. The assertions
 * make sure reload does not duplicate or drop either message and does not mark
 * the completed partial response as still streaming.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Chatbot from './Chatbot';

vi.mock('./ChatbotPDF', () => ({
  ChatbotPDFDownload: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => key,
  }),
}));

Element.prototype.scrollIntoView = vi.fn();

const conversationId = 73;
const userContent = 'What should I expect during recovery?';
const partialAssistantContent = 'Recovery is usually gradual, but this answer was cut off';
const followUps = ['What happens next?', 'When can I return to work?'];
const persistedAssistantContent = `${partialAssistantContent} <!-- SPIRO_FOLLOWUPS: ${JSON.stringify(followUps)} -->`;
const malformedPersistedAssistantContent = `${partialAssistantContent} <!-- SPIRO_FOLLOWUPS: ["What happens next?"`;
const multipleMarkerAssistantContent = [
  'The first answer fragment remains visible.',
  `<!-- SPIRO_FOLLOWUPS: ${JSON.stringify(['What happens next?'])} -->`,
  'The middle answer fragment remains visible.',
  `<!-- SPIRO_FOLLOWUPS: ${JSON.stringify(['When can I return to work?'])} -->`,
  'The final answer fragment remains visible.',
].join(' ');

function makeSSEStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ content: partialAssistantContent })}\n`,
      ));
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ error: 'stream ended unexpectedly', retryable: false })}\n`,
      ));
      controller.close();
    },
  });
}

function makeCompletedSSEStream(content: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ content })}\n`,
      ));
      controller.enqueue(encoder.encode('data: {"done":true}\n'));
      controller.close();
    },
  });
}

function conversationHistory(assistantContent = persistedAssistantContent) {
  return {
    id: conversationId,
    title: userContent,
    createdAt: '2026-08-31T10:00:00.000Z',
    messages: [
      {
        id: 501,
        conversationId,
        role: 'user',
        content: userContent,
        createdAt: '2026-08-31T10:00:01.000Z',
      },
      {
        id: 502,
        conversationId,
        role: 'assistant',
        content: assistantContent,
        createdAt: '2026-08-31T10:00:02.000Z',
      },
    ],
  };
}

function setupFetchMock(assistantContent = persistedAssistantContent) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('/api/patient-settings')) {
        return { ok: true, json: async () => ({}) } as Response;
      }

      if (url === '/api/gemini/conversations' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ id: conversationId }),
        } as Response;
      }

      if (url === `/api/gemini/conversations/${conversationId}/messages`) {
        return {
          ok: true,
          body: makeSSEStream(),
        } as unknown as Response;
      }

      if (url === `/api/gemini/conversations/${conversationId}` && !init?.method) {
        return {
          ok: true,
          json: async () => conversationHistory(assistantContent),
        } as Response;
      }

      return { ok: true, json: async () => ({}) } as Response;
    },
  );
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Chatbot – conversation history after reload', () => {
  it('renders the persisted assistant message and its follow-up chips after reload', async () => {
    const fetchSpy = setupFetchMock();
    const firstMount = render(<Chatbot />);

    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);
    fireEvent.change(textarea, { target: { value: userContent } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(partialAssistantContent)).toBeInTheDocument();
    });
    expect(screen.getAllByText(userContent)).toHaveLength(1);
    expect(screen.getAllByText(partialAssistantContent)).toHaveLength(1);
    expect(document.querySelector('.animate-pulse')).toBeNull();
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(localStorage.getItem('spirecut_chat_conversation_id')).toBe(String(conversationId));

    firstMount.unmount();
    render(<Chatbot />);
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));

    await waitFor(() => {
      expect(screen.getByText(partialAssistantContent)).toBeInTheDocument();
    });
    expect(screen.getAllByText(userContent)).toHaveLength(1);
    expect(screen.getAllByText(partialAssistantContent)).toHaveLength(1);
    expect(screen.getByText('You might also ask')).toBeInTheDocument();
    for (const followUp of followUps) {
      expect(screen.getByRole('button', { name: followUp })).toBeInTheDocument();
    }
    expect(document.querySelector('.animate-pulse')).toBeNull();
    expect(document.querySelector('.animate-spin')).toBeNull();

    expect(fetchSpy.mock.calls.some(([input, init]) =>
      String(input) === `/api/gemini/conversations/${conversationId}` && !init?.method,
    )).toBe(true);
  });

  it('keeps the persisted answer visible without chips when follow-up metadata is incomplete', async () => {
    localStorage.setItem('spirecut_chat_conversation_id', String(conversationId));
    setupFetchMock(malformedPersistedAssistantContent);

    render(<Chatbot />);
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));

    await waitFor(() => {
      expect(screen.getByText(partialAssistantContent)).toBeInTheDocument();
    });

    expect(screen.queryByText('You might also ask')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'What happens next?' })).not.toBeInTheDocument();
  });

  it('removes every complete follow-up marker while preserving answer fragments after reload', async () => {
    localStorage.setItem('spirecut_chat_conversation_id', String(conversationId));
    setupFetchMock(multipleMarkerAssistantContent);

    render(<Chatbot />);
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));

    await waitFor(() => {
      expect(screen.getByText(
        /The first answer fragment remains visible\.\s+The middle answer fragment remains visible\.\s+The final answer fragment remains visible\./,
      )).toBeInTheDocument();
    });

    expect(screen.queryByText(/SPIRO_FOLLOWUPS/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What happens next?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'When can I return to work?' })).toBeInTheDocument();
  });

  it('clears a deleted conversation and starts a fresh chat after reload', async () => {
    const staleConversationId = conversationId;
    const freshConversationId = 202;
    const freshResponse = 'This is a fresh conversation.';
    localStorage.setItem('spirecut_chat_conversation_id', String(staleConversationId));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/api/patient-settings')) {
          return { ok: true, json: async () => ({}) } as Response;
        }

        if (url === `/api/gemini/conversations/${staleConversationId}` && !init?.method) {
          return { ok: false, status: 404 } as Response;
        }

        if (url === '/api/gemini/conversations' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: freshConversationId }),
          } as Response;
        }

        if (url === `/api/gemini/conversations/${freshConversationId}/messages`) {
          return {
            ok: true,
            body: makeCompletedSSEStream(freshResponse),
          } as unknown as Response;
        }

        return { ok: true, json: async () => ({}) } as Response;
      },
    );

    render(<Chatbot />);
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));

    await waitFor(() => {
      expect(localStorage.getItem('spirecut_chat_conversation_id')).toBeNull();
    });
    expect(screen.getByText(/I answer your questions about the Spirecut/i)).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/ask spiro/i);
    fireEvent.change(textarea, { target: { value: 'Start over, please.' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(freshResponse)).toBeInTheDocument();
    });
    expect(localStorage.getItem('spirecut_chat_conversation_id')).toBe(String(freshConversationId));
    expect(fetchSpy.mock.calls.some(([input, init]) =>
      String(input) === '/api/gemini/conversations' && init?.method === 'POST',
    )).toBe(true);
    expect(fetchSpy.mock.calls.some(([input]) =>
      String(input) === `/api/gemini/conversations/${freshConversationId}/messages`,
    )).toBe(true);
  });

  it('keeps a saved conversation and retries after a temporary history failure', async () => {
    localStorage.setItem('spirecut_chat_conversation_id', String(conversationId));
    let historyAttempts = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/api/patient-settings')) {
          return { ok: true, json: async () => ({}) } as Response;
        }

        if (url === `/api/gemini/conversations/${conversationId}` && !init?.method) {
          historyAttempts += 1;
          if (historyAttempts === 1) {
            return { ok: false, status: 503 } as Response;
          }
          return {
            ok: true,
            json: async () => conversationHistory(),
          } as Response;
        }

        return { ok: true, json: async () => ({}) } as Response;
      },
    );

    render(<Chatbot />);
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/saved chat could not be loaded/i);
    });
    expect(localStorage.getItem('spirecut_chat_conversation_id')).toBe(String(conversationId));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask spiro/i)).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText(partialAssistantContent)).toBeInTheDocument();
    });
    expect(historyAttempts).toBe(2);
    expect(localStorage.getItem('spirecut_chat_conversation_id')).toBe(String(conversationId));
    expect(fetchSpy.mock.calls.some(([input, init]) =>
      String(input) === '/api/gemini/conversations' && init?.method === 'POST',
    )).toBe(false);
  });

  it('starts a separate chat without overwriting the saved conversation', async () => {
    const freshConversationId = 202;
    const freshResponse = 'This is a separate conversation.';
    localStorage.setItem('spirecut_chat_conversation_id', String(conversationId));
    let historyAttempts = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();

        if (url.includes('/api/patient-settings')) {
          return { ok: true, json: async () => ({}) } as Response;
        }

        if (url === `/api/gemini/conversations/${conversationId}` && !init?.method) {
          historyAttempts += 1;
          return historyAttempts === 1
            ? { ok: false, status: 503 } as Response
            : { ok: true, json: async () => conversationHistory() } as Response;
        }

        if (url === '/api/gemini/conversations' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ id: freshConversationId }),
          } as Response;
        }

        if (url === `/api/gemini/conversations/${freshConversationId}/messages`) {
          return {
            ok: true,
            body: makeCompletedSSEStream(freshResponse),
          } as unknown as Response;
        }

        return { ok: true, json: async () => ({}) } as Response;
      },
    );

    const firstMount = render(<Chatbot />);
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/saved chat could not be loaded/i);
    });

    fireEvent.click(screen.getByRole('button', { name: /start a new conversation/i }));
    expect(localStorage.getItem('spirecut_chat_conversation_id')).toBe(String(conversationId));
    expect(screen.getByText(/I answer your questions about the Spirecut/i)).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/ask spiro/i);
    fireEvent.change(textarea, { target: { value: 'Ask something else' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(freshResponse)).toBeInTheDocument();
    });
    expect(localStorage.getItem('spirecut_chat_conversation_id')).toBe(String(conversationId));
    expect(fetchSpy.mock.calls.some(([input]) =>
      String(input) === `/api/gemini/conversations/${freshConversationId}/messages`,
    )).toBe(true);

    firstMount.unmount();
    render(<Chatbot />);
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));

    await waitFor(() => {
      expect(screen.getByText(partialAssistantContent)).toBeInTheDocument();
    });
    expect(historyAttempts).toBe(2);
  });
});
