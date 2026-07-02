import type { ElementType, HTMLAttributes } from 'react';
import { cn } from './utils';

export type CardSize = 'md' | 'lg';

const sizeClass: Record<CardSize, string> = {
  md: 'p-4',
  lg: 'p-5',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  as?: ElementType;
  size?: CardSize;
  interactive?: boolean;
  selected?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

export function Card({
  as: Component = 'div',
  size = 'md',
  interactive = false,
  selected = false,
  className,
  ...props
}: CardProps) {
  return (
    <Component
      className={cn(
        'rounded-sm bg-lacquer ring-1 ring-bone/10',
        sizeClass[size],
        interactive &&
          'transition hover:-translate-y-0.5 hover:ring-gold/40 hover:shadow-[--shadow-soft] focus-within:ring-gold/40',
        selected && 'ring-2 ring-gold',
        className,
      )}
      {...props}
    />
  );
}
