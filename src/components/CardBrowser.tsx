import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './ui/utils';

interface CardBrowserProps extends HTMLAttributes<HTMLElement> {
  label: string;
}

export function CardBrowser({ label, className, children, ...props }: CardBrowserProps) {
  return (
    <section
      className={cn(
        'flex min-h-[24rem] flex-col rounded-sm bg-lacquer/60 p-4 ring-1 ring-bone/10 md:min-h-[28rem] md:p-5 xl:min-h-0',
        className,
      )}
      aria-label={label}
      {...props}
    >
      {children}
    </section>
  );
}

interface CardBrowserToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  kicker?: ReactNode;
  title: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
}

export function CardBrowserToolbar({
  kicker,
  title,
  search,
  actions,
  summary,
  className,
  children,
  ...props
}: CardBrowserToolbarProps) {
  return (
    <div className={cn('mb-4 space-y-4', className)} {...props}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {kicker && <div className="text-[10px] uppercase tracking-[0.3em] text-gold/70">{kicker}</div>}
          <h2 className="truncate font-display text-2xl italic">{title}</h2>
        </div>
        {search}
      </div>
      {(actions || summary || children) && (
        <div className="space-y-2">
          {actions}
          {summary}
          {children}
        </div>
      )}
    </div>
  );
}

export function CardBrowserGrid({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'deck-pool-grid grid min-h-0 flex-1 grid-cols-2 content-start gap-3 overflow-y-auto p-1 pr-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
