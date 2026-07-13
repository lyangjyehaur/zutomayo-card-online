import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { authenticateAdmin, hasAdminPermission, revokeAdminSession, totpCode, verifyAdminSession, verifyTotp } =
  require('../adminAuthService.cjs') as Record<string, (...args: unknown[]) => unknown>;

function createPool(handler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] }) {
  return { query: vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params)) };
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

  it('revokes a specific admin session', async () => {
    const pool = createPool(() => ({ rows: [] }));
    await expect(revokeAdminSession({ pool, jti: 'jti-1', adminUserId: 'admin_1' })).resolves.toEqual({
      ok: true,
      body: { revoked: true },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('revoked_at'), ['jti-1', 'admin_1']);
  });
});
