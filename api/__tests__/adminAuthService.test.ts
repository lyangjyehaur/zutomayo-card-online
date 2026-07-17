import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  authenticateAdmin,
  createLinkedAdminSession,
  hasAdminPermission,
  revokeAdminSession,
  totpCode,
  verifyAdminSession,
  verifyTotp,
} = require('../adminAuthService.cjs') as Record<string, (...args: unknown[]) => unknown>;

function createPool(handler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] }) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params));
  const release = vi.fn();
  return { query, connect: vi.fn(async () => ({ query, release })), release };
}

describe('admin auth service', () => {
  it('enforces role permissions', () => {
    expect(hasAdminPermission('viewer', 'users:read')).toBe(true);
    expect(hasAdminPermission('viewer', 'seasons:read')).toBe(true);
    expect(hasAdminPermission('viewer', 'seasons:write')).toBe(false);
    expect(hasAdminPermission('viewer', 'elo:write')).toBe(false);
    expect(hasAdminPermission('moderator', 'chat:moderate')).toBe(true);
    expect(hasAdminPermission('operator', 'seasons:write')).toBe(true);
    expect(hasAdminPermission('operator', 'legal-holds:read')).toBe(true);
    expect(hasAdminPermission('operator', 'legal-holds:write')).toBe(false);
    expect(hasAdminPermission('admin', 'admins:manage')).toBe(true);
    expect(hasAdminPermission('admin', 'legal-holds:write')).toBe(true);
  });

  it('generates and verifies RFC-compatible TOTP windows', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const timestamp = 1_710_000_000_000;
    const code = totpCode(secret, timestamp) as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, timestamp)).toBe(true);
    expect(verifyTotp(secret, '000000', timestamp)).toBe(false);
  });

  it('requires password and MFA before issuing a revocable admin session', async () => {
    const timestamp = 1_710_000_000_000;
    const secret = 'JBSWY3DPEHPK3PXP';
    const pool = createPool((sql) => {
      if (sql.includes('FROM admin_users')) {
        return {
          rows: [
            {
              id: 'admin_1',
              username: 'alice',
              password_hash: 'correct-hash',
              salt: 'salt',
              role: 'operator',
              totp_secret_ciphertext: 'encrypted',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const now = vi.spyOn(Date, 'now').mockReturnValue(timestamp);
    const result = (await authenticateAdmin({
      pool,
      body: { username: 'Alice', password: 'password', totpCode: totpCode(secret, timestamp) },
      hashPassword: async () => 'correct-hash',
      decryptTotpSecret: async () => secret,
      createSessionToken: ({ jti }: { jti: string }) => `token:${jti}`,
      passwordIterations: 100_000,
      generateJti: () => 'jti-1',
    })) as Record<string, unknown>;
    now.mockRestore();

    expect(result).toEqual({ ok: true, body: { token: 'token:jti-1', role: 'operator', expiresIn: 3600 } });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_sessions'), [
      'jti-1',
      'admin_1',
      'operator',
      3600,
    ]);
    expect(pool.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(pool.release).toHaveBeenCalledOnce();
  });

  it('rejects an unconfigured MFA account even with a correct password', async () => {
    const pool = createPool((sql) =>
      sql.includes('FROM admin_users')
        ? {
            rows: [
              {
                id: 'admin_1',
                username: 'alice',
                password_hash: 'correct-hash',
                salt: 'salt',
                role: 'admin',
                totp_secret_ciphertext: null,
              },
            ],
          }
        : { rows: [] },
    );
    await expect(
      authenticateAdmin({
        pool,
        body: { username: 'alice', password: 'password', totpCode: '123456' },
        hashPassword: async () => 'correct-hash',
        decryptTotpSecret: async () => '',
        createSessionToken: () => 'token',
        passwordIterations: 100_000,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Admin MFA is not configured' });
  });

  it('does not allow a linked account through the legacy password flow', async () => {
    const pool = createPool((sql) =>
      sql.includes('FROM admin_users')
        ? {
            rows: [
              {
                id: 'admin_linked',
                username: 'user:u_1',
                password_hash: null,
                salt: null,
                role: 'admin',
                totp_secret_ciphertext: null,
              },
            ],
          }
        : { rows: [] },
    );
    const hashPassword = vi.fn(async () => 'hash');

    await expect(
      authenticateAdmin({
        pool,
        body: { username: 'user:u_1', password: 'password', totpCode: '123456' },
        hashPassword,
        decryptTotpSecret: async () => '',
        createSessionToken: () => 'token',
        passwordIterations: 100_000,
      }),
    ).resolves.toEqual({ ok: false, status: 401, error: 'Invalid admin credentials' });
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it('issues an admin session for a linked signed-in user', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('JOIN users u')) return { rows: [{ id: 'admin_1', role: 'operator' }] };
      return { rows: [] };
    });

    await expect(
      createLinkedAdminSession({
        pool,
        userId: 'u_1',
        createSessionToken: ({ adminUserId, role }: { adminUserId: string; role: string }) =>
          `token:${adminUserId}:${role}`,
        generateJti: () => 'linked-jti',
      }),
    ).resolves.toEqual({
      ok: true,
      body: { token: 'token:admin_1:operator', role: 'operator', expiresIn: 3600 },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('a.user_id = $1'), ['u_1']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO admin_sessions'), [
      'linked-jti',
      'admin_1',
      'operator',
      3600,
    ]);
  });

  it('does not elevate an unlinked signed-in user', async () => {
    const pool = createPool(() => ({ rows: [] }));
    await expect(
      createLinkedAdminSession({
        pool,
        userId: 'u_regular',
        createSessionToken: () => 'token',
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Account does not have admin access' });
  });

  it('checks the persisted session and permission on every admin request', async () => {
    const pool = createPool((sql) =>
      sql.includes('FROM admin_sessions') ? { rows: [{ admin_user_id: 'admin_1', role: 'moderator' }] } : { rows: [] },
    );
    await expect(
      verifyAdminSession({
        pool,
        payload: { adminUserId: 'admin_1', role: 'moderator', jti: 'jti-1' },
        permission: 'chat:moderate',
      }),
    ).resolves.toEqual({ adminUserId: 'admin_1', role: 'moderator' });
    await expect(
      verifyAdminSession({
        pool,
        payload: { adminUserId: 'admin_1', role: 'moderator', jti: 'jti-1' },
        permission: 'cards:write',
      }),
    ).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('u.role = $3'), ['jti-1', 'admin_1', 'moderator']);
  });

  it('invalidates a session when the administrator role changes', async () => {
    const pool = createPool((sql) => (sql.includes('FROM admin_sessions') ? { rows: [] } : { rows: [] }));
    await expect(
      verifyAdminSession({
        pool,
        payload: { adminUserId: 'admin_1', role: 'operator', jti: 'jti-1' },
        permission: 'seasons:write',
      }),
    ).resolves.toBeNull();
  });

  it('does not issue a jti when credentials rotate between verification and the locked recheck', async () => {
    const timestamp = 1_710_000_000_000;
    const secret = 'JBSWY3DPEHPK3PXP';
    let adminRead = 0;
    const pool = createPool((sql) => {
      if (sql.includes('FROM admin_users')) {
        adminRead += 1;
        return {
          rows: [
            {
              id: 'admin_1',
              username: 'alice',
              password_hash: adminRead === 1 ? 'correct-hash' : 'rotated-hash',
              salt: 'salt',
              role: 'operator',
              totp_secret_ciphertext: 'encrypted',
              disabled_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(timestamp);
    await expect(
      authenticateAdmin({
        pool,
        body: { username: 'alice', password: 'password', totpCode: totpCode(secret, timestamp) },
        hashPassword: async () => 'correct-hash',
        decryptTotpSecret: async () => secret,
        createSessionToken: () => 'must-not-be-issued',
        passwordIterations: 100_000,
      }),
    ).resolves.toEqual({ ok: false, status: 401, error: 'Invalid admin credentials' });
    now.mockRestore();

    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_sessions'),
      expect.anything(),
    );
    expect(pool.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(pool.release).toHaveBeenCalledOnce();
  });

  it('revokes a specific admin session', async () => {
    const pool = createPool(() => ({ rows: [] }));
    await expect(revokeAdminSession({ pool, jti: 'jti-1', adminUserId: 'admin_1' })).resolves.toEqual({
      ok: true,
      body: { revoked: true },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('revoked_at'), ['jti-1', 'admin_1']);
  });
});
