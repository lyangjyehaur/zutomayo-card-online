import type { CardInstance, GameState, PlayerIndex, PlayerState } from '../types';
import type { AIKnowledgeState } from './types';

const HIDDEN_DEF_ID = '__hidden__';

function hiddenCard(instanceId: string): CardInstance {
  return { instanceId, defId: HIDDEN_DEF_ID, faceUp: false };
}

interface HiddenCardIds {
  id(owner: PlayerIndex, card: CardInstance): string;
}

function createHiddenCardIds(): HiddenCardIds {
  const ids: [Map<string, string>, Map<string, string>] = [new Map(), new Map()];
  const next = [0, 0];
  return {
    id(owner, card) {
      const existing = ids[owner].get(card.instanceId);
      if (existing) return existing;
      const opaque = `ai-hidden-p${owner}-card-${next[owner]++}`;
      ids[owner].set(card.instanceId, opaque);
      return opaque;
    },
  };
}

function redactCard(
  card: CardInstance | null,
  owner: PlayerIndex,
  hiddenIds: HiddenCardIds,
  explicitlyRevealedIds: ReadonlySet<string>,
): CardInstance | null {
  if (!card) return null;
  return card.faceUp || explicitlyRevealedIds.has(card.instanceId) ? card : hiddenCard(hiddenIds.id(owner, card));
}

function sanitizePlayer(
  G: GameState,
  owner: PlayerIndex,
  viewer: PlayerIndex,
  hiddenIds: HiddenCardIds,
  explicitlyRevealedIds: ReadonlySet<string>,
): PlayerState {
  const player = structuredClone(G.players[owner]) as PlayerState;
  if (owner !== viewer) player.knownDeckDefIds = undefined;
  player.deck = player.deck.map((card) =>
    card.faceUp || explicitlyRevealedIds.has(card.instanceId) ? card : hiddenCard(hiddenIds.id(owner, card)),
  );
  if (owner === viewer) return player;

  const revealedHandIds = new Set(G.revealedHandCardIds?.[owner] ?? []);
  player.hand = player.hand.map((card) =>
    revealedHandIds.has(card.instanceId) || explicitlyRevealedIds.has(card.instanceId)
      ? card
      : hiddenCard(hiddenIds.id(owner, card)),
  );
  player.battleZone = redactCard(player.battleZone, owner, hiddenIds, explicitlyRevealedIds);
  player.setZoneA = redactCard(player.setZoneA, owner, hiddenIds, explicitlyRevealedIds);
  player.setZoneB = redactCard(player.setZoneB, owner, hiddenIds, explicitlyRevealedIds);
  player.setZoneC = redactCard(player.setZoneC, owner, hiddenIds, explicitlyRevealedIds);
  player.powerCharger = player.powerCharger.map((card) => redactCard(card, owner, hiddenIds, explicitlyRevealedIds)!);
  player.abyss = player.abyss.map((card) => redactCard(card, owner, hiddenIds, explicitlyRevealedIds)!);
  return player;
}

function visibleCard(card: CardInstance | null): object | null {
  if (!card) return null;
  return card.defId === HIDDEN_DEF_ID
    ? { hidden: true, instanceId: card.instanceId }
    : { defId: card.defId, faceUp: card.faceUp, instanceId: card.instanceId };
}

function visiblePlayer(player: PlayerState): object {
  return {
    hp: player.hp,
    deck: player.deck.map(visibleCard),
    knownDeckDefIds: player.knownDeckDefIds,
    hand: player.hand.map(visibleCard),
    battleZone: visibleCard(player.battleZone),
    setZoneA: visibleCard(player.setZoneA),
    setZoneB: visibleCard(player.setZoneB),
    setZoneC: visibleCard(player.setZoneC),
    powerCharger: player.powerCharger.map(visibleCard),
    abyss: player.abyss.map(visibleCard),
    cardsSetThisTurn: player.cardsSetThisTurn,
    rawAttack: player.rawAttack,
  };
}

function visibleStateKey(G: GameState, player: PlayerIndex): string {
  return JSON.stringify({
    player,
    step: G.step,
    turn: G.turnNumber,
    ready: G.ready,
    chronos: G.chronos,
    midnightRange: G.midnightRange,
    chronosAtTurnStart: G.chronosAtTurnStart,
    players: G.players.map(visiblePlayer),
    lastBattleResult: G.lastBattleResult,
    setCardsThisTurn: G.setCardsThisTurn.map((cards) => cards.map(visibleCard)),
    pendingEffects: G.pendingEffects,
    pendingEffectPlayer: G.pendingEffectPlayer,
    delayedEffects: G.delayedEffects,
    pendingChoice: G.pendingChoice,
    lastChoiceSelectionCount: G.lastChoiceSelectionCount,
    timingEvents: G.timingEvents,
    swappedCardsThisTurn: G.swappedCardsThisTurn.map((cards) => cards.map(visibleCard)),
    suppressedEffectCardIdsThisTurn: G.suppressedEffectCardIdsThisTurn,
    drawEffectCardIdsThisTurn: G.drawEffectCardIdsThisTurn,
    drawOccurredThisEffect: G.drawOccurredThisEffect,
    previousTurnCharacterElements: G.previousTurnCharacterElements,
    handSizeModifier: G.handSizeModifier,
    areaEnchantSetLocked: G.areaEnchantSetLocked,
    damageReducedThisTurn: G.damageReducedThisTurn,
    jankenChoices: G.jankenChoices,
    jankenDrawCount: G.jankenDrawCount,
    mulliganUsed: G.mulliganUsed,
    modifiers: G.modifiers,
    winner: G.winner,
    gameoverReason: G.gameoverReason,
  });
}

/**
 * Builds the only state shape accepted by strategy code. It applies the player-view
 * boundary again so tests or future callers cannot accidentally pass authoritative
 * opponent cards or either player's shuffled deck order to the AI.
 */
export function createAIKnowledgeState(G: GameState, player: PlayerIndex): AIKnowledgeState {
  const hiddenIds = createHiddenCardIds();
  const explicitlyRevealedIds = new Set(
    G.pendingChoice?.player === player
      ? G.pendingChoice.options.flatMap((option) => (option.cardInstanceId ? [option.cardInstanceId] : []))
      : [],
  );
  const knownOwnDeckDefIds = [
    ...(G.players[player].knownDeckDefIds ??
      G.players[player].deck.map((card) => card.defId).filter((id) => id !== HIDDEN_DEF_ID)),
  ].sort();
  const game = structuredClone(G) as GameState;
  game.players = [
    sanitizePlayer(G, 0, player, hiddenIds, explicitlyRevealedIds),
    sanitizePlayer(G, 1, player, hiddenIds, explicitlyRevealedIds),
  ];
  game.setCardsThisTurn = game.setCardsThisTurn.map((cards, owner) =>
    cards.map((card) =>
      owner === player || card.faceUp ? card : hiddenCard(hiddenIds.id(owner as PlayerIndex, card)),
    ),
  ) as GameState['setCardsThisTurn'];
  game.swappedCardsThisTurn = game.swappedCardsThisTurn.map((cards, owner) =>
    cards.map((card) =>
      owner === player || card.faceUp ? card : hiddenCard(hiddenIds.id(owner as PlayerIndex, card)),
    ),
  ) as GameState['swappedCardsThisTurn'];
  if (game.pendingChoice && game.pendingChoice.player !== player) {
    game.pendingChoice = { ...game.pendingChoice, options: [] };
  }
  if (game.jankenChoices[0] === null || game.jankenChoices[1] === null) {
    game.jankenChoices[(1 - player) as PlayerIndex] = null;
  }
  game.log = [];
  game.actionLog = [];
  game.recentHpChanges = [];
  game.recentGameNotices = [];
  return {
    game,
    player,
    opponent: (1 - player) as PlayerIndex,
    knownOwnDeckDefIds,
    visibleStateKey: visibleStateKey(game, player),
  };
}
