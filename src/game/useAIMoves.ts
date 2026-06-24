import { useEffect, useRef, useCallback } from 'react';
import type { GameState } from '../game/types';
import { aiSelectCards, type AIDifficulty } from '../game/ai';
import { getMaxSetCards } from '../game/GameLogic';

// Hook to run AI moves on a boardgame.io client
export function useAIMoves(
  G: GameState | null,
  ctx: any,
  moves: any,
  playerID: string,
  difficulty: AIDifficulty
) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isAITurn = playerID === '1' && ctx && !ctx.gameover;

  useEffect(() => {
    if (!isAITurn || !G) return;

    // Small delay to make AI feel natural
    const delay = difficulty === 'easy' ? 1500 : difficulty === 'normal' ? 1000 : 500;

    timeoutRef.current = setTimeout(() => {
      const playerIdx = 1;
      const player = G.players[playerIdx];
      const maxCards = getMaxSetCards(G, playerIdx);

      if (player.cardsSetThisTurn < maxCards && player.hand.length > 0) {
        const aiMoves = aiSelectCards(G, playerIdx, difficulty);
        if (aiMoves.length > player.cardsSetThisTurn) {
          const move = aiMoves[player.cardsSetThisTurn];
          moves.selectCard(move.handIndex, move.slot);
        }
      } else if (player.cardsSetThisTurn > 0) {
        moves.confirmSet();
      } else {
        // No cards, just confirm
        moves.confirmSet();
      }
    }, delay);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [G, ctx, moves, isAITurn, difficulty]);

  return isAITurn;
}
