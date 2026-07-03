import { availableLocales, getLocaleLabel, setLocale, t, useLocale, type Locale } from '../i18n';
import { Select } from './ui';
import { cn } from './ui/utils';

interface LanguageSwitcherProps {
  className?: string;
  labelClassName?: string;
  labelMode?: 'responsive' | 'always';
  layout?: 'inline' | 'stacked';
  selectClassName?: string;
}

export function LanguageSwitcher({
  className,
  labelClassName,
  labelMode = 'responsive',
  layout = 'inline',
  selectClassName,
}: LanguageSwitcherProps) {
  const locale = useLocale();

  return (
    <label
      className={cn(
        layout === 'stacked' ? 'grid w-full gap-2' : 'inline-flex shrink-0 items-center gap-1.5',
        className,
      )}
      title={`${t('settings.language')}: ${getLocaleLabel(locale)}`}
    >
      <span
        className={cn(
          'text-[10px] uppercase tracking-[0.3em] text-bone/40',
          labelMode === 'responsive' && 'hidden md:inline',
          labelClassName,
        )}
      >
        {t('settings.language')}
      </span>
      <Select
        className={cn('min-h-11 max-w-36 font-mono text-[10px] uppercase tracking-[0.3em] text-bone/60', selectClassName)}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        aria-label={t('settings.language')}
      >
        {availableLocales.map((option) => (
          <option key={option} value={option} className="bg-lacquer-deep text-bone">
            {getLocaleLabel(option)}
          </option>
        ))}
      </Select>
    </label>
  );
}
