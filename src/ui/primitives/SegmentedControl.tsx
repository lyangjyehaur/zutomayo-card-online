import type { ReactNode } from 'react';
import { cn } from './utils';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  optionClassName?: string;
  size?: 'sm' | 'md';
  behavior?: 'segmented' | 'tabs';
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  optionClassName,
  size = 'md',
  behavior = 'segmented',
}: SegmentedControlProps<T>) {
  const isTabs = behavior === 'tabs';

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      role={isTabs ? 'tablist' : 'group'}
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={isTabs ? 'tab' : undefined}
            aria-selected={isTabs ? selected : undefined}
            aria-pressed={!isTabs ? selected : undefined}
            disabled={option.disabled}
            className={cn(
              'rounded-sm font-mono text-caption uppercase transition disabled:cursor-not-allowed disabled:opacity-40',
              'focus-visible:outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-[--focus-ring-color] focus-visible:ring-offset-[length:var(--focus-ring-offset)] focus-visible:ring-offset-surface-base',
              size === 'md'
                ? 'min-h-touch px-3 tracking-[var(--tracking-control)] md:tracking-[var(--tracking-kicker)]'
                : 'min-h-control-sm px-3 tracking-[var(--tracking-control)]',
              selected
                ? 'bg-accent-primary text-content-inverse'
                : 'text-content-dim hover:bg-content-primary/5 hover:text-content-primary',
              optionClassName,
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
