import { Languages } from 'lucide-react';
import { availableLocales, getLocaleLabel, setLocale, t, useLocale, type Locale } from '../i18n';
import { Select } from '../ui';
import { cn } from '../ui';

interface LanguageSwitcherProps {
  className?: string;
  labelClassName?: string;
  labelMode?: 'responsive' | 'always';
  layout?: 'inline' | 'stacked';
  selectClassName?: string;
  variant?: 'default' | 'header';
}

export function LanguageSwitcher({
  className,
  labelClassName,
  labelMode = 'responsive',
  layout = 'inline',
  selectClassName,
  variant = 'default',
}: LanguageSwitcherProps) {
  const locale = useLocale();

  return (
    <label
      className={cn(
        layout === 'stacked' ? 'grid w-full gap-2' : 'inline-flex shrink-0 items-center gap-1.5',
        variant === 'header' &&
          'min-h-9 gap-1 rounded-sm px-2 text-content-muted transition hover:bg-surface-raised hover:text-content-primary focus-within:bg-surface-raised',
        className,
      )}
      title={`${t('settings.language')}: ${getLocaleLabel(locale)}`}
    >
      <span
        className={cn(
          'text-caption uppercase tracking-[var(--tracking-kicker)] text-content-muted',
          variant === 'header' && 'sr-only',
          labelMode === 'responsive' && 'hidden md:inline',
          labelClassName,
        )}
      >
        {t('settings.language')}
      </span>
      {variant === 'header' && <Languages className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />}
      <Select
        className={cn(
          'min-h-11 max-w-36 font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/60',
          variant === 'header' &&
            'min-h-9 w-auto max-w-28 border-0 bg-transparent px-1 py-1 font-sans text-control normal-case tracking-normal text-content-muted shadow-none focus:border-0 focus:ring-0',
          selectClassName,
        )}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        aria-label={t('settings.language')}
      >
        {availableLocales.map((option) => (
          <option key={option} value={option} className="bg-surface-canvas text-content-primary">
            {getLocaleLabel(option)}
          </option>
        ))}
      </Select>
    </label>
  );
}
