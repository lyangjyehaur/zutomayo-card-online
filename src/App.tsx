import { useState, useEffect, useMemo } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import { SocketIO } from 'boardgame.io/multiplayer';
import { ZutomayoCard } from './game/Game';
import { Board } from './components/Board';
import { DeckEditor } from './components/DeckEditor';
import { MatchHistory } from './components/MatchHistory';
import { AIGame } from './components/AIGame';
import { OnlineGame } from './components/OnlineGame';
import { InteractiveTutorial } from './components/InteractiveTutorial';
import { AuthPanel, UserBadge } from './components/AuthPanel';
import { Leaderboard } from './components/Leaderboard';
import { PRESET_DECKS } from './game/cards/presetDecks';
import { isLoggedIn, logout, getProfile } from './api/client';
import type { AIDifficulty } from './game/ai';
import './App.css';
import './components/InteractiveTutorial.css';
import './components/Account.css';

const deckNames = Object.keys(PRESET_DECKS);

// Factory: create a fresh Local client for 2-player same-screen
function createLocalClient() {
  return Client({
    game: ZutomayoCard,
    board: Board,
    numPlayers: 2,
    multiplayer: Local(),
    debug: false,
  });
}

// Factory: create a fresh Online client (connects to boardgame.io server)
function createOnlineClient() {
  return Client({
    game: ZutomayoCard,
    board: Board,
    numPlayers: 2,
    multiplayer: SocketIO({ server: window.location.origin }),
    debug: false,
  });
}

// Create a match on the boardgame.io server
async function createMatch(): Promise<{ matchID: string }> {
  const res = await fetch('/games/zutomayo-card/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numPlayers: 2 }),
  });
  return res.json();
}

// Join an existing match
async function joinMatch(matchID: string, playerID: string): Promise<{ playerID: string }> {
  const res = await fetch(`/games/zutomayo-card/${matchID}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerID, playerName: `Player ${playerID}` }),
  });
  return res.json();
}

// Lobby
function Lobby({ onStart, onOnline, onDeckEditor, onMatchHistory, onStartAI, onTutorial, onLeaderboard, user, onLogout }: {
  onStart: (d0: string, d1: string) => void;
  onOnline: (mode: 'create' | 'join', matchID: string) => void;
  onDeckEditor: () => void;
  onMatchHistory: () => void;
  onStartAI: (difficulty: AIDifficulty) => void;
  onTutorial: () => void;
  onLeaderboard: () => void;
  user: { nickname: string; elo: number } | null;
  onLogout: () => void;
}) {
  const [deck0, setDeck0] = useState(deckNames[0]);
  const [deck1, setDeck1] = useState(deckNames[1]);
  const [matchID, setMatchID] = useState('');
  const [tab, setTab] = useState<'local' | 'online'>('local');

  return (
    <div className="lobby">
      {user && <div className="lobby-user"><UserBadge nickname={user.nickname} elo={user.elo} onLogout={onLogout} /></div>}

      <h1>🎵 ZUTOMAYO CARD</h1>
      <h2>THE BATTLE BEGINS</h2>

      <div className="mode-tabs">
        <button className={tab === 'local' ? 'active' : ''} onClick={() => setTab('local')}>Local</button>
        <button className={tab === 'online' ? 'active' : ''} onClick={() => setTab('online')}>Online</button>
      </div>

      {tab === 'local' ? (
        <>
          <div className="deck-select">
            <div className="player-select">
              <h3>Player 0 (Night Side)</h3>
              {deckNames.map(name => (
                <label key={name} className={`deck-option ${deck0 === name ? 'selected' : ''}`}>
                  <input type="radio" name="deck0" value={name} checked={deck0 === name} onChange={() => setDeck0(name)} />
                  {PRESET_DECKS[name].name}
                </label>
              ))}
            </div>
            <div className="vs">VS</div>
            <div className="player-select">
              <h3>Player 1 (Day Side)</h3>
              {deckNames.map(name => (
                <label key={name} className={`deck-option ${deck1 === name ? 'selected' : ''}`}>
                  <input type="radio" name="deck1" value={name} checked={deck1 === name} onChange={() => setDeck1(name)} />
                  {PRESET_DECKS[name].name}
                </label>
              ))}
            </div>
          </div>
          <button className="start-btn" onClick={() => onStart(deck0, deck1)}>⚔️ Start Local Battle</button>
        </>
      ) : (
        <div className="online-section">
          <div className="online-actions">
            <button className="start-btn" onClick={() => onOnline('create', '')}>🏠 Create Room</button>
            <div className="join-section">
              <input type="text" placeholder="Match ID" value={matchID} onChange={e => setMatchID(e.target.value)} />
              <button className="start-btn" disabled={!matchID} onClick={() => onOnline('join', matchID)}>🚪 Join Room</button>
            </div>
          </div>
        </div>
      )}

      <div className="lobby-actions">
        <button className="nav-btn" onClick={onDeckEditor}>🃏 Deck Editor</button>
        <button className="nav-btn" onClick={onMatchHistory}>📊 Match History</button>
        <button className="nav-btn" onClick={onLeaderboard}>🏆 Leaderboard</button>
      </div>

      <div className="ai-section">
        <h3>🤖 Practice vs AI</h3>
        <div className="ai-buttons">
          <button className="ai-btn easy" onClick={() => onStartAI('easy')}>Easy</button>
          <button className="ai-btn normal" onClick={() => onStartAI('normal')}>Normal</button>
          <button className="ai-btn hard" onClick={() => onStartAI('hard')}>Hard</button>
        </div>
      </div>

      <button className="how-to-play-btn" onClick={onTutorial}>❓ How to Play</button>
    </div>
  );
}

// Local Battle wrapper — fresh client each mount
function LocalBattle() {
  const [LocalClient] = useState(() => createLocalClient());

  return (
    <div className="app">
      <div className="game-container">
        <div className="player-view"><h3>Player 0</h3><LocalClient playerID="0" /></div>
        <div className="player-view"><h3>Player 1</h3><LocalClient playerID="1" /></div>
      </div>
    </div>
  );
}

// Main App
export default function App() {
  const [mode, setMode] = useState<string>('menu');
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('normal');
  const [showTutorial, setShowTutorial] = useState(() => !localStorage.getItem('zutomayo_tutorial_seen'));
  const [user, setUser] = useState<{ id: string; email: string; nickname: string; elo: number } | null>(null);
  const [onlineMatch, setOnlineMatch] = useState<{ matchID: string; playerID: string } | null>(null);

  useEffect(() => {
    if (isLoggedIn()) {
      getProfile().then(setUser).catch(() => localStorage.removeItem('zutomayo_token'));
    }
  }, []);

  const closeTutorial = () => {
    localStorage.setItem('zutomayo_tutorial_seen', '1');
    setShowTutorial(false);
  };

  const handleAuth = (userData: any) => {
    setUser(userData);
    setMode('menu');
  };

  const handleLogout = () => {
    logout();
    setUser(null);
  };

  // Auth gate
  if (!user && !localStorage.getItem('zutomayo_guest') && mode === 'menu') {
    return <AuthPanel onAuth={handleAuth} onSkip={() => localStorage.setItem('zutomayo_guest', '1')} />;
  }

  // Tutorial overlay
  if (showTutorial && mode === 'menu') {
    return (
      <>
        <InteractiveTutorial onComplete={closeTutorial} onStartPractice={() => { closeTutorial(); setAiDifficulty('easy'); setMode('ai-game'); }} />
        <Lobby
          onStart={() => setMode('local')}
          onOnline={(action, id) => setMode(action === 'create' ? 'online-create' : 'online-join')}
          onDeckEditor={() => setMode('deck-editor')}
          onMatchHistory={() => setMode('match-history')}
          onStartAI={(d) => { setAiDifficulty(d); setMode('ai-game'); }}
          onTutorial={() => setShowTutorial(true)}
          onLeaderboard={() => setMode('leaderboard')}
          user={user}
          onLogout={handleLogout}
        />
      </>
    );
  }

  // Mode routing — each mode renders independently
  switch (mode) {
    case 'menu':
      return (
        <Lobby
          onStart={() => setMode('local')}
          onOnline={async (action, matchID) => {
            if (action === 'create') {
              try {
                const { matchID } = await createMatch();
                setOnlineMatch({ matchID, playerID: '0' });
                setMode('online-play');
              } catch (e) {
                alert('Failed to create match. Is the server running?');
              }
            } else {
              try {
                const { playerID } = await joinMatch(matchID, '1');
                setOnlineMatch({ matchID, playerID });
                setMode('online-play');
              } catch (e) {
                alert('Failed to join match. Check the Match ID.');
              }
            }
          }}
          onDeckEditor={() => setMode('deck-editor')}
          onMatchHistory={() => setMode('match-history')}
          onStartAI={(d) => { setAiDifficulty(d); setMode('ai-game'); }}
          onTutorial={() => setShowTutorial(true)}
          onLeaderboard={() => setMode('leaderboard')}
          user={user}
          onLogout={handleLogout}
        />
      );

    case 'local':
      return (
        <>
          <LocalBattle />
          <button className="back-btn" onClick={() => setMode('menu')}>← Back to Lobby</button>
        </>
      );

    case 'ai-game':
      return <AIGame difficulty={aiDifficulty} onBack={() => setMode('menu')} />;

    case 'online-play':
      if (!onlineMatch) { setMode('menu'); return null; }
      return (
        <OnlineGame
          matchID={onlineMatch.matchID}
          playerID={onlineMatch.playerID}
          onBack={() => { setOnlineMatch(null); setMode('menu'); }}
        />
      );

    case 'deck-editor':
      return <DeckEditor onSave={() => setMode('menu')} onCancel={() => setMode('menu')} />;

    case 'match-history':
      return <MatchHistory onBack={() => setMode('menu')} />;

    case 'leaderboard':
      return <Leaderboard onBack={() => setMode('menu')} />;

    default:
      return <Lobby
        onStart={() => setMode('local')}
        onOnline={(action) => setMode(action === 'create' ? 'online-create' : 'online-join')}
        onDeckEditor={() => setMode('deck-editor')}
        onMatchHistory={() => setMode('match-history')}
        onStartAI={(d) => { setAiDifficulty(d); setMode('ai-game'); }}
        onTutorial={() => setShowTutorial(true)}
        onLeaderboard={() => setMode('leaderboard')}
        user={user}
        onLogout={handleLogout}
      />;
  }
}
