import { ChevronRight } from 'lucide-react';
import type { AIDifficulty } from '../../game/ai';
import { t } from '../../i18n';
import { Button } from '../../ui';

export function DifficultyButtons({
  onStart,
  disabled = false,
  layout = 'stacked',
}: {
  onStart: (difficulty: AIDifficulty) => void;
  disabled?: boolean;
  layout?: 'stacked' | 'row';
}) {
  const levels: { id: AIDifficulty; label: string; detail: string }[] = [
    { id: 'easy', label: t('difficulty.easy'), detail: t('difficulty.easyDesc') },
    { id: 'normal', label: t('difficulty.normal'), detail: t('difficulty.normalDesc') },
    { id: 'hard', label: t('difficulty.hard'), detail: t('difficulty.hardDesc') },
  ];

  return (
    <section className="flex flex-col gap-3">
      {disabled && <p className="text-caption text-accent-action">{t('lobby.selectDeckFirst')}</p>}
      <div className={layout === 'row' ? 'grid gap-2 sm:grid-cols-3' : 'flex flex-col gap-2'}>
        {levels.map((level) => (
          <Button
            key={level.id}
            className="group justify-between border-content-primary/10 px-4 py-3 normal-case tracking-normal hover:border-accent-primary/30 disabled:opacity-60 disabled:hover:border-content-primary/10 disabled:hover:bg-transparent"
            variant="secondary"
            type="button"
            onClick={() => onStart(level.id)}
            disabled={disabled}
          >
            <span className="flex flex-col gap-0.5 text-left">
              <span className="font-display text-base font-bold leading-tight text-content-primary">{level.label}</span>
              <span className="text-caption text-content-primary/40">{level.detail}</span>
            </span>
            <ChevronRight
              strokeWidth={1.25}
              className="size-4 text-content-primary/30 transition group-hover:translate-x-0.5 group-hover:text-accent-primary/70"
            />
          </Button>
        ))}
      </div>
    </section>
  );
}
