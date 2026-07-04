import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AIGame } from '../components/AIGame';
import { BackButton, Card, PageSectionHeader, Panel, ScrollPageLayout } from '../ui';
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
  const [activeDifficulty, setActiveDifficulty] = useState<AIDifficulty | null>(() =>
    shouldAutoStart(location.state) ? getRouteDifficulty(location.state) : null,
  );

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
    <ScrollPageLayout>
      <PageSectionHeader
        kicker={t('lobby.menu')}
        title={t('aiSetup.title')}
        actions={
          <BackButton className="min-h-11" type="button" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </BackButton>
        }
      />

      <Panel className="mt-4" size="lg">
        <div className="mb-4 grid gap-1">
          <h3 className="font-display text-xl font-bold">{t('aiSetup.chooseDifficulty')}</h3>
          <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">{t('lobby.difficulty')}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {levels.map((level) => (
            <Card
              as="button"
              key={level.id}
              className="flex flex-col items-start gap-2 text-left"
              interactive
              selected={difficulty === level.id}
              type="button"
              onClick={() => {
                setDifficulty(level.id);
                setActiveDifficulty(level.id);
              }}
            >
              <strong className="font-display text-lg font-bold">{level.label}</strong>
              <span className="text-sm text-content-primary/70">{level.detail}</span>
            </Card>
          ))}
        </div>
      </Panel>
    </ScrollPageLayout>
  );
}
