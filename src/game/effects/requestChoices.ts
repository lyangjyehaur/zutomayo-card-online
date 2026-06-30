import type {
  CardType,
  Element,
  GameState,
  PendingAbyssToDeckBottomPayload,
  PendingCardFilter,
  PendingCardMovePayload,
  PendingChoice,
  PendingChoiceCardZone,
  PendingChoiceDeckPosition,
  PendingChoiceDestinationZone,
  PendingNameGuessOpponentHandRevealPayload,
  PendingOptionalHandMoveThenDrawPayload,
  PendingOpponentPowerCharacterSwapPayload,
  PendingReorderDeckTopPayload,
  PendingRevealHandAttackBoostPayload,
  PendingUseFromHandPayload,
  PlayerIndex,
  PlayerState,
} from '../types';
import { CHRONOS_MAPPING } from '../types';
import { getAllCardDefs, getCardDef } from '../cards/loader';
import type { ParsedEffect } from './types';
import {
  isCharacterCard,
  legalCardMoveCards,
  legalOptionalHandMoveThenDrawCards,
  legalOpponentPowerCharacterSwapCards,
  relativePlayer,
  type RelativeChoicePlayer,
} from './choices';

type ChoiceResult = { success: boolean; message: string };

interface RequestChoiceHandlerArgs {
  effect: ParsedEffect;
  G: GameState;
  player: PlayerIndex;
  me: PlayerState;
  opponent: PlayerState;
  opponentIndex: PlayerIndex;
  power: (G: GameState, player: PlayerIndex) => number;
  loseOnEffectOverdraw: (G: GameState, player: PlayerIndex, count: number) => boolean;
  loseByAbyssPaymentFailure: (G: GameState, player: PlayerIndex, min: number, available: number) => void;
}

type ChoiceHandler = (args: RequestChoiceHandlerArgs) => ChoiceResult;

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

function handleRevealHandAttackBoostChoice({ effect, G, player, me }: RequestChoiceHandlerArgs): ChoiceResult {
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

function handleNameGuessOpponentHandRevealChoice({
  effect,
  G,
  player,
  opponent,
  opponentIndex,
}: RequestChoiceHandlerArgs): ChoiceResult {
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

function handleOptionalHandMoveThenDrawChoice({ effect, G, player }: RequestChoiceHandlerArgs): ChoiceResult {
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

function handleUseFromHandChoice({
  effect,
  G,
  player,
  me,
  power,
  loseOnEffectOverdraw,
}: RequestChoiceHandlerArgs): ChoiceResult {
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

function handleCardMoveChoice({ effect, G, player }: RequestChoiceHandlerArgs): ChoiceResult {
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

function handleAbyssToDeckBottomOrLoseChoice({
  effect,
  G,
  player,
  me,
  loseByAbyssPaymentFailure,
}: RequestChoiceHandlerArgs): ChoiceResult {
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

function handleReorderOpponentDeckTopChoice({ effect, G, player }: RequestChoiceHandlerArgs): ChoiceResult {
  const count = Number(effect.action.params.count ?? 3);
  const result = buildReorderOpponentDeckTopChoice(G, player, count, effect.rawText);
  if (result.choice) G.pendingChoice = result.choice;
  return { success: result.success, message: result.message };
}

function handleOpponentPowerCharacterSwapChoice({
  effect,
  G,
  player,
  opponent,
  opponentIndex,
}: RequestChoiceHandlerArgs): ChoiceResult {
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

function handleHandAbyssSwapChoice({ effect, G, player, me }: RequestChoiceHandlerArgs): ChoiceResult {
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

function handleClockPositionChoice({ effect, G, player }: RequestChoiceHandlerArgs): ChoiceResult {
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

function handleClockAdvanceChoice({ effect, G, player }: RequestChoiceHandlerArgs): ChoiceResult {
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

function handleHandToDeckBottomThenDrawChoice({ effect, G, player, me }: RequestChoiceHandlerArgs): ChoiceResult {
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

export function handleRequestChoice(args: RequestChoiceHandlerArgs): ChoiceResult {
  const choiceType = String(args.effect.action.params.choiceType ?? '');
  const handler = (choiceHandlers as Record<string, ChoiceHandler | undefined>)[choiceType];
  if (!handler) {
    return { success: false, message: 'Unsupported choice type' };
  }
  return handler(args);
}
