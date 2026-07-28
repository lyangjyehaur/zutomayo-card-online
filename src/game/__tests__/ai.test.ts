import { describe, it, expect, vi } from 'vitest';
import { initCards, createInstance, getAllCardDefs } from '../cards/loader';
import {
  aiPlanTurn,
  aiSelectCards,
  aiSelectEffect,
  aiSelectMulligan,
  aiSelectPendingChoice,
  createAIKnowledgeState,
} from '../ai';
import { generateTurnPlans } from '../ai/candidates';
import { createDecisionContext } from '../ai/rng';
import { sampleUnknownState } from '../ai/sampling';
import { simulateTurnPlan } from '../ai/simulator';
import {
  clearPlanEvaluationCache,
  getCachedPlanEvaluation,
  planEvaluationCacheKey,
  setCachedPlanEvaluation,
} from '../ai/transposition';
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
  makeCard('test-expensive-character', 'Character', { powerCost: 99, attack: { night: 80, day: 80 } }),
  makeCard('test-unaffordable-damage', 'Character', {
    powerCost: 99,
    attack: { night: 80, day: 80 },
    effect: '相手に30ダメージを与える。',
  }),
  makeCard('test-direct-damage', 'Character', {
    attack: { night: 20, day: 20 },
    effect: '相手に30ダメージを与える。',
  }),
  makeCard('test-day-character', 'Character', { attack: { night: 0, day: 100 } }),
  makeCard('test-night-character', 'Character', { attack: { night: 100, day: 0 } }),
];

initCards(TEST_CARDS);

const parsedEffects = parseAllEffects(getAllCardDefs().map((card) => ({ id: card.id, effect: card.effect })));
const TEST_DECK_IDS = TEST_CARDS.slice(0, 20).map((card) => card.id);

// ===== Helpers =====

function setupTestGame(): GameState {
  return setupGame({ deck0Ids: TEST_DECK_IDS, deck1Ids: TEST_DECK_IDS, skipShuffle: true }, { allowSkipShuffle: true });
}

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
  const G = setupTestGame();
  G.step = step;
  G.turnNumber = step === 'turnSet' ? 2 : 1;
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
    const G = setupTestGame();
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

  it('returns a legal optional card count for the previous loser', () => {
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
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(2);
    expect(new Set(result.map((selection) => selection.slot)).size).toBe(result.length);

    const plans = generateTurnPlans(createAIKnowledgeState(G, 0));
    expect(
      plans.some(
        (plan) =>
          plan.length === 2 &&
          plan
            .map((selection) => selection.slot)
            .sort()
            .join(',') === 'A,B',
      ),
    ).toBe(true);
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

  it('hard difficulty handles the loser optional second card with limited slots', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-character-4',
      'test-character-5',
    ]);
    G.lastBattleResult = { winner: 1, damage: 10, winnerAttack: 30, loserAttack: 20 };
    const result = aiSelectCards(G, 0, 'hard');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(2);
    expect(new Set(result.map((selection) => selection.slot)).size).toBe(result.length);
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

describe('AI difficulty policy contracts', () => {
  it('replays easy decisions from the same seed without using global Math.random', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-enchant-1',
      'test-enchant-2',
    ]);
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('AI must not use global Math.random');
    });
    try {
      expect(aiPlanTurn(G, 0, 'easy', { seed: 'repeatable' }).action).toEqual(
        aiPlanTurn(G, 0, 'easy', { seed: 'repeatable' }).action,
      );
    } finally {
      random.mockRestore();
    }
  });

  it('sanitizes authoritative opponent cards before making a decision', () => {
    const first = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-enchant-1',
      'test-enchant-2',
    ]);
    const second = structuredClone(first) as GameState;
    first.players[1].hand = [createInstance('test-character-4'), createInstance('test-character-5')];
    second.players[1].hand = [createInstance('test-direct-damage'), createInstance('test-expensive-character')];

    const firstKnowledge = createAIKnowledgeState(first, 0);
    const secondKnowledge = createAIKnowledgeState(second, 0);
    expect(firstKnowledge.game.players[1].hand.map((card) => card.defId)).toEqual(['__hidden__', '__hidden__']);
    expect(secondKnowledge.game.players[1].hand.map((card) => card.defId)).toEqual(['__hidden__', '__hidden__']);
    expect(aiPlanTurn(first, 0, 'hard', { seed: 'hidden-invariant' }).action).toEqual(
      aiPlanTurn(second, 0, 'hard', { seed: 'hidden-invariant' }).action,
    );
  });

  it('preserves one opaque identity across an opponent zone and the played-card list', () => {
    const G = makeGWithHand(['test-character-1']);
    const hidden = createInstance('test-direct-damage');
    G.players[1].setZoneA = hidden;
    G.players[1].cardsSetThisTurn = 1;
    G.setCardsThisTurn[1] = [hidden];

    const knowledge = createAIKnowledgeState(G, 0);
    expect(knowledge.game.players[1].setZoneA?.defId).toBe('__hidden__');
    expect(knowledge.game.players[1].setZoneA?.instanceId).toBe(knowledge.game.setCardsThisTurn[1][0].instanceId);
  });

  it('samples unknown cards deterministically without observing their authoritative definitions', () => {
    const first = makeGWithHand(['test-character-1', 'test-character-2']);
    const hidden = createInstance('test-direct-damage');
    first.players[1].setZoneA = hidden;
    first.players[1].cardsSetThisTurn = 1;
    first.setCardsThisTurn[1] = [hidden];
    const second = structuredClone(first) as GameState;
    second.players[1].setZoneA!.defId = 'test-expensive-character';
    second.setCardsThisTurn[1][0].defId = 'test-expensive-character';

    const firstKnowledge = createAIKnowledgeState(first, 0);
    const secondKnowledge = createAIKnowledgeState(second, 0);
    const firstSample = sampleUnknownState(firstKnowledge, 'sample-seed', 0);
    const repeatedSample = sampleUnknownState(firstKnowledge, 'sample-seed', 0);
    const replacedSample = sampleUnknownState(secondKnowledge, 'sample-seed', 0);

    expect(firstKnowledge.visibleStateKey).toBe(secondKnowledge.visibleStateKey);
    expect(firstSample.game.players[1].setZoneA?.defId).toBe(repeatedSample.game.players[1].setZoneA?.defId);
    expect(firstSample.game.players[1].setZoneA?.defId).toBe(replacedSample.game.players[1].setZoneA?.defId);
    expect(firstSample.game.players[1].setZoneA?.instanceId).toBe(firstSample.game.setCardsThisTurn[1][0].instanceId);
    expect(firstSample.game.players[1].setZoneA?.defId).toBe(firstSample.game.setCardsThisTurn[1][0].defId);
  });

  it('resolves a sampled legal opponent response when the opponent has not committed', () => {
    const G = makeGWithHand(['test-character-1', 'test-character-2']);
    const knowledge = createAIKnowledgeState(G, 0);
    const sampled = sampleUnknownState(knowledge, 'opponent-response', 0);
    const ownPlan = generateTurnPlans(knowledge)[0];
    const opponentKnowledge = {
      ...sampled,
      player: 1 as const,
      opponent: 0 as const,
      knownOwnDeckDefIds: sampled.game.players[1].deck.map((card) => card.defId).sort(),
    };
    const opponentPlan = generateTurnPlans(opponentKnowledge)[0];
    const simulation = simulateTurnPlan(
      sampled,
      ownPlan,
      createDecisionContext('hard', 'opponent-response', { seed: 'opponent-response', budgetMs: 1_000 }),
      opponentPlan,
    );

    expect(opponentPlan).toHaveLength(1);
    expect(simulation?.completedTurn).toBe(true);
    expect(simulation?.state.turnNumber).toBeGreaterThan(G.turnNumber);
  });

  it('destroys own deck order before sampling and hard decisions', () => {
    const first = makeGWithHand(['test-character-1', 'test-character-2']);
    first.players[0].deck = [
      createInstance('test-character-3'),
      createInstance('test-enchant-1'),
      createInstance('test-character-4'),
    ];
    const second = structuredClone(first) as GameState;
    second.players[0].deck.reverse();
    const firstKnowledge = createAIKnowledgeState(first, 0);
    const secondKnowledge = createAIKnowledgeState(second, 0);

    expect(firstKnowledge.knownOwnDeckDefIds).toEqual(secondKnowledge.knownOwnDeckDefIds);
    expect(firstKnowledge.visibleStateKey).toBe(secondKnowledge.visibleStateKey);
    expect(sampleUnknownState(firstKnowledge, 'deck-order', 0).game.players[0].deck.map((card) => card.defId)).toEqual(
      sampleUnknownState(secondKnowledge, 'deck-order', 0).game.players[0].deck.map((card) => card.defId),
    );
    expect(aiPlanTurn(first, 0, 'hard', { seed: 'deck-order' }).action).toEqual(
      aiPlanTurn(second, 0, 'hard', { seed: 'deck-order' }).action,
    );
  });

  it('uses a hidden-information-safe transposition key and stable numeric cache value', () => {
    clearPlanEvaluationCache();
    const first = makeGWithHand(['test-character-1']);
    const hidden = createInstance('test-character-2');
    first.players[1].setZoneA = hidden;
    first.setCardsThisTurn[1] = [hidden];
    const second = structuredClone(first) as GameState;
    second.players[1].setZoneA!.defId = 'test-direct-damage';
    second.setCardsThisTurn[1][0].defId = 'test-direct-damage';
    const firstKey = planEvaluationCacheKey(createAIKnowledgeState(first, 0).visibleStateKey, 'plan', 'seed', 3);
    const secondKey = planEvaluationCacheKey(createAIKnowledgeState(second, 0).visibleStateKey, 'plan', 'seed', 3);

    expect(firstKey).toBe(secondKey);
    setCachedPlanEvaluation(firstKey, 42.5);
    expect(getCachedPlanEvaluation(secondKey)).toBe(42.5);
    expect(getCachedPlanEvaluation(firstKey)).toBe(42.5);
  });

  it('normal and hard redraw an opening with no Character', () => {
    const G = setupTestGame();
    G.step = 'mulligan';
    G.players[0].hand = Array.from({ length: 5 }, (_, index) => createInstance(`test-enchant-${index + 1}`));
    expect(aiSelectMulligan(G, 0, 'normal', { seed: 1 }).action.length).toBeGreaterThan(0);
    expect(aiSelectMulligan(G, 0, 'hard', { seed: 1 }).action.length).toBeGreaterThan(0);
  });

  it('keeps a strong and immediately playable Character opening', () => {
    const G = setupTestGame();
    G.step = 'mulligan';
    G.players[0].hand = Array.from({ length: 5 }, (_, index) => createInstance(`test-character-${index + 1}`));
    expect(aiSelectMulligan(G, 0, 'normal', { seed: 1 }).action).toEqual([]);
    expect(aiSelectMulligan(G, 0, 'hard', { seed: 1 }).action).toEqual([]);
  });

  it('uses sampled remaining-deck quality for hard mulligan decisions', () => {
    const makeMulliganState = (deckDefIds: string[]): GameState => {
      const G = setupTestGame();
      G.step = 'mulligan';
      G.players[0].hand = Array.from({ length: 5 }, (_, index) => createInstance(`test-enchant-${index + 1}`));
      G.players[0].deck = deckDefIds.map((defId) => createInstance(defId));
      G.players[0].knownDeckDefIds = [...deckDefIds];
      return G;
    };
    const playableDeck = Array.from({ length: 8 }, (_, index) => `test-character-${index + 6}`);
    const unplayableDeck = ['test-enchant-6', 'test-enchant-7', 'test-enchant-8', 'test-enchant-6', 'test-enchant-7'];

    expect(aiSelectMulligan(makeMulliganState(playableDeck), 0, 'hard', { seed: 'deck-aware' }).action.length).toBe(1);
    expect(aiSelectMulligan(makeMulliganState(unplayableDeck), 0, 'hard', { seed: 'deck-aware' }).action).toEqual([]);
  });

  it('does not score unaffordable effects as if they could resolve', () => {
    const G = makeGWithHand([
      'test-unaffordable-damage',
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-character-4',
    ]);
    for (const difficulty of ['normal', 'hard'] as const) {
      const decision = aiPlanTurn(G, 0, difficulty, { seed: `unaffordable:${difficulty}` });
      const selected = G.players[0].hand[decision.action.selections[0].handIndex];
      expect(selected.defId).not.toBe('test-unaffordable-damage');
    }
  });

  it('scores Character effects when cost reduction makes the card affordable', () => {
    const G = makeGWithHand([
      'test-unaffordable-damage',
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-character-4',
    ]);
    G.modifiers.powerCostReduction[0] = 99;

    for (const difficulty of ['normal', 'hard'] as const) {
      const decision = aiPlanTurn(G, 0, difficulty, { seed: `cost-reduction:${difficulty}` });
      const selected = G.players[0].hand[decision.action.selections[0].handIndex];
      expect(selected.defId).toBe('test-unaffordable-damage');
    }
  });

  it('prioritizes lethal direct damage over healing at full HP', () => {
    const G = setupTestGame();
    G.step = 'effectOrder';
    G.players[0].hp = 100;
    G.players[1].hp = 20;
    G.pendingEffectPlayer = 0;
    G.pendingEffects[0] = [
      {
        id: 'heal',
        player: 0,
        cardInstanceId: 'heal-card',
        cardDefId: 'test-character-1',
        rawText: 'heal',
        effect: {
          trigger: 'onUse',
          conditions: [],
          action: { type: 'heal', params: { value: 30 } },
          rawText: 'heal',
        },
        source: 'played',
      },
      {
        id: 'lethal',
        player: 0,
        cardInstanceId: 'damage-card',
        cardDefId: 'test-direct-damage',
        rawText: 'damage',
        effect: {
          trigger: 'onUse',
          conditions: [],
          action: { type: 'directDamage', params: { value: 30 } },
          rawText: 'damage',
        },
        source: 'played',
      },
    ];

    const decision = aiSelectEffect(G, 0, 'normal');
    expect(decision?.action).toBe(1);
    expect(decision?.reason).toBe('prioritize-directDamage');
    expect(aiSelectEffect(G, 0, 'hard')?.factors.some((factor) => factor.label === 'simulatedContinuation')).toBe(true);
  });

  it('prioritizes useful healing when HP is low', () => {
    const G = setupTestGame();
    G.step = 'effectOrder';
    G.players[0].hp = 20;
    G.pendingEffectPlayer = 0;
    G.pendingEffects[0] = [
      {
        id: 'clock',
        player: 0,
        cardInstanceId: 'clock-card',
        cardDefId: 'test-character-1',
        rawText: 'clock',
        effect: {
          trigger: 'onUse',
          conditions: [],
          action: { type: 'clockAdvance', params: { value: 1 } },
          rawText: 'clock',
        },
        source: 'played',
      },
      {
        id: 'heal',
        player: 0,
        cardInstanceId: 'heal-card',
        cardDefId: 'test-character-1',
        rawText: 'heal',
        effect: {
          trigger: 'onUse',
          conditions: [],
          action: { type: 'heal', params: { value: 30 } },
          rawText: 'heal',
        },
        source: 'played',
      },
    ];

    expect(aiSelectEffect(G, 0, 'normal')?.action).toBe(1);
  });

  it('chooses the lower-value discard instead of the first option', () => {
    const G = setupTestGame();
    const strong = createInstance('test-character-1');
    const weak = createInstance('test-expensive-character');
    G.players[0].hand = [strong, weak];
    G.step = 'effectOrder';
    G.pendingChoice = {
      id: 'discard-one',
      player: 0,
      type: 'optionalHandMoveThenDraw',
      min: 1,
      max: 1,
      payload: {
        sourcePlayer: 0,
        sourceZone: 'hand',
        destinationPlayer: 0,
        destinationZone: 'abyss',
        drawCount: 1,
        filter: {},
      },
      options: [
        { id: strong.instanceId, label: 'strong', cardDefId: strong.defId },
        { id: weak.instanceId, label: 'weak', cardDefId: weak.defId },
      ],
    };

    expect(aiSelectPendingChoice(G, 0, 'normal')?.action).toEqual([weak.instanceId]);
  });

  it('declines an optional discard when replacing a strong card has negative value', () => {
    const G = setupTestGame();
    const strong = createInstance('test-character-1');
    G.players[0].hand = [strong];
    G.step = 'effectOrder';
    G.pendingChoice = {
      id: 'optional-discard',
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
      options: [{ id: strong.instanceId, label: 'strong', cardDefId: strong.defId }],
    };

    expect(aiSelectPendingChoice(G, 0, 'normal')?.action).toEqual([]);
  });

  it('swaps a weak hand card for a stronger Abyss card', () => {
    const G = setupTestGame();
    const weak = createInstance('test-expensive-character');
    const strong = createInstance('test-character-1');
    G.players[0].hand = [weak];
    G.players[0].abyss = [strong];
    G.step = 'effectOrder';
    G.pendingChoice = {
      id: 'hand-abyss-swap',
      player: 0,
      type: 'handAbyssSwap',
      min: 2,
      max: 2,
      payload: {},
      options: [
        { id: `hand:${weak.instanceId}`, label: 'weak', cardDefId: weak.defId },
        { id: `abyss:${strong.instanceId}`, label: 'strong', cardDefId: strong.defId },
      ],
    };

    expect(aiSelectPendingChoice(G, 0, 'normal')?.action).toEqual([
      `hand:${weak.instanceId}`,
      `abyss:${strong.instanceId}`,
    ]);
  });

  it('uses the highest-value legal card from the Abyss', () => {
    const G = setupTestGame();
    G.players[0].abyss = [
      { instanceId: 'weak', defId: 'test-expensive-character', faceUp: true },
      { instanceId: 'strong', defId: 'test-character-1', faceUp: true },
    ];
    G.step = 'effectOrder';
    G.pendingChoice = {
      id: 'use-from-abyss',
      player: 0,
      type: 'useFromAbyss',
      min: 1,
      max: 1,
      payload: { sourcePlayer: 0, cardType: 'Character' },
      options: [
        { id: 'weak', label: 'weak', cardInstanceId: 'weak', cardDefId: 'test-expensive-character' },
        { id: 'strong', label: 'strong', cardInstanceId: 'strong', cardDefId: 'test-character-1' },
      ],
    };

    expect(aiSelectPendingChoice(G, 0, 'normal')?.action).toEqual(['strong']);
  });

  it('chooses a Chronos position that favors its current Character', () => {
    const G = setupTestGame();
    G.players[0].battleZone = createInstance('test-day-character', true);
    G.players[1].battleZone = createInstance('test-night-character', true);
    G.step = 'effectOrder';
    G.pendingChoice = {
      id: 'clock-position',
      player: 0,
      type: 'clockPosition',
      min: 1,
      max: 1,
      payload: {},
      options: Array.from({ length: 18 }, (_, value) => ({ id: `clock-${value}`, label: `${value}`, value })),
    };

    const selected = aiSelectPendingChoice(G, 0, 'normal')?.action[0];
    expect(Number(selected?.split('-')[1])).toBeGreaterThanOrEqual(5);
    expect(Number(selected?.split('-')[1])).toBeLessThanOrEqual(13);
  });

  it('orders weaker cards first on top of the opponent deck', () => {
    const G = setupTestGame();
    G.players[1].deck = [
      { instanceId: 'strong', defId: 'test-character-1', faceUp: false },
      { instanceId: 'weak', defId: 'test-expensive-character', faceUp: false },
    ];
    G.step = 'effectOrder';
    G.pendingChoice = {
      id: 'reorder-opponent',
      player: 0,
      type: 'reorderOpponentDeckTop',
      min: 2,
      max: 2,
      payload: { targetPlayer: 1, count: 2 },
      options: [
        { id: 'strong', label: 'strong', cardInstanceId: 'strong', cardDefId: 'test-character-1' },
        { id: 'weak', label: 'weak', cardInstanceId: 'weak', cardDefId: 'test-expensive-character' },
      ],
    };

    expect(aiSelectPendingChoice(G, 0, 'normal')?.action).toEqual(['weak', 'strong']);
  });

  it('returns a legal normal-policy fallback when hard search exceeds its budget', () => {
    const G = makeGWithHand([
      'test-character-1',
      'test-character-2',
      'test-character-3',
      'test-enchant-1',
      'test-enchant-2',
    ]);
    let time = 0;
    const decision = aiPlanTurn(G, 0, 'hard', { budgetMs: 1, now: () => (time += 2) });
    expect(decision.action.selections).toHaveLength(1);
    expect(decision.fallback).toBe('search-budget-exhausted');
  });
});
