#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { runRetention } = require('../api/retentionService.cjs');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');

const dryRun = process.argv.includes('--dry-run') || process.env.RETENTION_DRY_RUN === 'true';
const retentionUser = assertPostgresExpectedRole(process.env, 'PG_RETENTION_USER');
const connectionString = postgresConnectionString(process.env);
if (process.env.NODE_ENV === 'production') {
  const appUser = String(process.env.PG_APP_USER || '').trim();
  if (appUser && retentionUser === appUser) throw new Error('retention worker must use a dedicated PostgreSQL role');
}
const poolConfig = connectionString
  ? { connectionString }
  : {
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT) || 5432,
      user: process.env.PG_USER || retentionUser,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE,
    };
poolConfig.ssl = postgresSslConfig(process.env);
const pool = new Pool({ ...poolConfig, max: 2 });

const metricsFile = process.env.RETENTION_METRICS_FILE?.trim() || '';
const lastSuccessMetric = 'retention_last_success_unixtime_seconds';

function previousLastSuccess() {
  try {
    const contents = fs.readFileSync(metricsFile, 'utf8');
    const match = contents.match(new RegExp(`^${lastSuccessMetric}\\s+([0-9]+(?:\\.[0-9]+)?)\\s*$`, 'm'));
    return match ? Math.max(0, Math.floor(Number(match[1]) || 0)) : 0;
  } catch {
    return 0;
  }
}

function writeMetrics({ success, skipped = false, result, error }) {
  if (!metricsFile) return;
  const directory = path.dirname(metricsFile);
  fs.mkdirSync(directory, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const lastSuccess = success ? now : previousLastSuccess();
  const lines = [
    '# HELP retention_last_run_success Whether the latest retention run succeeded.',
    '# TYPE retention_last_run_success gauge',
    `retention_last_run_success ${success ? 1 : 0}`,
    '# HELP retention_last_run_skipped Whether the latest retention run was skipped due to contention.',
    '# TYPE retention_last_run_skipped gauge',
    `retention_last_run_skipped ${skipped ? 1 : 0}`,
    '# HELP retention_last_success_unixtime_seconds Unix timestamp of the latest successful retention run.',
    '# TYPE retention_last_success_unixtime_seconds gauge',
    `${lastSuccessMetric} ${lastSuccess}`,
    '# HELP retention_last_run_duration_ms Duration of the latest retention run.',
    '# TYPE retention_last_run_duration_ms gauge',
    `retention_last_run_duration_ms ${Math.max(0, Number(result?.durationMs) || 0)}`,
    '# HELP retention_last_run_batches Number of mutation batches in the latest retention run.',
    '# TYPE retention_last_run_batches gauge',
    `retention_last_run_batches ${Math.max(0, Number(result?.batchCount) || 0)}`,
  ];
  for (const [name, count] of Object.entries(result?.counts || {})) {
    lines.push(`retention_rows_affected{kind="${name}"} ${Math.max(0, Number(count) || 0)}`);
  }
  if (error) lines.push(`# retention_last_error ${String(error.message || error).replace(/[\r\n#]/g, ' ')}`);
  const temporary = `${metricsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${lines.join('\n')}\n`, { mode: 0o644 });
  fs.renameSync(temporary, metricsFile);
  fs.chmodSync(metricsFile, 0o644);
}

runRetention({
  pool,
  dryRun,
  batchSize: Number(process.env.RETENTION_BATCH_SIZE) || 5000,
  maxRuntimeMs: Number(process.env.RETENTION_MAX_RUNTIME_MS) || undefined,
})
  .then((result) => {
    writeMetrics({ success: result.ok === true, skipped: result.skipped === true, result });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .catch((error) => {
    writeMetrics({ success: false, error });
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
