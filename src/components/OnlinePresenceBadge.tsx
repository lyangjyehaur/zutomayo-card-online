import { Users } from 'lucide-react';
import { t, useLocale } from '../i18n';
import { cn } from '../ui/primitives/utils';

interface OnlinePresenceBadgeProps {
  onlineCount: number | null;
  className?: string;
  variant?: 'header' | 'panel';
}

function formatPresenceLabel(count: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale).format(count);
  const prefix = t('presence.onlinePrefix');
  const suffix = t('presence.onlineSuffix');
  return [prefix, formatted, suffix].filter(Boolean).join(' ');
}

export function OnlinePresenceBadge({ onlineCount, className, variant = 'header' }: OnlinePresenceBadgeProps) {
  const locale = useLocale();
  const label = onlineCount === null ? t('presence.syncing') : formatPresenceLabel(onlineCount, locale);
  const formattedCount = onlineCount === null ? '--' : new Intl.NumberFormat(locale).format(onlineCount);
  if (variant === 'panel') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-md border border-border-soft bg-surface-base/55 px-3 py-2',
          className,
        )}
      >
        <Users className="size-4 text-accent-primary" strokeWidth={1.5} aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-minutia uppercase tracking-[var(--tracking-meta)] text-content-primary/40">
            {t('presence.currentOnline')}
          </div>
          <div className="font-mono text-sm text-content-primary">{label}</div>
        </div>
      </div>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-sm border border-border-soft bg-surface-canvas/45 px-2 font-mono text-minutia uppercase tracking-[var(--tracking-meta)] text-content-muted',
        className,
      )}
      aria-label={label}
      title={label}
    >
      <Users className="size-3.5 text-accent-primary" strokeWidth={1.5} aria-hidden="true" />
      <span className="sm:hidden">{formattedCount}</span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
