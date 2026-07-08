import promClient, { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { Next, ParameterizedContext } from 'koa';
import type { ObsMiddleware } from './logger';

const register = new Registry();
promClient.collectDefaultMetrics({ register });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

export const matchmakingQueueDepth = new Gauge({
  name: 'matchmaking_queue_depth',
  help: 'Current matchmaking queue depth',
  registers: [register],
});

export const activeSocketConnections = new Gauge({
  name: 'active_socket_connections',
  help: 'Active Socket.IO connections',
  registers: [register],
});

/** Normalize dynamic path segments to keep label cardinality bounded. */
function normalizePath(path: string): string {
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
    .replace(/\/api\/feedback\/admin\/posts\/[^/]+/i, '/api/feedback/admin/posts/:id')
    .replace(/\/games\/[^/]+\/[^/]+/i, '/games/:name/:id');
}

export function metricsMiddleware(): ObsMiddleware {
  return async (ctx, next) => {
    const start = Date.now();
    try {
      await next();
    } finally {
      const duration = (Date.now() - start) / 1000;
      const path = normalizePath(ctx.path);
      const status = String(ctx.status);
      httpRequestDuration.labels(ctx.method, path, status).observe(duration);
      httpRequestsTotal.labels(ctx.method, path, status).inc();
    }
  };
}

export function metricsEndpoint(): ObsMiddleware {
  return async (ctx) => {
    ctx.set('Content-Type', register.contentType);
    ctx.body = await register.metrics();
  };
}

export { register };
export type { ObsMiddleware, ParameterizedContext, Next };
