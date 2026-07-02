import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';

export interface ResponsiveToolbarProps extends HTMLAttributes<HTMLDivElement> {
  primary?: ReactNode;
  secondary?: ReactNode;
  actions?: ReactNode;
}

export function ResponsiveToolbar({
  primary,
  secondary,
  actions,
  className,
  children,
  ...props
}: ResponsiveToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 md:flex-row md:items-center md:justify-between',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {primary}
        {secondary}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
