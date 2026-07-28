import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Flag,
  Languages,
  MessageCircle,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ANONYMOUS_PLAYER_DEFAULT_NAME,
  formatAnonymousDisplayName,
  loadAnonymousIdentity,
  renameAnonymousIdentity,
  sanitizeAnonymousBaseName,
  type AnonymousIdentity,
} from '../anonymousIdentity';
import {
  fetchChatMessages,
  fetchUnreadChat,
  getProfile,
  getFriends,
  isLoggedIn,
  markChatRead,
  reportChatMessage,
  requestChatTranslation,
  sendChatMessage,
  reserveDeck,
  type ChatMessage,
  type ChatMessageTranslation,
  type DeckResponse,
  type FriendProfile,
  type ProfileResponse,
} from '../api/client';
import { copyText } from '../clipboard';
import { buildOnlineRoomUrl } from '../components/OnlineRoomInfo';
import { useToast } from '../components/ToastProvider';
import { OnlinePresenceBadge } from '../components/OnlinePresenceBadge';
import { customRoomRelayErrorKey, resolvePlatformCustomRoomMatchID } from '../platform/customRoomRelay';
import { AuthSection } from '../components/lobby/AuthSection';
import { DeckSelector } from '../components/lobby/DeckSelector';
import { RoomDetails, RoomPanel } from '../components/lobby/RoomPanel';
import {
  buildDeckOptions,
  buildServerDeckOptions,
  serverDeckIdFromOption,
  type DeckOptionGroup,
} from '../components/lobby/shared';
import { Alert, AppHeader, Button, IconButton, Input, PageShell } from '../ui';
import { useOnlinePresence } from '../hooks/useOnlinePresence';
import {
  buildPlatformFriendInviteId,
  connectPlatformQuickMatch,
  createPlatformCustomRoom,
  createPlatformInvite,
  fetchPlatformAvailableRooms,
  isPlatformBoardgameRelayAcknowledged,
  joinPlatformCustomRoom,
  joinPlatformInvite,
  type PlatformAvailableRoom,
  type PlatformCustomRoom,
  type PlatformInviteSnapshot,
  type PlatformInviteRoom,
  type PlatformQuickMatchRoom,
} from '../platformClient';
import { Sentry } from '../sentry';
import { t, translate, useLocale } from '../i18n';
import type { OnlineSession } from '../onlineSession';
import { isOnlineRoomErrorKey } from '../onlineRoomStatus';
import { formatQuickMatchWait, quickMatchWaitSeconds, shouldOfferQuickMatchFallback } from '../matchmakingWait';
import { trackFunnelEvent } from '../funnelAnalytics';
import { QUICK_MATCH_ENABLED } from '../featureFlags';

interface OnlineLobbyPageProps {
  deck0Name: string;
  customDeckAvailable: boolean;
  serverDecks: DeckResponse[];
  setDeck0Name: (deckName: string) => void;
  onStartOnline: (
    matchID?: string,
    playerName?: string,
    options?: {
      navigate?: boolean;
      playerDeckName?: string;
      opponentDeckName?: string;
      playerDeckReservationId?: string;
    },
  ) => Promise<OnlineSession>;
  onCancelOnlineSession: (session: OnlineSession) => void | Promise<void>;
  onAuthChanged: () => void | Promise<void>;
  serverDeckError?: string;
  cardsReady: boolean;
  cardsLoadError?: boolean;
  onRetryCards?: () => void | Promise<void>;
}

type MatchmakingPhase =
  | 'idle'
  | 'platform-waiting'
  | 'host-starting'
  | 'host-waiting-relay'
  | 'guest-waiting-match'
  | 'guest-joining'
  | 'done';
type DirectChatStatus = 'idle' | 'loading' | 'ready' | 'sending' | 'unavailable';
type DirectChatTranslationState = {
  status: ChatMessageTranslation['status'] | 'loading' | 'unavailable';
  targetLanguage: string;
  content?: string;
};
type LobbyChatEntry = ChatMessage & { translation?: DirectChatTranslationState };
type RoomChatEntry = LobbyChatEntry;
const ANONYMOUS_NAME_PROMPT_STORAGE_KEY = 'zutomayo_anonymous_name_prompt_seen';
const ROOM_LIST_REFRESH_MS = 8_000;

function resolveDeckLabel(deckId: string, groups: DeckOptionGroup[]): string {
  for (const group of groups) {
    const found = group.options.find((option) => option.id === deckId);
    if (found) return found.name;
  }
  return deckId;
}

function onlineErrorMessage(error: unknown): string {
  const customRoomRelayKey = customRoomRelayErrorKey(error);
  if (customRoomRelayKey) return t(customRoomRelayKey);
  if (error instanceof Error && isOnlineRoomErrorKey(error.message)) return t(error.message);
  return t('online.connectionFailed');
}

function canShowChatMessage(message: ChatMessage): boolean {
  return message.moderationStatus === 'visible' || message.moderationStatus === 'pending_review';
}

function mergeRoomChatEntries(current: RoomChatEntry[], incoming: RoomChatEntry[]): RoomChatEntry[] {
  const translations = new Map(current.map((message) => [message.id, message.translation]));
  const merged = incoming.map((message) => ({ ...message, translation: translations.get(message.id) }));
  const unchanged =
    current.length === merged.length &&
    current.every((message, index) => {
      const next = merged[index];
      return (
        next?.id === message.id &&
        next.content === message.content &&
        next.authorDisplayName === message.authorDisplayName &&
        next.moderationStatus === message.moderationStatus &&
        next.editedAt === message.editedAt &&
        next.deletedAt === message.deletedAt &&
        next.translation === message.translation
      );
    });
  return unchanged ? current : merged;
}

export function OnlineLobbyPage({
  deck0Name,
  customDeckAvailable,
  serverDecks,
  setDeck0Name,
  onStartOnline,
  onCancelOnlineSession,
  onAuthChanged,
  serverDeckError,
  cardsReady,
  cardsLoadError,
  onRetryCards,
}: OnlineLobbyPageProps) {
  const { showToast } = useToast();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { onlineCount } = useOnlinePresence();
  const deckOptions = useMemo<DeckOptionGroup[]>(() => {
    const localOptions = buildDeckOptions(customDeckAvailable);
    const serverOptions = buildServerDeckOptions(serverDecks);
    return [
      { label: translate(locale, 'deck.localDecks'), options: localOptions },
      ...(serverOptions.length > 0 ? [{ label: translate(locale, 'deck.serverDecks'), options: serverOptions }] : []),
    ];
  }, [customDeckAvailable, locale, serverDecks]);

  // 帳號資料：用於 Header 與段位顯示。
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [friendStatus, setFriendStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [friendInviteActionId, setFriendInviteActionId] = useState<string | null>(null);
  const [friendInvitePeerId, setFriendInvitePeerId] = useState<string | null>(null);
  const [friendInviteMode, setFriendInviteMode] = useState<'incoming' | 'outgoing' | null>(null);
  const platformInviteRoomRef = useRef<PlatformInviteRoom | null>(null);
  const activeOutgoingInviteIdRef = useRef<string | null>(null);
  const pendingInviteHostSessionRef = useRef<{
    inviteId: string;
    friendUserId: string;
    session: OnlineSession;
  } | null>(null);
  const [roomChatSubjectOverride, setRoomChatSubjectOverride] = useState('');
  const [roomChatMessages, setRoomChatMessages] = useState<RoomChatEntry[]>([]);
  const [roomChatDraft, setRoomChatDraft] = useState('');
  const [roomChatStatus, setRoomChatStatus] = useState<DirectChatStatus>('idle');
  const [roomChatOpen, setRoomChatOpen] = useState(true);
  const [roomChatUnreadCount, setRoomChatUnreadCount] = useState(0);
  const [pageVisible, setPageVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  const [reportedRoomMessageIds, setReportedRoomMessageIds] = useState<Set<string>>(() => new Set());
  const quickMatchPanelRef = useRef<HTMLDivElement | null>(null);
  const customRoomPanelRef = useRef<HTMLDivElement | null>(null);
  const platformCustomRoomRef = useRef<PlatformCustomRoom | null>(null);
  const pendingCustomRoomSessionRef = useRef<OnlineSession | null>(null);
  const customRoomDisposedRef = useRef(false);
  const roomChatMessagesRef = useRef<HTMLDivElement | null>(null);
  const roomChatShouldStickToBottomRef = useRef(true);
  const [anonymousIdentity, setAnonymousIdentity] = useState<AnonymousIdentity>(() => loadAnonymousIdentity());
  const [editingAnonymousName, setEditingAnonymousName] = useState(false);
  const [anonymousNameDraft, setAnonymousNameDraft] = useState(() => anonymousIdentity.baseName);
  const [showAnonymousNamePrompt, setShowAnonymousNamePrompt] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);
  const refreshProfile = useCallback(async () => {
    if (!isLoggedIn()) {
      setProfile(null);
      setFriends([]);
      setFriendStatus('idle');
      setRoomChatMessages([]);
      setRoomChatStatus('idle');
      setFriendInviteActionId(null);
      setFriendInvitePeerId(null);
      setFriendInviteMode(null);
      activeOutgoingInviteIdRef.current = null;
      pendingInviteHostSessionRef.current = null;
      void platformInviteRoomRef.current?.leave(true).catch(() => undefined);
      platformInviteRoomRef.current = null;
      return;
    }
    try {
      setProfile(await getProfile());
    } catch {
      setProfile(null);
      setFriends([]);
      setFriendStatus('idle');
      setRoomChatMessages([]);
      setRoomChatStatus('idle');
      setFriendInviteActionId(null);
      setFriendInvitePeerId(null);
      setFriendInviteMode(null);
      activeOutgoingInviteIdRef.current = null;
      pendingInviteHostSessionRef.current = null;
      void platformInviteRoomRef.current?.leave(true).catch(() => undefined);
      platformInviteRoomRef.current = null;
    }
  }, []);

  const refreshFriends = useCallback(async () => {
    if (!isLoggedIn()) {
      setFriends([]);
      setFriendStatus('idle');
      return;
    }
    setFriendStatus('loading');
    try {
      const nextFriends = await getFriends();
      setFriends(nextFriends);
      setFriendStatus('ready');
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'friends',
        message: 'friend list unavailable',
        level: 'warning',
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      setFriends([]);
      setFriendStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshProfile().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [refreshProfile]);

  useEffect(() => {
    if (!profile) return;
    void refreshFriends();
  }, [profile, refreshFriends]);

  const handleAuthChanged = useCallback(async () => {
    await onAuthChanged();
    await refreshProfile();
    await refreshFriends();
    setError('');
  }, [onAuthChanged, refreshFriends, refreshProfile]);

  const applyRoomChatTranslation = useCallback((messageId: string, translation: DirectChatTranslationState) => {
    setRoomChatMessages((messages) =>
      messages.map((message) => (message.id === messageId ? { ...message, translation } : message)),
    );
  }, []);

  const anonymousDisplayName = formatAnonymousDisplayName(anonymousIdentity);
  const effectivePlayerName = profile?.nickname || anonymousDisplayName;
  const shouldPromptForAnonymousName =
    !profile &&
    anonymousIdentity.baseName === ANONYMOUS_PLAYER_DEFAULT_NAME &&
    sessionStorage.getItem(ANONYMOUS_NAME_PROMPT_STORAGE_KEY) !== 'true';

  const startEditingAnonymousName = () => {
    setAnonymousNameDraft(anonymousIdentity.baseName);
    setEditingAnonymousName(true);
    setShowAnonymousNamePrompt(false);
  };

  const saveAnonymousName = () => {
    const nextIdentity = renameAnonymousIdentity(anonymousNameDraft);
    setAnonymousIdentity(nextIdentity);
    setAnonymousNameDraft(nextIdentity.baseName);
    setEditingAnonymousName(false);
    setShowAnonymousNamePrompt(false);
    sessionStorage.setItem(ANONYMOUS_NAME_PROMPT_STORAGE_KEY, 'true');
  };

  const cancelAnonymousNameEdit = () => {
    setAnonymousNameDraft(anonymousIdentity.baseName);
    setEditingAnonymousName(false);
  };

  const requestAnonymousNameBeforeStart = () => {
    if (!shouldPromptForAnonymousName) return false;
    setShowAnonymousNamePrompt(true);
    setEditingAnonymousName(true);
    setAnonymousNameDraft(anonymousIdentity.baseName);
    sessionStorage.setItem(ANONYMOUS_NAME_PROMPT_STORAGE_KEY, 'true');
    return true;
  };

  // 牌組選擇後 Toast 提示（首次選擇時顯示）
  const handleDeckChange = (newDeck: string) => {
    const isFirstSelection = !deck0Name && newDeck;
    setDeck0Name(newDeck);
    if (window.matchMedia('(max-width: 1023px)').matches) {
      window.requestAnimationFrame(() => {
        const nextPanel = QUICK_MATCH_ENABLED ? quickMatchPanelRef.current : customRoomPanelRef.current;
        nextPanel?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'start',
        });
      });
    }

    if (isFirstSelection) {
      const hasShownToast = sessionStorage.getItem('zutomayo_deck_selected_toast');
      if (!hasShownToast) {
        showToast({
          title: t('deck.selectionSuccess'),
          body: t('deck.readyToStart'),
          kind: 'success',
          durationMs: 3000,
        });
        sessionStorage.setItem('zutomayo_deck_selected_toast', 'true');
      }
    }
  };

  // Matchmaking 狀態（原 OnlinePanel 邏輯移入，以便拆分到左右兩欄）。
  const [matchID, setMatchID] = useState('');
  const [createdMatchID, setCreatedMatchID] = useState('');
  const [error, setError] = useState('');
  const [matchmakingActive, setMatchmakingActive] = useState(false);
  const [matchmakingCancellable, setMatchmakingCancellable] = useState(false);
  const [matchmakingElapsedSeconds, setMatchmakingElapsedSeconds] = useState(0);
  const [longWaitDismissed, setLongWaitDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<PlatformAvailableRoom[]>([]);
  const [roomListStatus, setRoomListStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [customRoomStarting, setCustomRoomStarting] = useState(false);
  const [customRoomCancelling, setCustomRoomCancelling] = useState(false);
  const roomListRequestRef = useRef<Promise<void> | null>(null);
  const platformQuickMatchRoomRef = useRef<PlatformQuickMatchRoom | null>(null);
  const phaseRef = useRef<MatchmakingPhase>('idle');
  const cancelRef = useRef(false);
  const matchmakingStartedAtRef = useRef<number | null>(null);
  const matchmakingCheckpointTrackedRef = useRef(false);
  const pendingQuickMatchSessionRef = useRef<OnlineSession | null>(null);

  const refreshAvailableRooms = useCallback((showLoading = false): Promise<void> => {
    if (roomListRequestRef.current) return roomListRequestRef.current;
    if (showLoading) setRoomListStatus('loading');
    const request = fetchPlatformAvailableRooms()
      .then((rooms) => {
        setAvailableRooms(rooms);
        setRoomListStatus('ready');
      })
      .catch((err) => {
        setRoomListStatus('unavailable');
        Sentry.addBreadcrumb({
          category: 'platform',
          message: 'public custom room list unavailable',
          level: 'warning',
          data: { error: err instanceof Error ? err.message : String(err) },
        });
      })
      .finally(() => {
        if (roomListRequestRef.current === request) roomListRequestRef.current = null;
      });
    roomListRequestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    void refreshAvailableRooms(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAvailableRooms();
    }, ROOM_LIST_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refreshAvailableRooms]);

  useEffect(() => {
    const roomCode = new URLSearchParams(location.search).get('room')?.trim();
    if (!roomCode) return;
    setCreatedMatchID('');
    setRoomChatSubjectOverride('');
    setMatchID(roomCode);
    window.requestAnimationFrame(() => {
      customRoomPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [location.search]);

  const resetMatchmaking = useCallback(() => {
    phaseRef.current = 'idle';
    matchmakingStartedAtRef.current = null;
    pendingQuickMatchSessionRef.current = null;
    setMatchmakingActive(false);
    setMatchmakingCancellable(false);
    setMatchmakingElapsedSeconds(0);
    setLongWaitDismissed(false);
    matchmakingCheckpointTrackedRef.current = false;
  }, []);

  useEffect(() => {
    if (!matchmakingActive || !matchmakingCancellable || matchmakingStartedAtRef.current === null) return;
    const updateElapsed = () => {
      if (matchmakingStartedAtRef.current === null) return;
      setMatchmakingElapsedSeconds(quickMatchWaitSeconds(matchmakingStartedAtRef.current, Date.now()));
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(interval);
  }, [matchmakingActive, matchmakingCancellable]);

  useEffect(() => {
    if (!matchmakingActive || matchmakingCheckpointTrackedRef.current || matchmakingElapsedSeconds < 45) return;
    matchmakingCheckpointTrackedRef.current = true;
    trackFunnelEvent('F_Queue_Checkpoint', {
      match_mode: 'quick_match',
      queue_duration_s: matchmakingElapsedSeconds,
    });
  }, [matchmakingActive, matchmakingElapsedSeconds]);

  const cancelPendingCustomRoomSession = useCallback(
    async (session: OnlineSession | null = pendingCustomRoomSessionRef.current) => {
      if (!session) return;
      if (pendingCustomRoomSessionRef.current?.matchID === session.matchID) {
        pendingCustomRoomSessionRef.current = null;
      }
      await onCancelOnlineSession(session);
    },
    [onCancelOnlineSession],
  );

  useEffect(() => {
    customRoomDisposedRef.current = false;
    return () => {
      customRoomDisposedRef.current = true;
      cancelRef.current = true;
      void platformQuickMatchRoomRef.current?.leave(true).catch(() => {});
      platformQuickMatchRoomRef.current = null;
      void platformCustomRoomRef.current?.leave(true).catch(() => undefined);
      platformCustomRoomRef.current = null;
      void cancelPendingCustomRoomSession();
    };
  }, [cancelPendingCustomRoomSession]);

  useEffect(() => {
    setCopied(false);
  }, [createdMatchID]);

  useEffect(() => {
    if (createdMatchID) setRoomChatSubjectOverride('');
  }, [createdMatchID]);

  const roomChatSubjectId = roomChatSubjectOverride || createdMatchID || (matchID.length >= 3 ? matchID : '');
  const latestRoomChatMessageId = roomChatMessages.at(-1)?.id;

  useEffect(() => {
    setRoomChatOpen(true);
    setRoomChatUnreadCount(0);
  }, [roomChatSubjectId]);

  const loadRoomChatMessages = useCallback(async (): Promise<RoomChatEntry[]> => {
    if (!profile || !roomChatSubjectId) return [];
    const messages = await fetchChatMessages({
      conversationType: 'room',
      subjectId: roomChatSubjectId,
      limit: 50,
    });
    return messages.filter(canShowChatMessage);
  }, [profile, roomChatSubjectId]);

  useEffect(() => {
    if (!profile || !roomChatSubjectId) {
      setRoomChatMessages([]);
      setRoomChatStatus('idle');
      return;
    }
    let cancelled = false;
    roomChatShouldStickToBottomRef.current = true;
    setRoomChatStatus('loading');
    setReportedRoomMessageIds(new Set());
    void loadRoomChatMessages().then(
      (messages) => {
        if (cancelled) return;
        const visibleMessages = messages.filter(canShowChatMessage);
        setRoomChatMessages(visibleMessages);
        setRoomChatStatus('ready');
      },
      (err) => {
        if (cancelled) return;
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'custom room chat history unavailable',
          level: 'warning',
          data: { room_code: roomChatSubjectId, error: err instanceof Error ? err.message : String(err) },
        });
        setRoomChatStatus('unavailable');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loadRoomChatMessages, profile, roomChatSubjectId]);

  useEffect(() => {
    if (
      !profile ||
      !roomChatSubjectId ||
      roomChatStatus !== 'ready' ||
      !latestRoomChatMessageId ||
      !roomChatOpen ||
      !pageVisible
    )
      return;
    void markChatRead({
      conversationType: 'room',
      subjectId: roomChatSubjectId,
      lastReadMessageId: latestRoomChatMessageId,
    })
      .then(() => setRoomChatUnreadCount(0))
      .catch(() => undefined);
  }, [latestRoomChatMessageId, pageVisible, profile, roomChatOpen, roomChatStatus, roomChatSubjectId]);

  useEffect(() => {
    if (!profile || !roomChatSubjectId || roomChatOpen || !pageVisible) return;
    let cancelled = false;
    const syncUnread = () => {
      void fetchUnreadChat(50).then(
        (conversations) => {
          if (cancelled) return;
          const conversation = conversations.find(
            (entry) => entry.type === 'room' && entry.subjectId === roomChatSubjectId,
          );
          setRoomChatUnreadCount(conversation?.unreadCount ?? 0);
        },
        () => undefined,
      );
    };
    syncUnread();
    const interval = window.setInterval(syncUnread, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pageVisible, profile, roomChatOpen, roomChatSubjectId]);

  useEffect(() => {
    if (!profile || !roomChatSubjectId || roomChatStatus !== 'ready') return;
    let cancelled = false;
    const sync = () => {
      void loadRoomChatMessages().then(
        (messages) => {
          if (!cancelled) setRoomChatMessages((current) => mergeRoomChatEntries(current, messages));
        },
        () => undefined,
      );
    };
    const interval = window.setInterval(sync, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [loadRoomChatMessages, profile, roomChatStatus, roomChatSubjectId]);

  useEffect(() => {
    const element = roomChatMessagesRef.current;
    if (!element || !roomChatShouldStickToBottomRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [roomChatMessages]);

  const resolvePlatformCustomRoom = useCallback(
    async (roomCode: string): Promise<string> =>
      resolvePlatformCustomRoomMatchID({
        roomCode,
        userId: profile?.id || `anon:${anonymousIdentity.suffix}`,
        displayName: effectivePlayerName,
        joinPlatformCustomRoom,
      }),
    [anonymousIdentity.suffix, effectivePlayerName, profile?.id],
  );

  const leavePlatformCustomRoom = () => {
    void platformCustomRoomRef.current?.leave(true).catch(() => undefined);
    platformCustomRoomRef.current = null;
  };

  const runOnline = async (id?: string) => {
    if (createdMatchID || customRoomStarting || customRoomCancelling) return;
    if (!canStart) {
      setError(startDisabledReason);
      return;
    }
    if (requestAnonymousNameBeforeStart()) return;
    setError('');
    setCustomRoomStarting(true);
    try {
      if (id) {
        leavePlatformCustomRoom();
        setCreatedMatchID('');
        const targetMatchID = await resolvePlatformCustomRoom(id);
        await onStartOnline(targetMatchID, effectivePlayerName);
        return;
      }

      leavePlatformCustomRoom();
      const nextSession = await onStartOnline(undefined, effectivePlayerName, { navigate: false });
      pendingCustomRoomSessionRef.current = nextSession;
      if (customRoomDisposedRef.current) {
        if (pendingCustomRoomSessionRef.current?.matchID === nextSession.matchID) {
          await cancelPendingCustomRoomSession(nextSession);
        }
        return;
      }
      const room = await createPlatformCustomRoom(
        {
          roomCode: nextSession.matchID,
          boardgameMatchID: nextSession.matchID,
          userId: nextSession.platformUserId || profile?.id || `anon:${anonymousIdentity.suffix}`,
          displayName: nextSession.platformDisplayName || effectivePlayerName,
        },
        {
          onCancelled: () => {
            if (platformCustomRoomRef.current === room) {
              platformCustomRoomRef.current = null;
              setCreatedMatchID('');
              void cancelPendingCustomRoomSession(nextSession);
            }
          },
          onDisconnect: () => {
            if (platformCustomRoomRef.current === room) {
              platformCustomRoomRef.current = null;
              setCreatedMatchID('');
              void cancelPendingCustomRoomSession(nextSession);
            }
          },
          onBoardgameMatchReady: (message) => {
            if (!isPlatformBoardgameRelayAcknowledged(nextSession.matchID, message)) return;
            if (platformCustomRoomRef.current === room) {
              platformCustomRoomRef.current = null;
            }
            pendingCustomRoomSessionRef.current = null;
            setCreatedMatchID('');
            void room.leave(true).catch(() => undefined);
            navigateToOnlineSession(nextSession);
          },
        },
      );
      if (customRoomDisposedRef.current) {
        try {
          room.send('cancelCustomRoom', {});
        } catch {
          // The room can disconnect while the page is being removed.
        }
        await Promise.allSettled([
          room.leave(true),
          pendingCustomRoomSessionRef.current?.matchID === nextSession.matchID
            ? cancelPendingCustomRoomSession(nextSession)
            : Promise.resolve(),
        ]);
        return;
      }
      platformCustomRoomRef.current = room;
      setCreatedMatchID(nextSession.matchID);
    } catch (err) {
      await cancelPendingCustomRoomSession();
      if (customRoomDisposedRef.current) return;
      Sentry.captureException(err, { tags: { action: 'start-online' } });
      setError(onlineErrorMessage(err));
    } finally {
      setCustomRoomStarting(false);
    }
  };

  const handleQuickMatch = async () => {
    if (createdMatchID || customRoomStarting || customRoomCancelling) return;
    if (!isLoggedIn()) {
      setError(t('lobby.loginRequired'));
      return;
    }
    if (requestAnonymousNameBeforeStart()) return;
    setError('');
    setMatchmakingActive(true);
    setMatchmakingCancellable(true);
    matchmakingStartedAtRef.current = Date.now();
    matchmakingCheckpointTrackedRef.current = false;
    setMatchmakingElapsedSeconds(0);
    setLongWaitDismissed(false);
    cancelRef.current = false;
    phaseRef.current = 'platform-waiting';
    trackFunnelEvent('F_Queue_Start', { match_mode: 'quick_match' });

    try {
      const serverDeckId = serverDeckIdFromOption(deck0Name);
      const deckReservation = serverDeckId ? await reserveDeck(serverDeckId) : undefined;
      const room = await connectPlatformQuickMatch(
        {
          userId: profile?.id || `anon:${anonymousIdentity.suffix}`,
          displayName: effectivePlayerName,
          deckName: deck0Name,
          deckReservationId: deckReservation?.reservationId,
        },
        {
          onMatched: (match) => {
            if (cancelRef.current || phaseRef.current !== 'platform-waiting') return;
            setMatchmakingCancellable(false);
            if (match.role === 'host') {
              phaseRef.current = 'host-starting';
              void onStartOnline(undefined, effectivePlayerName, {
                navigate: false,
                playerDeckName: match.deckName ?? deck0Name,
                playerDeckReservationId: match.deckReservationId,
              })
                .then((session) => {
                  if (cancelRef.current || phaseRef.current !== 'host-starting') return;
                  pendingQuickMatchSessionRef.current = session;
                  phaseRef.current = 'host-waiting-relay';
                  const room = platformQuickMatchRoomRef.current;
                  room?.send('boardgameMatchReady', {
                    boardgameMatchID: session.matchID,
                  });
                })
                .catch((err) => {
                  pendingQuickMatchSessionRef.current = null;
                  phaseRef.current = 'idle';
                  setMatchmakingActive(false);
                  Sentry.captureException(err, { tags: { action: 'platform-matchmaking-host-start' } });
                  setError(onlineErrorMessage(err));
                  void platformQuickMatchRoomRef.current?.leave(true).catch(() => {});
                  platformQuickMatchRoomRef.current = null;
                });
              return;
            }
            phaseRef.current = 'guest-waiting-match';
          },
          onBoardgameMatchReady: (message) => {
            if (cancelRef.current || phaseRef.current === 'done' || phaseRef.current === 'host-starting') return;
            if (phaseRef.current === 'host-waiting-relay') {
              const session = pendingQuickMatchSessionRef.current;
              if (!session || !isPlatformBoardgameRelayAcknowledged(session.matchID, message)) return;
              pendingQuickMatchSessionRef.current = null;
              phaseRef.current = 'done';
              trackFunnelEvent('F_Queue_Match', {
                match_mode: 'quick_match',
                queue_duration_s: matchmakingStartedAtRef.current
                  ? quickMatchWaitSeconds(matchmakingStartedAtRef.current, Date.now())
                  : 0,
              });
              void platformQuickMatchRoomRef.current?.leave(true).catch(() => undefined);
              platformQuickMatchRoomRef.current = null;
              navigateToOnlineSession(session);
              return;
            }
            if (phaseRef.current !== 'guest-waiting-match') return;
            phaseRef.current = 'guest-joining';
            void onStartOnline(message.boardgameMatchID, effectivePlayerName, {
              navigate: false,
              playerDeckReservationId: deckReservation?.reservationId,
            })
              .then((session) => {
                phaseRef.current = 'done';
                trackFunnelEvent('F_Queue_Match', {
                  match_mode: 'quick_match',
                  queue_duration_s: matchmakingStartedAtRef.current
                    ? quickMatchWaitSeconds(matchmakingStartedAtRef.current, Date.now())
                    : 0,
                });
                navigateToOnlineSession(session);
              })
              .catch((err) => {
                phaseRef.current = 'idle';
                setMatchmakingActive(false);
                Sentry.captureException(err, { tags: { action: 'platform-matchmaking-guest-join' } });
                setError(onlineErrorMessage(err));
                void platformQuickMatchRoomRef.current?.leave(true).catch(() => {});
                platformQuickMatchRoomRef.current = null;
              });
          },
          onCancelled: () => {
            if (cancelRef.current || phaseRef.current === 'done') return;
            platformQuickMatchRoomRef.current = null;
            resetMatchmaking();
            setError(t('lobby.matchmakingTimeout'));
          },
          onDisconnect: () => {
            platformQuickMatchRoomRef.current = null;
            if (
              cancelRef.current ||
              (phaseRef.current !== 'platform-waiting' &&
                phaseRef.current !== 'host-starting' &&
                phaseRef.current !== 'host-waiting-relay' &&
                phaseRef.current !== 'guest-waiting-match')
            ) {
              return;
            }
            resetMatchmaking();
            setError(t('lobby.matchmakingFailed'));
            showToast({
              title: t('error.matchmakingFailed'),
              body: t('error.checkConnection'),
              kind: 'error',
              durationMs: 6000,
              actionLabel: t('common.retry'),
              onAction: handleQuickMatch,
            });
          },
        },
      );
      if (cancelRef.current) {
        void room.leave(true).catch(() => undefined);
        return;
      }
      platformQuickMatchRoomRef.current = room;
      const pendingSession = pendingQuickMatchSessionRef.current;
      if ((phaseRef.current as MatchmakingPhase) === 'host-waiting-relay' && pendingSession) {
        room.send('boardgameMatchReady', { boardgameMatchID: pendingSession.matchID });
      }
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'platform',
        message: 'platform quick match unavailable',
        level: 'warning',
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      resetMatchmaking();
      setError(t('lobby.matchmakingFailed'));
      showToast({
        title: t('error.matchmakingFailed'),
        body: t('error.checkConnection'),
        kind: 'error',
        durationMs: 6000,
        actionLabel: t('common.retry'),
        onAction: handleQuickMatch,
      });
    }
  };

  const cancelMatchmaking = (reason: 'player' | 'fallback_custom_room' | 'fallback_friend_invite') => {
    if (phaseRef.current !== 'platform-waiting') return;
    trackFunnelEvent('F_Queue_Cancel', {
      match_mode: 'quick_match',
      reason,
      queue_duration_s: matchmakingStartedAtRef.current
        ? quickMatchWaitSeconds(matchmakingStartedAtRef.current, Date.now())
        : 0,
    });
    cancelRef.current = true;
    pendingQuickMatchSessionRef.current = null;
    setMatchmakingCancellable(false);
    platformQuickMatchRoomRef.current?.send('cancelQuickMatch', {});
    void platformQuickMatchRoomRef.current?.leave(true).catch(() => {});
    platformQuickMatchRoomRef.current = null;
    resetMatchmaking();
  };

  const handleCancelMatchmaking = () => cancelMatchmaking('player');

  const handleContinueWaiting = () => {
    setLongWaitDismissed(true);
  };

  const handleUseCustomRoom = () => {
    cancelMatchmaking('fallback_custom_room');
    window.requestAnimationFrame(() => void runOnline());
  };

  const handleUseFriendInvite = () => {
    cancelMatchmaking('fallback_friend_invite');
    window.requestAnimationFrame(() => {
      document.querySelector('[data-friend-invites]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleCopyShareLink = async () => {
    if (!createdMatchID) return;
    await copyText(buildOnlineRoomUrl(createdMatchID));
    setCopied(true);
    showToast({
      title: t('online.copied'),
      body: t('online.copySuccessHelp'),
      kind: 'success',
    });
  };

  const handleCancelCustomRoom = async () => {
    if (!createdMatchID || customRoomCancelling) return;
    setCustomRoomCancelling(true);
    setError('');
    const room = platformCustomRoomRef.current;
    const session = pendingCustomRoomSessionRef.current;
    platformCustomRoomRef.current = null;
    pendingCustomRoomSessionRef.current = null;
    setCreatedMatchID('');
    setRoomChatSubjectOverride('');
    try {
      room?.send('cancelCustomRoom', {});
    } catch {
      // The room may already be disconnected; local/session cleanup still has to continue.
    }
    const cleanupResults = await Promise.allSettled([
      room?.leave(true) ?? Promise.resolve(),
      cancelPendingCustomRoomSession(session),
    ]);
    const cleanupError = cleanupResults.find((result) => result.status === 'rejected');
    if (cleanupError?.status === 'rejected') {
      Sentry.addBreadcrumb({
        category: 'platform',
        message: 'custom room cancellation cleanup failed',
        level: 'warning',
        data: {
          room_code: createdMatchID,
          error: cleanupError.reason instanceof Error ? cleanupError.reason.message : String(cleanupError.reason),
        },
      });
    }
    setCustomRoomCancelling(false);
  };

  const canStart = cardsReady && !!deck0Name;
  const customRoomWaiting = Boolean(createdMatchID);
  const customRoomBusy = customRoomWaiting || customRoomStarting || customRoomCancelling;
  const startDisabledReason = !cardsReady ? t('game.loading') : !deck0Name ? t('lobby.selectDeckFirst') : '';
  const canQuickMatch = canStart && !!profile;
  const quickMatchDisabledReason = !profile ? t('lobby.loginRequired') : startDisabledReason;
  const draftPreview = formatAnonymousDisplayName({
    baseName: sanitizeAnonymousBaseName(anonymousNameDraft),
    suffix: anonymousIdentity.suffix,
  });

  const leavePlatformInviteRoom = () => {
    activeOutgoingInviteIdRef.current = null;
    pendingInviteHostSessionRef.current = null;
    void platformInviteRoomRef.current?.leave(true).catch(() => undefined);
    platformInviteRoomRef.current = null;
    setFriendInviteMode(null);
  };

  const leaveObservedInviteRoom = (room: PlatformInviteRoom | null) => {
    void room?.leave(true).catch(() => undefined);
  };

  const navigateToOnlineSession = useCallback(
    (session: OnlineSession) => {
      navigate(`/play/online/${encodeURIComponent(session.matchID)}`, { state: { freshOnlineSession: true } });
    },
    [navigate],
  );

  const joinAcceptedInviteMatch = useCallback(
    (friend: FriendProfile, boardgameMatchID: string) => {
      setFriendInviteActionId(`join:${friend.userId}`);
      void onStartOnline(boardgameMatchID, effectivePlayerName, { navigate: false })
        .then((session) => {
          void platformInviteRoomRef.current?.leave(true).catch(() => undefined);
          platformInviteRoomRef.current = null;
          setFriendInviteActionId(null);
          setFriendInvitePeerId(null);
          setFriendInviteMode(null);
          navigateToOnlineSession(session);
        })
        .catch((err) => {
          Sentry.captureException(err, { tags: { action: 'platform-invite-guest-join' } });
          setError(onlineErrorMessage(err));
          setFriendInviteActionId(null);
        });
    },
    [effectivePlayerName, navigateToOnlineSession, onStartOnline],
  );

  const resumeJoinedInviteMatch = useCallback(
    (friend: FriendProfile, snapshot: PlatformInviteSnapshot) => {
      if (snapshot.boardgameMatchID && (snapshot.status === 'accepted' || snapshot.status === 'finished')) {
        joinAcceptedInviteMatch(friend, snapshot.boardgameMatchID);
        return true;
      }
      return false;
    },
    [joinAcceptedInviteMatch],
  );

  const handleInviteFriend = async (friend: FriendProfile) => {
    if (createdMatchID || customRoomStarting || customRoomCancelling) return;
    if (!profile) return;
    if (!canStart) {
      setError(startDisabledReason);
      return;
    }

    const inviteId = buildPlatformFriendInviteId(profile.id, friend.userId);
    setFriendInviteActionId(`send:${friend.userId}`);
    setError('');
    leavePlatformInviteRoom();
    activeOutgoingInviteIdRef.current = inviteId;
    let hostStartRequested = false;
    const startAcceptedInviteMatch = () => {
      if (activeOutgoingInviteIdRef.current !== inviteId || hostStartRequested) return;
      hostStartRequested = true;
      setFriendInviteActionId(`start:${friend.userId}`);
      showToast({ title: t('friend.inviteAccepted'), kind: 'success' });
      void onStartOnline(undefined, effectivePlayerName, { navigate: false })
        .then((session) => {
          if (activeOutgoingInviteIdRef.current !== inviteId) return;
          pendingInviteHostSessionRef.current = { inviteId, friendUserId: friend.userId, session };
          const room = platformInviteRoomRef.current;
          room?.send('boardgameMatchReady', {
            boardgameMatchID: session.matchID,
          });
        })
        .catch((err) => {
          hostStartRequested = false;
          pendingInviteHostSessionRef.current = null;
          Sentry.captureException(err, { tags: { action: 'platform-invite-host-start' } });
          setError(onlineErrorMessage(err));
          setFriendInviteActionId(null);
        });
    };

    try {
      const room = await createPlatformInvite(
        {
          inviteId,
          targetUserId: friend.userId,
          userId: profile.id,
          displayName: effectivePlayerName,
        },
        {
          onSnapshot: (snapshot) => {
            if (snapshot.inviteId !== inviteId || snapshot.status !== 'accepted') return;
            startAcceptedInviteMatch();
          },
          onAccepted: (message) => {
            if (message.inviteId !== inviteId) return;
            startAcceptedInviteMatch();
          },
          onBoardgameMatchReady: (message) => {
            const pending = pendingInviteHostSessionRef.current;
            if (
              !pending ||
              pending.inviteId !== inviteId ||
              pending.friendUserId !== friend.userId ||
              activeOutgoingInviteIdRef.current !== inviteId ||
              !isPlatformBoardgameRelayAcknowledged(pending.session.matchID, message)
            ) {
              return;
            }
            activeOutgoingInviteIdRef.current = null;
            pendingInviteHostSessionRef.current = null;
            void platformInviteRoomRef.current?.leave(true).catch(() => undefined);
            platformInviteRoomRef.current = null;
            setFriendInviteActionId(null);
            setFriendInvitePeerId(null);
            setFriendInviteMode(null);
            navigateToOnlineSession(pending.session);
          },
          onDeclined: () => {
            activeOutgoingInviteIdRef.current = null;
            pendingInviteHostSessionRef.current = null;
            showToast({ title: t('friend.inviteDeclined'), kind: 'error' });
            setFriendInviteActionId(null);
            setFriendInvitePeerId(null);
            leavePlatformInviteRoom();
          },
          onCancelled: () => {
            activeOutgoingInviteIdRef.current = null;
            pendingInviteHostSessionRef.current = null;
            setFriendInviteActionId(null);
            setFriendInvitePeerId(null);
            leavePlatformInviteRoom();
          },
          onDisconnect: () => {
            activeOutgoingInviteIdRef.current = null;
            pendingInviteHostSessionRef.current = null;
            setFriendInvitePeerId(null);
            setFriendInviteActionId(null);
            setFriendInviteMode(null);
          },
        },
      );
      platformInviteRoomRef.current = room;
      const pendingInviteSession = pendingInviteHostSessionRef.current;
      if (pendingInviteSession?.inviteId === inviteId && pendingInviteSession.friendUserId === friend.userId) {
        room.send('boardgameMatchReady', { boardgameMatchID: pendingInviteSession.session.matchID });
      }
      setFriendInvitePeerId(friend.userId);
      setFriendInviteMode('outgoing');
      setFriendInviteActionId(null);
      showToast({ title: t('friend.inviteSent'), kind: 'success' });
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'platform',
        message: 'friend invite create failed',
        level: 'warning',
        data: { friend_user_id: friend.userId, error: err instanceof Error ? err.message : String(err) },
      });
      setFriendInviteActionId(null);
      setFriendInvitePeerId(null);
      setFriendInviteMode(null);
      activeOutgoingInviteIdRef.current = null;
      pendingInviteHostSessionRef.current = null;
      showToast({ title: t('friend.inviteFailed'), kind: 'error' });
    }
  };

  const handleAcceptFriendInvite = async (friend: FriendProfile) => {
    if (createdMatchID || customRoomStarting || customRoomCancelling) return;
    if (!profile) return;
    const inviteId = buildPlatformFriendInviteId(friend.userId, profile.id);
    setFriendInviteActionId(`accept:${friend.userId}`);
    setError('');

    if (friendInviteMode === 'incoming' && friendInvitePeerId === friend.userId && platformInviteRoomRef.current) {
      platformInviteRoomRef.current.send('acceptInvite', {});
      showToast({ title: t('friend.inviteAccepted'), kind: 'success' });
      return;
    }

    leavePlatformInviteRoom();

    try {
      const room = await joinPlatformInvite(
        {
          inviteId,
          targetUserId: profile.id,
          userId: profile.id,
          displayName: effectivePlayerName,
        },
        {
          onSnapshot: (snapshot) => {
            resumeJoinedInviteMatch(friend, snapshot);
          },
          onAccepted: (message) => {
            if (message.boardgameMatchID) {
              joinAcceptedInviteMatch(friend, message.boardgameMatchID);
            }
          },
          onBoardgameMatchReady: (message) => {
            joinAcceptedInviteMatch(friend, message.boardgameMatchID);
          },
          onDeclined: () => {
            setFriendInviteActionId(null);
            setFriendInvitePeerId(null);
            leavePlatformInviteRoom();
          },
          onCancelled: () => {
            showToast({ title: t('friend.inviteCancelled'), kind: 'error' });
            setFriendInviteActionId(null);
            setFriendInvitePeerId(null);
            leavePlatformInviteRoom();
          },
        },
        { includeFinished: true },
      );
      platformInviteRoomRef.current = room;
      setFriendInvitePeerId(friend.userId);
      setFriendInviteMode('incoming');
      room.send('acceptInvite', {});
      showToast({ title: t('friend.inviteAccepted'), kind: 'success' });
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'platform',
        message: 'friend invite accept failed',
        level: 'warning',
        data: { friend_user_id: friend.userId, error: err instanceof Error ? err.message : String(err) },
      });
      setFriendInviteActionId(null);
      setFriendInvitePeerId(null);
      setFriendInviteMode(null);
      showToast({ title: t('friend.noInvite'), kind: 'error' });
    }
  };

  useEffect(() => {
    if (!profile || friendStatus !== 'ready' || friends.length === 0) return;
    if (friendInviteActionId || friendInvitePeerId || matchmakingActive || platformInviteRoomRef.current) return;

    let cancelled = false;

    const scanIncomingInvites = async () => {
      for (const friend of friends) {
        if (cancelled || platformInviteRoomRef.current) return;
        const inviteId = buildPlatformFriendInviteId(friend.userId, profile.id);
        let room: PlatformInviteRoom | null = null;
        const snapshot = await new Promise<{ ok: boolean }>((resolve) => {
          let settled = false;
          const settle = (ok: boolean) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve({ ok });
          };
          const timer = window.setTimeout(() => settle(false), 900);
          void joinPlatformInvite(
            {
              inviteId,
              targetUserId: profile.id,
              userId: profile.id,
              displayName: effectivePlayerName,
            },
            {
              onSnapshot: (nextSnapshot) => {
                settle(
                  nextSnapshot.status === 'pending' &&
                    nextSnapshot.targetUserId === profile.id &&
                    nextSnapshot.inviter?.userId === friend.userId,
                );
              },
              onAccepted: (message) => {
                if (message.boardgameMatchID) joinAcceptedInviteMatch(friend, message.boardgameMatchID);
              },
              onBoardgameMatchReady: (message) => {
                joinAcceptedInviteMatch(friend, message.boardgameMatchID);
              },
              onCancelled: () => {
                if (!settled) {
                  settle(false);
                  return;
                }
                setFriendInviteActionId(null);
                setFriendInvitePeerId(null);
                setFriendInviteMode(null);
                platformInviteRoomRef.current = null;
                showToast({ title: t('friend.inviteCancelled'), kind: 'error' });
              },
              onDisconnect: () => {
                if (!settled) {
                  settle(false);
                  return;
                }
                setFriendInviteActionId(null);
                setFriendInvitePeerId(null);
                setFriendInviteMode(null);
                platformInviteRoomRef.current = null;
              },
            },
          ).then(
            (nextRoom) => {
              room = nextRoom;
            },
            () => settle(false),
          );
        });

        if (cancelled) {
          leaveObservedInviteRoom(room);
          return;
        }

        if (snapshot.ok && room) {
          platformInviteRoomRef.current = room;
          setFriendInvitePeerId(friend.userId);
          setFriendInviteMode('incoming');
          setFriendInviteActionId(null);
          showToast({ title: t('friend.inviteIncoming'), kind: 'success' });
          return;
        }

        leaveObservedInviteRoom(room);
      }
    };

    void scanIncomingInvites();

    return () => {
      cancelled = true;
    };
  }, [
    effectivePlayerName,
    friendInviteActionId,
    friendInvitePeerId,
    friendStatus,
    friends,
    joinAcceptedInviteMatch,
    matchmakingActive,
    profile,
    showToast,
  ]);

  const handleRoomChatSubmit = async () => {
    if (!profile || !roomChatSubjectId || !roomChatDraft.trim() || roomChatStatus === 'sending') return;
    const content = roomChatDraft.trim();
    setRoomChatStatus('sending');
    try {
      const result = await sendChatMessage({
        conversationType: 'room',
        subjectId: roomChatSubjectId,
        content,
        title: t('chat.roomTitle'),
        authorDisplayName: profile.nickname,
        authorRole: 'player',
      });
      if (canShowChatMessage(result.message)) {
        roomChatShouldStickToBottomRef.current = true;
        setRoomChatMessages((messages) => [...messages, result.message]);
      }
      setRoomChatDraft('');
      setRoomChatStatus('ready');
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'chat',
        message: 'custom room chat send failed',
        level: 'warning',
        data: { room_code: roomChatSubjectId, error: err instanceof Error ? err.message : String(err) },
      });
      setRoomChatStatus('ready');
      showToast({ title: t('chat.sendFailed'), kind: 'error' });
    }
  };

  const handleRoomChatTranslate = useCallback(
    async (message: RoomChatEntry) => {
      if (message.translation?.status === 'loading') return;
      const targetLanguage = locale.toLowerCase();
      applyRoomChatTranslation(message.id, { status: 'loading', targetLanguage });
      try {
        const result = await requestChatTranslation(message.id, targetLanguage);
        applyRoomChatTranslation(message.id, {
          status: result.translation.status,
          targetLanguage: result.translation.targetLanguage,
          content: result.translation.translatedContent || undefined,
        });
      } catch (err) {
        applyRoomChatTranslation(message.id, { status: 'unavailable', targetLanguage });
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'custom room chat translation failed',
          level: 'warning',
          data: { message_id: message.id, error: err instanceof Error ? err.message : String(err) },
        });
      }
    },
    [applyRoomChatTranslation, locale],
  );

  const handleRoomChatReport = useCallback(
    async (message: RoomChatEntry) => {
      if (message.authorUserId === profile?.id || reportedRoomMessageIds.has(message.id)) return;
      setReportedRoomMessageIds((ids) => new Set(ids).add(message.id));
      try {
        await reportChatMessage(message.id, { reason: 'inappropriate' });
        showToast({ title: t('chat.reported'), kind: 'success' });
      } catch (err) {
        setReportedRoomMessageIds((ids) => {
          const next = new Set(ids);
          next.delete(message.id);
          return next;
        });
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'custom room chat report failed',
          level: 'warning',
          data: { message_id: message.id, error: err instanceof Error ? err.message : String(err) },
        });
        showToast({ title: t('chat.reportFailed'), kind: 'error' });
      }
    },
    [profile?.id, reportedRoomMessageIds, showToast],
  );

  return (
    <PageShell>
      <AppHeader
        title={t('lobby.onlineTitle')}
        subtitle={t('lobby.onlineLobbySubtitle')}
        backTo="/"
        leftMeta={<OnlinePresenceBadge onlineCount={onlineCount} />}
        actionsClassName="hidden sm:flex"
        actions={
          <div className="flex min-w-0 items-center gap-2 px-2 font-mono text-caption text-content-primary/50">
            <Radio className="size-3 shrink-0 text-accent-action" aria-hidden="true" />
            <span className="max-w-[14rem] truncate">{profile ? profile.nickname : anonymousDisplayName}</span>
          </div>
        }
      />

      <main className="relative z-[var(--z-dropdown)] h-full overflow-y-auto px-4 pb-8 pt-20 md:px-6 md:pt-24">
        <div className="mx-auto w-full max-w-7xl">
          {(serverDeckError || cardsLoadError) && (
            <div className="mb-4 grid gap-2">
              {serverDeckError && <Alert tone="danger">{serverDeckError}</Alert>}
              {cardsLoadError && (
                <Alert tone="danger">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>{t('game.cardsUnavailable')}</span>
                    <Button type="button" variant="secondary" onClick={() => void onRetryCards?.()}>
                      {t('common.retry')}
                    </Button>
                  </div>
                </Alert>
              )}
            </div>
          )}

          <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-[auto_auto_auto] lg:gap-5">
            <aside className="min-w-0 lg:col-start-1 lg:row-start-1">
              <RoomPanel
                mode="deck"
                className="!rounded-sm !bg-surface-elevated/35 !p-5 !ring-1 !ring-border-soft"
                aria-label={t('lobby.myDeck')}
              >
                <div className="divide-y divide-border-soft">
                  <div className="grid gap-4 pb-4">
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                            {profile ? t('lobby.rank') : t('anonymous.identity')}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-sm text-content-primary">
                            {profile ? profile.nickname : editingAnonymousName ? draftPreview : anonymousDisplayName}
                          </div>
                        </div>
                        {!profile && (
                          <IconButton
                            variant="ghost"
                            type="button"
                            onClick={startEditingAnonymousName}
                            label={t('anonymous.editName')}
                            title={t('anonymous.editName')}
                            icon={<Pencil strokeWidth={1.25} className="size-4" aria-hidden="true" />}
                          />
                        )}
                      </div>
                    </div>

                    <div className="min-w-0 rounded-sm bg-surface-canvas/45 px-3 py-3 ring-1 ring-border-soft">
                      <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                        {t('lobby.currentDeck')}
                      </div>
                      <div className="mt-0.5 truncate font-display text-lg font-bold">
                        {deck0Name ? resolveDeckLabel(deck0Name, deckOptions) : t('lobby.noDeckSelected')}
                      </div>
                    </div>

                    {!profile && editingAnonymousName && (
                      <div className="flex w-full gap-2">
                        <Input
                          className="min-h-11 min-w-0 flex-1"
                          value={anonymousNameDraft}
                          maxLength={30}
                          onChange={(event) => setAnonymousNameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') saveAnonymousName();
                            if (event.key === 'Escape') cancelAnonymousNameEdit();
                          }}
                          aria-label={t('anonymous.nameInput')}
                        />
                        <IconButton
                          variant="primary"
                          type="button"
                          onClick={saveAnonymousName}
                          label={t('common.save')}
                          icon={<Check className="size-4" aria-hidden="true" />}
                        />
                        <IconButton
                          variant="secondary"
                          type="button"
                          onClick={cancelAnonymousNameEdit}
                          label={t('common.cancel')}
                          icon={<X className="size-4" aria-hidden="true" />}
                        />
                      </div>
                    )}

                    {!profile && showAnonymousNamePrompt && (
                      <p className="w-full text-caption leading-relaxed text-accent-primary/70">
                        {t('anonymous.firstStartPrompt')}
                      </p>
                    )}
                  </div>

                  <details className="group" data-deck-options open>
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                      <span>
                        {t('common.select')} · {t('lobby.myDeck')}
                      </span>
                      <Plus className="size-4 transition-transform group-open:rotate-45" aria-hidden="true" />
                    </summary>
                    <div className="pb-4">
                      <DeckSelector
                        label={t('lobby.myDeck')}
                        value={deck0Name}
                        options={deckOptions}
                        onChange={handleDeckChange}
                        density="compact"
                        showHeader={false}
                        scrollable
                        disabled={customRoomBusy}
                      />
                    </div>
                  </details>

                  {!profile && (
                    <details className="group">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-sm font-medium">
                        <span>
                          {t('auth.login')} / {t('auth.register')}
                        </span>
                        <Plus className="size-4 transition-transform group-open:rotate-45" aria-hidden="true" />
                      </summary>
                      <div className="pb-4">
                        <AuthSection onAuthChanged={handleAuthChanged} />
                      </div>
                    </details>
                  )}
                </div>
              </RoomPanel>
            </aside>

            <section className="contents" aria-label={t('lobby.onlineTitle')}>
              {QUICK_MATCH_ENABLED && (
                <div ref={quickMatchPanelRef} className="min-w-0 scroll-mt-24 lg:col-start-1 lg:row-start-2">
                  <RoomPanel
                    mode="quick"
                    className="!rounded-sm !bg-surface-elevated/35 !p-5 !ring-1 !ring-border-soft lg:!overflow-visible"
                  >
                    <div className="grid">
                      <div className="flex min-h-40 flex-col justify-between py-5">
                        <div>
                          <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
                            {t('lobby.quickMatch')}
                          </div>
                          <h2 className="mt-1 font-display text-2xl font-bold">{t('lobby.beginMatch')}</h2>
                        </div>
                        <div className="mt-6">
                          <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                            {t('lobby.currentDeck')}
                          </div>
                          <p className="mt-1 truncate font-display text-lg font-bold text-content-primary/80">
                            {deck0Name ? resolveDeckLabel(deck0Name, deckOptions) : t('lobby.noDeckSelected')}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col justify-center gap-2 border-t border-border-soft pt-5">
                        <Button
                          className="min-h-14 w-full font-display text-lg font-bold tracking-normal"
                          type="button"
                          onClick={handleQuickMatch}
                          disabled={matchmakingActive || customRoomBusy || !canQuickMatch}
                          aria-describedby={!canQuickMatch ? 'online-quick-match-helper' : undefined}
                        >
                          <Zap className="size-4" aria-hidden="true" />
                          {t('lobby.beginMatch')}
                        </Button>
                        {!canQuickMatch && (
                          <p id="online-quick-match-helper" className="text-caption text-accent-action/70">
                            {quickMatchDisabledReason}
                          </p>
                        )}
                      </div>
                    </div>

                    {matchmakingActive && (
                      <div className="mt-5 border-y border-border-soft py-4" aria-live="polite">
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-2 text-sm text-accent-primary/80">
                            <span className="size-2 animate-pulse rounded-full bg-accent-action" />
                            {t('lobby.matchmakingSearching')} {formatQuickMatchWait(matchmakingElapsedSeconds)}
                          </span>
                          {matchmakingCancellable && (
                            <Button variant="ghost" size="sm" type="button" onClick={handleCancelMatchmaking}>
                              {t('lobby.matchmakingCancel')}
                            </Button>
                          )}
                        </div>

                        {matchmakingCancellable &&
                          !longWaitDismissed &&
                          shouldOfferQuickMatchFallback(matchmakingElapsedSeconds) && (
                            <Alert className="mt-4" tone="info" role="status">
                              <strong className="block text-sm">{t('lobby.matchmakingLongWaitTitle')}</strong>
                              <p className="mt-1 text-caption leading-relaxed">{t('lobby.matchmakingLongWaitBody')}</p>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <Button variant="secondary" type="button" onClick={handleContinueWaiting}>
                                  {t('lobby.matchmakingKeepWaiting')}
                                </Button>
                                <Button variant="primary" type="button" onClick={handleUseCustomRoom}>
                                  {t('lobby.matchmakingUseCustomRoom')}
                                </Button>
                                {profile && friends.length > 0 && (
                                  <Button
                                    className="sm:col-span-2"
                                    variant="ghost"
                                    type="button"
                                    onClick={handleUseFriendInvite}
                                  >
                                    {t('lobby.matchmakingUseFriendInvite')}
                                  </Button>
                                )}
                              </div>
                            </Alert>
                          )}
                      </div>
                    )}
                  </RoomPanel>
                </div>
              )}

              <div
                ref={customRoomPanelRef}
                className={`min-w-0 scroll-mt-24 lg:col-start-2 lg:row-start-1 ${
                  QUICK_MATCH_ENABLED ? 'lg:row-span-3' : 'lg:row-span-2'
                }`}
              >
                <RoomPanel
                  mode="custom"
                  className="!rounded-sm !bg-surface-elevated/20 !p-5 !ring-1 !ring-border-soft md:!p-6"
                >
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
                        {t('lobby.onlineTitle')}
                      </div>
                      <h2 className="mt-1 font-display text-2xl font-bold">{t('lobby.customRooms')}</h2>
                    </div>
                    <Button
                      className="min-h-11"
                      size="sm"
                      variant="primary"
                      type="button"
                      onClick={() => void runOnline()}
                      disabled={matchmakingActive || customRoomBusy || !canStart}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      {t('lobby.createPublicRoom')}
                    </Button>
                  </div>

                  {!canStart && <p className="mb-3 text-caption text-accent-action/70">{startDisabledReason}</p>}

                  <section aria-labelledby="available-room-list-title" className="border-y border-border-soft">
                    <div className="flex min-h-12 items-center justify-between gap-3">
                      <div>
                        <h3 id="available-room-list-title" className="font-display text-base font-bold">
                          {t('lobby.availableRooms')}
                        </h3>
                        <p className="text-caption text-content-primary/40">{t('lobby.availableRoomsHint')}</p>
                      </div>
                      <IconButton
                        type="button"
                        variant="ghost"
                        onClick={() => void refreshAvailableRooms(true)}
                        disabled={roomListStatus === 'loading'}
                        label={t('lobby.refreshRooms')}
                        title={t('lobby.refreshRooms')}
                        icon={
                          <RefreshCw
                            className={`size-4 ${roomListStatus === 'loading' ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                        }
                      />
                    </div>

                    {roomListStatus === 'unavailable' && availableRooms.length === 0 ? (
                      <Alert className="mb-3" tone="danger" role="status">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>{t('lobby.availableRoomsUnavailable')}</span>
                          <Button size="sm" variant="ghost" onClick={() => void refreshAvailableRooms(true)}>
                            {t('common.retry')}
                          </Button>
                        </div>
                      </Alert>
                    ) : roomListStatus === 'loading' && availableRooms.length === 0 ? (
                      <p className="py-5 text-center text-caption text-content-primary/40" role="status">
                        {t('lobby.loadingRooms')}
                      </p>
                    ) : availableRooms.filter((room) => room.roomCode !== createdMatchID).length === 0 ? (
                      <p className="py-5 text-center text-caption text-content-primary/40">
                        {t('lobby.availableRoomsEmpty')}
                      </p>
                    ) : (
                      <ul className="max-h-[28rem] divide-y divide-border-soft overflow-y-auto lg:max-h-[calc(100dvh-23rem)]">
                        {availableRooms
                          .filter((room) => room.roomCode !== createdMatchID)
                          .map((room) => (
                            <li key={room.roomCode} className="flex min-h-16 items-center justify-between gap-3 py-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{room.hostDisplayName}</div>
                                <div className="mt-0.5 flex items-center gap-2 text-caption text-content-primary/45">
                                  <span className="truncate font-mono">{room.roomCode}</span>
                                  <span className="flex shrink-0 items-center gap-1">
                                    <Users className="size-3" aria-hidden="true" />
                                    {room.playerCount}/2
                                  </span>
                                </div>
                              </div>
                              <Button
                                className="shrink-0"
                                size="sm"
                                variant="secondary"
                                disabled={matchmakingActive || customRoomBusy || !canStart}
                                onClick={() => {
                                  setRoomChatSubjectOverride('');
                                  setMatchID(room.roomCode);
                                  void runOnline(room.roomCode);
                                }}
                              >
                                {t('lobby.joinRoom')}
                              </Button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </section>

                  <details className="group mt-1" open>
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                      <span>{t('lobby.roomCode')}</span>
                      <Plus className="size-4 transition-transform group-open:rotate-45" aria-hidden="true" />
                    </summary>
                    <div className="grid gap-2 pb-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <Input
                        className="min-h-11 min-w-0"
                        value={matchID}
                        onChange={(event) => {
                          setRoomChatSubjectOverride('');
                          setMatchID(event.target.value.trim());
                        }}
                        placeholder={t('lobby.roomCodePlaceholder')}
                        aria-label={t('lobby.roomCode')}
                        disabled={matchmakingActive || customRoomBusy}
                      />
                      <Button
                        className="min-h-11"
                        variant="secondary"
                        type="button"
                        disabled={!matchID || matchmakingActive || customRoomBusy || !canStart}
                        onClick={() => void runOnline(matchID)}
                      >
                        {t('lobby.joinRoom')}
                      </Button>
                    </div>
                  </details>

                  {createdMatchID && (
                    <RoomDetails className="mt-4 !rounded-none !bg-accent-primary/5 !ring-accent-primary/20">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                          {t('online.roomCode')}
                        </span>
                        <strong className="font-mono text-sm text-accent-primary">{createdMatchID}</strong>
                      </div>
                      <Input
                        className="min-h-11 min-w-0 font-mono text-xs text-content-primary/70"
                        value={buildOnlineRoomUrl(createdMatchID)}
                        readOnly
                        aria-label={t('online.shareLink')}
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <Button size="sm" variant="secondary" type="button" onClick={handleCopyShareLink}>
                          {copied ? t('online.copied') : t('online.copyLink')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          onClick={() => void handleCancelCustomRoom()}
                          disabled={customRoomCancelling}
                        >
                          {customRoomCancelling ? t('online.leaving') : t('online.cancelRoom')}
                        </Button>
                        <span className="text-caption text-content-primary/50">{t('online.hostWaitingHelper')}</span>
                      </div>
                    </RoomDetails>
                  )}

                  {profile && roomChatSubjectId && (
                    <details
                      className="group mt-4 border-y border-border-soft"
                      open={roomChatOpen}
                      onToggle={(event) => setRoomChatOpen(event.currentTarget.open)}
                    >
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                          <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {t('chat.roomEyebrow')} · {roomChatSubjectId}
                          </span>
                          {roomChatUnreadCount > 0 && !roomChatOpen && (
                            <span
                              className="grid min-h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent-action px-1 font-mono text-minutia text-surface-canvas"
                              data-room-chat-unread-count={roomChatUnreadCount}
                              aria-label={t('chat.unreadCount').replace('{count}', String(roomChatUnreadCount))}
                            >
                              {roomChatUnreadCount > 99 ? '99+' : roomChatUnreadCount}
                            </span>
                          )}
                        </span>
                        <Plus
                          className="size-4 shrink-0 transition-transform group-open:rotate-45"
                          aria-hidden="true"
                        />
                      </summary>
                      <div
                        className="mb-4 grid h-72 grid-rows-[minmax(0,1fr)_auto] border border-border-soft bg-surface-canvas/30"
                        data-chat-surface="room"
                        data-chat-subject={roomChatSubjectId}
                      >
                        <div
                          ref={roomChatMessagesRef}
                          className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3"
                          onScroll={(event) => {
                            const element = event.currentTarget;
                            roomChatShouldStickToBottomRef.current =
                              element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
                          }}
                        >
                          {roomChatStatus === 'loading' && (
                            <div className="grid min-h-full place-items-center text-caption text-content-primary/35">
                              {t('presence.syncing')}
                            </div>
                          )}
                          {roomChatStatus === 'unavailable' && (
                            <div className="grid min-h-full place-items-center text-caption text-accent-action/70">
                              {t('chat.historyUnavailable')}
                            </div>
                          )}
                          {roomChatStatus === 'ready' && roomChatMessages.length === 0 && (
                            <div className="grid min-h-full place-items-center text-caption text-content-primary/35">
                              {t('chat.empty')}
                            </div>
                          )}
                          {roomChatMessages.map((message) => {
                            const self = message.authorUserId === profile.id;
                            return (
                              <div
                                key={message.id}
                                data-chat-message="room"
                                className={`max-w-[86%] ${self ? 'self-end text-right' : 'self-start text-left'}`}
                              >
                                <div className="flex items-center gap-1 px-1 pb-1 text-minutia text-content-primary/40">
                                  <span className="min-w-0 flex-1 truncate">
                                    {message.authorDisplayName || message.authorUserId}
                                  </span>
                                  <IconButton
                                    className="!size-7"
                                    variant="ghost"
                                    type="button"
                                    onClick={() => void handleRoomChatTranslate(message)}
                                    disabled={message.translation?.status === 'loading'}
                                    label={t('chat.translate')}
                                    icon={<Languages className="size-3" aria-hidden="true" />}
                                  />
                                  {!self && (
                                    <IconButton
                                      className="!size-7"
                                      variant="ghost"
                                      type="button"
                                      onClick={() => void handleRoomChatReport(message)}
                                      disabled={reportedRoomMessageIds.has(message.id)}
                                      label={
                                        reportedRoomMessageIds.has(message.id) ? t('chat.reported') : t('chat.report')
                                      }
                                      icon={<Flag className="size-3" aria-hidden="true" />}
                                    />
                                  )}
                                </div>
                                <div
                                  className={`rounded-sm border px-3 py-2 text-caption leading-relaxed [overflow-wrap:anywhere] ${
                                    self
                                      ? 'border-accent-primary/25 bg-accent-primary/10'
                                      : 'border-border-soft bg-surface-elevated/50'
                                  }`}
                                >
                                  {message.content}
                                </div>
                                {message.translation && (
                                  <div className="mt-1 rounded-sm border border-border-soft px-3 py-2 text-caption leading-relaxed text-content-muted">
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
                            );
                          })}
                        </div>
                        <form
                          className="grid grid-cols-[minmax(0,1fr)_var(--touch-target-min)] gap-2 border-t border-border-soft p-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleRoomChatSubmit();
                          }}
                        >
                          <Input
                            className="min-h-11 min-w-0"
                            value={roomChatDraft}
                            onChange={(event) => setRoomChatDraft(event.target.value.slice(0, 500))}
                            placeholder={t('chat.messagePlaceholder')}
                            aria-label={t('chat.messagePlaceholder')}
                            disabled={roomChatStatus === 'sending' || roomChatStatus === 'unavailable'}
                          />
                          <IconButton
                            variant="primary"
                            type="submit"
                            disabled={
                              !roomChatDraft.trim() || roomChatStatus === 'sending' || roomChatStatus === 'unavailable'
                            }
                            label={t('chat.send')}
                            icon={<Send className="size-4" aria-hidden="true" />}
                          />
                        </form>
                      </div>
                    </details>
                  )}
                </RoomPanel>
              </div>

              <div className={`min-w-0 lg:col-start-1 ${QUICK_MATCH_ENABLED ? 'lg:row-start-3' : 'lg:row-start-2'}`}>
                <RoomPanel
                  mode="custom"
                  className="!rounded-sm !bg-surface-elevated/20 !p-0 !ring-1 !ring-border-soft"
                  data-friend-invites
                >
                  <details className="group px-5">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
                          {t('friend.title')}
                        </span>
                        <span className="block truncate font-display text-lg font-bold">{t('friend.invite')}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {profile && (
                          <IconButton
                            variant="ghost"
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              refreshFriends();
                            }}
                            label={t('friend.refresh')}
                            icon={<RefreshCw className="size-4" aria-hidden="true" />}
                          />
                        )}
                        <Plus className="size-4 transition-transform group-open:rotate-45" aria-hidden="true" />
                      </span>
                    </summary>

                    {!profile ? (
                      <Alert className="mb-5" tone="info">
                        {t('lobby.loginRequired')}
                      </Alert>
                    ) : (
                      <div className="divide-y divide-border-soft border-t border-border-soft pb-4">
                        {friends.map((friend) => (
                          <div
                            key={friend.userId}
                            data-friend-user-id={friend.userId}
                            className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 py-2"
                          >
                            <div className="min-w-0">
                              <strong className="block truncate text-body">{friend.nickname || friend.userId}</strong>
                              <span className="block truncate text-minutia text-content-dim">{friend.userId}</span>
                            </div>
                            <IconButton
                              variant="ghost"
                              type="button"
                              data-friend-invite-action="send"
                              data-friend-user-id={friend.userId}
                              onClick={() => void handleInviteFriend(friend)}
                              disabled={
                                friendInviteActionId !== null ||
                                friendInvitePeerId !== null ||
                                matchmakingActive ||
                                customRoomBusy ||
                                !canStart
                              }
                              label={t('friend.invite')}
                              icon={<Send className="size-4" aria-hidden="true" />}
                            />
                            <IconButton
                              variant="ghost"
                              type="button"
                              data-friend-invite-action="accept"
                              data-friend-user-id={friend.userId}
                              onClick={() => void handleAcceptFriendInvite(friend)}
                              disabled={
                                friendInviteActionId !== null ||
                                matchmakingActive ||
                                customRoomBusy ||
                                (friendInvitePeerId !== null && friendInvitePeerId !== friend.userId)
                              }
                              label={t('friend.acceptInvite')}
                              icon={<Check className="size-4" aria-hidden="true" />}
                            />
                          </div>
                        ))}
                        {friendStatus !== 'loading' && friends.length === 0 && (
                          <p className="py-5 text-center text-caption text-content-dim">{t('friend.empty')}</p>
                        )}
                      </div>
                    )}
                  </details>
                </RoomPanel>
              </div>

              {error && (
                <Alert className="mt-4 lg:col-span-2" tone="danger" role="alert">
                  {error}
                </Alert>
              )}
            </section>
          </div>
        </div>
      </main>
    </PageShell>
  );
}
