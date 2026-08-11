import React, { ErrorInfo, ReactNode } from 'react';
import * as Sentry from '@sentry/react';

interface Props {
  children?: ReactNode;
  // A render-prop form is supported (error, reset) => ReactNode so a local
  // boundary (e.g. wrapping just the Ledger) can show what actually broke
  // and offer its own recovery (like "Back", not a full page reload)
  // without needing a separate mechanism to clear the caught error --
  // `reset` clears this boundary's own state so the wrapped tree gets a
  // fresh mount attempt on the next render, same effect as the static
  // fallback's window.location.reload() but scoped to just this subtree.
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false
  };

  constructor(props: Props) {
    super(props);
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    Sentry.captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack } },
    });
  }

  private reset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    const props = (this as any).props as Props;
    if (this.state.hasError) {
      if (typeof props.fallback === 'function') {
        return (props.fallback as (error: Error, reset: () => void) => ReactNode)(
          this.state.error || new Error('An unexpected error occurred.'),
          this.reset
        );
      }
      if (props.fallback) {
        return props.fallback;
      }
      return (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-error, #EF4444)' }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>Something went wrong.</h2>
          <p style={{ fontSize: 13, color: 'var(--color-muted, #94A3B8)' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button 
            onClick={() => window.location.reload()}
            style={{ 
              marginTop: 16, padding: '8px 16px', background: 'var(--color-surface-2, #1E293B)',
              border: '1px solid var(--color-border, #334155)', borderRadius: 8, color: 'var(--color-foreground, white)',
              cursor: 'pointer'
            }}
          >
            Reload application
          </button>
        </div>
      );
    }

    return props.children;
  }
}
