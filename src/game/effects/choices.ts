import type {
  CardInstance,
  GameState,
  PendingCardMovePayload,
  PendingCardFilter,
  PendingChoiceCardZone,
  PendingOptionalHandMoveThenDrawPayload,
  PendingOpponentPowerCharacterSwapPayload,
  PlayerIndex,
  PlayerState,
} from '../types';
import { getCardDef } from '../cards/loader';

export type RelativeChoicePlayer = 'self' | 'opponent';

export function relativePlayer(player: PlayerIndex, relative: RelativeChoicePlayer): PlayerIndex {
  return relative === 'self' ? player : ((1 - player) as PlayerIndex);
}

function zoneCards(player: PlayerState, zone: PendingChoiceCardZone): CardInstance[] {
  return player[zone];
}

export function sourceCards(G: GameState, payload: PendingCardMovePayload): CardInstance[] {
  return zoneCards(G.players[payload.sourcePlayer], payload.sourceZone);
}

export function matchesCardMoveFilter(card: CardInstance, payload: PendingCardMovePayload): boolean {
  if (payload.filterSendToPower === undefined) return true;
  return getCardDef(card.defId)?.sendToPower === payload.filterSendToPower;
}

export function legalCardMoveCards(G: GameState, payload: PendingCardMovePayload): CardInstance[] {
  return sourceCards(G, payload).filter(card => matchesCardMoveFilter(card, payload));
}

export function matchesPendingCardFilter(card: CardInstance, filter: PendingCardFilter): boolean {
  const def = getCardDef(card.defId);
  if (!def) return false;
  if (filter.cardType !== undefined && def.type !== filter.cardType) return false;
  if (filter.song !== undefined && def.song !== filter.song) return false;
  if (filter.element !== undefined && def.element !== filter.element) return false;
  return true;
}

export function legalOptionalHandMoveThenDrawCards(
  G: GameState,
  payload: PendingOptionalHandMoveThenDrawPayload,
): CardInstance[] {
  return G.players[payload.sourcePlayer].hand.filter(card => matchesPendingCardFilter(card, payload.filter));
}

export function isCharacterCard(card: CardInstance | null): card is CardInstance {
  return !!card && getCardDef(card.defId)?.type === 'Character';
}

export function legalOpponentPowerCharacterSwapCards(
  G: GameState,
  payload: PendingOpponentPowerCharacterSwapPayload,
): CardInstance[] {
  return G.players[payload.opponentPlayer].powerCharger.filter(isCharacterCard);
}

export function moveCardForChoice(G: GameState, payload: PendingCardMovePayload, instanceId: string): boolean {
  const source = sourceCards(G, payload);
  const sourceIndex = source.findIndex(card => card.instanceId === instanceId);
  if (sourceIndex < 0) return false;

  const [card] = source.splice(sourceIndex, 1);
  if (!matchesCardMoveFilter(card, payload)) {
    source.splice(sourceIndex, 0, card);
    return false;
  }

  card.faceUp = true;
  const destination = G.players[payload.destinationPlayer];
  if (payload.destinationZone === 'abyss') {
    destination.abyss.push(card);
    return true;
  }
  if (payload.destinationZone === 'deck' && payload.destinationPosition === 'bottom') {
    destination.deck.push(card);
    return true;
  }

  source.splice(sourceIndex, 0, card);
  return false;
}
