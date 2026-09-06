/**
 * spirecut-settings-broadcast-channel.test.ts
 *
 * Verifies that the BroadcastChannel wiring inside useSpirecutSettings propagates
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

const INITIAL_EMAIL = 'info@spirecut.de';
const UPDATED_EMAIL = 'updated@spirecut.de';

const SP_CHANNEL_NAME = 'spirecut-sp-settings-invalidate';

// ── Per-test state ────────────────────────────────────────────────────────────

/** Mutable pointer – the fetch mock reads this so mid-test updates propagate. */
let currentEmail = INITIAL_EMAIL;

beforeEach(async () => {
  currentEmail = INITIAL_EMAIL;

  // Reset the module registry so the hook module re-runs its top-level
  // BroadcastChannel setup with our mock already installed.
  vi.resetModules();

  // Clear any channel instances left over from the previous test.
  channelRegistry.clear();

  // Provide a fetch implementation that serves mutable fixture values.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: true,
    json: async () => ({ sp_contact_email_de: currentEmail }),
  } as Response));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useSpirecutSettings – BroadcastChannel cross-tab propagation', () => {
  it('re-fetches when a second tab broadcasts an invalidation message', async () => {
    // Fresh import after vi.resetModules() so module-level BroadcastChannel
    // setup runs again with the mock in place.
    const { useSpirecutSettings } =
      await import('@/hooks/useSpirecutSettings');

    // Render a hook instance (simulates Tab A).
    const { result } = renderHook(() => useSpirecutSettings());

    // Wait for the initial fetch to complete.
    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(INITIAL_EMAIL)
    );

    // Simulate an admin in Tab B saving a new value.  We open a second
    // BroadcastChannel instance directly (bypassing the hook's singleton)
    // to represent Tab B's channel.
    const tabB = new MockBroadcastChannel(SP_CHANNEL_NAME);

    // Update the fixture so the next fetch returns the new value.
    currentEmail = UPDATED_EMAIL;

    // Tab B broadcasts — Tab A's onmessage handler should fire.
    act(() => {
      tabB.postMessage('invalidate');
    });

    // Tab A's hook must re-fetch and surface the updated value.
    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(UPDATED_EMAIL)
    );

    tabB.close();
  });

  it('does not re-fetch in the same tab that called invalidateSpirecutSettingsCache', async () => {
    // Verify the broadcast goes to OTHER instances, not the sender itself.
    // (The sender's same-tab path already calls invalidationListeners directly.)
    const { useSpirecutSettings, invalidateSpirecutSettingsCache } =
      await import('@/hooks/useSpirecutSettings');

    const { result } = renderHook(() => useSpirecutSettings());

    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(INITIAL_EMAIL)
    );

    // Capture the fetch call count right before invalidation.
    const fetchBefore = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    currentEmail = UPDATED_EMAIL;
    act(() => { invalidateSpirecutSettingsCache(); });

    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(UPDATED_EMAIL)
    );

    // The hook should have triggered exactly one additional fetch (via the
    // same-tab invalidationListeners path), not a duplicate via the channel's
    // own onmessage (BroadcastChannel does not echo back to the sender).
    const fetchAfter = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchAfter - fetchBefore).toBe(1);
  });

  it('delivers the invalidation to every active hook instance in the same tab', async () => {
    // Two hook instances in Tab A should both update when Tab B broadcasts.
    const { useSpirecutSettings } =
      await import('@/hooks/useSpirecutSettings');

    const { result: r1 } = renderHook(() => useSpirecutSettings());
    const { result: r2 } = renderHook(() => useSpirecutSettings());

    await waitFor(() => {
      expect(r1.current.sp_contact_email_de).toBe(INITIAL_EMAIL);
      expect(r2.current.sp_contact_email_de).toBe(INITIAL_EMAIL);
    });

    const fetchBefore = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    const tabB = new MockBroadcastChannel(SP_CHANNEL_NAME);
    currentEmail = UPDATED_EMAIL;

    act(() => { tabB.postMessage('invalidate'); });

    await waitFor(() => {
      expect(r1.current.sp_contact_email_de).toBe(UPDATED_EMAIL);
      expect(r2.current.sp_contact_email_de).toBe(UPDATED_EMAIL);
    });
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length - fetchBefore).toBe(1);

    tabB.close();
  });

  it('handles multiple sequential broadcasts and always surfaces the latest value', async () => {
    const EMAIL_V2 = 'second@spirecut.de';
    const EMAIL_V3 = 'third@spirecut.de';

    const { useSpirecutSettings } =
      await import('@/hooks/useSpirecutSettings');

    const { result } = renderHook(() => useSpirecutSettings());
    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(INITIAL_EMAIL)
    );

    const tabB = new MockBroadcastChannel(SP_CHANNEL_NAME);

    // First update
    currentEmail = EMAIL_V2;
    act(() => { tabB.postMessage('invalidate'); });
    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(EMAIL_V2)
    );

    // Second update
    currentEmail = EMAIL_V3;
    act(() => { tabB.postMessage('invalidate'); });
    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(EMAIL_V3)
    );

    tabB.close();
  });

  it('does not re-fetch or update state after the hook is unmounted', async () => {
    const { useSpirecutSettings } =
      await import('@/hooks/useSpirecutSettings');

    const { result, unmount } = renderHook(() => useSpirecutSettings());

    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(INITIAL_EMAIL)
    );

    const fetchBeforeUnmount = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    // Closing Tab A removes its hook subscription before Tab B broadcasts.
    unmount();
    const tabB = new MockBroadcastChannel(SP_CHANNEL_NAME);
    currentEmail = UPDATED_EMAIL;

    act(() => {
      tabB.postMessage('invalidate');
    });

    // Let any queued promise callbacks and React work settle. A stale
    // subscription would trigger another request or a post-unmount warning.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      fetchBeforeUnmount,
    );
    const stateUpdateWarnings = consoleError.mock.calls.filter((args) =>
      args.some(
        (arg) =>
          typeof arg === 'string' &&
          arg.includes("Can't perform a React state update on an unmounted component"),
      ),
    );
    expect(stateUpdateWarnings).toHaveLength(0);

    tabB.close();
    consoleError.mockRestore();
  });

  it('does not re-fetch or update state after the browser app hook is unmounted', async () => {
    const { useSpirecutSettings } =
      await import('../../../spirecut-mobile-redirect/src/hooks/useSpirecutSettings');

    const { result, unmount } = renderHook(() => useSpirecutSettings());

    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(INITIAL_EMAIL)
    );

    const fetchBeforeUnmount = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    unmount();
    const tabB = new MockBroadcastChannel(SP_CHANNEL_NAME);
    currentEmail = UPDATED_EMAIL;

    act(() => {
      tabB.postMessage('invalidate');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      fetchBeforeUnmount,
    );
    const stateUpdateWarnings = consoleError.mock.calls.filter((args) =>
      args.some(
        (arg) =>
          typeof arg === 'string' &&
          arg.includes("Can't perform a React state update on an unmounted component"),
      ),
    );
    expect(stateUpdateWarnings).toHaveLength(0);

    tabB.close();
    consoleError.mockRestore();
  });

  it('refreshes the mounted browser app hook exactly once after another tab invalidates', async () => {
    const { useSpirecutSettings } =
      await import('../../../spirecut-mobile-redirect/src/hooks/useSpirecutSettings');
    const { result } = renderHook(() => useSpirecutSettings());

    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(INITIAL_EMAIL)
    );
    const fetchBefore = (fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    const tabB = new MockBroadcastChannel(SP_CHANNEL_NAME);
    currentEmail = UPDATED_EMAIL;

    act(() => {
      tabB.postMessage('invalidate');
    });

    await waitFor(() =>
      expect(result.current.sp_contact_email_de).toBe(UPDATED_EMAIL)
    );
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length - fetchBefore).toBe(1);
    tabB.close();
  });
});
