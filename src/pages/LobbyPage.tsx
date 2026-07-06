import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Code2,
  ExternalLink,
  Github,
  LayoutGrid,
  Menu,
  MessageCircle,
  Palette,
  ScrollText,
  Send,
  Swords,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react';
import { AppDrawer } from '../components/AppDrawer';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { VersionUpdateTrigger } from '../components/VersionUpdateTrigger';
import { AuthSection } from '../components/lobby/AuthSection';
import {
  DEFAULT_ABOUT_PAGE_CONFIG,
  fetchAboutPage,
  type AboutPageConfig,
  type AboutPageLink,
} from '../api/client';
import { AppHeader, Button, Dialog, IconButton, PageShell, Panel } from '../ui';
import { ChronosDial } from '../ui/game';
import { t, type TranslationKey } from '../i18n';

// 向後相容：App.tsx 從此檔案匯入這些工具函式/常數，實際定義已移至 components/lobby/shared.ts。
export { DEFAULT_DECK_NAME, aiOpponentDeckName, onlineDeckName, selectedDeckName } from '../components/lobby/shared';

interface LobbyPageProps {
  onAuthChanged: () => void | Promise<void>;
}

/**
 * 首頁「夜間放送 Night Broadcast」— Design System v2 從零設計。
 *
 * 構圖：浮動膠囊頁首（同對戰 HUD）＋ 主視覺（wordmark × ChronosDial 待機儀表）
 * ＋ 底部頻道列（CH.01–05 模式入口）。沒有通欄 header、沒有滿版卡片牆、
 * 沒有隨機卡圖模糊背景 — 卡牌彩度留給對戰。
 */
type Channel = {
  to: string;
  no: string;
  titleKey: TranslationKey;
  captionKey: TranslationKey;
  Icon: typeof Swords;
};

const CHANNELS: Channel[] = [
  { to: '/online', no: '01', titleKey: 'lobby.onlineTitle', captionKey: 'lobby.homeOnlineCaption', Icon: Swords },
  { to: '/ai', no: '02', titleKey: 'lobby.aiBattle', captionKey: 'lobby.homeAiCaption', Icon: Bot },
  { to: '/deck-builder', no: '03', titleKey: 'lobby.deckEditor', captionKey: 'lobby.homeDeckCaption', Icon: LayoutGrid },
  { to: '/leaderboard', no: '04', titleKey: 'leaderboard.title', captionKey: 'lobby.homeLeaderboardCaption', Icon: Trophy },
  { to: '/history', no: '05', titleKey: 'lobby.matchHistory', captionKey: 'lobby.homeHistoryCaption', Icon: ScrollText },
];

const PROJECT_CREDITS = [
  { labelKey: 'lobby.projectAuthor', valueField: 'author', Icon: UserRound },
  { labelKey: 'lobby.projectArtist', valueField: 'artist', Icon: Palette },
] satisfies Array<{
  labelKey: TranslationKey;
  valueField: 'author' | 'artist';
  Icon: typeof UserRound;
}>;

// 待機儀表的靜態 Chronos 狀態（真夜中・夜側）— 純裝飾，與對戰共用同一元件
const IDLE_CHRONOS = { position: 0, nightSidePlayer: 1 as const };

function AboutFeatureLink({ link, Icon }: { link: AboutPageLink; Icon: typeof Github }) {
  return (
    <a
      className="group flex min-w-0 gap-3 rounded-sm border border-border-soft bg-surface-base/50 p-3 text-left transition hover:border-accent-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
      href={link.url}
      target="_blank"
      rel="noreferrer"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-accent-primary/75" strokeWidth={1.5} aria-hidden="true" />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-body font-semibold leading-tight text-content-primary">
          {link.title}
          <ExternalLink
            className="size-3 shrink-0 text-content-dim transition group-hover:text-accent-primary"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </span>
        <span className="mt-1 block text-caption leading-relaxed text-content-muted">{link.description}</span>
      </span>
    </a>
  );
}

export function LobbyPage({ onAuthChanged }: LobbyPageProps) {
  const navigate = useNavigate();
  const [showDeckIntro, setShowDeckIntro] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutConfig, setAboutConfig] = useState<AboutPageConfig>(DEFAULT_ABOUT_PAGE_CONFIG);

  useEffect(() => {
    const seen = localStorage.getItem('zutomayo_deck_intro_seen');
    if (!seen) setShowDeckIntro(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAboutPage().then((config) => {
      if (!cancelled) setAboutConfig(config);
    });
    return () => {
      cancelled = true;
    };
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

  const communityLinks = [
    { labelKey: 'lobby.projectQQ', href: aboutConfig.community.qqUrl, Icon: Users },
    { labelKey: 'lobby.projectTelegram', href: aboutConfig.community.telegramUrl, Icon: Send },
    { labelKey: 'lobby.projectDiscord', href: aboutConfig.community.discordUrl, Icon: MessageCircle },
  ] satisfies Array<{ labelKey: TranslationKey; href: string; Icon: typeof Users }>;

  return (
    <PageShell>
      {/* 環境層：安靜的中央光暈＋夜色微染＋點陣（與戰場同語言，無卡圖背景） */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute left-1/2 top-1/2 h-[70vh] w-[110vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[oklch(from_var(--time-night)_l_c_h_/_0.07)] blur-[var(--ambient-glow-blur-lg)]" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:var(--pattern-dot)] [background-size:var(--pattern-dot-size)]" />
      </div>

      <AppHeader
        subtitle={t('app.subtitle')}
        actions={
          <>
            <div className="hidden items-center gap-3 sm:flex">
              <LanguageSwitcher
                className="shrink-0"
                labelMode="responsive"
                selectClassName="min-h-8 max-w-24 text-[11px]"
              />
              <div className="h-5 w-px bg-border-soft" aria-hidden="true" />
              <AuthSection onAuthChanged={onAuthChanged} compact />
            </div>
            <IconButton
              className="sm:hidden"
              variant="ghost"
              label={t('lobby.menu')}
              icon={<Menu className="size-4" strokeWidth={1.25} aria-hidden="true" />}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(true)}
            />
          </>
        }
      />

      <AppDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={t('lobby.menu')}
        kicker={t('settings.language')}
        actions={[]}
      >
        <div className="grid gap-4">
          <LanguageSwitcher labelClassName="inline" labelMode="always" layout="stacked" selectClassName="max-w-none" />
          <AuthSection onAuthChanged={onAuthChanged} />
        </div>
      </AppDrawer>

      <Dialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        mobilePresentation="modal"
        size="lg"
        title={aboutConfig.title}
        description={aboutConfig.description}
        closeLabel={t('common.close')}
        className="max-w-3xl"
      >
        <div className="grid gap-6">
          <section>
            <h3 className="font-mono text-caption uppercase tracking-[var(--tracking-meta)] text-content-dim">
              {t('lobby.projectCredits')}
            </h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {PROJECT_CREDITS.map(({ labelKey, valueField, Icon }) => (
                <li
                  key={labelKey}
                  className="flex min-h-11 min-w-0 items-center gap-3 rounded-sm border border-border-soft bg-surface-base/50 px-3 text-body"
                >
                  <Icon className="size-4 shrink-0 text-accent-primary/75" strokeWidth={1.5} aria-hidden="true" />
                  <span className="shrink-0 text-content-dim">{t(labelKey)}</span>
                  {aboutConfig[valueField].url ? (
                    <a
                      className="inline-flex min-w-0 items-center gap-1 text-content-primary underline-offset-4 transition hover:text-accent-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                      href={aboutConfig[valueField].url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="truncate">{aboutConfig[valueField].name}</span>
                      <ExternalLink className="size-3 shrink-0 text-content-dim" strokeWidth={1.5} aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="min-w-0 truncate text-content-primary">{aboutConfig[valueField].name}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-3">
            <h3 className="font-mono text-caption uppercase tracking-[var(--tracking-meta)] text-content-dim">
              {t('lobby.projectGithub')}
            </h3>
            <AboutFeatureLink link={aboutConfig.github} Icon={Github} />
          </section>

          <section className="grid gap-3">
            <h3 className="font-mono text-caption uppercase tracking-[var(--tracking-meta)] text-content-dim">
              {t('lobby.projectOtherProjects')}
            </h3>
            <AboutFeatureLink link={aboutConfig.otherProjects} Icon={Code2} />
          </section>

          <section>
            <h3 className="font-mono text-caption uppercase tracking-[var(--tracking-meta)] text-content-dim">
              {t('lobby.projectCommunity')}
            </h3>
            <p className="mt-2 text-body leading-relaxed text-content-muted">{aboutConfig.community.description}</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {communityLinks.map(({ labelKey, href, Icon }) => (
                <li key={labelKey}>
                  <a
                    className="flex min-h-11 items-center justify-between gap-3 rounded-sm border border-border-soft bg-surface-base/50 px-3 text-control text-content-muted transition hover:border-accent-primary/50 hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span className="truncate">{t(labelKey)}</span>
                    </span>
                    <ExternalLink className="size-3 shrink-0 text-content-dim" strokeWidth={1.5} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </Dialog>

      {/* ===== 主視覺：wordmark × 待機儀表 ===== */}
      <main className="relative z-[var(--z-dropdown)] flex h-full min-h-0 flex-col overflow-y-auto px-4 pt-20 md:px-10 md:pt-24">
        <section className="flex flex-1 flex-col items-center justify-center gap-8 md:flex-row md:justify-between md:gap-12">
          {/* 左：標語與主行動 */}
          <div className="flex max-w-xl flex-col items-center text-center md:items-start md:text-left">
            <span className="font-mono text-caption uppercase tracking-[0.18em] text-accent-primary/80">
              The Battle Begins
            </span>
            <h1 className="mt-4 font-display text-[clamp(2.6rem,7vw,5rem)] font-extrabold leading-[0.95] tracking-tight">
              ZUTOMAYO
              <br />
              CARD
              <br />
              ONLINE
            </h1>
            <p className="mt-5 max-w-[30ch] text-body-lg leading-relaxed text-content-muted">{t('app.subtitle')}</p>
            <div className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={() => navigate('/online')}
                data-umami-event="home-hero-online"
              >
                {t('lobby.onlineTitle')} →
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => navigate('/tutorial')}
                data-umami-event="home-hero-tutorial"
              >
                {t('lobby.tutorial')}
              </Button>
            </div>
          </div>

          {/* 右：待機中的 Chronos 儀表（純裝飾，與對戰共用元件） */}
          <div
            className="relative hidden shrink-0 scale-125 opacity-90 sm:block md:mr-8 md:scale-150 lg:mr-16"
            aria-hidden="true"
          >
            <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[oklch(from_var(--time-night)_l_c_h_/_0.1)] blur-3xl" />
            <ChronosDial chronos={IDLE_CHRONOS} currentTime="night" currentPlayer={0} />
          </div>
        </section>

        {/* ===== 頻道列：模式入口 ===== */}
        <nav className="shrink-0 pb-6 pt-8 md:pb-8" aria-label={t('lobby.menu')}>
          <div className="mb-3 flex items-baseline gap-3">
            <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-dim">
              Channels
            </span>
            <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:gap-3">
            {CHANNELS.map(({ to, no, titleKey, captionKey, Icon }) => (
              <li key={to} className="min-w-0">
                <button
                  type="button"
                  onClick={() => navigate(to)}
                  className="group flex min-h-[var(--size-touch-min)] w-full items-center gap-3 rounded-md border border-border-soft bg-surface-base/60 px-4 py-3 text-left backdrop-blur transition hover:border-accent-primary/50 hover:bg-surface-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] lg:h-full lg:flex-col lg:items-start lg:gap-2 lg:py-4"
                >
                  <span className="flex items-center gap-3 lg:w-full lg:justify-between">
                    <span className="font-mono text-caption tracking-[var(--tracking-meta)] text-accent-primary/70">
                      CH.{no}
                    </span>
                    <Icon
                      className="size-4 text-content-dim transition-colors group-hover:text-accent-primary"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-body-lg font-bold leading-tight">
                      {t(titleKey)}
                    </span>
                    <span className="mt-1 hidden min-h-[2.25em] text-caption leading-snug text-content-dim lg:line-clamp-2">
                      {t(captionKey)}
                    </span>
                  </span>
                  <span
                    className="font-mono text-body text-content-dim transition group-hover:translate-x-0.5 group-hover:text-accent-primary lg:hidden"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* footer 資訊行 */}
          <div className="mt-6 grid gap-3 border-t border-border-soft pt-4 text-caption text-content-primary/35 sm:grid-cols-2 sm:items-center lg:grid-cols-[minmax(0,1fr)_minmax(16rem,1.25fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 justify-center sm:justify-start">
              <VersionUpdateTrigger />
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                className="min-h-10 min-w-0 px-2 text-center font-sans leading-relaxed text-content-primary/35 normal-case tracking-normal hover:text-accent-primary"
                variant="ghost"
                size="sm"
                onClick={() => navigate('/feedback')}
              >
                {t('nav.feedback')}
              </Button>
              <span className="text-content-primary/20" aria-hidden="true">
                /
              </span>
              <Button
                type="button"
                className="min-h-10 min-w-0 px-2 text-center font-sans leading-relaxed text-content-primary/35 normal-case tracking-normal hover:text-accent-primary"
                variant="ghost"
                size="sm"
                onClick={() => setAboutOpen(true)}
              >
                {t('lobby.projectAboutAction')}
              </Button>
            </div>
            <span className="min-w-0 text-center font-sans leading-relaxed normal-case tracking-normal text-content-primary/35 sm:col-span-2 lg:col-span-1 lg:text-right">
              {t('app.footerCopyright')}
              <a
                className="inline text-content-primary/45 underline-offset-4 transition-colors hover:text-accent-primary hover:underline focus-visible:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60"
                href="https://zutomayocard.net"
                target="_blank"
                rel="noreferrer"
              >
                ZUTOMAYO
              </a>
              {t('app.footerCopyrightSuffix')}
            </span>
          </div>
        </nav>
      </main>

      {/* 首次訪問引導 */}
      {showDeckIntro && (
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-overlay)] flex justify-center px-4 pb-4 sm:bottom-auto sm:top-0 sm:pb-0 sm:pt-4">
          <Panel
            className="max-h-[calc(100dvh-2rem)] w-full max-w-[640px] overflow-y-auto bg-surface-panel-strong text-content-primary ring-accent-primary/40 backdrop-blur"
            size="lg"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
                Welcome
              </span>
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
            <h2 className="font-display text-xl font-bold leading-tight text-content-primary sm:text-2xl">
              {t('intro.deckTitle')}
            </h2>
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
