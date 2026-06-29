import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>>;
};

const require = createRequire(import.meta.url);
const { adminLogin, listAdminUsers, mapAdminUser, resetUserElo } = require('../adminService.cjs') as {
  adminLogin: (
    body: Record<string, unknown>,
    adminPassword: string,
    createAdminToken: () => string,
  ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  listAdminUsers: (pool: Queryable, limitParam: unknown) => Promise<Record<string, unknown>>;
  mapAdminUser: (user: Record<string, unknown>) => Record<string, unknown>;
  resetUserElo: (pool: Queryable, targetUserId: string, elo: unknown) => Promise<Record<string, unknown>>;
};

function poolWithRows(rows: unknown[] = []): Queryable {
  return {
    query: vi.fn(async () => ({ rows })),
  };
}

const adminUserRow = {
  id: 'u_1',
  email: 'user@example.com',
  nickname: 'User',
  elo: 1200,
  match_count: 5,
  wins: 2,
  created_at: '2026-06-30T00:00:00.000Z',
};

describe('admin service', () => {
  it('validates admin login configuration and password', async () => {
    await expect(adminLogin({ password: 'secret' }, '', () => 'token')).resolves.toEqual({
      ok: false,
      status: 503,
      error: 'Admin not configured',
    });
    await expect(adminLogin({ password: 'wrong' }, 'secret', () => 'token')).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'Invalid password',
    });
    await expect(adminLogin({ password: 'secret' }, 'secret', () => 'token')).resolves.toEqual({
      ok: true,
      body: { token: 'token' },
    });
  });

  it('maps admin user rows with win rate', () => {
    expect(mapAdminUser(adminUserRow)).toEqual({
      id: 'u_1',
      email: 'user@example.com',
      nickname: 'User',
      elo: 1200,
      matchCount: 5,
      wins: 2,
      createdAt: '2026-06-30T00:00:00.000Z',
      winRate: 40,
    });
  });

  it('lists admin users and clamps limit to 500', async () => {
    const pool = poolWithRows([adminUserRow]);

    await expect(listAdminUsers(pool, '999')).resolves.toEqual({
      users: [expect.objectContaining({ id: 'u_1', winRate: 40 })],
    });
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT id, email, nickname, elo, match_count, wins, created_at FROM users ORDER BY created_at DESC LIMIT $1',
      [500],
    );
  });

  it('resets user Elo with bounds', async () => {
    const highPool = poolWithRows();
    await expect(resetUserElo(highPool, 'u_1', '12000')).resolves.toEqual({ id: 'u_1', elo: 9999 });
    expect(highPool.query).toHaveBeenCalledWith('UPDATE users SET elo = $1 WHERE id = $2', [9999, 'u_1']);

    const lowPool = poolWithRows();
    await expect(resetUserElo(lowPool, 'u_2', '-50')).resolves.toEqual({ id: 'u_2', elo: 0 });
    expect(lowPool.query).toHaveBeenCalledWith('UPDATE users SET elo = $1 WHERE id = $2', [0, 'u_2']);
  });
});
