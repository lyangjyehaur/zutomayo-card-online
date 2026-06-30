import type { ParsedEffect } from './effects';
import { buildReorderOpponentDeckTopChoice } from './effects/requestChoices';
import {
  isCharacterCard,
  matchesCardMoveFilter,
  matchesPendingCardFilter,
  moveCardForChoice,
  sourceCards,
} from './effects/choices';
import type {
  ActionLogEntry,
  CardInstance,
  GameState,
  HpChangeBreakdown,
  PendingChoice,
  PendingEffect,
  PlayerIndex,
  PlayerState,
  TimingEvent,
} from './types';
import { normalizeChronosPosition } from './chronos';
import { getCardDef } from './cards/loader';

type ChoiceType = PendingChoice['type'];

export type ChoiceApplyResult =
  | { status: 'invalid' }
  | { status: 'endedGame' }
  | { status: 'ok'; nextChoice?: PendingChoice | null };

export interface PendingChoiceRuntime {
  drawUnchecked: (player: PlayerState, count: number) => void;
  endGame: (G: GameState, winner: PlayerIndex | null, reason: string) => void;
  getPlayerPower: (player: PlayerState, G?: GameState, playerIndex?: PlayerIndex) => number;
  recordPendingChoiceAction: (
    G: GameState,
    player: PlayerIndex,
    choice: PendingChoice,
    selectedCount: number,
    result?: ActionLogEntry['result'],
  ) => void;
  resolveTimingEvent: (
    G: GameState,
    parsedEffects: Map<string, ParsedEffect[]>,
    event: TimingEvent,
  ) => void;
  sendToOwnerZone: (
    card: CardInstance,
    player: PlayerState,
    G?: GameState,
    playerIndex?: PlayerIndex,
    parsedEffects?: Map<string, ParsedEffect[]>,
  ) => void;
  setChronosPosition: (
    G: GameState,
    position: number,
    parsedEffects?: Map<string, ParsedEffect[]>,
    logMessage?: string,
    source?: { kind: 'turnAdvance' | 'cardEffect'; cardDefId?: string },
    breakdown?: HpChangeBreakdown,
  ) => void;
  shuffleSelectedCards: <T>(cards: T[]) => T[];
  suppressEffectCardForTurn: (G: GameState, cardInstanceId: string) => void;
}

interface ChoiceHandlerContext {
  G: GameState;
  player: PlayerIndex;
  choice: PendingChoice;
  optionIds: string[];
  playerState: PlayerState;
  parsedEffects: Map<string, ParsedEffect[]>;
  runtime: PendingChoiceRuntime;
}

interface ChoiceHandler {
  summarize(choice: PendingChoice): Record<string, unknown>;
  apply(context: ChoiceHandlerContext): ChoiceApplyResult;
  preserveSelectionCount?: boolean;
}

const handToDeckBottomThenDrawHandler: ChoiceHandler = {
  summarize(choice) {
    const c = choice as Extract<PendingChoice, { type: 'handToDeckBottomThenDraw' }>;
    return { destinationZone: 'deck', destinationPosition: 'bottom', drawCount: c.payload.drawCount };
  },
  apply({ G, player, choice, optionIds, playerState, runtime }) {
    const c = choice as Extract<PendingChoice, { type: 'handToDeckBottomThenDraw' }>;
    for (const optionId of optionIds) {
      const handIndex = playerState.hand.findIndex((card) => card.instanceId === optionId);
      if (handIndex < 0) return { status: 'invalid' };
      const [card] = playerState.hand.splice(handIndex, 1);
      card.faceUp = true;
      playerState.deck.push(card);
    }
    const drawCount = Number(c.payload.drawCount ?? 0);
    if (playerState.deck.length < drawCount) {
      const reason = `Player ${player} loses: choice attempted to draw ${drawCount} with only ${playerState.deck.length} cards.`;
      runtime.recordPendingChoiceAction(G, player, choice, optionIds.length, { ok: false, message: reason });
      runtime.endGame(G, (1 - player) as PlayerIndex, reason);
      return { status: 'endedGame' };
    }
    runtime.drawUnchecked(playerState, drawCount);
    return { status: 'ok' };
  },
};

const optionalHandMoveThenDrawHandler: ChoiceHandler = {
  summarize(choice) {
    const c = choice as Extract<PendingChoice, { type: 'optionalHandMoveThenDraw' }>;
    return {
      sourcePlayer: c.payload.sourcePlayer,
      sourceZone: c.payload.sourceZone,
      destinationPlayer: c.payload.destinationPlayer,
      destinationZone: c.payload.destinationZone,
      destinationPosition: c.payload.destinationPosition,
      drawCount: c.payload.drawCount,
    };
  },
  apply({ G, player, choice, optionIds, playerState, parsedEffects, runtime }) {
    const c = choice as Extract<PendingChoice, { type: 'optionalHandMoveThenDraw' }>;
    if (
      c.payload.sourcePlayer !== player ||
      c.payload.sourceZone !== 'hand' ||
      c.payload.destinationPlayer !== player ||
      !['abyss', 'powerCharger', 'deck'].includes(c.payload.destinationZone) ||
      (c.payload.destinationZone === 'deck' && c.payload.destinationPosition !== 'bottom') ||
      (c.payload.destinationZone !== 'deck' && c.payload.destinationPosition !== undefined)
    ) {
      return { status: 'invalid' };
    }
    const drawCount = c.payload.drawCount === 'selected' ? optionIds.length : Number(c.payload.drawCount ?? 0);
    if (!Number.isInteger(drawCount) || drawCount < 0) return { status: 'invalid' };

    if (optionIds.length > 0) {
      for (const optionId of optionIds) {
        const card = playerState.hand.find((item) => item.instanceId === optionId);
        if (!card || !matchesPendingCardFilter(card, c.payload.filter)) return { status: 'invalid' };
      }

      for (const optionId of optionIds) {
        const handIndex = playerState.hand.findIndex((card) => card.instanceId === optionId);
        if (handIndex < 0) return { status: 'invalid' };
        const [card] = playerState.hand.splice(handIndex, 1);
        card.faceUp = true;
        if (c.payload.destinationZone === 'abyss') {
          playerState.abyss.push(card);
          runtime.resolveTimingEvent(G, parsedEffects, {
            type: 'zoneEntered',
            player,
            zone: 'abyss',
            cardDefId: card.defId,
          });
        } else if (c.payload.destinationZone === 'powerCharger') {
          playerState.powerCharger.push(card);
          runtime.resolveTimingEvent(G, parsedEffects, {
            type: 'zoneEntered',
            player,
            zone: 'powerCharger',
            cardDefId: card.defId,
          });
        } else {
          playerState.deck.push(card);
        }
      }

      if (playerState.deck.length < drawCount) {
        const reason = `Player ${player} loses: choice attempted to draw ${drawCount} with only ${playerState.deck.length} cards.`;
        runtime.recordPendingChoiceAction(G, player, choice, optionIds.length, { ok: false, message: reason });
        runtime.endGame(G, (1 - player) as PlayerIndex, reason);
        return { status: 'endedGame' };
      }
      runtime.drawUnchecked(playerState, drawCount);
    }
    return { status: 'ok' };
  },
};

const cardMoveHandler: ChoiceHandler = {
  summarize(choice) {
    const c = choice as Extract<PendingChoice, { type: 'cardMove' }>;
    return {
      sourcePlayer: c.payload.sourcePlayer,
      sourceZone: c.payload.sourceZone,
      destinationPlayer: c.payload.destinationPlayer,
      destinationZone: c.payload.destinationZone,
      destinationPosition: c.payload.destinationPosition,
    };
  },
  apply({ G, choice, optionIds, parsedEffects, runtime }) {
    const c = choice as Extract<PendingChoice, { type: 'cardMove' }>;
    const source = sourceCards(G, c.payload);
    if (
      !optionIds.every((optionId) => {
        const card = source.find((item) => item.instanceId === optionId);
        return !!card && matchesCardMoveFilter(card, c.payload);
      })
    )
      return { status: 'invalid' };
    for (const optionId of optionIds) {
      const movedCard = source.find((item) => item.instanceId === optionId);
      if (!moveCardForChoice(G, c.payload, optionId)) return { status: 'invalid' };
      if (movedCard && c.payload.destinationZone === 'abyss') {
        runtime.resolveTimingEvent(G, parsedEffects, {
          type: 'zoneEntered',
          player: c.payload.destinationPlayer,
          zone: 'abyss',
          cardDefId: movedCard.defId,
        });
      }
    }
    return { status: 'ok' };
  },
};

const useFromAbyssHandler: ChoiceHandler = {
  summarize(choice) {
    const c = choice as Extract<PendingChoice, { type: 'useFromAbyss' }>;
    return {
      sourcePlayer: c.payload.sourcePlayer,
      sourceZone: c.payload.sourceZone ?? 'abyss',
      effectLabel: 'useFromAbyss',
    };
  },
  apply({ G, player, choice, optionIds, playerState, parsedEffects }) {
    const c = choice as Extract<PendingChoice, { type: 'useFromAbyss' }>;
    if (c.payload.sourcePlayer !== player) return { status: 'invalid' };
    const source = c.payload.sourceZone === 'powerCharger' ? playerState.powerCharger : playerState.abyss;
    const copied: PendingEffect[] = [];
    for (const optionId of optionIds) {
      const selected = source.find((card) => card.instanceId === optionId);
      if (!selected) return { status: 'invalid' };
      const def = getCardDef(selected.defId);
      if (!def) return { status: 'invalid' };
      if (c.payload.cardType !== undefined && def.type !== c.payload.cardType) return { status: 'invalid' };
      if (c.payload.song !== undefined && def.song !== c.payload.song) return { status: 'invalid' };
      if (c.payload.sourceZone !== 'powerCharger' && c.payload.cardType === undefined && def.type !== 'Enchant')
        return { status: 'invalid' };
      selected.faceUp = true;
      const copiedEffects = (parsedEffects.get(selected.defId) ?? []).filter(
        (effect) => effect.trigger === 'onUse' || effect.trigger === 'onBattle',
      );
      if (copiedEffects.length === 0) continue;
      copied.push(
        ...copiedEffects.map((effect, index) => ({
          id: `${selected.instanceId}:copied:${G.turnNumber}:${G.log.length}:${index}`,
          player,
          cardInstanceId: selected.instanceId,
          cardDefId: selected.defId,
          rawText: effect.rawText,
          effect,
          source: 'played' as const,
        })),
      );
    }
    G.pendingEffects[player].unshift(...copied);
    return { status: 'ok' };
  },
};

const useFromHandHandler: ChoiceHandler = {
  summarize(choice) {
    const c = choice as Extract<PendingChoice, { type: 'useFromHand' }>;
    return {
      sourcePlayer: c.payload.sourcePlayer,
      sourceZone: 'hand',
      followUpDrawCount: c.payload.followUpDrawCount,
      effectLabel: 'useFromHand',
    };
  },
  apply({ G, player, choice, optionIds, playerState, parsedEffects, runtime }) {
    const c = choice as Extract<PendingChoice, { type: 'useFromHand' }>;
    if (c.payload.sourcePlayer !== player) return { status: 'invalid' };
    const copied: PendingEffect[] = [];
    for (const optionId of optionIds) {
      const selectedIndex = playerState.hand.findIndex((card) => card.instanceId === optionId);
      if (selectedIndex < 0) return { status: 'invalid' };
      const selected = playerState.hand[selectedIndex];
      const def = getCardDef(selected.defId);
      if (
        !def ||
        runtime.getPlayerPower(playerState, G, player) < def.powerCost ||
        !matchesPendingCardFilter(selected, c.payload.filter)
      )
        return { status: 'invalid' };
    }

    for (const optionId of optionIds) {
      const selectedIndex = playerState.hand.findIndex((card) => card.instanceId === optionId);
      if (selectedIndex < 0) return { status: 'invalid' };
      const [selected] = playerState.hand.splice(selectedIndex, 1);
      selected.faceUp = true;
      const copiedEffects = (parsedEffects.get(selected.defId) ?? []).filter(
        (effect) => effect.trigger === 'onUse' || effect.trigger === 'onBattle',
      );
      copied.push(
        ...copiedEffects.map((effect, index) => ({
          id: `${selected.instanceId}:hand:${G.turnNumber}:${G.log.length}:${index}`,
          player,
          cardInstanceId: selected.instanceId,
          cardDefId: selected.defId,
          rawText: effect.rawText,
          effect,
          source: 'played' as const,
        })),
      );
      runtime.sendToOwnerZone(selected, playerState, G, player, parsedEffects);
    }

    const followUpDrawCount = Number(c.payload.followUpDrawCount ?? 0);
    if (followUpDrawCount > 0) {
      copied.push({
        id: `follow-up-draw:${player}:${G.turnNumber}:${G.log.length}`,
        player,
        cardInstanceId: `follow-up-draw:${player}`,
        cardDefId: 'follow-up-draw',
        rawText: choice.prompt ?? 'follow-up draw',
        effect: {
          trigger: 'onUse',
          conditions: [],
          action: { type: 'drawCards', params: { value: followUpDrawCount } },
          rawText: choice.prompt ?? 'follow-up draw',
        },
        source: 'played',
      });
    }

    G.pendingEffects[player].unshift(...copied);
    return { status: 'ok' };
  },
};

const revealHandAttackBoostHandler: ChoiceHandler = {
  summarize(choice) {
    const c = choice as Extract<PendingChoice, { type: 'revealHandAttackBoost' }>;
    return {
      sourcePlayer: c.payload.sourcePlayer,
      effectLabel: 'revealHandAttackBoost',
    };
  },
  apply({ G, player, choice, optionIds, playerState }) {
    const c = choice as Extract<PendingChoice, { type: 'revealHandAttackBoost' }>;
    if (c.payload.sourcePlayer !== player) return { status: 'invalid' };
    for (const optionId of optionIds) {
      const card = playerState.hand.find((item) => item.instanceId === optionId);
      if (!card || !matchesPendingCardFilter(card, c.payload.filter)) return { status: 'invalid' };
    }
    const revealed = new Set(G.revealedHandCardIds[player] ?? []);
    for (const optionId of optionIds) revealed.add(optionId);
    G.revealedHandCardIds[player] = [...revealed];
    G.modifiers.attack[player] += optionIds.length * c.payload.boostPerCard;
    return { status: 'ok' };
  },
};

const nameGuessOpponentHandRevealHandler: ChoiceHandler = {
  summarize(choice) {
    const c = choice as Extract<PendingChoice, { type: 'nameGuessOpponentHandReveal' }>;
    return {
      targetPlayer: c.payload.opponentPlayer,
      effectLabel: 'nameGuessOpponentHandReveal',
    };
  },
  apply({ G, player, choice, optionIds }) {
    const c = choice as Extract<PendingChoice, { type: 'nameGuessOpponentHandReveal' }>;
    const match = optionIds[0]?.match(/^hand:([0-9]+):guess:([^:]+)$/);
    if (!match || c.payload.opponentPlayer !== ((1 - player) as PlayerIndex)) return { status: 'invalid' };
    const [, handIndexText, guessedDefId] = match;
    const opponent = G.players[c.payload.opponentPlayer];
    const selected = opponent.hand[Number(handIndexText)];
    if (!selected) return { status: 'invalid' };
    const revealed = new Set(G.revealedHandCardIds[c.payload.opponentPlayer] ?? []);
    revealed.add(selected.instanceId);
    G.revealedHandCardIds[c.payload.opponentPlayer] = [...revealed];
    if (selected.defId === guessedDefId) {
      G.modifiers.attack[player] += c.payload.attackBoost;
    }
    return { status: 'ok' };
  },
};

const handAbyssSwapHandler: ChoiceHandler = {
  summarize() {
    return { effectLabel: 'handAbyssSwap' };
  },
  apply({ optionIds, playerState }) {
    const handOption = optionIds.find((id) => id.startsWith('hand:'));
    const abyssOption = optionIds.find((id) => id.startsWith('abyss:'));
    if (!handOption || !abyssOption) return { status: 'invalid' };
    const handId = handOption.slice('hand:'.length);
    const abyssId = abyssOption.slice('abyss:'.length);
    const handIndex = playerState.hand.findIndex((card) => card.instanceId === handId);
    const abyssIndex = playerState.abyss.findIndex((card) => card.instanceId === abyssId);
    if (handIndex < 0 || abyssIndex < 0) return { status: 'invalid' };
    const [handCard] = playerState.hand.splice(handIndex, 1);
    const [abyssCard] = playerState.abyss.splice(abyssIndex, 1);
    handCard.faceUp = true;
    abyssCard.faceUp = true;
    playerState.hand.push(abyssCard);
    playerState.abyss.push(handCard);
    return { status: 'ok' };
  },
};

const opponentPowerCharacterSwapHandler: ChoiceHandler = {
  summarize(choice) {
    const c = choice as Extract<PendingChoice, { type: 'opponentPowerCharacterSwap' }>;
    return {
      targetPlayer: c.payload.opponentPlayer,
      effectLabel: 'opponentPowerCharacterSwap',
    };
  },
  apply({ G, player, choice, optionIds, runtime }) {
    const c = choice as Extract<PendingChoice, { type: 'opponentPowerCharacterSwap' }>;
    if (c.payload.opponentPlayer !== ((1 - player) as PlayerIndex)) return { status: 'invalid' };
    const opponent = G.players[c.payload.opponentPlayer];
    const battleZoneCard = opponent.battleZone;
    if (!isCharacterCard(battleZoneCard)) return { status: 'invalid' };
    const selectedIndex = opponent.powerCharger.findIndex((card) => card.instanceId === optionIds[0]);
    if (selectedIndex < 0) return { status: 'invalid' };
    const selected = opponent.powerCharger[selectedIndex];
    if (!isCharacterCard(selected)) return { status: 'invalid' };

    opponent.powerCharger.splice(selectedIndex, 1);
    selected.faceUp = true;
    battleZoneCard.faceUp = true;
    opponent.battleZone = selected;
    opponent.powerCharger.push(battleZoneCard);
    G.swappedCardsThisTurn[c.payload.opponentPlayer].push(selected);
    runtime.suppressEffectCardForTurn(G, selected.instanceId);
    return { status: 'ok' };
  },
};

const abyssToDeckBottomOrLoseHandler: ChoiceHandler = {
  summarize(choice) {
    const c = choice as Extract<PendingChoice, { type: 'abyssToDeckBottomOrLose' }>;
    return {
      sourceZone: 'abyss',
      destinationZone: 'deck',
      destinationPosition: 'bottom',
      faceDown: c.payload.faceDown,
      shuffle: c.payload.shuffle,
      followUpChoiceType: c.payload.followUpChoiceType,
    };
  },
  apply({ G, player, choice, optionIds, playerState, runtime }) {
    const c = choice as Extract<PendingChoice, { type: 'abyssToDeckBottomOrLose' }>;
    const abyssIds = new Set(playerState.abyss.map((card) => card.instanceId));
    if (!optionIds.every((optionId) => abyssIds.has(optionId))) return { status: 'invalid' };

    const selectedCards: CardInstance[] = [];
    for (const optionId of optionIds) {
      const abyssIndex = playerState.abyss.findIndex((card) => card.instanceId === optionId);
      if (abyssIndex < 0) return { status: 'invalid' };
      const [card] = playerState.abyss.splice(abyssIndex, 1);
      card.faceUp = !c.payload.faceDown;
      selectedCards.push(card);
    }

    const ordered =
      c.payload.shuffle && selectedCards.length > 1 ? runtime.shuffleSelectedCards(selectedCards) : selectedCards;
    playerState.deck.push(...ordered);
    G.lastChoiceSelectionCount[player] = optionIds.length;

    if (c.payload.followUpChoiceType === 'reorderOpponentDeckTop') {
      const result = buildReorderOpponentDeckTopChoice(G, player, Number(c.payload.followUpCount ?? 0), choice.prompt);
      if (!result.success) return { status: 'invalid' };
      return { status: 'ok', nextChoice: result.choice ?? null };
    }
    return { status: 'ok' };
  },
  preserveSelectionCount: true,
};

const reorderOpponentDeckTopHandler: ChoiceHandler = {
  summarize(choice) {
    const c = choice as Extract<PendingChoice, { type: 'reorderOpponentDeckTop' }>;
    return {
      targetPlayer: c.payload.targetPlayer,
      effectLabel: 'reorderOpponentDeckTop',
    };
  },
  apply({ G, choice, optionIds }) {
    const c = choice as Extract<PendingChoice, { type: 'reorderOpponentDeckTop' }>;
    const target = G.players[c.payload.targetPlayer];
    const count = c.payload.count;
    if (!Number.isInteger(count) || count < 1 || optionIds.length !== count) return { status: 'invalid' };
    const topCards = target.deck.slice(0, count);
    if (topCards.length !== count) return { status: 'invalid' };
    const topCardIds = new Set(topCards.map((card) => card.instanceId));
    if (!optionIds.every((optionId) => topCardIds.has(optionId))) return { status: 'invalid' };
    const ordered = optionIds.map((optionId) => topCards.find((card) => card.instanceId === optionId)!);
    target.deck.splice(0, count, ...ordered);
    return { status: 'ok' };
  },
};

const clockPositionHandler: ChoiceHandler = {
  summarize() {
    return { effectLabel: 'clockPosition' };
  },
  apply({ G, choice, optionIds, parsedEffects, runtime }) {
    const option = choice.options.find((item) => item.id === optionIds[0]);
    if (!option || !Number.isInteger(Number(option.value))) return { status: 'invalid' };
    const value = Number(option.value);
    const sourceCardDefId =
      G.pendingEffectPlayer !== null ? G.pendingEffects[G.pendingEffectPlayer]?.[0]?.cardDefId : undefined;
    runtime.setChronosPosition(G, value, parsedEffects, `Chronos set to ${value}.`, {
      kind: 'cardEffect',
      ...(sourceCardDefId ? { cardDefId: sourceCardDefId } : {}),
    });
    return { status: 'ok' };
  },
};

const clockAdvanceHandler: ChoiceHandler = {
  summarize() {
    return { effectLabel: 'clockAdvance' };
  },
  apply({ G, choice, optionIds, parsedEffects, runtime }) {
    const option = choice.options.find((item) => item.id === optionIds[0]);
    if (!option || !Number.isInteger(Number(option.value))) return { status: 'invalid' };
    const value = Number(option.value);
    const before = G.chronos.position;
    const sourceCardDefId =
      G.pendingEffectPlayer !== null ? G.pendingEffects[G.pendingEffectPlayer]?.[0]?.cardDefId : undefined;
    runtime.setChronosPosition(
      G,
      before + value,
      parsedEffects,
      `Chronos +${value} (${before}→${normalizeChronosPosition(before + value)}).`,
      { kind: 'cardEffect', ...(sourceCardDefId ? { cardDefId: sourceCardDefId } : {}) },
    );
    return { status: 'ok' };
  },
};

const choiceHandlers: Record<ChoiceType, ChoiceHandler> = {
  handToDeckBottomThenDraw: handToDeckBottomThenDrawHandler,
  cardMove: cardMoveHandler,
  optionalHandMoveThenDraw: optionalHandMoveThenDrawHandler,
  abyssToDeckBottomOrLose: abyssToDeckBottomOrLoseHandler,
  reorderOpponentDeckTop: reorderOpponentDeckTopHandler,
  opponentPowerCharacterSwap: opponentPowerCharacterSwapHandler,
  useFromAbyss: useFromAbyssHandler,
  useFromHand: useFromHandHandler,
  revealHandAttackBoost: revealHandAttackBoostHandler,
  nameGuessOpponentHandReveal: nameGuessOpponentHandRevealHandler,
  handAbyssSwap: handAbyssSwapHandler,
  clockPosition: clockPositionHandler,
  clockAdvance: clockAdvanceHandler,
};

export function choiceDestinationSummary(choice: PendingChoice): Record<string, unknown> {
  return choiceHandlers[choice.type].summarize(choice);
}

export function choiceActionPayload(choice: PendingChoice, selectedCount: number): Record<string, unknown> {
  return {
    choiceId: choice.id,
    choiceType: choice.type,
    selectedCount,
    min: choice.min,
    max: choice.max,
    ...choiceDestinationSummary(choice),
  };
}

export function applyPendingChoice(
  context: Omit<ChoiceHandlerContext, 'runtime'>,
  runtime: PendingChoiceRuntime,
): ChoiceApplyResult {
  return choiceHandlers[context.choice.type].apply({ ...context, runtime });
}

export function shouldPreserveChoiceSelectionCount(choice: PendingChoice): boolean {
  return Boolean(choiceHandlers[choice.type].preserveSelectionCount);
}
