import { ChevronRight } from 'lucide-react';
import type { AIDifficulty } from '../../game/ai';
import { t } from '../../i18n';

export function DifficultyButtons({
  onStart,
  disabled = false,
}: {
  onStart: (difficulty: AIDifficulty) => void;
  disabled?: boolean;
}) {
  const levels: { id: AIDifficulty; label: string; detail: string }[] = [
    { id: 'easy', label: t('difficulty.easy'), detail: t('difficulty.easyDesc') },
    { id: 'normal', label: t('difficulty.normal'), detail: t('difficulty.normalDesc') },
    { id: 'hard', label: t('difficulty.hard'), detail: t('difficulty.hardDesc') },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg italic text-bone">{t('lobby.aiBattle')}</h3>
        <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('lobby.difficulty')}</span>
      </div>
      {disabled && (
        <p className="text-[10px] text-vermilion/70">{t('lobby.selectDeckFirst')}</p>
      )}
      <div className="flex flex-col gap-2">
        {levels.map((level) => (
          <button
            key={level.id}
            className="group flex items-center justify-between border border-bone/10 px-4 py-3 transition hover:border-gold/30 hover:bg-bone/5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-bone/10 disabled:hover:bg-transparent"
            type="button"
            onClick={() => onStart(level.id)}
            disabled={disabled}
          >
            <span className="flex flex-col gap-0.5 text-left">
              <span className="font-display text-base italic text-bone">{level.label}</span>
              <span className="text-[10px] text-bone/40">{level.detail}</span>
            </span>
            <ChevronRight
              strokeWidth={1.25}
              className="size-4 text-bone/30 transition group-hover:translate-x-0.5 group-hover:text-gold/70"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
