import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, existsSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER4_CANARY_POLICY } from './collect-server4-canary-metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_EVIDENCE_DIR = path.join(ROOT, '.release-evidence');
const DEFAULT_MAX_EVIDENCE_AGE_HOURS = 168;
const MAX_OUTPUT_LENGTH = 12_000;
const STATUS_ORDER = Object.freeze({ passed: 0, blocked: 1, failed: 2 });
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const RUN_ID_PATTERN = /^\d+$/;
const IMAGE_DIGEST_PATTERN = /^\S+@sha256:[a-f0-9]{64}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MIGRATION_BASENAME_PATTERN = /^\d{6,}_[a-z0-9_]+$/;
const REQUIRED_IMAGE_DIGESTS = Object.freeze(['game', 'api', 'platform', 'migrate', 'retention', 'gateway', 'ops']);
const CANARY_RUNTIME_SERVICES = Object.freeze(['game', 'api', 'platform']);
const CANARY_GATEWAY_ARTIFACT_TYPE = 'zutomayo-canary-gateway-config';
const CANARY_RAW_METRICS_ARTIFACT_TYPE = 'zutomayo-canary-raw-metrics';
const CANARY_POLICY = SERVER4_CANARY_POLICY;
const OPERATIONAL_EVIDENCE_POLICIES = Object.freeze({
  'restore-drill': Object.freeze({
    rawArtifactType: 'zutomayo-restore-drill-raw',
    offsiteArtifactType: 'zutomayo-encrypted-offsite-restore-raw',
    thresholds: Object.freeze({ maxRpoMinutes: 15, maxRtoMinutes: 30 }),
  }),
  'chaos-reconnect': Object.freeze({
    rawArtifactType: 'zutomayo-chaos-reconnect-raw',
    thresholds: Object.freeze({ maxRecoverySeconds: 300, maxDuplicateDeliveries: 0 }),
    requiredHealthySamples: 3,
  }),
  'load-soak': Object.freeze({
    rawArtifactType: 'zutomayo-load-soak-raw',
    thresholds: Object.freeze({
      minPeakMultiplier: 2,
      minDurationMinutes: 120,
      maxP95LatencyMs: 500,
      maxErrorRate: 0.01,
    }),
    minPeakDurationMinutes: 30,
    minSoakDurationMinutes: 120,
  }),
  'alertmanager-delivery': Object.freeze({
    rawArtifactType: 'zutomayo-alertmanager-delivery-raw',
    thresholds: Object.freeze({ maxFiringDeliverySeconds: 300, maxResolvedDeliverySeconds: 300 }),
  }),
});

const COMPOSE_FILES = Object.freeze([
  {
    id: 'compose-base-e2e',
    title: 'Compose base + E2E configuration',
    args: ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.e2e.yml', 'config', '--quiet'],
  },
  {
    id: 'compose-retention',
    title: 'Compose retention configuration',
    args: ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.retention.yml', 'config', '--quiet'],
  },
  {
    id: 'compose-pgbouncer',
    title: 'Compose PgBouncer overlay configuration',
    args: ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.pgbouncer.yml', 'config', '--quiet'],
  },
  {
    id: 'compose-load-test',
    title: 'Compose load-test overlay configuration',
    args: ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.load-test.yml', 'config', '--quiet'],
  },
  {
    id: 'compose-staging',
    title: 'Compose staging configuration',
    args: ['compose', '-f', 'docker-compose.staging.yml', 'config', '--no-env-resolution', '--quiet'],
  },
  {
    id: 'compose-server4',
    title: 'Compose production/server4 configuration',
    args: ['compose', '-f', 'docker-compose.server4.yml', 'config', '--no-env-resolution', '--quiet'],
  },
  {
    id: 'compose-server4-slot',
    title: 'Compose production/server4 parallel slot configuration',
    args: ['compose', '-f', 'docker-compose.server4-slot.yml', 'config', '--no-env-resolution', '--quiet'],
  },
  {
    id: 'compose-server4-gateway',
    title: 'Compose production/server4 release gateway configuration',
    args: ['compose', '-f', 'docker-compose.server4-gateway.yml', 'config', '--no-env-resolution', '--quiet'],
  },
  {
    id: 'compose-postgres-role-tls-smoke',
    title: 'Compose PostgreSQL role/TLS smoke configuration',
    args: ['compose', '-f', 'docker-compose.postgres-role-smoke.yml', 'config', '--no-interpolate', '--quiet'],
  },
  {
    id: 'compose-postgres-ops',
    title: 'Compose PostgreSQL operations runner configuration',
    args: ['compose', '-f', 'docker-compose.postgres-ops.yml', '--profile', 'postgres-ops', 'config', '--quiet'],
  },
  {
    id: 'compose-monitoring',
    title: 'Compose monitoring configuration',
    args: ['compose', '-f', 'docker-compose.monitoring.yml', 'config', '--quiet'],
  },
]);

const STAGING_GATES = Object.freeze([
  {
    id: 'staging-authenticated-e2e',
    phase: 'P4',
    title: 'Authenticated dual-browser game journey',
    evidenceType: 'authenticated-e2e',
    measurements: {
      comparisons: [
        ['completedJourneys', 'minCompletedJourneys', 'gte'],
        ['failedSteps', 'maxFailedSteps', 'lte'],
      ],
      results: ['authenticatedJourneyPassed', 'historyVerified'],
    },
    relativePath: 'staging/authenticated-e2e.json',
  },
  {
    id: 'staging-restore',
    phase: 'P2',
    title: 'Encrypted backup restore and PITR drill',
    evidenceType: 'restore-drill',
    measurements: {
      comparisons: [
        ['rpoMinutes', 'maxRpoMinutes', 'lte'],
        ['rtoMinutes', 'maxRtoMinutes', 'lte'],
      ],
      results: ['schemaGatePassed', 'fixtureRoundTripPassed', 'legalHoldInvariantPassed'],
    },
    relativePath: 'staging/restore-drill.json',
  },
  {
    id: 'staging-chaos',
    phase: 'P2',
    title: 'PostgreSQL/Redis failover, reconnect, and outbox recovery',
    evidenceType: 'chaos-reconnect',
    measurements: {
      comparisons: [
        ['recoverySeconds', 'maxRecoverySeconds', 'lte'],
        ['duplicateDeliveries', 'maxDuplicateDeliveries', 'lte'],
      ],
      results: ['postgresRecovered', 'redisRecovered', 'websocketReconnected', 'outboxRecovered'],
    },
    relativePath: 'staging/chaos-reconnect.json',
  },
  {
    id: 'staging-load-soak',
    phase: 'P2',
    title: '2x peak load and soak against SLOs',
    evidenceType: 'load-soak',
    measurements: {
      comparisons: [
        ['peakMultiplier', 'minPeakMultiplier', 'gte'],
        ['durationMinutes', 'minDurationMinutes', 'gte'],
        ['p95LatencyMs', 'maxP95LatencyMs', 'lte'],
        ['errorRate', 'maxErrorRate', 'lte'],
      ],
      results: ['sloPassed'],
    },
    relativePath: 'staging/load-soak.json',
  },
  {
    id: 'staging-alerts',
    phase: 'P3',
    title: 'Alertmanager firing, resolved, and delivery evidence',
    evidenceType: 'alertmanager-delivery',
    measurements: {
      comparisons: [
        ['firingDeliverySeconds', 'maxFiringDeliverySeconds', 'lte'],
        ['resolvedDeliverySeconds', 'maxResolvedDeliverySeconds', 'lte'],
      ],
      results: ['firingDelivered', 'resolvedDelivered'],
    },
    relativePath: 'staging/alertmanager-delivery.json',
  },
  {
    id: 'staging-canary',
    phase: 'P2',
    title: '10% -> 50% -> 100% canary and rollback',
    evidenceType: 'canary-rollback',
    measurements: {
      comparisons: [
        ['rollbackSeconds', 'maxRollbackSeconds', 'lte'],
        ['rollbackObservationDelaySeconds', 'maxRollbackObservationDelaySeconds', 'lte'],
        ['rollbackObservationSeconds', 'maxRollbackObservationSeconds', 'lte'],
        ['stagesCompleted', 'requiredStages', 'gte'],
      ],
      results: ['tenPercentPassed', 'fiftyPercentPassed', 'fullPassed', 'rollbackPassed'],
    },
    relativePath: 'staging/canary-rollback.json',
  },
  {
    id: 'staging-provider-account',
    phase: 'P5',
    title: 'Email/Logto account lifecycle and recovery',
    evidenceType: 'account-provider-e2e',
    measurements: {
      comparisons: [
        ['journeysCompleted', 'minJourneysCompleted', 'gte'],
        ['failedSteps', 'maxFailedSteps', 'lte'],
      ],
      results: ['emailPassed', 'logtoPassed', 'deletionPassed', 'recoveryPassed'],
    },
    relativePath: 'staging/account-provider-e2e.json',
  },
]);

function nowIso() {
  return new Date().toISOString();
}

function truncate(value) {
  const text = String(value ?? '').trim();
  if (text.length <= MAX_OUTPUT_LENGTH) return text;
  return `${text.slice(0, MAX_OUTPUT_LENGTH)}\n...[truncated]`;
}

function redact(value) {
  return truncate(value)
    .replace(/(password|secret|token|authorization|api[-_]?key)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/(rediss?:\/\/[^\s:@]+:)[^@\s]+@/gi, '$1[redacted]@');
}

function readReleaseMigration() {
  const migrationNames = readdirSync(path.join(ROOT, 'migrations'))
    .filter((name) => /^\d+_.+\.js$/.test(name))
    .sort();
  const latest = migrationNames.at(-1);
  if (!latest) throw new Error('no release migration found in migrations/');
  const contents = readFileSync(path.join(ROOT, 'migrations', latest));
  return {
    name: latest.replace(/\.js$/, ''),
    checksum: createHash('sha256').update(contents).digest('hex'),
  };
}

function composeFixtureEnv() {
  const migration = readReleaseMigration();
  const rolePasswords = {
    PG_MIGRATION_PASSWORD: 'release-gate-migration-password',
    PG_APP_PASSWORD: 'release-gate-app-password',
    PG_API_PASSWORD: 'release-gate-api-password',
    PG_GAME_PASSWORD: 'release-gate-game-password',
    PG_PLATFORM_PASSWORD: 'release-gate-platform-password',
    PG_RETENTION_PASSWORD: 'release-gate-retention-password',
    PG_MONITOR_PASSWORD: 'release-gate-monitor-password',
    PG_BACKUP_PASSWORD: 'release-gate-backup-password',
    PG_WAL_PASSWORD: 'release-gate-wal-password',
    PG_WAL_OPERATOR_PASSWORD: 'release-gate-wal-operator-password',
  };
  return {
    ...rolePasswords,
    PG_PASSWORD: rolePasswords.PG_MIGRATION_PASSWORD,
    PG_MIGRATION_USER: 'zutomayo_migrator',
    PG_APP_USER: 'zutomayo_app',
    PG_API_USER: 'zutomayo_api',
    PG_GAME_USER: 'zutomayo_game',
    PG_PLATFORM_USER: 'zutomayo_platform',
    PG_RETENTION_USER: 'zutomayo_retention',
    PG_MONITOR_USER: 'zutomayo_monitor',
    PG_BACKUP_USER: 'zutomayo_backup',
    PG_WAL_USER: 'zutomayo_wal',
    PG_WAL_OPERATOR_USER: 'zutomayo_wal_operator',
    PG_WAL_OPERATOR_DATABASE: 'zutomayo',
    PG_WAL_OPERATOR_PGPASS_FILE: '/tmp/postgres-operator.pgpass',
    PG_WAL_AGE_IDENTITY_FILE: '/tmp/wal-age-identity',
    PG_WAL_S3_CREDENTIALS_FILE: '/tmp/wal-s3-credentials',
    PG_WAL_OFFSITE_URI: 's3://zutomayo-release-gate-wal',
    PG_WAL_S3_REGION: 'us-east-1',
    POSTGRES_OPS_SECRETS_GID: '992',
    PG_HOST: 'staging-postgres.example.internal',
    PG_DATABASE: 'zutomayo',
    PG_CA_FILE: '/run/secrets/postgres_ca',
    PG_SSLROOTCERT: '/run/secrets/postgres_ca',
    NODE_EXTRA_CA_CERTS: '/run/secrets/postgres_ca',
    PG_CA_SECRET_NAME: 'zutomayo-staging-postgres-ca',
    PGSSLMODE: 'verify-full',
    PG_MONITOR_HOST: 'postgres',
    PG_MONITOR_DATABASE: 'zutomayo',
    PG_MONITOR_SSLMODE: 'verify-full',
    PG_RETENTION_HOST: 'postgres',
    PG_RETENTION_DATABASE: 'zutomayo',
    PG_RETENTION_SSLMODE: 'verify-full',
    REDIS_URL: 'rediss://:release-gate-redis-password@staging-redis.example.internal:6380',
    REDIS_PASSWORD: 'release-gate-redis-password',
    JWT_SECRET: 'release-gate-jwt-secret-32chars-minimum',
    PLATFORM_SEAT_TOKEN_SECRET: 'release-gate-seat-token-secret-32chars-minimum',
    PLATFORM_PUBLIC_ADDRESS: 'wss://platform.example.invalid/colyseus/release-gate-1',
    ADMIN_TOTP_ENCRYPTION_KEY: 'release-gate-admin-totp-key-32chars-minimum',
    OAUTH_TOKEN_ENCRYPTION_KEY: 'release-gate-oauth-token-key-32chars-minimum',
    ACCOUNT_EXPORT_S3_BUCKET: 'zutomayo-release-gate-account-exports',
    ACCOUNT_EXPORT_S3_REGION: 'us-east-1',
    ACCOUNT_EXPORT_S3_CREDENTIALS_MODE: 'default',
    ACCOUNT_EXPORT_S3_VERSIONING_MODE: 'disabled',
    ACCOUNT_EXPORT_S3_LIFECYCLE_CONFIRMED: 'true',
    ACCOUNT_EXPORT_PSEUDONYM_KEY: 'release-gate-export-pseudonym-key-32chars-minimum',
    OAUTH_PUBLIC_BASE_URL: 'https://game.example.invalid',
    METRICS_TOKEN: 'release-gate-metrics-token',
    SLACK_ALERT_WEBHOOK: 'https://hooks.example.invalid/services/release-gate',
    GRAFANA_PASSWORD: 'release-gate-grafana-password',
    EXPECTED_SCHEMA_MIGRATION: migration.name,
    EXPECTED_SCHEMA_CHECKSUM: migration.checksum,
    APP_VERSION: '0.2.0',
    RELEASE_SHA: 'a'.repeat(40),
    GAME_RULES_VERSION: 'release-gate-rules',
    GAME_IMAGE: 'ghcr.io/example/game@sha256:' + '0'.repeat(64),
    API_IMAGE: 'ghcr.io/example/api@sha256:' + '0'.repeat(64),
    PLATFORM_IMAGE: 'ghcr.io/example/platform@sha256:' + '0'.repeat(64),
    MIGRATE_IMAGE: 'ghcr.io/example/migrate@sha256:' + '0'.repeat(64),
    RETENTION_IMAGE: 'ghcr.io/example/retention@sha256:' + '0'.repeat(64),
    GATEWAY_IMAGE: 'ghcr.io/example/gateway@sha256:' + '0'.repeat(64),
    OPS_IMAGE: 'ghcr.io/example/ops@sha256:' + '0'.repeat(64),
    COLYSEUS_REDIS_IMAGE: 'redis@sha256:' + '0'.repeat(64),
    COLYSEUS_REDIS_PASSWORD: 'release-gate-colyseus-redis-password',
    FEEDBACK_UPLOADS_VOLUME: 'zutomayo-release-gate-feedback-uploads',
    PUBLIC_HOST: 'game.example.invalid',
    RELEASE_SLOT: 'blue',
    COMPOSE_PROJECT_NAME: 'zutomayo-blue',
    RETENTION_METRICS_GID: '991',
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    stagingEvidenceDir: undefined,
    releaseSha: undefined,
    releaseManifest: undefined,
    evidenceRunId: undefined,
    maxEvidenceAgeHours: DEFAULT_MAX_EVIDENCE_AGE_HOURS,
    format: 'both',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { ...options, help: true };
    if (
      argument === '--evidence-dir' ||
      argument === '--staging-evidence-dir' ||
      argument === '--release-sha' ||
      argument === '--release-manifest' ||
      argument === '--evidence-run-id' ||
      argument === '--max-evidence-age-hours' ||
      argument === '--format'
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--evidence-dir') options.evidenceDir = path.resolve(process.cwd(), value);
      else if (argument === '--staging-evidence-dir') options.stagingEvidenceDir = path.resolve(process.cwd(), value);
      else if (argument === '--release-sha') {
        if (!RELEASE_SHA_PATTERN.test(value)) throw new Error('--release-sha must be a full 40-character commit SHA');
        options.releaseSha = value.toLowerCase();
      } else if (argument === '--release-manifest') options.releaseManifest = path.resolve(process.cwd(), value);
      else if (argument === '--evidence-run-id') {
        if (!RUN_ID_PATTERN.test(value)) throw new Error('--evidence-run-id must be a numeric GitHub Actions run ID');
        options.evidenceRunId = value;
      } else if (argument === '--max-evidence-age-hours') {
        const hours = Number(value);
        if (!Number.isFinite(hours) || hours <= 0) {
          throw new Error('--max-evidence-age-hours must be a positive number');
        }
        options.maxEvidenceAgeHours = hours;
      } else if (!['json', 'markdown', 'both'].includes(value))
        throw new Error('--format must be json, markdown, or both');
      else options.format = value;
      continue;
    }
    throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

function commandLabel(command, args) {
  return [command, ...args].join(' ');
}

function classifySpawnFailure(error, stderr, stdout) {
  if (error?.code === 'ENOENT') return { status: 'blocked', reason: 'required local executable is unavailable' };
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  if (
    combined.includes('cannot connect to the docker daemon') ||
    combined.includes('is the docker daemon running') ||
    combined.includes('permission denied while trying to connect to the docker daemon')
  ) {
    return { status: 'blocked', reason: 'Docker daemon is unavailable for this local gate' };
  }
  if (combined.includes('listen eperm') && combined.includes('tsx') && combined.includes('.pipe')) {
    return { status: 'blocked', reason: 'local sandbox prevents the tsx verifier from creating its IPC socket' };
  }
  return undefined;
}

function runCommand(command, args, env = process.env) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const stdout = redact(result.stdout ?? '');
  const stderr = redact(result.stderr ?? '');
  const spawnClassification = classifySpawnFailure(result.error, stderr, stdout);
  const status = spawnClassification?.status ?? (result.status === 0 ? 'passed' : 'failed');
  return {
    status,
    reason:
      spawnClassification?.reason ??
      (status === 'passed'
        ? 'command completed successfully'
        : `command exited with status ${result.status ?? 'unknown'}`),
    command: commandLabel(command, args),
    exitCode: result.status,
    signal: result.signal,
    stdout,
    stderr,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: nowIso(),
    durationMs: Date.now() - startedAt,
  };
}

function runPipeline(commands, env) {
  const startedAt = Date.now();
  const first = spawnSync(commands[0].command, commands[0].args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const firstStdout = redact(first.stdout ?? '');
  const firstStderr = redact(first.stderr ?? '');
  const firstFailure = classifySpawnFailure(first.error, firstStderr, firstStdout);
  if (firstFailure || first.status !== 0) {
    return {
      status: firstFailure?.status ?? 'failed',
      reason: firstFailure?.reason ?? `command exited with status ${first.status ?? 'unknown'}`,
      command: commands.map(({ command, args }) => commandLabel(command, args)).join(' | '),
      exitCode: first.status,
      stdout: firstStdout,
      stderr: firstStderr,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: nowIso(),
      durationMs: Date.now() - startedAt,
    };
  }
  const second = spawnSync(commands[1].command, commands[1].args, {
    cwd: ROOT,
    env,
    input: first.stdout,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const stdout = redact(`${first.stdout ?? ''}${second.stdout ?? ''}`);
  const stderr = redact(`${first.stderr ?? ''}${second.stderr ?? ''}`);
  const secondFailure = classifySpawnFailure(second.error, stderr, stdout);
  return {
    status: secondFailure?.status ?? (second.status === 0 ? 'passed' : 'failed'),
    reason:
      secondFailure?.reason ??
      (second.status === 0
        ? 'pipeline completed successfully'
        : `command exited with status ${second.status ?? 'unknown'}`),
    command: commands.map(({ command, args }) => commandLabel(command, args)).join(' | '),
    exitCode: second.status,
    signal: second.signal,
    stdout,
    stderr,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: nowIso(),
    durationMs: Date.now() - startedAt,
  };
}

function withCheckMetadata(id, category, title, result, extra = {}) {
  return { id, category, title, required: true, ...result, ...extra };
}

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isoTimestamp(value) {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) return undefined;
  return timestamp;
}

function validateArtifacts(evidence, stagingEvidenceDir, missing) {
  const verifiedArtifacts = new Map();
  if (!Array.isArray(evidence?.artifacts) || evidence.artifacts.length === 0) {
    missing.push('artifacts[] with at least one path + sha256 entry');
    return verifiedArtifacts;
  }
  for (const [index, artifact] of evidence.artifacts.entries()) {
    const artifactPath = artifact?.path;
    const artifactHash = artifact?.sha256;
    if (typeof artifactPath !== 'string' || artifactPath.trim() === '') {
      missing.push(`artifacts[${index}].path`);
      continue;
    }
    if (!SHA256_PATTERN.test(artifactHash ?? '')) {
      missing.push(`artifacts[${index}].sha256`);
      continue;
    }
    try {
      const evidenceRoot = realpathSync(stagingEvidenceDir);
      const absolutePath = path.resolve(evidenceRoot, artifactPath);
      if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
        missing.push(`artifacts[${index}] existing file: ${artifactPath}`);
        continue;
      }
      const realArtifactPath = realpathSync(absolutePath);
      const relativePath = path.relative(evidenceRoot, realArtifactPath);
      if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        missing.push(`artifacts[${index}].path contained within the evidence directory`);
        continue;
      }
      const contents = readFileSync(realArtifactPath);
      const actualHash = createHash('sha256').update(contents).digest('hex');
      if (actualHash !== artifactHash.toLowerCase()) {
        missing.push(`artifacts[${index}].sha256 matching file contents`);
        continue;
      }
      verifiedArtifacts.set(`${artifactPath}\0${actualHash}`, { contents });
    } catch {
      missing.push(`artifacts[${index}] readable file: ${artifactPath}`);
    }
  }
  return verifiedArtifacts;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateArtifactReference(evidence, reference, label, missing, verifiedArtifacts) {
  if (!isPlainObject(reference)) {
    missing.push(`${label} artifact reference`);
    return undefined;
  }
  if (typeof reference.path !== 'string' || reference.path.trim() === '') {
    missing.push(`${label}.path`);
  }
  if (!SHA256_PATTERN.test(reference.sha256 ?? '')) {
    missing.push(`${label}.sha256`);
  }
  if (
    typeof reference.path !== 'string' ||
    !SHA256_PATTERN.test(reference.sha256 ?? '') ||
    !Array.isArray(evidence?.artifacts)
  ) {
    return undefined;
  }
  const matchesVerifiedArtifact = evidence.artifacts.some(
    (artifact) =>
      artifact?.path === reference.path &&
      typeof artifact.sha256 === 'string' &&
      artifact.sha256.toLowerCase() === reference.sha256.toLowerCase(),
  );
  if (!matchesVerifiedArtifact) {
    missing.push(`${label} matching artifacts[]`);
    return undefined;
  }
  const verifiedArtifact = verifiedArtifacts.get(`${reference.path}\0${reference.sha256.toLowerCase()}`);
  if (!verifiedArtifact) {
    missing.push(`${label} referencing a hash-verified artifact`);
    return undefined;
  }
  return verifiedArtifact;
}

function imageRepository(imageDigest) {
  return typeof imageDigest === 'string' ? imageDigest.slice(0, imageDigest.toLowerCase().lastIndexOf('@sha256:')) : '';
}

function validateReleaseSet(releaseSet, label, missing) {
  if (!isPlainObject(releaseSet)) {
    missing.push(`${label} object`);
    return;
  }
  for (const service of CANARY_RUNTIME_SERVICES) {
    if (!IMAGE_DIGEST_PATTERN.test(releaseSet[service] ?? '')) {
      missing.push(`${label}.${service} (complete @sha256 reference)`);
    }
  }
  for (const [service, imageDigest] of Object.entries(releaseSet)) {
    if (!IMAGE_DIGEST_PATTERN.test(imageDigest ?? '')) {
      missing.push(`${label}.${service} (complete @sha256 reference)`);
    }
  }
}

function validateReleaseSetMatch(actual, expected, label, missing) {
  if (!isPlainObject(actual)) {
    missing.push(`${label} object`);
    return;
  }
  for (const service of CANARY_RUNTIME_SERVICES) {
    if (
      typeof actual[service] !== 'string' ||
      typeof expected?.[service] !== 'string' ||
      actual[service].toLowerCase() !== expected[service].toLowerCase()
    ) {
      missing.push(`${label}.${service} matching the declared release set`);
    }
  }
}

function parseStableReleaseManifest(verifiedArtifact, label, missing) {
  const lines = verifiedArtifact.contents.toString('utf8').split(/\r?\n/);
  const values = {};
  for (const key of ['RELEASE_SHA', 'GAME_IMAGE', 'API_IMAGE', 'PLATFORM_IMAGE']) {
    const matches = lines.filter((line) => line.startsWith(`${key}=`));
    if (matches.length !== 1 || !matches[0].match(new RegExp(`^${key}=\\S+$`))) {
      missing.push(`${label} containing exactly one unquoted ${key}= value`);
      continue;
    }
    values[key] = matches[0].slice(key.length + 1);
  }
  return values;
}

function validateStableReleaseManifest(evidence, rollout, stableReleaseSet, missing, verifiedArtifacts) {
  if (!RELEASE_SHA_PATTERN.test(rollout.stableReleaseSha ?? '')) {
    missing.push('rollout.stableReleaseSha (full 40-character SHA)');
  } else if (
    RELEASE_SHA_PATTERN.test(evidence?.releaseSha ?? '') &&
    rollout.stableReleaseSha.toLowerCase() === evidence.releaseSha.toLowerCase()
  ) {
    missing.push('rollout.stableReleaseSha different from candidate releaseSha');
  }
  const stableManifestArtifact = validateArtifactReference(
    evidence,
    rollout.stableManifestArtifact,
    'rollout.stableManifestArtifact',
    missing,
    verifiedArtifacts,
  );
  if (!stableManifestArtifact) return;
  const manifest = parseStableReleaseManifest(stableManifestArtifact, 'rollout.stableManifestArtifact', missing);
  if (
    RELEASE_SHA_PATTERN.test(manifest.RELEASE_SHA ?? '') &&
    RELEASE_SHA_PATTERN.test(rollout.stableReleaseSha ?? '') &&
    manifest.RELEASE_SHA.toLowerCase() !== rollout.stableReleaseSha.toLowerCase()
  ) {
    missing.push('rollout.stableManifestArtifact RELEASE_SHA matching rollout.stableReleaseSha');
  }
  const manifestKeys = { game: 'GAME_IMAGE', api: 'API_IMAGE', platform: 'PLATFORM_IMAGE' };
  for (const service of CANARY_RUNTIME_SERVICES) {
    const manifestImage = manifest[manifestKeys[service]];
    if (!IMAGE_DIGEST_PATTERN.test(manifestImage ?? '')) {
      missing.push(`rollout.stableManifestArtifact ${manifestKeys[service]} immutable digest`);
    } else if (
      typeof stableReleaseSet?.[service] !== 'string' ||
      manifestImage.toLowerCase() !== stableReleaseSet[service].toLowerCase()
    ) {
      missing.push(`rollout.stableManifestArtifact ${manifestKeys[service]} matching stableReleaseSet.${service}`);
    }
  }
}

function validateGatewayConfig(config, expectations, label, missing) {
  if (!isPlainObject(config)) {
    missing.push(`${label} JSON object`);
    return;
  }
  if (config.schemaVersion !== 1) missing.push(`${label}.schemaVersion exactly 1`);
  if (config.artifactType !== CANARY_GATEWAY_ARTIFACT_TYPE) {
    missing.push(`${label}.artifactType exactly "${CANARY_GATEWAY_ARTIFACT_TYPE}"`);
  }
  if (config.phase !== expectations.phase) missing.push(`${label}.phase exactly "${expectations.phase}"`);
  if (config.sequence !== expectations.sequence) {
    missing.push(`${label}.sequence exactly ${expectations.sequence}`);
  }
  const expectedActiveReleaseSet =
    expectations.candidateWeightPercent === 0
      ? 'stable'
      : expectations.candidateWeightPercent === 100
        ? 'candidate'
        : 'mixed';
  if (config.activeReleaseSet !== expectedActiveReleaseSet) {
    missing.push(`${label}.activeReleaseSet exactly "${expectedActiveReleaseSet}"`);
  }
  const traffic = config.traffic;
  if (!isPlainObject(traffic)) {
    missing.push(`${label}.traffic object`);
  } else {
    if (traffic.stableWeightPercent !== expectations.stableWeightPercent) {
      missing.push(`${label}.traffic.stableWeightPercent exactly ${expectations.stableWeightPercent}`);
    }
    if (traffic.candidateWeightPercent !== expectations.candidateWeightPercent) {
      missing.push(`${label}.traffic.candidateWeightPercent exactly ${expectations.candidateWeightPercent}`);
    }
  }
  if (!isPlainObject(config.releaseSets)) {
    missing.push(`${label}.releaseSets object`);
  } else {
    validateReleaseSetMatch(
      config.releaseSets.stable,
      expectations.stableReleaseSet,
      `${label}.releaseSets.stable`,
      missing,
    );
    validateReleaseSetMatch(
      config.releaseSets.candidate,
      expectations.candidateReleaseSet,
      `${label}.releaseSets.candidate`,
      missing,
    );
  }
}

function validateRawMetrics(metrics, expectations, label, missing) {
  if (!isPlainObject(metrics)) {
    missing.push(`${label} JSON object`);
    return;
  }
  if (metrics.schemaVersion !== 1) missing.push(`${label}.schemaVersion exactly 1`);
  if (metrics.artifactType !== CANARY_RAW_METRICS_ARTIFACT_TYPE) {
    missing.push(`${label}.artifactType exactly "${CANARY_RAW_METRICS_ARTIFACT_TYPE}"`);
  }
  if (metrics.phase !== expectations.phase) missing.push(`${label}.phase exactly "${expectations.phase}"`);
  if (metrics.sequence !== expectations.sequence) missing.push(`${label}.sequence exactly ${expectations.sequence}`);
  if (metrics.stableWeightPercent !== expectations.stableWeightPercent) {
    missing.push(`${label}.stableWeightPercent exactly ${expectations.stableWeightPercent}`);
  }
  if (metrics.candidateWeightPercent !== expectations.candidateWeightPercent) {
    missing.push(`${label}.candidateWeightPercent exactly ${expectations.candidateWeightPercent}`);
  }
  if (metrics.httpSamples !== expectations.httpSamples) {
    missing.push(`${label}.httpSamples matching evidence value ${expectations.httpSamples}`);
  }
  if (metrics.websocketSamples !== expectations.websocketSamples) {
    missing.push(`${label}.websocketSamples matching evidence value ${expectations.websocketSamples}`);
  }
  if (metrics.readyReplicaCount !== expectations.readyReplicaCount) {
    missing.push(`${label}.readyReplicaCount matching evidence value ${expectations.readyReplicaCount}`);
  }
  if (
    typeof metrics.gatewayConfigSha256 !== 'string' ||
    typeof expectations.gatewayConfigSha256 !== 'string' ||
    metrics.gatewayConfigSha256.toLowerCase() !== expectations.gatewayConfigSha256.toLowerCase()
  ) {
    missing.push(`${label}.gatewayConfigSha256 matching the gateway config artifact`);
  }
  if (expectations.phase === 'rollback' && metrics.rollbackSeconds !== expectations.rollbackSeconds) {
    missing.push(`${label}.rollbackSeconds matching evidence value ${expectations.rollbackSeconds}`);
  }
  if (expectations.phase === 'rollback') {
    const observation = metrics.observation;
    if (!isPlainObject(observation)) {
      missing.push(`${label}.observation from the rollback collector`);
    } else {
      if (observation.startedAt !== expectations.observationStartedAt) {
        missing.push(`${label}.observation.startedAt matching rollback observation`);
      }
      if (observation.finishedAt !== expectations.observationFinishedAt) {
        missing.push(`${label}.observation.finishedAt matching rollback observation`);
      }
      const startedAt = isoTimestamp(observation.startedAt);
      const finishedAt = isoTimestamp(observation.finishedAt);
      const dwellSeconds =
        startedAt === undefined || finishedAt === undefined || finishedAt <= startedAt
          ? undefined
          : (finishedAt - startedAt) / 1_000;
      if (dwellSeconds === undefined || observation.dwellSeconds !== dwellSeconds) {
        missing.push(`${label}.observation.dwellSeconds matching its timestamps`);
      }
    }
  }
  if (expectations.phase === 'rollout') {
    const observation = metrics.observation;
    if (!isPlainObject(observation)) {
      missing.push(`${label}.observation from the enforced rollout collector`);
    } else {
      if (observation.startedAt !== expectations.startedAt) {
        missing.push(`${label}.observation.startedAt matching evidence value ${expectations.startedAt}`);
      }
      if (observation.finishedAt !== expectations.finishedAt) {
        missing.push(`${label}.observation.finishedAt matching evidence value ${expectations.finishedAt}`);
      }
      const startedAt = isoTimestamp(observation.startedAt);
      const finishedAt = isoTimestamp(observation.finishedAt);
      const dwellSeconds =
        startedAt === undefined || finishedAt === undefined || finishedAt <= startedAt
          ? undefined
          : (finishedAt - startedAt) / 1_000;
      if (dwellSeconds === undefined || observation.dwellSeconds !== dwellSeconds) {
        missing.push(`${label}.observation.dwellSeconds matching its timestamps`);
      }
      if (dwellSeconds === undefined || dwellSeconds < CANARY_POLICY.minStageDwellSeconds) {
        missing.push(`${label}.observation dwell >= ${CANARY_POLICY.minStageDwellSeconds} seconds (repository policy)`);
      }
    }
    const policy = metrics.policy;
    if (!isPlainObject(policy)) {
      missing.push(`${label}.policy repository snapshot`);
    } else {
      for (const [name, value] of Object.entries(CANARY_POLICY)) {
        if (Array.isArray(value)) {
          if (!Array.isArray(policy[name]) || policy[name].length !== value.length) {
            missing.push(`${label}.policy.${name} matching repository policy`);
            continue;
          }
          for (const [index, item] of value.entries()) {
            if (policy[name][index] !== item) {
              missing.push(`${label}.policy.${name} matching repository policy`);
              break;
            }
          }
        } else if (policy[name] !== value) {
          missing.push(`${label}.policy.${name} exactly ${value} (repository policy)`);
        }
      }
    }
    if (metrics.policyPassed !== true) {
      missing.push(`${label}.policyPassed: true from the enforced rollout collector`);
    }
  }
}

function validateCanaryStageArtifacts(evidence, stage, label, missing, verifiedArtifacts, gatewayExpectations) {
  if (!SHA256_PATTERN.test(stage?.gatewayConfigSha256 ?? '')) {
    missing.push(`${label}.gatewayConfigSha256`);
  }
  const gatewayArtifact = validateArtifactReference(
    evidence,
    stage?.gatewayConfigArtifact,
    `${label}.gatewayConfigArtifact`,
    missing,
    verifiedArtifacts,
  );
  if (
    SHA256_PATTERN.test(stage?.gatewayConfigSha256 ?? '') &&
    SHA256_PATTERN.test(stage?.gatewayConfigArtifact?.sha256 ?? '') &&
    stage.gatewayConfigSha256.toLowerCase() !== stage.gatewayConfigArtifact.sha256.toLowerCase()
  ) {
    missing.push(`${label}.gatewayConfigSha256 matching gatewayConfigArtifact.sha256`);
  }
  const rawMetricsArtifact = validateArtifactReference(
    evidence,
    stage?.rawMetricsArtifact,
    `${label}.rawMetricsArtifact`,
    missing,
    verifiedArtifacts,
  );
  if (gatewayArtifact) {
    try {
      const gatewayConfig = JSON.parse(gatewayArtifact.contents.toString('utf8'));
      validateGatewayConfig(gatewayConfig, gatewayExpectations, `${label}.gatewayConfigArtifact`, missing);
    } catch (error) {
      missing.push(
        `${label}.gatewayConfigArtifact valid JSON (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  if (rawMetricsArtifact) {
    try {
      const rawMetrics = JSON.parse(rawMetricsArtifact.contents.toString('utf8'));
      validateRawMetrics(rawMetrics, gatewayExpectations, `${label}.rawMetricsArtifact`, missing);
    } catch (error) {
      missing.push(
        `${label}.rawMetricsArtifact valid JSON (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
}

function validateCanaryEvidence(evidence, missing, verifiedArtifacts) {
  const metrics = isPlainObject(evidence?.metrics) ? evidence.metrics : {};
  const thresholds = isPlainObject(evidence?.thresholds) ? evidence.thresholds : {};
  const expectedThresholds = {
    requiredStages: CANARY_POLICY.requiredStages,
    maxRollbackSeconds: CANARY_POLICY.maxRollbackSeconds,
    maxRollbackObservationDelaySeconds: CANARY_POLICY.maxRollbackObservationDelaySeconds,
    maxRollbackObservationSeconds: CANARY_POLICY.maxRollbackObservationSeconds,
    minStageDwellSeconds: CANARY_POLICY.minStageDwellSeconds,
    minHttpSamplesPerStage: CANARY_POLICY.minHttpSamplesPerStage,
    minWebsocketSamplesPerStage: CANARY_POLICY.minWebsocketSamplesPerStage,
    minReadyReplicaCount: CANARY_POLICY.minReadyReplicaCount,
  };
  for (const [name, value] of Object.entries(expectedThresholds)) {
    if (thresholds[name] !== value) missing.push(`thresholds.${name} exactly ${value} (repository policy)`);
  }
  if (metrics.stagesCompleted !== CANARY_POLICY.requiredStages) {
    missing.push(`metrics.stagesCompleted exactly ${CANARY_POLICY.requiredStages} (repository policy)`);
  }
  if (!Number.isFinite(metrics.rollbackSeconds) || metrics.rollbackSeconds > CANARY_POLICY.maxRollbackSeconds) {
    missing.push(`metrics.rollbackSeconds <= ${CANARY_POLICY.maxRollbackSeconds} (repository policy)`);
  }

  const rollout = evidence?.rollout;
  if (!isPlainObject(rollout)) {
    missing.push('rollout object');
    return;
  }
  const stableReleaseSet = rollout.stableReleaseSet;
  const candidateReleaseSet = rollout.candidateReleaseSet;
  validateReleaseSet(stableReleaseSet, 'rollout.stableReleaseSet', missing);
  validateReleaseSet(candidateReleaseSet, 'rollout.candidateReleaseSet', missing);
  validateStableReleaseManifest(evidence, rollout, stableReleaseSet, missing, verifiedArtifacts);
  for (const service of CANARY_RUNTIME_SERVICES) {
    const stableImage = stableReleaseSet?.[service];
    const candidateImage = candidateReleaseSet?.[service];
    const evidenceImage = evidence?.imageDigests?.[service];
    if (
      IMAGE_DIGEST_PATTERN.test(candidateImage ?? '') &&
      IMAGE_DIGEST_PATTERN.test(evidenceImage ?? '') &&
      candidateImage.toLowerCase() !== evidenceImage.toLowerCase()
    ) {
      missing.push(`rollout.candidateReleaseSet.${service} matching imageDigests.${service}`);
    }
    if (IMAGE_DIGEST_PATTERN.test(stableImage ?? '') && IMAGE_DIGEST_PATTERN.test(candidateImage ?? '')) {
      if (stableImage.toLowerCase() === candidateImage.toLowerCase()) {
        missing.push(`rollout.stableReleaseSet.${service} different from candidate release`);
      }
      if (imageRepository(stableImage).toLowerCase() !== imageRepository(candidateImage).toLowerCase()) {
        missing.push(`rollout.stableReleaseSet.${service} using the same image repository as candidate ${service}`);
      }
    }
  }

  if (!Array.isArray(rollout.stages) || rollout.stages.length !== CANARY_POLICY.requiredStages) {
    missing.push(`rollout.stages containing exactly ${CANARY_POLICY.requiredStages} stages`);
    return;
  }

  const evidenceStartedAt = isoTimestamp(evidence?.startedAt);
  const evidenceFinishedAt = isoTimestamp(evidence?.finishedAt);
  let previousFinishedAt;
  const gatewayConfigHashes = new Set();
  for (const [index, expectedWeight] of CANARY_POLICY.stageWeights.entries()) {
    const stage = rollout.stages[index];
    const label = `rollout.stages[${index}]`;
    if (!isPlainObject(stage)) {
      missing.push(`${label} object`);
      continue;
    }
    if (stage.sequence !== index + 1) missing.push(`${label}.sequence exactly ${index + 1}`);
    if (stage.weightPercent !== expectedWeight) {
      missing.push(`${label}.weightPercent exactly ${expectedWeight} without skipped stages`);
    }
    const startedAt = isoTimestamp(stage.startedAt);
    const finishedAt = isoTimestamp(stage.finishedAt);
    if (startedAt === undefined) missing.push(`${label}.startedAt (ISO timestamp)`);
    if (finishedAt === undefined) missing.push(`${label}.finishedAt (ISO timestamp)`);
    if (startedAt !== undefined && finishedAt !== undefined) {
      if (finishedAt <= startedAt) missing.push(`${label}.finishedAt after startedAt`);
      else if (finishedAt - startedAt < CANARY_POLICY.minStageDwellSeconds * 1_000) {
        missing.push(`${label} dwell >= ${CANARY_POLICY.minStageDwellSeconds} seconds (repository policy)`);
      }
      if (previousFinishedAt !== undefined && startedAt < previousFinishedAt) {
        missing.push(`${label}.startedAt after the previous stage finished`);
      }
      if (
        evidenceStartedAt !== undefined &&
        evidenceFinishedAt !== undefined &&
        (startedAt < evidenceStartedAt || finishedAt > evidenceFinishedAt)
      ) {
        missing.push(`${label} timestamps within the evidence interval`);
      }
      previousFinishedAt = finishedAt;
    }
    if (!Number.isInteger(stage.httpSamples) || stage.httpSamples < CANARY_POLICY.minHttpSamplesPerStage) {
      missing.push(`${label}.httpSamples >= ${CANARY_POLICY.minHttpSamplesPerStage} (repository policy)`);
    }
    if (
      !Number.isInteger(stage.websocketSamples) ||
      stage.websocketSamples < CANARY_POLICY.minWebsocketSamplesPerStage
    ) {
      missing.push(`${label}.websocketSamples >= ${CANARY_POLICY.minWebsocketSamplesPerStage} (repository policy)`);
    }
    if (!Number.isInteger(stage.readyReplicaCount) || stage.readyReplicaCount < CANARY_POLICY.minReadyReplicaCount) {
      missing.push(`${label}.readyReplicaCount >= ${CANARY_POLICY.minReadyReplicaCount} (repository policy)`);
    }
    validateCanaryStageArtifacts(evidence, stage, label, missing, verifiedArtifacts, {
      phase: 'rollout',
      sequence: index + 1,
      stableWeightPercent: 100 - expectedWeight,
      candidateWeightPercent: expectedWeight,
      httpSamples: stage.httpSamples,
      websocketSamples: stage.websocketSamples,
      readyReplicaCount: stage.readyReplicaCount,
      gatewayConfigSha256: stage.gatewayConfigSha256,
      startedAt: stage.startedAt,
      finishedAt: stage.finishedAt,
      stableReleaseSet,
      candidateReleaseSet,
    });
    if (SHA256_PATTERN.test(stage.gatewayConfigSha256 ?? '')) {
      const gatewayHash = stage.gatewayConfigSha256.toLowerCase();
      if (gatewayConfigHashes.has(gatewayHash)) {
        missing.push(`${label}.gatewayConfigSha256 unique for its traffic weight`);
      }
      gatewayConfigHashes.add(gatewayHash);
    }
  }

  const rollback = rollout.rollback;
  if (!isPlainObject(rollback)) {
    missing.push('rollout.rollback object');
    return;
  }
  validateReleaseSetMatch(rollback.fromReleaseSet, candidateReleaseSet, 'rollout.rollback.fromReleaseSet', missing);
  validateReleaseSetMatch(rollback.toReleaseSet, stableReleaseSet, 'rollout.rollback.toReleaseSet', missing);
  const rollbackStartedAt = isoTimestamp(rollback.startedAt);
  const rollbackFinishedAt = isoTimestamp(rollback.finishedAt);
  if (rollbackStartedAt === undefined) missing.push('rollout.rollback.startedAt (ISO timestamp)');
  if (rollbackFinishedAt === undefined) missing.push('rollout.rollback.finishedAt (ISO timestamp)');
  if (rollbackStartedAt !== undefined && rollbackFinishedAt !== undefined) {
    const rollbackDurationSeconds = (rollbackFinishedAt - rollbackStartedAt) / 1_000;
    if (rollbackFinishedAt <= rollbackStartedAt) missing.push('rollout.rollback.finishedAt after startedAt');
    if (rollbackDurationSeconds > CANARY_POLICY.maxRollbackSeconds) {
      missing.push(`rollout.rollback duration <= ${CANARY_POLICY.maxRollbackSeconds} seconds (repository policy)`);
    }
    if (metrics.rollbackSeconds !== rollbackDurationSeconds) {
      missing.push('metrics.rollbackSeconds matching rollout.rollback timestamp duration');
    }
    if (previousFinishedAt !== undefined && rollbackStartedAt < previousFinishedAt) {
      missing.push('rollout.rollback.startedAt after the 100% stage finished');
    }
    if (
      evidenceStartedAt !== undefined &&
      evidenceFinishedAt !== undefined &&
      (rollbackStartedAt < evidenceStartedAt || rollbackFinishedAt > evidenceFinishedAt)
    ) {
      missing.push('rollout.rollback timestamps within the evidence interval');
    }
  }
  const rollbackObservationStartedAt = isoTimestamp(rollback.observationStartedAt);
  const rollbackObservationFinishedAt = isoTimestamp(rollback.observationFinishedAt);
  if (rollbackObservationStartedAt === undefined) missing.push('rollout.rollback.observationStartedAt (ISO timestamp)');
  if (rollbackObservationFinishedAt === undefined)
    missing.push('rollout.rollback.observationFinishedAt (ISO timestamp)');
  if (rollbackObservationStartedAt !== undefined && rollbackObservationFinishedAt !== undefined) {
    const rollbackObservationSeconds = (rollbackObservationFinishedAt - rollbackObservationStartedAt) / 1_000;
    if (rollbackObservationFinishedAt <= rollbackObservationStartedAt) {
      missing.push('rollout.rollback observation finished after it started');
    }
    if (rollbackObservationSeconds > CANARY_POLICY.maxRollbackObservationSeconds) {
      missing.push(
        `rollout.rollback observation duration <= ${CANARY_POLICY.maxRollbackObservationSeconds} seconds (repository policy)`,
      );
    }
    if (metrics.rollbackObservationSeconds !== rollbackObservationSeconds) {
      missing.push('metrics.rollbackObservationSeconds matching rollout.rollback observation duration');
    }
    if (rollbackFinishedAt !== undefined && rollbackObservationStartedAt < rollbackFinishedAt) {
      missing.push('rollout.rollback observation started after the switch finished');
    }
    if (rollbackFinishedAt !== undefined && rollbackObservationStartedAt >= rollbackFinishedAt) {
      const observationDelaySeconds = (rollbackObservationStartedAt - rollbackFinishedAt) / 1_000;
      if (observationDelaySeconds > CANARY_POLICY.maxRollbackObservationDelaySeconds) {
        missing.push(
          `rollout.rollback observation started within ${CANARY_POLICY.maxRollbackObservationDelaySeconds} seconds of the switch (repository policy)`,
        );
      }
      if (metrics.rollbackObservationDelaySeconds !== observationDelaySeconds) {
        missing.push('metrics.rollbackObservationDelaySeconds matching the rollback observation delay');
      }
    }
    if (
      evidenceStartedAt !== undefined &&
      evidenceFinishedAt !== undefined &&
      (rollbackObservationStartedAt < evidenceStartedAt || rollbackObservationFinishedAt > evidenceFinishedAt)
    ) {
      missing.push('rollout.rollback observation timestamps within the evidence interval');
    }
  }
  if (
    !Number.isInteger(rollback.readyReplicaCount) ||
    rollback.readyReplicaCount < CANARY_POLICY.minReadyReplicaCount
  ) {
    missing.push(`rollout.rollback.readyReplicaCount >= ${CANARY_POLICY.minReadyReplicaCount} (repository policy)`);
  }
  if (!Number.isInteger(rollback.httpSamples) || rollback.httpSamples < CANARY_POLICY.minHttpSamplesPerStage) {
    missing.push(`rollout.rollback.httpSamples >= ${CANARY_POLICY.minHttpSamplesPerStage} (repository policy)`);
  }
  if (
    !Number.isInteger(rollback.websocketSamples) ||
    rollback.websocketSamples < CANARY_POLICY.minWebsocketSamplesPerStage
  ) {
    missing.push(
      `rollout.rollback.websocketSamples >= ${CANARY_POLICY.minWebsocketSamplesPerStage} (repository policy)`,
    );
  }
  validateCanaryStageArtifacts(evidence, rollback, 'rollout.rollback', missing, verifiedArtifacts, {
    phase: 'rollback',
    sequence: CANARY_POLICY.requiredStages + 1,
    stableWeightPercent: 100,
    candidateWeightPercent: 0,
    httpSamples: rollback.httpSamples,
    websocketSamples: rollback.websocketSamples,
    readyReplicaCount: rollback.readyReplicaCount,
    rollbackSeconds: metrics.rollbackSeconds,
    observationStartedAt: rollback.observationStartedAt,
    observationFinishedAt: rollback.observationFinishedAt,
    gatewayConfigSha256: rollback.gatewayConfigSha256,
    stableReleaseSet,
    candidateReleaseSet,
  });
  if (
    SHA256_PATTERN.test(rollback.gatewayConfigSha256 ?? '') &&
    gatewayConfigHashes.has(rollback.gatewayConfigSha256.toLowerCase())
  ) {
    missing.push('rollout.rollback.gatewayConfigSha256 different from every candidate traffic stage');
  }
}

function numbersEqual(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 1e-9;
}

function validatePolicyThresholds(evidence, policy, missing) {
  const thresholds = isPlainObject(evidence?.thresholds) ? evidence.thresholds : {};
  for (const [name, value] of Object.entries(policy.thresholds)) {
    if (thresholds[name] !== value) missing.push(`thresholds.${name} exactly ${value} (repository policy)`);
  }
}

function validateSummaryMetric(evidence, name, recomputed, missing) {
  if (!numbersEqual(evidence?.metrics?.[name], recomputed)) {
    missing.push(`metrics.${name} matching recomputed raw artifact value ${recomputed}`);
  }
}

function validateSummaryResult(evidence, name, recomputed, missing) {
  if (evidence?.results?.[name] !== recomputed) {
    missing.push(`results.${name} matching recomputed raw artifact value ${recomputed}`);
  }
}

function validateRawArtifactEnvelope(raw, evidence, policy, missing, exactEvidenceInterval = true) {
  const label = 'rawArtifact';
  if (!isPlainObject(raw)) {
    missing.push(`${label} JSON object`);
    return {};
  }
  if (raw.schemaVersion !== 1) missing.push(`${label}.schemaVersion exactly 1`);
  if (raw.artifactType !== policy.rawArtifactType) {
    missing.push(`${label}.artifactType exactly "${policy.rawArtifactType}"`);
  }
  if (
    typeof raw.releaseSha !== 'string' ||
    typeof evidence?.releaseSha !== 'string' ||
    raw.releaseSha.toLowerCase() !== evidence.releaseSha.toLowerCase()
  ) {
    missing.push(`${label}.releaseSha matching evidence.releaseSha`);
  }
  const startedAt = isoTimestamp(raw.startedAt);
  const finishedAt = isoTimestamp(raw.finishedAt);
  if (startedAt === undefined) missing.push(`${label}.startedAt (ISO timestamp)`);
  if (finishedAt === undefined) missing.push(`${label}.finishedAt (ISO timestamp)`);
  if (startedAt !== undefined && finishedAt !== undefined && finishedAt <= startedAt) {
    missing.push(`${label}.finishedAt after startedAt`);
  }
  if (exactEvidenceInterval) {
    if (raw.startedAt !== evidence?.startedAt) missing.push(`${label}.startedAt matching evidence.startedAt`);
    if (raw.finishedAt !== evidence?.finishedAt) missing.push(`${label}.finishedAt matching evidence.finishedAt`);
  } else {
    const evidenceStartedAt = isoTimestamp(evidence?.startedAt);
    const evidenceFinishedAt = isoTimestamp(evidence?.finishedAt);
    if (
      startedAt !== undefined &&
      finishedAt !== undefined &&
      evidenceStartedAt !== undefined &&
      evidenceFinishedAt !== undefined &&
      (startedAt < evidenceStartedAt || finishedAt > evidenceFinishedAt)
    ) {
      missing.push(`${label} interval contained within the evidence interval`);
    }
  }
  return { startedAt, finishedAt };
}

function timestampWithinInterval(value, label, interval, missing) {
  const timestamp = isoTimestamp(value);
  if (timestamp === undefined) {
    missing.push(`${label} (ISO timestamp)`);
    return undefined;
  }
  if (
    interval.startedAt !== undefined &&
    interval.finishedAt !== undefined &&
    (timestamp < interval.startedAt || timestamp > interval.finishedAt)
  ) {
    missing.push(`${label} within raw artifact interval`);
  }
  return timestamp;
}

function validateRestoreRawArtifact(raw, evidence, interval, missing, options) {
  if (raw.success !== true) missing.push('rawArtifact.success: true');
  if (raw.exitCode !== 0) missing.push('rawArtifact.exitCode exactly 0');
  if (
    interval.startedAt !== undefined &&
    interval.finishedAt !== undefined &&
    raw.durationSeconds !== (interval.finishedAt - interval.startedAt) / 1_000
  ) {
    missing.push('rawArtifact.durationSeconds matching finishedAt - startedAt');
  }

  const backup = raw.backup;
  if (!isPlainObject(backup)) {
    missing.push('rawArtifact.backup object');
  } else {
    if (backup.method !== 'pg_basebackup') missing.push('rawArtifact.backup.method exactly "pg_basebackup"');
    if (backup.verified !== true) missing.push('rawArtifact.backup.verified: true');
    if (!SHA256_PATTERN.test(backup.manifestSha256 ?? '')) {
      missing.push('rawArtifact.backup.manifestSha256');
    }
  }

  const restore = raw.restore;
  if (!isPlainObject(restore)) {
    missing.push('rawArtifact.restore object');
    return;
  }
  if (restore.mode !== 'pitr') missing.push('rawArtifact.restore.mode exactly "pitr"');
  if (!SHA256_PATTERN.test(restore.baseBackupSha256 ?? '')) {
    missing.push('rawArtifact.restore.baseBackupSha256');
  }
  if (
    SHA256_PATTERN.test(backup?.manifestSha256 ?? '') &&
    SHA256_PATTERN.test(restore.baseBackupSha256 ?? '') &&
    backup.manifestSha256.toLowerCase() !== restore.baseBackupSha256.toLowerCase()
  ) {
    missing.push('rawArtifact.restore.baseBackupSha256 matching backup.manifestSha256');
  }
  if (!Number.isInteger(restore.walSegmentsApplied) || restore.walSegmentsApplied < 1) {
    missing.push('rawArtifact.restore.walSegmentsApplied >= 1');
  }
  if (restore.targetReached !== true) missing.push('rawArtifact.restore.targetReached: true');
  if (restore.promoted !== true) missing.push('rawArtifact.restore.promoted: true');
  const restoreTargetAt = isoTimestamp(restore.targetAt);
  const recoveredThroughAt = isoTimestamp(restore.recoveredThroughAt);
  if (restoreTargetAt === undefined) missing.push('rawArtifact.restore.targetAt (ISO timestamp)');
  if (recoveredThroughAt === undefined) missing.push('rawArtifact.restore.recoveredThroughAt (ISO timestamp)');

  let rpoMinutes;
  if (restoreTargetAt !== undefined && recoveredThroughAt !== undefined) {
    if (recoveredThroughAt > restoreTargetAt) {
      missing.push('rawArtifact.restore.recoveredThroughAt no later than targetAt');
    } else {
      rpoMinutes = (restoreTargetAt - recoveredThroughAt) / 60_000;
    }
  }

  let rtoMinutes;
  if (interval.startedAt !== undefined && interval.finishedAt !== undefined) {
    rtoMinutes = (interval.finishedAt - interval.startedAt) / 60_000;
  }

  const checks = raw.checks;
  if (!isPlainObject(checks)) {
    missing.push('rawArtifact.checks object');
    return { rpoMinutes, rtoMinutes };
  }
  const expectedSchemaBound =
    typeof options.expectedSchemaMigration === 'string' &&
    typeof options.expectedSchemaChecksum === 'string' &&
    checks.expectedMigration === options.expectedSchemaMigration &&
    checks.expectedSchemaChecksum === options.expectedSchemaChecksum &&
    checks.migrateImage === options.imageDigests?.migrate;
  if (!expectedSchemaBound) {
    missing.push('rawArtifact.checks expected migration/checksum/migrate image matching the release manifest');
  }
  for (const name of [
    'expectedMigrationCount',
    'requiredTableCount',
    'unvalidatedConstraints',
    'invalidOutboxStatus',
    'markerBeforeCount',
    'walReplayProbeCount',
    'markerAfterCount',
    'sourceMarkerAfterCount',
    'deletionHoldViolations',
    'deletedSocialViolations',
  ]) {
    if (!Number.isInteger(checks[name]) || checks[name] < 0)
      missing.push(`rawArtifact.checks.${name} non-negative integer`);
  }
  const recomputedResults = {
    schemaGatePassed:
      expectedSchemaBound &&
      checks.expectedMigrationCount === 1 &&
      checks.requiredTableCount === 8 &&
      checks.unvalidatedConstraints === 0 &&
      checks.invalidOutboxStatus === 0,
    fixtureRoundTripPassed:
      checks.markerBeforeCount === 1 &&
      checks.walReplayProbeCount === 1 &&
      checks.markerAfterCount === 0 &&
      checks.sourceMarkerAfterCount === 1 &&
      restore.targetReached === true,
    legalHoldInvariantPassed: checks.deletionHoldViolations === 0 && checks.deletedSocialViolations === 0,
  };
  for (const [resultName, passed] of Object.entries(recomputedResults)) {
    validateSummaryResult(evidence, resultName, passed, missing);
    if (checks[resultName] !== passed) missing.push(`rawArtifact.checks.${resultName} matching observed counts`);
    if (!passed) missing.push(`rawArtifact.checks.${resultName}: true`);
  }
  return { rpoMinutes, rtoMinutes };
}

function isOffsiteObjectUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 's3:' || url.protocol === 'https:') &&
      url.hostname !== '' &&
      url.pathname.length > 1 &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
}

function validateRestoreOffsiteArtifact(evidence, policy, missing, verifiedArtifacts, options) {
  const label = 'offsiteArtifact';
  const verifiedArtifact = validateArtifactReference(
    evidence,
    evidence?.offsiteArtifact,
    label,
    missing,
    verifiedArtifacts,
  );
  if (!verifiedArtifact) return {};
  if (
    evidence?.rawArtifact?.path === evidence.offsiteArtifact.path ||
    evidence?.rawArtifact?.sha256?.toLowerCase() === evidence.offsiteArtifact.sha256?.toLowerCase()
  ) {
    missing.push(`${label} distinct from the PITR mechanics rawArtifact`);
  }

  let raw;
  try {
    raw = JSON.parse(verifiedArtifact.contents.toString('utf8'));
  } catch (error) {
    missing.push(`${label} valid JSON (${error instanceof Error ? error.message : String(error)})`);
    return {};
  }
  if (!isPlainObject(raw)) {
    missing.push(`${label} JSON object`);
    return {};
  }
  if (raw.schemaVersion !== 1) missing.push(`${label}.schemaVersion exactly 1`);
  if (raw.artifactType !== policy.offsiteArtifactType) {
    missing.push(`${label}.artifactType exactly "${policy.offsiteArtifactType}"`);
  }
  if (
    typeof raw.releaseSha !== 'string' ||
    typeof evidence?.releaseSha !== 'string' ||
    raw.releaseSha.toLowerCase() !== evidence.releaseSha.toLowerCase()
  ) {
    missing.push(`${label}.releaseSha matching evidence.releaseSha`);
  }
  const evidenceInterval = {
    startedAt: isoTimestamp(evidence?.startedAt),
    finishedAt: isoTimestamp(evidence?.finishedAt),
  };
  const startedAt = timestampWithinInterval(raw.startedAt, `${label}.startedAt`, evidenceInterval, missing);
  const finishedAt = timestampWithinInterval(raw.finishedAt, `${label}.finishedAt`, evidenceInterval, missing);
  if (startedAt !== undefined && finishedAt !== undefined && finishedAt <= startedAt) {
    missing.push(`${label}.finishedAt after startedAt`);
  }

  let recoveryPointAt;
  const backup = raw.backup;
  if (!isPlainObject(backup)) {
    missing.push(`${label}.backup object`);
  } else {
    if (!isOffsiteObjectUrl(backup.remoteObjectUrl)) {
      missing.push(`${label}.backup.remoteObjectUrl as an s3:// or HTTPS object URL`);
    }
    if (
      typeof backup.objectVersionId !== 'string' ||
      backup.objectVersionId.trim() === '' ||
      backup.objectVersionId === 'null'
    ) {
      missing.push(`${label}.backup.objectVersionId`);
    }
    if (
      typeof backup.checksumObjectVersionId !== 'string' ||
      backup.checksumObjectVersionId.trim() === '' ||
      backup.checksumObjectVersionId === 'null'
    ) {
      missing.push(`${label}.backup.checksumObjectVersionId`);
    }
    if (backup.encrypted !== true) missing.push(`${label}.backup.encrypted: true`);
    if (backup.encryptionScheme !== 'age') missing.push(`${label}.backup.encryptionScheme exactly "age"`);
    if (!SHA256_PATTERN.test(backup.artifactSha256 ?? '')) {
      missing.push(`${label}.backup.artifactSha256`);
    }
    if (backup.checksumVerified !== true) missing.push(`${label}.backup.checksumVerified: true`);
    if (backup.decryptSucceeded !== true) missing.push(`${label}.backup.decryptSucceeded: true`);
    recoveryPointAt = isoTimestamp(backup.recoveryPointAt);
    const objectLastModifiedAt = isoTimestamp(backup.objectLastModifiedAt);
    if (recoveryPointAt === undefined) missing.push(`${label}.backup.recoveryPointAt (ISO timestamp)`);
    if (objectLastModifiedAt === undefined) missing.push(`${label}.backup.objectLastModifiedAt (ISO timestamp)`);
    if (recoveryPointAt !== undefined && objectLastModifiedAt !== undefined && objectLastModifiedAt < recoveryPointAt) {
      missing.push(`${label}.backup.objectLastModifiedAt no earlier than recoveryPointAt`);
    }
    if (objectLastModifiedAt !== undefined && startedAt !== undefined && objectLastModifiedAt > startedAt) {
      missing.push(`${label}.backup.objectLastModifiedAt no later than restore startedAt`);
    }
  }

  const restore = raw.restore;
  if (!isPlainObject(restore)) {
    missing.push(`${label}.restore object`);
  } else {
    const schema = restore.schema;
    if (!isPlainObject(schema)) {
      missing.push(`${label}.restore.schema object`);
    } else {
      if (!MIGRATION_BASENAME_PATTERN.test(schema.expectedMigration ?? '')) {
        missing.push(`${label}.restore.schema.expectedMigration`);
      }
      if (!SHA256_PATTERN.test(schema.expectedChecksum ?? '')) {
        missing.push(`${label}.restore.schema.expectedChecksum`);
      }
      if (
        schema.expectedMigration !== options.expectedSchemaMigration ||
        schema.expectedChecksum !== options.expectedSchemaChecksum ||
        schema.migrateImage !== options.imageDigests?.migrate
      ) {
        missing.push(`${label}.restore.schema matching the release manifest`);
      }
    }
    if (restore.isolated !== true) missing.push(`${label}.restore.isolated: true`);
    if (restore.completed !== true) missing.push(`${label}.restore.completed: true`);
    const observations = restore.observations;
    if (!isPlainObject(observations)) {
      missing.push(`${label}.restore.observations object`);
    } else {
      for (const name of [
        'schemaMigrations',
        'expectedSchemaBinding',
        'users',
        'cards',
        'officialCardDataReleases',
        'missingOfficialEnglishNames',
        'missingOfficialEnglishEffects',
        'officialErrata',
        'officialJapaneseRows',
        'officialEnglishRows',
        'matches',
        'relationshipChangeOutbox',
        'legalHolds',
        'unvalidatedConstraints',
        'invalidOutboxStatus',
        'deletionHoldViolations',
        'deletedSocialViolations',
      ]) {
        if (!Number.isInteger(observations[name]) || observations[name] < 0) {
          missing.push(`${label}.restore.observations.${name} non-negative integer`);
        }
      }
      const expectedSchemaBound =
        schema?.expectedMigration === options.expectedSchemaMigration &&
        schema?.expectedChecksum === options.expectedSchemaChecksum &&
        schema?.migrateImage === options.imageDigests?.migrate;
      const recomputed = {
        schemaGatePassed:
          expectedSchemaBound &&
          observations.schemaMigrations >= 1 &&
          observations.expectedSchemaBinding === 1 &&
          observations.unvalidatedConstraints === 0,
        coreDataInvariantPassed:
          observations.cards === 422 &&
          observations.officialCardDataReleases >= 1 &&
          observations.missingOfficialEnglishNames === 0 &&
          observations.missingOfficialEnglishEffects === 0 &&
          observations.officialErrata === 12 &&
          observations.officialJapaneseRows === 422 &&
          observations.officialEnglishRows === 422 &&
          observations.invalidOutboxStatus === 0,
        legalHoldInvariantPassed:
          observations.deletionHoldViolations === 0 && observations.deletedSocialViolations === 0,
      };
      for (const [resultName, passed] of Object.entries(recomputed)) {
        if (restore[resultName] !== passed) {
          missing.push(`${label}.restore.${resultName} matching observed counts`);
        }
        if (!passed) missing.push(`${label}.restore.${resultName}: true`);
      }
    }
  }
  const rpoMinutes =
    startedAt !== undefined && recoveryPointAt !== undefined && recoveryPointAt <= startedAt
      ? (startedAt - recoveryPointAt) / 60_000
      : undefined;
  if (recoveryPointAt !== undefined && startedAt !== undefined && recoveryPointAt > startedAt) {
    missing.push(`${label}.backup.recoveryPointAt no later than restore startedAt`);
  }
  const rtoMinutes =
    startedAt !== undefined && finishedAt !== undefined && finishedAt > startedAt
      ? (finishedAt - startedAt) / 60_000
      : undefined;
  return { rpoMinutes, rtoMinutes };
}

function recoveryFromProbe(failover, component, policy, interval, missing) {
  const label = `rawArtifact.failovers.${component}`;
  if (!isPlainObject(failover)) {
    missing.push(`${label} object`);
    return undefined;
  }
  const injectedAt = timestampWithinInterval(failover.injectedAt, `${label}.injectedAt`, interval, missing);
  if (!Array.isArray(failover.probes) || failover.probes.length < policy.requiredHealthySamples + 1) {
    missing.push(`${label}.probes with an outage and ${policy.requiredHealthySamples} recovery samples`);
    return undefined;
  }

  let previousAt;
  let outageObserved = false;
  let consecutiveHealthy = 0;
  let recoveredAt;
  let invalidProbe = false;
  for (const [index, probe] of failover.probes.entries()) {
    const probeLabel = `${label}.probes[${index}]`;
    if (!isPlainObject(probe) || typeof probe.healthy !== 'boolean') {
      missing.push(`${probeLabel} with boolean healthy`);
      invalidProbe = true;
      continue;
    }
    const at = timestampWithinInterval(probe.at, `${probeLabel}.at`, interval, missing);
    if (at === undefined) {
      invalidProbe = true;
      continue;
    }
    if (injectedAt !== undefined && at < injectedAt) missing.push(`${probeLabel}.at no earlier than injectedAt`);
    if (previousAt !== undefined && at <= previousAt) missing.push(`${probeLabel}.at after the previous probe`);
    previousAt = at;
    if (!probe.healthy) {
      if (recoveredAt !== undefined) missing.push(`${label}.probes remaining healthy after recovery`);
      outageObserved = true;
      consecutiveHealthy = 0;
      continue;
    }
    if (outageObserved && recoveredAt === undefined) {
      consecutiveHealthy += 1;
      if (consecutiveHealthy === policy.requiredHealthySamples) recoveredAt = at;
    }
  }
  if (!outageObserved) missing.push(`${label}.probes observing an outage`);
  if (recoveredAt === undefined) {
    missing.push(`${label}.probes ending with ${policy.requiredHealthySamples} consecutive healthy samples`);
  }
  if (invalidProbe || injectedAt === undefined || recoveredAt === undefined || recoveredAt < injectedAt)
    return undefined;
  return (recoveredAt - injectedAt) / 1_000;
}

function validateChaosRawArtifact(raw, evidence, policy, interval, missing) {
  const failoversByComponent = new Map();
  if (!Array.isArray(raw.failovers) || raw.failovers.length !== 2) {
    missing.push('rawArtifact.failovers containing exactly PostgreSQL and Redis failovers');
  } else {
    for (const [index, failover] of raw.failovers.entries()) {
      if (!isPlainObject(failover) || !['postgres', 'redis'].includes(failover.component)) {
        missing.push(`rawArtifact.failovers[${index}].component as postgres or redis`);
        continue;
      }
      if (failoversByComponent.has(failover.component)) {
        missing.push(`rawArtifact.failovers containing one ${failover.component} failover`);
      } else {
        failoversByComponent.set(failover.component, failover);
      }
    }
  }

  const recoveryDurations = [];
  const recovered = {};
  for (const component of ['postgres', 'redis']) {
    const duration = recoveryFromProbe(failoversByComponent.get(component), component, policy, interval, missing);
    recovered[component] = duration !== undefined;
    if (duration !== undefined) recoveryDurations.push(duration);
    validateSummaryResult(evidence, `${component}Recovered`, recovered[component], missing);
  }

  let websocketRecovered = false;
  if (!isPlainObject(raw.websocket)) {
    missing.push('rawArtifact.websocket object');
  } else {
    const disconnectedAt = timestampWithinInterval(
      raw.websocket.disconnectedAt,
      'rawArtifact.websocket.disconnectedAt',
      interval,
      missing,
    );
    const reconnectedAt = timestampWithinInterval(
      raw.websocket.reconnectedAt,
      'rawArtifact.websocket.reconnectedAt',
      interval,
      missing,
    );
    websocketRecovered =
      disconnectedAt !== undefined &&
      reconnectedAt !== undefined &&
      reconnectedAt > disconnectedAt &&
      raw.websocket.stateRecovered === true;
    if (disconnectedAt !== undefined && reconnectedAt !== undefined && reconnectedAt <= disconnectedAt) {
      missing.push('rawArtifact.websocket.reconnectedAt after disconnectedAt');
    }
    if (raw.websocket.stateRecovered !== true) missing.push('rawArtifact.websocket.stateRecovered: true');
    if (websocketRecovered) recoveryDurations.push((reconnectedAt - disconnectedAt) / 1_000);
  }
  validateSummaryResult(evidence, 'websocketReconnected', websocketRecovered, missing);

  let duplicateDeliveries = 0;
  let outboxRecovered = false;
  const outbox = raw.outbox;
  if (!isPlainObject(outbox)) {
    missing.push('rawArtifact.outbox object');
  } else {
    const expectedIds = Array.isArray(outbox.expectedMessageIds) ? outbox.expectedMessageIds : [];
    const expectedSet = new Set(expectedIds);
    if (
      expectedIds.length === 0 ||
      expectedSet.size !== expectedIds.length ||
      expectedIds.some((id) => typeof id !== 'string' || id.trim() === '')
    ) {
      missing.push('rawArtifact.outbox.expectedMessageIds as a non-empty unique string array');
    }
    const deliveryCounts = new Map();
    if (!Array.isArray(outbox.deliveries) || outbox.deliveries.length === 0) {
      missing.push('rawArtifact.outbox.deliveries non-empty array');
    } else {
      for (const [index, delivery] of outbox.deliveries.entries()) {
        const label = `rawArtifact.outbox.deliveries[${index}]`;
        if (!isPlainObject(delivery) || typeof delivery.messageId !== 'string') {
          missing.push(`${label}.messageId`);
          continue;
        }
        timestampWithinInterval(delivery.deliveredAt, `${label}.deliveredAt`, interval, missing);
        if (!expectedSet.has(delivery.messageId)) missing.push(`${label}.messageId declared in expectedMessageIds`);
        deliveryCounts.set(delivery.messageId, (deliveryCounts.get(delivery.messageId) ?? 0) + 1);
      }
    }
    duplicateDeliveries = [...deliveryCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
    outboxRecovered = expectedIds.length > 0 && expectedIds.every((id) => (deliveryCounts.get(id) ?? 0) >= 1);
  }
  validateSummaryMetric(evidence, 'duplicateDeliveries', duplicateDeliveries, missing);
  validateSummaryResult(evidence, 'outboxRecovered', outboxRecovered, missing);
  if (duplicateDeliveries !== policy.thresholds.maxDuplicateDeliveries) {
    missing.push(`recomputed raw artifact duplicate deliveries exactly ${policy.thresholds.maxDuplicateDeliveries}`);
  }

  if (recoveryDurations.length > 0) {
    const recoverySeconds = Math.max(...recoveryDurations);
    validateSummaryMetric(evidence, 'recoverySeconds', recoverySeconds, missing);
    if (recoverySeconds > policy.thresholds.maxRecoverySeconds) {
      missing.push(
        `recomputed raw artifact recovery <= ${policy.thresholds.maxRecoverySeconds} seconds (repository policy)`,
      );
    }
  }
}

function validateLoadRun(run, kind, observedPeakRps, interval, missing) {
  const label = `rawArtifact.runs.${kind}`;
  if (!isPlainObject(run)) {
    missing.push(`${label} object`);
    return undefined;
  }
  const startedAt = timestampWithinInterval(run.startedAt, `${label}.startedAt`, interval, missing);
  const finishedAt = timestampWithinInterval(run.finishedAt, `${label}.finishedAt`, interval, missing);
  let durationSeconds;
  if (startedAt !== undefined && finishedAt !== undefined) {
    if (finishedAt <= startedAt) missing.push(`${label}.finishedAt after startedAt`);
    else durationSeconds = (finishedAt - startedAt) / 1_000;
  }
  if (!Number.isInteger(run.targetRps) || run.targetRps <= 0) missing.push(`${label}.targetRps positive integer`);
  if (!Number.isInteger(run.droppedIterations) || run.droppedIterations !== 0) {
    missing.push(`${label}.droppedIterations exactly 0`);
  }

  let requestCount = 0;
  let errorCount = 0;
  if (!isPlainObject(run.statusCounts) || Object.keys(run.statusCounts).length === 0) {
    missing.push(`${label}.statusCounts non-empty object`);
  } else {
    for (const [status, count] of Object.entries(run.statusCounts)) {
      if (!/^\d{3}$/.test(status) || !Number.isInteger(count) || count < 0) {
        missing.push(`${label}.statusCounts.${status} non-negative integer`);
        continue;
      }
      requestCount += count;
      const statusCode = Number(status);
      if (statusCode < 200 || statusCode >= 300) errorCount += count;
    }
  }

  const latencyDistribution = [];
  let latencyCount = 0;
  if (!Array.isArray(run.latencyDistribution) || run.latencyDistribution.length === 0) {
    missing.push(`${label}.latencyDistribution non-empty array`);
  } else {
    for (const [index, bucket] of run.latencyDistribution.entries()) {
      if (
        !isPlainObject(bucket) ||
        !Number.isFinite(bucket.latencyMs) ||
        bucket.latencyMs < 0 ||
        !Number.isInteger(bucket.count) ||
        bucket.count <= 0
      ) {
        missing.push(`${label}.latencyDistribution[${index}] with latencyMs and positive count`);
        continue;
      }
      latencyDistribution.push({ latencyMs: bucket.latencyMs, count: bucket.count });
      latencyCount += bucket.count;
    }
  }
  if (latencyCount !== requestCount) {
    missing.push(`${label}.latencyDistribution counts matching statusCounts (${requestCount})`);
  }
  if (durationSeconds !== undefined && Number.isInteger(run.targetRps) && run.targetRps > 0) {
    const requiredSamples = Math.floor(run.targetRps * durationSeconds);
    if (requestCount < requiredSamples) {
      missing.push(`${label}.request samples >= targetRps * duration (${requiredSamples})`);
    }
  }
  if (!Number.isFinite(observedPeakRps) || observedPeakRps <= 0 || !Number.isInteger(run.targetRps)) return undefined;
  return {
    startedAt,
    finishedAt,
    durationSeconds,
    multiplier: run.targetRps / observedPeakRps,
    requestCount,
    errorCount,
    latencyDistribution,
  };
}

function latencyPercentile(distribution, totalCount, percentile) {
  if (totalCount <= 0) return undefined;
  const rank = Math.ceil(totalCount * percentile);
  let cumulative = 0;
  for (const bucket of [...distribution].sort((left, right) => left.latencyMs - right.latencyMs)) {
    cumulative += bucket.count;
    if (cumulative >= rank) return bucket.latencyMs;
  }
  return undefined;
}

function validateLoadRawArtifact(raw, evidence, policy, interval, missing) {
  if (!Number.isFinite(raw.observedPeakRps) || raw.observedPeakRps <= 0) {
    missing.push('rawArtifact.observedPeakRps positive number');
  }
  if (!Array.isArray(raw.runs) || raw.runs.length !== 2) {
    missing.push('rawArtifact.runs containing exactly peak and soak runs');
    return;
  }
  const peakEntries = raw.runs.filter((run) => run?.kind === 'peak');
  const soakEntries = raw.runs.filter((run) => run?.kind === 'soak');
  if (peakEntries.length !== 1) missing.push('rawArtifact.runs containing one peak run');
  if (soakEntries.length !== 1) missing.push('rawArtifact.runs containing one soak run');
  const peak = validateLoadRun(peakEntries[0], 'peak', raw.observedPeakRps, interval, missing);
  const soak = validateLoadRun(soakEntries[0], 'soak', raw.observedPeakRps, interval, missing);
  if (!peak || !soak) return;

  if (peak.startedAt !== interval.startedAt)
    missing.push('rawArtifact.runs.peak.startedAt matching rawArtifact.startedAt');
  if (soak.finishedAt !== interval.finishedAt)
    missing.push('rawArtifact.runs.soak.finishedAt matching rawArtifact.finishedAt');
  if (peak.finishedAt !== undefined && soak.startedAt !== undefined && soak.startedAt < peak.finishedAt) {
    missing.push('rawArtifact.runs.soak.startedAt no earlier than peak finishedAt');
  }
  const peakDurationMinutes = peak.durationSeconds === undefined ? undefined : peak.durationSeconds / 60;
  const soakDurationMinutes = soak.durationSeconds === undefined ? undefined : soak.durationSeconds / 60;
  if (peakDurationMinutes === undefined || peakDurationMinutes < policy.minPeakDurationMinutes) {
    missing.push(`rawArtifact peak duration >= ${policy.minPeakDurationMinutes} minutes (repository policy)`);
  }
  if (soakDurationMinutes === undefined || soakDurationMinutes < policy.minSoakDurationMinutes) {
    missing.push(`rawArtifact soak duration >= ${policy.minSoakDurationMinutes} minutes (repository policy)`);
  }
  for (const [kind, run] of [
    ['peak', peak],
    ['soak', soak],
  ]) {
    if (run.multiplier < policy.thresholds.minPeakMultiplier) {
      missing.push(
        `rawArtifact ${kind} target >= ${policy.thresholds.minPeakMultiplier}x observed peak (repository policy)`,
      );
    }
  }

  const peakP95LatencyMs = latencyPercentile(peak.latencyDistribution, peak.requestCount, 0.95);
  const soakP95LatencyMs = latencyPercentile(soak.latencyDistribution, soak.requestCount, 0.95);
  const p95LatencyMs =
    peakP95LatencyMs === undefined || soakP95LatencyMs === undefined
      ? undefined
      : Math.max(peakP95LatencyMs, soakP95LatencyMs);
  const peakErrorRate = peak.requestCount > 0 ? peak.errorCount / peak.requestCount : undefined;
  const soakErrorRate = soak.requestCount > 0 ? soak.errorCount / soak.requestCount : undefined;
  const errorRate =
    peakErrorRate === undefined || soakErrorRate === undefined ? undefined : Math.max(peakErrorRate, soakErrorRate);
  const peakMultiplier = Math.min(peak.multiplier, soak.multiplier);
  validateSummaryMetric(evidence, 'peakMultiplier', peakMultiplier, missing);
  if (soakDurationMinutes !== undefined)
    validateSummaryMetric(evidence, 'durationMinutes', soakDurationMinutes, missing);
  if (p95LatencyMs !== undefined) validateSummaryMetric(evidence, 'p95LatencyMs', p95LatencyMs, missing);
  if (errorRate !== undefined) validateSummaryMetric(evidence, 'errorRate', errorRate, missing);

  const sloPassed =
    peakDurationMinutes !== undefined &&
    peakDurationMinutes >= policy.minPeakDurationMinutes &&
    soakDurationMinutes !== undefined &&
    soakDurationMinutes >= policy.minSoakDurationMinutes &&
    peakMultiplier >= policy.thresholds.minPeakMultiplier &&
    p95LatencyMs !== undefined &&
    p95LatencyMs < policy.thresholds.maxP95LatencyMs &&
    errorRate !== undefined &&
    errorRate < policy.thresholds.maxErrorRate;
  validateSummaryResult(evidence, 'sloPassed', sloPassed, missing);
  if (p95LatencyMs !== undefined && p95LatencyMs >= policy.thresholds.maxP95LatencyMs) {
    missing.push(`recomputed raw artifact HTTP p95 < ${policy.thresholds.maxP95LatencyMs}ms (repository policy)`);
  }
  if (errorRate !== undefined && errorRate >= policy.thresholds.maxErrorRate) {
    missing.push(`recomputed raw artifact HTTP error rate < ${policy.thresholds.maxErrorRate} (repository policy)`);
  }
}

function validateAlertRawArtifact(raw, evidence, policy, interval, missing) {
  if (!Array.isArray(raw.notifications) || raw.notifications.length === 0) {
    missing.push('rawArtifact.notifications non-empty array');
    return;
  }
  const alerts = new Map();
  for (const [index, notification] of raw.notifications.entries()) {
    const label = `rawArtifact.notifications[${index}]`;
    if (
      !isPlainObject(notification) ||
      typeof notification.alertId !== 'string' ||
      notification.alertId.trim() === '' ||
      !['firing', 'resolved'].includes(notification.state)
    ) {
      missing.push(`${label} with alertId and firing/resolved state`);
      continue;
    }
    if (typeof notification.deliveryId !== 'string' || notification.deliveryId.trim() === '') {
      missing.push(`${label}.deliveryId`);
    }
    if (typeof notification.receiver !== 'string' || notification.receiver.trim() === '') {
      missing.push(`${label}.receiver`);
    }
    const emittedAt = timestampWithinInterval(notification.emittedAt, `${label}.emittedAt`, interval, missing);
    const deliveredAt = timestampWithinInterval(notification.deliveredAt, `${label}.deliveredAt`, interval, missing);
    if (emittedAt !== undefined && deliveredAt !== undefined && deliveredAt < emittedAt) {
      missing.push(`${label}.deliveredAt no earlier than emittedAt`);
    }
    const states = alerts.get(notification.alertId) ?? { firing: [], resolved: [] };
    states[notification.state].push({ emittedAt, deliveredAt });
    alerts.set(notification.alertId, states);
  }

  const firingDelays = [];
  const resolvedDelays = [];
  let completePairs = 0;
  for (const [alertId, states] of alerts.entries()) {
    if (states.firing.length !== 1 || states.resolved.length !== 1) {
      missing.push(`rawArtifact.notifications for ${alertId} containing one firing and one resolved delivery`);
      continue;
    }
    const firing = states.firing[0];
    const resolved = states.resolved[0];
    if (
      firing.emittedAt === undefined ||
      firing.deliveredAt === undefined ||
      resolved.emittedAt === undefined ||
      resolved.deliveredAt === undefined
    ) {
      continue;
    }
    if (resolved.emittedAt < firing.emittedAt) {
      missing.push(`rawArtifact.notifications for ${alertId} resolving after firing`);
      continue;
    }
    completePairs += 1;
    firingDelays.push((firing.deliveredAt - firing.emittedAt) / 1_000);
    resolvedDelays.push((resolved.deliveredAt - resolved.emittedAt) / 1_000);
  }
  if (completePairs === 0) missing.push('rawArtifact.notifications with a complete firing/resolved pair');
  const firingDeliverySeconds = firingDelays.length > 0 ? Math.max(...firingDelays) : undefined;
  const resolvedDeliverySeconds = resolvedDelays.length > 0 ? Math.max(...resolvedDelays) : undefined;
  if (firingDeliverySeconds !== undefined) {
    validateSummaryMetric(evidence, 'firingDeliverySeconds', firingDeliverySeconds, missing);
    if (firingDeliverySeconds > policy.thresholds.maxFiringDeliverySeconds) {
      missing.push(
        `recomputed raw artifact firing delivery <= ${policy.thresholds.maxFiringDeliverySeconds} seconds (repository policy)`,
      );
    }
  }
  if (resolvedDeliverySeconds !== undefined) {
    validateSummaryMetric(evidence, 'resolvedDeliverySeconds', resolvedDeliverySeconds, missing);
    if (resolvedDeliverySeconds > policy.thresholds.maxResolvedDeliverySeconds) {
      missing.push(
        `recomputed raw artifact resolved delivery <= ${policy.thresholds.maxResolvedDeliverySeconds} seconds (repository policy)`,
      );
    }
  }
  validateSummaryResult(evidence, 'firingDelivered', completePairs > 0, missing);
  validateSummaryResult(evidence, 'resolvedDelivered', completePairs > 0, missing);
}

function validateOperationalEvidence(evidence, expectedEvidenceType, missing, verifiedArtifacts, options) {
  const policy = OPERATIONAL_EVIDENCE_POLICIES[expectedEvidenceType];
  if (!policy) return;
  validatePolicyThresholds(evidence, policy, missing);
  const verifiedRawArtifact = validateArtifactReference(
    evidence,
    evidence.rawArtifact,
    'rawArtifact',
    missing,
    verifiedArtifacts,
  );
  if (!verifiedRawArtifact) return;
  let raw;
  try {
    raw = JSON.parse(verifiedRawArtifact.contents.toString('utf8'));
  } catch (error) {
    missing.push(`rawArtifact valid JSON (${error instanceof Error ? error.message : String(error)})`);
    return;
  }
  const interval = validateRawArtifactEnvelope(
    raw,
    evidence,
    policy,
    missing,
    expectedEvidenceType !== 'restore-drill',
  );
  if (expectedEvidenceType === 'restore-drill') {
    const physical = validateRestoreRawArtifact(raw, evidence, interval, missing, options);
    const offsite = validateRestoreOffsiteArtifact(evidence, policy, missing, verifiedArtifacts, options);
    if (Number.isFinite(physical?.rpoMinutes) && Number.isFinite(offsite?.rpoMinutes)) {
      const rpoMinutes = Math.max(physical.rpoMinutes, offsite.rpoMinutes);
      validateSummaryMetric(evidence, 'rpoMinutes', rpoMinutes, missing);
      if (rpoMinutes > policy.thresholds.maxRpoMinutes) {
        missing.push(`worst-case restore RPO <= ${policy.thresholds.maxRpoMinutes} minutes (repository policy)`);
      }
    }
    if (Number.isFinite(physical?.rtoMinutes) && Number.isFinite(offsite?.rtoMinutes)) {
      const rtoMinutes = Math.max(physical.rtoMinutes, offsite.rtoMinutes);
      validateSummaryMetric(evidence, 'rtoMinutes', rtoMinutes, missing);
      if (rtoMinutes > policy.thresholds.maxRtoMinutes) {
        missing.push(`worst-case restore RTO <= ${policy.thresholds.maxRtoMinutes} minutes (repository policy)`);
      }
    }
  } else if (expectedEvidenceType === 'chaos-reconnect') {
    validateChaosRawArtifact(raw, evidence, policy, interval, missing);
  } else if (expectedEvidenceType === 'load-soak') {
    validateLoadRawArtifact(raw, evidence, policy, interval, missing);
  } else if (expectedEvidenceType === 'alertmanager-delivery') {
    validateAlertRawArtifact(raw, evidence, policy, interval, missing);
  }
}

function readReleaseManifestContract(manifestPath) {
  const contents = readFileSync(manifestPath, 'utf8');
  const imageDigests = {};
  const manifestValue = (key) => {
    const matches = contents.split(/\r?\n/).filter((line) => line.startsWith(`${key}=`));
    if (matches.length !== 1 || !matches[0].match(new RegExp(`^${key}=\\S+$`))) {
      throw new Error(`release manifest must contain exactly one unquoted ${key}= value`);
    }
    return matches[0].slice(key.length + 1);
  };
  const releaseSha = manifestValue('RELEASE_SHA');
  if (!RELEASE_SHA_PATTERN.test(releaseSha ?? '')) {
    throw new Error('release manifest is missing a full RELEASE_SHA');
  }
  const expectedSchemaMigration = manifestValue('EXPECTED_SCHEMA_MIGRATION');
  const expectedSchemaChecksum = manifestValue('EXPECTED_SCHEMA_CHECKSUM');
  if (!MIGRATION_BASENAME_PATTERN.test(expectedSchemaMigration)) {
    throw new Error('release manifest EXPECTED_SCHEMA_MIGRATION is invalid');
  }
  if (!SHA256_PATTERN.test(expectedSchemaChecksum)) {
    throw new Error('release manifest EXPECTED_SCHEMA_CHECKSUM is invalid');
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^(GAME|API|PLATFORM|MIGRATE|RETENTION|GATEWAY|OPS)_IMAGE=(\S+)$/);
    if (match) imageDigests[match[1].toLowerCase()] = match[2];
  }
  for (const image of REQUIRED_IMAGE_DIGESTS) {
    if (!IMAGE_DIGEST_PATTERN.test(imageDigests[image] ?? '')) {
      throw new Error(`release manifest is missing immutable ${image} image digest`);
    }
  }
  return {
    releaseSha: releaseSha.toLowerCase(),
    imageDigests,
    expectedSchemaMigration,
    expectedSchemaChecksum: expectedSchemaChecksum.toLowerCase(),
  };
}

function validateMeasurements(evidence, descriptor, missing) {
  const metrics = evidence?.metrics;
  const thresholds = evidence?.thresholds;
  const results = evidence?.results;
  const validMetrics = metrics && typeof metrics === 'object' && !Array.isArray(metrics);
  const validThresholds = thresholds && typeof thresholds === 'object' && !Array.isArray(thresholds);
  const validResults = results && typeof results === 'object' && !Array.isArray(results);
  if (!validMetrics) missing.push('metrics object');
  if (!validThresholds) missing.push('thresholds object');
  if (!validResults) missing.push('results object');
  if (!validMetrics || !validThresholds || !validResults) return;

  for (const [metricName, thresholdName, comparison] of descriptor.measurements.comparisons) {
    const metric = metrics[metricName];
    const threshold = thresholds[thresholdName];
    if (!Number.isFinite(metric)) missing.push(`metrics.${metricName} (finite number)`);
    if (!Number.isFinite(threshold)) missing.push(`thresholds.${thresholdName} (finite number)`);
    if (!Number.isFinite(metric) || !Number.isFinite(threshold)) continue;
    if (comparison === 'gte' && metric < threshold) {
      missing.push(`metrics.${metricName} >= thresholds.${thresholdName}`);
    }
    if (comparison === 'lte' && metric > threshold) {
      missing.push(`metrics.${metricName} <= thresholds.${thresholdName}`);
    }
  }
  for (const resultName of descriptor.measurements.results) {
    if (results[resultName] !== true) missing.push(`results.${resultName}: true`);
  }
  for (const [name, value] of Object.entries(metrics)) {
    if (!Number.isFinite(value)) missing.push(`metrics.${name} (finite number)`);
  }
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value)) missing.push(`thresholds.${name} (finite number)`);
  }
  for (const [name, value] of Object.entries(results)) {
    if (value !== true) missing.push(`results.${name}: true`);
  }
}

function validateProvenance(evidence, options, missing) {
  const provenance = evidence?.provenance;
  const validProvenance =
    provenance &&
    typeof provenance === 'object' &&
    RUN_ID_PATTERN.test(String(provenance.runId ?? '')) &&
    typeof provenance.repository === 'string' &&
    provenance.repository.trim() !== '' &&
    isHttpsUrl(provenance.runUrl);
  if (validProvenance) {
    if (options.evidenceRunId && String(provenance.runId) !== options.evidenceRunId) {
      missing.push(`provenance.runId matching ${options.evidenceRunId}`);
    }
    return;
  }
  if (isHttpsUrl(evidence?.signer) && !options.evidenceRunId) return;
  missing.push('provenance.runId/repository/HTTPS runUrl or signer HTTPS URL');
}

function inspectStagingEvidence(descriptor, stagingEvidenceDir, options) {
  const evidencePath = path.join(stagingEvidenceDir, descriptor.relativePath);
  if (!existsSync(evidencePath)) {
    return {
      status: 'blocked',
      reason: `missing staging evidence: ${descriptor.relativePath}`,
      evidencePath: descriptor.relativePath,
    };
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch (error) {
    return {
      status: 'blocked',
      reason: `staging evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      evidencePath: descriptor.relativePath,
    };
  }
  const missing = [];
  if (evidence?.schemaVersion !== 1) missing.push('schemaVersion: 1');
  if (evidence?.status !== 'passed') missing.push('status: "passed"');
  if (evidence?.environment !== 'staging') missing.push('environment: "staging"');
  if (evidence?.evidenceType !== descriptor.evidenceType) {
    missing.push(`evidenceType: "${descriptor.evidenceType}"`);
  }
  if (!RELEASE_SHA_PATTERN.test(evidence?.releaseSha ?? '')) {
    missing.push('releaseSha (full 40-character SHA)');
  } else if (evidence.releaseSha.toLowerCase() !== options.releaseSha.toLowerCase()) {
    missing.push(`releaseSha matching ${options.releaseSha}`);
  }
  if (!evidence?.imageDigests || typeof evidence.imageDigests !== 'object') {
    missing.push('imageDigests');
  } else {
    for (const image of REQUIRED_IMAGE_DIGESTS) {
      if (!IMAGE_DIGEST_PATTERN.test(evidence.imageDigests[image] ?? '')) {
        missing.push(`imageDigests.${image} (complete @sha256 reference)`);
      } else if (
        options.imageDigests &&
        evidence.imageDigests[image].toLowerCase() !== options.imageDigests[image].toLowerCase()
      ) {
        missing.push(`imageDigests.${image} matching the release manifest`);
      }
    }
  }
  const checkedAtMs = isoTimestamp(evidence?.checkedAt);
  if (checkedAtMs === undefined) {
    missing.push('checkedAt (ISO timestamp)');
  } else {
    if (checkedAtMs > options.nowMs) missing.push('checkedAt not in the future');
    else if (options.nowMs - checkedAtMs > options.maxEvidenceAgeHours * 60 * 60 * 1000) {
      missing.push(`checkedAt no older than ${options.maxEvidenceAgeHours} hours`);
    }
  }
  const startedAtMs = isoTimestamp(evidence?.startedAt);
  const finishedAtMs = isoTimestamp(evidence?.finishedAt);
  if (startedAtMs === undefined) missing.push('startedAt (ISO timestamp)');
  if (finishedAtMs === undefined) missing.push('finishedAt (ISO timestamp)');
  if (startedAtMs !== undefined && finishedAtMs !== undefined && finishedAtMs <= startedAtMs) {
    missing.push('finishedAt after startedAt');
  }
  if (finishedAtMs !== undefined && checkedAtMs !== undefined && finishedAtMs > checkedAtMs) {
    missing.push('finishedAt no later than checkedAt');
  }
  if (!Number.isFinite(evidence?.durationMs) || evidence.durationMs <= 0) {
    missing.push('durationMs (positive number)');
  } else if (
    startedAtMs !== undefined &&
    finishedAtMs !== undefined &&
    evidence.durationMs !== finishedAtMs - startedAtMs
  ) {
    missing.push('durationMs matching finishedAt - startedAt');
  }
  if (evidence?.source !== undefined && !isHttpUrl(evidence.source)) {
    missing.push('source as an HTTP(S) URL when provided');
  }
  if (evidence?.signer !== undefined && !isHttpUrl(evidence.signer)) {
    missing.push('signer as an HTTP(S) URL when provided');
  }
  validateProvenance(evidence, options, missing);
  validateMeasurements(evidence, descriptor, missing);
  const verifiedArtifacts = validateArtifacts(evidence, stagingEvidenceDir, missing);
  validateOperationalEvidence(evidence, descriptor.evidenceType, missing, verifiedArtifacts, options);
  if (descriptor.evidenceType === 'canary-rollback') {
    validateCanaryEvidence(evidence, missing, verifiedArtifacts);
  }
  if (missing.length > 0) {
    const problems = [...new Set(missing)];
    return {
      status: 'blocked',
      reason: `staging evidence contract incomplete; missing ${problems.join(', ')}`,
      evidencePath: descriptor.relativePath,
    };
  }
  return {
    status: 'passed',
    reason: 'validated staging evidence contract',
    evidencePath: descriptor.relativePath,
    startedAt: evidence.startedAt,
    finishedAt: evidence.finishedAt,
    durationMs: finishedAtMs - startedAtMs,
    checkedAt: evidence.checkedAt,
    releaseSha: evidence.releaseSha,
    source: evidence.source,
    signer: evidence.signer,
    artifacts: evidence.artifacts,
    metrics: evidence.metrics,
    thresholds: evidence.thresholds,
    results: evidence.results,
    provenance: evidence.provenance,
    ...(evidence.rollout === undefined ? {} : { rollout: evidence.rollout }),
  };
}

export function aggregateStatus(checks) {
  return checks.reduce(
    (current, check) => (STATUS_ORDER[check.status] > STATUS_ORDER[current] ? check.status : current),
    'passed',
  );
}

export function inspectStagingGates(stagingEvidenceDir, options = {}) {
  const directory = stagingEvidenceDir ? path.resolve(stagingEvidenceDir) : undefined;
  const releaseSha = options.releaseSha ?? gitValue(['rev-parse', 'HEAD']);
  if (!RELEASE_SHA_PATTERN.test(releaseSha)) throw new Error('release SHA must be a full 40-character commit SHA');
  const maxEvidenceAgeHours = options.maxEvidenceAgeHours ?? DEFAULT_MAX_EVIDENCE_AGE_HOURS;
  if (!Number.isFinite(maxEvidenceAgeHours) || maxEvidenceAgeHours <= 0) {
    throw new Error('max evidence age must be a positive number of hours');
  }
  const evidenceOptions = {
    releaseSha,
    maxEvidenceAgeHours,
    nowMs: options.nowMs ?? Date.now(),
    imageDigests: options.imageDigests,
    expectedSchemaMigration: options.expectedSchemaMigration,
    expectedSchemaChecksum: options.expectedSchemaChecksum,
    evidenceRunId: options.evidenceRunId,
  };
  return STAGING_GATES.map((descriptor) => {
    const result = directory
      ? inspectStagingEvidence(descriptor, directory, evidenceOptions)
      : {
          status: 'blocked',
          reason: `staging-only gate requires external evidence (${descriptor.relativePath}); no staging evidence directory supplied`,
          evidencePath: descriptor.relativePath,
        };
    return withCheckMetadata(descriptor.id, 'staging', `${descriptor.phase}: ${descriptor.title}`, result);
  });
}

function localChecks(run = runCommand, pipeline = runPipeline) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const fixtureEnv = { ...process.env, ...composeFixtureEnv() };
  const checks = [];
  checks.push(withCheckMetadata('verify', 'local', 'Full repository verification', run(npm, ['run', 'verify'])));
  checks.push(
    withCheckMetadata(
      'release-config',
      'config',
      'Immutable release configuration',
      run(npm, ['run', 'release:config']),
    ),
  );
  checks.push(
    withCheckMetadata(
      'operational-config',
      'config',
      'Operational and recovery configuration',
      run(npm, ['run', 'ops:config']),
    ),
  );
  for (const compose of COMPOSE_FILES) {
    checks.push(withCheckMetadata(compose.id, 'config', compose.title, run('docker', compose.args, fixtureEnv)));
  }
  checks.push(
    withCheckMetadata(
      'compose-staging-role-env',
      'config',
      'Rendered staging PostgreSQL/TLS/Redis role environment',
      pipeline(
        [
          {
            command: 'docker',
            args: ['compose', '-f', 'docker-compose.staging.yml', 'config', '--no-env-resolution', '--format', 'json'],
          },
          {
            command: 'jq',
            args: ['-c', '-f', 'scripts/project-compose-role-env.jq'],
          },
          {
            command: process.execPath,
            args: ['scripts/verify-compose-role-env.mjs', '--require-pgsslmode=verify-full', '--require-rediss'],
          },
        ],
        fixtureEnv,
      ),
    ),
  );
  checks.push(
    withCheckMetadata(
      'compose-server4-role-env',
      'config',
      'Rendered production PostgreSQL/TLS role environment',
      pipeline(
        [
          {
            command: 'docker',
            args: ['compose', '-f', 'docker-compose.server4.yml', 'config', '--no-env-resolution', '--format', 'json'],
          },
          {
            command: 'jq',
            args: ['-c', '-f', 'scripts/project-compose-role-env.jq'],
          },
          {
            command: process.execPath,
            args: ['scripts/verify-compose-role-env.mjs', '--require-pgsslmode=verify-full', '--require-rediss'],
          },
        ],
        fixtureEnv,
      ),
    ),
  );
  checks.push(
    withCheckMetadata(
      'compose-server4-slot-role-env',
      'config',
      'Rendered parallel server4 PostgreSQL/TLS/Redis role environment',
      pipeline(
        [
          {
            command: 'docker',
            args: [
              'compose',
              '-f',
              'docker-compose.server4-slot.yml',
              'config',
              '--no-env-resolution',
              '--format',
              'json',
            ],
          },
          {
            command: 'jq',
            args: ['-c', '-f', 'scripts/project-compose-role-env.jq'],
          },
          {
            command: process.execPath,
            args: ['scripts/verify-compose-role-env.mjs', '--require-pgsslmode=verify-full', '--require-rediss'],
          },
        ],
        fixtureEnv,
      ),
    ),
  );
  checks.push(
    withCheckMetadata(
      'docker-runtime-contract',
      'local',
      'Docker runtime image contract tests',
      run(npm, ['exec', '--', 'vitest', 'run', 'scripts/__tests__/docker-runtime-contract.test.ts']),
    ),
  );
  return checks;
}

export function renderMarkdown(summary) {
  const lines = [
    '# Release Gate Evidence',
    '',
    `- Overall: **${summary.status.toUpperCase()}**`,
    `- Generated: ${summary.generatedAt}`,
    `- Repository: \`${summary.repository}\``,
    `- Commit: \`${summary.commit}\``,
    `- Evidence release: \`${summary.releaseSha ?? summary.commit}\``,
    '',
    '| Category | Check | Status | Reason |',
    '| --- | --- | --- | --- |',
  ];
  for (const check of summary.checks) {
    lines.push(
      `| ${check.category} | ${check.title} | **${check.status.toUpperCase()}** | ${String(check.reason).replaceAll('|', '\\|')} |`,
    );
  }
  lines.push('', '## Interpretation', '');
  if (summary.status === 'passed') lines.push('All required local and staging evidence gates passed.');
  else if (summary.status === 'blocked') {
    lines.push(
      'Release is blocked. Resolve every blocked evidence gate before deployment; blocked is not a release approval.',
    );
  } else
    lines.push('Release is failed. Fix failed checks and rerun the gate; staging evidence cannot override a failure.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function gitValue(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

export function createSummary(checks, options = {}) {
  const commit = gitValue(['rev-parse', 'HEAD']);
  return {
    schemaVersion: 1,
    generatedAt: nowIso(),
    repository: path.basename(ROOT),
    commit,
    releaseSha: options.releaseSha ?? commit,
    maxEvidenceAgeHours: options.maxEvidenceAgeHours ?? DEFAULT_MAX_EVIDENCE_AGE_HOURS,
    status: aggregateStatus(checks),
    checks,
  };
}

export function writeEvidence(summary, evidenceDir, format = 'both') {
  mkdirSync(evidenceDir, { recursive: true });
  const written = [];
  if (format === 'json' || format === 'both') {
    const jsonPath = path.join(evidenceDir, 'release-gate.json');
    writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    written.push(jsonPath);
  }
  if (format === 'markdown' || format === 'both') {
    const markdownPath = path.join(evidenceDir, 'release-gate.md');
    writeFileSync(markdownPath, renderMarkdown(summary), 'utf8');
    written.push(markdownPath);
  }
  return written;
}

export async function runReleaseGate(options = {}, dependencies = {}) {
  const run = dependencies.run ?? runCommand;
  const pipeline = dependencies.pipeline ?? runPipeline;
  const manifest = options.releaseManifest ? readReleaseManifestContract(options.releaseManifest) : undefined;
  const releaseSha = options.releaseSha ?? manifest?.releaseSha ?? gitValue(['rev-parse', 'HEAD']);
  if (manifest && manifest.releaseSha !== releaseSha.toLowerCase()) {
    throw new Error(`release manifest RELEASE_SHA ${manifest.releaseSha} does not match requested ${releaseSha}`);
  }
  const imageDigests = manifest?.imageDigests ?? options.imageDigests;
  const maxEvidenceAgeHours = options.maxEvidenceAgeHours ?? DEFAULT_MAX_EVIDENCE_AGE_HOURS;
  const checks = [
    ...localChecks(run, pipeline),
    ...inspectStagingGates(options.stagingEvidenceDir, {
      releaseSha,
      maxEvidenceAgeHours,
      imageDigests,
      expectedSchemaMigration: manifest?.expectedSchemaMigration ?? options.expectedSchemaMigration,
      expectedSchemaChecksum: manifest?.expectedSchemaChecksum ?? options.expectedSchemaChecksum,
      evidenceRunId: options.evidenceRunId,
    }),
  ];
  const summary = createSummary(checks, { releaseSha, maxEvidenceAgeHours });
  const evidenceDir = options.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const written = writeEvidence(summary, evidenceDir, options.format ?? 'both');
  return { ...summary, evidenceDir, written };
}

function printHelp() {
  console.log(
    `Usage: npm run release:gate -- [options]\n\nOptions:\n  --evidence-dir DIR          Write release-gate.json/.md here (default: .release-evidence)\n  --staging-evidence-dir DIR  Read validated staging/*.json evidence from here\n  --release-sha SHA           Bind evidence to this full SHA (default: current HEAD)\n  --release-manifest FILE     Bind staging image digests to a verified .release.env manifest\n  --evidence-run-id ID        Require staging provenance to match this CI run ID\n  --max-evidence-age-hours N  Reject older staging evidence (default: 168)\n  --format FORMAT             json, markdown, or both (default: both)\n  --help                      Show this help\n\nExit codes:\n  0  all required gates passed\n  1  one or more local/config gates failed\n  2  no failures, but one or more staging evidence gates are blocked`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs();
    if (options.help) {
      printHelp();
      process.exit(0);
    }
    const summary = await runReleaseGate(options);
    console.log(`release gate: ${summary.status}`);
    for (const file of summary.written) console.log(`evidence: ${file}`);
    process.exitCode = summary.status === 'passed' ? 0 : summary.status === 'blocked' ? 2 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
