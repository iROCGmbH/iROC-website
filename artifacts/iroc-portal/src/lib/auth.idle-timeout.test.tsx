import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, PORTAL_IDLE_TIMEOUT_MS, useAuth } from './auth';

const setLocation = vi.fn();

vi.mock('wouter', () => ({
  useLocation: () => ['/', setLocation],
}));

vi.mock('@workspace/api-client-react', () => ({
  setAuthTokenGetter: vi.fn(),
}));

function AuthProbe() {
  const { login, isAuthenticated } = useAuth();

  return (
    <div>
      <span>{isAuthenticated ? 'authenticated' : 'signed out'}</span>
      <button onClick={() => login('test-token', { customerNr: 'DOC10025' } as never)}>
        Login
      </button>
    </div>
  );
}

describe('portal idle logout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setLocation.mockClear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('logs out after ten minutes without activity', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    expect(screen.getByText('authenticated')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(PORTAL_IDLE_TIMEOUT_MS - 1);
    });
    expect(screen.getByText('authenticated')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('signed out')).toBeInTheDocument();
    expect(localStorage.getItem('iroc_portal_token')).toBeNull();
    expect(setLocation).toHaveBeenLastCalledWith('/');
  });

  it('resets the inactivity window after user activity', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Login' }));
    act(() => {
      vi.advanceTimersByTime(PORTAL_IDLE_TIMEOUT_MS - 1000);
      window.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('authenticated')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(PORTAL_IDLE_TIMEOUT_MS - 1001);
    });
    expect(screen.getByText('authenticated')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('signed out')).toBeInTheDocument();
  });
});