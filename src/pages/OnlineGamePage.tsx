import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { isVersionMismatchError, reloadForAppUpdate } from '../clientVersion';
import { OnlineGame } from '../components/OnlineGame';
import { OnlineRoomInfo } from '../components/OnlineRoomInfo';
import { Alert, Button, Dialog, PageShell, Panel } from '../ui';
import { Sentry } from '../sentry';
import { getProfile, isLoggedIn, type ProfileResponse } from '../api/client';
import { t, translate, useLocale } from '../i18n';
import {
  clearStoredOnlineSession,
  leaveOnlineSession,
  validateOnlineSession,
  type OnlineSession,
} from '../onlineSession';
import { isOnlineFailureStatus, onlineStatusPanelCopy, type OnlineRoomStatus } from '../onlineRoomStatus';
import { createPlatformCustomRoom, type PlatformCustomRoom } from '../platformClient';

type MatchPlayer = {
  id: number;
  name?: string;
};

type MatchResponse = {
  players?: MatchPlayer[];
};

type PlatformSessionIdentity = {
  userId: string;
  displayName: string;
};

interface OnlineGamePageProps {
  session: OnlineSession | null;
  onClearSession: () => void;
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
  } catch (err) {
    Sentry.captureException(err, { tags: { action: 'fetch-room', match_id: matchID } });
    return { ok: false, reason: 'connectionFailed' };
  }
}

function roomInfoHelper(status: OnlineRoomStatus): string {
  if (status === 'waiting') return t('online.hostWaitingHelper');
  if (status === 'ready') return t('online.roomReadyHelper');
  return t('online.reconnectHelper');
}

async function resolvePlatformSessionIdentity(session: OnlineSession): Promise<PlatformSessionIdentity> {
  if (session.platformUserId) {
    return {
      userId: session.platformUserId,
      displayName: session.platformDisplayName || (session.playerID === '0' ? t('player.zero') : t('player.one')),
    };
  }

  if (isLoggedIn()) {
    try {
      const profile: ProfileResponse = await getProfile();
      return { userId: profile.id, displayName: profile.nickname };
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'platform',
        message: 'platform session account identity unavailable',
        level: 'warning',
        data: { match_id: session.matchID, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return {
    userId: `guest:match:${session.matchID}:player:${session.playerID}`,
    displayName: session.platformDisplayName || (session.playerID === '0' ? t('player.zero') : t('player.one')),
  };
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={t('online.leaveTitle')}
      description={t('online.leaveBody')}
      footer={
        <>
          <Button variant="primary" type="button" disabled={leaving} onClick={onCancel}>
            {t('online.stayInRoom')}
          </Button>
          <Button variant="secondary" type="button" disabled={leaving} onClick={onConfirm}>
            {leaving ? t('online.leaving') : t('online.leaveRoom')}
          </Button>
        </>
      }
    >
      <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
        {t('game.onlineMode')}
      </span>
    </Dialog>
  );
}

export function OnlineGamePage({ session, onClearSession, onCreateNewRoom }: OnlineGamePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const locale = useLocale();
  const { matchID = '' } = useParams<'matchID'>();
  const spectatorMode = new URLSearchParams(location.search).get('spectate') === '1';
  const activeSession = !spectatorMode && session?.matchID === matchID ? session : null;
  const [reconnectStatus, setReconnectStatus] = useState<OnlineRoomStatus>('reconnecting');
  const [retryNonce, setRetryNonce] = useState(0);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [actionError, setActionError] = useState('');
  const [platformCustomRoomReady, setPlatformCustomRoomReady] = useState(false);
  const platformCustomRoomRef = useRef<PlatformCustomRoom | null>(null);
  const latestReconnectStatusRef = useRef(reconnectStatus);
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
    latestReconnectStatusRef.current = reconnectStatus;
  }, [reconnectStatus]);

  const leavePlatformCustomRoom = useCallback((cancel = false) => {
    const room = platformCustomRoomRef.current;
    if (cancel && room) {
      try {
        room.send('cancelCustomRoom', {});
      } catch {
        // The room may already be closing; onLeave still handles host cleanup when possible.
      }
    }
    void room?.leave(true).catch(() => undefined);
    platformCustomRoomRef.current = null;
    setPlatformCustomRoomReady(false);
  }, []);

  useEffect(() => {
    if (spectatorMode || activeSession || !matchID) return;
    navigate(`/online?room=${encodeURIComponent(matchID)}`, { replace: true });
  }, [activeSession, matchID, navigate, spectatorMode]);

  useEffect(() => {
    if (!spectatorMode || !matchID) return;

    let cancelled = false;
    setReconnectStatus('reconnecting');

    void fetchRoom(matchID).then((room) => {
      if (cancelled) return;
      setReconnectStatus(room.ok ? 'ready' : room.reason);
    });

    return () => {
      cancelled = true;
    };
  }, [matchID, retryNonce, spectatorMode]);

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

  useEffect(() => {
    if (!activeSession || activeSession.playerID !== '0' || reconnectStatus !== 'waiting') {
      leavePlatformCustomRoom(!activeSession && latestReconnectStatusRef.current === 'waiting');
      return;
    }

    let cancelled = false;
    if (platformCustomRoomRef.current) return;

    void resolvePlatformSessionIdentity(activeSession)
      .then((identity) =>
        createPlatformCustomRoom(
          {
            roomCode: activeSession.matchID,
            boardgameMatchID: activeSession.matchID,
            userId: identity.userId,
            displayName: identity.displayName,
          },
          {
            onDisconnect: () => {
              platformCustomRoomRef.current = null;
              setPlatformCustomRoomReady(false);
            },
          },
        ),
      )
      .then(
        (room) => {
          if (cancelled) {
            void room.leave(true).catch(() => undefined);
            return;
          }
          platformCustomRoomRef.current = room;
          setPlatformCustomRoomReady(true);
        },
        (err) => {
          Sentry.addBreadcrumb({
            category: 'platform',
            message: 'custom room host registration unavailable',
            level: 'warning',
            data: { match_id: activeSession.matchID, error: err instanceof Error ? err.message : String(err) },
          });
          if (!cancelled) {
            setPlatformCustomRoomReady(false);
            setReconnectStatus('connectionFailed');
          }
        },
      );

    return () => {
      cancelled = true;
    };
  }, [activeSession, leavePlatformCustomRoom, reconnectStatus]);

  useEffect(
    () => () => leavePlatformCustomRoom(latestReconnectStatusRef.current === 'waiting'),
    [leavePlatformCustomRoom],
  );

  const retryStatusCheck = useCallback(() => {
    setActionError('');
    setRetryNonce((value) => value + 1);
  }, []);

  const spectateRoom = useCallback(() => {
    setActionError('');
    navigate(`/play/online/${encodeURIComponent(matchID)}?spectate=1`);
  }, [matchID, navigate]);

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
      Sentry.captureException(err, { tags: { action: 'create-room' } });
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
    const canShowRoomInfo =
      status !== 'waiting' ||
      !panelSession ||
      panelSession.playerID !== '0' ||
      platformCustomRoomReady ||
      Boolean(platformCustomRoomRef.current);
    const showRoomInfo =
      canShowRoomInfo &&
      panelSession &&
      (status === 'waiting' || status === 'reconnecting' || status === 'retrying' || status === 'ready');
    const isFailure = isOnlineFailureStatus(status);
    const canLeave = panelSession && !isFailure;
    const canRetry = copy.canRetry || status === 'retrying';
    const canSpectate = Boolean(matchID && status === 'roomFull');
    const primaryLabel = isFailure
      ? t('common.backToLobby')
      : canLeave
        ? t('online.leaveRoom')
        : t('common.backToLobby');
    const panelTone =
      copy.tone === 'error'
        ? 'text-accent-action/80'
        : copy.tone === 'waiting'
          ? 'text-accent-primary/70'
          : 'text-content-primary/45';

    return (
      <PageShell className="flex items-center justify-center px-4" glow={{ color: 'vermilion', size: 'md' }}>
        <Panel className="relative z-[var(--z-dropdown)] w-full max-w-xl" size="xl">
          <span className={`font-mono text-caption uppercase tracking-[var(--tracking-kicker)] ${panelTone}`}>
            {t('game.onlineMode')}
          </span>
          <h1 className="mt-3 font-display text-3xl font-bold">{t(copy.titleKey)}</h1>
          <p className="mt-3 text-sm leading-relaxed text-content-primary/60">{t(copy.bodyKey)}</p>
          {showRoomInfo && <OnlineRoomInfo matchID={panelSession.matchID} helperText={roomInfoHelper(status)} />}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              variant={canLeave ? 'secondary' : 'primary'}
              type="button"
              onClick={() => backActionForStatus(status)}
            >
              {primaryLabel}
            </Button>
            {canRetry && (
              <Button
                variant="primary"
                type="button"
                onClick={status === 'versionMismatch' ? reloadForAppUpdate : retryStatusCheck}
              >
                {status === 'versionMismatch' ? t('online.reloadAction') : t('online.retryAction')}
              </Button>
            )}
            {copy.canCreateNewRoom && (
              <Button
                variant="primary"
                type="button"
                disabled={creatingRoom}
                aria-busy={creatingRoom}
                onClick={() => void createNewRoom()}
              >
                {creatingRoom ? t('online.creatingRoom') : t('online.createNewRoom')}
              </Button>
            )}
            {canSpectate && (
              <Button variant="secondary" type="button" onClick={spectateRoom}>
                {t('online.watchMatch')}
              </Button>
            )}
          </div>
          {actionError && (
            <Alert className="mt-4" tone="danger" role="alert">
              {actionError}
            </Alert>
          )}
        </Panel>
        {leavePromptOpen && (
          <LeaveConfirmDialog leaving={leaving} onCancel={closeLeavePrompt} onConfirm={() => void leaveAndReturn()} />
        )}
      </PageShell>
    );
  };

  if (spectatorMode && reconnectStatus === 'ready') {
    return (
      <OnlineGame
        matchID={matchID}
        spectator
        onLeaveRequest={returnToLobby}
        onReturnToLobby={returnToLobby}
        onCreateNewRoom={() => {
          void createNewRoom();
        }}
      />
    );
  }

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
        platformSeatToken={activeSession.platformSeatToken}
        platformUserId={activeSession.platformUserId}
        platformDisplayName={activeSession.platformDisplayName}
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
