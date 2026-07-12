import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  platformMetricsAuthorized,
  platformMetricsMiddleware,
  platformMetricsRegister,
  platformMetricsText,
  recordPlatformDependencyFailure,
  setPlatformRuntimeMetrics,
} from '../metrics';

describe('platform metrics', () => {
  beforeEach(() => {
    platformMetricsRegister.resetMetrics();
  });

  it('requires a bearer token when configured', () => {
    expect(platformMetricsAuthorized(undefined, 'metrics-secret')).toBe(false);
    expect(platformMetricsAuthorized('Bearer wrong', 'metrics-secret')).toBe(false);
    expect(platformMetricsAuthorized('Bearer metrics-secret', 'metrics-secret')).toBe(true);
  });

  it('records bounded HTTP labels after the response finishes', async () => {
    const req = { method: 'POST', path: '/matchmake/join/quick_match' };
    const res = Object.assign(new EventEmitter(), { statusCode: 201 });
    const next = vi.fn();
    platformMetricsMiddleware(req as never, res as never, next);
    res.emit('finish');
    expect(next).toHaveBeenCalledOnce();
    const metrics = await platformMetricsText();
    expect(metrics.body).toContain('platform_http_requests_total{method="POST",path="/matchmake/:operation/:room",status="201"} 1');
  });

  it('exports dependency, room, and connection metrics', async () => {
    recordPlatformDependencyFailure('postgres');
    setPlatformRuntimeMetrics({ quick_match: 2, custom_room: 1 }, 5);
    const metrics = await platformMetricsText();
    expect(metrics.body).toContain('platform_dependency_failures_total{dependency="postgres"} 1');
    expect(metrics.body).toContain('platform_active_rooms{room_type="quick_match"} 2');
    expect(metrics.body).toContain('platform_connected_clients 5');
  });
});
