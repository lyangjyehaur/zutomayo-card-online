import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { deleteAccount } = require('../accountLifecycleService.cjs') as {
  deleteAccount: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
const { submitMatchResult } = require('../matchSubmission.cjs') as {
  submitMatchResult: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
const { acquireAccountMutationLocks } = require('../accountMutationLock.cjs') as {
  acquireAccountMutationLocks: (client: Record<string, unknown>, userIds: string[]) => Promise<unknown[]>;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function lockCoordinator() {
  const owners = new Map<string, string>();
  const waiters = new Map<string, Array<() => void>>();
  const heldByClient = new Map<string, Set<string>>();
  const blocked = deferred();

  return {
    blocked: blocked.promise,
    async acquire(clientId: string, key: string) {
      if (owners.get(key) === clientId) return;
      while (owners.has(key)) {
        blocked.resolve();
        await new Promise<void>((resolve) => {
          waiters.set(key, [...(waiters.get(key) ?? []), resolve]);
        });
      }
      owners.set(key, clientId);
      heldByClient.set(clientId, new Set([...(heldByClient.get(clientId) ?? []), key]));
    },
    release(clientId: string) {
      for (const key of heldByClient.get(clientId) ?? []) {
        if (owners.get(key) !== clientId) continue;
        owners.delete(key);
        for (const resolve of waiters.get(key) ?? []) resolve();
        waiters.delete(key);
      }
      heldByClient.delete(clientId);
    },
  };
}

describe('account mutation concurrency', () => {
  it('normalizes reversed participants into one deterministic lock order', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT * FROM users')) {
        return { rows: [{ id: params?.[0], deleted_at: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    await acquireAccountMutationLocks({ query }, ['u_zed', 'guest:session', 'u_alice', 'u_zed']);

    const advisoryKeys = query.mock.calls
      .filter(([sql]) => String(sql).includes('pg_advisory_xact_lock'))
      .map(([, params]) => params?.[0]);
    const rowIds = query.mock.calls
      .filter(([sql]) => String(sql).startsWith('SELECT * FROM users'))
      .map(([, params]) => params?.[0]);
    expect(advisoryKeys).toEqual(['legal-hold:account:u_alice', 'legal-hold:account:u_zed']);
    expect(rowIds).toEqual(['u_alice', 'u_zed']);
  });

  it('blocks match writes behind deletion and rechecks deleted_at after the lock is released', async () => {
    const coordinator = lockCoordinator();
    const deletionLocked = deferred();
    const continueDeletion = deferred();
    const users = new Map([
      ['u_alice', { id: 'u_alice', deleted_at: null as string | null, elo: 1000 }],
      ['u_bob', { id: 'u_bob', deleted_at: null as string | null, elo: 1000 }],
    ]);
    const insertedMatches: unknown[][] = [];

    const createClient = (clientId: string) => ({
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          coordinator.release(clientId);
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          await coordinator.acquire(clientId, String(params?.[0]));
          return { rows: [], rowCount: 1 };
        }
        if (sql === 'SELECT * FROM users WHERE id = $1 FOR UPDATE') {
          if (clientId === 'deletion') {
            deletionLocked.resolve();
            await continueDeletion.promise;
          }
          const user = users.get(String(params?.[0]));
          return { rows: user && !user.deleted_at ? [user] : [], rowCount: user && !user.deleted_at ? 1 : 0 };
        }
        if (sql.includes('FROM legal_holds') || sql.includes('FROM account_deletion_requests')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('UPDATE users') && sql.includes('deleted_at = NOW()')) {
          const user = users.get(String(params?.[0]));
          if (user) user.deleted_at = '2026-07-13T00:00:00.000Z';
          return { rows: [], rowCount: user ? 1 : 0 };
        }
        if (sql.startsWith('INSERT INTO matches')) {
          insertedMatches.push(params ?? []);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('FROM matches WHERE source_match_id')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    });

    const clients = [createClient('deletion'), createClient('match')];
    const pool = {
      connect: vi.fn(async () => clients.shift()!),
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    };

    const deletion = deleteAccount({ pool, userId: 'u_alice' });
    await deletionLocked.promise;
    const submission = submitMatchResult({
      pool,
      authUserId: 'u_alice',
      rankedMatchesEnabled: true,
      body: { winnerId: 'u_alice', loserId: 'u_bob' },
      sanitizeActionLog: () => [],
      generateMatchId: () => 'm_race',
    });
    await coordinator.blocked;
    continueDeletion.resolve();

    await expect(deletion).resolves.toEqual({ ok: true, body: { deleted: true } });
    await expect(submission).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Ranked participants no longer exist',
    });
    expect(insertedMatches).toEqual([]);
    expect(users.get('u_alice')).toMatchObject({ deleted_at: '2026-07-13T00:00:00.000Z', elo: 1000 });
  });
});
