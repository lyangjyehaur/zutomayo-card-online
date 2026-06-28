import { Check } from 'lucide-react';
import { t } from '../../i18n';
import type { DeckOptionGroup } from './shared';

const DECK_ACCENT: Record<string, string> = {
  dark: 'from-[#7771a8] to-[#3a3568]',
  flame: 'from-[#e2624a] to-[#7a2a1c]',
  electric: 'from-[#d8c44a] to-[#7a6818]',
  wind: 'from-[#5fb58a] to-[#2a5e44]',
};

function accentFor(optionId: string, synced?: boolean): string {
  if (synced) return 'from-gold/60 to-vermilion/40';
  return DECK_ACCENT[optionId] ?? 'from-bone/30 to-bone/10';
}

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
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg italic text-bone">{label}</h3>
        <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('lobby.deckSelectHint')}</span>
      </div>
      <div className="flex flex-col gap-4">
        {options.map((group) => (
          <div className="flex flex-col gap-2" key={group.label}>
            <span className="text-[10px] uppercase tracking-[0.3em] text-gold/70">{group.label}</span>
            <div className="grid gap-1.5">
              {group.options.map((option) => {
                const selected = value === option.id;
                const accent = accentFor(option.id, option.synced);
                return (
                  <button
                    key={option.id}
                    className={`group flex items-center gap-3 rounded-sm bg-lacquer-deep/60 px-3 py-2.5 text-left ring-1 transition hover:-translate-y-0.5 hover:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:ring-bone/10 ${
                      selected ? 'ring-2 ring-gold' : 'ring-bone/10'
                    }`}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => onChange(option.id)}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-9 w-7 shrink-0 rounded-xs bg-gradient-to-b ${accent} ring-1 ring-bone/10`}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-display text-sm italic text-bone/90">{option.name}</span>
                      <span className="truncate text-[10px] text-bone/40">{option.description}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {option.synced && (
                        <span className="font-mono text-[9px] uppercase tracking-widest text-bone/40">
                          {t('deck.synced')}
                        </span>
                      )}
                      {selected && (
                        <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-widest text-gold">
                          <Check strokeWidth={1.25} className="size-3" />
                        </span>
                      )}
                    </span>
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
