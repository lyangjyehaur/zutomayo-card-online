import type {
  CardType,
  CardInstance,
  Element,
  GameState,
  PendingAbyssToDeckBottomPayload,
  PendingCardFilter,
  PendingCardMovePayload,
  PendingChoiceCardZone,
  PendingChoiceDeckPosition,
  PendingChoiceDestinationZone,
  PendingEffect,
  PendingNameGuessOpponentHandRevealPayload,
  PendingEffectSource,
  PendingOptionalHandMoveThenDrawPayload,
  PendingOpponentPowerCharacterSwapPayload,
  PendingRevealHandAttackBoostPayload,
  PendingUseFromAbyssPayload,
  PlayerIndex,
} from '../types';
import { CHRONOS_MAPPING } from '../types';
import type { ParsedEffect, Condition } from './types';
import { getAllCardDefs, getCardDef } from '../cards/loader';
import { getChronosTimeForPosition, normalizeChronosPosition } from '../chronos';
import {
  isCharacterCard,
  legalCardMoveCards,
  legalOptionalHandMoveThenDrawCards,
  legalOpponentPowerCharacterSwapCards,
  relativePlayer,
  type RelativeChoicePlayer,
} from './choices';

function power(G: GameState, player: PlayerIndex): number {
  return G.players[player].powerCharger.reduce(
    (sum, card) => sum + (getCardDef(card.defId)?.sendToPower ?? 0), 0,
  );
}

function zoneElementCount(G: GameState, player: PlayerIndex, zone: string, element: string): number {
  const cards = zone === 'powerCharger' ? G.players[player].powerCharger : G.players[player].abyss;
  return cards.filter(card => getCardDef(card.defId)?.element === element).length;
}

function zoneSongCount(G: GameState, player: PlayerIndex, zone: string, song: string): number {
  const cards = zone === 'powerCharger' ? G.players[player].powerCharger : G.players[player].abyss;
  return cards.filter(card => getCardDef(card.defId)?.song === song).length;
}

function isNight(G: GameState): boolean {
  return getChronosTimeForPosition(G.chronos.position, G.midnightRange) === 'night';
}

function chronosTimeAt(position: number, midnightRange: number): 'night' | 'day' {
  return getChronosTimeForPosition(position, midnightRange);
}

function isNamedCharacter(card: CardInstance | null, song: string): boolean {
  if (!card) return false;
  const def = getCardDef(card.defId);
  return def?.type === 'Character' && def.song === song;
}

function compareNumber(actual: number, cond: Condition): boolean {
  const operator = cond.operator ?? 'gte';
  if (operator === 'in') {
    return Array.isArray(cond.value) && cond.value.map(Number).includes(actual);
  }
  const expected = Number(cond.value);
  if (operator === 'eq') return actual === expected;
  if (operator === 'lte') return actual <= expected;
  return actual >= expected;
}

function conditionPlayer(cond: Condition, player: PlayerIndex): PlayerIndex {
  if (cond.owner === 'opponent' || cond.target === 'opponent') return (1 - player) as PlayerIndex;
  return player;
}

function conditionZoneCards(G: GameState, player: PlayerIndex, cond: Condition): CardInstance[] {
  const owner = conditionPlayer(cond, player);
  return cond.target === 'powerCharger' ? G.players[owner].powerCharger : G.players[owner].abyss;
}

function latestChronosChangedEvent(G: GameState) {
  return [...G.timingEvents].reverse().find(item => item.type === 'chronosChanged');
}

function evaluateCondition(cond: Condition, G: GameState, player: PlayerIndex): boolean {
  const me = G.players[player];
  const opponent = G.players[(1 - player) as PlayerIndex];
  switch (cond.type) {
    case 'chronos': return (isNight(G) ? 'night' : 'day') === cond.value;
    case 'opponentElement': return !!opponent.battleZone && getCardDef(opponent.battleZone.defId)?.element === cond.value;
    case 'selfElement': return !!me.battleZone && getCardDef(me.battleZone.defId)?.element === cond.value;
    case 'powerAtLeast': return power(G, player) >= Number(cond.value);
    case 'abyssElements': {
      const cards = cond.target === 'powerCharger' ? me.powerCharger : me.abyss;
      return new Set(cards.map(card => getCardDef(card.defId)?.element).filter(Boolean)).size >= Number(cond.value);
    }
    case 'abyssElementCount': {
      const owner = conditionPlayer(cond, player);
      const element = cond.element ?? String(cond.value);
      const count = G.players[owner].abyss.filter(card => getCardDef(card.defId)?.element === element).length;
      return compareNumber(count, cond);
    }
    case 'powerChargerElementCount': {
      const owner = conditionPlayer(cond, player);
      const element = cond.element ?? String(cond.value);
      const count = G.players[owner].powerCharger.filter(card => getCardDef(card.defId)?.element === element).length;
      return compareNumber(count, cond);
    }
    case 'abyssAllSameElement': {
      const owner = conditionPlayer(cond, player);
      const cards = G.players[owner].abyss;
      return cards.length > 0 && cards.every(card => getCardDef(card.defId)?.element === cond.value);
    }
    case 'powerChargerAllSameElement': {
      const owner = conditionPlayer(cond, player);
      const cards = G.players[owner].powerCharger;
      return cards.length > 0 && cards.every(card => getCardDef(card.defId)?.element === cond.value);
    }
    case 'zoneHasElement': {
      const cards = cond.target === 'powerCharger' ? me.powerCharger : me.abyss;
      return cards.some(card => getCardDef(card.defId)?.element === cond.value);
    }
    case 'zoneEnteredCardType': {
      const targetPlayer = cond.target === 'opponent' ? (1 - player) as PlayerIndex : player;
      return G.timingEvents.some(event => (
        event.type === 'zoneEntered'
        && event.player === targetPlayer
        && event.zone === 'powerCharger'
        && getCardDef(event.cardDefId ?? '')?.type === cond.value
      ));
    }
    case 'abyssCount': return me.abyss.length >= Number(cond.value);
    case 'handCount': return me.hand.length >= Number(cond.value);
    case 'hpLessOrEqual': return (cond.target === 'opponent' ? opponent : me).hp <= Number(cond.value);
    case 'hpComparison': return compareNumber((cond.target === 'opponent' ? opponent : me).hp, cond);
    case 'hpLessThanOpponent': return me.hp < opponent.hp;
    case 'opponentPowerCost': {
      if (!opponent.battleZone) return false;
      const powerCost = getCardDef(opponent.battleZone.defId)?.powerCost;
      return powerCost !== undefined && compareNumber(powerCost, cond);
    }
    case 'selfPowerCost': {
      if (cond.value === 'sameAsOpponent') {
        if (!me.battleZone || !opponent.battleZone) return false;
        return getCardDef(me.battleZone.defId)?.powerCost === getCardDef(opponent.battleZone.defId)?.powerCost;
      }
      if (!me.battleZone) return false;
      const powerCost = getCardDef(me.battleZone.defId)?.powerCost;
      return powerCost !== undefined && compareNumber(powerCost, cond);
    }
    case 'damageAtLeast': {
      const event = [...G.timingEvents].reverse().find(item => item.type === 'damageReceived' && item.player === player);
      return Number(event?.amount ?? 0) >= Number(cond.value);
    }
    case 'zoneEntered': {
      const targetPlayer = cond.target === 'opponent' ? (1 - player) as PlayerIndex : player;
      return G.timingEvents.some(event => (
        event.type === 'zoneEntered'
        && (cond.target === 'any' || event.player === targetPlayer)
        && event.zone === cond.value
      ));
    }
    case 'zoneCountAtLeast': {
      const cards = cond.target === 'powerCharger' ? me.powerCharger : me.abyss;
      return cards.length >= Number(cond.value);
    }
    case 'zoneCountComparison': return compareNumber(conditionZoneCards(G, player, cond).length, cond);
    case 'chronosChanged': return G.chronos.position !== G.chronosAtTurnStart;
    case 'chronosTimeChanged': {
      if (cond.value === true) return chronosTimeAt(G.chronosAtTurnStart, G.midnightRange) !== chronosTimeAt(G.chronos.position, G.midnightRange);
      const event = latestChronosChangedEvent(G);
      if (!event) return false;
      if (cond.value === 'dayToNight') return event.fromChronosTime === 'day' && event.toChronosTime === 'night';
      if (cond.value === 'nightToDay') return event.fromChronosTime === 'night' && event.toChronosTime === 'day';
      return event.fromChronosTime !== event.toChronosTime;
    }
    case 'namedCardCondition': {
      const song = String(cond.value);
      if (cond.target === 'battleZone') return isNamedCharacter(me.battleZone, song);
      if (cond.target === 'battleZoneNot') return !!me.battleZone && !isNamedCharacter(me.battleZone, song);
      if (cond.target === 'playedThisTurn') return G.setCardsThisTurn[player].some(card => isNamedCharacter(card, song));
      if (cond.target === 'swappedThisTurn') return G.swappedCardsThisTurn[player].some(card => isNamedCharacter(card, song));
      return isNamedCharacter(me.battleZone, song) || G.setCardsThisTurn[player].some(card => isNamedCharacter(card, song));
    }
    case 'namedCardInBattleZone': return isNamedCharacter(G.players[conditionPlayer(cond, player)].battleZone, String(cond.value));
    case 'noCardInAbyss': return G.players[conditionPlayer(cond, player)].abyss.length === 0;
    case 'simultaneousCharacter':
      return G.setCardsThisTurn[player].some(card => getCardDef(card.defId)?.type === 'Character');
    case 'hasAreaEnchant': {
      const owner = cond.target === 'opponent' ? opponent : me;
      if (cond.value === true) return !!owner.setZoneC;
      return !!owner.setZoneC && owner.setZoneC.defId === cond.value;
    }
    case 'battleLost': return G.lastBattleResult.winner !== null && G.lastBattleResult.winner !== player;
    case 'previousCharElement': return G.previousTurnCharacterElements?.[player] === cond.value;
    case 'and': return (cond.value as Condition[]).every(item => evaluateCondition(item, G, player));
    case 'or': return (cond.value as Condition[]).some(item => evaluateCondition(item, G, player));
  }
}

function loseOnEffectOverdraw(G: GameState, player: PlayerIndex, count: number): boolean {
  if (G.players[player].deck.length >= count) return false;
  G.step = 'gameOver';
  G.winner = (1 - player) as PlayerIndex;
  G.gameoverReason = `Player ${player} loses: effect attempted to draw ${count} with only ${G.players[player].deck.length} cards.`;
  G.log.push(G.gameoverReason);
  return true;
}

function loseByHp(G: GameState, player: PlayerIndex, reason: string): void {
  G.step = 'gameOver';
  G.winner = (1 - player) as PlayerIndex;
  G.gameoverReason = reason;
  G.ready = [true, true];
  G.log.push(reason);
}

function loseByAbyssPaymentFailure(G: GameState, player: PlayerIndex, min: number, available: number): void {
  const reason = `Player ${player} loses: cannot pay Abyss-to-deck-bottom requirement (needs ${min}, has ${available}).`;
  G.step = 'gameOver';
  G.winner = (1 - player) as PlayerIndex;
  G.gameoverReason = reason;
  G.ready = [true, true];
  G.pendingEffects = [[], []];
  G.pendingEffectPlayer = null;
  G.pendingChoice = null;
  G.log.push(reason);
}

function isPersistentAreaEnchantEffect(card: CardInstance, effect: ParsedEffect): boolean {
  return getCardDef(card.defId)?.type === 'Area Enchant' && [
    'boostAttack',
    'forceOwnAttackTime',
    'setPowerCost',
    'setAllCardClocks',
  ].includes(effect.action.type);
}

export function getTurnEffectPlayerOrder(G: GameState): [PlayerIndex, PlayerIndex] {
  const priority: PlayerIndex = isNight(G)
    ? G.chronos.nightSidePlayer
    : ((1 - G.chronos.nightSidePlayer) as PlayerIndex);
  return [priority, (1 - priority) as PlayerIndex];
}

function effectSource(G: GameState, player: PlayerIndex, card: CardInstance): PendingEffectSource {
  if (G.players[player].battleZone?.instanceId === card.instanceId) return 'battleZone';
  if (G.players[player].setZoneC?.instanceId === card.instanceId) return 'setZoneC';
  return 'played';
}

export function collectTurnEffects(
  G: GameState,
  parsedEffects: Map<string, ParsedEffect[]>,
  playedCards: [CardInstance[], CardInstance[]] = [[], []],
): [PendingEffect[], PendingEffect[]] {
  const pending: [PendingEffect[], PendingEffect[]] = [[], []];
  for (const player of getTurnEffectPlayerOrder(G)) {
    if (G.step === 'gameOver' || G.modifiers.effectsDisabled[player]) continue;
    const playedIds = new Set(playedCards[player].map(card => card.instanceId));
    const candidates = [...playedCards[player], G.players[player].battleZone, G.players[player].setZoneC]
      .filter((card): card is CardInstance => card !== null)
      .filter(card => !(G.suppressedEffectCardIdsThisTurn ?? []).includes(card.instanceId))
      .filter((card, index, all) => all.findIndex(other => other.instanceId === card.instanceId) === index);
    for (const card of candidates) {
      const definition = getCardDef(card.defId);
      const effects = parsedEffects.get(card.defId) ?? [];
      for (const [effectIndex, effect] of effects.entries()) {
        const isNew = playedIds.has(card.instanceId);
        if (!['onUse', 'onEnter', 'onBattle'].includes(effect.trigger)) continue;
        const isPersistedSetZoneC = G.players[player].setZoneC?.instanceId === card.instanceId;
        const canRunPersisted = isPersistedSetZoneC && isPersistentAreaEnchantEffect(card, effect);
        if ((effect.trigger === 'onUse' || effect.trigger === 'onEnter') && !isNew && !canRunPersisted) continue;
        if (!definition || power(G, player) < definition.powerCost) {
          G.log.push(`Player ${player}: ${definition?.name ?? card.defId} effect skipped (power cost).`);
          continue;
        }
        pending[player].push({
          id: `${card.instanceId}:${effectIndex}:${pending[player].length}`,
          player,
          cardInstanceId: card.instanceId,
          cardDefId: card.defId,
          rawText: effect.rawText,
          effect,
          source: effectSource(G, player, card),
        });
      }
    }
  }
  return pending;
}

export function executeEffect(
  effect: ParsedEffect,
  G: GameState,
  player: PlayerIndex,
): { success: boolean; message: string } {
  if (!effect.conditions.every(condition => evaluateCondition(condition, G, player))) {
    return { success: false, message: 'Condition not met' };
  }
  const me = G.players[player];
  const opponentIndex = (1 - player) as PlayerIndex;
  const opponent = G.players[opponentIndex];
  const valueParam = effect.action.params.value;
  const value = Number(effect.action.params.value ?? 0);
  switch (effect.action.type) {
    case 'boostAttack': {
      let multiplier = 1;
      if (effect.action.params.per === 'zoneElementCount') {
        multiplier = zoneElementCount(
          G,
          player,
          String(effect.action.params.zone ?? 'abyss'),
          String(effect.action.params.element ?? ''),
        );
      }
      if (effect.action.params.per === 'zoneSongCount') {
        multiplier = zoneSongCount(
          G,
          player,
          String(effect.action.params.zone ?? 'abyss'),
          String(effect.action.params.song ?? ''),
        );
      }
      const boost = effect.action.params.per || effect.action.params.perCount ? value * multiplier : value;
      G.modifiers.attack[player] += boost;
      return { success: true, message: `Attack +${boost}` };
    }
    case 'boostBothAttackByOwnHp':
      G.modifiers.attack[player] += me.hp;
      G.modifiers.attack[opponentIndex] += opponent.hp;
      return { success: true, message: 'Both players gain attack equal to own HP' };
    case 'reduceAttack':
      G.modifiers.attack[opponentIndex] -= value;
      return { success: true, message: `Opponent attack -${value}` };
    case 'setOpponentAttack':
      if (!G.modifiers.attackSetTo) G.modifiers.attackSetTo = [null, null];
      G.modifiers.attackSetTo[opponentIndex] = value;
      return { success: true, message: `Opponent attack set to ${value}` };
    case 'heal':
      me.hp = Math.min(100, me.hp + value);
      return { success: true, message: `Heal ${value}` };
    case 'directDamage': {
      if (effect.action.params.timing === 'turnEnd') {
        const { timing: _timing, ...params } = effect.action.params;
        if (!G.delayedEffects) G.delayedEffects = [];
        G.delayedEffects.push({
          id: `delayed-${player}-${G.turnNumber}-${G.log.length}-${G.delayedEffects.length}`,
          player,
          cardInstanceId: `delayed-${player}`,
          cardDefId: 'delayed-effect',
          rawText: effect.rawText,
          effect: {
            ...effect,
            trigger: 'onTurnEnd',
            conditions: [],
            action: { type: 'directDamage', params },
          },
          source: 'played',
        });
        return { success: true, message: 'Scheduled turn-end damage' };
      }
      const damage = valueParam === 'reducedThisTurn'
        ? (G.damageReducedThisTurn?.[player] ?? 0)
        : value;
      if (damage === -1) G.modifiers.unreduceableDamage[player] = true;
      else {
        opponent.hp = Math.max(0, opponent.hp - damage);
        if (opponent.hp <= 0) loseByHp(G, opponentIndex, `Player ${opponentIndex} loses at 0 HP.`);
      }
      return { success: true, message: damage === -1 ? 'Battle damage cannot be reduced' : `Deal ${damage}` };
    }
    case 'damageReduce':
      G.modifiers.damageReduction[player] += value;
      return { success: true, message: `Damage reduction +${value}` };
    case 'drawCards': {
      if (loseOnEffectOverdraw(G, player, value)) return { success: false, message: 'Not enough cards to draw' };
      for (let i = 0; i < value; i++) {
        const card = me.deck.shift()!;
        card.faceUp = true;
        me.hand.push(card);
      }
      return { success: true, message: `Draw ${value}` };
    }
    case 'swapAttack':
      G.modifiers.swapAttack[opponentIndex] = !G.modifiers.swapAttack[opponentIndex];
      return { success: true, message: 'Swap opponent day/night attack' };
    case 'forceOwnAttackTime': {
      const time = effect.action.params.value;
      if (time !== 'day' && time !== 'night') return { success: false, message: 'Unsupported attack time override' };
      if (!G.modifiers.attackTimeOverride) G.modifiers.attackTimeOverride = [null, null];
      G.modifiers.attackTimeOverride[player] = time;
      return { success: true, message: `Own attack uses ${time}` };
    }
    case 'clockReset':
      G.chronos.position = G.chronosAtTurnStart;
      return { success: true, message: 'Reset Chronos' };
    case 'clockSetFromTurnStartMinusOpponentClock': {
      const clock = opponent.battleZone ? getCardDef(opponent.battleZone.defId)?.clock : undefined;
      if (!Number.isInteger(clock)) return { success: false, message: 'No opposing character clock' };
      G.chronos.position = normalizeChronosPosition(G.chronosAtTurnStart - Number(clock));
      return { success: true, message: `Chronos set to turn start -${clock}` };
    }
    case 'setAllCardClocks':
      G.modifiers.cardClockSetTo = value;
      return { success: true, message: `All card clocks set to ${value}` };
    case 'expandMidnightRange':
      G.midnightRange = Math.max(G.midnightRange, Number(effect.action.params.range ?? 0));
      return { success: true, message: `Midnight range +${G.midnightRange}` };
    case 'clockSet':
      if (effect.action.params.value === 'any') {
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'clockPosition',
          min: 1,
          max: 1,
          prompt: effect.rawText,
          payload: {},
          options: Array.from({ length: CHRONOS_MAPPING.positions }, (_, position) => ({
            id: `chronos-${position}`,
            label: `${position}`,
            value: position,
          })),
        };
        return { success: true, message: 'Pending Chronos position selection' };
      }
      if (Number.isInteger(Number(effect.action.params.value))) {
        const next = normalizeChronosPosition(Number(effect.action.params.value));
        G.chronos.position = next;
        return { success: true, message: `Set Chronos to ${next}` };
      }
      return { success: false, message: 'Unsupported clock range effect' };
    case 'clockAdvance':
      G.chronos.position = normalizeChronosPosition(G.chronos.position + value);
      return { success: true, message: `Chronos +${value}` };
    case 'recoverFromAbyss': {
      const source = effect.action.params.source === 'powerCharger' ? me.powerCharger : me.abyss;
      const max = Number(effect.action.params.max ?? 1);
      let recovered = 0;
      for (let i = source.length - 1; i >= 0 && recovered < max; i--) {
        const card = source[i];
        const def = getCardDef(card.defId);
        if (effect.action.params.song && def?.song !== effect.action.params.song) continue;
        if (effect.action.params.cardType && def?.type !== effect.action.params.cardType) continue;
        source.splice(i, 1);
        card.faceUp = true;
        me.hand.push(card);
        recovered++;
      }
      if (recovered === 0) return { success: false, message: 'No card to recover' };
      return { success: true, message: `Recover ${recovered} card${recovered === 1 ? '' : 's'}` };
    }
    case 'sendToAbyss': {
      const card = opponent.battleZone;
      if (!card) return { success: false, message: 'No opposing character' };
      opponent.battleZone = null;
      opponent.abyss.push(card);
      return { success: true, message: 'Send opposing character to Abyss' };
    }
    case 'millDeckToAbyss': {
      let count: number;
      if (effect.action.params.countFromLastChoice) {
        const selectedCount = G.lastChoiceSelectionCount[player];
        if (selectedCount === null || selectedCount <= 0) {
          return { success: false, message: 'Missing selected count for mill effect' };
        }
        count = selectedCount;
      } else {
        count = Number(effect.action.params.count ?? 0);
      }
      let moved = 0;
      for (let i = 0; i < count && opponent.deck.length > 0; i++) {
        const card = opponent.deck.shift()!;
        card.faceUp = true;
        opponent.abyss.push(card);
        moved++;
      }
      if (effect.action.params.countFromLastChoice) G.lastChoiceSelectionCount[player] = null;
      return { success: true, message: `Mill ${moved} opposing card${moved === 1 ? '' : 's'} to Abyss` };
    }
    case 'moveOwnDeckTopByPower': {
      if (me.deck.length === 0) {
        loseOnEffectOverdraw(G, player, 1);
        return { success: false, message: 'No deck top card to move' };
      }
      const card = me.deck.shift()!;
      const sendToPower = getCardDef(card.defId)?.sendToPower ?? 0;
      card.faceUp = true;
      if (sendToPower > 0) {
        me.powerCharger.push(card);
        return { success: true, message: 'Move deck top to Power Charger' };
      }
      me.abyss.push(card);
      return { success: true, message: 'Move deck top to Abyss' };
    }
    case 'moveOpponentDeckTopByPowerCost': {
      const minPowerCost = Number(effect.action.params.minPowerCost ?? 0);
      if (opponent.deck.length === 0) return { success: false, message: 'No opposing deck top card to reveal' };
      const card = opponent.deck[0];
      card.faceUp = true;
      const powerCost = getCardDef(card.defId)?.powerCost ?? 0;
      if (powerCost >= minPowerCost) {
        opponent.deck.shift();
        opponent.powerCharger.push(card);
        return { success: true, message: 'Move opposing deck top to Power Charger' };
      }
      return { success: true, message: 'Reveal opposing deck top' };
    }
    case 'revealOpponentHand': {
      if (!G.revealedHandCardIds) G.revealedHandCardIds = [[], []];
      const revealed = new Set(G.revealedHandCardIds[opponentIndex]);
      for (const card of opponent.hand) revealed.add(card.instanceId);
      G.revealedHandCardIds[opponentIndex] = [...revealed];
      return { success: true, message: 'Reveal opposing hand' };
    }
    case 'returnAreaEnchantToDeck': {
      const card = opponent.setZoneC;
      if (!card) return { success: false, message: 'No opposing Area Enchant' };
      opponent.setZoneC = null;
      card.faceUp = true;
      if (effect.action.params.position === 'top') opponent.deck.unshift(card);
      else opponent.deck.push(card);
      return { success: true, message: 'Return opposing Area Enchant to deck' };
    }
    case 'moveSelfAreaEnchant': {
      const card = me.setZoneC;
      if (!card) return { success: false, message: 'No own Area Enchant' };
      me.setZoneC = null;
      card.faceUp = true;
      if (effect.action.params.destination === 'powerCharger') me.powerCharger.push(card);
      else me.abyss.push(card);
      return { success: true, message: `Move own Area Enchant to ${effect.action.params.destination === 'powerCharger' ? 'Power Charger' : 'Abyss'}` };
    }
    case 'useFromAbyss': {
      const sourceZone = effect.action.params.source === 'powerCharger' ? 'powerCharger' : 'abyss';
      const source = sourceZone === 'powerCharger' ? me.powerCharger : me.abyss;
      const max = Number(effect.action.params.count ?? effect.action.params.max ?? 1);
      const options = source
        .filter(card => {
          const def = getCardDef(card.defId);
          if (!def) return false;
          if (effect.action.params.cardType !== undefined && def.type !== effect.action.params.cardType) return false;
          if (effect.action.params.song !== undefined && def.song !== effect.action.params.song) return false;
          if (sourceZone === 'abyss' && effect.action.params.cardType === undefined && def.type !== 'Enchant') return false;
          return true;
        })
        .map(card => ({
          id: card.instanceId,
          label: getCardDef(card.defId)?.name ?? card.defId,
          cardInstanceId: card.instanceId,
          cardDefId: card.defId,
        }));
      if (options.length === 0) return { success: false, message: 'No card effect to use' };
      const payload: PendingUseFromAbyssPayload = {
        sourcePlayer: player,
        sourceZone,
        cardType: typeof effect.action.params.cardType === 'string' ? effect.action.params.cardType as CardType : undefined,
        song: typeof effect.action.params.song === 'string' ? effect.action.params.song : undefined,
      };
      G.pendingChoice = {
        id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
        player,
        type: 'useFromAbyss',
        min: 1,
        max: Math.max(1, Math.min(max, options.length)),
        prompt: effect.rawText,
        payload,
        options,
      };
      return { success: true, message: 'Pending copied effect selection' };
    }
    case 'handSizeModifier': {
      const amount = Number(effect.action.params.value ?? 0);
      if (effect.action.params.duration === 'game') {
        if (!G.handSizeModifier) G.handSizeModifier = [0, 0];
        G.handSizeModifier[player] += amount;
        return { success: true, message: `Game hand size +${amount}` };
      }
      if (!G.modifiers.handSize) G.modifiers.handSize = [0, 0];
      G.modifiers.handSize[player] += amount;
      return { success: true, message: `Battle hand size +${amount}` };
    }
    case 'setPowerCost': {
      const reduction = Number(effect.action.params.reduction ?? effect.action.params.value ?? 0);
      if (!G.modifiers.powerCostReduction) G.modifiers.powerCostReduction = [0, 0];
      G.modifiers.powerCostReduction[player] += reduction;
      return { success: true, message: `Character power cost -${reduction}` };
    }
    case 'requestChoice': {
      if (effect.action.params.choiceType === 'revealHandAttackBoost') {
        const boostPerCard = Number(effect.action.params.boostPerCard ?? 0);
        const filter: PendingCardFilter = {};
        if (effect.action.params.filterCardType !== undefined) {
          const cardType = String(effect.action.params.filterCardType);
          if (!['Character', 'Enchant', 'Area Enchant'].includes(cardType)) {
            return { success: false, message: 'Unsupported reveal card type filter' };
          }
          filter.cardType = cardType as CardType;
        }
        if (effect.action.params.filterSong !== undefined) {
          const song = String(effect.action.params.filterSong).trim();
          if (song.length === 0) return { success: false, message: 'Unsupported reveal song filter' };
          filter.song = song;
        }

        const payload: PendingRevealHandAttackBoostPayload = {
          sourcePlayer: player,
          boostPerCard,
          filter,
        };
        const options = me.hand
          .filter(card => {
            const def = getCardDef(card.defId);
            if (!def) return false;
            if (filter.cardType !== undefined && def.type !== filter.cardType) return false;
            if (filter.song !== undefined && def.song !== filter.song) return false;
            if (filter.element !== undefined && def.element !== filter.element) return false;
            return true;
          })
          .map(card => ({
            id: card.instanceId,
            label: getCardDef(card.defId)?.name ?? card.defId,
            cardInstanceId: card.instanceId,
            cardDefId: card.defId,
          }));
        if (options.length === 0) return { success: true, message: 'No legal hand cards to reveal' };
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'revealHandAttackBoost',
          min: 0,
          max: options.length,
          prompt: effect.rawText,
          payload,
          options,
        };
        return { success: true, message: 'Pending hand reveal selection' };
      }

      if (effect.action.params.choiceType === 'nameGuessOpponentHandReveal') {
        const attackBoost = Number(effect.action.params.attackBoost ?? 0);
        if (opponent.hand.length === 0) return { success: false, message: 'No opposing hand card to reveal' };
        const payload: PendingNameGuessOpponentHandRevealPayload = {
          opponentPlayer: opponentIndex,
          attackBoost,
        };
        const cardDefs = getAllCardDefs();
        const options = opponent.hand.flatMap((_card, handIndex) => cardDefs.map(def => ({
          id: `hand:${handIndex}:guess:${def.id}`,
          label: `${def.name} / Opponent hand ${handIndex + 1}`,
          value: def.id,
        })));
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'nameGuessOpponentHandReveal',
          min: 1,
          max: 1,
          prompt: effect.rawText,
          payload,
          options,
        };
        return { success: true, message: 'Pending name guess and hand reveal' };
      }

      if (effect.action.params.choiceType === 'optionalHandMoveThenDraw') {
        const sourceOwner = String(effect.action.params.sourceOwner);
        const sourceZone = String(effect.action.params.sourceZone);
        const destinationOwner = String(effect.action.params.destinationOwner);
        const destinationZone = String(effect.action.params.destinationZone);
        const destinationPosition = effect.action.params.destinationPosition === undefined
          ? undefined
          : String(effect.action.params.destinationPosition);
        const drawCountParam = effect.action.params.drawCount ?? 0;
        const drawCount = drawCountParam === 'selected' ? 'selected' : Number(drawCountParam);
        if (
          sourceOwner !== 'self'
          || sourceZone !== 'hand'
          || destinationOwner !== 'self'
          || !['abyss', 'powerCharger', 'deck'].includes(destinationZone)
          || (destinationZone === 'deck' && destinationPosition !== 'bottom')
          || (destinationZone !== 'deck' && destinationPosition !== undefined)
          || (drawCount !== 'selected' && drawCount !== 1)
        ) {
          return { success: false, message: 'Unsupported optional hand payment choice' };
        }

        const filter: PendingCardFilter = {};
        if (effect.action.params.filterCardType !== undefined) {
          const cardType = String(effect.action.params.filterCardType);
          if (!['Character', 'Enchant', 'Area Enchant'].includes(cardType)) {
            return { success: false, message: 'Unsupported optional hand payment card type filter' };
          }
          filter.cardType = cardType as CardType;
        }
        if (effect.action.params.filterSong !== undefined) {
          const song = String(effect.action.params.filterSong).trim();
          if (song.length === 0) return { success: false, message: 'Unsupported optional hand payment song filter' };
          filter.song = song;
        }
        if (effect.action.params.filterElement !== undefined) {
          const element = String(effect.action.params.filterElement);
          if (!['闇', '炎', '電気', '風', 'カオス'].includes(element)) {
            return { success: false, message: 'Unsupported optional hand payment element filter' };
          }
          filter.element = element as Element;
        }

        const payload: PendingOptionalHandMoveThenDrawPayload = {
          sourcePlayer: relativePlayer(player, sourceOwner as RelativeChoicePlayer),
          sourceZone: 'hand',
          destinationPlayer: relativePlayer(player, destinationOwner as RelativeChoicePlayer),
          destinationZone: destinationZone as PendingOptionalHandMoveThenDrawPayload['destinationZone'],
          destinationPosition: destinationPosition as PendingChoiceDeckPosition | undefined,
          drawCount,
          filter,
        };
        const options = legalOptionalHandMoveThenDrawCards(G, payload).map(card => ({
          id: card.instanceId,
          label: getCardDef(card.defId)?.name ?? card.defId,
          cardInstanceId: card.instanceId,
          cardDefId: card.defId,
        }));
        if (options.length === 0) {
          return { success: true, message: 'No legal optional hand payment cards' };
        }
        const max = drawCount === 'selected' ? options.length : 1;
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'optionalHandMoveThenDraw',
          min: 0,
          max,
          prompt: effect.rawText,
          payload,
          options,
        };
        return { success: true, message: 'Pending optional hand payment selection' };
      }

      if (effect.action.params.choiceType === 'cardMove') {
        const count = Number(effect.action.params.count ?? 1);
        const sourceOwner = String(effect.action.params.sourceOwner);
        const destinationOwner = String(effect.action.params.destinationOwner);
        const sourceZone = String(effect.action.params.sourceZone);
        const destinationZone = String(effect.action.params.destinationZone);
        const destinationPosition = effect.action.params.destinationPosition === undefined
          ? undefined
          : String(effect.action.params.destinationPosition);
        if (
          !['self', 'opponent'].includes(sourceOwner)
          || !['self', 'opponent'].includes(destinationOwner)
          || !Number.isInteger(count)
          || count < 1
          || !['hand', 'abyss', 'powerCharger'].includes(sourceZone)
          || !['abyss', 'deck'].includes(destinationZone)
          || (destinationZone === 'deck' && destinationPosition !== 'bottom')
        ) {
          return { success: false, message: 'Unsupported card choice move' };
        }
        const payload: PendingCardMovePayload = {
          sourcePlayer: relativePlayer(player, sourceOwner as RelativeChoicePlayer),
          sourceZone: sourceZone as PendingChoiceCardZone,
          destinationPlayer: relativePlayer(player, destinationOwner as RelativeChoicePlayer),
          destinationZone: destinationZone as PendingChoiceDestinationZone,
          destinationPosition: destinationPosition as PendingChoiceDeckPosition | undefined,
          filterSendToPower: effect.action.params.filterSendToPower === undefined
            ? undefined
            : Number(effect.action.params.filterSendToPower),
        };
        const options = legalCardMoveCards(G, payload).map(card => ({
          id: card.instanceId,
          label: getCardDef(card.defId)?.name ?? card.defId,
          cardInstanceId: card.instanceId,
          cardDefId: card.defId,
        }));
        if (options.length === 0) return { success: false, message: 'No legal cards for choice' };
        if (options.length < count) return { success: false, message: 'Not enough legal cards for choice' };
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'cardMove',
          min: count,
          max: count,
          prompt: effect.rawText,
          payload,
          options,
        };
        return { success: true, message: 'Pending card selection' };
      }

      if (effect.action.params.choiceType === 'abyssToDeckBottomOrLose') {
        const min = Number(effect.action.params.min ?? 1);
        const maxParam = effect.action.params.max ?? min;
        const dynamicMax = maxParam === 'available';
        const max = dynamicMax ? me.abyss.length : Number(maxParam);
        if (!Number.isInteger(min) || min < 1 || (!dynamicMax && (!Number.isInteger(max) || max < min))) {
          return { success: false, message: 'Unsupported Abyss payment choice' };
        }

        const available = me.abyss.length;
        if (available < min) {
          loseByAbyssPaymentFailure(G, player, min, available);
          return { success: false, message: 'Not enough Abyss cards for payment' };
        }

        const payload: PendingAbyssToDeckBottomPayload = {
          faceDown: Boolean(effect.action.params.faceDown),
          shuffle: Boolean(effect.action.params.shuffle),
        };
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'abyssToDeckBottomOrLose',
          min,
          max,
          prompt: effect.rawText,
          payload,
          options: me.abyss.map(card => ({
            id: card.instanceId,
            label: getCardDef(card.defId)?.name ?? card.defId,
            cardInstanceId: card.instanceId,
            cardDefId: card.defId,
          })),
        };
        return { success: true, message: 'Pending Abyss payment selection' };
      }

      if (effect.action.params.choiceType === 'opponentPowerCharacterSwap') {
        if (!isCharacterCard(opponent.battleZone)) {
          return { success: false, message: 'No opposing Battle Zone Character' };
        }
        const payload: PendingOpponentPowerCharacterSwapPayload = { opponentPlayer: opponentIndex };
        const options = legalOpponentPowerCharacterSwapCards(G, payload).map(card => ({
          id: card.instanceId,
          label: getCardDef(card.defId)?.name ?? card.defId,
          cardInstanceId: card.instanceId,
          cardDefId: card.defId,
        }));
        if (options.length === 0) return { success: false, message: 'No legal cards for choice' };
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'opponentPowerCharacterSwap',
          min: 1,
          max: 1,
          prompt: effect.rawText,
          payload,
          options,
        };
        return { success: true, message: 'Pending opponent Power Charger Character swap' };
      }

      if (effect.action.params.choiceType === 'handAbyssSwap') {
        if (me.hand.length === 0 || me.abyss.length === 0) return { success: false, message: 'No legal cards for hand/Abyss swap' };
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'handAbyssSwap',
          min: 2,
          max: 2,
          prompt: effect.rawText,
          payload: {},
          options: [
            ...me.hand.map(card => ({
              id: `hand:${card.instanceId}`,
              label: `Hand: ${getCardDef(card.defId)?.name ?? card.defId}`,
              cardInstanceId: card.instanceId,
              cardDefId: card.defId,
            })),
            ...me.abyss.map(card => ({
              id: `abyss:${card.instanceId}`,
              label: `Abyss: ${getCardDef(card.defId)?.name ?? card.defId}`,
              cardInstanceId: card.instanceId,
              cardDefId: card.defId,
            })),
          ],
        };
        return { success: true, message: 'Pending hand/Abyss swap' };
      }

      if (effect.action.params.choiceType === 'clockPosition') {
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'clockPosition',
          min: 1,
          max: 1,
          prompt: effect.rawText,
          payload: {},
          options: Array.from({ length: CHRONOS_MAPPING.positions }, (_, position) => ({
            id: `chronos-${position}`,
            label: `${position}`,
            value: position,
          })),
        };
        return { success: true, message: 'Pending Chronos position selection' };
      }

      if (effect.action.params.choiceType === 'clockAdvance') {
        const min = Number(effect.action.params.min ?? 0);
        const max = Number(effect.action.params.max ?? min);
        if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
          return { success: false, message: 'Unsupported Chronos advance choice' };
        }
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'clockAdvance',
          min: 1,
          max: 1,
          prompt: effect.rawText,
          payload: {},
          options: Array.from({ length: max - min + 1 }, (_, index) => {
            const amount = min + index;
            return { id: `advance-${amount}`, label: `+${amount}`, value: amount };
          }),
        };
        return { success: true, message: 'Pending Chronos advance selection' };
      }

      if (effect.action.params.choiceType !== 'handToDeckBottomThenDraw') {
        return { success: false, message: 'Unsupported choice type' };
      }
      const discardCount = Number(effect.action.params.discardCount ?? 1);
      const drawCount = Number(effect.action.params.drawCount ?? discardCount);
      G.pendingChoice = {
        id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
        player,
        type: 'handToDeckBottomThenDraw',
        min: discardCount,
        max: discardCount,
        prompt: effect.rawText,
        payload: { drawCount },
        options: me.hand.map(card => ({
          id: card.instanceId,
          label: getCardDef(card.defId)?.name ?? card.defId,
          cardInstanceId: card.instanceId,
          cardDefId: card.defId,
        })),
      };
      return { success: true, message: 'Pending hand selection' };
    }
    case 'noEffect':
      G.modifiers.effectsDisabled[opponentIndex] = true;
      return { success: true, message: 'Disable opponent effects this turn' };
    case 'suppressEffectActivation':
      return { success: true, message: 'Swapped-in Character effect suppression clause' };
    case 'addSettableCard':
      return { success: false, message: 'Optional extra-set effects require a card-specific choice flow' };
  }
}

export function processTurnEffects(
  G: GameState,
  parsedEffects: Map<string, ParsedEffect[]>,
  playedCards: [CardInstance[], CardInstance[]] = [[], []],
): void {
  const pending = collectTurnEffects(G, parsedEffects, playedCards);
  for (const player of getTurnEffectPlayerOrder(G)) {
    if (G.step === 'gameOver' || G.modifiers.effectsDisabled[player]) continue;
    for (const pendingEffect of pending[player]) {
      const result = executeEffect(pendingEffect.effect, G, player);
      if (result.success) G.log.push(`Player ${player}: ${result.message}.`);
      if ((G.step as GameState['step']) === 'gameOver') return;
    }
  }
}
