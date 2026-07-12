import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  deleteAccount,
  exportAccountData,
  hashAccountToken,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  verifyEmailToken,
} = require('../accountLifecycleService.cjs') as {
  deleteAccount: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  exportAccountData: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  hashAccountToken: (token: string) => string;
  requestEmailVerification: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  requestPasswordReset: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  resetPassword: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  verifyEmailToken: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

type QueryResult = { rows: Record<string, unknown>[] };

function createPool(handler: (sql: string, params?: unknown[]) => QueryResult) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params)),
  };
}

describe('account lifecycle service', () => {
  it('stores only the hash when issuing an email verification token', async () => {
    const pool = createPool((sql) => {
      if (sql.startsWith('SELECT id, email')) {
        return { rows: [{ id: 'u_1', email: 'user@example.com', email_verified: false, deleted_at: null }] };
      }
      if (sql.includes('SELECT id FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
      return { rows: [] };
    });

    await expect(
      requestEmailVerification({ pool, userId: 'u_1', generateToken: () => 'raw-verification-token' }),
    ).resolves.toEqual({
      ok: true,
      body: { email: 'user@example.com', token: 'raw-verification-token', expiresIn: 1800 },
    });

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO account_action_tokens'), [
      'u_1',
      'verify_email',
      hashAccountToken('raw-verification-token'),
      1800,
    ]);
    expect(pool.query).toHaveBeenCalledWith('SELECT id FROM users WHERE id = $1 FOR UPDATE', ['u_1']);
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('atomically consumes a verification token before marking the email verified', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('RETURNING user_id')) return { rows: [{ user_id: 'u_1' }] };
      return { rows: [] };
    });

    await expect(verifyEmailToken({ pool, token: 'verify-me' })).resolves.toEqual({
      ok: true,
      body: { verified: true },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("action_type = 'verify_email'"), [
      hashAccountToken('verify-me'),
    ]);
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE users SET email_verified = TRUE WHERE id = $1 AND deleted_at IS NULL',
      ['u_1'],
    );
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('does not reveal whether a password reset email exists', async () => {
    const pool = createPool(() => ({ rows: [] }));
    await expect(requestPasswordReset({ pool, email: 'missing@example.com' })).resolves.toEqual({
      ok: true,
      body: { accepted: true },
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('requires a 12-character password and increments auth_version after reset', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('RETURNING user_id')) return { rows: [{ user_id: 'u_1' }] };
      return { rows: [] };
    });

    await expect(
      resetPassword({
        pool,
        token: 'reset-me',
        newPassword: 'too-short',
        hashPassword: vi.fn(),
        generateSalt: () => 'salt',
      }),
    ).resolves.toMatchObject({ ok: false, status: 400 });

    const hashPassword = vi.fn(async () => 'new-hash');
    await expect(
      resetPassword({
        pool,
        token: 'reset-me',
        newPassword: 'long-enough-password',
        hashPassword,
        generateSalt: () => 'new-salt',
      }),
    ).resolves.toEqual({ ok: true, body: { reset: true, revokeSessions: true, userId: 'u_1' } });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('auth_version = auth_version + 1'), [
      'new-hash',
      'new-salt',
      'u_1',
    ]);
  });

  it('exports account data without password material', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM users')) {
        return { rows: [{ id: 'u_1', email: 'user@example.com', nickname: 'User' }] };
      }
      return { rows: [] };
    });

    const result = (await exportAccountData({ pool, userId: 'u_1' })) as {
      ok: boolean;
      body: { account: Record<string, unknown> };
    };
    expect(result.ok).toBe(true);
    expect(result.body.account).not.toHaveProperty('password_hash');
    expect(result.body.account).not.toHaveProperty('salt');
  });

  it('anonymizes an account while retaining match referential integrity', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'u_1' }] };
      return { rows: [] };
    });

    await expect(deleteAccount({ pool, userId: 'u_1' })).resolves.toEqual({
      ok: true,
      body: { deleted: true },
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("nickname = 'Deleted Player'"),
      expect.arrayContaining(['u_1', 'deleted+u_1@invalid.local']),
    );
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM matches'), expect.anything());
  });
});
