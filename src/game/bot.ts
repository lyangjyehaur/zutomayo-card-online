import { INVALID_MOVE } from 'boardgame.io/core';
import type { GameState } from './types';
import { aiSelectCards, type AIDifficulty } from './ai';
import { getMaxSetCards } from './GameLogic';

// boardgame.io bot that plays automatically
export class ZutomayoBot {
  private difficulty: AIDifficulty;

  constructor(difficulty: AIDifficulty = 'normal') {
    this.difficulty = difficulty;
  }

  // Called by boardgame.io to get the bot's next move
  play(G: GameState, ctx: any): { action: string; args: any[] } | null {
    const playerID = ctx.currentPlayer;
    const playerIdx = parseInt(playerID) as 0 | 1;
    const player = G.players[playerIdx];

    const maxCards = getMaxSetCards(G, playerIdx);

    // If we haven't set enough cards yet, set more
    if (player.cardsSetThisTurn < maxCards) {
      const moves = aiSelectCards(G, playerIdx, this.difficulty);
      if (moves.length > 0) {
        const move = moves[player.cardsSetThisTurn];
        return { action: 'selectCard', args: [move.handIndex, move.slot] };
      }
    }

    // If we've set enough cards, confirm
    if (player.cardsSetThisTurn > 0) {
      return { action: 'confirmSet', args: [] };
    }

    // If hand is empty and can't do anything, confirm anyway
    return { action: 'confirmSet', args: [] };
  }
}
