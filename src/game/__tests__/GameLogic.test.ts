import { describe, it, expect } from 'vitest';
import { initCards, isCardsInitialized, getAllCardDefs, createInstance } from '../cards/loader';
import { parseAllEffects } from '../effects/parser';
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

  it('hides opponent set cards until revealed', () => {
    const G = setupGame();
    progressToInitialSet(G);
    setInitialCard(G, 1, 0);
    const view = ZutomayoCard.playerView?.({ G, playerID: '0' } as never) as GameState;
    // Opponent's battleZone card should be hidden (faceDown)
    expect(view.players[1].battleZone?.defId).toBe('__hidden__');
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
