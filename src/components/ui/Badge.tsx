import type { HTMLAttributes } from 'react';
import { cn } from './utils';

export type BadgeTone = 'neutral' | 'gold' | 'jade' | 'vermilion';

const toneClass: Record<BadgeTone, string> = {
  neutral: 'border-bone/10 bg-lacquer text-bone/50',
  gold: 'border-gold/40 bg-gold/10 text-gold',
  jade: 'border-jade/40 bg-jade/10 text-jade',
  vermilion: 'border-vermilion/50 bg-vermilion/10 text-vermilion',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-xs border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em]',
        toneClass[tone],
        className,
      )}
      {...props}
    />
  );
}
