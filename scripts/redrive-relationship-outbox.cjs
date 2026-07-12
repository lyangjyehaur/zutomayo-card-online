#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { redriveRelationshipChange } = require('../api/relationshipOutbox.cjs');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');

async function main() {
  const eventId = String(process.argv[2] || '').trim();
  if (!/^[A-Za-z0-9-]{16,128}$/.test(eventId)) {
    throw new Error('Usage: node scripts/redrive-relationship-outbox.cjs <event-id>');
  }
  const apiUser = assertPostgresExpectedRole(process.env, 'PG_API_USER');
  const connectionString = postgresConnectionString(process.env);
  const pool = new Pool({
    ...(connectionString
      ? { connectionString }
      : {
          host: process.env.PG_HOST || 'localhost',
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER || apiUser || 'postgres',
          password: process.env.PG_PASSWORD || '',
          database: process.env.PG_DATABASE || 'postgres',
        }),
    ssl: postgresSslConfig(process.env),
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const redriven = await redriveRelationshipChange(pool, eventId);
    if (!redriven) throw new Error('Relationship outbox event is not in dead_letter state');
    process.stdout.write(`${JSON.stringify({ ok: true, eventId, status: 'pending' })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
