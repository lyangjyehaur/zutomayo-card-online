import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type RedisLike = Record<string, ReturnType<typeof vi.fn>>;

const require = createRequire(import.meta.url);
const {
  applyMatchmakingBlock,
  getMatchmakingStatus,
  joinMatchmakingQueue,
  leaveMatchmakingQueue,
  listMatchmakingBlockedUserIds,
  purgeDeletedMatchmakingAccount,
  reportRealMatch,
} = require('../matchmakingService.cjs') as {
  applyMatchmakingBlock: (redis: RedisLike, blockerUserId: string, blockedUserId: string) => Promise<void>;
  getMatchmakingStatus: (
    redis: RedisLike,
    userId: string,
    now: number,
    timeoutMs: number,
    blockedUserIds?: string[],
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
    blockedUserIds?: string[];
  }) => Promise<Record<string, unknown>>;
  leaveMatchmakingQueue: (redis: RedisLike, userId: string) => Promise<Record<string, unknown>>;
  listMatchmakingBlockedUserIds: (input: {
    pool: { query: ReturnType<typeof vi.fn> };
    userId: string;
  }) => Promise<string[]>;
  purgeDeletedMatchmakingAccount: (redis: RedisLike, userId: string) => Promise<void>;
  reportRealMatch: (
    redis: RedisLike,
    userId: string,
    matchId: unknown,
    blockedUserIds?: string[],
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
    sadd: vi.fn(async () => 1),
    srem: vi.fn(async () => 1),
    scan: vi.fn(async () => ['0', []]),
    eval: vi.fn(async () => 0),
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

  it('passes the PostgreSQL block snapshot into the atomic matcher', async () => {
    const redis = makeRedis();
    redis.hgetall = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ queueId: 'q_fixed', status: 'queued' });

    await joinMatchmakingQueue({
      redis,
      userId: 'u_1',
      body: {},
      sanitizeText: () => '',
      generateQueueId: () => 'q_fixed',
      generateMatchId: () => 'mm_fixed',
      now: 1000,
      ttlSeconds: 70,
      timeoutMs: 60000,
      blockedUserIds: ['u_blocked_by_me', 'u_blocked_me'],
    });

    expect(redis.mmTryMatch).toHaveBeenCalledWith(
      'mm:queue',
      'u_1',
      '1000',
      'mm_fixed',
      '60000',
      'u_blocked_by_me',
      'u_blocked_me',
    );
  });

  it('loads blocks in both directions and atomically cancels a matched pair when blocking', async () => {
    const query = vi.fn(async () => ({
      rows: [{ blocked_user_id: 'u_outgoing' }, { blocked_user_id: 'u_incoming' }],
    }));
    await expect(listMatchmakingBlockedUserIds({ pool: { query }, userId: 'u_1' })).resolves.toEqual([
      'u_outgoing',
      'u_incoming',
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('blocker_user_id = $1 OR blocked_user_id = $1'), [
      'u_1',
      5000,
    ]);

    const redis = makeRedis();
    redis.mmApplyBlock = vi.fn(async () => 2);
    await applyMatchmakingBlock(redis, 'u_1', 'u_2');
    expect(redis.mmApplyBlock).toHaveBeenCalledWith('mm:queue', 'u_1', 'u_2');
  });

  it('purges own state, reverse blocks, and fenced peer references across every scan page on retries', async () => {
    const redis = makeRedis();
    redis.scan = vi.fn(async (cursor: string, _match: string, pattern: string) => {
      if (pattern === 'mm:blocked:*') {
        if (cursor === '0') return ['7', ['mm:blocked:u_deleted', 'mm:blocked:u_alice']];
        if (cursor === '7') return ['12', []];
        return ['0', ['mm:blocked:u_bob']];
      }
      if (cursor === '0') return ['5', ['mm:u_deleted', 'mm:u_alice']];
      if (cursor === '5') return ['8', []];
      return ['0', ['mm:u_bob']];
    });

    await purgeDeletedMatchmakingAccount(redis, 'u_deleted');
    await purgeDeletedMatchmakingAccount(redis, 'u_deleted');

    const blockScans = redis.scan.mock.calls.filter((call) => call[2] === 'mm:blocked:*');
    const peerScans = redis.scan.mock.calls.filter((call) => call[2] === 'mm:*');
    expect(blockScans.map((call) => call[0])).toEqual(['0', '7', '12', '0', '7', '12']);
    expect(peerScans.map((call) => call[0])).toEqual(['0', '5', '8', '0', '5', '8']);
    expect(peerScans.every((call) => call.join(' ') === `${call[0]} MATCH mm:* COUNT 200 TYPE hash`)).toBe(true);
    expect(redis.srem.mock.calls).toEqual([
      ['mm:blocked:u_alice', 'u_deleted'],
      ['mm:blocked:u_bob', 'u_deleted'],
      ['mm:blocked:u_alice', 'u_deleted'],
      ['mm:blocked:u_bob', 'u_deleted'],
    ]);
    const peerLua = String(redis.eval.mock.calls[0]?.[0]);
    expect(redis.eval.mock.calls.map((call) => call.slice(1))).toEqual([
      [2, 'mm:queue', 'mm:u_alice', 'u_deleted', 'u_alice'],
      [2, 'mm:queue', 'mm:u_bob', 'u_deleted', 'u_bob'],
      [2, 'mm:queue', 'mm:u_alice', 'u_deleted', 'u_alice'],
      [2, 'mm:queue', 'mm:u_bob', 'u_deleted', 'u_bob'],
    ]);
    expect(redis.eval.mock.calls.every((call) => call[0] === peerLua)).toBe(true);
    expect(redis.zrem.mock.calls).toEqual([
      ['mm:queue', 'u_deleted'],
      ['mm:queue', 'u_deleted'],
    ]);
    expect(redis.del.mock.calls).toEqual([
      ['mm:u_deleted'],
      ['mm:blocked:u_deleted'],
      ['mm:u_deleted'],
      ['mm:blocked:u_deleted'],
    ]);

    const fenceIndex = peerLua.indexOf("HGET', peerKey, 'opponentId'");
    const mutationIndex = peerLua.indexOf("HDEL', peerKey");
    expect(fenceIndex).toBeGreaterThanOrEqual(0);
    expect(fenceIndex).toBeLessThan(mutationIndex);
    expect(peerLua).toContain("'opponentId', 'matchId', 'role', 'realMatchId'");
    expect(peerLua).toContain("if status == 'matched' then");
  });

  it('propagates reverse-index mutation failures so the outbox can retry without deleting the own block key', async () => {
    const redis = makeRedis();
    const failure = new Error('Redis SREM unavailable');
    redis.scan = vi.fn(async (_cursor: string, _match: string, pattern: string) =>
      pattern === 'mm:blocked:*' ? ['0', ['mm:blocked:u_alice']] : ['0', []],
    );
    redis.srem = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(1);

    await expect(purgeDeletedMatchmakingAccount(redis, 'u_deleted')).rejects.toBe(failure);
    expect(redis.del).not.toHaveBeenCalledWith('mm:blocked:u_deleted');

    await expect(purgeDeletedMatchmakingAccount(redis, 'u_deleted')).resolves.toBeUndefined();
    expect(redis.srem).toHaveBeenLastCalledWith('mm:blocked:u_alice', 'u_deleted');
    expect(redis.del).toHaveBeenCalledWith('mm:blocked:u_deleted');
  });

  it('propagates scan and conditional peer mutation errors instead of acknowledging partial cleanup', async () => {
    const scanRedis = makeRedis();
    const scanFailure = new Error('Redis SCAN unavailable');
    scanRedis.scan = vi.fn().mockRejectedValue(scanFailure);
    await expect(purgeDeletedMatchmakingAccount(scanRedis, 'u_deleted')).rejects.toBe(scanFailure);
    expect(scanRedis.del).not.toHaveBeenCalledWith('mm:blocked:u_deleted');

    const peerRedis = makeRedis();
    const peerFailure = new Error('Redis EVAL unavailable');
    peerRedis.scan = vi.fn(async (_cursor: string, _match: string, pattern: string) =>
      pattern === 'mm:blocked:*' ? ['0', []] : ['0', ['mm:u_peer']],
    );
    peerRedis.eval = vi.fn().mockRejectedValue(peerFailure);
    await expect(purgeDeletedMatchmakingAccount(peerRedis, 'u_deleted')).rejects.toBe(peerFailure);
    expect(peerRedis.del).not.toHaveBeenCalledWith('mm:blocked:u_deleted');
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

  it('fails closed when PostgreSQL says an existing matched opponent is blocked', async () => {
    const redis = makeRedis({
      'mm:u_1': { status: 'matched', matchId: 'mm_1', opponentId: 'u_2', role: 'host' },
      'mm:u_2': { status: 'matched', matchId: 'mm_1', opponentId: 'u_1', role: 'guest' },
    });
    redis.mmCancelPair = vi.fn(async () => 2);

    await expect(getMatchmakingStatus(redis, 'u_1', 1000, 60000, ['u_2'])).resolves.toEqual({
      status: 'timeout',
    });
    expect(redis.mmCancelPair).toHaveBeenCalledWith('mm:queue', 'u_1', 'u_2');
    await expect(reportRealMatch(redis, 'u_1', 'bg_1', ['u_2'])).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Matchmaking pair is blocked',
    });
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
