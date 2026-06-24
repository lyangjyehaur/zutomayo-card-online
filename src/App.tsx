import { useState } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import { SocketIO } from 'boardgame.io/multiplayer';
import { ZutomayoCard } from './game/Game';
import { Board } from './components/Board';
import { DeckEditor } from './components/DeckEditor';
import { MatchHistory } from './components/MatchHistory';
import { AIGame } from './components/AIGame';
import type { AIDifficulty } from './game/ai';
import { PRESET_DECKS } from './game/cards/presetDecks';
import './App.css';

const deckNames = Object.keys(PRESET_DECKS);
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:8000';

// Local mode client (2 players on same screen)
const LocalClient = Client({
  game: ZutomayoCard,
  board: Board,
  numPlayers: 2,
  multiplayer: Local(),
  debug: false,
});

// Online mode client (connects to server)
function createOnlineClient() {
  return Client({
    game: ZutomayoCard,
    board: Board,
    multiplayer: SocketIO({ server: SERVER_URL }),
    debug: false,
  });
}

function Lobby({ onStart, onOnline, onDeckEditor, onMatchHistory, onStartAI }: {
  onStart: (d0: string, d1: string) => void;
  onOnline: (mode: 'create' | 'join', matchID: string) => void;
  onDeckEditor: () => void;
  onMatchHistory: () => void;
  onStartAI: (difficulty: AIDifficulty) => void;
}) {
  const [deck0, setDeck0] = useState(deckNames[0]);
  const [deck1, setDeck1] = useState(deckNames[1]);
  const [matchID, setMatchID] = useState('');
  const [tab, setTab] = useState<'local' | 'online'>('local');

  return (
    <div className="lobby">
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
                  <input type="radio" name="deck0" value={name} checked={deck0 === name}
                    onChange={() => setDeck0(name)} />
                  {PRESET_DECKS[name].name}
                </label>
              ))}
            </div>

            <div className="vs">VS</div>

            <div className="player-select">
              <h3>Player 1 (Day Side)</h3>
              {deckNames.map(name => (
                <label key={name} className={`deck-option ${deck1 === name ? 'selected' : ''}`}>
                  <input type="radio" name="deck1" value={name} checked={deck1 === name}
                    onChange={() => setDeck1(name)} />
                  {PRESET_DECKS[name].name}
                </label>
              ))}
            </div>
          </div>

          <button className="start-btn" onClick={() => onStart(deck0, deck1)}>
            ⚔️ Start Local Battle
          </button>
        </>
      ) : (
        <div className="online-section">
          <div className="online-actions">
            <button className="start-btn" onClick={() => onOnline('create', '')}>
              🏠 Create Room
            </button>
            <div className="join-section">
              <input
                type="text"
                placeholder="Match ID"
                value={matchID}
                onChange={e => setMatchID(e.target.value)}
              />
              <button
                className="start-btn"
                disabled={!matchID}
                onClick={() => onOnline('join', matchID)}
              >
                🚪 Join Room
              </button>
            </div>
          </div>
          <p className="lobby-hint">Server: {SERVER_URL}</p>
        </div>
      )}

      <div className="lobby-actions">
        {tab === 'local' && (
          <>
            <button className="deck-editor-btn" onClick={() => onDeckEditor()}>
              🃏 Deck Editor
            </button>
            <button className="deck-editor-btn" onClick={() => onMatchHistory()}>
              📊 Match History
            </button>
          </>
        )}
      </div>

      <div className="ai-section">
        <h3>🤖 Practice vs AI</h3>
        <div className="ai-buttons">
          <button className="ai-btn easy" onClick={() => onStartAI('easy')}>Easy</button>
          <button className="ai-btn normal" onClick={() => onStartAI('normal')}>Normal</button>
          <button className="ai-btn hard" onClick={() => onStartAI('hard')}>Hard</button>
        </div>
      </div>

      <p className="lobby-hint">
        422 cards • 4 packs • Chronos day/night system
      </p>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<'menu' | 'local' | 'online-create' | 'online-join' | 'deck-editor' | 'match-history' | 'ai-game'>('menu');
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('normal');
  const [matchID, setMatchID] = useState('');

  const handleLocalStart = (_d0: string, _d1: string) => {
    setMode('local');
  };

  const handleOnline = (action: 'create' | 'join', id: string) => {
    if (action === 'create') {
      const newID = Math.random().toString(36).substring(2, 8);
      setMatchID(newID);
      setMode('online-create');
    } else {
      setMatchID(id);
      setMode('online-join');
    }
  };

  if (mode === 'ai-game') {
    return <AIGame difficulty={aiDifficulty} onBack={() => setMode('menu')} />;
  }

  if (mode === 'match-history') {
    return <MatchHistory onBack={() => setMode('menu')} />;
  }

  if (mode === 'deck-editor') {
    return (
      <DeckEditor
        onSave={(deck) => {
          console.log('Saved deck:', deck);
          setMode('menu');
        }}
        onCancel={() => setMode('menu')}
      />
    );
  }

  if (mode === 'menu') {
    return <Lobby onStart={handleLocalStart} onOnline={handleOnline} onDeckEditor={() => setMode('deck-editor')} onMatchHistory={() => setMode('match-history')} onStartAI={(d) => { setAiDifficulty(d); setMode('ai-game'); }} />;
  }

  if (mode === 'local') {
    return (
      <div className="app">
        <div className="game-container">
          <div className="player-view">
            <h3>Player 0</h3>
            <LocalClient playerID="0" />
          </div>
          <div className="player-view">
            <h3>Player 1</h3>
            <LocalClient playerID="1" />
          </div>
        </div>
        <button className="back-btn" onClick={() => setMode('menu')}>← Back to Lobby</button>
      </div>
    );
  }

  // Online mode
  const OnlineClient = createOnlineClient();

  return (
    <div className="app">
      <div className="match-info">
        Match ID: <code>{matchID}</code> — Share this with your opponent
      </div>
      <div className="game-container single">
        <OnlineClient playerID={mode === 'online-create' ? '0' : '1'} matchID={matchID} />
      </div>
      <button className="back-btn" onClick={() => setMode('menu')}>← Back to Lobby</button>
    </div>
  );
}
