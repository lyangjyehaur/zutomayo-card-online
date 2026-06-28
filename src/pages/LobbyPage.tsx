import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiError,
  getProfile,
  isLoggedIn,
  login,
  logout as logoutAccount,
  matchmakingLeave,
  matchmakingQueue,
  matchmakingReportMatch,
  matchmakingStatus,
  register,
  type DeckResponse,
} from '../api/client';
import { Card } from '../components/Card';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { OnlineRoomInfo } from '../components/OnlineRoomInfo';
import type { AIDifficulty } from '../game/ai';
import type { PlayerIndex, ZutomayoSetupData } from '../game/types';
import { CUSTOM_DECK_NAME, loadCustomDeckIds } from '../game/cards/deckBuilder';
import { PRESET_DECKS } from '../game/cards/presetDecks';
import { t, useLocale } from '../i18n';
import type { OnlineSession } from '../onlineSession';
import { isOnlineRoomErrorKey } from '../onlineRoomStatus';

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
type AuthUser = {
  id: string;
  email: string;
  nickname: string;
  elo: number;
  matchCount?: number;
  wins?: number;
  winRate?: number;
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

export function onlineDeckName(player: PlayerIndex, deckName: string, serverDecks: DeckResponse[]): ZutomayoSetupData {
  const serverDeckId = serverDeckIdFromOption(deckName);
  if (serverDeckId) {
    const serverDeck = serverDecks.find((deck) => deck.id === serverDeckId);
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
  return serverDecks.map((deck) => ({
    id: serverDeckOptionId(deck.id),
    name: deck.name,
    description: t('deck.synced'),
    previewIds: deck.cardIds.slice(0, 3),
    synced: true,
  }));
}

function DeckSelector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: DeckOptionGroup[];
  onChange: (deckName: string) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="card-title">{label}</h3>
        <span className="text-sm opacity-70">{t('lobby.deckSelectHint')}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {options.map((group) => (
          <div className="flex flex-col gap-2" key={group.label}>
            <span className="text-sm font-semibold opacity-70">{group.label}</span>
            {group.options.map((option) => (
              <button
                key={option.id}
                className={`card bg-base-200 hover:shadow-2xl cursor-pointer transition-shadow ${
                  value === option.id ? 'ring ring-primary' : ''
                }`}
                type="button"
                disabled={option.disabled}
                onClick={() => onChange(option.id)}
              >
                <div className="card-body gap-3 p-4">
                  <div className="deck-preview-stack" aria-hidden="true">
                    {option.previewIds.map((id, index) => (
                      <Card
                        key={`${option.id}-${id}-${index}`}
                        card={{ instanceId: `${option.id}-${id}-${index}`, defId: id, faceUp: true }}
                        size="micro"
                      />
                    ))}
                  </div>
                  <div className="flex flex-col gap-1 text-left">
                    <strong>{option.name}</strong>
                    <span className="text-sm opacity-70">{option.description}</span>
                  </div>
                  <div className="card-actions">
                    {option.synced && <span className="badge badge-primary">{t('deck.synced')}</span>}
                    {value === option.id && <span className="badge badge-success">{t('common.selected')}</span>}
                  </div>
                </div>
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
    <section className="card bg-base-200 shadow-xl">
      <div className="card-body">
        <div>
          <h3 className="card-title">{t('lobby.aiBattle')}</h3>
          <span className="text-sm opacity-70">{t('lobby.difficulty')}</span>
        </div>
        <div className="grid gap-3">
          {levels.map((level) => (
            <button
              key={level.id}
              className="btn btn-ghost h-auto justify-start p-4 text-left"
              type="button"
              onClick={() => onStart(level.id)}
            >
              <span className="flex flex-col gap-1">
                <strong>{level.label}</strong>
                <span className="text-sm opacity-70">{level.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function authErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    error instanceof TypeError ||
    (error instanceof ApiError && error.status !== undefined && error.status >= 500) ||
    message.includes('fetch') ||
    message.includes('network')
  ) {
    return t('auth.serviceUnavailable');
  }
  if (message.includes('exists') || message.includes('registered')) return t('auth.emailExists');
  return t('auth.invalidCredentials');
}

function onlineErrorMessage(error: unknown): string {
  if (error instanceof Error && isOnlineRoomErrorKey(error.message)) return t(error.message);
  return t('online.connectionFailed');
}

function profileStats(user: AuthUser): { matchCount: number; wins: number; winRate: number } {
  const matchCount = user.matchCount ?? 0;
  const wins = user.wins ?? 0;
  const winRate = user.winRate ?? (matchCount > 0 ? Math.round((wins / matchCount) * 100) : 0);
  return { matchCount, wins, winRate };
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
      .then((profile) => {
        if (!cancelled) setUser(profile);
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) logoutAccount();
        if (!cancelled) setError(t('auth.profileUnavailable'));
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
      const authUser = mode === 'login' ? await login(email, password) : await register(email, password, nickname);
      let nextUser = authUser as AuthUser;
      try {
        nextUser = await getProfile();
      } catch {
        // Login/register responses are enough to keep guest fallback and auth state usable.
      }
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
    if (typeof window !== 'undefined' && !window.confirm(t('auth.logoutConfirm'))) return;
    logoutAccount();
    setUser(null);
    setStatus('');
    setExpanded(false);
    resetForm();
    void onAuthChanged();
  };

  if (user) {
    const stats = profileStats(user);
    return (
      <section className="card bg-base-200 shadow-xl" aria-label={user.nickname || t('auth.guest')}>
        <div className="card-body gap-3 p-4">
          <div>
            <strong>{user.nickname || t('auth.guest')}</strong>
            <div className="flex flex-wrap gap-2 pt-2">
              <span className="badge badge-primary">ELO {user.elo}</span>
              <span className="badge badge-success">
                {t('auth.winRate')} {stats.winRate}%
              </span>
              <span className="badge badge-warning">
                {t('auth.wins')} {stats.wins}/{stats.matchCount}
              </span>
            </div>
          </div>
          <div className="card-actions items-center">
            <button className="btn btn-secondary btn-sm" type="button" onClick={handleLogout}>
              {t('auth.logout')}
            </button>
            {status && <span className="badge badge-success">{status}</span>}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card bg-base-200 shadow-xl">
      <div className="card-body gap-3 p-4">
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t('auth.login')} / {t('auth.register')}
        </button>
        {!expanded && error && <div className="alert alert-error">{error}</div>}

        {expanded && (
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <div className="join" role="tablist" aria-label={`${t('auth.login')} / ${t('auth.register')}`}>
              <button
                className={`btn btn-sm join-item ${mode === 'login' ? 'btn-primary' : 'btn-ghost'}`}
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                onClick={() => switchMode('login')}
              >
                {t('auth.login')}
              </button>
              <button
                className={`btn btn-sm join-item ${mode === 'register' ? 'btn-primary' : 'btn-ghost'}`}
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                onClick={() => switchMode('register')}
              >
                {t('auth.register')}
              </button>
            </div>
            <label className="form-control">
              <span>{t('auth.email')}</span>
              <input
                className="input input-bordered"
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {mode === 'register' && (
              <label className="form-control">
                <span>{t('auth.nickname')}</span>
                <input
                  className="input input-bordered"
                  type="text"
                  value={nickname}
                  autoComplete="nickname"
                  required
                  onChange={(event) => setNickname(event.target.value)}
                />
              </label>
            )}
            <label className="form-control">
              <span>{t('auth.password')}</span>
              <input
                className="input input-bordered"
                type="password"
                value={password}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <div className="alert alert-error">{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {mode === 'login' ? t('auth.login') : t('auth.register')}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

type MatchmakingPhase = 'idle' | 'polling' | 'host-starting' | 'guest-joining' | 'done';

function OnlinePanel({ startOnline }: { startOnline: (matchID?: string) => Promise<OnlineSession> }) {
  const [matchID, setMatchID] = useState('');
  const [createdMatchID, setCreatedMatchID] = useState('');
  const [error, setError] = useState('');
  const [matchmakingActive, setMatchmakingActive] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<MatchmakingPhase>('idle');
  const cancelRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const resetMatchmaking = useCallback(() => {
    stopPolling();
    phaseRef.current = 'idle';
    cancelRef.current = false;
    setMatchmakingActive(false);
  }, [stopPolling]);

  useEffect(
    () => () => {
      cancelRef.current = true;
      stopPolling();
    },
    [stopPolling],
  );

  const runOnline = async (id?: string) => {
    setError('');
    try {
      const nextSession = await startOnline(id);
      setCreatedMatchID(id ? '' : nextSession.matchID);
    } catch (err) {
      setError(onlineErrorMessage(err));
    }
  };

  const pollMatchmaking = useCallback(async () => {
    if (cancelRef.current) return;
    if (phaseRef.current !== 'polling') return;

    let status;
    try {
      status = await matchmakingStatus();
    } catch (err) {
      if (cancelRef.current) return;
      if (phaseRef.current !== 'polling') return;
      resetMatchmaking();
      setError(onlineErrorMessage(err));
      return;
    }

    if (cancelRef.current) return;
    if (phaseRef.current !== 'polling') return;

    if (status.status === 'matched') {
      if (status.role === 'host') {
        phaseRef.current = 'host-starting';
        stopPolling();
        try {
          const session = await startOnline();
          phaseRef.current = 'done';
          // 通知 guest 真實 boardgame.io matchID（fire and forget，避免阻塞導航）
          void matchmakingReportMatch(session.matchID).catch(() => {});
        } catch (err) {
          phaseRef.current = 'idle';
          setMatchmakingActive(false);
          setError(onlineErrorMessage(err));
          void matchmakingLeave().catch(() => {});
        }
      } else if (status.role === 'guest' && status.realMatchId) {
        phaseRef.current = 'guest-joining';
        stopPolling();
        try {
          await startOnline(status.realMatchId);
          phaseRef.current = 'done';
        } catch (err) {
          phaseRef.current = 'idle';
          setMatchmakingActive(false);
          setError(onlineErrorMessage(err));
          void matchmakingLeave().catch(() => {});
        }
      }
      // guest 但尚未收到 realMatchId，繼續輪詢
    } else if (status.status === 'timeout') {
      resetMatchmaking();
      setError(t('lobby.matchmakingTimeout'));
    }
  }, [resetMatchmaking, startOnline, stopPolling]);

  const handleQuickMatch = async () => {
    if (!isLoggedIn()) {
      setError(t('auth.serviceUnavailable'));
      return;
    }
    setError('');
    setMatchmakingActive(true);
    cancelRef.current = false;
    phaseRef.current = 'polling';
    try {
      await matchmakingQueue();
    } catch (err) {
      resetMatchmaking();
      setError(onlineErrorMessage(err));
      return;
    }
    // 立即檢查一次（可能已立即配對）
    void pollMatchmaking();
    // 每 2 秒輪詢
    pollingRef.current = setInterval(() => {
      void pollMatchmaking();
    }, 2000);
  };

  const handleCancelMatchmaking = () => {
    cancelRef.current = true;
    resetMatchmaking();
    void matchmakingLeave().catch(() => {});
  };

  return (
    <section className="card bg-base-200 shadow-xl">
      <div className="card-body">
        <div>
          <h3 className="card-title">{t('lobby.onlineTitle')}</h3>
          <span className="text-sm opacity-70">{t('game.onlineMode')}</span>
        </div>
        <div className="grid gap-3">
          <button className="btn btn-primary" type="button" onClick={handleQuickMatch} disabled={matchmakingActive}>
            {t('lobby.quickMatch')}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => runOnline()} disabled={matchmakingActive}>
            {t('lobby.createRoom')}
          </button>
          <div className="join">
            <input
              className="input input-bordered join-item min-w-0 flex-1"
              value={matchID}
              onChange={(event) => setMatchID(event.target.value.trim())}
              placeholder={t('lobby.roomCodePlaceholder')}
              aria-label={t('lobby.roomCode')}
              disabled={matchmakingActive}
            />
            <button
              className="btn btn-secondary join-item"
              type="button"
              disabled={!matchID || matchmakingActive}
              onClick={() => runOnline(matchID)}
            >
              {t('lobby.joinRoom')}
            </button>
          </div>
        </div>
        {matchmakingActive && (
          <div className="alert alert-info">
            <span>{t('lobby.matchmakingSearching')}</span>
            <button className="btn btn-sm" type="button" onClick={handleCancelMatchmaking}>
              {t('lobby.matchmakingCancel')}
            </button>
          </div>
        )}
        {createdMatchID && <OnlineRoomInfo matchID={createdMatchID} helperText={t('online.hostWaitingHelper')} />}
        {error && <div className="alert alert-error">{error}</div>}
      </div>
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
  serverDeckError?: string;
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
  serverDeckError,
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
    <main className="min-h-screen container mx-auto flex flex-col gap-4 p-4">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span>{t('lobby.menu')}</span>
            <h1 className="text-2xl font-bold text-primary">{t('app.title')}</h1>
            <p>{t('app.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              className="card bg-base-200 hover:shadow-2xl cursor-pointer transition-shadow"
              type="button"
              onClick={() => navigate('/play/local')}
            >
              <div className="card-body p-4">
                <h2 className="card-title">{t('lobby.localBattle')}</h2>
              </div>
            </button>
            <button
              className="card bg-base-200 hover:shadow-2xl cursor-pointer transition-shadow"
              type="button"
              onClick={() => navigate('/deck-builder')}
            >
              <div className="card-body p-4">
                <h2 className="card-title">{t('lobby.deckEditor')}</h2>
              </div>
            </button>
            <button
              className="card bg-base-200 hover:shadow-2xl cursor-pointer transition-shadow"
              type="button"
              onClick={() => navigate('/history')}
            >
              <div className="card-body p-4">
                <h2 className="card-title">{t('lobby.matchHistory')}</h2>
              </div>
            </button>
            <button
              className="card bg-base-200 hover:shadow-2xl cursor-pointer transition-shadow"
              type="button"
              onClick={onShowTutorial}
            >
              <div className="card-body p-4">
                <h2 className="card-title">{t('lobby.tutorial')}</h2>
              </div>
            </button>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/leaderboard')}>
              {t('leaderboard.title')}
            </button>
            <AuthSection onAuthChanged={onAuthChanged} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-6">
          {serverDeckError && <div className="alert alert-error">{serverDeckError}</div>}
          <DeckSelector label={t('lobby.myDeck')} value={deck0Name} options={deckOptions} onChange={setDeck0Name} />
          <div className="divider" />
          <DeckSelector
            label={t('lobby.opponentDeck')}
            value={deck1Name}
            options={deckOptions}
            onChange={setDeck1Name}
          />
        </div>
        <div className="flex flex-col gap-4">
          <DifficultyButtons onStart={onStartAI} />
          <OnlinePanel startOnline={onStartOnline} />
        </div>
      </section>
    </main>
  );
}
