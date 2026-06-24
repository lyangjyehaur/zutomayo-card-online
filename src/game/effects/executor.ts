import type { CardInstance, GameState, PlayerIndex } from '../types';
import type { ParsedEffect, Condition } from './types';
import { getCardDef } from '../cards/loader';

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
    case 'chronosChanged': return G.chronos.position !== G.chronosAtTurnStart;
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
    case 'previousCharElement': return false;
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
      else opponent.hp = Math.max(0, opponent.hp - value);
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
        G.chronos.position = 0;
        return { success: true, message: 'Set Chronos to position 0 (choice UI not implemented)' };
      }
      if (effect.action.params.value === 'expand_midnight') {
        G.midnightRange = Math.max(G.midnightRange, Number(effect.action.params.range ?? 0));
        return { success: true, message: `Midnight range +${G.midnightRange}` };
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
    case 'noEffect':
      G.modifiers.effectsDisabled[opponentIndex] = true;
      return { success: true, message: 'Disable opponent effects this turn' };
    case 'addSettableCard':
      return { success: false, message: 'Optional extra-set effects require a card-specific choice flow' };
  }
}

export function processTurnEffects(
  G: GameState,
  parsedEffects: Map<string, ParsedEffect[]>,
  playedCards: [CardInstance[], CardInstance[]] = [[], []],
): void {
  const priority: PlayerIndex = isNight(G)
    ? G.chronos.nightSidePlayer
    : ((1 - G.chronos.nightSidePlayer) as PlayerIndex);
  const order: PlayerIndex[] = [priority, (1 - priority) as PlayerIndex];
  for (const player of order) {
    if (G.step === 'gameOver' || G.modifiers.effectsDisabled[player]) continue;
    const playedIds = new Set(playedCards[player].map(card => card.instanceId));
    const candidates = [...playedCards[player], G.players[player].battleZone, G.players[player].setZoneC]
      .filter((card): card is CardInstance => card !== null)
      .filter((card, index, all) => all.findIndex(other => other.instanceId === card.instanceId) === index);
    for (const card of candidates) {
      const definition = getCardDef(card.defId);
      const effects = parsedEffects.get(card.defId) ?? [];
      for (const effect of effects) {
        const isNew = playedIds.has(card.instanceId);
        if ((effect.trigger === 'onUse' || effect.trigger === 'onEnter') && !isNew) continue;
        if (!['onUse', 'onEnter', 'onBattle'].includes(effect.trigger)) continue;
        if (!definition || power(G, player) < definition.powerCost) {
          G.log.push(`Player ${player}: ${definition?.name ?? card.defId} effect skipped (power cost).`);
          continue;
        }
        const result = executeEffect(effect, G, player);
        if (result.success) G.log.push(`Player ${player}: ${result.message}.`);
        if ((G.step as GameState['step']) === 'gameOver') return;
      }
    }
  }
}
