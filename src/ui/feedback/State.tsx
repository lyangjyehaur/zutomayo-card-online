import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../primitives/utils';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const alertToneClass: Record<AlertTone, string> = {
  info: 'border-accent-info/40 bg-accent-info/10 text-accent-info',
  success: 'border-accent-success/40 bg-accent-success/10 text-accent-success',
  warning: 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary',
  danger: 'border-accent-action/50 bg-accent-action/10 text-accent-action',
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
}

export function Alert({ tone = 'info', title, children, className, role = 'status', ...props }: AlertProps) {
  return (
    <div
      className={cn(
        'rounded-sm border-l-2 px-3 py-2 text-body-sm leading-relaxed transition',
        alertToneClass[tone],
        className,
      )}
      role={role}
      {...props}
    >
      {title && <strong className="mb-1 block font-mono text-caption uppercase tracking-[var(--tracking-control)]">{title}</strong>}
      {children}
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function EmptyState({ title, description, actions, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'grid place-items-center gap-3 rounded-sm border border-border-soft bg-surface-panel p-panel text-center text-content-muted',
        'transition',
        className,
      )}
      {...props}
    >
      {title && <strong className="font-display text-title-sm italic text-content-primary">{title}</strong>}
      {description && <p className="max-w-prose text-body-sm leading-relaxed">{description}</p>}
      {actions}
    </div>
  );
}

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
}

export function LoadingState({ label, className, ...props }: LoadingStateProps) {
  return (
    <div
      className={cn(
        'grid place-items-center rounded-sm border border-border-soft bg-surface-panel p-panel font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-dim',
        className,
      )}
      role="status"
      aria-live="polite"
      {...props}
    >
      <span className="mb-2 size-2.5 animate-pulse rounded-full bg-accent-primary/70 shadow-status-dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
