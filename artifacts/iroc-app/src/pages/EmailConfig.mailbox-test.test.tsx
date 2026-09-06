import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmailConfig from './EmailConfig';

const language = vi.hoisted(() => ({ lang: 'en' as 'en' | 'de' }));
const adminGet = vi.hoisted(() => vi.fn());
const adminPost = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('@/hooks/use-language', () => ({
  useLanguage: () => language,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

vi.mock('@/lib/admin-fetch', () => ({
  adminGet,
  adminPost,
  adminPut: vi.fn(),
  adminDelete: vi.fn(),
}));

vi.mock('@/components/email-signatures/EmailSignatureDesigner', () => ({
  EmailSignatureDesigner: () => null,
}));

afterEach(() => {
  language.lang = 'en';
  adminGet.mockReset();
  adminPost.mockReset();
  toast.mockReset();
  vi.unstubAllGlobals();
});

function stubEmailConfigRequests(
  getDeliverySettings: () => Record<string, unknown>[] = () => [
    {
      purpose: 'general',
      provider: 'smtp',
      microsoftMailbox: null,
    },
    {
      purpose: 'website_contact',
      provider: 'smtp',
      microsoftMailbox: null,
    },
  ],
) {
  adminGet.mockImplementation((path: string) => {
    if (path === '/api/admin/microsoft-365-mailboxes') return Promise.resolve([]);
    if (path === '/api/admin/email-delivery-settings') {
      return Promise.resolve(getDeliverySettings());
    }
    if (path === '/api/admin/sally/settings') return Promise.resolve({});
    return Promise.resolve([]);
  });

  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/api/admin/email-settings') ? [] : {};
    return Promise.resolve({
      ok: true,
      json: async () => body,
    });
  }));
}

async function renderMailboxTest(roleLabel = 'Delivery role') {
  stubEmailConfigRequests();
  render(<EmailConfig />);
  return screen.findByRole('combobox', { name: roleLabel });
}

describe('EmailConfig mailbox test', () => {
  it.each([
    {
      lang: 'en' as const,
      roleLabel: 'Delivery role',
      controlledWarning: 'Use only an address you control.',
      rejectedWarning: 'Addresses from customer, patient, lead, and supplier contacts are rejected by the server.',
    },
    {
      lang: 'de' as const,
      roleLabel: 'Versandrolle',
      controlledWarning: 'Verwenden Sie nur eine von Ihnen kontrollierte Adresse.',
      rejectedWarning: 'Adressen aus Kunden-, Patienten-, Lead- und Lieferantenkontakten werden serverseitig abgelehnt.',
    },
  ])(
    'renders the role selector and controlled-recipient warnings in $lang',
    async ({ lang, roleLabel, controlledWarning, rejectedWarning }) => {
      language.lang = lang;

      const roleSelect = await renderMailboxTest(roleLabel);

      expect(roleSelect).toHaveAccessibleName(roleLabel);
      expect(screen.getByText(new RegExp(controlledWarning.replace('.', '\\.'), 'i'))).toBeInTheDocument();
      expect(screen.getByText(new RegExp(rejectedWarning.replace('.', '\\.'), 'i'))).toBeInTheDocument();
    },
  );

  it('sends the selected role and trimmed controlled address while showing loading and success states', async () => {
    const user = userEvent.setup();
    let deliverySettingsRead = 0;
    let resolveTestRequest!: () => void;
    const testRequest = new Promise<void>((resolve) => {
      resolveTestRequest = resolve;
    });
    adminPost.mockImplementation((path: string) => (
      path === '/api/admin/email-delivery-test' ? testRequest : Promise.resolve({})
    ));

    stubEmailConfigRequests(() => {
      deliverySettingsRead += 1;
      return deliverySettingsRead === 1
        ? [{ purpose: 'general', provider: 'smtp', microsoftMailbox: null }]
        : [
            { purpose: 'general', provider: 'smtp', microsoftMailbox: null },
            { purpose: 'website_contact', provider: 'smtp', microsoftMailbox: null },
          ];
    });
    render(<EmailConfig />);
    const roleSelect = await screen.findByRole('combobox', { name: 'Delivery role' });
    const recipientInput = screen.getByLabelText('Your test address');
    const sendButton = screen.getByRole('button', { name: 'Send test' });

    await user.type(recipientInput, '  admin@example.com  ');
    await user.click(sendButton);

    expect(sendButton).toBeDisabled();
    expect(sendButton).toHaveTextContent('Send test');
    await waitFor(() => {
      expect((roleSelect as HTMLSelectElement).querySelector('option[value="website_contact"]')).not.toBeNull();
    });
    expect(adminPost).toHaveBeenCalledWith(
      '/api/admin/email-delivery-test',
      'test-token',
      { purpose: 'general', to: 'admin@example.com' },
    );

    resolveTestRequest();
    await waitFor(() => {
      expect(sendButton).toBeEnabled();
      expect(toast).toHaveBeenCalledWith({
        title: 'Test email sent',
        description: 'admin@example.com',
      });
    });
  });

  it('keeps the failure state bilingual when the mailbox test fails', async () => {
    language.lang = 'de';
    adminPost.mockImplementation((path: string) => (
      path === '/api/admin/email-delivery-test'
        ? Promise.reject(new Error('Mailbox unavailable'))
        : Promise.resolve({})
    ));

    const roleSelect = await renderMailboxTest('Versandrolle');
    fireEvent.change(roleSelect, { target: { value: 'website_contact' } });
    fireEvent.change(screen.getByLabelText('Ihre Testadresse'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test senden' }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({
        variant: 'destructive',
        title: 'Test-E-Mail fehlgeschlagen',
        description: 'Error: Mailbox unavailable',
      });
    });
    expect(screen.getByRole('button', { name: 'Test senden' })).toBeEnabled();
  });

  it.each([
    {
      lang: 'en' as const,
      roleLabel: 'Delivery role',
      title: 'Delivery role unavailable',
      description: 'The selected delivery role is no longer available. Please choose a current role.',
    },
    {
      lang: 'de' as const,
      roleLabel: 'Versandrolle',
      title: 'Versandrolle nicht verfügbar',
      description: 'Die ausgewählte Versandrolle ist nicht mehr verfügbar. Bitte wählen Sie eine aktuelle Rolle.',
    },
  ])(
    'refreshes roles and blocks a stale $lang test selection',
    async ({ lang, roleLabel, title, description }) => {
      language.lang = lang;
      const user = userEvent.setup();
      let deliverySettingsRead = 0;
      stubEmailConfigRequests(() => {
        deliverySettingsRead += 1;
        return deliverySettingsRead === 1
          ? [
              { purpose: 'general', provider: 'smtp', microsoftMailbox: null },
              { purpose: 'website_contact', provider: 'smtp', microsoftMailbox: null },
            ]
          : [{ purpose: 'general', provider: 'smtp', microsoftMailbox: null }];
      });
      render(<EmailConfig />);

      const roleSelect = await screen.findByRole('combobox', { name: roleLabel });
      await user.selectOptions(roleSelect, 'website_contact');
      await user.type(
        screen.getByLabelText(lang === 'de' ? 'Ihre Testadresse' : 'Your test address'),
        'admin@example.com',
      );
      await user.click(screen.getByRole('button', { name: lang === 'de' ? 'Test senden' : 'Send test' }));

      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith({
          variant: 'destructive',
          title,
          description,
        });
      });
      expect(roleSelect).toHaveValue('general');
      expect(adminPost).not.toHaveBeenCalledWith(
        '/api/admin/email-delivery-test',
        expect.anything(),
        expect.anything(),
      );
    },
  );
});