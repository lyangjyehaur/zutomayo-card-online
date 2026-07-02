import { X } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { useEffect, useId } from 'react';
import { cn } from './utils';

export interface SheetProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  dismissible?: boolean;
  side?: 'bottom' | 'right';
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  closeLabel = 'Close',
  dismissible = true,
  side = 'bottom',
  className,
  children,
  ...props
}: SheetProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open || !dismissible) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange?.(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dismissible, onOpenChange, open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-[--z-modal] flex bg-lacquer-deep/80 p-3 backdrop-blur',
        side === 'right' ? 'items-stretch justify-end' : 'items-end justify-center',
      )}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onOpenChange?.(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'flex min-h-0 w-full flex-col rounded-md bg-lacquer ring-1 ring-gold/30 shadow-[--shadow]',
          side === 'right' ? 'max-w-md' : 'max-h-[calc(100dvh-1.5rem)] max-w-2xl',
          className,
        )}
        {...props}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-bone/10 bg-lacquer p-4">
          <div className="min-w-0">
            {title && (
              <h2 id={titleId} className="font-display text-xl italic text-bone">
                {title}
              </h2>
            )}
            {description && (
              <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-bone/70">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              aria-label={closeLabel}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-bone/50 transition hover:text-vermilion focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer"
              onClick={() => onOpenChange?.(false)}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="sticky bottom-0 border-t border-bone/10 bg-lacquer p-4">{footer}</footer>}
      </section>
    </div>
  );
}
