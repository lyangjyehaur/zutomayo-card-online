import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AIGame } from '../components/AIGame';
import { GameTutorialOverlay } from '../components/GameTutorialOverlay';
import { useTutorialState } from '../hooks/useTutorialState';
import { TUTORIAL_STEPS } from '../data/tutorialSteps';
import type { GameState } from '../game/types';
import { t } from '../i18n';
import '../components/GameTutorialOverlay.css';

export function TutorialGamePage() {
  const navigate = useNavigate();
  const [gameState, setGameState] = useState<GameState | null>(null);

  const { currentStep, goNext, goPrev } = useTutorialState({
    steps: TUTORIAL_STEPS,
    gameState,
    onComplete: () => {
      navigate('/');
    },
  });

  const handleSkip = () => {
    if (window.confirm(t('tutorial.skipConfirm' as any) || '確定要跳過教學嗎？')) {
      navigate('/');
    }
  };

  const handleComplete = () => {
    navigate('/');
  };

  return (
    <>
      <AIGame
        difficulty="easy"
        deck0Name="default"
        deck1Name="default"
        onBack={() => navigate('/')}
        onGameStateChange={setGameState}
        tutorialMode
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
