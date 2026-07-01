import { availableLocales, getLocaleLabel, setLocale, t, useLocale, type Locale } from '../i18n';

export function LanguageSwitcher() {
  const locale = useLocale();

  return (
    <label
      className="inline-flex shrink-0 items-center gap-1.5"
      title={`${t('settings.language')}: ${getLocaleLabel(locale)}`}
    >
      <span className="hidden text-[10px] uppercase tracking-[0.3em] text-bone/40 sm:inline">
        {t('settings.language')}
      </span>
      <select
        className="max-w-20 border border-bone/10 bg-lacquer-deep px-1.5 py-1 text-[9px] uppercase tracking-[0.12em] text-bone/60 focus:outline-none focus:ring-1 focus:ring-gold/40 sm:max-w-none sm:px-2 sm:text-[10px] sm:tracking-[0.3em]"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        aria-label={t('settings.language')}
      >
        {availableLocales.map((option) => (
          <option key={option} value={option} className="bg-lacquer-deep text-bone">
            {getLocaleLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
