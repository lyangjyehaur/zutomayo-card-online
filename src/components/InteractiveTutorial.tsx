import { useState, useEffect, useRef } from 'react';
import { t, type TranslationKey } from '../i18n';

type TutorialTarget =
  | 'welcome'
  | 'zones'
  | 'chronos'
  | 'resources'
  | 'catchup'
  | 'janken'
  | 'mulligan'
  | 'effectOrder'
  | 'pendingChoice';

interface TutorialStep {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  accent: 'night' | 'day' | 'gold' | 'energy' | 'danger';
  target: TutorialTarget;
  icon: string;
}

const STEPS: TutorialStep[] = [
  { titleKey: 'tutorial.stepWelcomeTitle', bodyKey: 'tutorial.stepWelcomeBody', accent: 'gold', target: 'welcome', icon: '🎉' },
  { titleKey: 'tutorial.stepZonesTitle', bodyKey: 'tutorial.stepZonesBody', accent: 'night', target: 'zones', icon: '🏟️' },
  { titleKey: 'tutorial.stepChronosTitle', bodyKey: 'tutorial.stepChronosBody', accent: 'day', target: 'chronos', icon: '🕐' },
  { titleKey: 'tutorial.stepResourcesTitle', bodyKey: 'tutorial.stepResourcesBody', accent: 'energy', target: 'resources', icon: '⚡' },
  { titleKey: 'tutorial.stepCatchupTitle', bodyKey: 'tutorial.stepCatchupBody', accent: 'danger', target: 'catchup', icon: '⚖️' },
  { titleKey: 'tutorial.stepJankenTitle', bodyKey: 'tutorial.stepJankenBody', accent: 'gold', target: 'janken', icon: '✊' },
  { titleKey: 'tutorial.stepMulliganTitle', bodyKey: 'tutorial.stepMulliganBody', accent: 'night', target: 'mulligan', icon: '🔄' },
  { titleKey: 'tutorial.stepEffectOrderTitle', bodyKey: 'tutorial.stepEffectOrderBody', accent: 'day', target: 'effectOrder', icon: '🔢' },
  { titleKey: 'tutorial.stepPendingChoiceTitle', bodyKey: 'tutorial.stepPendingChoiceBody', accent: 'energy', target: 'pendingChoice', icon: '📋' },
];

interface InteractiveTutorialProps {
  onComplete: () => void;
  onStartPractice: () => void;
}

export function InteractiveTutorial({ onComplete, onStartPractice }: InteractiveTutorialProps) {
  const [index, setIndex] = useState(0);
  const current = STEPS[index];
  const isFirst = index === 0;
  const isLast = index >= STEPS.length - 1;
  const spotlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (spotlightRef.current) {
      spotlightRef.current.classList.remove('tutorial-spotlight-pulse');
      void spotlightRef.current.offsetWidth;
      spotlightRef.current.classList.add('tutorial-spotlight-pulse');
    }
  }, [index]);

  const goPrev = () => setIndex(value => Math.max(0, value - 1));
  const goNext = () => setIndex(value => Math.min(STEPS.length - 1, value + 1));

  return (
    <div className="tutorial-overlay interactive">
      <div className="tutorial-backdrop" />
      <div className={`tutorial-spotlight tutorial-target-${current.target}`} ref={spotlightRef} aria-hidden="true">
        <span className="tutorial-spotlight-icon">{current.icon}</span>
        <span className="tutorial-spotlight-ring" />
      </div>
      <section className={`tutorial-card accent-${current.accent} tutorial-target-${current.target}`}>
        <div className="tutorial-progress" aria-hidden="true">
          {STEPS.map((step, stepIndex) => (
            <span
              key={step.titleKey}
              className={stepIndex === index ? 'active' : stepIndex < index ? 'done' : ''}
            />
          ))}
        </div>

        <div className="tutorial-step-indicator">
          <span className="tutorial-symbol">
            <span>{index + 1}</span>
          </span>
          <span className="tutorial-step-label">
            {t('tutorial.stepIndicator')} {index + 1} / {STEPS.length}
          </span>
        </div>

        <span className="tutorial-kicker">{t('tutorial.title')}</span>
        <h2>{t(current.titleKey)}</h2>
        <p>{t(current.bodyKey)}</p>

        <div className="tutorial-nav">
          <button className="tutorial-btn skip" type="button" onClick={onComplete}>
            {t('tutorial.skip')}
          </button>
          <div className="tutorial-nav-step">
            <button
              className="tutorial-btn prev"
              type="button"
              onClick={goPrev}
              disabled={isFirst}
            >
              {t('tutorial.prev')}
            </button>
            {isLast ? (
              <button className="tutorial-btn start" type="button" onClick={onStartPractice}>
                {t('tutorial.startPractice')}
              </button>
            ) : (
              <button className="tutorial-btn next" type="button" onClick={goNext}>
                {t('common.next')}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
