import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { OnlineGame } from '../components/OnlineGame';
import { t } from '../i18n';
import { clearStoredOnlineSession, validateOnlineSession, type OnlineSession } from '../onlineSession';

type ReconnectStatus = 'reconnecting' | 'retrying' | 'ready' | 'roomGone' | 'seatTaken';

interface OnlineGamePageProps {
  session: OnlineSession | null;
  onClearSession: () => void;
}

export function OnlineGamePage({ session, onClearSession }: OnlineGamePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { matchID = '' } = useParams<'matchID'>();
  const activeSession = session?.matchID === matchID ? session : null;
  const [reconnectStatus, setReconnectStatus] = useState<ReconnectStatus>('reconnecting');
  const routeState = location.state as { freshOnlineSession?: boolean; resumeOnlineSession?: boolean } | null;
  const showRejoinedStatus = routeState?.freshOnlineSession !== true;

  useEffect(() => {
    if (!activeSession) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const validate = async (isRetry: boolean) => {
      setReconnectStatus(isRetry ? 'retrying' : 'reconnecting');
      const result = await validateOnlineSession(activeSession);
      if (cancelled) return;

      if (result.ok) {
        setReconnectStatus('ready');
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
      setReconnectStatus(result.reason === 'roomGone' ? 'roomGone' : 'seatTaken');
    };

    void validate(false);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [activeSession]);

  if (!activeSession) {
    return (
      <main className="online-session-missing app-screen">
        <section className="empty-route-panel">
          <span>{t('game.onlineMode')}</span>
          <h1>{t('onlineSession.missingTitle')}</h1>
          <p>{t('onlineSession.missingBody')}</p>
          <button className="primary-action" type="button" onClick={() => navigate('/')}>
            {t('common.backToLobby')}
          </button>
        </section>
      </main>
    );
  }

  if (reconnectStatus !== 'ready') {
    const isRoomGone = reconnectStatus === 'roomGone';
    const isSeatTaken = reconnectStatus === 'seatTaken';
    const title = isRoomGone
      ? t('onlineSession.roomGoneTitle')
      : isSeatTaken
      ? t('onlineSession.seatTakenTitle')
      : t('onlineSession.reconnecting');
    const body = isRoomGone
      ? t('onlineSession.roomGoneBody')
      : isSeatTaken
      ? t('onlineSession.seatTakenBody')
      : reconnectStatus === 'retrying'
      ? t('onlineSession.disconnectedRetrying')
      : t('onlineSession.resumeCheckingBody');

    return (
      <main className="online-session-missing app-screen">
        <section className="empty-route-panel">
          <span>{t('game.onlineMode')}</span>
          <h1>{title}</h1>
          <p>{body}</p>
          {(isRoomGone || isSeatTaken) && (
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
        onClearSession();
        navigate('/');
      }}
    />
  );
}
