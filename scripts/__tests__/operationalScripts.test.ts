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
    expect(deploy).toContain('build --pull migrate game api platform');
    expect(deploy).toContain('up -d --wait');
    expect(deploy).toContain('battle-assets.sha256');
    expect(deploy).toContain('sync_battle_assets');
    expect(deploy).toContain('COPYFILE_DISABLE=1 tar');
    expect(deploy).toContain("-name '._*' -delete");
    expect(deploy).toContain('sha256sum --check');
    expect(deploy).toContain('--check-battle-assets true');
    expect(deploy).not.toContain('--rollback');
    expect(deploy).not.toContain('rollback_and_smoke');
    expect(deploy).not.toContain('.env.previous');
    expect(deploy).not.toContain('$COMPOSE_FILE.previous');
    expect(compose).toContain('${BATTLE_ASSET_DIR:-./public/battle}:/app/dist/battle:ro');
    expect(smoke).toContain('/battle/chronos.svg');
    expect(smoke).toContain('/battle/medal.png');
    expect(smoke).toContain('if (checkBattleAssets)');
    expect(assetChecksums).toHaveLength(22);
    expect(assetChecksums.every((line) => /^[a-f0-9]{64} {2}[A-Za-z0-9._/-]+\.(png|svg)$/.test(line))).toBe(true);
    expect(deploy).not.toContain('--manifest');
    expect(deploy).not.toContain('cosign');
    expect(deploy).not.toContain('attestation');
  });

  it('keeps source recovery staging-only and reuses the normal deploy path', () => {
    const recovery = readFileSync(resolve('scripts/server4-recovery-drill.sh'), 'utf8');
    expect(recovery).toContain('DEPLOY_ENVIRONMENT=staging');
    expect(recovery).toContain('RECOVERY_CONFIRM=source-redeploy-staging');
    expect(recovery).toContain("!= '149.104.6.238'");
    expect(recovery).toContain('stop game api platform');
    expect(recovery).toContain('deploy-server4.sh');
    expect(recovery).toContain('sourceCheckoutVerified');
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
