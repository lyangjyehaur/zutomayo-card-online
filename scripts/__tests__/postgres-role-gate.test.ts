import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { ALL_TABLES, APPLICATION_TABLES, enforceRuntimeRolePrivileges, quoteIdentifier } =
  require('../postgres-role-gate.cjs') as {
    ALL_TABLES: string[];
    APPLICATION_TABLES: string[];
    quoteIdentifier: (value: unknown) => string;
    enforceRuntimeRolePrivileges: (
      pool: { query: ReturnType<typeof vi.fn>; connect?: ReturnType<typeof vi.fn> },
      options: {
        appUser?: string;
        roleUsers?: Record<string, string>;
        requireComplete?: boolean;
        requireDistinct?: boolean;
      },
    ) => Promise<{
      appUser?: string;
      roles: Record<string, string>;
      protectedTables: string[];
      requiredRoleTypes: string[];
    }>;
  };
const { REQUIRED_RUNTIME_TABLES } = require('../../api/schemaGate.cjs') as { REQUIRED_RUNTIME_TABLES: string[] };

const roleUsers = Object.freeze({
  api: 'z_api',
  game: 'z_game',
  platform: 'z_platform',
  retention: 'z_retention',
  monitor: 'z_monitor',
  backup: 'z_backup',
  wal: 'z_wal',
});

type QueryOverride = (sql: string, params: unknown[]) => { rows: unknown[] } | undefined;

function successfulQuery(users: Record<string, string> = roleUsers, override?: QueryOverride) {
  const uniqueUsers = [...new Set(Object.values(users))];
  return vi.fn(async (sql: string, params: unknown[] = []) => {
    const overridden = override?.(sql, params);
    if (overridden) return overridden;
    if (sql.startsWith('SELECT current_user')) {
      return { rows: [{ migration_user: 'z_migrator', database_name: 'zutomayo' }] };
    }
    if (sql.includes('rolreplication') && sql.includes('FROM pg_roles')) {
      return {
        rows: uniqueUsers.map((rolname) => ({
          rolname,
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: rolname === users.wal,
          rolbypassrls: false,
          rolinherit: rolname !== users.wal,
        })),
      };
    }
    if (sql.includes("rolname = 'pg_monitor'")) return { rows: [{ rolcanlogin: false }] };
    if (sql.includes("to_regclass('public.'")) {
      return { rows: ALL_TABLES.map((table_name) => ({ table_name, present: true })) };
    }
    if (sql.includes('FROM information_schema.tables')) {
      return { rows: ALL_TABLES.map((table_name) => ({ table_name })) };
    }
    if (sql.includes('has_table_privilege')) return { rows: [] };
    if (sql.includes('has_column_privilege')) return { rows: [] };
    if (sql.includes('has_sequence_privilege')) return { rows: [] };
    if (sql.includes('has_schema_privilege')) {
      return {
        rows: uniqueUsers.map((role_name) => ({
          role_name,
          can_use: role_name !== users.monitor && role_name !== users.wal,
          can_create: false,
        })),
      };
    }
    if (sql.includes('has_database_privilege')) {
      return { rows: uniqueUsers.map((role_name) => ({ role_name, can_connect: role_name !== users.wal })) };
    }
    if (sql.includes('pg_has_role')) {
      return { rows: uniqueUsers.map((role_name) => ({ role_name, is_member: role_name === users.monitor })) };
    }
    if (sql.includes('FROM pg_auth_members')) return { rows: [] };
    return { rows: [] };
  });
}

describe('PostgreSQL runtime role gate', () => {
  it('quotes identifiers and rejects empty role names', () => {
    expect(quoteIdentifier('app"role')).toBe('"app""role"');
    expect(() => quoteIdentifier('')).toThrow('identifier is required');
  });

  it('applies and verifies the complete least-privilege matrix', async () => {
    const query = successfulQuery();

    await expect(
      enforceRuntimeRolePrivileges({ query }, { roleUsers, requireComplete: true, requireDistinct: true }),
    ).resolves.toMatchObject({
      appUser: 'z_api',
      roles: roleUsers,
      protectedTables: ['schema_migrations', 'schema_migration_checksums'],
    });

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain('GRANT SELECT, UPDATE ON TABLE public."matches" TO "z_retention"');
    expect(statements).toContain('GRANT SELECT, DELETE ON TABLE public."chat_message_translations" TO "z_retention"');
    expect(statements).toContain('GRANT INSERT, UPDATE ON TABLE public."retention_runs" TO "z_retention"');
    expect(statements).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."account_export_jobs" TO "z_api"',
    );
    expect(statements).toContain('GRANT SELECT, INSERT ON TABLE public."account_export_audit" TO "z_api"');
    expect(statements).toContain('GRANT SELECT, DELETE ON TABLE public."account_export_jobs" TO "z_retention"');
    expect(statements).toContain('GRANT SELECT, DELETE ON TABLE public."account_export_audit" TO "z_retention"');
    expect(statements).not.toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."account_export_audit" TO "z_api"',
    );
    expect(statements).not.toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."matches" TO "z_retention"');
    expect(statements).toContain('GRANT SELECT ON TABLE public."users" TO "z_backup"');
    expect(statements).toContain('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO "z_backup"');
    expect(statements).not.toContain('GRANT USAGE ON SCHEMA public TO "z_monitor"');
    expect(statements).not.toContain('GRANT CONNECT ON DATABASE "zutomayo" TO "z_wal"');
    expect(statements).not.toContain('GRANT USAGE ON SCHEMA public TO "z_wal"');
    expect(statements).toContain('BEGIN');
    expect(statements).toContain('COMMIT');
    expect(statements).toContain('SELECT pg_advisory_xact_lock(hashtext($1))');
    expect(statements).toContain(
      'GRANT SELECT ("id", "elo", "match_count", "wins", "auth_version", "deleted_at") ON TABLE public."users" TO "z_game"',
    );
    expect(statements).toContain('GRANT UPDATE ("elo", "match_count", "wins") ON TABLE public."users" TO "z_game"');
    expect(statements).toContain(
      'GRANT SELECT ("id", "auth_version", "deleted_at") ON TABLE public."users" TO "z_platform"',
    );
  });

  it('permits only the local API/GAME/PLATFORM compatibility alias', async () => {
    const localUsers = { ...roleUsers, api: 'z_app', game: 'z_app', platform: 'z_app' };
    const query = successfulQuery(localUsers);
    await expect(
      enforceRuntimeRolePrivileges({ query }, { roleUsers: localUsers, requireComplete: true }),
    ).resolves.toMatchObject({ appUser: 'z_app' });

    await expect(
      enforceRuntimeRolePrivileges(
        { query: vi.fn() },
        { roleUsers: localUsers, requireComplete: true, requireDistinct: true },
      ),
    ).rejects.toThrow('must be distinct');
    await expect(
      enforceRuntimeRolePrivileges(
        { query: vi.fn() },
        { roleUsers: { ...roleUsers, backup: roleUsers.monitor }, requireComplete: true },
      ),
    ).rejects.toThrow('only API/GAME/PLATFORM');
  });

  it('fails closed for incomplete, missing, or unsafe roles', async () => {
    await expect(
      enforceRuntimeRolePrivileges({ query: vi.fn() }, { appUser: 'z_app', requireComplete: true }),
    ).rejects.toThrow('role matrix is incomplete');

    const missingRole = successfulQuery(roleUsers, (sql) => {
      if (!sql.includes('rolreplication') || !sql.includes('FROM pg_roles')) return undefined;
      return {
        rows: Object.values(roleUsers)
          .filter((rolname) => rolname !== roleUsers.backup)
          .map((rolname) => ({
            rolname,
            rolcanlogin: true,
            rolsuper: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: rolname === roleUsers.wal,
            rolbypassrls: false,
            rolinherit: rolname !== roleUsers.wal,
          })),
      };
    });
    await expect(
      enforceRuntimeRolePrivileges({ query: missingRole }, { roleUsers, requireComplete: true, requireDistinct: true }),
    ).rejects.toThrow('do not exist');

    const unsafeWal = successfulQuery(roleUsers, (sql) => {
      if (!sql.includes('rolreplication') || !sql.includes('FROM pg_roles')) return undefined;
      return {
        rows: Object.values(roleUsers).map((rolname) => ({
          rolname,
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: rolname === roleUsers.wal,
          rolbypassrls: false,
          rolinherit: true,
        })),
      };
    });
    await expect(
      enforceRuntimeRolePrivileges({ query: unsafeWal }, { roleUsers, requireComplete: true, requireDistinct: true }),
    ).rejects.toThrow('attributes are unsafe');
  });

  it('fails closed when required tables or final ACLs do not match', async () => {
    const missingTable = successfulQuery(roleUsers, (sql) => {
      if (!sql.includes("to_regclass('public.'")) return undefined;
      return { rows: [{ table_name: 'schema_migrations', present: false }] };
    });
    await expect(
      enforceRuntimeRolePrivileges(
        { query: missingTable },
        { roleUsers, requireComplete: true, requireDistinct: true },
      ),
    ).rejects.toThrow('Role matrix tables are missing');

    const unknownTable = successfulQuery(roleUsers, (sql) => {
      if (!sql.includes('FROM information_schema.tables')) return undefined;
      return { rows: [...ALL_TABLES, 'forgotten_migration_table'].map((table_name) => ({ table_name })) };
    });
    await expect(
      enforceRuntimeRolePrivileges(
        { query: unknownTable },
        { roleUsers, requireComplete: true, requireDistinct: true },
      ),
    ).rejects.toThrow('missing from the PostgreSQL role matrix');

    const invalidAcl = successfulQuery(roleUsers, (sql) => {
      if (!sql.includes('has_table_privilege')) return undefined;
      return { rows: [{ role_name: roleUsers.backup, table_name: 'users', privilege: 'UPDATE' }] };
    });
    await expect(
      enforceRuntimeRolePrivileges({ query: invalidAcl }, { roleUsers, requireComplete: true, requireDistinct: true }),
    ).rejects.toThrow('table privileges do not match');
    const invalidStatements = invalidAcl.mock.calls.map(([sql]) => String(sql));
    expect(invalidStatements).toContain('ROLLBACK');
    expect(invalidStatements).not.toContain('COMMIT');
  });

  it('pins the ACL transaction to one acquired client', async () => {
    const precheckQuery = successfulQuery();
    const clientQuery = successfulQuery();
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query: clientQuery, release }));

    await enforceRuntimeRolePrivileges(
      { query: precheckQuery, connect },
      { roleUsers, requireComplete: true, requireDistinct: true },
    );

    expect(connect).toHaveBeenCalledOnce();
    expect(clientQuery.mock.calls.map(([sql]) => String(sql))).toContain('BEGIN');
    expect(clientQuery.mock.calls.map(([sql]) => String(sql))).toContain('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('PostgreSQL role provisioning contract', () => {
  it('keeps the ACL allowlist aligned with the runtime schema list', () => {
    expect(new Set(ALL_TABLES.filter((table) => table !== 'schema_migrations'))).toEqual(
      new Set(REQUIRED_RUNTIME_TABLES),
    );
    expect(new Set(APPLICATION_TABLES)).toEqual(
      new Set(REQUIRED_RUNTIME_TABLES.filter((table) => table !== 'schema_migration_checksums')),
    );
  });

  it('bootstraps every role in one fail-closed SQL transaction', () => {
    const script = readFileSync('scripts/postgres-init-roles.sh', 'utf8');
    for (const variable of [
      'PG_API_USER',
      'PG_GAME_USER',
      'PG_PLATFORM_USER',
      'PG_RETENTION_USER',
      'PG_MONITOR_USER',
      'PG_BACKUP_USER',
      'PG_WAL_USER',
    ]) {
      expect(script).toContain(variable);
    }
    expect(script).toContain('--set=ON_ERROR_STOP=1');
    expect(script).toContain('\\getenv migration_password PG_MIGRATION_PASSWORD');
    expect(script).toContain('\\getenv api_password PG_API_PASSWORD');
    expect(script).not.toContain('--set=api_password=');
    expect(script).toContain('PG_MIGRATION_USER="${PG_MIGRATION_USER:-$POSTGRES_USER}"');
    expect(script).toContain('--set=migration_user="$PG_MIGRATION_USER"');
    expect(script).toContain('ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER');
    expect(script).toContain('ALTER DATABASE %I OWNER TO %I');
    expect(script).toContain('ALTER TABLE %I.%I OWNER TO %I');
    expect(script).toMatch(/<<'SQL'\n(?:\\getenv[^\n]+\n)+BEGIN;[\s\S]+COMMIT;\nSQL/);
    expect(script).toContain("CASE WHEN replication THEN 'REPLICATION' ELSE 'NOREPLICATION' END");
    expect(script).toContain("CASE WHEN replication THEN 'NOINHERIT' ELSE 'INHERIT' END");
    expect(script).toContain('GRANT pg_monitor TO %I');
  });

  it('rejects reused production role passwords before invoking psql', () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      POSTGRES_USER: 'z_bootstrap',
      PG_MIGRATION_USER: 'z_migrator',
      PG_MIGRATION_PASSWORD: 'migration-secret',
      POSTGRES_DB: 'zutomayo',
      REQUIRE_DISTINCT_DB_ROLES: 'true',
      PG_API_USER: 'z_api',
      PG_API_PASSWORD: 'same-secret',
      PG_GAME_USER: 'z_game',
      PG_GAME_PASSWORD: 'same-secret',
      PG_PLATFORM_USER: 'z_platform',
      PG_PLATFORM_PASSWORD: 'platform-secret',
      PG_RETENTION_USER: 'z_retention',
      PG_RETENTION_PASSWORD: 'retention-secret',
      PG_MONITOR_USER: 'z_monitor',
      PG_MONITOR_PASSWORD: 'monitor-secret',
      PG_BACKUP_USER: 'z_backup',
      PG_BACKUP_PASSWORD: 'backup-secret',
      PG_WAL_USER: 'z_wal',
      PG_WAL_PASSWORD: 'wal-secret',
    };
    const result = spawnSync('bash', ['scripts/postgres-init-roles.sh'], { encoding: 'utf8', env });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('must not reuse passwords');
  });

  it('uses explicit runtime allowlists without importing the shared env file', () => {
    for (const composeFile of ['docker-compose.server4.yml', 'docker-compose.staging.yml']) {
      const compose = readFileSync(composeFile, 'utf8');
      expect(compose).not.toContain('env_file:');
      expect(compose).toContain('PG_GAME_PASSWORD');
      expect(compose).toContain('PG_API_PASSWORD');
      expect(compose).toContain('PG_PLATFORM_PASSWORD');
    }
  });
});
