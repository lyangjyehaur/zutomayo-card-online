#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { assertRuntimeSchema } = require('../api/schemaGate.cjs');

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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DATABASE_URL ? undefined : process.env.PG_HOST || 'localhost',
  port: process.env.DATABASE_URL ? undefined : Number(process.env.PG_PORT) || 5432,
  user: process.env.DATABASE_URL ? undefined : process.env.PG_USER || 'postgres',
  password: process.env.DATABASE_URL ? undefined : process.env.PG_PASSWORD || '',
  database: process.env.DATABASE_URL ? undefined : process.env.PG_DATABASE || 'postgres',
  max: 1,
  connectionTimeoutMillis: 5_000,
});

async function main() {
  await assertRuntimeSchema({ pool, expectedMigration, expectedChecksum });
  console.log(`schema gate: ${expectedMigration} applied (${expectedChecksum})`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
