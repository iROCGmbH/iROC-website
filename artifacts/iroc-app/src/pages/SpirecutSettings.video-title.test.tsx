import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SpirecutSettings from './SpirecutSettings';

const language = vi.hoisted(() => ({ lang: 'en' as 'en' | 'de' }));
const adminGet = vi.hoisted(() => vi.fn());
const adminPost = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

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
}));

afterEach(() => {
  language.lang = 'en';
  adminGet.mockReset();
  adminPost.mockClear();
  vi.restoreAllMocks();
});

function stubSettingsFetch(repairCount = 0, acknowledgedCount = 0) {
  adminGet.mockResolvedValue({
    settings: {},
    repair: {
      legacyPracticalVideoTitlesRepaired: repairCount,
      legacyPracticalVideoTitlesAcknowledged: acknowledgedCount,
    },
  });
}

function saveButtonFor(input: HTMLElement): HTMLButtonElement {
  return input.parentElement?.querySelector('button') as HTMLButtonElement;
}

describe('SpirecutSettings practical video titles', () => {
  it('shows the legacy repair count in English', async () => {
    stubSettingsFetch(2);
    render(<SpirecutSettings />);

    expect(await screen.findByText(/2 legacy practical video titles were automatically repaired/i)).toBeInTheDocument();
  });

  it('shows the legacy repair count in German', async () => {
    language.lang = 'de';
    stubSettingsFetch(1);
    render(<SpirecutSettings />);

    expect(await screen.findByText(/1 historische Titel für praktische Videos automatisch bereinigt/i)).toBeInTheDocument();
  });

  it('acknowledges the notice without clearing the recorded repair count', async () => {
    stubSettingsFetch(2);
    adminPost.mockResolvedValueOnce({ ok: true, acknowledged: 2 });
    render(<SpirecutSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge notice' }));

    await waitFor(() => {
      expect(adminPost).toHaveBeenCalledWith(
        '/api/admin/spirecut-settings/acknowledge-title-repairs',
        'test-token',
        {},
      );
      expect(screen.queryByText(/2 legacy practical video titles/i)).not.toBeInTheDocument();
    });
  });

  it('keeps an acknowledged notice hidden until the cumulative repair count increases', async () => {
    stubSettingsFetch(2, 2);
    const first = render(<SpirecutSettings />);
    await waitFor(() => expect(adminGet).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Acknowledge notice' })).not.toBeInTheDocument();
    first.unmount();

    stubSettingsFetch(3, 2);
    render(<SpirecutSettings />);
    expect(await screen.findByText(/3 legacy practical video titles/i)).toBeInTheDocument();
  });

  it('normalizes a whitespace-only title to empty and explains it in English', async () => {
    stubSettingsFetch();
    render(<SpirecutSettings />);

    const input = await screen.findByPlaceholderText('z. B. Karpaltunnelsyndrom – Eingriff');
    fireEvent.change(input, { target: { value: '   \t' } });
    fireEvent.click(saveButtonFor(input));

    await waitFor(() => {
      expect(adminPost).toHaveBeenCalledWith(
        '/api/admin/spirecut-settings',
        'test-token',
        { key: 'sp_video_praktisch_1_title', value: '' },
      );
    });
    expect(input).toHaveValue('');
    expect(screen.getByText(/contained only whitespace and was saved as empty/i)).toBeInTheDocument();
  });

  it('shows the whitespace normalization guidance in German', async () => {
    language.lang = 'de';
    stubSettingsFetch();
    render(<SpirecutSettings />);

    const input = await screen.findByPlaceholderText('z. B. Karpaltunnelsyndrom – Eingriff');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(saveButtonFor(input));

    expect(await screen.findByText(/enthielt nur Leerzeichen und wurde als leer gespeichert/i)).toBeInTheDocument();
  });

  it('sends a non-blank custom title unchanged', async () => {
    stubSettingsFetch();
    render(<SpirecutSettings />);

    const input = await screen.findByPlaceholderText('z. B. Schnappfinger – Eingriff');
    const title = '  Individuelle Anleitung  ';
    fireEvent.change(input, { target: { value: title } });
    fireEvent.click(saveButtonFor(input));

    await waitFor(() => {
      expect(adminPost).toHaveBeenCalledWith(
        '/api/admin/spirecut-settings',
        'test-token',
        { key: 'sp_video_praktisch_2_title', value: title },
      );
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });
});