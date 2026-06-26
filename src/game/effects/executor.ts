import type {
  CardInstance,
  GameState,
  PendingAbyssToDeckBottomPayload,
  PendingCardMovePayload,
  PendingChoiceCardZone,
  PendingChoiceDeckPosition,
  PendingChoiceDestinationZone,
  PendingEffect,
  PendingEffectSource,
  PendingOpponentPowerCharacterSwapPayload,
  PlayerIndex,
} from '../types';
import type { ParsedEffect, Condition } from './types';
import { getCardDef } from '../cards/loader';
import {
  isCharacterCard,
  legalCardMoveCards,
  legalOpponentPowerCharacterSwapCards,
  relativePlayer,
  type RelativeChoicePlayer,
} from './choices';

function power(G: GameState, player: PlayerIndex): number {
  return G.players[player].powerCharger.reduce(
    (sum, card) => sum + (getCardDef(card.defId)?.sendToPower ?? 0), 0,
  );
}

function isNight(G: GameState): boolean {
  const position = ((G.chronos.position % 12) + 12) % 12;
  const distanceFromMidnight = Math.min(position, 12 - position);
  return position < 6 || distanceFromMidnight <= G.midnightRange;
}

function chronosTimeAt(position: number, midnightRange: number): 'night' | 'day' {
  const normalized = ((position % 12) + 12) % 12;
  const distanceFromMidnight = Math.min(normalized, 12 - normalized);
  return normalized < 6 || distanceFromMidnight <= midnightRange ? 'night' : 'day';
}

function isNamedCharacter(card: CardInstance | null, song: string): boolean {
  if (!card) return false;
  const def = getCardDef(card.defId);
  return def?.type === 'Character' && def.song === song;
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
    case 'abyssCount': return me.abyss.length >= Number(cond.value);
    case 'handCount': return me.hand.length >= Number(cond.value);
    case 'hpLessOrEqual': return me.hp <= Number(cond.value);
    case 'hpLessThanOpponent': return me.hp < opponent.hp;
    case 'damageAtLeast': {
      const event = [...G.timingEvents].reverse().find(item => item.type === 'damageReceived' && item.player === player);
      return Number(event?.amount ?? 0) >= Number(cond.value);
    }
    case 'zoneEntered': {
      const targetPlayer = cond.target === 'opponent' ? (1 - player) as PlayerIndex : player;
      return G.timingEvents.some(event => (
        event.type === 'zoneEntered'
        && event.player === targetPlayer
        && event.zone === cond.value
      ));
    }
    case 'chronosChanged': return G.chronos.position !== G.chronosAtTurnStart;
    case 'chronosTimeChanged': return chronosTimeAt(G.chronosAtTurnStart, G.midnightRange) !== chronosTimeAt(G.chronos.position, G.midnightRange);
    case 'namedCardCondition': {
      const song = String(cond.value);
      if (cond.target === 'battleZone') return isNamedCharacter(me.battleZone, song);
      if (cond.target === 'playedThisTurn') return G.setCardsThisTurn[player].some(card => isNamedCharacter(card, song));
      if (cond.target === 'swappedThisTurn') return G.swappedCardsThisTurn[player].some(card => isNamedCharacter(card, song));
      return isNamedCharacter(me.battleZone, song) || G.setCardsThisTurn[player].some(card => isNamedCharacter(card, song));
    }
    case 'simultaneousCharacter':
      return G.setCardsThisTurn[player].some(card => getCardDef(card.defId)?.type === 'Character');
    case 'hasAreaEnchant': return !!me.setZoneC && me.setZoneC.defId === cond.value;
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
  return getCardDef(card.defId)?.type === 'Area Enchant' && effect.action.type === 'boostAttack';
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
  const value = Number(effect.action.params.value ?? 0);
  switch (effect.action.type) {
    case 'boostAttack':
      G.modifiers.attack[player] += value;
      return { success: true, message: `Attack +${value}` };
    case 'reduceAttack':
      G.modifiers.attack[opponentIndex] -= value;
      return { success: true, message: `Opponent attack -${value}` };
    case 'heal':
      me.hp = Math.min(100, me.hp + value);
      return { success: true, message: `Heal ${value}` };
    case 'directDamage':
      if (value === -1) G.modifiers.unreduceableDamage[player] = true;
      else {
        opponent.hp = Math.max(0, opponent.hp - value);
        if (opponent.hp <= 0) loseByHp(G, opponentIndex, `Player ${opponentIndex} loses at 0 HP.`);
      }
      return { success: true, message: value === -1 ? 'Battle damage cannot be reduced' : `Deal ${value}` };
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
    case 'clockReset':
      G.chronos.position = G.chronosAtTurnStart;
      return { success: true, message: 'Reset Chronos' };
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
          options: Array.from({ length: 12 }, (_, position) => ({
            id: `chronos-${position}`,
            label: `${position}`,
            value: position,
          })),
        };
        return { success: true, message: 'Pending Chronos position selection' };
      }
      if (effect.action.params.value === 'expand_midnight') {
        G.midnightRange = Math.max(G.midnightRange, Number(effect.action.params.range ?? 0));
        return { success: true, message: `Midnight range +${G.midnightRange}` };
      }
      if (Number.isInteger(Number(effect.action.params.value))) {
        const next = ((Number(effect.action.params.value) % 12) + 12) % 12;
        G.chronos.position = next;
        return { success: true, message: `Set Chronos to ${next}` };
      }
      return { success: false, message: 'Unsupported clock range effect' };
    case 'clockAdvance':
      G.chronos.position = (G.chronos.position + value) % 12;
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
    case 'requestChoice': {
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

      if (effect.action.params.choiceType === 'clockPosition') {
        G.pendingChoice = {
          id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
          player,
          type: 'clockPosition',
          min: 1,
          max: 1,
          prompt: effect.rawText,
          payload: {},
          options: Array.from({ length: 12 }, (_, position) => ({
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
