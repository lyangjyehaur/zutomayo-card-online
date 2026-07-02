import type { HTMLAttributes } from 'react';
import { cn } from './utils';

export interface ActionBarProps extends HTMLAttributes<HTMLDivElement> {
  sticky?: boolean;
}

export function ActionBar({ sticky = false, className, ...props }: ActionBarProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end',
        sticky &&
          'sticky bottom-0 z-[--z-sticky] -mx-4 border-t border-bone/10 bg-lacquer-deep/90 px-4 py-3 backdrop-blur md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none',
        className,
      )}
      {...props}
    />
  );
}
