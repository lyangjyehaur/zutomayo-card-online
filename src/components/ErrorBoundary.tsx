import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recoverPwaAndReload, reloadForAppUpdate } from '../clientVersion';
import { t } from '../i18n';
import { Button } from '../ui';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  errorName: string;
  hasError: boolean;
  isRecovering: boolean;
}

function trackCrash(error: Error, errorInfo: ErrorInfo): void {
  try {
    window.umami?.track('C_System_Crash', {
      error_name: error.name || 'Error',
      error_message: error.message.slice(0, 120),
      component_stack: errorInfo.componentStack?.slice(0, 240),
      path: window.location.pathname,
    });
  } catch {
    // Crash telemetry must never block recovery UI.
  }
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    errorName: '',
    hasError: false,
    isRecovering: false,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      errorName: error.name || 'Error',
      hasError: true,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(error, errorInfo);
    trackCrash(error, errorInfo);
  }

  retry = (): void => {
    this.setState({ errorName: '', hasError: false, isRecovering: false });
  };

  recover = async (): Promise<void> => {
    this.setState({ isRecovering: true });
    try {
      window.umami?.track('C_PWA_Recover_ClearCache', {
        source: 'error_boundary',
        path: window.location.pathname,
      });
    } catch {
      // Ignore analytics failures while recovering from a crash.
    }
    await recoverPwaAndReload();
  };

  goToLobby = (): void => {
    window.location.assign('/');
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="app-screen error-boundary-screen">
        <section className="empty-route-panel error-boundary-panel" role="alert" aria-live="assertive">
          <span>{t('appError.kicker')}</span>
          <h1>{t('appError.title')}</h1>
          <p>{t('appError.body')}</p>
          {this.state.errorName && <code>{this.state.errorName}</code>}
          <div className="error-boundary-actions">
            <Button variant="primary" type="button" onClick={this.retry} data-umami-event="C_App_Crash_Retry">
              {t('appError.retryAction')}
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={reloadForAppUpdate}
              data-umami-event="C_App_Crash_Reload"
            >
              {t('online.reloadAction')}
            </Button>
            <Button
              variant="danger"
              type="button"
              disabled={this.state.isRecovering}
              onClick={() => void this.recover()}
              data-umami-event="C_PWA_Recover_ClearCache"
              data-umami-event-source="error_boundary"
            >
              {this.state.isRecovering ? t('pwa.recoveringAction') : t('pwa.clearCacheAction')}
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={this.goToLobby}
              data-umami-event="C_App_Crash_BackToLobby"
            >
              {t('common.backToLobby')}
            </Button>
          </div>
        </section>
      </main>
    );
  }
}
