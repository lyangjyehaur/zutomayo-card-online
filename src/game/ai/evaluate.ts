import { getAllCardDefs, getCardDef } from '../cards/loader';
import { getChronosTimeForPosition, normalizeChronosPosition } from '../chronos';
import { parseAllEffects } from '../effects';
import type { EffectAction, ParsedEffect } from '../effects';
import { getEffectiveAttack, getPlayerPower } from '../GameLogic';
import type { CardDef, CardInstance, GameState, PendingChoice, PlayerIndex } from '../types';
import type { AITraceFactor } from './types';

let parsedEffectsCache: Map<string, ParsedEffect[]> | null = null;
let parsedEffectsSignature = '';

export function getAIParsedEffects(): Map<string, ParsedEffect[]> {
  const definitions = getAllCardDefs();
  const signature = definitions.map((card) => `${card.id}:${card.effect}`).join('|');
  if (!parsedEffectsCache || signature !== parsedEffectsSignature) {
    parsedEffectsCache = parseAllEffects(definitions.map((card) => ({ id: card.id, effect: card.effect })));
    parsedEffectsSignature = signature;
  }
  return parsedEffectsCache;
}

function numericParam(action: EffectAction, key = 'value'): number {
  const value = Number(action.params[key] ?? action.params.amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function effectActionValue(action: EffectAction, G: GameState, player: PlayerIndex): number {
  const me = G.players[player];
  const opponent = G.players[(1 - player) as PlayerIndex];
  const amount = Math.abs(numericParam(action));
  switch (action.type) {
    case 'directDamage':
      return amount >= opponent.hp ? 500 : amount * 14;
    case 'heal':
      return Math.min(amount, Math.max(0, 100 - me.hp)) * 11;
    case 'healOpponent':
      return -Math.min(amount, Math.max(0, 100 - opponent.hp)) * 11;
    case 'healBoth':
      return (Math.min(amount, 100 - me.hp) - Math.min(amount, 100 - opponent.hp)) * 8;
    case 'boostAttack':
    case 'reduceAttack':
    case 'setOpponentAttack':
    case 'boostBothAttackByOwnHp':
      return amount * 3 + 12;
    case 'damageReduce':
      return amount * 4 + (me.hp <= 25 ? 25 : 8);
    case 'drawCards':
      return amount * 18;
    case 'boostPower':
    case 'setPowerCost':
      return amount * 8 + 10;
    case 'clockSet':
    case 'clockAdvance':
    case 'clockReset':
    case 'clockRewindOpponentCharacter':
    case 'clockSetFromTurnStartMinusOpponentClock':
    case 'nullifyOpponentClock':
      return 18 + amount * 2;
    case 'recoverFromAbyss':
    case 'useFromAbyss':
    case 'addSettableCard':
      return 28;
    case 'handSizeModifier':
      return 24 + amount * 8;
    case 'sendToAbyss':
    case 'millDeckToAbyss':
    case 'moveOwnDeckTopByPower':
    case 'moveOpponentDeckTopByPowerCost':
      return 12 + amount * 5;
    case 'requestChoice':
      return 16;
    case 'noEffect':
    case 'suppressEffectActivation':
    case 'returnAreaEnchantToDeck':
    case 'moveOpponentAreaEnchant':
      return 25;
    case 'moveSelfAreaEnchant':
      return -8;
    case 'revealOpponentHand':
    case 'revealOpponentDeckTopBySendToPower':
      return 10;
    case 'swapAttack':
    case 'forceOwnAttackTime':
    case 'setOpponentElement':
    case 'setAllCardClocks':
    case 'expandMidnightRange':
      return 14;
  }
}

export function effectValue(effect: ParsedEffect, G: GameState, player: PlayerIndex): number {
  const conditionDiscount = effect.conditions.length > 0 ? 0.68 : 1;
  const triggerDiscount = effect.trigger === 'onUse' || effect.trigger === 'onBattle' ? 1 : 0.72;
  return effectActionValue(effect.action, G, player) * conditionDiscount * triggerDiscount;
}

function projectedTime(G: GameState, clockAdvance: number): 'night' | 'day' {
  return getChronosTimeForPosition(normalizeChronosPosition(G.chronos.position + clockAdvance), G.midnightRange);
}

export function scoreCardDefinition(
  def: CardDef,
  G: GameState,
  player: PlayerIndex,
  projectedClock = def.clock,
): { score: number; factors: AITraceFactor[] } {
  const power = getPlayerPower(G.players[player], G, player);
  const factors: AITraceFactor[] = [];
  let score = 0;

  if (def.type === 'Character' && def.attack) {
    const time = projectedTime(G, projectedClock);
    const attack = def.attack[time];
    const affordable = power >= def.powerCost;
    const attackValue = affordable ? attack : 0;
    score += attackValue;
    factors.push({ label: 'effectiveAttack', value: attackValue, detail: time });
    const affordability = affordable ? 24 : -70 - def.powerCost * 3;
    score += affordability;
    factors.push({ label: 'powerCost', value: affordability, detail: `${power}/${def.powerCost}` });
    const clockValue = Math.max(-18, 10 - Math.abs(def.clock - 2) * 4);
    score += clockValue;
    factors.push({ label: 'chronos', value: clockValue, detail: `${def.clock}` });
  } else {
    const affordability = power >= def.powerCost ? 25 : -55 - def.powerCost * 2;
    score += affordability;
    factors.push({ label: 'powerCost', value: affordability, detail: `${power}/${def.powerCost}` });
    if (def.type === 'Area Enchant') {
      const persistence = G.players[player].setZoneC ? -12 : 22;
      score += persistence;
      factors.push({ label: 'areaPersistence', value: persistence });
    }
  }

  const effects = getAIParsedEffects().get(def.id) ?? [];
  const effectsScore = effects.reduce((sum, effect) => sum + effectValue(effect, G, player), 0);
  score += effectsScore;
  if (effects.length > 0) factors.push({ label: 'parsedEffects', value: effectsScore, detail: `${effects.length}` });
  score += def.sendToPower * 2;
  if (def.sendToPower) factors.push({ label: 'futurePower', value: def.sendToPower * 2 });
  return { score, factors };
}

export function scoreCard(
  card: CardInstance,
  G: GameState,
  player: PlayerIndex,
  projectedClock?: number,
): { score: number; factors: AITraceFactor[] } {
  const def = getCardDef(card.defId);
  if (!def) return { score: -1000, factors: [{ label: 'missingDefinition', value: -1000 }] };
  return scoreCardDefinition(def, G, player, projectedClock);
}

export function evaluateState(G: GameState, player: PlayerIndex): number {
  const opponent = (1 - player) as PlayerIndex;
  if (G.step === 'gameOver') {
    if (G.winner === player) return 100_000;
    if (G.winner === opponent) return -100_000;
  }
  const me = G.players[player];
  const them = G.players[opponent];
  const ownAttack = me.battleZone && getCardDef(me.battleZone.defId) ? getEffectiveAttack(me.battleZone, G, player) : 0;
  const opponentAttack =
    them.battleZone && getCardDef(them.battleZone.defId) ? getEffectiveAttack(them.battleZone, G, opponent) : 0;
  return (
    (me.hp - them.hp) * 45 +
    (ownAttack - opponentAttack) * 3 +
    (getPlayerPower(me, G, player) - getPlayerPower(them, G, opponent)) * 9 +
    (me.hand.length - them.hand.length) * 7 +
    (me.deck.length - them.deck.length) * 1.5 +
    (me.setZoneC ? 18 : 0) -
    (them.setZoneC ? 18 : 0)
  );
}

function optionCardValue(choice: PendingChoice, optionDefId: string | undefined, G: GameState): number {
  if (!optionDefId) return 0;
  const def = getCardDef(optionDefId);
  if (!def) return 0;
  const sourcePlayer = 'sourcePlayer' in choice.payload ? choice.payload.sourcePlayer : choice.player;
  return scoreCardDefinition(def, G, sourcePlayer).score;
}

export function choiceOptionHeuristic(choice: PendingChoice, optionIds: string[], G: GameState): number {
  const options = optionIds.map((id) => choice.options.find((option) => option.id === id)).filter(Boolean);
  const values = options.map((option) => optionCardValue(choice, option?.cardDefId, G));
  const total = values.reduce((sum, value) => sum + value, 0);
  switch (choice.type) {
    case 'cardMove':
      return choice.payload.destinationPlayer === choice.player ? total : -total;
    case 'optionalHandMoveThenDraw':
    case 'handToDeckBottomThenDraw':
      return -total + optionIds.length * 18;
    case 'useFromAbyss':
    case 'useFromHand':
    case 'revealHandAttackBoost':
      return total;
    case 'opponentPowerCharacterSwap':
      return -total;
    case 'handAbyssSwap': {
      const handValue = options[0]?.id.startsWith('hand:') ? values[0] : values[1];
      const abyssValue = options[0]?.id.startsWith('abyss:') ? values[0] : values[1];
      return (abyssValue ?? 0) - (handValue ?? 0);
    }
    case 'clockPosition':
    case 'clockAdvance':
      return options.reduce((sum, option) => sum + Math.abs(Number(option?.value ?? 0)), 0);
    case 'abyssToDeckBottomOrLose':
      return total + optionIds.length * 30;
    case 'reorderOpponentDeckTop':
    case 'nameGuessOpponentHandReveal':
      return 0;
  }
}
