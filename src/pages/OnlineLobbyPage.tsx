import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Pencil, Radio, X } from 'lucide-react';
import {
  ANONYMOUS_PLAYER_DEFAULT_NAME,
  formatAnonymousDisplayName,
  loadAnonymousIdentity,
  renameAnonymousIdentity,
  sanitizeAnonymousBaseName,
  type AnonymousIdentity,
} from '../anonymousIdentity';
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
import { useToast } from '../components/ToastProvider';
import { DeckSelector } from '../components/lobby/DeckSelector';
import { buildDeckOptions, buildServerDeckOptions, type DeckOptionGroup } from '../components/lobby/shared';
import { BackButton, Button, Input, PageHeader, Panel, PageShell } from '../components/ui';
import { t, translate, useLocale } from '../i18n';
import type { OnlineSession } from '../onlineSession';
import { isOnlineRoomErrorKey } from '../onlineRoomStatus';

interface OnlineLobbyPageProps {
  deck0Name: string;
  customDeckAvailable: boolean;
  serverDecks: DeckResponse[];
  setDeck0Name: (deckName: string) => void;
  onStartOnline: (matchID?: string, playerName?: string) => Promise<OnlineSession>;
  serverDeckError?: string;
  cardsReady: boolean;
}

type MatchmakingPhase = 'idle' | 'polling' | 'host-starting' | 'guest-joining' | 'done';
const ANONYMOUS_NAME_PROMPT_STORAGE_KEY = 'zutomayo_anonymous_name_prompt_seen';

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
  const { showToast } = useToast();
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
  const [anonymousIdentity, setAnonymousIdentity] = useState<AnonymousIdentity>(() => loadAnonymousIdentity());
  const [editingAnonymousName, setEditingAnonymousName] = useState(false);
  const [anonymousNameDraft, setAnonymousNameDraft] = useState(() => anonymousIdentity.baseName);
  const [showAnonymousNamePrompt, setShowAnonymousNamePrompt] = useState(false);
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

  const anonymousDisplayName = formatAnonymousDisplayName(anonymousIdentity);
  const effectivePlayerName = profile?.nickname || anonymousDisplayName;
  const shouldPromptForAnonymousName =
    !profile &&
    anonymousIdentity.baseName === ANONYMOUS_PLAYER_DEFAULT_NAME &&
    sessionStorage.getItem(ANONYMOUS_NAME_PROMPT_STORAGE_KEY) !== 'true';

  const startEditingAnonymousName = () => {
    setAnonymousNameDraft(anonymousIdentity.baseName);
    setEditingAnonymousName(true);
    setShowAnonymousNamePrompt(false);
  };

  const saveAnonymousName = () => {
    const nextIdentity = renameAnonymousIdentity(anonymousNameDraft);
    setAnonymousIdentity(nextIdentity);
    setAnonymousNameDraft(nextIdentity.baseName);
    setEditingAnonymousName(false);
    setShowAnonymousNamePrompt(false);
    sessionStorage.setItem(ANONYMOUS_NAME_PROMPT_STORAGE_KEY, 'true');
  };

  const cancelAnonymousNameEdit = () => {
    setAnonymousNameDraft(anonymousIdentity.baseName);
    setEditingAnonymousName(false);
  };

  const requestAnonymousNameBeforeStart = () => {
    if (!shouldPromptForAnonymousName) return false;
    setShowAnonymousNamePrompt(true);
    setEditingAnonymousName(true);
    setAnonymousNameDraft(anonymousIdentity.baseName);
    sessionStorage.setItem(ANONYMOUS_NAME_PROMPT_STORAGE_KEY, 'true');
    return true;
  };

  // 牌組選擇後 Toast 提示（首次選擇時顯示）
  const handleDeckChange = (newDeck: string) => {
    const isFirstSelection = !deck0Name && newDeck;
    setDeck0Name(newDeck);

    if (isFirstSelection) {
      const hasShownToast = sessionStorage.getItem('zutomayo_deck_selected_toast');
      if (!hasShownToast) {
        showToast({
          title: t('deck.selectionSuccess'),
          body: t('deck.readyToStart'),
          kind: 'success',
          durationMs: 3000,
        });
        sessionStorage.setItem('zutomayo_deck_selected_toast', 'true');
      }
    }
  };

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
    if (requestAnonymousNameBeforeStart()) return;
    setError('');
    try {
      const nextSession = await onStartOnline(id, effectivePlayerName);
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
    if (requestAnonymousNameBeforeStart()) return;
    setError('');
    setMatchmakingActive(true);
    cancelRef.current = false;
    phaseRef.current = 'polling';
    try {
      await matchmakingQueue();
    } catch (err) {
      resetMatchmaking();
      setError(onlineErrorMessage(err));
      // 顯示錯誤 Toast 並提供重試按鈕
      showToast({
        title: t('error.matchmakingFailed'),
        body: t('error.checkConnection'),
        kind: 'error',
        durationMs: 6000,
        actionLabel: t('common.retry'),
        onAction: handleQuickMatch,
      });
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
    showToast({
      title: t('online.copied'),
      body: t('online.copySuccessHelp'),
      kind: 'success',
    });
  };

  const canStart = cardsReady && !!deck0Name;
  const startDisabledReason = !cardsReady ? t('game.loading') : !deck0Name ? t('lobby.selectDeckFirst') : '';
  const rank = profile ? eloToRank(profile.elo) : null;
  const draftPreview = formatAnonymousDisplayName({
    baseName: sanitizeAnonymousBaseName(anonymousNameDraft),
    suffix: anonymousIdentity.suffix,
  });

  return (
    <PageShell
      variant="workspace"
      className="flex flex-col"
      glow={{ color: 'vermilion', size: 'sm', className: 'left-0 top-0 translate-x-0 translate-y-0' }}
    >
      <PageHeader
        leading={
          <BackButton type="button" onClick={() => navigate('/')}>
            <span className="hidden sm:inline">{t('common.backToLobby')}</span>
          </BackButton>
        }
        title={t('lobby.onlineTitle')}
        subtitle={t('lobby.onlineLobbySubtitle')}
        actions={
          <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-bone/40 md:flex">
            <Radio className="size-3 animate-pulse text-vermilion" />
            {profile ? `${profile.nickname} · ELO ${profile.elo}` : anonymousDisplayName}
          </div>
        }
      />

      {/* 雙欄內容 */}
      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 py-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden lg:px-6">
        {/* 左側：Quick Match */}
        <Panel as="aside" className="flex flex-col gap-4 lg:overflow-y-auto" size="xl">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-gold/70">{t('lobby.quickMatch')}</div>
            <h2 className="mt-1 font-display text-3xl italic">{t('lobby.onlineTitle')}</h2>
          </div>

          {/* 匿名身份 */}
          <Panel variant="ghost">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('anonymous.identity')}</div>
                <div className="mt-1 truncate font-mono text-sm text-gold">
                  {profile ? profile.nickname : editingAnonymousName ? draftPreview : anonymousDisplayName}
                </div>
              </div>
              {!profile && (
                <Button
                  className="size-8 shrink-0 p-0 tracking-normal"
                  variant="secondary"
                  type="button"
                  onClick={startEditingAnonymousName}
                  aria-label={t('anonymous.editName')}
                  title={t('anonymous.editName')}
                >
                  <Pencil strokeWidth={1.25} className="size-3.5" />
                </Button>
              )}
            </div>
            {!profile && editingAnonymousName && (
              <div className="mt-3 flex gap-2">
                <Input
                  className="min-w-0 flex-1"
                  value={anonymousNameDraft}
                  maxLength={30}
                  onChange={(event) => setAnonymousNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveAnonymousName();
                    if (event.key === 'Escape') cancelAnonymousNameEdit();
                  }}
                  aria-label={t('anonymous.nameInput')}
                />
                <Button
                  className="size-9 shrink-0 p-0 tracking-normal"
                  variant="primary"
                  type="button"
                  onClick={saveAnonymousName}
                  aria-label={t('common.save')}
                  title={t('common.save')}
                >
                  <Check strokeWidth={1.25} className="size-4" />
                </Button>
                <Button
                  className="size-9 shrink-0 p-0 tracking-normal"
                  variant="secondary"
                  type="button"
                  onClick={cancelAnonymousNameEdit}
                  aria-label={t('common.cancel')}
                  title={t('common.cancel')}
                >
                  <X strokeWidth={1.25} className="size-4" />
                </Button>
              </div>
            )}
            {!profile && showAnonymousNamePrompt && (
              <p className="mt-3 text-[10px] leading-relaxed text-gold/70">{t('anonymous.firstStartPrompt')}</p>
            )}
            {!profile && !editingAnonymousName && (
              <p className="mt-2 text-[10px] leading-relaxed text-bone/40">{t('anonymous.registerHint')}</p>
            )}
          </Panel>

          {/* 當前牌組摘要 */}
          <Panel variant="ghost">
            <div className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('lobby.currentDeck')}</div>
            <div className="mt-1 truncate font-display text-lg italic">
              {deck0Name ? resolveDeckLabel(deck0Name, deckOptions) : t('lobby.noDeckSelected')}
            </div>
          </Panel>

          {/* 段位卡 */}
          <Panel variant="ghost">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-bone/40">
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
          </Panel>

          {/* 開始匹配 */}
          <div className="grid gap-2">
            <Button
              className="w-full bg-gradient-to-r from-vermilion to-gold py-4 font-display text-lg italic tracking-wide text-lacquer-deep transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
              type="button"
              onClick={handleQuickMatch}
              disabled={matchmakingActive || !canStart}
              aria-describedby={!canStart ? 'online-quick-match-helper' : undefined}
            >
              {t('lobby.beginMatch')}
            </Button>

            {!canStart && (
              <p id="online-quick-match-helper" className="text-[10px] leading-relaxed text-vermilion/70">
                {startDisabledReason}
              </p>
            )}
          </div>

          {matchmakingActive && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[10px] text-gold/70">
                <span className="size-1.5 animate-pulse rounded-full bg-vermilion" />
                {t('lobby.matchmakingSearching')}
              </span>
              <Button variant="ghost" size="sm" type="button" onClick={handleCancelMatchmaking}>
                {t('lobby.matchmakingCancel')}
              </Button>
            </div>
          )}
        </Panel>

        {/* 右側：牌組選擇 + 自訂房間 */}
        <section className="flex flex-col gap-6 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
          {/* 牌組選擇 */}
          <Panel variant="ghost" size="lg">
            <DeckSelector
              label={t('lobby.myDeck')}
              value={deck0Name}
              options={deckOptions}
              onChange={handleDeckChange}
            />
          </Panel>

          {/* 自訂房間 */}
          <Panel className="flex flex-col gap-4" variant="ghost" size="lg">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-gold/70">{t('lobby.customRooms')}</div>
                <h2 className="font-display text-2xl italic">{t('lobby.createRoom')}</h2>
              </div>
              <div className="grid gap-2 sm:justify-items-end">
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  onClick={() => runOnline()}
                  disabled={matchmakingActive || !canStart}
                  aria-describedby={!canStart ? 'online-create-room-helper' : undefined}
                >
                  + {t('lobby.createRoom')}
                </Button>

                {!canStart && (
                  <p
                    id="online-create-room-helper"
                    className="max-w-[18rem] text-left text-[10px] leading-relaxed text-vermilion/70 sm:text-right"
                  >
                    {startDisabledReason}
                  </p>
                )}
              </div>
            </div>

            {/* 加入房間 */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                className="min-w-0 flex-1"
                value={matchID}
                onChange={(event) => setMatchID(event.target.value.trim())}
                placeholder={t('lobby.roomCodePlaceholder')}
                aria-label={t('lobby.roomCode')}
                disabled={matchmakingActive}
              />
              <Button
                variant="secondary"
                type="button"
                disabled={!matchID || matchmakingActive}
                onClick={() => runOnline(matchID)}
              >
                {t('lobby.joinRoom')}
              </Button>
            </div>

            {serverDeckError && <p className="text-[10px] text-vermilion/80">{serverDeckError}</p>}

            {/* 已建立房間資訊 */}
            {createdMatchID && (
              <Panel className="flex flex-col gap-3" variant="ghost">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('online.roomCode')}</span>
                  <span className="font-mono text-xs text-gold">{createdMatchID}</span>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('online.shareLink')}</span>
                  <Input
                    className="min-w-0 font-mono text-xs text-bone/70"
                    value={buildOnlineRoomUrl(createdMatchID)}
                    readOnly
                    aria-label={t('online.shareLink')}
                  />
                </label>
                <div className="flex items-center gap-3">
                  <Button size="sm" variant="secondary" type="button" onClick={handleCopyShareLink}>
                    {copied ? t('online.copied') : t('online.copyLink')}
                  </Button>
                  <span className="text-[10px] text-bone/40">{t('online.hostWaitingHelper')}</span>
                </div>
              </Panel>
            )}

            {error && <p className="text-[10px] text-vermilion/80">{error}</p>}
          </Panel>
        </section>
      </div>
    </PageShell>
  );
}
