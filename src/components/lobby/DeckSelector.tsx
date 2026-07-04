import { Check } from 'lucide-react';
import { t } from '../../i18n';
import { Button } from '../../ui';
import type { DeckOptionGroup } from './shared';

const DECK_ACCENT: Record<string, string> = {
  dark: 'from-element-dark/85 to-element-dark/35',
  flame: 'from-element-flame/85 to-element-flame/35',
  electric: 'from-element-electric/85 to-element-electric/35',
  wind: 'from-element-wind/85 to-element-wind/35',
};

function accentFor(optionId: string, synced?: boolean): string {
  if (synced) return 'from-accent-primary/60 to-accent-action/40';
  return DECK_ACCENT[optionId] ?? 'from-content-primary/30 to-content-primary/10';
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
        <h3 className="font-display text-lg font-bold leading-tight text-content-primary">{label}</h3>
        <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">{t('lobby.deckSelectHint')}</span>
      </div>
      <div className="flex flex-col gap-4">
        {options.map((group) => (
          <div className="flex flex-col gap-2" key={group.label}>
            <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">{group.label}</span>
            <div className="grid gap-1.5">
              {group.options.map((option) => {
                const selected = value === option.id;
                const accent = accentFor(option.id, option.synced);
                return (
                  <Button
                    key={option.id}
                    className={`group justify-start bg-surface-canvas/60 px-3 py-2.5 text-left normal-case tracking-normal ring-1 hover:-translate-y-0.5 hover:ring-accent-primary/40 disabled:hover:translate-y-0 disabled:hover:ring-content-primary/10 ${
                      selected ? 'ring-2 ring-accent-primary' : 'ring-content-primary/10'
                    }`}
                    variant="ghost"
                    size="md"
                    fullWidth
                    type="button"
                    disabled={option.disabled}
                    onClick={() => onChange(option.id)}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-9 w-7 shrink-0 rounded-xs bg-gradient-to-b ${accent} ring-1 ring-content-primary/10`}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-display text-body font-bold leading-tight text-content-primary/90">{option.name}</span>
                      <span className="truncate text-caption text-content-primary/40">{option.description}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {option.synced && (
                        <span className="font-mono text-minutia uppercase tracking-widest text-content-primary/40">
                          {t('deck.synced')}
                        </span>
                      )}
                      {selected && (
                        <span className="inline-flex items-center gap-1 font-mono text-minutia uppercase tracking-widest text-accent-primary">
                          <Check strokeWidth={1.25} className="size-3" />
                        </span>
                      )}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
