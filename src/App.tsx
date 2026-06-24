import { useState } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import { createZutomayoCard } from './game/Game';
import { Board } from './components/Board';
import { DeckEditor } from './components/DeckEditor';
import { MatchHistory } from './components/MatchHistory';
import { AIGame } from './components/AIGame';
import { OnlineGame } from './components/OnlineGame';
import { InteractiveTutorial } from './components/InteractiveTutorial';
import type { AIDifficulty } from './game/ai';
import { PRESET_DECKS } from './game/cards/presetDecks';
import { CUSTOM_DECK_NAME, hasCustomDeck } from './game/cards/deckBuilder';
import './App.css';
import './components/InteractiveTutorial.css';

type Mode = 'menu' | 'local' | 'ai' | 'online' | 'deck-editor' | 'match-history';
type DeckOption = { id: string; name: string; disabled?: boolean };

const DEFAULT_DECK_NAME = Object.keys(PRESET_DECKS)[0] ?? '';

function selectedDeckName(deckName: string, customDeckAvailable: boolean): string | undefined {
  if (deckName === CUSTOM_DECK_NAME && !customDeckAvailable) return DEFAULT_DECK_NAME;
  return deckName || undefined;
}

async function createMatch(): Promise<string> {
  const response = await fetch('/games/zutomayo-card/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numPlayers: 2 }),
  });
  if (!response.ok) throw new Error('Could not create match');
  const data = await response.json();
  return data.matchID;
}

async function joinMatch(matchID: string, playerID: '0' | '1'): Promise<{ playerCredentials: string }> {
  const response = await fetch(`/games/zutomayo-card/${matchID}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerID, playerName: `Player ${playerID}` }),
  });
  if (!response.ok) throw new Error('Could not join match');
  return response.json();
}

function LocalBattle({ deck0Name, deck1Name }: { deck0Name?: string; deck1Name?: string }) {
  const [LocalClient] = useState(() => Client({
    game: createZutomayoCard({ deck0Name, deck1Name }),
    board: Board,
    numPlayers: 2,
    multiplayer: Local(),
    debug: false,
  }));
  return (
    <div className="app"><div className="game-container">
      <div className="player-view"><h3>Player 0</h3><LocalClient playerID="0" /></div>
      <div className="player-view"><h3>Player 1</h3><LocalClient playerID="1" /></div>
    </div></div>
  );
}

function DeckSelector({ label, name, value, options, onChange }: {
  label: string;
  name: string;
  value: string;
  options: DeckOption[];
  onChange: (deckName: string) => void;
}) {
  return (
    <div className="player-select">
      <h3>{label}</h3>
      {options.map(option => (
        <label key={option.id} className={`deck-option ${value === option.id ? 'selected' : ''}`}>
          <input
            type="radio"
            name={name}
            value={option.id}
            checked={value === option.id}
            disabled={option.disabled}
            onChange={() => onChange(option.id)}
          />
          {option.name}
        </label>
      ))}
    </div>
  );
}

function Lobby({
  navigate,
  startAI,
  startOnline,
  showTutorial,
  deck0Name,
  deck1Name,
  customDeckAvailable,
  setDeck0Name,
  setDeck1Name,
}: {
  navigate: (mode: Mode) => void;
  startAI: (difficulty: AIDifficulty) => void;
  startOnline: (matchID?: string) => Promise<void>;
  showTutorial: () => void;
  deck0Name: string;
  deck1Name: string;
  customDeckAvailable: boolean;
  setDeck0Name: (deckName: string) => void;
  setDeck1Name: (deckName: string) => void;
}) {
  const [matchID, setMatchID] = useState('');
  const [error, setError] = useState('');
  const deckOptions: DeckOption[] = [
    ...Object.entries(PRESET_DECKS).map(([id, deck]) => ({ id, name: deck.name })),
    { id: CUSTOM_DECK_NAME, name: 'Custom Deck', disabled: !customDeckAvailable },
  ];
  const runOnline = async (id?: string) => {
    setError('');
    try { await startOnline(id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Online match failed'); }
  };
  return (
    <div className="lobby">
      <h1>🎵 ZUTOMAYO CARD</h1><h2>THE BATTLE BEGINS</h2>
      <div className="deck-select">
        <DeckSelector
          label="Player 0 Deck"
          name="player-0-deck"
          value={deck0Name}
          options={deckOptions}
          onChange={setDeck0Name}
        />
        <div className="vs">VS</div>
        <DeckSelector
          label="Player 1 Deck"
          name="player-1-deck"
          value={deck1Name}
          options={deckOptions}
          onChange={setDeck1Name}
        />
      </div>
      <button className="start-btn" onClick={() => navigate('local')}>⚔️ Two-player local game</button>
      <div className="online-section">
        <button className="start-btn" onClick={() => runOnline()}>Create online room</button>
        <div className="join-section">
          <input value={matchID} onChange={event => setMatchID(event.target.value.trim())} placeholder="Match ID" />
          <button className="start-btn" disabled={!matchID} onClick={() => runOnline(matchID)}>Join room</button>
        </div>
        {error && <p>{error}</p>}
      </div>
      <div className="ai-section"><h3>Practice vs AI</h3><div className="ai-buttons">
        {(['easy', 'normal', 'hard'] as AIDifficulty[]).map(level => (
          <button key={level} className={`ai-btn ${level}`} onClick={() => startAI(level)}>{level}</button>
        ))}
      </div></div>
      <div className="lobby-actions">
        <button className="nav-btn" onClick={() => navigate('deck-editor')}>🃏 Deck editor</button>
        <button className="nav-btn" onClick={() => navigate('match-history')}>📊 Local match history</button>
        <button className="how-to-play-btn" onClick={showTutorial}>How to play</button>
      </div>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>('menu');
  const [difficulty, setDifficulty] = useState<AIDifficulty>('normal');
  const [tutorial, setTutorial] = useState(() => !localStorage.getItem('zutomayo_tutorial_seen'));
  const [customDeckAvailable, setCustomDeckAvailable] = useState(hasCustomDeck);
  const [deck0Name, setDeck0Name] = useState(DEFAULT_DECK_NAME);
  const [deck1Name, setDeck1Name] = useState(DEFAULT_DECK_NAME);
  const [online, setOnline] = useState<{
    matchID: string;
    playerID: '0' | '1';
    playerCredentials: string;
  } | null>(null);
  const closeTutorial = () => {
    localStorage.setItem('zutomayo_tutorial_seen', '1');
    setTutorial(false);
  };
  const startOnline = async (existingID?: string) => {
    const matchID = existingID || await createMatch();
    const playerID = existingID ? '1' : '0';
    const { playerCredentials } = await joinMatch(matchID, playerID);
    setOnline({ matchID, playerID, playerCredentials });
    setMode('online');
  };
  const deck0 = selectedDeckName(deck0Name, customDeckAvailable);
  const deck1 = selectedDeckName(deck1Name, customDeckAvailable);
  if (tutorial && mode === 'menu') {
    return <InteractiveTutorial onComplete={closeTutorial} onStartPractice={() => { closeTutorial(); setDifficulty('easy'); setMode('ai'); }} />;
  }
  if (mode === 'local') return <><LocalBattle deck0Name={deck0} deck1Name={deck1} /><button className="back-btn" onClick={() => setMode('menu')}>← Lobby</button></>;
  if (mode === 'ai') return <AIGame difficulty={difficulty} deck0Name={deck0} deck1Name={deck1} onBack={() => setMode('menu')} />;
  if (mode === 'online' && online) return <OnlineGame {...online} onBack={() => { setOnline(null); setMode('menu'); }} />;
  if (mode === 'deck-editor') return <DeckEditor onSave={() => { setCustomDeckAvailable(hasCustomDeck()); setMode('menu'); }} onCancel={() => setMode('menu')} />;
  if (mode === 'match-history') return <MatchHistory onBack={() => setMode('menu')} />;
  return <Lobby
    navigate={setMode}
    startAI={level => { setDifficulty(level); setMode('ai'); }}
    startOnline={startOnline}
    showTutorial={() => setTutorial(true)}
    deck0Name={deck0Name}
    deck1Name={deck1Name}
    customDeckAvailable={customDeckAvailable}
    setDeck0Name={setDeck0Name}
    setDeck1Name={setDeck1Name}
  />;
}
