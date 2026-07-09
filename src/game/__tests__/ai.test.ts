import { describe, it, expect } from 'vitest';
import { initCards, isCardsInitialized, createInstance, getAllCardDefs } from '../cards/loader';
import { aiSelectCards } from '../ai';
import { setupGame, chooseJanken, finishMulligan, setInitialCard, confirmReady } from '../GameLogic';
import { parseAllEffects } from '../effects/parser';
import type { CardDef, CardType, GameState } from '../types';

// ===== Test card definitions =====

function makeCard(id: string, type: CardType, overrides: Partial<CardDef> = {}): CardDef {
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
    attack: type === 'Character' ? { night: 20, day: 30 } : null,
    powerCost: 0,
    sendToPower: 0,
    effect: '',
    image: '',
    errata: '',
    ...overrides,
  };
}

const TEST_CARDS: CardDef[] = [
  ...Array.from({ length: 15 }, (_, i) => makeCard(`test-character-${i + 1}`, 'Character')),
  ...Array.from({ length: 8 }, (_, i) => makeCard(`test-enchant-${i + 1}`, 'Enchant')),
  ...Array.from({ length: 2 }, (_, i) => makeCard(`test-area-enchant-${i + 1}`, 'Area Enchant')),
];

if (!isCardsInitialized()) {
  initCards(TEST_CARDS);
}

const parsedEffects = parseAllEffects(getAllCardDefs().map((card) => ({ id: card.id, effect: card.effect })));

// ===== Helpers =====

function progressToInitialSet(G: GameState): void {
  chooseJanken(G, 0, 'rock');
  chooseJanken(G, 1, 'scissors');
  finishMulligan(G, 0, []);
  finishMulligan(G, 1, []);
}

function progressToTurnSet(G: GameState): void {
  progressToInitialSet(G);
  setInitialCard(G, 0, 0);
  setInitialCard(G, 1, 0);
  confirmReady(G, 0, parsedEffects);
  confirmReady(G, 1, parsedEffects);
}

function makeGWithHand(handDefIds: string[], step: 'initialSet' | 'turnSet' = 'turnSet'): GameState {
  const G = setupGame();
  if (step === 'initialSet') {
    progressToInitialSet(G);
  } else {
    progressToTurnSet(G);
  }
  // Replace player 0's hand with specific cards for deterministic testing
  G.players[0].hand = handDefIds.map((id) => createInstance(id));
  G.players[0].cardsSetThisTurn = 0;
  G.players[0].battleZone = null;
  G.players[0].setZoneA = null;
  G.players[0].setZoneB = null;
  G.ready[0] = false;
  G.lastBattleResult = { winner: null, damage: 0, winnerAttack: 0, loserAttack: 0 };
  return G;
}

// ===== Tests =====

describe('aiSelectCards', () => {
  it('returns empty array when hand is empty', () => {
    const G = setupGame();
    progressToTurnSet(G);
    G.players[0].hand = [];
    const result = aiSelectCards(G, 0, 'normal');
    expect(result).toEqual([]);
  });

  it('easy difficulty returns valid selections with correct count', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-enchant-1',
      'test-enchant-2',
    ]);
    const result = aiSelectCards(G, 0, 'easy');
    // Required set count is 1 (no battle result winner), so 1 card
    expect(result).toHaveLength(1);
    expect(result[0].handIndex).toBeGreaterThanOrEqual(0);
    expect(result[0].handIndex).toBeLessThan(5);
    expect(['A', 'B']).toContain(result[0].slot);
  });

  it('normal difficulty returns highest scored cards', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-enchant-1',
      'test-enchant-2',
    ]);
    const result = aiSelectCards(G, 0, 'normal');
    expect(result).toHaveLength(1);
    // Normal picks highest score: characters with high attack score higher than enchants
    const selectedCard = G.players[0].hand[result[0].handIndex];
    expect(selectedCard.defId).toMatch(/test-character/);
  });

  it('hard difficulty returns valid selections via lookahead', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-enchant-1',
      'test-enchant-2',
    ]);
    const result = aiSelectCards(G, 0, 'hard');
    expect(result).toHaveLength(1);
    expect(result[0].handIndex).toBeGreaterThanOrEqual(0);
    expect(result[0].handIndex).toBeLessThan(5);
  });

  it('returns 2 cards when required set count is 2 (loser)', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-character-4',
      'test-character-5',
    ]);
    // Simulate player 0 being the loser of previous battle
    G.lastBattleResult = { winner: 1, damage: 10, winnerAttack: 30, loserAttack: 20 };
    const result = aiSelectCards(G, 0, 'normal');
    expect(result).toHaveLength(2);
    // Two different hand indices
    expect(result[0].handIndex).not.toBe(result[1].handIndex);
  });

  it('works in initialSet step', () => {
    const G = makeGWithHand(
      ['test-character-1', 'test-character-2', 'test-character-3', 'test-enchant-1', 'test-enchant-2'],
      'initialSet',
    );
    const result = aiSelectCards(G, 0, 'normal');
    expect(result).toHaveLength(1);
    expect(result[0].slot).toBe('A');
  });

  it('normal prefers characters over enchants', () => {
    const G = makeGWithHand([
      'test-enchant-1',
      'test-enchant-2',
      'test-character-1',
      'test-character-2',
      'test-character-3',
    ]);
    const result = aiSelectCards(G, 0, 'normal');
    const selectedDefId = G.players[0].hand[result[0].handIndex].defId;
    expect(selectedDefId).toMatch(/test-character/);
  });

  it('all difficulties return valid hand indices', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-character-4',
      'test-character-5',
    ]);
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const result = aiSelectCards(G, 0, difficulty);
      for (const selection of result) {
        expect(selection.handIndex).toBeGreaterThanOrEqual(0);
        expect(selection.handIndex).toBeLessThan(G.players[0].hand.length);
        expect(['A', 'B', 'C']).toContain(selection.slot);
      }
    }
  });

  it('hard difficulty handles 2-card requirement with limited slots', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-character-4',
      'test-character-5',
    ]);
    G.lastBattleResult = { winner: 1, damage: 10, winnerAttack: 30, loserAttack: 20 };
    const result = aiSelectCards(G, 0, 'hard');
    expect(result).toHaveLength(2);
    // Slots should be A and B
    const slots = result.map((r) => r.slot).sort();
    expect(slots).toEqual(['A', 'B']);
  });

  it('does not modify the original game state hand', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-character-4',
      'test-character-5',
    ]);
    const handBefore = [...G.players[0].hand];
    aiSelectCards(G, 0, 'hard');
    expect(G.players[0].hand).toEqual(handBefore);
  });

  it('falls back to normal strategy when hard lookahead returns empty', () => {
    // When player has 0 cards to set (already met required count)
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-character-4',
      'test-character-5',
    ]);
    G.players[0].cardsSetThisTurn = 1; // Already set 1 card, requirement is 1
    const result = aiSelectCards(G, 0, 'hard');
    expect(result).toEqual([]);
  });
});

describe('aiSelectCards with power cost considerations', () => {
  it('normal difficulty can select zero-cost characters', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-character-4',
      'test-character-5',
    ]);
    // All test characters have powerCost 0, so they should be selectable
    const result = aiSelectCards(G, 0, 'normal');
    expect(result).toHaveLength(1);
    expect(result[0].handIndex).toBeGreaterThanOrEqual(0);
  });

  it('handles player with power in powerCharger', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-character-4',
      'test-character-5',
    ]);
    // Add a card to powerCharger (sendToPower 0 for test cards, so power stays 0)
    G.players[0].powerCharger = [createInstance('test-character-1')];
    const result = aiSelectCards(G, 0, 'hard');
    expect(result).toHaveLength(1);
  });
});
