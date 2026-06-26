import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { getDecks, isLoggedIn, type DeckResponse } from './api/client';
import { InteractiveTutorial } from './components/InteractiveTutorial';
import { hasCustomDeck } from './game/cards/deckBuilder';
import type { ZutomayoSetupData } from './game/types';
import type { AIDifficulty } from './game/ai';
import { AdminPage } from './pages/AdminPage';
import { I18nManager } from './pages/I18nManager';
import { AIGamePage } from './pages/AIGamePage';
import { DeckEditorPage } from './pages/DeckEditorPage';
import { LobbyPage, DEFAULT_DECK_NAME, onlineDeckName, selectedDeckName } from './pages/LobbyPage';
import { LocalGamePage } from './pages/LocalGamePage';
import { MatchHistoryPage } from './pages/MatchHistoryPage';
import { OnlineGamePage } from './pages/OnlineGamePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { t, useLocale, type TranslationKey } from './i18n';
import {
  clearStoredOnlineSession,
  loadOnlineSession,
  saveOnlineSession,
  validateOnlineSession,
  type OnlineSession,
  type OnlineSessionValidationReason,
} from './onlineSession';
import './App.css';
import './components/InteractiveTutorial.css';

async function createMatch(setupData: ZutomayoSetupData): Promise<string> {
  const response = await fetch('/games/zutomayo-card/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numPlayers: 2, setupData }),
  });
  if (!response.ok) throw new Error(t('lobby.onlineError'));
  const data = await response.json();
  return data.matchID;
}

async function joinMatch(matchID: string, playerID: '0' | '1'): Promise<{ playerCredentials: string }> {
  const response = await fetch(`/games/zutomayo-card/${matchID}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerID, playerName: playerID === '0' ? t('player.zero') : t('player.one') }),
  });
  if (!response.ok) throw new Error(t('lobby.onlineError'));
  return response.json();
}

function NavBar({ onShowTutorial }: { onShowTutorial: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();

  if (location.pathname.startsWith('/play/')) return null;

  const buttonClass = (path: string) => `nav-link ${location.pathname === path ? 'active' : ''}`;

  return (
    <nav className="nav-bar" aria-label={t('nav.primary')}>
      <button className={buttonClass('/')} type="button" onClick={() => navigate('/')}>
        {t('nav.lobby')}
      </button>
      <button className={buttonClass('/deck-builder')} type="button" onClick={() => navigate('/deck-builder')}>
        {t('nav.deckBuilder')}
      </button>
      <button className={buttonClass('/history')} type="button" onClick={() => navigate('/history')}>
        {t('nav.history')}
      </button>
      <button className={buttonClass('/leaderboard')} type="button" onClick={() => navigate('/leaderboard')}>
        🏆 排行
      </button>
      <button className="nav-link tutorial" type="button" onClick={onShowTutorial}>
        {t('nav.tutorial')}
      </button>
    </nav>
  );
}

function resumeErrorTitle(reason: OnlineSessionValidationReason): TranslationKey {
  if (reason === 'roomGone') return 'onlineSession.roomGoneTitle';
  if (reason === 'seatTaken') return 'onlineSession.seatTakenTitle';
  return 'onlineSession.resumeErrorTitle';
}

function resumeErrorBody(reason: OnlineSessionValidationReason): TranslationKey {
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

function RouterShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const locale = useLocale();
  const [tutorial, setTutorial] = useState(() => !localStorage.getItem('zutomayo_tutorial_seen'));
  const [customDeckAvailable, setCustomDeckAvailable] = useState(hasCustomDeck);
  const [serverDecks, setServerDecks] = useState<DeckResponse[]>([]);
  const [deck0Name, setDeck0Name] = useState(DEFAULT_DECK_NAME);
  const [deck1Name, setDeck1Name] = useState(DEFAULT_DECK_NAME);
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(loadOnlineSession);
  const [resumePromptSession, setResumePromptSession] = useState<OnlineSession | null>(() => (
    location.pathname.startsWith('/play/online/') ? null : loadOnlineSession()
  ));
  const [resumePromptStatus, setResumePromptStatus] = useState<'idle' | 'reconnecting' | 'error'>('idle');
  const [resumeErrorReason, setResumeErrorReason] = useState<OnlineSessionValidationReason | null>(null);

  const closeTutorial = () => {
    localStorage.setItem('zutomayo_tutorial_seen', '1');
    setTutorial(false);
  };

  const refreshServerDecks = useCallback(async () => {
    if (!isLoggedIn()) {
      setServerDecks([]);
      setDeck0Name(current => current.startsWith('server:') ? DEFAULT_DECK_NAME : current);
      setDeck1Name(current => current.startsWith('server:') ? DEFAULT_DECK_NAME : current);
      return;
    }
    try {
      setServerDecks(await getDecks());
    } catch {
      setServerDecks([]);
    }
  }, []);

  useEffect(() => {
    void refreshServerDecks();
  }, [refreshServerDecks]);

  const startAI = (difficulty: AIDifficulty) => {
    navigate('/play/ai', { state: { difficulty, autoStart: true } });
  };

  const startOnline = async (existingID?: string) => {
    const setupData = {
      ...onlineDeckName(0, deck0Name, serverDecks),
      ...onlineDeckName(1, deck1Name, serverDecks),
    };
    const matchID = existingID || await createMatch(setupData);
    const playerID: '0' | '1' = existingID ? '1' : '0';
    const { playerCredentials } = await joinMatch(matchID, playerID);
    const session = { matchID, playerID, playerCredentials };
    setOnlineSession(session);
    setResumePromptSession(null);
    saveOnlineSession(session);
    navigate(`/play/online/${encodeURIComponent(matchID)}`, { state: { freshOnlineSession: true } });
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
  const hideNav = location.pathname.startsWith('/play/');

  return (
    <div className={`app-shell ${hideNav ? 'play-shell' : 'has-nav'}`} data-locale={locale}>
      {!hideNav && <NavBar onShowTutorial={() => setTutorial(true)} />}
      <div className="route-content">
        <Routes>
          <Route
            path="/"
            element={(
              <LobbyPage
                deck0Name={deck0Name}
                deck1Name={deck1Name}
                customDeckAvailable={customDeckAvailable}
                serverDecks={serverDecks}
                setDeck0Name={setDeck0Name}
                setDeck1Name={setDeck1Name}
                onStartAI={startAI}
                onStartOnline={startOnline}
                onAuthChanged={refreshServerDecks}
                onShowTutorial={() => setTutorial(true)}
              />
            )}
          />
          <Route path="/play/local" element={<LocalGamePage deck0Name={deck0} deck1Name={deck1} />} />
          <Route path="/play/ai" element={<AIGamePage deck0Name={deck0} deck1Name={deck1} />} />
          <Route
            path="/play/online/:matchID"
            element={<OnlineGamePage session={onlineSession} onClearSession={clearOnlineSession} />}
          />
          <Route
            path="/deck-builder"
            element={(
              <DeckEditorPage
                serverDecks={serverDecks}
                onServerDecksLoaded={setServerDecks}
                onDeckSaved={deck => {
                  setCustomDeckAvailable(hasCustomDeck());
                  if (deck) setServerDecks(current => [deck, ...current]);
                }}
              />
            )}
          />
          <Route path="/history" element={<MatchHistoryPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/i18n" element={<I18nManager />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
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
