/**
 * PraktischeInformationen.broadcast-clear.test.tsx
 *
 * Confirms the video section disappears — without a page reload — when an
 * admin clears both sp_video_praktisch_1_url and sp_video_praktisch_2_url
 * and the change is propagated to an already-open tab via BroadcastChannel.
 *
 * Strategy
 * ─────────
 * 1. vi.hoisted() installs a fully-functional in-process BroadcastChannel
 *    mock BEFORE any module is imported, so the hook's module-level
 *    initialisation (which calls `new BroadcastChannel(…)` and assigns
 *    `bc.onmessage`) already sees the mock.
 * 2. vi.resetModules() + dynamic import() in beforeEach ensures the hook
 *    module re-runs its top-level code fresh with the mock in place.
 * 3. Each test renders PraktischeInformationen (the real component), waits
 *    for the initial fetch to populate both video URLs, then simulates a
 *    second-tab broadcast that triggers a re-fetch returning empty strings.
 * 4. Assertions verify: no iframes remain, the section heading is gone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';

// ── BroadcastChannel mock (must run before any import) ────────────────────────
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
      // Deliver to every OTHER instance — cross-tab semantics
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

// ── i18n stub ─────────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { returnObjects?: boolean }) => {
      if (key === 'praktisch.beforeItems' && opts?.returnObjects) return [];
      if (key === 'praktisch.afterItems' && opts?.returnObjects) return [];
      return key;
    },
  }),
}));

// ── Fixture constants ─────────────────────────────────────────────────────────
const VALID_P1_EMBED = 'https://www.youtube.com/embed/P1ID?rel=0';
const VALID_P2_EMBED = 'https://www.youtube.com/embed/P2ID?rel=0';
const SP_CHANNEL_NAME = 'spirecut-sp-settings-invalidate';

// ── Per-test mutable fetch payload ────────────────────────────────────────────
let currentSettings: Record<string, string> = {};

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeEach(async () => {
  // Start with both video URLs populated
  currentSettings = {
    sp_video_praktisch_1_url: VALID_P1_EMBED,
    sp_video_praktisch_2_url: VALID_P2_EMBED,
  };

  // Reset module registry so the hook re-runs its top-level BC setup
  vi.resetModules();
  channelRegistry.clear();

  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: true,
    json: async () => ({ ...currentSettings }),
  } as Response));
});

afterEach(() => {
  vi.restoreAllMocks();
  channelRegistry.clear();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PraktischeInformationen – video section hidden via BroadcastChannel clear', () => {
  it('hides the video section when Tab B clears both URLs', async () => {
    // Dynamic import after resetModules so the hook's module-level BC setup
    // runs with MockBroadcastChannel already on globalThis.
    const PraktischeInformationen = (
      await import('./PraktischeInformationen')
    ).default;

    render(<PraktischeInformationen />);

    // Wait for both iframes to appear (initial state: URLs are set)
    await waitFor(() => {
      expect(document.querySelectorAll('iframe')).toHaveLength(2);
    });
    expect(screen.getByText('praktisch.videosTitle')).toBeTruthy();

    // Admin in Tab B clears both URLs and broadcasts invalidation
    currentSettings = {
      sp_video_praktisch_1_url: '',
      sp_video_praktisch_2_url: '',
    };

    const tabB = new MockBroadcastChannel(SP_CHANNEL_NAME);
    act(() => {
      tabB.postMessage('invalidate');
    });

    // Tab A's hook must re-fetch and hide the video section
    await waitFor(() => {
      expect(document.querySelectorAll('iframe')).toHaveLength(0);
    });
    expect(screen.queryByText('praktisch.videosTitle')).toBeNull();

    tabB.close();
  });

  it('hides the video section when Tab B clears both URLs using non-YouTube values', async () => {
    const PraktischeInformationen = (
      await import('./PraktischeInformationen')
    ).default;

    render(<PraktischeInformationen />);

    // Initial state: both iframes visible
    await waitFor(() => {
      expect(document.querySelectorAll('iframe')).toHaveLength(2);
    });

    // Tab B saves non-YouTube URLs — toEmbedUrl returns "" for both
    currentSettings = {
      sp_video_praktisch_1_url: 'https://vimeo.com/111',
      sp_video_praktisch_2_url: 'https://vimeo.com/222',
    };

    const tabB = new MockBroadcastChannel(SP_CHANNEL_NAME);
    act(() => {
      tabB.postMessage('invalidate');
    });

    await waitFor(() => {
      expect(document.querySelectorAll('iframe')).toHaveLength(0);
    });
    expect(screen.queryByText('praktisch.videosTitle')).toBeNull();

    tabB.close();
  });

  it('removes only the cleared iframe when Tab B clears just one URL', async () => {
    const PraktischeInformationen = (
      await import('./PraktischeInformationen')
    ).default;

    render(<PraktischeInformationen />);

    await waitFor(() => {
      expect(document.querySelectorAll('iframe')).toHaveLength(2);
    });

    // Tab B clears only the first URL
    currentSettings = {
      sp_video_praktisch_1_url: '',
      sp_video_praktisch_2_url: VALID_P2_EMBED,
    };

    const tabB = new MockBroadcastChannel(SP_CHANNEL_NAME);
    act(() => {
      tabB.postMessage('invalidate');
    });

    // Only second iframe should remain; section heading still visible
    await waitFor(() => {
      expect(document.querySelectorAll('iframe')).toHaveLength(1);
    });
    expect(document.querySelectorAll('iframe')[0].getAttribute('src')).toBe(VALID_P2_EMBED);
    expect(screen.getByText('praktisch.videosTitle')).toBeTruthy();

    tabB.close();
  });

  it('hides the section on the second broadcast after a partial clear followed by a full clear', async () => {
    const PraktischeInformationen = (
      await import('./PraktischeInformationen')
    ).default;

    render(<PraktischeInformationen />);

    await waitFor(() => {
      expect(document.querySelectorAll('iframe')).toHaveLength(2);
    });

    const tabB = new MockBroadcastChannel(SP_CHANNEL_NAME);

    // First broadcast: clear only URL 2
    currentSettings = {
      sp_video_praktisch_1_url: VALID_P1_EMBED,
      sp_video_praktisch_2_url: '',
    };
    act(() => { tabB.postMessage('invalidate'); });

    await waitFor(() => {
      expect(document.querySelectorAll('iframe')).toHaveLength(1);
    });
    expect(screen.getByText('praktisch.videosTitle')).toBeTruthy();

    // Second broadcast: clear URL 1 as well
    currentSettings = {
      sp_video_praktisch_1_url: '',
      sp_video_praktisch_2_url: '',
    };
    act(() => { tabB.postMessage('invalidate'); });

    await waitFor(() => {
      expect(document.querySelectorAll('iframe')).toHaveLength(0);
    });
    expect(screen.queryByText('praktisch.videosTitle')).toBeNull();

    tabB.close();
  });
});
