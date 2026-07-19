import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type GateCheck = { id: string; category: string; status: string; reason: string };
type GateModule = {
  aggregateStatus(checks: Array<{ status: string }>): string;
  composeFixtureEnv(): Record<string, string>;
  inspectStagingGates(
    stagingEvidenceDir?: string,
    options?: {
      releaseSha?: string;
      maxEvidenceAgeHours?: number;
      nowMs?: number;
      imageDigests?: Record<string, string>;
      evidenceRunId?: string;
      profile?: 'beta' | 'production-hardening';
    },
  ): GateCheck[];
  renderMarkdown(summary: {
    status: string;
    generatedAt: string;
    repository: string;
    commit: string;
    profile?: 'beta' | 'production-hardening';
    checks: Array<{ category: string; title: string; status: string; reason: string }>;
  }): string;
};

// @ts-expect-error The runtime MJS module intentionally has no generated declarations.
const gateModule = await import('../release-gate.mjs');
const { aggregateStatus, composeFixtureEnv, inspectStagingGates, renderMarkdown } = gateModule as GateModule;

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
    metrics: { completedJourneys: 10, consecutiveRuns: 5, skippedTests: 0, failedTests: 0, flakyTests: 0 },
    thresholds: {
      minCompletedJourneys: 10,
      requiredConsecutiveRuns: 5,
      maxSkippedTests: 0,
      maxFailedTests: 0,
      maxFlakyTests: 0,
    },
    results: {
      authenticatedJourneyPassed: true,
      historyVerified: true,
      friendInviteVerified: true,
      spectatorHiddenInformationVerified: true,
      secureCookieVerified: true,
      httpsTopologyVerified: true,
      zeroConditionalSkips: true,
    },
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

describe('single release gate evidence model', () => {
  it('renders production compose with one immutable release identity', () => {
    const fixture = composeFixtureEnv();
    expect(fixture.APP_BUILD_ID).toMatch(/^[a-f0-9]{40}$/);
    expect(fixture.APP_BUILD_ID).toBe(fixture.RELEASE_SHA);
    expect(fixture.APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prioritizes failed over blocked and passed checks', () => {
    expect(aggregateStatus([{ status: 'passed' }, { status: 'blocked' }])).toBe('blocked');
    expect(aggregateStatus([{ status: 'blocked' }, { status: 'failed' }])).toBe('failed');
    expect(aggregateStatus([{ status: 'passed' }])).toBe('passed');
  });

  it('keeps the Beta profile narrow and production hardening explicit', () => {
    const betaChecks = inspectStagingGates(undefined);
    expect(betaChecks.map((check) => check.id)).toEqual([
      'staging-card-dataset',
      'staging-authenticated-e2e',
      'staging-restore',
    ]);
    expect(betaChecks.every((check) => check.category === 'staging' && check.status === 'blocked')).toBe(true);
    expect(betaChecks[0].reason).toContain('staging-only gate requires external evidence');

    const hardeningChecks = inspectStagingGates(undefined, { profile: 'production-hardening' });
    expect(hardeningChecks).toHaveLength(10);
    expect(hardeningChecks.some((check) => check.id === 'staging-chaos')).toBe(true);
    expect(hardeningChecks.some((check) => check.id === 'staging-provider-account')).toBe(true);
    expect(() => inspectStagingGates(undefined, { profile: 'unknown' as 'beta' })).toThrow('release profile');
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
    const legacyAuthenticated = legacyChecks.find((check) => check.id === 'staging-authenticated-e2e');
    expect(legacyAuthenticated?.status).toBe('blocked');
    expect(legacyAuthenticated?.reason).toContain('schemaVersion: 1');

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
    const minimalAuthenticated = minimalChecks.find((check) => check.id === 'staging-authenticated-e2e');
    expect(minimalAuthenticated?.status).toBe('blocked');
    expect(minimalAuthenticated?.reason).toContain('startedAt');
    expect(minimalAuthenticated?.reason).toContain('durationMs');
    expect(minimalAuthenticated?.reason).toContain('metrics object');
    expect(minimalAuthenticated?.reason).toContain('artifacts[]');

    writeFileSync(evidencePath, JSON.stringify(completeEvidence));
    const checks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
      imageDigests: completeEvidence.imageDigests,
      evidenceRunId: '123',
    });
    const authenticatedCheck = checks.find((check) => check.id === 'staging-authenticated-e2e');
    expect(authenticatedCheck?.status).toBe('passed');
    expect(authenticatedCheck?.reason).toContain('validated staging evidence contract');
    expect(checks.find((check) => check.id === 'staging-card-dataset')?.status).toBe('blocked');

    const insufficientRuns = authenticatedEvidence(directory);
    insufficientRuns.metrics.completedJourneys = 2;
    insufficientRuns.metrics.consecutiveRuns = 1;
    writeFileSync(evidencePath, JSON.stringify(insufficientRuns));
    const insufficientChecks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
    });
    const insufficientAuthenticated = insufficientChecks.find((check) => check.id === 'staging-authenticated-e2e');
    expect(insufficientAuthenticated?.status).toBe('blocked');
    expect(insufficientAuthenticated?.reason).toContain('metrics.completedJourneys >= thresholds.minCompletedJourneys');
    expect(insufficientAuthenticated?.reason).toContain(
      'metrics.consecutiveRuns >= thresholds.requiredConsecutiveRuns',
    );

    const betaEvidence = authenticatedEvidence(directory);
    betaEvidence.metrics.completedJourneys = 2;
    betaEvidence.metrics.consecutiveRuns = 1;
    betaEvidence.thresholds.minCompletedJourneys = 2;
    betaEvidence.thresholds.requiredConsecutiveRuns = 1;
    writeFileSync(evidencePath, JSON.stringify(betaEvidence));
    const betaChecks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
    });
    expect(betaChecks.find((check) => check.id === 'staging-authenticated-e2e')?.status).toBe('passed');
    const hardeningChecks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
      profile: 'production-hardening',
    });
    expect(hardeningChecks.find((check) => check.id === 'staging-authenticated-e2e-hardening')?.reason).toContain(
      'thresholds.requiredConsecutiveRuns >= 5',
    );

    const mismatchedRelease = JSON.parse(readFileSync(evidencePath, 'utf8'));
    mismatchedRelease.releaseSha = 'b'.repeat(40);
    writeFileSync(evidencePath, JSON.stringify(mismatchedRelease));
    const mismatchChecks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
    });
    const mismatchAuthenticated = mismatchChecks.find((check) => check.id === 'staging-authenticated-e2e');
    expect(mismatchAuthenticated?.status).toBe('blocked');
    expect(mismatchAuthenticated?.reason).toContain('releaseSha matching');

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
    const digestAuthenticated = digestChecks.find((check) => check.id === 'staging-authenticated-e2e');
    expect(digestAuthenticated?.status).toBe('blocked');
    expect(digestAuthenticated?.reason).toContain('matching the release manifest');

    digestMismatch.imageDigests.game = completeEvidence.imageDigests.game;
    digestMismatch.provenance.runId = '456';
    writeFileSync(evidencePath, JSON.stringify(digestMismatch));
    const provenanceChecks = inspectStagingGates(directory, {
      releaseSha: 'a'.repeat(40),
      imageDigests: completeEvidence.imageDigests,
      evidenceRunId: '123',
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
    });
    const provenanceAuthenticated = provenanceChecks.find((check) => check.id === 'staging-authenticated-e2e');
    expect(provenanceAuthenticated?.status).toBe('blocked');
    expect(provenanceAuthenticated?.reason).toContain('provenance.runId matching 123');
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
    const staleAuthenticated = stale.find((check) => check.id === 'staging-authenticated-e2e');
    expect(staleAuthenticated?.status).toBe('blocked');
    expect(staleAuthenticated?.reason).toContain('no older than 1 hours');

    evidence.checkedAt = '2026-07-13T01:00:00.000Z';
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const future = inspectStagingGates(directory, {
      releaseSha: evidence.releaseSha,
      nowMs: Date.parse('2026-07-13T00:00:00.000Z'),
    });
    const futureAuthenticated = future.find((check) => check.id === 'staging-authenticated-e2e');
    expect(futureAuthenticated?.status).toBe('blocked');
    expect(futureAuthenticated?.reason).toContain('not in the future');

    evidence.checkedAt = '2026-07-13T00:00:00.000Z';
    evidence.imageDigests.game = 'ghcr.io/example/game:latest';
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const mutableImage = inspectStagingGates(directory, {
      releaseSha: evidence.releaseSha,
      nowMs: Date.parse('2026-07-13T00:30:00.000Z'),
    });
    const mutableAuthenticated = mutableImage.find((check) => check.id === 'staging-authenticated-e2e');
    expect(mutableAuthenticated?.status).toBe('blocked');
    expect(mutableAuthenticated?.reason).toContain('imageDigests.game');

    evidence.imageDigests.game = `ghcr.io/example/game@sha256:${'0'.repeat(64)}`;
    evidence.artifacts[0].sha256 = 'f'.repeat(64);
    writeFileSync(evidencePath, JSON.stringify(evidence));
    const wrongArtifactHash = inspectStagingGates(directory, {
      releaseSha: evidence.releaseSha,
      nowMs: Date.parse('2026-07-13T00:30:00.000Z'),
    });
    const wrongArtifactAuthenticated = wrongArtifactHash.find((check) => check.id === 'staging-authenticated-e2e');
    expect(wrongArtifactAuthenticated?.status).toBe('blocked');
    expect(wrongArtifactAuthenticated?.reason).toContain('sha256 matching file contents');
  });

  it('accepts only complete RR-07 restore, deployment recovery, and six-scenario alert evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-gate-operations-'));
    mkdirSync(join(directory, 'staging'));
    const common = authenticatedEvidence(directory);
    const restoreRawPath = 'staging/restore-drill-raw.json';
    const deploymentRawPath = 'staging/deployment-recovery-raw.json';
    const alertRawPath = 'staging/alert-delivery-receipt-raw.json';
    for (const [artifactPath, contents] of [
      [restoreRawPath, 'restore'],
      [deploymentRawPath, 'deployment'],
      [alertRawPath, 'alerts'],
    ]) {
      writeFileSync(join(directory, artifactPath), contents);
    }
    const artifactEntry = (artifactPath: string, contents: string) => ({
      path: artifactPath,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
    writeFileSync(
      join(directory, 'staging', 'restore-drill.json'),
      JSON.stringify({
        ...common,
        evidenceType: 'restore-drill',
        metrics: { rpoMinutes: 10, rtoMinutes: 18, deploymentRecoverySeconds: 720 },
        thresholds: { maxRpoMinutes: 15, maxRtoMinutes: 30, maxDeploymentRecoverySeconds: 1_800 },
        results: {
          schemaGatePassed: true,
          fixtureRoundTripPassed: true,
          legalHoldInvariantPassed: true,
          deploymentRecoveryPassed: true,
        },
        artifacts: [artifactEntry(restoreRawPath, 'restore'), artifactEntry(deploymentRawPath, 'deployment')],
      }),
    );
    writeFileSync(
      join(directory, 'staging', 'alertmanager-delivery.json'),
      JSON.stringify({
        ...common,
        evidenceType: 'alertmanager-delivery',
        metrics: { firingDeliverySeconds: 25, resolvedDeliverySeconds: 20, scenariosDelivered: 6, failedScenarios: 0 },
        thresholds: {
          maxFiringDeliverySeconds: 300,
          maxResolvedDeliverySeconds: 300,
          minScenariosDelivered: 6,
          maxFailedScenarios: 0,
        },
        results: {
          firingDelivered: true,
          resolvedDelivered: true,
          apiFailureDelivered: true,
          platformFailureDelivered: true,
          reconnectSpikeDelivered: true,
          databaseOutageDelivered: true,
          resourcePressureDelivered: true,
          outboxBacklogDelivered: true,
        },
        artifacts: [artifactEntry(alertRawPath, 'alerts')],
      }),
    );
    const checks = inspectStagingGates(directory, {
      releaseSha: common.releaseSha,
      imageDigests: common.imageDigests,
      evidenceRunId: '123',
      nowMs: Date.parse('2026-07-13T01:00:00.000Z'),
      profile: 'production-hardening',
    });
    expect(checks.find((check) => check.id === 'staging-restore')?.status).toBe('passed');
    expect(checks.find((check) => check.id === 'staging-deployment-recovery')?.status).toBe('passed');
    expect(checks.find((check) => check.id === 'staging-alerts')?.status).toBe('passed');
  });

  it('renders a visible blocked interpretation in Markdown', () => {
    const markdown = renderMarkdown({
      status: 'blocked',
      generatedAt: '2026-07-13T00:00:00.000Z',
      repository: 'zutomayo-card-online',
      commit: 'abc123',
      profile: 'beta',
      checks: [{ category: 'staging', title: 'Restore drill', status: 'blocked', reason: 'missing evidence' }],
    });
    expect(markdown).toContain('**BLOCKED**');
    expect(markdown).toContain('Profile: `beta`');
    expect(markdown).toContain('blocked is not a release approval');
  });
});
