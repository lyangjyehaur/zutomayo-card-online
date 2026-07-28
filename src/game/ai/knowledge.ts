import type { CardInstance, GameState, PlayerIndex, PlayerState } from '../types';
import type { AIKnowledgeState } from './types';

const HIDDEN_DEF_ID = '__hidden__';

function hiddenCard(instanceId: string): CardInstance {
  return { instanceId, defId: HIDDEN_DEF_ID, faceUp: false };
}

function redactCard(card: CardInstance | null, placeholder: string): CardInstance | null {
  if (!card) return null;
  return card.faceUp ? card : hiddenCard(placeholder);
}

function sanitizePlayer(G: GameState, owner: PlayerIndex, viewer: PlayerIndex): PlayerState {
  const player = structuredClone(G.players[owner]) as PlayerState;
  player.deck = player.deck.map((card, index) =>
    card.faceUp ? card : hiddenCard(`ai-hidden-p${owner}-deck-${index}`),
  );
  if (owner === viewer) return player;

  const revealedHandIds = new Set(G.revealedHandCardIds?.[owner] ?? []);
  player.hand = player.hand.map((card, index) =>
    revealedHandIds.has(card.instanceId) ? card : hiddenCard(`ai-hidden-p${owner}-hand-${index}`),
  );
  player.battleZone = redactCard(player.battleZone, `ai-hidden-p${owner}-battle`);
  player.setZoneA = redactCard(player.setZoneA, `ai-hidden-p${owner}-set-a`);
  player.setZoneB = redactCard(player.setZoneB, `ai-hidden-p${owner}-set-b`);
  player.setZoneC = redactCard(player.setZoneC, `ai-hidden-p${owner}-set-c`);
  player.powerCharger = player.powerCharger.map(
    (card, index) => redactCard(card, `ai-hidden-p${owner}-power-${index}`)!,
  );
  player.abyss = player.abyss.map((card, index) => redactCard(card, `ai-hidden-p${owner}-abyss-${index}`)!);
  return player;
}

function visibleStateKey(G: GameState, player: PlayerIndex): string {
  const own = G.players[player];
  const opponent = G.players[(1 - player) as PlayerIndex];
  return JSON.stringify({
    step: G.step,
    turn: G.turnNumber,
    chronos: G.chronos.position,
    hp: [own.hp, opponent.hp],
    hand: own.hand.map((card) => card.defId),
    zones: [own.battleZone?.defId, own.setZoneA?.defId, own.setZoneB?.defId, own.setZoneC?.defId],
    opponentZones: [
      opponent.battleZone?.defId,
      opponent.setZoneA?.defId,
      opponent.setZoneB?.defId,
      opponent.setZoneC?.defId,
    ],
    pendingChoice: G.pendingChoice?.id,
    pendingEffects: G.pendingEffects[player].map((effect) => effect.id),
  });
}

/**
 * Builds the only state shape accepted by strategy code. It applies the player-view
 * boundary again so tests or future callers cannot accidentally pass authoritative
 * opponent cards or either player's shuffled deck order to the AI.
 */
export function createAIKnowledgeState(G: GameState, player: PlayerIndex): AIKnowledgeState {
  const game = structuredClone(G) as GameState;
  game.players = [sanitizePlayer(G, 0, player), sanitizePlayer(G, 1, player)];
  game.setCardsThisTurn = game.setCardsThisTurn.map((cards, owner) =>
    cards.map((card, index) =>
      owner === player || card.faceUp ? card : hiddenCard(`ai-hidden-p${owner}-played-${index}`),
    ),
  ) as GameState['setCardsThisTurn'];
  if (game.pendingChoice && game.pendingChoice.player !== player) {
    game.pendingChoice = { ...game.pendingChoice, options: [] };
  }
  return {
    game,
    player,
    opponent: (1 - player) as PlayerIndex,
    visibleStateKey: visibleStateKey(game, player),
  };
}
