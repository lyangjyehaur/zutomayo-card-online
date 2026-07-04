import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Swords, Bot, LayoutGrid, Menu } from 'lucide-react';
import { AppDrawer } from '../components/AppDrawer';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { VersionUpdateTrigger } from '../components/VersionUpdateTrigger';
import { AuthSection } from '../components/lobby/AuthSection';
import { Button, Card, IconButton, PageShell, Panel } from '../components/ui';
import { t, type TranslationKey } from '../i18n';

// 向後相容：App.tsx 從此檔案匯入這些工具函式/常數，實際定義已移至 components/lobby/shared.ts。
export { DEFAULT_DECK_NAME, aiOpponentDeckName, onlineDeckName, selectedDeckName } from '../components/lobby/shared';

interface LobbyPageProps {
  onAuthChanged: () => void | Promise<void>;
}

type Entry = {
  to: '/online' | '/ai' | '/deck-builder';
  titleKey: TranslationKey;
  subtitle: string;
  captionKey: TranslationKey;
  Icon: typeof Swords;
};

const ENTRIES: Entry[] = [
  {
    to: '/online',
    titleKey: 'lobby.onlineTitle',
    subtitle: 'Online Duel',
    captionKey: 'lobby.homeOnlineCaption',
    Icon: Swords,
  },
  {
    to: '/ai',
    titleKey: 'lobby.aiBattle',
    subtitle: 'VS. CPU',
    captionKey: 'lobby.homeAiCaption',
    Icon: Bot,
  },
  {
    to: '/deck-builder',
    titleKey: 'lobby.deckEditor',
    subtitle: 'Deck Editor',
    captionKey: 'lobby.homeDeckCaption',
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
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    <PageShell>
      {/* 環境層：隨機卡牌模糊背景 + 紫光暈 + 點陣紋理 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
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
        <div className="absolute inset-0 bg-surface-canvas/55" />
        <div className="absolute left-1/2 top-1/2 h-[var(--ambient-glow-size-lg)] w-[var(--ambient-glow-size-lg)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-action/8 blur-[var(--ambient-glow-blur-md)]" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:var(--pattern-dot)] [background-size:var(--pattern-dot-size)]" />
      </div>

      {/* 頂部 Header */}
      <header className="absolute inset-x-0 top-0 z-[var(--z-sticky)] flex min-h-16 items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-2 rounded-full bg-accent-action shadow-status-dot" />
          <span className="truncate font-display text-title-sm italic leading-none tracking-tight md:text-xl">
            {t('app.title')}
          </span>
          <span className="ml-3 hidden text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40 md:inline">
            {t('app.subtitle')}
          </span>
        </div>
        <div className="hidden min-w-0 items-center justify-end gap-2 sm:flex md:gap-4">
          <LanguageSwitcher />
          <AuthSection onAuthChanged={onAuthChanged} />
        </div>
        <IconButton
          className="sm:hidden"
          variant="secondary"
          label={t('lobby.menu')}
          icon={<Menu className="size-4" strokeWidth={1.25} aria-hidden="true" />}
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(true)}
        />
      </header>

      <AppDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={t('lobby.menu')}
        kicker={t('settings.language')}
        actions={[]}
      >
        <div className="grid gap-4">
          <LanguageSwitcher
            labelClassName="inline"
            labelMode="always"
            layout="stacked"
            selectClassName="max-w-none"
          />
          <AuthSection onAuthChanged={onAuthChanged} />
        </div>
      </AppDrawer>

      {/* 中央三聯幅卡 */}
      <section className="lobby-home-content relative z-[var(--z-dropdown)] h-full overflow-y-auto px-4 pb-10 pt-32 sm:pt-24 md:flex md:items-center md:justify-center md:px-8 md:pb-12 md:pt-20">
        <div className="grid w-full max-w-6xl grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
          {ENTRIES.map(({ to, titleKey, subtitle, captionKey, Icon }, i) => (
            <Card
              as="button"
              key={to}
              type="button"
              onClick={() => navigate(to)}
              className="lobby-entry-card group relative flex min-h-[11rem] flex-col justify-between overflow-hidden rounded-sm bg-surface-base p-5 text-left ring-1 ring-content-primary/10 transition-all duration-[var(--motion-duration-page)] hover:-translate-y-1 hover:ring-accent-primary/50 hover:shadow-glow-action md:h-[60dvh] md:p-8 xl:h-[460px]"
            >
              {/* 卡內裝飾：內框線 */}
              <div className="pointer-events-none absolute inset-3 rounded-sm ring-1 ring-content-primary/5 transition-all duration-[var(--motion-duration-page)] group-hover:ring-accent-primary/20" />
              {/* 卡內裝飾：底部漸層 */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-accent-action/10 to-transparent opacity-0 transition-opacity duration-[var(--motion-duration-page)] group-hover:opacity-100" />

              {/* 頂：編號 + 圖示 */}
              <div className="relative flex items-start justify-between">
                <span className="font-mono text-caption tracking-[var(--tracking-kicker)] text-accent-primary/70">0{i + 1} / 03</span>
                <Icon className="size-5 text-content-primary/40 transition-colors group-hover:text-accent-primary" strokeWidth={1.25} />
              </div>

              {/* 中：副標 + 主標 + 說明 */}
              <div className="relative">
                <div className="mb-2 text-caption uppercase tracking-[var(--tracking-label)] text-content-primary/40 md:tracking-[var(--tracking-kicker)]">
                  {subtitle}
                </div>
                <h2 className="font-display text-lobby-card-title font-extrabold leading-none tracking-tight md:text-5xl">
                  {t(titleKey)}
                </h2>
                <p className="lobby-entry-caption mt-4 max-w-[22ch] text-body leading-relaxed text-content-primary/50">
                  {t(captionKey)}
                </p>
              </div>

              {/* 底：Enter + 箭頭 */}
              <div className="relative flex items-center justify-between border-t border-content-primary/10 pt-5">
                <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40 transition-colors group-hover:text-content-primary/80">
                  Enter
                </span>
                <span className="font-display text-xl italic text-accent-primary/60 transition-transform duration-[var(--motion-duration-page)] group-hover:translate-x-1 group-hover:text-accent-primary">
                  →
                </span>
              </div>
            </Card>
          ))}
          <Button
            type="button"
            onClick={() => navigate('/tutorial')}
            className="mt-1 flex w-full items-center justify-center gap-3 border-accent-primary/30 bg-accent-primary/10 text-accent-primary sm:hidden"
            variant="secondary"
          >
            <span className="text-caption uppercase tracking-[var(--tracking-control)]">{t('lobby.tutorial')}</span>
            <span className="font-display text-xl italic">→</span>
          </Button>
        </div>
      </section>

      {/* 底部 Footer */}
      <footer className="lobby-home-footer pointer-events-none absolute inset-x-0 bottom-0 z-[var(--z-sticky)] hidden flex-col items-center gap-3 px-4 pb-4 sm:flex md:px-8">
        {/* 教學入口 */}
        <Button
          type="button"
          onClick={() => navigate('/tutorial')}
          className="lobby-tutorial-button pointer-events-auto group flex w-full max-w-md items-center justify-center gap-3 rounded-sm border border-accent-primary/30 bg-gradient-to-r from-accent-primary/8 via-accent-primary/5 to-accent-primary/8 px-6 py-3 text-accent-primary transition-all hover:border-accent-primary/50 hover:bg-accent-primary/10 hover:shadow-glow-primary"
          variant="secondary"
        >
          <span className="text-caption uppercase tracking-[var(--tracking-kicker)]">{t('lobby.tutorial')}</span>
          <span className="font-display text-xl italic transition-transform group-hover:translate-x-1">→</span>
        </Button>

        {/* 原有的 footer 信息 */}
        <div className="pointer-events-auto flex w-full items-center justify-between text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/30">
          <VersionUpdateTrigger />
          <Button
            type="button"
            className="hidden min-h-10 items-center text-content-primary/30 transition-colors hover:text-accent-primary md:inline-flex"
            variant="ghost"
            size="sm"
            onClick={() => navigate('/feedback')}
          >
            {t('app.footerAlpha')}
          </Button>
          <span className="font-mono">
            {t('app.footerCopyright')}
            <a
              className="inline-flex min-h-10 items-center text-content-primary/40 underline-offset-4 transition-colors hover:text-accent-primary hover:underline focus-visible:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60"
              href="https://zutomayocard.net"
              target="_blank"
              rel="noreferrer"
            >
              ZUTOMAYO
            </a>
            {t('app.footerCopyrightSuffix')}
          </span>
        </div>
      </footer>

      {/* 首次訪問引導——頂部橫幅卡片，不遮罩背景 */}
      {showDeckIntro && (
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-overlay)] flex justify-center px-4 pb-4 sm:bottom-auto sm:top-0 sm:pb-0 sm:pt-4">
          <Panel
            className="max-h-[calc(100dvh-2rem)] w-full max-w-[640px] overflow-y-auto bg-gradient-to-br from-surface-canvas via-surface-canvas to-surface-base text-content-primary ring-accent-primary/40 backdrop-blur"
            size="lg"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">Welcome</span>
              <Button
                type="button"
                aria-label={t('common.close')}
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={handleDismissIntro}
                data-umami-event="deck-intro-dismiss"
              >
                {t('common.close')}
              </Button>
            </div>
            <h2 className="font-display text-xl italic leading-tight text-content-primary sm:text-2xl">{t('intro.deckTitle')}</h2>
            <p className="mt-2 text-body leading-relaxed text-content-primary/70">{t('intro.deckDescription')}</p>
            <div className="mt-4 flex flex-col justify-end gap-2 sm:flex-row">
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="min-h-11"
                onClick={handleGoToDeckBuilder}
                data-umami-event="deck-intro-go-to-builder"
              >
                {t('intro.goToDeckBuilder')}
              </Button>
              <Button type="button" size="sm" variant="secondary" className="min-h-11" onClick={handleDismissIntro}>
                {t('intro.exploreLater')}
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </PageShell>
  );
}
