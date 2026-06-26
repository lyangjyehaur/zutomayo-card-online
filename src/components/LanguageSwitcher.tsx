import type { ChangeEvent } from 'react';
import {
  availableLocales,
  getLocaleFlag,
  getLocaleLabel,
  setLocale,
  t,
  useLocale,
  type Locale,
} from '../i18n';

export function LanguageSwitcher() {
  const locale = useLocale();

  const changeLocale = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = event.target.value as Locale;
    if (availableLocales.includes(nextLocale)) setLocale(nextLocale);
  };

  return (
    <label className="language-switcher" title={`${t('settings.language')}: ${getLocaleLabel(locale)}`}>
      <span className="language-switcher-label">{t('settings.language')}</span>
      <select value={locale} onChange={changeLocale} aria-label={t('settings.language')}>
        {availableLocales.map(option => (
          <option key={option} value={option}>
            {getLocaleFlag(option)} {getLocaleLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
