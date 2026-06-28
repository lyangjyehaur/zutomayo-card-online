import { useNavigate } from 'react-router-dom';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { AuthSection } from '../components/lobby/AuthSection';
import { t } from '../i18n';

// 向後相容：App.tsx 從此檔案匯入這些工具函式/常數，實際定義已移至 components/lobby/shared.ts。
export { DEFAULT_DECK_NAME, onlineDeckName, selectedDeckName } from '../components/lobby/shared';

interface LobbyPageProps {
  onAuthChanged: () => void | Promise<void>;
  onShowTutorial: () => void;
}

export function LobbyPage({ onAuthChanged, onShowTutorial }: LobbyPageProps) {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen container mx-auto flex flex-col gap-6 p-4">
      {/* 頂部列：標題 + 語言選擇 */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-sm opacity-70">{t('lobby.menu')}</span>
          <h1 className="text-3xl font-bold text-primary">{t('app.title')}</h1>
          <p className="text-sm opacity-70">{t('app.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
        </div>
      </header>

      {/* 主選單三個大卡片 */}
      <section className="lobby-menu-cards grid gap-4 sm:grid-cols-2 lg:grid-cols-3 flex-1">
        <button
          className="lobby-menu-card card bg-base-200 hover:shadow-2xl cursor-pointer transition-shadow"
          type="button"
          onClick={() => navigate('/online')}
        >
          <div className="card-body items-center text-center gap-2 p-8">
            <span className="lobby-menu-icon text-4xl">🌐</span>
            <h2 className="card-title">{t('lobby.onlineTitle')}</h2>
            <p className="text-sm opacity-70">{t('game.onlineMode')}</p>
          </div>
        </button>
        <button
          className="lobby-menu-card card bg-base-200 hover:shadow-2xl cursor-pointer transition-shadow"
          type="button"
          onClick={() => navigate('/ai')}
        >
          <div className="card-body items-center text-center gap-2 p-8">
            <span className="lobby-menu-icon text-4xl">🤖</span>
            <h2 className="card-title">{t('lobby.aiBattle')}</h2>
            <p className="text-sm opacity-70">{t('lobby.difficulty')}</p>
          </div>
        </button>
        <button
          className="lobby-menu-card card bg-base-200 hover:shadow-2xl cursor-pointer transition-shadow"
          type="button"
          onClick={() => navigate('/deck-builder')}
        >
          <div className="card-body items-center text-center gap-2 p-8">
            <span className="lobby-menu-icon text-4xl">🗂️</span>
            <h2 className="card-title">{t('lobby.deckEditor')}</h2>
            <p className="text-sm opacity-70">{t('deck.localDecks')}</p>
          </div>
        </button>
      </section>

      {/* 底部區：登入區塊 + 次要連結 */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3 lg:max-w-sm lg:flex-1">
          <AuthSection onAuthChanged={onAuthChanged} />
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label={t('nav.primary')}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/leaderboard')}>
            🏆 {t('leaderboard.title')}
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/history')}>
            📜 {t('lobby.matchHistory')}
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onShowTutorial}>
            ❓ {t('lobby.tutorial')}
          </button>
        </nav>
      </section>
    </main>
  );
}
