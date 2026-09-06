/**
 * settings-url-validation.test.tsx
 *
 * Verifies that the Settings panel in the Admin page shows an inline error —
 * and blocks the save fetch — when an admin types a dangerous URL
 * (javascript: or data: scheme) into any URL field.
 *
 * Also acts as a regression guard that a valid https:// URL does NOT trigger
 * the error and that the save fetch is called correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { WebsiteSettingsTab } from '@/pages/Admin';

// ── stub heavy dependencies ───────────────────────────────────────────────────

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// requestUploadUrl is imported but only used in the hero-upload flow — not
// exercised here, so stub the whole api-client-react module to prevent real
// HTTP calls from the import side-effects.
vi.mock('@workspace/api-client-react', () => ({
  getTrainingDates: vi.fn(),
  createTrainingDate: vi.fn(),
  deleteTrainingDate: vi.fn(),
  listTrainedDoctors: vi.fn(),
  createTrainedDoctor: vi.fn(),
  updateTrainedDoctor: vi.fn(),
  deleteTrainedDoctor: vi.fn(),
  listResources: vi.fn(),
  createResource: vi.fn(),
  deleteResource: vi.fn(),
  listTeamMembers: vi.fn(),
  createTeamMember: vi.fn(),
  updateTeamMember: vi.fn(),
  deleteTeamMember: vi.fn(),
  requestUploadUrl: vi.fn(),
  listTrainingRegistrations: vi.fn(),
  certifyTrainingRegistration: vi.fn(),
}));

// ── controllable fetch fixture ────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.spyOn>;
type FetchCall = [RequestInfo | URL, ...unknown[]];
const SAVED_MAPS_EMBED_URL =
  'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2662.4!2d11.7!3d48.17!saved-settings';
const ADMIN_SETTINGS_ENDPOINT = '/api/admin/website-settings';
const URL_FIELD_PLACEHOLDERS = [
  'images.unsplash.com',
  '/maps/embed',
  'maps.google.com/\\?q=',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
] as const;

beforeEach(() => {
  // GET /api/website-settings returns a saved Maps URL, while all other
  // settings use the component defaults.
  // POST /api/admin/website-settings returns 200 OK.
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/admin/website-settings')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      // Initial settings load
      return {
        ok: true,
        json: async () => ({ ws_maps_embed_url: SAVED_MAPS_EMBED_URL }),
      } as Response;
    });
});

afterEach(() => {
  localStorage.removeItem('iroc_language');
  vi.restoreAllMocks();
});

// ── wrapper ───────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

function renderTab() {
  return render(
    <Wrapper>
      <WebsiteSettingsTab token="test-token" />
    </Wrapper>
  );
}

// Helper: find the Save button that sits next to a given URL field identified
// by its placeholder substring. The Settings tab renders a distinct <Input>
// and a sibling <Button> for every key; both live inside the same <div>.
async function findSaveButtonForPlaceholder(placeholderFragment: string) {
  const input = await screen.findByPlaceholderText(
    new RegExp(placeholderFragment, 'i'),
  );
  // The button is a sibling inside the same flex container
  const container = input.parentElement!;
  const btn = container.querySelector('button')!;
  return { input, btn };
}

function adminSettingsPostCalls() {
  return (fetchSpy.mock.calls as FetchCall[]).filter(
    ([input, init]: FetchCall) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return (
        url.includes(ADMIN_SETTINGS_ENDPOINT) &&
        (init as RequestInit | undefined)?.method === 'POST'
      );
    },
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('WebsiteSettingsTab – URL validation', () => {
  it.each(URL_FIELD_PLACEHOLDERS)(
    'blocks unsafe protocols from the %s field before saving',
    async (placeholder) => {
      const user = userEvent.setup();
      renderTab();

      const { input, btn } =
        await findSaveButtonForPlaceholder(placeholder);
      const blockedValue = placeholder.includes('facebook')
        ? 'data:text/html,<script>alert(1)</script>'
        : 'javascript:alert(1)';

      await user.clear(input);
      await user.type(input, blockedValue);
      await user.click(btn);

      expect(
        await screen.findByText(
          'Ungültige URL – bitte eine vollständige URL eingeben (z. B. https://…)',
        ),
      ).toBeInTheDocument();
      expect(adminSettingsPostCalls()).toHaveLength(0);
    },
  );

  it('shows the English validation message and blocks saving in English', async () => {
    localStorage.setItem('iroc_language', 'EN');
    const user = userEvent.setup();
    renderTab();

    const { input, btn } =
      await findSaveButtonForPlaceholder('linkedin.com');
    await user.clear(input);
    await user.type(input, 'javascript:alert(1)');
    await user.click(btn);

    expect(
      await screen.findByText(
        'Invalid URL – please enter a full URL (e.g. https://…)',
      ),
    ).toBeInTheDocument();
    expect(adminSettingsPostCalls()).toHaveLength(0);
  });

  it('shows an inline error for javascript: URLs and does NOT call fetch POST', async () => {
    const user = userEvent.setup();
    renderTab();

    const { input, btn } = await findSaveButtonForPlaceholder('linkedin.com');

    await user.clear(input);
    await user.type(input, 'javascript:alert(1)');
    await user.click(btn);

    // Error message must be visible
    await waitFor(() => {
      expect(
        screen.getByText(/Invalid URL|Ungültige URL/i),
      ).toBeInTheDocument();
    });

    // No POST to the settings endpoint must have been made
    const postCalls = (
      fetchSpy.mock.calls as FetchCall[]
    ).filter(([input]: FetchCall) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.includes('/api/admin/website-settings');
    });
    expect(postCalls).toHaveLength(0);
  });

  it('shows an inline error for data: URLs and does NOT call fetch POST', async () => {
    const user = userEvent.setup();
    renderTab();

    const { input, btn } = await findSaveButtonForPlaceholder('facebook.com');

    await user.clear(input);
    await user.type(input, 'data:text/html,<script>alert(1)</script>');
    await user.click(btn);

    await waitFor(() => {
      expect(
        screen.getByText(/Invalid URL|Ungültige URL/i),
      ).toBeInTheDocument();
    });

    const postCalls = (
      fetchSpy.mock.calls as FetchCall[]
    ).filter(([input]: FetchCall) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.includes('/api/admin/website-settings');
    });
    expect(postCalls).toHaveLength(0);
  });

  it('shows no error and calls fetch POST for a valid https:// URL', async () => {
    const user = userEvent.setup();
    renderTab();

    const { input, btn } = await findSaveButtonForPlaceholder('instagram.com');

    await user.clear(input);
    await user.type(input, 'https://www.instagram.com/iroc_gmbh');
    await user.click(btn);

    // No inline error
    await waitFor(() => {
      expect(
        screen.queryByText(/Invalid URL|Ungültige URL/i),
      ).not.toBeInTheDocument();
    });

    // The POST to the settings endpoint must have been made exactly once
    const postCalls = (
      fetchSpy.mock.calls as FetchCall[]
    ).filter(([input]: FetchCall) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.includes('/api/admin/website-settings');
    });
    expect(postCalls).toHaveLength(1);
  });

  it('clears the error when the user corrects a bad URL to a valid one', async () => {
    const user = userEvent.setup();
    renderTab();

    const { input, btn } = await findSaveButtonForPlaceholder('youtube.com');

    // First type a bad URL and save — error appears
    await user.clear(input);
    await user.type(input, 'javascript:void(0)');
    await user.click(btn);

    await waitFor(() => {
      expect(
        screen.getByText(/Invalid URL|Ungültige URL/i),
      ).toBeInTheDocument();
    });

    // Now correct it — the error should disappear on change
    await user.clear(input);
    await user.type(input, 'https://www.youtube.com/@iroc');

    await waitFor(() => {
      expect(
        screen.queryByText(/Invalid URL|Ungültige URL/i),
      ).not.toBeInTheDocument();
    });
  });

  it('shows an inline error for the Maps embed URL field with a javascript: value', async () => {
    const user = userEvent.setup();
    renderTab();

    // Maps embed uses a distinct placeholder containing "maps.google" or similar;
    // fall back to locating by label text if needed.
    const mapsInput = await screen.findByPlaceholderText(
      /maps\.google|embed/i,
    ).catch(() => null);

    // If the embed placeholder doesn't match, find by the label text instead
    const input =
      mapsInput ??
      (await (async () => {
        const label = await screen.findByText(/Maps.*Embed|Embed.*URL/i);
        return label
          .closest('div')!
          .querySelector('input')!;
      })());

    expect(input).toBeTruthy();

    const container = (input as HTMLElement).parentElement!;
    const btn = container.querySelector('button')!;

    await user.clear(input as HTMLElement);
    await user.type(input as HTMLElement, 'javascript:alert("xss")');

    // The preview must disappear as soon as the value becomes unsafe.
    expect(
      screen.queryByTitle(/Kartenvorschau|Map preview/i),
    ).not.toBeInTheDocument();

    await user.click(btn);

    await waitFor(() => {
      expect(
        screen.getByText(/Invalid URL|Ungültige URL/i),
      ).toBeInTheDocument();
    });
  });

  it('renders a preview for valid http:// and https:// Maps embed URLs without a network request', async () => {
    const user = userEvent.setup();
    renderTab();

    const mapsInput = await screen.findByPlaceholderText(/\/maps\/embed/i);

    for (const embedUrl of [
      'http://www.google.com/maps/embed?pb=!1m18!1m12',
      'https://www.google.com/maps/embed?pb=!1m18!1m12',
    ]) {
      await user.clear(mapsInput);
      await user.type(mapsInput, embedUrl);

      await waitFor(() => {
        const preview = screen.getByTitle(/Kartenvorschau|Map preview/i);
        expect(preview).toHaveAttribute('src', embedUrl);
      });
    }
  });

  it('renders the saved Maps embed preview after settings load', async () => {
    renderTab();

    const preview = await screen.findByTitle(/Kartenvorschau|Map preview/i);

    expect(preview).toHaveAttribute('src', SAVED_MAPS_EMBED_URL);
  });
});
