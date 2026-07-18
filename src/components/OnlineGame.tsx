import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Client, type BoardProps } from 'boardgame.io/react';
import { SocketIO } from 'boardgame.io/multiplayer';
import { onlineSocketOptions } from '../onlineSocketConfig';
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
  type MatchChatAccess,
  type ProfileResponse,
} from '../api/client';
import {
  canSubmitMatchChat,
  matchChatAccessStatus,
  matchChatAuthorRole,
  matchPlatformPresenceUserId,
} from '../chat/matchChatAccess';
import {
  createOnlineStateSnapshot,
  evaluateOnlineStateSnapshot,
  type OnlineStateMismatchReason,
  type OnlineStateSnapshot,
} from '../onlineStateGuard';
import { didOnlineStateAdvance, ONLINE_MOVE_ACK_TIMEOUT_MS, shouldTrackOnlineMove } from '../onlineMoveAck';
import type { PlatformMatchShellRoom } from '../platformClient';
import {
  connectPlatformMatchShellWithRetry,
  type PlatformMatchShellConnectionState,
} from '../platformMatchShellConnection';

interface OnlineGameProps {
  matchID: string;
  playerID?: string;
  playerCredentials?: string;
  platformSeatToken?: string;
  platformUserId?: string;
  platformDisplayName?: string;
  spectator?: boolean;
  showRejoinedStatus?: boolean;
  onLeaveRequest: () => void;
  onReturnToLobby: () => void;
  onCreateNewRoom: () => void;
  onOpponentDetected?: () => void;
}

type ConnectionStatus = 'reconnecting' | 'disconnected' | 'rejoined' | null;

type MatchDataMember = { id: number; name?: string } | undefined;
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
  return t('chat.playerN').replace('{n}', String(Number(playerID) + 1));
}

function participantDisplayName(playerID: string | undefined, spectator: boolean): string {
  if (spectator || playerID === undefined) return t('chat.spectator');
  return playerDisplayName(playerID);
}

function chatTimeLabel(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function mapChatMessage(message: ChatMessage, localUserId: string, localDisplayName: string): OnlineChatEntry {
  const sameUser = Boolean(localUserId && message.authorUserId === localUserId);
  const sameGuest = Boolean(localUserId && message.metadata.guestSeatUserId === localUserId);
  const sameDisplayName = Boolean(!localUserId && localDisplayName && message.authorDisplayName === localDisplayName);
  return {
    id: message.id,
    authorDisplayName: message.authorDisplayName || t('player.self'),
    authorRole: message.authorRole,
    content: message.content,
    createdAt: message.createdAt,
    persisted: true,
    self: sameUser || sameGuest || sameDisplayName,
  };
}

function canShowChatMessage(message: ChatMessage): boolean {
  return message.moderationStatus !== 'blocked' && message.moderationStatus !== 'deleted';
}

function chatStatusLabel(status: ChatStatus): string {
  if (status === 'loading') return t('chat.matchSyncing');
  if (status === 'login_required') return t('chat.matchLoginRequired');
  if (status === 'unavailable') return t('chat.matchOffline');
  return t('chat.matchChat');
}

function chatEmptyLabel(status: ChatStatus): string {
  if (status === 'loading') return t('chat.matchSyncing');
  if (status === 'login_required') return t('chat.matchLoginToChat');
  return t('chat.matchNoMessages');
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
    spectator: boolean;
    onConnectionStatusChange: (isConnected: boolean) => void;
    onOpponentDetected: () => void;
    onStateMismatch: (reason: OnlineStateMismatchReason) => void;
    onMoveSubmitted: (moveName: string, stateID: number | undefined) => void;
    onStateObserved: (stateID: number) => void;
    onExitRequest: () => void;
  },
) {
  const {
    gameOverActions,
    spectator,
    onConnectionStatusChange,
    onOpponentDetected,
    onStateMismatch,
    onMoveSubmitted,
    onStateObserved,
    moves,
    _stateID,
    ...boardProps
  } = props;
  const lastSnapshot = useRef<OnlineStateSnapshot | null>(null);
  const trackedMoves = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(moves).map(([name, move]) => [
          name,
          (...args: unknown[]) => {
            onMoveSubmitted(name, _stateID);
            return (move as (...moveArgs: unknown[]) => unknown)(...args);
          },
        ]),
      ) as typeof moves,
    [_stateID, moves, onMoveSubmitted],
  );

  useEffect(() => {
    onConnectionStatusChange(props.isConnected);
  }, [onConnectionStatusChange, props.isConnected]);

  useEffect(() => {
    if (typeof props._stateID !== 'number' || !props.G || !props.ctx) return;
    onStateObserved(props._stateID);
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
  }, [props._stateID, props.G, props.ctx, onStateMismatch, onStateObserved]);

  // P2-13：改用 Socket.IO 推送的 matchData 變化偵測對手加入，取代 HTTP 輪詢。
  // boardgame.io client 連線後，當第二個玩家 join 時 server 會推送 matchData 更新。
  useEffect(() => {
    const matchData = props.matchData as MatchDataMember[] | undefined;
    if (!matchData) return;
    const opponentJoined = matchData.some((player) => player?.id === 1 && Boolean(player?.name));
    if (opponentJoined) onOpponentDetected();
  }, [props.matchData, onOpponentDetected]);

  // P3-16：線上模式啟用伺服器權威計時器（G.turnStartTime + timeoutSkip move）。
  return (
    <Board
      {...boardProps}
      _stateID={_stateID}
      moves={trackedMoves}
      gameOverActions={gameOverActions}
      spectator={spectator}
      useServerTimer
    />
  );
}

export function OnlineGame({
  matchID,
  playerID,
  playerCredentials,
  platformSeatToken,
  platformUserId,
  platformDisplayName,
  spectator = false,
  showRejoinedStatus = false,
  onLeaveRequest,
  onReturnToLobby,
  onCreateNewRoom,
  onOpponentDetected,
}: OnlineGameProps) {
  const locale = useLocale();
  const connectedOnce = useRef(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveAckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestStateIDRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ moveName: string; stateID: number } | null>(null);
  const onReturnToLobbyRef = useRef(onReturnToLobby);
  const onCreateNewRoomRef = useRef(onCreateNewRoom);
  const onLeaveRequestRef = useRef(onLeaveRequest);
  const opponentDetectedRef = useRef<(() => void) | null>(null);
  const platformRoomRef = useRef<PlatformMatchShellRoom | null>(null);
  const spectatorPlatformUserId = useRef(Date.now().toString(36));
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('reconnecting');
  const [clientSyncNonce, setClientSyncNonce] = useState(0);
  const [resyncingState, setResyncingState] = useState(false);
  const [platformShellConnectionState, setPlatformShellConnectionState] =
    useState<PlatformMatchShellConnectionState>('connecting');
  const [platformShellEvidenceReady, setPlatformShellEvidenceReady] = useState(false);
  const [platformShellUnavailable, setPlatformShellUnavailable] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatStatus, setChatStatus] = useState<ChatStatus>('loading');
  const [chatMessages, setChatMessages] = useState<OnlineChatEntry[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [reportedMessageIds, setReportedMessageIds] = useState<Set<string>>(() => new Set());
  const [chatAccount, setChatAccount] = useState<ProfileResponse | null>(null);
  const [chatAccountLoaded, setChatAccountLoaded] = useState(false);
  const fallbackDisplayName = participantDisplayName(playerID, spectator);
  const chatDisplayName = chatAccount?.nickname || platformDisplayName || fallbackDisplayName;
  const hasPlayerSeat = !spectator && (playerID === '0' || playerID === '1') && Boolean(playerCredentials);
  const matchAccess = useMemo<MatchChatAccess | undefined>(
    () =>
      hasPlayerSeat
        ? { matchID, playerID: playerID as string, playerCredentials: playerCredentials as string }
        : undefined,
    [hasPlayerSeat, matchID, playerCredentials, playerID],
  );
  const localPlatformUserId =
    platformUserId && !spectator
      ? platformUserId
      : matchPlatformPresenceUserId({
          account: chatAccount,
          matchID,
          playerID,
          spectator,
          anonymousToken: spectatorPlatformUserId.current,
        });
  const chatUserId = chatAccount?.id || localPlatformUserId;

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
      if (moveAckTimer.current) clearTimeout(moveAckTimer.current);
    },
    [],
  );

  useEffect(() => {
    pendingMoveRef.current = null;
    latestStateIDRef.current = null;
    if (moveAckTimer.current) clearTimeout(moveAckTimer.current);
    moveAckTimer.current = null;
    connectedOnce.current = false;
  }, [matchID]);

  useEffect(() => {
    onReturnToLobbyRef.current = onReturnToLobby;
    onCreateNewRoomRef.current = onCreateNewRoom;
    onLeaveRequestRef.current = onLeaveRequest;
    opponentDetectedRef.current = onOpponentDetected ?? null;
  }, [onReturnToLobby, onCreateNewRoom, onLeaveRequest, onOpponentDetected]);

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
    const messages = await fetchChatMessages({
      conversationType: 'match',
      subjectId: matchID,
      limit: 50,
      matchAccess,
    });
    return messages
      .filter((message) => canShowChatMessage(message))
      .map((message) => mapChatMessage(message, chatUserId, chatDisplayName));
  }, [chatDisplayName, chatUserId, matchAccess, matchID]);

  useEffect(() => {
    let cancelled = false;
    setChatStatus('loading');
    setChatMessages([]);
    setReportedMessageIds(new Set());

    const accessStatus = matchChatAccessStatus(chatAccountLoaded, chatAccount, hasPlayerSeat);
    if (accessStatus === 'loading') {
      return () => {
        cancelled = true;
      };
    }

    if (accessStatus === 'login_required') {
      setChatStatus('login_required');
      return () => {
        cancelled = true;
      };
    }

    if (!platformShellEvidenceReady) {
      if (platformShellUnavailable) setChatStatus('unavailable');
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
  }, [
    chatAccount,
    chatAccountLoaded,
    hasPlayerSeat,
    loadMatchChatEntries,
    matchID,
    platformShellEvidenceReady,
    platformShellUnavailable,
  ]);

  useEffect(() => {
    if (chatStatus !== 'ready' || !chatAccount) return;
    const latestPersisted = [...chatMessages].reverse().find((message) => message.persisted);
    if (!latestPersisted) return;
    void markChatRead({
      conversationType: 'match',
      subjectId: matchID,
      lastReadMessageId: latestPersisted.id,
    }).catch(() => undefined);
  }, [chatAccount, chatMessages, chatStatus, matchID]);

  useEffect(() => {
    if (!chatAccountLoaded) return;
    let cancelled = false;
    setPlatformShellEvidenceReady(false);
    setPlatformShellUnavailable(false);

    const controller = connectPlatformMatchShellWithRetry(
      {
        boardgameMatchID: matchID,
        userId: localPlatformUserId,
        displayName: chatDisplayName,
        role: spectator ? 'spectator' : 'player',
        boardgamePlayerID: spectator ? undefined : playerID,
        hasBoardgameCredentials: !spectator && Boolean(playerCredentials),
        platformSeatToken: spectator ? undefined : platformSeatToken,
      },
      {
        onStateChange: (state) => {
          if (!cancelled) setPlatformShellConnectionState(state);
        },
        onRoomChange: (nextRoom) => {
          if (!cancelled) platformRoomRef.current = nextRoom;
        },
        onPresence: () => {
          if (!cancelled) {
            setPlatformShellEvidenceReady(true);
            setPlatformShellUnavailable(false);
          }
        },
        onChatPreview: () => {
          if (cancelled) return;
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
          if (!cancelled) {
            setPlatformShellEvidenceReady(false);
          }
        },
        onError: (err) => {
          Sentry.addBreadcrumb({
            category: 'platform',
            message: 'match shell unavailable; retry scheduled',
            level: 'warning',
            data: { match_id: matchID, error: err instanceof Error ? err.message : String(err) },
          });
          if (!cancelled) {
            setPlatformShellUnavailable(true);
          }
        },
      },
    );

    return () => {
      cancelled = true;
      platformRoomRef.current = null;
      setPlatformShellConnectionState('stopped');
      setPlatformShellEvidenceReady(false);
      setPlatformShellUnavailable(false);
      void controller.stop();
    };
  }, [
    chatAccount,
    chatAccountLoaded,
    chatDisplayName,
    loadMatchChatEntries,
    localPlatformUserId,
    matchID,
    playerCredentials,
    platformSeatToken,
    platformUserId,
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

  const rebuildOnlineClient = useCallback(() => {
    pendingMoveRef.current = null;
    if (moveAckTimer.current) clearTimeout(moveAckTimer.current);
    moveAckTimer.current = null;
    if (statusTimer.current) clearTimeout(statusTimer.current);
    if (resyncTimer.current) clearTimeout(resyncTimer.current);
    setConnectionStatus('reconnecting');
    setResyncingState(true);
    setClientSyncNonce((nonce) => nonce + 1);
    resyncTimer.current = setTimeout(() => setResyncingState(false), 5000);
  }, []);

  const handleStateMismatch = useCallback(
    (reason: OnlineStateMismatchReason) => {
      console.warn(`[online-sync] detected ${reason}; rebuilding client to resync authoritative state`);
      Sentry.captureException(new Error(`Online state mismatch: ${reason}`), {
        tags: { layer: 'online-sync', reason, match_id: matchID },
      });
      rebuildOnlineClient();
    },
    [matchID, rebuildOnlineClient],
  );

  const handleStateObserved = useCallback((stateID: number) => {
    latestStateIDRef.current = stateID;
    const pending = pendingMoveRef.current;
    if (!pending || !didOnlineStateAdvance(pending.stateID, stateID)) return;
    pendingMoveRef.current = null;
    if (moveAckTimer.current) clearTimeout(moveAckTimer.current);
    moveAckTimer.current = null;
  }, []);

  const handleMoveSubmitted = useCallback(
    (moveName: string, stateID: number | undefined) => {
      if (!shouldTrackOnlineMove(moveName) || typeof stateID !== 'number') return;
      pendingMoveRef.current = { moveName, stateID };
      if (moveAckTimer.current) clearTimeout(moveAckTimer.current);
      moveAckTimer.current = setTimeout(() => {
        const pending = pendingMoveRef.current;
        if (!pending || didOnlineStateAdvance(pending.stateID, latestStateIDRef.current)) return;
        pendingMoveRef.current = null;
        Sentry.captureException(new Error(`Online move acknowledgement timed out: ${pending.moveName}`), {
          tags: { layer: 'online-sync', reason: 'move-ack-timeout', move: pending.moveName, match_id: matchID },
          extra: { submittedStateID: pending.stateID, observedStateID: latestStateIDRef.current },
        });
        rebuildOnlineClient();
      }, ONLINE_MOVE_ACK_TIMEOUT_MS);
    },
    [matchID, rebuildOnlineClient],
  );

  const handleChatSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const content = chatDraft.trim();
      if (!canSubmitMatchChat({ account: chatAccount, hasPlayerSeat, content, status: chatStatus })) return;
      const authorRole = matchChatAuthorRole(chatAccount, spectator, hasPlayerSeat);
      if (!authorRole) {
        setChatStatus('login_required');
        return;
      }

      setChatStatus('sending');
      try {
        const result = await sendChatMessage(
          {
            conversationType: 'match',
            subjectId: matchID,
            content,
            authorDisplayName: chatDisplayName,
            authorRole,
            clientMessageId: `client:${Date.now()}:${Math.random().toString(36).slice(2)}`,
          },
          matchAccess,
        );
        if (canShowChatMessage(result.message)) {
          appendChatEntry(mapChatMessage(result.message, chatUserId, chatDisplayName));
        }
        setChatDraft('');
        if (canShowChatMessage(result.message)) {
          platformRoomRef.current?.send('chatPreview', {
            conversationId: result.conversation.id,
            messageId: result.message.id,
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
    [
      appendChatEntry,
      chatAccount,
      chatDisplayName,
      chatDraft,
      chatStatus,
      chatUserId,
      hasPlayerSeat,
      matchAccess,
      matchID,
      spectator,
    ],
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
        const result = await requestChatTranslation(message.id, targetLanguage, matchAccess);
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
    [applyChatTranslation, locale, matchAccess, matchID],
  );

  const onlineBoardRuntimeRef = useRef({
    spectator,
    handleConnectionStatusChange,
    handleOpponentDetected,
    handleStateMismatch,
    handleMoveSubmitted,
    handleStateObserved,
  });
  onlineBoardRuntimeRef.current = {
    spectator,
    handleConnectionStatusChange,
    handleOpponentDetected,
    handleStateMismatch,
    handleMoveSubmitted,
    handleStateObserved,
  };

  const [OnlineClient] = useState(() =>
    Client({
      game: ZutomayoCard,
      board: (props: BoardProps<GameState>) => {
        const runtime = onlineBoardRuntimeRef.current;
        return (
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
            spectator={runtime.spectator}
            onConnectionStatusChange={runtime.handleConnectionStatusChange}
            onOpponentDetected={runtime.handleOpponentDetected}
            onStateMismatch={runtime.handleStateMismatch}
            onMoveSubmitted={runtime.handleMoveSubmitted}
            onStateObserved={runtime.handleStateObserved}
            onExitRequest={() => onLeaveRequestRef.current()}
          />
        );
      },
      loading: OnlineLoading,
      numPlayers: 2,
      multiplayer: SocketIO({ server: window.location.origin, socketOpts: onlineSocketOptions() }),
      debug: false,
    }),
  );

  const visibleConnectionStatus = resyncingState ? 'reconnecting' : connectionStatus;

  return (
    <PageShell>
      {visibleConnectionStatus && (
        <div
          className="absolute right-6 top-1.5 z-[var(--z-modal)]"
          data-online-connection-status={visibleConnectionStatus}
        >
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
      {platformShellConnectionState !== 'connected' && platformShellConnectionState !== 'stopped' && (
        <div
          className="absolute left-6 top-7 z-[var(--z-modal)]"
          aria-live="polite"
          data-platform-connection-status={platformShellConnectionState}
        >
          <span className="font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/45">
            {platformShellConnectionState === 'reconnecting' ? t('onlineSession.reconnecting') : t('chat.matchSyncing')}
          </span>
        </div>
      )}
      <div className={`online-chat-panel ${chatOpen ? 'open' : 'collapsed'}`}>
        <div className="online-chat-header">
          <IconButton
            label={chatOpen ? t('chat.matchHide') : t('chat.matchShow')}
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
                            label={t('chat.matchTranslate')}
                            icon={<Languages className="size-3" aria-hidden="true" />}
                            size="sm"
                            className="online-chat-translate-button"
                            disabled={message.translation?.status === 'loading'}
                            onClick={() => void handleChatTranslate(message)}
                          />
                        )}
                        {chatAccount && message.persisted && !message.self && (
                          <IconButton
                            label={reportedMessageIds.has(message.id) ? t('chat.matchReported') : t('chat.matchReport')}
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
                            ? t('chat.translationTranslating')
                            : message.translation.status === 'unavailable'
                              ? t('chat.translationOffline')
                              : t('chat.translationPending')}
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
                aria-label={t('chat.matchInput')}
              />
              <IconButton
                label={t('chat.matchSend')}
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
