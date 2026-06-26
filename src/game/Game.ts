import type { Game, Move } from 'boardgame.io';
import type { ActionLogEntry, CardInstance, GameState, JankenChoice, PlayerIndex, SetSlot, ZutomayoSetupData } from './types';
import { getAllCardDefs } from './cards/loader';
import { parseAllEffects } from './effects';
import {
  chooseJanken,
  confirmReady,
  finishMulligan,
  resolvePendingEffect as resolvePendingEffectChoice,
  setInitialCard,
  setTurnCard,
  setupGame,
  submitPendingChoice,
  undoSetCard,
  validateZutomayoSetupData,
} from './GameLogic';

export type { ZutomayoSetupData } from './types';

// boardgame.io 0.50 publishes core as a CommonJS directory that Node ESM cannot
// import directly. The documented sentinel is the stable string consumed by
// its reducer, so keeping it local works in both Vite and the Node server.
const INVALID_MOVE = 'INVALID_MOVE';

const parsedEffects = parseAllEffects(
  getAllCardDefs().map(card => ({ id: card.id, effect: card.effect })),
);

function playerIndex(playerID: string | null): PlayerIndex | null {
  return playerID === '0' || playerID === '1' ? Number(playerID) as PlayerIndex : null;
}

function hiddenCard(instanceId: string): CardInstance {
  return { instanceId, defId: '__hidden__', faceUp: false };
}

function redactHiddenCard(card: CardInstance | null, placeholder: string): CardInstance | null {
  if (!card) return null;
  return card.faceUp ? { ...card } : hiddenCard(placeholder);
}

function redactPlayerForViewer(G: GameState, owner: PlayerIndex, viewer: PlayerIndex | null) {
  const player = G.players[owner];
  const isOwner = viewer === owner;
  if (isOwner) return { ...player, hand: [...player.hand], deck: [...player.deck] };

  return {
    ...player,
    hand: player.hand.map((_, index) => hiddenCard(`hidden-p${owner}-hand-${index}`)),
    deck: player.deck.map((_, index) => hiddenCard(`hidden-p${owner}-deck-${index}`)),
    setZoneA: redactHiddenCard(player.setZoneA, `hidden-p${owner}-set-a`),
    setZoneB: redactHiddenCard(player.setZoneB, `hidden-p${owner}-set-b`),
  };
}

function redactPlayedCardsForViewer(G: GameState, owner: PlayerIndex, viewer: PlayerIndex | null): CardInstance[] {
  if (viewer === owner) return G.setCardsThisTurn[owner].map(card => ({ ...card }));
  return G.setCardsThisTurn[owner].map((card, index) => (
    card.faceUp ? { ...card } : hiddenCard(`hidden-p${owner}-played-${index}`)
  ));
}

function redactActionLogForViewer(
  G: GameState,
  viewer: PlayerIndex | null,
  bothChose: boolean,
): ActionLogEntry[] {
  return (G.actionLog ?? [])
    .filter(entry => entry.action !== 'janken' || bothChose || entry.player === viewer)
    .map(entry => ({
      ...entry,
      payload: entry.payload && typeof entry.payload === 'object' ? { ...entry.payload } : entry.payload,
    }));
}

function playerView({ G, playerID }: { G: GameState; playerID: string | null }): GameState {
  const viewer = playerIndex(playerID);
  const bothChose = G.jankenChoices[0] !== null && G.jankenChoices[1] !== null;
  const jankenChoices = G.jankenChoices.map((choice, index) => {
    if (bothChose || viewer === index) return choice;
    return null;
  }) as GameState['jankenChoices'];
  const pendingChoice = !G.pendingChoice || G.pendingChoice.player === viewer
    ? G.pendingChoice
    : { ...G.pendingChoice, options: [] };

  return {
    ...G,
    players: [redactPlayerForViewer(G, 0, viewer), redactPlayerForViewer(G, 1, viewer)],
    setCardsThisTurn: [redactPlayedCardsForViewer(G, 0, viewer), redactPlayedCardsForViewer(G, 1, viewer)],
    jankenChoices,
    pendingChoice,
    actionLog: redactActionLogForViewer(G, viewer, bothChose),
  };
}

const moves: Record<string, Move<GameState>> = {
  janken: ({ G, playerID }, choice: JankenChoice) => {
    const player = playerIndex(playerID);
    if (player === null || !chooseJanken(G, player, choice)) return INVALID_MOVE;
  },
  mulligan: ({ G, playerID }, indices: number[]) => {
    const player = playerIndex(playerID);
    if (player === null || !Array.isArray(indices) || !finishMulligan(G, player, indices)) return INVALID_MOVE;
  },
  keepHand: ({ G, playerID }) => {
    const player = playerIndex(playerID);
    if (player === null || !finishMulligan(G, player, [])) return INVALID_MOVE;
  },
  setInitialCard: ({ G, playerID }, handIndex: number) => {
    const player = playerIndex(playerID);
    if (player === null || !setInitialCard(G, player, handIndex)) return INVALID_MOVE;
  },
  setTurnCard: ({ G, playerID }, handIndex: number, slot: SetSlot) => {
    const player = playerIndex(playerID);
    if (player === null || !setTurnCard(G, player, handIndex, slot)) return INVALID_MOVE;
  },
  undoSetCard: ({ G, playerID }, slot: SetSlot) => {
    const player = playerIndex(playerID);
    if (player === null || !undoSetCard(G, player, slot)) return INVALID_MOVE;
  },
  confirmReady: ({ G, playerID }) => {
    const player = playerIndex(playerID);
    if (player === null || !confirmReady(G, player, parsedEffects)) return INVALID_MOVE;
  },
  resolvePendingEffect: ({ G, playerID }, index: number) => {
    const player = playerIndex(playerID);
    if (player === null || !resolvePendingEffectChoice(G, player, index, parsedEffects)) return INVALID_MOVE;
  },
  submitPendingChoice: ({ G, playerID }, optionIds: string[]) => {
    const player = playerIndex(playerID);
    if (player === null || !submitPendingChoice(G, player, optionIds, parsedEffects)) return INVALID_MOVE;
  },
};

export const ZutomayoCard: Game<GameState, Record<string, unknown>, ZutomayoSetupData> = {
  name: 'zutomayo-card',
  validateSetupData: setupData => validateZutomayoSetupData(setupData),
  setup: (_context, setupData) => setupGame(setupData),
  playerView,
  moves,
  turn: {
    activePlayers: { all: 'simultaneous' },
    stages: { simultaneous: { moves } },
  },
  endIf: ({ G }) => {
    if (G.step !== 'gameOver') return;
    return G.winner === null ? { draw: true } : { winner: String(G.winner) };
  },
};

export function createZutomayoCard(
  defaultSetupData: ZutomayoSetupData = {},
): Game<GameState, Record<string, unknown>, ZutomayoSetupData> {
  return {
    ...ZutomayoCard,
    validateSetupData: setupData => validateZutomayoSetupData({
      deck0Name: setupData?.deck0Name ?? defaultSetupData.deck0Name,
      deck1Name: setupData?.deck1Name ?? defaultSetupData.deck1Name,
      deck0Ids: setupData?.deck0Ids ?? defaultSetupData.deck0Ids,
      deck1Ids: setupData?.deck1Ids ?? defaultSetupData.deck1Ids,
    }, { allowBrowserCustomDeckName: true }),
    setup: (_context, setupData) => setupGame({
      deck0Name: setupData?.deck0Name ?? defaultSetupData.deck0Name,
      deck1Name: setupData?.deck1Name ?? defaultSetupData.deck1Name,
      deck0Ids: setupData?.deck0Ids ?? defaultSetupData.deck0Ids,
      deck1Ids: setupData?.deck1Ids ?? defaultSetupData.deck1Ids,
    }, { allowBrowserCustomDeckName: true }),
  };
}
