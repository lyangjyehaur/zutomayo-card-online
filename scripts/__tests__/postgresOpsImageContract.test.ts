import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync('Dockerfile.ops', 'utf8');
const compose = readFileSync('docker-compose.postgres-ops.yml', 'utf8');
const entrypoint = readFileSync('scripts/postgres-ops-entrypoint.sh', 'utf8');
const bootstrap = readFileSync('scripts/postgres-init-roles.sh', 'utf8');
const roleGate = readFileSync('scripts/postgres-role-gate.cjs', 'utf8');
const workflow = readFileSync('.github/workflows/cd.yml', 'utf8');
const resolver = readFileSync('scripts/resolve-release-manifest.sh', 'utf8');
const legacyDeploy = readFileSync('scripts/deploy-server4.sh', 'utf8');
const canaryDeploy = readFileSync('scripts/deploy-server4-canary.sh', 'utf8');
const hasDocker = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;

describe('immutable PostgreSQL OPS image contract', () => {
  it('builds the required tools from a digest-pinned PostgreSQL 16 image and runs non-root', () => {
    expect(dockerfile).toMatch(/^FROM postgres:16-alpine@sha256:[a-f0-9]{64}$/m);
    expect(dockerfile).toContain('apk add --no-cache age aws-cli');
    expect(dockerfile).toContain('USER postgres');
    expect(dockerfile).toContain('ENTRYPOINT ["/opt/zutomayo/scripts/postgres-ops-entrypoint.sh"]');
  });

  it('accepts credentials only through hardened read-only file mounts', () => {
    for (const fragment of [
      'image: ${OPS_IMAGE:?',
      "user: '70:70'",
      'read_only: true',
      'cap_drop: [ALL]',
      'no-new-privileges:true',
      'create_host_path: false',
      'PGPASSFILE: /run/secrets/postgres-operator.pgpass',
      'PG_BACKUP_AGE_IDENTITY_FILE: /run/secrets/wal-age-identity',
      'AWS_SHARED_CREDENTIALS_FILE: /run/secrets/wal-s3-credentials',
      'PG_WAL_SWITCH_FUNCTION: zutomayo_ops.switch_wal',
    ]) {
      expect(compose).toContain(fragment);
    }
    for (const forbidden of [
      'PGPASSWORD:',
      'PG_PASSWORD:',
      'PG_WAL_PROBE_PASSWORD:',
      'AWS_ACCESS_KEY_ID:',
      'AWS_SECRET_ACCESS_KEY:',
    ]) {
      expect(compose).not.toContain(forbidden);
    }
    expect(entrypoint).toContain('[[ "$mode" == 440 ]]');
    expect(entrypoint).toContain("readonly RUNTIME_PGPASS_FILE='/tmp/postgres-operator.pgpass'");
    expect(entrypoint).toContain('cp "$SOURCE_PGPASS_FILE" "$RUNTIME_PGPASS_FILE"');
    expect(entrypoint).toContain('chmod 0600 "$RUNTIME_PGPASS_FILE"');
    expect(entrypoint).toContain('export PGPASSFILE="$RUNTIME_PGPASS_FILE"');
    expect(entrypoint).toContain('AWS_EC2_METADATA_DISABLED');
    expect(entrypoint).toContain('exec /opt/zutomayo/scripts/pg-wal-operational-smoke.sh');
  });

  it.skipIf(!hasDocker)(
    'authenticates with the private runtime copy instead of the group-readable source',
    () => {
      const suffix = `${process.pid}-${Date.now()}`;
      const network = `zutomayo-ops-pgpass-${suffix}`;
      const server = `zutomayo-ops-pgpass-server-${suffix}`;
      const docker = (args: string[], timeout = 30_000) => spawnSync('docker', args, { encoding: 'utf8', timeout });

      expect(docker(['network', 'create', network]).status).toBe(0);
      try {
        const started = docker([
          'run',
          '-d',
          '--name',
          server,
          '--network',
          network,
          '--network-alias',
          'postgres',
          '-e',
          'POSTGRES_USER=ops_operator',
          '-e',
          'POSTGRES_PASSWORD=ops-test-password',
          '-e',
          'POSTGRES_DB=ops_test',
          'postgres:16-alpine',
        ]);
        expect(started.status, started.stderr).toBe(0);
        const ready = docker(
          [
            'exec',
            server,
            'sh',
            '-ec',
            'until pg_isready -h 127.0.0.1 -U ops_operator -d ops_test; do sleep 0.2; done',
          ],
          60_000,
        );
        expect(ready.status, ready.stderr).toBe(0);

        const client = docker([
          'run',
          '--rm',
          '--network',
          network,
          '--user',
          '0:0',
          '--entrypoint',
          'sh',
          'postgres:16-alpine',
          '-ec',
          [
            "printf '%s\\n' 'postgres:5432:ops_test:ops_operator:ops-test-password' > /tmp/source.pgpass",
            'chown 0:70 /tmp/source.pgpass',
            'chmod 0440 /tmp/source.pgpass',
            'su-exec postgres sh -ec \'umask 077; cp /tmp/source.pgpass /tmp/runtime.pgpass; chmod 0600 /tmp/runtime.pgpass; test "$(stat -c %u /tmp/runtime.pgpass)" = "$(id -u)"; test "$(stat -c %a /tmp/runtime.pgpass)" = 600; PGPASSFILE=/tmp/runtime.pgpass PGSSLMODE=disable psql -X -h postgres -U ops_operator -d ops_test -Atc "SELECT 1"\'',
          ].join('; '),
        ]);
        expect(client.status, client.stderr).toBe(0);
        expect(client.stdout.trim()).toBe('1');
        expect(client.stderr).not.toContain('group or world access');
      } finally {
        docker(['rm', '-f', server]);
        docker(['network', 'rm', network]);
      }
    },
    60_000,
  );

  it('uses a narrow superuser-owned wrapper instead of pg_checkpoint membership', () => {
    expect(bootstrap).toContain('CREATE OR REPLACE FUNCTION zutomayo_ops.switch_wal()');
    expect(bootstrap).toContain('SECURITY DEFINER');
    expect(bootstrap).toContain('SET search_path = pg_catalog');
    expect(bootstrap).not.toContain('GRANT pg_checkpoint');
    expect(roleGate).toContain("wrapper?.source !== 'SELECT pg_catalog.pg_switch_wal()'");
    expect(roleGate).toContain("has_function_privilege(role_name, $2::oid, 'EXECUTE')");
  });

  it('builds, signs, resolves, and verifies OPS_IMAGE with the other release artifacts', () => {
    expect(workflow).toContain('app: ops');
    expect(workflow).toContain('dockerfile: ./Dockerfile.ops');
    expect(workflow).toContain(
      'GAME_IMAGE|API_IMAGE|PLATFORM_IMAGE|MIGRATE_IMAGE|RETENTION_IMAGE|GATEWAY_IMAGE|OPS_IMAGE',
    );
    expect(resolver).toContain('game api platform migrate retention gateway ops');
    for (const deploy of [legacyDeploy, canaryDeploy]) {
      expect(deploy).toContain('OPS_IMAGE');
      expect(deploy).toContain('docker-compose.postgres-ops.yml');
    }
  });

  it('runs the WAL round-trip after migration/role gates and before application startup', () => {
    const legacyStart = legacyDeploy.indexOf('remote_deploy()');
    const legacyEnd = legacyDeploy.indexOf('remote_rollback()', legacyStart);
    const legacy = legacyDeploy.slice(legacyStart, legacyEnd);
    expect(legacy.indexOf('postgres-role-tls-$role')).toBeLessThan(legacy.indexOf('postgres-wal-operational-smoke'));
    expect(legacy.indexOf('postgres-wal-operational-smoke')).toBeLessThan(
      legacy.indexOf("docker compose -f '$COMPOSE_FILE' up -d --wait"),
    );

    const canaryStart = canaryDeploy.indexOf('stage_slot()');
    const canaryEnd = canaryDeploy.indexOf('render_and_apply_gateway()', canaryStart);
    const canary = canaryDeploy.slice(canaryStart, canaryEnd);
    expect(canary.indexOf('postgres-role-tls-\\$role')).toBeLessThan(canary.indexOf('postgres-wal-operational-smoke'));
    expect(canary.indexOf('postgres-wal-operational-smoke')).toBeLessThan(
      canary.indexOf('compose up -d --no-deps --wait'),
    );
  });
});
