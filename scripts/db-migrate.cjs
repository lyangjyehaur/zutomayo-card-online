/**
 * node-pg-migrate wrapper：從 PG_* 環境變數組合連線資訊，執行 migration。
 *
 * 用法：
 *   node scripts/db-migrate.cjs up        # 執行所有待跑 migration
 *   node scripts/db-migrate.cjs down      # 回退最後一個 migration
 *   node scripts/db-migrate.cjs create <name>  # 建立新 migration 檔案
 *
 * 環境變數（與 api/server.cjs 一致）：
 *   PG_HOST / PG_PORT / PG_USER / PG_PASSWORD / PG_DATABASE
 * 或直接設定 DATABASE_URL（優先使用）。
 */
'use strict';

const { resolve } = require('node:path');
const { Pool } = require('pg');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');
const { recordMigrationChecksums } = require('./migration-checksums.cjs');
const { listAppliedMigrationNames, migrationIgnorePatternForApplied } = require('./migration-order-compat.cjs');
const { enforceRuntimeRolePrivileges } = require('./postgres-role-gate.cjs');

async function main() {
  const [, , subCommand, ...rest] = process.argv;

  if (!['up', 'down', 'create'].includes(subCommand)) {
    console.error('Usage: node scripts/db-migrate.cjs <up|down|create> [name]');
    process.exit(1);
  }

  const migrationsDir = resolve(__dirname, '..', 'migrations');

  const { runner, Migration } = require('node-pg-migrate');

  if (subCommand === 'create') {
    const name = rest[0];
    if (!name) {
      console.error('Usage: node scripts/db-migrate.cjs create <name>');
      process.exit(1);
    }
    const filePath = await Migration.create(name, migrationsDir, { language: 'js' });
    console.log('Created migration:', filePath);
    return;
  }

  assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
  const connectionString = postgresConnectionString(process.env);
  const databaseConfig = {
    ...(connectionString
      ? { connectionString }
      : {
          host: process.env.PG_HOST || 'localhost',
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER || process.env.PG_MIGRATION_USER || 'postgres',
          password: process.env.PG_PASSWORD || '',
          database: process.env.PG_DATABASE || 'postgres',
        }),
    ssl: postgresSslConfig(process.env),
  };

  const direction = subCommand;

  const historyPool = new Pool(databaseConfig);
  let ignorePattern;
  try {
    const appliedNames = await listAppliedMigrationNames(historyPool);
    ignorePattern = migrationIgnorePatternForApplied(appliedNames);
  } finally {
    await historyPool.end();
  }
  if (ignorePattern) {
    console.log('Using canonical append-only card migrations 000028-000030');
  }

  await runner({
    databaseUrl: databaseConfig,
    dir: migrationsDir,
    direction,
    migrationsTable: 'schema_migrations',
    schema: 'public',
    ignorePattern,
    checkOrder: true,
    count: direction === 'down' ? 1 : Infinity,
    log: (msg) => console.log(msg),
  });
  const checksumPool = new Pool(databaseConfig);
  try {
    await recordMigrationChecksums(checksumPool, migrationsDir);
    if (process.env.REQUIRE_APP_ROLE_GATE === 'true') {
      const roleUsers = {
        api: process.env.PG_API_USER || process.env.PG_APP_USER,
        game: process.env.PG_GAME_USER || process.env.PG_APP_USER,
        platform: process.env.PG_PLATFORM_USER || process.env.PG_APP_USER,
        retention: process.env.PG_RETENTION_USER,
        monitor: process.env.PG_MONITOR_USER,
        backup: process.env.PG_BACKUP_USER,
        wal: process.env.PG_WAL_USER,
      };
      await enforceRuntimeRolePrivileges(checksumPool, {
        roleUsers,
        appUser: roleUsers.api,
        requireComplete: process.env.REQUIRE_ROLE_MATRIX_GATE !== 'false',
        requireDistinct: process.env.REQUIRE_DISTINCT_DB_ROLES === 'true',
      });
      console.log(`Runtime PostgreSQL role matrix gate passed for ${roleUsers.api}`);
    }
  } finally {
    await checksumPool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
