import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

type Queryable = {
  query: ReturnType<typeof vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>>>;
};

const require = createRequire(import.meta.url);
const { getAccountProfile, loginAccount, mapAccountProfile, registerAccount, updateAccountProfile } = require(
  '../accountService.cjs',
) as {
  getAccountProfile: (
    pool: Queryable,
    userId: string,
  ) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  loginAccount: (input: {
    pool: Queryable;
    body: Record<string, unknown>;
    hashPassword: (password: unknown, salt: string, iterations?: number) => Promise<string>;
    createToken: (userId: string) => string;
    currentIterations: number;
    legacyIterations: number;
  }) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  mapAccountProfile: (user: Record<string, unknown>) => Record<string, unknown>;
  registerAccount: (input: {
    pool: Queryable;
    body: Record<string, unknown>;
    sanitizeText: (value: unknown, maxLen?: number) => string;
    hashPassword: (password: unknown, salt: string) => Promise<string>;
    createToken: (userId: string) => string;
    generateUserId: () => string;
    generateSalt: () => string;
  }) => Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string }>;
  updateAccountProfile: (input: {
    pool: Queryable;
    userId: string;
    body: Record<string, unknown>;
    sanitizeText: (value: unknown, maxLen?: number) => string;
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

function poolWithHandler(handler: (sql: string, params?: unknown[]) => { rows: unknown[] }): Queryable {
  return {
    query: vi.fn(async (sql, params) => handler(sql, params)),
  };
}

describe('account service', () => {
  it('maps account profiles with derived win rate', () => {
    expect(mapAccountProfile(userRow)).toEqual({
      id: 'u_1',
      email: 'user@example.com',
      nickname: 'User',
      elo: 1000,
      matchCount: 4,
      wins: 3,
      winRate: 75,
      createdAt: '2026-06-30T00:00:00.000Z',
    });
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
      body: { token: 'token:u_fixed', user: { id: 'u_fixed', email: 'user@example.com', nickname: 'Alice', elo: 1000 } },
    });

    expect(sanitizeText).toHaveBeenCalledWith('<Alice>', 30);
    expect(hashPassword).toHaveBeenCalledWith('secret1', 'salt');
    expect(pool.query).toHaveBeenCalledWith(
      'INSERT INTO users (id, email, password_hash, salt, nickname) VALUES ($1, $2, $3, $4, $5)',
      ['u_fixed', 'user@example.com', 'hash', 'salt', 'Alice'],
    );
  });

  it('rejects invalid and duplicate registrations before inserting', async () => {
    const duplicatePool = poolWithHandler((sql) => (sql.startsWith('SELECT') ? { rows: [{ id: 'u_existing' }] } : { rows: [] }));
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
    const hashPassword = vi.fn(async (_password, _salt, iterations) => (iterations === 100000 ? 'current-hash' : 'legacy-hash'));

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
    const hashPassword = vi.fn(async (_password, _salt, iterations) => (iterations === 100000 ? 'current-hash' : 'legacy-hash'));

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
    expect(pool.query).toHaveBeenCalledWith('UPDATE users SET password_hash = $1 WHERE id = $2', ['current-hash', 'u_1']);
  });

  it('gets and updates profile data', async () => {
    const pool = poolWithHandler((sql) => (sql.startsWith('SELECT') ? { rows: [userRow] } : { rows: [] }));
    await expect(getAccountProfile(pool, 'u_1')).resolves.toMatchObject({ ok: true, body: { id: 'u_1', winRate: 75 } });

    await expect(
      updateAccountProfile({
        pool,
        userId: 'u_1',
        body: { nickname: '<New>' },
        sanitizeText: () => 'New',
      }),
    ).resolves.toMatchObject({ ok: true, body: { id: 'u_1' } });
    expect(pool.query).toHaveBeenCalledWith('UPDATE users SET nickname = $1 WHERE id = $2', ['New', 'u_1']);
  });

  it('returns explicit errors for missing users and blank nicknames', async () => {
    const pool = poolWithHandler(() => ({ rows: [] }));
    await expect(getAccountProfile(pool, 'missing')).resolves.toEqual({ ok: false, status: 404, error: 'User not found' });
    await expect(
      updateAccountProfile({ pool, userId: 'u_1', body: { nickname: '' }, sanitizeText: () => '' }),
    ).resolves.toEqual({ ok: false, status: 400, error: 'Nickname required' });
  });
});
