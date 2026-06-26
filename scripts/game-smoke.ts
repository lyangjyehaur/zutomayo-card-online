import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createInstance, getAllCardDefs } from '../src/game/cards/loader';
import { PRESET_DECKS } from '../src/game/cards/presetDecks';
import { isValidConstructedDeck, validateConstructedDeckIds } from '../src/game/cards/deckBuilder';
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
  submitPendingChoice,
} from '../src/game/GameLogic';
import { executeEffect, processTurnEffects } from '../src/game/effects/executor';
import { parseAllEffects, parseEffect } from '../src/game/effects/parser';
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

function preparedAreaEnchantState(defId: string, chronosPosition: number): GameState {
  const G = preparedState();
  G.players[0].setZoneC = createInstance(defId, true);
  G.players[0].powerCharger = [createInstance('1st_9', true)];
  G.chronos.position = chronosPosition;
  return G;
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
  assert.match(validateConstructedDeckIds(noCharacters) ?? '', /at least 10 Character/);

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
  for (let i = 0; i < 10 && player0.getState()?.G.step === 'effectOrder'; i++) {
    const pendingPlayer = player0.getState()?.G.pendingEffectPlayer;
    assert.notEqual(pendingPlayer, null);
    (pendingPlayer === 0 ? player0 : player1).moves.resolvePendingEffect(0);
  }
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
  const parsedEffects = new Map<string, ParsedEffect[]>([
    ['2nd_5', [turnEndDamage5, turnStartHeal10]],
  ]);
  resolveTurn(G, parsedEffects);
  assert.equal(G.step, 'turnSet');
  assert.equal(G.turnNumber, 3);
  assert.equal(G.players[1].hp, 95);
  assert.equal(G.players[0].hp, 90);
  assert.ok((G as any).timingEvents);
  assert.ok((G as any).timingEvents.some((event: any) => event.type === 'turnEnd'));
  assert.ok((G as any).timingEvents.some((event: any) => event.type === 'turnStart'));
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
  assert.ok((G as any).timingEvents.some((event: any) => event.type === 'damageReceived'));
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
  G.chronos.position = 10;
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
  G.chronos.position = 10;
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
  assert.ok(G.timingEvents.some(event => event.type === 'zoneEntered' && event.player === 1 && event.zone === 'battleZone' && event.cardDefId === '1st_1'));
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
  assert.ok(G.timingEvents.some(event => event.type === 'characterReplaced' && event.player === 0 && event.cardDefId === '1st_9' && event.replacedCardDefId === '1st_17'));
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
  const taidadaEffect = parsedCardEffect('4th_55');
  assert.deepEqual(taidadaEffect.conditions, [{ type: 'namedCardCondition', value: 'TAIDADA', target: 'battleZone' }]);
  assert.deepEqual(taidadaEffect.action, { type: 'heal', params: { value: 20 } });
}

{
  assert.equal(parseEffect('ターンの終了時に相手のHP-10')?.trigger, 'onTurnEnd');
  assert.equal(parseEffect('ターンの開始時にHPを10回復')?.trigger, 'onTurnStart');
  assert.equal(parseEffect('パワーチャージャーの電気属性のカード１枚につき、攻撃力+20。相手のHPが30以下になったターンの終了時にアビスに置く')?.trigger, 'onUse');
  assert.equal(parseEffect('相手のキャラクターカードの時計を無効にする。昼と夜が入れ替わったターンの終了時にアビスに置く')?.trigger, 'onUse');
  const areaExpiryEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect }))).get('2nd_5') ?? [];
  assert.ok(areaExpiryEffects.some(effect => effect.trigger === 'onTurnEnd' && effect.action.type === 'moveSelfAreaEnchant'));
  const chronosExpiryEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect }))).get('2nd_86') ?? [];
  assert.ok(chronosExpiryEffects.some(effect => effect.trigger === 'onChronosChanged' && effect.action.type === 'moveSelfAreaEnchant'));
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
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.chronos.position = 5;
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
  assert.equal(G.players[0].setZoneC, null);
  assert.equal(G.players[0].abyss.at(-1)?.defId, '2nd_5');
}

{
  const parsedEffects = parseAllEffects(getAllCardDefs().map(({ id, effect }) => ({ id, effect })));
  const G = preparedState();
  G.step = 'turnSet';
  G.turnNumber = 2;
  G.chronos.position = 5;
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

console.log('game smoke: all assertions passed');
