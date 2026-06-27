import { useEffect, useRef } from 'react';
import type { Ctx } from 'boardgame.io';
import type { GameState, JankenChoice, SetSlot } from './types';
import { aiSelectCards, type AIDifficulty } from './ai';
import { getMinimumSetCount, getRequiredSetCount } from './GameLogic';

export interface ZutomayoMoveDispatchers {
  janken: (choice: JankenChoice) => void;
  keepHand: () => void;
  setInitialCard: (handIndex: number) => void;
  setTurnCard: (handIndex: number, slot: SetSlot) => void;
  confirmReady: () => void;
  resolvePendingEffect: (index: number) => void;
}

export function useAIMoves(
  G: GameState | null,
  ctx: Ctx | null,
  moves: ZutomayoMoveDispatchers,
  playerID: string,
  difficulty: AIDifficulty,
) {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = playerID === '1' && !!ctx && !ctx.gameover;

  useEffect(() => {
    if (!active || !G || G.step === 'gameOver') return;
    const delay = difficulty === 'easy' ? 700 : difficulty === 'normal' ? 450 : 250;
    timeout.current = setTimeout(() => {
      const player = G.players[1];
      if (G.step === 'janken') {
        if (!G.jankenChoices[1]) moves.janken('scissors');
        return;
      }
      if (G.step === 'mulligan') {
        if (!G.mulliganUsed[1]) moves.keepHand();
        return;
      }
      if (G.step === 'effectOrder') {
        if (G.pendingEffectPlayer === 1 && G.pendingEffects[1].length > 0) {
          moves.resolvePendingEffect(0);
        }
        return;
      }
      if (G.step !== 'initialSet' && G.step !== 'turnSet') return;
      const minimum = getMinimumSetCount(G, 1);
      const required = getRequiredSetCount(G, 1);
      if (G.ready[1]) return;
      if (player.cardsSetThisTurn >= minimum && player.cardsSetThisTurn <= required) {
        moves.confirmReady();
        return;
      }
      if (player.hand.length === 0) return;
      const choice = aiSelectCards(G, 1, difficulty)[0];
      const handIndex = choice?.handIndex ?? 0;
      if (G.step === 'initialSet') moves.setInitialCard(handIndex);
      else moves.setTurnCard(handIndex, player.setZoneA ? 'B' : 'A');
    }, delay);
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [G, ctx, moves, active, difficulty]);

  return active;
}
