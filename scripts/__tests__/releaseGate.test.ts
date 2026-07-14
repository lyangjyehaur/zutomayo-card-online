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
      ['game', 'api', 'platform', 'migrate', 'retention'].map((name) => [
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

function canaryEvidence(directory: string) {
  const imageDigests = Object.fromEntries(
    ['game', 'api', 'platform', 'migrate', 'retention'].map((name) => [
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
    finishedAt: '2026-07-12T23:49:00.000Z',
    durationMs: 19 * 60 * 1_000,
    checkedAt: '2026-07-12T23:50:00.000Z',
    metrics: { rollbackSeconds: 240, stagesCompleted: 3 },
    thresholds: {
      maxRollbackSeconds: 300,
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
