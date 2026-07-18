import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  Code2,
  ExternalLink,
  Github,
  LayoutGrid,
  Megaphone,
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
import { CardImage } from '../components/CardImage';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { VersionUpdateTrigger } from '../components/VersionUpdateTrigger';
import { AuthSection } from '../components/lobby/AuthSection';
import { OnlinePresenceBadge } from '../components/OnlinePresenceBadge';
import { useOnlinePresence } from '../hooks/useOnlinePresence';
import {
  DEFAULT_ABOUT_PAGE_I18N_CONFIG,
  fetchAnnouncements,
  fetchAboutPage,
  type Announcement,
  type AboutPageConfig,
  type AboutPageLink,
} from '../api/client';
import { getAllCardDefs, refreshCards } from '../game/cards/loader';
import { AppHeader, Button, Dialog, IconButton, PageShell, Panel } from '../ui';
import { ChronosDial } from '../ui/game';
import { t, useLocale, type TranslationKey } from '../i18n';
import type { CardDef } from '../game/types';

// 向後相容：App.tsx 從此檔案匯入這些工具函式/常數，實際定義已移至 components/lobby/shared.ts。
export {
  DEFAULT_DECK_NAME,
  aiOpponentDeckName,
  onlineDeckName,
  selectedDeckName,
  serverDeckIdFromOption,
} from '../components/lobby/shared';

interface LobbyPageProps {
  onAuthChanged: () => void | Promise<void>;
}

/**
 * 首頁「夜間放送 Night Broadcast」— Design System v2 從零設計。
 *
 * 構圖：浮動膠囊頁首（同對戰 HUD）＋ 模糊卡圖環境層 ＋ 主視覺（wordmark × ChronosDial 待機儀表）
 * ＋ 底部頻道列（CH.01–05 模式入口）。沒有通欄 header、沒有滿版卡片牆。
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
  {
    to: '/deck-builder',
    no: '03',
    titleKey: 'lobby.deckEditor',
    captionKey: 'lobby.homeDeckCaption',
    Icon: LayoutGrid,
  },
  {
    to: '/leaderboard',
    no: '04',
    titleKey: 'leaderboard.title',
    captionKey: 'lobby.homeLeaderboardCaption',
    Icon: Trophy,
  },
  {
    to: '/history',
    no: '05',
    titleKey: 'lobby.matchHistory',
    captionKey: 'lobby.homeHistoryCaption',
    Icon: ScrollText,
  },
  {
    to: '/community',
    no: '06',
    titleKey: 'community.title',
    captionKey: 'community.caption',
    Icon: MessageCircle,
  },
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
const LOBBY_BACKGROUND_FALLBACK_IMAGE = 'https://r2.dan.tw/cards/the-world-is-changing/zutomayocard_1st_1.jpg';

function randomLobbyBackgroundImage(cards: CardDef[]): string | null {
  const featuredCards = cards.filter((card) => card.rarity === 'UR' || card.rarity === 'SR' || card.rarity === 'SE');
  const sourceCards = featuredCards.some((card) => card.image) ? featuredCards : cards;
  const images = sourceCards.map((card) => card.image).filter((image): image is string => Boolean(image));
  if (images.length === 0) return null;
  return images[Math.floor(Math.random() * images.length)];
}

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
  const locale = useLocale();
  const [networkOnline, setNetworkOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [showDeckIntro, setShowDeckIntro] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { onlineCount } = useOnlinePresence();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutConfig, setAboutConfig] = useState<AboutPageConfig>(DEFAULT_ABOUT_PAGE_I18N_CONFIG[locale]);
  const [backgroundImage, setBackgroundImage] = useState(
    () => randomLobbyBackgroundImage(getAllCardDefs()) ?? LOBBY_BACKGROUND_FALLBACK_IMAGE,
  );

  useEffect(() => {
    const handleOnline = () => setNetworkOnline(true);
    const handleOffline = () => setNetworkOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const seen = localStorage.getItem('zutomayo_deck_intro_seen');
    if (!seen) setShowDeckIntro(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAnnouncementsLoading(true);
    void fetchAnnouncements(locale, 3)
      .then(
        (items) => {
          if (!cancelled) setAnnouncements(items);
        },
        () => {
          if (!cancelled) setAnnouncements([]);
        },
      )
      .finally(() => {
        if (!cancelled) setAnnouncementsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    setAboutConfig(DEFAULT_ABOUT_PAGE_I18N_CONFIG[locale]);
    fetchAboutPage(locale).then((config) => {
      if (!cancelled) setAboutConfig(config);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    void refreshCards().then((cards) => {
      const image = randomLobbyBackgroundImage(cards);
      if (!cancelled && image) setBackgroundImage(image);
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
      {/* 環境層：隨機卡牌模糊背景＋中央光暈＋夜色微染＋點陣（與戰場同語言） */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {backgroundImage && (
          <div className="absolute inset-[-7%] [&>img]:block [&>img]:h-full [&>img]:w-full [&>picture]:block [&>picture]:h-full [&>picture]:w-full">
            <CardImage
              src={backgroundImage}
              context="detail"
              alt=""
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover opacity-45 blur-[6px] brightness-[0.72] saturate-[1.35]"
              onError={() =>
                setBackgroundImage((current) =>
                  current === LOBBY_BACKGROUND_FALLBACK_IMAGE ? '' : LOBBY_BACKGROUND_FALLBACK_IMAGE,
                )
              }
            />
          </div>
        )}
        <div className="absolute inset-0 bg-surface-canvas/58" />
        <div className="absolute inset-0 bg-gradient-to-r from-surface-canvas/82 via-surface-canvas/24 to-surface-canvas/62" />
        <div className="absolute left-1/2 top-1/2 h-[70vh] w-[110vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[oklch(from_var(--time-night)_l_c_h_/_0.07)] blur-[var(--ambient-glow-blur-lg)]" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:var(--pattern-dot)] [background-size:var(--pattern-dot-size)]" />
      </div>

      <AppHeader
        subtitle={t('app.subtitle')}
        leftMeta={<OnlinePresenceBadge onlineCount={onlineCount} />}
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
                disabled={!networkOnline}
                data-offline-requires-network="online"
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

        <section
          className="mx-auto w-full max-w-6xl shrink-0 border-y border-border-soft bg-surface-base/45 px-4 py-3 backdrop-blur-md"
          aria-labelledby="home-announcements-title"
        >
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 text-accent-primary" strokeWidth={1.5} aria-hidden="true" />
            <h2
              id="home-announcements-title"
              className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-muted"
            >
              {t('announcement.title')}
            </h2>
          </div>
          {announcementsLoading ? (
            <p className="mt-2 text-caption text-content-dim">{t('announcement.loading')}</p>
          ) : announcements.length === 0 ? (
            <p className="mt-2 text-caption text-content-dim">{t('announcement.empty')}</p>
          ) : (
            <div className="mt-2 grid gap-x-6 gap-y-3 md:grid-cols-3">
              {announcements.map((announcement) => (
                <article key={announcement.id} className="min-w-0 border-l-2 border-accent-primary/45 pl-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="truncate text-body font-semibold text-content-primary">{announcement.title}</h3>
                    {announcement.publishedAt && (
                      <time
                        className="shrink-0 font-mono text-[10px] text-content-dim"
                        dateTime={announcement.publishedAt}
                      >
                        {new Date(announcement.publishedAt).toLocaleDateString(locale, {
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </time>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-caption leading-relaxed text-content-muted">
                    {announcement.content}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* ===== 頻道列：模式入口 ===== */}
        <nav className="shrink-0 pb-6 pt-8 md:pb-8" aria-label={t('lobby.menu')}>
          <div className="mb-3 flex items-baseline gap-3">
            <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-dim">
              Channels
            </span>
            <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6 lg:gap-3">
            {CHANNELS.map(({ to, no, titleKey, captionKey, Icon }) => {
              const requiresNetwork = to === '/online' || to === '/leaderboard' || to === '/community';
              return (
                <li key={to} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => navigate(to)}
                    disabled={requiresNetwork && !networkOnline}
                    data-offline-requires-network={requiresNetwork ? to.slice(1) : undefined}
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
              );
            })}
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
                className="inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-content-primary/45 underline-offset-4 transition-colors hover:text-accent-primary hover:underline focus-visible:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60"
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
