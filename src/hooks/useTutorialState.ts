import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../game/types';
import type { TutorialEntrySnapshot, TutorialStep } from '../components/GameTutorialOverlay';

interface UseTutorialStateOptions {
  steps: TutorialStep[];
  gameState: GameState | null;
  onComplete: () => void;
}

function snapshot(G: GameState | null): TutorialEntrySnapshot | null {
  if (!G) return null;
  return {
    step: G.step,
    turnNumber: G.turnNumber,
  };
}

/**
 * 教學狀態引擎：以「完成條件」驅動推進。
 * - 導覽步驟（無 completeWhen）：由用戶手動點 Next 推進。
 * - 操作步驟（有 completeWhen）：偵測遊戲狀態變化，條件達成時自動推進。
 * - 條件式步驟（有 skipWhen）：進入時若 skipWhen 為 true 則自動跳過。
 *
 * 進入每個步驟時記錄遊戲狀態快照（entry），供 completeWhen 比對前後變化。
 */
export function useTutorialState({ steps, gameState, onComplete }: UseTutorialStateOptions) {
  const [currentStep, setCurrentStep] = useState(0);
  // 持續追蹤最新遊戲狀態，供步驟切換時立即取快照
  const gameRef = useRef<GameState | null>(gameState);
  // 進入當前步驟時的遊戲狀態快照
  const entryRef = useRef<TutorialEntrySnapshot | null>(snapshot(gameState));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    gameRef.current = gameState;
  }, [gameState]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const advance = useCallback(() => {
    clearTimer();
    setCurrentStep((prev) => {
      if (prev >= steps.length - 1) {
        onComplete();
        return prev;
      }
      // 切換步驟時立即以當下遊戲狀態建立新快照
      entryRef.current = snapshot(gameRef.current);
      return prev + 1;
    });
  }, [steps.length, onComplete, clearTimer]);

  const current = steps[currentStep];

  // 進入新步驟時：檢查 skipWhen（條件式步驟跳過）
  useEffect(() => {
    if (!current?.skipWhen) return;
    const G = gameRef.current;
    if (G && current.skipWhen(G)) {
      timerRef.current = setTimeout(() => advance(), 120);
      return () => clearTimer();
    }
    return undefined;
  }, [currentStep, current, advance, clearTimer]);

  // 偵測操作步驟完成條件
  useEffect(() => {
    if (!current?.completeWhen || !gameState) return;
    if (current.completeWhen(gameState, entryRef.current)) {
      // 短暫延遲讓用戶看到操作結果後再推進
      timerRef.current = setTimeout(() => advance(), 700);
      return () => clearTimer();
    }
    return undefined;
  }, [gameState, currentStep, current, advance, clearTimer]);

  const goNext = useCallback(() => {
    advance();
  }, [advance]);

  const goPrev = useCallback(() => {
    clearTimer();
    setCurrentStep((prev) => {
      const next = Math.max(0, prev - 1);
      entryRef.current = snapshot(gameRef.current);
      return next;
    });
  }, [clearTimer]);

  return {
    currentStep,
    goNext,
    goPrev,
  };
}
