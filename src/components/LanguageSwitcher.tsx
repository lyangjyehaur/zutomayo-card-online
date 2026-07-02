import { availableLocales, getLocaleLabel, setLocale, t, useLocale, type Locale } from '../i18n';
import { Select } from './ui';

export function LanguageSwitcher() {
  const locale = useLocale();

  return (
    <label
      className="inline-flex shrink-0 items-center gap-1.5"
      title={`${t('settings.language')}: ${getLocaleLabel(locale)}`}
    >
      <span className="hidden text-[10px] uppercase tracking-[0.3em] text-bone/40 md:inline">
        {t('settings.language')}
      </span>
      <Select
        className="max-w-36 font-mono text-[10px] uppercase tracking-[0.3em] text-bone/60"
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
