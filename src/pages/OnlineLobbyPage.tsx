import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Radio } from 'lucide-react';
import {
  getProfile,
  isLoggedIn,
  matchmakingLeave,
  matchmakingQueue,
  matchmakingReportMatch,
  matchmakingStatus,
  type DeckResponse,
  type ProfileResponse,
} from '../api/client';
import { copyText } from '../clipboard';
import { buildOnlineRoomUrl } from '../components/OnlineRoomInfo';
import { DeckSelector } from '../components/lobby/DeckSelector';
import { buildDeckOptions, buildServerDeckOptions, type DeckOptionGroup } from '../components/lobby/shared';
import { t, translate, useLocale } from '../i18n';
import type { OnlineSession } from '../onlineSession';
import { isOnlineRoomErrorKey } from '../onlineRoomStatus';

interface OnlineLobbyPageProps {
  deck0Name: string;
  customDeckAvailable: boolean;
  serverDecks: DeckResponse[];
  setDeck0Name: (deckName: string) => void;
  onStartOnline: (matchID?: string) => Promise<OnlineSession>;
  serverDeckError?: string;
  cardsReady: boolean;
}

type MatchmakingPhase = 'idle' | 'polling' | 'host-starting' | 'guest-joining' | 'done';

// 段位定義：依 ELO 劃分漆面塔羅風格的段位名（專有名詞，不 i18n）。
const RANKS = [
  { name: '金輝 V', min: 1800, max: 2400 },
  { name: '朱痕 IV', min: 1600, max: 1800 },
  { name: '幽影 III', min: 1400, max: 1600 },
  { name: '殘月 II', min: 1200, max: 1400 },
  { name: '新月 I', min: 0, max: 1200 },
] as const;

function eloToRank(elo: number): { name: string; progress: number } {
  const rank = RANKS.find((r) => elo >= r.min && elo < r.max) ?? RANKS[RANKS.length - 1];
  const span = rank.max - rank.min;
  const progress = span > 0 ? Math.min(1, Math.max(0, (elo - rank.min) / span)) : 0;
  return { name: rank.name, progress };
}

function resolveDeckLabel(deckId: string, groups: DeckOptionGroup[]): string {
  for (const group of groups) {
    const found = group.options.find((option) => option.id === deckId);
    if (found) return found.name;
  }
  return deckId;
}

function onlineErrorMessage(error: unknown): string {
  if (error instanceof Error && isOnlineRoomErrorKey(error.message)) return t(error.message);
  return t('online.connectionFailed');
}

export function OnlineLobbyPage({
  deck0Name,
  customDeckAvailable,
  serverDecks,
  setDeck0Name,
  onStartOnline,
  serverDeckError,
  cardsReady,
}: OnlineLobbyPageProps) {
  const navigate = useNavigate();
  const locale = useLocale();
  const deckOptions = useMemo<DeckOptionGroup[]>(() => {
    const localOptions = buildDeckOptions(customDeckAvailable);
    const serverOptions = buildServerDeckOptions(serverDecks);
    return [
      { label: translate(locale, 'deck.localDecks'), options: localOptions },
      ...(serverOptions.length > 0 ? [{ label: translate(locale, 'deck.serverDecks'), options: serverOptions }] : []),
    ];
  }, [customDeckAvailable, locale, serverDecks]);

  // 帳號資料：用於 Header 與段位顯示。
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  useEffect(() => {
    if (!isLoggedIn()) return;
    let cancelled = false;
    void getProfile()
      .then((next) => {
        if (!cancelled) setProfile(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Matchmaking 狀態（原 OnlinePanel 邏輯移入，以便拆分到左右兩欄）。
  const [matchID, setMatchID] = useState('');
  const [createdMatchID, setCreatedMatchID] = useState('');
  const [error, setError] = useState('');
  const [matchmakingActive, setMatchmakingActive] = useState(false);
  const [copied, setCopied] = useState(false);
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

  useEffect(() => {
    setCopied(false);
  }, [createdMatchID]);

  const runOnline = async (id?: string) => {
    setError('');
    try {
      const nextSession = await onStartOnline(id);
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
          const session = await onStartOnline();
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
          await onStartOnline(status.realMatchId);
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
  }, [resetMatchmaking, onStartOnline, stopPolling]);

  const handleQuickMatch = async () => {
    if (!isLoggedIn()) {
      setError(t('lobby.loginRequired'));
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

  const handleCopyShareLink = async () => {
    if (!createdMatchID) return;
    await copyText(buildOnlineRoomUrl(createdMatchID));
    setCopied(true);
  };

  const canStart = cardsReady && !!deck0Name;
  const rank = profile ? eloToRank(profile.elo) : null;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-lacquer-deep font-sans text-bone">
      {/* 環境光暈 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-0 top-0 h-[50vh] w-[50vh] rounded-full bg-vermilion/8 blur-[140px]" />
      </div>

      {/* Header */}
      <header className="absolute inset-x-0 top-0 z-30 flex h-12 items-center justify-between border-b border-bone/5 bg-lacquer-deep/80 px-6 backdrop-blur">
        <button
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-bone/50 transition hover:text-bone"
          type="button"
          onClick={() => navigate('/')}
        >
          <ArrowLeft strokeWidth={1.25} className="size-3.5" />
          {t('common.backToLobby')}
        </button>
        <div className="pointer-events-none font-display text-sm italic">
          {t('lobby.onlineTitle')} · {t('lobby.onlineLobbySubtitle')}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">
          <Radio className="size-3 animate-pulse text-vermilion" />
          {profile ? `${profile.nickname} · ELO ${profile.elo}` : t('lobby.guestRank')}
        </div>
      </header>

      {/* 雙欄內容 */}
      <div className="relative z-10 grid h-full grid-cols-1 gap-4 overflow-y-auto px-4 pb-6 pt-16 md:grid-cols-[340px_minmax(0,1fr)] md:overflow-hidden md:px-6">
        {/* 左側：Quick Match */}
        <aside className="flex flex-col gap-4 rounded-sm bg-lacquer p-6 ring-1 ring-bone/10 md:overflow-y-auto">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-gold/70">{t('lobby.quickMatch')}</div>
            <h2 className="mt-1 font-display text-3xl italic">{t('lobby.onlineTitle')}</h2>
          </div>

          {/* 當前牌組摘要 */}
          <div className="rounded-sm bg-lacquer-deep/60 p-4 ring-1 ring-bone/5">
            <div className="text-[10px] uppercase tracking-widest text-bone/40">{t('lobby.currentDeck')}</div>
            <div className="mt-1 truncate font-display text-lg italic">
              {deck0Name ? resolveDeckLabel(deck0Name, deckOptions) : t('lobby.noDeckSelected')}
            </div>
          </div>

          {/* 段位卡 */}
          <div className="rounded-sm bg-lacquer-deep/60 p-4 ring-1 ring-bone/5">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-bone/40">
              <span>{t('lobby.rank')}</span>
              <span className="text-gold">{rank ? rank.name : t('lobby.guestRank')}</span>
            </div>
            <div className="mt-2 h-1 w-full bg-bone/10">
              <div
                className="h-full bg-gradient-to-r from-vermilion to-gold transition-all"
                style={{ width: rank ? `${Math.round(rank.progress * 100)}%` : '0%' }}
              />
            </div>
            <div className="mt-1 font-mono text-[9px] text-bone/40">
              {profile ? `ELO ${profile.elo} · ${profile.wins}/${profile.matchCount}` : t('lobby.loginRequired')}
            </div>
          </div>

          {/* 開始匹配 */}
          <button
            className="bg-gradient-to-r from-vermilion to-gold py-4 font-display text-lg italic tracking-wide text-lacquer-deep transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
            type="button"
            onClick={handleQuickMatch}
            disabled={matchmakingActive || !canStart}
          >
            {t('lobby.beginMatch')}
          </button>

          {matchmakingActive && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[10px] text-gold/70">
                <span className="size-1.5 animate-pulse rounded-full bg-vermilion" />
                {t('lobby.matchmakingSearching')}
              </span>
              <button
                className="text-[10px] uppercase tracking-[0.3em] text-vermilion/70 transition hover:text-vermilion"
                type="button"
                onClick={handleCancelMatchmaking}
              >
                {t('lobby.matchmakingCancel')}
              </button>
            </div>
          )}

          {!cardsReady && <p className="text-[10px] text-vermilion/70">{t('game.loading')}</p>}
          {cardsReady && !deck0Name && <p className="text-[10px] text-vermilion/70">{t('lobby.selectDeckFirst')}</p>}
        </aside>

        {/* 右側：牌組選擇 + 自訂房間 */}
        <section className="flex min-h-0 flex-col gap-6 md:overflow-y-auto md:pr-2">
          {/* 牌組選擇 */}
          <div className="rounded-sm bg-lacquer/60 p-5 ring-1 ring-bone/10">
            <DeckSelector label={t('lobby.myDeck')} value={deck0Name} options={deckOptions} onChange={setDeck0Name} />
          </div>

          {/* 自訂房間 */}
          <div className="flex flex-col gap-4 rounded-sm bg-lacquer/60 p-5 ring-1 ring-bone/10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-gold/70">{t('lobby.customRooms')}</div>
                <h2 className="font-display text-2xl italic">{t('lobby.createRoom')}</h2>
              </div>
              <button
                className="border border-bone/20 px-4 py-1.5 text-[10px] uppercase tracking-[0.3em] text-bone/70 transition hover:bg-bone/5 disabled:cursor-not-allowed disabled:opacity-40"
                type="button"
                onClick={() => runOnline()}
                disabled={matchmakingActive || !canStart}
              >
                + {t('lobby.createRoom')}
              </button>
            </div>

            {/* 加入房間 */}
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 border border-bone/10 bg-lacquer-deep px-3 py-2 text-sm text-bone placeholder:text-bone/30 focus:outline-none focus:ring-1 focus:ring-gold/40 disabled:opacity-50"
                value={matchID}
                onChange={(event) => setMatchID(event.target.value.trim())}
                placeholder={t('lobby.roomCodePlaceholder')}
                aria-label={t('lobby.roomCode')}
                disabled={matchmakingActive}
              />
              <button
                className="border border-bone/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-bone/60 transition hover:bg-bone/5 disabled:opacity-50"
                type="button"
                disabled={!matchID || matchmakingActive}
                onClick={() => runOnline(matchID)}
              >
                {t('lobby.joinRoom')}
              </button>
            </div>

            {serverDeckError && <p className="text-[10px] text-vermilion/80">{serverDeckError}</p>}

            {/* 已建立房間資訊 */}
            {createdMatchID && (
              <div className="flex flex-col gap-3 rounded-sm bg-lacquer-deep/60 p-4 ring-1 ring-bone/5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('online.roomCode')}</span>
                  <span className="font-mono text-xs text-gold">{createdMatchID}</span>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('online.shareLink')}</span>
                  <input
                    className="min-w-0 border border-bone/10 bg-lacquer-deep px-3 py-2 font-mono text-[11px] text-bone/70 focus:outline-none"
                    value={buildOnlineRoomUrl(createdMatchID)}
                    readOnly
                    aria-label={t('online.shareLink')}
                  />
                </label>
                <div className="flex items-center gap-3">
                  <button
                    className="border border-bone/20 px-4 py-1.5 text-[10px] uppercase tracking-[0.3em] text-bone/70 transition hover:bg-bone/5"
                    type="button"
                    onClick={handleCopyShareLink}
                  >
                    {copied ? t('online.copied') : t('online.copyLink')}
                  </button>
                  <span className="text-[10px] text-bone/40">{t('online.hostWaitingHelper')}</span>
                </div>
              </div>
            )}

            {error && <p className="text-[10px] text-vermilion/80">{error}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
