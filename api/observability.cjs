const Sentry = require('@sentry/node');

const dsn = process.env.SENTRY_DSN || process.env.GLITCHTIP_DSN || '';
const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0);
const enabled = Boolean(dsn);

function initErrorReporting(serviceName) {
  if (!enabled) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
  });
  Sentry.setTag('service', serviceName);
}

function captureError(error, context = {}) {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context.tags || {})) {
      if (value !== undefined) scope.setTag(key, value);
    }
    if (context.extra) scope.setContext('details', context.extra);
    Sentry.captureException(error);
  });
}

async function flushErrorReporting(timeoutMs = 2000) {
  if (!enabled) return;
  await Sentry.flush(timeoutMs);
}

module.exports = {
  captureError,
  enabled,
  flushErrorReporting,
  initErrorReporting,
};
