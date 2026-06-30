import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { isVersionMismatchError, reloadForAppUpdate } from '../clientVersion';
import { OnlineGame } from '../components/OnlineGame';
import { OnlineRoomInfo } from '../components/OnlineRoomInfo';
import { t, translate, useLocale } from '../i18n';
import {
  clearStoredOnlineSession,
  leaveOnlineSession,
  validateOnlineSession,
  type OnlineSession,
} from '../onlineSession';
import {
  isOnlineFailureStatus,
  onlineErrorStatus,
  onlineStatusPanelCopy,
  type OnlineRoomStatus,
} from '../onlineRoomStatus';

type MatchPlayer = {
  id: number;
  name?: string;
};

type MatchResponse = {
  players?: MatchPlayer[];
};

interface OnlineGamePageProps {
  session: OnlineSession | null;
  onClearSession: () => void;
  onJoinSharedRoom: (matchID: string) => Promise<OnlineSession>;
  onCreateNewRoom: () => Promise<OnlineSession>;
}

async function fetchRoom(
  matchID: string,
): Promise<
  | { ok: true; opponentJoined: boolean }
  | { ok: false; reason: Exclude<OnlineRoomStatus, 'reconnecting' | 'retrying' | 'waiting' | 'ready'> }
> {
  try {
    const response = await fetch(`/games/zutomayo-card/${encodeURIComponent(matchID)}`);
    if (response.status === 404) return { ok: false, reason: 'roomNotFound' };
    if (!response.ok) return { ok: false, reason: 'connectionFailed' };
    const data = (await response.json()) as MatchResponse;
    const opponentJoined = Boolean(data.players?.some((player) => player.id === 1 && player.name));
    return { ok: true, opponentJoined };
  } catch {
    return { ok: false, reason: 'connectionFailed' };
  }
}

function roomInfoHelper(status: OnlineRoomStatus): string {
  if (status === 'waiting') return t('online.hostWaitingHelper');
  if (status === 'ready') return t('online.roomReadyHelper');
  return t('online.reconnectHelper');
}

function LeaveConfirmDialog({
  leaving,
  onCancel,
  onConfirm,
}: {
  leaving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-lacquer-deep/70 px-4 backdrop-blur-sm"
      role="presentation"
    >
      <section
        className="w-full max-w-md rounded-sm bg-lacquer p-6 text-bone ring-1 ring-bone/10"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-confirm-title"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">{t('game.onlineMode')}</span>
        <h2 id="leave-confirm-title" className="mt-3 font-display text-2xl italic">
          {t('online.leaveTitle')}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bone/60">{t('online.leaveBody')}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="bg-bone px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition hover:bg-gold disabled:opacity-40"
            type="button"
            disabled={leaving}
            onClick={onCancel}
          >
            {t('online.stayInRoom')}
          </button>
          <button
            className="border border-bone/20 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-bone/60 transition hover:border-vermilion/50 hover:text-vermilion disabled:opacity-40"
            type="button"
            disabled={leaving}
            onClick={onConfirm}
          >
            {leaving ? t('online.leaving') : t('online.leaveRoom')}
          </button>
        </div>
      </section>
    </div>
  );
}

export function OnlineGamePage({ session, onClearSession, onJoinSharedRoom, onCreateNewRoom }: OnlineGamePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const locale = useLocale();
  const { matchID = '' } = useParams<'matchID'>();
  const activeSession = session?.matchID === matchID ? session : null;
  const [reconnectStatus, setReconnectStatus] = useState<OnlineRoomStatus>('reconnecting');
  const [retryNonce, setRetryNonce] = useState(0);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [actionError, setActionError] = useState('');
  // P2-13：Socket.IO 偵測到對手加入時設為 true，用來停止 HTTP fallback 並推進到 ready。
  const opponentJoinedRef = useRef(false);
  const routeState = location.state as { freshOnlineSession?: boolean; resumeOnlineSession?: boolean } | null;
  const showRejoinedStatus = routeState?.freshOnlineSession !== true;

  const handleOpponentDetected = useCallback(() => {
    if (opponentJoinedRef.current) return;
    opponentJoinedRef.current = true;
    setReconnectStatus('ready');
  }, []);

  useEffect(() => {
    if (activeSession || !matchID) return;

    let cancelled = false;
    setReconnectStatus('reconnecting');

    onJoinSharedRoom(matchID)
      .then(() => {
        if (!cancelled) setReconnectStatus('ready');
      })
      .catch((error) => {
        if (!cancelled) setReconnectStatus(onlineErrorStatus(error));
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession, matchID, onJoinSharedRoom, retryNonce]);

  useEffect(() => {
    if (!activeSession) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // P2-13：Socket.IO 偵測到對手加入後，停止 HTTP fallback 重試。
    opponentJoinedRef.current = false;

    const validate = async (isRetry: boolean) => {
      if (opponentJoinedRef.current) return;
      setReconnectStatus(isRetry ? 'retrying' : 'reconnecting');
      const result = await validateOnlineSession(activeSession);
      if (cancelled || opponentJoinedRef.current) return;

      if (result.ok) {
        if (activeSession.playerID !== '0') {
          setReconnectStatus('ready');
          return;
        }

        const room = await fetchRoom(activeSession.matchID);
        if (cancelled || opponentJoinedRef.current) return;
        if (!room.ok) {
          if (room.reason === 'roomNotFound' || room.reason === 'roomFull') {
            clearStoredOnlineSession();
          }
          setReconnectStatus(room.reason);
          return;
        }

        if (room.opponentJoined) {
          setReconnectStatus('ready');
          return;
        }

        setReconnectStatus('waiting');
        // P2-13：HTTP 輪詢降級為 fallback（5 秒），主要靠 Socket.IO 的 matchData 推送偵測對手加入。
        retryTimer = setTimeout(() => {
          if (cancelled) return;
          void validate(true);
        }, 5000);
        return;
      }

      if (result.reason === 'network') {
        setReconnectStatus('retrying');
        retryTimer = setTimeout(() => {
          if (cancelled) return;
          void validate(true);
        }, 5000);
        return;
      }

      clearStoredOnlineSession();
      setReconnectStatus(
        result.reason === 'roomGone'
          ? 'roomNotFound'
          : result.reason === 'versionMismatch'
            ? 'versionMismatch'
            : 'roomFull',
      );
    };

    void validate(false);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [activeSession, retryNonce]);

  useEffect(() => {
    if (!activeSession || reconnectStatus !== 'ready') return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const message = t('online.leaveConfirm');
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [activeSession, locale, reconnectStatus]);

  useEffect(() => {
    if (!activeSession) setLeavePromptOpen(false);
  }, [activeSession]);

  const retryStatusCheck = useCallback(() => {
    setActionError('');
    setRetryNonce((value) => value + 1);
  }, []);

  const returnToLobby = useCallback(() => {
    onClearSession();
    navigate('/');
  }, [navigate, onClearSession]);

  const requestLeave = useCallback(() => {
    setLeavePromptOpen(true);
  }, []);

  const leaveAndReturn = useCallback(async () => {
    setActionError('');
    setLeaving(true);
    try {
      if (activeSession) await leaveOnlineSession(activeSession);
      onClearSession();
      navigate('/');
    } finally {
      setLeaving(false);
    }
  }, [activeSession, navigate, onClearSession]);

  const createNewRoom = useCallback(async () => {
    setCreatingRoom(true);
    setActionError('');
    try {
      if (activeSession) await leaveOnlineSession(activeSession);
      onClearSession();
      await onCreateNewRoom();
    } catch (err) {
      setActionError(
        isVersionMismatchError(err)
          ? translate(locale, 'online.versionMismatchBody')
          : translate(locale, 'online.createRoomFailed'),
      );
    } finally {
      setCreatingRoom(false);
    }
  }, [activeSession, locale, onClearSession, onCreateNewRoom]);

  const closeLeavePrompt = useCallback(() => {
    if (!leaving) setLeavePromptOpen(false);
  }, [leaving]);

  const backActionForStatus = useCallback(
    (status: OnlineRoomStatus) => {
      if (
        activeSession &&
        (status === 'waiting' || status === 'reconnecting' || status === 'retrying' || status === 'connectionFailed')
      ) {
        requestLeave();
        return;
      }
      returnToLobby();
    },
    [activeSession, requestLeave, returnToLobby],
  );

  const renderStatusPanel = (status: OnlineRoomStatus, panelSession: OnlineSession | null) => {
    const copy = onlineStatusPanelCopy(status);
    const showRoomInfo =
      panelSession &&
      (status === 'waiting' || status === 'reconnecting' || status === 'retrying' || status === 'ready');
    const isFailure = isOnlineFailureStatus(status);
    const canLeave = panelSession && !isFailure;
    const canRetry = copy.canRetry || status === 'retrying';
    const primaryLabel = isFailure
      ? t('common.backToLobby')
      : canLeave
        ? t('online.leaveRoom')
        : t('common.backToLobby');
    const panelTone =
      copy.tone === 'error' ? 'text-vermilion/80' : copy.tone === 'waiting' ? 'text-gold/70' : 'text-bone/45';

    return (
      <main className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-lacquer-deep px-4 font-sans text-bone">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-[60vh] w-[120vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-vermilion/8 blur-[120px]" />
        </div>
        <section className="relative z-10 w-full max-w-xl rounded-sm bg-lacquer p-6 ring-1 ring-bone/10">
          <span className={`font-mono text-[10px] uppercase tracking-[0.3em] ${panelTone}`}>
            {t('game.onlineMode')}
          </span>
          <h1 className="mt-3 font-display text-3xl italic">{t(copy.titleKey)}</h1>
          <p className="mt-3 text-sm leading-relaxed text-bone/60">{t(copy.bodyKey)}</p>
          {showRoomInfo && <OnlineRoomInfo matchID={panelSession.matchID} helperText={roomInfoHelper(status)} />}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className={
                canLeave
                  ? 'border border-bone/20 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-bone/60 transition hover:border-vermilion/50 hover:text-vermilion'
                  : 'bg-bone px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition hover:bg-gold'
              }
              type="button"
              onClick={() => backActionForStatus(status)}
            >
              {primaryLabel}
            </button>
            {canRetry && (
              <button
                className="bg-bone px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition hover:bg-gold"
                type="button"
                onClick={status === 'versionMismatch' ? reloadForAppUpdate : retryStatusCheck}
              >
                {status === 'versionMismatch' ? t('online.reloadAction') : t('online.retryAction')}
              </button>
            )}
            {copy.canCreateNewRoom && (
              <button
                className="bg-bone px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition hover:bg-gold disabled:opacity-40"
                type="button"
                disabled={creatingRoom}
                onClick={() => void createNewRoom()}
              >
                {creatingRoom ? t('online.creatingRoom') : t('online.createNewRoom')}
              </button>
            )}
          </div>
          {actionError && <p className="mt-4 text-[10px] text-vermilion/80">{actionError}</p>}
        </section>
        {leavePromptOpen && (
          <LeaveConfirmDialog leaving={leaving} onCancel={closeLeavePrompt} onConfirm={() => void leaveAndReturn()} />
        )}
      </main>
    );
  };

  if (!activeSession) {
    return renderStatusPanel(reconnectStatus, null);
  }

  const isFailure = isOnlineFailureStatus(reconnectStatus);
  // P2-13：waiting/ready 時提前渲染 OnlineGame，讓它建立 Socket.IO 連線偵測對手加入。
  // waiting 時疊上狀態面板覆蓋層，避免房主在對手加入前看到遊戲畫面。
  const showOnlineGame = reconnectStatus === 'waiting' || reconnectStatus === 'ready';

  if (isFailure || !showOnlineGame) {
    return renderStatusPanel(reconnectStatus, activeSession);
  }

  return (
    <>
      <OnlineGame
        matchID={activeSession.matchID}
        playerID={activeSession.playerID}
        playerCredentials={activeSession.playerCredentials}
        showRejoinedStatus={showRejoinedStatus}
        onLeaveRequest={requestLeave}
        onReturnToLobby={() => {
          void leaveAndReturn();
        }}
        onCreateNewRoom={() => {
          void createNewRoom();
        }}
        onOpponentDetected={handleOpponentDetected}
      />
      {reconnectStatus === 'waiting' && (
        <div
          className="online-waiting-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t('online.waitingForOpponent')}
        >
          {renderStatusPanel('waiting', activeSession)}
        </div>
      )}
      {leavePromptOpen && (
        <LeaveConfirmDialog leaving={leaving} onCancel={closeLeavePrompt} onConfirm={() => void leaveAndReturn()} />
      )}
    </>
  );
}
