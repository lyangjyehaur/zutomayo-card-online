import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/Card';
import type { AIDifficulty } from '../game/ai';
import { CUSTOM_DECK_NAME, loadCustomDeckIds } from '../game/cards/deckBuilder';
import { PRESET_DECKS } from '../game/cards/presetDecks';
import { t } from '../i18n';

type DeckOption = {
  id: string;
  name: string;
  description: string;
  previewIds: string[];
  disabled?: boolean;
};

const DECK_COPY: Record<string, { nameKey: Parameters<typeof t>[0]; descKey: Parameters<typeof t>[0] }> = {
  dark: { nameKey: 'deck.dark', descKey: 'deck.darkDesc' },
  flame: { nameKey: 'deck.flame', descKey: 'deck.flameDesc' },
  electric: { nameKey: 'deck.electric', descKey: 'deck.electricDesc' },
  wind: { nameKey: 'deck.wind', descKey: 'deck.windDesc' },
};

export const DEFAULT_DECK_NAME = Object.keys(PRESET_DECKS)[0] ?? '';

export function selectedDeckName(deckName: string, customDeckAvailable: boolean): string | undefined {
  if (deckName === CUSTOM_DECK_NAME && !customDeckAvailable) return DEFAULT_DECK_NAME;
  return deckName || undefined;
}

export function onlineDeckName(deckName: string): string | undefined {
  if (deckName === CUSTOM_DECK_NAME) return DEFAULT_DECK_NAME;
  return deckName || undefined;
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

interface LobbyPageProps {
  deck0Name: string;
  deck1Name: string;
  customDeckAvailable: boolean;
  setDeck0Name: (deckName: string) => void;
  setDeck1Name: (deckName: string) => void;
  onStartAI: (difficulty: AIDifficulty) => void;
  onStartOnline: (matchID?: string) => Promise<void>;
  onShowTutorial: () => void;
}

export function LobbyPage({
  deck0Name,
  deck1Name,
  customDeckAvailable,
  setDeck0Name,
  setDeck1Name,
  onStartAI,
  onStartOnline,
  onShowTutorial,
}: LobbyPageProps) {
  const navigate = useNavigate();
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
          <button className="menu-action featured" type="button" onClick={() => navigate('/play/local')}>
            {t('lobby.localBattle')}
          </button>
          <button className="menu-action" type="button" onClick={() => navigate('/deck-builder')}>
            {t('lobby.deckEditor')}
          </button>
          <button className="menu-action" type="button" onClick={() => navigate('/history')}>
            {t('lobby.matchHistory')}
          </button>
          <button className="menu-action" type="button" onClick={onShowTutorial}>
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
          <DifficultyButtons onStart={onStartAI} />
          <OnlinePanel startOnline={onStartOnline} />
        </div>
      </section>
    </main>
  );
}
