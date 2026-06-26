import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createInstance, getAllCardDefs } from '../src/game/cards/loader';
import { PRESET_DECKS } from '../src/game/cards/presetDecks';
import { getCharacterCountWarning, isValidConstructedDeck, validateConstructedDeckIds } from '../src/game/cards/deckBuilder';
import {
  advanceChronos,
  confirmReady,
  finishMulligan,
  getChronosTime,
  getEffectiveAttack,
  getEffectiveElement,
  getRequiredSetCount,
  endOfTurnDrawCount,
  placeRevealedCards,
  resolveJanken,
  resolveBattle,
  resolvePendingEffect,
  resolveTimingEvent,
  resolveTurn,
  setInitialCard,
  setTurnCard,
  setupGame,
  submitPendingChoice,
} from '../src/game/GameLogic';
import { collectTurnEffects, executeEffect, processTurnEffects } from '../src/game/effects/executor';
import { parseAllEffects, parseEffect } from '../src/game/effects/parser';
import { CHRONOS_MAPPING, type GameState } from '../src/game/types';
import type { ParsedEffect } from '../src/game/effects';
import { ZutomayoCard } from '../src/game/Game';
import { aiSelectCards } from '../src/game/ai';

const require = createRequire(import.meta.url);
const { Client } = require('boardgame.io/client') as typeof import('boardgame.io/client');
const { Local } = require('boardgame.io/multiplayer') as typeof import('boardgame.io/multiplayer');

const noEffects = new Map<string, ParsedEffect[]>();
const boost: ParsedEffect = {
  trigger: 'onUse', conditions: [], rawText: 'test',
  action: { type: 'boostAttack', params: { value: 20 } },
};
const damage7: ParsedEffect = {
  trigger: 'onUse', conditions: [], rawText: 'deal 7 first',
  action: { type: 'directDamage', params: { value: 7 } },
};
const damage11: ParsedEffect = {
  trigger: 'onUse', conditions: [], rawText: 'deal 11 second',
  action: { type: 'directDamage', params: { value: 11 } },
};
const damage13: ParsedEffect = {
  trigger: 'onUse', conditions: [], rawText: 'deal 13 response',
  action: { type: 'directDamage', params: { value: 13 } },
};
const turnStartHeal10: ParsedEffect = {
  trigger: 'onTurnStart', conditions: [], rawText: 'turn start heal',
  action: { type: 'heal', params: { value: 10 } },
};
const turnStartBoost20: ParsedEffect = {
  trigger: 'onTurnStart', conditions: [], rawText: 'turn start boost',
  action: { type: 'boostAttack', params: { value: 20 } },
};
const turnEndDamage5: ParsedEffect = {
  trigger: 'onTurnEnd', conditions: [], rawText: 'turn end damage',
  action: { type: 'directDamage', params: { value: 5 } },
};
const damageReceivedHeal10: ParsedEffect = {
  trigger: 'onDamageReceived', conditions: [], rawText: 'damage received heal',
  action: { type: 'heal', params: { value: 10 } },
};
const damageReceivedReduce40: ParsedEffect = {
  trigger: 'onDamageReceived', conditions: [], rawText: 'damage received reduce',
  action: { type: 'damageReduce', params: { value: 40 } },
};
const lethalTurnEndDamage: ParsedEffect = {
  trigger: 'onTurnEnd', conditions: [], rawText: 'lethal turn end',
  action: { type: 'directDamage', params: { value: 120 } },
};
const lethalPendingDamage: ParsedEffect = {
  trigger: 'onUse', conditions: [], rawText: 'lethal pending',
  action: { type: 'directDamage', params: { value: 120 } },
};

function preparedState(): GameState {
  const G = setupGame();
  resolveJanken(G, 'rock', 'scissors');
  finishMulligan(G, 0, []);
  finishMulligan(G, 1, []);
  return G;
}

function parsedCardEffect(defId: string): ParsedEffect {
  const card = getAllCardDefs().find(item => item.id === defId);
  assert.ok(card, `missing card ${defId}`);
  const parsed = parseEffect(card.effect.split('\n')[0]);
  assert.ok(parsed, `effect did not parse for ${defId}`);
  return parsed;
}

function cardEffectText(defId: string): string {
  const card = getAllCardDefs().find(item => item.id === defId);
  assert.ok(card, `missing card ${defId}`);
  return card.effect.split('\n')[0];
}

function preparedAreaEnchantState(defId: string, chronosPosition: number): GameState {
  const G = preparedState();
  G.players[0].setZoneC = createInstance(defId, true);
  G.players[0].powerCharger = [createInstance('1st_9', true)];
  G.chronos.position = chronosPosition;
  return G;
}

function fivePowerCards() {
  return [
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
  ];
}

{
  const customIds = PRESET_DECKS.dark.ids;
  assert.equal(validateConstructedDeckIds(customIds), null);
  assert.equal(isValidConstructedDeck(customIds), true);

  assert.match(validateConstructedDeckIds(customIds.slice(0, 19)) ?? '', /exactly 20/);

  const unknown = [...customIds];
  unknown[0] = 'missing_card';
  assert.match(validateConstructedDeckIds(unknown) ?? '', /Unknown card/);

  const tooManyCopies = [...customIds];
  tooManyCopies[2] = tooManyCopies[0];
  assert.match(validateConstructedDeckIds(tooManyCopies) ?? '', /more than 2 copies/);

  const noCharacters = getAllCardDefs()
    .filter(card => card.type !== 'Character')
    .slice(0, 10)
    .flatMap(card => [card.id, card.id]);
  assert.equal(noCharacters.length, 20);
  // 官方「キャラクター50%推薦」非強制：無角色牌組應為合法（驗證通過），僅回傳警告。
  assert.equal(validateConstructedDeckIds(noCharacters), null);
  assert.match(getCharacterCountWarning(noCharacters) ?? '', /at least 10 Character/);

  const G = setupGame({ deck0Ids: customIds, deck1Ids: PRESET_DECKS.flame.ids });
  assert.deepEqual(
    [...G.players[0].hand, ...G.players[0].deck].map(card => card.defId).sort(),
    [...customIds].sort(),
  );
  assert.throws(() => setupGame({ deck0Name: 'custom' }), /requires deck IDs/);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.players[0].setZoneA = createInstance('1st_5', true);
  G.players[0].setZoneB = createInstance('1st_1', true);
  placeRevealedCards(G, false);
  assert.equal(G.players[0].setZoneA?.defId, '1st_5');
  assert.equal(G.players[0].battleZone?.defId, '1st_1');
}

{
  const multiplayer = Local();
  const player0 = Client({ game: ZutomayoCard, numPlayers: 2, playerID: '0', multiplayer });
  const player1 = Client({ game: ZutomayoCard, numPlayers: 2, playerID: '1', multiplayer });
  player0.start();
  player1.start();
  player0.moves.janken('rock');
  assert.equal(
    (player1.getState()?.G.actionLog ?? []).some(entry => entry.action === 'janken' && entry.player === 0),
    false,
  );
  player1.moves.janken('scissors');
  assert.equal(player0.getState()?.G.step, 'mulligan');
  assert.equal(player1.getState()?.G.step, 'mulligan');
  assert.deepEqual(
    (player0.getState()?.G.actionLog ?? []).filter(entry => entry.action === 'janken').map(entry => entry.payload),
    [{ choice: 'rock' }, { choice: 'scissors' }],
  );
  player0.moves.keepHand();
  player1.moves.keepHand();
  assert.equal(player0.getState()?.G.step, 'initialSet');
  player0.moves.setInitialCard(0);
  const opponentSetLog = (player1.getState()?.G.actionLog ?? [])
    .find(entry => entry.action === 'setInitialCard' && entry.player === 0);
  assert.deepEqual(opponentSetLog?.payload, { slot: 'A', faceDown: true });
  assert.equal(JSON.stringify(opponentSetLog).includes('defId'), false);
  player1.moves.setInitialCard(0);
  player0.moves.confirmReady();
  player1.moves.confirmReady();
  for (let i = 0; i < 20 && player0.getState()?.G.step === 'effectOrder'; i++) {
    const globalState = player0.getState()?.G;
    const pendingChoicePlayer = globalState?.pendingChoice?.player;
    if (pendingChoicePlayer === 0 || pendingChoicePlayer === 1) {
      const client = pendingChoicePlayer === 0 ? player0 : player1;
      const choice = client.getState()?.G.pendingChoice;
      assert.ok(choice);
      client.moves.submitPendingChoice(choice.options.slice(0, choice.min).map(option => option.id));
      continue;
    }
    const pendingPlayer = globalState?.pendingEffectPlayer;
    assert.notEqual(pendingPlayer, null);
    (pendingPlayer === 0 ? player0 : player1).moves.resolvePendingEffect(0);
  }
  assert.equal(player0.getState()?.G.step, 'turnSet');
  const actionLog = player0.getState()?.G.actionLog ?? [];
  assert.ok(actionLog.length >= 8);
  assert.ok(actionLog.some(entry => entry.action === 'mulligan' && entry.payload?.redrawnCount === 0));
  assert.ok(actionLog.some(entry => entry.action === 'confirmReady' && entry.player === 0));
  assert.ok(actionLog.every(entry => typeof entry.timestamp === 'number'));
  player0.stop();
  player1.stop();
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.players[0].battleZone = createInstance('1st_9', true);
  G.players[1].battleZone = createInstance('1st_9', true);
  assert.equal(executeEffect(boost, G, 0).success, true);
  resolveBattle(G);
  assert.equal(G.lastBattleResult.damage, 20);
  assert.equal(G.players[1].hp, 80);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.players[0].hp = 80;
  G.players[0].setZoneC = createInstance('2nd_5', true);
  G.players[0].powerCharger = [
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
  ];
  G.players[0].battleZone = createInstance('1st_9', true);
  G.players[1].battleZone = createInstance('1st_9', true);
  G.timingEvents.push({ type: 'zoneEntered', player: 1, zone: 'abyss', cardDefId: '1st_1' });
  const parsedEffects = new Map<string, ParsedEffect[]>([
    ['2nd_5', [turnEndDamage5, turnStartHeal10]],
  ]);
  resolveTurn(G, parsedEffects);
  assert.equal(G.step, 'turnSet');
  assert.equal(G.turnNumber, 3);
  assert.equal(G.players[1].hp, 95);
  assert.equal(G.players[0].hp, 90);
  assert.ok((G as any).timingEvents);
  assert.ok((G as any).timingEvents.some((event: any) => event.type === 'turnStart'));
  assert.equal((G as any).timingEvents.some((event: any) => event.type === 'turnEnd'), false);
  assert.equal((G as any).timingEvents.some((event: any) => event.type === 'zoneEntered' && event.zone === 'abyss'), false);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.players[0].battleZone = createInstance('1st_9', true);
  G.players[1].battleZone = createInstance('1st_17', true);
  G.players[1].setZoneC = createInstance('2nd_5', true);
  G.players[1].powerCharger = [
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
  ];
  const parsedEffects = new Map<string, ParsedEffect[]>([
    ['2nd_5', [damageReceivedHeal10]],
  ]);
  resolveTurn(G, parsedEffects);
  assert.equal(G.players[1].hp, 100 - G.lastBattleResult.damage + 10);
  assert.ok((G as any).timingEvents);
  assert.equal((G as any).timingEvents.some((event: any) => event.type === 'damageReceived'), false);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.players[0].battleZone = createInstance('1st_1', true);
  G.players[0].powerCharger = [
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
  ];
  G.players[1].battleZone = createInstance('1st_17', true);
  G.players[1].setZoneC = createInstance('2nd_5', true);
  G.players[1].powerCharger = [
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
  ];
  resolveTurn(G, new Map([['2nd_5', [damageReceivedReduce40]]]));
  assert.equal(G.lastBattleResult.damage, 80);
  assert.equal(G.players[1].hp, 20);
  assert.equal(G.step, 'turnSet');
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.players[0].setZoneC = createInstance('2nd_5', true);
  G.players[0].powerCharger = [
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
  ];
  G.players[0].battleZone = createInstance('1st_9', true);
  G.players[1].battleZone = createInstance('1st_9', true);
  resolveTurn(G, new Map([['2nd_5', [lethalTurnEndDamage]]]));
  assert.equal(G.players[1].hp, 0);
  assert.equal(G.step, 'gameOver');
  assert.equal(G.winner, 0);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.players[0].setZoneC = createInstance('2nd_5', true);
  G.players[0].powerCharger = [
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
  ];
  G.players[0].battleZone = createInstance('1st_9', true);
  G.players[1].battleZone = createInstance('1st_9', true);
  resolveTurn(G, new Map([['2nd_5', [turnStartBoost20]]]));
  assert.equal(G.step, 'turnSet');
  assert.equal(G.turnNumber, 3);
  G.players[0].hand = [createInstance('1st_9', true)];
  G.players[1].hand = [createInstance('1st_9', true)];
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);
  resolveTurn(G, new Map([['2nd_5', [turnStartBoost20]]]));
  assert.equal(G.lastBattleResult.damage, 20);
  assert.equal(G.players[1].hp, 80);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.chronos.position = 8;
  G.players[0].hand = [createInstance('1st_9', true)];
  G.players[1].hand = [createInstance('1st_17', true)];
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);

  const parsedEffects = new Map<string, ParsedEffect[]>([
    ['1st_9', [damage7, damage11]],
    ['1st_17', [damage13]],
  ]);
  resolveTurn(G, parsedEffects);
  assert.equal(G.step, 'effectOrder');
  assert.equal(G.turnNumber, 2);
  assert.equal(G.lastBattleResult.damage, 0);
  assert.equal((G as any).pendingEffectPlayer, 0);
  assert.equal((G as any).pendingEffects[0].length, 2);
  assert.equal((G as any).pendingEffects[1].length, 1);

  const resolvePendingEffect = (ZutomayoCard.moves as any).resolvePendingEffect;
  assert.equal(resolvePendingEffect({ G, playerID: '0' }, 1), undefined);
  const orderLog = G.actionLog.at(-1);
  assert.equal(orderLog?.action, 'chooseEffectOrder');
  assert.equal(orderLog?.payload?.index, 1);
  assert.ok(orderLog?.payload?.effectId);
  assert.equal(orderLog?.payload?.cardDefId, '1st_9');
  assert.equal(orderLog?.payload?.source, 'battleZone');
  assert.equal(G.players[1].hp, 89);
  assert.match(G.log.at(-1) ?? '', /Deal 11/);
  assert.equal((G as any).pendingEffects[0][0].rawText, 'deal 7 first');

  assert.equal(resolvePendingEffect({ G, playerID: '0' }, 0), undefined);
  assert.equal(G.players[1].hp, 82);
  assert.equal((G as any).pendingEffectPlayer, 1);
  assert.equal((G as any).pendingEffects[0].length, 0);
  assert.equal((G as any).pendingEffects[1].length, 1);
  assert.equal(G.step, 'effectOrder');

  assert.equal(resolvePendingEffect({ G, playerID: '0' }, 0), 'INVALID_MOVE');
  assert.equal(G.players[0].hp, 100);

  assert.equal(resolvePendingEffect({ G, playerID: '1' }, 0), undefined);
  assert.equal(G.players[0].hp, 87);
  assert.equal(G.players[1].hp, 42);
  assert.equal(G.lastBattleResult.damage, 40);
  assert.equal(G.step, 'turnSet');
  assert.equal(G.turnNumber, 3);
  assert.equal((G as any).pendingEffectPlayer, null);
  assert.deepEqual((G as any).pendingEffects, [[], []]);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.chronos.position = 0;
  G.chronos.nightSidePlayer = 0;
  G.lastBattleResult = { winner: null, damage: 0, winnerAttack: 0, loserAttack: 0 };
  G.players[0].powerCharger = fivePowerCards();
  G.players[0].hand = [createInstance('1st_5', true)];
  G.players[1].hand = [createInstance('1st_92', true)];
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);
  resolveTurn(G, new Map([
    ['1st_5', [parsedCardEffect('1st_5')]],
    ['1st_92', [parsedCardEffect('1st_92')]],
  ]));
  assert.equal(G.step, 'effectOrder');
  assert.equal((G as any).pendingEffects[0][0].effect.priority, 'late');
  assert.equal((G as any).pendingEffectPlayer, 1);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.chronos.position = 8;
  G.players[0].hand = [createInstance('1st_9', true)];
  G.players[1].hand = [createInstance('1st_17', true)];
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);
  resolveTurn(G, new Map([['1st_9', [lethalPendingDamage]]]));
  assert.equal(G.step, 'effectOrder');
  const resolvePendingEffect = (ZutomayoCard.moves as any).resolvePendingEffect;
  assert.equal(resolvePendingEffect({ G, playerID: '0' }, 0), undefined);
  assert.equal(G.players[1].hp, 0);
  assert.equal(G.step, 'gameOver');
  assert.equal(G.winner, 0);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.players[0].hand = [createInstance('1st_9', true)];
  G.players[1].hand = [createInstance('1st_17', true)];
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);
  resolveTurn(G, noEffects);
  assert.equal(G.step, 'turnSet');
  assert.equal(G.turnNumber, 3);
  assert.equal((G as any).pendingEffectPlayer, null);
  assert.deepEqual((G as any).pendingEffects, [[], []]);
}

{
  const G = preparedState();
  const costlyCard = createInstance('1st_1', true);
  processTurnEffects(G, new Map([['1st_1', [boost]]]), [[costlyCard], []]);
  assert.equal(G.modifiers.attack[0], 0);
}

{
  const G = preparedState();
  assert.equal(G.step, 'initialSet');
  assert.deepEqual(G.ready, [false, false]);
}

{
  const G = preparedState();
  G.players[0].hand = [createInstance('1st_5', true)]; // Enchant, clock 0
  G.players[1].hand = [createInstance('2nd_5', true)]; // Area Enchant, clock 1
  assert.equal(setInitialCard(G, 0, 0), true);
  assert.equal(setInitialCard(G, 1, 0), true);
  assert.equal(confirmReady(G, 0, noEffects), true);
  assert.equal(confirmReady(G, 1, noEffects), true);
  assert.equal(G.chronos.position, 1);
  assert.equal(G.players[0].battleZone, null);
  assert.equal(G.players[1].battleZone, null);
  assert.equal(G.players[0].abyss.length, 1);
  assert.equal(G.players[1].abyss.length, 1);
  assert.equal(G.step, 'turnSet');
  assert.equal(G.turnNumber, 2);
  assert.deepEqual(G.previousTurnCharacterElements, [null, null]);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.lastBattleResult = { winner: 0, damage: 0, winnerAttack: 0, loserAttack: 0 };
  G.players[1].hand = [createInstance('1st_1', true), createInstance('1st_5', true)];
  assert.equal(getRequiredSetCount(G, 1), 2);
  assert.equal(setTurnCard(G, 1, 0, 'B'), true);
  resolveTurn(G, noEffects);
  assert.equal(G.players[1].battleZone?.defId, '1st_1');
  assert.equal(G.timingEvents.some(event => event.type === 'zoneEntered' && event.player === 1 && event.zone === 'battleZone' && event.cardDefId === '1st_1'), false);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.players[0].battleZone = createInstance('1st_17', true);
  G.players[0].hand = [createInstance('1st_9', true)];
  G.players[1].hand = [createInstance('1st_9', true)];
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);
  resolveTurn(G, noEffects);
  assert.equal(G.players[0].battleZone?.defId, '1st_9');
  assert.equal(G.timingEvents.some(event => event.type === 'characterReplaced' && event.player === 0 && event.cardDefId === '1st_9' && event.replacedCardDefId === '1st_17'), false);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.players[0].battleZone = createInstance('1st_1', true);
  G.players[1].battleZone = createInstance('1st_1', true);
  G.players[0].deck = [];
  G.players[0].cardsSetThisTurn = 1;
  G.players[1].cardsSetThisTurn = 0;
  resolveTurn(G, noEffects);
  assert.equal(G.step, 'gameOver');
  assert.equal(G.winner, 1);
  assert.equal(G.players[0].hand.length, 5);
}

{
  const ids = ['2nd_26', '2nd_62', '3rd_26', '4th_2', '4th_55', '4th_59', '4th_73', '4th_75', '4th_93'];
  for (const id of ids) assert.ok(parsedCardEffect(id), `${id} should parse`);
  assert.deepEqual(parsedCardEffect('2nd_62').action, { type: 'addSettableCard', params: { count: 1, optional: true } });
  const taidadaEffect = parsedCardEffect('4th_55');
  assert.deepEqual(taidadaEffect.conditions, [{ type: 'namedCardInBattleZone', value: 'TAIDADA' }]);
  assert.deepEqual(taidadaEffect.action, { type: 'heal', params: { value: 20 } });
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.lastBattleResult = { winner: 0, damage: 0, winnerAttack: 0, loserAttack: 0 };
  G.players[0].hand = [createInstance('1st_1', true), createInstance('1st_9', true)];
  assert.equal(getRequiredSetCount(G, 0), 1);
  assert.equal(executeEffect(parsedCardEffect('2nd_62'), G, 0).success, true);
  assert.equal(getRequiredSetCount(G, 0), 2);
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 0, 0, 'B'), true);
  assert.equal(confirmReady(G, 0, noEffects), true);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.lastBattleResult = { winner: null, damage: 0, winnerAttack: 0, loserAttack: 0 };
  G.handSizeModifier[0] = 1;
  // handSizeModifier 計入回合抽牌數（保證手札淨 +N），不計入セット上限。
  assert.equal(getRequiredSetCount(G, 0), 1);
  G.players[0].cardsSetThisTurn = 1;
  assert.equal(endOfTurnDrawCount(G, 0), 2);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.lastBattleResult = { winner: null, damage: 0, winnerAttack: 0, loserAttack: 0 };
  G.players[0].hand = [createInstance('1st_9', true)];
  G.players[1].hand = [createInstance('1st_9', true)];
  G.players[0].deck = [createInstance('1st_1', false), createInstance('1st_5', false)];
  G.players[1].deck = [createInstance('1st_1', false)];
  G.modifiers.handSize[0] = 1;
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);
  resolveTurn(G, noEffects);
  assert.equal(G.players[0].hand.length, 2);
  assert.equal(G.players[1].hand.length, 1);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.lastBattleResult = { winner: 0, damage: 0, winnerAttack: 0, loserAttack: 0 };
  G.players[0].hand = [createInstance('1st_1', true), createInstance('1st_9', true)];
  assert.equal(executeEffect(parsedCardEffect('2nd_62'), G, 0).success, true);
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(confirmReady(G, 0, noEffects), true);
}

{
  assert.equal(parseEffect('ターンの終了時に相手のHP-10')?.trigger, 'onTurnEnd');
  assert.equal(parseEffect('ターンの開始時にHPを10回復')?.trigger, 'onTurnStart');
  assert.deepEqual(parseEffect('相手のエリアエンチャントが置かれているなら、すぐにアビスに置く')?.conditions, [{ type: 'hasAreaEnchant', value: true, target: 'opponent' }]);
  assert.deepEqual(parseEffect('HPが50以下になったなら、パワーチャージャーに置く')?.action, { type: 'moveSelfAreaEnchant', params: { destination: 'powerCharger' } });
  assert.equal(parseEffect('HPが50以下になったなら、パワーチャージャーに置く')?.trigger, 'onDamageReceived');
  assert.deepEqual(parseEffect('パワーチャージャーにカードが５枚以上置かれているなら、すぐにアビスに置く')?.conditions, [
    { type: 'zoneCountComparison', value: 5, operator: 'gte', target: 'powerCharger', owner: 'self' },
  ]);
  assert.equal(parseEffect('相手のアビスにカードが置かれたとき、すぐにこのカードをアビスに置く')?.trigger, 'onZoneEntered');
  assert.equal(parseEffect('パワーチャージャーにカードを置いたとき、すぐにこのカードをアビスに置く')?.trigger, 'onZoneEntered');
  assert.deepEqual(parseEffect('バトルに負けたとき、すぐにアビスに置く')?.conditions, [{ type: 'battleLost', value: true }]);
  assert.deepEqual(parseEffect('相手のキャラクターカードの時計を無効にする。昼と夜が入れ替わったターンの終了時にアビスに置く')?.action, { type: 'nullifyOpponentClock', params: {} });
  assert.equal(parseEffect('パワーチャージャーの電気属性のカード１枚につき、攻撃力+20。相手のHPが30以下になったターンの終了時にアビスに置く')?.trigger, 'onUse');
  assert.equal(parseEffect('相手のキャラクターカードの時計を無効にする。昼と夜が入れ替わったターンの終了時にアビスに置く')?.trigger, 'onUse');
  assert.equal(parsedCardEffect('1st_5').priority, 'late');
  const allParsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  const areaExpiryEffects = allParsedEffects.get('2nd_5') ?? [];
  assert.ok(areaExpiryEffects.some(effect => effect.trigger === 'onTurnEnd' && effect.action.type === 'moveSelfAreaEnchant'));
  const chronosExpiryEffects = allParsedEffects.get('2nd_86') ?? [];
  assert.ok(chronosExpiryEffects.some(effect => effect.trigger === 'onChronosChanged' && effect.action.type === 'moveSelfAreaEnchant'));
  const zoneEntryExpiryEffects = allParsedEffects.get('4th_30') ?? [];
  assert.equal(zoneEntryExpiryEffects.filter(effect => effect.rawText.includes('相手のアビスにカードが置かれたとき')).length, 1);
  const returnAreaAndExpireEffects = allParsedEffects.get('3rd_55') ?? [];
  assert.ok(returnAreaAndExpireEffects.some(effect => effect.action.type === 'returnAreaEnchantToDeck'));
  assert.ok(returnAreaAndExpireEffects.some(effect => effect.action.type === 'moveSelfAreaEnchant' && effect.trigger === 'onTurnEnd'));

  const priorityAreaExpiryIds = ['2nd_5', '2nd_86', '2nd_98', '3rd_58', '3rd_85', '3rd_86', '3rd_91', '3rd_92', '3rd_98', '3rd_104'];
  for (const id of priorityAreaExpiryIds) {
    const parsed = parseEffect(cardEffectText(id));
    assert.ok(parsed?.expiry, `${id} should expose secondary expiry metadata`);
    assert.equal(parsed.expiry.action.type, 'moveSelfAreaEnchant', `${id} expiry should move its Area Enchant`);
    assert.ok(allParsedEffects.get(id)?.some(effect => (
      effect.action.type === 'moveSelfAreaEnchant'
      && effect.trigger === parsed.expiry?.trigger
    )), `${id} expiry should be emitted by parseAllEffects`);
  }
  assert.deepEqual(parseEffect(cardEffectText('2nd_86'))?.expiry?.conditions, [{ type: 'chronos', value: 'day' }]);
  assert.deepEqual(parseEffect(cardEffectText('2nd_98'))?.expiry?.conditions, [{ type: 'chronos', value: 'night' }]);
  assert.deepEqual(parseEffect(cardEffectText('3rd_58'))?.expiry?.conditions, [{ type: 'damageAtLeast', value: 30 }]);
  assert.deepEqual(parseEffect(cardEffectText('3rd_58'))?.action, { type: 'healBoth', params: { value: 10 } });
  assert.deepEqual(parseEffect(cardEffectText('3rd_91'))?.expiry?.conditions, [{ type: 'zoneEntered', value: 'abyss', target: 'opponent' }]);

  const healBothState = preparedState();
  healBothState.players[0].hp = 80;
  healBothState.players[1].hp = 95;
  const healBothEffect = parseEffect(cardEffectText('3rd_58'));
  assert.ok(healBothEffect);
  assert.equal(executeEffect(healBothEffect, healBothState, 0).success, true);
  assert.equal(healBothState.players[0].hp, 90);
  assert.equal(healBothState.players[1].hp, 100);

  const opponentHealThenDamage = parseEffect(cardEffectText('3rd_27'));
  assert.deepEqual(opponentHealThenDamage?.action, { type: 'healOpponent', params: { value: 50 } });
  assert.deepEqual(opponentHealThenDamage?.expiry?.action, { type: 'directDamage', params: { value: 50 } });
  const opponentHealThenDamageEffects = allParsedEffects.get('3rd_27') ?? [];
  assert.equal(opponentHealThenDamageEffects.length, 2);
  assert.ok(opponentHealThenDamageEffects.some(effect => effect.trigger === 'onTurnEnd' && effect.action.type === 'directDamage'));
  const opponentHealState = preparedState();
  opponentHealState.players[1].hp = 40;
  assert.equal(executeEffect(opponentHealThenDamage!, opponentHealState, 0).success, true);
  assert.equal(opponentHealState.players[1].hp, 90);

  const returnAreaState = preparedState();
  const opponentArea = createInstance('2nd_5', true);
  returnAreaState.players[1].setZoneC = opponentArea;
  const returnAreaEffect = parseEffect('相手のエリアエンチャントをデッキの底に戻し、以後相手はエリアエンチャントをセットできない。相手がアビスにカードを置いたターンの終了時にパワーチャージャーに置く');
  assert.ok(returnAreaEffect);
  assert.deepEqual(returnAreaEffect.action, { type: 'returnAreaEnchantToDeck', params: { target: 'opponent', position: 'bottom', lockAreaEnchant: true } });
  assert.equal(executeEffect(returnAreaEffect, returnAreaState, 0).success, true);
  assert.equal(returnAreaState.players[1].setZoneC, null);
  assert.equal(returnAreaState.players[1].deck.at(-1)?.instanceId, opponentArea.instanceId);
  assert.equal(returnAreaState.areaEnchantSetLocked[1], true);
  returnAreaState.step = 'turnSet';
  returnAreaState.ready[1] = false;
  returnAreaState.players[1].hand = [createInstance('2nd_5', true)];
  assert.equal(setTurnCard(returnAreaState, 1, 0, 'A'), false);

  const revealOpponentHand = parseEffect('相手の手札を公開する');
  assert.deepEqual(revealOpponentHand?.action, { type: 'revealOpponentHand', params: {} });
  const revealOpponentHandState = preparedState();
  const hiddenOpponentHandCard = createInstance('1st_4', false);
  revealOpponentHandState.players[1].hand = [hiddenOpponentHandCard];
  assert.equal(executeEffect(revealOpponentHand!, revealOpponentHandState, 0).success, true);
  assert.deepEqual(revealOpponentHandState.revealedHandCardIds[1], [hiddenOpponentHandCard.instanceId]);
  const revealedHandView = ZutomayoCard.playerView!({ G: revealOpponentHandState, ctx: {} as any, playerID: '0' }) as GameState;
  assert.equal(revealedHandView.players[1].hand[0].defId, hiddenOpponentHandCard.defId);

  const handAbyssSwap = parseEffect('手札１枚とアビスの好きなカード１枚を入れ替える');
  assert.deepEqual(handAbyssSwap?.action, { type: 'requestChoice', params: { choiceType: 'handAbyssSwap' } });
  const handAbyssSwapState = preparedState();
  const swapHandCard = createInstance('1st_9', false);
  const swapAbyssCard = createInstance('1st_17', true);
  handAbyssSwapState.players[0].hand = [swapHandCard];
  handAbyssSwapState.players[0].abyss = [swapAbyssCard];
  assert.equal(executeEffect(handAbyssSwap!, handAbyssSwapState, 0).success, true);
  assert.equal(handAbyssSwapState.pendingChoice?.type, 'handAbyssSwap');
  assert.deepEqual(handAbyssSwapState.pendingChoice?.options.map(option => option.id), [`hand:${swapHandCard.instanceId}`, `abyss:${swapAbyssCard.instanceId}`]);
  assert.equal(submitPendingChoice(handAbyssSwapState, 0, [`hand:${swapHandCard.instanceId}`, `hand:${swapHandCard.instanceId}`], noEffects), false);
  assert.equal(submitPendingChoice(handAbyssSwapState, 0, [`hand:${swapHandCard.instanceId}`, `abyss:${swapAbyssCard.instanceId}`], noEffects), true);
  assert.equal(handAbyssSwapState.players[0].hand.at(-1)?.instanceId, swapAbyssCard.instanceId);
  assert.equal(handAbyssSwapState.players[0].abyss.at(-1)?.instanceId, swapHandCard.instanceId);
  assert.equal(swapHandCard.faceUp, true);
  assert.equal(swapAbyssCard.faceUp, true);

  const extraEnchantThenDraw = parseEffect(cardEffectText('2nd_15'));
  assert.deepEqual(extraEnchantThenDraw?.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'useFromHand',
      sourceOwner: 'self',
      sourceZone: 'hand',
      filterCardType: 'Enchant',
      max: 1,
      optional: true,
      followUpDrawCount: 1,
    },
  });
  const extraEnchantThenDrawState = preparedState();
  const extraHandEnchant = createInstance('1st_30', true);
  extraEnchantThenDrawState.players[0].hand = [extraHandEnchant];
  extraEnchantThenDrawState.players[0].powerCharger = fivePowerCards();
  extraEnchantThenDrawState.previousTurnCharacterElements[0] = '闇';
  extraEnchantThenDrawState.chronos.position = CHRONOS_MAPPING.noon;
  assert.equal(executeEffect(extraEnchantThenDraw!, extraEnchantThenDrawState, 0).success, true);
  assert.equal(extraEnchantThenDrawState.pendingChoice?.type, 'useFromHand');
  const extraEnchantParsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  assert.equal(submitPendingChoice(extraEnchantThenDrawState, 0, [extraHandEnchant.instanceId], extraEnchantParsedEffects), true);
  assert.equal(extraEnchantThenDrawState.players[0].hand.length, 0);
  assert.equal(extraEnchantThenDrawState.players[0].abyss.at(-1)?.instanceId, extraHandEnchant.instanceId);
  assert.equal(extraEnchantThenDrawState.pendingEffects[0][0]?.effect.action.type, 'boostAttack');
  assert.deepEqual(extraEnchantThenDrawState.pendingEffects[0][1]?.effect.action, { type: 'drawCards', params: { value: 1 } });

  const rewindByOpponentClock = parseEffect('このターンのはじまりの時間から相手の時計分、時間が戻る');
  assert.deepEqual(rewindByOpponentClock?.action, { type: 'clockSetFromTurnStartMinusOpponentClock', params: {} });
  const rewindByOpponentClockState = preparedState();
  rewindByOpponentClockState.chronosAtTurnStart = 3;
  rewindByOpponentClockState.chronos.position = 8;
  rewindByOpponentClockState.players[1].battleZone = createInstance('1st_1', true);
  assert.equal(executeEffect(rewindByOpponentClock!, rewindByOpponentClockState, 0).success, true);
  assert.equal(rewindByOpponentClockState.chronos.position, 10);

  const nullifyOpponentClock = parseEffect('相手のキャラクターカードの時計を無効にする。昼と夜が入れ替わったターンの終了時にアビスに置く');
  assert.deepEqual(nullifyOpponentClock?.action, { type: 'nullifyOpponentClock', params: {} });
  const rewindOpponentCharacterClockState = preparedState();
  const opponentPlayedCharacter = createInstance('1st_9', true);
  rewindOpponentCharacterClockState.chronos.position = 7;
  rewindOpponentCharacterClockState.setCardsThisTurn[1] = [opponentPlayedCharacter];
  assert.equal(getAllCardDefs().find(card => card.id === opponentPlayedCharacter.defId)?.clock, 1);
  assert.equal(executeEffect(nullifyOpponentClock!, rewindOpponentCharacterClockState, 0).success, true);
  assert.equal(rewindOpponentCharacterClockState.chronos.position, 6);
  assert.equal(rewindOpponentCharacterClockState.modifiers.clockContributionDisabled[1], true);

  const disabledClockAdvanceState = preparedState();
  disabledClockAdvanceState.chronos.position = 4;
  disabledClockAdvanceState.modifiers.clockContributionDisabled[1] = true;
  disabledClockAdvanceState.setCardsThisTurn[1] = [createInstance('1st_9', true)];
  advanceChronos(disabledClockAdvanceState, noEffects);
  assert.equal(disabledClockAdvanceState.chronos.position, 4);

  const boostBothByHp = parseEffect('お互いの自分のHPの分だけ攻撃力+。相手のHPが40以下になったターンの終了時にアビスに置く');
  assert.deepEqual(boostBothByHp?.action, { type: 'boostBothAttackByOwnHp', params: {} });
  const boostBothByHpState = preparedState();
  boostBothByHpState.players[0].hp = 70;
  boostBothByHpState.players[1].hp = 40;
  assert.equal(executeEffect(boostBothByHp!, boostBothByHpState, 0).success, true);
  assert.deepEqual(boostBothByHpState.modifiers.attack, [70, 40]);

  const setOpponentAttackTo100 = parseEffect('バトルゾーンのカードが（猫リセット）のキャラクターなら、相手の攻撃力を100にする');
  assert.deepEqual(setOpponentAttackTo100?.conditions, [{ type: 'namedCardInBattleZone', value: '猫リセット' }]);
  assert.deepEqual(setOpponentAttackTo100?.action, { type: 'setOpponentAttack', params: { value: 100 } });
  const setOpponentAttackState = preparedState();
  setOpponentAttackState.chronos.position = 6;
  setOpponentAttackState.players[0].battleZone = createInstance('1st_12', true);
  setOpponentAttackState.players[1].battleZone = createInstance('2nd_20', true);
  setOpponentAttackState.players[1].powerCharger = [createInstance('1st_9', true), createInstance('1st_13', true), createInstance('1st_14', true), createInstance('1st_17', true)];
  assert.equal(executeEffect(setOpponentAttackTo100!, setOpponentAttackState, 0).success, true);
  assert.equal(getEffectiveAttack(setOpponentAttackState.players[1].battleZone, setOpponentAttackState, 1), 100);

  const setAllClocksToOne = parseEffect('すべてのカードの時計を１にする。ターンの終了時に、相手のフィールドにエリアエンチャントがあるならパワーチャージャーに置く');
  assert.deepEqual(setAllClocksToOne?.action, { type: 'setAllCardClocks', params: { value: 1 } });
  const setAllClocksState = preparedState();
  setAllClocksState.players[0].setZoneA = createInstance('1st_1', true);
  setAllClocksState.players[1].setZoneA = createInstance('1st_43', true);
  setAllClocksState.setCardsThisTurn = [[setAllClocksState.players[0].setZoneA], [setAllClocksState.players[1].setZoneA]];
  assert.equal(executeEffect(setAllClocksToOne!, setAllClocksState, 0).success, true);
  advanceChronos(setAllClocksState, noEffects);
  assert.equal(setAllClocksState.chronos.position, 2);

  const forceDayAttack = parseEffect('このカードを使用中、自分の攻撃力は常に昼の攻撃力となる。相手がエリアエンチャントを出したターンの終了時にアビスに置く');
  assert.deepEqual(forceDayAttack?.action, { type: 'forceOwnAttackTime', params: { value: 'day' } });
  const forceDayAttackState = preparedState();
  forceDayAttackState.chronos.nightSidePlayer = 0;
  forceDayAttackState.chronos.position = 0;
  forceDayAttackState.players[0].battleZone = createInstance('1st_12', true);
  forceDayAttackState.players[0].powerCharger = [createInstance('1st_9', true), createInstance('1st_13', true), createInstance('1st_14', true)];
  assert.equal(getEffectiveAttack(forceDayAttackState.players[0].battleZone, forceDayAttackState, 0), 100);
  assert.equal(executeEffect(forceDayAttack!, forceDayAttackState, 0).success, true);
  assert.equal(getEffectiveAttack(forceDayAttackState.players[0].battleZone, forceDayAttackState, 0), 60);

  const selfSwapAttack = parseEffect('自分の基礎攻撃力を昼夜逆転する');
  const opponentSwapAttack = parseEffect('相手の攻撃力を昼夜逆転する');
  assert.deepEqual(selfSwapAttack?.action, { type: 'swapAttack', params: { target: 'self' } });
  assert.deepEqual(opponentSwapAttack?.action, { type: 'swapAttack', params: { target: 'opponent' } });
  const swapAttackState = preparedState();
  swapAttackState.chronos.position = 0;
  swapAttackState.players[0].battleZone = createInstance('1st_12', true);
  swapAttackState.players[1].battleZone = createInstance('1st_12', true);
  swapAttackState.players[0].powerCharger = fivePowerCards();
  swapAttackState.players[1].powerCharger = fivePowerCards();
  assert.equal(getEffectiveAttack(swapAttackState.players[0].battleZone, swapAttackState, 0), 100);
  assert.equal(executeEffect(selfSwapAttack!, swapAttackState, 0).success, true);
  assert.equal(getEffectiveAttack(swapAttackState.players[0].battleZone, swapAttackState, 0), 60);
  assert.equal(getEffectiveAttack(swapAttackState.players[1].battleZone, swapAttackState, 1), 100);
  assert.equal(executeEffect(opponentSwapAttack!, swapAttackState, 0).success, true);
  assert.equal(getEffectiveAttack(swapAttackState.players[1].battleZone, swapAttackState, 1), 60);

  const opponentDeckTopPowerToPower = parseEffect('相手はターンの開始時にデッキの一番上を公開する。パワーコストが６以上のカードが山札から公開されたらパワーチャージャーに置く');
  assert.equal(opponentDeckTopPowerToPower?.trigger, 'onTurnStart');
  assert.deepEqual(opponentDeckTopPowerToPower?.action, { type: 'moveOpponentDeckTopByPowerCost', params: { minPowerCost: 6, destination: 'powerCharger' } });
  const opponentDeckTopPowerState = preparedState();
  const costlyDeckTop = createInstance('2nd_20', false);
  opponentDeckTopPowerState.players[1].deck = [costlyDeckTop, createInstance('1st_12', false)];
  assert.equal(executeEffect(opponentDeckTopPowerToPower!, opponentDeckTopPowerState, 0).success, true);
  assert.equal(opponentDeckTopPowerState.players[1].deck[0].defId, '1st_12');
  assert.equal(opponentDeckTopPowerState.players[1].powerCharger.at(-1)?.instanceId, costlyDeckTop.instanceId);
  assert.equal(costlyDeckTop.faceUp, true);

  const useNamedCharacterFromPowerCharger = parseEffect('パワーチャージャーにある（シェードの埃は延長）のキャラクターを１枚選び、このカードの効果として使用する。');
  assert.deepEqual(useNamedCharacterFromPowerCharger?.action, {
    type: 'useFromAbyss',
    params: { source: 'powerCharger', song: 'シェードの埃は延長', cardType: 'Character', count: 1 },
  });

  const hpSelfMoveState = preparedState();
  hpSelfMoveState.players[0].hp = 50;
  const hpSelfMoveCard = createInstance('4th_91', true);
  hpSelfMoveState.players[0].setZoneC = hpSelfMoveCard;
  const hpSelfMove = parseEffect('HPが50以下になったなら、パワーチャージャーに置く');
  assert.ok(hpSelfMove);
  assert.equal(executeEffect(hpSelfMove, hpSelfMoveState, 0).success, true);
  assert.equal(hpSelfMoveState.players[0].setZoneC, null);
  assert.equal(hpSelfMoveState.players[0].powerCharger.at(-1)?.instanceId, hpSelfMoveCard.instanceId);

  const opponentAreaSelfMoveState = preparedState();
  const opponentAreaSelfMoveCard = createInstance('4th_32', true);
  opponentAreaSelfMoveState.players[0].setZoneC = opponentAreaSelfMoveCard;
  opponentAreaSelfMoveState.players[1].setZoneC = createInstance('2nd_5', true);
  const opponentAreaSelfMove = parseEffect('相手のエリアエンチャントが置かれているなら、すぐにアビスに置く');
  assert.ok(opponentAreaSelfMove);
  assert.equal(executeEffect(opponentAreaSelfMove, opponentAreaSelfMoveState, 0).success, true);
  assert.equal(opponentAreaSelfMoveState.players[0].setZoneC, null);
  assert.equal(opponentAreaSelfMoveState.players[0].abyss.at(-1)?.instanceId, opponentAreaSelfMoveCard.instanceId);

  const battleLostSelfMoveState = preparedState();
  const battleLostSelfMoveCard = createInstance('4th_95', true);
  battleLostSelfMoveState.players[0].setZoneC = battleLostSelfMoveCard;
  battleLostSelfMoveState.lastBattleResult = { winner: 1, damage: 20, winnerAttack: 50, loserAttack: 30 };
  const battleLostSelfMove = parseEffect('バトルに負けたとき、すぐにアビスに置く');
  assert.ok(battleLostSelfMove);
  assert.equal(executeEffect(battleLostSelfMove, battleLostSelfMoveState, 0).success, true);
  assert.equal(battleLostSelfMoveState.players[0].setZoneC, null);
  assert.equal(battleLostSelfMoveState.players[0].abyss.at(-1)?.instanceId, battleLostSelfMoveCard.instanceId);

  const battleLostTimingState = preparedState();
  const battleLostTimingCard = createInstance('4th_95', true);
  battleLostTimingState.chronos.position = 0;
  battleLostTimingState.players[0].battleZone = createInstance('1st_9', true);
  battleLostTimingState.players[1].battleZone = createInstance('1st_12', true);
  battleLostTimingState.players[0].setZoneC = battleLostTimingCard;
  battleLostTimingState.players[0].powerCharger = fivePowerCards();
  battleLostTimingState.players[1].powerCharger = fivePowerCards();
  resolveBattle(battleLostTimingState, allParsedEffects);
  assert.equal(battleLostTimingState.lastBattleResult.winner, 1);
  assert.equal(battleLostTimingState.players[0].setZoneC, null);
  assert.equal(battleLostTimingState.players[0].abyss.at(-1)?.instanceId, battleLostTimingCard.instanceId);

  const changedAwayState = preparedState();
  const changedAwayArea = createInstance('4th_65', true);
  const changedAwayCharacter = createInstance('1st_12', true);
  changedAwayState.players[0].battleZone = createInstance('2nd_9', true);
  changedAwayState.players[0].setZoneA = changedAwayCharacter;
  changedAwayState.players[0].setZoneC = changedAwayArea;
  changedAwayState.players[0].powerCharger = fivePowerCards();
  changedAwayState.setCardsThisTurn[0] = [changedAwayCharacter];
  placeRevealedCards(changedAwayState, false, allParsedEffects);
  assert.equal(changedAwayState.players[0].setZoneC, null);
  assert.equal(changedAwayState.players[0].abyss.at(-1)?.instanceId, changedAwayArea.instanceId);

  assert.notEqual(parseEffect('相手のアビスのカードを1枚選んでデッキの底に戻させる')?.action.type, 'drawCards');
  assert.notEqual(parseEffect('手札を１枚選んでデッキの底に置き、カードを１枚引く')?.action.type, 'drawCards');
  assert.notEqual(parseEffect('アビスに炎属性のカードが２枚以上あるなら、時計が真夜中になる')?.action.type, 'drawCards');
  assert.notEqual(parseEffect('パワーチャージャーにカードが５枚以上置かれているなら、すぐにアビスに置く')?.action.type, 'drawCards');
  const handBottomDraw = parseEffect('手札を１枚選んでデッキの底に置き、カードを１枚引く');
  assert.deepEqual(handBottomDraw?.action, { type: 'requestChoice', params: { choiceType: 'handToDeckBottomThenDraw', discardCount: 1, drawCount: 1 } });

  const choiceState = preparedState();
  choiceState.players[0].hand = [createInstance('1st_9', true), createInstance('1st_17', true)];
  const chosen = choiceState.players[0].hand[0].instanceId;
  assert.ok(handBottomDraw);
  assert.equal(executeEffect(handBottomDraw, choiceState, 0).success, true);
  assert.equal(choiceState.pendingChoice?.player, 0);
  assert.equal(choiceState.pendingChoice?.options.length, 2);
  assert.equal(submitPendingChoice(choiceState, 0, [chosen], noEffects), true);
  assert.equal(choiceState.pendingChoice, null);
  assert.equal(choiceState.players[0].hand.length, 2);
  assert.equal(choiceState.players[0].deck.at(-1)?.instanceId, chosen);

  const duplicateChoiceState = preparedState();
  duplicateChoiceState.players[0].hand = [createInstance('1st_9', true), createInstance('1st_17', true)];
  const handBottomDrawTwo = parseEffect('手札を２枚選んでデッキの底に置き、カードを２枚引く');
  assert.ok(handBottomDrawTwo);
  assert.equal(executeEffect(handBottomDrawTwo, duplicateChoiceState, 0).success, true);
  assert.equal(submitPendingChoice(
    duplicateChoiceState,
    0,
    [duplicateChoiceState.players[0].hand[0].instanceId, duplicateChoiceState.players[0].hand[0].instanceId],
    noEffects,
  ), false);

  for (const [id, discardCount, drawCount] of [
    ['2nd_27', 2, 2],
    ['2nd_31', 2, 2],
    ['2nd_82', 1, 1],
    ['2nd_94', 1, 1],
  ] as const) {
    assert.deepEqual(parsedCardEffect(id).action, {
      type: 'requestChoice',
      params: { choiceType: 'handToDeckBottomThenDraw', discardCount, drawCount },
    }, `${id} should use the hand-to-deck-bottom pending choice`);
  }

  assert.deepEqual(parsedCardEffect('4th_61').action, {
    type: 'requestChoice',
    params: {
      choiceType: 'optionalHandMoveThenDraw',
      sourceOwner: 'self',
      sourceZone: 'hand',
      destinationOwner: 'self',
      destinationZone: 'deck',
      destinationPosition: 'bottom',
      drawCount: 'selected',
    },
  });
  assert.deepEqual(parsedCardEffect('4th_62').action, {
    type: 'requestChoice',
    params: {
      choiceType: 'optionalHandMoveThenDraw',
      sourceOwner: 'self',
      sourceZone: 'hand',
      destinationOwner: 'self',
      destinationZone: 'abyss',
      drawCount: 'selected',
      filterElement: '闇',
    },
  });
  assert.deepEqual(parsedCardEffect('4th_63').action, {
    type: 'requestChoice',
    params: {
      choiceType: 'optionalHandMoveThenDraw',
      sourceOwner: 'self',
      sourceZone: 'hand',
      destinationOwner: 'self',
      destinationZone: 'abyss',
      drawCount: 'selected',
      filterElement: '炎',
    },
  });

  const drawFromDeck = parseEffect('デッキから１枚カードを引き、手札に加える');
  assert.deepEqual(drawFromDeck?.action, { type: 'drawCards', params: { value: 1 } });
  assert.deepEqual(parsedCardEffect('1st_92').action, { type: 'drawCards', params: { value: 1 } });

  const handToAbyss = parseEffect('手札からパワーの有無に関わらずカード１枚を選び、アビスに置く。');
  assert.deepEqual(handToAbyss?.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'cardMove',
      count: 1,
      sourceOwner: 'self',
      sourceZone: 'hand',
      destinationOwner: 'self',
      destinationZone: 'abyss',
    },
  });
  assert.deepEqual(parsedCardEffect('3rd_31').action, handToAbyss?.action);
  const handToAbyssState = preparedState();
  handToAbyssState.players[0].hand = [createInstance('1st_9', true), createInstance('1st_17', true)];
  const handToAbyssChosen = handToAbyssState.players[0].hand[0].instanceId;
  assert.ok(handToAbyss);
  assert.equal(executeEffect(handToAbyss, handToAbyssState, 0).success, true);
  assert.equal(handToAbyssState.pendingChoice?.type, 'cardMove');
  assert.equal(handToAbyssState.pendingChoice?.options.length, 2);
  assert.equal(submitPendingChoice(handToAbyssState, 0, [handToAbyssChosen], noEffects), true);
  assert.equal(handToAbyssState.players[0].abyss.at(-1)?.instanceId, handToAbyssChosen);
  assert.equal(handToAbyssState.players[0].hand.length, 1);

  const abyssElectricDamage = parsedCardEffect('2nd_50');
  assert.deepEqual(abyssElectricDamage.conditions, [{ type: 'zoneHasElement', value: '電気', target: 'abyss' }]);
  assert.deepEqual(abyssElectricDamage.action, { type: 'directDamage', params: { value: 20 } });
  const abyssElectricNoopState = preparedState();
  abyssElectricNoopState.players[0].abyss = [createInstance('1st_4', true)];
  assert.deepEqual(executeEffect(abyssElectricDamage, abyssElectricNoopState, 0), { success: false, message: 'Condition not met' });
  assert.equal(abyssElectricNoopState.players[1].hp, 100);
  const abyssElectricState = preparedState();
  abyssElectricState.players[0].abyss = [createInstance('1st_3', true)];
  assert.equal(executeEffect(abyssElectricDamage, abyssElectricState, 0).success, true);
  assert.equal(abyssElectricState.players[1].hp, 80);

  const deckTopByPower = parsedCardEffect('2nd_41');
  assert.deepEqual(deckTopByPower.conditions, [{ type: 'previousCharElement', value: '闇' }]);
  assert.deepEqual(deckTopByPower.action, { type: 'moveOwnDeckTopByPower', params: {} });
  const deckTopNoopState = preparedState();
  deckTopNoopState.previousTurnCharacterElements[0] = '炎';
  deckTopNoopState.players[0].deck = [createInstance('1st_17', false)];
  assert.deepEqual(executeEffect(deckTopByPower, deckTopNoopState, 0), { success: false, message: 'Condition not met' });
  assert.equal(deckTopNoopState.players[0].deck.length, 1);
  const deckTopPowerState = preparedState();
  deckTopPowerState.previousTurnCharacterElements[0] = '闇';
  const powerTop = createInstance('1st_17', false);
  deckTopPowerState.players[0].deck = [powerTop];
  assert.equal(executeEffect(deckTopByPower, deckTopPowerState, 0).success, true);
  assert.equal(deckTopPowerState.players[0].deck.length, 0);
  assert.equal(deckTopPowerState.players[0].powerCharger.at(-1)?.instanceId, powerTop.instanceId);
  assert.equal(powerTop.faceUp, true);
  assert.ok(deckTopPowerState.timingEvents.some(event => (
    event.type === 'zoneEntered'
    && event.player === 0
    && event.zone === 'powerCharger'
    && event.cardDefId === powerTop.defId
  )));
  const powerEntryParsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  const powerEntryAreaState = preparedAreaEnchantState('4th_33', 0);
  powerEntryAreaState.previousTurnCharacterElements[0] = '闇';
  powerEntryAreaState.players[0].deck = [createInstance('1st_9', false)];
  assert.equal(executeEffect(deckTopByPower, powerEntryAreaState, 0, {
    onTimingEvent: event => resolveTimingEvent(powerEntryAreaState, powerEntryParsedEffects, event),
  }).success, true);
  assert.equal(powerEntryAreaState.players[0].setZoneC, null);
  assert.equal(powerEntryAreaState.players[0].abyss.at(-1)?.defId, '4th_33');

  const opponentDeckTopPowerEntryState = preparedAreaEnchantState('4th_33', 0);
  opponentDeckTopPowerEntryState.players[0].powerCharger = fivePowerCards();
  const costlyOpponentTop = createInstance('2nd_20', false);
  opponentDeckTopPowerEntryState.players[1].deck = [costlyOpponentTop];
  const opponentDeckTopPowerToPowerEffect: ParsedEffect = {
    trigger: 'onUse',
    conditions: [],
    rawText: 'move opposing deck top by power cost',
    action: { type: 'moveOpponentDeckTopByPowerCost', params: { minPowerCost: 6 } },
  };
  assert.equal(executeEffect(opponentDeckTopPowerToPowerEffect, opponentDeckTopPowerEntryState, 0, {
    onTimingEvent: event => resolveTimingEvent(opponentDeckTopPowerEntryState, powerEntryParsedEffects, event),
  }).success, true);
  assert.equal(opponentDeckTopPowerEntryState.players[1].powerCharger.at(-1)?.instanceId, costlyOpponentTop.instanceId);
  assert.equal(opponentDeckTopPowerEntryState.players[0].setZoneC, null);
  assert.equal(opponentDeckTopPowerEntryState.players[0].abyss.at(-1)?.defId, '4th_33');
  const deckTopAbyssState = preparedState();
  deckTopAbyssState.previousTurnCharacterElements[0] = '闇';
  const noPowerTop = createInstance('1st_1', false);
  deckTopAbyssState.players[0].deck = [noPowerTop];
  assert.equal(executeEffect(deckTopByPower, deckTopAbyssState, 0).success, true);
  assert.equal(deckTopAbyssState.players[0].abyss.at(-1)?.instanceId, noPowerTop.instanceId);
  assert.equal(noPowerTop.faceUp, true);
  const deckTopEmptyState = preparedState();
  deckTopEmptyState.previousTurnCharacterElements[0] = '闇';
  deckTopEmptyState.players[0].deck = [];
  assert.equal(executeEffect(deckTopByPower, deckTopEmptyState, 0).success, false);
  assert.equal(deckTopEmptyState.step, 'gameOver');
  assert.equal(deckTopEmptyState.winner, 1);

  const opponentAbyssReturn = parsedCardEffect('4th_90');
  assert.deepEqual(opponentAbyssReturn.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'cardMove',
      count: 1,
      sourceOwner: 'opponent',
      sourceZone: 'abyss',
      destinationOwner: 'opponent',
      destinationZone: 'deck',
      destinationPosition: 'bottom',
    },
  });
  const opponentAbyssReturnState = preparedState();
  const returnedAbyssCard = createInstance('1st_4', true);
  const untouchedAbyssCard = createInstance('1st_3', true);
  opponentAbyssReturnState.players[1].abyss = [returnedAbyssCard, untouchedAbyssCard];
  opponentAbyssReturnState.players[1].deck = [createInstance('1st_9', false)];
  assert.equal(executeEffect(opponentAbyssReturn, opponentAbyssReturnState, 0).success, true);
  assert.equal(opponentAbyssReturnState.pendingChoice?.type, 'cardMove');
  assert.deepEqual(opponentAbyssReturnState.pendingChoice?.options.map(option => option.cardInstanceId), [returnedAbyssCard.instanceId, untouchedAbyssCard.instanceId]);
  const beforeInvalidOpponentAbyss = opponentAbyssReturnState.players[1].abyss.map(card => card.instanceId);
  const beforeInvalidOpponentDeck = opponentAbyssReturnState.players[1].deck.map(card => card.instanceId);
  assert.equal(submitPendingChoice(opponentAbyssReturnState, 0, ['missing-card'], noEffects), false);
  assert.deepEqual(opponentAbyssReturnState.players[1].abyss.map(card => card.instanceId), beforeInvalidOpponentAbyss);
  assert.deepEqual(opponentAbyssReturnState.players[1].deck.map(card => card.instanceId), beforeInvalidOpponentDeck);
  assert.equal(submitPendingChoice(opponentAbyssReturnState, 0, [returnedAbyssCard.instanceId], noEffects), true);
  assert.equal(opponentAbyssReturnState.players[1].abyss.length, 1);
  assert.equal(opponentAbyssReturnState.players[1].deck.at(-1)?.instanceId, returnedAbyssCard.instanceId);
  assert.equal(returnedAbyssCard.faceUp, true);

  const optionalStudyDraw = parsedCardEffect('4th_53');
  assert.deepEqual(optionalStudyDraw.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'optionalHandMoveThenDraw',
      sourceOwner: 'self',
      sourceZone: 'hand',
      destinationOwner: 'self',
      destinationZone: 'powerCharger',
      drawCount: 1,
      filterCardType: 'Character',
      filterSong: 'お勉強しといてよ',
    },
  });

  const optionalElectricDraw = parsedCardEffect('4th_54');
  assert.deepEqual(optionalElectricDraw.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'optionalHandMoveThenDraw',
      sourceOwner: 'self',
      sourceZone: 'hand',
      destinationOwner: 'self',
      destinationZone: 'abyss',
      drawCount: 1,
      filterElement: '電気',
    },
  });

  const optionalWindDraw = parsedCardEffect('4th_58');
  assert.deepEqual(optionalWindDraw.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'optionalHandMoveThenDraw',
      sourceOwner: 'self',
      sourceZone: 'hand',
      destinationOwner: 'self',
      destinationZone: 'abyss',
      drawCount: 1,
      filterElement: '風',
    },
  });

  const optionalDeckSelectedDraw = parsedCardEffect('4th_61');
  assert.deepEqual(optionalDeckSelectedDraw.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'optionalHandMoveThenDraw',
      sourceOwner: 'self',
      sourceZone: 'hand',
      destinationOwner: 'self',
      destinationZone: 'deck',
      destinationPosition: 'bottom',
      drawCount: 'selected',
    },
  });

  const optionalDarkSelectedDraw = parsedCardEffect('4th_62');
  assert.deepEqual(optionalDarkSelectedDraw.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'optionalHandMoveThenDraw',
      sourceOwner: 'self',
      sourceZone: 'hand',
      destinationOwner: 'self',
      destinationZone: 'abyss',
      drawCount: 'selected',
      filterElement: '闇',
    },
  });

  const optionalFireSelectedDraw = parsedCardEffect('4th_63');
  assert.deepEqual(optionalFireSelectedDraw.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'optionalHandMoveThenDraw',
      sourceOwner: 'self',
      sourceZone: 'hand',
      destinationOwner: 'self',
      destinationZone: 'abyss',
      drawCount: 'selected',
      filterElement: '炎',
    },
  });

  const optionalStudyState = preparedState();
  const matchingStudy = createInstance('1st_1', false);
  const nonmatchingStudy = createInstance('1st_17', true);
  const studyDrawCard = createInstance('2nd_1', false);
  optionalStudyState.players[0].hand = [matchingStudy, nonmatchingStudy];
  optionalStudyState.players[0].deck = [studyDrawCard];
  optionalStudyState.players[0].powerCharger = [];
  assert.equal(executeEffect(optionalStudyDraw, optionalStudyState, 0).success, true);
  assert.equal(optionalStudyState.pendingChoice?.type, 'optionalHandMoveThenDraw');
  assert.equal(optionalStudyState.pendingChoice?.min, 0);
  assert.equal(optionalStudyState.pendingChoice?.max, 1);
  assert.deepEqual(optionalStudyState.pendingChoice?.options.map(option => option.cardInstanceId), [matchingStudy.instanceId]);
  const hiddenOptionalChoiceView = ZutomayoCard.playerView!({ G: optionalStudyState, ctx: {} as any, playerID: '1' }) as GameState;
  assert.equal(hiddenOptionalChoiceView.pendingChoice?.options.length, 0);
  const studyHandBeforeDecline = optionalStudyState.players[0].hand.map(card => card.instanceId);
  const studyDeckBeforeDecline = optionalStudyState.players[0].deck.map(card => card.instanceId);
  assert.equal(submitPendingChoice(optionalStudyState, 0, [], noEffects), true);
  assert.equal(optionalStudyState.pendingChoice, null);
  assert.deepEqual(optionalStudyState.players[0].hand.map(card => card.instanceId), studyHandBeforeDecline);
  assert.deepEqual(optionalStudyState.players[0].deck.map(card => card.instanceId), studyDeckBeforeDecline);
  assert.deepEqual(optionalStudyState.players[0].powerCharger, []);
  assert.equal(executeEffect(optionalStudyDraw, optionalStudyState, 0).success, true);
  assert.equal(submitPendingChoice(optionalStudyState, 0, [matchingStudy.instanceId], noEffects), true);
  assert.deepEqual(
    optionalStudyState.players[0].hand.map(card => card.instanceId),
    [nonmatchingStudy.instanceId, studyDrawCard.instanceId],
  );
  assert.equal(optionalStudyState.players[0].deck.length, 0);
  assert.equal(optionalStudyState.players[0].powerCharger.at(-1)?.instanceId, matchingStudy.instanceId);
  assert.equal(matchingStudy.faceUp, true);
  assert.equal(studyDrawCard.faceUp, true);

  const optionalElementState = preparedState();
  const electricPayment = createInstance('1st_3', false);
  const windNonpayment = createInstance('1st_4', true);
  const elementDrawCard = createInstance('2nd_2', false);
  optionalElementState.players[0].hand = [electricPayment, windNonpayment];
  optionalElementState.players[0].deck = [elementDrawCard];
  optionalElementState.players[0].abyss = [];
  assert.equal(executeEffect(optionalElectricDraw, optionalElementState, 0).success, true);
  assert.deepEqual(optionalElementState.pendingChoice?.options.map(option => option.cardInstanceId), [electricPayment.instanceId]);
  assert.equal(submitPendingChoice(optionalElementState, 0, [electricPayment.instanceId], noEffects), true);
  assert.deepEqual(
    optionalElementState.players[0].hand.map(card => card.instanceId),
    [windNonpayment.instanceId, elementDrawCard.instanceId],
  );
  assert.equal(optionalElementState.players[0].abyss.at(-1)?.instanceId, electricPayment.instanceId);
  assert.equal(electricPayment.faceUp, true);
  assert.equal(elementDrawCard.faceUp, true);

  const optionalInvalidState = preparedState();
  const invalidMatching = createInstance('1st_3', true);
  const invalidNonmatching = createInstance('1st_4', true);
  const invalidDrawCard = createInstance('2nd_3', false);
  optionalInvalidState.players[0].hand = [invalidMatching, invalidNonmatching];
  optionalInvalidState.players[0].deck = [invalidDrawCard];
  optionalInvalidState.players[0].abyss = [];
  assert.equal(executeEffect(optionalElectricDraw, optionalInvalidState, 0).success, true);
  const invalidHandBefore = optionalInvalidState.players[0].hand.map(card => card.instanceId);
  const invalidDeckBefore = optionalInvalidState.players[0].deck.map(card => card.instanceId);
  assert.equal(submitPendingChoice(optionalInvalidState, 0, [invalidNonmatching.instanceId], noEffects), false);
  assert.deepEqual(optionalInvalidState.players[0].hand.map(card => card.instanceId), invalidHandBefore);
  assert.deepEqual(optionalInvalidState.players[0].deck.map(card => card.instanceId), invalidDeckBefore);
  assert.deepEqual(optionalInvalidState.players[0].abyss, []);
  assert.equal(optionalInvalidState.pendingChoice?.type, 'optionalHandMoveThenDraw');

  const optionalNoLegalState = preparedState();
  optionalNoLegalState.players[0].hand = [createInstance('1st_17', true)];
  optionalNoLegalState.players[0].deck = [createInstance('2nd_4', false)];
  optionalNoLegalState.players[0].powerCharger = [];
  const noLegalHandBefore = optionalNoLegalState.players[0].hand.map(card => card.instanceId);
  const noLegalDeckBefore = optionalNoLegalState.players[0].deck.map(card => card.instanceId);
  assert.deepEqual(executeEffect(optionalStudyDraw, optionalNoLegalState, 0), {
    success: true,
    message: 'No legal optional hand payment cards',
  });
  assert.equal(optionalNoLegalState.pendingChoice, null);
  assert.deepEqual(optionalNoLegalState.players[0].hand.map(card => card.instanceId), noLegalHandBefore);
  assert.deepEqual(optionalNoLegalState.players[0].deck.map(card => card.instanceId), noLegalDeckBefore);
  assert.deepEqual(optionalNoLegalState.players[0].powerCharger, []);

  const optionalOverdrawState = preparedState();
  const overdrawPayment = createInstance('1st_1', false);
  optionalOverdrawState.players[0].hand = [overdrawPayment];
  optionalOverdrawState.players[0].deck = [];
  optionalOverdrawState.players[0].powerCharger = [];
  assert.equal(executeEffect(optionalStudyDraw, optionalOverdrawState, 0).success, true);
  assert.equal(submitPendingChoice(optionalOverdrawState, 0, [overdrawPayment.instanceId], noEffects), true);
  assert.equal(optionalOverdrawState.step, 'gameOver');
  assert.equal(optionalOverdrawState.winner, 1);
  assert.equal(optionalOverdrawState.pendingChoice, null);
  assert.deepEqual(optionalOverdrawState.players[0].hand, []);
  assert.equal(optionalOverdrawState.players[0].powerCharger.at(-1)?.instanceId, overdrawPayment.instanceId);
  assert.match(optionalOverdrawState.gameoverReason ?? '', /choice attempted to draw 1 with only 0 cards/);

  const optionalDeckState = preparedState();
  const deckPaymentA = createInstance('1st_1', false);
  const deckPaymentB = createInstance('1st_2', false);
  const deckKeep = createInstance('1st_3', true);
  const deckDrawA = createInstance('2nd_1', false);
  const deckDrawB = createInstance('2nd_2', false);
  optionalDeckState.players[0].hand = [deckPaymentA, deckPaymentB, deckKeep];
  optionalDeckState.players[0].deck = [deckDrawA, deckDrawB];
  assert.equal(executeEffect(optionalDeckSelectedDraw, optionalDeckState, 0).success, true);
  assert.equal(optionalDeckState.pendingChoice?.type, 'optionalHandMoveThenDraw');
  assert.equal(optionalDeckState.pendingChoice?.min, 0);
  assert.equal(optionalDeckState.pendingChoice?.max, 3);
  assert.deepEqual(
    optionalDeckState.pendingChoice?.options.map(option => option.cardInstanceId),
    [deckPaymentA.instanceId, deckPaymentB.instanceId, deckKeep.instanceId],
  );
  assert.equal(submitPendingChoice(optionalDeckState, 0, [deckPaymentB.instanceId, deckPaymentA.instanceId], noEffects), true);
  assert.deepEqual(
    optionalDeckState.players[0].hand.map(card => card.instanceId),
    [deckKeep.instanceId, deckDrawA.instanceId, deckDrawB.instanceId],
  );
  assert.equal(optionalDeckState.players[0].deck.length, 2);
  assert.deepEqual(
    new Set(optionalDeckState.players[0].deck.map(card => card.instanceId)),
    new Set([deckPaymentA.instanceId, deckPaymentB.instanceId]),
  );
  assert.equal(deckPaymentA.faceUp, true);
  assert.equal(deckPaymentB.faceUp, true);
  assert.equal(deckDrawA.faceUp, true);
  assert.equal(deckDrawB.faceUp, true);
  assert.equal(optionalDeckState.winner, null);

  const optionalDeckDeclineState = preparedState();
  const deckDeclinePayment = createInstance('1st_1', false);
  const deckDeclineKeep = createInstance('1st_2', true);
  const deckDeclineDraw = createInstance('2nd_1', false);
  optionalDeckDeclineState.players[0].hand = [deckDeclinePayment, deckDeclineKeep];
  optionalDeckDeclineState.players[0].deck = [deckDeclineDraw];
  assert.equal(executeEffect(optionalDeckSelectedDraw, optionalDeckDeclineState, 0).success, true);
  assert.equal(optionalDeckDeclineState.pendingChoice?.max, 2);
  const deckDeclineHandBefore = optionalDeckDeclineState.players[0].hand.map(card => card.instanceId);
  const deckDeclineDeckBefore = optionalDeckDeclineState.players[0].deck.map(card => card.instanceId);
  assert.equal(submitPendingChoice(optionalDeckDeclineState, 0, [], noEffects), true);
  assert.equal(optionalDeckDeclineState.pendingChoice, null);
  assert.deepEqual(optionalDeckDeclineState.players[0].hand.map(card => card.instanceId), deckDeclineHandBefore);
  assert.deepEqual(optionalDeckDeclineState.players[0].deck.map(card => card.instanceId), deckDeclineDeckBefore);

  const optionalDarkState = preparedState();
  const darkPaymentA = createInstance('1st_1', false);
  const darkNonpayment = createInstance('1st_2', true);
  const darkPaymentB = createInstance('1st_5', false);
  const darkDrawA = createInstance('2nd_3', false);
  const darkDrawB = createInstance('2nd_4', false);
  optionalDarkState.players[0].hand = [darkPaymentA, darkNonpayment, darkPaymentB];
  optionalDarkState.players[0].deck = [darkDrawA, darkDrawB];
  optionalDarkState.players[0].abyss = [];
  assert.equal(executeEffect(optionalDarkSelectedDraw, optionalDarkState, 0).success, true);
  assert.equal(optionalDarkState.pendingChoice?.min, 0);
  assert.equal(optionalDarkState.pendingChoice?.max, 2);
  assert.deepEqual(
    optionalDarkState.pendingChoice?.options.map(option => option.cardInstanceId),
    [darkPaymentA.instanceId, darkPaymentB.instanceId],
  );
  assert.equal(submitPendingChoice(optionalDarkState, 0, [darkPaymentA.instanceId, darkPaymentB.instanceId], noEffects), true);
  assert.deepEqual(
    optionalDarkState.players[0].hand.map(card => card.instanceId),
    [darkNonpayment.instanceId, darkDrawA.instanceId, darkDrawB.instanceId],
  );
  assert.deepEqual(
    optionalDarkState.players[0].abyss.map(card => card.instanceId),
    [darkPaymentA.instanceId, darkPaymentB.instanceId],
  );
  assert.equal(optionalDarkState.players[0].deck.length, 0);
  assert.equal(darkPaymentA.faceUp, true);
  assert.equal(darkPaymentB.faceUp, true);
  assert.equal(darkDrawA.faceUp, true);
  assert.equal(darkDrawB.faceUp, true);
  assert.equal(optionalDarkState.winner, null);

  const optionalDarkInvalidState = preparedState();
  const invalidDarkPayment = createInstance('1st_1', true);
  const invalidFirePayment = createInstance('1st_2', true);
  const invalidSelectedDraw = createInstance('2nd_1', false);
  optionalDarkInvalidState.players[0].hand = [invalidDarkPayment, invalidFirePayment];
  optionalDarkInvalidState.players[0].deck = [invalidSelectedDraw];
  optionalDarkInvalidState.players[0].abyss = [];
  assert.equal(executeEffect(optionalDarkSelectedDraw, optionalDarkInvalidState, 0).success, true);
  const invalidSelectedHandBefore = optionalDarkInvalidState.players[0].hand.map(card => card.instanceId);
  const invalidSelectedDeckBefore = optionalDarkInvalidState.players[0].deck.map(card => card.instanceId);
  assert.equal(submitPendingChoice(optionalDarkInvalidState, 0, [invalidFirePayment.instanceId], noEffects), false);
  assert.deepEqual(optionalDarkInvalidState.players[0].hand.map(card => card.instanceId), invalidSelectedHandBefore);
  assert.deepEqual(optionalDarkInvalidState.players[0].deck.map(card => card.instanceId), invalidSelectedDeckBefore);
  assert.deepEqual(optionalDarkInvalidState.players[0].abyss, []);
  assert.equal(optionalDarkInvalidState.pendingChoice?.type, 'optionalHandMoveThenDraw');

  const optionalDarkNoLegalState = preparedState();
  optionalDarkNoLegalState.players[0].hand = [createInstance('1st_2', true), createInstance('2nd_2', true)];
  optionalDarkNoLegalState.players[0].deck = [createInstance('2nd_4', false)];
  optionalDarkNoLegalState.players[0].abyss = [];
  const darkNoLegalHandBefore = optionalDarkNoLegalState.players[0].hand.map(card => card.instanceId);
  const darkNoLegalDeckBefore = optionalDarkNoLegalState.players[0].deck.map(card => card.instanceId);
  assert.deepEqual(executeEffect(optionalDarkSelectedDraw, optionalDarkNoLegalState, 0), {
    success: true,
    message: 'No legal optional hand payment cards',
  });
  assert.equal(optionalDarkNoLegalState.pendingChoice, null);
  assert.deepEqual(optionalDarkNoLegalState.players[0].hand.map(card => card.instanceId), darkNoLegalHandBefore);
  assert.deepEqual(optionalDarkNoLegalState.players[0].deck.map(card => card.instanceId), darkNoLegalDeckBefore);
  assert.deepEqual(optionalDarkNoLegalState.players[0].abyss, []);

  const optionalSelectedOverdrawState = preparedState();
  const overdrawFireA = createInstance('1st_2', false);
  const overdrawFireB = createInstance('2nd_2', false);
  const overdrawRemainingDeck = createInstance('1st_3', false);
  optionalSelectedOverdrawState.players[0].hand = [overdrawFireA, overdrawFireB];
  optionalSelectedOverdrawState.players[0].deck = [overdrawRemainingDeck];
  optionalSelectedOverdrawState.players[0].abyss = [];
  assert.equal(executeEffect(optionalFireSelectedDraw, optionalSelectedOverdrawState, 0).success, true);
  assert.equal(optionalSelectedOverdrawState.pendingChoice?.max, 2);
  assert.equal(submitPendingChoice(optionalSelectedOverdrawState, 0, [overdrawFireA.instanceId, overdrawFireB.instanceId], noEffects), true);
  assert.equal(optionalSelectedOverdrawState.step, 'gameOver');
  assert.equal(optionalSelectedOverdrawState.winner, 1);
  assert.equal(optionalSelectedOverdrawState.pendingChoice, null);
  assert.deepEqual(optionalSelectedOverdrawState.players[0].hand, []);
  assert.deepEqual(optionalSelectedOverdrawState.players[0].deck.map(card => card.instanceId), [overdrawRemainingDeck.instanceId]);
  assert.deepEqual(
    optionalSelectedOverdrawState.players[0].abyss.map(card => card.instanceId),
    [overdrawFireA.instanceId, overdrawFireB.instanceId],
  );
  assert.match(optionalSelectedOverdrawState.gameoverReason ?? '', /choice attempted to draw 2 with only 1 cards/);

  const abyssFourPayment = parseEffect('アビスのカードを４枚選び、裏向きにして混ぜ、デッキの底に置く。そうしない場合、ゲームに敗北する。');
  assert.ok(abyssFourPayment);
  assert.deepEqual(abyssFourPayment.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'abyssToDeckBottomOrLose',
      min: 4,
      max: 4,
      faceDown: true,
      shuffle: true,
    },
  });
  assert.deepEqual(parsedCardEffect('4th_6').action, abyssFourPayment.action);

  const opponentPowerCharacterSwap = parseEffect('相手のパワーチャージャーのキャラクターを１枚選び、バトルゾーンのキャラクターと入れ替える。');
  assert.ok(opponentPowerCharacterSwap);
  assert.deepEqual(opponentPowerCharacterSwap.action, {
    type: 'requestChoice',
    params: { choiceType: 'opponentPowerCharacterSwap' },
  });

  const swappedInSuppression = parseEffect('この効果で出したキャラクターの効果は発動しない');
  assert.ok(swappedInSuppression);
  assert.deepEqual(swappedInSuppression.action, {
    type: 'suppressEffectActivation',
    params: { scope: 'thisEffectSwappedInCharacter' },
  });

  const fourthSixEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect }))).get('4th_6') ?? [];
  assert.deepEqual(fourthSixEffects[1]?.action, opponentPowerCharacterSwap.action);
  assert.deepEqual(fourthSixEffects[2]?.action, swappedInSuppression.action);

  const abyssVariablePayment = parseEffect('アビスのカードを１枚以上選び、裏向きにして混ぜ、デッキの底に置く。そうしない場合、ゲームに敗北する。');
  assert.ok(abyssVariablePayment);
  assert.deepEqual(abyssVariablePayment.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'abyssToDeckBottomOrLose',
      min: 1,
      max: 'available',
      faceDown: true,
      shuffle: true,
    },
  });
  assert.deepEqual(parsedCardEffect('4th_27').action, abyssVariablePayment.action);

  const selectedCountMill = parseEffect('相手のデッキの上から、それと同じ枚数をアビスに置く');
  assert.ok(selectedCountMill);
  assert.deepEqual(selectedCountMill.action, {
    type: 'millDeckToAbyss',
    params: { target: 'opponent', countFromLastChoice: true },
  });
  const fourth27Effects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect }))).get('4th_27') ?? [];
  assert.deepEqual(fourth27Effects[1]?.action, selectedCountMill.action);

  const abyssSixPayment = parseEffect('アビスのカードを６枚選び、裏向きにして混ぜ、デッキの底に置く。そうしない場合、ゲームに敗北する。');
  assert.ok(abyssSixPayment);
  assert.deepEqual(abyssSixPayment.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'abyssToDeckBottomOrLose',
      min: 6,
      max: 6,
      faceDown: true,
      shuffle: true,
    },
  });
  assert.deepEqual(parsedCardEffect('4th_28').action, abyssSixPayment.action);

  const abyssOneFaceUpPayment = parseEffect('アビスのカードを１枚選び、デッキの底に置く。そうしない場合、ゲームに敗北する。相手のデッキの上から３枚を見て、好きな順番に入れ替えて戻す');
  assert.ok(abyssOneFaceUpPayment);
  assert.deepEqual(abyssOneFaceUpPayment.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'abyssToDeckBottomOrLose',
      min: 1,
      max: 1,
      faceDown: false,
      shuffle: false,
      followUpChoiceType: 'reorderOpponentDeckTop',
      followUpCount: 3,
    },
  });
  assert.deepEqual(parsedCardEffect('4th_88').action, abyssOneFaceUpPayment.action);

  const reorderOpponentDeckTop = parseEffect('相手のデッキの上から３枚を見て、好きな順番に入れ替えて戻す');
  assert.ok(reorderOpponentDeckTop);
  assert.deepEqual(reorderOpponentDeckTop.action, {
    type: 'requestChoice',
    params: { choiceType: 'reorderOpponentDeckTop', count: 3 },
  });

  const reorderFollowUpState = preparedState();
  const reorderPayment = createInstance('1st_9', true);
  const reorderTopA = createInstance('1st_1', false);
  const reorderTopB = createInstance('1st_2', false);
  const reorderTopC = createInstance('1st_3', false);
  const reorderRest = createInstance('1st_4', false);
  reorderFollowUpState.players[0].abyss = [reorderPayment];
  reorderFollowUpState.players[0].deck = [];
  reorderFollowUpState.players[1].deck = [reorderTopA, reorderTopB, reorderTopC, reorderRest];
  assert.equal(executeEffect(abyssOneFaceUpPayment, reorderFollowUpState, 0).success, true);
  assert.equal(reorderFollowUpState.pendingChoice?.type, 'abyssToDeckBottomOrLose');
  assert.equal(submitPendingChoice(reorderFollowUpState, 0, [reorderPayment.instanceId], noEffects), true);
  assert.equal(reorderFollowUpState.pendingChoice?.type, 'reorderOpponentDeckTop');
  assert.equal(reorderFollowUpState.pendingChoice?.min, 3);
  assert.equal(reorderFollowUpState.pendingChoice?.max, 3);
  assert.deepEqual(
    reorderFollowUpState.pendingChoice?.options.map(option => option.cardInstanceId),
    [reorderTopA.instanceId, reorderTopB.instanceId, reorderTopC.instanceId],
  );
  const hiddenReorderView = ZutomayoCard.playerView!({ G: reorderFollowUpState, ctx: {} as any, playerID: '1' }) as GameState;
  assert.equal(hiddenReorderView.pendingChoice?.options.length, 0);
  assert.equal(submitPendingChoice(
    reorderFollowUpState,
    0,
    [reorderTopC.instanceId, reorderTopC.instanceId, reorderTopA.instanceId],
    noEffects,
  ), false);
  assert.equal(submitPendingChoice(
    reorderFollowUpState,
    0,
    [reorderTopC.instanceId, reorderTopA.instanceId, reorderTopB.instanceId],
    noEffects,
  ), true);
  assert.equal(reorderFollowUpState.pendingChoice, null);
  assert.deepEqual(
    reorderFollowUpState.players[1].deck.map(card => card.instanceId),
    [reorderTopC.instanceId, reorderTopA.instanceId, reorderTopB.instanceId, reorderRest.instanceId],
  );

  const fixedAbyssPaymentState = preparedState();
  const fixedAbyssCards = [
    createInstance('1st_9', true),
    createInstance('1st_17', true),
    createInstance('1st_1', true),
    createInstance('1st_5', true),
  ];
  const fixedDeckBefore = createInstance('2nd_1', false);
  fixedAbyssPaymentState.players[0].abyss = fixedAbyssCards;
  fixedAbyssPaymentState.players[0].deck = [fixedDeckBefore];
  const fixedSelectedIds = fixedAbyssCards.map(card => card.instanceId);
  assert.equal(executeEffect(abyssFourPayment, fixedAbyssPaymentState, 0).success, true);
  assert.equal(fixedAbyssPaymentState.pendingChoice?.type, 'abyssToDeckBottomOrLose');
  assert.equal(fixedAbyssPaymentState.pendingChoice?.min, 4);
  assert.equal(fixedAbyssPaymentState.pendingChoice?.max, 4);
  const hiddenChoiceView = ZutomayoCard.playerView!({ G: fixedAbyssPaymentState, ctx: {} as any, playerID: '1' }) as GameState;
  assert.equal(hiddenChoiceView.pendingChoice?.options.length, 0);
  assert.equal(submitPendingChoice(
    fixedAbyssPaymentState,
    0,
    [fixedSelectedIds[0], fixedSelectedIds[0], fixedSelectedIds[1], fixedSelectedIds[2]],
    noEffects,
  ), false);
  assert.equal(fixedAbyssPaymentState.players[0].abyss.length, 4);
  assert.equal(submitPendingChoice(fixedAbyssPaymentState, 0, fixedSelectedIds, noEffects), true);
  assert.equal(fixedAbyssPaymentState.pendingChoice, null);
  assert.deepEqual(fixedAbyssPaymentState.players[0].abyss, []);
  assert.equal(fixedAbyssPaymentState.players[0].deck[0].instanceId, fixedDeckBefore.instanceId);
  const fixedMovedCards = fixedAbyssPaymentState.players[0].deck.slice(-4);
  assert.deepEqual(new Set(fixedMovedCards.map(card => card.instanceId)), new Set(fixedSelectedIds));
  for (const card of fixedMovedCards) assert.equal(card.faceUp, false);

  const fixedInsufficientAbyssState = preparedState();
  fixedInsufficientAbyssState.players[0].abyss = [
    createInstance('1st_9', true),
    createInstance('1st_17', true),
    createInstance('1st_1', true),
  ];
  assert.equal(executeEffect(abyssFourPayment, fixedInsufficientAbyssState, 0).success, false);
  assert.equal(fixedInsufficientAbyssState.step, 'gameOver');
  assert.equal(fixedInsufficientAbyssState.winner, 1);
  assert.match(fixedInsufficientAbyssState.gameoverReason ?? '', /cannot pay Abyss-to-deck-bottom requirement/);

  const variableAbyssPaymentState = preparedState();
  const variableAbyssCards = [
    createInstance('1st_9', true),
    createInstance('1st_17', true),
    createInstance('1st_1', true),
  ];
  const variableDeckBefore = createInstance('2nd_1', false);
  variableAbyssPaymentState.players[0].abyss = variableAbyssCards;
  variableAbyssPaymentState.players[0].deck = [variableDeckBefore];
  const variableSelectedIds = [variableAbyssCards[0].instanceId, variableAbyssCards[2].instanceId];
  const variableRemainingId = variableAbyssCards[1].instanceId;
  assert.equal(executeEffect(abyssVariablePayment, variableAbyssPaymentState, 0).success, true);
  assert.equal(variableAbyssPaymentState.pendingChoice?.type, 'abyssToDeckBottomOrLose');
  assert.equal(variableAbyssPaymentState.pendingChoice?.min, 1);
  assert.equal(variableAbyssPaymentState.pendingChoice?.max, 3);
  assert.equal(submitPendingChoice(variableAbyssPaymentState, 0, [], noEffects), false);
  assert.equal(submitPendingChoice(
    variableAbyssPaymentState,
    0,
    [...variableAbyssCards.map(card => card.instanceId), 'missing-card'],
    noEffects,
  ), false);
  assert.equal(submitPendingChoice(variableAbyssPaymentState, 0, variableSelectedIds, noEffects), true);
  assert.deepEqual(variableAbyssPaymentState.players[0].abyss.map(card => card.instanceId), [variableRemainingId]);
  assert.equal(variableAbyssPaymentState.players[0].deck[0].instanceId, variableDeckBefore.instanceId);
  const variableMovedCards = variableAbyssPaymentState.players[0].deck.slice(-2);
  assert.deepEqual(new Set(variableMovedCards.map(card => card.instanceId)), new Set(variableSelectedIds));
  for (const card of variableMovedCards) assert.equal(card.faceUp, false);

  const selectedCountSequenceState = preparedState();
  const selectedCountAbyssCards = [
    createInstance('1st_9', true),
    createInstance('1st_17', true),
    createInstance('1st_1', true),
  ];
  const selectedCountOpponentDeck = [
    createInstance('2nd_1', false),
    createInstance('2nd_2', false),
    createInstance('2nd_3', false),
    createInstance('2nd_4', false),
    createInstance('2nd_5', false),
  ];
  const selectedCountMilledIds = selectedCountOpponentDeck.slice(0, 2).map(card => card.instanceId);
  const selectedCountRemainingDeckIds = selectedCountOpponentDeck.slice(2).map(card => card.instanceId);
  selectedCountSequenceState.players[0].abyss = selectedCountAbyssCards;
  selectedCountSequenceState.players[1].deck = selectedCountOpponentDeck;
  selectedCountSequenceState.step = 'effectOrder';
  selectedCountSequenceState.pendingEffectPlayer = 0;
  selectedCountSequenceState.pendingEffects[0] = [{
    id: '4th_27-follow-up',
    player: 0,
    cardInstanceId: '4th_27-instance',
    cardDefId: '4th_27',
    rawText: selectedCountMill.rawText,
    effect: selectedCountMill,
    source: 'played',
  }];
  const selectedCountIds = [
    selectedCountAbyssCards[0].instanceId,
    selectedCountAbyssCards[2].instanceId,
  ];
  assert.equal(executeEffect(abyssVariablePayment, selectedCountSequenceState, 0).success, true);
  assert.equal(submitPendingChoice(selectedCountSequenceState, 0, selectedCountIds, noEffects), true);
  assert.equal(selectedCountSequenceState.lastChoiceSelectionCount[0], 2);
  assert.equal(executeEffect(selectedCountMill, selectedCountSequenceState, 0).success, true);
  assert.deepEqual(
    selectedCountSequenceState.players[1].abyss.map(card => card.instanceId),
    selectedCountMilledIds,
  );
  assert.deepEqual(
    selectedCountSequenceState.players[1].deck.map(card => card.instanceId),
    selectedCountRemainingDeckIds,
  );
  assert.equal(selectedCountSequenceState.lastChoiceSelectionCount[0], null);

  const missingSelectedCountState = preparedState();
  const missingSelectedCountDeck = [
    createInstance('2nd_1', false),
    createInstance('2nd_2', false),
  ];
  missingSelectedCountState.players[1].deck = missingSelectedCountDeck;
  const missingSelectedCountResult = executeEffect(selectedCountMill, missingSelectedCountState, 0);
  assert.equal(missingSelectedCountResult.success, false);
  assert.match(missingSelectedCountResult.message, /Missing selected count/);
  assert.deepEqual(
    missingSelectedCountState.players[1].deck.map(card => card.instanceId),
    missingSelectedCountDeck.map(card => card.instanceId),
  );
  assert.deepEqual(missingSelectedCountState.players[1].abyss, []);

  const variableEmptyAbyssState = preparedState();
  variableEmptyAbyssState.players[0].abyss = [];
  assert.equal(executeEffect(abyssVariablePayment, variableEmptyAbyssState, 0).success, false);
  assert.equal(variableEmptyAbyssState.step, 'gameOver');
  assert.equal(variableEmptyAbyssState.winner, 1);

  const opponentAbyssToDeck = parseEffect('相手のアビスのカードを1枚選んでデッキの底に戻させる');
  assert.deepEqual(opponentAbyssToDeck?.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'cardMove',
      count: 1,
      sourceOwner: 'opponent',
      sourceZone: 'abyss',
      destinationOwner: 'opponent',
      destinationZone: 'deck',
      destinationPosition: 'bottom',
    },
  });
  assert.deepEqual(parsedCardEffect('1st_103').action, opponentAbyssToDeck?.action);
  const abyssMoveState = preparedState();
  const abyssCard = createInstance('1st_9', true);
  const abyssOther = createInstance('1st_17', true);
  const bottomBefore = createInstance('1st_1', false);
  abyssMoveState.players[1].abyss = [abyssCard, abyssOther];
  abyssMoveState.players[1].deck = [bottomBefore];
  assert.ok(opponentAbyssToDeck);
  assert.equal(executeEffect(opponentAbyssToDeck, abyssMoveState, 0).success, true);
  assert.equal(abyssMoveState.pendingChoice?.options.length, 2);
  assert.equal(submitPendingChoice(abyssMoveState, 1, [abyssCard.instanceId], noEffects), false);
  assert.equal(submitPendingChoice(abyssMoveState, 0, [abyssCard.instanceId, abyssCard.instanceId], noEffects), false);
  assert.equal(submitPendingChoice(abyssMoveState, 0, [abyssCard.instanceId], noEffects), true);
  assert.deepEqual(abyssMoveState.players[1].abyss.map(card => card.instanceId), [abyssOther.instanceId]);
  assert.deepEqual(abyssMoveState.players[1].deck.map(card => card.instanceId), [bottomBefore.instanceId, abyssCard.instanceId]);

  const powerTwoToDeck = parseEffect('相手のパワーチャージャーからSEND TO POWER★★のカードを１枚選び、相手のデッキの底に置く');
  assert.deepEqual(powerTwoToDeck?.action, {
    type: 'requestChoice',
    params: {
      choiceType: 'cardMove',
      count: 1,
      sourceOwner: 'opponent',
      sourceZone: 'powerCharger',
      destinationOwner: 'opponent',
      destinationZone: 'deck',
      destinationPosition: 'bottom',
      filterSendToPower: 2,
    },
  });
  assert.deepEqual(parsedCardEffect('2nd_8').action, powerTwoToDeck?.action);
  const powerOneToDeck = parseEffect('相手のパワーチャージャーからSEND TO POWER★１のカードを１枚選び、相手のデッキの底に置く');
  assert.equal(powerOneToDeck?.action.params.filterSendToPower, 1);
  assert.deepEqual(parsedCardEffect('2nd_19').action, powerOneToDeck?.action);
  assert.deepEqual(parsedCardEffect('2nd_24').conditions, [
    { type: 'previousCharElement', value: '電気' },
    { type: 'chronos', value: 'night' },
  ]);
  assert.equal(parsedCardEffect('2nd_24').action.params.filterSendToPower, 1);

  const powerMoveState = preparedState();
  const illegalPower = createInstance('1st_9', true);
  const legalPower = createInstance('1st_13', true);
  const powerBottomBefore = createInstance('1st_1', false);
  powerMoveState.players[1].powerCharger = [illegalPower, legalPower];
  powerMoveState.players[1].deck = [powerBottomBefore];
  assert.ok(powerTwoToDeck);
  assert.equal(executeEffect(powerTwoToDeck, powerMoveState, 0).success, true);
  assert.deepEqual(powerMoveState.pendingChoice?.options.map(option => option.cardInstanceId), [legalPower.instanceId]);
  assert.equal(submitPendingChoice(powerMoveState, 0, [illegalPower.instanceId], noEffects), false);
  assert.equal(submitPendingChoice(powerMoveState, 0, [legalPower.instanceId], noEffects), true);
  assert.deepEqual(powerMoveState.players[1].powerCharger.map(card => card.instanceId), [illegalPower.instanceId]);
  assert.deepEqual(powerMoveState.players[1].deck.map(card => card.instanceId), [powerBottomBefore.instanceId, legalPower.instanceId]);

  const noLegalPowerState = preparedState();
  noLegalPowerState.players[1].powerCharger = [createInstance('1st_9', true)];
  assert.deepEqual(executeEffect(powerTwoToDeck, noLegalPowerState, 0), { success: false, message: 'No legal cards for choice' });
  assert.equal(noLegalPowerState.pendingChoice, null);

  const opponentSwapState = preparedState();
  const battleCharacter = createInstance('1st_9', false);
  const powerCharacter = createInstance('1st_13', false);
  const powerNonCharacter = createInstance('1st_5', true);
  opponentSwapState.players[1].battleZone = battleCharacter;
  opponentSwapState.players[1].powerCharger = [powerNonCharacter, powerCharacter];
  opponentSwapState.pendingEffects[0] = [{
    id: 'keep-window',
    player: 0,
    cardInstanceId: 'keep-window-card',
    cardDefId: '1st_9',
    rawText: boost.rawText,
    effect: boost,
    source: 'played',
  }];
  opponentSwapState.pendingEffects[1] = [{
    id: 'stale-swapped-in',
    player: 1,
    cardInstanceId: powerCharacter.instanceId,
    cardDefId: powerCharacter.defId,
    rawText: boost.rawText,
    effect: boost,
    source: 'battleZone',
  }];
  assert.equal(executeEffect(opponentPowerCharacterSwap, opponentSwapState, 0).success, true);
  assert.equal(opponentSwapState.pendingChoice?.type, 'opponentPowerCharacterSwap');
  assert.deepEqual(opponentSwapState.pendingChoice?.options.map(option => option.cardInstanceId), [powerCharacter.instanceId]);
  assert.equal(submitPendingChoice(opponentSwapState, 1, [powerCharacter.instanceId], noEffects), false);
  assert.equal(submitPendingChoice(opponentSwapState, 0, [], noEffects), false);
  assert.equal(submitPendingChoice(opponentSwapState, 0, [powerCharacter.instanceId, powerCharacter.instanceId], noEffects), false);
  assert.equal(submitPendingChoice(opponentSwapState, 0, [powerNonCharacter.instanceId], noEffects), false);
  assert.equal(submitPendingChoice(opponentSwapState, 0, [powerCharacter.instanceId], noEffects), true);
  assert.equal(opponentSwapState.players[1].battleZone?.instanceId, powerCharacter.instanceId);
  assert.deepEqual(
    opponentSwapState.players[1].powerCharger.map(card => card.instanceId),
    [powerNonCharacter.instanceId, battleCharacter.instanceId],
  );
  assert.equal(powerCharacter.faceUp, true);
  assert.equal(battleCharacter.faceUp, true);
  assert.deepEqual(opponentSwapState.swappedCardsThisTurn[1].map(card => card.instanceId), [powerCharacter.instanceId]);
  assert.ok(opponentSwapState.suppressedEffectCardIdsThisTurn.includes(powerCharacter.instanceId));
  assert.equal(opponentSwapState.pendingEffects[1].some(effect => effect.cardInstanceId === powerCharacter.instanceId), false);

  const missingBattleSwapState = preparedState();
  const missingBattlePower = createInstance('1st_13', true);
  missingBattleSwapState.players[1].battleZone = null;
  missingBattleSwapState.players[1].powerCharger = [missingBattlePower];
  assert.equal(executeEffect(opponentPowerCharacterSwap, missingBattleSwapState, 0).success, false);
  assert.equal(missingBattleSwapState.pendingChoice, null);
  assert.deepEqual(missingBattleSwapState.players[1].powerCharger.map(card => card.instanceId), [missingBattlePower.instanceId]);

  const noLegalSwapState = preparedState();
  const noLegalBattle = createInstance('1st_9', true);
  const noLegalPower = createInstance('1st_5', true);
  noLegalSwapState.players[1].battleZone = noLegalBattle;
  noLegalSwapState.players[1].powerCharger = [noLegalPower];
  assert.equal(executeEffect(opponentPowerCharacterSwap, noLegalSwapState, 0).success, false);
  assert.equal(noLegalSwapState.pendingChoice, null);
  assert.equal(noLegalSwapState.players[1].battleZone?.instanceId, noLegalBattle.instanceId);
  assert.deepEqual(noLegalSwapState.players[1].powerCharger.map(card => card.instanceId), [noLegalPower.instanceId]);

  const suppressionCollectState = preparedState();
  const suppressedBattle = createInstance('4th_73', true);
  const unsuppressedPlayed = createInstance('4th_55', true);
  suppressionCollectState.players[0].battleZone = suppressedBattle;
  suppressionCollectState.players[0].powerCharger = [createInstance('1st_13', true)];
  suppressionCollectState.suppressedEffectCardIdsThisTurn = [suppressedBattle.instanceId];
  const collectedSuppressionEffects = collectTurnEffects(
    suppressionCollectState,
    new Map([
      ['4th_73', [parsedCardEffect('4th_73')]],
      ['4th_55', [parsedCardEffect('4th_55')]],
    ]),
    [[unsuppressedPlayed], []],
  );
  assert.equal(collectedSuppressionEffects[0].some(effect => effect.cardInstanceId === suppressedBattle.instanceId), false);
  assert.equal(collectedSuppressionEffects[0].some(effect => effect.cardInstanceId === unsuppressedPlayed.instanceId), true);

  const fixedAdvance = parseEffect('昼なら、時計を２つ進める');
  assert.deepEqual(fixedAdvance?.conditions, [{ type: 'chronos', value: 'day' }]);
  assert.deepEqual(fixedAdvance?.action, { type: 'clockAdvance', params: { value: 2 } });
  const advanceState = preparedState();
  advanceState.chronos.position = 6;
  assert.ok(fixedAdvance);
  assert.equal(executeEffect(fixedAdvance, advanceState, 0).success, true);
  assert.equal(advanceState.chronos.position, 8);

  assert.deepEqual(parseEffect('アビスに炎属性のカードが２枚以上あるなら、時計が真夜中になる')?.action, { type: 'clockSet', params: { value: 0 } });
  assert.deepEqual(parseEffect('アビスに風属性のカードが２枚以上あるなら、時計が正午になる')?.action, { type: 'clockSet', params: { value: 6 } });
  assert.deepEqual(parseEffect('HPが相手のHPより少ないなら、時計を真夜中にする')?.conditions, [{ type: 'hpLessThanOpponent', value: true }]);
  assert.deepEqual(parseEffect('HPが相手のHPより少ないなら、時計を真昼にする')?.action, { type: 'clockSet', params: { value: 6 } });
  const midnightState = preparedState();
  midnightState.chronos.position = 4;
  midnightState.players[0].abyss = [createInstance('1st_13', true), createInstance('1st_14', true)];
  const midnight = parsedCardEffect('2nd_36');
  assert.equal(executeEffect(midnight, midnightState, 0).success, true);
  assert.equal(midnightState.chronos.position, 0);

  const anyChronos = parseEffect('クロノスを好きな時間にする');
  assert.deepEqual(anyChronos?.action, { type: 'requestChoice', params: { choiceType: 'clockPosition' } });
  const anyChronosState = preparedState();
  anyChronosState.chronos.position = 2;
  assert.ok(anyChronos);
  assert.equal(executeEffect(anyChronos, anyChronosState, 0).success, true);
  assert.equal(anyChronosState.pendingChoice?.type, 'clockPosition');
  assert.equal(anyChronosState.pendingChoice?.options.length, 12);
  assert.equal(submitPendingChoice(anyChronosState, 0, ['chronos-9'], noEffects), true);
  assert.equal(anyChronosState.chronos.position, 9);

  const clockRange = parsedCardEffect('2nd_11');
  assert.deepEqual(clockRange.conditions, [{ type: 'previousCharElement', value: '炎' }]);
  assert.deepEqual(clockRange.action, { type: 'requestChoice', params: { choiceType: 'clockAdvance', min: 0, max: 5 } });
  const clockRangeState = preparedState();
  clockRangeState.chronos.position = 10;
  assert.equal(executeEffect(clockRange, clockRangeState, 0).success, false);
  clockRangeState.previousTurnCharacterElements[0] = '炎';
  assert.equal(executeEffect(clockRange, clockRangeState, 0).success, true);
  assert.equal(clockRangeState.pendingChoice?.type, 'clockAdvance');
  assert.deepEqual(clockRangeState.pendingChoice?.options.map(option => option.id), ['advance-0', 'advance-1', 'advance-2', 'advance-3', 'advance-4', 'advance-5']);
  assert.equal(submitPendingChoice(clockRangeState, 0, ['advance-6'], noEffects), false);
  assert.equal(submitPendingChoice(clockRangeState, 0, ['advance-5'], noEffects), true);
  assert.equal(clockRangeState.chronos.position, 3);

  const millTop = parseEffect('相手のデッキの一番上のカードをパワーの有無に関わらずアビスに置く');
  assert.ok(millTop);
  assert.deepEqual(millTop.action, { type: 'millDeckToAbyss', params: { target: 'opponent', count: 1 } });

  const millTwo = parseEffect('相手のデッキの上から２枚を相手のアビスに置く');
  assert.ok(millTwo);
  assert.deepEqual(millTwo.action, { type: 'millDeckToAbyss', params: { target: 'opponent', count: 2 } });

  const areaBottom = parseEffect('相手のエリアエンチャントを相手のデッキの底に置く');
  assert.ok(areaBottom);
  assert.deepEqual(areaBottom.action, { type: 'returnAreaEnchantToDeck', params: { target: 'opponent', position: 'bottom' } });

  const areaTop = parseEffect('相手のエリアエンチャントを相手のデッキの上に置く');
  assert.ok(areaTop);
  assert.deepEqual(areaTop.action, { type: 'returnAreaEnchantToDeck', params: { target: 'opponent', position: 'top' } });

  const areaCardTop = parseEffect('相手のエリアエンチャントカードを相手のデッキの上に置く');
  assert.ok(areaCardTop);
  assert.deepEqual(areaCardTop.action, { type: 'returnAreaEnchantToDeck', params: { target: 'opponent', position: 'top' } });

  assert.deepEqual(parsedCardEffect('1st_104').action, { type: 'millDeckToAbyss', params: { target: 'opponent', count: 1 } });

  const realMillTwo = parsedCardEffect('4th_57');
  assert.deepEqual(realMillTwo.conditions, [{ type: 'abyssCount', value: 3 }]);
  assert.deepEqual(realMillTwo.action, { type: 'millDeckToAbyss', params: { target: 'opponent', count: 2 } });

  assert.deepEqual(parsedCardEffect('3rd_14').action, { type: 'returnAreaEnchantToDeck', params: { target: 'opponent', position: 'bottom' } });
  assert.deepEqual(parsedCardEffect('3rd_21').action, { type: 'returnAreaEnchantToDeck', params: { target: 'opponent', position: 'top' } });

  const realAreaTop = parsedCardEffect('2nd_55');
  assert.deepEqual(realAreaTop.conditions, [{ type: 'selfElement', value: '炎' }]);
  assert.deepEqual(realAreaTop.action, { type: 'returnAreaEnchantToDeck', params: { target: 'opponent', position: 'top' } });
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.chronos.position = 3;
  G.players[0].battleZone = createInstance('1st_9', true);
  G.players[1].hand = [createInstance('1st_1', true), createInstance('1st_3', true)];
  G.players[1].powerCharger = fivePowerCards();

  const choices = aiSelectCards(G, 1, 'hard');
  assert.equal(choices[0]?.handIndex, 1);
  assert.equal(choices[0]?.slot, 'A');
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.chronos.position = 3;
  G.players[0].battleZone = createInstance('1st_9', true);
  G.players[1].hand = [createInstance('1st_3', true), createInstance('1st_9', true)];

  const choices = aiSelectCards(G, 1, 'hard');
  assert.equal(choices[0]?.handIndex, 1);
}

{
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.chronos.position = 3;
  G.lastBattleResult = { winner: 0, damage: 20, winnerAttack: 30, loserAttack: 10 };
  G.players[0].battleZone = createInstance('1st_9', true);
  G.players[1].hand = [createInstance('1st_9', true), createInstance('1st_3', true)];
  G.players[1].powerCharger = fivePowerCards();

  const choices = aiSelectCards(G, 1, 'hard');
  assert.deepEqual(choices, [
    { handIndex: 1, slot: 'A' },
    { handIndex: 0, slot: 'B' },
  ]);
}

{
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.chronos.position = 2;
  G.players[0].setZoneC = createInstance('2nd_5', true);
  G.players[0].powerCharger = [
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
    createInstance('1st_9', true),
  ];
  G.players[0].hand = [createInstance('1st_9', true)];
  G.players[1].hand = [createInstance('1st_9', true)];
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);
  resolveTurn(G, parsedEffects);
  assert.equal(G.chronos.position, 3);
  assert.equal(G.players[0].setZoneC?.defId, '2nd_5');
}

{
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.chronos.position = 2;
  G.players[0].setZoneC = createInstance('2nd_86', true);
  G.players[0].powerCharger = [createInstance('1st_9', true)];
  G.players[0].hand = [createInstance('1st_9', true)];
  G.players[1].hand = [createInstance('1st_9', true)];
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);
  resolveTurn(G, parsedEffects);
  assert.equal(G.players[0].setZoneC, null);
  assert.equal(G.players[0].powerCharger.at(-1)?.defId, '2nd_86');
}

{
  const previousDark = parseEffect('前のターンで使用したキャラクターカードの属性が闇なら、攻撃力+20');
  assert.ok(previousDark);
  assert.deepEqual(previousDark.conditions, [{ type: 'previousCharElement', value: '闇' }]);
  assert.deepEqual(previousDark.action, { type: 'boostAttack', params: { value: 20 } });

  const G = preparedState();
  assert.equal(executeEffect(previousDark, G, 0).success, false);
  assert.equal(G.modifiers.attack[0], 0);
}

{
  const seal = parsedCardEffect('2nd_86');
  assert.deepEqual(seal.conditions, [{ type: 'chronos', value: 'night' }]);
  assert.deepEqual(seal.action, { type: 'boostAttack', params: { value: 20 } });

  const review = parsedCardEffect('2nd_98');
  assert.deepEqual(review.conditions, [{ type: 'chronos', value: 'day' }]);
  assert.deepEqual(review.action, { type: 'boostAttack', params: { value: 20 } });
}

{
  const effect = parsedCardEffect('2nd_86');
  const G = preparedAreaEnchantState('2nd_86', 0);
  processTurnEffects(G, new Map([['2nd_86', [effect]]]));
  assert.equal(G.modifiers.attack[0], 20);
}

{
  const effect = parsedCardEffect('2nd_86');
  const G = preparedAreaEnchantState('2nd_86', 6);
  processTurnEffects(G, new Map([['2nd_86', [effect]]]));
  assert.equal(G.modifiers.attack[0], 0);
}

{
  const effect = parsedCardEffect('2nd_98');
  const G = preparedAreaEnchantState('2nd_98', 6);
  processTurnEffects(G, new Map([['2nd_98', [effect]]]));
  assert.equal(G.modifiers.attack[0], 20);
}

{
  const effect = parsedCardEffect('2nd_98');
  const G = preparedAreaEnchantState('2nd_98', 0);
  processTurnEffects(G, new Map([['2nd_98', [effect]]]));
  assert.equal(G.modifiers.attack[0], 0);
}

{
  const effect = parsedCardEffect('2nd_86');
  const G = preparedAreaEnchantState('2nd_86', 0);
  const area = G.players[0].setZoneC!;
  processTurnEffects(G, new Map([['2nd_86', [effect]]]), [[area], []]);
  assert.equal(G.modifiers.attack[0], 20);
}

{
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  const G = preparedAreaEnchantState('4th_32', 0);
  G.players[0].powerCharger = fivePowerCards();
  G.players[1].setZoneC = createInstance('2nd_5', true);
  processTurnEffects(G, parsedEffects);
  assert.equal(G.players[0].setZoneC, null);
  assert.equal(G.players[0].abyss.at(-1)?.defId, '4th_32');

  const hpBoostG = preparedAreaEnchantState('3rd_64', 0);
  hpBoostG.players[0].powerCharger = fivePowerCards();
  hpBoostG.players[0].hp = 65;
  hpBoostG.players[1].hp = 35;
  processTurnEffects(hpBoostG, parsedEffects);
  assert.deepEqual(hpBoostG.modifiers.attack, [65, 35]);
}

{
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  const effects = parsedEffects.get('3rd_58') ?? [];
  assert.ok(effects.some(effect => (
    effect.trigger === 'onDamageReceived'
    && effect.action.type === 'moveSelfAreaEnchant'
    && effect.conditions.some(condition => condition.type === 'damageAtLeast' && condition.value === 30)
  )));
  const G = preparedAreaEnchantState('3rd_58', 0);
  G.players[0].powerCharger = [createInstance('1st_13', true)];
  resolveTimingEvent(G, parsedEffects, { type: 'damageReceived', player: 0, amount: 29 });
  assert.equal(G.players[0].setZoneC?.defId, '3rd_58');
  resolveTimingEvent(G, parsedEffects, { type: 'damageReceived', player: 0, amount: 30 });
  assert.equal(G.players[0].setZoneC, null);
  assert.equal(G.players[0].abyss.at(-1)?.defId, '3rd_58');
}

{
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  const effects = parsedEffects.get('4th_30') ?? [];
  assert.ok(effects.some(effect => (
    effect.trigger === 'onZoneEntered'
    && effect.action.type === 'moveSelfAreaEnchant'
    && effect.conditions.some(condition => condition.type === 'zoneEntered' && condition.value === 'abyss' && condition.target === 'opponent')
  )));
  const G = preparedAreaEnchantState('4th_30', 0);
  G.players[0].powerCharger = [
    createInstance('1st_13', true),
    createInstance('1st_13', true),
  ];
  resolveTimingEvent(G, parsedEffects, { type: 'zoneEntered', player: 0, zone: 'abyss', cardDefId: '1st_1' });
  assert.equal(G.players[0].setZoneC?.defId, '4th_30');
  resolveTimingEvent(G, parsedEffects, { type: 'zoneEntered', player: 1, zone: 'abyss', cardDefId: '1st_1' });
  assert.equal(G.players[0].setZoneC, null);
  assert.equal(G.players[0].abyss.at(-1)?.defId, '4th_30');

  const sendState = preparedAreaEnchantState('4th_30', 0);
  sendState.players[0].powerCharger = fivePowerCards();
  sendState.players[1].battleZone = createInstance('1st_9', true);
  const sendToAbyss: ParsedEffect = {
    trigger: 'onUse',
    conditions: [],
    rawText: 'send opposing character',
    action: { type: 'sendToAbyss', params: {} },
  };
  assert.equal(executeEffect(sendToAbyss, sendState, 0, {
    onTimingEvent: event => resolveTimingEvent(sendState, parsedEffects, event),
  }).success, true);
  assert.equal(sendState.players[0].setZoneC, null);
  assert.equal(sendState.players[0].abyss.at(-1)?.defId, '4th_30');

  const millState = preparedAreaEnchantState('4th_30', 0);
  millState.players[0].powerCharger = fivePowerCards();
  millState.players[1].deck = [createInstance('1st_9', false)];
  const millToAbyss: ParsedEffect = {
    trigger: 'onUse',
    conditions: [],
    rawText: 'mill opposing deck',
    action: { type: 'millDeckToAbyss', params: { count: 1 } },
  };
  assert.equal(executeEffect(millToAbyss, millState, 0, {
    onTimingEvent: event => resolveTimingEvent(millState, parsedEffects, event),
  }).success, true);
  assert.equal(millState.players[0].setZoneC, null);
  assert.equal(millState.players[0].abyss.at(-1)?.defId, '4th_30');
}

{
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  const effects = parsedEffects.get('3rd_91') ?? [];
  assert.ok(effects.some(effect => (
    effect.trigger === 'onTurnEnd'
    && effect.action.type === 'moveSelfAreaEnchant'
    && effect.conditions.some(condition => condition.type === 'zoneEntered' && condition.value === 'abyss' && condition.target === 'opponent')
  )));
  const G = preparedAreaEnchantState('3rd_91', 0);
  G.players[0].powerCharger = [createInstance('1st_13', true)];
  G.timingEvents.push({ type: 'zoneEntered', player: 1, zone: 'abyss', cardDefId: '1st_1' });
  resolveTimingEvent(G, parsedEffects, { type: 'turnEnd' });
  assert.equal(G.players[0].setZoneC, null);
  assert.equal(G.players[0].powerCharger.at(-1)?.defId, '3rd_91');

  const scopedEventState = preparedAreaEnchantState('3rd_91', 0);
  scopedEventState.step = 'turnSet';
  scopedEventState.turnNumber = 2;
  scopedEventState.players[0].battleZone = createInstance('1st_9', true);
  scopedEventState.players[1].battleZone = createInstance('1st_9', true);
  scopedEventState.players[0].powerCharger = [createInstance('1st_13', true)];
  scopedEventState.timingEvents.push({ type: 'zoneEntered', player: 1, zone: 'abyss', cardDefId: '1st_1' });
  resolveTurn(scopedEventState, parsedEffects);
  assert.equal(resolvePendingEffect(scopedEventState, 0, 0, parsedEffects), true);
  assert.equal(scopedEventState.players[0].powerCharger.at(-1)?.defId, '3rd_91');
  const nextTurnArea = createInstance('3rd_91', true);
  scopedEventState.players[0].setZoneC = nextTurnArea;
  resolveTimingEvent(scopedEventState, parsedEffects, { type: 'turnEnd' });
  assert.equal(scopedEventState.players[0].setZoneC?.instanceId, nextTurnArea.instanceId);
}

{
  const previousDark = parseEffect('前のターンで使用したキャラクターカードの属性が闇なら、攻撃力+20');
  const previousFlame = parseEffect('前のターンで使用したキャラクターカードの属性が炎なら、攻撃力+20');
  assert.ok(previousDark);
  assert.ok(previousFlame);

  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.players[0].hand = [createInstance('1st_9', true)];
  G.players[1].hand = [createInstance('1st_5', true)];
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);
  resolveTurn(G, noEffects);
  assert.deepEqual(G.previousTurnCharacterElements, ['闇', null]);
  assert.equal(executeEffect(previousDark, G, 0).success, true);
  assert.equal(G.modifiers.attack[0], 20);
  assert.equal(executeEffect(previousFlame, G, 0).success, false);
}

{
  const G = preparedState();
  const nightPositions: readonly number[] = CHRONOS_MAPPING.nightPositions;
  const dayPositions: readonly number[] = CHRONOS_MAPPING.dayPositions;

  for (let position = 0; position < CHRONOS_MAPPING.positions; position++) {
    G.chronos.position = position;
    const expected = nightPositions.includes(position) ? 'night' : 'day';
    assert.equal(getChronosTime(G), expected, `Chronos position ${position} should be ${expected}`);
  }

  assert.equal(nightPositions.length + dayPositions.length, CHRONOS_MAPPING.positions);
  assert.equal(new Set([...nightPositions, ...dayPositions]).size, CHRONOS_MAPPING.positions);

  G.chronos.position = CHRONOS_MAPPING.midnight;
  assert.equal(getChronosTime(G), 'night', 'Midnight should be night');

  G.chronos.position = CHRONOS_MAPPING.noon;
  assert.equal(getChronosTime(G), 'day', 'Noon should be day');

  G.chronos.position = CHRONOS_MAPPING.positions + CHRONOS_MAPPING.midnight;
  assert.equal(getChronosTime(G), 'night', 'Chronos should wrap past the final position');
}

{
  const G = preparedState();
  G.chronos.position = 0;
  G.setCardsThisTurn[0] = [createInstance('1st_1', true)];
  const effect = parsedCardEffect('2nd_26');
  assert.equal(executeEffect(effect, G, 0).success, true);
  assert.equal(G.modifiers.attack[0], 30);
}

{
  const G = preparedState();
  const effect = parsedCardEffect('3rd_26');
  assert.equal(executeEffect(effect, G, 0).success, true);
  G.chronos.position = 11;
  assert.equal(G.midnightRange, 2);
  assert.equal(getChronosTime(G), 'night');
}

{
  const G = preparedState();
  const noEffectCopy = createInstance('4th_3', true);
  const legalCopy = createInstance('4th_73', true);
  G.players[0].powerCharger = [noEffectCopy, legalCopy, createInstance('1st_9', true)];
  const effect = parsedCardEffect('4th_2');
  assert.equal(executeEffect(effect, G, 0).success, true);
  assert.equal(G.pendingChoice?.type, 'useFromAbyss');
  assert.deepEqual(G.pendingChoice?.options.map(option => option.cardInstanceId), [noEffectCopy.instanceId, legalCopy.instanceId]);
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  assert.equal(submitPendingChoice(G, 0, [legalCopy.instanceId], parsedEffects), true);
  assert.ok(G.pendingEffects[0].some(pending => pending.cardDefId === '4th_73'));
  assert.equal(G.players[0].powerCharger.length, 3);
}

{
  const G = preparedState();
  G.players[0].hp = 70;
  G.players[0].battleZone = createInstance('4th_1', true);
  assert.equal(executeEffect(parsedCardEffect('4th_55'), G, 0).success, true);
  assert.equal(G.players[0].hp, 90);
}

{
  const G = preparedState();
  G.players[0].hp = 30;
  G.players[0].powerCharger = [createInstance('1st_9', true), createInstance('1st_13', true), createInstance('1st_17', true)];
  assert.equal(executeEffect(parsedCardEffect('4th_59'), G, 0).success, true);
  assert.equal(G.players[0].hp, 80);
  G.players[0].hp = 30;
  G.players[0].powerCharger = [createInstance('1st_9', true), createInstance('1st_13', true)];
  assert.equal(executeEffect(parsedCardEffect('4th_93'), G, 0).success, true);
  assert.equal(G.players[0].hp, 60);
}

{
  const G = preparedState();
  G.players[0].hp = 50;
  G.players[0].battleZone = createInstance('1st_9', true);
  G.swappedCardsThisTurn[0] = [createInstance('4th_73', true)];
  assert.equal(executeEffect(parsedCardEffect('4th_73'), G, 0).success, true);
  assert.equal(G.players[0].hp, 70);
  G.swappedCardsThisTurn[0] = [createInstance('4th_75', true)];
  assert.equal(executeEffect(parsedCardEffect('4th_75'), G, 0).success, true);
  assert.equal(G.players[1].hp, 80);
}

{
  const G = preparedState();
  G.players[0].battleZone = createInstance('1st_9', true);
  G.players[0].hand = [createInstance('1st_1', true), createInstance('2nd_62', true)];
  G.players[0].powerCharger = [createInstance('1st_9', true), createInstance('1st_13', true), createInstance('1st_17', true)];
  G.players[1].battleZone = createInstance('1st_1', true);
  G.players[1].hand = [createInstance('1st_1', true), createInstance('1st_5', true)];
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.lastBattleResult = { winner: 1, damage: 0, winnerAttack: 0, loserAttack: 0 };
  assert.equal(setTurnCard(G, 0, 0, 'A'), true);
  assert.equal(setTurnCard(G, 0, 0, 'B'), true);
  assert.equal(setTurnCard(G, 1, 0, 'A'), true);
  assert.equal(confirmReady(G, 0, new Map([['2nd_62', [parsedCardEffect('2nd_62')]]])), true);
  assert.equal(confirmReady(G, 1, new Map([['2nd_62', [parsedCardEffect('2nd_62')]]])), true);
  assert.equal(G.players[0].battleZone?.defId, '1st_9');
}

{
  const G = preparedState();
  G.players[0].hand = [createInstance('3rd_4', false)];
  G.players[0].setZoneA = createInstance('1st_1', false);
  G.players[0].setZoneB = createInstance('1st_5', true);
  G.setCardsThisTurn[0] = [G.players[0].setZoneA, G.players[0].setZoneB];
  G.jankenChoices = ['rock', null];
  const viewForP1 = ZutomayoCard.playerView!({ G, ctx: {} as any, playerID: '1' }) as GameState;
  assert.equal(viewForP1.players[0].hand[0].defId, '__hidden__');
  assert.equal(viewForP1.players[0].deck[0].defId, '__hidden__');
  assert.equal(viewForP1.players[0].setZoneA?.defId, '__hidden__');
  assert.equal(viewForP1.players[0].setZoneA?.instanceId.includes('1st_1'), false);
  assert.equal(viewForP1.players[0].setZoneB?.defId, '1st_5');
  assert.equal(viewForP1.setCardsThisTurn[0][0].defId, '__hidden__');
  assert.equal(viewForP1.setCardsThisTurn[0][1].defId, '1st_5');
  assert.deepEqual(viewForP1.jankenChoices, [null, null]);
}

{
  const G = preparedState();
  G.players[0].deck = [createInstance('1st_1', true)];
  const drawTwo: ParsedEffect = {
    trigger: 'onUse', conditions: [], rawText: 'draw two',
    action: { type: 'drawCards', params: { value: 2 } },
  };
  assert.equal(executeEffect(drawTwo, G, 0).success, false);
  assert.equal(G.step, 'gameOver');
  assert.equal(G.winner, 1);
}

{
  const top = createInstance('1st_1', false);
  const next = createInstance('1st_5', false);
  const G = preparedState();
  G.players[1].deck = [top, next];
  G.players[1].abyss = [];
  const millOne: ParsedEffect = {
    trigger: 'onUse', conditions: [], rawText: 'mill one',
    action: { type: 'millDeckToAbyss', params: { target: 'opponent', count: 1 } },
  };
  assert.equal(executeEffect(millOne, G, 0).success, true);
  assert.deepEqual(G.players[1].abyss.map(card => card.instanceId), [top.instanceId]);
  assert.deepEqual(G.players[1].deck.map(card => card.instanceId), [next.instanceId]);
  assert.equal(top.faceUp, true);
}

{
  const top = createInstance('1st_1', false);
  const second = createInstance('1st_5', false);
  const third = createInstance('1st_9', false);
  const G = preparedState();
  G.players[1].deck = [top, second, third];
  G.players[1].abyss = [];
  const millTwo: ParsedEffect = {
    trigger: 'onUse', conditions: [], rawText: 'mill two',
    action: { type: 'millDeckToAbyss', params: { target: 'opponent', count: 2 } },
  };
  assert.equal(executeEffect(millTwo, G, 0).success, true);
  assert.deepEqual(G.players[1].abyss.map(card => card.instanceId), [top.instanceId, second.instanceId]);
  assert.deepEqual(G.players[1].deck.map(card => card.instanceId), [third.instanceId]);
  assert.equal(top.faceUp, true);
  assert.equal(second.faceUp, true);
}

{
  const top = createInstance('1st_1', false);
  const G = preparedState();
  G.players[1].deck = [top];
  G.players[1].abyss = [];
  const millTwo: ParsedEffect = {
    trigger: 'onUse', conditions: [], rawText: 'partial mill',
    action: { type: 'millDeckToAbyss', params: { target: 'opponent', count: 2 } },
  };
  assert.equal(executeEffect(millTwo, G, 0).success, true);
  assert.equal(G.step, 'initialSet');
  assert.deepEqual(G.players[1].abyss.map(card => card.instanceId), [top.instanceId]);
  assert.deepEqual(G.players[1].deck, []);
}

{
  const area = createInstance('2nd_5', false);
  const deckCard = createInstance('1st_1', false);
  const G = preparedState();
  G.players[1].setZoneC = area;
  G.players[1].deck = [deckCard];
  const returnTop: ParsedEffect = {
    trigger: 'onUse', conditions: [], rawText: 'return top',
    action: { type: 'returnAreaEnchantToDeck', params: { target: 'opponent', position: 'top' } },
  };
  assert.equal(executeEffect(returnTop, G, 0).success, true);
  assert.equal(G.players[1].setZoneC, null);
  assert.deepEqual(G.players[1].deck.map(card => card.instanceId), [area.instanceId, deckCard.instanceId]);
  assert.equal(area.faceUp, true);
}

{
  const area = createInstance('2nd_5', false);
  const deckCard = createInstance('1st_1', false);
  const G = preparedState();
  G.players[1].setZoneC = area;
  G.players[1].deck = [deckCard];
  const returnBottom: ParsedEffect = {
    trigger: 'onUse', conditions: [], rawText: 'return bottom',
    action: { type: 'returnAreaEnchantToDeck', params: { target: 'opponent', position: 'bottom' } },
  };
  assert.equal(executeEffect(returnBottom, G, 0).success, true);
  assert.equal(G.players[1].setZoneC, null);
  assert.deepEqual(G.players[1].deck.map(card => card.instanceId), [deckCard.instanceId, area.instanceId]);
  assert.equal(area.faceUp, true);
}

{
  const G = preparedState();
  G.players[1].setZoneC = null;
  const returnTop: ParsedEffect = {
    trigger: 'onUse', conditions: [], rawText: 'return missing',
    action: { type: 'returnAreaEnchantToDeck', params: { target: 'opponent', position: 'top' } },
  };
  assert.deepEqual(executeEffect(returnTop, G, 0), { success: false, message: 'No opposing Area Enchant' });
}

{
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  for (const id of ['1st_6', '1st_92', '2nd_6', '2nd_58', '4th_41', '4th_65', '4th_89', '4th_100']) {
    assert.ok(parsedEffects.get(id)?.length, `${id} should parse`);
  }

  assert.deepEqual(parsedCardEffect('1st_6').action, {
    type: 'useFromAbyss',
    params: { source: 'abyss', cardType: 'Enchant', count: 1 },
  });
  assert.deepEqual(parseEffect('※このカードを使用後、手札の数はバトル終了まで１枚増える')?.action, {
    type: 'handSizeModifier',
    params: { value: 1, duration: 'battle' },
  });
  assert.deepEqual(parsedCardEffect('2nd_6').action, { type: 'setPowerCost', params: { reduction: 2 } });
  assert.deepEqual(parsedCardEffect('2nd_58').action, {
    type: 'boostPower',
    params: { value: 1, perCount: true, per: 'zoneElementCount', zone: 'abyss', element: '闇' },
  });
  assert.equal(parsedEffects.get('4th_41')?.length, 1);
  assert.deepEqual(parsedEffects.get('4th_41')?.[0].conditions, [
    { type: 'namedCardCondition', value: 'シェードの埃は延長', target: 'swappedThisTurn' },
  ]);
  assert.deepEqual(parsedEffects.get('4th_41')?.[0].action, {
    type: 'noEffect',
    params: { scope: 'enchantOnly' },
  });
  assert.deepEqual(parsedCardEffect('4th_65').conditions, [
    { type: 'namedCardInBattleZone', value: 'お勉強しといてよ' },
  ]);
  assert.deepEqual(parsedCardEffect('1st_58').conditions, [
    { type: 'opponentPowerCost', value: 2, operator: 'gte' },
  ]);
  assert.deepEqual(parsedCardEffect('2nd_14').conditions, [
    { type: 'abyssElementCount', value: 2, operator: 'gte', element: '闇', owner: 'self' },
  ]);
  assert.deepEqual(parsedCardEffect('3rd_56').conditions, [
    { type: 'zoneCountComparison', value: 3, operator: 'lte', target: 'powerCharger', owner: 'self' },
  ]);
  assert.deepEqual(parsedCardEffect('3rd_87').conditions, [
    { type: 'hpComparison', value: 100, operator: 'eq', target: 'opponent' },
  ]);
  assert.deepEqual(parsedCardEffect('4th_29').conditions, [
    { type: 'noCardInAbyss', value: true, owner: 'opponent' },
  ]);
  assert.deepEqual(parsedCardEffect('1st_61').trigger, 'onChronosChanged');
  assert.deepEqual(parsedCardEffect('1st_61').conditions, [
    { type: 'chronosTimeChanged', value: 'dayToNight' },
  ]);
  assert.deepEqual(parsedCardEffect('4th_5').action, {
    type: 'boostAttack',
    params: { value: 20, perCount: true, per: 'zoneElementCount', zone: 'abyss', element: '風' },
  });
  assert.deepEqual(parseEffect('このカードの効果でカードを引いたなら、手札の数はゲーム終了まで１枚増える')?.action, {
    type: 'handSizeModifier',
    params: { value: 1, duration: 'game' },
  });
  assert.deepEqual(parseEffect('このカードの効果でカードを引いたなら、手札の数はゲーム終了まで１枚増える')?.conditions, [
    { type: 'drawOccurredThisEffect', value: true },
  ]);
  assert.deepEqual(parsedEffects.get('4th_100')?.[0].action, {
    type: 'directDamage',
    params: { value: 'reducedThisTurn', timing: 'turnEnd' },
  });
  assert.deepEqual(parsedCardEffect('4th_8').conditions, [
    { type: 'handElements', value: 4 },
  ]);
  assert.deepEqual(parsedCardEffect('3rd_8').conditions, [
    { type: 'specificElements', value: ['闇', '炎', '電気', '風'], target: 'abyss' },
  ]);
  assert.deepEqual(parsedCardEffect('3rd_22').conditions, [
    { type: 'specificElements', value: ['闇', '炎', '電気', '風'], target: 'abyss' },
  ]);
  assert.deepEqual(parsedCardEffect('4th_34').conditions, [
    { type: 'opponentAttack', value: 0, operator: 'eq' },
  ]);
  assert.deepEqual(parsedCardEffect('4th_60').conditions, [
    { type: 'opponentSendToPower', value: 2, operator: 'eq' },
  ]);
  assert.deepEqual(parsedCardEffect('3rd_1').conditions, [
    { type: 'chronosPosition', value: 'midnight' },
  ]);
  assert.deepEqual(parsedCardEffect('3rd_103').action, {
    type: 'revealOpponentDeckTopBySendToPower',
    params: { minSendToPower: 1, boostIfMissing: 30 },
  });
  const revealPowerEntryState = preparedState();
  revealPowerEntryState.players[0].setZoneC = createInstance('2nd_5', true);
  revealPowerEntryState.players[1].setZoneC = createInstance('4th_33', true);
  revealPowerEntryState.players[1].powerCharger = fivePowerCards();
  revealPowerEntryState.players[1].deck = [createInstance('1st_17', false)];
  assert.equal(executeEffect(parsedCardEffect('3rd_103'), revealPowerEntryState, 0, {
    onTimingEvent: event => resolveTimingEvent(revealPowerEntryState, parsedEffects, event),
  }).success, true);
  assert.equal(revealPowerEntryState.players[0].powerCharger.at(-1)?.defId, '2nd_5');
  assert.equal(revealPowerEntryState.players[1].setZoneC, null);
  assert.equal(revealPowerEntryState.players[1].abyss.at(-1)?.defId, '4th_33');
  assert.ok(parsedEffects.get('2nd_84')?.some(effect => (
    effect.action.type === 'setOpponentElement'
    && effect.action.params.value === '電気'
  )));

  const useFromAbyssState = preparedState();
  const copiedEnchant = createInstance('1st_92', true);
  useFromAbyssState.players[0].abyss = [copiedEnchant, createInstance('1st_1', true)];
  assert.equal(executeEffect(parsedCardEffect('1st_6'), useFromAbyssState, 0).success, true);
  assert.equal(useFromAbyssState.pendingChoice?.type, 'useFromAbyss');
  assert.deepEqual(useFromAbyssState.pendingChoice?.options.map(option => option.cardDefId), ['1st_92']);
  assert.equal(submitPendingChoice(useFromAbyssState, 0, [copiedEnchant.instanceId], parsedEffects), true);
  assert.ok(useFromAbyssState.pendingEffects[0].some(effect => effect.cardDefId === '1st_92'));

  const battleHandSizeState = preparedState();
  const battleHandSize = parseEffect('※このカードを使用後、手札の数はバトル終了まで１枚増える');
  assert.ok(battleHandSize);
  assert.equal(executeEffect(battleHandSize, battleHandSizeState, 0).success, true);
  assert.equal(battleHandSizeState.modifiers.handSize[0], 1);
  const gameHandSizeState = preparedState();
  const gameHandSize = parseEffect('このカードの効果でカードを引いたなら、手札の数はゲーム終了まで１枚増える');
  assert.ok(gameHandSize);
  assert.deepEqual(executeEffect(gameHandSize, gameHandSizeState, 0), { success: false, message: 'Condition not met' });
  gameHandSizeState.drawEffectCardIdsThisTurn.push('draw-source');
  assert.equal(executeEffect(gameHandSize, gameHandSizeState, 0, { cardInstanceId: 'draw-source' }).success, true);
  assert.equal(gameHandSizeState.handSizeModifier[0], 1);

  const reducedCostState = preparedState();
  const costlyCharacter = createInstance('1st_22', true);
  reducedCostState.players[0].battleZone = costlyCharacter;
  reducedCostState.setCardsThisTurn[0] = [costlyCharacter];
  assert.equal(getEffectiveAttack(costlyCharacter, reducedCostState, 0), 0);
  assert.equal(executeEffect(parsedCardEffect('2nd_6'), reducedCostState, 0).success, true);
  assert.equal(getEffectiveAttack(costlyCharacter, reducedCostState, 0), 50);

  const handElementsState = preparedState();
  handElementsState.players[0].hand = ['1st_1', '1st_2', '1st_3', '1st_4'].map(id => createInstance(id, true));
  assert.equal(executeEffect(parsedCardEffect('4th_8'), handElementsState, 0).success, true);
  assert.equal(handElementsState.modifiers.attack[0], 80);
  assert.deepEqual(handElementsState.revealedHandCardIds[0], handElementsState.players[0].hand.map(card => card.instanceId));

  const specificElementsState = preparedState();
  specificElementsState.players[0].abyss = ['1st_1', '1st_2', '1st_3', '1st_4'].map(id => createInstance(id, true));
  assert.equal(executeEffect(parsedCardEffect('3rd_8'), specificElementsState, 0).success, true);
  assert.equal(specificElementsState.modifiers.attack[0], 100);
  const extraChaosElementsState = preparedState();
  extraChaosElementsState.players[0].abyss = ['1st_1', '1st_2', '1st_3', '1st_4', '4th_6'].map(id => createInstance(id, true));
  assert.deepEqual(executeEffect(parsedCardEffect('3rd_8'), extraChaosElementsState, 0), { success: false, message: 'Condition not met' });

  const opponentAttackZeroState = preparedState();
  opponentAttackZeroState.players[1].battleZone = createInstance('1st_1', true);
  assert.equal(executeEffect(parsedCardEffect('4th_34'), opponentAttackZeroState, 0).success, true);
  assert.equal(opponentAttackZeroState.modifiers.attack[0], 30);

  const opponentSendToPowerState = preparedState();
  opponentSendToPowerState.players[1].battleZone = createInstance('1st_13', true);
  assert.equal(executeEffect(parsedCardEffect('4th_60'), opponentSendToPowerState, 0).success, true);
  assert.equal(opponentSendToPowerState.modifiers.attack[0], 20);

  const midnightConditionState = preparedState();
  midnightConditionState.chronos.position = 1;
  assert.equal(executeEffect(parsedCardEffect('3rd_1'), midnightConditionState, 0).success, false);
  midnightConditionState.midnightRange = 1;
  assert.equal(executeEffect(parsedCardEffect('3rd_1'), midnightConditionState, 0).success, true);
  assert.equal(midnightConditionState.modifiers.attack[0], 100);

  const elementOverrideState = preparedState();
  elementOverrideState.players[1].battleZone = createInstance('1st_1', true);
  const elementOverrideEffect = parsedEffects.get('2nd_84')?.find(effect => effect.action.type === 'setOpponentElement');
  assert.ok(elementOverrideEffect);
  assert.equal(executeEffect(elementOverrideEffect, elementOverrideState, 0).success, true);
  assert.equal(getEffectiveElement(elementOverrideState.players[1].battleZone!, elementOverrideState, 1), '電気');

  const deckTopSendToPowerBoostState = preparedState();
  deckTopSendToPowerBoostState.players[1].deck = [createInstance('1st_1', false)];
  assert.equal(executeEffect(parsedCardEffect('3rd_103'), deckTopSendToPowerBoostState, 0).success, true);
  assert.equal(deckTopSendToPowerBoostState.modifiers.attack[0], 30);
  assert.equal(deckTopSendToPowerBoostState.players[1].deck[0].faceUp, true);

  const deckTopSendToPowerMoveState = preparedState();
  const sendToPowerArea = createInstance('3rd_103', true);
  deckTopSendToPowerMoveState.players[0].setZoneC = sendToPowerArea;
  deckTopSendToPowerMoveState.players[1].deck = [createInstance('1st_9', false)];
  assert.equal(executeEffect(parsedCardEffect('3rd_103'), deckTopSendToPowerMoveState, 0).success, true);
  assert.equal(deckTopSendToPowerMoveState.players[0].setZoneC, null);
  assert.equal(deckTopSendToPowerMoveState.players[0].powerCharger.at(-1)?.instanceId, sendToPowerArea.instanceId);

  const enchantOnlyDisableState = preparedState();
  const enchantOnlyDisable = parsedEffects.get('4th_41')?.[0];
  assert.ok(enchantOnlyDisable);
  enchantOnlyDisableState.swappedCardsThisTurn[0] = [createInstance('4th_41', true)];
  assert.equal(executeEffect(enchantOnlyDisable, enchantOnlyDisableState, 0).success, true);
  assert.equal(enchantOnlyDisableState.modifiers.enchantEffectsDisabled[1], true);
  assert.equal(enchantOnlyDisableState.modifiers.effectsDisabled[1], false);
  enchantOnlyDisableState.players[1].powerCharger = fivePowerCards();
  const disabledEnchant = createInstance('1st_5', true);
  const enabledCharacter = createInstance('1st_1', true);
  const enchantOnlyPending = collectTurnEffects(
    enchantOnlyDisableState,
    new Map<string, ParsedEffect[]>([
      ['1st_5', [boost]],
      ['1st_1', [damage7]],
    ]),
    [[], [disabledEnchant, enabledCharacter]],
  );
  assert.deepEqual(enchantOnlyPending[1].map(effect => effect.cardDefId), ['1st_1']);

  const namedReducedCostState = preparedState();
  namedReducedCostState.chronos.position = 0;
  namedReducedCostState.players[0].battleZone = createInstance('1st_1', true);
  namedReducedCostState.players[0].powerCharger = [createInstance('1st_9', true), createInstance('1st_10', true), createInstance('1st_17', true)];
  assert.equal(getEffectiveAttack(namedReducedCostState.players[0].battleZone, namedReducedCostState, 0), 0);
  assert.equal(executeEffect(parsedCardEffect('4th_65'), namedReducedCostState, 0).success, true);
  assert.equal(getEffectiveAttack(namedReducedCostState.players[0].battleZone, namedReducedCostState, 0), 130);

  const abyssBoostState = preparedState();
  abyssBoostState.players[0].abyss = [createInstance('1st_9', true), createInstance('1st_10', true), createInstance('1st_13', true)];
  assert.equal(executeEffect(parsedCardEffect('2nd_58'), abyssBoostState, 0).success, true);
  assert.equal(abyssBoostState.modifiers.sendToPower[0], 2);

  const opponentPowerCostState = preparedState();
  opponentPowerCostState.players[1].battleZone = createInstance('1st_10', true);
  assert.deepEqual(executeEffect(parsedCardEffect('1st_58'), opponentPowerCostState, 0), { success: false, message: 'Condition not met' });
  opponentPowerCostState.players[1].battleZone = createInstance('1st_22', true);
  assert.equal(executeEffect(parsedCardEffect('1st_58'), opponentPowerCostState, 0).success, true);
  assert.equal(opponentPowerCostState.modifiers.attack[0], 20);

  const abyssElementCountState = preparedState();
  abyssElementCountState.players[0].hp = 50;
  abyssElementCountState.players[0].abyss = [createInstance('1st_9', true)];
  assert.deepEqual(executeEffect(parsedCardEffect('2nd_14'), abyssElementCountState, 0), { success: false, message: 'Condition not met' });
  abyssElementCountState.players[0].abyss.push(createInstance('1st_10', true));
  assert.equal(executeEffect(parsedCardEffect('2nd_14'), abyssElementCountState, 0).success, true);
  assert.equal(abyssElementCountState.players[0].hp, 70);

  const powerChargerCountState = preparedState();
  powerChargerCountState.players[0].powerCharger = [createInstance('1st_9', true), createInstance('1st_10', true), createInstance('1st_13', true), createInstance('1st_17', true)];
  assert.deepEqual(executeEffect(parsedCardEffect('3rd_56'), powerChargerCountState, 0), { success: false, message: 'Condition not met' });
  powerChargerCountState.players[0].powerCharger.pop();
  assert.equal(executeEffect(parsedCardEffect('3rd_56'), powerChargerCountState, 0).success, true);
  assert.equal(powerChargerCountState.modifiers.attack[0], 50);

  const opponentHpExactState = preparedState();
  opponentHpExactState.players[1].hp = 90;
  assert.deepEqual(executeEffect(parsedCardEffect('3rd_87'), opponentHpExactState, 0), { success: false, message: 'Condition not met' });
  opponentHpExactState.players[1].hp = 100;
  assert.equal(executeEffect(parsedCardEffect('3rd_87'), opponentHpExactState, 0).success, true);
  assert.equal(opponentHpExactState.modifiers.attack[0], 40);

  const noOpponentAbyssState = preparedState();
  noOpponentAbyssState.players[1].abyss = [createInstance('1st_9', true)];
  assert.deepEqual(executeEffect(parsedCardEffect('4th_29'), noOpponentAbyssState, 0), { success: false, message: 'Condition not met' });
  noOpponentAbyssState.players[1].abyss = [];
  assert.equal(executeEffect(parsedCardEffect('4th_29'), noOpponentAbyssState, 0).success, true);
  assert.equal(noOpponentAbyssState.modifiers.attack[0], 100);

  const perCountBoostState = preparedState();
  perCountBoostState.players[0].abyss = [createInstance('1st_4', true), createInstance('1st_21', true), createInstance('1st_9', true)];
  assert.equal(executeEffect(parsedCardEffect('4th_5'), perCountBoostState, 0).success, true);
  assert.equal(perCountBoostState.modifiers.attack[0], 40);

  const chronosTransitionState = preparedState();
  chronosTransitionState.timingEvents.push({
    type: 'chronosChanged',
    fromChronos: 8,
    toChronos: 0,
    fromChronosTime: 'day',
    toChronosTime: 'night',
  });
  assert.equal(executeEffect(parsedCardEffect('1st_61'), chronosTransitionState, 0).success, true);
  assert.equal(chronosTransitionState.modifiers.attack[0], 30);

  const revealBoostState = preparedState();
  const taidadaA = createInstance('4th_67', false);
  const taidadaB = createInstance('4th_68', false);
  revealBoostState.players[0].hand = [taidadaA, taidadaB, createInstance('1st_1', false)];
  revealBoostState.step = 'effectOrder';
  revealBoostState.pendingEffectPlayer = 0;
  revealBoostState.pendingEffects = [[{
    id: 'hold-reveal',
    player: 0,
    cardInstanceId: 'hold-reveal',
    cardDefId: 'hold-reveal',
    rawText: 'hold',
    effect: boost,
    source: 'played',
  }], []];
  assert.equal(executeEffect(parsedCardEffect('4th_1'), revealBoostState, 0).success, true);
  assert.equal(revealBoostState.pendingChoice?.type, 'revealHandAttackBoost');
  assert.equal(submitPendingChoice(revealBoostState, 0, [taidadaA.instanceId, taidadaB.instanceId], noEffects), true);
  assert.equal(revealBoostState.modifiers.attack[0], 60);
  assert.deepEqual(new Set(revealBoostState.revealedHandCardIds[0]), new Set([taidadaA.instanceId, taidadaB.instanceId]));

  for (const [id, attackBoost] of [
    ['3rd_47', 50],
    ['3rd_59', 100],
    ['3rd_94', 40],
    ['3rd_105', 100],
  ] as const) {
    assert.deepEqual(parsedCardEffect(id).action, {
      type: 'requestChoice',
      params: { choiceType: 'nameGuessOpponentHandReveal', attackBoost },
    }, `${id} should use the name-guess pending choice`);
  }

  const nameGuessState = preparedState();
  const guessedCard = createInstance('1st_4', false);
  nameGuessState.players[1].hand = [guessedCard];
  nameGuessState.step = 'effectOrder';
  nameGuessState.pendingEffectPlayer = 0;
  nameGuessState.pendingEffects = [[{
    id: 'hold-guess',
    player: 0,
    cardInstanceId: 'hold-guess',
    cardDefId: 'hold-guess',
    rawText: 'hold',
    effect: boost,
    source: 'played',
  }], []];
  assert.equal(executeEffect(parsedCardEffect('3rd_47'), nameGuessState, 0).success, true);
  const guessOption = nameGuessState.pendingChoice?.options.find(option => option.id === `hand:0:guess:${guessedCard.defId}`);
  assert.ok(guessOption);
  assert.equal(submitPendingChoice(nameGuessState, 0, [guessOption.id], noEffects), true);
  assert.equal(nameGuessState.modifiers.attack[0], 50);
  assert.deepEqual(nameGuessState.revealedHandCardIds[1], [guessedCard.instanceId]);

  const delayedDamageState = preparedState();
  delayedDamageState.players[0].battleZone = createInstance('1st_12', true);
  const delayedDamage = parsedEffects.get('4th_100')?.[0];
  assert.ok(delayedDamage);
  assert.equal(executeEffect(delayedDamage, delayedDamageState, 0).success, true);
  assert.equal(delayedDamageState.delayedEffects.length, 1);
  delayedDamageState.damageReducedThisTurn[0] = 35;
  resolveTimingEvent(delayedDamageState, noEffects, { type: 'turnEnd' });
  assert.equal(delayedDamageState.players[1].hp, 65);

  const characterPowerExpiryState = preparedAreaEnchantState('2nd_58', 0);
  characterPowerExpiryState.players[0].powerCharger = [createInstance('1st_9', true), createInstance('1st_10', true), createInstance('1st_17', true)];
  characterPowerExpiryState.timingEvents.push({ type: 'zoneEntered', player: 0, zone: 'powerCharger', cardDefId: '1st_9' });
  resolveTimingEvent(characterPowerExpiryState, parsedEffects, { type: 'turnEnd' });
  assert.equal(characterPowerExpiryState.players[0].setZoneC, null);
  assert.equal(characterPowerExpiryState.players[0].abyss.at(-1)?.defId, '2nd_58');

  const abyssCountExpiry = parsedEffects.get('3rd_86')?.find(effect => effect.action.type === 'moveSelfAreaEnchant');
  assert.deepEqual(abyssCountExpiry?.conditions, [{ type: 'zoneCountAtLeast', value: 4, target: 'abyss' }]);
}

console.log('game smoke: all assertions passed');
