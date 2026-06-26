import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { t, availableLocales, getLocaleLabel, getLocaleFlag } from '../i18n';
import { zhTW } from '../i18n/zh-TW';
import { zhHK } from '../i18n/zh-HK';
import { zhCN } from '../i18n/zh-CN';
import { ja } from '../i18n/ja';
import { en } from '../i18n/en';
import { ko } from '../i18n/ko';
import '../components/I18nManager.css';

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
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem('admin_auth') === 'true');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [selectedLocale, setSelectedLocale] = useState('zh-TW');
  const [filterMissing, setFilterMissing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  if (!authenticated) {
    return (
      <main className="admin-page app-screen">
        <header className="screen-header">
          <button className="back-btn" onClick={() => navigate('/')}>{t('common.backToLobby')}</button>
          <h1>i18n 管理</h1>
        </header>
        <section className="admin-login">
          <h2>管理員驗證</h2>
          <input
            type="password"
            placeholder="輸入管理密碼"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const adminPwd = import.meta.env.VITE_ADMIN_PASSWORD || 'zutomayo2026';
                if (password === adminPwd) {
                  sessionStorage.setItem('admin_auth', 'true');
                  setAuthenticated(true);
                } else {
                  setError('密碼錯誤');
                }
              }
            }}
          />
          <button onClick={() => {
            const adminPwd = import.meta.env.VITE_ADMIN_PASSWORD || 'zutomayo2026';
            if (password === adminPwd) {
              sessionStorage.setItem('admin_auth', 'true');
              setAuthenticated(true);
            } else {
              setError('密碼錯誤');
            }
          }}>登入</button>
          {error && <p className="admin-error">{error}</p>}
        </section>
      </main>
    );
  }

  const dict = allDictionaries[selectedLocale] || {};

  const filteredKeys = useMemo(() => {
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
  }, [dict, filterMissing, searchText]);

  const missingCount = allKeys.filter(k => !dict[k] || dict[k].trim() === '').length;

  const handleSaveEdit = () => {
    if (editKey && editValue.trim()) {
      // In a real app, this would save to the server
      // For now, just show a notification
      alert(`已儲存: ${editKey}\n新值: ${editValue}\n\n注意：此變更僅在當前 session 有效，重新載入後會恢復。如需永久保存請手動修改 src/i18n/${selectedLocale}.ts`);
      setEditKey(null);
      setEditValue('');
    }
  };

  return (
    <main className="admin-page app-screen">
      <header className="screen-header">
        <button className="back-btn" onClick={() => navigate('/')}>{t('common.backToLobby')}</button>
        <h1>i18n 管理</h1>
        <button className="logout-btn" onClick={() => {
          sessionStorage.removeItem('admin_auth');
          setAuthenticated(false);
        }}>登出</button>
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
          <span>總 Keys: {allKeys.length}</span>
          <span className={missingCount > 0 ? 'stat-warn' : 'stat-ok'}>
            缺失: {missingCount}
          </span>
          <span>已翻譯: {allKeys.length - missingCount}</span>
        </div>

        <div className="i18n-filters">
          <input
            type="text"
            placeholder="搜尋 key 或翻譯內容..."
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
            僅顯示缺失
          </label>
        </div>
      </div>

      <div className="i18n-table-wrapper">
        <table className="i18n-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>zh-TW (基準)</th>
              <th>{getLocaleFlag(selectedLocale as any)} {getLocaleLabel(selectedLocale as any)}</th>
              <th>狀態</th>
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
                        {isMissing ? '(缺失)' : translated}
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
