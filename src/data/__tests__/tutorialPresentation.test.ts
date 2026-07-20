import { describe, expect, it } from 'vitest';
import type { GameState } from '../../game/types';
import {
  buildTutorialPresentationState,
  captureTutorialPresentationSnapshots,
  EMPTY_TUTORIAL_PRESENTATION_SNAPSHOTS,
} from '../tutorialPresentation';

function state(turnNumber: number, step: GameState['step'], playerHp = 80, opponentHp = 100): GameState {
  return {
    turnNumber,
    step,
    ready: [false, false],
    chronos: { position: turnNumber === 2 ? 3 : 10, nightSidePlayer: 0 },
    chronosAtTurnStart: 3,
    players: [
      { hp: playerHp, hand: [], deck: [], battleZone: null, setZoneA: null, setZoneB: null, setZoneC: null },
      { hp: opponentHp, hand: [], deck: [], battleZone: null, setZoneA: null, setZoneB: null, setZoneC: null },
    ],
    pendingEffects: [[], []],
  } as unknown as GameState;
}

describe('tutorial presentation timeline', () => {
  it('captures immutable checkpoints without replacing earlier snapshots', () => {
    const turn2 = state(2, 'turnSet');
    const effectOrder = state(2, 'effectOrder');
    effectOrder.pendingEffects[0] = [{ id: 'effect' }] as GameState['pendingEffects'][0];
    const turn3 = state(3, 'turnSet', 80, 30);

    const first = captureTutorialPresentationSnapshots(EMPTY_TUTORIAL_PRESENTATION_SNAPSHOTS, turn2);
    const second = captureTutorialPresentationSnapshots(first, effectOrder);
    const third = captureTutorialPresentationSnapshots(second, turn3);

    expect(third.turn2Entry).not.toBe(turn2);
    expect(third.turn2Entry?.turnNumber).toBe(2);
    expect(third.effectOrder?.step).toBe('effectOrder');
    expect(third.postTurn2?.players[1].hp).toBe(30);
  });

  it('shows the narrated values while leaving authoritative state untouched', () => {
    const authoritative = state(3, 'turnSet', 80, 30);
    const turn2 = state(2, 'turnSet', 80, 100);
    const snapshots = {
      turn2Entry: turn2,
      effectOrder: state(2, 'effectOrder', 80, 100),
      postTurn2: authoritative,
    };

    const recap = buildTutorialPresentationState({
      authoritative,
      snapshots,
      phase: 'flow-recap',
      secondHpCalculation: false,
    });
    const firstHp = buildTutorialPresentationState({
      authoritative,
      snapshots,
      phase: 'hp-calc',
      secondHpCalculation: false,
    });
    const choice = buildTutorialPresentationState({
      authoritative,
      snapshots,
      phase: 'choice-mechanics',
      secondHpCalculation: false,
    });
    const secondHp = buildTutorialPresentationState({
      authoritative,
      snapshots,
      phase: 'hp-calc',
      secondHpCalculation: true,
    });

    expect(recap).toMatchObject({ turnNumber: 1, chronos: { position: 0 } });
    expect(recap?.players.map((player) => player.hp)).toEqual([100, 100]);
    expect(firstHp?.players[0].hp).toBe(80);
    expect(choice).toMatchObject({ turnNumber: 2, step: 'effectOrder' });
    expect(choice?.players[1].hp).toBe(100);
    expect(secondHp?.turnNumber).toBe(2);
    expect(secondHp?.players[1].hp).toBe(30);
    expect(authoritative).toMatchObject({ turnNumber: 3, players: [{ hp: 80 }, { hp: 30 }] });
  });
});
