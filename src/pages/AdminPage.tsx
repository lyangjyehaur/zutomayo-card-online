import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';

export function AdminPage() {
  const navigate = useNavigate();

  return (
    <main className="admin-page app-screen">
      <header className="screen-header">
        <div>
          <span>{t('lobby.menu')}</span>
          <h1>{t('admin.title')}</h1>
        </div>
        <div className="screen-actions">
          <button className="secondary-action" type="button" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </button>
        </div>
      </header>
      <iframe className="admin-frame" src="/admin/index.html" title={t('admin.title')} />
    </main>
  );
}
