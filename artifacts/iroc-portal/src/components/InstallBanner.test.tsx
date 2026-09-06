import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { InstallBanner } from './InstallBanner';

const DISMISS_KEY = 'iroc_install_banner_dismissed';
const DISMISS_DAYS = 14;
const DAY_MS = 86400000;
const INITIAL_TIME = new Date('2026-09-01T12:00:00.000Z').getTime();
type StandaloneState = {
  displayMode?: boolean;
  navigatorStandalone?: boolean;
};

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (_de: string, en: string) => en,
  }),
}));

function setStandaloneState({
  displayMode = false,
  navigatorStandalone = false,
}: StandaloneState = {}) {
  const matchMedia = vi.fn((query: string) =>
    ({
        matches: query === '(display-mode: standalone)' && displayMode,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: matchMedia,
  });
  Object.defineProperty(window.navigator, 'standalone', {
    configurable: true,
    value: navigatorStandalone,
  });
}

function createInstallPrompt(
  outcome: 'accepted' | 'dismissed' = 'accepted',
) {
  const event = new Event('beforeinstallprompt');
  const prompt = vi.fn().mockResolvedValue(undefined);
  const preventDefault = vi.spyOn(event, 'preventDefault');
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  return { event, prompt, preventDefault };
}

async function dispatchInstallPrompt(event: Event) {
  await act(async () => {
    window.dispatchEvent(event);
  });
}

async function dispatchAppInstalled() {
  await act(async () => {
    window.dispatchEvent(new Event('appinstalled'));
  });
}

beforeEach(() => {
  localStorage.clear();
  setStandaloneState();
  vi.spyOn(Date, 'now').mockReturnValue(INITIAL_TIME);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InstallBanner browser behavior', () => {
  const standaloneBrowserCases: Array<[string, StandaloneState]> = [
    ['display-mode standalone', { displayMode: true }],
    ['iOS navigator standalone', { navigatorStandalone: true }],
  ];

  it.each(standaloneBrowserCases)(
    'does not show in %s mode',
    async (_browser: string, standaloneState: StandaloneState) => {
    setStandaloneState(standaloneState);
    render(<InstallBanner />);

    const installPrompt = createInstallPrompt();
    await dispatchInstallPrompt(installPrompt.event);

    await user.click(screen.getByRole('button', { name: 'Install Now' }));

    expect(installPrompt.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByText('Install iROC app')).not.toBeInTheDocument();
    expect(localStorage.getItem(DISMISS_KEY)).toBe(
      String(Date.now() + DISMISS_DAYS * DAY_MS),
    );
  });

  it('dismisses the exhausted prompt when the browser rejects it', async () => {
    const user = userEvent.setup();
    render(<InstallBanner />);
    const installPrompt = createInstallPrompt();
    installPrompt.prompt.mockRejectedValueOnce(new Error('Prompt unavailable'));
    await dispatchInstallPrompt(installPrompt.event);

    await user.click(screen.getByRole('button', { name: 'Install Now' }));

    expect(installPrompt.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByText('Install iROC app')).not.toBeInTheDocument();
    expect(localStorage.getItem(DISMISS_KEY)).toBe(
      String(Date.now() + DISMISS_DAYS * DAY_MS),
    );
  });

  it('hides and clears dismissal state after browser-led installation', async () => {
    render(<InstallBanner />);
    await dispatchInstallPrompt(createInstallPrompt().event);
    localStorage.setItem(DISMISS_KEY, 'stale-dismissal');

    await dispatchAppInstalled();

    expect(screen.queryByText('Install iROC app')).not.toBeInTheDocument();
    expect(localStorage.getItem(DISMISS_KEY)).toBeNull();
  });

  it('stays hidden after installation when a standalone portal session remounts', async () => {
    const first = render(<InstallBanner />);
    await dispatchInstallPrompt(createInstallPrompt().event);
    await dispatchAppInstalled();
    first.unmount();

    setStandaloneState({ navigatorStandalone: true });
    render(<InstallBanner />);
    const stalePrompt = createInstallPrompt();
    await dispatchInstallPrompt(stalePrompt.event);

    expect(screen.queryByText('Install iROC app')).not.toBeInTheDocument();
    expect(stalePrompt.preventDefault).not.toHaveBeenCalled();
  });

  it('stays hidden after installation when an iOS standalone portal remounts', async () => {
    const first = render(<InstallBanner />);
    await dispatchInstallPrompt(createInstallPrompt().event);
    await dispatchAppInstalled();
    first.unmount();

    setStandaloneState({ navigatorStandalone: true });
    render(<InstallBanner />);
    const stalePrompt = createInstallPrompt();
    await dispatchInstallPrompt(stalePrompt.event);

    expect(screen.queryByText('Install iROC app')).not.toBeInTheDocument();
    expect(stalePrompt.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps the banner hidden for 14 days after dismissal', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<InstallBanner />);
    await dispatchInstallPrompt(createInstallPrompt().event);

    await user.click(screen.getByRole('button', { name: 'Later' }));

    expect(screen.queryByText('Install iROC app')).not.toBeInTheDocument();
    expect(localStorage.getItem(DISMISS_KEY)).toBe(
      String(Date.now() + DISMISS_DAYS * DAY_MS),
    );

    unmount();
    render(<InstallBanner />);
    const duringDismissal = createInstallPrompt();
    await dispatchInstallPrompt(duringDismissal.event);

    expect(screen.queryByText('Install iROC app')).not.toBeInTheDocument();
    expect(duringDismissal.preventDefault).not.toHaveBeenCalled();
  });

  it('allows the banner again after the dismissal period expires', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<InstallBanner />);
    await dispatchInstallPrompt(createInstallPrompt().event);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    unmount();

    vi.mocked(Date.now).mockReturnValue(
      INITIAL_TIME + DISMISS_DAYS * DAY_MS + 1,
    );
    render(<InstallBanner />);
    const afterDismissal = createInstallPrompt();
    await dispatchInstallPrompt(afterDismissal.event);

    expect(afterDismissal.preventDefault).toHaveBeenCalledOnce();
    expect(screen.getByText('Install iROC app')).toBeInTheDocument();
  });
});
