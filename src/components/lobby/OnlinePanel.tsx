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
import { addErrorBreadcrumb } from '../../observability/sentry';

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
    addErrorBreadcrumb(id ? 'online.join_room' : 'online.create_room', { hasMatchId: Boolean(id) });
    try {
      const nextSession = await startOnline(id);
      addErrorBreadcrumb('online.room_started', {
        matchID: nextSession.matchID,
        playerID: nextSession.playerID,
      });
      setCreatedMatchID(id ? '' : nextSession.matchID);
    } catch (err) {
      addErrorBreadcrumb('online.room_start_failed', {
        message: err instanceof Error ? err.message : 'unknown',
      });
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
      addErrorBreadcrumb('matchmaking.status_failed', {
        message: err instanceof Error ? err.message : 'unknown',
      });
      setError(onlineErrorMessage(err));
      return;
    }

    if (cancelRef.current) return;
    if (phaseRef.current !== 'polling') return;

    if (status.status === 'matched') {
      addErrorBreadcrumb('matchmaking.matched', {
        role: status.role,
        hasRealMatchId: Boolean(status.realMatchId),
      });
      if (status.role === 'host') {
        phaseRef.current = 'host-starting';
        stopPolling();
        try {
          const session = await startOnline();
          phaseRef.current = 'done';
          addErrorBreadcrumb('matchmaking.host_started_room', { matchID: session.matchID });
          // 通知 guest 真實 boardgame.io matchID（fire and forget，避免阻塞導航）
          void matchmakingReportMatch(session.matchID).catch(() => {});
        } catch (err) {
          phaseRef.current = 'idle';
          setMatchmakingActive(false);
          addErrorBreadcrumb('matchmaking.host_start_failed', {
            message: err instanceof Error ? err.message : 'unknown',
          });
          setError(onlineErrorMessage(err));
          void matchmakingLeave().catch(() => {});
        }
      } else if (status.role === 'guest' && status.realMatchId) {
        phaseRef.current = 'guest-joining';
        stopPolling();
        try {
          await startOnline(status.realMatchId);
          phaseRef.current = 'done';
          addErrorBreadcrumb('matchmaking.guest_joined_room', { matchID: status.realMatchId });
        } catch (err) {
          phaseRef.current = 'idle';
          setMatchmakingActive(false);
          addErrorBreadcrumb('matchmaking.guest_join_failed', {
            message: err instanceof Error ? err.message : 'unknown',
          });
          setError(onlineErrorMessage(err));
          void matchmakingLeave().catch(() => {});
        }
      }
      // guest 但尚未收到 realMatchId，繼續輪詢
    } else if (status.status === 'timeout') {
      resetMatchmaking();
      addErrorBreadcrumb('matchmaking.timeout');
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
    addErrorBreadcrumb('matchmaking.queue');
    try {
      await matchmakingQueue();
    } catch (err) {
      resetMatchmaking();
      addErrorBreadcrumb('matchmaking.queue_failed', {
        message: err instanceof Error ? err.message : 'unknown',
      });
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
    addErrorBreadcrumb('matchmaking.cancel');
    void matchmakingLeave().catch(() => {});
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg italic text-bone">{t('lobby.onlineTitle')}</h3>
        <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('game.onlineMode')}</span>
      </div>
      <div className="flex flex-col gap-2">
        <button
          className="bg-bone px-5 py-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-lacquer transition active:scale-95 disabled:opacity-50"
          type="button"
          onClick={handleQuickMatch}
          disabled={matchmakingActive}
        >
          {t('lobby.quickMatch')}
        </button>
        <button
          className="border border-bone/20 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-bone/60 transition hover:bg-bone/5 disabled:opacity-50"
          type="button"
          onClick={() => runOnline()}
          disabled={matchmakingActive}
        >
          {t('lobby.createRoom')}
        </button>
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
      </div>
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
      {createdMatchID && (
        <div className="flex flex-col gap-2 rounded-sm bg-lacquer p-3 ring-1 ring-bone/10">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{t('online.roomCode')}</span>
            <span className="font-mono text-xs text-gold">{createdMatchID}</span>
          </div>
          <OnlineRoomInfo matchID={createdMatchID} helperText={t('online.hostWaitingHelper')} />
        </div>
      )}
      {error && <p className="text-[10px] text-vermilion/80">{error}</p>}
    </section>
  );
}
