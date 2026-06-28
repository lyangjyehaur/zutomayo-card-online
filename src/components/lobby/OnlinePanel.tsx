import { useCallback, useEffect, useRef, useState } from 'react';
import { OnlineRoomInfo } from '../OnlineRoomInfo';
import {
  isLoggedIn,
  matchmakingLeave,
  matchmakingQueue,
  matchmakingReportMatch,
  matchmakingStatus,
} from '../../api/client';
import { t } from '../../i18n';
import type { OnlineSession } from '../../onlineSession';
import { isOnlineRoomErrorKey } from '../../onlineRoomStatus';

type MatchmakingPhase = 'idle' | 'polling' | 'host-starting' | 'guest-joining' | 'done';

function onlineErrorMessage(error: unknown): string {
  if (error instanceof Error && isOnlineRoomErrorKey(error.message)) return t(error.message);
  return t('online.connectionFailed');
}

export function OnlinePanel({ startOnline }: { startOnline: (matchID?: string) => Promise<OnlineSession> }) {
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
