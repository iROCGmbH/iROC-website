import { Suspense, lazy } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { RouteSwitch } from '@/components/RouteSwitch';
import { Router as WouterRouter } from 'wouter';

describe('RouteErrorBoundary', () => {
  it('shows bilingual recovery text and retries after a rejected lazy import', async () => {
    const BrokenPage = lazy(() =>
      Promise.reject(new Error('route chunk failed')),
    );
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(
      <RouteErrorBoundary onRetry={onRetry} routeLabel="/iroc-website/doctors">
        <Suspense fallback={<div>Loading</div>}>
          <BrokenPage />
        </Suspense>
      </RouteErrorBoundary>,
    );

    const recoveryMessage = await screen.findByRole('alert');
    expect(recoveryMessage).toHaveTextContent(
      'Seite konnte nicht geladen werden / Page could not be loaded',
    );
    expect(recoveryMessage).toHaveTextContent(
      'Die Seite „/iroc-website/doctors“ konnte nicht geladen werden',
    );
    expect(recoveryMessage).toHaveTextContent(
      'The page “/iroc-website/doctors” could not be loaded',
    );
    expect(recoveryMessage).toHaveTextContent(/Support-Referenz \/ Support reference: ROUTE-[A-Z0-9]+/);
    expect(recoveryMessage).not.toHaveTextContent('route chunk failed');

    await user.click(
      screen.getByRole('button', { name: 'Erneut versuchen / Try again' }),
    );

    await waitFor(() => expect(onRetry).toHaveBeenCalledOnce());
  });

  it('passes matched public and protected route paths into recovery without loading the full app', async () => {
    const Broken = () => { throw new Error('private loader detail'); };
    const routes = [
      { path: '/public-recovery', protected: false, component: Broken },
      { path: '/protected-recovery', protected: true, component: Broken },
    ];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const renderRoute = async (path: string) => {
      window.history.replaceState({}, '', path);
      const result = render(
        <WouterRouter>
          <RouteSwitch routes={routes} renderProtected={(Page) => <Page />} />
        </WouterRouter>,
      );
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(`Die Seite „${path}“ konnte nicht geladen werden`);
      expect(alert).toHaveTextContent(`The page “${path}” could not be loaded`);
      expect(alert).not.toHaveTextContent('private loader detail');
      result.unmount();
    };
    await renderRoute('/public-recovery');
    await renderRoute('/protected-recovery');
    consoleError.mockRestore();
  });
});