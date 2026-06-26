import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AIGame } from '../components/AIGame';
import type { AIDifficulty } from '../game/ai';
import { t } from '../i18n';

interface AIGamePageProps {
  deck0Name?: string;
  deck1Name?: string;
}

function isAIDifficulty(value: unknown): value is AIDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

function getRouteDifficulty(state: unknown): AIDifficulty {
  if (state && typeof state === 'object' && isAIDifficulty((state as Record<string, unknown>).difficulty)) {
    return (state as Record<string, AIDifficulty>).difficulty;
  }
  return 'normal';
}

function shouldAutoStart(state: unknown): boolean {
  return Boolean(state && typeof state === 'object' && (state as Record<string, unknown>).autoStart);
}

export function AIGamePage({ deck0Name, deck1Name }: AIGamePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const levels: { id: AIDifficulty; label: string; detail: string }[] = [
    { id: 'easy', label: t('difficulty.easy'), detail: t('difficulty.easyDesc') },
    { id: 'normal', label: t('difficulty.normal'), detail: t('difficulty.normalDesc') },
    { id: 'hard', label: t('difficulty.hard'), detail: t('difficulty.hardDesc') },
  ];
  const [difficulty, setDifficulty] = useState<AIDifficulty>(() => getRouteDifficulty(location.state));
  const [activeDifficulty, setActiveDifficulty] = useState<AIDifficulty | null>(() => (
    shouldAutoStart(location.state) ? getRouteDifficulty(location.state) : null
  ));

  useEffect(() => {
    if (!shouldAutoStart(location.state)) return;
    const routeDifficulty = getRouteDifficulty(location.state);
    setDifficulty(routeDifficulty);
    setActiveDifficulty(routeDifficulty);
  }, [location.state]);

  if (activeDifficulty) {
    return (
      <AIGame
        key={`${activeDifficulty}-${deck0Name ?? 'default'}-${deck1Name ?? 'default'}`}
        difficulty={activeDifficulty}
        deck0Name={deck0Name}
        deck1Name={deck1Name}
        onBack={() => navigate('/')}
      />
    );
  }

  return (
    <main className="ai-setup app-screen">
      <header className="screen-header">
        <div>
          <span>{t('lobby.menu')}</span>
          <h1>{t('aiSetup.title')}</h1>
        </div>
        <div className="screen-actions">
          <button className="secondary-action" type="button" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </button>
        </div>
      </header>

      <section className="ai-setup-panel lobby-panel">
        <div className="section-heading">
          <h3>{t('aiSetup.chooseDifficulty')}</h3>
          <span>{t('lobby.difficulty')}</span>
        </div>
        <div className="difficulty-grid">
          {levels.map(level => (
            <button
              key={level.id}
              className={`difficulty-card ${level.id} ${difficulty === level.id ? 'selected' : ''}`}
              type="button"
              onClick={() => {
                setDifficulty(level.id);
                setActiveDifficulty(level.id);
              }}
            >
              <strong>{level.label}</strong>
              <span>{level.detail}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
