import { describe, expect, it } from 'vitest';
import type { GameNotice } from '../../../game/types';
import { battleResultView } from '../BattleResolutionLayer';

describe('battleResultView', () => {
  it('uses the notice snapshot without reading a later turn result', () => {
    const notice: GameNotice = {
      id: 8,
      kind: 'hpChange',
      tone: 'danger',
      titleKey: 'board.hpChange.battle',
      player: 1,
      delta: -40,
      hpBefore: 100,
      hpAfter: 60,
      reason: 'battle',
      winner: 0,
      winnerAttack: 60,
      loserAttack: 20,
      damage: 40,
      battleCards: [
        { instanceId: 'turn-1-winner', defId: 'test-character-1', faceUp: true },
        { instanceId: 'turn-1-loser', defId: 'test-character-2', faceUp: true },
      ],
      resolutionTurn: 1,
      timestamp: Date.now(),
    };

    expect(battleResultView(notice)).toMatchObject({
      winner: 0,
      loser: 1,
      attacks: { 0: 60, 1: 20 },
      rawDamage: 40,
      finalDamage: 40,
      hpLoss: 40,
      hpBefore: 100,
      hpAfter: 60,
    });
  });

  it('keeps structured damage-reduction sources for causal animation', () => {
    const notice: GameNotice = {
      id: 9,
      kind: 'hpChange',
      tone: 'danger',
      titleKey: 'board.hpChange.battle',
      player: 1,
      delta: -20,
      hpBefore: 100,
      hpAfter: 80,
      reason: 'battle',
      winner: 0,
      winnerAttack: 70,
      loserAttack: 40,
      damage: 20,
      damageReductionSources: [{ cardInstanceId: 'guard', cardDefId: 'guard-card', amount: 10 }],
      timestamp: Date.now(),
    };

    expect(battleResultView(notice)).toMatchObject({
      rawDamage: 30,
      reduction: 10,
      finalDamage: 20,
      reductionSources: [{ cardInstanceId: 'guard', cardDefId: 'guard-card', amount: 10 }],
    });
  });

  it('does not mistake overkill damage for damage reduction', () => {
    const notice: GameNotice = {
      id: 10,
      kind: 'hpChange',
      tone: 'danger',
      titleKey: 'board.hpChange.battle',
      player: 1,
      delta: -10,
      hpBefore: 10,
      hpAfter: 0,
      reason: 'battle',
      winner: 0,
      winnerAttack: 70,
      loserAttack: 20,
      damage: 50,
      timestamp: Date.now(),
    };

    expect(battleResultView(notice)).toMatchObject({
      rawDamage: 50,
      finalDamage: 50,
      hpLoss: 10,
      reduction: 0,
    });
  });
});
