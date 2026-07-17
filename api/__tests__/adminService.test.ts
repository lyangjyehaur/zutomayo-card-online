import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>>;
};

const require = createRequire(import.meta.url);
const { adminLogin, linkedAdminId, listAdminUsers, mapAdminUser, resetUserElo, updateLinkedAdminRole } =
  require('../adminService.cjs') as {
    adminLogin: (
      body: Record<string, unknown>,
      adminPassword: string,
      createAdminToken: () => string,
    ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
    listAdminUsers: (pool: Queryable, limitParam: unknown) => Promise<Record<string, unknown>>;
    linkedAdminId: (userId: string) => string;
    mapAdminUser: (user: Record<string, unknown>, currentAdminUserId?: string) => Record<string, unknown>;
    resetUserElo: (pool: Queryable, targetUserId: string, elo: unknown) => Promise<Record<string, unknown>>;
    updateLinkedAdminRole: (
      pool: Queryable & { connect?: () => Promise<Queryable & { release: () => void }> },
      input: { targetUserId: string; role: string | null; actorAdminUserId: string },
    ) => Promise<Record<string, unknown>>;
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
      adminRole: null,
      isCurrentAdmin: false,
    });
  });

  it('maps linked role details only when supplied by the authorized query', () => {
    expect(
      mapAdminUser(
        {
          ...adminUserRow,
          admin_user_id: 'admin_current',
          admin_role: 'admin',
          admin_disabled_at: null,
        },
        'admin_current',
      ),
    ).toEqual(expect.objectContaining({ adminRole: 'admin', isCurrentAdmin: true }));
  });

  it('lists admin users and clamps limit to 500', async () => {
    const pool = poolWithRows([adminUserRow]);

    await expect(listAdminUsers(pool, '999')).resolves.toEqual({
      users: [expect.objectContaining({ id: 'u_1', winRate: 40 })],
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM users u'), [500, '', '%%']);
  });

  it('resets user Elo with bounds', async () => {
    const highPool = poolWithRows();
    await expect(resetUserElo(highPool, 'u_1', '12000')).resolves.toEqual({ id: 'u_1', elo: 9999 });
    expect(highPool.query).toHaveBeenCalledWith('UPDATE users SET elo = $1 WHERE id = $2', [9999, 'u_1']);

    const lowPool = poolWithRows();
    await expect(resetUserElo(lowPool, 'u_2', '-50')).resolves.toEqual({ id: 'u_2', elo: 0 });
    expect(lowPool.query).toHaveBeenCalledWith('UPDATE users SET elo = $1 WHERE id = $2', [0, 'u_2']);
  });

  it('assigns a linked admin role, revokes sessions, and writes an audit record atomically', async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM users u')) {
        return { rows: [{ id: 'u_2', email: 'target@example.com', admin_user_id: null, admin_role: null }] };
      }
      if (sql.includes('INSERT INTO admin_users')) return { rows: [{ id: linkedAdminId('u_2'), role: 'operator' }] };
      return { rows: [] };
    });
    const pool = { query: vi.fn(), connect: vi.fn(async () => ({ query, release })) };

    await expect(
      updateLinkedAdminRole(pool, {
        targetUserId: 'u_2',
        role: 'operator',
        actorAdminUserId: 'admin_actor',
      }),
    ).resolves.toEqual({ ok: true, body: { id: 'u_2', adminRole: 'operator' } });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_users'), [
      linkedAdminId('u_2'),
      'u_2',
      'user:u_2',
      'operator',
    ]);
    expect(query).toHaveBeenCalledWith('DELETE FROM admin_sessions WHERE admin_user_id = $1', [linkedAdminId('u_2')]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_audit_log'), [
      'admin_actor',
      'grant_admin_role',
      'user',
      'u_2',
      expect.stringContaining('operator'),
    ]);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('revokes linked admin access and refuses self-role changes', async () => {
    const revokeQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM users u')) {
        return {
          rows: [{ id: 'u_2', email: 'target@example.com', admin_user_id: 'admin_target', admin_role: 'viewer' }],
        };
      }
      return { rows: [] };
    });
    await expect(
      updateLinkedAdminRole(
        { query: revokeQuery },
        { targetUserId: 'u_2', role: null, actorAdminUserId: 'admin_actor' },
      ),
    ).resolves.toEqual({ ok: true, body: { id: 'u_2', adminRole: null } });
    expect(revokeQuery).toHaveBeenCalledWith('DELETE FROM admin_users WHERE id = $1', ['admin_target']);
    expect(revokeQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_audit_log'), [
      'admin_actor',
      'revoke_admin_role',
      'user',
      'u_2',
      expect.stringContaining('viewer'),
    ]);

    const selfQuery = vi.fn(async (sql: string) =>
      sql.includes('FROM users u')
        ? {
            rows: [{ id: 'u_self', email: 'self@example.com', admin_user_id: 'admin_actor', admin_role: 'admin' }],
          }
        : { rows: [] },
    );
    await expect(
      updateLinkedAdminRole(
        { query: selfQuery },
        { targetUserId: 'u_self', role: 'viewer', actorAdminUserId: 'admin_actor' },
      ),
    ).resolves.toEqual({ ok: false, status: 409, error: 'You cannot change your own admin role' });
    expect(selfQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(selfQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE admin_users'), expect.anything());
  });
});
