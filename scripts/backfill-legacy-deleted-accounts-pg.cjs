#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');
const { Pool } = require('pg');
const { backfillLegacyDeletedAccount } = require('../api/accountLifecycleService.cjs');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');

function expectedCount(value) {
  const canonical = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)$/.test(canonical)) return null;
  const count = Number(canonical);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function auditRef(userId) {
  return createHash('sha256').update(String(userId)).digest('hex').slice(0, 16);
}

async function pendingLegacyTombstones(pool) {
  const result = await pool.query(
    `SELECT id
      FROM users
      WHERE deleted_at IS NOT NULL
        AND identity_anonymized_at IS NULL
      ORDER BY id`,
  );
  return result.rows.map((row) => String(row.id));
}

async function runLegacyTombstoneBackfill({ pool, env = process.env, backfill = backfillLegacyDeletedAccount }) {
  const pending = await pendingLegacyTombstones(pool);
  if (pending.length === 0) return { reviewed: 0, backfilled: 0 };

  if (env.LEGACY_TOMBSTONE_BACKFILL_APPROVED !== 'true') {
    throw new Error(
      `Found ${pending.length} legacy deleted accounts; set LEGACY_TOMBSTONE_BACKFILL_APPROVED=true only after production-copy review`,
    );
  }
  const reviewedCount = expectedCount(env.LEGACY_TOMBSTONE_BACKFILL_EXPECTED_COUNT);
  if (reviewedCount === null || reviewedCount !== pending.length) {
    throw new Error(
      `Legacy tombstone count changed after review: expected ${env.LEGACY_TOMBSTONE_BACKFILL_EXPECTED_COUNT || 'unset'}, found ${pending.length}`,
    );
  }

  let backfilled = 0;
  for (const userId of pending) {
    let result;
    try {
      result = await backfill({ pool, userId });
    } catch (error) {
      throw new Error(`Legacy tombstone ${auditRef(userId)} backfill failed`, { cause: error });
    }
    if (!result?.ok) {
      throw new Error(`Legacy tombstone ${auditRef(userId)} was not backfilled`);
    }
    backfilled += 1;
  }

  const remaining = await pendingLegacyTombstones(pool);
  if (remaining.length > 0) {
    throw new Error(`Legacy tombstone backfill left ${remaining.length} accounts pending`);
  }
  return { reviewed: pending.length, backfilled };
}

function createPool() {
  const connectionString = postgresConnectionString(process.env);
  return new Pool({
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
    max: 2,
  });
}

async function main() {
  assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
  const pool = createPool();
  try {
    const result = await runLegacyTombstoneBackfill({ pool });
    console.log(`legacy tombstone backfill: ${result.backfilled}/${result.reviewed} reviewed accounts`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  auditRef,
  expectedCount,
  pendingLegacyTombstones,
  runLegacyTombstoneBackfill,
};
