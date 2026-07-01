import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swords, Bot, LayoutGrid } from 'lucide-react';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { VersionUpdateTrigger } from '../components/VersionUpdateTrigger';
import { AuthSection } from '../components/lobby/AuthSection';
import { AppDrawer } from '../components/AppDrawer';
import { t } from '../i18n';

// 向後相容：App.tsx 從此檔案匯入這些工具函式/常數，實際定義已移至 components/lobby/shared.ts。
export { DEFAULT_DECK_NAME, onlineDeckName, selectedDeckName } from '../components/lobby/shared';

interface LobbyPageProps {
  onAuthChanged: () => void | Promise<void>;
  onShowTutorial: () => void;
}

type Entry = {
  to: '/online' | '/ai' | '/deck-builder';
  titleKey: 'lobby.onlineTitle' | 'lobby.aiBattle' | 'lobby.deckEditor';
  subtitle: string;
  caption: string;
  Icon: typeof Swords;
};

const ENTRIES: Entry[] = [
  {
    to: '/online',
    titleKey: 'lobby.onlineTitle',
    subtitle: 'Online Duel',
    caption: '與遠方的對手進行儀式',
    Icon: Swords,
  },
  {
    to: '/ai',
    titleKey: 'lobby.aiBattle',
    subtitle: 'VS. CPU',
    caption: '於靜室中獨自演練',
    Icon: Bot,
  },
  {
    to: '/deck-builder',
    titleKey: 'lobby.deckEditor',
    subtitle: 'Deck Editor',
    caption: '編織你的命運序列',
    Icon: LayoutGrid,
  },
];

async function pickRandomCardImage(): Promise<string | null> {
  const { getAllCardDefs } = await import('../game/cards/loader');
  const cards = getAllCardDefs().filter((card) => typeof card.image === 'string' && card.image.length > 0);
  if (cards.length === 0) return null;
  return cards[Math.floor(Math.random() * cards.length)].image;
}

export function LobbyPage({ onAuthChanged }: LobbyPageProps) {
  const navigate = useNavigate();
  // 每次進入首頁隨機取一張卡牌作為模糊背景
  const [bgImage, setBgImage] = useState<string | null>(null);
  // 首次訪問引導彈窗
  const [showDeckIntro, setShowDeckIntro] = useState(false);

  // 每次 mount 時重新隨機取一張（確保返回首頁也有背景）
  useEffect(() => {
    let cancelled = false;
    void pickRandomCardImage().then((next) => {
      if (!cancelled && next) setBgImage(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 檢測首次訪問
  useEffect(() => {
    const seen = localStorage.getItem('zutomayo_deck_intro_seen');
    if (!seen) {
      setShowDeckIntro(true);
    }
  }, []);

  const handleDismissIntro = () => {
    localStorage.setItem('zutomayo_deck_intro_seen', 'true');
    setShowDeckIntro(false);
  };

  const handleGoToDeckBuilder = () => {
    localStorage.setItem('zutomayo_deck_intro_seen', 'true');
    setShowDeckIntro(false);
    navigate('/deck-builder');
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-lacquer-deep font-sans text-bone">
      {/* 環境層：隨機卡牌模糊背景 + 紫光暈 + 點陣紋理 */}
      <div className="pointer-events-none absolute inset-0">
        {bgImage && (
          <img
            src={bgImage}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="absolute inset-0 size-full scale-125 object-cover opacity-30 blur-[4px] saturate-[1.2]"
          />
        )}
        {/* 暗化遮罩，確保文字可讀（漸層：中央較透、邊緣較暗） */}
        <div className="absolute inset-0 bg-lacquer-deep/55" />
        <div className="absolute left-1/2 top-1/2 h-[80vh] w-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-vermilion/10 blur-[140px]" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:radial-gradient(rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:3px_3px]" />
      </div>

      {/* 頂部 Header */}
      <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between gap-3 px-4 md:px-8">
        <div className="flex items-center gap-3">
          <div className="size-2 rounded-full bg-vermilion shadow-[0_0_12px] shadow-vermilion/60" />
          <span className="font-display text-xl italic tracking-tight">{t('app.title')}</span>
          <span className="ml-3 hidden text-[10px] uppercase tracking-[0.3em] text-bone/40 md:inline">
            {t('app.subtitle')}
          </span>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2 md:gap-4">
          <LanguageSwitcher />
          <AuthSection onAuthChanged={onAuthChanged} />
        </div>
      </header>

      {/* 中央三聯幅卡 */}
      <section className="relative z-10 h-full overflow-y-auto px-4 pb-14 pt-24 md:flex md:items-center md:justify-center md:px-8 md:pb-12 md:pt-20">
        <div className="grid w-full max-w-6xl grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
          {ENTRIES.map(({ to, titleKey, subtitle, caption, Icon }, i) => (
            <button
              key={to}
              type="button"
              onClick={() => navigate(to)}
              className="group relative flex min-h-[11rem] flex-col justify-between overflow-hidden rounded-sm bg-lacquer p-5 text-left ring-1 ring-bone/10 transition-all duration-500 hover:-translate-y-1 hover:ring-gold/50 hover:shadow-[0_30px_80px_-20px] hover:shadow-vermilion/30 md:h-[460px] md:p-8"
            >
              {/* 卡內裝飾：內框線 */}
              <div className="pointer-events-none absolute inset-3 rounded-sm ring-1 ring-bone/5 transition-all duration-500 group-hover:ring-gold/20" />
              {/* 卡內裝飾：底部漸層 */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-vermilion/10 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

              {/* 頂：編號 + 圖示 */}
              <div className="relative flex items-start justify-between">
                <span className="font-mono text-[10px] tracking-[0.3em] text-gold/70">0{i + 1} / 03</span>
                <Icon className="size-5 text-bone/40 transition-colors group-hover:text-gold" strokeWidth={1.25} />
              </div>

              {/* 中：副標 + 主標 + 說明 */}
              <div className="relative">
                <div className="mb-2 text-[10px] uppercase tracking-[0.35em] text-bone/40">{subtitle}</div>
                <h2 className="font-display text-5xl font-extrabold leading-none tracking-tight">{t(titleKey)}</h2>
                <p className="mt-4 max-w-[22ch] text-sm leading-relaxed text-bone/50">{caption}</p>
              </div>

              {/* 底：Enter + 箭頭 */}
              <div className="relative flex items-center justify-between border-t border-bone/10 pt-5">
                <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40 transition-colors group-hover:text-bone/80">
                  Enter
                </span>
                <span className="font-display text-xl italic text-gold/60 transition-transform duration-500 group-hover:translate-x-1 group-hover:text-gold">
                  →
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 底部 Footer */}
      <footer className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-4 pb-4 md:px-8">
        {/* 教學入口 */}
        <button
          type="button"
          onClick={() => navigate('/tutorial')}
          className="group flex w-full max-w-md items-center justify-center gap-3 rounded-sm border border-gold/30 bg-gradient-to-r from-gold/8 via-gold/5 to-gold/8 px-6 py-3 text-gold transition-all hover:border-gold/50 hover:bg-gold/10 hover:shadow-[0_8px_32px_-8px] hover:shadow-gold/30"
        >
          <span className="text-[10px] uppercase tracking-[0.3em]">{t('lobby.tutorial')}</span>
          <span className="font-display text-xl italic transition-transform group-hover:translate-x-1">→</span>
        </button>

        {/* 原有的 footer 信息 */}
        <div className="flex w-full items-center justify-between text-[10px] uppercase tracking-[0.3em] text-bone/30">
          <VersionUpdateTrigger />
          <span className="hidden md:inline">{t('app.footerAlpha')}</span>
          <span className="font-mono">{t('app.footerCopyright')}</span>
        </div>
      </footer>

      {/* 首次訪問引導彈窗 */}
      <AppDrawer
        open={showDeckIntro}
        title={t('intro.deckTitle')}
        description={t('intro.deckDescription')}
        kicker="Welcome"
        actions={[
          {
            label: t('intro.goToDeckBuilder'),
            onClick: handleGoToDeckBuilder,
            tone: 'primary',
            eventName: 'deck-intro-go-to-builder',
          },
          {
            label: t('intro.exploreLater'),
            onClick: handleDismissIntro,
            tone: 'secondary',
            eventName: 'deck-intro-dismiss',
          },
        ]}
      />
    </main>
  );
}
