import { useState } from 'react';
import { t, type TranslationKey } from '../i18n';

interface TutorialStep {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  accent: 'night' | 'day' | 'gold' | 'energy' | 'danger';
}

const STEPS: TutorialStep[] = [
  { titleKey: 'tutorial.stepWelcomeTitle', bodyKey: 'tutorial.stepWelcomeBody', accent: 'gold' },
  { titleKey: 'tutorial.stepZonesTitle', bodyKey: 'tutorial.stepZonesBody', accent: 'night' },
  { titleKey: 'tutorial.stepChronosTitle', bodyKey: 'tutorial.stepChronosBody', accent: 'day' },
  { titleKey: 'tutorial.stepResourcesTitle', bodyKey: 'tutorial.stepResourcesBody', accent: 'energy' },
  { titleKey: 'tutorial.stepCatchupTitle', bodyKey: 'tutorial.stepCatchupBody', accent: 'danger' },
];

interface InteractiveTutorialProps {
  onComplete: () => void;
  onStartPractice: () => void;
}

export function InteractiveTutorial({ onComplete, onStartPractice }: InteractiveTutorialProps) {
  const [index, setIndex] = useState(0);
  const current = STEPS[index];
  const readyToStart = index >= STEPS.length - 1;

  return (
    <div className="tutorial-overlay interactive">
      <div className="tutorial-backdrop" />
      <section className={`tutorial-card accent-${current.accent}`}>
        <div className="tutorial-progress" aria-hidden="true">
          {STEPS.map((step, stepIndex) => (
            <span
              key={step.titleKey}
              className={stepIndex === index ? 'active' : stepIndex < index ? 'done' : ''}
            />
          ))}
        </div>

        <div className="tutorial-symbol">
          <span>{index + 1}</span>
        </div>

        <span className="tutorial-kicker">{t('tutorial.title')}</span>
        <h2>{t(current.titleKey)}</h2>
        <p>{t(current.bodyKey)}</p>

        <div className="tutorial-nav">
          <button className="tutorial-btn skip" type="button" onClick={onComplete}>
            {t('tutorial.skip')}
          </button>
          {readyToStart ? (
            <button className="tutorial-btn start" type="button" onClick={onStartPractice}>
              {t('tutorial.startPractice')}
            </button>
          ) : (
            <button className="tutorial-btn next" type="button" onClick={() => setIndex(value => Math.min(STEPS.length - 1, value + 1))}>
              {t('common.next')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
