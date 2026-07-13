import type { LongFormMove } from 'boardgame.io';
import { describe, expect, it } from 'vitest';
import { ZutomayoCard } from '../Game';
import type { GameState } from '../types';

const CONCURRENT_MOVE_NAMES = [
  'janken',
  'mulligan',
  'keepHand',
  'setInitialCard',
  'setTurnCard',
  'undoSetCard',
  'confirmReady',
] as const;

function concurrentMove(name: (typeof CONCURRENT_MOVE_NAMES)[number]): LongFormMove<GameState> {
  const move = ZutomayoCard.moves?.[name];
  expect(move, `${name} should be registered`).toBeDefined();
  expect(typeof move, `${name} should use the long-form server move contract`).toBe('object');
  return move as LongFormMove<GameState>;
}

describe('online simultaneous move contract', () => {
  it.each(CONCURRENT_MOVE_NAMES)('%s waits for the server and accepts a concurrent stale state ID', (name) => {
    expect(concurrentMove(name)).toMatchObject({
      client: false,
      ignoreStaleStateID: true,
      move: expect.any(Function),
    });
  });

  it('uses the same guarded moves in the simultaneous stage', () => {
    expect(ZutomayoCard.turn?.stages?.simultaneous?.moves).toBe(ZutomayoCard.moves);
  });
});
