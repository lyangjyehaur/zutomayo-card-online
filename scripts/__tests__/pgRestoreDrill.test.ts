import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const scriptPath = resolve(root, 'scripts/pg-restore-drill.sh');
const pinnedImage = `postgres@sha256:${'a'.repeat(64)}`;
const migrateImage = `ghcr.io/example/migrate@sha256:${'b'.repeat(64)}`;
const releaseSha = 'c'.repeat(40);
const remoteObjectUrl = 's3://zutomayo-staging-backups/logical/release.dump.age';
const objectVersionId = 'artifact-version-123';
const checksumVersionId = 'checksum-version-456';
const secret = 'must-not-appear-in-evidence';
const expectedMigration = '000031_official_card_data_releases';
const expectedSchemaChecksum = '9'.repeat(64);

type GateModule = {
  inspectStagingGates(
    stagingEvidenceDir: string,
    options: {
      releaseSha: string;
      nowMs: number;
      imageDigests: Record<string, string>;
      expectedSchemaMigration: string;
      expectedSchemaChecksum: string;
      evidenceRunId: string;
    },
  ): Array<{ id: string; status: string; reason: string }>;
};

// @ts-expect-error The runtime MJS module intentionally has no generated declarations.
const { inspectStagingGates } = (await import('../release-gate.mjs')) as GateModule;

interface HarnessOptions {
  ageFailure?: boolean;
  checksumMismatch?: boolean;
  coreDataFailure?: boolean;
  expectedMigration?: string;
  invariantFailure?: boolean;
  legalHoldFailure?: boolean;
  objectVersion?: string;
  releaseSha?: string;
  schemaBindingFailure?: boolean;
}

function executable(path: string, contents: string) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function harness(options: HarnessOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'zutomayo-offsite-restore-'));
  const binDirectory = join(directory, 'bin');
  const metricsDirectory = join(directory, 'metrics');
  const reportDirectory = join(directory, 'reports');
  const artifactDirectory = join(directory, 'artifacts');
  const commandLog = join(directory, 'commands.log');
  const identityFile = join(directory, 'age-identity.txt');
  const remoteArtifact = join(directory, 'remote.dump.age');
  const remoteChecksum = join(directory, 'remote.dump.age.sha256');
  const nowSeconds = Math.floor(Date.now() / 1_000) * 1_000;
  const recoveryPointAt = new Date(nowSeconds - 60_000).toISOString();
  const objectLastModifiedAt = new Date(nowSeconds - 30_000).toISOString();
  mkdirSync(binDirectory);
  mkdirSync(metricsDirectory);
  mkdirSync(reportDirectory);
  mkdirSync(artifactDirectory);
  writeFileSync(identityFile, `AGE-SECRET-KEY-${secret}\n`);
  writeFileSync(remoteArtifact, 'synthetic-age-encrypted-postgres-custom-dump\n');
  const artifactSha256 = createHash('sha256').update(readFileSync(remoteArtifact)).digest('hex');
  writeFileSync(remoteChecksum, `${options.checksumMismatch ? '0'.repeat(64) : artifactSha256}  release.dump.age\n`);

  executable(
    join(binDirectory, 'aws'),
    `#!/bin/sh
set -eu
printf '%s|aws|%s\n' "$(date -u +%s)" "$*" >>"$COMMAND_LOG"
test "$1" = s3api
test "$2" = get-object
shift 2
bucket=''
key=''
version=''
destination=''
while test "$#" -gt 0; do
  case "$1" in
    --bucket) bucket=$2; shift 2 ;;
    --key) key=$2; shift 2 ;;
    --version-id) version=$2; shift 2 ;;
    *) destination=$1; shift ;;
  esac
done
test "$bucket" = zutomayo-staging-backups
case "$key" in
  logical/release.dump.age)
    test "$version" = "$EXPECTED_OBJECT_VERSION"
    cp "$FAKE_REMOTE_ARTIFACT" "$destination"
    printf '{"VersionId":"%s","LastModified":"%s","Metadata":{"recovery-point-at":"%s"}}\n' \
      "$version" "$FAKE_OBJECT_LAST_MODIFIED_AT" "$FAKE_RECOVERY_POINT_AT"
    ;;
  logical/release.dump.age.sha256)
    test "$version" = "$EXPECTED_CHECKSUM_VERSION"
    cp "$FAKE_REMOTE_CHECKSUM" "$destination"
    printf '{"VersionId":"%s","LastModified":"%s","Metadata":{}}\n' \
      "$version" "$FAKE_OBJECT_LAST_MODIFIED_AT"
    ;;
  *) exit 71 ;;
esac
`,
  );
  executable(
    join(binDirectory, 'age'),
    `#!/bin/sh
set -eu
printf '%s|age|%s\n' "$(date -u +%s)" "$*" >>"$COMMAND_LOG"
if test "${options.ageFailure ? 'true' : 'false'}" = true; then exit 72; fi
output=''
source=''
while test "$#" -gt 0; do
  case "$1" in
    --decrypt) shift ;;
    --identity) test -r "$2"; shift 2 ;;
    --output) output=$2; shift 2 ;;
    *) source=$1; shift ;;
  esac
done
test -n "$output"
cp "$source" "$output"
`,
  );
  executable(
    join(binDirectory, 'docker'),
    `#!/bin/sh
set -eu
printf '%s|docker|%s\n' "$(date -u +%s)" "$*" >>"$COMMAND_LOG"
command=$1
shift
case "$command" in
  run) printf '%s\n' synthetic-container ;;
  cp) exit 0 ;;
  rm) exit 0 ;;
  exec)
    container=$1
    subcommand=$2
    shift 2
    test "$container" = zutomayo-offsite-restore-test
    case "$subcommand" in
      pg_isready|pg_restore) exit 0 ;;
      psql)
        cat <<'COUNTS'
cards=422
deleted_social_violations=0
deletion_hold_violations=${options.legalHoldFailure ? '1' : '0'}
invalid_outbox_status=${options.coreDataFailure ? '1' : '0'}
legal_holds=1
matches=12
missing_official_english_effects=0
missing_official_english_names=0
official_card_data_releases=1
official_english_rows=422
official_errata=12
official_japanese_rows=422
relationship_change_outbox=3
schema_migrations=31
expected_schema_binding=${options.schemaBindingFailure ? '0' : '1'}
unvalidated_constraints=${options.invariantFailure ? '1' : '0'}
users=8
COUNTS
        ;;
      *) exit 73 ;;
    esac
    ;;
  *) exit 74 ;;
esac
`,
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: 'synthetic-access-key',
    AWS_SECRET_ACCESS_KEY: secret,
    COMMAND_LOG: commandLog,
    EXPECTED_CHECKSUM_VERSION: checksumVersionId,
    EXPECTED_OBJECT_VERSION: objectVersionId,
    EXPECTED_SCHEMA_CHECKSUM: expectedSchemaChecksum,
    EXPECTED_SCHEMA_MIGRATION: options.expectedMigration ?? expectedMigration,
    FAKE_REMOTE_ARTIFACT: remoteArtifact,
    FAKE_REMOTE_CHECKSUM: remoteChecksum,
    FAKE_OBJECT_LAST_MODIFIED_AT: objectLastModifiedAt,
    FAKE_RECOVERY_POINT_AT: recoveryPointAt,
    MIGRATE_IMAGE: migrateImage,
    PATH: `${binDirectory}:${process.env.PATH}`,
    PG_BACKUP_AGE_IDENTITY_FILE: identityFile,
    PG_BACKUP_METRICS_DIR: metricsDirectory,
    PG_RESTORE_DRILL_ARTIFACT_DIR: artifactDirectory,
    PG_RESTORE_DRILL_CHECKSUM_VERSION_ID: checksumVersionId,
    PG_RESTORE_DRILL_CONTAINER: 'zutomayo-offsite-restore-test',
    PG_RESTORE_DRILL_IMAGE: pinnedImage,
    PG_RESTORE_DRILL_OBJECT_VERSION_ID: options.objectVersion ?? objectVersionId,
    PG_RESTORE_DRILL_REPORT_DIR: reportDirectory,
    PG_RESTORE_DRILL_RUN_ID: 'release-integration',
    RELEASE_SHA: options.releaseSha ?? releaseSha,
    TMPDIR: directory,
  };
  const result = spawnSync('bash', [scriptPath, remoteObjectUrl], {
    encoding: 'utf8',
    env,
    timeout: 15_000,
  });
  return {
    artifactDirectory,
    artifactPath: join(artifactDirectory, 'encrypted-offsite-restore-release-integration.json'),
    artifactSha256,
    commandLog,
    directory,
    metricsDirectory,
    reportDirectory,
    recoveryPointAt,
    objectLastModifiedAt,
    result,
  };
}

function sha256(contents: string) {
  return createHash('sha256').update(contents).digest('hex');
}

describe('encrypted off-site logical restore producer', { timeout: 20_000 }, () => {
  it('downloads exact S3 versions and emits evidence accepted by the restore gate', () => {
    const run = harness();
    expect(run.result.status, `${run.result.stdout}\n${run.result.stderr}`).toBe(0);
    const artifactContents = readFileSync(run.artifactPath, 'utf8');
    const artifact = JSON.parse(artifactContents) as {
      releaseSha: string;
      startedAt: string;
      finishedAt: string;
      backup: Record<string, unknown>;
      restore: Record<string, unknown>;
    };
    expect(artifact).toMatchObject({
      releaseSha,
      backup: {
        remoteObjectUrl,
        objectVersionId,
        checksumObjectVersionId: checksumVersionId,
        artifactSha256: run.artifactSha256,
        recoveryPointAt: run.recoveryPointAt,
        objectLastModifiedAt: run.objectLastModifiedAt,
        checksumVerified: true,
        decryptSucceeded: true,
      },
      restore: {
        isolated: true,
        completed: true,
        schema: {
          expectedMigration,
          expectedChecksum: expectedSchemaChecksum,
          migrateImage,
        },
        observations: {
          schemaMigrations: 31,
          expectedSchemaBinding: 1,
          users: 8,
          cards: 422,
          officialCardDataReleases: 1,
          missingOfficialEnglishNames: 0,
          missingOfficialEnglishEffects: 0,
          officialErrata: 12,
          officialJapaneseRows: 422,
          officialEnglishRows: 422,
          matches: 12,
          relationshipChangeOutbox: 3,
          legalHolds: 1,
          unvalidatedConstraints: 0,
          invalidOutboxStatus: 0,
          deletionHoldViolations: 0,
          deletedSocialViolations: 0,
        },
        schemaGatePassed: true,
        coreDataInvariantPassed: true,
        legalHoldInvariantPassed: true,
      },
    });
    expect(artifact.restore).not.toHaveProperty('fixtureRoundTripPassed');

    const startedAtMs = Date.parse(artifact.startedAt);
    const finishedAtMs = Date.parse(artifact.finishedAt);
    expect(finishedAtMs).toBeGreaterThan(startedAtMs);
    const commands = readFileSync(run.commandLog, 'utf8').trim().split('\n');
    expect(commands.filter((line) => line.includes('|aws|'))).toHaveLength(2);
    expect(commands.join('\n')).toContain(
      's3api get-object --bucket zutomayo-staging-backups --key logical/release.dump.age --version-id artifact-version-123',
    );
    expect(commands.join('\n')).toContain(
      's3api get-object --bucket zutomayo-staging-backups --key logical/release.dump.age.sha256 --version-id checksum-version-456',
    );
    expect(commands.join('\n')).not.toContain('s3 cp');
    expect(commands.join('\n')).toContain('run --detach --rm --network none');
    expect(commands.join('\n')).toContain('JOIN schema_migration_checksums');
    expect(commands.join('\n')).toContain(expectedMigration);
    expect(commands.join('\n')).toContain(expectedSchemaChecksum);
    for (const command of commands.filter((line) => /^\d+\|/.test(line))) {
      const commandEpochMs = Number(command.split('|', 1)[0]) * 1_000;
      expect(commandEpochMs).toBeGreaterThanOrEqual(startedAtMs);
      expect(commandEpochMs).toBeLessThanOrEqual(finishedAtMs);
    }

    const physicalRaw = {
      schemaVersion: 1,
      artifactType: 'zutomayo-restore-drill-raw',
      releaseSha,
      startedAt: artifact.startedAt,
      finishedAt: artifact.finishedAt,
      durationSeconds: (finishedAtMs - startedAtMs) / 1_000,
      success: true,
      exitCode: 0,
      backup: { method: 'pg_basebackup', verified: true, manifestSha256: 'f'.repeat(64) },
      restore: {
        mode: 'pitr',
        targetAt: new Date(startedAtMs - 60_000).toISOString(),
        recoveredThroughAt: new Date(startedAtMs - 60_000).toISOString(),
        baseBackupSha256: 'f'.repeat(64),
        walSegmentsApplied: 2,
        targetReached: true,
        promoted: true,
      },
      checks: {
        schemaGatePassed: true,
        fixtureRoundTripPassed: true,
        legalHoldInvariantPassed: true,
        expectedMigration,
        expectedSchemaChecksum,
        migrateImage,
        expectedMigrationCount: 1,
        requiredTableCount: 8,
        unvalidatedConstraints: 0,
        invalidOutboxStatus: 0,
        markerBeforeCount: 1,
        walReplayProbeCount: 1,
        markerAfterCount: 0,
        sourceMarkerAfterCount: 1,
        deletionHoldViolations: 0,
        deletedSocialViolations: 0,
      },
    };
    const physicalPath = join(run.artifactDirectory, 'pitr-raw.json');
    const physicalContents = `${JSON.stringify(physicalRaw, null, 2)}\n`;
    writeFileSync(physicalPath, physicalContents);
    const stagingDirectory = join(run.directory, 'staging');
    mkdirSync(stagingDirectory);
    const rawReference = { path: `artifacts/${basename(physicalPath)}`, sha256: sha256(physicalContents) };
    const offsiteReference = { path: `artifacts/${basename(run.artifactPath)}`, sha256: sha256(artifactContents) };
    const imageDigests = Object.fromEntries(
      ['game', 'api', 'platform', 'migrate', 'retention', 'gateway', 'ops'].map((name) => [
        name,
        name === 'migrate' ? migrateImage : `ghcr.io/example/${name}@sha256:${'0'.repeat(64)}`,
      ]),
    );
    const checkedAt = new Date(finishedAtMs + 1_000).toISOString();
    writeFileSync(
      join(stagingDirectory, 'restore-drill.json'),
      JSON.stringify({
        schemaVersion: 1,
        status: 'passed',
        environment: 'staging',
        evidenceType: 'restore-drill',
        releaseSha,
        imageDigests,
        startedAt: artifact.startedAt,
        finishedAt: artifact.finishedAt,
        durationMs: finishedAtMs - startedAtMs,
        checkedAt,
        metrics: {
          rpoMinutes: (startedAtMs - Date.parse(run.recoveryPointAt)) / 60_000,
          rtoMinutes: (finishedAtMs - startedAtMs) / 60_000,
        },
        thresholds: { maxRpoMinutes: 15, maxRtoMinutes: 60 },
        results: {
          schemaGatePassed: true,
          fixtureRoundTripPassed: true,
          legalHoldInvariantPassed: true,
        },
        rawArtifact: rawReference,
        offsiteArtifact: offsiteReference,
        artifacts: [rawReference, offsiteReference],
        provenance: {
          runId: '123',
          repository: 'example/repository',
          runUrl: 'https://github.com/example/repository/actions/runs/123',
        },
        source: 'https://github.com/example/repository/actions/runs/123',
      }),
    );
    const restoreGate = inspectStagingGates(run.directory, {
      releaseSha,
      imageDigests,
      expectedSchemaMigration: expectedMigration,
      expectedSchemaChecksum,
      evidenceRunId: '123',
      nowMs: Date.parse(checkedAt),
    }).find((check) => check.id === 'staging-restore');
    expect(restoreGate?.status, restoreGate?.reason).toBe('passed');

    const reports = readdirSync(run.reportDirectory).map((name) =>
      readFileSync(join(run.reportDirectory, name), 'utf8'),
    );
    const metrics = readFileSync(join(run.metricsDirectory, 'zutomayo_pg_restore_drill.prom'), 'utf8');
    expect(metrics).toContain('pg_restore_drill_success 1');
    for (const output of [artifactContents, reports.join('\n'), commands.join('\n'), run.result.stdout]) {
      expect(output).not.toContain(secret);
    }
  });

  it.each(['', 'null'])('requires an immutable object version before invoking AWS (%j)', (objectVersion) => {
    const run = harness({ objectVersion });
    expect(run.result.status).not.toBe(0);
    expect(run.result.stderr).toContain('PG_RESTORE_DRILL_OBJECT_VERSION_ID is required');
    expect(existsSync(run.commandLog)).toBe(false);
    expect(readdirSync(run.artifactDirectory).filter((name) => name.endsWith('.json'))).toHaveLength(0);
  });

  it.each([
    ['release SHA', { releaseSha: '' }, 'RELEASE_SHA must be a full 40-character commit SHA'],
    ['expected schema', { expectedMigration: '' }, 'EXPECTED_SCHEMA_MIGRATION must be a migration basename'],
  ] as const)('requires the %s binding before external commands', (_label, options, message) => {
    const run = harness(options);
    expect(run.result.status).not.toBe(0);
    expect(run.result.stderr).toContain(message);
    expect(existsSync(run.commandLog)).toBe(false);
    expect(readdirSync(run.artifactDirectory).filter((name) => name.endsWith('.json'))).toHaveLength(0);
  });

  it.each([
    ['checksum mismatch', { checksumMismatch: true }, 'backup checksum mismatch'],
    ['decryption failure', { ageFailure: true }, ''],
    ['schema binding failure', { schemaBindingFailure: true }, 'schema migration/checksum binding mismatch'],
    ['schema invariant failure', { invariantFailure: true }, 'restored invariant failed'],
    ['core-data invariant failure', { coreDataFailure: true }, 'restored invariant failed'],
    ['legal-hold invariant failure', { legalHoldFailure: true }, 'restored invariant failed'],
  ] as const)('does not emit successful evidence after %s', (_label, options, expectedError) => {
    const run = harness(options);
    expect(run.result.status).not.toBe(0);
    if (expectedError) expect(run.result.stderr).toContain(expectedError);
    expect(readdirSync(run.artifactDirectory).filter((name) => name.endsWith('.json'))).toHaveLength(0);
    expect(readFileSync(join(run.metricsDirectory, 'zutomayo_pg_restore_drill.prom'), 'utf8')).toContain(
      'pg_restore_drill_success 0',
    );
  });
});
