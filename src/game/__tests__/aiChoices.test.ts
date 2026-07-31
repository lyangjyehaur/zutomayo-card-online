import { describe, expect, it } from 'vitest';
import { aiSelectPendingChoice } from '../ai';
import { createInstance, registerCardDefFallbacks } from '../cards/loader';
import { pendingChoiceSelectionError } from '../pendingChoices';
import { setupGame } from '../GameLogic';
import type { CardDef, CardInstance, CardType, GameState, PendingChoice } from '../types';

function card(id: string, type: CardType, overrides: Partial<CardDef> = {}): CardDef {
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
    attack: type === 'Character' ? { night: 30, day: 30 } : null,
    powerCost: 0,
    sendToPower: 0,
    effect: '',
    image: '',
    errata: '',
    ...overrides,
  };
}

const CARDS: CardDef[] = [
  ...Array.from({ length: 15 }, (_, index) => card(`test-character-${index + 1}`, 'Character')),
  ...Array.from({ length: 8 }, (_, index) => card(`test-enchant-${index + 1}`, 'Enchant')),
  ...Array.from({ length: 2 }, (_, index) => card(`test-area-enchant-${index + 1}`, 'Area Enchant')),
  card('test-expensive-character', 'Character', { attack: { night: 80, day: 80 }, powerCost: 99 }),
  card('test-direct-damage', 'Character', {
    attack: { night: 20, day: 20 },
    effect: '相手に30ダメージを与える。',
  }),
  card('test-day-character', 'Character', { attack: { night: 0, day: 100 } }),
  card('test-night-character', 'Character', { attack: { night: 100, day: 0 } }),
];

registerCardDefFallbacks(CARDS);
const DECK_IDS = CARDS.slice(0, 20).map((definition) => definition.id);

function instance(instanceId: string, defId: string, faceUp = true): CardInstance {
  return { instanceId, defId, faceUp };
}

function choiceState(choice: PendingChoice): GameState {
  const G = setupGame({ deck0Ids: DECK_IDS, deck1Ids: DECK_IDS });
  G.step = 'effectOrder';
  G.pendingChoice = choice;
  return G;
}

function choose(G: GameState): string[] {
  const choice = G.pendingChoice!;
  const decision = aiSelectPendingChoice(G, choice.player, 'normal', {
    seed: 'fixture:' + choice.type,
    now: () => 0,
  });
  expect(decision).not.toBeNull();
  expect(pendingChoiceSelectionError(choice, decision!.action)).toBeNull();
  expect(decision!.fallback).toBeUndefined();
  return decision!.action;
}

function option(cardValue: CardInstance) {
  return {
    id: cardValue.instanceId,
    label: cardValue.defId,
    cardInstanceId: cardValue.instanceId,
    cardDefId: cardValue.defId,
  };
}

describe('AI PendingChoice tactical fixtures', () => {
  it('returns the lower-value hand card to the deck before drawing', () => {
    const strong = instance('strong', 'test-character-1');
    const weak = instance('weak', 'test-expensive-character');
    const G = choiceState({
      id: 'hand-bottom',
      player: 0,
      type: 'handToDeckBottomThenDraw',
      min: 1,
      max: 1,
      payload: { drawCount: 1 },
      options: [option(strong), option(weak)],
    });
    G.players[0].hand = [strong, weak];
    G.players[0].deck = [createInstance('test-character-2')];
    expect(choose(G)).toEqual([weak.instanceId]);
  });

  it('recovers the higher-value own card with cardMove', () => {
    const strong = instance('strong', 'test-character-1');
    const weak = instance('weak', 'test-expensive-character');
    const G = choiceState({
      id: 'card-move',
      player: 0,
      type: 'cardMove',
      min: 1,
      max: 1,
      payload: {
        sourcePlayer: 0,
        sourceZone: 'abyss',
        destinationPlayer: 0,
        destinationZone: 'deck',
        destinationPosition: 'bottom',
      },
      options: [option(weak), option(strong)],
    });
    G.players[0].abyss = [weak, strong];
    expect(choose(G)).toEqual([strong.instanceId]);
  });

  it('declines an optional payment that would discard a strong card', () => {
    const strong = instance('strong', 'test-character-1');
    const G = choiceState({
      id: 'optional-payment',
      player: 0,
      type: 'optionalHandMoveThenDraw',
      min: 0,
      max: 1,
      payload: {
        sourcePlayer: 0,
        sourceZone: 'hand',
        destinationPlayer: 0,
        destinationZone: 'abyss',
        drawCount: 1,
        filter: {},
      },
      options: [option(strong)],
    });
    G.players[0].hand = [strong];
    expect(choose(G)).toEqual([]);
  });

  it('returns the highest-value Abyss card to the deck', () => {
    const strong = instance('strong', 'test-character-1');
    const weak = instance('weak', 'test-expensive-character');
    const G = choiceState({
      id: 'abyss-bottom',
      player: 0,
      type: 'abyssToDeckBottomOrLose',
      min: 1,
      max: 1,
      payload: { faceDown: true, shuffle: false },
      options: [option(weak), option(strong)],
    });
    G.players[0].abyss = [weak, strong];
    expect(choose(G)).toEqual([strong.instanceId]);
  });

  it('orders weaker cards first on the opponent deck', () => {
    const strong = instance('strong', 'test-character-1', false);
    const weak = instance('weak', 'test-expensive-character', false);
    const G = choiceState({
      id: 'reorder',
      player: 0,
      type: 'reorderOpponentDeckTop',
      min: 2,
      max: 2,
      payload: { targetPlayer: 1, count: 2 },
      options: [option(strong), option(weak)],
    });
    G.players[1].deck = [strong, weak];
    expect(choose(G)).toEqual([weak.instanceId, strong.instanceId]);
  });

  it('forces the weakest opposing Power Character into battle', () => {
    const weak = instance('weak', 'test-expensive-character');
    const strong = instance('strong', 'test-character-1');
    const G = choiceState({
      id: 'opponent-swap',
      player: 0,
      type: 'opponentPowerCharacterSwap',
      min: 1,
      max: 1,
      payload: { opponentPlayer: 1 },
      options: [option(strong), option(weak)],
    });
    G.players[1].battleZone = instance('battle', 'test-character-1');
    G.players[1].powerCharger = [strong, weak];
    expect(choose(G)).toEqual([weak.instanceId]);
  });

  it('uses the highest-value legal card from the Abyss', () => {
    const weak = instance('weak', 'test-expensive-character');
    const strong = instance('strong', 'test-character-1');
    const G = choiceState({
      id: 'use-abyss',
      player: 0,
      type: 'useFromAbyss',
      min: 1,
      max: 1,
      payload: { sourcePlayer: 0, cardType: 'Character' },
      options: [option(weak), option(strong)],
    });
    G.players[0].abyss = [weak, strong];
    expect(choose(G)).toEqual([strong.instanceId]);
  });

  it('uses the strongest affordable legal card from hand', () => {
    const weak = instance('weak', 'test-expensive-character');
    const strong = instance('strong', 'test-character-1');
    const G = choiceState({
      id: 'use-hand',
      player: 0,
      type: 'useFromHand',
      min: 1,
      max: 1,
      payload: { sourcePlayer: 0, filter: { cardType: 'Character' } },
      options: [option(weak), option(strong)],
    });
    G.players[0].hand = [weak, strong];
    expect(choose(G)).toEqual([strong.instanceId]);
  });

  it('reveals enough legal cards to maximize a positive attack boost', () => {
    const first = instance('first', 'test-expensive-character');
    const second = instance('second', 'test-expensive-character');
    const G = choiceState({
      id: 'reveal-boost',
      player: 0,
      type: 'revealHandAttackBoost',
      min: 0,
      max: 2,
      payload: { sourcePlayer: 0, boostPerCard: 10, filter: { cardType: 'Character' } },
      options: [option(first), option(second)],
    });
    G.players[0].hand = [first, second];
    G.players[0].battleZone = instance('own-battle', 'test-character-2');
    G.players[1].battleZone = instance('opponent-battle', 'test-character-1');
    expect(choose(G)).toEqual([first.instanceId, second.instanceId]);
  });

  it('uses a public card-pool prior for name guesses without observing the hidden card', () => {
    const makeState = (hiddenDefId: string) => {
      const G = choiceState({
        id: 'guess',
        player: 0,
        type: 'declareOpponentHandCardName',
        min: 1,
        max: 1,
        payload: { opponentPlayer: 1, attackBoost: 20 },
        options: [
          { id: 'declare:test-enchant-1', label: 'enchant', value: 'test-enchant-1' },
          { id: 'declare:test-character-1', label: 'character', value: 'test-character-1' },
        ],
      });
      G.players[1].hand = [instance('hidden', hiddenDefId, false)];
      return G;
    };
    expect(choose(makeState('test-character-2'))).toEqual(['declare:test-character-1']);
    expect(choose(makeState('test-enchant-1'))).toEqual(['declare:test-character-1']);
  });

  it('swaps a weak hand card for a stronger Abyss card', () => {
    const weak = instance('weak', 'test-expensive-character');
    const strong = instance('strong', 'test-character-1');
    const G = choiceState({
      id: 'hand-abyss-swap',
      player: 0,
      type: 'handAbyssSwap',
      min: 2,
      max: 2,
      payload: {},
      options: [
        { ...option(weak), id: `hand:${weak.instanceId}` },
        { ...option(strong), id: `abyss:${strong.instanceId}` },
      ],
    });
    G.players[0].hand = [weak];
    G.players[0].abyss = [strong];
    expect(choose(G)).toEqual([`hand:${weak.instanceId}`, `abyss:${strong.instanceId}`]);
  });

  it('sets Chronos to a time favoring its current Character', () => {
    const G = choiceState({
      id: 'clock-position',
      player: 0,
      type: 'clockPosition',
      min: 1,
      max: 1,
      payload: {},
      options: [
        { id: 'night', label: 'night', value: 0 },
        { id: 'day', label: 'day', value: 9 },
      ],
    });
    G.players[0].battleZone = instance('own-battle', 'test-day-character');
    G.players[1].battleZone = instance('opponent-battle', 'test-night-character');
    expect(choose(G)).toEqual(['day']);
  });

  it('advances Chronos into a time favoring its current Character', () => {
    const G = choiceState({
      id: 'clock-advance',
      player: 0,
      type: 'clockAdvance',
      min: 1,
      max: 1,
      payload: {},
      options: [
        { id: 'stay-night', label: 'stay', value: 0 },
        { id: 'reach-day', label: 'advance', value: 2 },
      ],
    });
    G.chronos.position = 3;
    G.players[0].battleZone = instance('own-battle', 'test-day-character');
    G.players[1].battleZone = instance('opponent-battle', 'test-night-character');
    expect(choose(G)).toEqual(['reach-day']);
  });
});
