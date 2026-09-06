import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmailSignatureDesigner } from './EmailSignatureDesigner';
import { adminGet, adminPost, adminPut } from '@/lib/admin-fetch';

vi.mock('@/lib/admin-fetch', () => ({
  adminGet: vi.fn(),
  adminPut: vi.fn(),
  adminPost: vi.fn(),
}));

// Mock hooks
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ token: 'fake-token' }),
}));

vi.mock('@/hooks/use-language', () => ({
  useLanguage: () => ({ lang: 'en' }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const toastMock = vi.fn();

describe('EmailSignatureDesigner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('loads existing profiles and allows switching groups, adding column, and saving', async () => {
    const mockAddresses = [
      {
        id: 'addr-1',
        email: 'info@i-roc.de',
        displayName: 'iROC Info',
        descriptionDe: 'Allgemein',
        descriptionEn: 'General',
        brand: 'iroc',
        source: 'smtp',
      },
    ];

    const mockSignatures = [
      {
        group: 'admin',
        enabled: true,
        addressId: 'addr-1',
        thankYouDe: 'Danke DE',
        thankYouEn: 'Thanks EN',
        writerName: 'John Doe',
        writerRoleDe: 'Rolle',
        writerRoleEn: 'Role',
        writerEmail: 'john@i-roc.de',
        writerPhone: '12345',
        logoPath: '/objects/test-logo.png',
        columns: [],
      },
      {
        group: 'sally',
        enabled: false,
        addressId: '',
        thankYouDe: '',
        thankYouEn: '',
        writerName: 'Sally AI',
        writerRoleDe: '',
        writerRoleEn: '',
        writerEmail: '',
        writerPhone: '',
        logoPath: '',
        columns: [],
      },
    ];

    vi.mocked(adminGet).mockResolvedValue({
      addresses: mockAddresses,
      signatures: mockSignatures,
    });

    render(<EmailSignatureDesigner />);

    // Initially loading
    expect(screen.getByTestId('container-loading')).toBeInTheDocument();

    // Wait for load
    await waitFor(() => {
      expect(screen.queryByTestId('container-loading')).not.toBeInTheDocument();
    });

    // Check that 'admin' profile is loaded and displayed in preview
    expect(screen.getByTestId('preview-writername')).toHaveTextContent('John Doe');
    expect(screen.getByTestId('input-writer-name')).toHaveValue('John Doe');

    // Check logo preview URL uses correct /api/storage logic
    const logoImg = screen.getByAltText('Logo');
    expect(logoImg).toHaveAttribute('src', '/api/storage/objects/test-logo.png');

    // Switch to sally
    fireEvent.click(screen.getByTestId('btn-group-sally'));
    
    // Sally preview
    expect(screen.getByTestId('preview-writername')).toHaveTextContent('Sally AI');

    // Add a column to Sally
    const btnAddColumn = screen.getByTestId('btn-add-column');
    fireEvent.click(btnAddColumn);

    const inputTitleEn = screen.getByTestId('input-column-title-en-0');
    fireEvent.change(inputTitleEn, { target: { value: 'New Column' } });
    expect(inputTitleEn).toHaveValue('New Column');

    // Save Sally
    vi.mocked(adminPut).mockResolvedValue({
      group: 'sally',
      enabled: false,
      addressId: '',
      thankYouDe: '',
      thankYouEn: '',
      writerName: 'Sally AI',
      writerRoleDe: '',
      writerRoleEn: '',
      writerEmail: '',
      writerPhone: '',
      logoPath: '',
      columns: [{ id: 'some-id', titleDe: '', titleEn: 'New Column', bodyDe: '', bodyEn: '' }],
    });

    fireEvent.click(screen.getByTestId('btn-save-profile'));
    
    await waitFor(() => {
      expect(adminPut).toHaveBeenCalledWith(
        '/api/admin/email-signatures/sally',
        'fake-token',
        expect.objectContaining({ writerName: 'Sally AI' })
      );
    });
  });

  it('accepts an email-sized logo and uploads it to the logo storage path', async () => {
    vi.mocked(adminGet).mockResolvedValue({ addresses: [], signatures: [] });
    vi.mocked(adminPost).mockResolvedValue({ uploadURL: 'https://storage.test/upload', objectPath: '/objects/logo.png' });
    vi.stubGlobal('Image', class {
      naturalWidth = 120;
      naturalHeight = 40;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
      onload?: () => void;
      onerror?: () => void;
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:logo') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    render(<EmailSignatureDesigner />);
    await waitFor(() => expect(screen.queryByTestId('container-loading')).not.toBeInTheDocument());

    const file = new File(['small logo'], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('input-logo-upload'), { target: { files: [file] } });

    await waitFor(() => expect(adminPost).toHaveBeenCalledWith(
      '/api/storage/uploads/request-url/logo',
      'fake-token',
      expect.objectContaining({ name: 'logo.png', contentType: 'image/png' }),
    ));
  });

  it('rejects a logo that exceeds the email byte limit before requesting storage', async () => {
    vi.mocked(adminGet).mockResolvedValue({ addresses: [], signatures: [] });
    render(<EmailSignatureDesigner />);
    await waitFor(() => expect(screen.queryByTestId('container-loading')).not.toBeInTheDocument());

    const file = new File([new Uint8Array(512 * 1024 + 1)], 'large.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('input-logo-upload'), { target: { files: [file] } });

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Logo needs adjustment',
      description: 'Please use an image no larger than 512 KB and 600 × 200 px.',
    })));
    expect(adminPost).not.toHaveBeenCalled();
  });
});
