import { useEffect, useRef } from 'react';
import type { Ctx } from 'boardgame.io';
import type { GameState, JankenChoice, PendingChoice, SetSlot } from './types';
import {
  aiPlanTurn,
  aiSelectEffect,
  aiSelectJanken,
  aiSelectMulligan,
  aiSelectPendingChoice,
  type AIDecision,
  type AIDifficulty,
  type AISelection,
} from './ai';
import { getMinimumSetCount, getRequiredSetCount } from './GameLogic';
import { defaultPendingChoiceOptionIds, pendingChoiceSelectionError } from './pendingChoices';

const AI_ACTION_DELAY_MS = 450;

function publishDecisionTrace(decision: AIDecision<unknown>): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('zutomayo:ai-decision', { detail: decision }));
}

// 為 AI 挑選合法的 pendingChoice option 組合。
// handAbyssSwap 必須含 1 個 hand: 與 1 個 abyss: option，否則 handler 判定 invalid。
// 其餘 type 取前 N 個（N = max(min, min(max,1))）。min > options.length 時回傳 null（引擎端不應建立此種 choice）。
function aiPickChoiceOptions(choice: PendingChoice): string[] | null {
  const fallback = defaultPendingChoiceOptionIds(choice);
  if (!fallback || fallback.length > 0 || choice.max === 0) return fallback;
  const optionalPick = choice.options[0]?.id ? [choice.options[0].id] : [];
  return pendingChoiceSelectionError(choice, optionalPick) ? fallback : optionalPick;
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
  mulligan: (indices: number[]) => void;
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
  fastMode?: boolean,
) {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePlan = useRef<{
    turnNumber: number;
    step: GameState['step'];
    selections: AISelection[];
    decisionToken: string;
  } | null>(null);
  const active = playerID === '1' && !!ctx && !ctx.gameover;

  useEffect(() => {
    // 教學導覽階段（aiPaused=true）暫停 AI，避免場地導覽時 AI 自動出拳/放置卡牌
    if (!active || !G || G.step === 'gameOver' || aiPaused) return;
    // Difficulty controls policy only. Presentation timing is a separate UX concern.
    const delay = fastMode ? 50 : tutorialMode ? 2000 : AI_ACTION_DELAY_MS;
    timeout.current = setTimeout(() => {
      const player = G.players[1];
      if (G.step === 'janken') {
        activePlan.current = null;
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
          const decision = aiSelectJanken(G, 1, difficulty);
          publishDecisionTrace(decision);
          moves.janken(decision.action);
        }
        return;
      }
      if (G.step === 'mulligan') {
        activePlan.current = null;
        if (!G.mulliganUsed[1]) {
          const decision = aiSelectMulligan(G, 1, difficulty);
          publishDecisionTrace(decision);
          moves.mulligan(decision.action);
        }
        return;
      }
      // 效果執行後可能產生 pendingChoice（如選擇手牌棄置），step 仍為 effectOrder
      // 但 pendingEffects 已清空，必須優先處理 pendingChoice 否則遊戲會卡死。
      if (G.pendingChoice && G.pendingChoice.player === 1) {
        activePlan.current = null;
        const choice = G.pendingChoice;
        // 教學腳本：用 defId 一對一匹配 option；不合法時 fallback 到通用選擇。
        const scriptedDefIds = aiScript?.pendingChoiceDefIdsByTurn?.[G.turnNumber];
        const scriptedIds = scriptedDefIds ? aiChoiceOptionIds(choice, scriptedDefIds) : null;
        const decision = scriptedIds ? null : aiSelectPendingChoice(G, 1, difficulty);
        if (decision) publishDecisionTrace(decision);
        const ids = scriptedIds ?? decision?.action ?? aiChoiceOptionIds(choice);
        if (ids) moves.submitPendingChoice(ids);
        return;
      }
      if (G.step === 'effectOrder') {
        activePlan.current = null;
        if (G.pendingEffectPlayer === 1 && G.pendingEffects[1].length > 0) {
          // 教學腳本：指定效果解決順序；未指定時預設 index 0
          const scriptedOrder = aiScript?.effectOrderByTurn?.[G.turnNumber];
          // 已解決的效果數 = 原始數量 - 當前剩餘；用此作為腳本陣列的推進 index
          // 但腳本 index 是相對於「當前 pendingEffects」的位置，直接取第一個有效 index
          const decision = scriptedOrder && scriptedOrder.length > 0 ? null : aiSelectEffect(G, 1, difficulty);
          if (decision) publishDecisionTrace(decision);
          const idx = scriptedOrder && scriptedOrder.length > 0 ? scriptedOrder[0] : (decision?.action ?? 0);
          const safeIdx = Math.min(idx, G.pendingEffects[1].length - 1);
          moves.resolvePendingEffect(safeIdx);
        }
        return;
      }
      if (G.step !== 'initialSet' && G.step !== 'turnSet') return;
      const minimum = getMinimumSetCount(G, 1);
      const required = getRequiredSetCount(G, 1);
      if (G.ready[1]) {
        activePlan.current = null;
        return;
      }
      // 教學腳本：用 defId 指定要出的卡，依序設定
      const scriptedSetCards = aiScript?.setCardsByTurn?.[G.turnNumber];
      const cardToSet = scriptedSetCards?.[player.cardsSetThisTurn];
      if (cardToSet) {
        activePlan.current = null;
        const handIndex = player.hand.findIndex((c) => c.defId === cardToSet.defId);
        if (handIndex >= 0) {
          if (G.step === 'initialSet') moves.setInitialCard(handIndex);
          else moves.setTurnCard(handIndex, cardToSet.slot);
          return;
        }
        // 腳本指定的卡不在手牌（已被出或不存在），fallback 到 AI 策略
      }
      if (player.cardsSetThisTurn >= minimum && player.cardsSetThisTurn <= required) {
        const plan = activePlan.current;
        const planMatchesTurn = plan?.turnNumber === G.turnNumber && plan.step === G.step;
        const remainingPlannedCard =
          planMatchesTurn &&
          plan.selections.some((selection) => player.hand.some((card) => card.instanceId === selection.cardInstanceId));
        if (planMatchesTurn && !remainingPlannedCard) {
          activePlan.current = null;
          moves.confirmReady();
          return;
        }
      }
      // 空手時無法出牌，規則允許直接 confirmReady，避免永久卡死。
      if (player.hand.length === 0) {
        activePlan.current = null;
        moves.confirmReady();
        return;
      }
      let plan = activePlan.current;
      if (!plan || plan.turnNumber !== G.turnNumber || plan.step !== G.step) {
        const decision = aiPlanTurn(G, 1, difficulty);
        publishDecisionTrace(decision);
        plan = {
          turnNumber: G.turnNumber,
          step: G.step,
          selections: decision.action.selections,
          decisionToken: decision.action.decisionToken,
        };
        activePlan.current = plan;
      }
      const next = plan.selections.find((selection) =>
        player.hand.some((card) => card.instanceId === selection.cardInstanceId),
      );
      if (!next) {
        activePlan.current = null;
        if (player.cardsSetThisTurn >= minimum) moves.confirmReady();
        return;
      }
      const handIndex = player.hand.findIndex((card) => card.instanceId === next.cardInstanceId);
      if (handIndex < 0) {
        activePlan.current = null;
        return;
      }
      if (G.step === 'initialSet') moves.setInitialCard(handIndex);
      else moves.setTurnCard(handIndex, next.slot);
    }, delay);
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [G, ctx, moves, active, difficulty, tutorialMode, aiPaused, aiScript, fastMode]);

  return active;
}
