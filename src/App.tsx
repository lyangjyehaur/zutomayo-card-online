import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { identifyAnalytics, trackPageView } from './analytics';
import { formatAnonymousDisplayName } from './anonymousIdentity';
import { getDecks, getProfile, isLoggedIn, type DeckResponse } from './api/client';
import { ensureCompatibleAppVersion } from './clientVersion';
import { InteractiveTutorial } from './components/InteractiveTutorial';
import { NetworkStatusNotifier } from './components/NetworkStatusNotifier';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { PwaStatusPrompt } from './components/PwaStatusPrompt';
import { hasStoredCustomDeck } from './game/cards/customDeck';
import type { ZutomayoSetupData } from './game/types';
import type { AIDifficulty } from './game/ai';
import { LobbyPage, onlineDeckName, selectedDeckName } from './pages/LobbyPage';
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
import './components/InteractiveTutorial.css';

const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));
const I18nManager = lazy(() => import('./pages/I18nManager').then((module) => ({ default: module.I18nManager })));
const AIGamePage = lazy(() => import('./pages/AIGamePage').then((module) => ({ default: module.AIGamePage })));
const AILobbyPage = lazy(() => import('./pages/AILobbyPage').then((module) => ({ default: module.AILobbyPage })));
const TutorialGamePage = lazy(() => import('./pages/TutorialGamePage').then((module) => ({ default: module.TutorialGamePage })));
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

type OnlineRoomErrorKey =
  | 'online.roomFull'
  | 'online.roomNotFound'
  | 'online.connectionFailed'
  | 'online.versionMismatch';

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

function NavBar({ onShowTutorial }: { onShowTutorial: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();

  // 全螢幕單屏頁面有自己的 Header，不需要 NavBar
  if (
    location.pathname.startsWith('/play/') ||
    location.pathname === '/' ||
    location.pathname === '/online' ||
    location.pathname === '/ai'
  ) {
    return null;
  }

  const buttonClass = (path: string) =>
    `text-[10px] uppercase tracking-[0.3em] transition-colors ${
      location.pathname === path ? 'text-gold' : 'text-bone/50 hover:text-bone'
    }`;

  return (
    <nav
      className="absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-between border-b border-bone/5 bg-lacquer-deep/80 px-6 backdrop-blur"
      aria-label={t('nav.primary')}
    >
      <div className="flex items-center gap-6">
        <button className={buttonClass('/')} type="button" onClick={() => navigate('/')}>
          {t('nav.lobby')}
        </button>
        <button className={buttonClass('/online')} type="button" onClick={() => navigate('/online')}>
          {t('lobby.onlineTitle')}
        </button>
        <button className={buttonClass('/ai')} type="button" onClick={() => navigate('/ai')}>
          {t('lobby.aiBattle')}
        </button>
        <button className={buttonClass('/deck-builder')} type="button" onClick={() => navigate('/deck-builder')}>
          {t('nav.deckBuilder')}
        </button>
        <button className={buttonClass('/feedback')} type="button" onClick={() => navigate('/feedback')}>
          {t('nav.feedback')}
        </button>
      </div>
      <button className={buttonClass('')} type="button" onClick={onShowTutorial}>
        {t('nav.tutorial')}
      </button>
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
          <button className="primary-action" type="button" disabled={status === 'reconnecting'} onClick={onResume}>
            {status === 'reconnecting' ? t('onlineSession.reconnecting') : t('onlineSession.resumeAction')}
          </button>
        )}
        <button className="secondary-action" type="button" onClick={onDismiss}>
          {t('onlineSession.dismissAction')}
        </button>
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
        <button className="primary-action" type="button" onClick={() => navigate('/')}>
          {t('common.backToLobby')}
        </button>
      </section>
    </main>
  );
}

function RouteFallback() {
  return (
    <main className="app-screen grid place-items-center bg-lacquer-deep font-mono text-[10px] uppercase tracking-[0.3em] text-bone/50">
      {t('game.loading')}
    </main>
  );
}

function RouterShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const locale = useLocale();
  const [tutorial, setTutorial] = useState(() => !localStorage.getItem('zutomayo_tutorial_seen'));
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

  const closeTutorial = () => {
    localStorage.setItem('zutomayo_tutorial_seen', '1');
    setTutorial(false);
  };

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
  const deck1 = selectedDeckName(deck1Name, customDeckAvailable);
  // 全螢幕單屏頁面（首頁/線上/電腦/對戰中）有自己的 Header，不需要 NavBar 和 padding
  const hideNav =
    location.pathname.startsWith('/play/') ||
    location.pathname === '/' ||
    location.pathname === '/online' ||
    location.pathname === '/ai';

  return (
    <div className={`app-shell ${hideNav ? 'play-shell' : 'has-nav'}`} data-locale={locale}>
      {!hideNav && <NavBar onShowTutorial={() => setTutorial(true)} />}
      <div className="route-content">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route
              path="/"
              element={<LobbyPage onAuthChanged={refreshServerDecks} onShowTutorial={() => setTutorial(true)} />}
            />
            <Route
              path="/online"
              element={
                <OnlineLobbyPage
                  deck0Name={deck0Name}
                  customDeckAvailable={customDeckAvailable}
                  serverDecks={serverDecks}
                  setDeck0Name={setDeck0Name}
                  onStartOnline={startOnline}
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
      {tutorial && (
        <InteractiveTutorial
          onComplete={closeTutorial}
          onStartPractice={() => {
            closeTutorial();
            navigate('/play/ai', { state: { difficulty: 'easy', autoStart: true } });
          }}
        />
      )}
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
