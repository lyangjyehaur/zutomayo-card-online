import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { mutateAdminCredentials } = require('../adminCredentialService.cjs') as {
  mutateAdminCredentials: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number };

function transactionalPool(handler: (sql: string, params?: unknown[]) => QueryResult | Promise<QueryResult>) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { pool: { connect }, query, release };
}

function credentialInput(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'create',
    username: 'operator',
    role: 'operator',
    passwordHash: 'password-hash-marker',
    salt: 'salt-marker',
    totpSecretCiphertext: 'ciphertext-marker',
    adminUserId: 'admin_0123456789abcdef',
    ...overrides,
  };
}

describe('admin credential mutation', () => {
  it('creates and audits an administrator under an advisory and row lock in one transaction', async () => {
    const { pool, query, release } = transactionalPool((sql) => {
      if (sql.includes('WHERE username = $1') && sql.includes('FOR UPDATE')) return { rows: [] };
      if (sql.includes('INSERT INTO admin_users')) {
        return {
          rows: [{ id: 'admin_0123456789abcdef', username: 'operator', role: 'operator', disabled_at: null }],
        };
      }
      return { rows: [] };
    });

    await expect(mutateAdminCredentials({ pool, ...credentialInput() })).resolves.toEqual({
      id: 'admin_0123456789abcdef',
      username: 'operator',
      role: 'operator',
      mode: 'create',
      sessionsRevoked: 0,
    });

    const statements = query.mock.calls.map(([sql]) => sql as string);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toContain('pg_advisory_xact_lock');
    expect(statements[2]).toContain('FOR UPDATE');
    expect(statements).toContain('SELECT id FROM admin_users WHERE id = $1 FOR UPDATE');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.some((sql) => sql.includes('UPDATE admin_sessions'))).toBe(false);

    const auditCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO admin_audit_log'));
    expect(auditCall?.[1]?.[0]).toBe('admin_account_created');
    const serializedAudit = JSON.stringify(auditCall?.[1]);
    expect(serializedAudit).not.toContain('password-hash-marker');
    expect(serializedAudit).not.toContain('salt-marker');
    expect(serializedAudit).not.toContain('ciphertext-marker');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rotates an existing credential and revokes every active session before writing the audit', async () => {
    const { pool, query } = transactionalPool((sql) => {
      if (sql.includes('WHERE username = $1') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{ id: 'admin_existing', username: 'operator', role: 'viewer', disabled_at: null }],
        };
      }
      if (sql.includes('UPDATE admin_users')) {
        return {
          rows: [{ id: 'admin_existing', username: 'operator', role: 'viewer', disabled_at: null }],
        };
      }
      if (sql.includes('UPDATE admin_sessions')) return { rows: [], rowCount: 3 };
      return { rows: [] };
    });

    await expect(
      mutateAdminCredentials({ pool, ...credentialInput({ mode: 'rotate', role: '', adminUserId: undefined }) }),
    ).resolves.toMatchObject({ mode: 'rotate', role: 'viewer', sessionsRevoked: 3 });

    const revokeIndex = query.mock.calls.findIndex(([sql]) => String(sql).includes('UPDATE admin_sessions'));
    const auditIndex = query.mock.calls.findIndex(([sql]) => String(sql).includes('INSERT INTO admin_audit_log'));
    expect(revokeIndex).toBeGreaterThan(0);
    expect(auditIndex).toBeGreaterThan(revokeIndex);
    const revokeSql = String(query.mock.calls[revokeIndex]?.[0]);
    expect(revokeSql).toContain('revoked_at IS NULL');
    expect(revokeSql).toContain('expires_at > NOW()');
    expect(query.mock.calls[auditIndex]?.[1]?.[0]).toBe('admin_credentials_rotated');
    expect(JSON.parse(String(query.mock.calls[auditIndex]?.[1]?.[2]))).toMatchObject({
      previousRole: 'viewer',
      role: 'viewer',
      wasDisabled: false,
      sessionsRevoked: 3,
    });
  });

  it('recovers only a disabled administrator, clears disabled_at, and revokes residual sessions', async () => {
    const { pool, query } = transactionalPool((sql) => {
      if (sql.includes('WHERE username = $1') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{ id: 'admin_existing', username: 'operator', role: 'operator', disabled_at: new Date() }],
        };
      }
      if (sql.includes('UPDATE admin_users')) {
        return {
          rows: [{ id: 'admin_existing', username: 'operator', role: 'admin', disabled_at: null }],
        };
      }
      if (sql.includes('UPDATE admin_sessions')) return { rows: [], rowCount: 1 };
      return { rows: [] };
    });

    await expect(
      mutateAdminCredentials({ pool, ...credentialInput({ mode: 'recover', role: 'admin', adminUserId: undefined }) }),
    ).resolves.toMatchObject({ mode: 'recover', role: 'admin', sessionsRevoked: 1 });

    const updateCall = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE admin_users'));
    expect(updateCall?.[0]).toContain("CASE WHEN $5 = 'recover' THEN NULL");
    const auditCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO admin_audit_log'));
    expect(auditCall?.[1]?.[0]).toBe('admin_account_recovered');
    expect(JSON.parse(String(auditCall?.[1]?.[2]))).toMatchObject({ previousRole: 'operator', wasDisabled: true });
  });

  it('requires explicit rotate versus recover intent for active and disabled accounts', async () => {
    const disabledPool = transactionalPool((sql) =>
      sql.includes('WHERE username = $1') && sql.includes('FOR UPDATE')
        ? { rows: [{ id: 'admin_existing', username: 'operator', role: 'operator', disabled_at: new Date() }] }
        : { rows: [] },
    );
    await expect(
      mutateAdminCredentials({
        pool: disabledPool.pool,
        ...credentialInput({ mode: 'rotate', adminUserId: undefined }),
      }),
    ).rejects.toThrow('use admin:recover');
    expect(disabledPool.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');

    const activePool = transactionalPool((sql) =>
      sql.includes('WHERE username = $1') && sql.includes('FOR UPDATE')
        ? { rows: [{ id: 'admin_existing', username: 'operator', role: 'operator', disabled_at: null }] }
        : { rows: [] },
    );
    await expect(
      mutateAdminCredentials({
        pool: activePool.pool,
        ...credentialInput({ mode: 'recover', adminUserId: undefined }),
      }),
    ).rejects.toThrow('use admin:rotate');
    expect(activePool.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('rolls back the credential and session changes when durable audit insertion fails', async () => {
    const { pool, query, release } = transactionalPool((sql) => {
      if (sql.includes('WHERE username = $1') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{ id: 'admin_existing', username: 'operator', role: 'operator', disabled_at: null }],
        };
      }
      if (sql.includes('UPDATE admin_users')) {
        return {
          rows: [{ id: 'admin_existing', username: 'operator', role: 'operator', disabled_at: null }],
        };
      }
      if (sql.includes('INSERT INTO admin_audit_log')) throw new Error('audit unavailable');
      return { rows: [], rowCount: 1 };
    });

    await expect(
      mutateAdminCredentials({ pool, ...credentialInput({ mode: 'rotate', adminUserId: undefined }) }),
    ).rejects.toThrow('audit unavailable');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
