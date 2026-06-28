import { Check } from 'lucide-react';
import { t } from '../../i18n';
import type { DeckOptionGroup } from './shared';

export function DeckSelector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: DeckOptionGroup[];
  onChange: (deckName: string) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg italic text-bone">{label}</h3>
        <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('lobby.deckSelectHint')}</span>
      </div>
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        {options.map((group) => (
          <div className="flex flex-col gap-2" key={group.label}>
            <span className="text-[10px] uppercase tracking-[0.3em] text-gold/70">{group.label}</span>
            <div className="grid gap-2">
              {group.options.map((option) => {
                const selected = value === option.id;
                return (
                  <button
                    key={option.id}
                    className={`group relative flex cursor-pointer flex-col gap-2 rounded-sm bg-lacquer-deep p-3 ring-1 transition hover:-translate-y-1 hover:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 ${
                      selected ? 'ring-2 ring-gold' : 'ring-bone/10'
                    }`}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => onChange(option.id)}
                  >
                    <div
                      aria-hidden="true"
                      className="aspect-[3/4] rounded-xs bg-gradient-to-br from-vermilion/25 via-lacquer to-lacquer-deep ring-1 ring-bone/5"
                    />
                    <div className="flex flex-col gap-0.5 text-left">
                      <span className="font-display text-sm italic text-bone/80">{option.name}</span>
                      <span className="text-[10px] text-bone/40">{option.description}</span>
                    </div>
                    {(selected || option.synced) && (
                      <div className="flex items-center gap-2">
                        {option.synced && (
                          <span className="font-mono text-[9px] uppercase tracking-widest text-bone/40">
                            {t('deck.synced')}
                          </span>
                        )}
                        {selected && (
                          <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-gold">
                            <Check strokeWidth={1.25} className="size-3" />
                            {t('common.selected')}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
