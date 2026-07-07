import { useCallback, useEffect, useRef, useState } from 'react';
import { Client, type BoardProps } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { ZutomayoCard } from '../game/Game';
import type { GameState } from '../game/types';
import { Board, type BoardGameOverActions } from './Board';
import { t } from '../i18n';
import { PageShell } from '../ui';
import { Sentry } from '../sentry';
import {
  createOnlineStateSnapshot,
  evaluateOnlineStateSnapshot,
  type OnlineStateMismatchReason,
  type OnlineStateSnapshot,
} from '../onlineStateGuard';

interface OnlineGameProps {
  matchID: string;
  playerID: string;
  playerCredentials: string;
  showRejoinedStatus?: boolean;
  onLeaveRequest: () => void;
  onReturnToLobby: () => void;
  onCreateNewRoom: () => void;
  onOpponentDetected?: () => void;
}

type ConnectionStatus = 'reconnecting' | 'disconnected' | 'rejoined' | null;

type MatchDataMember = { id: number; name?: string } | undefined;

function OnlineLoading() {
  return (
    <PageShell
      className="flex items-center justify-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/50"
      role="status"
    >
      {t('onlineSession.reconnecting')}
    </PageShell>
  );
}

function OnlineBoard(
  props: BoardProps<GameState> & {
    gameOverActions: BoardGameOverActions;
    onConnectionStatusChange: (isConnected: boolean) => void;
    onOpponentDetected: () => void;
    onStateMismatch: (reason: OnlineStateMismatchReason) => void;
  },
) {
  const { gameOverActions, onConnectionStatusChange, onOpponentDetected, onStateMismatch, ...boardProps } = props;
  const lastSnapshot = useRef<OnlineStateSnapshot | null>(null);

  useEffect(() => {
    onConnectionStatusChange(props.isConnected);
  }, [onConnectionStatusChange, props.isConnected]);

  useEffect(() => {
    if (typeof props._stateID !== 'number' || !props.G || !props.ctx) return;
    // 同步 game_phase tag 到 Sentry，便於後台依遊戲階段篩選錯誤。
    if (props.G.step) {
      Sentry.setTag('game_phase', props.G.step);
    }
    const next = createOnlineStateSnapshot({
      stateID: props._stateID,
      G: props.G,
      ctx: props.ctx,
    });
    const result = evaluateOnlineStateSnapshot(lastSnapshot.current, next);
    if (!result.ok) {
      lastSnapshot.current = null;
      onStateMismatch(result.reason);
      return;
    }
    lastSnapshot.current = result.snapshot;
  }, [props._stateID, props.G, props.ctx, onStateMismatch]);

  // P2-13：改用 Socket.IO 推送的 matchData 變化偵測對手加入，取代 HTTP 輪詢。
  // boardgame.io client 連線後，當第二個玩家 join 時 server 會推送 matchData 更新。
  useEffect(() => {
    const matchData = props.matchData as MatchDataMember[] | undefined;
    if (!matchData) return;
    const opponentJoined = matchData.some((player) => player?.id === 1 && Boolean(player?.name));
    if (opponentJoined) onOpponentDetected();
  }, [props.matchData, onOpponentDetected]);

  // P3-16：線上模式啟用伺服器權威計時器（G.turnStartTime + timeoutSkip move）。
  return <Board {...boardProps} gameOverActions={gameOverActions} useServerTimer />;
}

export function OnlineGame({
  matchID,
  playerID,
  playerCredentials,
  showRejoinedStatus = false,
  onLeaveRequest: _onLeaveRequest,
  onReturnToLobby,
  onCreateNewRoom,
  onOpponentDetected,
}: OnlineGameProps) {
  const connectedOnce = useRef(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReturnToLobbyRef = useRef(onReturnToLobby);
  const onCreateNewRoomRef = useRef(onCreateNewRoom);
  const opponentDetectedRef = useRef<(() => void) | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');
  const [clientSyncNonce, setClientSyncNonce] = useState(0);
  const [resyncingState, setResyncingState] = useState(false);

  // 線上對戰模式標記，便於 Sentry 後台區分錯誤來源模式。
  useEffect(() => {
    Sentry.setTag('match_mode', 'online');
    return () => {
      // 離開線上模式時清除 tag，避免 tag 殘留影響後續頁面的錯誤歸類。
      Sentry.setTag('match_mode', undefined);
    };
  }, []);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
    },
    [],
  );

  useEffect(() => {
    onReturnToLobbyRef.current = onReturnToLobby;
    onCreateNewRoomRef.current = onCreateNewRoom;
    opponentDetectedRef.current = onOpponentDetected ?? null;
  }, [onReturnToLobby, onCreateNewRoom, onOpponentDetected]);

  const handleOpponentDetected = useCallback(() => {
    opponentDetectedRef.current?.();
  }, []);

  const flashRejoined = useCallback(() => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setConnectionStatus('rejoined');
    statusTimer.current = setTimeout(() => setConnectionStatus(null), 2400);
  }, []);

  const handleConnectionStatusChange = useCallback(
    (isConnected: boolean) => {
      if (isConnected) {
        const isReconnect = connectedOnce.current;
        connectedOnce.current = true;
        setResyncingState(false);
        if (resyncTimer.current) clearTimeout(resyncTimer.current);
        if (showRejoinedStatus || isReconnect) flashRejoined();
        else setConnectionStatus(null);
        Sentry.addBreadcrumb({
          category: 'connection',
          message: isReconnect ? 'WebSocket reconnected' : 'WebSocket connected',
          level: 'info',
          data: { match_id: matchID },
        });
        return;
      }

      const wasConnected = connectedOnce.current;
      setConnectionStatus(wasConnected ? 'disconnected' : 'reconnecting');
      Sentry.addBreadcrumb({
        category: 'connection',
        message: wasConnected ? 'WebSocket disconnected, attempting reconnect' : 'WebSocket connecting',
        level: wasConnected ? 'warning' : 'info',
        data: { match_id: matchID },
      });
    },
    [flashRejoined, matchID, showRejoinedStatus],
  );

  const handleStateMismatch = useCallback(
    (reason: OnlineStateMismatchReason) => {
      console.warn(`[online-sync] detected ${reason}; rebuilding client to resync authoritative state`);
      Sentry.captureException(new Error(`Online state mismatch: ${reason}`), {
        tags: { layer: 'online-sync', reason, match_id: matchID },
      });
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
      setConnectionStatus('reconnecting');
      setResyncingState(true);
      setClientSyncNonce((nonce) => nonce + 1);
      resyncTimer.current = setTimeout(() => setResyncingState(false), 5000);
    },
    [matchID],
  );

  const [OnlineClient] = useState(() =>
    Client({
      game: ZutomayoCard,
      board: (props: BoardProps<GameState>) => (
        <OnlineBoard
          {...props}
          gameOverActions={{
            helperText: t('online.gameOverHelper'),
            primary: {
              label: t('common.backToLobby'),
              onClick: () => onReturnToLobbyRef.current(),
            },
            secondary: {
              label: t('online.createNewRoom'),
              onClick: () => onCreateNewRoomRef.current(),
              variant: 'secondary',
            },
          }}
          onConnectionStatusChange={handleConnectionStatusChange}
          onOpponentDetected={handleOpponentDetected}
          onStateMismatch={handleStateMismatch}
        />
      ),
      loading: OnlineLoading,
      numPlayers: 2,
      multiplayer: SocketIO({ server: window.location.origin }),
      debug: false,
    }),
  );

  const visibleConnectionStatus = resyncingState ? 'reconnecting' : connectionStatus;

  return (
    <PageShell>
      {visibleConnectionStatus && (
        <div className="absolute right-6 top-1.5 z-[var(--z-modal)]">
          <span
            className={`font-mono text-caption uppercase tracking-[var(--tracking-kicker)] ${
              visibleConnectionStatus === 'disconnected' ? 'text-accent-action/80' : 'text-accent-primary/70'
            }`}
          >
            {visibleConnectionStatus === 'rejoined'
              ? t('onlineSession.rejoined')
              : visibleConnectionStatus === 'disconnected'
                ? t('onlineSession.disconnectedRetrying')
                : t('onlineSession.reconnecting')}
          </span>
        </div>
      )}
      <div className="board-client-frame h-full w-full">
        <OnlineClient
          key={`${matchID}:${playerID}:${clientSyncNonce}`}
          playerID={playerID}
          matchID={matchID}
          credentials={playerCredentials}
        />
      </div>
    </PageShell>
  );
}
