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
        'rounded-sm bg-surface-panel ring-1 ring-border-soft',
        sizeClass[size],
        interactive &&
          'transition will-change-transform hover:-translate-y-0.5 hover:ring-border-strong hover:shadow-floating focus-within:ring-border-strong focus-within:shadow-focus',
        selected && 'ring-2 ring-accent-primary',
        className,
      )}
      {...props}
    />
  );
}
