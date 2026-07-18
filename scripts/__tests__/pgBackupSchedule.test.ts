import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const backupScript = resolve('scripts/pg-backup.sh');
const baseBackupScript = resolve('scripts/pg-base-backup.sh');
const scheduledRestoreScript = resolve('scripts/run-pg-restore-drill-scheduled.sh');
const temporaryDirectories: string[] = [];
const artifactSha256 = 'a'.repeat(64);

function executable(path: string, contents: string) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function createBackupHarness() {
  const root = mkdtempSync(join(tmpdir(), 'zutomayo-pg-backup-'));
  temporaryDirectories.push(root);
  const bin = join(root, 'bin');
  const backups = join(root, 'backups');
  const receipts = join(backups, 'receipts');
  const metrics = join(root, 'metrics');
  const awsLog = join(root, 'aws.jsonl');
  mkdirSync(bin);
  mkdirSync(backups);
  mkdirSync(metrics);

  executable(
    join(bin, 'pg_dump'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--file');
if (outputIndex < 0 || !args[outputIndex + 1]) process.exit(2);
fs.writeFileSync(args[outputIndex + 1], 'verified custom-format backup fixture');
`,
  );
  executable(join(bin, 'pg_restore'), '#!/usr/bin/env bash\nexit 0\n');
  executable(
    join(bin, 'age'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
if (outputIndex < 0 || !args[outputIndex + 1]) process.exit(2);
fs.copyFileSync(args.at(-1), args[outputIndex + 1]);
`,
  );
  executable(
    join(bin, 'aws'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_AWS_LOG, JSON.stringify(args) + '\\n');
const key = args[args.indexOf('--key') + 1];
const checksum = key.endsWith('.sha256');
const configured = checksum
  ? process.env.FAKE_CHECKSUM_VERSION_ID
  : process.env.FAKE_ARTIFACT_VERSION_ID;
process.stdout.write(JSON.stringify({ VersionId: configured === 'null' ? null : configured }));
`,
  );

  return {
    root,
    backups,
    receipts,
    metrics,
    awsLog,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      PG_BACKUP_USER: 'backup-test',
      PG_BACKUP_PASSWORD: 'secret',
      PG_PASSWORD: '',
      PGPASSFILE: '',
      PG_BACKUP_DIR: backups,
      PG_BACKUP_RECEIPT_DIR: receipts,
      PG_BACKUP_METRICS_DIR: metrics,
      PG_BACKUP_OFFSITE_URI: 's3://versioned-backups/logical',
      PG_BACKUP_AGE_RECIPIENT: 'age1test',
      PG_BACKUP_AGE_RECIPIENT_FILE: '',
      PG_BACKUP_ALLOW_LOCAL_ONLY: 'false',
      PG_BACKUP_ALLOW_UNENCRYPTED: 'false',
      FAKE_AWS_LOG: awsLog,
      FAKE_ARTIFACT_VERSION_ID: 'artifact-version-1',
      FAKE_CHECKSUM_VERSION_ID: 'checksum-version-1',
    } satisfies NodeJS.ProcessEnv,
  };
}

function runBackup(env: NodeJS.ProcessEnv) {
  return spawnSync('bash', [backupScript], { encoding: 'utf8', env, timeout: 10_000 });
}

interface BackupReceipt {
  schemaVersion: number;
  artifactType: string;
  remoteObjectUrl: string;
  checksumRemoteObjectUrl: string;
  objectVersionId: string;
  checksumObjectVersionId: string;
  artifactSha256: string;
  sizeBytes: number;
}

function recentTimestamp(offsetMilliseconds = 0) {
  return new Date(Date.now() + offsetMilliseconds).toISOString();
}

function validReceipt(overrides: Record<string, unknown> = {}) {
  const recoveryPointAt = recentTimestamp();
  return {
    schemaVersion: 1,
    artifactType: 'zutomayo-encrypted-logical-backup-receipt',
    uploadedAt: recoveryPointAt,
    recoveryPointAt,
    remoteObjectUrl: 's3://versioned-backups/logical/zutomayo_20260718T010203Z.dump.age',
    checksumRemoteObjectUrl: 's3://versioned-backups/logical/zutomayo_20260718T010203Z.dump.age.sha256',
    objectVersionId: 'artifact-version-1',
    checksumObjectVersionId: 'checksum-version-1',
    artifactSha256,
    sizeBytes: 1024,
    ...overrides,
  };
}

function createScheduleHarness(receipt = validReceipt()) {
  const root = mkdtempSync(join(tmpdir(), 'zutomayo-pg-restore-schedule-'));
  temporaryDirectories.push(root);
  const metrics = join(root, 'metrics');
  const receiptPath = join(root, 'latest-offsite-backup-receipt.json');
  const restoreLog = join(root, 'restore.json');
  const restore = join(root, 'fake-restore.js');
  mkdirSync(metrics);
  writeFileSync(receiptPath, JSON.stringify(receipt));
  chmodSync(receiptPath, 0o440);
  executable(
    restore,
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.FAKE_RESTORE_LOG, JSON.stringify({
  artifact: process.argv[2],
  objectVersionId: process.env.PG_RESTORE_DRILL_OBJECT_VERSION_ID,
  checksumVersionId: process.env.PG_RESTORE_DRILL_CHECKSUM_VERSION_ID,
  expectedSha256: process.env.PG_RESTORE_DRILL_EXPECTED_SHA256,
  runId: process.env.PG_RESTORE_DRILL_RUN_ID,
}));
process.exit(Number(process.env.FAKE_RESTORE_EXIT || 0));
`,
  );

  return {
    root,
    metrics,
    receiptPath,
    restoreLog,
    env: {
      ...process.env,
      PG_RESTORE_DRILL_RECEIPT_FILE: receiptPath,
      PG_RESTORE_DRILL_SCRIPT: restore,
      PG_RESTORE_DRILL_MAX_RECEIPT_AGE_SECONDS: '93600',
      PG_BACKUP_METRICS_DIR: metrics,
      PG_RESTORE_DRILL_RUN_ID: 'scheduled-test-run',
      FAKE_RESTORE_LOG: restoreLog,
    } satisfies NodeJS.ProcessEnv,
  };
}

function runSchedule(env: NodeJS.ProcessEnv) {
  return spawnSync('bash', [scheduledRestoreScript], { encoding: 'utf8', env, timeout: 10_000 });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('PostgreSQL logical backup receipts', { timeout: 20_000 }, () => {
  it('publishes exact immutable S3 versions only after both uploads succeed', () => {
    const harness = createBackupHarness();
    const result = runBackup(harness.env);

    expect(result.status, result.stderr).toBe(0);
    const timestampedReceipts = readdirSync(harness.receipts).filter(
      (name) => name.startsWith('zutomayo_') && name.endsWith('.receipt.json'),
    );
    expect(timestampedReceipts).toHaveLength(1);
    const timestampedPath = join(harness.receipts, timestampedReceipts[0]);
    const receipt = JSON.parse(readFileSync(timestampedPath, 'utf8')) as BackupReceipt;
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      artifactType: 'zutomayo-encrypted-logical-backup-receipt',
      objectVersionId: 'artifact-version-1',
      checksumObjectVersionId: 'checksum-version-1',
    });
    expect(receipt.remoteObjectUrl).toMatch(/^s3:\/\/versioned-backups\/logical\/zutomayo_.*\.dump\.age$/);
    expect(receipt.checksumRemoteObjectUrl).toBe(`${receipt.remoteObjectUrl}.sha256`);
    expect(receipt.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.sizeBytes).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(harness.receipts, 'latest-offsite-backup-receipt.json'), 'utf8'))).toEqual(
      receipt,
    );
    expect(statSync(timestampedPath).mode & 0o777).toBe(0o440);

    const uploads = readFileSync(harness.awsLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    expect(uploads).toHaveLength(2);
    expect(uploads.every((args) => args[0] === 's3api' && args[1] === 'put-object')).toBe(true);
    expect(uploads.map((args) => args[args.indexOf('--key') + 1])).toEqual([
      receipt.remoteObjectUrl.replace('s3://versioned-backups/', ''),
      receipt.checksumRemoteObjectUrl.replace('s3://versioned-backups/', ''),
    ]);
    expect(readFileSync(join(harness.metrics, 'zutomayo_pg_backup.prom'), 'utf8')).toContain(
      'pg_backup_last_run_success 1',
    );
  });

  it.each(['artifact', 'checksum'] as const)('rejects a null %s VersionId without publishing a receipt', (target) => {
    const harness = createBackupHarness();
    writeFileSync(
      join(harness.metrics, 'zutomayo_pg_backup.prom'),
      'pg_backup_last_success_unixtime_seconds 123\npg_backup_last_size_bytes 456\n',
    );
    const result = runBackup({
      ...harness.env,
      [target === 'artifact' ? 'FAKE_ARTIFACT_VERSION_ID' : 'FAKE_CHECKSUM_VERSION_ID']: 'null',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('did not return an immutable VersionId');
    expect(
      existsSync(harness.receipts) && readdirSync(harness.receipts).some((name) => name.endsWith('.receipt.json')),
    ).toBe(false);
    const metrics = readFileSync(join(harness.metrics, 'zutomayo_pg_backup.prom'), 'utf8');
    expect(metrics).toContain('pg_backup_last_run_success 0');
    expect(metrics).toContain('pg_backup_last_success_unixtime_seconds 123');
    expect(metrics).toContain('pg_backup_last_size_bytes 456');
  });

  it('records logical and physical preflight failures without losing the last success state', () => {
    const harness = createBackupHarness();
    writeFileSync(
      join(harness.metrics, 'zutomayo_pg_backup.prom'),
      'pg_backup_last_success_unixtime_seconds 123\npg_backup_last_size_bytes 456\n',
    );
    writeFileSync(
      join(harness.metrics, 'zutomayo_pg_base_backup.prom'),
      'pg_base_backup_last_success_unixtime_seconds 789\npg_base_backup_last_size_bytes 654\n',
    );

    const logical = runBackup({ ...harness.env, PG_BACKUP_PASSWORD: '', PGPASSFILE: '' });
    const physical = spawnSync('bash', [baseBackupScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PG_WAL_PASSWORD: '',
        PG_PASSWORD: '',
        PGPASSFILE: '',
        PG_BACKUP_METRICS_DIR: harness.metrics,
      },
      timeout: 10_000,
    });

    expect(logical.status).toBe(1);
    expect(physical.status).toBe(1);
    const logicalMetrics = readFileSync(join(harness.metrics, 'zutomayo_pg_backup.prom'), 'utf8');
    expect(logicalMetrics).toContain('pg_backup_last_run_success 0');
    expect(logicalMetrics).toContain('pg_backup_last_success_unixtime_seconds 123');
    expect(logicalMetrics).toContain('pg_backup_last_size_bytes 456');
    const physicalMetrics = readFileSync(join(harness.metrics, 'zutomayo_pg_base_backup.prom'), 'utf8');
    expect(physicalMetrics).toContain('pg_base_backup_last_run_success 0');
    expect(physicalMetrics).toContain('pg_base_backup_last_success_unixtime_seconds 789');
    expect(physicalMetrics).toContain('pg_base_backup_last_size_bytes 654');
  });
});

describe('scheduled PostgreSQL restore drill', { timeout: 20_000 }, () => {
  it('passes only the receipt-pinned object versions and checksum to the restore drill', () => {
    const harness = createScheduleHarness();
    const result = runSchedule(harness.env);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(harness.restoreLog, 'utf8'))).toEqual({
      artifact: 's3://versioned-backups/logical/zutomayo_20260718T010203Z.dump.age',
      objectVersionId: 'artifact-version-1',
      checksumVersionId: 'checksum-version-1',
      expectedSha256: artifactSha256,
      runId: 'scheduled-test-run',
    });
  });

  it.each(['stale', 'writable', 'symlink', 'malformed'] as const)(
    'rejects a %s receipt and records failure',
    (kind) => {
      const receipt =
        kind === 'stale'
          ? validReceipt({
              uploadedAt: recentTimestamp(-172_800_000),
              recoveryPointAt: recentTimestamp(-172_800_000),
            })
          : validReceipt();
      const harness = createScheduleHarness(receipt);

      if (kind === 'writable') chmodSync(harness.receiptPath, 0o660);
      if (kind === 'malformed') {
        chmodSync(harness.receiptPath, 0o640);
        writeFileSync(harness.receiptPath, '{not-json');
        chmodSync(harness.receiptPath, 0o440);
      }
      if (kind === 'symlink') {
        const link = join(harness.root, 'receipt-link.json');
        symlinkSync(harness.receiptPath, link);
        harness.env.PG_RESTORE_DRILL_RECEIPT_FILE = link;
      }

      const result = runSchedule(harness.env);

      expect(result.status).toBe(1);
      expect(existsSync(harness.restoreLog)).toBe(false);
      expect(readFileSync(join(harness.metrics, 'zutomayo_pg_restore_drill.prom'), 'utf8')).toContain(
        'pg_restore_drill_success 0',
      );
    },
  );

  it('records failure and preserves the last success timestamp when the restore child fails', () => {
    const harness = createScheduleHarness();
    writeFileSync(
      join(harness.metrics, 'zutomayo_pg_restore_drill.prom'),
      'pg_restore_drill_last_success_unixtime_seconds 123\n',
    );
    const result = runSchedule({ ...harness.env, FAKE_RESTORE_EXIT: '7' });

    expect(result.status).toBe(7);
    expect(existsSync(harness.restoreLog)).toBe(true);
    const metrics = readFileSync(join(harness.metrics, 'zutomayo_pg_restore_drill.prom'), 'utf8');
    expect(metrics).toContain('pg_restore_drill_success 0');
    expect(metrics).toContain('pg_restore_drill_last_success_unixtime_seconds 123');
  });
});
