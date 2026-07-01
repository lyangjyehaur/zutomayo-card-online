import { useEffect, useRef } from 'react';
import type { Ctx } from 'boardgame.io';
import type { GameState, JankenChoice, PendingChoice, SetSlot } from './types';
import { aiSelectCards, type AIDifficulty } from './ai';
import { getMinimumSetCount, getRequiredSetCount } from './GameLogic';

// 為 AI 挑選合法的 pendingChoice option 組合。
// handAbyssSwap 必須含 1 個 hand: 與 1 個 abyss: option，否則 handler 判定 invalid。
// 其餘 type 取前 N 個（N = max(min, min(max,1))）。min > options.length 時回傳 null（引擎端不應建立此種 choice）。
function aiPickChoiceOptions(choice: PendingChoice): string[] | null {
  if (choice.type === 'handAbyssSwap') {
    const hand = choice.options.find((option) => option.id.startsWith('hand:'));
    const abyss = choice.options.find((option) => option.id.startsWith('abyss:'));
    if (!hand || !abyss) return null;
    return [hand.id, abyss.id];
  }
  if (choice.min > choice.options.length) return null;
  const want = Math.max(choice.min, Math.min(choice.max, 1));
  const count = Math.min(want, choice.options.length);
  return choice.options.slice(0, count).map((option) => option.id);
}

export interface ZutomayoMoveDispatchers {
  janken: (choice: JankenChoice) => void;
  keepHand: () => void;
  setInitialCard: (handIndex: number) => void;
  setTurnCard: (handIndex: number, slot: SetSlot) => void;
  confirmReady: () => void;
  resolvePendingEffect: (index: number) => void;
  submitPendingChoice: (optionIds: string[]) => void;
}

export function useAIMoves(
  G: GameState | null,
  ctx: Ctx | null,
  moves: ZutomayoMoveDispatchers,
  playerID: string,
  difficulty: AIDifficulty,
  tutorialMode?: boolean,
) {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = playerID === '1' && !!ctx && !ctx.gameover;

  useEffect(() => {
    if (!active || !G || G.step === 'gameOver') return;
    // Tutorial mode: longer delays to give user time to read
    const baseDelay = difficulty === 'easy' ? 700 : difficulty === 'normal' ? 450 : 250;
    const delay = tutorialMode ? Math.max(baseDelay, 2000) : baseDelay;
    timeout.current = setTimeout(() => {
      const player = G.players[1];
      if (G.step === 'janken') {
        const choices: JankenChoice[] = ['rock', 'paper', 'scissors'];
        if (!G.jankenChoices[1]) moves.janken(choices[Math.floor(Math.random() * 3)]);
        return;
      }
      if (G.step === 'mulligan') {
        if (!G.mulliganUsed[1]) moves.keepHand();
        return;
      }
      // 效果執行後可能產生 pendingChoice（如選擇手牌棄置），step 仍為 effectOrder
      // 但 pendingEffects 已清空，必須優先處理 pendingChoice 否則遊戲會卡死。
      if (G.pendingChoice && G.pendingChoice.player === 1) {
        const choice = G.pendingChoice;
        // 依 choice type 挑選合法組合（handAbyssSwap 需混合 hand/abyss；其餘取前 N 個）。
        const ids = aiPickChoiceOptions(choice);
        if (ids) moves.submitPendingChoice(ids);
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
      // 空手時無法出牌，規則允許直接 confirmReady，避免永久卡死。
      if (player.hand.length === 0) {
        moves.confirmReady();
        return;
      }
      const choice = aiSelectCards(G, 1, difficulty)[0];
      const handIndex = choice?.handIndex ?? 0;
      if (G.step === 'initialSet') moves.setInitialCard(handIndex);
      else moves.setTurnCard(handIndex, player.setZoneA ? 'B' : 'A');
    }, delay);
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [G, ctx, moves, active, difficulty, tutorialMode]);

  return active;
}
