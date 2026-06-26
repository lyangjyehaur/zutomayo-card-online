import { useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { InteractiveTutorial } from './components/InteractiveTutorial';
import { hasCustomDeck } from './game/cards/deckBuilder';
import type { AIDifficulty } from './game/ai';
import { AdminPage } from './pages/AdminPage';
import { I18nManager } from './pages/I18nManager';
import { AIGamePage } from './pages/AIGamePage';
import { DeckEditorPage } from './pages/DeckEditorPage';
import { LobbyPage, DEFAULT_DECK_NAME, onlineDeckName, selectedDeckName } from './pages/LobbyPage';
import { LocalGamePage } from './pages/LocalGamePage';
import { MatchHistoryPage } from './pages/MatchHistoryPage';
import { OnlineGamePage, type OnlineSession } from './pages/OnlineGamePage';
import { t, useLocale } from './i18n';
import './App.css';
import './components/InteractiveTutorial.css';

const ONLINE_SESSION_STORAGE_KEY = 'zutomayo_online_session';

async function createMatch(deck0Name?: string, deck1Name?: string): Promise<string> {
  const response = await fetch('/games/zutomayo-card/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numPlayers: 2, setupData: { deck0Name, deck1Name } }),
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

function loadOnlineSession(): OnlineSession | null {
  try {
    const raw = sessionStorage.getItem(ONLINE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<OnlineSession>;
    if (
      typeof data.matchID === 'string' &&
      (data.playerID === '0' || data.playerID === '1') &&
      typeof data.playerCredentials === 'string'
    ) {
      return {
        matchID: data.matchID,
        playerID: data.playerID,
        playerCredentials: data.playerCredentials,
      };
    }
  } catch {
    sessionStorage.removeItem(ONLINE_SESSION_STORAGE_KEY);
  }
  return null;
}

function saveOnlineSession(session: OnlineSession): void {
  sessionStorage.setItem(ONLINE_SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredOnlineSession(): void {
  sessionStorage.removeItem(ONLINE_SESSION_STORAGE_KEY);
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
      <button className="nav-link tutorial" type="button" onClick={onShowTutorial}>
        {t('nav.tutorial')}
      </button>
    </nav>
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
  const [deck0Name, setDeck0Name] = useState(DEFAULT_DECK_NAME);
  const [deck1Name, setDeck1Name] = useState(DEFAULT_DECK_NAME);
  const [onlineSession, setOnlineSession] = useState<OnlineSession | null>(loadOnlineSession);

  const closeTutorial = () => {
    localStorage.setItem('zutomayo_tutorial_seen', '1');
    setTutorial(false);
  };

  const startAI = (difficulty: AIDifficulty) => {
    navigate('/play/ai', { state: { difficulty, autoStart: true } });
  };

  const startOnline = async (existingID?: string) => {
    const matchID = existingID || await createMatch(onlineDeckName(deck0Name), onlineDeckName(deck1Name));
    const playerID: '0' | '1' = existingID ? '1' : '0';
    const { playerCredentials } = await joinMatch(matchID, playerID);
    const session = { matchID, playerID, playerCredentials };
    setOnlineSession(session);
    saveOnlineSession(session);
    navigate(`/play/online/${encodeURIComponent(matchID)}`);
  };

  const clearOnlineSession = () => {
    setOnlineSession(null);
    clearStoredOnlineSession();
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
                setDeck0Name={setDeck0Name}
                setDeck1Name={setDeck1Name}
                onStartAI={startAI}
                onStartOnline={startOnline}
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
                onDeckSaved={() => setCustomDeckAvailable(hasCustomDeck())}
              />
            )}
          />
          <Route path="/history" element={<MatchHistoryPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/i18n" element={<I18nManager />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
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
