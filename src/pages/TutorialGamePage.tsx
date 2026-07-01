import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AIGame } from '../components/AIGame';
import { GameTutorialOverlay } from '../components/GameTutorialOverlay';
import { useTutorialState } from '../hooks/useTutorialState';
import { TUTORIAL_STEPS } from '../data/tutorialSteps';
import { isCardsInitialized, refreshCards } from '../game/cards/loader';
import { RANDOM_DECK_NAME } from '../game/cards/deckBuilder';
import type { GameState } from '../game/types';
import { t } from '../i18n';
import '../components/GameTutorialOverlay.css';

export function TutorialGamePage() {
  const navigate = useNavigate();
  const [gameState, setGameState] = useState<GameState | null>(null);
  // 卡牌必須載入完成才能建立對戰，否則空牌組會導致開局崩潰
  const [cardsReady, setCardsReady] = useState(isCardsInitialized());

  useEffect(() => {
    if (cardsReady) return;
    let cancelled = false;
    void refreshCards().finally(() => {
      if (!cancelled) setCardsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [cardsReady]);

  const { currentStep, goNext, goPrev } = useTutorialState({
    steps: TUTORIAL_STEPS,
    gameState,
    onComplete: () => {
      navigate('/');
    },
  });

  // 教學進度在 janken-intro 之前（場地導覽階段）時隱藏 janken/mulligan 浮層，
  // 等教學進度到了才顯示，避免猜拳面板一開始就彈出。
  const jankenStepIndex = TUTORIAL_STEPS.findIndex((s) => s.phase === 'janken-intro');
  const hideSetupOverlay = jankenStepIndex === -1 || currentStep < jankenStepIndex;

  const handleSkip = () => {
    if (window.confirm(t('tutorial.skipConfirm' as never) || '確定要跳過教學嗎？')) {
      navigate('/');
    }
  };

  const handleComplete = () => {
    navigate('/');
  };

  // 卡牌未載入時顯示 loading，避免 AIGame 用空牌組崩潰
  if (!cardsReady) {
    return (
      <main className="app-screen grid place-items-center bg-lacquer-deep font-mono text-[10px] uppercase tracking-[0.3em] text-bone/50">
        {t('game.loading')}
      </main>
    );
  }

  return (
    <>
      <AIGame
        difficulty="easy"
        deck0Name={RANDOM_DECK_NAME}
        deck1Name={RANDOM_DECK_NAME}
        onBack={() => navigate('/')}
        onGameStateChange={setGameState}
        tutorialMode
        hideSetupOverlay={hideSetupOverlay}
      />

      <GameTutorialOverlay
        steps={TUTORIAL_STEPS}
        currentStep={currentStep}
        gameState={gameState}
        onNext={goNext}
        onPrev={goPrev}
        onComplete={handleComplete}
        onSkip={handleSkip}
      />
    </>
  );
}
