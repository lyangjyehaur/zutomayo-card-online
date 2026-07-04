import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';

export type BadgeTone = 'neutral' | 'gold' | 'jade' | 'vermilion';

const toneClass: Record<BadgeTone, string> = {
  neutral: 'border-border-soft bg-surface-panel text-content-dim',
  gold: 'border-border-strong bg-accent-primary/10 text-accent-primary',
  jade: 'border-accent-success/40 bg-accent-success/10 text-accent-success',
  vermilion: 'border-accent-action/50 bg-accent-action/10 text-accent-action',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-xs border px-2 py-1 font-mono text-caption uppercase tracking-[var(--tracking-control)]',
        toneClass[tone],
        className,
      )}
      {...props}
    />
  );
}

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  swatch?: string;
  children: ReactNode;
}

export function Tag({ swatch, className, children, ...props }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-xs border border-border-soft bg-surface-panel px-2 py-1 font-mono text-caption text-content-muted',
        className,
      )}
      {...props}
    >
      {swatch && (
        <span
          className="size-2 rounded-pill border border-content-primary/20"
          style={{ backgroundColor: swatch }}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

export interface TagButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  swatch?: string;
  children: ReactNode;
}

export function TagButton({ swatch, className, children, type = 'button', ...props }: TagButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex min-h-control-sm items-center gap-1 rounded-xs border border-border-soft bg-surface-panel px-2 py-1 font-mono text-caption text-content-muted transition',
        'hover:border-border-strong hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-soft disabled:hover:text-content-muted focus-visible:outline-none focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-[--focus-ring-color]',
        className,
      )}
      {...props}
    >
      {swatch && (
        <span
          className="size-2 rounded-pill border border-content-primary/20"
          style={{ backgroundColor: swatch }}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}
