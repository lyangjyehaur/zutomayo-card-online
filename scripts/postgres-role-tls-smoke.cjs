'use strict';

const { Client } = require('pg');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');

const ARTIFACT_TYPE = 'zutomayo-postgres-role-tls-smoke';
const PERMISSION_DENIED_SQLSTATE = '42501';
const DEFAULT_TIMEOUT_MS = 10_000;

const ROLE_PROBES = Object.freeze({
  api: Object.freeze({
    expectedUserVariable: 'PG_API_USER',
    allow: Object.freeze({ name: 'read-users', sql: 'SELECT id FROM public.users LIMIT 0' }),
    deny: Object.freeze({
      name: 'write-schema-history',
      sql: 'UPDATE public.schema_migrations SET name = name WHERE FALSE',
    }),
  }),
  game: Object.freeze({
    expectedUserVariable: 'PG_GAME_USER',
    allow: Object.freeze({
      name: 'read-game-user-state',
      sql: 'SELECT auth_version, deleted_at FROM public.users LIMIT 0',
    }),
    deny: Object.freeze({ name: 'read-user-email', sql: 'SELECT email FROM public.users LIMIT 0' }),
  }),
  platform: Object.freeze({
    expectedUserVariable: 'PG_PLATFORM_USER',
    allow: Object.freeze({
      name: 'read-platform-user-state',
      sql: 'SELECT auth_version, deleted_at FROM public.users LIMIT 0',
    }),
    deny: Object.freeze({ name: 'read-user-email', sql: 'SELECT email FROM public.users LIMIT 0' }),
  }),
  retention: Object.freeze({
    expectedUserVariable: 'PG_RETENTION_USER',
    allow: Object.freeze({
      name: 'read-retention-user-state',
      sql: 'SELECT id, deleted_at FROM public.users LIMIT 0',
    }),
    deny: Object.freeze({ name: 'read-user-email', sql: 'SELECT email FROM public.users LIMIT 0' }),
  }),
  monitor: Object.freeze({
    expectedUserVariable: 'PG_MONITOR_USER',
    allow: Object.freeze({
      name: 'verify-pg-monitor-membership',
      sql: "SELECT pg_has_role(current_user, 'pg_monitor', 'member') AS monitor_member",
      validate(rows) {
        return rows?.[0]?.monitor_member === true;
      },
    }),
    deny: Object.freeze({ name: 'read-application-table', sql: 'SELECT id FROM public.users LIMIT 0' }),
  }),
  backup: Object.freeze({
    expectedUserVariable: 'PG_BACKUP_USER',
    allow: Object.freeze({ name: 'read-users', sql: 'SELECT id FROM public.users LIMIT 0' }),
    deny: Object.freeze({
      name: 'write-users',
      sql: 'UPDATE public.users SET nickname = nickname WHERE FALSE',
    }),
  }),
});

const ROLE_TYPES = Object.freeze(Object.keys(ROLE_PROBES));

class PostgresRoleTlsSmokeError extends Error {
  constructor(stage) {
    super(`PostgreSQL role TLS smoke failed during ${stage}`);
    this.name = 'PostgresRoleTlsSmokeError';
    this.stage = stage;
  }
}

function asSmokeError(error, stage) {
  return error instanceof PostgresRoleTlsSmokeError ? error : new PostgresRoleTlsSmokeError(stage);
}

function parseRoleArgument(argv) {
  if (!Array.isArray(argv) || argv.length !== 1 || !String(argv[0]).startsWith('--role=')) {
    throw new PostgresRoleTlsSmokeError('configuration');
  }
  const role = String(argv[0]).slice('--role='.length);
  if (!Object.hasOwn(ROLE_PROBES, role)) throw new PostgresRoleTlsSmokeError('configuration');
  return role;
}

function parseTimeout(env) {
  const raw = String(env.PG_ROLE_TLS_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS).trim();
  if (!/^\d+$/.test(raw)) throw new PostgresRoleTlsSmokeError('configuration');
  const timeoutMs = Number(raw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new PostgresRoleTlsSmokeError('configuration');
  }
  return timeoutMs;
}

function requiredEnvironmentValue(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new PostgresRoleTlsSmokeError('configuration');
  return value;
}

function postgresClientConfig(env, role) {
  if (env.NODE_ENV !== 'production') throw new PostgresRoleTlsSmokeError('configuration');
  if (
    String(env.PGSSLMODE || '')
      .trim()
      .toLowerCase() !== 'verify-full'
  ) {
    throw new PostgresRoleTlsSmokeError('configuration');
  }

  const probe = ROLE_PROBES[role];
  try {
    assertPostgresExpectedRole(env, probe.expectedUserVariable);
  } catch (error) {
    throw asSmokeError(error, 'configuration');
  }

  const timeoutMs = parseTimeout(env);
  let connectionString;
  let ssl;
  try {
    connectionString = postgresConnectionString(env);
    ssl = postgresSslConfig(env);
  } catch (error) {
    throw asSmokeError(error, 'configuration');
  }
  if (!ssl || ssl.rejectUnauthorized !== true) throw new PostgresRoleTlsSmokeError('configuration');

  const connection = connectionString
    ? { connectionString }
    : {
        host: requiredEnvironmentValue(env, 'PG_HOST'),
        port: Number(env.PG_PORT || 5432),
        user: requiredEnvironmentValue(env, 'PG_USER'),
        password: requiredEnvironmentValue(env, 'PG_PASSWORD'),
        database: requiredEnvironmentValue(env, 'PG_DATABASE'),
      };
  if (!connectionString && (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65_535)) {
    throw new PostgresRoleTlsSmokeError('configuration');
  }

  return {
    ...connection,
    ssl,
    application_name: `zutomayo-role-tls-smoke-${role}`,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
  };
}

function sqlState(error) {
  if (!error || typeof error !== 'object') return '';
  return typeof error.code === 'string' ? error.code : '';
}

async function runPostgresRoleTlsSmoke({ role, env = process.env, clientFactory, now = () => new Date() }) {
  if (!Object.hasOwn(ROLE_PROBES, role)) throw new PostgresRoleTlsSmokeError('configuration');
  const probe = ROLE_PROBES[role];
  const expectedUser = requiredEnvironmentValue(env, probe.expectedUserVariable);
  const config = postgresClientConfig(env, role);
  const createClient = clientFactory || ((clientConfig) => new Client(clientConfig));

  let client;
  try {
    client = createClient(config);
  } catch (error) {
    throw asSmokeError(error, 'configuration');
  }

  try {
    try {
      await client.connect();
    } catch (error) {
      throw asSmokeError(error, 'connect');
    }

    let identityResult;
    try {
      identityResult = await client.query(
        `SELECT current_user AS authenticated_user,
                connection.ssl AS tls_enabled,
                connection.version AS tls_version,
                connection.cipher AS tls_cipher
           FROM pg_stat_ssl AS connection
          WHERE connection.pid = pg_backend_pid()`,
      );
    } catch (error) {
      throw asSmokeError(error, 'identity');
    }
    const identity = identityResult.rows?.[0];
    if (!identity || identity.authenticated_user !== expectedUser) {
      throw new PostgresRoleTlsSmokeError('identity');
    }
    if (
      identity.tls_enabled !== true ||
      typeof identity.tls_version !== 'string' ||
      !identity.tls_version.trim() ||
      typeof identity.tls_cipher !== 'string' ||
      !identity.tls_cipher.trim()
    ) {
      throw new PostgresRoleTlsSmokeError('tls');
    }

    let allowResult;
    try {
      allowResult = await client.query(probe.allow.sql);
    } catch (error) {
      throw asSmokeError(error, 'allow-probe');
    }
    if (probe.allow.validate && !probe.allow.validate(allowResult.rows)) {
      throw new PostgresRoleTlsSmokeError('allow-probe');
    }

    try {
      await client.query(probe.deny.sql);
    } catch (error) {
      if (sqlState(error) !== PERMISSION_DENIED_SQLSTATE) {
        throw new PostgresRoleTlsSmokeError('deny-probe');
      }
      return {
        schemaVersion: 1,
        artifactType: ARTIFACT_TYPE,
        ok: true,
        role,
        checkedAt: now().toISOString(),
        identity: { matchesExpectedRole: true },
        tls: {
          enabled: true,
          version: identity.tls_version,
          cipher: identity.tls_cipher,
        },
        probes: {
          allow: { name: probe.allow.name, status: 'passed' },
          deny: {
            name: probe.deny.name,
            status: 'passed',
            expectedSqlState: PERMISSION_DENIED_SQLSTATE,
            observedSqlState: PERMISSION_DENIED_SQLSTATE,
          },
        },
      };
    }
    throw new PostgresRoleTlsSmokeError('deny-probe');
  } finally {
    if (client && typeof client.end === 'function') await client.end().catch(() => undefined);
  }
}

function postgresRoleTlsSmokeFailureReport(error, role, now = () => new Date()) {
  return {
    schemaVersion: 1,
    artifactType: ARTIFACT_TYPE,
    ok: false,
    role: Object.hasOwn(ROLE_PROBES, role || '') ? role : null,
    checkedAt: now().toISOString(),
    failure: {
      stage: error instanceof PostgresRoleTlsSmokeError ? error.stage : 'internal',
    },
  };
}

async function main() {
  let role = null;
  try {
    role = parseRoleArgument(process.argv.slice(2));
    const report = await runPostgresRoleTlsSmoke({ role });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(postgresRoleTlsSmokeFailureReport(error, role))}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ARTIFACT_TYPE,
  PERMISSION_DENIED_SQLSTATE,
  ROLE_PROBES,
  ROLE_TYPES,
  PostgresRoleTlsSmokeError,
  parseRoleArgument,
  postgresClientConfig,
  postgresRoleTlsSmokeFailureReport,
  runPostgresRoleTlsSmoke,
};

if (require.main === module) void main();
