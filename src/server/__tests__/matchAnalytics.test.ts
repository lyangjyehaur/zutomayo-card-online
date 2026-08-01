import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  projectAbandonedMatchAnalytics,
  projectMatchAnalytics,
  resolveMatchAnalyticsRuntimeMetadata,
  sourceMatchDigest,
} from '../matchAnalytics';

function card(defId: string, instanceId: string) {
  return { defId, instanceId, faceUp: false };
}

function state() {
  return {
    _stateID: 12,
    G: {
      step: 'gameOver',
      winner: 0,
      turnNumber: 5,
      matchStartedAt: 1_000,
      matchEndedAt: 61_000,
      players: [{ hp: 80 }, { hp: 0 }],
      actionLog: [
        {
          id: 1,
          turn: 1,
          step: 'janken',
          player: 0,
          action: 'janken',
          payload: { choice: 'rock', hiddenCardId: 'private-card' },
          privateUserId: 'user-secret',
        },
        {
          id: 2,
          turn: 1,
          step: 'mulligan',
          player: 0,
          action: 'jankenResult',
          hp: [100, 100],
          payload: { draw: false, winner: 0, freeText: 'do not retain me' },
        },
        {
          id: 3,
          turn: 5,
          step: 'effectOrder',
          player: 1,
          action: 'timeoutAdvance',
          payload: { timedOutStep: 'effectOrder', nested: { userId: 'user-secret' } },
        },
        {
          id: 4,
          turn: 5,
          step: 'gameOver',
          player: 1,
          action: 'hpChange',
          payload: {
            delta: -20,
            reason: 'battle',
            before: 20,
            after: 0,
            sourceCardDefId: 'card_001',
            sourceCardInstanceId: 'private-instance',
            breakdown: { title: 'private free text' },
          },
          result: { ok: true, message: 'private result message' },
        },
        {
          id: 5,
          turn: 5,
          step: 'gameOver',
          player: 0,
          action: 'gameOver',
          payload: { winner: 0, draw: false, reason: 'Player 1 loses at 0 HP.' },
        },
        {
          id: 6,
          turn: 5,
          step: 'gameOver',
          player: 1,
          action: 'effectFailed',
          payload: { cardDefId: 'card_002', reason: 'privateToken', arbitrary: 'hidden' },
        },
      ],
    },
    ctx: { gameover: { winner: 0 } },
  } as never;
}

function initialState(reverse = false) {
  const deck = (seat: number) =>
    Array.from({ length: 20 }, (_, index) => card(`card_${seat}_${index}`, `secret:${seat}:${index}`));
  const player = (seat: number) => {
    const cards = reverse ? deck(seat).reverse() : deck(seat);
    return { deck: cards.slice(5), hand: cards.slice(0, 5) };
  };
  return { G: { players: [player(0), player(1)] } } as never;
}

function project(initial = initialState()) {
  return projectMatchAnalytics({
    sourceMatchId: 'opaque-production-match-id',
    state: state(),
    initialState: initial,
    seats: [
      { playerID: '0', userId: 'registered-user-id', rankedEligible: true },
      { playerID: '1', userId: 'guest:browser-secret', rankedEligible: false },
    ],
    rankedEligible: false,
    unratedReason: 'guest_or_unranked_seat',
    rulesVersion: 'rules-1',
    version: { appVersion: '1.0.0', buildId: 'build-1', rulesVersion: 'rules-1' },
    datasetSha256: 'dataset-sha',
    environment: 'production',
  });
}

describe('match analytics projection', () => {
  it('requires an exact dataset digest for production and staging runtimes', () => {
    const digest = 'a'.repeat(64);
    expect(resolveMatchAnalyticsRuntimeMetadata({ DEPLOYMENT_ENV: 'production', CARD_DATASET_SHA256: digest })).toEqual(
      { environment: 'production', datasetSha256: digest },
    );
    expect(
      resolveMatchAnalyticsRuntimeMetadata({ DEPLOYMENT_ENV: 'staging', VITE_CARD_DATASET_SHA256: digest }),
    ).toEqual({ environment: 'staging', datasetSha256: digest });
    expect(() => resolveMatchAnalyticsRuntimeMetadata({ NODE_ENV: 'production' })).toThrow(
      'production match analytics require CARD_DATASET_SHA256',
    );
    expect(() =>
      resolveMatchAnalyticsRuntimeMetadata({ DEPLOYMENT_ENV: 'staging', CARD_DATASET_SHA256: 'invalid' }),
    ).toThrow('CARD_DATASET_SHA256 must be a lowercase SHA-256 digest');
    expect(resolveMatchAnalyticsRuntimeMetadata({ NODE_ENV: 'test' })).toEqual({
      environment: 'test',
      datasetSha256: 'unknown',
    });
  });

  it('creates stable anonymous facts and unordered 20-card deck snapshots', () => {
    const analytics = project();
    const reordered = project(initialState(true));

    expect(analytics.fact.sourceMatchDigest).toBe(sourceMatchDigest('opaque-production-match-id'));
    expect(analytics.fact).toMatchObject({
      ratingMode: 'unrated',
      outcome: 'completed',
      winnerSeat: 0,
      jankenWinnerSeat: 0,
      gameoverReasonCode: 'rules_terminal',
      finalHp: [80, 0],
      seatClasses: ['registered', 'guest'],
      timeoutCount: 1,
      disconnectCounts: [0, 0],
      reconnectCounts: [0, 0],
      seatResumeCounts: [0, 0],
      deckCount: 2,
      eventCount: 5,
    });
    expect(analytics.decks).toHaveLength(2);
    expect(analytics.decks.every((deck) => deck.cardIds.length === 20)).toBe(true);
    expect(analytics.decks).toEqual(reordered.decks);
    expect(analytics.fact.integritySha256).toBe(reordered.fact.integritySha256);
    expect(analytics.fact.qualityFlags).toContain('missing-provenance');
    expect(analytics.events.find((event) => event.eventType === 'jankenResult')).toMatchObject({
      hpBefore: null,
      hpAfter: null,
    });
  });

  it('projects trusted provenance and bounded connection summaries without identifiers', () => {
    const analytics = projectMatchAnalytics({
      sourceMatchId: 'telemetry-source-match',
      state: state(),
      initialState: initialState(),
      seats: [
        { playerID: '0', userId: 'private-user-0', rankedEligible: true, resumeCount: 2 },
        { playerID: '1', userId: 'private-user-1', rankedEligible: true, resumeCount: 1 },
      ],
      rankedEligible: true,
      unratedReason: null,
      rulesVersion: 'rules-1',
      version: { appVersion: '1.0.0', buildId: 'build-1', rulesVersion: 'rules-1' },
      environment: 'production',
      telemetry: {
        matchMode: 'quick_match',
        trafficClass: 'operator',
        disconnectCounts: [3, -1],
        reconnectCounts: [2, Number.MAX_SAFE_INTEGER],
      },
    });

    expect(analytics.fact).toMatchObject({
      matchMode: 'quick_match',
      trafficClass: 'operator',
      disconnectCounts: [3, 0],
      reconnectCounts: [2, 0],
      seatResumeCounts: [2, 1],
    });
    expect(analytics.fact.qualityFlags).toEqual(
      expect.arrayContaining(['disconnect-observed', 'reconnect-observed', 'seat-resume-observed']),
    );
    expect(analytics.fact.qualityFlags).not.toContain('missing-provenance');
    expect(JSON.stringify(analytics)).not.toContain('private-user');
    expect(JSON.stringify(analytics)).not.toContain('telemetry-source-match');
  });

  it('drops hidden choices, instance IDs, user IDs, nested fields, and free text', () => {
    const serialized = JSON.stringify(project());

    expect(serialized).not.toContain('opaque-production-match-id');
    expect(serialized).not.toContain('registered-user-id');
    expect(serialized).not.toContain('browser-secret');
    expect(serialized).not.toContain('private-card');
    expect(serialized).not.toContain('private-instance');
    expect(serialized).not.toContain('private free text');
    expect(serialized).not.toContain('private result message');
    expect(serialized).not.toContain('do not retain me');
    expect(serialized).not.toContain('rock');
    expect(serialized).not.toContain('privateToken');
  });

  it('property-tests that arbitrary nested private data cannot enter the permanent projection', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.jsonValue(), (secretId, arbitraryNestedValue) => {
        const secret = `private-${secretId}`;
        const fuzzedState = structuredClone(state()) as unknown as {
          G: { actionLog: Array<Record<string, unknown>> };
        };
        fuzzedState.G.actionLog = fuzzedState.G.actionLog.map((entry) => ({
          ...entry,
          socketId: secret,
          sessionId: secret,
          userId: secret,
          hiddenHand: [secret],
          deckOrder: [secret],
          unknownNested: { secret, arbitraryNestedValue },
          payload: {
            ...(entry.payload as Record<string, unknown>),
            socketId: secret,
            sessionId: secret,
            userId: secret,
            freeText: secret,
            hiddenHand: [secret],
            deckOrder: [secret],
            unknownNested: { secret, arbitraryNestedValue },
          },
          result: {
            ...(entry.result as Record<string, unknown> | undefined),
            message: secret,
            unknownNested: { secret, arbitraryNestedValue },
          },
        }));
        fuzzedState.G.actionLog.push({
          action: 'unknown-private-action',
          payload: { secret, arbitraryNestedValue },
        });

        const fuzzedInitialState = structuredClone(initialState()) as unknown as {
          G: { players: Array<Record<string, unknown>> };
        };
        fuzzedInitialState.G.players = fuzzedInitialState.G.players.map((player) => ({
          ...player,
          hiddenHand: [secret],
          deckOrder: [secret],
          unknownNested: { secret, arbitraryNestedValue },
        }));

        const analytics = projectMatchAnalytics({
          sourceMatchId: secret,
          state: fuzzedState as never,
          initialState: fuzzedInitialState as never,
          seats: [
            { playerID: '0', userId: secret, rankedEligible: true },
            { playerID: '1', userId: `guest:${secret}`, rankedEligible: false },
          ],
          rankedEligible: false,
          unratedReason: 'guest_or_unranked_seat',
          rulesVersion: 'rules-1',
          version: { appVersion: '1.0.0', buildId: 'build-1', rulesVersion: 'rules-1' },
          datasetSha256: 'dataset-sha',
          environment: 'production',
        });

        const serialized = JSON.stringify(analytics);
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('unknown-private-action');
        expect(serialized).not.toContain('unknownNested');
        expect(serialized).not.toContain('hiddenHand');
        expect(serialized).not.toContain('deckOrder');
        expect(serialized).not.toContain('freeText');
        expect(serialized).not.toContain('socketId');
        expect(serialized).not.toContain('sessionId');
        expect(serialized).not.toContain('userId');
      }),
      { numRuns: 250 },
    );
  });

  it('fails closed when either authoritative initial deck is incomplete', () => {
    const incomplete = initialState() as { G: { players: Array<{ deck: unknown[]; hand: unknown[] }> } };
    incomplete.G.players[1].deck.pop();

    expect(() => project(incomplete as never)).toThrow('must contain exactly 20 cards');
  });

  it('projects stale unfinished runtime state as a deterministic abandoned session', () => {
    const unfinished = state() as unknown as {
      G: Record<string, unknown>;
      ctx: Record<string, unknown>;
    };
    unfinished.G.step = 'turnSet';
    delete unfinished.G.winner;
    delete unfinished.G.matchEndedAt;
    unfinished.ctx = {};
    const input = {
      sourceMatchId: 'opaque-abandoned-match-id',
      state: unfinished as never,
      initialState: initialState(),
      seats: [{ playerID: '0' as const, userId: 'registered-user-id', rankedEligible: true }],
      rulesVersion: 'rules-1',
      version: { appVersion: '1.0.0', buildId: 'build-1', rulesVersion: 'rules-1' },
      datasetSha256: 'dataset-sha',
      environment: 'production',
      abandonedAt: '2026-07-31T05:00:00.000Z',
    };

    const analytics = projectAbandonedMatchAnalytics(input);
    const duplicate = projectAbandonedMatchAnalytics(input);

    expect(analytics.fact).toMatchObject({
      outcome: 'abandoned',
      ratingMode: 'unrated',
      unratedReason: 'abandoned',
      winnerSeat: null,
      gameoverReasonCode: 'inactive-room',
      seatClasses: ['registered', 'unknown'],
      completedAt: '2026-07-31T05:00:00.000Z',
    });
    expect(analytics.fact.qualityFlags).toContain('abandoned');
    expect(analytics.fact.integritySha256).toBe(duplicate.fact.integritySha256);
  });
});
