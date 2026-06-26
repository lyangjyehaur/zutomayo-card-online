import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProfile, isLoggedIn, login, logout as logoutAccount, register, type DeckResponse } from '../api/client';
import { Card } from '../components/Card';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import type { AIDifficulty } from '../game/ai';
import type { PlayerIndex, ZutomayoSetupData } from '../game/types';
import { CUSTOM_DECK_NAME, loadCustomDeckIds } from '../game/cards/deckBuilder';
import { PRESET_DECKS } from '../game/cards/presetDecks';
import { t, useLocale } from '../i18n';
import type { OnlineSession } from '../onlineSession';

type DeckOption = {
  id: string;
  name: string;
  description: string;
  previewIds: string[];
  synced?: boolean;
  disabled?: boolean;
};

type DeckOptionGroup = {
  label: string;
  options: DeckOption[];
};

type AuthMode = 'login' | 'register';
type OnlineRoomErrorKey = 'online.roomFull' | 'online.roomNotFound' | 'online.connectionFailed';
type AuthUser = {
  id: string;
  email: string;
  nickname: string;
  elo: number;
};

const DECK_COPY: Record<string, { nameKey: Parameters<typeof t>[0]; descKey: Parameters<typeof t>[0] }> = {
  dark: { nameKey: 'deck.dark', descKey: 'deck.darkDesc' },
  flame: { nameKey: 'deck.flame', descKey: 'deck.flameDesc' },
  electric: { nameKey: 'deck.electric', descKey: 'deck.electricDesc' },
  wind: { nameKey: 'deck.wind', descKey: 'deck.windDesc' },
};

export const DEFAULT_DECK_NAME = Object.keys(PRESET_DECKS)[0] ?? '';
const SERVER_DECK_PREFIX = 'server:';

function serverDeckOptionId(deckId: string): string {
  return `${SERVER_DECK_PREFIX}${deckId}`;
}

function serverDeckIdFromOption(optionId: string): string | null {
  return optionId.startsWith(SERVER_DECK_PREFIX) ? optionId.slice(SERVER_DECK_PREFIX.length) : null;
}

export function selectedDeckName(deckName: string, customDeckAvailable: boolean): string | undefined {
  if (serverDeckIdFromOption(deckName)) return DEFAULT_DECK_NAME;
  if (deckName === CUSTOM_DECK_NAME && !customDeckAvailable) return DEFAULT_DECK_NAME;
  return deckName || undefined;
}

export function onlineDeckName(
  player: PlayerIndex,
  deckName: string,
  serverDecks: DeckResponse[],
): ZutomayoSetupData {
  const serverDeckId = serverDeckIdFromOption(deckName);
  if (serverDeckId) {
    const serverDeck = serverDecks.find(deck => deck.id === serverDeckId);
    if (serverDeck) return player === 0 ? { deck0Ids: serverDeck.cardIds } : { deck1Ids: serverDeck.cardIds };
    return player === 0 ? { deck0Name: DEFAULT_DECK_NAME } : { deck1Name: DEFAULT_DECK_NAME };
  }
  const selectedName = deckName === CUSTOM_DECK_NAME ? DEFAULT_DECK_NAME : deckName;
  if (!selectedName) return {};
  return player === 0 ? { deck0Name: selectedName } : { deck1Name: selectedName };
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

function buildServerDeckOptions(serverDecks: DeckResponse[]): DeckOption[] {
  return serverDecks.map(deck => ({
    id: serverDeckOptionId(deck.id),
    name: deck.name,
    description: t('deck.synced'),
    previewIds: deck.cardIds.slice(0, 3),
    synced: true,
  }));
}

function DeckSelector({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: DeckOptionGroup[];
  onChange: (deckName: string) => void;
}) {
  return (
    <section className="deck-selector">
      <div className="section-heading">
        <h3>{label}</h3>
        <span>{t('lobby.deckSelectHint')}</span>
      </div>
      <div className="deck-option-grid">
        {options.map(group => (
          <div className="deck-option-group" key={group.label}>
            <span className="deck-option-group-label">{group.label}</span>
            {group.options.map(option => (
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
                {option.synced && <small>{t('deck.synced')}</small>}
                {value === option.id && <em>{t('common.selected')}</em>}
              </button>
            ))}
          </div>
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

function authErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('exists') || message.includes('registered')) return t('auth.emailExists');
  return t('auth.invalidCredentials');
}

function isOnlineRoomErrorKey(value: string): value is OnlineRoomErrorKey {
  return value === 'online.roomFull' || value === 'online.roomNotFound' || value === 'online.connectionFailed';
}

function onlineErrorMessage(error: unknown): string {
  if (error instanceof Error && isOnlineRoomErrorKey(error.message)) return t(error.message);
  return t('online.connectionFailed');
}

function buildOnlineRoomUrl(matchID: string): string {
  const path = `/play/online/${encodeURIComponent(matchID)}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

function AuthSection({ onAuthChanged }: { onAuthChanged: () => void | Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) return;
    let cancelled = false;
    getProfile()
      .then(profile => {
        if (!cancelled) setUser(profile);
      })
      .catch(() => {
        if (!cancelled) logoutAccount();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetForm = () => {
    setEmail('');
    setNickname('');
    setPassword('');
    setError('');
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setStatus('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setStatus('');

    try {
      const nextUser = mode === 'login'
        ? await login(email, password)
        : await register(email, password, nickname);
      setUser(nextUser);
      setStatus(mode === 'login' ? t('auth.loginSuccess') : t('auth.registerSuccess'));
      setExpanded(false);
      resetForm();
      void onAuthChanged();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    logoutAccount();
    setUser(null);
    setStatus('');
    setExpanded(false);
    resetForm();
    void onAuthChanged();
  };

  if (user) {
    return (
      <section className="auth-section logged-in" aria-label={user.nickname || t('auth.guest')}>
        <div className="auth-user-badge">
          <strong>{user.nickname || t('auth.guest')}</strong>
          <span>ELO {user.elo}</span>
        </div>
        <button className="secondary-action auth-logout" type="button" onClick={handleLogout}>
          {t('auth.logout')}
        </button>
        {status && <span className="auth-status">{status}</span>}
      </section>
    );
  }

  return (
    <section className={`auth-section ${expanded ? 'expanded' : ''}`}>
      <button
        className="secondary-action auth-toggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        {t('auth.login')} / {t('auth.register')}
      </button>

      {expanded && (
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-mode-switch" role="tablist" aria-label={`${t('auth.login')} / ${t('auth.register')}`}>
            <button
              className={mode === 'login' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => switchMode('login')}
            >
              {t('auth.login')}
            </button>
            <button
              className={mode === 'register' ? 'active' : ''}
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => switchMode('register')}
            >
              {t('auth.register')}
            </button>
          </div>
          <label>
            <span>{t('auth.email')}</span>
            <input
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={event => setEmail(event.target.value)}
            />
          </label>
          {mode === 'register' && (
            <label>
              <span>{t('auth.nickname')}</span>
              <input
                type="text"
                value={nickname}
                autoComplete="nickname"
                required
                onChange={event => setNickname(event.target.value)}
              />
            </label>
          )}
          <label>
            <span>{t('auth.password')}</span>
            <input
              type="password"
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              onChange={event => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="error-copy auth-error">{error}</p>}
          <button className="primary-action auth-submit" type="submit" disabled={submitting}>
            {mode === 'login' ? t('auth.login') : t('auth.register')}
          </button>
        </form>
      )}
    </section>
  );
}

function OnlinePanel({ startOnline }: { startOnline: (matchID?: string) => Promise<OnlineSession> }) {
  const [matchID, setMatchID] = useState('');
  const [createdMatchID, setCreatedMatchID] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const shareLink = createdMatchID ? buildOnlineRoomUrl(createdMatchID) : '';

  const runOnline = async (id?: string) => {
    setError('');
    setCopied(false);
    try {
      const nextSession = await startOnline(id);
      setCreatedMatchID(id ? '' : nextSession.matchID);
    } catch (err) {
      setError(onlineErrorMessage(err));
    }
  };

  const copyShareLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareLink;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
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
      {createdMatchID && (
        <div className="online-share-card" role="status" aria-live="polite">
          <span>{t('online.roomCode')}</span>
          <strong className="online-room-code">{createdMatchID}</strong>
          <label className="share-link-row">
            <span>{t('online.shareLink')}</span>
            <input value={shareLink} readOnly aria-label={t('online.shareLink')} />
          </label>
          <button className="secondary-action" type="button" onClick={copyShareLink}>
            {copied ? t('online.copied') : t('online.copyLink')}
          </button>
        </div>
      )}
      {error && <p className="error-copy">{error}</p>}
    </section>
  );
}

interface LobbyPageProps {
  deck0Name: string;
  deck1Name: string;
  customDeckAvailable: boolean;
  serverDecks: DeckResponse[];
  setDeck0Name: (deckName: string) => void;
  setDeck1Name: (deckName: string) => void;
  onStartAI: (difficulty: AIDifficulty) => void;
  onStartOnline: (matchID?: string) => Promise<OnlineSession>;
  onAuthChanged: () => void | Promise<void>;
  onShowTutorial: () => void;
}

export function LobbyPage({
  deck0Name,
  deck1Name,
  customDeckAvailable,
  serverDecks,
  setDeck0Name,
  setDeck1Name,
  onStartAI,
  onStartOnline,
  onAuthChanged,
  onShowTutorial,
}: LobbyPageProps) {
  const navigate = useNavigate();
  const locale = useLocale();
  const deckOptions = useMemo<DeckOptionGroup[]>(() => {
    const localOptions = buildDeckOptions(customDeckAvailable);
    const serverOptions = buildServerDeckOptions(serverDecks);
    return [
      { label: t('deck.localDecks'), options: localOptions },
      ...(serverOptions.length > 0 ? [{ label: t('deck.serverDecks'), options: serverOptions }] : []),
    ];
  }, [customDeckAvailable, locale, serverDecks]);

  return (
    <main className="lobby">
      <div className="lobby-backdrop" />
      <section className="lobby-hero">
        <div className="title-lockup">
          <span>{t('lobby.menu')}</span>
          <h1>{t('app.title')}</h1>
          <p>{t('app.subtitle')}</p>
        </div>
        <div className="lobby-actions">
          <AuthSection onAuthChanged={onAuthChanged} />
          <LanguageSwitcher />
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
