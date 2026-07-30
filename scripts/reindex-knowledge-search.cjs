#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const {
  createKnowledgeSearchService,
  createMeiliHttpClient,
  validateKnowledgeSearchConfig,
} = require('../api/knowledgeSearchService.cjs');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');

async function checkSearch(config) {
  if (!config.enabled) throw new Error('MEILI_HOST is required for search:check');
  const client = createMeiliHttpClient(config);
  const health = await client.request('/health');
  if (health.status !== 'available') throw new Error(`Meilisearch is not available: ${health.status || 'unknown'}`);
  const stats = await client.request(`/indexes/${encodeURIComponent(config.indexUid)}/stats`);
  if (!Number.isInteger(stats.numberOfDocuments) || stats.numberOfDocuments <= 0) {
    throw new Error(`Knowledge index ${config.indexUid} has no documents`);
  }
  console.log(
    JSON.stringify({ status: 'available', indexUid: config.indexUid, documentCount: stats.numberOfDocuments }),
  );
}

async function reindex(config) {
  if (!config.enabled) throw new Error('MEILI_HOST is required for search:reindex');
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
  });
  try {
    const service = createKnowledgeSearchService({ pool, env: process.env });
    const result = await service.reindex();
    console.log(JSON.stringify({ status: 'indexed', ...result }));
  } finally {
    await pool.end();
  }
}

async function main() {
  const config = validateKnowledgeSearchConfig(process.env);
  if (process.argv.includes('--check')) await checkSearch(config);
  else await reindex(config);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
