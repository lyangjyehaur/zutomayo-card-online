/* global module, require, process, URL */

const pino = require('pino');
const promClient = require('prom-client');
const crypto = require('crypto');

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const logger = pino({
  level: LOG_LEVEL,
  base: { service: 'api-server' },
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.passwordHash', '*.salt'],
});

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

const rateLimitedTotal = new promClient.Counter({
  name: 'rate_limited_requests_total',
  help: 'Requests rejected by rate limiter',
  labelNames: ['pathname'],
  registers: [register],
});

const relationshipOutboxPending = new promClient.Gauge({
  name: 'relationship_change_outbox_pending',
  help: 'Relationship/account revocation events waiting for delivery',
  registers: [register],
});

const relationshipOutboxDeadLetter = new promClient.Gauge({
  name: 'relationship_change_outbox_dead_letter',
  help: 'Relationship/account revocation events that exhausted retries',
  registers: [register],
});

const relationshipOutboxOldestAgeSeconds = new promClient.Gauge({
  name: 'relationship_change_outbox_oldest_age_seconds',
  help: 'Age of the oldest undelivered relationship/account revocation event',
  registers: [register],
});

const relationshipOutboxProcessedTotal = new promClient.Counter({
  name: 'relationship_change_outbox_processed_total',
  help: 'Relationship/account revocation outbox delivery results',
  labelNames: ['result'],
  registers: [register],
});

const relationshipOutboxMetricsRefreshSuccess = new promClient.Gauge({
  name: 'relationship_change_outbox_metrics_refresh_success',
  help: 'Whether the latest relationship outbox PostgreSQL metrics refresh succeeded',
  registers: [register],
});

const relationshipOutboxMetricsLastSuccess = new promClient.Gauge({
  name: 'relationship_change_outbox_metrics_last_success_unixtime_seconds',
  help: 'Unix timestamp of the latest successful relationship outbox metrics refresh',
  registers: [register],
});

const officialRulingsSyncRunsTotal = new promClient.Counter({
  name: 'official_rulings_sync_runs_total',
  help: 'Official rulings source check results',
  labelNames: ['status', 'trigger_source'],
  registers: [register],
});

const officialRulingsSyncChangesTotal = new promClient.Counter({
  name: 'official_rulings_sync_changes_total',
  help: 'Official rulings source changes detected by resource and change type',
  labelNames: ['resource_type', 'change_type'],
  registers: [register],
});

const officialRulingsTranslationWritesTotal = new promClient.Counter({
  name: 'official_rulings_translation_writes_total',
  help: 'Official rulings translation rows successfully written',
  labelNames: ['resource_type', 'locale', 'status', 'operation'],
  registers: [register],
});

const officialRulingsTranslationFailuresTotal = new promClient.Counter({
  name: 'official_rulings_translation_failures_total',
  help: 'Official rulings translation generation failures',
  labelNames: ['resource_type', 'locale', 'operation'],
  registers: [register],
});

function normalizePath(path) {
  return path
    .replace(/\/api\/imgproxy\/.+/i, '/api/imgproxy/:path')
    .replace(/\/api\/cards\/[^/]+/i, '/api/cards/:id')
    .replace(/\/api\/decks\/[^/]+/i, '/api/decks/:id')
    .replace(/\/api\/matches\/[^/]+/i, '/api/matches/:id')
    .replace(/\/api\/feedback\/posts\/[^/]+/i, '/api/feedback/posts/:id')
    .replace(/\/api\/feedback\/comments\/[^/]+/i, '/api/feedback/comments/:id')
    .replace(/\/api\/admin\/cards\/[^/]+/i, '/api/admin/cards/:id')
    .replace(/\/api\/admin\/users\/[^/]+/i, '/api/admin/users/:id')
    .replace(/\/api\/admin\/config\/[^/]+/i, '/api/admin/config/:id')
    .replace(
      /\/api\/admin\/official-content\/translations\/(qa|errata)\/[^/]+\/[^/]+(?:\/generate)?/i,
      '/api/admin/official-content/translations/:type/:id/:locale',
    )
    .replace(/\/api\/official\/(qa|errata)\/[^/]+/i, '/api/official/:type/:id')
    .replace(/\/api\/feedback\/admin\/posts\/[^/]+/i, '/api/feedback/admin/posts/:id');
}

/**
 * Attach request-scoped observability to a native http request.
 * Generates request id, sets response header, registers finish listener for metrics + log.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {{ log: import('pino').Logger, requestId: string }}
 */
function attachRequestObservability(req, res) {
  const start = Date.now();
  const requestId = (req.headers['x-request-id'] || crypto.randomUUID()).toString();
  res.setHeader('X-Request-Id', requestId);
  const log = logger.child({ requestId });
  const url = new URL(req.url, `http://localhost:${req.socket.localPort || 3001}`);
  const method = req.method;
  const rawPath = url.pathname;
  const pathname = normalizePath(rawPath);
  res.once('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const status = String(res.statusCode || 500);
    httpRequestDuration.labels(method, pathname, status).observe(duration);
    httpRequestsTotal.labels(method, pathname, status).inc();
    log.info({ method, path: pathname, status, durationMs: duration * 1000 }, 'request completed');
  });
  return { log, requestId };
}

async function metricsResponse(res) {
  res.writeHead(200, { 'Content-Type': register.contentType });
  res.end(await register.metrics());
}

module.exports = {
  logger,
  register,
  httpRequestDuration,
  httpRequestsTotal,
  relationshipOutboxPending,
  relationshipOutboxDeadLetter,
  relationshipOutboxOldestAgeSeconds,
  relationshipOutboxProcessedTotal,
  relationshipOutboxMetricsRefreshSuccess,
  relationshipOutboxMetricsLastSuccess,
  officialRulingsSyncRunsTotal,
  officialRulingsSyncChangesTotal,
  officialRulingsTranslationWritesTotal,
  officialRulingsTranslationFailuresTotal,
  rateLimitedTotal,
  attachRequestObservability,
  metricsResponse,
};
