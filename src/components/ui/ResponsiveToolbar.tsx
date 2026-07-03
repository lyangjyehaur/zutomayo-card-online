import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';

export interface ResponsiveToolbarProps extends HTMLAttributes<HTMLDivElement> {
  as?: 'div' | 'section';
  primary?: ReactNode;
  secondary?: ReactNode;
  actions?: ReactNode;
  contentClassName?: string;
  actionsClassName?: string;
}

export function ResponsiveToolbar({
  as: Component = 'div',
  primary,
  secondary,
  actions,
  contentClassName,
  actionsClassName,
  className,
  children,
  ...props
}: ResponsiveToolbarProps) {
  return (
    <Component
      className={cn('flex flex-col gap-3 md:flex-row md:items-center md:justify-between', className)}
      {...props}
    >
      <div
        className={cn('flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center', contentClassName)}
      >
        {primary}
        {secondary}
        {children}
      </div>
      {actions && <div className={cn('flex shrink-0 flex-wrap items-center gap-2', actionsClassName)}>{actions}</div>}
    </Component>
  );
}
