#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { assertPlatformRuntimeSchema } = require('../api/schemaGate.cjs');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');

function createPool() {
  const connectionString = postgresConnectionString(process.env);
  return new Pool({
    ...(connectionString
      ? { connectionString }
      : {
          host: process.env.PG_HOST || 'localhost',
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER,
          password: process.env.PG_PASSWORD,
          database: process.env.PG_DATABASE,
        }),
    ssl: postgresSslConfig(process.env),
    max: 1,
  });
}

async function main() {
  assertPostgresExpectedRole(process.env, 'PG_PLATFORM_USER');
  const pool = createPool();
  try {
    await assertPlatformRuntimeSchema({
      pool,
      expectedMigration: process.env.EXPECTED_SCHEMA_MIGRATION,
      expectedChecksum: process.env.EXPECTED_SCHEMA_CHECKSUM,
    });
    console.log('Platform least-privilege runtime schema gate passed');
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

module.exports = { createPool, main };
