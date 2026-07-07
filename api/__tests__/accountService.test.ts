import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>>;
};

const require = createRequire(import.meta.url);
const {
  createAvatarUrls,
  getAccountProfile,
  linkOAuthIdentity,
  listAccountIdentities,
  loginAccount,
  mapAccountProfile,
  registerAccount,
  unlinkOAuthIdentity,
  updateAccountPassword,
  updateAccountProfile,
} = require('../accountService.cjs') as {
  createAvatarUrls: (
    email: string,
    country?: string,
    hashEmail?: (email: string) => string,
  ) => { avatarUrl: string; avatarFallbackUrls: string[] };
  getAccountProfile: (
    pool: Queryable,
    userId: string,
    options?: Record<string, unknown>,
  ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  linkOAuthIdentity: (input: {
    pool: Queryable;
    userId: string;
    profile: Record<string, unknown>;
  }) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  listAccountIdentities: (
    pool: Queryable,
    userId: string,
  ) => Promise<
    { ok: true; body: { identities: Record<string, unknown>[] } } | { ok: false; status: number; error: string }
  >;
  loginAccount: (input: {
    pool: Queryable;
    body: Record<string, unknown>;
    hashPassword: (password: unknown, salt: string, iterations?: number) => Promise<string>;
    createToken: (userId: string) => string;
    currentIterations: number;
    legacyIterations: number;
  }) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  mapAccountProfile: (user: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>;
  registerAccount: (input: {
    pool: Queryable;
    body: Record<string, unknown>;
    sanitizeText: (value: unknown, maxLen?: number) => string;
    hashPassword: (password: unknown, salt: string) => Promise<string>;
    createToken: (userId: string) => string;
    generateUserId: () => string;
    generateSalt: () => string;
  }) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  unlinkOAuthIdentity: (input: {
    pool: Queryable;
    userId: string;
    provider: string;
  }) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  updateAccountProfile: (input: {
    pool: Queryable;
    userId: string;
    body: Record<string, unknown>;
    sanitizeText: (value: unknown, maxLen?: number) => string;
    hashEmail?: (email: string) => string;
  }) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  updateAccountPassword: (input: {
    pool: Queryable;
    userId: string;
    body: Record<string, unknown>;
    hashPassword: (password: unknown, salt: string, iterations?: number) => Promise<string>;
    generateSalt: () => string;
    currentIterations: number;
    legacyIterations: number;
  }) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
};

const userRow = {
  id: 'u_1',
  email: 'user@example.com',
  nickname: 'User',
  elo: 1000,
  match_count: 4,
  wins: 3,
  created_at: '2026-06-30T00:00:00.000Z',
  salt: 'salt',
  password_hash: 'current-hash',
};
const userEmailHash = 'b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514';
const hashEmail = () => userEmailHash;

function poolWithHandler(handler: (sql: string, params?: unknown[]) => { rows: unknown[] }): Queryable {
  return {
    query: vi.fn(async (sql, params) => handler(sql, params)),
  };
}

describe('account service', () => {
  it('maps account profiles with derived win rate', () => {
    expect(mapAccountProfile(userRow, { hashEmail })).toEqual({
      id: 'u_1',
      email: 'user@example.com',
      nickname: 'User',
      avatarUrl: `https://www.gravatar.com/avatar/${userEmailHash}?d=mp&s=160`,
      avatarFallbackUrls: [`https://cravatar.cn/avatar/${userEmailHash}?d=mp&s=160`],
      elo: 1000,
      matchCount: 4,
      wins: 3,
      winRate: 75,
      createdAt: '2026-06-30T00:00:00.000Z',
    });
  });

  it('builds avatar fallbacks for China and numeric QQ mailboxes', () => {
    const avatars = createAvatarUrls('123456@qq.com', 'CN', hashEmail);
    expect(avatars.avatarUrl).toContain('cravatar.cn/avatar/');
    expect(avatars.avatarFallbackUrls[0]).toBe('https://q1.qlogo.cn/g?b=qq&nk=123456&s=100');
    expect(avatars.avatarFallbackUrls[1]).toContain('gravatar.com/avatar/');
  });

  it('registers users with normalized email, sanitized nickname, and generated credentials', async () => {
    const pool = poolWithHandler((sql) => (sql.startsWith('SELECT') ? { rows: [] } : { rows: [] }));
    const sanitizeText = vi.fn(() => 'Alice');
    const hashPassword = vi.fn(async () => 'hash');

    await expect(
      registerAccount({
        pool,
        body: { email: 'USER@EXAMPLE.COM', password: 'secret1', nickname: '<Alice>' },
        sanitizeText,
        hashPassword,
        createToken: (id) => `token:${id}`,
        generateUserId: () => 'u_fixed',
        generateSalt: () => 'salt',
      }),
    ).resolves.toEqual({
      ok: true,
      body: {
        token: 'token:u_fixed',
        user: { id: 'u_fixed', email: 'user@example.com', nickname: 'Alice', elo: 1000 },
      },
    });

    expect(sanitizeText).toHaveBeenCalledWith('<Alice>', 30);
    expect(hashPassword).toHaveBeenCalledWith('secret1', 'salt');
    expect(pool.query).toHaveBeenCalledWith(
      'INSERT INTO users (id, email, password_hash, salt, nickname) VALUES ($1, $2, $3, $4, $5)',
      ['u_fixed', 'user@example.com', 'hash', 'salt', 'Alice'],
    );
  });

  it('rejects invalid and duplicate registrations before inserting', async () => {
    const duplicatePool = poolWithHandler((sql) =>
      sql.startsWith('SELECT') ? { rows: [{ id: 'u_existing' }] } : { rows: [] },
    );
    const deps = {
      pool: duplicatePool,
      sanitizeText: () => 'User',
      hashPassword: async () => 'hash',
      createToken: () => 'token',
      generateUserId: () => 'u_fixed',
      generateSalt: () => 'salt',
    };

    await expect(registerAccount({ ...deps, body: { email: '', password: 'secret1' } })).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    await expect(registerAccount({ ...deps, body: { email: 'a@b.com', password: '123' } })).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    await expect(registerAccount({ ...deps, body: { email: 'a@b.com', password: 'secret1' } })).resolves.toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it('logs in current-hash users without rehashing', async () => {
    const pool = poolWithHandler((sql) => (sql.startsWith('SELECT') ? { rows: [userRow] } : { rows: [] }));
    const hashPassword = vi.fn(async (_password, _salt, iterations) =>
      iterations === 100000 ? 'current-hash' : 'legacy-hash',
    );

    await expect(
      loginAccount({
        pool,
        body: { email: 'user@example.com', password: 'secret1' },
        hashPassword,
        createToken: (id) => `token:${id}`,
        currentIterations: 100000,
        legacyIterations: 10000,
      }),
    ).resolves.toMatchObject({ ok: true, body: { token: 'token:u_1' } });
    expect(pool.query).not.toHaveBeenCalledWith('UPDATE users SET password_hash = $1 WHERE id = $2', expect.anything());
  });

  it('upgrades legacy password hashes after successful login', async () => {
    const legacyUser = { ...userRow, password_hash: 'legacy-hash' };
    const pool = poolWithHandler((sql) => (sql.startsWith('SELECT') ? { rows: [legacyUser] } : { rows: [] }));
    const hashPassword = vi.fn(async (_password, _salt, iterations) =>
      iterations === 100000 ? 'current-hash' : 'legacy-hash',
    );

    await expect(
      loginAccount({
        pool,
        body: { email: 'user@example.com', password: 'secret1' },
        hashPassword,
        createToken: (id) => `token:${id}`,
        currentIterations: 100000,
        legacyIterations: 10000,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(pool.query).toHaveBeenCalledWith('UPDATE users SET password_hash = $1 WHERE id = $2', [
      'current-hash',
      'u_1',
    ]);
  });

  it('updates password after verifying current password', async () => {
    const pool = poolWithHandler((sql) => (sql.startsWith('SELECT') ? { rows: [userRow] } : { rows: [] }));
    const hashPassword = vi.fn(async (password, _salt, iterations) => {
      if (password === 'secret1' && iterations === 100000) return 'current-hash';
      if (password === 'newsecret' && iterations === 100000) return 'next-hash';
      return 'other-hash';
    });

    await expect(
      updateAccountPassword({
        pool,
        userId: 'u_1',
        body: { currentPassword: 'secret1', newPassword: 'newsecret' },
        hashPassword,
        generateSalt: () => 'next-salt',
        currentIterations: 100000,
        legacyIterations: 10000,
      }),
    ).resolves.toEqual({ ok: true, body: { ok: true } });
    expect(pool.query).toHaveBeenCalledWith('UPDATE users SET password_hash = $1, salt = $2 WHERE id = $3', [
      'next-hash',
      'next-salt',
      'u_1',
    ]);
  });

  it('rejects password updates when current password is invalid', async () => {
    const pool = poolWithHandler((sql) => (sql.startsWith('SELECT') ? { rows: [userRow] } : { rows: [] }));
    await expect(
      updateAccountPassword({
        pool,
        userId: 'u_1',
        body: { currentPassword: 'wrong', newPassword: 'newsecret' },
        hashPassword: async () => 'wrong-hash',
        generateSalt: () => 'next-salt',
        currentIterations: 100000,
        legacyIterations: 10000,
      }),
    ).resolves.toEqual({ ok: false, status: 401, error: 'Invalid current password' });
  });

  it('lists and links OAuth identities for the current user', async () => {
    const pool = poolWithHandler((sql) => {
      if (sql.includes('FROM user_identities') && sql.includes('ORDER BY')) {
        return {
          rows: [
            {
              provider: 'google',
              provider_user_id: 'g_1',
              email: 'user@example.com',
              display_name: 'User',
              avatar_url: 'https://example.com/avatar.png',
              created_at: '2026-07-01T00:00:00.000Z',
              updated_at: '2026-07-02T00:00:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(listAccountIdentities(pool, 'u_1')).resolves.toEqual({
      ok: true,
      body: {
        identities: [
          {
            provider: 'google',
            providerUserId: 'g_1',
            email: 'user@example.com',
            displayName: 'User',
            avatarUrl: 'https://example.com/avatar.png',
            linkedAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-02T00:00:00.000Z',
          },
        ],
      },
    });

    await expect(
      linkOAuthIdentity({
        pool,
        userId: 'u_1',
        profile: {
          provider: 'google',
          providerUserId: 'g_1',
          email: 'USER@EXAMPLE.COM',
          emailVerified: true,
          displayName: 'User',
          avatarUrl: 'https://example.com/avatar.png',
        },
      }),
    ).resolves.toEqual({ ok: true, body: { linked: true, provider: 'google' } });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO user_identities'), [
      'u_1',
      'google',
      'g_1',
      'user@example.com',
      true,
      'User',
      'https://example.com/avatar.png',
    ]);
  });

  it('rejects linking an OAuth identity owned by another user', async () => {
    const pool = poolWithHandler((sql) =>
      sql.includes('SELECT user_id FROM user_identities') ? { rows: [{ user_id: 'u_2' }] } : { rows: [] },
    );
    await expect(
      linkOAuthIdentity({
        pool,
        userId: 'u_1',
        profile: { provider: 'discord', providerUserId: 'd_1' },
      }),
    ).resolves.toEqual({ ok: false, status: 409, error: 'OAuth account is already linked' });
  });

  it('unlinks OAuth identities when another sign-in method remains', async () => {
    const pool = poolWithHandler((sql) => {
      if (sql.includes('SELECT provider_user_id FROM user_identities')) return { rows: [{ provider_user_id: 'g_1' }] };
      if (sql.includes('SELECT password_hash FROM users')) return { rows: [{ password_hash: 'current-hash' }] };
      if (sql.includes('SELECT COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
      return { rows: [] };
    });

    await expect(unlinkOAuthIdentity({ pool, userId: 'u_1', provider: 'google' })).resolves.toEqual({
      ok: true,
      body: { unlinked: true, provider: 'google' },
    });
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM user_identities WHERE user_id = $1 AND provider = $2', [
      'u_1',
      'google',
    ]);
  });

  it('rejects unlinking the last OAuth-only sign-in method', async () => {
    const pool = poolWithHandler((sql) => {
      if (sql.includes('SELECT provider_user_id FROM user_identities')) return { rows: [{ provider_user_id: 'g_1' }] };
      if (sql.includes('SELECT password_hash FROM users')) return { rows: [{ password_hash: 'oauth:disabled' }] };
      if (sql.includes('SELECT COUNT(*)::int AS count')) return { rows: [{ count: 1 }] };
      return { rows: [] };
    });

    await expect(unlinkOAuthIdentity({ pool, userId: 'u_1', provider: 'google' })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'Cannot unlink the last sign-in method',
    });
    expect(pool.query).not.toHaveBeenCalledWith(
      'DELETE FROM user_identities WHERE user_id = $1 AND provider = $2',
      expect.anything(),
    );
  });

  it('gets and updates profile data', async () => {
    const pool = poolWithHandler((sql) => (sql.startsWith('SELECT') ? { rows: [userRow] } : { rows: [] }));
    await expect(getAccountProfile(pool, 'u_1', { hashEmail })).resolves.toMatchObject({
      ok: true,
      body: { id: 'u_1', winRate: 75, avatarUrl: expect.stringContaining('gravatar.com') },
    });

    await expect(
      updateAccountProfile({
        pool,
        userId: 'u_1',
        body: { nickname: '<New>' },
        sanitizeText: () => 'New',
        hashEmail,
      }),
    ).resolves.toMatchObject({ ok: true, body: { id: 'u_1' } });
    expect(pool.query).toHaveBeenCalledWith('UPDATE users SET nickname = $1 WHERE id = $2', ['New', 'u_1']);
  });

  it('returns explicit errors for missing users and blank nicknames', async () => {
    const pool = poolWithHandler(() => ({ rows: [] }));
    await expect(getAccountProfile(pool, 'missing')).resolves.toEqual({
      ok: false,
      status: 404,
      error: 'User not found',
    });
    await expect(
      updateAccountProfile({ pool, userId: 'u_1', body: { nickname: '' }, sanitizeText: () => '' }),
    ).resolves.toEqual({ ok: false, status: 400, error: 'Nickname required' });
  });
});
