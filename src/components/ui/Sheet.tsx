import { X } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { IconButton } from './Button';
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
  const sheetRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => sheetRef.current?.focus());
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
        'fixed inset-0 z-[var(--z-modal)] flex bg-surface-overlay p-3 backdrop-blur',
        side === 'right' ? 'items-stretch justify-end' : 'items-end justify-center',
      )}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onOpenChange?.(false);
      }}
    >
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative isolate flex min-h-0 w-full flex-col overflow-hidden rounded-md border border-border-strong bg-surface-panel-strong shadow-sheet',
          'animate-in fade-in slide-in-from-bottom-2 duration-[var(--motion-duration-base)] focus:outline-none',
          side === 'right' ? 'max-w-md' : 'max-h-[calc(100dvh_-_var(--space-6))] max-w-2xl',
          className,
        )}
        {...props}
      >
        <header className="sticky top-0 z-[var(--z-dropdown)] flex items-start justify-between gap-3 border-b border-border-soft bg-surface-panel-strong p-panel">
          <div className="min-w-0">
            {title && (
              <h2 id={titleId} className="font-display text-title-sm italic text-content-primary">
                {title}
              </h2>
            )}
            {description && (
              <p id={descriptionId} className="mt-1 text-body leading-relaxed text-content-muted">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <IconButton
              label={closeLabel}
              icon={<X className="size-4" aria-hidden="true" />}
              className="focus-visible:ring-offset-surface-panel-strong"
              onClick={() => onOpenChange?.(false)}
            />
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-canvas p-panel">{children}</div>
        {footer && (
          <footer className="sticky bottom-0 border-t border-border-soft bg-surface-panel-strong p-panel">{footer}</footer>
        )}
      </section>
    </div>
  );
}
