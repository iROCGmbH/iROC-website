/**
 * portal-idle-timeout.test.tsx
 *
 * Verifies the idle-logout timer logic in Portal.tsx:
 *
 *  1. Warning banner appears at 9 minutes of inactivity (in both DE and EN).
 *  2. Logout fires at 10 minutes — POST /api/auth/logout is called and the
 *     user is redirected to /login.
 *  3. A user-activity event (mousemove) at 8 minutes resets the timer so
 *     no logout fires at the original 10-minute mark.
 *  4. Clicking "Stay logged in" / "Aktiv bleiben" hides the banner and
 *     resets the timer.
 *
 * Strategy:
 *  - vi.useFakeTimers() replaces setTimeout/setInterval so we can advance
 *    time synchronously without real wall-clock minutes.
 *  - vi.hoisted() declares stable spy/mock objects before vi.mock() hoisting
 *    runs.  Returning the SAME logoutMut reference on every render is critical:
 *    if useDoctorLogout() returned a new object each render, logoutMut → doLogout
 *    → resetIdleTimer would all change identity on every render, causing the
 *    useEffect to re-fire, call resetIdleTimer() again, and clear warnSecondsLeft
 *    back to null before the banner ever appears.
 *  - act() + fireEvent.click is used for all button interactions.  userEvent
 *    relies on internal real-time delays that hang when fake timers are installed,
 *    even with the advanceTimers option — fireEvent is synchronous and avoids
 *    the issue entirely.
 *  - "await act(async () => {})" drains the microtask queue after timer
 *    advancement so that the async onSuccess (await checkAuth → setLocation)
 *    runs before assertions.
 *  - The LanguageProvider is used as-is so DE/EN switching works normally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import Portal from '@/pages/Portal';

// ── Stable mock objects (must be hoisted so vi.mock factories can close over them) ──
//
// IMPORTANT: useDoctorLogout MUST return the same object reference on every
// render.  If it returned a new object each time, logoutMut → doLogout →
// resetIdleTimer would all have new identities after every render, causing
// the useEffect([isAuthenticated, resetIdleTimer]) to re-run, which calls
// resetIdleTimer() again, which sets warnSecondsLeft(null) and wipes the banner.

const { fakeMutate, mockCheckAuth, mockSetLocation, stableLogout } = vi.hoisted(() => {
  /** Mutable holder so the captured onSuccess survives across renders. */
  const onSuccessHolder: { fn?: () => Promise<void> } = {};

  const stableLogout = {
    /** Stable function reference — same identity across all renders. */
    mutate: vi.fn().mockImplementation(() => {
      // Invoke onSuccess (it is async; we don't await here — the caller
      // must drain the microtask queue with await act(async () => {}) if
      // it needs setLocation('/login') to have run before asserting).
      onSuccessHolder.fn?.();
    }),
    isPending: false,
    /** Internal slot — the mock factory writes here on every useDoctorLogout call. */
    _holder: onSuccessHolder,
  };

  return {
    fakeMutate: stableLogout.mutate,
    mockCheckAuth: vi.fn().mockResolvedValue(undefined),
    mockSetLocation: vi.fn(),
    stableLogout,
  };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('wouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wouter')>();
  return {
    ...actual,
    useLocation: () => ['/', mockSetLocation],
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    instrument: 'spirecut',
    isLoading: false,
    isFetching: false,
    checkAuth: mockCheckAuth,
  }),
}));

vi.mock('@workspace/api-client-react', () => ({
  /**
   * Returns stableLogout — the SAME object every render.
   * Captures the onSuccess callback so mutate() can invoke it.
   */
  useDoctorLogout: (opts?: { mutation?: { onSuccess?: () => Promise<void> } }) => {
    stableLogout._holder.fn = opts?.mutation?.onSuccess;
    return stableLogout;
  },
  useListResources: () => ({ data: [] }),
}));

// ── Constants (must match Portal.tsx) ─────────────────────────────────────────

const IDLE_MS = 10 * 60 * 1000; // 10 minutes
const WARN_MS =  1 * 60 * 1000; // warn starts 1 minute before logout
const WARN_AT = IDLE_MS - WARN_MS; // 9 minutes

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Language-toggle button rendered alongside the portal. */
function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  return (
    <button
      data-testid="lang-toggle"
      onClick={() => setLanguage(language === 'DE' ? 'EN' : 'DE')}
    >
      {language}
    </button>
  );
}

function renderPortal() {
  render(
    <LanguageProvider>
      <LanguageToggle />
      <Portal />
    </LanguageProvider>,
  );
}

/** Advance fake timers and flush React state updates synchronously. */
function tick(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

/** Click a button synchronously via fireEvent (avoids userEvent delay issues with fake timers). */
function click(el: HTMLElement) {
  act(() => { fireEvent.click(el); });
}

/** Simulate a browser tab being hidden or focused again. */
function setTabVisibility(visibility: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibility,
  });
  act(() => { fireEvent(document, new Event('visibilitychange')); });
}

/** Flush pending Promise microtasks so that async onSuccess callbacks complete. */
async function flushMicrotasks() {
  await act(async () => { await Promise.resolve(); });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Portal – idle-timeout behaviour', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setTabVisibility('visible');
    fakeMutate.mockClear();
    mockCheckAuth.mockClear();
    mockSetLocation.mockClear();
  });

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).visibilityState;
    vi.useRealTimers();
  });

  // ── 1. Warning banner at 9 minutes ──────────────────────────────────────────

  describe('warning banner at 9 minutes of inactivity', () => {
    it('shows no warning banner before 9 minutes have elapsed', () => {
      renderPortal();
      tick(WARN_AT - 1);
      expect(screen.queryByText(/Sekunde/)).not.toBeInTheDocument();
      expect(screen.queryByText(/second/i)).not.toBeInTheDocument();
    });

    it('shows the DE warning banner at exactly 9 minutes with 60 seconds remaining', () => {
      renderPortal();
      tick(WARN_AT);
      expect(
        screen.getByText((c) => c.includes('Sitzung läuft ab') && c.includes('60 Sekunden')),
      ).toBeInTheDocument();
    });

    it('shows "Sekunden" (plural) at 60 seconds remaining in DE', () => {
      renderPortal();
      tick(WARN_AT);
      expect(screen.getByText((c) => c.includes('60 Sekunden'))).toBeInTheDocument();
    });

    it('shows "Sekunde" (singular) when 1 second remains in DE', () => {
      renderPortal();
      tick(WARN_AT);
      tick(59 * 1000);
      expect(
        screen.getByText((c) => c.includes('1 Sekunde') && !c.includes('Sekunden')),
      ).toBeInTheDocument();
    });

    it('shows the EN warning banner with correct text after switching to EN', () => {
      renderPortal();
      click(screen.getByTestId('lang-toggle'));
      tick(WARN_AT);
      expect(
        screen.getByText((c) => c.includes('Session expires') && c.includes('60 seconds')),
      ).toBeInTheDocument();
    });

    it('shows "seconds" (plural) at 60 seconds remaining in EN', () => {
      renderPortal();
      click(screen.getByTestId('lang-toggle'));
      tick(WARN_AT);
      expect(screen.getByText((c) => c.includes('60 seconds'))).toBeInTheDocument();
    });

    it('shows "second" (singular, no trailing s) when 1 second remains in EN', () => {
      renderPortal();
      click(screen.getByTestId('lang-toggle'));
      tick(WARN_AT);
      tick(59 * 1000);
      expect(
        screen.getByText((c) => c.includes('1 second') && !c.includes('1 seconds')),
      ).toBeInTheDocument();
    });

    it('renders the "Aktiv bleiben" button inside the warning banner in DE', () => {
      renderPortal();
      tick(WARN_AT);
      expect(screen.getByRole('button', { name: 'Aktiv bleiben' })).toBeInTheDocument();
    });

    it('renders the "Stay logged in" button inside the warning banner in EN', () => {
      renderPortal();
      click(screen.getByTestId('lang-toggle'));
      tick(WARN_AT);
      expect(screen.getByRole('button', { name: 'Stay logged in' })).toBeInTheDocument();
    });

    it('the countdown decrements each second after the banner appears', () => {
      renderPortal();
      tick(WARN_AT);
      expect(screen.getByText((c) => c.includes('60 Sekunden'))).toBeInTheDocument();

      tick(1000);
      expect(screen.getByText((c) => c.includes('59 Sekunden'))).toBeInTheDocument();

      tick(1000);
      expect(screen.getByText((c) => c.includes('58 Sekunden'))).toBeInTheDocument();
    });
  });

  // ── 2. Logout at 10 minutes ─────────────────────────────────────────────────

  describe('logout fires at 10 minutes of inactivity', () => {
    it('calls mutate (POST /api/auth/logout) at exactly 10 minutes', () => {
      renderPortal();
      expect(fakeMutate).not.toHaveBeenCalled();
      tick(IDLE_MS);
      expect(fakeMutate).toHaveBeenCalledTimes(1);
    });

    it('redirects to /login after logout', async () => {
      renderPortal();
      tick(IDLE_MS);
      // onSuccess is async (await checkAuth → setLocation); drain microtasks
      await flushMicrotasks();
      expect(mockSetLocation).toHaveBeenCalledWith('/login');
    });

    it('calls checkAuth before redirecting', async () => {
      renderPortal();
      tick(IDLE_MS);
      await flushMicrotasks();
      expect(mockCheckAuth).toHaveBeenCalled();
    });

    it('does not call mutate before 10 minutes have elapsed', () => {
      renderPortal();
      tick(IDLE_MS - 1);
      expect(fakeMutate).not.toHaveBeenCalled();
    });

    it('hides the warning banner immediately when logout fires', () => {
      renderPortal();
      tick(IDLE_MS);
      expect(screen.queryByText(/Sekunde/)).not.toBeInTheDocument();
    });
  });

  // ── 3. Activity event resets the timer ─────────────────────────────────────

  describe('user activity resets the idle timer', () => {
    it('a mousemove at 8 minutes resets the timer so no logout fires at the original 10-minute mark', () => {
      renderPortal();
      tick(8 * 60 * 1000);
      act(() => { fireEvent.mouseMove(document); });
      // Advance 2 more minutes — would have been the original 10-minute mark
      tick(2 * 60 * 1000);
      expect(fakeMutate).not.toHaveBeenCalled();
    });

    it('after a mousemove reset, logout fires 10 minutes from the reset point', () => {
      renderPortal();
      tick(8 * 60 * 1000);
      act(() => { fireEvent.mouseMove(document); });
      tick(IDLE_MS);
      expect(fakeMutate).toHaveBeenCalledTimes(1);
    });

    it('a mousemove at 8 minutes also suppresses the warning banner at the original 9-minute mark', () => {
      renderPortal();
      tick(8 * 60 * 1000);
      act(() => { fireEvent.mouseMove(document); });
      // 1 minute later = original 9-minute mark; no banner yet
      tick(60 * 1000);
      expect(screen.queryByText(/Sekunde/)).not.toBeInTheDocument();
    });

    it('banner appears at 9 minutes from the reset point, not from the original start', () => {
      renderPortal();
      tick(8 * 60 * 1000);
      act(() => { fireEvent.mouseMove(document); });
      tick(WARN_AT);
      expect(screen.getByText((c) => c.includes('Sekunde'))).toBeInTheDocument();
    });

    it('a keydown event also resets the timer', () => {
      renderPortal();
      tick(8 * 60 * 1000);
      act(() => { fireEvent.keyDown(document); });
      tick(2 * 60 * 1000);
      expect(fakeMutate).not.toHaveBeenCalled();
    });

    it('a touchstart event also resets the timer', () => {
      renderPortal();
      tick(8 * 60 * 1000);
      act(() => { fireEvent.touchStart(document); });
      tick(2 * 60 * 1000);
      expect(fakeMutate).not.toHaveBeenCalled();
    });

    it('a scroll event also resets the timer', () => {
      renderPortal();
      tick(8 * 60 * 1000);
      act(() => { fireEvent.scroll(document); });
      tick(2 * 60 * 1000);
      expect(fakeMutate).not.toHaveBeenCalled();
    });
  });

  // ── 4. "Stay logged in" cancels the countdown ───────────────────────────────

  describe('"Stay logged in" / "Aktiv bleiben" button behaviour', () => {
    it('clicking "Aktiv bleiben" hides the warning banner', () => {
      renderPortal();
      tick(WARN_AT);
      expect(screen.getByText((c) => c.includes('Sekunde'))).toBeInTheDocument();

      click(screen.getByRole('button', { name: 'Aktiv bleiben' }));
      expect(screen.queryByText(/Sekunde/)).not.toBeInTheDocument();
    });

    it('clicking "Aktiv bleiben" resets the timer so no logout fires at the original 10-minute mark', () => {
      renderPortal();
      tick(WARN_AT);
      click(screen.getByRole('button', { name: 'Aktiv bleiben' }));
      // Advance the remaining 1 minute to the original 10-minute mark
      tick(WARN_MS);
      expect(fakeMutate).not.toHaveBeenCalled();
    });

    it('after clicking "Aktiv bleiben", logout fires 10 minutes from the click point', () => {
      renderPortal();
      tick(WARN_AT);
      click(screen.getByRole('button', { name: 'Aktiv bleiben' }));
      tick(IDLE_MS);
      expect(fakeMutate).toHaveBeenCalledTimes(1);
    });

    it('after clicking "Stay logged in" in EN, the banner disappears', () => {
      renderPortal();
      click(screen.getByTestId('lang-toggle'));
      tick(WARN_AT);
      click(screen.getByRole('button', { name: 'Stay logged in' }));
      expect(screen.queryByText(/second/i)).not.toBeInTheDocument();
    });

    it('the banner re-appears after a second idle period following "Aktiv bleiben"', () => {
      renderPortal();
      tick(WARN_AT);
      click(screen.getByRole('button', { name: 'Aktiv bleiben' }));
      // Let a full new idle period elapse until the second warning fires
      tick(WARN_AT);
      expect(screen.getByText((c) => c.includes('Sekunde'))).toBeInTheDocument();
    });
  });

  // ── 5. Tab visibility pauses and resumes the idle timer ─────────────────────

  describe('tab visibility pauses and resumes the idle timer', () => {
    it('does not show a warning or log out while the tab is hidden', () => {
      renderPortal();
      tick(8 * 60 * 1000);
      setTabVisibility('hidden');

      tick(5 * 60 * 1000);

      expect(screen.queryByText(/Sekunde/)).not.toBeInTheDocument();
      expect(fakeMutate).not.toHaveBeenCalled();
    });

    it('shows the warning after the remaining visible minute once the tab is focused again', () => {
      renderPortal();
      tick(8 * 60 * 1000);
      setTabVisibility('hidden');
      tick(5 * 60 * 1000);
      setTabVisibility('visible');

      tick(60 * 1000);

      expect(screen.getByText((c) => c.includes('60 Sekunden'))).toBeInTheDocument();
      expect(fakeMutate).not.toHaveBeenCalled();
    });

    it('keeps the warning countdown frozen while the tab is hidden', () => {
      renderPortal();
      tick(WARN_AT);
      tick(15 * 1000);
      expect(screen.getByText((c) => c.includes('45 Sekunden'))).toBeInTheDocument();

      setTabVisibility('hidden');
      tick(2 * 60 * 1000);
      expect(screen.getByText((c) => c.includes('45 Sekunden'))).toBeInTheDocument();

      setTabVisibility('visible');
      tick(1000);
      expect(screen.getByText((c) => c.includes('44 Sekunden'))).toBeInTheDocument();
    });

    it('logs out only after the remaining visible time has elapsed following tab focus', () => {
      renderPortal();
      tick(8 * 60 * 1000);
      setTabVisibility('hidden');
      tick(5 * 60 * 1000);
      setTabVisibility('visible');

      tick((2 * 60 * 1000) - 1);
      expect(fakeMutate).not.toHaveBeenCalled();

      tick(1);
      expect(fakeMutate).toHaveBeenCalledTimes(1);
    });
  });

  // ── 6. Cleanup on unmount (navigation away without logout) ──────────────────

  describe('cleanup on unmount (navigation away without logout)', () => {
    it('mutate() is NOT called at the original 10-minute mark after unmounting at 5 minutes', () => {
      const { unmount } = render(
        <LanguageProvider>
          <LanguageToggle />
          <Portal />
        </LanguageProvider>,
      );
      tick(5 * 60 * 1000);
      // Simulate navigating away — component unmounts
      act(() => { unmount(); });
      // Advance to the original 10-minute mark; stale timers must NOT fire
      tick(5 * 60 * 1000);
      expect(fakeMutate).not.toHaveBeenCalled();
    });

    it('the warning banner is not present after unmounting at 9 minutes', () => {
      const { unmount } = render(
        <LanguageProvider>
          <LanguageToggle />
          <Portal />
        </LanguageProvider>,
      );
      // Advance to the warning point so the banner would appear
      tick(WARN_AT);
      expect(screen.getByText((c) => c.includes('Sekunde'))).toBeInTheDocument();
      // Navigate away
      act(() => { unmount(); });
      // Banner must no longer be in the document
      expect(screen.queryByText(/Sekunde/)).not.toBeInTheDocument();
      expect(screen.queryByText(/second/i)).not.toBeInTheDocument();
    });

    it('does not schedule new timers when activity events fire after unmounting', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const { unmount } = render(
        <LanguageProvider>
          <LanguageToggle />
          <Portal />
        </LanguageProvider>,
      );

      const timerCallsBeforeUnmount = setTimeoutSpy.mock.calls.length;
      act(() => { unmount(); });

      act(() => {
        fireEvent.mouseMove(document);
        fireEvent.keyDown(document);
      });

      expect(setTimeoutSpy).toHaveBeenCalledTimes(timerCallsBeforeUnmount);
      setTimeoutSpy.mockRestore();
    });

    it('does not schedule timers or log out when remaining activity events fire after unmounting', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const { unmount } = render(
        <LanguageProvider>
          <LanguageToggle />
          <Portal />
        </LanguageProvider>,
      );

      const timerCallsBeforeUnmount = setTimeoutSpy.mock.calls.length;
      const intervalCallsBeforeUnmount = setIntervalSpy.mock.calls.length;
      act(() => { unmount(); });

      act(() => {
        fireEvent.mouseDown(document);
        fireEvent.touchStart(document);
        fireEvent.scroll(document);
      });
      setTabVisibility('hidden');
      setTabVisibility('visible');

      expect(setTimeoutSpy).toHaveBeenCalledTimes(timerCallsBeforeUnmount);
      expect(setIntervalSpy).toHaveBeenCalledTimes(intervalCallsBeforeUnmount);

      tick(IDLE_MS);
      expect(fakeMutate).not.toHaveBeenCalled();

      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    });
  });
});
