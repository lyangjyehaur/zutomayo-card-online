import { X } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { IconButton } from './Button';
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

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
        'fixed inset-0 z-[var(--z-modal)] flex overflow-y-auto bg-surface-overlay p-4 backdrop-blur',
        mobilePresentation === 'sheet' ? 'items-end justify-center md:items-center' : 'items-center justify-center',
      )}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onOpenChange?.(false);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[calc(100dvh_-_var(--space-8))] w-full flex-col rounded-md bg-surface-panel-strong ring-1 ring-border-strong shadow-sheet',
          'animate-in fade-in slide-in-from-bottom-2 duration-[var(--motion-duration-base)] focus:outline-none',
          sizeClass[size],
          className,
        )}
        {...props}
      >
        {dismissible && (
          <IconButton
            label={closeLabel}
            icon={<X className="size-4" aria-hidden="true" />}
            className="absolute right-3 top-3 focus-visible:ring-offset-surface-panel-strong"
            onClick={() => onOpenChange?.(false)}
          />
        )}
        {(title || description) && (
          <header className="grid gap-2 border-b border-border-soft p-4 pr-12 md:p-6 md:pr-12">
            {title && (
              <h2 id={titleId} className="font-display text-title-sm italic text-content-primary">
                {title}
              </h2>
            )}
            {description && (
              <p id={descriptionId} className="text-body leading-relaxed text-content-muted">
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
          <footer className="flex flex-col gap-2 border-t border-border-soft p-4 sm:flex-row sm:items-center sm:justify-end md:p-6">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
