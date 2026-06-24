import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createInstance, getAllCardDefs } from '../src/game/cards/loader';
import {
  confirmReady,
  finishMulligan,
  getChronosTime,
  getRequiredSetCount,
  placeRevealedCards,
  resolveJanken,
  resolveBattle,
  resolveTurn,
  setInitialCard,
  setTurnCard,
  setupGame,
} from '../src/game/GameLogic';
import { executeEffect, processTurnEffects } from '../src/game/effects/executor';
import { parseEffect } from '../src/game/effects/parser';
import type { GameState } from '../src/game/types';
import type { ParsedEffect } from '../src/game/effects';
import { ZutomayoCard } from '../src/game/Game';

const require = createRequire(import.meta.url);
const { Client } = require('boardgame.io/client') as typeof import('boardgame.io/client');
const { Local } = require('boardgame.io/multiplayer') as typeof import('boardgame.io/multiplayer');

const noEffects = new Map<string, ParsedEffect[]>();
const boost: ParsedEffect = {
  trigger: 'onUse', conditions: [], rawText: 'test',
  action: { type: 'boostAttack', params: { value: 20 } },
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
  player1.moves.janken('scissors');
  assert.equal(player0.getState()?.G.step, 'mulligan');
  assert.equal(player1.getState()?.G.step, 'mulligan');
  player0.moves.keepHand();
  player1.moves.keepHand();
  assert.equal(player0.getState()?.G.step, 'initialSet');
  player0.moves.setInitialCard(0);
  player1.moves.setInitialCard(0);
  player0.moves.confirmReady();
  player1.moves.confirmReady();
  assert.equal(player0.getState()?.G.step, 'turnSet');
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
  G.players[0].powerCharger = [createInstance('4th_3', true), createInstance('4th_73', true), createInstance('1st_9', true)];
  const handBefore = G.players[0].hand.length;
  const effect = parsedCardEffect('4th_2');
  assert.equal(executeEffect(effect, G, 0).success, true);
  assert.equal(G.players[0].hand.length, handBefore + 2);
  assert.equal(G.players[0].powerCharger.length, 1);
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

console.log('game smoke: all assertions passed');
