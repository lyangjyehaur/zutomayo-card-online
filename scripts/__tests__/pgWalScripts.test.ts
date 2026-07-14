import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const archiveScript = resolve('scripts/pg-wal-archive.sh');
const restoreScript = resolve('scripts/pg-wal-restore.sh');
const temporaryDirectories: string[] = [];

interface Harness {
  root: string;
  s3: string;
  metrics: string;
  identity: string;
  env: NodeJS.ProcessEnv;
}

function executable(path: string, contents: string) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'zutomayo-pg-wal-'));
  temporaryDirectories.push(root);
  const bin = join(root, 'bin');
  const s3 = join(root, 's3');
  const metrics = join(root, 'metrics');
  mkdirSync(bin);
  mkdirSync(s3);
  mkdirSync(metrics);

  executable(
    join(bin, 'age'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const input = args.at(-1);
if (args.includes('--decrypt')) {
  const contents = fs.readFileSync(input);
  if (process.env.FAKE_AGE_DECRYPT_FAIL === '1') {
    process.stdout.write(contents.subarray(0, Math.min(4, contents.length)));
    process.exit(9);
  }
  process.stdout.write(contents);
  process.exit(0);
}
const outputIndex = args.indexOf('--output');
if (outputIndex < 0 || !args[outputIndex + 1]) process.exit(2);
fs.copyFileSync(input, args[outputIndex + 1]);
`,
  );
  executable(
    join(bin, 'aws'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
if (process.env.FAKE_AWS_FAIL === '1') process.exit(7);
const args = process.argv.slice(2);
const source = args.at(-2);
const destination = args.at(-1);
const objectPath = (value) => path.join(process.env.FAKE_S3_DIR, path.basename(new URL(value).pathname));
fs.copyFileSync(source.startsWith('s3://') ? objectPath(source) : source, destination.startsWith('s3://') ? objectPath(destination) : destination);
`,
  );

  const identity = join(root, 'identity.txt');
  writeFileSync(identity, 'test identity');
  return {
    root,
    s3,
    metrics,
    identity,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      FAKE_S3_DIR: s3,
      PG_WAL_OFFSITE_URI: 's3://test-bucket/wal',
      PG_BACKUP_AGE_RECIPIENT: 'age1test',
      PG_BACKUP_AGE_IDENTITY_FILE: identity,
      PG_BACKUP_METRICS_DIR: metrics,
    },
  };
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('PostgreSQL WAL archive and restore scripts', () => {
  it.each(['000000010000000000000001', '00000002.history'])('round-trips the standard WAL name %s', (walName) => {
    const harness = createHarness();
    const source = join(harness.root, 'source-wal');
    const destination = join(harness.root, 'restore', basename(walName));
    writeFileSync(source, `contents for ${walName}`);

    const archived = run(archiveScript, [source, walName], harness.env);
    expect(archived.status, archived.stderr).toBe(0);
    expect(readFileSync(join(harness.metrics, 'zutomayo_pg_wal_archive.prom'), 'utf8')).toContain(
      'pg_wal_archive_last_run_success 1',
    );

    const restored = run(restoreScript, [walName, destination], harness.env);
    expect(restored.status, restored.stderr).toBe(0);
    expect(readFileSync(destination, 'utf8')).toBe(`contents for ${walName}`);
  });

  it('records a failed archive metric when an external upload command fails', () => {
    const harness = createHarness();
    const source = join(harness.root, 'source-wal');
    writeFileSync(source, 'wal contents');
    writeFileSync(
      join(harness.metrics, 'zutomayo_pg_wal_archive.prom'),
      'pg_wal_archive_last_success_unixtime_seconds 123\n',
    );

    const result = run(archiveScript, [source, '000000010000000000000001'], {
      ...harness.env,
      FAKE_AWS_FAIL: '1',
    });

    expect(result.status).not.toBe(0);
    const metrics = readFileSync(join(harness.metrics, 'zutomayo_pg_wal_archive.prom'), 'utf8');
    expect(metrics).toContain('pg_wal_archive_last_run_success 0');
    expect(metrics).toContain('pg_wal_archive_last_success_unixtime_seconds 123');
  });

  it('keeps the existing destination intact when WAL decryption fails', () => {
    const harness = createHarness();
    const walName = '00000002.history';
    const encrypted = Buffer.from('encrypted timeline history');
    writeFileSync(join(harness.s3, `${walName}.age`), encrypted);
    writeFileSync(
      join(harness.s3, `${walName}.age.sha256`),
      `${createHash('sha256').update(encrypted).digest('hex')}  ${walName}.age\n`,
    );
    const destinationDirectory = join(harness.root, 'restore');
    const destination = join(destinationDirectory, walName);
    mkdirSync(destinationDirectory);
    writeFileSync(destination, 'existing WAL');

    const result = run(restoreScript, [walName, destination], {
      ...harness.env,
      FAKE_AGE_DECRYPT_FAIL: '1',
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(destination, 'utf8')).toBe('existing WAL');
    expect(readdirSync(destinationDirectory).filter((name) => name.startsWith('.pg-wal-restore.'))).toEqual([]);
  });
});
