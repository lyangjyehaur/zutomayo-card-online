/* global module, require, process, URL */
/* eslint-disable @typescript-eslint/no-require-imports */
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

function normalizePath(path) {
  return path
    .replace(/\/api\/cards\/[^/]+/i, '/api/cards/:id')
    .replace(/\/api\/decks\/[^/]+/i, '/api/decks/:id')
    .replace(/\/api\/matches\/[^/]+/i, '/api/matches/:id')
    .replace(/\/api\/feedback\/posts\/[^/]+/i, '/api/feedback/posts/:id')
    .replace(/\/api\/feedback\/comments\/[^/]+/i, '/api/feedback/comments/:id')
    .replace(/\/api\/admin\/cards\/[^/]+/i, '/api/admin/cards/:id')
    .replace(/\/api\/admin\/users\/[^/]+/i, '/api/admin/users/:id')
    .replace(/\/api\/admin\/config\/[^/]+/i, '/api/admin/config/:id')
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

function metricsResponse(res) {
  res.writeHead(200, { 'Content-Type': register.contentType });
  res.end(register.metrics());
}

module.exports = {
  logger,
  register,
  httpRequestDuration,
  httpRequestsTotal,
  rateLimitedTotal,
  attachRequestObservability,
  metricsResponse,
};
