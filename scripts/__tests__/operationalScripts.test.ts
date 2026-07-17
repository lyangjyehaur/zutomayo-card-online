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
];
const hasDockerCompose = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

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

  it('routes logical and physical backups through separate PostgreSQL roles', () => {
    expect(readFileSync(resolve('scripts/pg-backup.sh'), 'utf8')).toContain(
      'PG_USER="${PG_BACKUP_USER:-${PG_USER:-zutomayo_backup}}"',
    );
    expect(readFileSync(resolve('scripts/pg-base-backup.sh'), 'utf8')).toContain(
      'PG_USER="${PG_WAL_USER:-${PG_BASE_BACKUP_USER:-${PG_USER:-zutomayo_wal}}}"',
    );
  });

  it('runs real PostgreSQL outbox, social race, and deletion anonymization smokes after role bootstrap', () => {
    const smoke = readFileSync(resolve('scripts/postgres-role-smoke.sh'), 'utf8');
    const compose = readFileSync(resolve('docker-compose.yml'), 'utf8');
    const concurrencySmoke = readFileSync(resolve('docker-compose.postgres-concurrency-smoke.yml'), 'utf8');
    expect(smoke).toContain('PG_BOOTSTRAP_USER');
    expect(smoke).toContain('PG_PASSWORD="${PG_PASSWORD:-$PG_APP_PASSWORD}"');
    expect(smoke).toContain('export PG_DATABASE PG_APP_USER PG_APP_PASSWORD PG_PASSWORD');
    expect(smoke).toContain('migration owner is still a superuser');
    expect(compose).toContain('POSTGRES_USER: ${PG_BOOTSTRAP_USER:-${PG_MIGRATION_USER:-zutomayo}}');
    expect(smoke).toContain("grep -qx '1'");
    expect(smoke).toContain('migrate npm run relationship:outbox:pg-smoke');
    expect(smoke).toContain('migrate npm run db:migration-lineage:smoke');
    expect(smoke).toContain('migrate npm run db:platform-schema:smoke');
    expect(smoke).toContain('lineage_database="${PG_DATABASE}_lineage"');
    expect(smoke).toContain('--env REQUIRE_APP_ROLE_GATE=false');
    expect(smoke).toContain('REDIS_DB="${REDIS_DB:-7}"');
    expect(smoke).toContain('--env REDIS_DB="$REDIS_DB"');
    expect(smoke).toContain('api node social-concurrency-pg-smoke.cjs');
    expect(smoke).toContain('--env NODE_ENV=test api node account-deletion-pg-smoke.cjs');
    expect(smoke).toContain('"${source_smoke_compose[@]}" run --build --rm --no-deps boardgame-metadata-pg-smoke');
    expect(smoke).toContain('migrate node scripts/admin-credential-pg-smoke.cjs');
    expect(smoke).toContain('ADMIN_CREDENTIAL_PG_SMOKE_ALLOW_REMOTE=true');
    expect(concurrencySmoke).toContain('target: builder');
    expect(concurrencySmoke).toContain(
      "command: ['node', '--import', 'tsx', 'scripts/boardgame-metadata-pg-smoke.ts']",
    );
    expect(concurrencySmoke).not.toContain('target: runtime');
  });

  it('requires signed official card data completeness in logical and PITR restore evidence', () => {
    const logicalRestore = readFileSync(resolve('scripts/pg-restore-drill.sh'), 'utf8');
    expect(logicalRestore).toContain('[[ "$cards_count" == 422 ]]');
    expect(logicalRestore).toContain('official_card_data_releases');
    expect(logicalRestore).toContain('missing_official_english_names');
    expect(logicalRestore).toContain('missing_official_english_effects');
    expect(logicalRestore).toContain('[[ "$official_errata_count" == 12 ]]');
  });

  it.skipIf(!hasDockerCompose)('renders the E2E PostgreSQL healthcheck against the overlay database', () => {
    const result = spawnSync(
      'docker',
      [
        'compose',
        '-f',
        'docker-compose.yml',
        '-f',
        'docker-compose.e2e.yml',
        'config',
        '--no-interpolate',
        '--format',
        'json',
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.status, result.stderr).toBe(0);
    const config = JSON.parse(result.stdout);
    expect(config.services.postgres.environment).toContain('POSTGRES_DB=zutomayo_e2e');
    expect(config.services.postgres.healthcheck.test).toEqual([
      'CMD-SHELL',
      'pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"',
    ]);
  });

  it('runs the E2E runner separately from successful one-shot dependencies', () => {
    const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
    const browserMatrix = readFileSync(resolve('.github/workflows/e2e-matrix.yml'), 'utf8');
    expect(workflow).toContain('"${compose[@]}" build');
    expect(workflow).toContain('"${compose[@]}" run --rm e2e');
    expect(workflow).toContain('PG_BOOTSTRAP_USER: zutomayo_e2e_bootstrap');
    expect(workflow).toContain('EXPECTED_SCHEMA_MIGRATION: 000031_official_card_data_releases');
    expect(workflow).toContain(
      'EXPECTED_SCHEMA_CHECKSUM: 172b810651446e91d5ba371e4ee7d6b046c2b76aa8a131dfec014e7fd742b4b8',
    );
    expect(browserMatrix).toContain('PG_BOOTSTRAP_USER: zutomayo_e2e_bootstrap');
    expect(browserMatrix).toContain('EXPECTED_SCHEMA_MIGRATION: 000031_official_card_data_releases');
    expect(browserMatrix).toContain(
      'EXPECTED_SCHEMA_CHECKSUM: 172b810651446e91d5ba371e4ee7d6b046c2b76aa8a131dfec014e7fd742b4b8',
    );
    expect(browserMatrix).not.toContain('export EXPECTED_SCHEMA_MIGRATION=');
    expect(workflow).not.toContain('--abort-on-container-exit');
    expect(workflow).not.toContain('--exit-code-from e2e');
  });

  it('makes authenticated ranked multiplayer mandatory in the Docker E2E stack', () => {
    const compose = readFileSync(resolve('docker-compose.e2e.yml'), 'utf8');
    const spec = readFileSync(resolve('e2e/authenticated-multiplayer.spec.ts'), 'utf8');

    expect(compose).toContain('VITE_PLATFORM_URL: ws://platform.e2e.test:3002');
    expect(compose).toContain('AUTH_COOKIE_DOMAIN=.e2e.test');
    expect(compose).toContain('PLATFORM_PUBLIC_ADDRESS=ws://platform.e2e.test:3002');
    expect(compose).toContain('ALLOWED_ORIGINS=http://game.e2e.test:3000');
    expect(compose).toContain('E2E_BASE_URL=http://game.e2e.test:3000');
    expect(compose).toContain('E2E_PLATFORM_COOKIE_SHARED=1');
    expect(compose).toContain('E2E_AUTHENTICATED_MULTIPLAYER=1');
    expect(compose).toContain('E2E_RANKED_MATCHES_ENABLED=1');
    expect(compose).toContain('RANKED_MATCHES_ENABLED=true');
    expect(compose).toContain('GAME_BACKGROUND_WORKERS_ENABLED=true');
    expect(spec).toContain('Authenticated multiplayer is required but misconfigured');
    expect(spec).not.toContain('test.skip');
  });

  it('gates the rendered production role/TLS environment before migration', () => {
    const deploy = readFileSync(resolve('scripts/deploy-server4.sh'), 'utf8');
    expect(deploy).toContain('verify-compose-role-env.mjs $ROLE_ENV_VALIDATOR_ARGS');
    expect(deploy).toContain('jq -c -f scripts/project-compose-role-env.jq');
    expect(deploy).toContain("ROLE_ENV_VALIDATOR_ARGS='--require-pgsslmode=verify-full --require-rediss'");
    expect(deploy).toContain('node --import tsx "$SCRIPT_DIR/platform-deployment-smoke.ts"');
    expect(deploy).toContain('--expected-public-address "$platform_public_address"');
    expect(deploy).toContain('--bootstrap');
  });

  it('imports and gates the signed official card dataset before server4 applications start', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const server4 = readFileSync(resolve('docker-compose.server4.yml'), 'utf8');
    const server4Slot = readFileSync(resolve('docker-compose.server4-slot.yml'), 'utf8');
    const staging = readFileSync(resolve('docker-compose.staging.yml'), 'utf8');
    const localCompose = readFileSync(resolve('docker-compose.yml'), 'utf8');
    const importer = readFileSync(resolve('scripts/import-card-official-texts-pg.ts'), 'utf8');
    const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');

    expect(packageJson.scripts.verify).toContain('npm run data:policy');
    expect(packageJson.scripts['db:migrate:release']).toContain('scripts/backfill-legacy-deleted-accounts-pg.cjs');
    expect(packageJson.scripts['db:migrate:release']).toContain('scripts/release-card-data.cjs');
    expect(server4).toContain('REQUIRE_OFFICIAL_CARD_DATA=true');
    expect(server4).toContain('RELEASE_SHA=${RELEASE_SHA:');
    expect(server4Slot).toContain("REQUIRE_OFFICIAL_CARD_DATA: 'true'");
    expect(server4Slot).toContain('RELEASE_SHA: ${RELEASE_SHA:');
    expect(staging).toContain('REQUIRE_OFFICIAL_CARD_DATA=true');
    expect(staging).toContain('RELEASE_SHA=${RELEASE_SHA:');
    expect(localCompose).toContain('REQUIRE_OFFICIAL_CARD_DATA=${REQUIRE_OFFICIAL_CARD_DATA:-false}');
    for (const compose of [server4, server4Slot, staging, localCompose]) {
      expect(compose).toContain('LEGACY_TOMBSTONE_BACKFILL_APPROVED');
      expect(compose).toContain('LEGACY_TOMBSTONE_BACKFILL_EXPECTED_COUNT');
    }
    expect(importer).toContain("assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER')");
    expect(importer).toContain('postgresConnectionString(process.env)');
    expect(importer).toContain('ssl: postgresSslConfig(process.env)');
    expect(importer).toContain("pg_advisory_xact_lock(hashtext('zutomayo:official-card-data-release'))");
    expect(importer).toContain('Official card dataset ${cardDataManifest.datasetSha256} was already applied');
    const ledgerInsert = importer.indexOf('INSERT INTO official_card_data_releases');
    const exactGate = importer.indexOf('requireExact: true', ledgerInsert);
    const commit = importer.indexOf("client.query('COMMIT')", exactGate);
    expect(ledgerInsert).toBeGreaterThan(0);
    expect(exactGate).toBeGreaterThan(ledgerInsert);
    expect(commit).toBeGreaterThan(exactGate);
    expect(workflow).toContain('npm run data:policy');
  });

  it('validates the active release and smokes its build id after automatic rollback', () => {
    const deploy = readFileSync(resolve('scripts/deploy-server4.sh'), 'utf8');
    expect(deploy).toContain('validate_remote_manifest \'.release.env\' "$current_manifest"');
    expect(deploy).toContain('ROLLBACK_RELEASE_SHA="$RELEASE_SHA"');
    expect(deploy).toContain('RELEASE_SHA="$ROLLBACK_RELEASE_SHA"');
    expect(deploy).toContain("test -s '$COMPOSE_FILE.previous'");
    expect(deploy).toContain('test -s scripts/postgres-init-roles.sh.previous');
    expect(deploy).toContain('cp -p scripts/postgres-init-roles.sh.previous scripts/postgres-init-roles.sh');
    expect(deploy).toContain('--source-digest "$RELEASE_SHA"');
    expect(deploy).toContain('.release.rollback-ready');
    expect(deploy).toContain('validate_remote_manifest \'.release.env\' "$current_manifest" true');
    expect(deploy).toContain("MANIFEST_FORMAT='legacy-six'");
    expect(deploy).toContain('ROLLBACK_MANIFEST_FORMAT="$MANIFEST_FORMAT"');
    expect(deploy).toContain("printf '%s\\n' '$ROLLBACK_MANIFEST_FORMAT' > .release.previous.format");
  });

  it('keeps new legacy deployments strict while allowing only verified rollback targets to be legacy-six', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-release-transition-'));
    const sixManifest = resolve(directory, 'legacy-six.env');
    const sevenManifest = resolve(directory, 'current-seven.env');
    const image = (app: string) => 'ghcr.io/example/zutomayo-card-online-' + app + '@sha256:' + 'a'.repeat(64);
    const lines = [
      'RELEASE_SHA=' + 'a'.repeat(40),
      'APP_VERSION=1.2.3',
      'GAME_RULES_VERSION=1.2.3',
      'EXPECTED_SCHEMA_MIGRATION=000031_official_card_data_releases',
      'EXPECTED_SCHEMA_CHECKSUM=' + 'b'.repeat(64),
      ...['game', 'api', 'platform', 'migrate', 'retention', 'gateway'].map(
        (app) => app.toUpperCase() + '_IMAGE=' + image(app),
      ),
    ];
    writeFileSync(sixManifest, lines.join('\n') + '\n');
    writeFileSync(sevenManifest, [...lines, 'OPS_IMAGE=' + image('ops')].join('\n') + '\n');
    const run = (manifest: string) =>
      spawnSync('bash', [resolve('scripts/deploy-server4.sh'), '--manifest', manifest, '--dry-run'], {
        encoding: 'utf8',
        env: { ...process.env, VERIFY_RELEASE_ARTIFACTS: 'false' },
      });

    const rejected = run(sixManifest);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('OPS_IMAGE is required for a new release');
    expect(run(sevenManifest).status).toBe(0);
  });

  it('rolls an N image back over an N+1 schema without running the old migration image', () => {
    const deploy = readFileSync(resolve('scripts/deploy-server4.sh'), 'utf8');
    const rollbackStart = deploy.indexOf('remote_rollback()');
    const rollbackEnd = deploy.indexOf('run_smoke()', rollbackStart);
    const rollback = deploy.slice(rollbackStart, rollbackEnd);

    expect(rollback).toContain(
      "docker compose -f '$COMPOSE_FILE' up -d --no-deps --wait --wait-timeout 180 game api platform",
    );
    expect(rollback).not.toContain("docker compose -f '$COMPOSE_FILE' run --rm migrate");
    expect(rollback).not.toContain("docker compose -f '$COMPOSE_FILE' up -d --wait");
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
