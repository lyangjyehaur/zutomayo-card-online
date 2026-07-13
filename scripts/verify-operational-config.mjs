import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`missing operational file: ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

function requireFragments(relativePath, fragments) {
  const contents = read(relativePath);
  for (const fragment of fragments) {
    if (!contents.includes(fragment)) throw new Error(`${relativePath} is missing operational contract: ${fragment}`);
  }
}

function assertExecutable(relativePath) {
  const mode = statSync(path.join(ROOT, relativePath)).mode;
  if ((mode & 0o111) === 0) throw new Error(`${relativePath} must be executable`);
}

export function validateOperationalConfig() {
  const backupScripts = [
    'scripts/pg-backup.sh',
    'scripts/pg-base-backup.sh',
    'scripts/pg-wal-archive.sh',
    'scripts/pg-wal-restore.sh',
    'scripts/pg-restore-drill.sh',
  ];
  for (const relativePath of backupScripts) assertExecutable(relativePath);
  requireFragments('scripts/pg-backup.sh', [
    'PG_BACKUP_OFFSITE_URI',
    'PG_BACKUP_AGE_RECIPIENT',
    'pg_restore --list',
    'pg_backup_last_success_unixtime_seconds',
  ]);
  requireFragments('scripts/pg-base-backup.sh', [
    'PG_BASE_BACKUP_OFFSITE_URI',
    'pg_basebackup',
    'pg_base_backup_last_success_unixtime_seconds',
  ]);
  requireFragments('scripts/pg-wal-archive.sh', ['PG_WAL_OFFSITE_URI', 'pg_wal_archive_last_success_unixtime_seconds']);
  requireFragments('scripts/pg-wal-restore.sh', ['sha256', 'age --decrypt']);
  requireFragments('scripts/pg-backup.sh', ['PG_BACKUP_USER', 'PG_BACKUP_PASSWORD']);
  requireFragments('scripts/pg-base-backup.sh', ['PG_WAL_USER', 'PG_WAL_PASSWORD']);
  requireFragments('scripts/pg-restore-drill.sh', [
    'PG_RESTORE_DRILL_IMAGE',
    '@sha256:',
    'pg_restore',
    'pg_restore_drill_success',
    'unvalidated_constraints',
    'invalid_outbox_status',
    'deletion_hold_violations',
    'deleted_social_violations',
  ]);

  for (const timer of ['ops/systemd/zutomayo-pg-backup.timer', 'ops/systemd/zutomayo-pg-base-backup.timer']) {
    requireFragments(timer, ['Persistent=true', 'OnCalendar=', 'Unit=']);
  }

  assertExecutable('scripts/synthetic-probe.mjs');
  requireFragments('scripts/synthetic-probe.mjs', [
    'SYNTHETIC_SESSION_COOKIE',
    'SYNTHETIC_EMAIL',
    'SYNTHETIC_PASSWORD',
    'SYNTHETIC_METRICS_FILE',
    'synthetic production probe requires',
    'zutomayo_synthetic_probe_success',
    '/games/zutomayo-card/create',
    '/games/zutomayo-card/${encodeURIComponent(matchId)}/leave',
  ]);
  requireFragments('ops/systemd/zutomayo-synthetic-probe.service', [
    'Environment=NODE_ENV=production',
    'Environment=SYNTHETIC_REQUIRED=true',
    'EnvironmentFile=/etc/zutomayo/synthetic.env',
    'ExecStart=/usr/bin/node /opt/zutomayo/scripts/synthetic-probe.mjs',
    'ReadWritePaths=/var/lib/node_exporter/textfile_collector',
  ]);
  requireFragments('ops/systemd/zutomayo-synthetic-probe.timer', [
    'OnUnitActiveSec=1min',
    'Persistent=true',
    'Unit=zutomayo-synthetic-probe.service',
  ]);
  requireFragments('package.json', ['"synthetic:probe"']);
  requireFragments('package.json', ['"relationship:outbox:redrive"']);
  requireFragments('package.json', ['"relationship:outbox:pg-smoke"']);
  requireFragments('scripts/redrive-relationship-outbox.cjs', [
    'assertPostgresExpectedRole',
    "'PG_API_USER'",
    'redriveRelationshipChange',
  ]);

  const monitoring = read('docker-compose.monitoring.yml');
  if (monitoring.includes('sslmode=disable')) {
    throw new Error('monitoring PostgreSQL exporter must not disable TLS by default');
  }
  requireFragments('docker-compose.monitoring.yml', [
    'PG_MONITOR_SSLMODE:?',
    'PG_MONITOR_DATABASE:?',
    'PGSSLROOTCERT=${PG_SSLROOTCERT:?',
    '--redis.addr=rediss://',
    '--tls-ca-cert-file=',
    '--skip-tls-verification=false',
    'METRICS_TOKEN:?',
    'backup-metrics-exporter:',
  ]);
  requireFragments('docker-compose.retention.yml', [
    'PGSSLMODE:',
    'PG_HOST: ${PG_RETENTION_HOST:?',
    'PG_RETENTION_DATABASE:?',
    'PG_CA_FILE:?',
    'PG_SSLROOTCERT:',
    'RETENTION_METRICS_FILE:',
  ]);
  requireFragments('scripts/run-retention.cjs', [
    "require('../api/runtimeSecurityConfig.cjs')",
    "assertPostgresExpectedRole(process.env, 'PG_RETENTION_USER')",
    'retention worker must use a dedicated PostgreSQL role',
    'poolConfig.ssl = postgresSslConfig(process.env)',
  ]);
  for (const migrationScript of ['scripts/db-migrate.cjs', 'scripts/db-schema-gate.cjs']) {
    requireFragments(migrationScript, [
      "require('../api/runtimeSecurityConfig.cjs')",
      "assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER')",
      'postgresConnectionString(process.env)',
      'postgresSslConfig(process.env)',
    ]);
  }
  for (const privilegedScript of [
    'scripts/create-admin.cjs',
    'scripts/seed-cards-pg.ts',
    'scripts/migrate-sqlite-to-pg.ts',
  ]) {
    requireFragments(privilegedScript, [
      "assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER')",
      'postgresConnectionString(process.env)',
      'postgresSslConfig(process.env)',
    ]);
  }
  requireFragments('docker-compose.pgbouncer.yml', [
    'pgbouncer-role-mode-gate:',
    'REQUIRE_DISTINCT_DB_ROLES',
    '"$$PG_API_USER" != "$$PG_GAME_USER"',
    '"$$PG_API_USER" != "$$PG_PLATFORM_USER"',
    'incompatible with distinct PostgreSQL runtime roles',
  ]);
  requireFragments('observability/prometheus/prometheus.yml', [
    "job_name: 'zutomayo-game'",
    "job_name: 'zutomayo-api'",
    "job_name: 'zutomayo-platform'",
    "job_name: 'zutomayo-readiness'",
    'bearer_token_file: /etc/prometheus/metrics_token',
  ]);
  requireFragments('observability/grafana/alerting/alerts.yml', [
    'PostgresBackupMissingOrStale',
    'PostgresWalArchiveMissingOrStale',
    'PostgresRestoreDrillFailed',
    'PostgresRestoreDrillMissingOrStale',
    'PostgresBaseBackupMissingOrStale',
    'RetentionJobMissingOrStale',
    'ReadinessProbeFailed',
    'SyntheticPlayerJourneyFailed',
    'SyntheticPlayerJourneyStale',
    'RelationshipChangeOutboxBacklog',
    'RelationshipChangeOutboxOldestRow',
    'RelationshipChangeOutboxDeadLetter',
    'RelationshipChangeOutboxMetricsStale',
  ]);
  requireFragments('observability/prometheus/alertmanager.yml', ['api_url_file: /etc/alertmanager/slack_webhook']);
  if (read('docker-compose.monitoring.yml').includes("content: '${SLACK_ALERT_WEBHOOK:-")) {
    throw new Error('Alertmanager must fail closed when the notification endpoint is missing');
  }

  requireFragments('scripts/chaos-recovery-probe.ts', ['CHAOS_PROBE_REQUIRE_OUTAGE', 'recovery_timeout']);
  requireFragments('scripts/compose-chaos-drill.sh', [
    'CHAOS_CONFIRM=local-compose-only',
    'refuses to run against production',
    'npm run chaos:probe',
  ]);
  requireFragments('load-tests/operational-soak.js', [
    'OBSERVED_PEAK_RPS must be the measured',
    'PEAK_MULTIPLIER || 2',
    'TARGET_URLS must be explicit representative workload URLs',
    'dropped_iterations',
  ]);
  requireFragments('load-tests/websocket-load.js', ['WS_TARGET_CONNECTIONS', 'ws_connecting', 'ws_connect_success']);
  requireFragments('load-tests/matchmaking-load.js', ['mm_matched']);
  requireFragments('load-tests/auth-load.js', ['auth_refresh_success']);
  for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/cd.yml']) {
    requireFragments(workflow, [
      'npm run ops:config',
      'docker-compose.yml -f docker-compose.retention.yml config --quiet',
      'PG_RETENTION_HOST:',
      'PG_RETENTION_USER:',
      'PG_RETENTION_PASSWORD:',
      'PG_RETENTION_SSLMODE:',
    ]);
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    validateOperationalConfig();
    console.log('operational config: valid');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
