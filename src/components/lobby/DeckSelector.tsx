import { Check } from 'lucide-react';
import { t } from '../../i18n';
import { Button } from '../../ui';
import type { DeckOptionGroup } from './shared';

const DECK_ACCENT: Record<string, string> = {
  dark: 'bg-element-dark/80',
  flame: 'bg-element-flame/80',
  electric: 'bg-element-electric/80',
  wind: 'bg-element-wind/80',
};

function accentFor(optionId: string, synced?: boolean): string {
  if (synced) return 'bg-accent-primary/70';
  return DECK_ACCENT[optionId] ?? 'bg-content-primary/25';
}

export function DeckSelector({
  label,
  value,
  options,
  onChange,
  density = 'comfortable',
  showHeader = true,
  layout = 'grid',
  scrollable = false,
  disabled = false,
}: {
  label: string;
  value: string;
  options: DeckOptionGroup[];
  onChange: (deckName: string) => void;
  density?: 'comfortable' | 'compact';
  showHeader?: boolean;
  layout?: 'grid' | 'rail';
  scrollable?: boolean;
  disabled?: boolean;
}) {
  const compact = density === 'compact';

  return (
    <section className={`flex flex-col ${compact ? 'gap-2.5' : 'gap-3'}`}>
      {showHeader && (
        <div className="flex flex-col gap-1">
          <h3
            className={`font-display font-bold leading-tight text-content-primary ${compact ? 'text-base' : 'text-lg'}`}
          >
            {label}
          </h3>
          <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
            {t('lobby.deckSelectHint')}
          </span>
        </div>
      )}
      <div className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
        <div
          className={`flex flex-col gap-4 ${scrollable ? 'max-h-[min(28rem,55vh)] overflow-y-auto overscroll-contain p-1' : ''}`}
        >
          {options.map((group) => (
            <div className="flex flex-col gap-2" key={group.label}>
              <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
                {group.label}
              </span>
              <div
                className={`grid grid-cols-2 ${
                  layout === 'rail'
                    ? 'gap-1.5 sm:grid-cols-3 xl:grid-cols-6'
                    : compact
                      ? 'gap-1.5'
                      : 'gap-2 xl:grid-cols-3'
                }`}
              >
                {group.options.map((option) => {
                  const selected = value === option.id;
                  const accent = accentFor(option.id, option.synced);
                  return (
                    <Button
                      key={option.id}
                      className={`group justify-start rounded-sm bg-surface-canvas/40 text-left normal-case tracking-normal ring-1 hover:bg-surface-elevated/60 hover:ring-accent-primary/40 disabled:hover:ring-content-primary/10 ${
                        compact ? 'min-h-14 px-2.5 py-2' : 'min-h-20 px-3 py-2.5'
                      } ${selected ? 'bg-accent-primary/10 ring-2 ring-accent-primary' : 'ring-content-primary/10'}`}
                      variant="ghost"
                      size="md"
                      fullWidth
                      type="button"
                      disabled={disabled || option.disabled}
                      aria-pressed={selected}
                      onClick={() => onChange(option.id)}
                    >
                      <span
                        aria-hidden="true"
                        className={`${compact ? 'h-8 w-1' : 'h-9 w-1.5'} shrink-0 rounded-full ${accent}`}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-display text-body font-bold leading-tight text-content-primary/90">
                          {option.name}
                        </span>
                        {!compact && (
                          <span className="truncate text-caption text-content-primary/40">{option.description}</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {option.synced && (
                          <span className="font-mono text-minutia uppercase tracking-normal text-content-primary/40">
                            {t('deck.synced')}
                          </span>
                        )}
                        {selected && (
                          <span className="inline-flex items-center gap-1 font-mono text-minutia uppercase tracking-normal text-accent-primary">
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
      </div>
    </section>
  );
}
