import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

type RouteErrorBoundaryProps = {
  children: ReactNode;
  onRetry?: () => void;
  routeLabel?: string;
};

type RouteErrorBoundaryState = {
  hasError: boolean;
};

/**
 * A failed route chunk is recoverable by requesting the current document again.
 * Keeping this boundary at the route level means the rest of the admin shell
 * can still be replaced with a useful recovery action instead of an uncaught
 * lazy-import error.
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: unknown, _errorInfo: ErrorInfo) {
    // React requires an error boundary to handle the render error. The retry
    // action below performs the user-visible recovery; no extra logging is
    // needed here because the browser reports the failed chunk request.
  }

  private handleRetry = () => {
    this.setState({ hasError: false }, () => {
      if (this.props.onRetry) {
        this.props.onRetry();
      } else {
        window.location.reload();
      }
    });
  };

  private getDiagnosticReference() {
    const route = this.props.routeLabel ?? window.location.pathname;
    let hash = 0;
    for (const character of route) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return `ROUTE-${Math.abs(hash).toString(36).toUpperCase()}`;
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const routeLabel = this.props.routeLabel ?? window.location.pathname;
    return (
      <div
        role="alert"
        className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div className="max-w-lg space-y-2">
          <h1 className="text-xl font-semibold">
            Seite konnte nicht geladen werden / Page could not be loaded
          </h1>
          <p className="text-sm text-muted-foreground">
            Die Seite „{routeLabel}“ konnte nicht geladen werden. Bitte versuchen
            Sie es erneut. / The page “{routeLabel}” could not be loaded.
            Please try again.
          </p>
          <p className="text-xs text-muted-foreground">
            Support-Referenz / Support reference: <code>{this.getDiagnosticReference()}</code>
          </p>
        </div>
        <Button type="button" onClick={this.handleRetry}>
          Erneut versuchen / Try again
        </Button>
      </div>
    );
  }
}