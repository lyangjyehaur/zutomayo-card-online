import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { withAccountMutationTransaction } = require('../accountMutationLock.cjs') as {
  withAccountMutationTransaction: (
    pool: PoolLike,
    userIds: string[],
    operation: (client: ClientLike) => Promise<unknown>,
  ) => Promise<unknown>;
};
const { AccountSessionUnavailableError, RefreshSessionPersistenceTimeoutError, issueAccountRefreshToken } =
  require('../authSessionService.cjs') as {
    AccountSessionUnavailableError: new (userId: string) => Error;
    RefreshSessionPersistenceTimeoutError: new (timeoutMs: number) => Error;
    issueAccountRefreshToken: (input: Record<string, unknown>) => Promise<string>;
  };

type QueryResult = { rows: Array<Record<string, unknown>>; rowCount: number };
type ClientLike = { query: (sql: string, params?: unknown[]) => Promise<QueryResult>; release?: () => void };
type PoolLike = {
  query: (sql: string, params?: unknown[]) => Promise<QueryResult>;
  connect: () => Promise<ClientLike>;
};

const ACCOUNT_ROW_LOCK_SQL = 'SELECT id, deleted_at, elo, match_count, wins FROM users WHERE id = $1 FOR UPDATE';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function lockCoordinator() {
  const ownerByKey = new Map<string, string>();
  const heldByClient = new Map<string, Set<string>>();
  const waiters = new Map<string, Array<() => void>>();
  const blocked = deferred();

  return {
    blocked: blocked.promise,
    async acquire(clientId: string, key: string) {
      while (ownerByKey.has(key) && ownerByKey.get(key) !== clientId) {
        blocked.resolve();
        await new Promise<void>((resolve) => {
          waiters.set(key, [...(waiters.get(key) ?? []), resolve]);
        });
      }
      ownerByKey.set(key, clientId);
      heldByClient.set(clientId, new Set([...(heldByClient.get(clientId) ?? []), key]));
    },
    release(clientId: string) {
      for (const key of heldByClient.get(clientId) ?? []) {
        if (ownerByKey.get(key) !== clientId) continue;
        ownerByKey.delete(key);
        for (const resolve of waiters.get(key) ?? []) resolve();
        waiters.delete(key);
      }
      heldByClient.delete(clientId);
    },
  };
}

function raceFixture(clientOrder: string[]) {
  const coordinator = lockCoordinator();
  const user = { id: 'u_refresh', deleted_at: null as string | null, auth_version: 1 };
  const refreshKeys = new Map<string, string>();
  const queryLogByClient = new Map<string, string[]>();
  let revokedBefore: number | null = null;

  const createClient = (clientId: string): ClientLike => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queryLogByClient.set(clientId, [...(queryLogByClient.get(clientId) ?? []), sql]);
      if (sql === 'COMMIT' || sql === 'ROLLBACK') coordinator.release(clientId);
      if (sql.includes('pg_advisory_xact_lock')) {
        await coordinator.acquire(clientId, String(params?.[0]));
      }
      if (sql === ACCOUNT_ROW_LOCK_SQL) {
        return { rows: [{ ...user }], rowCount: 1 };
      }
      if (sql === 'SELECT auth_version, deleted_at FROM users WHERE id = $1') {
        return { rows: [{ auth_version: user.auth_version, deleted_at: user.deleted_at }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  });
  const clients = clientOrder.map(createClient);
  const pool: PoolLike = {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: vi.fn(async () => clients.shift()!),
  };
  const applyPersist = (args: unknown[]) => {
    const [, , refreshKey, , ownerUserId, tokenSessionIat] = args;
    if (revokedBefore !== null && Number(tokenSessionIat) <= revokedBefore) return 0;
    refreshKeys.set(String(refreshKey), String(ownerUserId));
    return 1;
  };
  const redis = {
    eval: vi.fn(async (...args: unknown[]) => applyPersist(args)),
  };
  const issue = (overrides: Record<string, unknown> = {}) =>
    issueAccountRefreshToken({
      pool,
      redis,
      userId: user.id,
      sessionIat: 1_000,
      requestedAuthVersion: 1,
      createRefreshToken: () => 'refresh-token',
      decodeTokenPayload: () => ({ jti: 'new-session', exp: 2_000, sessionIat: 1_000 }),
      nowSeconds: () => 1_000,
      ...overrides,
    });
  const deletion = (operation?: () => Promise<void>) =>
    withAccountMutationTransaction(pool, [user.id], async () => {
      await operation?.();
      user.deleted_at = '2026-07-15T00:00:00.000Z';
      user.auth_version += 1;
      revokedBefore = 1_100;
      refreshKeys.clear();
    });

  return { applyPersist, coordinator, deletion, issue, queryLogByClient, redis, refreshKeys };
}

describe('refresh session account-deletion ordering', () => {
  it('rejects a stale refresh request after deletion wins the account lock', async () => {
    const fixture = raceFixture(['deletion', 'refresh']);
    const deletionLocked = deferred();
    const continueDeletion = deferred();
    const deleting = fixture.deletion(async () => {
      deletionLocked.resolve();
      await continueDeletion.promise;
    });
    await deletionLocked.promise;

    const refreshing = fixture.issue();
    await fixture.coordinator.blocked;
    continueDeletion.resolve();

    await expect(deleting).resolves.toBeUndefined();
    await expect(refreshing).rejects.toBeInstanceOf(AccountSessionUnavailableError);
    expect(fixture.redis.eval).not.toHaveBeenCalled();
    expect(fixture.refreshKeys.size).toBe(0);
  });

  it('lets deletion purge a refresh key written by the request that won the lock', async () => {
    const fixture = raceFixture(['refresh', 'deletion']);
    const refreshSetStarted = deferred();
    const continueRefreshSet = deferred();
    fixture.redis.eval.mockImplementationOnce(async (...args: unknown[]) => {
      refreshSetStarted.resolve();
      await continueRefreshSet.promise;
      return fixture.applyPersist(args);
    });

    const refreshing = fixture.issue();
    await refreshSetStarted.promise;
    const deleting = fixture.deletion();
    await fixture.coordinator.blocked;
    continueRefreshSet.resolve();

    await expect(refreshing).resolves.toBe('refresh-token');
    await expect(deleting).resolves.toBeUndefined();
    expect(fixture.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('SET'"),
      2,
      'refresh:new-session',
      'auth:revoked-before:u_refresh',
      'u_refresh',
      '1000',
      '1000',
    );
    expect(fixture.refreshKeys.size).toBe(0);
  });

  it('rejects a late Redis command after timeout and deletion instead of recreating the key', async () => {
    const fixture = raceFixture(['refresh', 'deletion']);
    let settleLatePersist!: () => void;
    fixture.redis.eval.mockImplementationOnce(
      (...args: unknown[]) =>
        new Promise<number>((resolve) => {
          settleLatePersist = () => resolve(fixture.applyPersist(args));
        }),
    );
    const clearTimer = vi.fn();

    await expect(
      fixture.issue({
        redisSetTimeoutMs: 25,
        setTimer: (callback: () => void) => {
          queueMicrotask(callback);
          return { unref: vi.fn() };
        },
        clearTimer,
      }),
    ).rejects.toBeInstanceOf(RefreshSessionPersistenceTimeoutError);

    expect(fixture.queryLogByClient.get('refresh')?.at(-1)).toBe('ROLLBACK');
    expect(fixture.queryLogByClient.get('refresh')).not.toContain('COMMIT');
    expect(clearTimer).toHaveBeenCalledOnce();

    await expect(fixture.deletion()).resolves.toBeUndefined();
    settleLatePersist();
    await Promise.resolve();

    expect(fixture.refreshKeys.size).toBe(0);
  });
});
