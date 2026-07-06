import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type RedisLike = Record<string, ReturnType<typeof vi.fn>>;

const require = createRequire(import.meta.url);
const { countOnlinePresence, heartbeatOnlinePresence, normalizePresenceId } = require('../presenceService.cjs') as {
  countOnlinePresence: (
    redis: RedisLike,
    input: { key?: string; now?: number; ttlMs: number },
  ) => Promise<{ onlineCount: number; activeWindowSeconds: number }>;
  heartbeatOnlinePresence: (
    redis: RedisLike,
    input: { key?: string; visitorId: unknown; now?: number; ttlMs: number },
  ) => Promise<
    | { ok: true; body: { onlineCount: number; activeWindowSeconds: number } }
    | { ok: false; status: number; error: string }
  >;
  normalizePresenceId: (value: unknown) => string | null;
};

function makeRedis(count = 0): RedisLike {
  return {
    zremrangebyscore: vi.fn(async () => 1),
    zcount: vi.fn(async () => count),
    zadd: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  };
}

describe('presence service', () => {
  it('normalizes browser visitor ids conservatively', () => {
    expect(normalizePresenceId('presence:abc_12345')).toBe('presence:abc_12345');
    expect(normalizePresenceId('bad space')).toBeNull();
    expect(normalizePresenceId('short')).toBeNull();
  });

  it('cleans stale visitors before counting active presence', async () => {
    const redis = makeRedis(3);

    await expect(countOnlinePresence(redis, { key: 'presence:test', now: 100_000, ttlMs: 90_000 })).resolves.toEqual({
      onlineCount: 3,
      activeWindowSeconds: 90,
    });
    expect(redis.zremrangebyscore).toHaveBeenCalledWith('presence:test', 0, 10_000);
    expect(redis.zcount).toHaveBeenCalledWith('presence:test', 10_001, '+inf');
  });

  it('stores a heartbeat and returns the refreshed count', async () => {
    const redis = makeRedis(1);

    await expect(
      heartbeatOnlinePresence(redis, {
        key: 'presence:test',
        visitorId: 'presence:visitor_1',
        now: 100_000,
        ttlMs: 90_000,
      }),
    ).resolves.toEqual({ ok: true, body: { onlineCount: 1, activeWindowSeconds: 90 } });
    expect(redis.zadd).toHaveBeenCalledWith('presence:test', 100_000, 'presence:visitor_1');
    expect(redis.expire).toHaveBeenCalledWith('presence:test', 180);
  });

  it('rejects missing visitor ids for heartbeat updates', async () => {
    await expect(heartbeatOnlinePresence(makeRedis(), { visitorId: '', ttlMs: 90_000 })).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'visitorId required',
    });
  });
});
