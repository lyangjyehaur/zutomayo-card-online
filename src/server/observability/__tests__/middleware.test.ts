import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParameterizedContext } from 'koa';
import { logger, requestLoggingMiddleware } from '../logger';
import { httpRequestDuration, httpRequestsTotal, metricsMiddleware } from '../metrics';

function context(status = 404): ParameterizedContext {
  return {
    method: 'POST',
    path: '/games/zutomayo-card/create',
    status,
    get: vi.fn().mockReturnValue('request-test'),
    set: vi.fn(),
  } as unknown as ParameterizedContext;
}

describe('observability middleware error status', () => {
  beforeEach(() => {
    httpRequestDuration.reset();
    httpRequestsTotal.reset();
    vi.restoreAllMocks();
  });

  it('logs the thrown HTTP status before Koa updates the context', async () => {
    const info = vi.fn();
    vi.spyOn(logger, 'child').mockReturnValue({ info } as never);
    const error = Object.assign(new Error('Forbidden'), { status: 403 });

    await expect(requestLoggingMiddleware()(context(), async () => Promise.reject(error))).rejects.toBe(error);

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/games/zutomayo-card/create', status: 403 }),
      'request completed',
    );
  });

  it('records the thrown HTTP status before Koa updates the context', async () => {
    const error = Object.assign(new Error('Forbidden'), { status: 403 });

    await expect(metricsMiddleware()(context(), async () => Promise.reject(error))).rejects.toBe(error);

    const metric = await httpRequestsTotal.get();
    expect(metric.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          labels: { method: 'POST', path: '/games/:name/:id', status: '403' },
          value: 1,
        }),
      ]),
    );
  });
});
