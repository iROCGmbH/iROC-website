/**
 * cms-offline-resilience.test.tsx
 *
 * Verifies that a failing forced CMS re-fetch (e.g. API temporarily offline)
 * leaves the last-known-good CMS map intact rather than replacing it with an
 * empty Map.
 *
 * Strategy:
 *  1. Install a BroadcastChannel mock via vi.hoisted() so the module-level
 *     channel setup in LanguageContext runs against the mock even before any
 *     import is resolved.
 *  2. Call vi.resetModules() before each test so the module-level _cmsPromise
 *     singleton starts fresh and the BroadcastChannel setup re-runs with the
 *     mock in place.
 *  3. Mock fetch: first call returns a good map, second call fails.
 *  4. Trigger invalidation and assert the component still shows the original
 *     CMS text rather than blank / the hard-coded fallback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── BroadcastChannel mock ─────────────────────────────────────────────────────
// vi.hoisted() executes before any static import, so the globalThis stub is
// already in place when LanguageContext's module-level code runs.

const { channelRegistry, MockBroadcastChannel } = vi.hoisted(() => {
  const channelRegistry = new Map<string, Set<MockBC>>();

  class MockBC {
    name: string;
    onmessage: ((ev: MessageEvent) => void) | null = null;

    constructor(name: string) {
      this.name = name;
      if (!channelRegistry.has(name)) channelRegistry.set(name, new Set());
      channelRegistry.get(name)!.add(this);
    }

    postMessage(data: unknown) {
      channelRegistry.get(this.name)?.forEach((ch) => {
        if (ch !== this && ch.onmessage) {
          ch.onmessage(new MessageEvent('message', { data }));
        }
      });
    }

    close() {
      channelRegistry.get(this.name)?.delete(this);
    }
  }

  (globalThis as unknown as Record<string, unknown>).BroadcastChannel = MockBC;

  return { channelRegistry, MockBroadcastChannel: MockBC };
});

// ── Fixture ───────────────────────────────────────────────────────────────────

/**
 * Fake /api/content/iroc response shape.
 *
 * IMPORTANT: the DE override ('CMS: Willkommen') intentionally differs from the
 * source label ('Willkommen') so that the test can distinguish between:
 *   - Map active  → t('Willkommen', 'FALLBACK') returns 'CMS: Willkommen'
 *   - Map wiped   → t('Willkommen', 'FALLBACK') returns 'Willkommen' (DE hardcode)
 * Without this distinction every failure case would be a false positive.
 */
const INITIAL_CMS_RESPONSE = {
  hero_label: { label: 'Willkommen', de: 'CMS: Willkommen', en: 'Welcome' },
};

const UPDATED_CMS_RESPONSE = {
  hero_label: { label: 'Willkommen', de: 'Herzlich willkommen', en: 'Welcome' },
};

// ── Channel name (must match LanguageContext.tsx constant) ────────────────────
const IROC_CMS_CHANNEL_NAME = 'iroc-cms-content-invalidate';

// ── Per-test reset ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  channelRegistry.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CMS offline resilience — LanguageContext', () => {
  it('retains the last-known map when the forced re-fetch fails', async () => {
    // First call: initial load succeeds.
    // Second call: forced re-fetch after invalidation rejects (API offline).
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockRejectedValueOnce(new Error('Network error'));

    // Import AFTER vi.resetModules() so the singleton starts clean.
    const { LanguageProvider, useLanguage, invalidateIrocCmsCache } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    // Wait for the initial successful fetch to populate the map.
    // 'CMS: Willkommen' proves the map is active (not the hardcoded 'Willkommen' fallback).
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    // Trigger invalidation — the forced re-fetch will reject.
    await act(async () => {
      invalidateIrocCmsCache();
      // Give the rejected promise time to settle.
      await new Promise((r) => setTimeout(r, 20));
    });

    // The CMS override must still show — not the hardcoded 'Willkommen' or 'FALLBACK'.
    expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen');
  });

  it('retains the map when the forced re-fetch returns a non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      // Server is overloaded — returns 503 on the invalidation fetch.
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as Response);

    const { LanguageProvider, useLanguage, invalidateIrocCmsCache } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    // 'CMS: Willkommen' proves the map is active (not the hardcoded 'Willkommen' fallback).
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    await act(async () => {
      invalidateIrocCmsCache();
      await new Promise((r) => setTimeout(r, 20));
    });

    // Map must still be intact after a 503 — not the hardcoded 'Willkommen'.
    expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen');
  });

  it('refreshes CMS content when the tab becomes visible again', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => UPDATED_CMS_RESPONSE,
      } as Response);

    const { LanguageProvider, useLanguage } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent(
        'Herzlich willkommen',
      ),
    );
    expect(globalThis.fetch).toHaveBeenLastCalledWith('/api/content/iroc', {
      cache: 'no-store',
    });
  });

  it('retains the last-known map when a visible-tab refresh fails offline', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockRejectedValueOnce(new Error('Network error'));

    const { LanguageProvider, useLanguage } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen');
    expect(globalThis.fetch).toHaveBeenLastCalledWith('/api/content/iroc', {
      cache: 'no-store',
    });
  });

  it('refreshes without browser cache after browser history restoration', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => UPDATED_CMS_RESPONSE,
      } as Response);

    const { LanguageProvider, useLanguage } = await import('@/contexts/LanguageContext');
    function CmsProbe() {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t('Willkommen', 'FALLBACK')}</span>;
    }
    render(<LanguageProvider><CmsProbe /></LanguageProvider>);
    await screen.findByText('CMS: Willkommen');

    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    await act(async () => window.dispatchEvent(event));

    await screen.findByText('Herzlich willkommen');
    expect(globalThis.fetch).toHaveBeenLastCalledWith('/api/content/iroc', {
      cache: 'no-store',
    });
  });

  it('does not refresh CMS content for a normal, non-persisted pageshow', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => INITIAL_CMS_RESPONSE,
    } as Response);
    const { LanguageProvider, useLanguage } = await import('@/contexts/LanguageContext');
    function CmsProbe() {
      const { t } = useLanguage();
      return <span>{t('Willkommen', 'FALLBACK')}</span>;
    }
    render(<LanguageProvider><CmsProbe /></LanguageProvider>);
    await screen.findByText('CMS: Willkommen');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: false });
    await act(async () => window.dispatchEvent(event));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the last-known wording when history restoration refresh is offline', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockRejectedValueOnce(new Error('offline'));

    const { LanguageProvider, useLanguage } = await import('@/contexts/LanguageContext');
    function CmsProbe() {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t('Willkommen', 'FALLBACK')}</span>;
    }
    render(<LanguageProvider><CmsProbe /></LanguageProvider>);
    await screen.findByText('CMS: Willkommen');

    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    await act(async () => {
      window.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen');
  });

  it('updates the map normally when the forced re-fetch succeeds', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => UPDATED_CMS_RESPONSE,
      } as Response);

    const { LanguageProvider, useLanguage, invalidateIrocCmsCache } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    // 'CMS: Willkommen' proves the map is active (not the hardcoded 'Willkommen' fallback).
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    await act(async () => {
      invalidateIrocCmsCache();
    });

    // After a successful re-fetch the updated DE override must appear.
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent(
        'Herzlich willkommen',
      ),
    );
  });

  // ── Cross-tab BroadcastChannel tests ─────────────────────────────────────────

  it('retains the map when a cross-tab broadcast triggers a failing re-fetch (network error)', async () => {
    // Tab A: initial fetch succeeds.
    // Tab B (simulated via MockBroadcastChannel): posts 'invalidate'.
    // Tab A's forced re-fetch then rejects — the last-known map must survive.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockRejectedValueOnce(new Error('Network error'));

    // Import after vi.resetModules() so the BroadcastChannel setup re-runs
    // with the mock in place and _cmsPromise starts clean.
    const { LanguageProvider, useLanguage } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    // Wait for the initial CMS map to populate.
    // 'CMS: Willkommen' proves the map override is active, not the hardcoded 'Willkommen' fallback.
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    // Open a second "Tab B" channel instance and broadcast an invalidation.
    // LanguageContext's module-level onmessage handler fires → forceFetchCmsMap
    // is called → fetch rejects → fallback (current map) is used.
    const tabB = new MockBroadcastChannel(IROC_CMS_CHANNEL_NAME);

    await act(async () => {
      tabB.postMessage('invalidate');
      // Allow the rejected promise to settle.
      await new Promise((r) => setTimeout(r, 30));
    });

    tabB.close();

    // The CMS override must still be intact — not the hardcoded 'Willkommen' or 'FALLBACK'.
    expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen');
  });

  it('retains the map when a cross-tab broadcast triggers a non-OK re-fetch (503)', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as Response);

    const { LanguageProvider, useLanguage } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    // 'CMS: Willkommen' proves the map override is active, not the hardcoded 'Willkommen' fallback.
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    const tabB = new MockBroadcastChannel(IROC_CMS_CHANNEL_NAME);

    await act(async () => {
      tabB.postMessage('invalidate');
      await new Promise((r) => setTimeout(r, 30));
    });

    tabB.close();

    // 503 must not wipe the map — override must still show, not the hardcoded 'Willkommen'.
    expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen');
  });

  it('updates the map when a cross-tab broadcast triggers a successful re-fetch', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => UPDATED_CMS_RESPONSE,
      } as Response);

    const { LanguageProvider, useLanguage } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    // 'CMS: Willkommen' proves the map override is active, not the hardcoded 'Willkommen' fallback.
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    const tabB = new MockBroadcastChannel(IROC_CMS_CHANNEL_NAME);

    act(() => {
      tabB.postMessage('invalidate');
    });

    // After a successful re-fetch the new DE override must appear.
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent(
        'Herzlich willkommen',
      ),
    );

    tabB.close();
  });

  it('retains the last successful map across sequential cross-tab broadcasts when the second re-fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => UPDATED_CMS_RESPONSE,
      } as Response)
      .mockRejectedValueOnce(new Error('Network offline'));

    const { LanguageProvider, useLanguage } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    const tabB = new MockBroadcastChannel(IROC_CMS_CHANNEL_NAME);

    // The first cross-tab invalidation succeeds and becomes the new last-known-good map.
    act(() => {
      tabB.postMessage('invalidate');
    });
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent(
        'Herzlich willkommen',
      ),
    );

    // The page is already open when the next invalidation arrives, but the API is now offline.
    await act(async () => {
      tabB.postMessage('invalidate');
      await new Promise((r) => setTimeout(r, 30));
    });

    // The failed re-fetch must preserve the first broadcast's value, not the initial or empty map.
    expect(screen.getByTestId('cms-text')).toHaveTextContent(
      'Herzlich willkommen',
    );

    tabB.close();
  });

  it('keeps the newest successful map when overlapping broadcasts resolve out of order', async () => {
    let resolveOlder!: (response: Response) => void;
    let resolveNewer!: (response: Response) => void;
    const olderResponse = new Promise<Response>((resolve) => {
      resolveOlder = resolve;
    });
    const newerResponse = new Promise<Response>((resolve) => {
      resolveNewer = resolve;
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockImplementationOnce(() => olderResponse)
      .mockImplementationOnce(() => newerResponse);

    const { LanguageProvider, useLanguage } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    const tabB = new MockBroadcastChannel(IROC_CMS_CHANNEL_NAME);

    // The first response is the older update; the second response is newer.
    act(() => {
      tabB.postMessage('invalidate');
      tabB.postMessage('invalidate');
    });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));

    await act(async () => {
      resolveNewer({
        ok: true,
        json: async () => UPDATED_CMS_RESPONSE,
      } as Response);
    });
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent(
        'Herzlich willkommen',
      ),
    );

    // The older response arriving later must not roll the label back.
    await act(async () => {
      resolveOlder({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId('cms-text')).toHaveTextContent(
      'Herzlich willkommen',
    );

    tabB.close();
  });

  it('keeps the newest available successful map when an overlapping request fails offline', async () => {
    let resolveOlder!: (response: Response) => void;
    const olderResponse = new Promise<Response>((resolve) => {
      resolveOlder = resolve;
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => INITIAL_CMS_RESPONSE,
      } as Response)
      .mockImplementationOnce(() => olderResponse)
      .mockRejectedValueOnce(new Error('Network offline'));

    const { LanguageProvider, useLanguage } =
      await import('@/contexts/LanguageContext');

    function CmsProbe({ label }: { label: string }) {
      const { t } = useLanguage();
      return <span data-testid="cms-text">{t(label, 'FALLBACK')}</span>;
    }

    render(
      <LanguageProvider>
        <CmsProbe label="Willkommen" />
      </LanguageProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent('CMS: Willkommen'),
    );

    const tabB = new MockBroadcastChannel(IROC_CMS_CHANNEL_NAME);

    act(() => {
      tabB.postMessage('invalidate');
      tabB.postMessage('invalidate');
    });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3));

    // The newer request fails, while the older successful update eventually
    // completes. It should still be usable and must not be overwritten by the
    // failed request's stale fallback.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      resolveOlder({
        ok: true,
        json: async () => UPDATED_CMS_RESPONSE,
      } as Response);
    });
    await waitFor(() =>
      expect(screen.getByTestId('cms-text')).toHaveTextContent(
        'Herzlich willkommen',
      ),
    );

    expect(screen.getByTestId('cms-text')).toHaveTextContent(
      'Herzlich willkommen',
    );

    tabB.close();
  });
});
