import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  BookOpenCheck,
  Code2,
  ExternalLink,
  Github,
  LayoutGrid,
  Medal,
  Megaphone,
  Menu,
  MessageCircle,
  Palette,
  ScrollText,
  Send,
  Share2,
  Swords,
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
import { LOBBY_BACKGROUND_FALLBACK_IMAGE } from '../data/cardImageSources';
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
import { isActionableCommunityUrl } from '../communityLinks';
import './LobbyPage.css';

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
  deckSharingEnabled: boolean;
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

const START_CHANNELS: Channel[] = [
  { to: '/online', no: '01', titleKey: 'lobby.onlineTitle', captionKey: 'lobby.homeOnlineCaption', Icon: Swords },
  { to: '/ai', no: '02', titleKey: 'lobby.aiBattle', captionKey: 'lobby.homeAiCaption', Icon: Bot },
];

const UTILITY_CHANNELS: Channel[] = [
  {
    to: '/deck-builder',
    no: '03',
    titleKey: 'lobby.deckEditor',
    captionKey: 'lobby.homeDeckCaption',
    Icon: LayoutGrid,
  },
  {
    to: '/rules/qa',
    no: '05',
    titleKey: 'officialRules.channelTitle',
    captionKey: 'officialRules.channelCaption',
    Icon: BookOpenCheck,
  },
  {
    to: '/leaderboard',
    no: '06',
    titleKey: 'leaderboard.title',
    captionKey: 'lobby.homeLeaderboardCaption',
    Icon: Medal,
  },
  {
    to: '/history',
    no: '07',
    titleKey: 'lobby.matchHistory',
    captionKey: 'lobby.homeHistoryCaption',
    Icon: ScrollText,
  },
  {
    to: '/community',
    no: '08',
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
const LOBBY_BACKGROUND_HOLD_MS = 11_000;
const LOBBY_BACKGROUND_FADE_MS = 1_800;

function lobbyBackgroundImages(cards: CardDef[]): string[] {
  const featuredCards = cards.filter((card) => card.rarity === 'UR' || card.rarity === 'SR' || card.rarity === 'SE');
  const sourceCards = featuredCards.some((card) => card.image) ? featuredCards : cards;
  return [...new Set(sourceCards.map((card) => card.image).filter((image): image is string => Boolean(image)))];
}

function randomLobbyBackgroundImage(images: string[], currentImage?: string): string | null {
  const candidates = images.filter((image) => image !== currentImage);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
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

function HomeAnnouncements({
  announcements,
  loading,
  locale,
}: {
  announcements: Announcement[];
  loading: boolean;
  locale: string;
}) {
  return (
    <section
      className="w-full border-y border-border-soft bg-surface-base/30 py-4 text-left"
      aria-labelledby="home-announcements-title"
    >
      <div className="flex items-center gap-2 px-1">
        <Megaphone className="size-4 text-accent-primary" strokeWidth={1.5} aria-hidden="true" />
        <h2
          id="home-announcements-title"
          className="font-mono text-caption uppercase tracking-normal text-content-muted"
        >
          {t('announcement.title')}
        </h2>
      </div>
      {loading ? (
        <p className="px-1 pt-3 text-caption text-content-dim">{t('announcement.loading')}</p>
      ) : announcements.length === 0 ? (
        <p className="px-1 pt-3 text-caption text-content-dim">{t('announcement.empty')}</p>
      ) : (
        <div className="mt-3 grid gap-px overflow-hidden rounded-sm border border-border-soft bg-border-soft sm:grid-cols-3">
          {announcements.map((announcement) => (
            <article key={announcement.id} className="grid min-w-0 gap-1 bg-surface-base/80 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="min-w-0 truncate text-body font-semibold text-content-primary">{announcement.title}</h3>
                {announcement.publishedAt && (
                  <time className="shrink-0 font-mono text-[10px] text-content-dim" dateTime={announcement.publishedAt}>
                    {new Date(announcement.publishedAt).toLocaleDateString(locale, {
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </time>
                )}
              </div>
              <p className="line-clamp-2 text-caption leading-relaxed text-content-muted">{announcement.content}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function UtilityChannel({ channel, onOpen }: { channel: Channel; onOpen: (path: string) => void }) {
  const { to, no, titleKey, captionKey, Icon } = channel;
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onOpen(to)}
        className="group flex h-full min-h-28 w-full flex-col items-start gap-3 rounded-md border border-border-soft bg-surface-base/55 p-4 text-left transition hover:border-accent-primary/55 hover:bg-surface-base/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
      >
        <span className="flex w-full items-center justify-between gap-3">
          <span className="font-mono text-caption text-accent-primary/75">CH.{no}</span>
          <Icon
            className="size-4 shrink-0 text-content-dim transition-colors group-hover:text-accent-primary"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-body-lg font-bold leading-tight text-content-primary">
            {t(titleKey)}
          </span>
          <span className="mt-1 line-clamp-2 block text-caption leading-relaxed text-content-dim">{t(captionKey)}</span>
        </span>
        <ArrowRight
          className="size-4 self-end text-content-dim transition group-hover:translate-x-0.5 group-hover:text-accent-primary"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

export function LobbyPage({ onAuthChanged, deckSharingEnabled }: LobbyPageProps) {
  const navigate = useNavigate();
  const locale = useLocale();
  const [showDeckIntro, setShowDeckIntro] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { onlineCount } = useOnlinePresence();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutConfig, setAboutConfig] = useState<AboutPageConfig>(DEFAULT_ABOUT_PAGE_I18N_CONFIG[locale]);
  const [backgroundImages, setBackgroundImages] = useState(() => lobbyBackgroundImages(getAllCardDefs()));
  const [backgroundImage, setBackgroundImage] = useState(
    () => randomLobbyBackgroundImage(lobbyBackgroundImages(getAllCardDefs())) ?? LOBBY_BACKGROUND_FALLBACK_IMAGE,
  );
  const [pendingBackgroundImage, setPendingBackgroundImage] = useState<string | null>(null);
  const [backgroundTransitioning, setBackgroundTransitioning] = useState(false);

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
      const images = lobbyBackgroundImages(cards);
      if (cancelled || images.length === 0) return;
      setBackgroundImages(images);
      setBackgroundImage((current) =>
        !current || current === LOBBY_BACKGROUND_FALLBACK_IMAGE
          ? (randomLobbyBackgroundImage(images) ?? current)
          : current,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      backgroundImages.length < 2 ||
      pendingBackgroundImage ||
      backgroundTransitioning ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setPendingBackgroundImage(randomLobbyBackgroundImage(backgroundImages, backgroundImage));
    }, LOBBY_BACKGROUND_HOLD_MS);

    return () => window.clearTimeout(timeout);
  }, [backgroundImage, backgroundImages, backgroundTransitioning, pendingBackgroundImage]);

  useEffect(() => {
    if (!backgroundTransitioning || !pendingBackgroundImage) return;

    const timeout = window.setTimeout(() => {
      setBackgroundImage(pendingBackgroundImage);
      setPendingBackgroundImage(null);
      setBackgroundTransitioning(false);
    }, LOBBY_BACKGROUND_FADE_MS);

    return () => window.clearTimeout(timeout);
  }, [backgroundTransitioning, pendingBackgroundImage]);

  const handleDismissIntro = () => {
    localStorage.setItem('zutomayo_deck_intro_seen', 'true');
    setShowDeckIntro(false);
  };

  const handleGoToDeckBuilder = () => {
    localStorage.setItem('zutomayo_deck_intro_seen', 'true');
    setShowDeckIntro(false);
    navigate('/deck-builder');
  };

  const communityLinks = (
    [
      { labelKey: 'lobby.projectQQ', href: aboutConfig.community.qqUrl, Icon: Users },
      { labelKey: 'lobby.projectTelegram', href: aboutConfig.community.telegramUrl, Icon: Send },
      { labelKey: 'lobby.projectDiscord', href: aboutConfig.community.discordUrl, Icon: MessageCircle },
    ] satisfies Array<{ labelKey: TranslationKey; href: string; Icon: typeof Users }>
  ).filter(({ href }) => isActionableCommunityUrl(href));
  const utilityChannels: Channel[] = deckSharingEnabled
    ? [
        UTILITY_CHANNELS[0],
        {
          to: '/deck-shares',
          no: '04',
          titleKey: 'deckShare.lobbyTitle',
          captionKey: 'deckShare.lobbyDescription',
          Icon: Share2,
        },
        ...UTILITY_CHANNELS.slice(1),
      ]
    : UTILITY_CHANNELS;

  return (
    <PageShell>
      {/* 環境層保留真實卡圖的色彩與輪廓，並以遮罩維持首頁資訊對比。 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {backgroundImage && (
          <div
            key={backgroundImage}
            data-lobby-background="current"
            className={`lobby-background-layer absolute inset-0 [&>img]:block [&>img]:h-full [&>img]:w-full [&>picture]:block [&>picture]:h-full [&>picture]:w-full ${
              backgroundTransitioning ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <CardImage
              src={backgroundImage}
              context="detail"
              alt=""
              loading="eager"
              referrerPolicy="no-referrer"
              className="lobby-background-slide h-full w-full object-cover object-center opacity-50 blur-[3px] brightness-[0.72] saturate-[1.15]"
              onError={() => {
                setPendingBackgroundImage(null);
                setBackgroundTransitioning(false);
                setBackgroundImage((current) =>
                  current === LOBBY_BACKGROUND_FALLBACK_IMAGE ? '' : LOBBY_BACKGROUND_FALLBACK_IMAGE,
                );
              }}
            />
          </div>
        )}
        {pendingBackgroundImage && (
          <div
            key={pendingBackgroundImage}
            data-lobby-background="next"
            className={`lobby-background-layer absolute inset-0 [&>img]:block [&>img]:h-full [&>img]:w-full [&>picture]:block [&>picture]:h-full [&>picture]:w-full ${
              backgroundTransitioning ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <CardImage
              src={pendingBackgroundImage}
              context="detail"
              alt=""
              loading="eager"
              referrerPolicy="no-referrer"
              className="lobby-background-slide h-full w-full object-cover object-center opacity-50 blur-[3px] brightness-[0.72] saturate-[1.15]"
              onLoad={() => setBackgroundTransitioning(true)}
              onError={() => {
                setPendingBackgroundImage(null);
                setBackgroundTransitioning(false);
              }}
            />
          </div>
        )}
        <div className="absolute inset-0 bg-surface-canvas/52 sm:bg-surface-canvas/62" />
        <div className="absolute inset-0 opacity-[0.045] [background-image:var(--pattern-dot)] [background-size:var(--pattern-dot-size)]" />
      </div>

      <AppHeader
        subtitle={t('app.subtitle')}
        leftMeta={<OnlinePresenceBadge onlineCount={onlineCount} />}
        actions={
          <>
            <div className="hidden items-center gap-3 sm:flex">
              <LanguageSwitcher className="shrink-0" variant="header" />
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

          {communityLinks.length > 0 && (
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
          )}
        </div>
      </Dialog>

      <main className="relative z-[var(--z-dropdown)] h-full min-h-0 overflow-y-auto px-4 pt-20 md:px-8 md:pt-24">
        <div className="mx-auto w-full max-w-[1440px]">
          <section className="grid gap-8 pb-10 pt-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(34rem,1.2fr)] lg:items-center lg:gap-14 lg:pb-12 lg:pt-10">
            <header className="max-w-xl">
              <span className="font-mono text-caption uppercase tracking-normal text-accent-primary/80">
                The Battle Begins
              </span>
              <h1 className="mt-4 font-display text-[clamp(2.75rem,6vw,5.5rem)] font-extrabold leading-[0.92] tracking-normal text-content-primary">
                ZUTOMAYO
                <br />
                CARD ONLINE
              </h1>
              <p className="mt-5 max-w-[32ch] text-body-lg leading-relaxed text-content-muted">{t('app.subtitle')}</p>
            </header>

            <div className="grid min-w-0 gap-5">
              <div className="flex items-center gap-3">
                <span className="font-mono text-caption uppercase tracking-normal text-content-dim">
                  {t('lobby.homeStart')}
                </span>
                <span className="h-px flex-1 bg-border-soft" aria-hidden="true" />
              </div>

              <nav className="grid gap-3 sm:grid-cols-2" aria-label={t('lobby.homeStart')}>
                <button
                  type="button"
                  className="group relative min-h-48 overflow-hidden rounded-md border border-accent-primary/45 bg-surface-panel-strong p-5 text-left shadow-floating transition hover:border-accent-primary hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color] sm:col-span-2"
                  onClick={() => navigate(START_CHANNELS[0].to)}
                  data-umami-event="home-hero-online"
                >
                  <span className="relative z-10 flex h-full max-w-[60%] flex-col items-start">
                    <span className="font-mono text-caption text-accent-primary/80">CH.01</span>
                    <span className="mt-5 font-display text-2xl font-bold leading-tight text-content-primary sm:text-3xl">
                      {t(START_CHANNELS[0].titleKey)}
                    </span>
                    <span className="mt-2 text-body leading-relaxed text-content-muted">
                      {t(START_CHANNELS[0].captionKey)}
                    </span>
                    <span className="mt-auto inline-flex items-center gap-2 pt-5 text-control font-semibold text-accent-primary">
                      {t('lobby.homeEnter')}
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-1"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </span>
                  </span>
                  <span
                    className="absolute -right-8 top-1/2 hidden -translate-y-1/2 scale-90 opacity-55 sm:block"
                    aria-hidden="true"
                  >
                    <ChronosDial chronos={IDLE_CHRONOS} currentTime="night" currentPlayer={0} />
                  </span>
                </button>

                <button
                  type="button"
                  className="group flex min-h-28 items-center gap-4 rounded-md border border-border-soft bg-surface-base/60 p-4 text-left transition hover:border-accent-primary/55 hover:bg-surface-base/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                  onClick={() => navigate(START_CHANNELS[1].to)}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-border-soft bg-surface-raised text-accent-primary">
                    <Bot className="size-5" strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-caption text-accent-primary/75">CH.02</span>
                    <span className="mt-1 block font-display text-body-lg font-bold text-content-primary">
                      {t(START_CHANNELS[1].titleKey)}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-caption leading-relaxed text-content-dim">
                      {t(START_CHANNELS[1].captionKey)}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-content-dim" strokeWidth={1.5} aria-hidden="true" />
                </button>

                <button
                  type="button"
                  className="group flex min-h-28 items-center gap-4 rounded-md border border-border-soft bg-surface-base/60 p-4 text-left transition hover:border-accent-primary/55 hover:bg-surface-base/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--focus-ring-color]"
                  onClick={() => navigate('/tutorial')}
                  data-umami-event="home-hero-tutorial"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-border-soft bg-surface-raised text-accent-primary">
                    <BookOpenCheck className="size-5" strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-caption text-accent-primary/75">GUIDE</span>
                    <span className="mt-1 block font-display text-body-lg font-bold text-content-primary">
                      {t('lobby.tutorial')}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-caption leading-relaxed text-content-dim">
                      {t('lobby.homeTutorialCaption')}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-content-dim" strokeWidth={1.5} aria-hidden="true" />
                </button>
              </nav>

              <HomeAnnouncements announcements={announcements} loading={announcementsLoading} locale={locale} />
            </div>
          </section>

          <section className="border-t border-border-soft py-8" aria-labelledby="home-channels-title">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <span className="font-mono text-caption uppercase tracking-normal text-accent-primary/75">
                  {t('lobby.homeChannels')}
                </span>
                <h2 id="home-channels-title" className="mt-1 font-display text-xl font-bold text-content-primary">
                  {t('lobby.homeExplore')}
                </h2>
              </div>
              <span className="hidden max-w-sm text-right text-caption leading-relaxed text-content-dim sm:block">
                {t('lobby.homeExploreCaption')}
              </span>
            </div>
            <nav aria-label={t('lobby.homeChannels')}>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {utilityChannels.map((channel) => (
                  <UtilityChannel key={channel.to} channel={channel} onOpen={navigate} />
                ))}
              </ul>
            </nav>
          </section>

          <div className="lobby-home-footer grid gap-3 border-t border-border-soft pb-6 pt-4 text-caption text-content-primary/35 sm:grid-cols-2 sm:items-center lg:grid-cols-[minmax(0,1fr)_minmax(16rem,1.25fr)_minmax(0,1fr)]">
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
              <span className="text-content-primary/20" aria-hidden="true">
                /
              </span>
              <Button
                type="button"
                className="min-h-10 min-w-0 px-2 text-center font-sans leading-relaxed text-content-primary/35 normal-case tracking-normal hover:text-accent-primary"
                variant="ghost"
                size="sm"
                onClick={() => navigate('/legal')}
              >
                {t('legal.accountTitle')}
              </Button>
            </div>
            <span className="min-w-0 text-center font-sans leading-relaxed normal-case tracking-normal text-content-primary/35 sm:col-span-2 lg:col-span-1 lg:text-right">
              {t('app.footerCopyright')}
              <a
                className="inline-flex min-h-touch items-center text-content-primary/45 underline-offset-4 transition-colors hover:text-accent-primary hover:underline focus-visible:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/60"
                href="https://zutomayocard.net"
                target="_blank"
                rel="noreferrer"
              >
                ZUTOMAYO
              </a>
              {t('app.footerCopyrightSuffix')}
            </span>
          </div>
        </div>
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
