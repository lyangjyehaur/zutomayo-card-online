import type { AIDifficulty } from '../../game/ai';
import { t } from '../../i18n';

export function DifficultyButtons({ onStart }: { onStart: (difficulty: AIDifficulty) => void }) {
  const levels: { id: AIDifficulty; label: string; detail: string }[] = [
    { id: 'easy', label: t('difficulty.easy'), detail: t('difficulty.easyDesc') },
    { id: 'normal', label: t('difficulty.normal'), detail: t('difficulty.normalDesc') },
    { id: 'hard', label: t('difficulty.hard'), detail: t('difficulty.hardDesc') },
  ];

  return (
    <section className="card bg-base-200 shadow-xl">
      <div className="card-body">
        <div>
          <h3 className="card-title">{t('lobby.aiBattle')}</h3>
          <span className="text-sm opacity-70">{t('lobby.difficulty')}</span>
        </div>
        <div className="grid gap-3">
          {levels.map((level) => (
            <button
              key={level.id}
              className="btn btn-ghost h-auto justify-start p-4 text-left"
              type="button"
              onClick={() => onStart(level.id)}
            >
              <span className="flex flex-col gap-1">
                <strong>{level.label}</strong>
                <span className="text-sm opacity-70">{level.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
