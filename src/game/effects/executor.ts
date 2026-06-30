import type {
  CardType,
  CardInstance,
  Element,
  GameState,
  HpChangeBreakdown,
  HpChangeBreakdownLine,
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
  PendingChoice,
  PendingReorderDeckTopPayload,
  PendingRevealHandAttackBoostPayload,
  PendingUseFromAbyssPayload,
  PendingUseFromHandPayload,
  PlayerIndex,
  PlayerState,
  TimingEvent,
} from '../types';
import { CHRONOS_MAPPING } from '../types';
import type { ParsedEffect, Condition, EffectValue, ActionType } from './types';
import { getAllCardDefs, getCardDef } from '../cards/loader';
import { getChronosTimeForPosition, normalizeChronosPosition } from '../chronos';
import { pushHpChange } from '../hpChange';
import { recordAction } from '../actionLog';
import {
  isCharacterCard,
  legalCardMoveCards,
  legalOptionalHandMoveThenDrawCards,
  legalOpponentPowerCharacterSwapCards,
  relativePlayer,
  type RelativeChoicePlayer,
} from './choices';

export interface EffectExecutionContext {
  cardInstanceId?: string;
  cardDefId?: string;
  onTimingEvent?: (event: TimingEvent) => void;
}

function emitTimingEvent(G: GameState, context: EffectExecutionContext, event: TimingEvent): void {
  if (context.onTimingEvent) {
    context.onTimingEvent(event);
    return;
  }
  G.timingEvents.push(event);
  G.log.push(`Timing ${event.type}.`);
}

function emitZoneEntered(
  G: GameState,
  context: EffectExecutionContext,
  player: PlayerIndex,
  zone: NonNullable<TimingEvent['zone']>,
  card: CardInstance,
): void {
  emitTimingEvent(G, context, { type: 'zoneEntered', player, zone, cardDefId: card.defId });
}

export function areEffectsDisabledForCard(G: GameState, player: PlayerIndex, cardDefId?: string): boolean {
  if (G.modifiers.effectsDisabled?.[player]) return true;
  if (!G.modifiers.enchantEffectsDisabled?.[player]) return false;
  return getCardDef(cardDefId ?? '')?.type === 'Enchant';
}

function power(G: GameState, player: PlayerIndex): number {
  const base = G.players[player].powerCharger.reduce(
    (sum, card) => sum + (getCardDef(card.defId)?.sendToPower ?? 0),
    0,
  );
  return Math.max(0, base + (G.modifiers.sendToPower?.[player] ?? 0));
}

function zoneElementCount(G: GameState, player: PlayerIndex, zone: string, element: string): number {
  const cards = zone === 'powerCharger' ? G.players[player].powerCharger : G.players[player].abyss;
  return cards.filter((card) => getCardDef(card.defId)?.element === element).length;
}

function zoneSongCount(G: GameState, player: PlayerIndex, zone: string, song: string): number {
  const cards = zone === 'powerCharger' ? G.players[player].powerCharger : G.players[player].abyss;
  return cards.filter((card) => getCardDef(card.defId)?.song === song).length;
}

function isNight(G: GameState): boolean {
  return getChronosTimeForPosition(G.chronos.position, G.midnightRange) === 'night';
}

function chronosTimeAt(position: number, midnightRange: number): 'night' | 'day' {
  return getChronosTimeForPosition(position, midnightRange);
}

function isMidnightPosition(position: number, midnightRange: number): boolean {
  const normalized = normalizeChronosPosition(position);
  const distance = Math.min(normalized, CHRONOS_MAPPING.positions - normalized);
  return distance <= midnightRange;
}

function isNamedCharacter(card: CardInstance | null, song: string): boolean {
  if (!card) return false;
  const def = getCardDef(card.defId);
  return def?.type === 'Character' && def.song === song;
}

function effectiveElement(card: CardInstance | null, G: GameState, player: PlayerIndex): Element | null {
  if (!card) return null;
  return G.modifiers.elementOverride?.[player] ?? getCardDef(card.defId)?.element ?? null;
}

function effectivePowerCost(card: CardInstance | null, G: GameState, player: PlayerIndex): number | null {
  if (!card) return null;
  const def = getCardDef(card.defId);
  if (!def) return null;
  const reduction = def.type === 'Character' ? (G.modifiers.powerCostReduction?.[player] ?? 0) : 0;
  return Math.max(0, def.powerCost - reduction);
}

function effectiveAttack(card: CardInstance | null, G: GameState, player: PlayerIndex): number | null {
  const def = card ? getCardDef(card.defId) : null;
  if (!card || !def?.attack) return null;
  const cost = effectivePowerCost(card, G, player);
  if (cost === null || power(G, player) < cost) return 0;
  const time = isNight(G) ? 'night' : 'day';
  const effectiveTime = G.modifiers.attackTimeOverride?.[player] ?? time;
  const attackTime = G.modifiers.swapAttack[player] ? (effectiveTime === 'night' ? 'day' : 'night') : effectiveTime;
  const baseAttack = G.modifiers.attackSetTo?.[player] ?? def.attack[attackTime];
  return Math.max(0, baseAttack + G.modifiers.attack[player]);
}

// 計算不含 G.modifiers.attack 的基準攻撃力（用於逐效果鉗制時反推修飾器）。
function computeBaseAttack(card: CardInstance | null, G: GameState, player: PlayerIndex): number {
  if (!card) return 0;
  const def = getCardDef(card.defId);
  if (!def?.attack) return 0;
  const time = isNight(G) ? 'night' : 'day';
  const effectiveTime = G.modifiers.attackTimeOverride?.[player] ?? time;
  const attackTime = G.modifiers.swapAttack[player] ? (effectiveTime === 'night' ? 'day' : 'night') : effectiveTime;
  return G.modifiers.attackSetTo?.[player] ?? def.attack[attackTime];
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

function evaluateCondition(
  cond: Condition,
  G: GameState,
  player: PlayerIndex,
  context: EffectExecutionContext = {},
): boolean {
  const me = G.players[player];
  const opponent = G.players[(1 - player) as PlayerIndex];
  switch (cond.type) {
    case 'chronos':
      return (isNight(G) ? 'night' : 'day') === cond.value;
    case 'chronosPosition':
      if (cond.value === 'midnight') return isMidnightPosition(G.chronos.position, G.midnightRange);
      if (cond.value === 'noon') return normalizeChronosPosition(G.chronos.position) === CHRONOS_MAPPING.noon;
      return normalizeChronosPosition(G.chronos.position) === Number(cond.value);
    case 'opponentElement':
      return effectiveElement(opponent.battleZone, G, (1 - player) as PlayerIndex) === cond.value;
    case 'selfElement':
      return effectiveElement(me.battleZone, G, player) === cond.value;
    case 'powerAtLeast':
      return power(G, player) >= Number(cond.value);
    case 'abyssElements': {
      const cards = cond.target === 'powerCharger' ? me.powerCharger : me.abyss;
      return new Set(cards.map((card) => getCardDef(card.defId)?.element).filter(Boolean)).size >= Number(cond.value);
    }
    case 'specificElements': {
      if (!Array.isArray(cond.value)) return false;
      const required = new Set(cond.value.map(String));
      const actual = new Set(
        conditionZoneCards(G, player, cond)
          .map((card) => getCardDef(card.defId)?.element)
          .filter((element): element is Element => !!element),
      );
      return [...required].every((element) => actual.has(element as Element));
    }
    case 'abyssElementCount': {
      const owner = conditionPlayer(cond, player);
      const element = cond.element ?? String(cond.value);
      const count = G.players[owner].abyss.filter((card) => getCardDef(card.defId)?.element === element).length;
      return compareNumber(count, cond);
    }
    case 'powerChargerElementCount': {
      const owner = conditionPlayer(cond, player);
      const element = cond.element ?? String(cond.value);
      const count = G.players[owner].powerCharger.filter((card) => getCardDef(card.defId)?.element === element).length;
      return compareNumber(count, cond);
    }
    case 'abyssAllSameElement': {
      const owner = conditionPlayer(cond, player);
      const cards = G.players[owner].abyss;
      return cards.length > 0 && cards.every((card) => getCardDef(card.defId)?.element === cond.value);
    }
    case 'powerChargerAllSameElement': {
      const owner = conditionPlayer(cond, player);
      const cards = G.players[owner].powerCharger;
      return cards.length > 0 && cards.every((card) => getCardDef(card.defId)?.element === cond.value);
    }
    case 'zoneHasElement': {
      const cards = cond.target === 'powerCharger' ? me.powerCharger : me.abyss;
      return cards.some((card) => getCardDef(card.defId)?.element === cond.value);
    }
    case 'zoneEnteredCardType': {
      const targetPlayer = cond.target === 'opponent' ? ((1 - player) as PlayerIndex) : player;
      return G.timingEvents.some(
        (event) =>
          event.type === 'zoneEntered' &&
          event.player === targetPlayer &&
          event.zone === 'powerCharger' &&
          getCardDef(event.cardDefId ?? '')?.type === cond.value,
      );
    }
    case 'abyssCount':
      return me.abyss.length >= Number(cond.value);
    case 'handCount':
      return me.hand.length >= Number(cond.value);
    case 'handElements':
      return new Set(me.hand.map((card) => getCardDef(card.defId)?.element).filter(Boolean)).size >= Number(cond.value);
    case 'hpLessOrEqual':
      return (cond.target === 'opponent' ? opponent : me).hp <= Number(cond.value);
    case 'hpComparison':
      return compareNumber((cond.target === 'opponent' ? opponent : me).hp, cond);
    case 'hpLessThanOpponent':
      return me.hp < opponent.hp;
    case 'opponentPowerCost': {
      const powerCost = effectivePowerCost(opponent.battleZone, G, (1 - player) as PlayerIndex);
      return powerCost !== null && compareNumber(powerCost, cond);
    }
    case 'selfPowerCost': {
      if (cond.value === 'sameAsOpponent') {
        if (!me.battleZone || !opponent.battleZone) return false;
        return (
          effectivePowerCost(me.battleZone, G, player) ===
          effectivePowerCost(opponent.battleZone, G, (1 - player) as PlayerIndex)
        );
      }
      const powerCost = effectivePowerCost(me.battleZone, G, player);
      return powerCost !== null && compareNumber(powerCost, cond);
    }
    case 'opponentAttack': {
      // 官方 QA Q60：對手未セットキャラ時攻撃力視為 0（非條件不成立）。
      const attack = effectiveAttack(opponent.battleZone, G, (1 - player) as PlayerIndex) ?? 0;
      return compareNumber(attack, cond);
    }
    case 'opponentSendToPower': {
      if (!opponent.battleZone) return false;
      const sendToPower = getCardDef(opponent.battleZone.defId)?.sendToPower;
      return sendToPower !== undefined && compareNumber(sendToPower, cond);
    }
    case 'damageAtLeast': {
      const event = [...G.timingEvents]
        .reverse()
        .find((item) => item.type === 'damageReceived' && item.player === player);
      return Number(event?.amount ?? 0) >= Number(cond.value);
    }
    case 'zoneEntered': {
      const targetPlayer = cond.target === 'opponent' ? ((1 - player) as PlayerIndex) : player;
      return G.timingEvents.some(
        (event) =>
          event.type === 'zoneEntered' &&
          (cond.target === 'any' || event.player === targetPlayer) &&
          event.zone === cond.value,
      );
    }
    case 'zoneCountAtLeast': {
      const cards = cond.target === 'powerCharger' ? me.powerCharger : me.abyss;
      return cards.length >= Number(cond.value);
    }
    case 'zoneCountComparison':
      return compareNumber(conditionZoneCards(G, player, cond).length, cond);
    case 'chronosChanged':
      return G.chronos.position !== G.chronosAtTurnStart;
    case 'chronosTimeChanged': {
      if (cond.value === true)
        return (
          chronosTimeAt(G.chronosAtTurnStart, G.midnightRange) !== chronosTimeAt(G.chronos.position, G.midnightRange)
        );
      // 官方 QA Q18/Q21：檢查回合內所有 chronosChanged 事件，包含跨時間的中間轉換。
      const events = G.timingEvents.filter((e) => e.type === 'chronosChanged');
      if (cond.value === 'dayToNight')
        return events.some((e) => e.fromChronosTime === 'day' && e.toChronosTime === 'night');
      if (cond.value === 'nightToDay')
        return events.some((e) => e.fromChronosTime === 'night' && e.toChronosTime === 'day');
      return events.some((e) => e.fromChronosTime !== e.toChronosTime);
    }
    case 'namedCardCondition': {
      const song = String(cond.value);
      if (cond.target === 'battleZone') return isNamedCharacter(me.battleZone, song);
      if (cond.target === 'battleZoneNot') return !!me.battleZone && !isNamedCharacter(me.battleZone, song);
      if (cond.target === 'playedThisTurn')
        return G.setCardsThisTurn[player].some((card) => isNamedCharacter(card, song));
      if (cond.target === 'swappedThisTurn')
        return G.swappedCardsThisTurn[player].some((card) => isNamedCharacter(card, song));
      return (
        isNamedCharacter(me.battleZone, song) || G.setCardsThisTurn[player].some((card) => isNamedCharacter(card, song))
      );
    }
    case 'namedCardInBattleZone':
      return isNamedCharacter(G.players[conditionPlayer(cond, player)].battleZone, String(cond.value));
    case 'noCardInAbyss':
      return G.players[conditionPlayer(cond, player)].abyss.length === 0;
    case 'simultaneousCharacter':
      return G.setCardsThisTurn[player].some((card) => getCardDef(card.defId)?.type === 'Character');
    case 'hasAreaEnchant': {
      const owner = cond.target === 'opponent' ? opponent : me;
      if (cond.value === true) return !!owner.setZoneC;
      return !!owner.setZoneC && owner.setZoneC.defId === cond.value;
    }
    case 'battleLost':
      return G.lastBattleResult.winner !== null && G.lastBattleResult.winner !== player;
    case 'previousCharElement':
      return G.previousTurnCharacterElements?.[player] === cond.value;
    case 'drawOccurredThisEffect':
      if (context.cardInstanceId) return (G.drawEffectCardIdsThisTurn ?? []).includes(context.cardInstanceId);
      return Boolean(G.drawOccurredThisEffect?.[player]);
    case 'and':
      return (cond.value as Condition[]).every((item) => evaluateCondition(item, G, player, context));
    case 'or':
      return (cond.value as Condition[]).some((item) => evaluateCondition(item, G, player, context));
  }
}

function loseOnEffectOverdraw(G: GameState, player: PlayerIndex, count: number): boolean {
  if (G.players[player].deck.length >= count) return false;
  G.step = 'gameOver';
  G.winner = (1 - player) as PlayerIndex;
  G.gameoverReason = `Player ${player} loses: effect attempted to draw ${count} with only ${G.players[player].deck.length} cards.`;
  G.ready = [true, true];
  G.pendingEffects = [[], []];
  G.pendingEffectPlayer = null;
  G.pendingChoice = null;
  G.log.push(G.gameoverReason);
  return true;
}

function loseByHp(G: GameState, player: PlayerIndex, reason: string): void {
  G.step = 'gameOver';
  G.winner = (1 - player) as PlayerIndex;
  G.gameoverReason = reason;
  G.ready = [true, true];
  G.pendingEffects = [[], []];
  G.pendingEffectPlayer = null;
  G.pendingChoice = null;
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
  return (
    getCardDef(card.defId)?.type === 'Area Enchant' &&
    [
      'boostAttack',
      'boostBothAttackByOwnHp',
      'boostPower',
      'forceOwnAttackTime',
      'moveSelfAreaEnchant',
      'setPowerCost',
      'setAllCardClocks',
      // 官方 QA Q65：捜索中！每回合可重新選擇 powerCharger 的角色卡，useFromAbyss 需列入持久化白名單。
      'useFromAbyss',
    ].includes(effect.action.type)
  );
}

export function buildReorderOpponentDeckTopChoice(
  G: GameState,
  player: PlayerIndex,
  count: number,
  prompt?: string,
): { success: boolean; message: string; choice?: PendingChoice } {
  if (!Number.isInteger(count) || count < 1) {
    return { success: false, message: 'Unsupported opponent deck reorder count' };
  }

  const targetPlayer = (1 - player) as PlayerIndex;
  const topCards = G.players[targetPlayer].deck.slice(0, count);
  if (topCards.length === 0) {
    return { success: true, message: 'No opposing deck cards to reorder' };
  }

  const payload: PendingReorderDeckTopPayload = {
    targetPlayer,
    count: topCards.length,
  };
  return {
    success: true,
    message: 'Pending opponent deck top reorder',
    choice: {
      id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
      player,
      type: 'reorderOpponentDeckTop',
      min: topCards.length,
      max: topCards.length,
      prompt,
      payload,
      options: topCards.map((card) => ({
        id: card.instanceId,
        label: getCardDef(card.defId)?.name ?? card.defId,
        cardInstanceId: card.instanceId,
        cardDefId: card.defId,
      })),
    },
  };
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
  const playerOrder = getTurnEffectPlayerOrder(G);
  for (const player of playerOrder) {
    if (G.step === 'gameOver') continue;
    const playedIds = new Set(playedCards[player].map((card) => card.instanceId));
    const candidates = [...playedCards[player], G.players[player].battleZone, G.players[player].setZoneC]
      .filter((card): card is CardInstance => card !== null)
      .filter((card) => !(G.suppressedEffectCardIdsThisTurn ?? []).includes(card.instanceId))
      .filter((card, index, all) => all.findIndex((other) => other.instanceId === card.instanceId) === index);
    for (const card of candidates) {
      if (areEffectsDisabledForCard(G, player, card.defId)) {
        // 效果被禁用（如 enchantEffectsDisabled），記錄到 actionLog 讓玩家知道為何附魔未生效。
        recordAction(G, player, 'effectFailed', { cardDefId: card.defId, reason: 'disabled' });
        continue;
      }
      const definition = getCardDef(card.defId);
      const effects = parsedEffects.get(card.defId) ?? [];
      for (const [effectIndex, effect] of effects.entries()) {
        const isNew = playedIds.has(card.instanceId);
        if (!['onUse', 'onEnter'].includes(effect.trigger)) continue;
        const isPersistedSetZoneC = G.players[player].setZoneC?.instanceId === card.instanceId;
        const canRunPersisted = isPersistedSetZoneC && isPersistentAreaEnchantEffect(card, effect);
        if ((effect.trigger === 'onUse' || effect.trigger === 'onEnter') && !isNew && !canRunPersisted) continue;
        if (!definition || power(G, player) < definition.powerCost) {
          G.log.push(`Player ${player}: ${definition?.name ?? card.defId} effect skipped (power cost).`);
          // 能量不足導致效果未發動，記錄到 actionLog 供玩家回溯復盤。
          recordAction(G, player, 'effectFailed', { cardDefId: card.defId, reason: 'powerCost' });
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
  for (const player of playerOrder) {
    pending[player].sort((a, b) => {
      const aPriority = a.effect.priority === 'late' ? 1 : 0;
      const bPriority = b.effect.priority === 'late' ? 1 : 0;
      if (aPriority !== bPriority) return aPriority - bPriority;
      // 官方 QA Q22：moveSelfAreaEnchant 排在持續效果之前，確保移動後 suppress 生效。
      // 例如晩餐会（2nd_92）對手★4以上入れ替え後，攻撃力+20 效果應不可用。
      const aIsMove = a.effect.action.type === 'moveSelfAreaEnchant' ? 0 : 1;
      const bIsMove = b.effect.action.type === 'moveSelfAreaEnchant' ? 0 : 1;
      return aIsMove - bIsMove;
    });
  }
  return pending;
}

// ===== Effect handler registry =====
//
// executeEffect 透過 effectHandlers 分派到對應的 handler 函式。
// 每個 handler 負責單一 ActionType 的邏輯，保持原本 switch case 的行為。
// requestChoice handler 內部再透過 choiceHandlers 分派到 choiceType handler。

interface EffectHandlerArgs {
  effect: ParsedEffect;
  G: GameState;
  player: PlayerIndex;
  context: EffectExecutionContext;
  me: PlayerState;
  opponent: PlayerState;
  opponentIndex: PlayerIndex;
  valueParam: EffectValue;
  value: number;
}

type EffectHandler = (args: EffectHandlerArgs) => { success: boolean; message: string };

function handleBoostAttack({ effect, G, player, me, value }: EffectHandlerArgs): { success: boolean; message: string } {
  // 官方 QA Q40/Q74：角色 power cost 不足時攻撃力修飾效果不発動，
  // 不設定修飾器避免殘留導致 power 補足後攻撃力錯誤。
  // battleZone 為 null 時不跳過（無角色可修飾，修飾器不會造成殘留問題）。
  if (me.battleZone && power(G, player) < (effectivePowerCost(me.battleZone, G, player) ?? 0)) {
    return { success: true, message: 'Attack boost skipped (battleZone power cost not met)' };
  }
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
  // 官方 QA Q54：逐效果套用並鉗制至 0，避免負修正溢出被吸收後不正確地降低後續正修正效果。
  const currentAttack = effectiveAttack(me.battleZone, G, player) ?? 0;
  const newAttack = Math.max(0, currentAttack + boost);
  const baseAttack = computeBaseAttack(me.battleZone, G, player);
  G.modifiers.attack[player] = newAttack - baseAttack;
  return { success: true, message: `Attack +${boost}` };
}

function handleBoostBothAttackByOwnHp({ G, player, me, opponent, opponentIndex }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  // 官方 QA Q40/Q74/Q54：逐效果套用並鉗制至 0，且角色 power cost 不足時不発動。
  // 雙方各自檢查 power cost，不足者跳過修飾，避免殘留修飾器。
  // battleZone 為 null 時仍設定修飾器（無角色可修飾，不會造成殘留問題）。
  const myPowerOk = !me.battleZone || power(G, player) >= (effectivePowerCost(me.battleZone, G, player) ?? 0);
  if (myPowerOk) {
    const myCurrent = effectiveAttack(me.battleZone, G, player) ?? 0;
    const myNew = Math.max(0, myCurrent + me.hp);
    const myBase = computeBaseAttack(me.battleZone, G, player);
    G.modifiers.attack[player] = myNew - myBase;
  }
  const oppPowerOk =
    !opponent.battleZone || power(G, opponentIndex) >= (effectivePowerCost(opponent.battleZone, G, opponentIndex) ?? 0);
  if (oppPowerOk) {
    const oppCurrent = effectiveAttack(opponent.battleZone, G, opponentIndex) ?? 0;
    const oppNew = Math.max(0, oppCurrent + opponent.hp);
    const oppBase = computeBaseAttack(opponent.battleZone, G, opponentIndex);
    G.modifiers.attack[opponentIndex] = oppNew - oppBase;
  }
  return { success: true, message: 'Both players gain attack equal to own HP' };
}

function handleBoostPower({ effect, G, player, value }: EffectHandlerArgs): { success: boolean; message: string } {
  let multiplier = 1;
  if (effect.action.params.per === 'zoneElementCount') {
    multiplier = zoneElementCount(
      G,
      player,
      String(effect.action.params.zone ?? 'abyss'),
      String(effect.action.params.element ?? ''),
    );
  }
  const boost = effect.action.params.per || effect.action.params.perCount ? value * multiplier : value;
  if (!G.modifiers.sendToPower) G.modifiers.sendToPower = [0, 0];
  G.modifiers.sendToPower[player] += boost;
  return { success: true, message: `Power +${boost}` };
}

function handleReduceAttack({ G, opponent, opponentIndex, value }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  // 官方 QA Q40/Q74：對手角色 power cost 不足時攻撃力修飾效果不発動，
  // 不設定修飾器避免殘留導致 power 補足後攻撃力錯誤。
  // battleZone 為 null 時不跳過（無角色可修飾，修飾器不會造成殘留問題）。
  if (
    opponent.battleZone &&
    power(G, opponentIndex) < (effectivePowerCost(opponent.battleZone, G, opponentIndex) ?? 0)
  ) {
    return { success: true, message: 'Attack reduce skipped (opponent battleZone power cost not met)' };
  }
  // 官方 QA Q54：逐效果套用並鉗制至 0。
  const currentAttack = effectiveAttack(opponent.battleZone, G, opponentIndex) ?? 0;
  const newAttack = Math.max(0, currentAttack - value);
  const baseAttack = computeBaseAttack(opponent.battleZone, G, opponentIndex);
  G.modifiers.attack[opponentIndex] = newAttack - baseAttack;
  return { success: true, message: `Opponent attack -${value}` };
}

function handleSetOpponentAttack({ G, opponentIndex, value }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  // 官方 QA Q82：ジョブチェンジ設定對手攻撃力時，需重置累積 attack 修飾器，
  // 否則先前 boost/reduce 的累積值會疊加到新基準上。
  if (!G.modifiers.attackSetTo) G.modifiers.attackSetTo = [null, null];
  G.modifiers.attackSetTo[opponentIndex] = value;
  G.modifiers.attack[opponentIndex] = 0;
  return { success: true, message: `Opponent attack set to ${value}` };
}

function handleSetOpponentElement({ effect, G, opponentIndex }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const element = effect.action.params.value;
  if (!['闇', '炎', '電気', '風', 'カオス'].includes(String(element))) {
    return { success: false, message: 'Unsupported element override' };
  }
  if (!G.modifiers.elementOverride) G.modifiers.elementOverride = [null, null];
  G.modifiers.elementOverride[opponentIndex] = element as Element;
  return { success: true, message: `Opponent element set to ${element}` };
}

/** 組裝效果類（heal / directDamage）HP 變化的計算明細。 */
function buildEffectHpChangeBreakdown(
  titleKey: string,
  lines: HpChangeBreakdownLine[],
  sourceCardDefId?: string,
): HpChangeBreakdown {
  return {
    title: titleKey,
    lines,
    participantCardDefIds: sourceCardDefId ? [sourceCardDefId] : [],
  };
}

function handleHeal({ effect, G, player, context, me, opponent, opponentIndex, value }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const sourceCardDefId = context.cardDefId;
  if (effect.action.params.target === 'opponent') {
    const before = opponent.hp;
    opponent.hp = Math.min(100, before + value);
    const delta = opponent.hp - before;
    const breakdown = buildEffectHpChangeBreakdown(
      'board.hpChange.healCalc',
      [
        { label: 'board.hpChange.source', value: sourceCardDefId ?? '—', ...(sourceCardDefId ? { cardDefId: sourceCardDefId } : {}) },
        { label: 'board.hpChange.healAmount', value: `+${value}` },
        ...(delta < value ? [{ label: 'board.hpChange.cappedAt100', value: `${delta}` }] : []),
      ],
      sourceCardDefId,
    );
    pushHpChange(G, opponentIndex, delta, 'heal', sourceCardDefId, breakdown);
    return { success: true, message: `Heal opponent ${value}` };
  }
  const before = me.hp;
  me.hp = Math.min(100, before + value);
  const delta = me.hp - before;
  const breakdown = buildEffectHpChangeBreakdown(
    'board.hpChange.healCalc',
    [
      { label: 'board.hpChange.source', value: sourceCardDefId ?? '—', ...(sourceCardDefId ? { cardDefId: sourceCardDefId } : {}) },
      { label: 'board.hpChange.healAmount', value: `+${value}` },
      ...(delta < value ? [{ label: 'board.hpChange.cappedAt100', value: `${delta}` }] : []),
    ],
    sourceCardDefId,
  );
  pushHpChange(G, player, delta, 'heal', sourceCardDefId, breakdown);
  return { success: true, message: `Heal ${value}` };
}

function handleHealOpponent({ G, context, opponent, opponentIndex, value }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const sourceCardDefId = context.cardDefId;
  const before = opponent.hp;
  opponent.hp = Math.min(100, before + value);
  const delta = opponent.hp - before;
  const breakdown = buildEffectHpChangeBreakdown(
    'board.hpChange.healCalc',
    [
      { label: 'board.hpChange.source', value: sourceCardDefId ?? '—', ...(sourceCardDefId ? { cardDefId: sourceCardDefId } : {}) },
      { label: 'board.hpChange.healAmount', value: `+${value}` },
      ...(delta < value ? [{ label: 'board.hpChange.cappedAt100', value: `${delta}` }] : []),
    ],
    sourceCardDefId,
  );
  pushHpChange(G, opponentIndex, delta, 'healOpponent', sourceCardDefId, breakdown);
  return { success: true, message: `Heal opponent ${value}` };
}

function handleHealBoth({ G, player, context, me, opponent, opponentIndex, value }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const sourceCardDefId = context.cardDefId;
  const beforeMe = me.hp;
  me.hp = Math.min(100, beforeMe + value);
  const deltaMe = me.hp - beforeMe;
  pushHpChange(
    G,
    player,
    deltaMe,
    'healBoth',
    sourceCardDefId,
    buildEffectHpChangeBreakdown(
      'board.hpChange.healBothCalc',
      [
        { label: 'board.hpChange.source', value: sourceCardDefId ?? '—', ...(sourceCardDefId ? { cardDefId: sourceCardDefId } : {}) },
        { label: 'board.hpChange.healAmount', value: `+${value}` },
        ...(deltaMe < value ? [{ label: 'board.hpChange.cappedAt100', value: `${deltaMe}` }] : []),
      ],
      sourceCardDefId,
    ),
  );
  const beforeOpp = opponent.hp;
  opponent.hp = Math.min(100, beforeOpp + value);
  const deltaOpp = opponent.hp - beforeOpp;
  pushHpChange(
    G,
    opponentIndex,
    deltaOpp,
    'healBoth',
    sourceCardDefId,
    buildEffectHpChangeBreakdown(
      'board.hpChange.healBothCalc',
      [
        { label: 'board.hpChange.source', value: sourceCardDefId ?? '—', ...(sourceCardDefId ? { cardDefId: sourceCardDefId } : {}) },
        { label: 'board.hpChange.healAmount', value: `+${value}` },
        ...(deltaOpp < value ? [{ label: 'board.hpChange.cappedAt100', value: `${deltaOpp}` }] : []),
      ],
      sourceCardDefId,
    ),
  );
  return { success: true, message: `Heal both ${value}` };
}

function handleDirectDamage({
  effect,
  G,
  player,
  context,
  opponent,
  opponentIndex,
  valueParam,
  value,
}: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const sourceCardDefId = context.cardDefId;
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
  const usesReducedThisTurn = valueParam === 'reducedThisTurn';
  const damage = usesReducedThisTurn ? (G.damageReducedThisTurn?.[player] ?? 0) : value;
  if (damage === -1) {
    G.modifiers.unreduceableDamage[player] = true;
    return { success: true, message: 'Battle damage cannot be reduced' };
  }
  const before = opponent.hp;
  opponent.hp = Math.max(0, before - damage);
  const delta = opponent.hp - before;
  const breakdownLines: HpChangeBreakdownLine[] = [
    { label: 'board.hpChange.source', value: sourceCardDefId ?? '—', ...(sourceCardDefId ? { cardDefId: sourceCardDefId } : {}) },
  ];
  if (usesReducedThisTurn) {
    breakdownLines.push({ label: 'board.hpChange.reducedThisTurnBase', value: `${damage}` });
  } else {
    breakdownLines.push({ label: 'board.hpChange.damageAmount', value: `${damage}` });
  }
  breakdownLines.push({ label: 'board.hpChange.finalDamage', value: `${-delta}` });
  pushHpChange(
    G,
    opponentIndex,
    delta,
    'directDamage',
    sourceCardDefId,
    buildEffectHpChangeBreakdown('board.hpChange.directDamageCalc', breakdownLines, sourceCardDefId),
  );
  if (opponent.hp <= 0) loseByHp(G, opponentIndex, `Player ${opponentIndex} loses at 0 HP.`);
  return { success: true, message: `Deal ${damage}` };
}

function handleDamageReduce({ G, player, value }: EffectHandlerArgs): { success: boolean; message: string } {
  G.modifiers.damageReduction[player] += value;
  return { success: true, message: `Damage reduction +${value}` };
}

function handleDrawCards({ G, player, me, value, context }: EffectHandlerArgs): { success: boolean; message: string } {
  if (loseOnEffectOverdraw(G, player, value)) return { success: false, message: 'Not enough cards to draw' };
  for (let i = 0; i < value; i++) {
    const card = me.deck.shift()!;
    card.faceUp = true;
    me.hand.push(card);
  }
  if (!G.drawOccurredThisEffect) G.drawOccurredThisEffect = [false, false];
  G.drawOccurredThisEffect[player] = true;
  if (context.cardInstanceId) {
    if (!G.drawEffectCardIdsThisTurn) G.drawEffectCardIdsThisTurn = [];
    if (!G.drawEffectCardIdsThisTurn.includes(context.cardInstanceId)) {
      G.drawEffectCardIdsThisTurn.push(context.cardInstanceId);
    }
  }
  return { success: true, message: `Draw ${value}` };
}

function handleSwapAttack({ effect, G, player, opponentIndex }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const targetPlayer = effect.action.params.target === 'self' ? player : opponentIndex;
  G.modifiers.swapAttack[targetPlayer] = !G.modifiers.swapAttack[targetPlayer];
  return { success: true, message: `Swap ${targetPlayer === player ? 'own' : 'opponent'} day/night attack` };
}

function handleForceOwnAttackTime({ effect, G, player }: EffectHandlerArgs): { success: boolean; message: string } {
  const time = effect.action.params.value;
  if (time !== 'day' && time !== 'night') return { success: false, message: 'Unsupported attack time override' };
  if (!G.modifiers.attackTimeOverride) G.modifiers.attackTimeOverride = [null, null];
  G.modifiers.attackTimeOverride[player] = time;
  return { success: true, message: `Own attack uses ${time}` };
}

function handleClockReset({ G }: EffectHandlerArgs): { success: boolean; message: string } {
  G.chronos.position = G.chronosAtTurnStart;
  return { success: true, message: 'Reset Chronos' };
}

function handleNullifyOpponentClock({ G, player, opponentIndex, context }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  if (!G.modifiers.clockContributionDisabled) G.modifiers.clockContributionDisabled = [false, false];
  const wasDisabled = G.modifiers.clockContributionDisabled[opponentIndex];
  G.modifiers.clockContributionDisabled[opponentIndex] = true;
  // 官方 QA Q63：當回合新設定的 AE 不 rewind，次回合才発動。
  // flag 仍設定（讓 applyPreChronosModifiers 次回合預處理），但 chronos 不倒帶。
  const isNewThisTurn =
    Boolean(context.cardInstanceId) &&
    (G.setCardsThisTurn?.[player] ?? []).some((c) => c.instanceId === context.cardInstanceId);
  const rewind =
    wasDisabled || isNewThisTurn
      ? 0
      : (G.setCardsThisTurn?.[opponentIndex] ?? [])
          .filter((card) => getCardDef(card.defId)?.type === 'Character')
          .reduce((sum, card) => sum + (G.modifiers.cardClockSetTo ?? getCardDef(card.defId)?.clock ?? 0), 0);
  if (rewind > 0) G.chronos.position = normalizeChronosPosition(G.chronos.position - rewind);
  return { success: true, message: `Disable opponent Character clock${rewind > 0 ? ` and rewind ${rewind}` : ''}` };
}

function handleClockRewindOpponentCharacter({ G, opponentIndex }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const rewind = (G.setCardsThisTurn?.[opponentIndex] ?? [])
    .filter((card) => getCardDef(card.defId)?.type === 'Character')
    .reduce((sum, card) => sum + (getCardDef(card.defId)?.clock ?? 0), 0);
  G.chronos.position = normalizeChronosPosition(G.chronos.position - rewind);
  return { success: true, message: `Rewind opponent Character clock ${rewind}` };
}

function handleClockSetFromTurnStartMinusOpponentClock({ G, opponent }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const clock = opponent.battleZone ? getCardDef(opponent.battleZone.defId)?.clock : undefined;
  if (!Number.isInteger(clock)) return { success: false, message: 'No opposing character clock' };
  G.chronos.position = normalizeChronosPosition(G.chronosAtTurnStart - Number(clock));
  return { success: true, message: `Chronos set to turn start -${clock}` };
}

function handleSetAllCardClocks({ G, value }: EffectHandlerArgs): { success: boolean; message: string } {
  G.modifiers.cardClockSetTo = value;
  return { success: true, message: `All card clocks set to ${value}` };
}

function handleExpandMidnightRange({ effect, G }: EffectHandlerArgs): { success: boolean; message: string } {
  G.midnightRange = Math.max(G.midnightRange, Number(effect.action.params.range ?? 0));
  return { success: true, message: `Midnight range +${G.midnightRange}` };
}

function handleClockSet({ effect, G, player }: EffectHandlerArgs): { success: boolean; message: string } {
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
}

function handleClockAdvance({ G, value }: EffectHandlerArgs): { success: boolean; message: string } {
  G.chronos.position = normalizeChronosPosition(G.chronos.position + value);
  return { success: true, message: `Chronos +${value}` };
}

function handleRecoverFromAbyss({ effect, me }: EffectHandlerArgs): { success: boolean; message: string } {
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

function handleSendToAbyss({ G, opponent, opponentIndex, context }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const card = opponent.battleZone;
  if (!card) return { success: false, message: 'No opposing character' };
  opponent.battleZone = null;
  opponent.abyss.push(card);
  emitZoneEntered(G, context, opponentIndex, 'abyss', card);
  return { success: true, message: 'Send opposing character to Abyss' };
}

function handleMillDeckToAbyss({ effect, G, player, opponent, opponentIndex, context }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
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
    emitZoneEntered(G, context, opponentIndex, 'abyss', card);
    moved++;
  }
  if (effect.action.params.countFromLastChoice) G.lastChoiceSelectionCount[player] = null;
  return { success: true, message: `Mill ${moved} opposing card${moved === 1 ? '' : 's'} to Abyss` };
}

function handleMoveOwnDeckTopByPower({ G, player, me, context }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  if (me.deck.length === 0) {
    loseOnEffectOverdraw(G, player, 1);
    return { success: false, message: 'No deck top card to move' };
  }
  const card = me.deck.shift()!;
  const sendToPower = getCardDef(card.defId)?.sendToPower ?? 0;
  card.faceUp = true;
  if (sendToPower > 0) {
    me.powerCharger.push(card);
    emitZoneEntered(G, context, player, 'powerCharger', card);
    return { success: true, message: 'Move deck top to Power Charger' };
  }
  me.abyss.push(card);
  emitZoneEntered(G, context, player, 'abyss', card);
  return { success: true, message: 'Move deck top to Abyss' };
}

function handleMoveOpponentDeckTopByPowerCost({ effect, G, player, me, opponent, context }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  // 官方 QA Q35/Q45：公開對手牌庫頂卡後，該卡需放回對手牌庫頂（不消耗）。
  // 若該卡 powerCost >= minPowerCost，將「此 Area Enchant 自身」移到擁有者的
  // powerCharger（非アビス），被公開的卡仍留在對手牌庫頂。
  const minPowerCost = Number(effect.action.params.minPowerCost ?? 0);
  if (opponent.deck.length === 0) return { success: false, message: 'No opposing deck top card to reveal' };
  const card = opponent.deck[0];
  card.faceUp = true;
  const powerCost = getCardDef(card.defId)?.powerCost ?? 0;
  if (powerCost >= minPowerCost) {
    const areaEnchant = me.setZoneC;
    if (!areaEnchant) return { success: false, message: 'No own Area Enchant to move' };
    me.setZoneC = null;
    areaEnchant.faceUp = true;
    me.powerCharger.push(areaEnchant);
    emitZoneEntered(G, context, player, 'powerCharger', areaEnchant);
    return { success: true, message: 'Move own Area Enchant to Power Charger' };
  }
  return { success: true, message: 'Reveal opposing deck top' };
}

function handleRevealOpponentDeckTopBySendToPower({ effect, G, player, me, opponent, context }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  if (opponent.deck.length === 0) return { success: false, message: 'No opposing deck top card to reveal' };
  const card = opponent.deck[0];
  card.faceUp = true;
  const sendToPower = getCardDef(card.defId)?.sendToPower ?? 0;
  const minSendToPower = Number(effect.action.params.minSendToPower ?? 1);
  if (sendToPower >= minSendToPower) {
    const areaEnchant = me.setZoneC;
    if (!areaEnchant) return { success: false, message: 'No own Area Enchant to move' };
    me.setZoneC = null;
    areaEnchant.faceUp = true;
    me.powerCharger.push(areaEnchant);
    emitZoneEntered(G, context, player, 'powerCharger', areaEnchant);
    return { success: true, message: 'Move own Area Enchant to Power Charger' };
  }
  const boost = Number(effect.action.params.boostIfMissing ?? 0);
  G.modifiers.attack[player] += boost;
  return { success: true, message: `Attack +${boost}` };
}

function handleRevealOpponentHand({ G, opponent, opponentIndex }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  if (!G.revealedHandCardIds) G.revealedHandCardIds = [[], []];
  const revealed = new Set(G.revealedHandCardIds[opponentIndex]);
  for (const card of opponent.hand) revealed.add(card.instanceId);
  G.revealedHandCardIds[opponentIndex] = [...revealed];
  return { success: true, message: 'Reveal opposing hand' };
}

function handleReturnAreaEnchantToDeck({ effect, G, opponent, opponentIndex }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const card = opponent.setZoneC;
  if (!card) return { success: false, message: 'No opposing Area Enchant' };
  opponent.setZoneC = null;
  card.faceUp = true;
  if (effect.action.params.position === 'top') opponent.deck.unshift(card);
  else opponent.deck.push(card);
  if (effect.action.params.lockAreaEnchant) {
    if (!G.areaEnchantSetLocked) G.areaEnchantSetLocked = [false, false];
    G.areaEnchantSetLocked[opponentIndex] = true;
  }
  return { success: true, message: 'Return opposing Area Enchant to deck' };
}

function handleMoveSelfAreaEnchant({ effect, G, player, me, context }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const card = me.setZoneC;
  if (!card) return { success: false, message: 'No own Area Enchant' };
  me.setZoneC = null;
  card.faceUp = true;
  if (effect.action.params.destination === 'powerCharger') {
    me.powerCharger.push(card);
    emitZoneEntered(G, context, player, 'powerCharger', card);
  } else {
    me.abyss.push(card);
    emitZoneEntered(G, context, player, 'abyss', card);
  }
  // 官方 QA Q22：Area Enchant 移動後，同卡同回合後續 pending effects 不再處理
  // （如晩餐会移動後攻撃力+20效果不可用）。
  if (context.cardInstanceId) {
    if (!G.suppressedEffectCardIdsThisTurn) G.suppressedEffectCardIdsThisTurn = [];
    if (!G.suppressedEffectCardIdsThisTurn.includes(context.cardInstanceId)) {
      G.suppressedEffectCardIdsThisTurn.push(context.cardInstanceId);
    }
    G.pendingEffects[0] = G.pendingEffects[0].filter((e) => e.cardInstanceId !== context.cardInstanceId);
    G.pendingEffects[1] = G.pendingEffects[1].filter((e) => e.cardInstanceId !== context.cardInstanceId);
  }
  return {
    success: true,
    message: `Move own Area Enchant to ${effect.action.params.destination === 'powerCharger' ? 'Power Charger' : 'Abyss'}`,
  };
}

function handleUseFromAbyss({ effect, G, player, me, context }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const sourceZone = effect.action.params.source === 'powerCharger' ? 'powerCharger' : 'abyss';
  const source = sourceZone === 'powerCharger' ? me.powerCharger : me.abyss;
  const max = Number(effect.action.params.count ?? effect.action.params.max ?? 1);
  const options = source
    .filter((card) => {
      // 官方 QA Q83：不允許自我選擇（如舞踏会でラストダンスを從 PC 選擇時排除自身）。
      if (context.cardInstanceId && card.instanceId === context.cardInstanceId) return false;
      const def = getCardDef(card.defId);
      if (!def) return false;
      if (effect.action.params.cardType !== undefined && def.type !== effect.action.params.cardType) return false;
      if (effect.action.params.song !== undefined && def.song !== effect.action.params.song) return false;
      if (sourceZone === 'abyss' && effect.action.params.cardType === undefined && def.type !== 'Enchant') return false;
      return true;
    })
    .map((card) => ({
      id: card.instanceId,
      label: getCardDef(card.defId)?.name ?? card.defId,
      cardInstanceId: card.instanceId,
      cardDefId: card.defId,
    }));
  if (options.length === 0) return { success: false, message: 'No card effect to use' };
  const payload: PendingUseFromAbyssPayload = {
    sourcePlayer: player,
    sourceZone,
    cardType:
      typeof effect.action.params.cardType === 'string' ? (effect.action.params.cardType as CardType) : undefined,
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

function handleHandSizeModifier({ effect, G, player }: EffectHandlerArgs): { success: boolean; message: string } {
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

function handleSetPowerCost({ effect, G, player }: EffectHandlerArgs): { success: boolean; message: string } {
  const reduction = Number(effect.action.params.reduction ?? effect.action.params.value ?? 0);
  if (!G.modifiers.powerCostReduction) G.modifiers.powerCostReduction = [0, 0];
  G.modifiers.powerCostReduction[player] += reduction;
  return { success: true, message: `Character power cost -${reduction}` };
}

function handleNoEffect({ effect, G, opponentIndex }: EffectHandlerArgs): { success: boolean; message: string } {
  if (effect.action.params.scope === 'enchantOnly') {
    if (!G.modifiers.enchantEffectsDisabled) G.modifiers.enchantEffectsDisabled = [false, false];
    G.modifiers.enchantEffectsDisabled[opponentIndex] = true;
    return { success: true, message: 'Disable opponent Enchant effects this turn' };
  }
  G.modifiers.effectsDisabled[opponentIndex] = true;
  return { success: true, message: 'Disable opponent effects this turn' };
}

function handleSuppressEffectActivation(_args: EffectHandlerArgs): { success: boolean; message: string } {
  return { success: true, message: 'Swapped-in Character effect suppression clause' };
}

function handleAddSettableCard({ effect, G, player }: EffectHandlerArgs): { success: boolean; message: string } {
  const count = Number(effect.action.params.count ?? 1);
  if (!Number.isInteger(count) || count < 0) return { success: false, message: 'Unsupported settable-card count' };
  if (!G.modifiers.extraSettableCards) G.modifiers.extraSettableCards = [0, 0];
  G.modifiers.extraSettableCards[player] += count;
  return { success: true, message: `Settable card allowance +${count}` };
}

// ===== Choice handler registry (for requestChoice) =====
//
// case 'requestChoice' 透過 choiceHandlers 分派到對應的 choiceType handler。
// 保留原本 if-else 鏈的行為：未知 choiceType 回傳 'Unsupported choice type'。

type ChoiceHandler = (args: EffectHandlerArgs) => { success: boolean; message: string };

type ChoiceType =
  | 'revealHandAttackBoost'
  | 'nameGuessOpponentHandReveal'
  | 'optionalHandMoveThenDraw'
  | 'useFromHand'
  | 'cardMove'
  | 'abyssToDeckBottomOrLose'
  | 'reorderOpponentDeckTop'
  | 'opponentPowerCharacterSwap'
  | 'handAbyssSwap'
  | 'clockPosition'
  | 'clockAdvance'
  | 'handToDeckBottomThenDraw';

function handleRevealHandAttackBoostChoice({ effect, G, player, me }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
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
    .filter((card) => {
      const def = getCardDef(card.defId);
      if (!def) return false;
      if (filter.cardType !== undefined && def.type !== filter.cardType) return false;
      if (filter.song !== undefined && def.song !== filter.song) return false;
      if (filter.element !== undefined && def.element !== filter.element) return false;
      return true;
    })
    .map((card) => ({
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

function handleNameGuessOpponentHandRevealChoice({ effect, G, player, opponent, opponentIndex }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const attackBoost = Number(effect.action.params.attackBoost ?? 0);
  if (opponent.hand.length === 0) return { success: false, message: 'No opposing hand card to reveal' };
  const payload: PendingNameGuessOpponentHandRevealPayload = {
    opponentPlayer: opponentIndex,
    attackBoost,
  };
  const cardDefs = getAllCardDefs();
  const options = opponent.hand.flatMap((_card, handIndex) =>
    cardDefs.map((def) => ({
      id: `hand:${handIndex}:guess:${def.id}`,
      label: `${def.name} / Opponent hand ${handIndex + 1}`,
      value: def.id,
    })),
  );
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

function handleOptionalHandMoveThenDrawChoice({ effect, G, player }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const sourceOwner = String(effect.action.params.sourceOwner);
  const sourceZone = String(effect.action.params.sourceZone);
  const destinationOwner = String(effect.action.params.destinationOwner);
  const destinationZone = String(effect.action.params.destinationZone);
  const destinationPosition =
    effect.action.params.destinationPosition === undefined
      ? undefined
      : String(effect.action.params.destinationPosition);
  const drawCountParam = effect.action.params.drawCount ?? 0;
  const drawCount = drawCountParam === 'selected' ? 'selected' : Number(drawCountParam);
  if (
    sourceOwner !== 'self' ||
    sourceZone !== 'hand' ||
    destinationOwner !== 'self' ||
    !['abyss', 'powerCharger', 'deck'].includes(destinationZone) ||
    (destinationZone === 'deck' && destinationPosition !== 'bottom') ||
    (destinationZone !== 'deck' && destinationPosition !== undefined) ||
    (drawCount !== 'selected' && drawCount !== 1)
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
  const options = legalOptionalHandMoveThenDrawCards(G, payload).map((card) => ({
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

function handleUseFromHandChoice({ effect, G, player, me }: EffectHandlerArgs): { success: boolean; message: string } {
  const sourceOwner = String(effect.action.params.sourceOwner);
  const sourceZone = String(effect.action.params.sourceZone);
  const max = Number(effect.action.params.max ?? 1);
  const optional = Boolean(effect.action.params.optional);
  const followUpDrawCount = Number(effect.action.params.followUpDrawCount ?? 0);
  if (
    sourceOwner !== 'self' ||
    sourceZone !== 'hand' ||
    !Number.isInteger(max) ||
    max < 1 ||
    !Number.isInteger(followUpDrawCount) ||
    followUpDrawCount < 0
  ) {
    return { success: false, message: 'Unsupported hand-use choice' };
  }

  const filter: PendingCardFilter = {};
  if (effect.action.params.filterCardType !== undefined) {
    const cardType = String(effect.action.params.filterCardType);
    if (!['Character', 'Enchant', 'Area Enchant'].includes(cardType)) {
      return { success: false, message: 'Unsupported hand-use card type filter' };
    }
    filter.cardType = cardType as CardType;
  }
  if (effect.action.params.filterSong !== undefined) {
    const song = String(effect.action.params.filterSong).trim();
    if (song.length === 0) return { success: false, message: 'Unsupported hand-use song filter' };
    filter.song = song;
  }
  if (effect.action.params.filterElement !== undefined) {
    const element = String(effect.action.params.filterElement);
    if (!['闇', '炎', '電気', '風', 'カオス'].includes(element)) {
      return { success: false, message: 'Unsupported hand-use element filter' };
    }
    filter.element = element as Element;
  }

  const options = me.hand
    .filter((card) => {
      const def = getCardDef(card.defId);
      if (!def || power(G, player) < def.powerCost) return false;
      if (filter.cardType !== undefined && def.type !== filter.cardType) return false;
      if (filter.song !== undefined && def.song !== filter.song) return false;
      if (filter.element !== undefined && def.element !== filter.element) return false;
      return true;
    })
    .map((card) => ({
      id: card.instanceId,
      label: getCardDef(card.defId)?.name ?? card.defId,
      cardInstanceId: card.instanceId,
      cardDefId: card.defId,
    }));

  if (options.length === 0 && optional) {
    if (followUpDrawCount > 0) {
      if (loseOnEffectOverdraw(G, player, followUpDrawCount))
        return { success: false, message: 'Not enough cards to draw' };
      for (let i = 0; i < followUpDrawCount; i++) {
        const card = me.deck.shift()!;
        card.faceUp = true;
        me.hand.push(card);
      }
    }
    return {
      success: true,
      message: followUpDrawCount > 0 ? `Draw ${followUpDrawCount}` : 'No legal hand cards to use',
    };
  }
  if (options.length === 0) return { success: false, message: 'No legal hand cards to use' };

  const payload: PendingUseFromHandPayload = {
    sourcePlayer: player,
    filter,
    followUpDrawCount,
  };
  G.pendingChoice = {
    id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
    player,
    type: 'useFromHand',
    min: optional ? 0 : 1,
    max: Math.min(max, options.length),
    prompt: effect.rawText,
    payload,
    options,
  };
  return { success: true, message: 'Pending hand card use selection' };
}

function handleCardMoveChoice({ effect, G, player }: EffectHandlerArgs): { success: boolean; message: string } {
  const count = Number(effect.action.params.count ?? 1);
  const sourceOwner = String(effect.action.params.sourceOwner);
  const destinationOwner = String(effect.action.params.destinationOwner);
  const sourceZone = String(effect.action.params.sourceZone);
  const destinationZone = String(effect.action.params.destinationZone);
  const destinationPosition =
    effect.action.params.destinationPosition === undefined
      ? undefined
      : String(effect.action.params.destinationPosition);
  if (
    !['self', 'opponent'].includes(sourceOwner) ||
    !['self', 'opponent'].includes(destinationOwner) ||
    !Number.isInteger(count) ||
    count < 1 ||
    !['hand', 'abyss', 'powerCharger'].includes(sourceZone) ||
    !['abyss', 'deck'].includes(destinationZone) ||
    (destinationZone === 'deck' && destinationPosition !== 'bottom')
  ) {
    return { success: false, message: 'Unsupported card choice move' };
  }
  const payload: PendingCardMovePayload = {
    sourcePlayer: relativePlayer(player, sourceOwner as RelativeChoicePlayer),
    sourceZone: sourceZone as PendingChoiceCardZone,
    destinationPlayer: relativePlayer(player, destinationOwner as RelativeChoicePlayer),
    destinationZone: destinationZone as PendingChoiceDestinationZone,
    destinationPosition: destinationPosition as PendingChoiceDeckPosition | undefined,
    filterSendToPower:
      effect.action.params.filterSendToPower === undefined ? undefined : Number(effect.action.params.filterSendToPower),
  };
  const options = legalCardMoveCards(G, payload).map((card) => ({
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

function handleAbyssToDeckBottomOrLoseChoice({ effect, G, player, me }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
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
    followUpChoiceType:
      effect.action.params.followUpChoiceType === 'reorderOpponentDeckTop' ? 'reorderOpponentDeckTop' : undefined,
    followUpCount:
      effect.action.params.followUpCount === undefined ? undefined : Number(effect.action.params.followUpCount),
  };
  G.pendingChoice = {
    id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
    player,
    type: 'abyssToDeckBottomOrLose',
    min,
    max,
    prompt: effect.rawText,
    payload,
    options: me.abyss.map((card) => ({
      id: card.instanceId,
      label: getCardDef(card.defId)?.name ?? card.defId,
      cardInstanceId: card.instanceId,
      cardDefId: card.defId,
    })),
  };
  return { success: true, message: 'Pending Abyss payment selection' };
}

function handleReorderOpponentDeckTopChoice({ effect, G, player }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const count = Number(effect.action.params.count ?? 3);
  const result = buildReorderOpponentDeckTopChoice(G, player, count, effect.rawText);
  if (result.choice) G.pendingChoice = result.choice;
  return { success: result.success, message: result.message };
}

function handleOpponentPowerCharacterSwapChoice({ effect, G, player, opponent, opponentIndex }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  if (!isCharacterCard(opponent.battleZone)) {
    return { success: false, message: 'No opposing Battle Zone Character' };
  }
  const payload: PendingOpponentPowerCharacterSwapPayload = { opponentPlayer: opponentIndex };
  const options = legalOpponentPowerCharacterSwapCards(G, payload).map((card) => ({
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

function handleHandAbyssSwapChoice({ effect, G, player, me }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  if (me.hand.length === 0 || me.abyss.length === 0)
    return { success: false, message: 'No legal cards for hand/Abyss swap' };
  G.pendingChoice = {
    id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
    player,
    type: 'handAbyssSwap',
    min: 2,
    max: 2,
    prompt: effect.rawText,
    payload: {},
    options: [
      ...me.hand.map((card) => ({
        id: `hand:${card.instanceId}`,
        label: `Hand: ${getCardDef(card.defId)?.name ?? card.defId}`,
        cardInstanceId: card.instanceId,
        cardDefId: card.defId,
      })),
      ...me.abyss.map((card) => ({
        id: `abyss:${card.instanceId}`,
        label: `Abyss: ${getCardDef(card.defId)?.name ?? card.defId}`,
        cardInstanceId: card.instanceId,
        cardDefId: card.defId,
      })),
    ],
  };
  return { success: true, message: 'Pending hand/Abyss swap' };
}

function handleClockPositionChoice({ effect, G, player }: EffectHandlerArgs): { success: boolean; message: string } {
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

function handleClockAdvanceChoice({ effect, G, player }: EffectHandlerArgs): { success: boolean; message: string } {
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

function handleHandToDeckBottomThenDrawChoice({ effect, G, player, me }: EffectHandlerArgs): {
  success: boolean;
  message: string;
} {
  const discardCount = Number(effect.action.params.discardCount ?? 1);
  const drawCount = Number(effect.action.params.drawCount ?? discardCount);
  if (me.hand.length < discardCount)
    return { success: false, message: 'Not enough hand cards to discard' };
  G.pendingChoice = {
    id: `choice-${player}-${G.turnNumber}-${G.log.length}`,
    player,
    type: 'handToDeckBottomThenDraw',
    min: discardCount,
    max: discardCount,
    prompt: effect.rawText,
    payload: { drawCount },
    options: me.hand.map((card) => ({
      id: card.instanceId,
      label: getCardDef(card.defId)?.name ?? card.defId,
      cardInstanceId: card.instanceId,
      cardDefId: card.defId,
    })),
  };
  return { success: true, message: 'Pending hand selection' };
}

const choiceHandlers: Record<ChoiceType, ChoiceHandler> = {
  revealHandAttackBoost: handleRevealHandAttackBoostChoice,
  nameGuessOpponentHandReveal: handleNameGuessOpponentHandRevealChoice,
  optionalHandMoveThenDraw: handleOptionalHandMoveThenDrawChoice,
  useFromHand: handleUseFromHandChoice,
  cardMove: handleCardMoveChoice,
  abyssToDeckBottomOrLose: handleAbyssToDeckBottomOrLoseChoice,
  reorderOpponentDeckTop: handleReorderOpponentDeckTopChoice,
  opponentPowerCharacterSwap: handleOpponentPowerCharacterSwapChoice,
  handAbyssSwap: handleHandAbyssSwapChoice,
  clockPosition: handleClockPositionChoice,
  clockAdvance: handleClockAdvanceChoice,
  handToDeckBottomThenDraw: handleHandToDeckBottomThenDrawChoice,
};

function handleRequestChoice(args: EffectHandlerArgs): { success: boolean; message: string } {
  const { effect } = args;
  const choiceType = String(effect.action.params.choiceType ?? '');
  const handler = (choiceHandlers as Record<string, ChoiceHandler | undefined>)[choiceType];
  if (!handler) {
    return { success: false, message: 'Unsupported choice type' };
  }
  return handler(args);
}

const effectHandlers: Record<ActionType, EffectHandler> = {
  boostAttack: handleBoostAttack,
  boostBothAttackByOwnHp: handleBoostBothAttackByOwnHp,
  boostPower: handleBoostPower,
  reduceAttack: handleReduceAttack,
  setOpponentAttack: handleSetOpponentAttack,
  setOpponentElement: handleSetOpponentElement,
  directDamage: handleDirectDamage,
  heal: handleHeal,
  healOpponent: handleHealOpponent,
  healBoth: handleHealBoth,
  damageReduce: handleDamageReduce,
  drawCards: handleDrawCards,
  swapAttack: handleSwapAttack,
  forceOwnAttackTime: handleForceOwnAttackTime,
  clockReset: handleClockReset,
  nullifyOpponentClock: handleNullifyOpponentClock,
  clockRewindOpponentCharacter: handleClockRewindOpponentCharacter,
  clockSet: handleClockSet,
  expandMidnightRange: handleExpandMidnightRange,
  clockSetFromTurnStartMinusOpponentClock: handleClockSetFromTurnStartMinusOpponentClock,
  setAllCardClocks: handleSetAllCardClocks,
  clockAdvance: handleClockAdvance,
  recoverFromAbyss: handleRecoverFromAbyss,
  sendToAbyss: handleSendToAbyss,
  millDeckToAbyss: handleMillDeckToAbyss,
  moveOwnDeckTopByPower: handleMoveOwnDeckTopByPower,
  moveOpponentDeckTopByPowerCost: handleMoveOpponentDeckTopByPowerCost,
  revealOpponentDeckTopBySendToPower: handleRevealOpponentDeckTopBySendToPower,
  revealOpponentHand: handleRevealOpponentHand,
  returnAreaEnchantToDeck: handleReturnAreaEnchantToDeck,
  moveSelfAreaEnchant: handleMoveSelfAreaEnchant,
  useFromAbyss: handleUseFromAbyss,
  handSizeModifier: handleHandSizeModifier,
  setPowerCost: handleSetPowerCost,
  requestChoice: handleRequestChoice,
  suppressEffectActivation: handleSuppressEffectActivation,
  noEffect: handleNoEffect,
  addSettableCard: handleAddSettableCard,
};

export function executeEffect(
  effect: ParsedEffect,
  G: GameState,
  player: PlayerIndex,
  context: EffectExecutionContext = {},
): { success: boolean; message: string } {
  if (!effect.conditions.every((condition) => evaluateCondition(condition, G, player, context))) {
    return { success: false, message: 'Condition not met' };
  }
  const me = G.players[player];
  const opponentIndex = (1 - player) as PlayerIndex;
  const opponent = G.players[opponentIndex];
  if (effect.conditions.some((condition) => condition.type === 'handElements')) {
    if (!G.revealedHandCardIds) G.revealedHandCardIds = [[], []];
    const revealed = new Set(G.revealedHandCardIds[player]);
    for (const card of me.hand) revealed.add(card.instanceId);
    G.revealedHandCardIds[player] = [...revealed];
  }
  const valueParam = effect.action.params.value;
  const value = Number(effect.action.params.value ?? 0);
  const handler = effectHandlers[effect.action.type];
  const result = handler({ effect, G, player, context, me, opponent, opponentIndex, valueParam, value });
  if (G.pendingChoice && context.cardDefId && !G.pendingChoice.sourceCardDefId) {
    G.pendingChoice.sourceCardDefId = context.cardDefId;
  }
  return result;
}

export function processTurnEffects(
  G: GameState,
  parsedEffects: Map<string, ParsedEffect[]>,
  playedCards: [CardInstance[], CardInstance[]] = [[], []],
): void {
  const pending = collectTurnEffects(G, parsedEffects, playedCards);
  for (const phase of ['normal', 'late'] as const) {
    for (const player of getTurnEffectPlayerOrder(G)) {
      if (G.step === 'gameOver') continue;
      for (const pendingEffect of pending[player]) {
        const priority = pendingEffect.effect.priority === 'late' ? 'late' : 'normal';
        if (priority !== phase) continue;
        if (areEffectsDisabledForCard(G, player, pendingEffect.cardDefId)) {
          // 執行階段再次檢查禁用（效果執行中途可能被其他效果禁用），記錄失敗。
          recordAction(G, player, 'effectFailed', { cardDefId: pendingEffect.cardDefId, reason: 'disabled' });
          continue;
        }
        const result = executeEffect(pendingEffect.effect, G, player, {
          cardInstanceId: pendingEffect.cardInstanceId,
          cardDefId: pendingEffect.cardDefId,
        });
        if (result.success) {
          G.log.push(`Player ${player}: ${result.message}.`);
        } else {
          // 效果條件不滿足或執行失敗，記錄到 actionLog 讓玩家知道附魔未生效原因。
          recordAction(G, player, 'effectFailed', {
            cardDefId: pendingEffect.cardDefId,
            reason: 'condition',
            message: result.message,
          });
        }
        if ((G.step as GameState['step']) === 'gameOver') return;
      }
    }
  }
}
