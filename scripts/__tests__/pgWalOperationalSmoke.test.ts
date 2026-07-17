import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/pg-wal-operational-smoke.sh');
const temporaryDirectories: string[] = [];

function executable(path: string, contents: string) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function harness(overrides: NodeJS.ProcessEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zutomayo-wal-operational-'));
  temporaryDirectories.push(root);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const psqlState = join(root, 'psql-state');
  const argvLog = join(root, 'argv.log');
  const restore = join(bin, 'restore');
  const caFile = join(root, 'postgres-ca.crt');
  writeFileSync(caFile, 'test CA');

  executable(
    join(bin, 'psql'),
    `#!/usr/bin/env bash
printf 'psql:%s\\n' "$*" >> "$FAKE_ARGV_LOG"
case "$*" in
  *"SELECT current_user"*) printf '%s\n' "\${FAKE_AUTHENTICATED_USER:-zutomayo-wal-operator}" ;;
  *"FROM pg_stat_ssl"*) printf '%s\n' "\${FAKE_TLS_STATE:-t|TLSv1.3|TLS_AES_256_GCM_SHA384}" ;;
  *"SHOW archive_mode"*) printf '%s\\n' "${overrides.FAKE_ARCHIVE_MODE ?? 'on'}" ;;
  *"SHOW wal_level"*) printf '%s\\n' replica ;;
  *"SHOW archive_command"*) printf '%s\\n' '/opt/zutomayo/scripts/pg-wal-archive.sh %p %f' ;;
  *"wal_segment_size"*) printf '%s\\n' 32 ;;
  *"pg_is_in_recovery"*) printf '%s\\n' f ;;
  *"FROM pg_stat_archiver"*)
    count=0
    if [[ -f "$FAKE_PSQL_STATE" ]]; then count=$(cat "$FAKE_PSQL_STATE"); fi
    printf '%s' "$((count + 1))" > "$FAKE_PSQL_STATE"
    if [[ "$count" = 0 ]]; then printf '%s\\n' '7|0|00000001000000000000000A'
    elif [[ "${overrides.FAKE_ARCHIVE_FAILURE ?? ''}" = 1 ]]; then printf '%s\\n' '8|1|00000001000000000000000B'
    else printf '%s\\n' '8|0|00000001000000000000000B'; fi
    ;;
  *"pg_walfile_name"*) printf '%s\\n' '00000001000000000000000B' ;;
  *"switch_wal"*) printf '%s\\n' '0/B000000' ;;
  *) exit 9 ;;
esac
`,
  );
  executable(
    restore,
    `#!/usr/bin/env bash
printf 'restore:%s\\n' "$*" >> "$FAKE_ARGV_LOG"
if [[ "${overrides.FAKE_RESTORE_FAILURE ?? ''}" = 1 ]]; then
  echo 'provider rejected credential secret-from-provider' >&2
  exit 8
fi
head -c 32 /dev/zero > "$2"
`,
  );
  executable(
    join(bin, 'pg_waldump'),
    `#!/usr/bin/env bash
printf 'pg_waldump:%s\\n' "$*" >> "$FAKE_ARGV_LOG"
exit 0
`,
  );

  return {
    root,
    argvLog,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      PG_WAL_RESTORE_COMMAND: restore,
      PG_WAL_PROBE_USER: 'zutomayo-wal-operator',
      PG_WAL_PROBE_PASSWORD: 'never-on-argv-password',
      PG_WAL_PROBE_DATABASE: 'postgres',
      PGUSER: 'zutomayo-wal-operator',
      PGPASSWORD: 'never-on-argv-password',
      PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: caFile,
      PG_WAL_PROBE_TIMEOUT_SECONDS: '2',
      PG_WAL_PROBE_POLL_SECONDS: '0',
      FAKE_PSQL_STATE: psqlState,
      FAKE_ARGV_LOG: argvLog,
      ...overrides,
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('live PostgreSQL WAL operational smoke', () => {
  it('forces archive progress and validates the exact segment through the restore path', () => {
    const test = harness();
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: test.env });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1,
      artifactType: 'zutomayo-pg-wal-operational-smoke',
      ok: true,
      identity: { matchesExpectedRole: true },
      tls: { enabled: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' },
      archive: {
        mode: 'on',
        walLevel: 'replica',
        counterAdvanced: true,
        failureCounterUnchanged: true,
        segment: '00000001000000000000000B',
      },
      restore: { offsiteRoundTrip: true, segmentBytes: 32, walDumpValidated: true },
    });
    const argv = readFileSync(test.argvLog, 'utf8');
    expect(argv).toContain('zutomayo_ops.switch_wal');
    expect(argv).toContain('restore:00000001000000000000000B');
    expect(argv).not.toContain('never-on-argv-password');
    expect(result.stdout).not.toContain('zutomayo-wal-operator');
  }, 15_000);

  it('requires verify-full and an explicit readable CA before connecting', () => {
    const test = harness({ PGSSLMODE: 'disable' });
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: test.env });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('ERROR: PostgreSQL WAL operational smoke failed during configuration\n');
    expect(existsSync(test.argvLog)).toBe(false);

    const missingCa = harness();
    missingCa.env.PGSSLROOTCERT = join(missingCa.root, 'missing-ca.crt');
    const missingCaResult = spawnSync('bash', [script], { encoding: 'utf8', env: missingCa.env });
    expect(missingCaResult.status).not.toBe(0);
    expect(missingCaResult.stderr).toBe('ERROR: PostgreSQL WAL operational smoke failed during configuration\n');
    expect(existsSync(missingCa.argvLog)).toBe(false);
  });

  it.each([
    {
      name: 'authenticated role',
      override: { FAKE_AUTHENTICATED_USER: 'zutomayo-migrator' },
      stage: 'connection-identity',
    },
    { name: 'TLS session metadata', override: { FAKE_TLS_STATE: 'f||' }, stage: 'connection-tls' },
    { name: 'TLS cipher', override: { FAKE_TLS_STATE: 't|TLSv1.3|' }, stage: 'connection-tls' },
  ])('fails closed on a mismatched $name', ({ override, stage }) => {
    const test = harness(override);
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: test.env });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('ERROR: PostgreSQL WAL operational smoke failed during ' + stage + '\n');
    expect(result.stderr).not.toContain('zutomayo-migrator');
    expect(readFileSync(test.argvLog, 'utf8')).not.toContain('never-on-argv-password');
  });

  it('fails closed when pg_stat_archiver records a failure', () => {
    const test = harness({ FAKE_ARCHIVE_FAILURE: '1' });
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: test.env });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('ERROR: PostgreSQL WAL operational smoke failed during archive-observation\n');
    expect(readFileSync(test.argvLog, 'utf8')).not.toContain('restore:');
  });

  it('does not echo provider errors or credentials when the off-site restore fails', () => {
    const test = harness({ FAKE_RESTORE_FAILURE: '1' });
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: test.env });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('ERROR: PostgreSQL WAL operational smoke failed during offsite-restore\n');
    expect(result.stderr).not.toContain('secret-from-provider');
    expect(result.stderr).not.toContain('never-on-argv-password');
  });

  it('refuses a primary without an active archive command before switching WAL', () => {
    const test = harness({ FAKE_ARCHIVE_MODE: 'off' });
    const result = spawnSync('bash', [script], { encoding: 'utf8', env: test.env });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('ERROR: PostgreSQL WAL operational smoke failed during archive-configuration\n');
    expect(readFileSync(test.argvLog, 'utf8')).not.toContain('switch_wal');
  });
});
