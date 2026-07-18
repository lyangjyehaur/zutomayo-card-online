import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  PERMISSION_DENIED_SQLSTATE,
  ROLE_PROBES,
  ROLE_TYPES,
  PostgresRoleTlsSmokeError,
  parseRoleArgument,
  postgresClientConfig,
  postgresRoleTlsSmokeFailureReport,
  runPostgresRoleTlsSmoke,
  type PostgresRoleTlsSmokeClient,
  type PostgresRoleTlsSmokeRole,
} from '../postgres-role-tls-smoke.cjs';

const expectedUsers: Record<PostgresRoleTlsSmokeRole, string> = {
  api: 'z_api',
  game: 'z_game',
  platform: 'z_platform',
  retention: 'z_retention',
  monitor: 'z_monitor',
  backup: 'z_backup',
};

function environment(role: PostgresRoleTlsSmokeRole): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PGSSLMODE: 'verify-full',
    PG_HOST: 'postgres.example.test',
    PG_PORT: '5432',
    PG_USER: expectedUsers[role],
    PG_PASSWORD: `only-${role}-password`,
    PG_DATABASE: 'zutomayo',
    [ROLE_PROBES[role].expectedUserVariable]: expectedUsers[role],
  };
}

function clientFor(
  role: PostgresRoleTlsSmokeRole,
  overrides: {
    identity?: Record<string, unknown>;
    denyError?: unknown;
    allowRows?: Array<Record<string, unknown>>;
  } = {},
) {
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM pg_stat_ssl')) {
      return {
        rows: [
          overrides.identity ?? {
            authenticated_user: expectedUsers[role],
            tls_enabled: true,
            tls_version: 'TLSv1.3',
            tls_cipher: 'TLS_AES_256_GCM_SHA384',
          },
        ],
      };
    }
    if (sql === ROLE_PROBES[role].allow.sql) {
      return {
        rows:
          overrides.allowRows ??
          (role === 'monitor'
            ? [
                {
                  monitor_member: true,
                },
              ]
            : []),
      };
    }
    if (sql === ROLE_PROBES[role].deny.sql) {
      if ('denyError' in overrides && overrides.denyError === undefined) return { rows: [] };
      throw overrides.denyError ?? Object.assign(new Error('permission denied'), { code: PERMISSION_DENIED_SQLSTATE });
    }
    throw new Error(`unexpected test query: ${sql}`);
  });
  const client: PostgresRoleTlsSmokeClient = { connect, query, end };
  return { client, connect, query, end };
}

describe('single-role PostgreSQL TLS operation smoke', () => {
  it.each(ROLE_TYPES)('connects as %s and returns a secret-free typed report', async (role) => {
    const fake = clientFor(role);
    let receivedConfig: Record<string, unknown> | undefined;
    const report = await runPostgresRoleTlsSmoke({
      role,
      env: environment(role),
      clientFactory(config) {
        receivedConfig = config;
        return fake.client;
      },
      now: () => new Date('2026-07-15T00:00:00.000Z'),
    });

    expect(report).toEqual({
      schemaVersion: 1,
      artifactType: 'zutomayo-postgres-role-tls-smoke',
      ok: true,
      role,
      checkedAt: '2026-07-15T00:00:00.000Z',
      identity: { matchesExpectedRole: true },
      tls: { enabled: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' },
      probes: {
        allow: { name: ROLE_PROBES[role].allow.name, status: 'passed' },
        deny: {
          name: ROLE_PROBES[role].deny.name,
          status: 'passed',
          expectedSqlState: '42501',
          observedSqlState: '42501',
        },
      },
    });
    expect(receivedConfig).toMatchObject({
      user: expectedUsers[role],
      password: `only-${role}-password`,
      ssl: { rejectUnauthorized: true },
      application_name: `zutomayo-role-tls-smoke-${role}`,
    });
    expect(JSON.stringify(report)).not.toContain(expectedUsers[role]);
    expect(JSON.stringify(report)).not.toContain(`only-${role}-password`);
    expect(fake.connect).toHaveBeenCalledOnce();
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it('requires an explicit supported role and production verify-full configuration', () => {
    expect(parseRoleArgument(['--role=api'])).toBe('api');
    expect(() => parseRoleArgument([])).toThrow(PostgresRoleTlsSmokeError);
    expect(() => parseRoleArgument(['--role=wal'])).toThrow(PostgresRoleTlsSmokeError);
    expect(() => postgresClientConfig({ ...environment('api'), PGSSLMODE: 'disable' }, 'api')).toThrow('configuration');
    expect(() => postgresClientConfig({ ...environment('api'), NODE_ENV: 'test' }, 'api')).toThrow('configuration');
  });

  it('ships in the migration image and keeps every privilege probe data-neutral', () => {
    expect(readFileSync('Dockerfile.migrate', 'utf8')).toContain(
      'COPY scripts/postgres-role-tls-smoke.cjs ./scripts/postgres-role-tls-smoke.cjs',
    );
    for (const probe of Object.values(ROLE_PROBES)) {
      expect(probe.allow.sql).toMatch(/LIMIT 0|pg_has_role/);
      expect(probe.deny.sql).toMatch(/LIMIT 0|WHERE FALSE/);
      expect(probe.deny.sql).not.toMatch(/\b(?:DELETE|DROP|TRUNCATE|ALTER)\b/i);
    }
  });

  it('fails closed when the authenticated identity or negotiated TLS metadata is wrong', async () => {
    const wrongIdentity = clientFor('api', {
      identity: {
        authenticated_user: 'z_migrator',
        tls_enabled: true,
        tls_version: 'TLSv1.3',
        tls_cipher: 'TLS_AES_256_GCM_SHA384',
      },
    });
    await expect(
      runPostgresRoleTlsSmoke({ role: 'api', env: environment('api'), clientFactory: () => wrongIdentity.client }),
    ).rejects.toMatchObject({ stage: 'identity' });
    expect(wrongIdentity.end).toHaveBeenCalledOnce();

    const plaintext = clientFor('api', {
      identity: {
        authenticated_user: expectedUsers.api,
        tls_enabled: false,
        tls_version: null,
        tls_cipher: null,
      },
    });
    await expect(
      runPostgresRoleTlsSmoke({ role: 'api', env: environment('api'), clientFactory: () => plaintext.client }),
    ).rejects.toMatchObject({ stage: 'tls' });
    expect(plaintext.end).toHaveBeenCalledOnce();
  });

  it('requires the allow result and an exact permission-denied SQLSTATE', async () => {
    const missingMembership = clientFor('monitor', { allowRows: [{ monitor_member: false }] });
    await expect(
      runPostgresRoleTlsSmoke({
        role: 'monitor',
        env: environment('monitor'),
        clientFactory: () => missingMembership.client,
      }),
    ).rejects.toMatchObject({ stage: 'allow-probe' });

    const unexpectedSuccess = clientFor('backup', { denyError: undefined });
    await expect(
      runPostgresRoleTlsSmoke({
        role: 'backup',
        env: environment('backup'),
        clientFactory: () => unexpectedSuccess.client,
      }),
    ).rejects.toMatchObject({ stage: 'deny-probe' });

    const unavailableTable = clientFor('game', {
      denyError: Object.assign(new Error('relation missing'), { code: '42P01' }),
    });
    await expect(
      runPostgresRoleTlsSmoke({
        role: 'game',
        env: environment('game'),
        clientFactory: () => unavailableTable.client,
      }),
    ).rejects.toMatchObject({ stage: 'deny-probe' });
  });

  it('serializes failures without raw errors, credentials, or connection details', () => {
    const secret = 'do-not-serialize-this-password';
    const rawError = Object.assign(new Error(`authentication failed for ${secret}@db.internal`), { code: '28P01' });
    const report = postgresRoleTlsSmokeFailureReport(rawError, 'api', () => new Date('2026-07-15T00:00:00.000Z'));

    expect(report).toEqual({
      schemaVersion: 1,
      artifactType: 'zutomayo-postgres-role-tls-smoke',
      ok: false,
      role: 'api',
      checkedAt: '2026-07-15T00:00:00.000Z',
      failure: { stage: 'internal' },
    });
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(JSON.stringify(report)).not.toContain('db.internal');
  });
});
