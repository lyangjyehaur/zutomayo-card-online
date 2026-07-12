import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fetchWithResilience, resetOAuthHttpCircuits } = require('../oauthHttp.cjs') as {
  fetchWithResilience: (
    fetchImpl: (url: string, options: Record<string, unknown>) => Promise<Response>,
    url: string,
    options?: Record<string, unknown>,
    overrides?: Record<string, unknown>,
  ) => Promise<Response>;
  resetOAuthHttpCircuits: () => void;
};

describe('OAuth HTTP resilience', () => {
  beforeEach(() => resetOAuthHttpCircuits());

  it('retries transient GET failures within a bounded budget', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const response = await fetchWithResilience(
      fetchImpl,
      'https://auth.example/.well-known/openid-configuration',
      undefined,
      {
        timeoutMs: 1_000,
        maxAttempts: 2,
      },
    );

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-idempotent token exchanges', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    const response = await fetchWithResilience(
      fetchImpl,
      'https://auth.example/oidc/token',
      { method: 'POST' },
      {
        retry: false,
        timeoutMs: 1_000,
        maxAttempts: 3,
      },
    );

    expect(response.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('opens a circuit after repeated dependency failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const overrides = { timeoutMs: 1_000, maxAttempts: 1, failureThreshold: 2, cooldownMs: 60_000 };

    await expect(fetchWithResilience(fetchImpl, 'https://auth.example/userinfo', {}, overrides)).rejects.toThrow(
      'network down',
    );
    await expect(fetchWithResilience(fetchImpl, 'https://auth.example/userinfo', {}, overrides)).rejects.toThrow(
      'network down',
    );
    await expect(fetchWithResilience(fetchImpl, 'https://auth.example/userinfo', {}, overrides)).rejects.toMatchObject({
      code: 'OAUTH_CIRCUIT_OPEN',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
