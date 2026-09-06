import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PortalDesign from './PortalDesign';
import PortalNavConfig from './PortalNavConfig';

const session = vi.hoisted(() => ({ token: null as string | null }));
const language = vi.hoisted(() => ({ lang: 'en' as 'en' | 'de' }));
const adminRequest = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => session }));
vi.mock('@/hooks/use-language', () => ({ useLanguage: () => language }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/admin-fetch', () => ({ adminRequest }));

afterEach(() => {
  session.token = null;
  language.lang = 'en';
  adminRequest.mockReset();
  toast.mockReset();
});

const response = (data: Record<string, string> = {}) => ({
  ok: true,
  status: 200,
  json: async () => data,
});

function deferredResponse() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>(nextResolve => { resolve = nextResolve; });
  return { promise, resolve };
}

describe.each([
  ['portal design', PortalDesign, 'Welcome', 'Welcome Message'],
  ['portal navigation', PortalNavConfig, 'Home', 'Doctor Portal – Navigation'],
] as const)('%s loader', (_name, Page, stateText, readyText) => {
  it('loads once when the session appears and ignores ordinary state and language changes', async () => {
    adminRequest.mockResolvedValue(response({
      portal_welcome_en: 'Welcome',
      portal_nav_config: JSON.stringify([{ id: 'order', visible: true }]),
    }));
    const { rerender } = render(<Page />);

    expect(adminRequest).not.toHaveBeenCalled();
    session.token = 'session-a';
    rerender(<Page />);

    await screen.findByText(readyText);
    expect(adminRequest).toHaveBeenCalledTimes(1);
    expect(adminRequest).toHaveBeenCalledWith('/api/admin/portal-settings', 'session-a');

    const control = screen.queryByDisplayValue(stateText)
      ?? screen.queryAllByRole('switch', { name: /visible/i }).find(item => !item.hasAttribute('disabled'))
      ?? null;
    if (control instanceof HTMLInputElement) {
      fireEvent.change(control, { target: { value: `${stateText} updated` } });
    } else if (control) {
      fireEvent.click(control);
    }
    language.lang = 'de';
    rerender(<Page />);

    expect(adminRequest).toHaveBeenCalledTimes(1);
  });
});

describe('PortalDesign load errors', () => {
  it.each([
    ['en', 'Load failed'],
    ['de', 'Fehler beim Laden'],
  ] as const)('uses the current %s language without reloading for the language change', async (lang, title) => {
    session.token = 'session-a';
    language.lang = lang;
    adminRequest.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const { rerender } = render(<PortalDesign />);

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({ variant: 'destructive', title });
    });
    language.lang = lang === 'en' ? 'de' : 'en';
    rerender(<PortalDesign />);
    expect(adminRequest).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  ['portal design', PortalDesign],
  ['portal navigation', PortalNavConfig],
] as const)('%s session changes', (_name, Page) => {
  it('does not let an older session response overwrite the newer session settings', async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    adminRequest
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    session.token = 'session-a';
    const { rerender } = render(<Page />);

    session.token = 'session-b';
    rerender(<Page />);
    second.resolve(response({
      portal_welcome_en: 'Current administrator',
      portal_nav_config: JSON.stringify([{ id: 'order', visible: false }]),
    }));

    if (Page === PortalDesign) {
      expect(await screen.findByDisplayValue('Current administrator')).toBeInTheDocument();
    } else {
      expect(await screen.findByText('Hidden')).toBeInTheDocument();
    }

    first.resolve(response({
      portal_welcome_en: 'Previous administrator',
      portal_nav_config: JSON.stringify([{ id: 'order', visible: true }]),
    }));

    await waitFor(() => {
      if (Page === PortalDesign) {
        expect(screen.queryByDisplayValue('Previous administrator')).not.toBeInTheDocument();
      } else {
        expect(screen.getByText('Hidden')).toBeInTheDocument();
      }
    });
  });
});