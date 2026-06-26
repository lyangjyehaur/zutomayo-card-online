import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';

export function AdminPage() {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(() => {
    return sessionStorage.getItem('admin_auth') === 'true';
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!authenticated) {
    return (
      <main className="admin-page app-screen">
        <header className="screen-header">
          <button className="back-btn" type="button" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </button>
          <h1>{t('admin.title')}</h1>
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

  return (
    <main className="admin-page app-screen">
      <header className="screen-header">
        <button className="back-btn" type="button" onClick={() => navigate('/')}>
          {t('common.backToLobby')}
        </button>
        <h1>{t('admin.title')}</h1>
        <button className="logout-btn" onClick={() => {
          sessionStorage.removeItem('admin_auth');
          setAuthenticated(false);
        }}>登出</button>
      </header>
      <section className="admin-launcher">
        <p>卡牌數據管理後台以獨立頁面運行，避免與遊戲主應用衝突。</p>
        <button className="primary-action" onClick={() => window.open('/admin/index.html', '_blank')}>
          🔗 開啟管理後台
        </button>
      </section>
    </main>
  );
}
