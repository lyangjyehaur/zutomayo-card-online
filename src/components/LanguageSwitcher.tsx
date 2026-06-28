import { availableLocales, getLocaleFlag, getLocaleLabel, setLocale, t, useLocale } from '../i18n';

export function LanguageSwitcher() {
  const locale = useLocale();

  return (
    <div className="dropdown dropdown-end" title={`${t('settings.language')}: ${getLocaleLabel(locale)}`}>
      <button className="btn btn-ghost btn-xs" type="button" tabIndex={0}>
        {getLocaleFlag(locale)} {getLocaleLabel(locale)}
      </button>
      <ul className="menu dropdown-content bg-base-200 rounded-box z-[1] mt-2 w-40 p-2 shadow-xl" tabIndex={0}>
        {availableLocales.map((option) => (
          <li key={option}>
            <button type="button" className={option === locale ? 'active' : ''} onClick={() => setLocale(option)}>
              {getLocaleFlag(option)} {getLocaleLabel(option)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
