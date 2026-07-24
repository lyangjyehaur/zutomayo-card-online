import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AIGame } from '../components/AIGame';
import type { TutorialBoardAction } from '../components/Board';
import { GameTutorialOverlay } from '../components/GameTutorialOverlay';
import { markTutorialChapterComplete, TutorialChapterHub } from '../components/TutorialChapterHub';
import { Alert, Button, Dialog, LoadingState, PageShell } from '../ui';
import { useTutorialState } from '../hooks/useTutorialState';
import { TUTORIAL_STEPS } from '../data/tutorialSteps';
import { TUTORIAL_DECK0_IDS, TUTORIAL_DECK1_IDS, TUTORIAL_AI_SCRIPT } from '../data/tutorialScenario';
import {
  buildTutorialPresentationState,
  captureTutorialPresentationSnapshots,
  EMPTY_TUTORIAL_PRESENTATION_SNAPSHOTS,
  type TutorialPresentationSnapshots,
} from '../data/tutorialPresentation';
import type { GameState } from '../game/types';
import { t } from '../i18n';
import { trackFunnelEvent } from '../funnelAnalytics';
import '../components/GameTutorialOverlay.css';

interface TutorialGamePageProps {
  cardsReady: boolean;
  cardsLoadError?: boolean;
  onRetryCards?: () => void | Promise<void>;
}

type TutorialCheckpoint = 'preparation' | 'flow' | 'turn2' | 'effects';

const TUTORIAL_CHECKPOINT_STEP_INDEXES: Record<TutorialCheckpoint, number> = {
  preparation: TUTORIAL_STEPS.findIndex((step) => step.phase === 'janken'),
  flow: TUTORIAL_STEPS.findIndex((step) => step.phase === 'flow-recap'),
  turn2: TUTORIAL_STEPS.findIndex((step) => step.phase === 'turnSet-character-select'),
  effects: TUTORIAL_STEPS.findIndex((step) => step.phase === 'effectOrder-action'),
};

const SECOND_HP_CALC_STEP_INDEX = TUTORIAL_STEPS.map((step) => step.phase).lastIndexOf('hp-calc');

export function TutorialGamePage(props: TutorialGamePageProps) {
  const navigate = useNavigate();
  const nextSessionIdRef = useRef(1);
  const [view, setView] = useState<'hub' | 'battle'>('hub');
  const [battleSession, setBattleSession] = useState<{
    id: number;
    preparationReady: boolean;
    stopAfterPreparation: boolean;
    startAtFlow: boolean;
  } | null>(null);

  const startBattle = (chapter: 'preparation' | 'flow') => {
    if (chapter === 'flow' && battleSession?.preparationReady) {
      setBattleSession((current) => (current ? { ...current, stopAfterPreparation: false } : current));
      setView('battle');
      return;
    }
    setBattleSession({
      id: nextSessionIdRef.current++,
      preparationReady: false,
      stopAfterPreparation: chapter === 'preparation',
      startAtFlow: chapter === 'flow',
    });
    setView('battle');
  };

  return (
    <>
      {view === 'hub' && (
        <TutorialChapterHub
          initialChapter={battleSession?.preparationReady ? 'flow' : undefined}
          onStartBattle={startBattle}
          onExit={() => navigate('/')}
        />
      )}
      {battleSession && (
        <div className={view === 'battle' ? 'contents' : 'hidden'} aria-hidden={view !== 'battle' || undefined}>
          <TutorialBattle
            key={battleSession.id}
            {...props}
            stopAfterPreparation={battleSession.stopAfterPreparation}
            startAtFlow={battleSession.startAtFlow}
            onPreparationReturn={() => {
              setBattleSession((current) => (current ? { ...current, preparationReady: true } : current));
              setView('hub');
            }}
            onExit={() => {
              setBattleSession(null);
              setView('hub');
            }}
            onComplete={() => {
              markTutorialChapterComplete('flow');
              setBattleSession(null);
              setView('hub');
            }}
          />
        </div>
      )}
    </>
  );
}

function TutorialBattle({
  cardsReady,
  cardsLoadError,
  onRetryCards,
  stopAfterPreparation,
  startAtFlow,
  onPreparationReturn,
  onExit,
  onComplete,
}: TutorialGamePageProps & {
  stopAfterPreparation: boolean;
  startAtFlow: boolean;
  onPreparationReturn: () => void;
  onExit: () => void;
  onComplete: () => void;
}) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [presentationSnapshots, setPresentationSnapshots] = useState<TutorialPresentationSnapshots>(
    EMPTY_TUTORIAL_PRESENTATION_SNAPSHOTS,
  );
  const [gameSessionId, setGameSessionId] = useState(0);
  const [replayTarget, setReplayTarget] = useState<Exclude<TutorialCheckpoint, 'preparation'> | null>(
    startAtFlow ? 'flow' : null,
  );
  const [replayReady, setReplayReady] = useState(!startAtFlow);
  const [skipPromptOpen, setSkipPromptOpen] = useState(false);
  const [preparationPromptOpen, setPreparationPromptOpen] = useState(false);
  const [rewindCheckpoint, setRewindCheckpoint] = useState<TutorialCheckpoint | null>(null);
  const [tutorialFinished, setTutorialFinished] = useState(false);
  const tutorialStartedAtRef = useRef(Date.now());
  const tutorialOutcomeRef = useRef<'active' | 'complete' | 'exit'>('active');
  const firstActionTrackedRef = useRef(false);
  const flowStartStepIndex = TUTORIAL_STEPS.findIndex((step) => step.chapter === 'flow');

  const recordTutorialCompletion = useCallback(() => {
    if (tutorialOutcomeRef.current !== 'complete') {
      tutorialOutcomeRef.current = 'complete';
      trackFunnelEvent('F_Tutorial_Complete', {
        elapsed_s: Math.round((Date.now() - tutorialStartedAtRef.current) / 1_000),
        total_steps: TUTORIAL_STEPS.length,
      });
    }
  }, []);

  const completeTutorial = useCallback(() => {
    recordTutorialCompletion();
    onComplete();
  }, [onComplete, recordTutorialCompletion]);

  const continueTutorialBattle = useCallback(() => {
    recordTutorialCompletion();
    markTutorialChapterComplete('flow');
    setTutorialFinished(true);
  }, [recordTutorialCompletion]);

  const { currentStep, goNext, goPrevious, resetToStep } = useTutorialState({
    steps: TUTORIAL_STEPS,
    gameState,
    onComplete: completeTutorial,
    initialStep: startAtFlow && flowStartStepIndex >= 0 ? flowStartStepIndex : 0,
  });

  const initialSetStepIndex = TUTORIAL_STEPS.findIndex((step) => step.phase === 'initialSet-confirm');
  const preparationCompletedRef = useRef(false);

  useEffect(() => {
    if (!replayTarget || !gameState) return;
    const ready =
      replayTarget === 'effects'
        ? gameState.step === 'effectOrder' &&
          gameState.pendingEffectPlayer === 0 &&
          gameState.pendingEffects[0].length > 0
        : gameState.step === 'turnSet' && gameState.turnNumber >= 2;
    if (!ready) return;
    const targetStep = TUTORIAL_CHECKPOINT_STEP_INDEXES[replayTarget];
    if (targetStep >= 0) resetToStep(targetStep);
    setReplayReady(true);
    setReplayTarget(null);
  }, [gameState, replayTarget, resetToStep]);

  useEffect(() => {
    if (
      preparationCompletedRef.current ||
      initialSetStepIndex === -1 ||
      currentStep < initialSetStepIndex ||
      !gameState ||
      !['turnSet', 'effectOrder', 'gameOver'].includes(gameState.step)
    ) {
      return;
    }
    preparationCompletedRef.current = true;
    if (!startAtFlow) markTutorialChapterComplete('preparation');
    if (stopAfterPreparation) setPreparationPromptOpen(true);
  }, [currentStep, gameState, initialSetStepIndex, startAtFlow, stopAfterPreparation]);

  useEffect(() => {
    const startedAt = tutorialStartedAtRef.current;
    trackFunnelEvent('F_Tutorial_Start', { total_steps: TUTORIAL_STEPS.length });
    return () => {
      if (tutorialOutcomeRef.current !== 'active') return;
      tutorialOutcomeRef.current = 'exit';
      trackFunnelEvent('F_Tutorial_Exit', {
        reason: 'route_exit',
        elapsed_s: Math.round((Date.now() - startedAt) / 1_000),
      });
    };
  }, []);

  useEffect(() => {
    const step = TUTORIAL_STEPS[currentStep];
    if (!step) return;
    trackFunnelEvent('F_Tutorial_Step', {
      step: currentStep + 1,
      total_steps: TUTORIAL_STEPS.length,
      phase: step.phase,
    });
    const firstActionStep = TUTORIAL_STEPS.findIndex((item) => Boolean(item.completeWhen));
    if (!firstActionTrackedRef.current && firstActionStep >= 0 && currentStep > firstActionStep) {
      firstActionTrackedRef.current = true;
      trackFunnelEvent('F_Tutorial_First_Action', {
        step: firstActionStep + 1,
        phase: TUTORIAL_STEPS[firstActionStep].phase,
        elapsed_s: Math.round((Date.now() - tutorialStartedAtRef.current) / 1_000),
      });
    }
  }, [currentStep]);

  // 教學步驟尚未進入 janken 時隱藏遊戲自己的 setup 浮層，避免與引導遮罩搶先出現。
  const jankenStepIndex = TUTORIAL_STEPS.findIndex((s) => s.phase === 'janken');
  const hideSetupOverlay = jankenStepIndex === -1 || currentStep < jankenStepIndex;
  // 進到 janken 步驟才恢復 AI，讓 completeWhen 以玩家的真實操作推進。
  const aiPaused = jankenStepIndex === -1 || currentStep < jankenStepIndex;

  // 猜拳結果彈窗的確認按鈕點擊時，若教學正在 janken-result 步驟，自動推進到下一步
  const jankenResultStepIndex = TUTORIAL_STEPS.findIndex((s) => s.phase === 'janken-result');
  const handleSetupFeedbackDismiss = useCallback(() => {
    if (currentStep === jankenResultStepIndex) {
      goNext();
    }
  }, [currentStep, jankenResultStepIndex, goNext]);

  // 時鐘推進/HP 計算彈窗的確認按鈕點擊時，若教學正在對應步驟，自動推進到下一步。
  // 用 advanceOnNoticeDismiss 旗標判斷，支援多回合重複步驟（T1/T2 各一次 clock-advance/hp-calc）。
  const handleNoticeDismiss = useCallback(() => {
    const step = TUTORIAL_STEPS[currentStep];
    if (step?.advanceOnNoticeDismiss) {
      goNext();
    }
  }, [currentStep, goNext]);

  const handleTutorialAction = useCallback(
    (action: TutorialBoardAction, cardDefId: string) => {
      const phase = TUTORIAL_STEPS[currentStep]?.phase;
      const expected =
        (phase === 'opening-hand' && action === 'mulligan-select' && cardDefId === '1st_2') ||
        (phase === 'initialSet-select' && action === 'set-select' && cardDefId === '1st_70') ||
        (phase === 'initialSet-place' && action === 'set-play' && cardDefId === '1st_70') ||
        (phase === 'turnSet-character-select' && action === 'set-select' && cardDefId === '1st_46') ||
        (phase === 'turnSet-character-place' && action === 'set-play' && cardDefId === '1st_46') ||
        (phase === 'turnSet-area-select' && action === 'set-select' && cardDefId === '2nd_98') ||
        (phase === 'turnSet-area-place' && action === 'set-play' && cardDefId === '2nd_98');
      if (expected) goNext();
    },
    [currentStep, goNext],
  );

  const handleGameStateChange = useCallback((state: GameState) => {
    setGameState(state);
    setPresentationSnapshots((current) => captureTutorialPresentationSnapshots(current, state));
  }, []);

  const handleSkip = () => {
    setSkipPromptOpen(true);
  };

  const restartAtCheckpoint = (checkpoint: TutorialCheckpoint) => {
    const targetStep = TUTORIAL_CHECKPOINT_STEP_INDEXES[checkpoint];
    if (targetStep < 0) return;
    setRewindCheckpoint(null);
    setPreparationPromptOpen(false);
    if (checkpoint === 'preparation') preparationCompletedRef.current = false;
    setGameState(null);
    setPresentationSnapshots(EMPTY_TUTORIAL_PRESENTATION_SNAPSHOTS);
    resetToStep(targetStep);
    setReplayReady(checkpoint === 'preparation');
    setReplayTarget(checkpoint === 'preparation' ? null : checkpoint);
    setGameSessionId((session) => session + 1);
  };

  const handlePrevious = () => {
    const behavior = TUTORIAL_STEPS[currentStep]?.backBehavior;
    if (!behavior) return;
    if (behavior.type === 'direct') {
      goPrevious();
      return;
    }
    setRewindCheckpoint(behavior.checkpoint);
  };

  const exitTutorial = (reason: 'route_exit' | 'back' | 'skip') => {
    if (tutorialOutcomeRef.current === 'active') {
      tutorialOutcomeRef.current = 'exit';
      trackFunnelEvent('F_Tutorial_Exit', {
        reason,
        elapsed_s: Math.round((Date.now() - tutorialStartedAtRef.current) / 1_000),
      });
    }
    onExit();
  };

  const activeStep = TUTORIAL_STEPS[currentStep];
  const activePhase = activeStep?.phase ?? '';
  const tutorialPresentationState = useMemo(
    () =>
      buildTutorialPresentationState({
        authoritative: gameState,
        snapshots: presentationSnapshots,
        phase: activePhase,
        secondHpCalculation: currentStep === SECOND_HP_CALC_STEP_INDEX,
      }),
    [activePhase, currentStep, gameState, presentationSnapshots],
  );
  const autoPreparing = Boolean(replayTarget) && !replayReady;
  const tutorialAllowedSetCards = activePhase.startsWith('initialSet')
    ? activePhase === 'initialSet-confirm'
      ? []
      : ['1st_70']
    : activePhase.startsWith('turnSet-character')
      ? ['1st_46']
      : activePhase.startsWith('turnSet-area')
        ? ['2nd_98']
        : activePhase === 'turnSet-confirm'
          ? []
          : undefined;
  const tutorialRequiredSetCards =
    gameState?.step === 'initialSet' ? ['1st_70'] : gameState?.step === 'turnSet' ? ['1st_46', '2nd_98'] : undefined;
  const tutorialSetInteractionEnabled = activePhase.startsWith('initialSet') || activePhase.startsWith('turnSet-');

  // 卡牌未載入時顯示 loading，避免 AIGame 用空牌組崩潰
  if (!cardsReady) {
    return (
      <PageShell className="grid place-items-center px-4">
        {cardsLoadError ? (
          <Alert className="w-full max-w-sm" tone="danger" role="alert">
            <div className="grid gap-4">
              <span>{t('game.cardsUnavailable')}</span>
              <Button type="button" variant="secondary" onClick={() => void onRetryCards?.()}>
                {t('common.retry')}
              </Button>
            </div>
          </Alert>
        ) : (
          <LoadingState label={t('game.loading')} className="w-full max-w-sm" />
        )}
      </PageShell>
    );
  }

  return (
    <>
      <div className={autoPreparing ? 'hidden' : 'contents'} aria-hidden={autoPreparing || undefined}>
        <AIGame
          key={gameSessionId}
          difficulty="easy"
          deck0Ids={TUTORIAL_DECK0_IDS}
          deck1Ids={TUTORIAL_DECK1_IDS}
          skipShuffle
          aiScript={tutorialFinished ? undefined : TUTORIAL_AI_SCRIPT}
          onBack={() => exitTutorial('back')}
          onGameStateChange={handleGameStateChange}
          tutorialMode={!tutorialFinished}
          hideSetupOverlay={!tutorialFinished && (autoPreparing || hideSetupOverlay)}
          aiPaused={!tutorialFinished && aiPaused}
          onSetupFeedbackDismiss={tutorialFinished ? undefined : handleSetupFeedbackDismiss}
          onNoticeDismiss={tutorialFinished ? undefined : handleNoticeDismiss}
          onTutorialAction={tutorialFinished ? undefined : handleTutorialAction}
          tutorialAllowedSetCardDefIds={tutorialFinished ? undefined : tutorialAllowedSetCards}
          tutorialRequiredSetCardDefIds={tutorialFinished ? undefined : tutorialRequiredSetCards}
          tutorialSetInteractionEnabled={tutorialFinished || tutorialSetInteractionEnabled}
          tutorialAutoReplay={!tutorialFinished ? (replayTarget ?? undefined) : undefined}
          tutorialSuppressNotices={!tutorialFinished && (replayTarget === 'turn2' || replayTarget === 'effects')}
          tutorialEffectOverlayVisible={tutorialFinished ? undefined : activePhase === 'effectOrder-action'}
          tutorialPresentationState={tutorialFinished ? undefined : tutorialPresentationState}
        />
      </div>

      {autoPreparing && (
        <PageShell className="grid place-items-center px-4">
          <LoadingState label={t('game.loading')} className="w-full max-w-sm" />
        </PageShell>
      )}

      {!autoPreparing && !preparationPromptOpen && !tutorialFinished && (
        <GameTutorialOverlay
          steps={TUTORIAL_STEPS}
          currentStep={currentStep}
          gameState={gameState}
          onNext={goNext}
          onPrevious={handlePrevious}
          onComplete={completeTutorial}
          onContinueBattle={continueTutorialBattle}
          onSkip={handleSkip}
          suspendFocusManagement={skipPromptOpen || Boolean(rewindCheckpoint)}
        />
      )}
      <Dialog
        open={preparationPromptOpen}
        dismissible={false}
        overlayClassName="tutorial-skip-dialog-overlay"
        title={t('tutorial.game.preparationComplete.title')}
        description={t('tutorial.game.preparationComplete.body')}
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setPreparationPromptOpen(false);
              onPreparationReturn();
            }}
          >
            {t('tutorial.game.preparationComplete.action')}
          </Button>
        }
      />
      <Dialog
        open={Boolean(rewindCheckpoint)}
        onOpenChange={(open) => {
          if (!open) setRewindCheckpoint(null);
        }}
        overlayClassName="tutorial-skip-dialog-overlay"
        title={t('tutorial.game.rewind.title')}
        description={t('tutorial.game.rewind.body')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRewindCheckpoint(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (rewindCheckpoint) restartAtCheckpoint(rewindCheckpoint);
              }}
            >
              {t('tutorial.game.rewind.action')}
            </Button>
          </>
        }
      />
      <Dialog
        open={skipPromptOpen}
        onOpenChange={setSkipPromptOpen}
        overlayClassName="tutorial-skip-dialog-overlay"
        title={t('common.confirm')}
        description={t('tutorial.battle.exitConfirm')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSkipPromptOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => exitTutorial('skip')}>
              {t('common.confirm')}
            </Button>
          </>
        }
      />
    </>
  );
}
