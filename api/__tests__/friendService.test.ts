import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>>>;
};

const require = createRequire(import.meta.url);
const { addFriend, listFriends, normalizeUserId, removeFriend } = require('../friendService.cjs') as {
  addFriend: (input: {
    pool: Queryable;
    userId: string;
    body: Record<string, unknown>;
  }) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  listFriends: (input: {
    pool: Queryable;
    userId: string;
  }) => Promise<
    { ok: true; body: { friends: Record<string, unknown>[] } } | { ok: false; status: number; error: string }
  >;
  normalizeUserId: (value: unknown) => string;
  removeFriend: (input: {
    pool: Queryable;
    userId: string;
    friendUserId: string;
  }) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
};

function poolResult(rows: unknown[] = [], rowCount = 1): Queryable {
  return {
    query: vi.fn(async () => ({ rows, rowCount })),
  };
}

describe('friend service', () => {
  it('normalizes supported user ids and rejects invalid ids', () => {
    expect(normalizeUserId(' user:abc_123-xyz ')).toBe('user:abc_123-xyz');
    expect(normalizeUserId('ab')).toBe('');
    expect(normalizeUserId('user@example.com')).toBe('');
    expect(normalizeUserId(null)).toBe('');
  });

  it('lists friends with joined profile fields', async () => {
    const pool = poolResult([
      {
        friend_user_id: 'u_friend',
        nickname: 'Friend',
        elo: '1500',
        match_count: '12',
        wins: '7',
        created_at: '2026-07-10T00:00:00.000Z',
      },
    ]);

    await expect(listFriends({ pool, userId: 'u_me' })).resolves.toEqual({
      ok: true,
      body: {
        friends: [
          {
            userId: 'u_friend',
            nickname: 'Friend',
            elo: 1500,
            matchCount: 12,
            wins: 7,
            createdAt: '2026-07-10T00:00:00.000Z',
          },
        ],
      },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM user_friends f'), ['u_me']);
  });

  it('adds friends symmetrically after verifying the target user exists', async () => {
    const pool: Queryable = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'SELECT * FROM users WHERE id = $1 FOR UPDATE') {
          return { rows: [{ id: String(params?.[0]), deleted_at: null }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO user_friends')) {
          return { rows: [{ created_at: '2026-07-13T00:00:00.000Z' }], rowCount: 2 };
        }
        if (sql.includes('INSERT INTO relationship_change_outbox'))
          return { rows: [{ event_id: 'event-1' }], rowCount: 1 };
        return { rows: [], rowCount: 2 };
      }),
    };

    await expect(addFriend({ pool, userId: 'u_me', body: { friendUserId: 'u_friend' } })).resolves.toEqual({
      ok: true,
      body: { ok: true, friendUserId: 'u_friend' },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('VALUES ($1, $2), ($2, $1)'), ['u_me', 'u_friend']);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO relationship_change_outbox'),
      expect.arrayContaining(['friendship_added:u_me:u_friend:2026-07-13T00:00:00.000Z']),
    );
  });

  it('rejects invalid, self, and unknown friend targets', async () => {
    await expect(addFriend({ pool: poolResult(), userId: '', body: { friendUserId: 'u_friend' } })).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    });
    await expect(addFriend({ pool: poolResult(), userId: 'u_me', body: { friendUserId: 'u_me' } })).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Invalid friend user',
    });
    await expect(
      addFriend({ pool: poolResult(), userId: 'u_me', body: { friendUserId: 'u_friend' } }),
    ).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'User not found',
    });
  });

  it('removes friend rows in both directions', async () => {
    const pool: Queryable = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'SELECT * FROM users WHERE id = $1 FOR UPDATE') {
          return { rows: [{ id: String(params?.[0]), deleted_at: null }], rowCount: 1 };
        }
        if (sql.includes('DELETE FROM user_friends')) {
          return { rows: [{ created_at: '2026-07-13T00:00:00.000Z' }], rowCount: 2 };
        }
        if (sql.includes('INSERT INTO relationship_change_outbox'))
          return { rows: [{ event_id: 'event-2' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    };

    await expect(removeFriend({ pool, userId: 'u_me', friendUserId: 'u_friend' })).resolves.toEqual({
      ok: true,
      body: { ok: true },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM user_friends'), ['u_me', 'u_friend']);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO relationship_change_outbox'),
      expect.arrayContaining(['friendship_removed:u_me:u_friend:2026-07-13T00:00:00.000Z']),
    );
  });
});
