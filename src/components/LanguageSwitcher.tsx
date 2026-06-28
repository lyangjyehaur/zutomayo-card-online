import { availableLocales, getLocaleFlag, getLocaleLabel, setLocale, t, useLocale, type Locale } from '../i18n';

export function LanguageSwitcher() {
  const locale = useLocale();

  return (
    <label className="inline-flex items-center gap-1.5" title={`${t('settings.language')}: ${getLocaleLabel(locale)}`}>
      <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('settings.language')}</span>
      <select
        className="border border-bone/10 bg-lacquer-deep px-2 py-1 text-[10px] uppercase tracking-[0.3em] text-bone/60 focus:outline-none focus:ring-1 focus:ring-gold/40"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
        aria-label={t('settings.language')}
      >
        {availableLocales.map((option) => (
          <option key={option} value={option} className="bg-lacquer-deep text-bone">
            {getLocaleFlag(option)} {getLocaleLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
