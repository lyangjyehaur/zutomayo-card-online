import { useEffect, useRef } from 'react';
import type { Ctx } from 'boardgame.io';
import type { GameState, JankenChoice, PendingChoice, SetSlot } from './types';
import { aiSelectCards, type AIDifficulty } from './ai';
import { getMinimumSetCount, getRequiredSetCount } from './GameLogic';
import { pendingChoiceSelectionError } from './pendingChoices';

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

/**
 * 教學腳本先依 defId 一對一消費 option，避免同名卡一次展開成多個 id 超過 max；
 * 腳本不完整或不合法時退回通用 AI 選擇，避免重複提交 INVALID_MOVE 卡死效果流程。
 */
export function aiChoiceOptionIds(choice: PendingChoice, scriptedDefIds?: string[]): string[] | null {
  if (scriptedDefIds && scriptedDefIds.length > 0) {
    const remaining = [...choice.options];
    const scriptedIds: string[] = [];
    for (const defId of scriptedDefIds) {
      const index = remaining.findIndex((option) => option.cardDefId === defId);
      if (index < 0) continue;
      scriptedIds.push(remaining[index].id);
      remaining.splice(index, 1);
    }
    if (!pendingChoiceSelectionError(choice, scriptedIds)) return scriptedIds;
  }
  const fallback = aiPickChoiceOptions(choice);
  return fallback && !pendingChoiceSelectionError(choice, fallback) ? fallback : null;
}

/**
 * 教學模式 AI 腳本：覆寫 AI 的隨機決策，讓固定劇本的每一步都可預測。
 *
 * - janken：猜拳出什麼（教學劇本可確保玩家贏）
 * - setCardsByTurn：以 turnNumber 為 key，列出該回合 AI 要依序設定的卡（用 defId 指定，
 *   腳本會在當前手牌中查找對應 index；slot 指定 A/B）
 * - effectOrderByTurn：該回合效果解決順序（pendingEffects 陣列中的 index，依序執行；
 *   未指定時預設 index 0）
 * - pendingChoiceDefIdsByTurn：該回合 pendingChoice 要選的卡（用 defId 匹配 option）
 */
export interface TutorialAIScript {
  setCardsByTurn?: Record<number, { defId: string; slot: SetSlot }[]>;
  effectOrderByTurn?: Record<number, number[]>;
  pendingChoiceDefIdsByTurn?: Record<number, string[]>;
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
  aiPaused?: boolean,
  aiScript?: TutorialAIScript,
) {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = playerID === '1' && !!ctx && !ctx.gameover;

  useEffect(() => {
    // 教學導覽階段（aiPaused=true）暫停 AI，避免場地導覽時 AI 自動出拳/放置卡牌
    if (!active || !G || G.step === 'gameOver' || aiPaused) return;
    // Tutorial mode: longer delays to give user time to read
    const baseDelay = difficulty === 'easy' ? 700 : difficulty === 'normal' ? 450 : 250;
    const delay = tutorialMode ? Math.max(baseDelay, 2000) : baseDelay;
    timeout.current = setTimeout(() => {
      const player = G.players[1];
      if (G.step === 'janken') {
        if (G.jankenChoices[1]) return;
        // 教學模式：等玩家出拳後，AI 出會輸的拳，確保玩家不管出什麼都贏
        if (aiScript) {
          if (!G.jankenChoices[0]) return; // 等玩家先出
          const beats: Record<JankenChoice, JankenChoice> = {
            rock: 'scissors',
            paper: 'rock',
            scissors: 'paper',
          };
          moves.janken(beats[G.jankenChoices[0] as JankenChoice]);
        } else {
          const choices: JankenChoice[] = ['rock', 'paper', 'scissors'];
          moves.janken(choices[Math.floor(Math.random() * 3)]);
        }
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
        // 教學腳本：用 defId 一對一匹配 option；不合法時 fallback 到通用選擇。
        const scriptedDefIds = aiScript?.pendingChoiceDefIdsByTurn?.[G.turnNumber];
        const ids = aiChoiceOptionIds(choice, scriptedDefIds);
        if (ids) moves.submitPendingChoice(ids);
        return;
      }
      if (G.step === 'effectOrder') {
        if (G.pendingEffectPlayer === 1 && G.pendingEffects[1].length > 0) {
          // 教學腳本：指定效果解決順序；未指定時預設 index 0
          const scriptedOrder = aiScript?.effectOrderByTurn?.[G.turnNumber];
          // 已解決的效果數 = 原始數量 - 當前剩餘；用此作為腳本陣列的推進 index
          // 但腳本 index 是相對於「當前 pendingEffects」的位置，直接取第一個有效 index
          const idx = scriptedOrder && scriptedOrder.length > 0 ? scriptedOrder[0] : 0;
          const safeIdx = Math.min(idx, G.pendingEffects[1].length - 1);
          moves.resolvePendingEffect(safeIdx);
        }
        return;
      }
      if (G.step !== 'initialSet' && G.step !== 'turnSet') return;
      const minimum = getMinimumSetCount(G, 1);
      const required = getRequiredSetCount(G, 1);
      if (G.ready[1]) return;
      // 教學腳本：用 defId 指定要出的卡，依序設定
      const scriptedSetCards = aiScript?.setCardsByTurn?.[G.turnNumber];
      const cardToSet = scriptedSetCards?.[player.cardsSetThisTurn];
      if (cardToSet) {
        const handIndex = player.hand.findIndex((c) => c.defId === cardToSet.defId);
        if (handIndex >= 0) {
          if (G.step === 'initialSet') moves.setInitialCard(handIndex);
          else moves.setTurnCard(handIndex, cardToSet.slot);
          return;
        }
        // 腳本指定的卡不在手牌（已被出或不存在），fallback 到 AI 策略
      }
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
  }, [G, ctx, moves, active, difficulty, tutorialMode, aiPaused, aiScript]);

  return active;
}
