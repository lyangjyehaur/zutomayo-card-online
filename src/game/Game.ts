import { Game } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import type { GameState } from './types';
import { getAllCardDefs } from './cards/loader';
import { parseAllEffects } from './effects';
import type { ParsedEffect } from './effects';
import type { JankenChoice } from './GameLogic';
import {
  setupGame,
  selectCard,
  revealCards,
  advanceChronos,
  swapCards,
  resolveBattle,
  endTurn,
  checkGameEnd,
  resolveJanken,
  mulligan,
  isSetupComplete,
} from './GameLogic';
import { processTurnEffects } from './effects/executor';

const allCards = getAllCardDefs();
const parsedEffects: Map<string, ParsedEffect[]> = parseAllEffects(
  allCards.map(c => ({ id: c.id, effect: c.effect }))
);

export const ZutomayoCard: Game<GameState> = {
  name: 'zutomayo-card',

  setup: () => setupGame(),

  moves: {
    // Janken (rock-paper-scissors)
    janken: ({ G, playerID }, choice: JankenChoice) => {
      const idx = parseInt(playerID) as 0 | 1;
      if (!G.jankenChoices) G.jankenChoices = [null, null];
      G.jankenChoices[idx] = choice;

      // If both chose, resolve
      if (G.jankenChoices[0] && G.jankenChoices[1]) {
        const result = resolveJanken(G, G.jankenChoices[0], G.jankenChoices[1]);
        if (result.winner === null) {
          // Draw — reset and try again
          G.jankenChoices = [null, null];
          G.log.push('Janken draw! Try again.');
        }
      }
    },

    // Mulligan
    mulligan: ({ G, playerID }, indicesToRedraw: number[]) => {
      const idx = parseInt(playerID) as 0 | 1;
      if (G.mulliganUsed?.[idx]) return INVALID_MOVE;
      mulligan(G, idx, indicesToRedraw);
    },

    // Skip mulligan
    keepHand: ({ G, playerID }) => {
      const idx = parseInt(playerID) as 0 | 1;
      if (G.mulliganUsed?.[idx]) return INVALID_MOVE;
      mulligan(G, idx, []);
    },

    // Select card during gameplay
    selectCard: ({ G, playerID }, handIndex: number, slot: 'A' | 'B') => {
      const idx = parseInt(playerID) as 0 | 1;
      if (!selectCard(G, idx, handIndex, slot)) return INVALID_MOVE;
    },

    // Confirm set
    confirmSet: ({ G, playerID }) => {
      const idx = parseInt(playerID) as 0 | 1;
      if (G.players[idx].cardsSetThisTurn === 0) return INVALID_MOVE;
    },
  },

  turn: {
    minMoves: 1,
    maxMoves: 2,

    onBegin: ({ G }) => {
      if (G.setupPhase === 'done') {
        G.players[0].cardsSetThisTurn = 0;
        G.players[1].cardsSetThisTurn = 0;
        G.setCardsThisTurn = { player0: [], player1: [] };
      }
    },

    onEnd: ({ G }) => {
      if (G.setupPhase !== 'done') return;

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
    if (G.setupPhase !== 'done') return;
    const result = checkGameEnd(G);
    if (result) return { winner: result };
  },
};
