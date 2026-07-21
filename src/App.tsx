import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { identifyAnalytics, trackPageView } from './analytics';
import { formatAnonymousDisplayName } from './anonymousIdentity';
import { getDecks, getProfile, isLoggedIn, reserveDeck, type DeckResponse } from './api/client';
import { ensureCompatibleAppVersion } from './clientVersion';
import { NetworkStatusNotifier } from './components/NetworkStatusNotifier';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { PwaStatusPrompt } from './components/PwaStatusPrompt';
import { Sentry } from './sentry';
import { Button, IconButton } from './ui';
import { hasStoredCustomDeck } from './game/cards/customDeck';
import { getGameConfig as getLoadedGameConfig } from './game/cards/loader';
import type { ZutomayoSetupData } from './game/types';
import type { AIDifficulty } from './game/ai';
import {
  LobbyPage,
  aiOpponentDeckName,
  onlineDeckName,
  selectedDeckName,
  serverDeckIdFromOption,
} from './pages/LobbyPage';
import { t, translate, useLocale, type TranslationKey } from './i18n';
import {
  clearStoredOnlineSession,
  loadOnlineSession,
  saveOnlineSession,
  validateOnlineSession,
  type OnlineSession,
  type OnlineSessionValidationReason,
} from './onlineSession';
import { APP_VERSION_INFO } from './version';
import './App.css';
// Design System v1：semantic tokens 與對戰版面樣式（必須在 App.css 之後載入，覆寫舊層）
import './ui/tokens/index.css';
import './ui/game/game.css';

const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));
const I18nManager = lazy(() => import('./pages/I18nManager').then((module) => ({ default: module.I18nManager })));
const AIGamePage = lazy(() => import('./pages/AIGamePage').then((module) => ({ default: module.AIGamePage })));
const AILobbyPage = lazy(() => import('./pages/AILobbyPage').then((module) => ({ default: module.AILobbyPage })));
const TutorialGamePage = lazy(() =>
  import('./pages/TutorialGamePage').then((module) => ({ default: module.TutorialGamePage })),
);
const DeckEditorPage = lazy(() =>
  import('./pages/DeckEditorPage').then((module) => ({ default: module.DeckEditorPage })),
);
const DeckShareLobbyPage = lazy(() =>
  import('./pages/DeckShareLobbyPage').then((module) => ({ default: module.DeckShareLobbyPage })),
);
const DeckShareDetailPage = lazy(() =>
  import('./pages/DeckShareDetailPage').then((module) => ({ default: module.DeckShareDetailPage })),
);
const MatchHistoryPage = lazy(() =>
  import('./pages/MatchHistoryPage').then((module) => ({ default: module.MatchHistoryPage })),
);
const LeaderboardPage = lazy(() =>
  import('./pages/LeaderboardPage').then((module) => ({ default: module.LeaderboardPage })),
);
const OnlineGamePage = lazy(() =>
  import('./pages/OnlineGamePage').then((module) => ({ default: module.OnlineGamePage })),
);
const OnlineLobbyPage = lazy(() =>
  import('./pages/OnlineLobbyPage').then((module) => ({ default: module.OnlineLobbyPage })),
);
const CommunityPage = lazy(() => import('./pages/CommunityPage').then((module) => ({ default: module.CommunityPage })));
const FeedbackPage = lazy(() => import('./pages/FeedbackPage').then((module) => ({ default: module.FeedbackPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const LegalPage = lazy(() => import('./pages/LegalPage').then((module) => ({ default: module.LegalPage })));
const OfficialQaPage = lazy(() =>
  import('./pages/OfficialQaPage').then((module) => ({ default: module.OfficialQaPage })),
);
const OfficialQaDetailPage = lazy(() =>
  import('./pages/OfficialQaDetailPage').then((module) => ({ default: module.OfficialQaDetailPage })),
);
const OfficialErrataPage = lazy(() =>
  import('./pages/OfficialErrataPage').then((module) => ({ default: module.OfficialErrataPage })),
);
const OfficialErrataDetailPage = lazy(() =>
  import('./pages/OfficialErrataDetailPage').then((module) => ({ default: module.OfficialErrataDetailPage })),
);
const VerifyEmailPage = lazy(() =>
  import('./pages/AccountActionPage').then((module) => ({ default: module.VerifyEmailPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/AccountActionPage').then((module) => ({ default: module.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/AccountActionPage').then((module) => ({ default: module.ResetPasswordPage })),
);
const BattleVisualQaPage = lazy(() =>
  import('./pages/BattleVisualQaPage').then((module) => ({ default: module.BattleVisualQaPage })),
);

type OnlineRoomErrorKey =
  | 'online.roomFull'
  | 'online.roomNotFound'
  | 'online.connectionFailed'
  | 'online.versionMismatch';

const APP_BOOT_TIMEOUT_MS = 4200;

function isFullscreenRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/play/') ||
    pathname.startsWith('/qa/') ||
    pathname === '/' ||
    pathname === '/online' ||
    pathname === '/community' ||
    pathname === '/ai' ||
    pathname === '/deck-builder' ||
    pathname === '/deck-shares' ||
    pathname.startsWith('/deck-shares/') ||
    pathname === '/feedback' ||
    pathname === '/tutorial' ||
    pathname === '/history' ||
    pathname === '/leaderboard' ||
    pathname === '/profile' ||
    pathname.startsWith('/rules') ||
    pathname.startsWith('/legal') ||
    pathname === '/verify-email' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password'
  );
}

function onlineRoomError(key: OnlineRoomErrorKey): Error {
  return new Error(key);
}

async function createMatch(setupData: ZutomayoSetupData): Promise<string> {
  await ensureCompatibleAppVersion();
  const response = await fetch('/games/zutomayo-card/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numPlayers: 2, setupData: { ...setupData, clientVersion: APP_VERSION_INFO } }),
  });
  if (response.status === 426) throw onlineRoomError('online.versionMismatch');
  if (!response.ok) {
    Sentry.captureException(new Error(`createMatch failed: HTTP ${response.status}`), {
      tags: { action: 'create-match', http_status: String(response.status) },
    });
    throw onlineRoomError('online.connectionFailed');
  }
  const data = await response.json();
  return data.matchID;
}

type OnlineSeatProfile = { data?: { userId: string }; platformUserId: string; platformDisplayName: string };

async function currentAccountSeatProfile(): Promise<OnlineSeatProfile | undefined> {
  if (!isLoggedIn()) return undefined;
  try {
    const profile = await getProfile();
    return { data: { userId: profile.id }, platformUserId: profile.id, platformDisplayName: profile.nickname };
  } catch {
    return undefined;
  }
}

async function joinMatch(
  matchID: string,
  playerID: '0' | '1',
  requestedPlayerName?: string,
  deckReservationId?: string,
): Promise<{
  playerCredentials: string;
  platformSeatToken?: string;
  platformUserId: string;
  platformDisplayName: string;
}> {
  await ensureCompatibleAppVersion();
  const account = await currentAccountSeatProfile();
  const playerName =
    requestedPlayerName ||
    account?.platformDisplayName ||
    formatAnonymousDisplayName() ||
    (playerID === '0' ? t('player.zero') : t('player.one'));
  const response = await fetch(`/games/zutomayo-card/${matchID}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerID,
      playerName,
      data: { ...(account?.data ?? {}), clientVersion: APP_VERSION_INFO },
      clientVersion: APP_VERSION_INFO,
      ...(deckReservationId ? { deckReservationId } : {}),
    }),
  });
  if (!response.ok) {
    if (response.status === 426) throw onlineRoomError('online.versionMismatch');
    if (response.status === 404) throw onlineRoomError('online.roomNotFound');
    if (response.status === 409) throw onlineRoomError('online.roomFull');
    Sentry.captureException(new Error(`joinMatch failed: HTTP ${response.status}`), {
      tags: { action: 'join-match', http_status: String(response.status), match_id: matchID },
    });
    throw onlineRoomError('online.connectionFailed');
  }
  const data = (await response.json()) as {
    playerCredentials: string;
    platformSeatToken?: string;
    platformUserId?: string;
  };
  const fallbackPlatformUserId = account?.platformUserId ?? `guest:match:${matchID}:player:${playerID}`;
  return {
    ...data,
    // Keep the legacy fallback for anonymous sessions, then prefer the
    // server-issued identity when one is present in the join response.
    platformUserId: account?.platformUserId ?? fallbackPlatformUserId,
    ...(data.platformUserId ? { platformUserId: data.platformUserId } : {}),
    platformDisplayName: playerName,
  };
}

function NavBar({ deckSharingEnabled }: { deckSharingEnabled: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // 全螢幕單屏頁面有自己的 Header，不需要 NavBar
  if (isFullscreenRoute(location.pathname)) {
    return null;
  }

  const navItems = [
    { path: '/', label: t('nav.lobby') },
    { path: '/online', label: t('lobby.onlineTitle') },
    { path: '/community', label: t('community.title') },
    { path: '/ai', label: t('lobby.aiBattle') },
    { path: '/deck-builder', label: t('nav.deckBuilder') },
    ...(deckSharingEnabled ? [{ path: '/deck-shares', label: t('deckShare.lobbyTitle') }] : []),
    { path: '/feedback', label: t('nav.feedback') },
    { path: '/profile', label: t('nav.profile') },
    { path: '/tutorial', label: t('nav.tutorial') },
  ];

  const activeItem = navItems.find((item) => item.path === location.pathname) ?? navItems[0];
  const navButtonClass = (path: string) =>
    `!min-h-11 min-w-touch px-2 py-0 tracking-[var(--tracking-label)] md:tracking-[var(--tracking-kicker)] ${
      location.pathname === path ? 'text-accent-primary' : 'text-content-primary/50 hover:text-content-primary'
    }`;

  const goTo = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <nav className="relative z-[var(--z-header)] px-3 pt-3 md:px-4 md:pt-4" aria-label={t('nav.primary')}>
      <div className="hidden items-center justify-between md:flex">
        <div className="flex items-center gap-1 rounded-md border border-border-soft bg-surface-base/80 px-2 py-1.5 backdrop-blur-md">
          <span className="mx-2 size-2 rounded-full bg-accent-primary shadow-status-dot" aria-hidden="true" />
          {navItems.slice(0, 6).map((item) => (
            <Button
              key={item.path}
              className={navButtonClass(item.path)}
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => goTo(item.path)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="rounded-md border border-border-soft bg-surface-base/80 px-2 py-1.5 backdrop-blur-md">
          <Button
            className={navButtonClass('/profile')}
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => goTo('/profile')}
          >
            {t('nav.profile')}
          </Button>
          <Button
            className={navButtonClass('/tutorial')}
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => goTo('/tutorial')}
          >
            {t('nav.tutorial')}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-base/80 px-2 py-1.5 backdrop-blur-md md:hidden">
        <Button
          className="!min-h-11 font-display text-base font-bold normal-case tracking-normal text-content-primary"
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => goTo('/')}
        >
          ZUTOMAYO
        </Button>
        <span className="min-w-0 truncate font-mono text-caption uppercase tracking-[var(--tracking-label)] text-accent-primary">
          {activeItem.label}
        </span>
        <IconButton
          variant="secondary"
          label={open ? t('common.close') : t('nav.primary')}
          icon={open ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        />
      </div>
      {open && (
        <div className="fixed inset-0 top-16 z-[var(--z-modal)] bg-surface-canvas/80 p-4 backdrop-blur md:hidden">
          <div className="grid gap-2 rounded-md bg-surface-base p-3 ring-1 ring-content-primary/10 shadow-raised">
            {navItems.map((item) => (
              <Button
                key={item.path}
                className="justify-between text-left"
                fullWidth
                variant={location.pathname === item.path ? 'primary' : 'ghost'}
                type="button"
                onClick={() => goTo(item.path)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

function resumeErrorTitle(reason: OnlineSessionValidationReason): TranslationKey {
  if (reason === 'versionMismatch') return 'online.versionMismatch';
  if (reason === 'roomGone') return 'onlineSession.roomGoneTitle';
  if (reason === 'seatTaken') return 'onlineSession.seatTakenTitle';
  return 'onlineSession.resumeErrorTitle';
}

function resumeErrorBody(reason: OnlineSessionValidationReason): TranslationKey {
  if (reason === 'versionMismatch') return 'online.versionMismatchBody';
  if (reason === 'roomGone') return 'onlineSession.roomGoneBody';
  if (reason === 'seatTaken') return 'onlineSession.seatTakenBody';
  return 'onlineSession.resumeErrorBody';
}

function OnlineResumePrompt({
  session,
  status,
  errorReason,
  onResume,
  onDismiss,
}: {
  session: OnlineSession;
  status: 'idle' | 'reconnecting' | 'error';
  errorReason: OnlineSessionValidationReason | null;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const playerKey = session.playerID === '0' ? 'player.zero' : 'player.one';
  const isError = status === 'error' && errorReason;

  return (
    <aside className={`online-resume-prompt ${status}`} role="status" aria-live="polite">
      <div>
        <span>{t('game.onlineMode')}</span>
        <strong>{isError ? t(resumeErrorTitle(errorReason)) : t('onlineSession.resumeTitle')}</strong>
        <p>
          {isError ? t(resumeErrorBody(errorReason)) : t('onlineSession.resumeBody')}
          {!isError && (
            <>
              {' '}
              {t('game.matchCode')} {session.matchID} / {t(playerKey)}
            </>
          )}
        </p>
      </div>
      <div className="online-resume-actions">
        {!isError && (
          <Button variant="primary" type="button" disabled={status === 'reconnecting'} onClick={onResume}>
            {status === 'reconnecting' ? t('onlineSession.reconnecting') : t('onlineSession.resumeAction')}
          </Button>
        )}
        <Button variant="secondary" type="button" onClick={onDismiss}>
          {t('onlineSession.dismissAction')}
        </Button>
      </div>
    </aside>
  );
}

function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <main className="not-found-page app-screen">
      <section className="empty-route-panel">
        <span>{t('notFound.kicker')}</span>
        <h1>{t('notFound.title')}</h1>
        <p>{t('notFound.body')}</p>
        <Button variant="primary" type="button" onClick={() => navigate('/')}>
          {t('common.backToLobby')}
        </Button>
      </section>
    </main>
  );
}

function RouteFallback() {
  return (
    <main className="app-screen grid place-items-center bg-surface-canvas font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/50">
      {t('game.loading')}
    </main>
  );
}

function waitForFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  return document.fonts.ready.then(() => undefined);
}

async function withBootTimeout<T>(promise: Promise<T>, timeoutMs = APP_BOOT_TIMEOUT_MS): Promise<T | null> {
  let timeoutId: number | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

function AppBootLoader() {
  return (
    <main className="app-boot-loader" role="status" aria-live="polite" aria-label={t('game.loading')}>
      <div className="app-boot-loader__mark" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="app-boot-loader__copy">
        <span>The Battle Begins</span>
        <strong>ZUTOMAYO CARD ONLINE</strong>
        <p>{t('game.loading')}</p>
      </div>
    </main>
  );
}

function RouterShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const locale = useLocale();
  const [customDeckAvailable, setCustomDeckAvailable] = useState(hasStoredCustomDeck);
  const [serverDecks, setServerDecks] = useState<DeckResponse[]>([]);
  const [serverDeckError, setServerDeckError] = useState('');
  const [appResourcesReady, setAppResourcesReady] = useState(false);
  // 卡牌資料載入狀態；失敗時保留可恢復的錯誤狀態，絕不把空卡池當成 ready。
  const [cardResourceState, setCardResourceState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [deckSharingEnabled, setDeckSharingEnabled] = useState(false);
  // 預設不選中任何牌組，玩家每次必須主動選擇才能開始遊戲。
  const [deck0Name, setDeck0Name] = useState('');
  const [deck1Name, setDeck1Name] = useState('');
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(loadOnlineSession);
  const [resumePromptSession, setResumePromptSession] = useState<OnlineSession | null>(() =>
    location.pathname.startsWith('/play/online/') ? null : loadOnlineSession(),
  );
  const [resumePromptStatus, setResumePromptStatus] = useState<'idle' | 'reconnecting' | 'error'>('idle');
  const [resumeErrorReason, setResumeErrorReason] = useState<OnlineSessionValidationReason | null>(null);

  useEffect(() => {
    trackPageView(`${location.pathname}${location.search}`);
    // 同步 route tag 到 Sentry，便於後台依頁面篩選錯誤。
    Sentry.setTag('route', location.pathname);
  }, [location.pathname, location.search]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      try {
        if (sessionStorage.getItem('umami_identify_sent') === 'true') return;
        const didIdentify = identifyAnalytics({
          app_version: APP_VERSION_INFO.appVersion,
          build_id: APP_VERSION_INFO.buildId,
          rules_version: APP_VERSION_INFO.rulesVersion,
          locale,
          is_logged_in: isLoggedIn() ? 'true' : 'false',
          has_custom_deck: hasStoredCustomDeck() ? 'true' : 'false',
        });
        if (didIdentify) sessionStorage.setItem('umami_identify_sent', 'true');
      } catch {
        // Analytics should never affect gameplay.
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [locale]);

  const refreshServerDecks = useCallback(async () => {
    if (!isLoggedIn()) {
      setServerDecks([]);
      setServerDeckError('');
      setDeck0Name((current) => (current.startsWith('server:') ? '' : current));
      setDeck1Name((current) => (current.startsWith('server:') ? '' : current));
      return;
    }
    try {
      setServerDecks(await getDecks());
      setServerDeckError('');
    } catch {
      setServerDecks([]);
      setServerDeckError(translate(locale, 'deck.loadServerError'));
    }
  }, [locale]);

  useEffect(() => {
    void refreshServerDecks();
  }, [refreshServerDecks]);

  const refreshCardResources = useCallback(async () => {
    setCardResourceState('loading');
    try {
      const { refreshCards } = await import('./game/cards/loader');
      const cards = await withBootTimeout(refreshCards());
      setCardResourceState(cards && cards.length > 0 ? 'ready' : 'error');
    } catch {
      setCardResourceState('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const [{ loadConfigFromAPI }, { loadCardTextsI18nFromAPI }] = await Promise.all([
        import('./game/cards/loader'),
        import('./game/cards/i18n'),
      ]);
      await Promise.allSettled([
        refreshCardResources(),
        withBootTimeout(loadConfigFromAPI()),
        withBootTimeout(loadCardTextsI18nFromAPI()),
        withBootTimeout(waitForFonts(), 2500),
      ]);
      if (cancelled) return;
      setDeckSharingEnabled(getLoadedGameConfig().deck_sharing_enabled === true);
      setAppResourcesReady(true);
    };
    void boot().catch(() => {
      if (cancelled) return;
      setAppResourcesReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshCardResources]);

  const startAI = (difficulty: AIDifficulty) => {
    navigate('/play/ai', { state: { difficulty, autoStart: true } });
  };

  const startOnline = async (
    existingID?: string,
    playerName?: string,
    options: {
      navigate?: boolean;
      playerDeckName?: string;
      opponentDeckName?: string;
      playerDeckReservationId?: string;
    } = {},
  ): Promise<OnlineSession> => {
    const selectedPlayerDeck = options.playerDeckName ?? deck0Name;
    const selectedServerDeckId = serverDeckIdFromOption(selectedPlayerDeck);
    const playerDeckReservation = options.playerDeckReservationId
      ? undefined
      : selectedServerDeckId && isLoggedIn()
        ? await reserveDeck(selectedServerDeckId, APP_VERSION_INFO.rulesVersion)
        : undefined;
    const effectiveDeckReservationId = options.playerDeckReservationId || playerDeckReservation?.reservationId;
    const setupData = {
      ...onlineDeckName(0, options.playerDeckName ?? deck0Name, serverDecks),
      ...(effectiveDeckReservationId
        ? {
            deck0Ids: undefined,
            deck0ReservationId: effectiveDeckReservationId,
            ...(playerDeckReservation
              ? { deck0Version: playerDeckReservation.deckVersion, rulesVersion: playerDeckReservation.rulesVersion }
              : {}),
          }
        : {}),
    };
    const matchID = existingID || (await createMatch(setupData));
    const playerID: '0' | '1' = existingID ? '1' : '0';
    const { playerCredentials, platformSeatToken, platformUserId, platformDisplayName } = await joinMatch(
      matchID,
      playerID,
      playerName,
      playerID === '1'
        ? options.playerDeckReservationId || playerDeckReservation?.reservationId
        : effectiveDeckReservationId,
    );
    const session = { matchID, playerID, playerCredentials, platformSeatToken, platformUserId, platformDisplayName };
    setOnlineSession(session);
    setResumePromptSession(null);
    saveOnlineSession(session);
    if (options.navigate !== false) {
      navigate(`/play/online/${encodeURIComponent(matchID)}`, { state: { freshOnlineSession: true } });
    }
    return session;
  };

  const clearOnlineSession = useCallback(() => {
    setOnlineSession(null);
    clearStoredOnlineSession();
  }, []);

  const resumeStoredSession = async () => {
    if (!resumePromptSession) return;
    setResumePromptStatus('reconnecting');
    setResumeErrorReason(null);
    const validation = await validateOnlineSession(resumePromptSession);
    if (validation.ok) {
      setOnlineSession(resumePromptSession);
      setResumePromptSession(null);
      setResumePromptStatus('idle');
      navigate(`/play/online/${encodeURIComponent(resumePromptSession.matchID)}`, {
        state: { resumeOnlineSession: true },
      });
      return;
    }

    if (validation.reason !== 'network') {
      setOnlineSession(null);
      clearStoredOnlineSession();
    }
    setResumeErrorReason(validation.reason);
    setResumePromptStatus('error');
  };

  const dismissResumePrompt = () => {
    setResumePromptSession(null);
    setResumePromptStatus('idle');
    setResumeErrorReason(null);
    clearOnlineSession();
  };

  const deck0 = selectedDeckName(deck0Name, customDeckAvailable);
  const deck1 = aiOpponentDeckName(deck1Name);
  const cardsReady = cardResourceState === 'ready';
  const cardsLoadError = cardResourceState === 'error';
  // 新版沉浸頁面有自己的 AppHeader，不需要外層 NavBar 和 padding。
  const hideNav = isFullscreenRoute(location.pathname);

  if (!appResourcesReady) return <AppBootLoader />;

  return (
    <div className={`app-shell ${hideNav ? 'play-shell' : 'has-nav'}`} data-locale={locale}>
      {!hideNav && <NavBar deckSharingEnabled={deckSharingEnabled} />}
      <div className="route-content">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route
              path="/"
              element={<LobbyPage onAuthChanged={refreshServerDecks} deckSharingEnabled={deckSharingEnabled} />}
            />
            <Route path="/community" element={<CommunityPage onAuthChanged={refreshServerDecks} />} />
            <Route
              path="/online"
              element={
                <OnlineLobbyPage
                  deck0Name={deck0Name}
                  customDeckAvailable={customDeckAvailable}
                  serverDecks={serverDecks}
                  setDeck0Name={setDeck0Name}
                  onStartOnline={startOnline}
                  onAuthChanged={refreshServerDecks}
                  serverDeckError={serverDeckError}
                  cardsReady={cardsReady}
                  cardsLoadError={cardsLoadError}
                  onRetryCards={refreshCardResources}
                />
              }
            />
            <Route
              path="/ai"
              element={
                <AILobbyPage
                  deck0Name={deck0Name}
                  deck1Name={deck1Name}
                  customDeckAvailable={customDeckAvailable}
                  serverDecks={serverDecks}
                  setDeck0Name={setDeck0Name}
                  setDeck1Name={setDeck1Name}
                  onStartAI={startAI}
                  serverDeckError={serverDeckError}
                  cardsReady={cardsReady}
                  cardsLoadError={cardsLoadError}
                  onRetryCards={refreshCardResources}
                />
              }
            />
            <Route
              path="/play/ai"
              element={
                <AIGamePage
                  deck0Name={deck0}
                  deck1Name={deck1}
                  cardsReady={cardsReady}
                  cardsLoadError={cardsLoadError}
                  onRetryCards={refreshCardResources}
                />
              }
            />
            <Route
              path="/tutorial"
              element={
                <TutorialGamePage
                  cardsReady={cardsReady}
                  cardsLoadError={cardsLoadError}
                  onRetryCards={refreshCardResources}
                />
              }
            />
            <Route
              path="/play/online/:matchID"
              element={
                <OnlineGamePage
                  session={onlineSession}
                  onClearSession={clearOnlineSession}
                  onCreateNewRoom={() => startOnline()}
                />
              }
            />
            <Route
              path="/deck-builder"
              element={
                <DeckEditorPage
                  serverDecks={serverDecks}
                  deckSharingEnabled={deckSharingEnabled}
                  onServerDecksLoaded={setServerDecks}
                  onDeckSaved={(deck) => {
                    setCustomDeckAvailable(hasStoredCustomDeck());
                    if (deck) {
                      setServerDeckError('');
                      setServerDecks((current) => [deck, ...current]);
                    }
                  }}
                />
              }
            />
            {deckSharingEnabled && <Route path="/deck-shares" element={<DeckShareLobbyPage />} />}
            {deckSharingEnabled && (
              <Route
                path="/deck-shares/:shareId"
                element={
                  <DeckShareDetailPage
                    onServerDeckCopied={(deck) =>
                      setServerDecks((current) => [deck, ...current.filter((item) => item.id !== deck.id)])
                    }
                  />
                }
              />
            )}
            <Route path="/history" element={<MatchHistoryPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/feedback" element={<FeedbackPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/rules/qa" element={<OfficialQaPage />} />
            <Route path="/rules/qa/:number" element={<OfficialQaDetailPage />} />
            <Route path="/rules/errata" element={<OfficialErrataPage />} />
            <Route path="/rules/errata/:errataId" element={<OfficialErrataDetailPage />} />
            <Route path="/legal" element={<LegalPage documentId="overview" />} />
            <Route path="/legal/privacy" element={<LegalPage documentId="privacy" />} />
            <Route path="/legal/terms" element={<LegalPage documentId="terms" />} />
            <Route path="/legal/contact" element={<LegalPage documentId="contact" />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/i18n" element={<I18nManager />} />
            <Route path="/qa/battle" element={<BattleVisualQaPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </div>
      {resumePromptSession && !hideNav && (
        <OnlineResumePrompt
          session={resumePromptSession}
          status={resumePromptStatus}
          errorReason={resumeErrorReason}
          onResume={resumeStoredSession}
          onDismiss={dismissResumePrompt}
        />
      )}
      <NetworkStatusNotifier />
      <PwaInstallPrompt />
      <PwaStatusPrompt />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RouterShell />
    </BrowserRouter>
  );
}
