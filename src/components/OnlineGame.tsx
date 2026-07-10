import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Client, type BoardProps } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { ChevronDown, Flag, Languages, MessageCircle, Send } from 'lucide-react';
import { ZutomayoCard } from '../game/Game';
import type { GameState } from '../game/types';
import { Board, type BoardGameOverActions } from './Board';
import { t, useLocale } from '../i18n';
import { IconButton, PageShell } from '../ui';
import { Sentry } from '../sentry';
import {
  ApiError,
  fetchChatMessages,
  getProfile,
  isLoggedIn,
  markChatRead,
  reportChatMessage,
  requestChatTranslation,
  sendChatMessage,
  type ChatAuthorRole,
  type ChatMessageTranslation,
  type ChatMessage,
  type ProfileResponse,
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
  playerID?: string;
  playerCredentials?: string;
  spectator?: boolean;
  showRejoinedStatus?: boolean;
  onLeaveRequest: () => void;
  onReturnToLobby: () => void;
  onCreateNewRoom: () => void;
  onOpponentDetected?: () => void;
}

type ConnectionStatus = 'reconnecting' | 'disconnected' | 'rejoined' | null;

type MatchDataMember = { id: number; name?: string } | undefined;
type PlatformShellStatus = (PlatformMatchShellPresence & { connected: boolean }) | null;
type ChatStatus = 'loading' | 'ready' | 'unavailable' | 'login_required' | 'sending';
type OnlineChatEntry = {
  id: string;
  authorDisplayName: string;
  authorRole: ChatAuthorRole;
  content: string;
  createdAt: string;
  persisted: boolean;
  self: boolean;
  translation?: OnlineChatTranslationState;
};
type OnlineChatTranslationState = {
  status: ChatMessageTranslation['status'] | 'loading' | 'unavailable';
  targetLanguage: string;
  content?: string;
};

function playerDisplayName(playerID: string): string {
  return `Player ${Number(playerID) + 1}`;
}

function participantDisplayName(playerID: string | undefined, spectator: boolean): string {
  if (spectator || playerID === undefined) return 'Spectator';
  return playerDisplayName(playerID);
}

function chatTimeLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function mapChatMessage(message: ChatMessage, localUserId: string, localDisplayName: string): OnlineChatEntry {
  const sameUser = Boolean(localUserId && message.authorUserId === localUserId);
  const sameDisplayName = Boolean(!localUserId && localDisplayName && message.authorDisplayName === localDisplayName);
  return {
    id: message.id,
    authorDisplayName: message.authorDisplayName || 'Player',
    authorRole: message.authorRole,
    content: message.content,
    createdAt: message.createdAt,
    persisted: true,
    self: sameUser || sameDisplayName,
  };
}

function canShowChatMessage(message: ChatMessage): boolean {
  return message.moderationStatus !== 'blocked' && message.moderationStatus !== 'deleted';
}

function chatStatusLabel(status: ChatStatus): string {
  if (status === 'loading') return 'SYNCING';
  if (status === 'login_required') return 'LOGIN REQUIRED';
  if (status === 'unavailable') return 'OFFLINE';
  return 'MATCH CHAT';
}

function chatEmptyLabel(status: ChatStatus): string {
  if (status === 'loading') return 'SYNCING';
  if (status === 'login_required') return 'LOGIN TO CHAT';
  return 'NO MESSAGES';
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
  spectator = false,
  showRejoinedStatus = false,
  onLeaveRequest: _onLeaveRequest,
  onReturnToLobby,
  onCreateNewRoom,
  onOpponentDetected,
}: OnlineGameProps) {
  const locale = useLocale();
  const connectedOnce = useRef(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReturnToLobbyRef = useRef(onReturnToLobby);
  const onCreateNewRoomRef = useRef(onCreateNewRoom);
  const opponentDetectedRef = useRef<(() => void) | null>(null);
  const platformRoomRef = useRef<PlatformMatchShellRoom | null>(null);
  const spectatorPlatformUserId = useRef(`match:${matchID}:spectator:${Date.now().toString(36)}`);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');
  const [clientSyncNonce, setClientSyncNonce] = useState(0);
  const [resyncingState, setResyncingState] = useState(false);
  const [platformShellStatus, setPlatformShellStatus] = useState<PlatformShellStatus>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatStatus, setChatStatus] = useState<ChatStatus>('loading');
  const [chatMessages, setChatMessages] = useState<OnlineChatEntry[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [reportedMessageIds, setReportedMessageIds] = useState<Set<string>>(() => new Set());
  const [chatAccount, setChatAccount] = useState<ProfileResponse | null>(null);
  const [chatAccountLoaded, setChatAccountLoaded] = useState(false);
  const fallbackDisplayName = participantDisplayName(playerID, spectator);
  const chatDisplayName = chatAccount?.nickname || fallbackDisplayName;
  const chatUserId = chatAccount?.id || '';
  const localPlatformUserId = chatUserId
    ? `user:${chatUserId}`
    : spectator
      ? spectatorPlatformUserId.current
      : `match:${matchID}:player:${playerID}`;

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

  useEffect(() => {
    let cancelled = false;
    setChatAccount(null);

    if (!isLoggedIn()) {
      setChatAccountLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    setChatAccountLoaded(false);
    void getProfile().then(
      (profile) => {
        if (cancelled) return;
        setChatAccount(profile);
        setChatAccountLoaded(true);
      },
      (err) => {
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'match chat account unavailable',
          level: 'warning',
          data: { match_id: matchID, status: err instanceof ApiError ? err.status : undefined },
        });
        if (cancelled) return;
        setChatAccount(null);
        setChatAccountLoaded(true);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [matchID]);

  const appendChatEntry = useCallback((entry: OnlineChatEntry) => {
    setChatMessages((messages) => {
      if (messages.some((message) => message.id === entry.id)) return messages;
      return [...messages, entry].slice(-60);
    });
  }, []);

  const applyChatTranslation = useCallback((messageId: string, translation: OnlineChatTranslationState) => {
    setChatMessages((messages) =>
      messages.map((message) => (message.id === messageId ? { ...message, translation } : message)),
    );
  }, []);

  const loadMatchChatEntries = useCallback(async (): Promise<OnlineChatEntry[]> => {
    const messages = await fetchChatMessages({ conversationType: 'match', subjectId: matchID, limit: 50 });
    return messages
      .filter((message) => canShowChatMessage(message))
      .map((message) => mapChatMessage(message, chatUserId, chatDisplayName));
  }, [chatDisplayName, chatUserId, matchID]);

  useEffect(() => {
    let cancelled = false;
    setChatStatus('loading');
    setChatMessages([]);
    setReportedMessageIds(new Set());

    if (!chatAccountLoaded) {
      return () => {
        cancelled = true;
      };
    }

    if (!chatAccount) {
      setChatStatus('login_required');
      return () => {
        cancelled = true;
      };
    }

    void loadMatchChatEntries().then(
      (entries) => {
        if (cancelled) return;
        setChatMessages(entries);
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
  }, [chatAccount, chatAccountLoaded, loadMatchChatEntries, matchID]);

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
    if (!chatAccountLoaded) return;
    let cancelled = false;
    let room: PlatformMatchShellRoom | undefined;

    void connectPlatformMatchShell(
      {
        boardgameMatchID: matchID,
        userId: localPlatformUserId,
        displayName: chatDisplayName,
        role: spectator ? 'spectator' : 'player',
        boardgamePlayerID: spectator ? undefined : playerID,
        hasBoardgameCredentials: !spectator && Boolean(playerCredentials),
      },
      {
        onPresence: (presence) => {
          if (!cancelled) setPlatformShellStatus({ ...presence, connected: true });
        },
        onChatPreview: (message) => {
          if (cancelled || message.sender.userId === localPlatformUserId) return;
          if (!chatAccount) return;
          void loadMatchChatEntries().then(
            (entries) => {
              if (!cancelled) setChatMessages(entries);
            },
            (err) => {
              Sentry.addBreadcrumb({
                category: 'chat',
                message: 'match chat preview sync failed',
                level: 'warning',
                data: { match_id: matchID, status: err instanceof ApiError ? err.status : undefined },
              });
            },
          );
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
  }, [
    chatAccount,
    chatAccountLoaded,
    chatDisplayName,
    loadMatchChatEntries,
    localPlatformUserId,
    matchID,
    playerCredentials,
    playerID,
    spectator,
  ]);

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
      if (!chatAccount) {
        setChatStatus('login_required');
        return;
      }

      setChatStatus('sending');
      try {
        const result = await sendChatMessage({
          conversationType: 'match',
          subjectId: matchID,
          content,
          authorDisplayName: chatDisplayName,
          authorRole: spectator ? 'spectator' : 'player',
          clientMessageId: `client:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        });
        if (canShowChatMessage(result.message)) {
          appendChatEntry(mapChatMessage(result.message, chatUserId, chatDisplayName));
        }
        setChatDraft('');
        if (canShowChatMessage(result.message)) {
          platformRoomRef.current?.send('chatPreview', {
            conversationId: result.conversation.id,
            text: result.message.content,
          });
        }
        setChatStatus('ready');
      } catch (err) {
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'match chat send failed',
          level: 'warning',
          data: { match_id: matchID, status: err instanceof ApiError ? err.status : undefined },
        });
        setChatStatus(err instanceof ApiError && err.status === 401 ? 'login_required' : 'ready');
      }
    },
    [appendChatEntry, chatAccount, chatDisplayName, chatDraft, chatStatus, chatUserId, matchID, spectator],
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

  const handleChatTranslate = useCallback(
    async (message: OnlineChatEntry) => {
      if (!message.persisted || message.translation?.status === 'loading') return;
      const targetLanguage = locale.toLowerCase();
      applyChatTranslation(message.id, { status: 'loading', targetLanguage });
      try {
        const result = await requestChatTranslation(message.id, targetLanguage);
        applyChatTranslation(message.id, {
          status: result.translation.status,
          targetLanguage: result.translation.targetLanguage,
          content: result.translation.translatedContent || undefined,
        });
      } catch (err) {
        applyChatTranslation(message.id, { status: 'unavailable', targetLanguage });
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'match chat translation failed',
          level: 'warning',
          data: { match_id: matchID, status: err instanceof ApiError ? err.status : undefined },
        });
      }
    },
    [applyChatTranslation, locale, matchID],
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
          {chatOpen && <span className="online-chat-state">{chatStatusLabel(chatStatus)}</span>}
        </div>
        {chatOpen && (
          <>
            <div className="online-chat-messages" aria-live="polite">
              {chatMessages.length === 0 ? (
                <div className="online-chat-empty">{chatEmptyLabel(chatStatus)}</div>
              ) : (
                chatMessages.map((message) => (
                  <div key={message.id} className={`online-chat-message ${message.self ? 'self' : ''}`}>
                    <div className="online-chat-meta">
                      <span>{message.authorDisplayName}</span>
                      <span className="online-chat-meta-actions">
                        {chatTimeLabel(message.createdAt)}
                        {message.persisted && (
                          <IconButton
                            label="Translate match chat message"
                            icon={<Languages className="size-3" aria-hidden="true" />}
                            size="sm"
                            className="online-chat-translate-button"
                            disabled={message.translation?.status === 'loading'}
                            onClick={() => void handleChatTranslate(message)}
                          />
                        )}
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
                    {message.translation && (
                      <div
                        className={`online-chat-translation ${
                          message.translation.status === 'ready' && message.translation.content ? 'ready' : 'pending'
                        }`}
                      >
                        {message.translation.status === 'ready' && message.translation.content
                          ? message.translation.content
                          : message.translation.status === 'loading'
                            ? 'TRANSLATING'
                            : message.translation.status === 'unavailable'
                              ? 'TRANSLATION OFFLINE'
                              : 'TRANSLATION PENDING'}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            <form className="online-chat-form" onSubmit={handleChatSubmit}>
              <input
                value={chatDraft}
                onChange={(event) => setChatDraft(event.target.value.slice(0, 500))}
                maxLength={500}
                disabled={chatStatus === 'loading' || chatStatus === 'unavailable' || chatStatus === 'login_required'}
                aria-label="Match chat message"
              />
              <IconButton
                label="Send match chat message"
                icon={<Send className="size-4" aria-hidden="true" />}
                type="submit"
                variant="secondary"
                disabled={
                  !chatDraft.trim() ||
                  chatStatus === 'loading' ||
                  chatStatus === 'sending' ||
                  chatStatus === 'unavailable' ||
                  chatStatus === 'login_required'
                }
              />
            </form>
          </>
        )}
      </div>
      <div className="board-client-frame h-full w-full">
        <OnlineClient
          key={`${matchID}:${spectator ? 'spectator' : playerID}:${clientSyncNonce}`}
          playerID={spectator ? undefined : playerID}
          matchID={matchID}
          credentials={spectator ? undefined : playerCredentials}
        />
      </div>
    </PageShell>
  );
}
