import { useCallback, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { t, availableLocales, getLocaleLabel, getLocaleFlag } from '../i18n';
import { zhTW } from '../i18n/zh-TW';
import { zhHK } from '../i18n/zh-HK';
import { zhCN } from '../i18n/zh-CN';
import { ja } from '../i18n/ja';
import { en } from '../i18n/en';
import { ko } from '../i18n/ko';
import { ApiError, adminLogin } from '../api/client';
import '../components/I18nManager.css';

const ADMIN_TOKEN_KEY = 'zutomayo_admin_token';

const allDictionaries: Record<string, Record<string, string>> = {
  'zh-TW': zhTW as unknown as Record<string, string>,
  'zh-HK': zhHK as unknown as Record<string, string>,
  'zh-CN': zhCN as unknown as Record<string, string>,
  'ja': ja as unknown as Record<string, string>,
  'en': en as unknown as Record<string, string>,
  'ko': ko as unknown as Record<string, string>,
};

const allKeys = Object.keys(zhTW as Record<string, string>);

export function I18nManager() {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem(ADMIN_TOKEN_KEY)));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [selectedLocale, setSelectedLocale] = useState('zh-TW');
  const [filterMissing, setFilterMissing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const filteredKeys = useMemo(() => {
    const dict = allDictionaries[selectedLocale] || {};
    let keys = allKeys;
    if (filterMissing) {
      keys = keys.filter(k => !dict[k] || dict[k].trim() === '');
    }
    if (searchText) {
      const q = searchText.toLowerCase();
      keys = keys.filter(k =>
        k.toLowerCase().includes(q) ||
        (dict[k] || '').toLowerCase().includes(q) ||
        ((zhTW as Record<string, string>)[k] || '').toLowerCase().includes(q)
      );
    }
    return keys;
  }, [selectedLocale, filterMissing, searchText]);

  const handleLogin = useCallback(async () => {
    setError('');
    setLoggingIn(true);
    try {
      const { token } = await adminLogin(password);
      sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
      setAuthenticated(true);
      setPassword('');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('admin.loginFailed');
      setError(msg === 'Invalid password' ? t('admin.passwordError') : msg);
    } finally {
      setLoggingIn(false);
    }
  }, [password]);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setAuthenticated(false);
  }, []);

  if (!authenticated) {
    return (
      <main className="admin-page app-screen">
        <header className="screen-header">
          <button className="back-btn" onClick={() => navigate('/')}>{t('common.backToLobby')}</button>
          <h1>{t('admin.i18nTitle')}</h1>
        </header>
        <section className="admin-login">
          <h2>{t('admin.adminVerify')}</h2>
          <input
            type="password"
            placeholder={t('admin.passwordPlaceholder')}
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !loggingIn) void handleLogin(); }}
            disabled={loggingIn}
          />
          <button onClick={() => void handleLogin()} disabled={loggingIn || !password}>
            {loggingIn ? t('admin.verifying') : t('admin.login')}
          </button>
          {error && <p className="admin-error">{error}</p>}
        </section>
      </main>
    );
  }

  const dict = allDictionaries[selectedLocale] || {};

  const missingCount = allKeys.filter(k => !dict[k] || dict[k].trim() === '').length;

  const handleSaveEdit = () => {
    if (editKey && editValue.trim()) {
      alert(`${t('admin.i18nSaved')}: ${editKey}\n${t('admin.i18nNewValue')}: ${editValue}\n\n${t('admin.i18nSaveNotice')}src/i18n/${selectedLocale}.ts`);
      setEditKey(null);
      setEditValue('');
    }
  };

  return (
    <main className="admin-page app-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => navigate('/')}>{t('common.backToLobby')}</button>
        <h1>{t('admin.i18nTitle')}</h1>
        <button className="logout-btn" onClick={handleLogout}>{t('admin.logout')}</button>
      </header>

      <div className="i18n-controls">
        <div className="i18n-locale-tabs">
          {availableLocales.map(locale => (
            <button
              key={locale}
              className={`locale-tab ${selectedLocale === locale ? 'active' : ''}`}
              onClick={() => setSelectedLocale(locale)}
            >
              {getLocaleFlag(locale as any)} {getLocaleLabel(locale as any)}
            </button>
          ))}
        </div>

        <div className="i18n-stats">
          <span>{t('admin.i18nTotalKeys')}: {allKeys.length}</span>
          <span className={missingCount > 0 ? 'stat-warn' : 'stat-ok'}>
            {t('admin.i18nMissing')}: {missingCount}
          </span>
          <span>{t('admin.i18nTranslated')}: {allKeys.length - missingCount}</span>
        </div>

        <div className="i18n-filters">
          <input
            type="text"
            placeholder={t('admin.i18nSearchPlaceholder')}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="i18n-search"
          />
          <label className="i18n-checkbox">
            <input
              type="checkbox"
              checked={filterMissing}
              onChange={e => setFilterMissing(e.target.checked)}
            />
            {t('admin.i18nFilterMissing')}
          </label>
        </div>
      </div>

      <div className="i18n-table-wrapper">
        <table className="i18n-table">
          <thead>
            <tr>
              <th>{t('admin.i18nColKey')}</th>
              <th>{t('admin.i18nColBase')}</th>
              <th>{getLocaleFlag(selectedLocale as any)} {getLocaleLabel(selectedLocale as any)}</th>
              <th>{t('admin.i18nColStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredKeys.map(key => {
              const baseValue = (zhTW as Record<string, string>)[key] || '';
              const translated = dict[key] || '';
              const isMissing = !translated || translated.trim() === '';
              const isSame = translated === baseValue && selectedLocale !== 'zh-TW';

              return (
                <tr key={key} className={isMissing ? 'row-missing' : isSame ? 'row-same' : ''}>
                  <td className="i18n-key">{key}</td>
                  <td className="i18n-base">{baseValue}</td>
                  <td className="i18n-translated" onClick={() => {
                    if (!isMissing) {
                      setEditKey(key);
                      setEditValue(translated);
                    }
                  }}>
                    {editKey === key ? (
                      <div className="i18n-edit">
                        <input
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); }}
                          autoFocus
                        />
                        <button onClick={handleSaveEdit}>✓</button>
                        <button onClick={() => setEditKey(null)}>✕</button>
                      </div>
                    ) : (
                      <span className={isMissing ? 'text-missing' : ''}>
                        {isMissing ? t('admin.i18nMissingBadge') : translated}
                      </span>
                    )}
                  </td>
                  <td className="i18n-status">
                    {isMissing ? '❌' : isSame ? '⚠️' : '✅'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
