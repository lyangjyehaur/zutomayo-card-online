import type { LongFormMove } from 'boardgame.io';
import { describe, expect, it } from 'vitest';
import { ZutomayoCard } from '../Game';
import type { GameState } from '../types';

const STALE_SAFE_SERVER_MOVE_NAMES = [
  'janken',
  'mulligan',
  'keepHand',
  'setInitialCard',
  'setTurnCard',
  'undoSetCard',
  'confirmReady',
  'surrender',
  'timeoutSkip',
  'timeoutAdvance',
] as const;

const AUTHORITATIVE_SERVER_MOVE_NAMES = [
  ...STALE_SAFE_SERVER_MOVE_NAMES,
  'resolvePendingEffect',
  'submitPendingChoice',
] as const;

function serverMove(name: (typeof AUTHORITATIVE_SERVER_MOVE_NAMES)[number]): LongFormMove<GameState> {
  const move = ZutomayoCard.moves?.[name];
  expect(move, `${name} should be registered`).toBeDefined();
  expect(typeof move, `${name} should use the long-form server move contract`).toBe('object');
  return move as LongFormMove<GameState>;
}

describe('online simultaneous move contract', () => {
  it.each(AUTHORITATIVE_SERVER_MOVE_NAMES)('%s waits for the authoritative server result', (name) => {
    expect(serverMove(name)).toMatchObject({
      client: false,
      move: expect.any(Function),
    });
  });

  it.each(STALE_SAFE_SERVER_MOVE_NAMES)('%s accepts an intentionally stale state ID', (name) => {
    expect(serverMove(name)).toMatchObject({
      client: false,
      ignoreStaleStateID: true,
      move: expect.any(Function),
    });
  });

  it('uses the same guarded moves in the simultaneous stage', () => {
    expect(ZutomayoCard.turn?.stages?.simultaneous?.moves).toBe(ZutomayoCard.moves);
  });
});
