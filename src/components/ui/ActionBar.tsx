import type { HTMLAttributes } from 'react';
import { cn } from './utils';

export interface ActionBarProps extends HTMLAttributes<HTMLDivElement> {
  sticky?: boolean;
  mobileLayout?: 'stack' | 'grid' | 'pagination';
}

const mobileLayoutClasses: Record<NonNullable<ActionBarProps['mobileLayout']>, string> = {
  stack: 'flex flex-col gap-2 sm:flex-row sm:items-center',
  grid: 'grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:items-center',
  pagination: 'grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex sm:flex-row sm:items-center',
};

export function ActionBar({ sticky = false, mobileLayout = 'stack', className, ...props }: ActionBarProps) {
  return (
    <div
      className={cn(
        mobileLayoutClasses[mobileLayout],
        'sm:justify-end',
        sticky &&
          'sticky bottom-0 z-[var(--z-sticky)] -mx-4 border-t border-border-soft bg-surface-overlay px-4 py-3 backdrop-blur md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none',
        className,
      )}
      {...props}
    />
  );
}
