import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AIGame } from '../components/AIGame';
import { GameTutorialOverlay } from '../components/GameTutorialOverlay';
import { Alert, Button, Dialog, LoadingState, PageShell } from '../ui';
import { useTutorialState } from '../hooks/useTutorialState';
import { TUTORIAL_STEPS } from '../data/tutorialSteps';
import { TUTORIAL_DECK0_IDS, TUTORIAL_DECK1_IDS, TUTORIAL_AI_SCRIPT } from '../data/tutorialScenario';
import type { GameState } from '../game/types';
import { t } from '../i18n';
import '../components/GameTutorialOverlay.css';

interface TutorialGamePageProps {
  cardsReady: boolean;
  cardsLoadError?: boolean;
  onRetryCards?: () => void | Promise<void>;
}

export function TutorialGamePage({ cardsReady, cardsLoadError, onRetryCards }: TutorialGamePageProps) {
  const navigate = useNavigate();
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [skipPromptOpen, setSkipPromptOpen] = useState(false);

  const { currentStep, goNext } = useTutorialState({
    steps: TUTORIAL_STEPS,
    gameState,
    onComplete: () => {
      navigate('/');
    },
  });

  // 教學進度在 janken 之前（場地導覽階段）時隱藏 janken/mulligan 浮層，
  // 等教學進度到了才顯示，避免猜拳面板一開始就彈出。
  const jankenStepIndex = TUTORIAL_STEPS.findIndex((s) => s.phase === 'janken');
  const hideSetupOverlay = jankenStepIndex === -1 || currentStep < jankenStepIndex;
  // AI 在 janken 之前（場地導覽階段）仍暫停，避免使用者還在讀文案時 AI 就出拳；
  // 進到 janken 步驟才恢復 AI 讓使用者實際操作（completeWhen 等玩家出拳後推進）。
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

  const handleSkip = () => {
    setSkipPromptOpen(true);
  };

  const handleComplete = () => {
    navigate('/');
  };

  const activeStep = TUTORIAL_STEPS[currentStep];
  const tutorialSetCards =
    gameState?.step === 'initialSet' ? ['1st_70'] : gameState?.step === 'turnSet' ? ['1st_34', '2nd_86'] : undefined;
  const tutorialSetInteractionEnabled = activeStep?.phase === 'initialSet' || activeStep?.phase === 'turnSet';

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
      <AIGame
        difficulty="easy"
        deck0Ids={TUTORIAL_DECK0_IDS}
        deck1Ids={TUTORIAL_DECK1_IDS}
        skipShuffle
        aiScript={TUTORIAL_AI_SCRIPT}
        onBack={() => navigate('/')}
        onGameStateChange={setGameState}
        tutorialMode
        hideSetupOverlay={hideSetupOverlay}
        aiPaused={aiPaused}
        onSetupFeedbackDismiss={handleSetupFeedbackDismiss}
        onNoticeDismiss={handleNoticeDismiss}
        tutorialAllowedSetCardDefIds={tutorialSetCards}
        tutorialRequiredSetCardDefIds={tutorialSetCards}
        tutorialSetInteractionEnabled={tutorialSetInteractionEnabled}
      />

      <GameTutorialOverlay
        steps={TUTORIAL_STEPS}
        currentStep={currentStep}
        gameState={gameState}
        onNext={goNext}
        onComplete={handleComplete}
        onSkip={handleSkip}
        suspendFocusManagement={skipPromptOpen}
      />
      <Dialog
        open={skipPromptOpen}
        onOpenChange={setSkipPromptOpen}
        overlayClassName="tutorial-skip-dialog-overlay"
        title={t('common.confirm')}
        description={t('tutorial.skipConfirm')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSkipPromptOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => navigate('/')}>
              {t('common.confirm')}
            </Button>
          </>
        }
      />
    </>
  );
}
