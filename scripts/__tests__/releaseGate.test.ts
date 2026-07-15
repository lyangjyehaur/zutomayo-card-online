import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type GateCheck = { id: string; category: string; status: string; reason: string };
type GateModule = {
  aggregateStatus(checks: Array<{ status: string }>): string;
  inspectStagingGates(
    stagingEvidenceDir?: string,
    options?: {
      releaseSha?: string;
      maxEvidenceAgeHours?: number;
      nowMs?: number;
      imageDigests?: Record<string, string>;
      expectedSchemaMigration?: string;
      expectedSchemaChecksum?: string;
      evidenceRunId?: string;
    },
  ): GateCheck[];
  renderMarkdown(summary: {
    status: string;
    generatedAt: string;
    repository: string;
    commit: string;
    checks: Array<{ category: string; title: string; status: string; reason: string }>;
  }): string;
};

// @ts-expect-error The runtime MJS module intentionally has no generated declarations.
const { aggregateStatus, inspectStagingGates, renderMarkdown } = (await import('../release-gate.mjs')) as GateModule;

function authenticatedEvidence(directory: string) {
  const artifactPath = 'staging/authenticated-e2e-report.json';
  const artifactContents = JSON.stringify({ journey: 'passed', history: 'verified' });
  writeFileSync(join(directory, artifactPath), artifactContents);
  return {
    schemaVersion: 1,
    status: 'passed',
    environment: 'staging',
    evidenceType: 'authenticated-e2e',
    releaseSha: 'a'.repeat(40),
    imageDigests: Object.fromEntries(
      ['game', 'api', 'platform', 'migrate', 'retention', 'gateway', 'ops'].map((name) => [
        name,
        `ghcr.io/example/${name}@sha256:${'0'.repeat(64)}`,
      ]),
    ),
    startedAt: '2026-07-12T23:30:00.000Z',
    finishedAt: '2026-07-12T23:50:00.000Z',
    durationMs: 20 * 60 * 1000,
    checkedAt: '2026-07-13T00:00:00.000Z',
    metrics: { completedJourneys: 2, failedSteps: 0 },
    thresholds: { minCompletedJourneys: 2, maxFailedSteps: 0 },
    results: { authenticatedJourneyPassed: true, historyVerified: true },
    artifacts: [
      {
        path: artifactPath,
        sha256: createHash('sha256').update(artifactContents).digest('hex'),
      },
    ],
    provenance: {
      runId: '123',
      repository: 'example/repository',
      runUrl: 'https://github.com/example/repository/actions/runs/123',
    },
    source: 'https://ci.example.test/runs/123',
  };
}

function writeEvidenceArtifact(directory: string, artifactPath: string, contents: string) {
  writeFileSync(join(directory, artifactPath), contents);
  return {
    path: artifactPath,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

interface OperationalEvidenceFixture {
  schemaVersion: number;
  status: string;
  environment: string;
  evidenceType: string;
  releaseSha: string;
  imageDigests: Record<string, string>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  checkedAt: string;
  metrics: Record<string, number>;
  thresholds: Record<string, number>;
  results: Record<string, boolean>;
  rawArtifact: { path: string; sha256: string };
  offsiteArtifact?: { path: string; sha256: string };
  artifacts: Array<{ path: string; sha256: string }>;
  provenance: { runId: string; repository: string; runUrl: string };
  source: string;
}

function operationalEvidence(
  directory: string,
  options: {
    evidenceType: string;
    rawArtifactName: string;
    raw: Record<string, unknown>;
    metrics: Record<string, number>;
    thresholds: Record<string, number>;
    results: Record<string, boolean>;
  },
): OperationalEvidenceFixture {
  const rawArtifact = writeEvidenceArtifact(
    directory,
    `staging/${options.rawArtifactName}`,
    JSON.stringify(options.raw),
  );
  const startedAt = String(options.raw.startedAt);
  const finishedAt = String(options.raw.finishedAt);
  return {
    schemaVersion: 1,
    status: 'passed',
    environment: 'staging',
    evidenceType: options.evidenceType,
    releaseSha: 'a'.repeat(40),
    imageDigests: Object.fromEntries(
      ['game', 'api', 'platform', 'migrate', 'retention', 'gateway', 'ops'].map((name) => [
        name,
        `ghcr.io/example/${name}@sha256:${'0'.repeat(64)}`,
      ]),
    ),
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    checkedAt: '2026-07-13T03:00:00.000Z',
    metrics: options.metrics,
    thresholds: options.thresholds,
    results: options.results,
    rawArtifact,
    artifacts: [{ ...rawArtifact }],
    provenance: {
      runId: '123',
      repository: 'example/repository',
      runUrl: 'https://github.com/example/repository/actions/runs/123',
    },
    source: 'https://ci.example.test/runs/123',
  };
}

function restoreEvidence(directory: string) {
  const evidence = operationalEvidence(directory, {
    evidenceType: 'restore-drill',
    rawArtifactName: 'restore-drill-raw.json',
    raw: {
      schemaVersion: 1,
      artifactType: 'zutomayo-restore-drill-raw',
      releaseSha: 'a'.repeat(40),
      startedAt: '2026-07-13T00:00:00.000Z',
      finishedAt: '2026-07-13T00:45:00.000Z',
      durationSeconds: 45 * 60,
      success: true,
      exitCode: 0,
      backup: {
        method: 'pg_basebackup',
        verified: true,
        manifestSha256: 'f'.repeat(64),
      },
      restore: {
        mode: 'pitr',
        targetAt: '2026-07-12T23:55:00.000Z',
        recoveredThroughAt: '2026-07-12T23:45:00.000Z',
        baseBackupSha256: 'f'.repeat(64),
        walSegmentsApplied: 4,
        targetReached: true,
        promoted: true,
      },
      checks: {
        schemaGatePassed: true,
        fixtureRoundTripPassed: true,
        legalHoldInvariantPassed: true,
        expectedMigration: '000027_account_deletion_anonymization',
        expectedSchemaChecksum: '9'.repeat(64),
        migrateImage: 'ghcr.io/example/migrate@sha256:' + '0'.repeat(64),
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
    },
    metrics: { rpoMinutes: 10, rtoMinutes: 45 },
    thresholds: { maxRpoMinutes: 15, maxRtoMinutes: 60 },
    results: { schemaGatePassed: true, fixtureRoundTripPassed: true, legalHoldInvariantPassed: true },
  });
  const offsiteArtifact = writeEvidenceArtifact(
    directory,
    'staging/encrypted-offsite-restore-raw.json',
    JSON.stringify({
      schemaVersion: 1,
      artifactType: 'zutomayo-encrypted-offsite-restore-raw',
      releaseSha: 'a'.repeat(40),
      startedAt: '2026-07-13T00:00:00.000Z',
      finishedAt: '2026-07-13T00:45:00.000Z',
      backup: {
        remoteObjectUrl: 's3://zutomayo-staging-backups/logical/release.dump.age',
        objectVersionId: 'version-123',
        checksumObjectVersionId: 'checksum-version-123',
        encrypted: true,
        encryptionScheme: 'age',
        artifactSha256: 'e'.repeat(64),
        recoveryPointAt: '2026-07-12T23:50:00.000Z',
        objectLastModifiedAt: '2026-07-12T23:55:00.000Z',
        checksumVerified: true,
        decryptSucceeded: true,
      },
      restore: {
        isolated: true,
        completed: true,
        schema: {
          expectedMigration: '000027_account_deletion_anonymization',
          expectedChecksum: '9'.repeat(64),
          migrateImage: 'ghcr.io/example/migrate@sha256:' + '0'.repeat(64),
        },
        observations: {
          schemaMigrations: 26,
          expectedSchemaBinding: 1,
          users: 8,
          cards: 240,
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
    }),
  );
  evidence.offsiteArtifact = offsiteArtifact;
  evidence.artifacts.push({ ...offsiteArtifact });
  return evidence;
}

function chaosEvidence(directory: string) {
  return operationalEvidence(directory, {
    evidenceType: 'chaos-reconnect',
    rawArtifactName: 'chaos-reconnect-raw.json',
    raw: {
      schemaVersion: 1,
      artifactType: 'zutomayo-chaos-reconnect-raw',
      releaseSha: 'a'.repeat(40),
      startedAt: '2026-07-13T00:00:00.000Z',
      finishedAt: '2026-07-13T00:05:00.000Z',
      failovers: [
        {
          component: 'postgres',
          injectedAt: '2026-07-13T00:00:00.000Z',
          probes: [
            { at: '2026-07-13T00:00:10.000Z', healthy: false },
            { at: '2026-07-13T00:01:00.000Z', healthy: true },
            { at: '2026-07-13T00:01:01.000Z', healthy: true },
            { at: '2026-07-13T00:01:02.000Z', healthy: true },
          ],
        },
        {
          component: 'redis',
          injectedAt: '2026-07-13T00:02:00.000Z',
          probes: [
            { at: '2026-07-13T00:02:05.000Z', healthy: false },
            { at: '2026-07-13T00:03:00.000Z', healthy: true },
            { at: '2026-07-13T00:03:01.000Z', healthy: true },
            { at: '2026-07-13T00:03:02.000Z', healthy: true },
          ],
        },
      ],
      websocket: {
        disconnectedAt: '2026-07-13T00:00:10.000Z',
        reconnectedAt: '2026-07-13T00:01:00.000Z',
        stateRecovered: true,
      },
      outbox: {
        expectedMessageIds: ['message-1'],
        deliveries: [{ messageId: 'message-1', deliveredAt: '2026-07-13T00:03:10.000Z' }],
      },
    },
    metrics: { recoverySeconds: 62, duplicateDeliveries: 0 },
    thresholds: { maxRecoverySeconds: 300, maxDuplicateDeliveries: 0 },
    results: { postgresRecovered: true, redisRecovered: true, websocketReconnected: true, outboxRecovered: true },
  });
}

function loadEvidence(directory: string) {
  return operationalEvidence(directory, {
    evidenceType: 'load-soak',
    rawArtifactName: 'load-soak-raw.json',
    raw: {
      schemaVersion: 1,
      artifactType: 'zutomayo-load-soak-raw',
      releaseSha: 'a'.repeat(40),
      startedAt: '2026-07-13T00:00:00.000Z',
      finishedAt: '2026-07-13T02:30:00.000Z',
      observedPeakRps: 10,
      runs: [
        {
          kind: 'peak',
          startedAt: '2026-07-13T00:00:00.000Z',
          finishedAt: '2026-07-13T00:30:00.000Z',
          targetRps: 20,
          droppedIterations: 0,
          statusCounts: { 200: 36_000 },
          latencyDistribution: [{ latencyMs: 100, count: 36_000 }],
        },
        {
          kind: 'soak',
          startedAt: '2026-07-13T00:30:00.000Z',
          finishedAt: '2026-07-13T02:30:00.000Z',
          targetRps: 20,
          droppedIterations: 0,
          statusCounts: { 200: 144_000 },
          latencyDistribution: [{ latencyMs: 100, count: 144_000 }],
        },
      ],
    },
    metrics: { peakMultiplier: 2, durationMinutes: 120, p95LatencyMs: 100, errorRate: 0 },
    thresholds: { minPeakMultiplier: 2, minDurationMinutes: 120, maxP95LatencyMs: 500, maxErrorRate: 0.01 },
    results: { sloPassed: true },
  });
}

function alertEvidence(directory: string) {
  return operationalEvidence(directory, {
    evidenceType: 'alertmanager-delivery',
    rawArtifactName: 'alertmanager-delivery-raw.json',
    raw: {
      schemaVersion: 1,
      artifactType: 'zutomayo-alertmanager-delivery-raw',
      releaseSha: 'a'.repeat(40),
      startedAt: '2026-07-13T00:00:00.000Z',
      finishedAt: '2026-07-13T00:10:00.000Z',
      notifications: [
        {
          alertId: 'alert-1',
          state: 'firing',
          emittedAt: '2026-07-13T00:00:00.000Z',
          deliveredAt: '2026-07-13T00:02:00.000Z',
          deliveryId: 'delivery-1',
          receiver: 'primary-on-call',
        },
        {
          alertId: 'alert-1',
          state: 'resolved',
          emittedAt: '2026-07-13T00:05:00.000Z',
          deliveredAt: '2026-07-13T00:06:30.000Z',
          deliveryId: 'delivery-2',
          receiver: 'primary-on-call',
        },
      ],
    },
    metrics: { firingDeliverySeconds: 120, resolvedDeliverySeconds: 90 },
    thresholds: { maxFiringDeliverySeconds: 300, maxResolvedDeliverySeconds: 300 },
    results: { firingDelivered: true, resolvedDelivered: true },
  });
}

const OPERATIONAL_SUMMARY_PATHS: Record<string, string> = {
  'restore-drill': 'restore-drill.json',
  'chaos-reconnect': 'chaos-reconnect.json',
  'load-soak': 'load-soak.json',
  'alertmanager-delivery': 'alertmanager-delivery.json',
};

const OPERATIONAL_GATE_IDS: Record<string, string> = {
  'restore-drill': 'staging-restore',
  'chaos-reconnect': 'staging-chaos',
  'load-soak': 'staging-load-soak',
  'alertmanager-delivery': 'staging-alerts',
};

function inspectOperationalEvidence(directory: string, evidence: OperationalEvidenceFixture) {
  writeFileSync(join(directory, 'staging', OPERATIONAL_SUMMARY_PATHS[evidence.evidenceType]), JSON.stringify(evidence));
  const check = inspectStagingGates(directory, {
    releaseSha: evidence.releaseSha,
    imageDigests: evidence.imageDigests,
    expectedSchemaMigration: '000027_account_deletion_anonymization',
    expectedSchemaChecksum: '9'.repeat(64),
    evidenceRunId: '123',
    nowMs: Date.parse('2026-07-13T04:00:00.000Z'),
  }).find((candidate) => candidate.id === OPERATIONAL_GATE_IDS[evidence.evidenceType]);
  if (!check) throw new Error(`missing operational gate ${evidence.evidenceType}`);
  return check;
}

function rewriteOperationalRawArtifact(
  directory: string,
  evidence: OperationalEvidenceFixture,
  mutate: (raw: Record<string, unknown>) => void,
) {
  const artifactPath = join(directory, evidence.rawArtifact.path);
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, unknown>;
  mutate(raw);
  const contents = JSON.stringify(raw);
  writeFileSync(artifactPath, contents);
  const sha256 = createHash('sha256').update(contents).digest('hex');
  evidence.rawArtifact.sha256 = sha256;
  evidence.artifacts[0].sha256 = sha256;
}

function rewriteRestoreOffsiteArtifact(
  directory: string,
  evidence: OperationalEvidenceFixture,
  mutate: (raw: Record<string, unknown>) => void,
) {
  if (!evidence.offsiteArtifact) throw new Error('missing offsite fixture artifact');
  const artifactPath = join(directory, evidence.offsiteArtifact.path);
  const raw = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, unknown>;
  mutate(raw);
  const contents = JSON.stringify(raw);
  writeFileSync(artifactPath, contents);
  const sha256 = createHash('sha256').update(contents).digest('hex');
  evidence.offsiteArtifact.sha256 = sha256;
  const artifact = evidence.artifacts.find((candidate) => candidate.path === evidence.offsiteArtifact?.path);
  if (!artifact) throw new Error('missing offsite fixture artifacts[] entry');
  artifact.sha256 = sha256;
}

function canaryEvidence(directory: string) {
  const imageDigests = Object.fromEntries(
    ['game', 'api', 'platform', 'migrate', 'retention', 'gateway', 'ops'].map((name) => [
      name,
      `ghcr.io/example/${name}@sha256:${'0'.repeat(64)}`,
    ]),
  );
  const candidateReleaseSet = {
    game: imageDigests.game,
    api: imageDigests.api,
    platform: imageDigests.platform,
  };
  const stableReleaseSet = {
    game: `ghcr.io/example/game@sha256:${'1'.repeat(64)}`,
    api: `ghcr.io/example/api@sha256:${'2'.repeat(64)}`,
    platform: `ghcr.io/example/platform@sha256:${'3'.repeat(64)}`,
  };
  const stableReleaseSha = 'b'.repeat(40);
  const artifacts: Array<{ path: string; sha256: string }> = [];
  const stableManifestArtifact = writeEvidenceArtifact(
    directory,
    'staging/stable-release.env',
    [
      `RELEASE_SHA=${stableReleaseSha}`,
      `GAME_IMAGE=${stableReleaseSet.game}`,
      `API_IMAGE=${stableReleaseSet.api}`,
      `PLATFORM_IMAGE=${stableReleaseSet.platform}`,
      '',
    ].join('\n'),
  );
  artifacts.push({ ...stableManifestArtifact });
  const stageTimes = [
    ['2026-07-12T23:30:00.000Z', '2026-07-12T23:35:00.000Z'],
    ['2026-07-12T23:35:00.000Z', '2026-07-12T23:40:00.000Z'],
    ['2026-07-12T23:40:00.000Z', '2026-07-12T23:45:00.000Z'],
  ];
  const stages = [10, 50, 100].map((weightPercent, index) => {
    const gatewayConfig = {
      schemaVersion: 1,
      artifactType: 'zutomayo-canary-gateway-config',
      phase: 'rollout',
      sequence: index + 1,
      activeReleaseSet: weightPercent === 100 ? 'candidate' : 'mixed',
      traffic: {
        stableWeightPercent: 100 - weightPercent,
        candidateWeightPercent: weightPercent,
      },
      releaseSets: { stable: stableReleaseSet, candidate: candidateReleaseSet },
    };
    const gatewayConfigArtifact = writeEvidenceArtifact(
      directory,
      `staging/canary-gateway-${weightPercent}.json`,
      JSON.stringify(gatewayConfig),
    );
    const rawMetricsArtifact = writeEvidenceArtifact(
      directory,
      `staging/canary-metrics-${weightPercent}.json`,
      JSON.stringify({
        schemaVersion: 1,
        artifactType: 'zutomayo-canary-raw-metrics',
        phase: 'rollout',
        sequence: index + 1,
        stableWeightPercent: 100 - weightPercent,
        candidateWeightPercent: weightPercent,
        httpSamples: 1_000,
        websocketSamples: 100,
        readyReplicaCount: 2,
        gatewayConfigSha256: gatewayConfigArtifact.sha256,
        observation: {
          startedAt: stageTimes[index][0],
          finishedAt: stageTimes[index][1],
          dwellSeconds: 300,
        },
        policy: {
          requiredStages: 3,
          stageWeights: [10, 50, 100],
          maxRollbackSeconds: 300,
          maxRollbackObservationDelaySeconds: 60,
          maxRollbackObservationSeconds: 600,
          minStageDwellSeconds: 300,
          minHttpSamplesPerStage: 1_000,
          minWebsocketSamplesPerStage: 100,
          minReadyReplicaCount: 2,
        },
        policyPassed: true,
      }),
    );
    artifacts.push({ ...gatewayConfigArtifact }, { ...rawMetricsArtifact });
    return {
      sequence: index + 1,
      weightPercent,
      startedAt: stageTimes[index][0],
      finishedAt: stageTimes[index][1],
      httpSamples: 1_000,
      websocketSamples: 100,
      readyReplicaCount: 2,
      gatewayConfigSha256: gatewayConfigArtifact.sha256,
      gatewayConfigArtifact,
      rawMetricsArtifact,
    };
  });
  const rollbackGatewayConfig = {
    schemaVersion: 1,
    artifactType: 'zutomayo-canary-gateway-config',
    phase: 'rollback',
    sequence: 4,
    activeReleaseSet: 'stable',
    traffic: { stableWeightPercent: 100, candidateWeightPercent: 0 },
    releaseSets: { stable: stableReleaseSet, candidate: candidateReleaseSet },
  };
  const rollbackGatewayConfigArtifact = writeEvidenceArtifact(
    directory,
    'staging/canary-gateway-rollback.json',
    JSON.stringify(rollbackGatewayConfig),
  );
  const rollbackRawMetricsArtifact = writeEvidenceArtifact(
    directory,
    'staging/canary-metrics-rollback.json',
    JSON.stringify({
      schemaVersion: 1,
      artifactType: 'zutomayo-canary-raw-metrics',
      phase: 'rollback',
      sequence: 4,
      stableWeightPercent: 100,
      candidateWeightPercent: 0,
      httpSamples: 1_000,
      websocketSamples: 100,
      readyReplicaCount: 2,
      rollbackSeconds: 240,
      gatewayConfigSha256: rollbackGatewayConfigArtifact.sha256,
      observation: {
        startedAt: '2026-07-12T23:49:00.000Z',
        finishedAt: '2026-07-12T23:54:00.000Z',
        dwellSeconds: 300,
      },
    }),
  );
  artifacts.push({ ...rollbackGatewayConfigArtifact }, { ...rollbackRawMetricsArtifact });
  return {
    schemaVersion: 1,
    status: 'passed',
    environment: 'staging',
    evidenceType: 'canary-rollback',
    releaseSha: 'a'.repeat(40),
    imageDigests,
    startedAt: '2026-07-12T23:30:00.000Z',
    finishedAt: '2026-07-12T23:54:00.000Z',
    durationMs: 24 * 60 * 1_000,
    checkedAt: '2026-07-12T23:55:00.000Z',
    metrics: {
      rollbackSeconds: 240,
      rollbackObservationDelaySeconds: 0,
      rollbackObservationSeconds: 300,
      stagesCompleted: 3,
    },
    thresholds: {
      maxRollbackSeconds: 300,
      maxRollbackObservationDelaySeconds: 60,
      maxRollbackObservationSeconds: 600,
      requiredStages: 3,
      minStageDwellSeconds: 300,
      minHttpSamplesPerStage: 1_000,
      minWebsocketSamplesPerStage: 100,
      minReadyReplicaCount: 2,
    },
    results: { tenPercentPassed: true, fiftyPercentPassed: true, fullPassed: true, rollbackPassed: true },
    artifacts,
    provenance: {
      runId: '123',
      repository: 'example/repository',
      runUrl: 'https://github.com/example/repository/actions/runs/123',
    },
    source: 'https://ci.example.test/runs/123',
    rollout: {
      stableReleaseSha,
      stableManifestArtifact,
      stableReleaseSet,
      candidateReleaseSet,
      stages,
      rollback: {
        fromReleaseSet: { ...candidateReleaseSet },
        toReleaseSet: { ...stableReleaseSet },
        startedAt: '2026-07-12T23:45:00.000Z',
        finishedAt: '2026-07-12T23:49:00.000Z',
        observationStartedAt: '2026-07-12T23:49:00.000Z',
        observationFinishedAt: '2026-07-12T23:54:00.000Z',
        httpSamples: 1_000,
        websocketSamples: 100,
        readyReplicaCount: 2,
        gatewayConfigSha256: rollbackGatewayConfigArtifact.sha256,
        gatewayConfigArtifact: rollbackGatewayConfigArtifact,
        rawMetricsArtifact: rollbackRawMetricsArtifact,
      },
    },
  };
}

function rewriteEvidenceArtifact(
  directory: string,
  evidence: ReturnType<typeof canaryEvidence>,
  reference: { path: string; sha256: string },
  contents: string,
) {
  writeFileSync(join(directory, reference.path), contents);
  const sha256 = createHash('sha256').update(contents).digest('hex');
  reference.sha256 = sha256;
  const artifact = evidence.artifacts.find((item) => item.path === reference.path);
  if (!artifact) throw new Error(`missing fixture artifact ${reference.path}`);
  artifact.sha256 = sha256;
  return sha256;
}

function rewriteGatewayArtifact(
  directory: string,
  evidence: ReturnType<typeof canaryEvidence>,
  target: (typeof evidence.rollout.stages)[number] | typeof evidence.rollout.rollback,
  mutate: (config: Record<string, unknown>) => void,
) {
  const config = JSON.parse(readFileSync(join(directory, target.gatewayConfigArtifact.path), 'utf8')) as Record<
    string,
    unknown
  >;
  mutate(config);
  target.gatewayConfigSha256 = rewriteEvidenceArtifact(
    directory,
    evidence,
    target.gatewayConfigArtifact,
    JSON.stringify(config),
  );
}

function rewriteRawMetricsArtifact(
  directory: string,
  evidence: ReturnType<typeof canaryEvidence>,
  target: (typeof evidence.rollout.stages)[number] | typeof evidence.rollout.rollback,
  mutate: (metrics: Record<string, unknown>) => void,
) {
  const metrics = JSON.parse(readFileSync(join(directory, target.rawMetricsArtifact.path), 'utf8')) as Record<
    string,
    unknown
  >;
  mutate(metrics);
  rewriteEvidenceArtifact(directory, evidence, target.rawMetricsArtifact, JSON.stringify(metrics));
}

function inspectCanaryEvidence(directory: string, evidence: ReturnType<typeof canaryEvidence>) {
  writeFileSync(join(directory, 'staging', 'canary-rollback.json'), JSON.stringify(evidence));
  const checks = inspectStagingGates(directory, {
    releaseSha: evidence.releaseSha,
    imageDigests: evidence.imageDigests,
    evidenceRunId: '123',
    nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
  });
  const canary = checks.find((check) => check.id === 'staging-canary');
  if (!canary) throw new Error('staging canary gate was not returned');
  return canary;
}

describe('single release gate evidence model', () => {
  it('prioritizes failed over blocked and passed checks', () => {
    expect(aggregateStatus([{ status: 'passed' }, { status: 'blocked' }])).toBe('blocked');
    expect(aggregateStatus([{ status: 'blocked' }, { status: 'failed' }])).toBe('failed');
    expect(aggregateStatus([{ status: 'passed' }])).toBe('passed');
  });

  it('marks every staging-only gate blocked when external evidence is absent', () => {
    const checks = inspectStagingGates(undefined);
    expect(checks.length).toBeGreaterThan(4);
    expect(checks.every((check) => check.category === 'staging' && check.status === 'blocked')).toBe(true);
    expect(checks[0].reason).toContain('staging-only gate requires external evidence');
  });

  it('accepts only an explicit, attributable staging evidence contract', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-evidence-'));
    mkdirSync(join(directory, 'staging'));
    const evidencePath = join(directory, 'staging', 'authenticated-e2e.json');
    writeFileSync(
      evidencePath,
      JSON.stringify({
        status: 'passed',
        environment: 'staging',
        checkedAt: '2026-07-13T00:00:00.000Z',
        source: 'run-123',
      }),
    );
    const legacyChecks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
    });
    expect(legacyChecks[0].status).toBe('blocked');
    expect(legacyChecks[0].reason).toContain('schemaVersion: 1');

    const completeEvidence = authenticatedEvidence(directory);
    writeFileSync(
      evidencePath,
      JSON.stringify({
        schemaVersion: 1,
        status: 'passed',
        environment: 'staging',
        evidenceType: 'authenticated-e2e',
        releaseSha: 'a'.repeat(40),
        imageDigests: completeEvidence.imageDigests,
        checkedAt: '2026-07-13T00:00:00.000Z',
        source: 'https://ci.example.test/runs/123',
      }),
    );
    const minimalChecks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
    });
    expect(minimalChecks[0].status).toBe('blocked');
    expect(minimalChecks[0].reason).toContain('startedAt');
    expect(minimalChecks[0].reason).toContain('durationMs');
    expect(minimalChecks[0].reason).toContain('metrics object');
    expect(minimalChecks[0].reason).toContain('artifacts[]');

    writeFileSync(evidencePath, JSON.stringify(completeEvidence));
    const checks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
      imageDigests: completeEvidence.imageDigests,
      evidenceRunId: '123',
    });
    expect(checks[0].status).toBe('passed');
    expect(checks[0].reason).toContain('validated staging evidence contract');
    expect(checks[1].status).toBe('blocked');

    const mismatchedRelease = JSON.parse(readFileSync(evidencePath, 'utf8'));
    mismatchedRelease.releaseSha = 'b'.repeat(40);
    writeFileSync(evidencePath, JSON.stringify(mismatchedRelease));
    const mismatchChecks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
    });
    expect(mismatchChecks[0].status).toBe('blocked');
    expect(mismatchChecks[0].reason).toContain('releaseSha matching');

    const digestMismatch = JSON.parse(readFileSync(evidencePath, 'utf8'));
    digestMismatch.releaseSha = 'a'.repeat(40);
    digestMismatch.imageDigests.game = `ghcr.io/example/game@sha256:${'1'.repeat(64)}`;
    writeFileSync(evidencePath, JSON.stringify(digestMismatch));
    const digestChecks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      imageDigests: completeEvidence.imageDigests,
      evidenceRunId: '123',
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
    });
    expect(digestChecks[0].status).toBe('blocked');
    expect(digestChecks[0].reason).toContain('matching the release manifest');

    digestMismatch.imageDigests.game = completeEvidence.imageDigests.game;
    digestMismatch.provenance.runId = '456';
    writeFileSync(evidencePath, JSON.stringify(digestMismatch));
    const provenanceChecks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      imageDigests: completeEvidence.imageDigests,
      evidenceRunId: '123',
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
    });
    expect(provenanceChecks[0].status).toBe('blocked');
    expect(provenanceChecks[0].reason).toContain('provenance.runId matching 123');
  });

  it('rejects stale, future, and incomplete immutable release evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-freshness-'));
    mkdirSync(join(directory, 'staging'));
    const evidencePath = join(directory, 'staging', 'authenticated-e2e.json');
    const evidence = authenticatedEvidence(directory);
    evidence.checkedAt = '2026-07-12T22:00:00.000Z';
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const stale = inspectStagingGates(directory, {
      releaseSha: evidence.releaseSha,
      maxEvidenceAgeHours: 1,
      nowMs: Date.parse('2026-07-13T00:00:00.000Z'),
    });
    expect(stale[0].status).toBe('blocked');
    expect(stale[0].reason).toContain('no older than 1 hours');

    evidence.checkedAt = '2026-07-13T01:00:00.000Z';
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const future = inspectStagingGates(directory, {
      releaseSha: evidence.releaseSha,
      nowMs: Date.parse('2026-07-13T00:00:00.000Z'),
    });
    expect(future[0].status).toBe('blocked');
    expect(future[0].reason).toContain('not in the future');

    evidence.checkedAt = '2026-07-13T00:00:00.000Z';
    evidence.imageDigests.game = 'ghcr.io/example/game:latest';
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const mutableImage = inspectStagingGates(directory, {
      releaseSha: evidence.releaseSha,
      nowMs: Date.parse('2026-07-13T00:30:00.000Z'),
    });
    expect(mutableImage[0].status).toBe('blocked');
    expect(mutableImage[0].reason).toContain('imageDigests.game');

    evidence.imageDigests.game = `ghcr.io/example/game@sha256:${'0'.repeat(64)}`;
    evidence.artifacts[0].sha256 = 'f'.repeat(64);
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const wrongArtifactHash = inspectStagingGates(directory, {
      releaseSha: evidence.releaseSha,
      nowMs: Date.parse('2026-07-13T00:30:00.000Z'),
    });
    expect(wrongArtifactHash[0].status).toBe('blocked');
    expect(wrongArtifactHash[0].reason).toContain('sha256 matching file contents');
  });

  it('accepts hash-verified operational artifacts under repository-owned policies', () => {
    for (const [name, createEvidence] of [
      ['restore', restoreEvidence],
      ['chaos', chaosEvidence],
      ['load', loadEvidence],
      ['alerts', alertEvidence],
    ] as const) {
      const directory = mkdtempSync(join(tmpdir(), `release-gate-${name}-valid-`));
      mkdirSync(join(directory, 'staging'));
      const check = inspectOperationalEvidence(directory, createEvidence(directory));

      expect(check.status, check.reason).toBe('passed');
      expect(check.reason).toContain('validated staging evidence contract');
    }
  });

  it('keeps the restore gate blocked when only the local PITR mechanics artifact exists', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-restore-without-offsite-'));
    mkdirSync(join(directory, 'staging'));
    const evidence = restoreEvidence(directory);
    delete evidence.offsiteArtifact;

    const check = inspectOperationalEvidence(directory, evidence);

    expect(check.status).toBe('blocked');
    expect(check.reason).toContain('offsiteArtifact artifact reference');
  });

  it('does not let operational evidence relax repository thresholds', () => {
    const restoreDirectory = mkdtempSync(join(tmpdir(), 'release-gate-restore-policy-'));
    mkdirSync(join(restoreDirectory, 'staging'));
    const restore = restoreEvidence(restoreDirectory);
    rewriteOperationalRawArtifact(restoreDirectory, restore, (raw) => {
      const details = raw.restore as Record<string, unknown>;
      details.recoveredThroughAt = '2026-07-12T23:35:00.000Z';
    });
    restore.metrics.rpoMinutes = 20;
    restore.thresholds.maxRpoMinutes = 30;
    const restoreCheck = inspectOperationalEvidence(restoreDirectory, restore);
    expect(restoreCheck.status).toBe('blocked');
    expect(restoreCheck.reason).toContain('thresholds.maxRpoMinutes exactly 15');
    expect(restoreCheck.reason).toContain('worst-case restore RPO <= 15 minutes');

    const chaosDirectory = mkdtempSync(join(tmpdir(), 'release-gate-chaos-policy-'));
    mkdirSync(join(chaosDirectory, 'staging'));
    const chaos = chaosEvidence(chaosDirectory);
    rewriteOperationalRawArtifact(chaosDirectory, chaos, (raw) => {
      const outbox = raw.outbox as Record<string, unknown>;
      const deliveries = outbox.deliveries as Array<Record<string, unknown>>;
      deliveries.push({ messageId: 'message-1', deliveredAt: '2026-07-13T00:03:11.000Z' });
    });
    chaos.metrics.duplicateDeliveries = 1;
    chaos.thresholds.maxDuplicateDeliveries = 1;
    const chaosCheck = inspectOperationalEvidence(chaosDirectory, chaos);
    expect(chaosCheck.status).toBe('blocked');
    expect(chaosCheck.reason).toContain('thresholds.maxDuplicateDeliveries exactly 0');
    expect(chaosCheck.reason).toContain('recomputed raw artifact duplicate deliveries exactly 0');

    const loadDirectory = mkdtempSync(join(tmpdir(), 'release-gate-load-policy-'));
    mkdirSync(join(loadDirectory, 'staging'));
    const load = loadEvidence(loadDirectory);
    rewriteOperationalRawArtifact(loadDirectory, load, (raw) => {
      const runs = raw.runs as Array<Record<string, unknown>>;
      for (const run of runs) {
        const statusCounts = run.statusCounts as Record<string, number>;
        run.latencyDistribution = [{ latencyMs: 600, count: statusCounts['200'] }];
      }
    });
    load.metrics.p95LatencyMs = 600;
    load.thresholds.maxP95LatencyMs = 700;
    const loadCheck = inspectOperationalEvidence(loadDirectory, load);
    expect(loadCheck.status).toBe('blocked');
    expect(loadCheck.reason).toContain('thresholds.maxP95LatencyMs exactly 500');
    expect(loadCheck.reason).toContain('recomputed raw artifact HTTP p95 < 500ms');

    const alertsDirectory = mkdtempSync(join(tmpdir(), 'release-gate-alert-policy-'));
    mkdirSync(join(alertsDirectory, 'staging'));
    const alerts = alertEvidence(alertsDirectory);
    rewriteOperationalRawArtifact(alertsDirectory, alerts, (raw) => {
      const notifications = raw.notifications as Array<Record<string, unknown>>;
      notifications[0].deliveredAt = '2026-07-13T00:06:40.000Z';
    });
    alerts.metrics.firingDeliverySeconds = 400;
    alerts.thresholds.maxFiringDeliverySeconds = 500;
    const alertsCheck = inspectOperationalEvidence(alertsDirectory, alerts);
    expect(alertsCheck.status).toBe('blocked');
    expect(alertsCheck.reason).toContain('thresholds.maxFiringDeliverySeconds exactly 300');
    expect(alertsCheck.reason).toContain('recomputed raw artifact firing delivery <= 300 seconds');
  });

  it('rejects favorable summaries that disagree with raw operational evidence', () => {
    const restoreDirectory = mkdtempSync(join(tmpdir(), 'release-gate-restore-summary-'));
    mkdirSync(join(restoreDirectory, 'staging'));
    const restore = restoreEvidence(restoreDirectory);
    restore.metrics.rpoMinutes = 1;
    const restoreCheck = inspectOperationalEvidence(restoreDirectory, restore);
    expect(restoreCheck.status).toBe('blocked');
    expect(restoreCheck.reason).toContain('metrics.rpoMinutes matching recomputed raw artifact value 10');

    const alertDirectory = mkdtempSync(join(tmpdir(), 'release-gate-alert-summary-'));
    mkdirSync(join(alertDirectory, 'staging'));
    const alerts = alertEvidence(alertDirectory);
    alerts.metrics.resolvedDeliverySeconds = 1;
    const alertsCheck = inspectOperationalEvidence(alertDirectory, alerts);
    expect(alertsCheck.status).toBe('blocked');
    expect(alertsCheck.reason).toContain('metrics.resolvedDeliverySeconds matching recomputed raw artifact value 90');

    const loadDirectory = mkdtempSync(join(tmpdir(), 'release-gate-load-summary-'));
    mkdirSync(join(loadDirectory, 'staging'));
    const load = loadEvidence(loadDirectory);
    rewriteOperationalRawArtifact(loadDirectory, load, (raw) => {
      const runs = raw.runs as Array<Record<string, unknown>>;
      const peak = runs.find((run) => run.kind === 'peak');
      if (!peak) throw new Error('missing peak fixture run');
      peak.statusCounts = { 200: 35_280, 500: 720 };
    });
    load.metrics.errorRate = 720 / 180_000;
    const loadCheck = inspectOperationalEvidence(loadDirectory, load);
    expect(loadCheck.status).toBe('blocked');
    expect(loadCheck.reason).toContain('metrics.errorRate matching recomputed raw artifact value 0.02');
    expect(loadCheck.reason).toContain('recomputed raw artifact HTTP error rate < 0.01');
  });

  it('rejects insufficient load duration, request samples, and chaos recovery samples', () => {
    const loadDirectory = mkdtempSync(join(tmpdir(), 'release-gate-load-samples-'));
    mkdirSync(join(loadDirectory, 'staging'));
    const load = loadEvidence(loadDirectory);
    rewriteOperationalRawArtifact(loadDirectory, load, (raw) => {
      const runs = raw.runs as Array<Record<string, unknown>>;
      const peak = runs.find((run) => run.kind === 'peak');
      if (!peak) throw new Error('missing peak fixture run');
      peak.finishedAt = '2026-07-13T00:29:00.000Z';
      peak.statusCounts = { 200: 1 };
      peak.latencyDistribution = [{ latencyMs: 100, count: 1 }];
    });
    const loadCheck = inspectOperationalEvidence(loadDirectory, load);
    expect(loadCheck.status).toBe('blocked');
    expect(loadCheck.reason).toContain('rawArtifact peak duration >= 30 minutes');
    expect(loadCheck.reason).toContain('request samples >= targetRps * duration');

    const chaosDirectory = mkdtempSync(join(tmpdir(), 'release-gate-chaos-samples-'));
    mkdirSync(join(chaosDirectory, 'staging'));
    const chaos = chaosEvidence(chaosDirectory);
    rewriteOperationalRawArtifact(chaosDirectory, chaos, (raw) => {
      const failovers = raw.failovers as Array<Record<string, unknown>>;
      failovers[0].probes = (failovers[0].probes as Array<Record<string, unknown>>).slice(0, 3);
    });
    const chaosCheck = inspectOperationalEvidence(chaosDirectory, chaos);
    expect(chaosCheck.status).toBe('blocked');
    expect(chaosCheck.reason).toContain('probes with an outage and 3 recovery samples');
  });

  it('treats the HTTP p95 and error-rate limits as strict SLO boundaries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-load-boundaries-'));
    mkdirSync(join(directory, 'staging'));
    const load = loadEvidence(directory);
    rewriteOperationalRawArtifact(directory, load, (raw) => {
      const runs = raw.runs as Array<Record<string, unknown>>;
      for (const run of runs) {
        const statusCounts = run.statusCounts as Record<string, number>;
        const total = statusCounts['200'];
        run.statusCounts = { 200: total * 0.99, 500: total * 0.01 };
        run.latencyDistribution = [{ latencyMs: 500, count: total }];
      }
    });
    load.metrics.p95LatencyMs = 500;
    load.metrics.errorRate = 0.01;

    const check = inspectOperationalEvidence(directory, load);

    expect(check.status).toBe('blocked');
    expect(check.reason).toContain('recomputed raw artifact HTTP p95 < 500ms');
    expect(check.reason).toContain('recomputed raw artifact HTTP error rate < 0.01');
  });

  it('parses re-hashed raw artifacts and rejects semantic invariant mismatches', () => {
    const restoreDirectory = mkdtempSync(join(tmpdir(), 'release-gate-restore-semantics-'));
    mkdirSync(join(restoreDirectory, 'staging'));
    const restore = restoreEvidence(restoreDirectory);
    rewriteOperationalRawArtifact(restoreDirectory, restore, (raw) => {
      raw.success = false;
      raw.exitCode = 1;
      const backup = raw.backup as Record<string, unknown>;
      backup.verified = false;
      const checks = raw.checks as Record<string, unknown>;
      checks.legalHoldInvariantPassed = true;
      checks.deletionHoldViolations = 1;
      const details = raw.restore as Record<string, unknown>;
      details.targetReached = false;
    });
    rewriteRestoreOffsiteArtifact(restoreDirectory, restore, (raw) => {
      const backup = raw.backup as Record<string, unknown>;
      backup.remoteObjectUrl = 'file:///tmp/local-backup.dump.age';
      backup.objectVersionId = 'null';
      backup.encrypted = false;
      backup.checksumVerified = false;
      const details = raw.restore as Record<string, unknown>;
      details.completed = false;
      details.coreDataInvariantPassed = true;
      const observations = details.observations as Record<string, unknown>;
      observations.cards = 0;
      const schema = details.schema as Record<string, unknown>;
      schema.expectedChecksum = '8'.repeat(64);
    });
    const restoreCheck = inspectOperationalEvidence(restoreDirectory, restore);
    expect(restoreCheck.status).toBe('blocked');
    expect(restoreCheck.reason).toContain('rawArtifact.checks.legalHoldInvariantPassed matching observed counts');
    expect(restoreCheck.reason).toContain('rawArtifact.success: true');
    expect(restoreCheck.reason).toContain('rawArtifact.exitCode exactly 0');
    expect(restoreCheck.reason).toContain('rawArtifact.backup.verified: true');
    expect(restoreCheck.reason).toContain('rawArtifact.restore.targetReached: true');
    expect(restoreCheck.reason).toContain('offsiteArtifact.backup.remoteObjectUrl as an s3:// or HTTPS object URL');
    expect(restoreCheck.reason).toContain('offsiteArtifact.backup.objectVersionId');
    expect(restoreCheck.reason).toContain('offsiteArtifact.backup.encrypted: true');
    expect(restoreCheck.reason).toContain('offsiteArtifact.backup.checksumVerified: true');
    expect(restoreCheck.reason).toContain('offsiteArtifact.restore.completed: true');
    expect(restoreCheck.reason).toContain('offsiteArtifact.restore.coreDataInvariantPassed matching observed counts');
    expect(restoreCheck.reason).toContain('offsiteArtifact.restore.schema matching the release manifest');
    expect(restoreCheck.reason).toContain(
      'results.legalHoldInvariantPassed matching recomputed raw artifact value false',
    );

    const alertDirectory = mkdtempSync(join(tmpdir(), 'release-gate-alert-semantics-'));
    mkdirSync(join(alertDirectory, 'staging'));
    const alerts = alertEvidence(alertDirectory);
    rewriteOperationalRawArtifact(alertDirectory, alerts, (raw) => {
      const notifications = raw.notifications as Array<Record<string, unknown>>;
      notifications[1].alertId = 'unrelated-alert';
    });
    const alertCheck = inspectOperationalEvidence(alertDirectory, alerts);
    expect(alertCheck.status).toBe('blocked');
    expect(alertCheck.reason).toContain('containing one firing and one resolved delivery');
  });

  it('applies RPO and RTO policy to the slower encrypted off-site restore', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-offsite-rto-'));
    mkdirSync(join(directory, 'staging'));
    const restore = restoreEvidence(directory);
    rewriteRestoreOffsiteArtifact(directory, restore, (raw) => {
      raw.finishedAt = '2026-07-13T01:01:00.000Z';
      const backup = raw.backup as Record<string, unknown>;
      backup.recoveryPointAt = '2026-07-12T23:40:00.000Z';
    });
    restore.finishedAt = '2026-07-13T01:01:00.000Z';
    restore.durationMs = 61 * 60 * 1_000;
    restore.checkedAt = '2026-07-13T01:02:00.000Z';

    const check = inspectOperationalEvidence(directory, restore);

    expect(check.status).toBe('blocked');
    expect(check.reason).toContain('worst-case restore RPO <= 15 minutes');
    expect(check.reason).toContain('worst-case restore RTO <= 60 minutes');
  });

  it('accepts only the repository-owned 10% -> 50% -> 100% canary policy', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-canary-'));
    mkdirSync(join(directory, 'staging'));
    const evidence = canaryEvidence(directory);

    const canary = inspectCanaryEvidence(directory, evidence);

    expect(canary.status).toBe('passed');
    expect(canary.reason).toContain('validated staging evidence contract');
  });

  it('parses the hash-verified gateway artifact and rejects semantic weight tampering', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-canary-gateway-'));
    mkdirSync(join(directory, 'staging'));
    const evidence = canaryEvidence(directory);
    rewriteGatewayArtifact(directory, evidence, evidence.rollout.stages[1], (config) => {
      const traffic = config.traffic as Record<string, unknown>;
      traffic.stableWeightPercent = 90;
    });
    rewriteGatewayArtifact(directory, evidence, evidence.rollout.rollback, (config) => {
      config.activeReleaseSet = 'mixed';
      const traffic = config.traffic as Record<string, unknown>;
      traffic.stableWeightPercent = 90;
      traffic.candidateWeightPercent = 10;
    });

    const canary = inspectCanaryEvidence(directory, evidence);

    expect(canary.status).toBe('blocked');
    expect(canary.reason).toContain('gatewayConfigArtifact.traffic.stableWeightPercent exactly 50');
    expect(canary.reason).toContain('rollback.gatewayConfigArtifact.activeReleaseSet exactly "stable"');
    expect(canary.reason).toContain('rollback.gatewayConfigArtifact.traffic.stableWeightPercent exactly 100');
    expect(canary.reason).toContain('rollback.gatewayConfigArtifact.traffic.candidateWeightPercent exactly 0');
  });

  it('parses raw metrics artifacts and cross-checks stage and rollback observations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-canary-raw-metrics-'));
    mkdirSync(join(directory, 'staging'));
    const evidence = canaryEvidence(directory);
    rewriteRawMetricsArtifact(directory, evidence, evidence.rollout.stages[2], (metrics) => {
      metrics.candidateWeightPercent = 50;
      metrics.httpSamples = 2_000;
      metrics.readyReplicaCount = 3;
      metrics.policyPassed = false;
      const observation = metrics.observation as Record<string, unknown>;
      observation.finishedAt = '2026-07-12T23:40:01.000Z';
    });
    rewriteRawMetricsArtifact(directory, evidence, evidence.rollout.rollback, (metrics) => {
      metrics.rollbackSeconds = 30;
      metrics.websocketSamples = 200;
    });

    const canary = inspectCanaryEvidence(directory, evidence);

    expect(canary.status).toBe('blocked');
    expect(canary.reason).toContain('rawMetricsArtifact.candidateWeightPercent exactly 100');
    expect(canary.reason).toContain('rawMetricsArtifact.httpSamples matching evidence value 1000');
    expect(canary.reason).toContain('rawMetricsArtifact.readyReplicaCount matching evidence value 2');
    expect(canary.reason).toContain('rawMetricsArtifact.observation.finishedAt matching evidence value');
    expect(canary.reason).toContain('rawMetricsArtifact.policyPassed: true');
    expect(canary.reason).toContain('rollback.rawMetricsArtifact.websocketSamples matching evidence value 100');
    expect(canary.reason).toContain('rollback.rawMetricsArtifact.rollbackSeconds matching evidence value 240');
  });

  it('binds the stable release set to a hash-verified manifest and release SHA', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-canary-stable-manifest-'));
    mkdirSync(join(directory, 'staging'));
    const evidence = canaryEvidence(directory);
    rewriteEvidenceArtifact(
      directory,
      evidence,
      evidence.rollout.stableManifestArtifact,
      [
        `RELEASE_SHA=${'c'.repeat(40)}`,
        `GAME_IMAGE=${evidence.rollout.stableReleaseSet.game}`,
        `API_IMAGE=${evidence.rollout.stableReleaseSet.game}`,
        `PLATFORM_IMAGE=${evidence.rollout.stableReleaseSet.platform}`,
        '',
      ].join('\n'),
    );

    const canary = inspectCanaryEvidence(directory, evidence);

    expect(canary.status).toBe('blocked');
    expect(canary.reason).toContain('stableManifestArtifact RELEASE_SHA matching rollout.stableReleaseSha');
    expect(canary.reason).toContain('stableManifestArtifact API_IMAGE matching stableReleaseSet.api');
  });

  it('rejects cross-service release slots and rollback targets even when artifact hashes are valid', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-canary-release-set-'));
    mkdirSync(join(directory, 'staging'));
    const evidence = canaryEvidence(directory);
    rewriteGatewayArtifact(directory, evidence, evidence.rollout.stages[0], (config) => {
      const releaseSets = config.releaseSets as Record<string, Record<string, string>>;
      releaseSets.candidate.api = releaseSets.candidate.platform;
    });
    evidence.rollout.candidateReleaseSet.game = evidence.imageDigests.api;
    evidence.rollout.stableReleaseSet.api = evidence.rollout.stableReleaseSet.game;
    evidence.rollout.rollback.toReleaseSet.platform = evidence.rollout.candidateReleaseSet.platform;

    const canary = inspectCanaryEvidence(directory, evidence);

    expect(canary.status).toBe('blocked');
    expect(canary.reason).toContain('candidateReleaseSet.game matching imageDigests.game');
    expect(canary.reason).toContain('stableReleaseSet.api using the same image repository as candidate api');
    expect(canary.reason).toContain(
      'gatewayConfigArtifact.releaseSets.candidate.api matching the declared release set',
    );
    expect(canary.reason).toContain('rollback.toReleaseSet.platform matching the declared release set');
  });

  it('does not let evidence lower required stages or raise the maximum rollback time', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-canary-policy-'));
    mkdirSync(join(directory, 'staging'));
    const requiredStagesBypass = canaryEvidence(directory);
    requiredStagesBypass.metrics.stagesCompleted = 0;
    requiredStagesBypass.thresholds.requiredStages = 0;

    const stagesCheck = inspectCanaryEvidence(directory, requiredStagesBypass);

    expect(stagesCheck.status).toBe('blocked');
    expect(stagesCheck.reason).toContain('thresholds.requiredStages exactly 3');
    expect(stagesCheck.reason).toContain('metrics.stagesCompleted exactly 3');

    const rollbackBypass = canaryEvidence(directory);
    rollbackBypass.metrics.rollbackSeconds = 600;
    rollbackBypass.thresholds.maxRollbackSeconds = 999;
    rollbackBypass.rollout.rollback.finishedAt = '2026-07-12T23:55:00.000Z';
    rollbackBypass.finishedAt = '2026-07-12T23:55:00.000Z';
    rollbackBypass.checkedAt = '2026-07-12T23:56:00.000Z';
    rollbackBypass.durationMs = 25 * 60 * 1_000;

    const rollbackCheck = inspectCanaryEvidence(directory, rollbackBypass);

    expect(rollbackCheck.status).toBe('blocked');
    expect(rollbackCheck.reason).toContain('thresholds.maxRollbackSeconds exactly 300');
    expect(rollbackCheck.reason).toContain('metrics.rollbackSeconds <= 300');
    expect(rollbackCheck.reason).toContain('rollout.rollback duration <= 300 seconds');
  });

  it('blocks rollback evidence when observation starts late or exceeds its maximum window', () => {
    const updateRollbackObservation = (
      directory: string,
      evidence: ReturnType<typeof canaryEvidence>,
      startedAt: string,
      finishedAt: string,
    ) => {
      const rollback = evidence.rollout.rollback;
      rollback.observationStartedAt = startedAt;
      rollback.observationFinishedAt = finishedAt;
      evidence.finishedAt = finishedAt;
      evidence.durationMs = Date.parse(finishedAt) - Date.parse(evidence.startedAt);
      evidence.metrics.rollbackObservationDelaySeconds =
        (Date.parse(startedAt) - Date.parse(rollback.finishedAt)) / 1_000;
      evidence.metrics.rollbackObservationSeconds = (Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000;
      rewriteRawMetricsArtifact(directory, evidence, rollback, (metrics) => {
        metrics.observation = {
          startedAt,
          finishedAt,
          dwellSeconds: evidence.metrics.rollbackObservationSeconds,
        };
      });
    };

    const delayedDirectory = mkdtempSync(join(tmpdir(), 'release-gate-canary-rollback-delay-'));
    mkdirSync(join(delayedDirectory, 'staging'));
    const delayed = canaryEvidence(delayedDirectory);
    updateRollbackObservation(delayedDirectory, delayed, '2026-07-12T23:50:01.000Z', '2026-07-12T23:55:01.000Z');
    const delayedCheck = inspectCanaryEvidence(delayedDirectory, delayed);

    expect(delayedCheck.status).toBe('blocked');
    expect(delayedCheck.reason).toContain('metrics.rollbackObservationDelaySeconds <= thresholds');
    expect(delayedCheck.reason).toContain('observation started within 60 seconds of the switch');

    const longDirectory = mkdtempSync(join(tmpdir(), 'release-gate-canary-rollback-window-'));
    mkdirSync(join(longDirectory, 'staging'));
    const tooLong = canaryEvidence(longDirectory);
    updateRollbackObservation(longDirectory, tooLong, '2026-07-12T23:49:00.000Z', '2026-07-12T23:59:01.000Z');
    const longCheck = inspectCanaryEvidence(longDirectory, tooLong);

    expect(longCheck.status).toBe('blocked');
    expect(longCheck.reason).toContain('metrics.rollbackObservationSeconds <= thresholds');
    expect(longCheck.reason).toContain('observation duration <= 600 seconds');
  });

  it('requires ordered weights, dwell, traffic samples, ready replicas, and attributable raw artifacts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-canary-observations-'));
    mkdirSync(join(directory, 'staging'));
    const evidence = canaryEvidence(directory);
    evidence.rollout.stages[1].weightPercent = 100;
    evidence.rollout.stages[0].finishedAt = '2026-07-12T23:34:59.000Z';
    evidence.rollout.stages[0].httpSamples = 999;
    evidence.rollout.stages[0].websocketSamples = 99;
    evidence.rollout.stages[0].readyReplicaCount = 1;
    evidence.rollout.stages[0].rawMetricsArtifact = {
      ...evidence.rollout.stages[0].rawMetricsArtifact,
      path: 'staging/unverified-metrics.json',
    };
    evidence.rollout.stages[2].gatewayConfigSha256 = evidence.rollout.stages[1].gatewayConfigSha256;

    const canary = inspectCanaryEvidence(directory, evidence);

    expect(canary.status).toBe('blocked');
    expect(canary.reason).toContain('weightPercent exactly 50 without skipped stages');
    expect(canary.reason).toContain('dwell >= 300 seconds');
    expect(canary.reason).toContain('httpSamples >= 1000');
    expect(canary.reason).toContain('websocketSamples >= 100');
    expect(canary.reason).toContain('readyReplicaCount >= 2');
    expect(canary.reason).toContain('rawMetricsArtifact matching artifacts[]');
    expect(canary.reason).toContain('gatewayConfigSha256 unique for its traffic weight');
  });

  it('renders a visible blocked interpretation in Markdown', () => {
    const markdown = renderMarkdown({
      status: 'blocked',
      generatedAt: '2026-07-13T00:00:00.000Z',
      repository: 'zutomayo-card-online',
      commit: 'abc123',
      checks: [{ category: 'staging', title: 'Restore drill', status: 'blocked', reason: 'missing evidence' }],
    });
    expect(markdown).toContain('**BLOCKED**');
    expect(markdown).toContain('blocked is not a release approval');
  });
});
