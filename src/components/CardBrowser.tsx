import type { HTMLAttributes, ReactNode } from 'react';
import { Button, Sheet } from '../ui';
import { cn } from '../ui';

interface CardBrowserProps extends HTMLAttributes<HTMLElement> {
  label: string;
}

export function CardBrowser({ label, className, children, ...props }: CardBrowserProps) {
  return (
    <section
      className={cn(
        'card-browser flex min-h-[24rem] flex-col rounded-sm bg-surface-base/60 p-4 ring-1 ring-content-primary/10 md:min-h-[28rem] md:p-5 xl:min-h-0',
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
          {kicker && <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">{kicker}</div>}
          <h2 className="truncate font-display text-2xl font-bold">{title}</h2>
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

interface CardBrowserFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  confirmLabel: string;
  children: ReactNode;
}

export function CardBrowserFilterSheet({
  open,
  onOpenChange,
  title,
  closeLabel,
  confirmLabel,
  children,
}: CardBrowserFilterSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      closeLabel={closeLabel}
      footer={
        <Button type="button" variant="primary" fullWidth className="min-h-11" onClick={() => onOpenChange(false)}>
          {confirmLabel}
        </Button>
      }
    >
      {children}
    </Sheet>
  );
}

interface CardBrowserDetailContentProps {
  title: ReactNode;
  meta?: ReactNode;
  stats?: ReactNode;
  effect?: ReactNode;
  footer?: ReactNode;
}

function CardBrowserDetailContent({
  title,
  meta,
  stats,
  effect,
  footer,
  showTitle = true,
}: CardBrowserDetailContentProps & { showTitle?: boolean }) {
  return (
    <>
      {showTitle && <div className="truncate font-display text-sm font-bold text-content-primary/90">{title}</div>}
      {meta && <div className="mt-0.5 font-mono text-minutia uppercase tracking-normal text-accent-primary/50">{meta}</div>}
      {stats && (
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-caption uppercase tracking-normal">
          {stats}
        </div>
      )}
      {effect && <p className="mt-2.5 text-body-sm leading-relaxed text-content-primary/80">{effect}</p>}
      {footer && <div className="mt-2 font-mono text-minutia text-content-primary/30">{footer}</div>}
    </>
  );
}

interface CardBrowserDetailPopoverProps
  extends CardBrowserDetailContentProps, Omit<HTMLAttributes<HTMLElement>, 'title'> {}

export function CardBrowserDetailPopover({
  title,
  meta,
  stats,
  effect,
  footer,
  className,
  ...props
}: CardBrowserDetailPopoverProps) {
  return (
    <aside
      aria-hidden="true"
      className={cn(
        'pointer-events-none fixed z-[var(--z-modal)] w-72 rounded-sm bg-gradient-to-br from-surface-canvas via-surface-canvas/95 to-surface-base p-4 shadow-popover ring-1 ring-accent-primary/30 backdrop-blur',
        className,
      )}
      {...props}
    >
      <CardBrowserDetailContent title={title} meta={meta} stats={stats} effect={effect} footer={footer} />
    </aside>
  );
}

interface CardBrowserDetailSheetProps extends CardBrowserDetailContentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeLabel: string;
}

export function CardBrowserDetailSheet({
  open,
  onOpenChange,
  closeLabel,
  title,
  meta,
  stats,
  effect,
  footer,
}: CardBrowserDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={meta} closeLabel={closeLabel}>
      <CardBrowserDetailContent
        title={title}
        meta={undefined}
        stats={stats}
        effect={effect}
        footer={footer}
        showTitle={false}
      />
    </Sheet>
  );
}
