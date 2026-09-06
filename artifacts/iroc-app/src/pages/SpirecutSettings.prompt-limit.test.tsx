import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CHATBOT_SYSTEM_PROMPT_MAX_LENGTH } from '@workspace/spirecut-shared';
import SpiroSettings from './SpiroSettings';

const language = vi.hoisted(() => ({ lang: 'en' as 'en' | 'de' }));
const adminGet = vi.hoisted(() => vi.fn());
const adminPost = vi.hoisted(() => vi.fn());
const adminDelete = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('@/hooks/use-language', () => ({
  useLanguage: () => language,
}));

vi.mock('@/hooks/use-site-urls', () => ({
  useSiteUrls: () => ({ spirecutUrl: '/spirecut-patient' }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/admin-fetch', () => ({
  adminGet,
  adminPost,
  adminDelete,
}));

afterEach(() => {
  language.lang = 'en';
  adminGet.mockReset();
  adminPost.mockReset();
  vi.restoreAllMocks();
});

function stubSettingsFetch(prompt = '') {
  adminGet.mockImplementation((path: string) => {
    if (path === '/api/admin/spiro/knowledge') return Promise.resolve([]);
    return Promise.resolve({
      settings: { sp_chatbot_system_prompt: prompt },
      repair: { legacyPracticalVideoTitlesRepaired: 0 },
    });
  });
  return adminGet;
}

describe('SpiroSettings chatbot system prompt limit', () => {
  it('shows the current character count and warns in English near the limit', async () => {
    stubSettingsFetch('initial prompt');
    render(<SpiroSettings />);

    const formattedMaxLength = CHATBOT_SYSTEM_PROMPT_MAX_LENGTH.toLocaleString('en-US');
    expect(await screen.findByText(`14 / ${formattedMaxLength} characters`)).toBeInTheDocument();
    expect(screen.queryByText(/approaching the safe character limit/i)).not.toBeInTheDocument();

    const prompt = screen.getByPlaceholderText('Enter system prompt…');
    const nearLimitPrompt = 'x'.repeat(Math.floor(CHATBOT_SYSTEM_PROMPT_MAX_LENGTH * 0.9));
    fireEvent.change(prompt, { target: { value: nearLimitPrompt } });

    expect(screen.getByText(`${nearLimitPrompt.length.toLocaleString('en-US')} / ${formattedMaxLength} characters`)).toBeInTheDocument();
    expect(screen.getByText(/approaching the safe character limit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save system prompt' })).toBeEnabled();
  });

  it('explains an over-limit prompt and prevents the save request', async () => {
    const adminGetMock = stubSettingsFetch();
    render(<SpiroSettings />);

    const prompt = await screen.findByPlaceholderText('Enter system prompt…');
    fireEvent.change(prompt, { target: { value: 'x'.repeat(CHATBOT_SYSTEM_PROMPT_MAX_LENGTH + 1) } });

    expect(screen.getByText(/The prompt is too long/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save system prompt' })).toBeDisabled();

    await waitFor(() => {
      expect(adminGetMock).toHaveBeenCalledTimes(2);
    });
    expect(adminPost).not.toHaveBeenCalled();
  });

  it('shows the counter and near-limit warning in German', async () => {
    language.lang = 'de';
    stubSettingsFetch();
    render(<SpiroSettings />);

    const prompt = await screen.findByPlaceholderText('System-Prompt eingeben…');
    const nearLimitPrompt = 'x'.repeat(Math.floor(CHATBOT_SYSTEM_PROMPT_MAX_LENGTH * 0.9));
    fireEvent.change(prompt, { target: { value: nearLimitPrompt } });

    expect(screen.getByText(`${nearLimitPrompt.length.toLocaleString('de-DE')} / ${CHATBOT_SYSTEM_PROMPT_MAX_LENGTH.toLocaleString('de-DE')} Zeichen`)).toBeInTheDocument();
    expect(screen.getByText(/nähert sich dem sicheren Zeichenlimit/i)).toBeInTheDocument();
  });
});