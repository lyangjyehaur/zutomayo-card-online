import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './utils';

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  align?: 'center' | 'start';
}

export function PageHeader({
  leading,
  title,
  subtitle,
  actions,
  align = 'center',
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'relative z-30 grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-bone/5 bg-lacquer-deep/80 px-4 py-2 backdrop-blur md:px-6',
        className,
      )}
      {...props}
    >
      <div className="min-w-0">{leading}</div>
      <div className={cn('min-w-0', align === 'center' ? 'text-center' : 'text-left')}>
        <h1 className="truncate font-display text-base italic text-bone md:text-lg">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-xs text-bone/50">{subtitle}</p>}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">{actions}</div>
    </header>
  );
}
