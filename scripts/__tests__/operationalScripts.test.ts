import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSyntheticProbe } from '../synthetic-probe.mjs';

const scripts = [
  'pg-backup.sh',
  'pg-base-backup.sh',
  'pg-wal-archive.sh',
  'pg-wal-restore.sh',
  'pg-restore-drill.sh',
  'postgres-init-roles.sh',
  'postgres-role-smoke.sh',
  'compose-chaos-drill.sh',
  'deploy-server4.sh',
  'server4-recovery-drill.sh',
];

describe('operational shell scripts', () => {
  it.each(scripts)('%s has valid Bash syntax', (script) => {
    expect(() => execFileSync('bash', ['-n', resolve('scripts', script)], { timeout: 5_000 })).not.toThrow();
  });

  it('rejects unsafe WAL archive names before invoking external upload tools', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-wal-test-'));
    const walPath = resolve(directory, 'wal');
    writeFileSync(walPath, 'test');
    const result = spawnSync('bash', [resolve('scripts/pg-wal-archive.sh'), walPath, '../escape'], {
      encoding: 'utf8',
      env: { ...process.env, PG_BACKUP_METRICS_DIR: directory },
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('invalid WAL file name');
  });

  it('requires a pinned image before a restore drill can start Docker', () => {
    const result = spawnSync('bash', [resolve('scripts/pg-restore-drill.sh'), '/tmp/example.dump.age'], {
      encoding: 'utf8',
      env: { ...process.env, PG_RESTORE_DRILL_IMAGE: '' },
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('explicitly pinned @sha256 image reference');
  });

  it('requires attributable fixtures before a release restore drill can start Docker', () => {
    const result = spawnSync('bash', [resolve('scripts/pg-restore-drill.sh'), '/tmp/example.dump.age'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PG_RESTORE_DRILL_IMAGE: `postgres@sha256:${'a'.repeat(64)}`,
        PG_RESTORE_RELEASE_EVIDENCE: 'true',
      },
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('evidence_output is required');
  });

  it('requires chat, feedback, and boardgame fixtures before a release restore drill can start Docker', () => {
    const result = spawnSync('bash', [resolve('scripts/pg-restore-drill.sh'), '/tmp/example.dump.age'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PG_RESTORE_DRILL_IMAGE: `postgres@sha256:${'a'.repeat(64)}`,
        PG_RESTORE_RELEASE_EVIDENCE: 'true',
        PG_RESTORE_EVIDENCE_OUTPUT: '/tmp/restore-drill.json',
        RELEASE_SHA: 'b'.repeat(40),
        PG_RESTORE_BACKUP_COMPLETED_AT: '2026-07-31T00:00:00.000Z',
        PG_RESTORE_INCIDENT_AT: '2026-07-31T00:01:00.000Z',
        PG_RESTORE_EXPECT_ACCOUNT_ID: 'u_release_fixture',
        PG_RESTORE_EXPECT_DECK_ID: 'deck_release_fixture',
        PG_RESTORE_EXPECT_MATCH_ID: 'match_release_fixture',
        PG_RESTORE_EXPECT_LEADERBOARD_USER_ID: 'u_release_fixture',
        EXPECTED_SCHEMA_MIGRATION: '000047_knowledge_search_zero_results',
        EXPECTED_SCHEMA_CHECKSUM: 'c'.repeat(64),
      },
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('expected_chat_message_id is required');
  });

  it('routes logical and physical backups through separate PostgreSQL roles', () => {
    expect(readFileSync(resolve('scripts/pg-backup.sh'), 'utf8')).toContain(
      'PG_USER="${PG_BACKUP_USER:-${PG_USER:-zutomayo_backup}}"',
    );
    expect(readFileSync(resolve('scripts/pg-base-backup.sh'), 'utf8')).toContain(
      'PG_USER="${PG_WAL_USER:-${PG_BASE_BACKUP_USER:-${PG_USER:-zutomayo_wal}}}"',
    );
  });

  it('runs the real PostgreSQL/Redis outbox and social race smoke after role bootstrap', () => {
    const smoke = readFileSync(resolve('scripts/postgres-role-smoke.sh'), 'utf8');
    expect(smoke).toContain("grep -qx '1'");
    expect(smoke).toContain('migrate npm run relationship:outbox:pg-smoke');
    expect(smoke).toContain('api node social-concurrency-pg-smoke.cjs');
  });

  it('writes a structured failed deployment-smoke receipt', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-deploy-smoke-'));
    const reportPath = resolve(directory, 'smoke.json');
    const result = spawnSync(
      process.execPath,
      [
        resolve('scripts/deploy-smoke.mjs'),
        '--host',
        '127.0.0.1',
        '--game-port',
        '1',
        '--api-port',
        '1',
        '--platform-port',
        '1',
        '--attempts',
        '1',
        '--timeout-ms',
        '50',
        '--retry-delay-ms',
        '0',
        '--report-path',
        reportPath,
      ],
      { encoding: 'utf8', timeout: 5_000 },
    );
    expect(result.status).not.toBe(0);
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      status: 'failed',
      checks: {
        healthReady: false,
        buildIdentityVerified: false,
        datasetIdentityVerified: false,
        applicationSmokePassed: false,
        battleAssetsVerified: false,
        smokePassed: false,
      },
    });
  });

  it('keeps the server4 beta deployment backup, Redis, asset, and health gates', () => {
    const deploy = readFileSync(resolve('scripts/deploy-server4.sh'), 'utf8');
    const compose = readFileSync(resolve('docker-compose.server4.yml'), 'utf8');
    const smoke = readFileSync(resolve('scripts/deploy-smoke.mjs'), 'utf8');
    const assetChecksums = readFileSync(resolve('scripts/battle-assets.sha256'), 'utf8').trim().split('\n');
    expect(deploy).toContain('git reset --hard origin/master');
    expect(deploy).toContain('pg_dump');
    expect(deploy).toContain('--format=custom');
    expect(deploy).toContain('sha256sum --check');
    expect(deploy).toContain('extract_redis_db');
    expect(deploy).toContain('CONFIG GET maxmemory-policy');
    expect(deploy).toContain('noeviction');
    expect(deploy).toContain('build --pull migrate');
    expect(deploy).toContain('build --pull game api platform');
    expect(deploy.indexOf('build --pull migrate')).toBeLessThan(deploy.indexOf('build --pull game api platform'));
    expect(deploy).toContain('public-card-dataset-preflight.ts');
    expect(deploy).toContain('record_card_dataset_sha256');
    expect(deploy).toContain('operator-provided card dataset SHA-256 does not match preflight');
    expect(deploy.indexOf('preflight_card_dataset ||')).toBeLessThan(deploy.indexOf('remote_build_runtime ||'));
    expect(deploy).toContain('up -d --wait');
    expect(deploy).toContain('battle-assets.sha256');
    expect(deploy).toContain('sync_battle_assets');
    expect(deploy).toContain('release_official_rulings');
    expect(deploy).toContain('OFFICIAL_RULE_DOCUMENTS_SOURCE');
    expect(deploy).toContain('release_official_rule_documents');
    expect(deploy).toContain('OFFICIAL_RULE_DOCUMENTS_FILE');
    expect(deploy).toContain('release_card_derived_effects');
    expect(deploy).toContain('CARD_DERIVED_EFFECTS_REVIEW_SOURCE');
    expect(deploy).toContain('import-card-derived-effects-pg.ts');
    expect(deploy).toContain('release_reviewed_unlisted_cards');
    expect(deploy).toContain('CARD_UNLISTED_RELEASE_SOURCE');
    expect(deploy).toContain('release-reviewed-unlisted-cards.ts');
    expect(deploy).toContain('audit-reviewed-unlisted-cards.ts');
    expect(deploy).toContain('prepare_external_meilisearch');
    expect(deploy).toContain("docker inspect '$MEILI_CONTAINER'");
    expect(deploy).toContain('docker compose up -d --force-recreate meilisearch');
    expect(deploy).toContain('1Panel Meilisearch key does not match the running container');
    expect(deploy).toContain('external Meilisearch master key changed during recreation');
    expect(deploy).toContain('1panel-network');
    expect(deploy).toContain('no_analytics = true');
    expect(deploy).toContain("sed -i 's/^env = .*/env =");
    expect(deploy).toContain('host_binding');
    expect(deploy).toContain('127.0.0.1');
    expect(compose).toContain('MEILI_HOST=http://meilisearch:7700');
    expect(compose).not.toMatch(/^ {2}meilisearch:/m);
    expect(compose).not.toContain('meili-data');
    expect(deploy.indexOf('release_reviewed_unlisted_cards ||')).toBeLessThan(
      deploy.indexOf('release_card_derived_names ||'),
    );
    expect(deploy.indexOf('release_card_derived_names ||')).toBeLessThan(
      deploy.indexOf('release_card_derived_effects ||'),
    );
    expect(deploy).toContain('scripts/import-card-derived-names-pg.ts');
    expect(deploy).toContain('--translations=-');
    expect(deploy).toContain('COPYFILE_DISABLE=1 tar');
    expect(deploy).toContain("-name '._*' -delete");
    expect(deploy).toContain('sha256sum --check');
    expect(deploy).toContain('--check-battle-assets true');
    expect(deploy).toContain('--public-base-url');
    expect(deploy).toContain('PUBLIC_SMOKE_BASE_URL');
    expect(deploy).toContain('cloudflare:cache:apply');
    expect(deploy).toContain('CLOUDFLARE_CACHE_RULES_REQUIRED');
    expect(deploy).toContain('cache-policy-smoke.ts');
    expect(deploy).toContain('DIRECT_SMOKE_ADDRESS');
    expect(deploy).toContain('DEPLOY_SMOKE_REPORT_PATH');
    expect(deploy).toContain('VITE_CARD_DATASET_SHA256:-');
    expect(deploy).toContain("upsert_env ALLOWED_ORIGINS '$SERVER4_ALLOWED_ORIGIN'");
    expect(deploy).toContain('ALLOWED_ORIGINS must contain only the production HTTPS origin');
    expect(deploy).toContain('--expected-dataset-sha256');
    expect(compose).toContain('CARD_DATASET_SHA256=${VITE_CARD_DATASET_SHA256:-}');
    expect(compose).toContain('MATCH_ANALYTICS_TRAFFIC_CLASS=production');
    const stagingCompose = readFileSync(resolve('docker-compose.staging.yml'), 'utf8');
    expect(stagingCompose).toContain('CARD_DATASET_SHA256=${VITE_CARD_DATASET_SHA256:?');
    expect(stagingCompose).toContain('MATCH_ANALYTICS_TRAFFIC_CLASS=synthetic');
    expect(smoke).toContain("args.get('expected-dataset-sha256')");
    expect(smoke).toContain('datasetIdentityVerified');
    expect(deploy).not.toContain('--rollback');
    expect(deploy).not.toContain('rollback_and_smoke');
    expect(deploy).not.toContain('.env.previous');
    expect(deploy).not.toContain('$COMPOSE_FILE.previous');
    expect(compose).toContain('${BATTLE_ASSET_DIR:-./public/battle}:/app/dist/battle:ro');
    expect(smoke).toContain("new URL('./battle-assets.sha256', import.meta.url)");
    expect(smoke).toContain('assertBattleAssetPayload');
    expect(smoke).toContain('publicBaseUrl');
    expect(smoke).toContain('if (checkBattleAssets)');
    expect(smoke).toContain("args.get('report-path')");
    expect(smoke).toContain('/api/official/status');
    expect(assetChecksums).toHaveLength(22);
    expect(assetChecksums.every((line) => /^[a-f0-9]{64} {2}[A-Za-z0-9._/-]+\.(png|svg)$/.test(line))).toBe(true);
    expect(deploy).not.toContain('--manifest');
    expect(deploy).not.toContain('cosign');
    expect(deploy).not.toContain('attestation');
  });

  it('manages cache rules without embedding Cloudflare credentials', () => {
    const rules = readFileSync(resolve('scripts/cloudflare-cache-rules.ts'), 'utf8');
    const smoke = readFileSync(resolve('scripts/cache-policy-smoke.ts'), 'utf8');
    expect(rules).toContain('zutomayo-cache-');
    expect(rules).toContain('http_request_cache_settings');
    expect(rules).toContain('CLOUDFLARE_API_TOKEN');
    expect(rules).toContain("mode: 'respect_origin'");
    expect(rules).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/);
    expect(smoke).toContain('direct-address');
    expect(smoke).toContain('servername: url.hostname');
    expect(smoke).toContain('CF-Cache-Status'.toLowerCase());
  });

  it('keeps source recovery staging-only and reuses the normal deploy path', () => {
    const recovery = readFileSync(resolve('scripts/server4-recovery-drill.sh'), 'utf8');
    expect(recovery).toContain('DEPLOY_ENVIRONMENT=staging');
    expect(recovery).toContain('RECOVERY_CONFIRM=source-redeploy-staging');
    expect(recovery).toContain("!= '149.104.6.238'");
    expect(recovery).toContain('stop game api platform');
    expect(recovery).toContain('deploy-server4.sh');
    expect(recovery).toContain('RECOVERY_DATASET_SHA256');
    expect(recovery).toContain('RECOVERY_MATCH_IMPACT_REPORT');
    expect(recovery).toContain('preDeployBackupVerified');
    expect(recovery).toContain('sourceCheckoutVerified');
    expect(recovery).toContain('datasetIdentityVerified');
    expect(recovery).toContain('buildIdentityVerified');
    expect(recovery).toContain('battleAssetsVerified');
    expect(recovery).toContain('websocketOutcomeVerified');
    expect(recovery).toContain('smokePassed');
  });

  it('rejects an unknown migration subcommand instead of defaulting to up', () => {
    const result = spawnSync(process.execPath, [resolve('scripts/db-migrate.cjs'), 'apply'], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('<up|down|create>');
  });

  it('rejects production migration and retention URLs owned by the wrong role before connecting', () => {
    const migrationEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      PGSSLMODE: 'verify-full',
      PG_MIGRATION_USER: 'zutomayo_migrator',
      DATABASE_URL: 'postgres://zutomayo_api:secret@db.example/zutomayo',
      EXPECTED_SCHEMA_MIGRATION: '000024_test',
      EXPECTED_SCHEMA_CHECKSUM: 'a'.repeat(64),
    };
    delete migrationEnv.PG_USER;
    const schemaResult = spawnSync(process.execPath, [resolve('scripts/db-schema-gate.cjs')], {
      encoding: 'utf8',
      env: migrationEnv,
      timeout: 5_000,
    });
    expect(schemaResult.status).toBe(1);
    expect(schemaResult.stderr).toContain('DATABASE_URL username must match PG_MIGRATION_USER');

    const retentionEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      PGSSLMODE: 'verify-full',
      PG_RETENTION_USER: 'zutomayo_retention',
      PG_USER: 'zutomayo_api',
    };
    delete retentionEnv.DATABASE_URL;
    const retentionResult = spawnSync(process.execPath, [resolve('scripts/run-retention.cjs')], {
      encoding: 'utf8',
      env: retentionEnv,
      timeout: 5_000,
    });
    expect(retentionResult.status).toBe(1);
    expect(retentionResult.stderr).toContain('PG_USER must match PG_RETENTION_USER');
  });

  it('fails closed when the production synthetic probe has no credentials', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-synthetic-config-test-'));
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
    delete env.SYNTHETIC_EMAIL;
    delete env.SYNTHETIC_PASSWORD;
    delete env.SYNTHETIC_SESSION_COOKIE;
    env.SYNTHETIC_METRICS_FILE = resolve(directory, 'synthetic.prom');
    const result = spawnSync(process.execPath, [resolve('scripts/synthetic-probe.mjs')], {
      encoding: 'utf8',
      env,
      timeout: 5_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('synthetic production probe requires');
  });

  it('does not hide Cloudflare analytics CSP violations from browser QA', () => {
    const benchmark = readFileSync(resolve('scripts/ai-browser-benchmark.mjs'), 'utf8');
    expect(benchmark).not.toContain('static.cloudflareinsights.com');
    expect(benchmark).not.toContain('isIgnorableConsoleError');
    expect(benchmark).toContain("if (message.type() === 'error') consoleErrors.push(message.text())");
  });
});

describe('synthetic probe script', () => {
  it('has valid Node syntax', () => {
    expect(() => execFileSync(process.execPath, ['--check', resolve('scripts/synthetic-probe.mjs')])).not.toThrow();
  });

  it('reports configuration failures without erasing the previous success timestamp', async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-synthetic-metrics-test-'));
    const metricsFile = resolve(directory, 'synthetic.prom');
    writeFileSync(metricsFile, 'zutomayo_synthetic_probe_last_success_unixtime_seconds 1700000000\n');

    await expect(
      runSyntheticProbe({
        env: {
          NODE_ENV: 'production',
          SYNTHETIC_METRICS_FILE: metricsFile,
        },
        clock: { now: () => 1_800_000_000_000 },
      }),
    ).rejects.toThrow('synthetic production probe requires');

    const metrics = readFileSync(metricsFile, 'utf8');
    expect(metrics).toContain('zutomayo_synthetic_probe_success 0');
    expect(metrics).toContain('zutomayo_synthetic_probe_last_run_unixtime_seconds 1800000000');
    expect(metrics).toContain('zutomayo_synthetic_probe_last_success_unixtime_seconds 1700000000');
    expect(metrics).toContain('zutomayo_synthetic_probe_step_success{step="config"} 0');
  });

  it('preserves the previous success timestamp when the player journey fails', async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-synthetic-journey-test-'));
    const metricsFile = resolve(directory, 'synthetic.prom');
    writeFileSync(metricsFile, 'zutomayo_synthetic_probe_last_success_unixtime_seconds 1700000000\n');

    await expect(
      runSyntheticProbe({
        env: {
          NODE_ENV: 'production',
          SYNTHETIC_SESSION_COOKIE: 'zutomayo_session=synthetic-token',
          SYNTHETIC_METRICS_FILE: metricsFile,
        },
        fetchImpl: async () => {
          throw new Error('synthetic network failure');
        },
        clock: { now: () => 1_800_000_000_000 },
      }),
    ).rejects.toThrow('synthetic network failure');

    const metrics = readFileSync(metricsFile, 'utf8');
    expect(metrics).toContain('zutomayo_synthetic_probe_success 0');
    expect(metrics).toContain('zutomayo_synthetic_probe_last_success_unixtime_seconds 1700000000');
    expect(metrics).toContain('zutomayo_synthetic_probe_step_success{step="homepage"} 0');
  });
});
