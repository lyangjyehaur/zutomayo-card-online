import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type GateCheck = { category: string; status: string; reason: string };
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
