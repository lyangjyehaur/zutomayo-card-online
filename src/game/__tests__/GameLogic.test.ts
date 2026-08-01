import { describe, it, expect, vi } from 'vitest';
import { initCards, isCardsInitialized, getAllCardDefs, createInstance } from '../cards/loader';
import { parseAllEffects, parseEffect } from '../effects/parser';
import { collectTurnEffects } from '../effects/executor';
import { ZutomayoCard } from '../Game';
import { CHRONOS_MAPPING, type CardDef, type CardType, type GameState, type PendingEffect } from '../types';
import {
  setupGame,
  validateZutomayoSetupData,
  resolveJanken,
  chooseJanken,
  finishMulligan,
  setInitialCard,
  setTurnCard,
  undoSetCard,
  confirmReady,
  timeoutSkip,
  getMinimumSetCount,
  getResolvablePendingEffectIndexes,
  getRequiredSetCount,
  getPlayerPower,
  getEffectiveAttack,
  resolveBattle,
  resolveTimingEvent,
  advanceChronos,
  resolvePendingEffect,
  submitPendingChoice,
  getEffectiveElement,
  getChronosTime,
  getPriorityPlayer,
  endGame,
  surrenderGame,
  emptyModifiers,
  TURN_TIMER_MS,
} from '../GameLogic';

describe('getResolvablePendingEffectIndexes', () => {
  function pendingEffect(id: string, cardInstanceId: string, priority?: 'late'): PendingEffect {
    return {
      id,
      player: 0,
      cardInstanceId,
      cardDefId: 'test-character-1',
      rawText: id,
      effect: {
        trigger: 'onUse',
        conditions: [],
        action: { type: 'boostAttack', params: { value: 10 } },
        rawText: id,
        ...(priority ? { priority } : {}),
      },
      source: 'battleZone',
    };
  }

  it('offers only the first normal effect from each card', () => {
    const G = setupGame();
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 0;
    G.pendingEffects = [
      [
        pendingEffect('card-a-1', 'card-a'),
        pendingEffect('card-a-2', 'card-a'),
        pendingEffect('card-b-1', 'card-b'),
        pendingEffect('card-c-late', 'card-c', 'late'),
      ],
      [],
    ];

    expect(getResolvablePendingEffectIndexes(G, 0)).toEqual([0, 2]);
    expect(getResolvablePendingEffectIndexes(G, 1)).toEqual([]);
  });

  it('offers late effects after all normal effects are gone', () => {
    const G = setupGame();
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 0;
    G.pendingEffects = [
      [pendingEffect('card-a-late-1', 'card-a', 'late'), pendingEffect('card-a-late-2', 'card-a', 'late')],
      [],
    ];

    expect(getResolvablePendingEffectIndexes(G, 0)).toEqual([0]);
  });

  it('records an order decision only when multiple effects are legally selectable', () => {
    const singleton = setupGame();
    singleton.step = 'effectOrder';
    singleton.pendingEffectPlayer = 0;
    singleton.pendingEffects = [[pendingEffect('only-effect', 'card-a')], []];

    expect(resolvePendingEffect(singleton, 0, 0)).toBe(true);
    expect(singleton.actionLog.some((entry) => entry.action === 'chooseEffectOrder')).toBe(false);

    const multiple = setupGame();
    multiple.step = 'effectOrder';
    multiple.pendingEffectPlayer = 0;
    multiple.pendingEffects = [[pendingEffect('first-effect', 'card-a'), pendingEffect('second-effect', 'card-b')], []];

    expect(resolvePendingEffect(multiple, 0, 1)).toBe(true);
    expect(multiple.actionLog.some((entry) => entry.action === 'chooseEffectOrder')).toBe(true);
  });
});

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

function testCardDefs(): CardDef[] {
  return [
    ...Array.from({ length: 15 }, (_, i) => makeCard(`test-character-${i + 1}`, 'Character')),
    makeCard('test-character-power-hungry', 'Character', {
      attack: { night: 130, day: 130 },
      powerCost: 5,
    }),
    ...Array.from({ length: 8 }, (_, i) => makeCard(`test-enchant-${i + 1}`, 'Enchant')),
    ...Array.from({ length: 2 }, (_, i) => makeCard(`test-area-enchant-${i + 1}`, 'Area Enchant')),
  ];
}

if (!isCardsInitialized()) {
  initCards(testCardDefs());
}

const parsedEffects = parseAllEffects(getAllCardDefs().map((card) => ({ id: card.id, effect: card.effect })));

// ===== Helpers =====

function progressToMulligan(G: GameState): void {
  chooseJanken(G, 0, 'rock');
  chooseJanken(G, 1, 'scissors');
}

function progressToInitialSet(G: GameState): void {
  progressToMulligan(G);
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

// ===== Tests =====

describe('setupGame', () => {
  it('initializes game state with default values', () => {
    const G = setupGame();
    expect(G.step).toBe('janken');
    expect(G.players[0].hp).toBe(100);
    expect(G.players[1].hp).toBe(100);
    expect(G.players[0].hand).toHaveLength(5);
    expect(G.players[1].hand).toHaveLength(5);
    expect(G.players[0].deck.length + G.players[0].hand.length).toBeGreaterThanOrEqual(20);
    expect(G.turnNumber).toBe(1);
    expect(G.chronos.position).toBe(0);
    expect(G.winner).toBeNull();
  });

  it('respects skipShuffle when allowed, preserving deck order', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `test-character-${(i % 15) + 1}`);
    const G = setupGame({ deck0Ids: ids, skipShuffle: true }, { allowSkipShuffle: true });
    expect(G.tutorialSkipShuffle).toBe(true);
    // First 5 cards drawn into hand should match first 5 ids.
    expect(G.players[0].hand.map((c) => c.defId)).toEqual(ids.slice(0, 5));
  });

  it('shuffles by default (skipShuffle false)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `test-character-${(i % 15) + 1}`);
    const G = setupGame({ deck0Ids: ids });
    expect(G.tutorialSkipShuffle).toBe(false);
  });

  it('reconstructs identical opening state and card identities from the same seed and decks', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `test-character-${(i % 15) + 1}`);
    const first = setupGame({ deck0Ids: ids, deck1Ids: [...ids].reverse(), rngSeed: 'same-match' });
    createInstance('test-enchant-1');
    const second = setupGame({ deck0Ids: ids, deck1Ids: [...ids].reverse(), rngSeed: 'same-match' });

    expect(second.replayManifest).toEqual(first.replayManifest);
    expect(second.players).toEqual(first.players);
    expect(second.rng).toEqual(first.rng);
  });

  it('uses different opening orders for different seeds', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `test-character-${(i % 15) + 1}`);
    const first = setupGame({ deck0Ids: ids, deck1Ids: ids, rngSeed: 1 });
    const second = setupGame({ deck0Ids: ids, deck1Ids: ids, rngSeed: 2 });

    expect(second.players[0]).not.toEqual(first.players[0]);
  });

  it('records exact pre-shuffle decks and rules version without global Math.random', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `test-character-${(i % 15) + 1}`);
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('rules randomness must not use Math.random');
    });
    try {
      const G = setupGame({ deck0Ids: ids, deck1Ids: [...ids].reverse(), rngSeed: 55, rulesVersion: 'rules-test' });
      expect(G.replayManifest).toEqual({
        schemaVersion: 1,
        rngAlgorithm: 'mulberry32-v1',
        seed: 55,
        rulesVersion: 'rules-test',
        deckDefIds: [ids, [...ids].reverse()],
      });
    } finally {
      random.mockRestore();
    }
  });

  it('replays effect-driven card shuffles from persisted RNG state', () => {
    const makeState = () => {
      const G = setupGame({ rngSeed: 8080 });
      G.players[0].deck = [];
      G.players[0].abyss = Array.from({ length: 8 }, (_, index) => ({
        instanceId: `payment-${index}`,
        defId: `test-enchant-${index + 1}`,
        faceUp: true,
      }));
      G.pendingChoice = {
        id: 'shuffle-payment',
        player: 0,
        type: 'abyssToDeckBottomOrLose',
        min: 8,
        max: 8,
        payload: { faceDown: true, shuffle: true },
        options: G.players[0].abyss.map((card) => ({
          id: card.instanceId,
          label: card.defId,
          cardInstanceId: card.instanceId,
        })),
      };
      return G;
    };
    const first = makeState();
    const second = makeState();
    const optionIds = first.pendingChoice!.options.map((option) => option.id);

    expect(submitPendingChoice(first, 0, optionIds)).toBe(true);
    expect(submitPendingChoice(second, 0, optionIds)).toBe(true);
    expect(second.players[0].deck).toEqual(first.players[0].deck);
    expect(second.rng).toEqual(first.rng);
  });
});

describe('validateZutomayoSetupData', () => {
  it('returns undefined for empty setupData', () => {
    expect(validateZutomayoSetupData(undefined)).toBeUndefined();
  });

  it('rejects skipShuffle by default', () => {
    expect(validateZutomayoSetupData({ skipShuffle: true })).toBe('skipShuffle is not allowed in this game mode');
  });

  it('allows skipShuffle when allowSkipShuffle is true', () => {
    expect(validateZutomayoSetupData({ skipShuffle: true }, { allowSkipShuffle: true })).toBeUndefined();
  });

  it('rejects custom deck name without IDs', () => {
    const result = validateZutomayoSetupData({ deck0Name: 'custom' });
    expect(result).toContain('custom deck requires deck IDs');
  });

  it('allows custom deck name when allowBrowserCustomDeckName is true', () => {
    expect(validateZutomayoSetupData({ deck0Name: 'custom' }, { allowBrowserCustomDeckName: true })).toBeUndefined();
  });

  it('rejects invalid custom deck IDs', () => {
    const result = validateZutomayoSetupData({ deck0Ids: ['only-one'] });
    expect(result).toContain('custom deck invalid');
  });

  it('accepts valid custom deck IDs', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `test-character-${(i % 15) + 1}`);
    expect(validateZutomayoSetupData({ deck0Ids: ids, deck1Ids: ids })).toBeUndefined();
  });

  it('rejects invalid deterministic seeds', () => {
    expect(validateZutomayoSetupData({ rngSeed: Number.NaN })).toContain('rngSeed');
    expect(validateZutomayoSetupData({ rngSeed: '' })).toContain('rngSeed');
  });
});

describe('janken', () => {
  it('resolveJanken determines winner correctly', () => {
    const G = setupGame();
    const result = resolveJanken(G, 'rock', 'scissors');
    expect(result.winner).toBe(0);
    expect(G.step).toBe('mulligan');
    expect(G.chronos.nightSidePlayer).toBe(0);
  });

  it('resolveJanken handles draws by incrementing draw count', () => {
    const G = setupGame();
    const result = resolveJanken(G, 'rock', 'rock');
    expect(result.winner).toBeNull();
    expect(G.jankenDrawCount).toBe(1);
    expect(G.jankenChoices).toEqual([null, null]);
    expect(G.step).toBe('janken');
  });

  it('chooseJanken accepts choice and resolves when both chosen', () => {
    const G = setupGame();
    expect(chooseJanken(G, 0, 'paper')).toBe(true);
    expect(G.jankenChoices[0]).toBe('paper');
    expect(G.step).toBe('janken');
    expect(chooseJanken(G, 1, 'rock')).toBe(true);
    // paper beats rock → player 0 wins
    expect(G.step).toBe('mulligan');
    expect(G.chronos.nightSidePlayer).toBe(0);
  });

  it('chooseJanken rejects double choice', () => {
    const G = setupGame();
    chooseJanken(G, 0, 'rock');
    expect(chooseJanken(G, 0, 'paper')).toBe(false);
    expect(G.jankenChoices[0]).toBe('rock');
  });

  it('chooseJanken rejects when not in janken step', () => {
    const G = setupGame();
    G.step = 'mulligan';
    expect(chooseJanken(G, 0, 'rock')).toBe(false);
  });
});

describe('mulligan', () => {
  it('finishMulligan keeps hand when indices empty', () => {
    const G = setupGame();
    progressToMulligan(G);
    const handBefore = [...G.players[0].hand];
    expect(finishMulligan(G, 0, [])).toBe(true);
    expect(G.mulliganUsed[0]).toBe(true);
    expect(G.ready[0]).toBe(true);
    expect(G.players[0].hand.map((c) => c.defId)).toEqual(handBefore.map((c) => c.defId));
  });

  it('finishMulligan redraws selected indices', () => {
    const G = setupGame();
    progressToMulligan(G);
    const handSizeBefore = G.players[0].hand.length;
    expect(finishMulligan(G, 0, [0, 1])).toBe(true);
    expect(G.players[0].hand).toHaveLength(handSizeBefore);
    expect(G.mulliganUsed[0]).toBe(true);
  });

  it('finishMulligan rejects when already used', () => {
    const G = setupGame();
    progressToMulligan(G);
    finishMulligan(G, 0, []);
    expect(finishMulligan(G, 0, [0])).toBe(false);
  });

  it('finishMulligan rejects when not in mulligan step', () => {
    const G = setupGame();
    expect(finishMulligan(G, 0, [])).toBe(false);
  });

  it('both players finishing mulligan advances to initialSet', () => {
    const G = setupGame();
    progressToMulligan(G);
    finishMulligan(G, 0, []);
    expect(G.step).toBe('mulligan');
    finishMulligan(G, 1, []);
    expect(G.step).toBe('initialSet');
    expect(G.ready).toEqual([false, false]);
  });
});

describe('setInitialCard', () => {
  it('sets a card to battleZone in initialSet step', () => {
    const G = setupGame();
    progressToInitialSet(G);
    expect(setInitialCard(G, 0, 0)).toBe(true);
    expect(G.players[0].battleZone).not.toBeNull();
    expect(G.players[0].hand).toHaveLength(4);
    expect(G.players[0].cardsSetThisTurn).toBe(1);
  });

  it('rejects when not in initialSet step', () => {
    const G = setupGame();
    expect(setInitialCard(G, 0, 0)).toBe(false);
  });

  it('rejects when player already ready', () => {
    const G = setupGame();
    progressToInitialSet(G);
    setInitialCard(G, 0, 0);
    confirmReady(G, 0, parsedEffects);
    expect(setInitialCard(G, 0, 0)).toBe(false);
  });

  it('rejects out-of-range hand index', () => {
    const G = setupGame();
    progressToInitialSet(G);
    expect(setInitialCard(G, 0, 99)).toBe(false);
  });

  it('rejects setting a second card when one already in battleZone', () => {
    const G = setupGame();
    progressToInitialSet(G);
    setInitialCard(G, 0, 0);
    expect(setInitialCard(G, 0, 1)).toBe(false);
  });
});

describe('setTurnCard and undoSetCard', () => {
  it('setTurnCard places card in setZoneA', () => {
    const G = setupGame();
    progressToTurnSet(G);
    expect(G.step).toBe('turnSet');
    expect(setTurnCard(G, 0, 0, 'A')).toBe(true);
    expect(G.players[0].setZoneA).not.toBeNull();
    expect(G.players[0].hand).toHaveLength(4);
  });

  it('setTurnCard places card in setZoneB', () => {
    const G = setupGame();
    progressToTurnSet(G);
    expect(setTurnCard(G, 0, 0, 'B')).toBe(true);
    expect(G.players[0].setZoneB).not.toBeNull();
  });

  it('setTurnCard rejects slot C', () => {
    const G = setupGame();
    progressToTurnSet(G);
    expect(setTurnCard(G, 0, 0, 'C')).toBe(false);
  });

  it('setTurnCard rejects slot B in initialSet step', () => {
    const G = setupGame();
    progressToInitialSet(G);
    expect(setTurnCard(G, 0, 0, 'B')).toBe(false);
  });

  it('setTurnCard rejects when slot occupied', () => {
    const G = setupGame();
    progressToTurnSet(G);
    setTurnCard(G, 0, 0, 'A');
    expect(setTurnCard(G, 0, 1, 'A')).toBe(false);
  });

  it('setTurnCard rejects when not in turnSet step', () => {
    const G = setupGame();
    expect(setTurnCard(G, 0, 0, 'A')).toBe(false);
  });

  it('undoSetCard returns card to hand in initialSet', () => {
    const G = setupGame();
    progressToInitialSet(G);
    setInitialCard(G, 0, 0);
    const handLen = G.players[0].hand.length;
    expect(undoSetCard(G, 0, 'A')).toBe(true);
    expect(G.players[0].battleZone).toBeNull();
    expect(G.players[0].hand).toHaveLength(handLen + 1);
  });

  it('undoSetCard returns setZoneA card in turnSet', () => {
    const G = setupGame();
    progressToTurnSet(G);
    setTurnCard(G, 0, 0, 'A');
    const handLen = G.players[0].hand.length;
    expect(undoSetCard(G, 0, 'A')).toBe(true);
    expect(G.players[0].setZoneA).toBeNull();
    expect(G.players[0].hand).toHaveLength(handLen + 1);
  });

  it('undoSetCard rejects when zone empty', () => {
    const G = setupGame();
    progressToTurnSet(G);
    expect(undoSetCard(G, 0, 'A')).toBe(false);
  });

  it('undoSetCard rejects when player already ready', () => {
    const G = setupGame();
    progressToTurnSet(G);
    setTurnCard(G, 0, 0, 'A');
    confirmReady(G, 0, parsedEffects);
    expect(undoSetCard(G, 0, 'A')).toBe(false);
  });
});

describe('getRequiredSetCount and getMinimumSetCount', () => {
  it('getMinimumSetCount always returns 1', () => {
    const G = setupGame();
    expect(getMinimumSetCount(G, 0)).toBe(1);
    expect(getMinimumSetCount(G, 1)).toBe(1);
  });

  it('getRequiredSetCount returns 1 in initialSet', () => {
    const G = setupGame();
    progressToInitialSet(G);
    expect(getRequiredSetCount(G, 0)).toBe(1);
  });

  it('getRequiredSetCount returns 2 for loser after first battle', () => {
    const G = setupGame();
    progressToTurnSet(G);
    G.lastBattleResult = { winner: 0, damage: 10, winnerAttack: 30, loserAttack: 20 };
    expect(getRequiredSetCount(G, 0)).toBe(1);
    expect(getRequiredSetCount(G, 1)).toBe(2);
  });

  it('getRequiredSetCount respects extraSettableCards modifier', () => {
    const G = setupGame();
    progressToTurnSet(G);
    // Reset battle result to isolate extraSettableCards effect
    G.lastBattleResult = { winner: null, damage: 0, winnerAttack: 0, loserAttack: 0 };
    G.modifiers.extraSettableCards = [1, 0];
    expect(getRequiredSetCount(G, 0)).toBe(2);
    expect(getRequiredSetCount(G, 1)).toBe(1);
  });
});

describe('confirmReady', () => {
  it('rejects when below minimum set count', () => {
    const G = setupGame();
    progressToInitialSet(G);
    expect(confirmReady(G, 0, parsedEffects)).toBe(false);
  });

  it('accepts when minimum met in initialSet', () => {
    const G = setupGame();
    progressToInitialSet(G);
    setInitialCard(G, 0, 0);
    expect(confirmReady(G, 0, parsedEffects)).toBe(true);
    expect(G.ready[0]).toBe(true);
  });

  it('both ready triggers resolveTurn and advances to turnSet', () => {
    const G = setupGame();
    progressToInitialSet(G);
    setInitialCard(G, 0, 0);
    setInitialCard(G, 1, 0);
    confirmReady(G, 0, parsedEffects);
    confirmReady(G, 1, parsedEffects);
    expect(G.turnNumber).toBe(2);
  });

  it('records per-card clock contributions for battlefield resolution feedback', () => {
    const G = setupGame();
    progressToInitialSet(G);
    setInitialCard(G, 0, 0);
    setInitialCard(G, 1, 0);
    const playerCard = G.players[0].battleZone;
    const opponentCard = G.players[1].battleZone;
    expect(playerCard).not.toBeNull();
    expect(opponentCard).not.toBeNull();

    confirmReady(G, 0, parsedEffects);
    confirmReady(G, 1, parsedEffects);

    const notice = [...G.recentGameNotices]
      .reverse()
      .find((item) => item.kind === 'chronosChange' && item.chronosSourceKind === 'turnAdvance');
    expect(notice?.chronosAdvanceAmount).toBe(2);
    expect(notice?.chronosContributions).toEqual([
      expect.objectContaining({
        player: 0,
        cardInstanceId: playerCard?.instanceId,
        appliedValue: 1,
        nullified: false,
      }),
      expect.objectContaining({
        player: 1,
        cardInstanceId: opponentCard?.instanceId,
        appliedValue: 1,
        nullified: false,
      }),
    ]);
  });

  it('rejects when already ready', () => {
    const G = setupGame();
    progressToInitialSet(G);
    setInitialCard(G, 0, 0);
    confirmReady(G, 0, parsedEffects);
    expect(confirmReady(G, 0, parsedEffects)).toBe(false);
  });
});

describe('timeoutSkip', () => {
  it('rejects when timer has not elapsed', () => {
    const G = setupGame();
    progressToTurnSet(G);
    G.turnStartTime = Date.now();
    expect(timeoutSkip(G, 0, parsedEffects)).toBe(false);
  });

  it('auto-sets one legal card before forcing ready when timer elapsed', () => {
    const G = setupGame();
    progressToTurnSet(G);
    G.turnStartTime = Date.now() - (TURN_TIMER_MS + 1000);
    expect(timeoutSkip(G, 0, parsedEffects)).toBe(true);
    expect(G.ready[0]).toBe(true);
    expect(G.players[0].cardsSetThisTurn).toBe(1);
    expect(G.players[0].setZoneA).not.toBeNull();
    expect(
      G.actionLog.some(
        (entry) => entry.action === 'timeoutSkip' && entry.player === 0 && entry.payload?.autoSet === true,
      ),
    ).toBe(true);
  });

  it('ends the game instead of confirming zero cards when no legal card is available', () => {
    const G = setupGame();
    progressToTurnSet(G);
    G.players[0].hand = [];
    G.turnStartTime = Date.now() - (TURN_TIMER_MS + 1000);
    expect(timeoutSkip(G, 0, parsedEffects)).toBe(true);
    expect(G.step).toBe('gameOver');
    expect(G.winner).toBe(1);
    expect(G.ready[0]).toBe(true);
    expect(G.gameoverReason).toContain('timeout with no legal card available to set');
  });

  it('rejects when not in turnSet step', () => {
    const G = setupGame();
    G.turnStartTime = Date.now() - (TURN_TIMER_MS + 1000);
    expect(timeoutSkip(G, 0, parsedEffects)).toBe(false);
  });
});

describe('getPlayerPower and getEffectiveAttack', () => {
  it('getPlayerPower returns 0 with empty powerCharger', () => {
    const G = setupGame();
    expect(getPlayerPower(G.players[0])).toBe(0);
  });

  it('getPlayerPower sums powerCharger sendToPower values', () => {
    const G = setupGame();
    const card1 = createInstance('test-character-1');
    const card2 = createInstance('test-character-2');
    G.players[0].powerCharger = [card1, card2];
    // test cards have sendToPower 0 by default
    expect(getPlayerPower(G.players[0])).toBe(0);
  });

  it('getEffectiveAttack returns attack value when power sufficient', () => {
    const G = setupGame();
    G.chronos.position = 0; // night
    G.chronos.nightSidePlayer = 0;
    const card = createInstance('test-character-1');
    // test-character-1 has powerCost 0, attack night 20 day 30
    expect(getEffectiveAttack(card, G, 0)).toBe(20);
  });

  it('getEffectiveAttack respects day time', () => {
    const G = setupGame();
    G.chronos.position = 9; // noon/day
    G.chronos.nightSidePlayer = 0;
    const card = createInstance('test-character-1');
    expect(getEffectiveAttack(card, G, 0)).toBe(30);
  });

  it('getEffectiveAttack applies attack modifier', () => {
    const G = setupGame();
    G.chronos.position = 0;
    G.chronos.nightSidePlayer = 0;
    G.modifiers.attack = [10, 0];
    const card = createInstance('test-character-1');
    expect(getEffectiveAttack(card, G, 0)).toBe(30);
  });

  it('getEffectiveAttack uses attackSetTo when set', () => {
    const G = setupGame();
    G.chronos.position = 0;
    G.chronos.nightSidePlayer = 0;
    G.modifiers.attackSetTo = [50, null];
    const card = createInstance('test-character-1');
    expect(getEffectiveAttack(card, G, 0)).toBe(50);
  });

  it('keeps the card attack in the battle breakdown when insufficient Power makes it 0', () => {
    const G = setupGame();
    G.chronos.position = 0;
    G.chronos.nightSidePlayer = 0;
    G.players[0].battleZone = createInstance('test-character-power-hungry', true);
    G.players[1].battleZone = createInstance('test-character-1', true);
    G.players[0].powerCharger = [];

    resolveBattle(G);

    const notice = G.recentGameNotices?.at(-1);
    expect(notice?.kind).toBe('hpChange');
    expect(notice?.breakdown?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'board.hpChange.loserAttack',
          value: 'board.hpChange.insufficientPower',
        }),
        expect.objectContaining({ label: 'board.hpChange.loserRawAttack', value: '130' }),
      ]),
    );
  });

  it('records both raw attacks when insufficient Power makes both attacks 0', () => {
    const G = setupGame();
    G.chronos.position = 0;
    G.chronos.nightSidePlayer = 0;
    G.players[0].battleZone = createInstance('test-character-power-hungry', true);
    G.players[1].battleZone = createInstance('test-character-power-hungry', true);
    G.players[0].powerCharger = [];
    G.players[1].powerCharger = [];

    resolveBattle(G);

    const notice = G.recentGameNotices?.at(-1);
    expect(notice).toMatchObject({ kind: 'battleResult', winner: null, winnerAttack: 0, loserAttack: 0 });
    expect(notice?.breakdown?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'board.hpChange.p0Attack', value: 'board.hpChange.insufficientPower' }),
        expect.objectContaining({ label: 'board.hpChange.p0RawAttack', value: '130' }),
        expect.objectContaining({ label: 'board.hpChange.p1Attack', value: 'board.hpChange.insufficientPower' }),
        expect.objectContaining({ label: 'board.hpChange.p1RawAttack', value: '130' }),
      ]),
    );
  });

  it('pushes a no-damage battle result when reduction absorbs all damage', () => {
    const G = setupGame();
    G.chronos.position = 0;
    G.chronos.nightSidePlayer = 0;
    G.players[0].battleZone = createInstance('test-character-1', true);
    G.players[1].battleZone = createInstance('test-character-2', true);
    G.modifiers.attack = [20, 0];
    G.modifiers.damageReduction = [0, 20];
    G.modifiers.damageReductionSources = [
      [],
      [
        {
          cardInstanceId: G.players[1].battleZone.instanceId,
          cardDefId: G.players[1].battleZone.defId,
          amount: 20,
        },
      ],
    ];

    resolveBattle(G);

    expect(G.players[1].hp).toBe(100);
    expect(G.recentGameNotices?.at(-1)).toMatchObject({
      kind: 'battleResult',
      titleKey: 'board.notice.battleNoDamage',
      winner: 0,
      damage: 0,
      hpBefore: 100,
      hpAfter: 100,
      damageReductionSources: [
        {
          cardInstanceId: G.players[1].battleZone.instanceId,
          cardDefId: G.players[1].battleZone.defId,
          amount: 20,
        },
      ],
    });
  });

  it('snapshots per-card attack modifier sources into the battle notice', () => {
    const G = setupGame();
    const boostSource = createInstance('test-enchant-1', true);
    const reduceSource = createInstance('test-enchant-2', true);
    G.chronos.position = 0;
    G.chronos.nightSidePlayer = 0;
    G.players[0].battleZone = createInstance('test-character-1', true);
    G.players[1].battleZone = createInstance('test-character-2', true);
    G.modifiers.attack = [20, -5];
    G.modifiers.attackSources = [
      [
        {
          kind: 'boost',
          player: 0,
          targetPlayer: 0,
          amount: 20,
          cardDefId: boostSource.defId,
          cardInstanceId: boostSource.instanceId,
        },
      ],
      [
        {
          kind: 'reduce',
          player: 0,
          targetPlayer: 1,
          amount: 5,
          cardDefId: reduceSource.defId,
          cardInstanceId: reduceSource.instanceId,
        },
      ],
    ];

    resolveBattle(G);

    expect(G.recentGameNotices?.at(-1)).toMatchObject({
      kind: 'hpChange',
      reason: 'battle',
      attackModifierSources: [
        [
          {
            kind: 'boost',
            player: 0,
            targetPlayer: 0,
            amount: 20,
            cardDefId: boostSource.defId,
            cardInstanceId: boostSource.instanceId,
          },
        ],
        [
          {
            kind: 'reduce',
            player: 0,
            targetPlayer: 1,
            amount: 5,
            cardDefId: reduceSource.defId,
            cardInstanceId: reduceSource.instanceId,
          },
        ],
      ],
    });
  });

  it('keeps the battle HP snapshot when a later turn-end effect heals the loser', () => {
    const G = setupGame();
    const winnerCard = createInstance('test-character-1', true);
    const loserCard = createInstance('test-character-2', true);
    G.players[0].battleZone = winnerCard;
    G.players[1].battleZone = loserCard;
    G.modifiers.attack = [40, 0];
    const timingEffects = new Map([
      [
        winnerCard.defId,
        [
          {
            trigger: 'onTurnEnd' as const,
            conditions: [],
            action: { type: 'healBoth' as const, params: { value: 10 } },
            rawText: 'Heal both players at turn end',
          },
        ],
      ],
    ]);

    resolveBattle(G, timingEffects);
    const battleNotice = G.recentGameNotices.find((notice) => notice.kind === 'hpChange' && notice.reason === 'battle');
    expect(battleNotice).toMatchObject({ player: 1, delta: -40, hpBefore: 100, hpAfter: 60 });
    expect(battleNotice).toMatchObject({
      winner: 0,
      winnerAttack: 60,
      loserAttack: 20,
      damage: 40,
      resolutionTurn: G.turnNumber,
      battleCards: [
        expect.objectContaining({ instanceId: winnerCard.instanceId, defId: winnerCard.defId }),
        expect.objectContaining({ instanceId: loserCard.instanceId, defId: loserCard.defId }),
      ],
    });

    resolveTimingEvent(G, timingEffects, { type: 'turnEnd' });

    expect(G.players[1].hp).toBe(70);
    expect(battleNotice).toMatchObject({ hpBefore: 100, hpAfter: 60 });
  });

  it('getEffectiveAttack applies a negative attack modifier', () => {
    const G = setupGame();
    G.chronos.position = 0;
    G.chronos.nightSidePlayer = 0;
    G.modifiers.attack = [-10, 0];
    const card = createInstance('test-character-1');
    expect(getEffectiveAttack(card, G, 0)).toBe(10);
  });
});

describe('effect failure notices', () => {
  const onUseBoost = {
    trigger: 'onUse' as const,
    conditions: [],
    action: { type: 'boostAttack' as const, params: { value: 10 } },
    rawText: 'Gain 10 attack',
  };

  it('identifies disabled and insufficient-Power effects before they enter the effect queue', () => {
    const disabled = setupGame();
    const disabledSource = createInstance('test-character-1', true);
    disabled.players[0].battleZone = disabledSource;
    disabled.modifiers.effectsDisabled![0] = true;
    const disabledEffects = new Map([[disabledSource.defId, [onUseBoost]]]);

    expect(collectTurnEffects(disabled, disabledEffects, [[disabledSource], []])[0]).toHaveLength(0);
    expect(disabled.recentGameNotices.at(-1)).toMatchObject({
      kind: 'effectFailure',
      player: 0,
      sourceCardDefId: disabledSource.defId,
      sourceCardInstanceId: disabledSource.instanceId,
      failureReason: 'disabled',
    });

    const insufficient = setupGame();
    const insufficientSource = createInstance('test-character-power-hungry', true);
    insufficient.players[0].battleZone = insufficientSource;
    insufficient.players[0].powerCharger = [];
    const insufficientEffects = new Map([[insufficientSource.defId, [onUseBoost]]]);

    expect(collectTurnEffects(insufficient, insufficientEffects, [[insufficientSource], []])[0]).toHaveLength(0);
    expect(insufficient.recentGameNotices.at(-1)).toMatchObject({
      kind: 'effectFailure',
      player: 0,
      sourceCardDefId: insufficientSource.defId,
      sourceCardInstanceId: insufficientSource.instanceId,
      failureReason: 'powerCost',
    });
  });

  it('does not report a disabled effect for a card with no eligible effect', () => {
    const G = setupGame();
    const source = createInstance('test-character-1', true);
    G.players[0].battleZone = source;
    G.modifiers.effectsDisabled![0] = true;

    expect(collectTurnEffects(G, new Map(), [[source], []])[0]).toHaveLength(0);
    expect(G.recentGameNotices.some((notice) => notice.kind === 'effectFailure')).toBe(false);
  });

  it('reports disabled automatic effects only when their timing trigger matches', () => {
    const G = setupGame();
    const source = createInstance('test-character-1', true);
    G.players[0].battleZone = source;
    G.modifiers.effectsDisabled![0] = true;
    const timingEffects = new Map([
      [
        source.defId,
        [
          {
            trigger: 'onTurnStart' as const,
            conditions: [],
            action: { type: 'heal' as const, params: { value: 10 } },
            rawText: 'Heal at turn start',
          },
        ],
      ],
    ]);

    resolveTimingEvent(G, timingEffects, { type: 'turnEnd' });
    expect(G.recentGameNotices.some((notice) => notice.kind === 'effectFailure')).toBe(false);

    resolveTimingEvent(G, timingEffects, { type: 'turnStart' });
    expect(G.recentGameNotices.at(-1)).toMatchObject({
      kind: 'effectFailure',
      sourceCardInstanceId: source.instanceId,
      failureReason: 'disabled',
    });
  });

  it('reports insufficient Power for an automatic effect that reaches its timing window', () => {
    const G = setupGame();
    const source = createInstance('test-character-power-hungry', true);
    G.players[0].battleZone = source;
    G.players[0].powerCharger = [];
    const timingEffects = new Map([
      [
        source.defId,
        [
          {
            trigger: 'onTurnEnd' as const,
            conditions: [],
            action: { type: 'heal' as const, params: { value: 10 } },
            rawText: 'Heal at turn end',
          },
        ],
      ],
    ]);

    resolveTimingEvent(G, timingEffects, { type: 'turnEnd' });

    expect(G.recentGameNotices.at(-1)).toMatchObject({
      kind: 'effectFailure',
      sourceCardInstanceId: source.instanceId,
      failureReason: 'powerCost',
    });
  });

  it('does not warn when an automatic conditional trigger simply does not match', () => {
    const G = setupGame();
    const source = createInstance('test-character-1', true);
    G.players[0].battleZone = source;
    const timingEffects = new Map([
      [
        source.defId,
        [
          {
            trigger: 'onTurnEnd' as const,
            conditions: [{ type: 'hpLessOrEqual' as const, value: 10 }],
            action: { type: 'heal' as const, params: { value: 10 } },
            rawText: 'Heal while HP is 10 or less',
          },
        ],
      ],
    ]);

    resolveTimingEvent(G, timingEffects, { type: 'turnEnd' });

    expect(G.recentGameNotices.some((notice) => notice.kind === 'effectFailure')).toBe(false);
  });

  it('reports a delayed effect that becomes disabled before turn end', () => {
    const G = setupGame();
    const source = createInstance('test-character-1', true);
    G.modifiers.effectsDisabled![0] = true;
    G.delayedEffects = [
      {
        id: 'delayed-disabled',
        player: 0,
        cardInstanceId: source.instanceId,
        cardDefId: source.defId,
        rawText: 'Deal damage at turn end',
        source: 'played',
        effect: {
          trigger: 'onTurnEnd',
          conditions: [],
          action: { type: 'directDamage', params: { value: 10 } },
          rawText: 'Deal damage at turn end',
        },
      },
    ];

    resolveTimingEvent(G, new Map(), { type: 'turnEnd' });

    expect(G.recentGameNotices.at(-1)).toMatchObject({
      kind: 'effectFailure',
      sourceCardInstanceId: source.instanceId,
      failureReason: 'disabled',
    });
  });

  it('reports a queued effect disabled by an earlier opponent effect', () => {
    const G = setupGame();
    const disabler = createInstance('test-enchant-1', true);
    const blocked = createInstance('test-enchant-2', true);
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 0;
    G.pendingEffects = [
      [
        {
          id: 'disable-opponent',
          player: 0,
          cardInstanceId: disabler.instanceId,
          cardDefId: disabler.defId,
          rawText: 'Disable opponent effects',
          effect: {
            trigger: 'onUse',
            conditions: [],
            action: { type: 'noEffect', params: {} },
            rawText: 'Disable opponent effects',
          },
          source: 'played',
        },
      ],
      [
        {
          id: 'blocked-effect',
          player: 1,
          cardInstanceId: blocked.instanceId,
          cardDefId: blocked.defId,
          rawText: 'Heal 10',
          effect: {
            trigger: 'onUse',
            conditions: [],
            action: { type: 'heal', params: { value: 10 } },
            rawText: 'Heal 10',
          },
          source: 'played',
        },
      ],
    ];

    expect(resolvePendingEffect(G, 0, 0)).toBe(true);

    expect(
      G.recentGameNotices.find(
        (notice) => notice.kind === 'effectFailure' && notice.sourceCardInstanceId === blocked.instanceId,
      ),
    ).toMatchObject({ player: 1, failureReason: 'disabled' });
  });

  it('attributes a pruned copied effect to the actual activating card', () => {
    const G = setupGame();
    const first = createInstance('test-enchant-1', true);
    const copied = createInstance('test-enchant-2', true);
    const rulesSource = createInstance('test-character-power-hungry', true);
    G.players[0].powerCharger = [];
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 1;
    G.pendingEffects = [
      [
        {
          id: 'copied-effect',
          player: 0,
          cardInstanceId: copied.instanceId,
          cardDefId: copied.defId,
          rulesSourceCardInstanceId: rulesSource.instanceId,
          rulesSourceCardDefId: rulesSource.defId,
          rawText: 'Copied heal',
          effect: {
            trigger: 'onUse',
            conditions: [],
            action: { type: 'heal', params: { value: 10 } },
            rawText: 'Copied heal',
          },
          source: 'played',
        },
      ],
      [
        {
          id: 'first-effect',
          player: 1,
          cardInstanceId: first.instanceId,
          cardDefId: first.defId,
          rawText: 'Heal 1',
          effect: {
            trigger: 'onUse',
            conditions: [],
            action: { type: 'heal', params: { value: 1 } },
            rawText: 'Heal 1',
          },
          source: 'played',
        },
      ],
    ];

    expect(resolvePendingEffect(G, 1, 0)).toBe(true);

    expect(
      G.recentGameNotices.find(
        (notice) => notice.kind === 'effectFailure' && notice.sourceCardInstanceId === rulesSource.instanceId,
      ),
    ).toMatchObject({
      player: 0,
      sourceCardDefId: rulesSource.defId,
      failureReason: 'powerCost',
    });
  });

  it('keeps the source card and failure message when a queued effect cannot resolve', () => {
    const G = setupGame();
    const source = createInstance('test-character-1', true);
    G.players[0].battleZone = source;
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 0;
    G.pendingEffects = [
      [
        {
          id: 'unsupported-element',
          player: 0,
          cardInstanceId: source.instanceId,
          cardDefId: source.defId,
          rawText: 'Set an unsupported element',
          effect: {
            trigger: 'onUse',
            conditions: [],
            action: { type: 'setOpponentElement', params: { value: '光' } },
            rawText: 'Set an unsupported element',
          },
          source: 'battleZone',
        },
      ],
      [],
    ];

    expect(resolvePendingEffect(G, 0, 0)).toBe(true);
    const failureNotice = G.recentGameNotices.find(
      (notice) => notice.kind === 'effectFailure' && notice.sourceCardInstanceId === source.instanceId,
    );
    expect(failureNotice).toMatchObject({
      kind: 'effectFailure',
      player: 0,
      sourceCardDefId: source.defId,
      sourceCardInstanceId: source.instanceId,
      failureReason: 'condition',
      failureMessage: expect.any(String),
    });
  });
});

describe('card-effect Chronos notices', () => {
  function resolveChronosEffect(
    action: PendingEffect['effect']['action'],
    startPosition: number,
    turnStartPosition = startPosition,
  ) {
    const G = setupGame();
    const sourceCard = createInstance('test-character-1', true);
    G.players[0].battleZone = sourceCard;
    G.chronos.position = startPosition;
    G.chronosAtTurnStart = turnStartPosition;
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 0;
    G.pendingEffects = [
      [
        {
          id: `chronos-${action.type}`,
          player: 0,
          cardInstanceId: sourceCard.instanceId,
          cardDefId: sourceCard.defId,
          rawText: 'QA Chronos effect',
          effect: {
            trigger: 'onUse',
            conditions: [],
            action,
            rawText: 'QA Chronos effect',
          },
          source: 'played',
        },
      ],
      [],
    ];

    expect(resolvePendingEffect(G, 0, 0)).toBe(true);
    const notice = [...G.recentGameNotices]
      .reverse()
      .find((item) => item.kind === 'chronosChange' && item.chronosSourceKind === 'cardEffect');
    return { G, notice, sourceCard };
  }

  it('records clockwise advance metadata', () => {
    const { notice, sourceCard } = resolveChronosEffect({ type: 'clockAdvance', params: { value: 5 } }, 2);
    expect(notice).toMatchObject({
      chronosFrom: 2,
      chronosTo: 7,
      chronosDelta: 5,
      chronosEffectMode: 'advance',
      chronosMoveAmount: 5,
      chronosSourceCardInstanceId: sourceCard.instanceId,
      player: 0,
    });
  });

  it('routes automatic turn-end Chronos effects through notices and timing events', () => {
    const G = setupGame();
    const sourceCard = createInstance('test-character-1', true);
    G.players[0].battleZone = sourceCard;
    G.chronos.position = 9;
    const timingEffects = new Map([
      [
        sourceCard.defId,
        [
          {
            trigger: 'onTurnEnd' as const,
            conditions: [],
            action: { type: 'clockAdvance' as const, params: { value: 2 } },
            rawText: 'Advance Chronos 2 at turn end',
          },
        ],
      ],
    ]);

    resolveTimingEvent(G, timingEffects, { type: 'turnEnd' });

    expect(G.chronos.position).toBe(11);
    expect(G.recentGameNotices.at(-1)).toMatchObject({
      kind: 'chronosChange',
      chronosFrom: 9,
      chronosTo: 11,
      chronosEffectMode: 'advance',
      chronosMoveAmount: 2,
      chronosSourceCardDefId: sourceCard.defId,
      chronosSourceCardInstanceId: sourceCard.instanceId,
      player: 0,
    });
    expect(G.timingEvents).toContainEqual(
      expect.objectContaining({ type: 'chronosChanged', fromChronos: 9, toChronos: 11 }),
    );
  });

  it('queues a triggering Chronos notice before its nested Chronos reaction', () => {
    const G = setupGame();
    const triggerCard = createInstance('test-character-1', true);
    const reactionCard = createInstance('test-character-2', true);
    G.players[0].battleZone = triggerCard;
    G.players[1].battleZone = reactionCard;
    G.chronos.position = 9;
    const timingEffects = new Map([
      [
        triggerCard.defId,
        [
          {
            trigger: 'onTurnEnd' as const,
            conditions: [],
            action: { type: 'clockAdvance' as const, params: { value: 2 } },
            rawText: 'Advance Chronos 2 at turn end',
          },
        ],
      ],
      [
        reactionCard.defId,
        [
          {
            trigger: 'onChronosChanged' as const,
            conditions: [],
            action: { type: 'clockSet' as const, params: { value: 4 } },
            rawText: 'Set Chronos to 4 after it changes',
          },
        ],
      ],
    ]);

    resolveTimingEvent(G, timingEffects, { type: 'turnEnd' });

    const notices = G.recentGameNotices.filter((notice) => notice.kind === 'chronosChange');
    expect(notices).toHaveLength(2);
    expect(notices[0]).toMatchObject({ chronosFrom: 9, chronosTo: 11, chronosSourceCardDefId: triggerCard.defId });
    expect(notices[1]).toMatchObject({ chronosFrom: 11, chronosTo: 4, chronosSourceCardDefId: reactionCard.defId });
    expect(notices[0].id).toBeLessThan(notices[1].id);
    expect(G.chronos.position).toBe(4);
  });

  it('records rewind metadata', () => {
    const { notice, sourceCard } = resolveChronosEffect({ type: 'clockReset', params: {} }, 8, 5);
    expect(notice).toMatchObject({
      chronosFrom: 8,
      chronosTo: 5,
      chronosDelta: -3,
      chronosEffectMode: 'rewind',
      chronosMoveAmount: 3,
      chronosSourceCardInstanceId: sourceCard.instanceId,
    });
  });

  it('records direct position metadata without treating it as stepped movement', () => {
    const { notice, sourceCard } = resolveChronosEffect({ type: 'clockSet', params: { value: 13 } }, 3);
    expect(notice).toMatchObject({
      chronosFrom: 3,
      chronosTo: 13,
      chronosDelta: -8,
      chronosEffectMode: 'set',
      chronosSourceCardInstanceId: sourceCard.instanceId,
    });
    expect(notice?.chronosMoveAmount).toBeUndefined();
  });

  it('keeps the source card metadata when an arbitrary dial position is confirmed later', () => {
    const G = setupGame();
    const sourceCard = createInstance('test-character-1', true);
    G.players[0].battleZone = sourceCard;
    G.chronos.position = 3;
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 0;
    G.pendingEffects = [
      [
        {
          id: 'chronos-set-any',
          player: 0,
          cardInstanceId: sourceCard.instanceId,
          cardDefId: sourceCard.defId,
          rawText: 'Choose any Chronos position',
          effect: {
            trigger: 'onUse',
            conditions: [],
            action: { type: 'clockSet', params: { value: 'any' } },
            rawText: 'Choose any Chronos position',
          },
          source: 'played',
        },
      ],
      [],
    ];

    expect(resolvePendingEffect(G, 0, 0)).toBe(true);
    expect(G.pendingChoice).toMatchObject({
      type: 'clockPosition',
      sourceCardDefId: sourceCard.defId,
      sourceCardInstanceId: sourceCard.instanceId,
    });
    expect(submitPendingChoice(G, 0, ['chronos-13'])).toBe(true);

    const notice = [...G.recentGameNotices]
      .reverse()
      .find((item) => item.kind === 'chronosChange' && item.chronosSourceKind === 'cardEffect');
    expect(notice).toMatchObject({
      chronosFrom: 3,
      chronosTo: 13,
      chronosEffectMode: 'set',
      chronosSourceCardDefId: sourceCard.defId,
      chronosSourceCardInstanceId: sourceCard.instanceId,
    });
  });

  it('records and resolves a clockwise full cycle even when the final position is unchanged', () => {
    const { G, notice } = resolveChronosEffect(
      { type: 'clockAdvance', params: { value: CHRONOS_MAPPING.positions } },
      2,
    );
    expect(G.chronos.position).toBe(2);
    expect(notice).toMatchObject({
      chronosFrom: 2,
      chronosTo: 2,
      chronosDelta: 0,
      chronosEffectMode: 'advance',
      chronosMoveAmount: CHRONOS_MAPPING.positions,
    });
    expect(G.log).toContain('Timing chronosChanged (path: night→day).');
    expect(G.log).toContain('Timing chronosChanged (path: day→night).');
  });

  it('records and resolves a counterclockwise full cycle', () => {
    const { G, notice } = resolveChronosEffect(
      { type: 'clockAdvance', params: { value: -CHRONOS_MAPPING.positions } },
      2,
    );
    expect(G.chronos.position).toBe(2);
    expect(notice).toMatchObject({
      chronosFrom: 2,
      chronosTo: 2,
      chronosDelta: 0,
      chronosEffectMode: 'rewind',
      chronosMoveAmount: CHRONOS_MAPPING.positions,
    });
    expect(G.log).toContain('Timing chronosChanged (path: night→day).');
    expect(G.log).toContain('Timing chronosChanged (path: day→night).');
  });

  it('emits turn-advance feedback for an 18-space total', () => {
    const G = setupGame();
    const playerCard = createInstance('test-character-1', true);
    const opponentCard = createInstance('test-character-2', true);
    G.chronos.position = 2;
    G.setCardsThisTurn = [[playerCard], [opponentCard]];
    G.modifiers.cardClockSetTo = 9;

    advanceChronos(G);

    const notice = [...G.recentGameNotices]
      .reverse()
      .find((item) => item.kind === 'chronosChange' && item.chronosSourceKind === 'turnAdvance');
    expect(G.chronos.position).toBe(2);
    expect(notice).toMatchObject({
      chronosFrom: 2,
      chronosTo: 2,
      chronosDelta: 0,
      chronosAdvanceAmount: CHRONOS_MAPPING.positions,
    });
    expect(notice?.chronosContributions).toHaveLength(2);
    expect(G.timingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'chronosChanged', fromChronosTime: 'night', toChronosTime: 'day' }),
        expect.objectContaining({ type: 'chronosChanged', fromChronosTime: 'day', toChronosTime: 'night' }),
        expect.objectContaining({ type: 'chronosChanged', fromChronos: 2, toChronos: 2 }),
      ]),
    );
  });
});

describe('4th SE card effects', () => {
  const reviewedEffects = {
    '4th_105':
      'アビスのカードを8枚選び、裏向きにして混ぜ、デッキの底に置く。そうしない場合、ゲームに敗北する。お互いのパワーチャージャーのカードをすべてアビスに置く。',
    '4th_106': 'クロノスの時計を9つ進ませる',
    '4th_107': '相手のエリアエンチャントを、相手のアビスに置く',
  } as const;

  function pendingReviewedEffect(G: GameState, cardId: keyof typeof reviewedEffects): ReturnType<typeof parseEffect> {
    const parsed = parseEffect(reviewedEffects[cardId]);
    expect(parsed).not.toBeNull();
    const sourceCard = createInstance('test-enchant-1', true);
    G.players[0].battleZone = sourceCard;
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 0;
    G.pendingEffects = [
      [
        {
          id: `${cardId}-reviewed-effect`,
          player: 0,
          cardInstanceId: sourceCard.instanceId,
          cardDefId: cardId,
          rawText: reviewedEffects[cardId],
          effect: parsed!,
          source: 'played',
        },
      ],
      [],
    ];
    return parsed;
  }

  it('moves the paid Abyss cards to the deck before moving both Power Chargers to the Abyss', () => {
    const G = setupGame();
    const sourceCard = createInstance('test-character-1', true);
    const paymentCards = Array.from({ length: 8 }, (_, index) =>
      createInstance(`test-enchant-${(index % 8) + 1}`, true),
    );
    const ownPowerCards = [createInstance('test-enchant-1', true), createInstance('test-enchant-2', true)];
    const opponentPowerCards = [createInstance('test-enchant-3', true), createInstance('test-enchant-4', true)];
    G.players[0].battleZone = sourceCard;
    G.players[0].deck = [];
    G.players[0].abyss = [...paymentCards];
    G.players[0].powerCharger = [...ownPowerCards];
    G.players[1].abyss = [];
    G.players[1].powerCharger = [...opponentPowerCards];
    G.step = 'effectOrder';
    G.pendingEffectPlayer = 0;
    G.pendingEffects = [
      [
        {
          id: '4th-105-effect',
          player: 0,
          cardInstanceId: sourceCard.instanceId,
          cardDefId: '4th_105',
          rawText: '4th_105',
          effect: {
            trigger: 'onUse',
            conditions: [],
            action: {
              type: 'requestChoice',
              params: {
                choiceType: 'abyssToDeckBottomOrLose',
                min: 8,
                max: 8,
                faceDown: true,
                shuffle: true,
                moveAllPowerChargersToAbyss: true,
              },
            },
            rawText: '4th_105',
          },
          source: 'played',
        },
      ],
      [],
    ];

    expect(resolvePendingEffect(G, 0, 0)).toBe(true);
    expect(G.pendingChoice).toMatchObject({
      type: 'abyssToDeckBottomOrLose',
      min: 8,
      max: 8,
      payload: { moveAllPowerChargersToAbyss: true },
    });
    const optionIds = G.pendingChoice?.options.map((option) => option.id) ?? [];
    expect(submitPendingChoice(G, 0, optionIds)).toBe(true);

    expect(G.players[0].deck).toHaveLength(8);
    expect(G.players[0].deck.every((card) => !card.faceUp)).toBe(true);
    expect(G.players[0].powerCharger).toHaveLength(0);
    expect(G.players[1].powerCharger).toHaveLength(0);
    expect(G.players[0].abyss.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining(ownPowerCards.map((card) => card.instanceId)),
    );
    expect(G.players[1].abyss.map((card) => card.instanceId)).toEqual(
      expect.arrayContaining(opponentPowerCards.map((card) => card.instanceId)),
    );
  });

  it('makes 4th_105 lose immediately when fewer than eight Abyss cards are available', () => {
    const G = setupGame();
    G.players[0].abyss = Array.from({ length: 7 }, (_, index) => createInstance(`test-enchant-${index + 1}`, true));
    pendingReviewedEffect(G, '4th_105');

    expect(resolvePendingEffect(G, 0, 0)).toBe(true);
    expect(G.winner).toBe(1);
    expect(G.step).toBe('gameOver');
    expect(G.pendingChoice).toBeNull();
    expect(G.log.at(-1)).toContain('needs 8, has 7');
  });

  it('parses and resolves the exact 4th_106 text as a nine-space card-effect Chronos advance', () => {
    const G = setupGame();
    G.chronos.position = 14;
    const parsed = pendingReviewedEffect(G, '4th_106');
    expect(parsed?.action).toEqual({ type: 'clockAdvance', params: { value: 9 } });

    expect(resolvePendingEffect(G, 0, 0)).toBe(true);
    expect(G.chronos.position).toBe(5);
    const notice = G.recentGameNotices.find(
      (item) => item.kind === 'chronosChange' && item.chronosSourceCardDefId === '4th_106',
    );
    expect(notice).toMatchObject({
      kind: 'chronosChange',
      chronosFrom: 14,
      chronosTo: 5,
      chronosEffectMode: 'advance',
      chronosMoveAmount: 9,
      chronosSourceKind: 'cardEffect',
      chronosSourceCardDefId: '4th_106',
      player: 0,
    });
  });

  it('parses and resolves the exact 4th_107 text, removing the opposing Area Enchant and its effects', () => {
    const G = setupGame();
    const areaEnchant = createInstance('test-area-enchant-1', true);
    G.players[1].setZoneC = areaEnchant;
    G.pendingEffects[1] = [
      {
        id: 'opponent-area-effect',
        player: 1,
        cardInstanceId: areaEnchant.instanceId,
        cardDefId: areaEnchant.defId,
        rawText: 'persistent opponent effect',
        effect: {
          trigger: 'onUse',
          conditions: [],
          action: { type: 'boostAttack', params: { value: 10 } },
          rawText: 'persistent opponent effect',
        },
        source: 'setZoneC',
      },
    ];
    const parsed = pendingReviewedEffect(G, '4th_107');
    expect(parsed?.action).toEqual({
      type: 'moveOpponentAreaEnchant',
      params: { target: 'opponent', destination: 'abyss' },
    });

    expect(resolvePendingEffect(G, 0, 0)).toBe(true);
    expect(G.players[1].setZoneC).toBeNull();
    expect(G.players[1].abyss).toContainEqual(expect.objectContaining({ instanceId: areaEnchant.instanceId }));
    expect(G.pendingEffects[1]).toHaveLength(0);
  });
});

describe('getChronosTime and getPriorityPlayer', () => {
  it('getChronosTime returns night at position 0', () => {
    const G = setupGame();
    G.chronos.position = 0;
    G.midnightRange = 0;
    expect(getChronosTime(G)).toBe('night');
  });

  it('getChronosTime returns day at position 9', () => {
    const G = setupGame();
    G.chronos.position = 9;
    G.midnightRange = 0;
    expect(getChronosTime(G)).toBe('day');
  });

  it('getPriorityPlayer returns nightSidePlayer during night', () => {
    const G = setupGame();
    G.chronos.position = 0;
    G.chronos.nightSidePlayer = 1;
    expect(getPriorityPlayer(G)).toBe(1);
  });

  it('getPriorityPlayer returns opposite player during day', () => {
    const G = setupGame();
    G.chronos.position = 9;
    G.chronos.nightSidePlayer = 0;
    expect(getPriorityPlayer(G)).toBe(1);
  });
});

describe('getEffectiveElement', () => {
  it('returns card element by default', () => {
    const G = setupGame();
    const card = createInstance('test-character-1');
    expect(getEffectiveElement(card, G, 0)).toBe('闇');
  });

  it('returns overridden element when modifier set', () => {
    const G = setupGame();
    const card = createInstance('test-character-1');
    G.modifiers.elementOverride = ['炎', null];
    expect(getEffectiveElement(card, G, 0)).toBe('炎');
  });
});

describe('endGame', () => {
  it('sets game over state with winner', () => {
    const G = setupGame();
    endGame(G, 0, 'Player 1 lost at 0 HP');
    expect(G.step).toBe('gameOver');
    expect(G.winner).toBe(0);
    expect(G.gameoverReason).toBe('Player 1 lost at 0 HP');
    expect(G.ready).toEqual([true, true]);
  });

  it('sets game over state with draw when winner null', () => {
    const G = setupGame();
    endGame(G, null, 'Both players lost');
    expect(G.step).toBe('gameOver');
    expect(G.winner).toBeNull();
  });

  it('restores deck and hand hidden information before exposing the final state', () => {
    const G = setupGame();
    G.players[0].deck[0].faceUp = true;
    G.revealedHandCardIds[1] = G.players[1].hand.map((card) => card.instanceId);
    endGame(G, 0, 'test game over');
    expect(G.players[0].deck.every((card) => card.faceUp === false)).toBe(true);
    expect(G.revealedHandCardIds).toEqual([[], []]);
  });
});

describe('surrenderGame', () => {
  it('ends the match in favor of the opponent and records the authoritative reason', () => {
    const G = setupGame();

    expect(surrenderGame(G, 1)).toBe(true);

    expect(G.step).toBe('gameOver');
    expect(G.winner).toBe(0);
    expect(G.gameoverReason).toBe('Player 1 surrendered.');
    expect(G.actionLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'surrender', player: 1, payload: { winner: 0 } }),
        expect.objectContaining({ action: 'gameOver', payload: expect.objectContaining({ winner: 0 }) }),
      ]),
    );
  });

  it('rejects a surrender after the match has already ended', () => {
    const G = setupGame();
    endGame(G, 0, 'done');
    const actionCount = G.actionLog.length;

    expect(surrenderGame(G, 1)).toBe(false);
    expect(G.actionLog).toHaveLength(actionCount);
  });
});

describe('emptyModifiers', () => {
  it('returns modifiers with zero/neutral defaults', () => {
    const mods = emptyModifiers();
    expect(mods.attack).toEqual([0, 0]);
    expect(mods.attackSetTo).toEqual([null, null]);
    expect(mods.damageReduction).toEqual([0, 0]);
    expect(mods.elementOverride).toEqual([null, null]);
    expect(mods.effectsDisabled).toEqual([false, false]);
    expect(mods.swapAttack).toEqual([false, false]);
  });
});

describe('ZutomayoCard.endIf', () => {
  it('returns undefined when not gameOver', () => {
    const G = setupGame();
    const result = ZutomayoCard.endIf?.({ G } as never);
    expect(result).toBeUndefined();
  });

  it('returns winner when gameOver with winner', () => {
    const G = setupGame();
    endGame(G, 1, 'done');
    const result = ZutomayoCard.endIf?.({ G } as never);
    expect(result).toEqual({ winner: '1' });
  });

  it('returns draw when gameOver with null winner', () => {
    const G = setupGame();
    endGame(G, null, 'draw');
    const result = ZutomayoCard.endIf?.({ G } as never);
    expect(result).toEqual({ draw: true });
  });
});

describe('playerView', () => {
  it('does not expose replay inputs or RNG state to players or spectators', () => {
    const G = setupGame({ rngSeed: 123 });
    const player = ZutomayoCard.playerView?.({ G, playerID: '0' } as never) as GameState;
    const spectator = ZutomayoCard.playerView?.({ G, playerID: null } as never) as GameState;

    expect(player.rng).toBeUndefined();
    expect(player.replayManifest).toBeUndefined();
    expect(spectator.rng).toBeUndefined();
    expect(spectator.replayManifest).toBeUndefined();
  });

  it('resolves card-name guesses as declaration, hidden position selection, then acknowledgement', () => {
    const G = setupGame();
    G.step = 'effectOrder';
    const target = G.players[1].hand[0];
    G.pendingChoice = {
      id: 'guess-card',
      type: 'declareOpponentHandCardName',
      player: 0,
      min: 1,
      max: 1,
      payload: { opponentPlayer: 1, attackBoost: 20 },
      options: [
        {
          id: `declare:${target.defId}`,
          label: target.defId,
          value: target.defId,
          cardDefId: target.defId,
        },
      ],
      sourceCardDefId: 'test-enchant-1',
      sourceCardInstanceId: 'guess-source',
    };

    expect(submitPendingChoice(G, 0, [`declare:${target.defId}`])).toBe(true);
    expect(G.pendingChoice?.type).toBe('selectOpponentHandCard');
    expect(G.pendingChoice?.options).toHaveLength(G.players[1].hand.length);
    expect(G.pendingChoice?.options.every((option) => !option.cardDefId && !option.cardInstanceId)).toBe(true);

    expect(submitPendingChoice(G, 0, ['hand-position:0'])).toBe(true);
    expect(G.pendingChoice).toMatchObject({
      type: 'acknowledgeRevealedHand',
      player: 0,
      payload: {
        revealedPlayer: 1,
        revealedCardInstanceIds: [target.instanceId],
        guessedCardDefId: target.defId,
        matched: true,
        attackBoost: 20,
      },
    });
    expect(G.modifiers.attack[0]).toBe(20);
    expect(G.modifiers.attackSources?.[0]).toEqual([
      expect.objectContaining({ cardDefId: 'test-enchant-1', amount: 20, kind: 'boost' }),
    ]);
    const spectator = ZutomayoCard.playerView?.({ G, playerID: null } as never) as GameState;
    const spectatorGuessChoice = spectator.actionLog.find(
      (entry) => entry.action === 'submitPendingChoice' && entry.payload?.choiceType === 'selectOpponentHandCard',
    );
    const spectatorReveal = spectator.actionLog.find(
      (entry) => entry.action === 'revealCards' && entry.payload?.sourceZone === 'hand',
    );
    expect(spectatorGuessChoice?.payload).not.toHaveProperty('guessedCardDefId');
    expect(spectatorReveal?.payload).toMatchObject({ sourceZone: 'hand', cardCount: 1 });
    expect(spectatorReveal?.payload).not.toHaveProperty('cardDefIds');
    expect(spectatorReveal?.payload).not.toHaveProperty('guessedCardDefId');
    expect(spectatorReveal?.payload).not.toHaveProperty('matched');
  });

  it('shows a partial own-hand reveal to both players but strips private ids from spectators', () => {
    const G = setupGame();
    G.step = 'effectOrder';
    const revealed = G.players[0].hand[0];
    G.pendingChoice = {
      id: 'partial-reveal',
      type: 'revealHandAttackBoost',
      player: 0,
      min: 0,
      max: 1,
      payload: { sourcePlayer: 0, boostPerCard: 10, filter: {} },
      options: [
        {
          id: revealed.instanceId,
          label: revealed.defId,
          cardDefId: revealed.defId,
          cardInstanceId: revealed.instanceId,
        },
      ],
      sourceCardDefId: 'test-enchant-1',
      sourceCardInstanceId: 'reveal-source',
    };

    expect(submitPendingChoice(G, 0, [revealed.instanceId])).toBe(true);
    expect(G.pendingChoice).toMatchObject({
      type: 'acknowledgeRevealedHand',
      player: 1,
      payload: { revealedPlayer: 0, revealedCardInstanceIds: [revealed.instanceId], attackBoost: 10 },
    });
    const reviewer = ZutomayoCard.playerView?.({ G, playerID: '1' } as never) as GameState;
    const owner = ZutomayoCard.playerView?.({ G, playerID: '0' } as never) as GameState;
    const spectator = ZutomayoCard.playerView?.({ G, playerID: null } as never) as GameState;
    expect(reviewer.players[0].hand.find((card) => card.instanceId === revealed.instanceId)?.defId).toBe(
      revealed.defId,
    );
    expect(owner.players[0].hand.find((card) => card.instanceId === revealed.instanceId)?.defId).toBe(revealed.defId);
    expect(spectator.players[0].hand.every((card) => card.defId === '__hidden__')).toBe(true);
    expect(spectator.pendingChoice?.type).toBe('acknowledgeRevealedHand');
    expect(spectator.pendingChoice?.payload).toEqual({ revealedPlayer: 0, sourceZone: 'hand' });
    const spectatorReveal = spectator.actionLog.find(
      (entry) => entry.action === 'revealCards' && entry.payload?.sourceZone === 'hand',
    );
    expect(spectatorReveal?.payload).toMatchObject({ sourceZone: 'hand', cardCount: 1 });
    expect(spectatorReveal?.payload).not.toHaveProperty('cardDefIds');
  });

  it('hides deck contents from all players', () => {
    const G = setupGame();
    const view = ZutomayoCard.playerView?.({ G, playerID: '0' } as never) as GameState;
    expect(view.players[0].deck.every((c) => c.defId === '__hidden__')).toBe(true);
    expect(view.players[1].deck.every((c) => c.defId === '__hidden__')).toBe(true);
  });

  it('reveals own hand but hides opponent hand', () => {
    const G = setupGame();
    const view = ZutomayoCard.playerView?.({ G, playerID: '0' } as never) as GameState;
    expect(view.players[0].hand[0].defId).toBe(G.players[0].hand[0].defId);
    expect(view.players[1].hand.every((c) => c.defId === '__hidden__')).toBe(true);
  });

  it('temporarily reveals a hand only to the reviewing player', () => {
    const G = setupGame();
    G.revealedHandCardIds[1] = G.players[1].hand.map((card) => card.instanceId);
    G.pendingChoice = {
      id: 'reveal-review',
      type: 'acknowledgeRevealedHand',
      player: 0,
      options: [],
      min: 0,
      max: 0,
      payload: { revealedPlayer: 1 },
    };

    const reviewer = ZutomayoCard.playerView?.({ G, playerID: '0' } as never) as GameState;
    const owner = ZutomayoCard.playerView?.({ G, playerID: '1' } as never) as GameState;
    const spectator = ZutomayoCard.playerView?.({ G, playerID: null } as never) as GameState;
    expect(reviewer.players[1].hand.map((card) => card.defId)).toEqual(G.players[1].hand.map((card) => card.defId));
    expect(owner.pendingChoice?.options).toEqual([]);
    expect(spectator.players[1].hand.every((card) => card.defId === '__hidden__')).toBe(true);
    expect(spectator.revealedHandCardIds).toEqual([[], []]);
  });

  it('hides the temporarily revealed hand immediately after acknowledgement', () => {
    const G = setupGame();
    G.step = 'effectOrder';
    G.revealedHandCardIds[1] = G.players[1].hand.map((card) => card.instanceId);
    G.pendingChoice = {
      id: 'reveal-review',
      type: 'acknowledgeRevealedHand',
      player: 0,
      options: [],
      min: 0,
      max: 0,
      payload: { revealedPlayer: 1 },
    };

    expect(submitPendingChoice(G, 0, [])).toBe(true);
    expect(G.pendingChoice).toBeNull();
    expect(G.revealedHandCardIds[1]).toEqual([]);
    const view = ZutomayoCard.playerView?.({ G, playerID: '0' } as never) as GameState;
    expect(view.players[1].hand.every((card) => card.defId === '__hidden__')).toBe(true);
  });

  it('hides opponent set cards until revealed', () => {
    const G = setupGame();
    progressToInitialSet(G);
    setInitialCard(G, 1, 0);
    const view = ZutomayoCard.playerView?.({ G, playerID: '0' } as never) as GameState;
    // Opponent's battleZone card should be hidden (faceDown)
    expect(view.players[1].battleZone?.defId).toBe('__hidden__');
    expect(view.players[1].battleZone?.instanceId).toBe(view.setCardsThisTurn[1][0].instanceId);
  });

  it('reveals own face-down set cards to owner', () => {
    const G = setupGame();
    progressToInitialSet(G);
    setInitialCard(G, 0, 0);
    const view = ZutomayoCard.playerView?.({ G, playerID: '0' } as never) as GameState;
    expect(view.players[0].battleZone?.defId).toBe(G.players[0].battleZone?.defId);
  });

  it('handles null playerID spectator view', () => {
    const G = setupGame();
    const view = ZutomayoCard.playerView?.({ G, playerID: null } as never) as GameState;
    expect(view.players[0].hand.every((c) => c.defId === '__hidden__')).toBe(true);
    expect(view.players[1].hand.every((c) => c.defId === '__hidden__')).toBe(true);
  });
});
