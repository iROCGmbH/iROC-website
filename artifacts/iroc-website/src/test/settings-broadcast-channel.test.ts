/**
 * settings-broadcast-channel.test.ts
 *
 * Verifies that the BroadcastChannel wiring inside useWebsiteSettings propagates
 * cache-invalidation events across simulated tabs.
 *
 * jsdom does not implement BroadcastChannel, so this file:
 *   1. Installs a fully-functional in-process BroadcastChannel mock via
 *      vi.hoisted() — which executes before any module import — so the hook's
 *      module-level initialisation code sees a real channel object.
 *   2. Resets the module registry and re-imports the hook dynamically in each
 *      test so the module-level singleton starts clean and re-runs its
 *      BroadcastChannel setup with the mock in place.
 *   3. Opens a second "tab" channel instance with the same name and calls
 *      postMessage(), then asserts the hook re-fetches and surfaces the updated
 *      value — covering exactly the code path that same-tab tests cannot reach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// ── BroadcastChannel mock ─────────────────────────────────────────────────────
// vi.hoisted() runs before any static import so globalThis.BroadcastChannel is
// already set when the hook module's top-level code executes.

const { channelRegistry, MockBroadcastChannel } = vi.hoisted(() => {
  /** All live MockBC instances keyed by channel name. */
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
      // Deliver to every OTHER instance on the same channel (cross-tab semantic)
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

  // Install globally so the hook's typeof check passes
  (globalThis as unknown as Record<string, unknown>).BroadcastChannel = MockBC;

  return { channelRegistry, MockBroadcastChannel: MockBC };
});

// ── Fixture values ────────────────────────────────────────────────────────────

const INITIAL_PHONE = '+49 89 4625993 70';
const UPDATED_PHONE = '+49 89 999 000 11';

const WS_CHANNEL_NAME = 'iroc-ws-settings-invalidate';

// ── Per-test state ────────────────────────────────────────────────────────────

/** Mutable pointer – the fetch mock reads this so mid-test updates propagate. */
let currentPhone = INITIAL_PHONE;

beforeEach(async () => {
  currentPhone = INITIAL_PHONE;

  // Reset the module registry so the hook module re-runs its top-level
  // BroadcastChannel setup with our mock already installed.
  vi.resetModules();

  // Clear any channel instances left over from the previous test.
  channelRegistry.clear();

  // Provide a fetch implementation that serves mutable fixture values.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: true,
    json: async () => ({ ws_contact_phone: currentPhone }),
  } as Response));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useWebsiteSettings – BroadcastChannel cross-tab propagation', () => {
  it('re-fetches when a second tab broadcasts an invalidation message', async () => {
    // Fresh import after vi.resetModules() so module-level BroadcastChannel
    // setup runs again with the mock in place.
    const { useWebsiteSettings } = await import('@/hooks/useWebsiteSettings');

    // Render a hook instance (simulates Tab A).
    const { result } = renderHook(() => useWebsiteSettings());

    // Wait for the initial fetch to complete.
    await waitFor(() =>
      expect(result.current.ws_contact_phone).toBe(INITIAL_PHONE)
    );

    // Simulate an admin in Tab B saving a new value and calling the invalidation
    // helper in that tab.  We open a second BroadcastChannel instance directly
    // (bypassing the hook's singleton) to represent Tab B's channel.
    const tabB = new MockBroadcastChannel(WS_CHANNEL_NAME);

    // Update the fixture so the next fetch returns the new value.
    currentPhone = UPDATED_PHONE;

    // Tab B broadcasts — Tab A's onmessage handler should fire.
    act(() => {
      tabB.postMessage('invalidate');
    });

    // Tab A's hook must re-fetch and surface the updated value.
    await waitFor(() =>
      expect(result.current.ws_contact_phone).toBe(UPDATED_PHONE)
    );

    tabB.close();
  });

  it('does not re-fetch in the same tab that called invalidateWebsiteSettingsCache', async () => {
    // Verify the broadcast goes to OTHER instances, not the sender itself.
    // (The sender's same-tab path already calls invalidationListeners directly.)
    const { useWebsiteSettings, invalidateWebsiteSettingsCache } =
      await import('@/hooks/useWebsiteSettings');

    const { result } = renderHook(() => useWebsiteSettings());

    await waitFor(() =>
      expect(result.current.ws_contact_phone).toBe(INITIAL_PHONE)
    );

    // Capture the fetch call count right before invalidation.
    const fetchBefore = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    currentPhone = UPDATED_PHONE;
    act(() => { invalidateWebsiteSettingsCache(); });

    await waitFor(() =>
      expect(result.current.ws_contact_phone).toBe(UPDATED_PHONE)
    );

    // The hook should have triggered exactly one additional fetch (via the
    // same-tab invalidationListeners path), not a duplicate via the channel's
    // own onmessage (BroadcastChannel does not echo back to the sender).
    const fetchAfter = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchAfter - fetchBefore).toBe(1);
  });

  it('delivers the invalidation to every active hook instance in the same tab', async () => {
    // Two hook instances in Tab A should both update when Tab B broadcasts.
    const { useWebsiteSettings } =
      await import('@/hooks/useWebsiteSettings');

    const { result: r1 } = renderHook(() => useWebsiteSettings());
    const { result: r2 } = renderHook(() => useWebsiteSettings());

    await waitFor(() => {
      expect(r1.current.ws_contact_phone).toBe(INITIAL_PHONE);
      expect(r2.current.ws_contact_phone).toBe(INITIAL_PHONE);
    });

    const tabB = new MockBroadcastChannel(WS_CHANNEL_NAME);
    currentPhone = UPDATED_PHONE;

    act(() => { tabB.postMessage('invalidate'); });

    await waitFor(() => {
      expect(r1.current.ws_contact_phone).toBe(UPDATED_PHONE);
      expect(r2.current.ws_contact_phone).toBe(UPDATED_PHONE);
    });

    tabB.close();
  });

  it('does not call fetch or setState after the hook is unmounted and a second tab broadcasts', async () => {
    const { useWebsiteSettings } =
      await import('@/hooks/useWebsiteSettings');

    const { result, unmount } = renderHook(() => useWebsiteSettings());

    // Wait for the initial fetch to complete.
    await waitFor(() =>
      expect(result.current.ws_contact_phone).toBe(INITIAL_PHONE)
    );

    const fetchBefore = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    // Unmount the hook — the useEffect cleanup should set alive=false and
    // remove the onInvalidate listener from invalidationListeners.
    act(() => { unmount(); });

    // Open a "Tab B" channel after unmount and broadcast an invalidation.
    const tabB = new MockBroadcastChannel(WS_CHANNEL_NAME);
    currentPhone = UPDATED_PHONE;

    // Wrap in act so any accidental state updates are flushed synchronously.
    act(() => { tabB.postMessage('invalidate'); });

    // Allow any microtasks / promise continuations to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // fetch must not have been called again — the alive guard prevented it.
    const fetchAfter = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchAfter).toBe(fetchBefore);

    tabB.close();
  });

  it('handles multiple sequential broadcasts and always surfaces the latest value', async () => {
    const PHONE_V2 = '+49 89 111 222 33';
    const PHONE_V3 = '+49 89 444 555 66';

    const { useWebsiteSettings } =
      await import('@/hooks/useWebsiteSettings');

    const { result } = renderHook(() => useWebsiteSettings());
    await waitFor(() =>
      expect(result.current.ws_contact_phone).toBe(INITIAL_PHONE)
    );

    const tabB = new MockBroadcastChannel(WS_CHANNEL_NAME);

    // First update
    currentPhone = PHONE_V2;
    act(() => { tabB.postMessage('invalidate'); });
    await waitFor(() =>
      expect(result.current.ws_contact_phone).toBe(PHONE_V2)
    );

    // Second update
    currentPhone = PHONE_V3;
    act(() => { tabB.postMessage('invalidate'); });
    await waitFor(() =>
      expect(result.current.ws_contact_phone).toBe(PHONE_V3)
    );

    tabB.close();
  });
});
