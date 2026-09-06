/**
 * hero-image-upload.test.tsx
 *
 * Verifies the hero background image upload flow in the real WebsiteSettingsTab.
 *
 * Scenarios:
 * 1. Hero presign request fails → "Upload fehlgeschlagen" toast, existing URL unchanged.
 * 2. GCS presigned PUT returns non-2xx → same error behaviour.
 * 3. Admin auto-save POST fails after a successful upload → URL still unchanged.
 * 4. Happy path: all steps succeed → URL input shows new value, success toast,
 *    POST body includes both value (absolute URL) and objectPath.
 *
 * Production fix verified here: setVals (URL update) now occurs AFTER the
 * admin settings POST succeeds, so any earlier failure leaves the field intact.
 *
 * Updated: hero upload calls POST /api/storage/uploads/request-url/hero
 * (not requestUploadUrl) so it writes to the hero-images/ namespace.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { WebsiteSettingsTab } from '@/pages/Admin';

// ── Constants ─────────────────────────────────────────────────────────────────

const FAKE_TOKEN    = 'test-admin-secret';
const EXISTING_URL  = 'https://storage.example.com/hero-existing.jpg';
const GCS_PUT_URL   = 'https://storage.googleapis.com/bucket/presigned-hero';
// Path returned by the hero upload endpoint (hero-images namespace + UUID)
const HERO_UUID     = '550e8400-e29b-41d4-a716-446655440000';
const OBJECT_PATH   = `/objects/hero-images/${HERO_UUID}`;
// The frontend prepends window.location.origin (Vite jsdom default: http://localhost:3000)
const NEW_URL       = `http://localhost:3000/api/storage${OBJECT_PATH}`;
const HERO_PRESIGN_PATH = '/api/storage/uploads/request-url/hero';

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockToast = vi.fn();

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return { ...actual };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderTab() {
  return render(
    <LanguageProvider>
      <WebsiteSettingsTab token={FAKE_TOKEN} />
    </LanguageProvider>,
  );
}

async function waitForLoaded() {
  await waitFor(() => {
    expect(
      screen.getByText(/Hero-Hintergrundbild|Hero Background Image/i),
    ).toBeInTheDocument();
  });
}

function selectHeroFile(file = new File(['x'], 'hero.jpg', { type: 'image/jpeg' })) {
  const input = document.querySelector(
    'input[type="file"][accept=".avif,.gif,.jpg,.jpeg,.png,.webp"]',
  ) as HTMLInputElement;
  expect(input).not.toBeNull();
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  return file;
}

function makeFileWithSize(size: number) {
  const file = new File(['x'], 'hero-too-large.jpg', { type: 'image/jpeg' });
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
}

function heroInputValue(): string {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="url"]');
  return inputs[0]?.value ?? '';
}

/**
 * Build a fetch spy that routes requests:
 *  - /content/iroc                   → LanguageContext CMS, returns {}
 *  - /website-settings (public)      → settings load, returns EXISTING_URL
 *  - HERO_PRESIGN_PATH               → presignOk controls ok/fail
 *  - GCS_PUT_URL                     → gcsPutOk controls ok/fail
 *  - admin/website-settings          → adminSaveOk controls ok/fail
 */
function buildFetchMock(opts: { presignOk: boolean; gcsPutOk: boolean; adminSaveOk: boolean }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;

    if (url.includes('/content/iroc')) {
      return { ok: true, json: async () => ({}) } as Response;
    }
    if (url.includes('website-settings') && !url.includes('admin')) {
      return {
        ok: true,
        json: async () => ({ ws_hero_image_url: EXISTING_URL }),
      } as Response;
    }
    if (url.includes(HERO_PRESIGN_PATH)) {
      if (!opts.presignOk) return { ok: false, status: 500, json: async () => ({}) } as Response;
      return {
        ok: true,
        json: async () => ({ uploadURL: GCS_PUT_URL, objectPath: OBJECT_PATH }),
      } as Response;
    }
    if (url === GCS_PUT_URL) {
      return { ok: opts.gcsPutOk, status: opts.gcsPutOk ? 200 : 403 } as Response;
    }
    if (url.includes('admin/website-settings')) {
      return {
        ok: opts.adminSaveOk,
        status: opts.adminSaveOk ? 200 : 500,
        json: async () => (opts.adminSaveOk ? { ok: true } : { error: 'error' }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Failure: hero presign request fails
// ═══════════════════════════════════════════════════════════════════════════════

describe('hero upload – step 1 fails: hero presign request fails', () => {
  beforeEach(() => {
    buildFetchMock({ presignOk: false, gcsPutOk: false, adminSaveOk: false });
  });

  it('loads the existing hero URL into the URL input', async () => {
    renderTab();
    await waitForLoaded();
    expect(heroInputValue()).toBe(EXISTING_URL);
  });

  it('shows the destructive "Upload fehlgeschlagen" toast', async () => {
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          title: 'Upload fehlgeschlagen',
        }),
      );
    });
  });

  it('does not show the success toast', async () => {
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    const success = mockToast.mock.calls.find(
      ([a]) => a?.title === 'Bild hochgeladen & gespeichert',
    );
    expect(success).toBeUndefined();
  });

  it('leaves the hero URL input unchanged after a failed presign request', async () => {
    renderTab();
    await waitForLoaded();
    expect(heroInputValue()).toBe(EXISTING_URL);

    await act(() => { selectHeroFile(); });
    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    expect(heroInputValue()).toBe(EXISTING_URL);
  });

  it('does not call the GCS PUT or admin-save endpoints', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch') as ReturnType<typeof vi.spyOn>;
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const calledUrls = (fetchSpy.mock.calls as [string | Request][]).map(
      ([u]) => (typeof u === 'string' ? u : (u as Request).url),
    );
    expect(calledUrls.some((u) => u === GCS_PUT_URL)).toBe(false);
    expect(calledUrls.some((u) => u.includes('admin/website-settings'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Failure: GCS presigned PUT returns non-2xx
// ═══════════════════════════════════════════════════════════════════════════════

describe('hero upload – step 2 fails: GCS PUT returns non-2xx', () => {
  beforeEach(() => {
    buildFetchMock({ presignOk: true, gcsPutOk: false, adminSaveOk: true });
  });

  it('shows the destructive "Upload fehlgeschlagen" toast', async () => {
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive', title: 'Upload fehlgeschlagen' }),
      );
    });
  });

  it('leaves the hero URL input showing the existing URL after a failed GCS PUT', async () => {
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(heroInputValue()).toBe(EXISTING_URL);
  });

  it('does not call the admin-save endpoint after a failed GCS PUT', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch') as ReturnType<typeof vi.spyOn>;
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const calledUrls = (fetchSpy.mock.calls as [string | Request][]).map(
      ([u]) => (typeof u === 'string' ? u : (u as Request).url),
    );
    expect(calledUrls.some((u) => u.includes('admin/website-settings'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Failure: admin settings POST fails after a successful GCS upload
// ═══════════════════════════════════════════════════════════════════════════════

describe('hero upload – step 3 fails: admin settings POST returns non-2xx', () => {
  beforeEach(() => {
    buildFetchMock({ presignOk: true, gcsPutOk: true, adminSaveOk: false });
  });

  it('shows the destructive "Upload fehlgeschlagen" toast', async () => {
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive', title: 'Upload fehlgeschlagen' }),
      );
    });
  });

  it('leaves the hero URL input showing the original URL when the save POST fails', async () => {
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(heroInputValue()).toBe(EXISTING_URL);
  });

  it('does not show the success toast when the save fails', async () => {
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    const success = mockToast.mock.calls.find(
      ([a]) => a?.title === 'Bild hochgeladen & gespeichert',
    );
    expect(success).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Happy path: all steps succeed
// ═══════════════════════════════════════════════════════════════════════════════

describe('hero upload – happy path: all steps succeed', () => {
  beforeEach(() => {
    buildFetchMock({ presignOk: true, gcsPutOk: true, adminSaveOk: true });
  });

  it('shows the "Bild hochgeladen & gespeichert" success toast', async () => {
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Bild hochgeladen & gespeichert' }),
      );
    });
  });

  it('updates the hero URL input to the new absolute object-storage URL', async () => {
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => expect(heroInputValue()).toBe(NEW_URL));
  });

  it('does not show a destructive toast on success', async () => {
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    const error = mockToast.mock.calls.find(([a]) => a?.variant === 'destructive');
    expect(error).toBeUndefined();
  });

  it('calls the dedicated hero presign endpoint with correct file metadata and auth token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch') as ReturnType<typeof vi.spyOn>;
    renderTab();
    await waitForLoaded();
    const file = new File(['x'], 'hero.jpg', { type: 'image/jpeg' });
    await act(() => { selectHeroFile(file); });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const presignCall = (fetchSpy.mock.calls as [string, RequestInit][]).find(([url]) =>
      (url as string).includes(HERO_PRESIGN_PATH),
    );
    expect(presignCall).toBeDefined();
    expect(presignCall![1].method).toBe('POST');
    const body = JSON.parse(presignCall![1].body as string);
    expect(body).toMatchObject({ name: 'hero.jpg', size: 1, contentType: 'image/jpeg' });
    const headers = presignCall![1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it('issues a POST to admin/website-settings with the absolute URL, objectPath, and correct auth', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch') as ReturnType<typeof vi.spyOn>;
    renderTab();
    await waitForLoaded();
    await act(() => { selectHeroFile(); });

    await waitFor(() => expect(mockToast).toHaveBeenCalled());

    const saveCall = (fetchSpy.mock.calls as [string, RequestInit][]).find(([url]) =>
      (url as string).includes('admin/website-settings'),
    );
    expect(saveCall).toBeDefined();
    expect(saveCall![1].method).toBe('POST');
    const body = JSON.parse(saveCall![1].body as string);
    expect(body.key).toBe('ws_hero_image_url');
    // Value must be absolute (http/https) so the server URL validator accepts it
    expect(body.value).toBe(NEW_URL);
    // objectPath is sent so the server can scope cleanup to hero-images/ namespace
    expect(body.objectPath).toBe(OBJECT_PATH);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Validation: oversized files are rejected before presigning
// ═══════════════════════════════════════════════════════════════════════════════

describe('hero upload – oversized files are rejected before the presign request', () => {
  it('shows a size-limit toast and does not request an upload URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    buildFetchMock({ presignOk: true, gcsPutOk: true, adminSaveOk: true });
    renderTab();
    await waitForLoaded();

    await act(() => {
      selectHeroFile(makeFileWithSize(10 * 1024 * 1024 + 1));
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'Datei zu groß – max. 10 MB',
      }),
    );
    const calledUrls = (fetchSpy.mock.calls as [string | Request][]).map(
      ([u]) => (typeof u === 'string' ? u : (u as Request).url),
    );
    expect(calledUrls.some((url) => url.includes(HERO_PRESIGN_PATH))).toBe(false);
  });
});
