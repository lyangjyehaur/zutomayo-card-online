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
      className="fixed inset-0 z-[--z-modal] flex items-center justify-center overflow-y-auto bg-lacquer-deep/80 p-4 backdrop-blur"
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
          'relative w-full rounded-md bg-lacquer p-6 ring-1 ring-gold/30 shadow-[--shadow]',
          sizeClass[size],
          className,
        )}
        {...props}
      >
        {dismissible && (
          <button
            type="button"
            aria-label={closeLabel}
            className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-sm text-bone/50 transition hover:text-vermilion focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-lacquer"
            onClick={() => onOpenChange?.(false)}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
        {(title || description) && (
          <header className="mb-5 grid gap-2 pr-8">
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
        <div>{children}</div>
        {footer && <footer className="mt-6 flex items-center justify-end gap-3">{footer}</footer>}
      </div>
    </div>
  );
}
