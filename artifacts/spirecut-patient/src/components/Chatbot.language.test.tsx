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

function makeSSEStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"content":"English response"}\n'));
      controller.enqueue(encoder.encode('data: {"done":true}\n'));
      controller.close();
    },
  });
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Chatbot language contract', () => {
  it('sends the selected English language with an open question', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/patient-settings')) {
          return { ok: true, json: async () => ({}) } as Response;
        }
        if (url.endsWith('/api/gemini/conversations') && init?.method === 'POST') {
          return { ok: true, json: async () => ({ id: 1 }) } as Response;
        }
        if (url.match(/\/api\/gemini\/conversations\/\d+\/messages$/)) {
          return { ok: true, body: makeSSEStream() } as unknown as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      },
    );

    render(<Chatbot />);
    fireEvent.click(screen.getByRole('button', { name: /open spiro/i }));
    const textarea = await screen.findByPlaceholderText(/ask spiro/i);
    fireEvent.change(textarea, { target: { value: 'What happens during recovery?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(screen.getByText('English response')).toBeInTheDocument());

    const messageRequest = fetchSpy.mock.calls.find(([input]) =>
      String(input).match(/\/api\/gemini\/conversations\/\d+\/messages$/),
    );
    expect(messageRequest).toBeDefined();
    expect(JSON.parse(String(messageRequest?.[1]?.body))).toEqual({
      content: 'What happens during recovery?',
      language: 'en',
    });
  });
});