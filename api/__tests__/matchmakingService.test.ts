import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type RedisLike = Record<string, ReturnType<typeof vi.fn>>;

const require = createRequire(import.meta.url);
const { getMatchmakingStatus, joinMatchmakingQueue, leaveMatchmakingQueue, reportRealMatch } =
  require('../matchmakingService.cjs') as {
    getMatchmakingStatus: (
      redis: RedisLike,
      userId: string,
      now: number,
      timeoutMs: number,
    ) => Promise<Record<string, unknown>>;
    joinMatchmakingQueue: (input: {
      redis: RedisLike;
      userId: string;
      body: Record<string, unknown>;
      sanitizeText: (value: unknown, maxLen?: number) => string;
      generateQueueId: () => string;
      generateMatchId: () => string;
      now: number;
      ttlSeconds: number;
      timeoutMs: number;
    }) => Promise<Record<string, unknown>>;
    leaveMatchmakingQueue: (redis: RedisLike, userId: string) => Promise<Record<string, unknown>>;
    reportRealMatch: (
      redis: RedisLike,
      userId: string,
      matchId: unknown,
    ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  };

function makeRedis(entries: Record<string, Record<string, string>> = {}): RedisLike {
  return {
    hgetall: vi.fn(async (key: string) => entries[key] ?? {}),
    hset: vi.fn(async () => 1),
    zadd: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    mmTryMatch: vi.fn(async () => ''),
    mmCleanExpired: vi.fn(async () => 0),
    zrem: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
  };
}

describe('matchmaking service', () => {
  it('returns existing matched queue entries without rewriting Redis state', async () => {
    const redis = makeRedis({ 'mm:u_1': { queueId: 'q_existing', status: 'matched' } });

    await expect(
      joinMatchmakingQueue({
        redis,
        userId: 'u_1',
        body: {},
        sanitizeText: () => '',
        generateQueueId: () => 'q_new',
        generateMatchId: () => 'mm_1',
        now: 1000,
        ttlSeconds: 70,
        timeoutMs: 60000,
      }),
    ).resolves.toEqual({ queueId: 'q_existing', status: 'matched' });
    expect(redis.hset).not.toHaveBeenCalled();
  });

  it('queues users with sanitized deck data and tries to match atomically', async () => {
    const redis = makeRedis({ 'mm:u_1': {} });
    redis.hgetall = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ queueId: 'q_fixed', status: 'queued' });
    const sanitizeText = vi.fn(() => 'Clean Deck');

    await expect(
      joinMatchmakingQueue({
        redis,
        userId: 'u_1',
        body: { deckName: '<Deck>', deckIds: ['a', 1, 'b'] },
        sanitizeText,
        generateQueueId: () => 'q_fixed',
        generateMatchId: () => 'mm_fixed',
        now: 1000,
        ttlSeconds: 70,
        timeoutMs: 60000,
      }),
    ).resolves.toEqual({ queueId: 'q_fixed', status: 'queued' });

    expect(sanitizeText).toHaveBeenCalledWith('<Deck>', 60);
    expect(redis.hset).toHaveBeenCalledWith('mm:u_1', {
      queueId: 'q_fixed',
      joinedAt: '1000',
      deckName: 'Clean Deck',
      deckIds: JSON.stringify(['a', 'b']),
      status: 'queued',
    });
    expect(redis.zadd).toHaveBeenCalledWith('mm:queue', 1000, 'u_1');
    expect(redis.expire).toHaveBeenCalledWith('mm:u_1', 70);
    expect(redis.mmTryMatch).toHaveBeenCalledWith('mm:queue', 'u_1', '1000', 'mm_fixed', '60000');
  });

  it('reports matchmaking status after cleaning expired queue entries', async () => {
    const redis = makeRedis({
      'mm:u_1': { status: 'matched', matchId: 'mm_1', opponentId: 'u_2', role: 'host', realMatchId: 'bg_1' },
    });

    await expect(getMatchmakingStatus(redis, 'u_1', 1000, 60000)).resolves.toEqual({
      status: 'matched',
      matchId: 'mm_1',
      opponentId: 'u_2',
      role: 'host',
      realMatchId: 'bg_1',
    });
    expect(redis.mmCleanExpired).toHaveBeenCalledWith('mm:queue', '1000', '60000');
  });

  it('marks a matched opponent as timed out when leaving the queue', async () => {
    const redis = makeRedis({
      'mm:u_1': { opponentId: 'u_2' },
      'mm:u_2': { status: 'matched' },
    });

    await expect(leaveMatchmakingQueue(redis, 'u_1')).resolves.toEqual({ deleted: true });
    expect(redis.hset).toHaveBeenCalledWith('mm:u_2', 'status', 'timeout');
    expect(redis.zrem).toHaveBeenCalledWith('mm:queue', 'u_1');
    expect(redis.del).toHaveBeenCalledWith('mm:u_1');
  });

  it('validates and stores the real boardgame match id', async () => {
    await expect(reportRealMatch(makeRedis(), 'u_1', '')).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'matchId required',
    });
    await expect(reportRealMatch(makeRedis({ 'mm:u_1': { status: 'queued' } }), 'u_1', 'bg_1')).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Not in a matched queue',
    });

    const redis = makeRedis({ 'mm:u_1': { status: 'matched', opponentId: 'u_2' } });
    await expect(reportRealMatch(redis, 'u_1', 'bg_1')).resolves.toEqual({ ok: true, body: { ok: true } });
    expect(redis.hset).toHaveBeenCalledWith('mm:u_1', 'realMatchId', 'bg_1');
    expect(redis.hset).toHaveBeenCalledWith('mm:u_2', 'realMatchId', 'bg_1');
  });
});
