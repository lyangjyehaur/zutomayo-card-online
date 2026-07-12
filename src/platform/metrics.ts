import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import promClient, { Counter, Gauge, Histogram, Registry } from 'prom-client';

const register = new Registry();
promClient.collectDefaultMetrics({ register, prefix: 'platform_' });

export const platformHttpRequestsTotal = new Counter({
  name: 'platform_http_requests_total',
  help: 'Total platform HTTP requests',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [register],
});

export const platformHttpDurationSeconds = new Histogram({
  name: 'platform_http_request_duration_seconds',
  help: 'Platform HTTP request latency in seconds',
  labelNames: ['method', 'path', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const platformDependencyFailuresTotal = new Counter({
  name: 'platform_dependency_failures_total',
  help: 'Failed platform dependency health checks',
  labelNames: ['dependency'] as const,
  registers: [register],
});

export const platformActiveRooms = new Gauge({
  name: 'platform_active_rooms',
  help: 'Active Colyseus rooms by type',
  labelNames: ['room_type'] as const,
  registers: [register],
});

export const platformConnectedClients = new Gauge({
  name: 'platform_connected_clients',
  help: 'Connected Colyseus clients across active rooms',
  registers: [register],
});

export const platformReconnectsTotal = new Counter({
  name: 'platform_reconnects_total',
  help: 'Same-user room or seat reconnects accepted by the platform',
  labelNames: ['room_type'] as const,
  registers: [register],
});

function normalizedPath(path: string): string {
  if (path === '/health' || path === '/ready' || path === '/metrics') return path;
  if (path.startsWith('/matchmake/')) return '/matchmake/:operation/:room';
  return '/other';
}

export function platformMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const path = normalizedPath(req.path);
    const status = String(res.statusCode);
    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    platformHttpRequestsTotal.labels(req.method, path, status).inc();
    platformHttpDurationSeconds.labels(req.method, path, status).observe(elapsedSeconds);
  });
  next();
}

function timingSafeTokenEqual(expected: string, received: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function platformMetricsAuthorized(
  authorization: string | undefined,
  token = process.env.METRICS_TOKEN || '',
): boolean {
  if (!token) return process.env.NODE_ENV !== 'production';
  const prefix = 'Bearer ';
  if (!authorization?.startsWith(prefix)) return false;
  return timingSafeTokenEqual(token, authorization.slice(prefix.length));
}

export async function platformMetricsText(): Promise<{ contentType: string; body: string }> {
  return { contentType: register.contentType, body: await register.metrics() };
}

export function recordPlatformDependencyFailure(dependency: string): void {
  platformDependencyFailuresTotal.labels(dependency).inc();
}

export function setPlatformRuntimeMetrics(roomCounts: Record<string, number>, connectedClients: number): void {
  platformActiveRooms.reset();
  for (const [roomType, count] of Object.entries(roomCounts)) {
    platformActiveRooms.labels(roomType).set(Math.max(0, Number(count) || 0));
  }
  platformConnectedClients.set(Math.max(0, Number(connectedClients) || 0));
}

export function recordPlatformReconnect(roomType: string): void {
  platformReconnectsTotal.labels(roomType).inc();
}

export { register as platformMetricsRegister };
