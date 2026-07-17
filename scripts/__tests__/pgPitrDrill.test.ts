import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const scriptPath = resolve(root, 'scripts/pg-pitr-drill.sh');
const sourceInitPath = resolve(root, 'scripts/pg-pitr-source-init.sh');
const composePath = resolve(root, 'docker-compose.pitr-drill.yml');
const pinnedImage = `postgres:16-alpine@sha256:${'a'.repeat(64)}`;
const pinnedMigrateImage = `ghcr.io/example/migrate@sha256:${'d'.repeat(64)}`;
const expectedMigration = '000033_admin_linked_auth_contract';
const expectedChecksum = 'b'.repeat(64);
const releaseSha = 'c'.repeat(40);

type GateModule = {
  inspectStagingGates(
    stagingEvidenceDir: string,
    options: {
      releaseSha: string;
      nowMs: number;
      imageDigests: Record<string, string>;
      evidenceRunId: string;
      expectedSchemaMigration?: string;
      expectedSchemaChecksum?: string;
    },
  ): Array<{ id: string; status: string; reason: string }>;
};

// @ts-expect-error The runtime MJS module intentionally has no generated declarations.
const { inspectStagingGates } = (await import('../release-gate.mjs')) as GateModule;

describe('physical PostgreSQL PITR drill', () => {
  it('has valid Bash syntax', () => {
    const result = spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const sourceInit = spawnSync('sh', ['-n', sourceInitPath], { encoding: 'utf8' });
    expect(sourceInit.status, sourceInit.stderr).toBe(0);
  });

  it('fails closed on a tag-only PostgreSQL image before invoking Docker', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-pitr-preflight-'));
    const binDirectory = resolve(directory, 'bin');
    const dockerMarker = resolve(directory, 'docker-called');
    mkdirSync(binDirectory);
    const dockerPath = resolve(binDirectory, 'docker');
    writeFileSync(dockerPath, `#!/bin/sh\ntouch "$DOCKER_MARKER"\nexit 0\n`);
    chmodSync(dockerPath, 0o755);

    const result = spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCKER_MARKER: dockerMarker,
        EXPECTED_SCHEMA_CHECKSUM: expectedChecksum,
        EXPECTED_SCHEMA_MIGRATION: expectedMigration,
        PATH: `${binDirectory}:${process.env.PATH}`,
        PG_PITR_DRILL_IMAGE: 'postgres:16-alpine',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('immutable @sha256 image reference');
    expect(() => readFileSync(dockerMarker)).toThrow();
  });

  it('fails closed on an invalid release binding before invoking Docker', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-pitr-release-'));
    const binDirectory = resolve(directory, 'bin');
    const dockerMarker = resolve(directory, 'docker-called');
    mkdirSync(binDirectory);
    const dockerPath = resolve(binDirectory, 'docker');
    writeFileSync(dockerPath, `#!/bin/sh\ntouch "$DOCKER_MARKER"\nexit 0\n`);
    chmodSync(dockerPath, 0o755);

    const result = spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCKER_MARKER: dockerMarker,
        EXPECTED_SCHEMA_CHECKSUM: expectedChecksum,
        EXPECTED_SCHEMA_MIGRATION: expectedMigration,
        PATH: `${binDirectory}:${process.env.PATH}`,
        PG_PITR_DRILL_IMAGE: pinnedImage,
        RELEASE_SHA: 'not-a-release-sha',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('full 40-character commit SHA');
    expect(() => readFileSync(dockerMarker)).toThrow();
  });

  it.each(['existing', 'symlink'] as const)('rejects a %s artifact directory before invoking Docker', (kind) => {
    const directory = mkdtempSync(resolve(tmpdir(), `zutomayo-pitr-artifact-${kind}-`));
    const binDirectory = resolve(directory, 'bin');
    const artifactDirectory = resolve(directory, 'artifacts');
    const dockerMarker = resolve(directory, 'docker-called');
    mkdirSync(binDirectory);
    if (kind === 'existing') {
      mkdirSync(artifactDirectory);
    } else {
      const target = resolve(directory, 'artifact-target');
      mkdirSync(target);
      symlinkSync(target, artifactDirectory);
    }
    const dockerPath = resolve(binDirectory, 'docker');
    writeFileSync(dockerPath, `#!/bin/sh\ntouch "$DOCKER_MARKER"\nexit 0\n`);
    chmodSync(dockerPath, 0o755);

    const result = spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCKER_MARKER: dockerMarker,
        EXPECTED_SCHEMA_CHECKSUM: expectedChecksum,
        EXPECTED_SCHEMA_MIGRATION: expectedMigration,
        PATH: `${binDirectory}:${process.env.PATH}`,
        PG_PITR_DRILL_ARTIFACT_DIR: artifactDirectory,
        PG_PITR_DRILL_IMAGE: pinnedImage,
        PG_PITR_DRILL_MIGRATE_IMAGE: pinnedMigrateImage,
        RELEASE_SHA: releaseSha,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('artifact directory already exists');
    expect(() => readFileSync(dockerMarker)).toThrow();
  });

  it('orchestrates source, migration, physical recovery, validation, then cleanup in order', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'zutomayo-pitr-order-'));
    const binDirectory = resolve(directory, 'bin');
    const artifactDirectory = resolve(directory, 'artifacts');
    const callsPath = resolve(directory, 'docker-calls.log');
    mkdirSync(binDirectory);
    const dockerPath = resolve(binDirectory, 'docker');
    writeFileSync(
      dockerPath,
      `#!/bin/sh
set -eu
printf '%s\\n' "$*" >>"$DOCKER_CALLS"
case "$*" in
  *"run --rm --no-deps drill"*)
    cat >"$PG_PITR_DRILL_ARTIFACT_DIR/pitr-drill-$PG_PITR_RUN_ID.json" <<JSON
{
  "schemaVersion": 1,
  "artifactType": "zutomayo-restore-drill-raw",
  "releaseSha": "$RELEASE_SHA",
  "runId": "$PG_PITR_RUN_ID",
  "success": true,
  "exitCode": 0,
  "failureStep": "complete",
  "startedAt": "2026-07-15T00:00:00.000Z",
  "finishedAt": "2026-07-15T00:00:01.000Z",
  "durationSeconds": 1,
  "backup": { "method": "pg_basebackup", "verified": true, "manifestSha256": "${'f'.repeat(64)}" },
  "restore": {
    "mode": "pitr",
    "targetAt": "2026-07-15T00:00:00.500Z",
    "recoveredThroughAt": "2026-07-15T00:00:00.500Z",
    "baseBackupSha256": "${'f'.repeat(64)}",
    "walSegmentsApplied": 2,
    "targetReached": true,
    "promoted": true
  },
  "checks": {
    "schemaGatePassed": true,
    "fixtureRoundTripPassed": true,
    "legalHoldInvariantPassed": true,
    "expectedMigration": "$EXPECTED_SCHEMA_MIGRATION",
    "expectedSchemaChecksum": "$EXPECTED_SCHEMA_CHECKSUM",
    "migrateImage": "$PG_PITR_DRILL_MIGRATE_IMAGE",
    "expectedMigrationCount": 1,
    "requiredTableCount": 8,
    "markerBeforeCount": 1,
    "walReplayProbeCount": 1,
    "markerAfterCount": 0,
    "sourceMarkerAfterCount": 1,
    "unvalidatedConstraints": 0,
    "invalidOutboxStatus": 0,
    "deletionHoldViolations": 0,
    "deletedSocialViolations": 0
  }
}
JSON
    ;;
esac
`,
    );
    chmodSync(dockerPath, 0o755);

    const result = spawnSync('bash', [scriptPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCKER_CALLS: callsPath,
        EXPECTED_SCHEMA_CHECKSUM: expectedChecksum,
        EXPECTED_SCHEMA_MIGRATION: expectedMigration,
        PATH: `${binDirectory}:${process.env.PATH}`,
        PG_PITR_DRILL_ARTIFACT_DIR: artifactDirectory,
        PG_PITR_DRILL_IMAGE: pinnedImage,
        PG_PITR_DRILL_MIGRATE_IMAGE: pinnedMigrateImage,
        PG_PITR_DRILL_PROJECT: 'zutomayo-pitr-contract',
        PG_PITR_RUN_ID: 'contract-order',
        RELEASE_SHA: releaseSha,
      },
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const calls = readFileSync(callsPath, 'utf8').trim().split('\n');
    const indexOf = (fragment: string) => calls.findIndex((call) => call.includes(fragment));
    expect(indexOf('config --quiet')).toBeGreaterThan(indexOf('version'));
    expect(indexOf('pull --quiet migrate')).toBeGreaterThan(indexOf('config --quiet'));
    expect(indexOf('up --detach --wait source')).toBeGreaterThan(indexOf('pull --quiet migrate'));
    expect(indexOf('run --rm --no-deps migrate')).toBeGreaterThan(indexOf('up --detach --wait source'));
    expect(indexOf('run --rm --no-deps drill')).toBeGreaterThan(indexOf('run --rm --no-deps migrate'));
    expect(indexOf('down --volumes --remove-orphans')).toBeGreaterThan(indexOf('run --rm --no-deps drill'));

    const artifactPath = resolve(artifactDirectory, 'pitr-drill-contract-order.json');
    const artifactContents = readFileSync(artifactPath, 'utf8');
    const artifact = JSON.parse(artifactContents) as Record<string, unknown>;
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      artifactType: 'zutomayo-restore-drill-raw',
      releaseSha,
      success: true,
    });

    const stagingDirectory = resolve(directory, 'staging');
    mkdirSync(stagingDirectory);
    const relativeArtifactPath = 'artifacts/pitr-drill-contract-order.json';
    const sha256 = createHash('sha256').update(artifactContents).digest('hex');
    const imageDigests = Object.fromEntries(
      ['game', 'api', 'platform', 'migrate', 'retention', 'gateway', 'ops'].map((name) => [
        name,
        name === 'migrate' ? pinnedMigrateImage : `ghcr.io/example/${name}@sha256:${'0'.repeat(64)}`,
      ]),
    );
    writeFileSync(
      resolve(stagingDirectory, 'restore-drill.json'),
      JSON.stringify({
        schemaVersion: 1,
        status: 'passed',
        environment: 'staging',
        evidenceType: 'restore-drill',
        releaseSha,
        imageDigests,
        startedAt: artifact.startedAt,
        finishedAt: artifact.finishedAt,
        durationMs: 1_000,
        checkedAt: '2026-07-15T00:01:00.000Z',
        metrics: { rpoMinutes: 0, rtoMinutes: 1 / 60 },
        thresholds: { maxRpoMinutes: 15, maxRtoMinutes: 60 },
        results: {
          schemaGatePassed: true,
          fixtureRoundTripPassed: true,
          legalHoldInvariantPassed: true,
        },
        rawArtifact: { path: relativeArtifactPath, sha256 },
        artifacts: [{ path: relativeArtifactPath, sha256 }],
        provenance: {
          runId: '123',
          repository: 'example/repository',
          runUrl: 'https://github.com/example/repository/actions/runs/123',
        },
        source: 'https://ci.example.test/runs/123',
      }),
    );
    const restoreCheck = inspectStagingGates(directory, {
      releaseSha,
      imageDigests,
      evidenceRunId: '123',
      expectedSchemaMigration: expectedMigration,
      expectedSchemaChecksum: expectedChecksum,
      nowMs: Date.parse('2026-07-15T00:02:00.000Z'),
    }).find((check) => check.id === 'staging-restore');
    expect(restoreCheck?.status).toBe('blocked');
    expect(restoreCheck?.reason).toContain('offsiteArtifact');
  });

  it('keeps the physical recovery operations and evidence checks in fail-closed order', () => {
    const script = readFileSync(scriptPath, 'utf8');
    expect(script).toContain('date -u +%Y-%m-%dT%H:%M:%S.000Z');
    const orderedFragments = [
      "insert_marker 'marker-before'",
      'pg_basebackup \\',
      'pg_verifybackup "$base_dir"',
      "insert_marker 'wal-replay-probe'",
      'pg_create_restore_point',
      'first_archived_wal="$(force_archive)"',
      "insert_marker 'marker-after'",
      'second_archived_wal="$(force_archive)"',
      "restore_command = 'cp /pitr-wal/%f %p'",
      "recovery_target_name = '$restore_target_name'",
      'touch "$recovery_dir/recovery.signal"',
      'marker_after_count="$(psql_recovery',
      '[[ "$marker_after_count" == 0 ]]',
      "current_step='recovery_schema_gate'",
      "current_step='recovery_invariants'",
      'write_result true 0',
    ];

    let previousIndex = -1;
    for (const fragment of orderedFragments) {
      const index = script.indexOf(fragment, previousIndex + 1);
      expect(index, fragment).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it('uses only an internal network, no published ports, and no persisted credentials', () => {
    const compose = readFileSync(composePath, 'utf8');
    expect(compose).toContain('internal: true');
    expect(compose).not.toContain('ports:');
    expect(compose).not.toMatch(/PASSWORD:\s+[^']\S+/);
    expect(compose).toContain('POSTGRES_HOST_AUTH_METHOD: trust');
    expect(compose).toContain('./scripts/pg-pitr-source-init.sh:/docker-entrypoint-initdb.d/10-pitr-replication.sh:ro');
    expect(readFileSync(sourceInitPath, 'utf8')).toContain('host replication all all trust');
    expect(compose).toContain('${PG_PITR_DRILL_IMAGE:?');
    expect(compose).toContain('${PG_PITR_DRILL_MIGRATE_IMAGE:?');
    expect(compose).toContain('chmod 0770 /artifacts');
    expect(compose).toContain('RELEASE_SHA: ${RELEASE_SHA:?');
  });
});
