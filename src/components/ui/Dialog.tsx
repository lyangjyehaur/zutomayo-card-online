import { X } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { useEffect, useId } from 'react';
import { cn } from './utils';

export type DialogSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  dismissible?: boolean;
  size?: DialogSize;
  mobilePresentation?: 'modal' | 'sheet';
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  closeLabel = 'Close',
  dismissible = true,
  size = 'md',
  mobilePresentation = 'sheet',
  className,
  children,
  ...props
}: DialogProps) {
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
        'fixed inset-0 z-[var(--z-modal)] flex overflow-y-auto bg-lacquer-deep/80 p-4 backdrop-blur',
        mobilePresentation === 'sheet' ? 'items-end justify-center md:items-center' : 'items-center justify-center',
      )}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onOpenChange?.(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'relative flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-md bg-lacquer ring-1 ring-gold/30 shadow-[--shadow]',
          sizeClass[size],
          className,
        )}
        {...props}
      >
        {dismissible && (
          <button
            type="button"
            aria-label={closeLabel}
            className="absolute right-3 top-3 inline-flex size-11 items-center justify-center rounded-sm text-bone/50 transition hover:text-vermilion focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer"
            onClick={() => onOpenChange?.(false)}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
        {(title || description) && (
          <header className="grid gap-2 border-b border-bone/10 p-4 pr-12 md:p-6 md:pr-12">
            {title && (
              <h2 id={titleId} className="font-display text-xl italic text-bone">
                {title}
              </h2>
            )}
            {description && (
              <p id={descriptionId} className="text-sm leading-relaxed text-bone/70">
                {description}
              </p>
            )}
          </header>
        )}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto',
            title || description ? 'p-4 md:p-6' : 'p-4 pr-12 md:p-6 md:pr-12',
          )}
        >
          {children}
        </div>
        {footer && (
          <footer className="flex flex-col gap-2 border-t border-bone/10 p-4 sm:flex-row sm:items-center sm:justify-end md:p-6">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
