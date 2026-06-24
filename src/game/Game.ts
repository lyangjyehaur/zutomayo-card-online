import { Game } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import type { GameState } from './types';
import { getAllCardDefs } from './cards/loader';
import { parseAllEffects } from './effects';
import type { ParsedEffect } from './effects';
import {
  setupGame,
  selectCard,
  revealCards,
  advanceChronos,
  swapCards,
  resolveBattle,
  endTurn,
  checkGameEnd,
} from './GameLogic';
import { processTurnEffects } from './effects/executor';

// Pre-parse all card effects at load time
const allCards = getAllCardDefs();
const parsedEffects: Map<string, ParsedEffect[]> = parseAllEffects(
  allCards.map(c => ({ id: c.id, effect: c.effect }))
);

export const ZutomayoCard: Game<GameState> = {
  name: 'zutomayo-card',

  setup: () => setupGame(),

  moves: {
    selectCard: ({ G, playerID }, handIndex: number, slot: 'A' | 'B') => {
      const idx = parseInt(playerID) as 0 | 1;
      if (!selectCard(G, idx, handIndex, slot)) {
        return INVALID_MOVE;
      }
    },

    confirmSet: ({ G, playerID }) => {
      const idx = parseInt(playerID) as 0 | 1;
      const player = G.players[idx];
      if (player.cardsSetThisTurn === 0) return INVALID_MOVE;
    },
  },

  turn: {
    minMoves: 1,
    maxMoves: 2,

    onBegin: ({ G }) => {
      G.players[0].cardsSetThisTurn = 0;
      G.players[1].cardsSetThisTurn = 0;
      G.setCardsThisTurn = { player0: [], player1: [] };
    },

    onEnd: ({ G }) => {
      // Phase pipeline: reveal → time → swap → effects → battle → end
      revealCards(G);
      advanceChronos(G);
      swapCards(G);
      processTurnEffects(G, parsedEffects);
      resolveBattle(G);
      endTurn(G);
    },
  },

  endIf: ({ G }) => {
    const result = checkGameEnd(G);
    if (result) return { winner: result };
  },
};
