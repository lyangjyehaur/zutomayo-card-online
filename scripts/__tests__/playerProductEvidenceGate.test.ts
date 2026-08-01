import { describe, expect, it } from 'vitest';
import { evaluatePlayerProductEvidence, REQUIRED_PLAYER_JOURNEYS } from '../playerProductEvidenceGate';

const releaseSha = 'a'.repeat(40);
const datasetSha256 = 'b'.repeat(64);

function report() {
  const journeys = Object.fromEntries(
    REQUIRED_PLAYER_JOURNEYS.map((name, index) => [
      name,
      {
        population: 10 + index,
        outcomes: 5 + index,
        medianSeconds: 30 + index,
        p95Seconds: 60 + index,
        receiptUrl: `https://analytics.example.test/receipts/${name}`,
      },
    ]),
  );
  return {
    schemaVersion: 1,
    status: 'complete',
    releaseSha,
    buildId: releaseSha,
    datasetSha256,
    window: {
      startedAt: '2026-07-20T00:00:00.000Z',
      finishedAt: '2026-07-28T00:00:00.000Z',
    },
    journeys,
    observationMethod: 'moderated-sessions',
    observations: [
      {
        id: 'obs-001',
        observedAt: '2026-07-21T00:00:00.000Z',
        participantType: 'first-time',
        viewportClass: 'mobile',
        taskResults: { tutorial: 'completed', queue: 'blocked', match: 'not-observed', reconnect: 'not-observed' },
        problemIds: ['PP-001'],
        receiptUrl: 'https://research.example.test/receipts/obs-001',
      },
      {
        id: 'obs-002',
        observedAt: '2026-07-22T00:00:00.000Z',
        participantType: 'first-time',
        viewportClass: 'desktop',
        taskResults: { tutorial: 'completed', queue: 'completed', match: 'blocked', reconnect: 'not-observed' },
        problemIds: ['PP-001'],
        receiptUrl: 'https://research.example.test/receipts/obs-002',
      },
      {
        id: 'obs-003',
        observedAt: '2026-07-23T00:00:00.000Z',
        participantType: 'returning',
        viewportClass: 'tablet',
        taskResults: { tutorial: 'not-observed', queue: 'completed', match: 'completed', reconnect: 'blocked' },
        problemIds: ['PP-001', 'PP-002'],
        receiptUrl: 'https://research.example.test/receipts/obs-003',
      },
      {
        id: 'obs-004',
        observedAt: '2026-07-24T00:00:00.000Z',
        participantType: 'representative',
        viewportClass: 'desktop',
        taskResults: { tutorial: 'not-observed', queue: 'completed', match: 'completed', reconnect: 'completed' },
        problemIds: [],
        receiptUrl: 'https://research.example.test/receipts/obs-004',
      },
      {
        id: 'obs-005',
        observedAt: '2026-07-25T00:00:00.000Z',
        participantType: 'representative',
        viewportClass: 'mobile',
        taskResults: { tutorial: 'completed', queue: 'completed', match: 'completed', reconnect: 'completed' },
        problemIds: [],
        receiptUrl: 'https://research.example.test/receipts/obs-005',
      },
    ],
    issues: [
      {
        id: 'PP-001',
        category: 'matchmaking',
        summary: 'Queue state does not explain the next action',
        impact: 5,
        frequency: 3,
      },
      {
        id: 'PP-002',
        category: 'reconnect',
        summary: 'Reconnect status remains unclear after recovery',
        impact: 3,
        frequency: 1,
      },
    ],
  };
}

describe('player and product evidence gate', () => {
  it('accepts release-bound aggregate journeys and five de-identified observations', () => {
    expect(evaluatePlayerProductEvidence(report(), { releaseSha, datasetSha256 })).toEqual({
      passed: true,
      releaseSha,
      datasetSha256,
      windowDays: 8,
      journeyRates: {
        homeToFirstMatch: 0.5,
        queueToMatch: 6 / 11,
        matchCompletion: 7 / 12,
        reconnect: 8 / 13,
        tutorialCompletion: 9 / 14,
        returningPlayers: 10 / 15,
      },
      observationCount: 5,
      rankedIssues: [
        { id: 'PP-001', priority: 15 },
        { id: 'PP-002', priority: 3 },
      ],
    });
  });

  it('accepts an explicit no-event baseline with null durations and rate', () => {
    const input = report();
    Object.assign(input.journeys.reconnect, {
      population: 0,
      outcomes: 0,
      medianSeconds: null,
      p95Seconds: null,
      receiptUrl: 'https://analytics.example.test/receipts/reconnect-empty',
    });
    expect(evaluatePlayerProductEvidence(input, { releaseSha, datasetSha256 }).journeyRates.reconnect).toBeNull();

    input.journeys.reconnect.medianSeconds = 1;
    expect(() => evaluatePlayerProductEvidence(input, { releaseSha, datasetSha256 })).toThrow(
      'must be null when population is zero',
    );
  });

  it('fails when release identity, the seven-day window, or a journey is incomplete', () => {
    const wrongRelease = report();
    wrongRelease.buildId = 'c'.repeat(40);
    expect(() => evaluatePlayerProductEvidence(wrongRelease, { releaseSha, datasetSha256 })).toThrow(
      'releaseSha and buildId',
    );

    const shortWindow = report();
    shortWindow.window.finishedAt = '2026-07-26T23:59:59.000Z';
    expect(() => evaluatePlayerProductEvidence(shortWindow, { releaseSha, datasetSha256 })).toThrow('seven days');

    const missingJourney = report();
    delete (missingJourney.journeys as Partial<typeof missingJourney.journeys>).returningPlayers;
    expect(() => evaluatePlayerProductEvidence(missingJourney, { releaseSha, datasetSha256 })).toThrow(
      'journeys.returningPlayers is required',
    );
  });

  it('rejects raw identity fields and sensitive problem summaries', () => {
    const rawIdentity = report();
    Object.assign(rawIdentity.observations[0], { nickname: 'player-name' });
    expect(() => evaluatePlayerProductEvidence(rawIdentity, { releaseSha, datasetSha256 })).toThrow(
      'unsupported fields: nickname',
    );

    const rawSummary = report();
    rawSummary.issues[0].summary = 'Player email user@example.com could not queue';
    expect(() => evaluatePlayerProductEvidence(rawSummary, { releaseSha, datasetSha256 })).toThrow('raw identifiers');
  });

  it('requires task coverage, attributable frequency, defined issues, and priority order', () => {
    const missingTask = report();
    for (const observation of missingTask.observations) observation.taskResults.reconnect = 'not-observed';
    expect(() => evaluatePlayerProductEvidence(missingTask, { releaseSha, datasetSha256 })).toThrow('reconnect task');

    const wrongFrequency = report();
    wrongFrequency.issues[0].frequency = 2;
    expect(() => evaluatePlayerProductEvidence(wrongFrequency, { releaseSha, datasetSha256 })).toThrow(
      'frequency must match',
    );

    const undefinedIssue = report();
    undefinedIssue.observations[4].problemIds = ['PP-999'];
    expect(() => evaluatePlayerProductEvidence(undefinedIssue, { releaseSha, datasetSha256 })).toThrow(
      'undefined issue PP-999',
    );

    const outOfOrder = report();
    outOfOrder.issues.reverse();
    expect(() => evaluatePlayerProductEvidence(outOfOrder, { releaseSha, datasetSha256 })).toThrow(
      'ordered by descending',
    );
  });
});
