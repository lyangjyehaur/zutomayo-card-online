#!/usr/bin/env node
'use strict';

const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { Pool } = require('pg');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');
const { assertAppliedMigrationOrder, listAppliedMigrationNames } = require('./migration-order-compat.cjs');

const ROOT = resolve(__dirname, '..');
const MIGRATIONS_DIR = resolve(ROOT, 'migrations');
const LEGACY_CARD_MIGRATIONS = new Set([
  '000007_card_official_texts_i18n',
  '000008_card_official_errata',
  '000009_card_official_errata_english_source',
]);
const PRE_CARD_HARDENING = [
  '000019_replay_metadata',
  '000020_schema_checksums',
  '000021_season_result_consistency',
  '000022_retention_hardening',
  '000023_account_deletion_saga',
  '000024_relationship_change_outbox',
  '000025_card_official_english',
  '000026_account_export_jobs',
  '000027_account_deletion_anonymization',
];
const CANONICAL_CARD_MIGRATIONS = [
  '000028_card_official_texts_i18n',
  '000029_card_official_errata',
  '000030_card_official_errata_english_source',
];
const LEGACY_OFFICIAL_CARD_DATA_MIGRATION = '000031_official_card_data_releases';
const POST_CARD_MIGRATIONS = [
  '000031_user_linked_admins',
  '000032_announcements',
  '000032_official_card_data_releases',
  '000033_admin_linked_auth_contract',
  '000033_card_text_authority',
  '000034_card_text_rollback_compat',
];

function migrationFilePattern(names) {
  return `(?:${names.join('|')})\\.js`;
}

function databaseConfig() {
  const connectionString = postgresConnectionString(process.env);
  return {
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
}

async function runSetupMigrations(ignorePattern) {
  const { runner } = require('node-pg-migrate');
  await runner({
    databaseUrl: databaseConfig(),
    dir: MIGRATIONS_DIR,
    direction: 'up',
    migrationsTable: 'schema_migrations',
    schema: 'public',
    ignorePattern,
    checkOrder: true,
    count: Infinity,
    log: () => undefined,
  });
}

function runActualWrapper(label) {
  const result = spawnSync(process.execPath, ['scripts/db-migrate.cjs', 'up'], {
    cwd: ROOT,
    env: {
      ...process.env,
      REQUIRE_APP_ROLE_GATE: 'false',
      REQUIRE_DISTINCT_DB_ROLES: 'false',
      REQUIRE_ROLE_MATRIX_GATE: 'false',
    },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
  const evidence = String(result.stdout || '')
    .split('\n')
    .filter((line) => /lineage compatibility|metadata normalized|No migrations to run/.test(line));
  console.log(`${label}: ${evidence.join(' | ') || 'completed'}`);
}

async function main() {
  assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
  const pool = new Pool(databaseConfig());
  try {
    const existing = await pool.query("SELECT to_regclass('public.schema_migrations') AS name");
    if (existing.rows[0]?.name) {
      throw new Error('migration lineage smoke requires a fresh disposable database');
    }

    const preCardSetupIgnore = [
      ...LEGACY_CARD_MIGRATIONS,
      ...PRE_CARD_HARDENING,
      ...CANONICAL_CARD_MIGRATIONS,
      LEGACY_OFFICIAL_CARD_DATA_MIGRATION,
      ...POST_CARD_MIGRATIONS,
    ];
    await runSetupMigrations(migrationFilePattern(preCardSetupIgnore));

    // Historical initSchema created these fields before the corresponding
    // deferred migration files existed. Exercise adoption instead of only an
    // empty-schema happy path.
    await pool.query(`
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS rules_version TEXT NOT NULL DEFAULT 'legacy';
      ALTER TABLE bjg_match_result_outbox ADD COLUMN IF NOT EXISTS rules_version TEXT NOT NULL DEFAULT 'legacy';
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS en_name_official TEXT NOT NULL DEFAULT '';
      ALTER TABLE cards ADD COLUMN IF NOT EXISTS en_effect_official TEXT NOT NULL DEFAULT '';
    `);

    await runSetupMigrations(
      migrationFilePattern([
        ...LEGACY_CARD_MIGRATIONS,
        ...PRE_CARD_HARDENING,
        LEGACY_OFFICIAL_CARD_DATA_MIGRATION,
        ...POST_CARD_MIGRATIONS,
      ]),
    );
    const cardFirstHistory = await listAppliedMigrationNames(pool);
    for (const migration of CANONICAL_CARD_MIGRATIONS) {
      if (!cardFirstHistory.includes(migration)) throw new Error(`historical setup did not apply ${migration}`);
    }
    if (cardFirstHistory.some((name) => PRE_CARD_HARDENING.includes(name))) {
      throw new Error('historical setup unexpectedly applied deferred hardening migrations');
    }
    if (cardFirstHistory.some((name) => POST_CARD_MIGRATIONS.includes(name))) {
      throw new Error('historical setup unexpectedly applied post-card migrations');
    }

    runActualWrapper('card-first compatibility run');
    runActualWrapper('post-normalization strict-order run');

    const appliedNames = await listAppliedMigrationNames(pool);
    assertAppliedMigrationOrder(appliedNames);
    const expectedNames = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.js'))
      .map((name) => name.replace(/\.js$/, ''))
      .filter((name) => !LEGACY_CARD_MIGRATIONS.has(name) && name !== LEGACY_OFFICIAL_CARD_DATA_MIGRATION)
      .sort();
    if (JSON.stringify(appliedNames) !== JSON.stringify(expectedNames)) {
      throw new Error('normalized migration history does not match the canonical release file set');
    }

    const artifacts = await pool.query(`
      SELECT
        to_regclass('public.account_export_jobs') IS NOT NULL AS account_exports,
        to_regclass('public.relationship_change_outbox') IS NOT NULL AS relationship_outbox,
        to_regclass('public.official_card_data_releases') IS NOT NULL AS card_release_ledger,
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'rules_version'
        ) AS replay_rules_version
    `);
    if (Object.values(artifacts.rows[0] || {}).some((value) => value !== true)) {
      throw new Error(`lineage compatibility schema artifacts are incomplete: ${JSON.stringify(artifacts.rows[0])}`);
    }
    console.log(`migration lineage smoke: ${appliedNames.length} canonical migrations in strict order`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
