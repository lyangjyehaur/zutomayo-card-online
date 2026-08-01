import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const roles = ['api', 'game', 'platform', 'retention', 'monitor', 'backup'] as const;
const compose = readFileSync(resolve('docker-compose.postgres-role-smoke.yml'), 'utf8');
const opsCompose = readFileSync(resolve('docker-compose.postgres-ops.yml'), 'utf8');
const legacyDeploy = readFileSync(resolve('scripts/deploy-server4.sh'), 'utf8');
const canaryDeploy = readFileSync(resolve('scripts/deploy-server4-canary.sh'), 'utf8');
const hasDockerCompose = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

function serviceBlock(role: (typeof roles)[number]) {
  const start = compose.indexOf(`  postgres-role-tls-${role}:`);
  const next = compose.indexOf('\n  postgres-role-tls-', start + 1);
  const end = next === -1 ? compose.indexOf('\nnetworks:', start) : next;
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return compose.slice(start, end);
}

describe('PostgreSQL role/TLS deployment gate contract', () => {
  it('runs each role in an isolated one-shot container with only its own password', () => {
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('cap_drop: [ALL]');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('PGSSLMODE=verify-full');

    for (const role of roles) {
      const block = serviceBlock(role);
      const variable = role.toUpperCase();
      expect(block).toContain(`'--role=${role}'`);
      expect(block).toContain(`PG_PASSWORD: \${PG_${variable}_PASSWORD:`);
      expect(block).toContain(`PG_${variable}_USER:`);
      for (const other of roles.filter((candidate) => candidate !== role)) {
        expect(block).not.toContain(`PG_${other.toUpperCase()}_PASSWORD`);
      }
    }
  });

  it('gates legacy startup after migration without putting passwords on argv', () => {
    const start = legacyDeploy.indexOf('remote_deploy()');
    const end = legacyDeploy.indexOf('remote_rollback()', start);
    const block = legacyDeploy.slice(start, end);
    const migration = block.indexOf("docker compose -f '$COMPOSE_FILE' run --rm migrate");
    const roleGate = block.indexOf('postgres-role-tls-\\$role');
    const startup = block.indexOf("docker compose -f '$COMPOSE_FILE' up -d --wait");

    expect(legacyDeploy).toContain('.role-tls-smoke-compose.incoming');
    expect(migration).toBeGreaterThan(-1);
    expect(roleGate).toBeGreaterThan(migration);
    expect(startup).toBeGreaterThan(roleGate);
    expect(block).toContain('.artifactType == \\"zutomayo-postgres-role-tls-smoke\\"');
    expect(block).not.toMatch(/(?:^|\s)(?:-e|--env)\s+PG_PASSWORD=/m);
  });

  it('gates a canary slot before any candidate runtime starts', () => {
    const start = canaryDeploy.indexOf('stage_slot()');
    const end = canaryDeploy.indexOf('render_and_apply_gateway()', start);
    const block = canaryDeploy.slice(start, end);
    const migration = block.indexOf('compose run --rm --no-deps migrate');
    const roleGate = block.indexOf('postgres-role-tls-\\$role');
    const runtimeStart = block.indexOf('compose up -d --no-deps --wait');

    expect(canaryDeploy).toContain(`$incoming/$ROLE_TLS_SMOKE_COMPOSE_FILE`);
    expect(migration).toBeGreaterThan(-1);
    expect(roleGate).toBeGreaterThan(migration);
    expect(runtimeStart).toBeGreaterThan(roleGate);
    expect(block).toContain('role_tls_smoke_compose()');
    expect(block).toContain('\\"\\$PROJECT-role-tls\\"');
    expect(block).toContain('.artifactType == \\"zutomayo-postgres-role-tls-smoke\\"');
    expect(block).not.toMatch(/(?:^|\s)(?:-e|--env)\s+PG_PASSWORD=/m);
  });

  it.skipIf(!hasDockerCompose)('renders the staging database target into both auxiliary gates', () => {
    const digest = '0'.repeat(64);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MIGRATE_IMAGE: 'ghcr.io/example/zutomayo-card-online-migrate@sha256:' + digest,
      OPS_IMAGE: 'ghcr.io/example/zutomayo-card-online-ops@sha256:' + digest,
      PG_DEPLOY_GATE_HOST: 'staging-postgres.example.internal',
      PG_DEPLOY_GATE_PORT: '6543',
      PG_DATABASE: 'zutomayo_staging',
      PGSSLMODE: 'verify-full',
      PG_SSLROOTCERT: '/run/secrets/zutomayo-service-ca.crt',
      NODE_EXTRA_CA_CERTS: '/run/secrets/zutomayo-service-ca.crt',
      PG_CA_FILE: '/tmp/postgres-ca.crt',
      PG_WAL_OPERATOR_DATABASE: 'zutomayo_staging',
      PG_WAL_OPERATOR_USER: 'zutomayo_wal_operator',
      PG_WAL_OPERATOR_PGPASS_FILE: '/tmp/postgres-operator.pgpass',
      PG_WAL_AGE_IDENTITY_FILE: '/tmp/wal-age-identity',
      PG_WAL_S3_CREDENTIALS_FILE: '/tmp/wal-s3-credentials',
      PG_WAL_OFFSITE_URI: 's3://zutomayo-staging-wal',
      PG_WAL_S3_REGION: 'us-east-1',
      POSTGRES_OPS_SECRETS_GID: '992',
    };
    for (const role of roles) {
      const variable = role.toUpperCase();
      env['PG_' + variable + '_USER'] = 'zutomayo_' + role;
      env['PG_' + variable + '_PASSWORD'] = 'password-' + role;
    }
    const render = (file: string, profile: string, renderEnv = env) => {
      const result = spawnSync('docker', ['compose', '-f', file, '--profile', profile, 'config', '--format', 'json'], {
        encoding: 'utf8',
        env: renderEnv,
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        services: Record<string, { environment: Record<string, string> }>;
      };
    };

    const roleConfig = render('docker-compose.postgres-role-smoke.yml', 'postgres-role-tls-smoke');
    const opsConfig = render('docker-compose.postgres-ops.yml', 'postgres-ops');
    expect(roleConfig.services['postgres-role-tls-api'].environment).toMatchObject({
      PG_HOST: 'staging-postgres.example.internal',
      PG_PORT: '6543',
    });
    expect(opsConfig.services['postgres-wal-operational-smoke'].environment).toMatchObject({
      PGHOST: 'staging-postgres.example.internal',
      PGPORT: '6543',
    });
    const productionEnv = { ...env };
    delete productionEnv.PG_DEPLOY_GATE_HOST;
    delete productionEnv.PG_DEPLOY_GATE_PORT;
    expect(
      render('docker-compose.postgres-role-smoke.yml', 'postgres-role-tls-smoke', productionEnv).services[
        'postgres-role-tls-api'
      ].environment,
    ).toMatchObject({ PG_HOST: 'postgresql', PG_PORT: '5432' });
    expect(
      render('docker-compose.postgres-ops.yml', 'postgres-ops', productionEnv).services[
        'postgres-wal-operational-smoke'
      ].environment,
    ).toMatchObject({ PGHOST: 'postgresql', PGPORT: '5432' });
    expect(compose).toContain('PG_HOST: ${PG_DEPLOY_GATE_HOST:-postgresql}');
    expect(opsCompose).toContain('PGHOST: ${PG_DEPLOY_GATE_HOST:-postgresql}');
    for (const deploy of [legacyDeploy, canaryDeploy]) {
      expect(deploy).toContain('.services.migrate.environment.PG_HOST');
      expect(deploy).toContain('.services.migrate.environment.PG_PORT');
      expect(deploy).toContain('export PG_DEPLOY_GATE_HOST PG_DEPLOY_GATE_PORT');
    }
  });
});
