import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
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
  }

  public render() {
    const props = (this as any).props as Props;
    if (this.state.hasError) {
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
