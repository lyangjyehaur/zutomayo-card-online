import { beforeEach, describe, expect, it } from 'vitest';
import type { GameStep } from '../../../game/types';
import { setLocale, t } from '../../../i18n';
import { getPhaseInstruction, type PhaseInstructionState } from '../phaseInstruction';

const playerName = (index: 0 | 1) => `Player ${index + 1}`;

function makeState(step: GameStep): PhaseInstructionState {
  return {
    step,
    players: [{ cardsSetThisTurn: 0 }, { cardsSetThisTurn: 0 }],
    ready: [false, false],
    pendingChoice: null,
    pendingEffectPlayer: null,
    pendingEffects: [[], []],
  };
}

describe('getPhaseInstruction', () => {
  beforeEach(() => setLocale('zh-TW'));

  it('shows setup guidance before janken instead of game-over copy', () => {
    const G = makeState('janken');

    const instruction = getPhaseInstruction(G, 0, 1, 1, playerName);

    expect(instruction).toEqual({
      title: t('board.janken'),
      body: t('board.jankenHint'),
      meta: [],
    });
    expect(instruction.title).not.toBe(t('board.gameOver'));
    expect(instruction.body).not.toBe(t('online.gameOverHelper'));
  });

  it('shows mulligan guidance instead of game-over copy', () => {
    const G = makeState('mulligan');

    const instruction = getPhaseInstruction(G, 0, 1, 1, playerName);

    expect(instruction).toEqual({
      title: t('board.mulligan'),
      body: t('board.mulliganHint'),
      meta: [],
    });
  });

  it('only shows game-over copy for the game-over step', () => {
    const G = makeState('gameOver');

    expect(getPhaseInstruction(G, 0, 1, 1, playerName)).toEqual({
      title: t('board.gameOver'),
      body: t('online.gameOverHelper'),
      meta: [],
    });
  });
});
