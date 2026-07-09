import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Client, type BoardProps } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { ChevronDown, Flag, MessageCircle, Send } from 'lucide-react';
import { ZutomayoCard } from '../game/Game';
import type { GameState } from '../game/types';
import { Board, type BoardGameOverActions } from './Board';
import { t } from '../i18n';
import { IconButton, PageShell } from '../ui';
import { Sentry } from '../sentry';
import {
  ApiError,
  fetchChatMessages,
  markChatRead,
  reportChatMessage,
  sendChatMessage,
  type ChatAuthorRole,
  type ChatMessage,
} from '../api/client';
import {
  createOnlineStateSnapshot,
  evaluateOnlineStateSnapshot,
  type OnlineStateMismatchReason,
  type OnlineStateSnapshot,
} from '../onlineStateGuard';
import {
  connectPlatformMatchShell,
  type PlatformMatchShellPresence,
  type PlatformMatchShellRoom,
} from '../platformClient';

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
type PlatformShellStatus = (PlatformMatchShellPresence & { connected: boolean }) | null;
type ChatStatus = 'loading' | 'ready' | 'unavailable' | 'sending';
type OnlineChatEntry = {
  id: string;
  authorDisplayName: string;
  authorRole: ChatAuthorRole;
  content: string;
  createdAt: string;
  persisted: boolean;
  self: boolean;
};

function playerDisplayName(playerID: string): string {
  return `Player ${Number(playerID) + 1}`;
}

function chatTimeLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function mapChatMessage(message: ChatMessage, localDisplayName: string): OnlineChatEntry {
  return {
    id: message.id,
    authorDisplayName: message.authorDisplayName || 'Player',
    authorRole: message.authorRole,
    content: message.content,
    createdAt: message.createdAt,
    persisted: true,
    self: Boolean(localDisplayName && message.authorDisplayName === localDisplayName),
  };
}

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
  const platformRoomRef = useRef<PlatformMatchShellRoom | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');
  const [clientSyncNonce, setClientSyncNonce] = useState(0);
  const [resyncingState, setResyncingState] = useState(false);
  const [platformShellStatus, setPlatformShellStatus] = useState<PlatformShellStatus>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatStatus, setChatStatus] = useState<ChatStatus>('loading');
  const [chatMessages, setChatMessages] = useState<OnlineChatEntry[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [reportedMessageIds, setReportedMessageIds] = useState<Set<string>>(() => new Set());
  const localDisplayName = playerDisplayName(playerID);
  const localPlatformUserId = `match:${matchID}:player:${playerID}`;

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

  const appendChatEntry = useCallback((entry: OnlineChatEntry) => {
    setChatMessages((messages) => {
      if (messages.some((message) => message.id === entry.id)) return messages;
      return [...messages, entry].slice(-60);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setChatStatus('loading');
    setChatMessages([]);
    setReportedMessageIds(new Set());

    void fetchChatMessages({ conversationType: 'match', subjectId: matchID, limit: 50 }).then(
      (messages) => {
        if (cancelled) return;
        setChatMessages(messages.map((message) => mapChatMessage(message, localDisplayName)));
        setChatStatus('ready');
      },
      (err) => {
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'match chat history unavailable',
          level: 'warning',
          data: { match_id: matchID, status: err instanceof ApiError ? err.status : undefined },
        });
        if (!cancelled) setChatStatus('unavailable');
      },
    );

    return () => {
      cancelled = true;
    };
  }, [localDisplayName, matchID]);

  useEffect(() => {
    if (chatStatus !== 'ready') return;
    const latestPersisted = [...chatMessages].reverse().find((message) => message.persisted);
    if (!latestPersisted) return;
    void markChatRead({
      conversationType: 'match',
      subjectId: matchID,
      lastReadMessageId: latestPersisted.id,
    }).catch(() => undefined);
  }, [chatMessages, chatStatus, matchID]);

  useEffect(() => {
    let cancelled = false;
    let room: PlatformMatchShellRoom | undefined;

    void connectPlatformMatchShell(
      {
        boardgameMatchID: matchID,
        userId: localPlatformUserId,
        displayName: localDisplayName,
        role: 'player',
      },
      {
        onPresence: (presence) => {
          if (!cancelled) setPlatformShellStatus({ ...presence, connected: true });
        },
        onChatPreview: (message) => {
          if (cancelled || message.sender.userId === localPlatformUserId) return;
          appendChatEntry({
            id: `preview:${message.sender.sessionId}:${message.createdAt}`,
            authorDisplayName: message.sender.displayName,
            authorRole: message.sender.role,
            content: message.text,
            createdAt: new Date(message.createdAt).toISOString(),
            persisted: false,
            self: false,
          });
        },
        onDisconnect: () => {
          if (!cancelled) setPlatformShellStatus(null);
        },
      },
    ).then(
      (nextRoom) => {
        if (cancelled) {
          void nextRoom.leave(true).catch(() => undefined);
          return;
        }
        room = nextRoom;
        platformRoomRef.current = nextRoom;
      },
      (err) => {
        Sentry.addBreadcrumb({
          category: 'platform',
          message: 'match shell unavailable',
          level: 'warning',
          data: { match_id: matchID, error: err instanceof Error ? err.message : String(err) },
        });
        if (!cancelled) setPlatformShellStatus(null);
      },
    );

    return () => {
      cancelled = true;
      platformRoomRef.current = null;
      setPlatformShellStatus(null);
      void room?.leave(true).catch(() => undefined);
    };
  }, [appendChatEntry, localDisplayName, localPlatformUserId, matchID]);

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

  const handleChatSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const content = chatDraft.trim();
      if (!content || chatStatus === 'sending') return;

      setChatStatus('sending');
      try {
        const result = await sendChatMessage({
          conversationType: 'match',
          subjectId: matchID,
          content,
          authorDisplayName: localDisplayName,
          authorRole: 'player',
          clientMessageId: `client:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        });
        appendChatEntry(mapChatMessage(result.message, localDisplayName));
        setChatDraft('');
        platformRoomRef.current?.send('chatPreview', {
          conversationId: result.conversation.id,
          text: result.message.content,
        });
        setChatStatus('ready');
      } catch (err) {
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'match chat send failed',
          level: 'warning',
          data: { match_id: matchID, status: err instanceof ApiError ? err.status : undefined },
        });
        setChatStatus('ready');
      }
    },
    [appendChatEntry, chatDraft, chatStatus, localDisplayName, matchID],
  );

  const handleChatReport = useCallback(
    async (message: OnlineChatEntry) => {
      if (!message.persisted || message.self || reportedMessageIds.has(message.id)) return;
      setReportedMessageIds((ids) => new Set(ids).add(message.id));
      try {
        await reportChatMessage(message.id, { reason: 'inappropriate' });
      } catch (err) {
        setReportedMessageIds((ids) => {
          const next = new Set(ids);
          next.delete(message.id);
          return next;
        });
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'match chat report failed',
          level: 'warning',
          data: { match_id: matchID, status: err instanceof ApiError ? err.status : undefined },
        });
      }
    },
    [matchID, reportedMessageIds],
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
      {platformShellStatus && (
        <div className="absolute left-6 top-1.5 z-[var(--z-modal)]">
          <span
            className="online-platform-status font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70"
            aria-label={`Platform room connected, ${platformShellStatus.players} players, ${platformShellStatus.spectators} spectators`}
          >
            P {platformShellStatus.players} / S {platformShellStatus.spectators}
          </span>
        </div>
      )}
      <div className={`online-chat-panel ${chatOpen ? 'open' : 'collapsed'}`}>
        <div className="online-chat-header">
          <IconButton
            label={chatOpen ? 'Hide match chat' : 'Show match chat'}
            icon={
              chatOpen ? (
                <ChevronDown className="size-4" aria-hidden="true" />
              ) : (
                <MessageCircle className="size-4" aria-hidden="true" />
              )
            }
            className="online-chat-toggle"
            onClick={() => setChatOpen((open) => !open)}
          />
          {chatOpen && (
            <span className="online-chat-state">
              {chatStatus === 'loading' ? 'SYNCING' : chatStatus === 'unavailable' ? 'OFFLINE' : 'MATCH CHAT'}
            </span>
          )}
        </div>
        {chatOpen && (
          <>
            <div className="online-chat-messages" aria-live="polite">
              {chatMessages.length === 0 ? (
                <div className="online-chat-empty">{chatStatus === 'loading' ? 'SYNCING' : 'NO MESSAGES'}</div>
              ) : (
                chatMessages.map((message) => (
                  <div key={message.id} className={`online-chat-message ${message.self ? 'self' : ''}`}>
                    <div className="online-chat-meta">
                      <span>{message.authorDisplayName}</span>
                      <span className="online-chat-meta-actions">
                        {chatTimeLabel(message.createdAt)}
                        {message.persisted && !message.self && (
                          <IconButton
                            label={
                              reportedMessageIds.has(message.id)
                                ? 'Match chat message reported'
                                : 'Report match chat message'
                            }
                            icon={<Flag className="size-3" aria-hidden="true" />}
                            size="sm"
                            className="online-chat-report-button"
                            disabled={reportedMessageIds.has(message.id)}
                            onClick={() => void handleChatReport(message)}
                          />
                        )}
                      </span>
                    </div>
                    <div className="online-chat-bubble">{message.content}</div>
                  </div>
                ))
              )}
            </div>
            <form className="online-chat-form" onSubmit={handleChatSubmit}>
              <input
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value.slice(0, 500))}
                maxLength={500}
                disabled={chatStatus === 'loading' || chatStatus === 'unavailable'}
                aria-label="Match chat message"
              />
              <IconButton
                label="Send match chat message"
                icon={<Send className="size-4" aria-hidden="true" />}
                type="submit"
                variant="secondary"
                disabled={!chatDraft.trim() || chatStatus === 'loading' || chatStatus === 'sending'}
              />
            </form>
          </>
        )}
      </div>
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
