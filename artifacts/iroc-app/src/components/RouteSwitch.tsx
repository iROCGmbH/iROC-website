import type { ComponentType, ReactNode } from 'react';
import { lazy } from 'react';
import { Route, Switch } from 'wouter';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

const NotFound = lazy(() => import('@/pages/not-found'));

export type RegisteredRoute = {
  path: string;
  protected: boolean;
  component: ComponentType;
};

/** Lightweight route renderer that keeps recovery labels testable in isolation. */
export function RouteSwitch({
  routes,
  renderProtected,
}: {
  routes: readonly RegisteredRoute[];
  renderProtected: (Page: ComponentType) => ReactNode;
}) {
  return (
    <Switch>
      {routes.map(({ path, component: Page, protected: requiresAuth }) => (
        <Route
          key={path}
          path={path}
          component={() => (
            <RouteErrorBoundary routeLabel={path}>
              {requiresAuth ? renderProtected(Page) : <Page />}
            </RouteErrorBoundary>
          )}
        />
      ))}
      <Route component={NotFound} />
    </Switch>
  );
}