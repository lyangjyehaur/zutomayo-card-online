import { beforeEach, describe, expect, it } from 'vitest';
import { emptyModifiers } from '../../../game/GameLogic';
import { initCards } from '../../../game/cards/loader';
import type { CardDef, CardInstance, GameState, PlayerState } from '../../../game/types';
import { battleCardBlockReason, deriveBattleActionAvailability } from '../actionAvailability';

function cardDef(id: string, type: CardDef['type']): CardDef {
  return {
    id,
    name: id,
    pack: 'test',
    song: 'test',
    illustrator: 'test',
    rarity: 'N',
    element: '闇',
    type,
    clock: 1,
    attack: type === 'Character' ? { night: 20, day: 20 } : null,
    powerCost: 0,
    sendToPower: 0,
    effect: '',
    image: '',
    errata: '',
  };
}

function card(defId: string): CardInstance {
  return { instanceId: `${defId}-instance`, defId, faceUp: false };
}

function player(hand: CardInstance[]): PlayerState {
  return {
    hp: 100,
    deck: [],
    hand,
    battleZone: null,
    setZoneA: null,
    setZoneB: null,
    setZoneC: null,
    powerCharger: [],
    abyss: [],
    cardsSetThisTurn: 0,
    rawAttack: 0,
  };
}

function gameState(hand = [card('character'), card('area')]): GameState {
  const state = {
    players: [player(hand), player([])],
    step: 'turnSet',
    ready: [false, false],
    turnNumber: 2,
    lastBattleResult: { winner: 1, damage: 10, winnerAttack: 30, loserAttack: 20 },
    modifiers: emptyModifiers(),
    areaEnchantSetLocked: [false, false],
    setCardsThisTurn: [[], []],
  } satisfies Pick<
    GameState,
    | 'players'
    | 'step'
    | 'ready'
    | 'turnNumber'
    | 'lastBattleResult'
    | 'modifiers'
    | 'areaEnchantSetLocked'
    | 'setCardsThisTurn'
  >;
  return state as unknown as GameState;
}

beforeEach(() => {
  initCards([cardDef('character', 'Character'), cardDef('area', 'Area Enchant')]);
});

describe('deriveBattleActionAvailability', () => {
  it('preserves the losing player option to set one or two cards', () => {
    const G = gameState();
    const initial = deriveBattleActionAvailability(G, 0);

    expect(initial).toMatchObject({ minimum: 1, required: 2, canAct: true, canConfirm: false });
    expect(initial.playableCardDefIds).toEqual(['character', 'area']);

    G.players[0].cardsSetThisTurn = 1;
    G.setCardsThisTurn[0] = [card('character')];
    expect(deriveBattleActionAvailability(G, 0)).toMatchObject({ canAct: true, canConfirm: true });

    G.players[0].cardsSetThisTurn = 2;
    expect(deriveBattleActionAvailability(G, 0)).toMatchObject({ canAct: false, canConfirm: true });
  });

  it('fails closed for spectators, ready players, and disabled tutorial interaction', () => {
    const G = gameState();
    G.players[0].cardsSetThisTurn = 1;

    expect(deriveBattleActionAvailability(G, 0, { spectator: true })).toMatchObject({
      canAct: false,
      canConfirm: false,
      playableCardDefIds: [],
    });
    expect(deriveBattleActionAvailability(G, 0, { tutorialSetInteractionEnabled: false })).toMatchObject({
      canAct: false,
      canConfirm: false,
    });
    G.ready[0] = true;
    expect(deriveBattleActionAvailability(G, 0)).toMatchObject({ canAct: false, canConfirm: false });
  });

  it('filters cards restricted by the tutorial and area-enchant lock', () => {
    const G = gameState();
    G.areaEnchantSetLocked[0] = true;

    expect(deriveBattleActionAvailability(G, 0, { tutorialAllowedSetCardDefIds: ['area'] }).playableCardDefIds).toEqual(
      [],
    );
    expect(battleCardBlockReason(G, 0, card('character'), ['area'])).toBe('tutorial-restricted');
    expect(battleCardBlockReason(G, 0, card('area'), ['area'])).toBe('area-enchant-locked');
  });

  it('blocks all turn-set cards when both ordinary set slots are occupied', () => {
    const G = gameState();
    G.players[0].setZoneA = card('character');
    G.players[0].setZoneB = card('character');

    expect(deriveBattleActionAvailability(G, 0).playableCardDefIds).toEqual([]);
    expect(battleCardBlockReason(G, 0, card('character'))).toBe('no-set-slot-available');

    G.step = 'initialSet';
    expect(battleCardBlockReason(G, 0, card('character'))).toBeNull();
  });

  it('requires every tutorial card before confirmation', () => {
    const G = gameState();
    G.players[0].cardsSetThisTurn = 1;
    G.setCardsThisTurn[0] = [card('character')];

    expect(
      deriveBattleActionAvailability(G, 0, { tutorialRequiredSetCardDefIds: ['character', 'area'] }).canConfirm,
    ).toBe(false);
    G.setCardsThisTurn[0].push(card('area'));
    expect(
      deriveBattleActionAvailability(G, 0, { tutorialRequiredSetCardDefIds: ['character', 'area'] }).canConfirm,
    ).toBe(true);
  });
});
