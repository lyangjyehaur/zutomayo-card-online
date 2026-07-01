import { useState, useEffect, useCallback } from 'react';
import type { GameState } from '../game/types';
import type { TutorialStep } from '../components/GameTutorialOverlay';

interface UseTutorialStateOptions {
  steps: TutorialStep[];
  gameState: GameState | null;
  onComplete: () => void;
}

interface TutorialState {
  currentStep: number;
  userHasActed: boolean;
  isWaitingForGame: boolean;
}

export function useTutorialState({ steps, gameState, onComplete }: UseTutorialStateOptions) {
  const [state, setState] = useState<TutorialState>({
    currentStep: 0,
    userHasActed: false,
    isWaitingForGame: false,
  });

  const current = steps[state.currentStep];

  // Auto-advance when game phase matches expected phase
  useEffect(() => {
    if (!gameState || !current.waitForGamePhase) return;

    if (gameState.step === current.waitForGamePhase && !current.waitForUserAction) {
      setState((prev) => ({ ...prev, isWaitingForGame: false }));
      // Auto-advance after a short delay to let user see the transition
      const timer = setTimeout(() => {
        if (state.currentStep < steps.length - 1) {
          setState((prev) => ({
            currentStep: prev.currentStep + 1,
            userHasActed: false,
            isWaitingForGame: true,
          }));
        }
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [gameState?.step, current.waitForGamePhase, current.waitForUserAction, state.currentStep, steps.length]);

  // Mark when waiting for specific game phase
  useEffect(() => {
    if (current.waitForGamePhase && gameState?.step !== current.waitForGamePhase) {
      setState((prev) => ({ ...prev, isWaitingForGame: true }));
    }
  }, [current.waitForGamePhase, gameState?.step]);

  const goNext = useCallback(() => {
    if (state.currentStep >= steps.length - 1) {
      onComplete();
      return;
    }

    setState((prev) => ({
      currentStep: prev.currentStep + 1,
      userHasActed: false,
      isWaitingForGame: !!steps[prev.currentStep + 1]?.waitForGamePhase,
    }));
  }, [state.currentStep, steps.length, steps, onComplete]);

  const goPrev = useCallback(() => {
    if (state.currentStep <= 0) return;

    setState((prev) => ({
      currentStep: prev.currentStep - 1,
      userHasActed: false,
      isWaitingForGame: !!steps[prev.currentStep - 1]?.waitForGamePhase,
    }));
  }, [state.currentStep, steps]);

  const markUserAction = useCallback(() => {
    setState((prev) => ({ ...prev, userHasActed: true }));
  }, []);

  return {
    currentStep: state.currentStep,
    isWaitingForGame: state.isWaitingForGame,
    userHasActed: state.userHasActed,
    goNext,
    goPrev,
    markUserAction,
  };
}
