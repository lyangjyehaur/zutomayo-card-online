import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { OnlineGame } from '../components/OnlineGame';
import { t, useLocale } from '../i18n';
import { clearStoredOnlineSession, validateOnlineSession, type OnlineSession } from '../onlineSession';

type ReconnectStatus = 'reconnecting' | 'retrying' | 'waiting' | 'ready' | 'roomNotFound' | 'roomFull' | 'connectionFailed';
type OnlineRoomErrorKey = 'online.roomFull' | 'online.roomNotFound' | 'online.connectionFailed';

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
}

function isOnlineRoomErrorKey(value: string): value is OnlineRoomErrorKey {
  return value === 'online.roomFull' || value === 'online.roomNotFound' || value === 'online.connectionFailed';
}

function onlineErrorStatus(error: unknown): ReconnectStatus {
  if (error instanceof Error && isOnlineRoomErrorKey(error.message)) {
    if (error.message === 'online.roomFull') return 'roomFull';
    if (error.message === 'online.roomNotFound') return 'roomNotFound';
  }
  return 'connectionFailed';
}

function buildOnlineRoomUrl(matchID: string): string {
  const path = `/play/online/${encodeURIComponent(matchID)}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

async function leaveOnlineSession(session: OnlineSession): Promise<void> {
  try {
    await fetch(`/games/zutomayo-card/${encodeURIComponent(session.matchID)}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerID: session.playerID,
        credentials: session.playerCredentials,
      }),
    });
  } catch {
    // Local cleanup still happens; the server may already have dropped the room.
  }
}

async function fetchRoom(matchID: string): Promise<
  | { ok: true; opponentJoined: boolean }
  | { ok: false; reason: Exclude<ReconnectStatus, 'reconnecting' | 'retrying' | 'waiting' | 'ready'> }
> {
  try {
    const response = await fetch(`/games/zutomayo-card/${encodeURIComponent(matchID)}`);
    if (response.status === 404) return { ok: false, reason: 'roomNotFound' };
    if (!response.ok) return { ok: false, reason: 'connectionFailed' };
    const data = await response.json() as MatchResponse;
    const opponentJoined = Boolean(data.players?.some(player => player.id === 1 && player.name));
    return { ok: true, opponentJoined };
  } catch {
    return { ok: false, reason: 'connectionFailed' };
  }
}

function RoomInfo({ matchID }: { matchID: string }) {
  const [copied, setCopied] = useState(false);
  const shareLink = useMemo(() => buildOnlineRoomUrl(matchID), [matchID]);

  const copyShareLink = async () => {
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
    <div className="online-room-info">
      <span>{t('online.roomCode')}</span>
      <strong className="online-room-code">{matchID}</strong>
      <label className="share-link-row">
        <span>{t('online.shareLink')}</span>
        <input value={shareLink} readOnly aria-label={t('online.shareLink')} />
      </label>
      <button className="secondary-action" type="button" onClick={copyShareLink}>
        {copied ? t('online.copied') : t('online.copyLink')}
      </button>
    </div>
  );
}

export function OnlineGamePage({ session, onClearSession, onJoinSharedRoom }: OnlineGamePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const locale = useLocale();
  const { matchID = '' } = useParams<'matchID'>();
  const activeSession = session?.matchID === matchID ? session : null;
  const [reconnectStatus, setReconnectStatus] = useState<ReconnectStatus>('reconnecting');
  const routeState = location.state as { freshOnlineSession?: boolean; resumeOnlineSession?: boolean } | null;
  const showRejoinedStatus = routeState?.freshOnlineSession !== true;

  useEffect(() => {
    if (activeSession || !matchID) return;

    let cancelled = false;
    setReconnectStatus('reconnecting');

    onJoinSharedRoom(matchID)
      .then(() => {
        if (!cancelled) setReconnectStatus('ready');
      })
      .catch(error => {
        if (!cancelled) setReconnectStatus(onlineErrorStatus(error));
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession, matchID, onJoinSharedRoom]);

  useEffect(() => {
    if (!activeSession) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const validate = async (isRetry: boolean) => {
      setReconnectStatus(isRetry ? 'retrying' : 'reconnecting');
      const result = await validateOnlineSession(activeSession);
      if (cancelled) return;

      if (result.ok) {
        if (activeSession.playerID !== '0') {
          setReconnectStatus('ready');
          return;
        }

        const room = await fetchRoom(activeSession.matchID);
        if (cancelled) return;
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
        retryTimer = setTimeout(() => {
          void validate(true);
        }, 2500);
        return;
      }

      if (result.reason === 'network') {
        setReconnectStatus('retrying');
        retryTimer = setTimeout(() => {
          void validate(true);
        }, 2500);
        return;
      }

      clearStoredOnlineSession();
      setReconnectStatus(result.reason === 'roomGone' ? 'roomNotFound' : 'roomFull');
    };

    void validate(false);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [activeSession]);

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

  const leaveAndReturn = useCallback(async () => {
    if (activeSession) await leaveOnlineSession(activeSession);
    onClearSession();
    navigate('/');
  }, [activeSession, navigate, onClearSession]);

  if (!activeSession) {
    const isError = reconnectStatus === 'roomFull'
      || reconnectStatus === 'roomNotFound'
      || reconnectStatus === 'connectionFailed';
    const title = reconnectStatus === 'roomFull'
      ? t('online.roomFull')
      : reconnectStatus === 'roomNotFound'
      ? t('online.roomNotFound')
      : reconnectStatus === 'connectionFailed'
      ? t('online.connectionFailed')
      : t('onlineSession.reconnecting');

    return (
      <main className="online-session-missing app-screen">
        <section className="empty-route-panel">
          <span>{t('game.onlineMode')}</span>
          <h1>{title}</h1>
          <p>{isError ? t('onlineSession.resumeErrorBody') : t('onlineSession.resumeCheckingBody')}</p>
          <button className="primary-action" type="button" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </button>
        </section>
      </main>
    );
  }

  if (reconnectStatus !== 'ready') {
    const isRoomNotFound = reconnectStatus === 'roomNotFound';
    const isRoomFull = reconnectStatus === 'roomFull';
    const isConnectionFailed = reconnectStatus === 'connectionFailed' || reconnectStatus === 'retrying';
    const isWaiting = reconnectStatus === 'waiting';
    const title = isRoomNotFound
      ? t('online.roomNotFound')
      : isRoomFull
      ? t('online.roomFull')
      : isConnectionFailed
      ? t('online.connectionFailed')
      : isWaiting
      ? t('online.waitingForOpponent')
      : t('onlineSession.reconnecting');
    const body = isRoomNotFound
      ? t('onlineSession.roomGoneBody')
      : isRoomFull
      ? t('onlineSession.seatTakenBody')
      : reconnectStatus === 'retrying'
      ? t('onlineSession.disconnectedRetrying')
      : isWaiting
      ? t('onlineSession.resumeCheckingBody')
      : t('onlineSession.resumeCheckingBody');

    return (
      <main className="online-session-missing app-screen">
        <section className={`empty-route-panel ${isWaiting ? 'waiting-room-panel' : ''}`}>
          <span>{t('game.onlineMode')}</span>
          <h1>{title}</h1>
          <p>{body}</p>
          {isWaiting && <RoomInfo matchID={activeSession.matchID} />}
          {isWaiting ? (
            <button className="danger-action" type="button" onClick={() => void leaveAndReturn()}>
              {t('online.cancelRoom')}
            </button>
          ) : (isRoomNotFound || isRoomFull || isConnectionFailed) && (
            <button
              className="primary-action"
              type="button"
              onClick={() => {
                onClearSession();
                navigate('/');
              }}
            >
              {t('common.backToLobby')}
            </button>
          )}
        </section>
      </main>
    );
  }

  return (
    <OnlineGame
      matchID={activeSession.matchID}
      playerID={activeSession.playerID}
      playerCredentials={activeSession.playerCredentials}
      showRejoinedStatus={showRejoinedStatus}
      onBack={() => {
        void leaveAndReturn();
      }}
    />
  );
}
