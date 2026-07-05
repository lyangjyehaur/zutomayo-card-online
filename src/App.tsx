import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { identifyAnalytics, trackPageView } from './analytics';
import { formatAnonymousDisplayName } from './anonymousIdentity';
import { getDecks, getProfile, isLoggedIn, type DeckResponse } from './api/client';
import { ensureCompatibleAppVersion } from './clientVersion';
import { NetworkStatusNotifier } from './components/NetworkStatusNotifier';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { PwaStatusPrompt } from './components/PwaStatusPrompt';
import { Button, IconButton } from './ui';
import { hasStoredCustomDeck } from './game/cards/customDeck';
import type { ZutomayoSetupData } from './game/types';
import type { AIDifficulty } from './game/ai';
import { LobbyPage, aiOpponentDeckName, onlineDeckName, selectedDeckName } from './pages/LobbyPage';
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
const MatchHistoryPage = lazy(() =>
  import('./pages/MatchHistoryPage').then((module) => ({ default: module.MatchHistoryPage })),
);
const OnlineGamePage = lazy(() =>
  import('./pages/OnlineGamePage').then((module) => ({ default: module.OnlineGamePage })),
);
const OnlineLobbyPage = lazy(() =>
  import('./pages/OnlineLobbyPage').then((module) => ({ default: module.OnlineLobbyPage })),
);
const LeaderboardPage = lazy(() =>
  import('./pages/LeaderboardPage').then((module) => ({ default: module.LeaderboardPage })),
);
const FeedbackPage = lazy(() => import('./pages/FeedbackPage').then((module) => ({ default: module.FeedbackPage })));
const BattleVisualQaPage = lazy(() =>
  import('./pages/BattleVisualQaPage').then((module) => ({ default: module.BattleVisualQaPage })),
);

type OnlineRoomErrorKey =
  | 'online.roomFull'
  | 'online.roomNotFound'
  | 'online.connectionFailed'
  | 'online.versionMismatch';

function isFullscreenRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/play/') ||
    pathname.startsWith('/qa/') ||
    pathname === '/' ||
    pathname === '/online' ||
    pathname === '/ai' ||
    pathname === '/tutorial' ||
    pathname === '/history' ||
    pathname === '/leaderboard'
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
  if (!response.ok) throw onlineRoomError('online.connectionFailed');
  const data = await response.json();
  return data.matchID;
}

async function currentAccountSeatProfile(): Promise<{ data?: { userId: string }; playerName?: string } | undefined> {
  if (!isLoggedIn()) return undefined;
  try {
    const profile = await getProfile();
    return { data: { userId: profile.id }, playerName: profile.nickname };
  } catch {
    return undefined;
  }
}

async function joinMatch(
  matchID: string,
  playerID: '0' | '1',
  requestedPlayerName?: string,
): Promise<{ playerCredentials: string }> {
  await ensureCompatibleAppVersion();
  const account = await currentAccountSeatProfile();
  const playerName =
    requestedPlayerName ||
    account?.playerName ||
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
    }),
  });
  if (!response.ok) {
    if (response.status === 426) throw onlineRoomError('online.versionMismatch');
    if (response.status === 404) throw onlineRoomError('online.roomNotFound');
    if (response.status === 409) throw onlineRoomError('online.roomFull');
    throw onlineRoomError('online.connectionFailed');
  }
  return response.json();
}

function NavBar() {
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
    { path: '/ai', label: t('lobby.aiBattle') },
    { path: '/deck-builder', label: t('nav.deckBuilder') },
    { path: '/feedback', label: t('nav.feedback') },
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
          {navItems.slice(0, 5).map((item) => (
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

function RouterShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const locale = useLocale();
  const [customDeckAvailable, setCustomDeckAvailable] = useState(hasStoredCustomDeck);
  const [serverDecks, setServerDecks] = useState<DeckResponse[]>([]);
  const [serverDeckError, setServerDeckError] = useState('');
  // 卡牌資料是否已載入完成；未完成時禁用開局按鈕，避免空牌組崩潰。
  const [cardsReady, setCardsReady] = useState(false);
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

  useEffect(() => {
    void import('./game/cards/loader').then(({ loadConfigFromAPI, refreshCards }) => {
      void refreshCards().finally(() => setCardsReady(true));
      void loadConfigFromAPI();
    });
    // 同樣載入效果翻譯（API 優先，fallback 到靜態 JSON）
    void import('./game/cards/i18n').then(({ loadEffectI18nFromAPI }) => {
      void loadEffectI18nFromAPI();
    });
  }, []);

  const startAI = (difficulty: AIDifficulty) => {
    navigate('/play/ai', { state: { difficulty, autoStart: true } });
  };

  const joinSharedOnlineRoom = useCallback(async (matchID: string): Promise<OnlineSession> => {
    const { playerCredentials } = await joinMatch(matchID, '1');
    const session = { matchID, playerID: '1' as const, playerCredentials };
    setOnlineSession(session);
    setResumePromptSession(null);
    saveOnlineSession(session);
    return session;
  }, []);

  const startOnline = async (existingID?: string, playerName?: string): Promise<OnlineSession> => {
    const setupData = {
      ...onlineDeckName(0, deck0Name, serverDecks),
      ...onlineDeckName(1, deck1Name, serverDecks),
    };
    const matchID = existingID || (await createMatch(setupData));
    const playerID: '0' | '1' = existingID ? '1' : '0';
    const { playerCredentials } = await joinMatch(matchID, playerID, playerName);
    const session = { matchID, playerID, playerCredentials };
    setOnlineSession(session);
    setResumePromptSession(null);
    saveOnlineSession(session);
    navigate(`/play/online/${encodeURIComponent(matchID)}`, { state: { freshOnlineSession: true } });
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
  // 全螢幕單屏頁面（首頁/線上/電腦/教學/對戰中）有自己的 Header，不需要 NavBar 和 padding
  const hideNav = isFullscreenRoute(location.pathname);

  return (
    <div className={`app-shell ${hideNav ? 'play-shell' : 'has-nav'}`} data-locale={locale}>
      {!hideNav && <NavBar />}
      <div className="route-content">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<LobbyPage onAuthChanged={refreshServerDecks} />} />
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
                />
              }
            />
            <Route path="/play/ai" element={<AIGamePage deck0Name={deck0} deck1Name={deck1} />} />
            <Route path="/tutorial" element={<TutorialGamePage />} />
            <Route
              path="/play/online/:matchID"
              element={
                <OnlineGamePage
                  session={onlineSession}
                  onClearSession={clearOnlineSession}
                  onJoinSharedRoom={joinSharedOnlineRoom}
                  onCreateNewRoom={() => startOnline()}
                />
              }
            />
            <Route
              path="/deck-builder"
              element={
                <DeckEditorPage
                  serverDecks={serverDecks}
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
            <Route path="/history" element={<MatchHistoryPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/feedback" element={<FeedbackPage />} />
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
