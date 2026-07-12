import { describe, it, expect } from 'vitest';
import { initCards, isCardsInitialized, getAllCardDefs, createInstance } from '../cards/loader';
import { parseAllEffects } from '../effects/parser';
import { ZutomayoCard } from '../Game';
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
  getRequiredSetCount,
  getPlayerPower,
  getEffectiveAttack,
  getEffectiveElement,
  getChronosTime,
  getPriorityPlayer,
  endGame,
  surrenderGame,
  emptyModifiers,
  TURN_TIMER_MS,
} from '../GameLogic';
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

function testCardDefs(): CardDef[] {
  return [
    ...Array.from({ length: 15 }, (_, i) => makeCard(`test-character-${i + 1}`, 'Character')),
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

  it('forces ready when timer elapsed', () => {
    const G = setupGame();
    progressToTurnSet(G);
    G.turnStartTime = Date.now() - (TURN_TIMER_MS + 1000);
    expect(timeoutSkip(G, 0, parsedEffects)).toBe(true);
    expect(G.ready[0]).toBe(true);
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
