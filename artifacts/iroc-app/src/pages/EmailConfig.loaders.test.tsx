import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmailConfig from './EmailConfig';

const session = vi.hoisted(() => ({ token: null as string | null }));
const language = vi.hoisted(() => ({ lang: 'en' as 'en' | 'de' }));
const adminGet = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => session }));
vi.mock('@/hooks/use-language', () => ({ useLanguage: () => language }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/admin-fetch', () => ({
  adminGet,
  adminPost: vi.fn(),
  adminPut: vi.fn(),
  adminDelete: vi.fn(),
}));
vi.mock('@/components/email-signatures/EmailSignatureDesigner', () => ({
  EmailSignatureDesigner: () => null,
}));

afterEach(() => {
  session.token = null;
  language.lang = 'en';
  adminGet.mockReset();
  toast.mockReset();
  vi.unstubAllGlobals();
});

function successfulRequests() {
  adminGet.mockImplementation((path: string) => {
    if (path === '/api/admin/email-delivery-settings') {
      return Promise.resolve([{ purpose: 'general', provider: 'smtp', microsoftMailbox: null }]);
    }
    if (path === '/api/admin/sally/settings') return Promise.resolve({});
    return Promise.resolve([]);
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(nextResolve => { resolve = nextResolve; });
  return { promise, resolve };
}

describe('EmailConfig settings loaders', () => {
  it('loads every settings group once when a session becomes available without duplicating on state or language changes', async () => {
    successfulRequests();
    const { rerender } = render(<EmailConfig />);

    expect(adminGet).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    session.token = 'session-a';
    rerender(<EmailConfig />);

    await waitFor(() => {
      expect(adminGet).toHaveBeenCalledTimes(4);
      expect(fetch).toHaveBeenCalledTimes(3);
    });
    for (const path of [
      '/api/admin/email-settings',
      '/api/admin/sally/settings',
      '/api/admin/microsoft-365-mailboxes',
      '/api/admin/email-delivery-settings',
    ]) {
      expect(adminGet).toHaveBeenCalledWith(path, 'session-a');
      expect(adminGet.mock.calls.filter(([calledPath]) => calledPath === path)).toHaveLength(1);
    }

    fireEvent.change(screen.getByLabelText('Your test address'), {
      target: { value: 'admin@example.com' },
    });
    language.lang = 'de';
    rerender(<EmailConfig />);

    expect(screen.getByLabelText('Ihre Testadresse')).toHaveValue('admin@example.com');
    expect(adminGet).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not let a previous session replace email settings loaded by the current session', async () => {
    const first = deferred<{ key: string; label: string; email: string; defaultEmail: string }[]>();
    const second = deferred<{ key: string; label: string; email: string; defaultEmail: string }[]>();
    adminGet.mockImplementation((path: string, token: string) => {
      if (path === '/api/admin/email-settings') return token === 'session-a' ? first.promise : second.promise;
      if (path === '/api/admin/email-delivery-settings') return Promise.resolve([]);
      if (path === '/api/admin/sally/settings') return Promise.resolve({});
      return Promise.resolve([]);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    session.token = 'session-a';
    const { rerender } = render(<EmailConfig />);

    session.token = 'session-b';
    rerender(<EmailConfig />);
    second.resolve([{ key: 'recipient', label: 'Current recipient', email: 'current@example.com', defaultEmail: '' }]);
    expect(await screen.findByDisplayValue('current@example.com')).toBeInTheDocument();

    first.resolve([{ key: 'recipient', label: 'Previous recipient', email: 'previous@example.com', defaultEmail: '' }]);
    await waitFor(() => expect(screen.queryByDisplayValue('previous@example.com')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('current@example.com')).toBeInTheDocument();
  });

  it.each([
    ['en', 'Could not load mailboxes', 'Could not load delivery settings'],
    ['de', 'Postfächer konnten nicht geladen werden', 'Versandeinstellungen konnten nicht geladen werden'],
  ] as const)('keeps mailbox and delivery load errors bilingual in %s', async (lang, mailboxTitle, deliveryTitle) => {
    language.lang = lang;
    session.token = 'session-a';
    adminGet.mockImplementation((path: string) => {
      if (path === '/api/admin/microsoft-365-mailboxes' || path === '/api/admin/email-delivery-settings') {
        return Promise.reject(new Error('unavailable'));
      }
      return Promise.resolve(path === '/api/admin/sally/settings' ? {} : []);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    render(<EmailConfig />);

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({ variant: 'destructive', title: mailboxTitle });
      expect(toast).toHaveBeenCalledWith({ variant: 'destructive', title: deliveryTitle });
    });
  });
});