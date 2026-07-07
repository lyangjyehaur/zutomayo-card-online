import * as Sentry from '@sentry/react';
import { APP_VERSION_INFO } from './version';

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

/** Initialize GlitchTip/Sentry error tracking. No-op when VITE_SENTRY_DSN is unset. */
export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: `${APP_VERSION_INFO.appVersion}@${APP_VERSION_INFO.buildId}`,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE) || 0.1,
    initialScope: {
      tags: {
        service: 'frontend',
      },
    },
  });
}

export { Sentry };
