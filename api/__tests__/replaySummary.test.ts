import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createReplaySummary } = require('../replaySummary.cjs') as {
  createReplaySummary: (
    G: Record<string, unknown>,
    rulesVersion: string,
    actionLog: unknown[],
  ) => Record<string, unknown> & { searchText: string };
};

describe('completed-match replay summary', () => {
  it('indexes phases, decisions, effects, revealed hands, and the final result', () => {
    const actionLog = [
      { id: 1, turn: 1, step: 'set', player: 0, action: 'setTurnCard', payload: {} },
      {
        id: 2,
        turn: 1,
        step: 'battle',
        player: 0,
        action: 'resolvePendingEffect',
        pendingEffectCardDefId: 'card-effect',
        pendingChoiceType: 'clockAdvance',
        payload: {},
        result: { ok: true, message: 'resolved' },
      },
      {
        id: 3,
        turn: 1,
        step: 'battle',
        player: 1,
        action: 'revealCards',
        payload: { targetPlayer: 1, sourceZone: 'hand', cardDefIds: ['card-secret'] },
      },
    ];
    const summary = createReplaySummary(
      {
        winner: 0,
        gameoverReason: 'hp',
        turnNumber: 1,
        chronos: { position: 4 },
        players: [{ hp: 40 }, { hp: 0 }],
        replayManifest: { schemaVersion: 1, rulesVersion: 'rules-1' },
        decisionTrace: [
          {
            sequence: 1,
            player: 0,
            move: 'setTurnCard',
            args: ['card-secret'],
            requestFingerprint: 'before',
            stateFingerprintAfter: 'after',
          },
        ],
      },
      'rules-1',
      actionLog,
    );

    expect(summary).toMatchObject({
      schemaVersion: 1,
      traceComplete: true,
      result: { winner: 0, turns: 1, finalHp: [40, 0], finalChronos: 4 },
      phases: [
        { step: 'set', actionCount: 1 },
        { step: 'battle', actionCount: 2 },
      ],
      effects: [{ order: 1, cardDefId: 'card-effect', choiceType: 'clockAdvance' }],
      revealedHands: [
        { player: 0, cardDefIds: [] },
        { player: 1, cardDefIds: ['card-secret'] },
      ],
    });
    expect(summary.searchText).toContain('card-effect');
    expect(summary.searchText).toContain('card-secret');
  });

  it('does not serialize unrevealed hands, decks, RNG state, or replay manifests', () => {
    const summary = createReplaySummary(
      {
        winner: 1,
        players: [{ hp: 0, hand: [{ defId: 'hidden-hand' }], deck: [{ defId: 'hidden-deck' }] }, { hp: 10 }],
        rng: { seed: 123 },
        replayManifest: { schemaVersion: 1, seed: 123, deckDefIds: [['hidden-deck'], []] },
        decisionTrace: [],
      },
      'rules-1',
      [],
    );
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('hidden-hand');
    expect(serialized).not.toContain('hidden-deck');
    expect(serialized).not.toContain('"seed"');
    expect(serialized).not.toContain('replayManifest');
  });
});
