#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { assertRuntimeSchema } = require('../api/schemaGate.cjs');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');

const expectedMigration = String(process.env.EXPECTED_SCHEMA_MIGRATION || '').trim();
const expectedChecksum = String(process.env.EXPECTED_SCHEMA_CHECKSUM || '')
  .trim()
  .toLowerCase();
if (!/^\d{6,}_[a-z0-9_]+$/i.test(expectedMigration)) {
  console.error('EXPECTED_SCHEMA_MIGRATION is required and must be a migration basename');
  process.exit(2);
}
if (!/^[a-f0-9]{64}$/.test(expectedChecksum)) {
  console.error('EXPECTED_SCHEMA_CHECKSUM is required and must be a 64-character SHA-256 digest');
  process.exit(2);
}

async function main() {
  assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
  const connectionString = postgresConnectionString(process.env);
  const pool = new Pool({
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
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await assertRuntimeSchema({ pool, expectedMigration, expectedChecksum });
    console.log(`schema gate: ${expectedMigration} applied (${expectedChecksum})`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
