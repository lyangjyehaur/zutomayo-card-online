import { getMinimumSetCount, getRequiredSetCount } from '../../game/GameLogic';
import { getCardDef } from '../../game/cards/loader';
import type { CardInstance, GameState, PlayerIndex } from '../../game/types';

export type BattleCardBlockReason = 'tutorial-restricted' | 'area-enchant-locked' | 'no-set-slot-available';

export interface BattleActionAvailabilityOptions {
  spectator?: boolean;
  tutorialSetInteractionEnabled?: boolean;
  tutorialAllowedSetCardDefIds?: readonly string[];
  tutorialRequiredSetCardDefIds?: readonly string[];
}

export interface BattleActionAvailability {
  minimum: number;
  required: number;
  canAct: boolean;
  canConfirm: boolean;
  playableCardDefIds: string[];
}

export function battleCardBlockReason(
  G: GameState,
  player: PlayerIndex,
  card: CardInstance,
  tutorialAllowedSetCardDefIds?: readonly string[],
): BattleCardBlockReason | null {
  if (tutorialAllowedSetCardDefIds && !tutorialAllowedSetCardDefIds.includes(card.defId)) {
    return 'tutorial-restricted';
  }
  if (getCardDef(card.defId)?.type === 'Area Enchant' && G.areaEnchantSetLocked?.[player]) {
    return 'area-enchant-locked';
  }
  const playerState = G.players[player];
  if (G.step === 'turnSet' && playerState.setZoneA && playerState.setZoneB) {
    return 'no-set-slot-available';
  }
  return null;
}

export function deriveBattleActionAvailability(
  G: GameState,
  player: PlayerIndex,
  {
    spectator = false,
    tutorialSetInteractionEnabled = true,
    tutorialAllowedSetCardDefIds,
    tutorialRequiredSetCardDefIds,
  }: BattleActionAvailabilityOptions = {},
): BattleActionAvailability {
  const playerState = G.players[player];
  const minimum = getMinimumSetCount(G, player);
  const required = getRequiredSetCount(G, player);
  const canAct =
    !spectator &&
    tutorialSetInteractionEnabled &&
    (G.step === 'initialSet' || G.step === 'turnSet') &&
    !G.ready[player] &&
    playerState.cardsSetThisTurn < required;
  const playableCardDefIds = canAct
    ? playerState.hand
        .filter((card) => battleCardBlockReason(G, player, card, tutorialAllowedSetCardDefIds) === null)
        .map((card) => card.defId)
    : [];
  const hasRequiredTutorialCards =
    !tutorialRequiredSetCardDefIds ||
    tutorialRequiredSetCardDefIds.every((defId) => G.setCardsThisTurn[player].some((card) => card.defId === defId));
  const canConfirm =
    !spectator &&
    tutorialSetInteractionEnabled &&
    !G.ready[player] &&
    playerState.cardsSetThisTurn >= minimum &&
    playerState.cardsSetThisTurn <= required &&
    hasRequiredTutorialCards;

  return { minimum, required, canAct, canConfirm, playableCardDefIds };
}
