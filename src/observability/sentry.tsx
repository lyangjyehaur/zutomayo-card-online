import * as Sentry from '@sentry/react';
import type { ReactNode } from 'react';
import type { ProfileResponse } from '../api/client';

const dsn = import.meta.env.VITE_SENTRY_DSN || import.meta.env.VITE_GLITCHTIP_DSN || '';
const tracesSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0);

export const isErrorReportingEnabled = Boolean(dsn);

export function initErrorReporting(): void {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
  });
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  if (!isErrorReportingEnabled) return <>{children}</>;
  return <Sentry.ErrorBoundary fallback={<></>}>{children}</Sentry.ErrorBoundary>;
}

export function setErrorReportingUser(profile: ProfileResponse | null): void {
  if (!isErrorReportingEnabled) return;
  if (!profile) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: profile.id,
    username: profile.nickname || undefined,
  });
}

export function addErrorBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (!isErrorReportingEnabled) return;
  Sentry.addBreadcrumb({
    category: 'app',
    data,
    level: 'info',
    message,
  });
}
