import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN || process.env.GLITCHTIP_DSN || '';
const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0);

export const isServerErrorReportingEnabled = Boolean(dsn);

export function initServerErrorReporting(serviceName: string): void {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
  });
  Sentry.setTag('service', serviceName);
}

export function captureServerError(
  error: unknown,
  context: {
    extra?: Record<string, unknown>;
    tags?: Record<string, string | number | boolean | undefined>;
  } = {},
): void {
  if (!isServerErrorReportingEnabled) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context.tags ?? {})) {
      if (value !== undefined) scope.setTag(key, value);
    }
    if (context.extra) scope.setContext('details', context.extra);
    Sentry.captureException(error);
  });
}

export async function flushErrorReporting(timeoutMs = 2000): Promise<void> {
  if (!isServerErrorReportingEnabled) return;
  await Sentry.flush(timeoutMs);
}
