import { useMemo, useState } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import { createZutomayoCard } from './game/Game';
import { Board } from './components/Board';
import { Card } from './components/Card';
import { DeckEditor } from './components/DeckEditor';
import { MatchHistory } from './components/MatchHistory';
import { AIGame } from './components/AIGame';
import { OnlineGame } from './components/OnlineGame';
import { InteractiveTutorial } from './components/InteractiveTutorial';
import type { AIDifficulty } from './game/ai';
import { PRESET_DECKS } from './game/cards/presetDecks';
import { CUSTOM_DECK_NAME, hasCustomDeck, loadCustomDeckIds } from './game/cards/deckBuilder';
import { t } from './i18n';
import './App.css';
import './components/InteractiveTutorial.css';

type Mode = 'menu' | 'local' | 'ai' | 'online' | 'deck-editor' | 'match-history';
type DeckOption = {
  id: string;
  name: string;
  description: string;
  previewIds: string[];
  disabled?: boolean;
};

const DEFAULT_DECK_NAME = Object.keys(PRESET_DECKS)[0] ?? '';

const DECK_COPY: Record<string, { nameKey: Parameters<typeof t>[0]; descKey: Parameters<typeof t>[0] }> = {
  dark: { nameKey: 'deck.dark', descKey: 'deck.darkDesc' },
  flame: { nameKey: 'deck.flame', descKey: 'deck.flameDesc' },
  electric: { nameKey: 'deck.electric', descKey: 'deck.electricDesc' },
  wind: { nameKey: 'deck.wind', descKey: 'deck.windDesc' },
};

function selectedDeckName(deckName: string, customDeckAvailable: boolean): string | undefined {
  if (deckName === CUSTOM_DECK_NAME && !customDeckAvailable) return DEFAULT_DECK_NAME;
  return deckName || undefined;
}

function onlineDeckName(deckName: string): string | undefined {
  if (deckName === CUSTOM_DECK_NAME) return DEFAULT_DECK_NAME;
  return deckName || undefined;
}

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

function buildDeckOptions(customDeckAvailable: boolean): DeckOption[] {
  const presetOptions = Object.entries(PRESET_DECKS).map(([id, deck]) => {
    const copy = DECK_COPY[id];
    return {
      id,
      name: copy ? t(copy.nameKey) : deck.name,
      description: copy ? t(copy.descKey) : deck.name,
      previewIds: deck.ids.slice(0, 3),
    };
  });

  return [
    ...presetOptions,
    {
      id: CUSTOM_DECK_NAME,
      name: t('deck.custom'),
      description: customDeckAvailable ? t('deck.customDesc') : t('lobby.customDeckLocked'),
      previewIds: loadCustomDeckIds()?.slice(0, 3) ?? presetOptions[0]?.previewIds ?? [],
      disabled: !customDeckAvailable,
    },
  ];
}

function LocalBattle({ deck0Name, deck1Name, onBack }: {
  deck0Name?: string;
  deck1Name?: string;
  onBack: () => void;
}) {
  const [LocalClient] = useState(() => Client({
    game: createZutomayoCard({ deck0Name, deck1Name }),
    board: Board,
    numPlayers: 2,
    multiplayer: Local(),
    debug: false,
  }));

  return (
    <div className="app game-app">
      <GameHeader title={t('game.localMode')} subtitle={`${t('player.zero')} / ${t('player.one')}`} onBack={onBack} />
      <div className="game-container local-duel">
        <section className="player-view">
          <div className="view-label">{t('player.zeroView')}</div>
          <LocalClient playerID="0" />
        </section>
        <section className="player-view">
          <div className="view-label">{t('player.oneView')}</div>
          <LocalClient playerID="1" />
        </section>
      </div>
    </div>
  );
}

function GameHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <header className="game-header">
      <button className="back-btn" type="button" onClick={onBack}>{t('common.backToLobby')}</button>
      <div>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </header>
  );
}

function DeckSelector({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: DeckOption[];
  onChange: (deckName: string) => void;
}) {
  return (
    <section className="deck-selector">
      <div className="section-heading">
        <h3>{label}</h3>
        <span>{t('lobby.deckSelectHint')}</span>
      </div>
      <div className="deck-option-grid">
        {options.map(option => (
          <button
            key={option.id}
            className={`deck-option-card ${value === option.id ? 'selected' : ''}`}
            type="button"
            disabled={option.disabled}
            onClick={() => onChange(option.id)}
          >
            <div className="deck-preview-stack" aria-hidden="true">
              {option.previewIds.map((id, index) => (
                <Card
                  key={`${option.id}-${id}-${index}`}
                  card={{ instanceId: `${option.id}-${id}-${index}`, defId: id, faceUp: true }}
                  size="micro"
                />
              ))}
            </div>
            <div className="deck-option-copy">
              <strong>{option.name}</strong>
              <span>{option.description}</span>
            </div>
            {value === option.id && <em>{t('common.selected')}</em>}
          </button>
        ))}
      </div>
    </section>
  );
}

function DifficultyButtons({ onStart }: { onStart: (difficulty: AIDifficulty) => void }) {
  const levels: { id: AIDifficulty; label: string; detail: string }[] = [
    { id: 'easy', label: t('difficulty.easy'), detail: t('difficulty.easyDesc') },
    { id: 'normal', label: t('difficulty.normal'), detail: t('difficulty.normalDesc') },
    { id: 'hard', label: t('difficulty.hard'), detail: t('difficulty.hardDesc') },
  ];

  return (
    <section className="lobby-panel ai-panel">
      <div className="section-heading">
        <h3>{t('lobby.aiBattle')}</h3>
        <span>{t('lobby.difficulty')}</span>
      </div>
      <div className="difficulty-grid">
        {levels.map(level => (
          <button key={level.id} className={`difficulty-card ${level.id}`} type="button" onClick={() => onStart(level.id)}>
            <strong>{level.label}</strong>
            <span>{level.detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function OnlinePanel({ startOnline }: { startOnline: (matchID?: string) => Promise<void> }) {
  const [matchID, setMatchID] = useState('');
  const [error, setError] = useState('');

  const runOnline = async (id?: string) => {
    setError('');
    try {
      await startOnline(id);
    } catch {
      setError(t('lobby.onlineError'));
    }
  };

  return (
    <section className="lobby-panel online-panel">
      <div className="section-heading">
        <h3>{t('lobby.onlineTitle')}</h3>
        <span>{t('game.onlineMode')}</span>
      </div>
      <div className="online-actions">
        <button className="primary-action" type="button" onClick={() => runOnline()}>
          {t('lobby.createRoom')}
        </button>
        <div className="join-row">
          <input
            value={matchID}
            onChange={event => setMatchID(event.target.value.trim())}
            placeholder={t('lobby.roomCodePlaceholder')}
            aria-label={t('lobby.roomCode')}
          />
          <button className="secondary-action" type="button" disabled={!matchID} onClick={() => runOnline(matchID)}>
            {t('lobby.joinRoom')}
          </button>
        </div>
      </div>
      {error && <p className="error-copy">{error}</p>}
    </section>
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
  const deckOptions = useMemo(() => buildDeckOptions(customDeckAvailable), [customDeckAvailable]);

  return (
    <main className="lobby">
      <div className="lobby-backdrop" />
      <section className="lobby-hero">
        <div className="title-lockup">
          <span>{t('lobby.menu')}</span>
          <h1>{t('app.title')}</h1>
          <p>{t('app.subtitle')}</p>
        </div>
        <div className="primary-menu">
          <button className="menu-action featured" type="button" onClick={() => navigate('local')}>
            {t('lobby.localBattle')}
          </button>
          <button className="menu-action" type="button" onClick={() => navigate('deck-editor')}>
            {t('lobby.deckEditor')}
          </button>
          <button className="menu-action" type="button" onClick={() => navigate('match-history')}>
            {t('lobby.matchHistory')}
          </button>
          <button className="menu-action" type="button" onClick={showTutorial}>
            {t('lobby.tutorial')}
          </button>
        </div>
      </section>

      <section className="lobby-grid">
        <div className="lobby-panel deck-panel">
          <DeckSelector label={t('lobby.myDeck')} value={deck0Name} options={deckOptions} onChange={setDeck0Name} />
          <DeckSelector label={t('lobby.opponentDeck')} value={deck1Name} options={deckOptions} onChange={setDeck1Name} />
        </div>
        <div className="lobby-side">
          <DifficultyButtons onStart={startAI} />
          <OnlinePanel startOnline={startOnline} />
        </div>
      </section>
    </main>
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
    const matchID = existingID || await createMatch(onlineDeckName(deck0Name), onlineDeckName(deck1Name));
    const playerID = existingID ? '1' : '0';
    const { playerCredentials } = await joinMatch(matchID, playerID);
    setOnline({ matchID, playerID, playerCredentials });
    setMode('online');
  };

  const deck0 = selectedDeckName(deck0Name, customDeckAvailable);
  const deck1 = selectedDeckName(deck1Name, customDeckAvailable);

  if (tutorial && mode === 'menu') {
    return (
      <InteractiveTutorial
        onComplete={closeTutorial}
        onStartPractice={() => {
          closeTutorial();
          setDifficulty('easy');
          setMode('ai');
        }}
      />
    );
  }

  if (mode === 'local') {
    return <LocalBattle deck0Name={deck0} deck1Name={deck1} onBack={() => setMode('menu')} />;
  }

  if (mode === 'ai') {
    return (
      <AIGame
        difficulty={difficulty}
        deck0Name={deck0}
        deck1Name={deck1}
        onBack={() => setMode('menu')}
      />
    );
  }

  if (mode === 'online' && online) {
    return (
      <OnlineGame
        {...online}
        onBack={() => {
          setOnline(null);
          setMode('menu');
        }}
      />
    );
  }

  if (mode === 'deck-editor') {
    return (
      <DeckEditor
        onSave={() => {
          setCustomDeckAvailable(hasCustomDeck());
          setMode('menu');
        }}
        onCancel={() => setMode('menu')}
      />
    );
  }

  if (mode === 'match-history') return <MatchHistory onBack={() => setMode('menu')} />;

  return (
    <Lobby
      navigate={setMode}
      startAI={level => {
        setDifficulty(level);
        setMode('ai');
      }}
      startOnline={startOnline}
      showTutorial={() => setTutorial(true)}
      deck0Name={deck0Name}
      deck1Name={deck1Name}
      customDeckAvailable={customDeckAvailable}
      setDeck0Name={setDeck0Name}
      setDeck1Name={setDeck1Name}
    />
  );
}
