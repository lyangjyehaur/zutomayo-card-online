import { describe, expect, it, vi } from 'vitest';
import { createServiceReadiness } from '../serviceLifecycle';

describe('service readiness lifecycle', () => {
  it('reports dependency state and immediately becomes draining', async () => {
    const checkDependencies = vi.fn(async () => ({ ok: true, checks: { postgres: 'up' } }));
    const readiness = createServiceReadiness(checkDependencies);

    await expect(readiness.check()).resolves.toEqual({
      ok: true,
      status: 'ready',
      checks: { postgres: 'up' },
    });
    expect(readiness.beginDrain()).toBe(true);
    expect(readiness.beginDrain()).toBe(false);
    await expect(readiness.check()).resolves.toEqual({
      ok: false,
      status: 'draining',
      checks: { service: 'draining' },
    });
    expect(checkDependencies).toHaveBeenCalledOnce();
  });

  it('returns degraded when a dependency probe fails', async () => {
    const readiness = createServiceReadiness(async () => ({
      ok: false,
      checks: { postgres: 'down', redis: 'up' },
    }));
    await expect(readiness.check()).resolves.toEqual({
      ok: false,
      status: 'degraded',
      checks: { postgres: 'down', redis: 'up' },
    });
  });
});
