import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { enforceRuntimeRolePrivileges, quoteIdentifier } = require('../postgres-role-gate.cjs') as {
  quoteIdentifier: (value: unknown) => string;
  enforceRuntimeRolePrivileges: (
    pool: { query: ReturnType<typeof vi.fn> },
    options: { appUser: string },
  ) => Promise<{ appUser: string; protectedTables: string[] }>;
};

describe('PostgreSQL runtime role gate', () => {
  it('quotes identifiers and rejects empty role names', () => {
    expect(quoteIdentifier('app"role')).toBe('"app""role"');
    expect(() => quoteIdentifier('')).toThrow('identifier is required');
  });

  it('revokes schema-history writes after granting runtime table access', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT current_user')) {
        return { rows: [{ migration_user: 'zutomayo_migrator', database_name: 'zutomayo' }] };
      }
      if (sql.startsWith('SELECT 1 FROM pg_roles')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes("to_regclass('public.'")) {
        return {
          rows: [
            { table_name: 'schema_migrations', present: true },
            { table_name: 'schema_migration_checksums', present: true },
          ],
        };
      }
      if (sql.includes('has_table_privilege')) {
        return {
          rows: [
            { table_name: 'schema_migrations', can_select: true, can_write: false },
            { table_name: 'schema_migration_checksums', can_select: true, can_write: false },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(enforceRuntimeRolePrivileges({ query }, { appUser: 'zutomayo_app' })).resolves.toEqual({
      appUser: 'zutomayo_app',
      protectedTables: ['schema_migrations', 'schema_migration_checksums'],
    });
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public."schema_migrations" FROM "zutomayo_app"',
    );
    expect(statements).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public."schema_migration_checksums" FROM "zutomayo_app"',
    );
    expect(statements.at(-1)).toContain('has_table_privilege');
  });

  it('fails closed when the application role or protected tables are absent', async () => {
    const missingRole = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ migration_user: 'owner', database_name: 'db' }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(enforceRuntimeRolePrivileges({ query: missingRole }, { appUser: 'app' })).rejects.toThrow(
      'does not exist',
    );

    const missingTable = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ migration_user: 'owner', database_name: 'db' }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [{ table_name: 'schema_migrations', present: false }] });
    await expect(enforceRuntimeRolePrivileges({ query: missingTable }, { appUser: 'app' })).rejects.toThrow(
      'Protected schema tables are missing',
    );
  });
});
