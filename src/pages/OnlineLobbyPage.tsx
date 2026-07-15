import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Check, Flag, Languages, MessageCircle, Pencil, Radio, Send, Trash2, UserPlus, X } from 'lucide-react';
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
  addFriend,
  fetchChatMessages,
  getProfile,
  getFriends,
  fetchUnreadChat,
  isLoggedIn,
  markChatRead,
  reportChatMessage,
  removeFriend,
  requestChatTranslation,
  sendChatMessage,
  reserveDeck,
  type ChatMessage,
  type ChatMessageTranslation,
  type DeckResponse,
  type ChatUnreadConversation,
  type FriendProfile,
  type ProfileResponse,
} from '../api/client';
import { buildDirectConversationSubjectId } from '../chat/directConversation';
import { resolveUnreadConversationAction, unreadConversationLatestMessageId } from '../chat/unreadNavigation';
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
import { Alert, AppHeader, Button, Input, PageShell, Panel } from '../ui';
import { useOnlinePresence } from '../hooks/useOnlinePresence';
import {
  buildPlatformFriendInviteId,
  connectPlatformQuickMatch,
  createPlatformCustomRoom,
  createPlatformInvite,
  isPlatformBoardgameRelayAcknowledged,
  joinPlatformCustomRoom,
  joinPlatformInvite,
  type PlatformCustomRoom,
  type PlatformInviteSnapshot,
  type PlatformInviteRoom,
  type PlatformQuickMatchRoom,
} from '../platformClient';
import { Sentry } from '../sentry';
import { t, translate, useLocale } from '../i18n';
import { buildMatchHistoryChatPath } from '../game/matchHistory';
import type { OnlineSession } from '../onlineSession';
import { isOnlineRoomErrorKey } from '../onlineRoomStatus';

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
type DirectChatEntry = LobbyChatEntry;
type RoomChatEntry = LobbyChatEntry;
const ANONYMOUS_NAME_PROMPT_STORAGE_KEY = 'zutomayo_anonymous_name_prompt_seen';
const GLOBAL_LOBBY_CHAT_SUBJECT_ID = 'online-lobby';

// 段位定義：依 ELO 劃分漆面塔羅風格的段位名（專有名詞，不 i18n）。
const RANKS = [
  { name: '金輝 V', min: 1800, max: 2400 },
  { name: '朱痕 IV', min: 1600, max: 1800 },
  { name: '幽影 III', min: 1400, max: 1600 },
  { name: '殘月 II', min: 1200, max: 1400 },
  { name: '新月 I', min: 0, max: 1200 },
] as const;

function eloToRank(elo: number): { name: string; progress: number } {
  const rank = RANKS.find((r) => elo >= r.min && elo < r.max) ?? RANKS[RANKS.length - 1];
  const span = rank.max - rank.min;
  const progress = span > 0 ? Math.min(1, Math.max(0, (elo - rank.min) / span)) : 0;
  return { name: rank.name, progress };
}

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

export function OnlineLobbyPage({
  deck0Name,
  customDeckAvailable,
  serverDecks,
  setDeck0Name,
  onStartOnline,
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
  const [friendUserIdDraft, setFriendUserIdDraft] = useState('');
  const [friendActionId, setFriendActionId] = useState<string | null>(null);
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
  const [unreadChats, setUnreadChats] = useState<ChatUnreadConversation[]>([]);
  const [unreadChatStatus, setUnreadChatStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [directChat, setDirectChat] = useState<{
    subjectId: string;
    peerUserId: string;
    friend?: FriendProfile;
  } | null>(null);
  const [directChatMessages, setDirectChatMessages] = useState<DirectChatEntry[]>([]);
  const [directChatDraft, setDirectChatDraft] = useState('');
  const [directChatStatus, setDirectChatStatus] = useState<DirectChatStatus>('idle');
  const [reportedDirectMessageIds, setReportedDirectMessageIds] = useState<Set<string>>(() => new Set());
  const directChatPanelRef = useRef<HTMLDivElement | null>(null);
  const directChatMessagesRef = useRef<HTMLDivElement | null>(null);
  const [lobbyChatMessages, setLobbyChatMessages] = useState<LobbyChatEntry[]>([]);
  const [lobbyChatDraft, setLobbyChatDraft] = useState('');
  const [lobbyChatStatus, setLobbyChatStatus] = useState<DirectChatStatus>('idle');
  const [reportedLobbyMessageIds, setReportedLobbyMessageIds] = useState<Set<string>>(() => new Set());
  const lobbyChatPanelRef = useRef<HTMLDivElement | null>(null);
  const lobbyChatMessagesRef = useRef<HTMLDivElement | null>(null);
  const [roomChatSubjectOverride, setRoomChatSubjectOverride] = useState('');
  const [roomChatMessages, setRoomChatMessages] = useState<RoomChatEntry[]>([]);
  const [roomChatDraft, setRoomChatDraft] = useState('');
  const [roomChatStatus, setRoomChatStatus] = useState<DirectChatStatus>('idle');
  const [reportedRoomMessageIds, setReportedRoomMessageIds] = useState<Set<string>>(() => new Set());
  const customRoomPanelRef = useRef<HTMLDivElement | null>(null);
  const platformCustomRoomRef = useRef<PlatformCustomRoom | null>(null);
  const roomChatMessagesRef = useRef<HTMLDivElement | null>(null);
  const [anonymousIdentity, setAnonymousIdentity] = useState<AnonymousIdentity>(() => loadAnonymousIdentity());
  const [editingAnonymousName, setEditingAnonymousName] = useState(false);
  const [anonymousNameDraft, setAnonymousNameDraft] = useState(() => anonymousIdentity.baseName);
  const [showAnonymousNamePrompt, setShowAnonymousNamePrompt] = useState(false);
  const refreshProfile = useCallback(async () => {
    if (!isLoggedIn()) {
      setProfile(null);
      setFriends([]);
      setFriendStatus('idle');
      setUnreadChats([]);
      setUnreadChatStatus('idle');
      setDirectChat(null);
      setLobbyChatMessages([]);
      setLobbyChatStatus('idle');
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
      setUnreadChats([]);
      setUnreadChatStatus('idle');
      setDirectChat(null);
      setLobbyChatMessages([]);
      setLobbyChatStatus('idle');
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

  const refreshUnreadChats = useCallback(async () => {
    if (!isLoggedIn()) {
      setUnreadChats([]);
      setUnreadChatStatus('idle');
      return;
    }
    setUnreadChatStatus('loading');
    try {
      const conversations = await fetchUnreadChat(5);
      setUnreadChats(conversations);
      setUnreadChatStatus('ready');
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'chat',
        message: 'unread chat summary unavailable',
        level: 'warning',
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      setUnreadChats([]);
      setUnreadChatStatus('unavailable');
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
    void refreshUnreadChats();
  }, [profile, refreshFriends, refreshUnreadChats]);

  const handleAuthChanged = useCallback(async () => {
    await onAuthChanged();
    await refreshProfile();
    await refreshFriends();
    await refreshUnreadChats();
    setError('');
  }, [onAuthChanged, refreshFriends, refreshProfile, refreshUnreadChats]);

  useEffect(() => {
    if (!directChat || !profile) {
      setDirectChatMessages([]);
      setDirectChatStatus('idle');
      return;
    }
    let cancelled = false;
    setDirectChatStatus('loading');
    setDirectChatMessages([]);
    void fetchChatMessages({ conversationType: 'direct', subjectId: directChat.subjectId, limit: 50 }).then(
      (messages) => {
        if (cancelled) return;
        const visibleMessages = messages.filter(canShowChatMessage);
        setDirectChatMessages(visibleMessages);
        setDirectChatStatus('ready');
        const latestMessageId = visibleMessages.at(-1)?.id;
        void markChatRead({
          conversationType: 'direct',
          subjectId: directChat.subjectId,
          lastReadMessageId: latestMessageId,
        }).then(refreshUnreadChats, () => undefined);
      },
      (err) => {
        if (cancelled) return;
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'direct chat history unavailable',
          level: 'warning',
          data: { peer_user_id: directChat.peerUserId, error: err instanceof Error ? err.message : String(err) },
        });
        setDirectChatStatus('unavailable');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [directChat, profile, refreshUnreadChats]);

  useEffect(() => {
    const element = directChatMessagesRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [directChatMessages]);

  useEffect(() => {
    if (!profile) {
      setLobbyChatMessages([]);
      setLobbyChatStatus('idle');
      return;
    }
    let cancelled = false;
    setLobbyChatStatus('loading');
    void fetchChatMessages({
      conversationType: 'global',
      subjectId: GLOBAL_LOBBY_CHAT_SUBJECT_ID,
      limit: 50,
    }).then(
      (messages) => {
        if (cancelled) return;
        const visibleMessages = messages.filter(canShowChatMessage);
        setLobbyChatMessages(visibleMessages);
        setLobbyChatStatus('ready');
        const latestMessageId = visibleMessages.at(-1)?.id;
        void markChatRead({
          conversationType: 'global',
          subjectId: GLOBAL_LOBBY_CHAT_SUBJECT_ID,
          lastReadMessageId: latestMessageId,
        }).then(refreshUnreadChats, () => undefined);
      },
      (err) => {
        if (cancelled) return;
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'global lobby chat history unavailable',
          level: 'warning',
          data: { error: err instanceof Error ? err.message : String(err) },
        });
        setLobbyChatStatus('unavailable');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [profile, refreshUnreadChats]);

  useEffect(() => {
    const element = lobbyChatMessagesRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [lobbyChatMessages]);

  const applyDirectChatTranslation = useCallback((messageId: string, translation: DirectChatTranslationState) => {
    setDirectChatMessages((messages) =>
      messages.map((message) => (message.id === messageId ? { ...message, translation } : message)),
    );
  }, []);

  const applyLobbyChatTranslation = useCallback((messageId: string, translation: DirectChatTranslationState) => {
    setLobbyChatMessages((messages) =>
      messages.map((message) => (message.id === messageId ? { ...message, translation } : message)),
    );
  }, []);

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
  const [copied, setCopied] = useState(false);
  const platformQuickMatchRoomRef = useRef<PlatformQuickMatchRoom | null>(null);
  const phaseRef = useRef<MatchmakingPhase>('idle');
  const cancelRef = useRef(false);
  const pendingQuickMatchSessionRef = useRef<OnlineSession | null>(null);

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
    cancelRef.current = false;
    pendingQuickMatchSessionRef.current = null;
    setMatchmakingActive(false);
    setMatchmakingCancellable(false);
  }, []);

  useEffect(
    () => () => {
      cancelRef.current = true;
      void platformQuickMatchRoomRef.current?.leave(true).catch(() => {});
      platformQuickMatchRoomRef.current = null;
      void platformCustomRoomRef.current?.leave(true).catch(() => undefined);
      platformCustomRoomRef.current = null;
    },
    [],
  );

  useEffect(() => {
    setCopied(false);
  }, [createdMatchID]);

  useEffect(() => {
    if (createdMatchID) setRoomChatSubjectOverride('');
  }, [createdMatchID]);

  const roomChatSubjectId = roomChatSubjectOverride || createdMatchID || (matchID.length >= 3 ? matchID : '');

  useEffect(() => {
    if (!profile || !roomChatSubjectId) {
      setRoomChatMessages([]);
      setRoomChatStatus('idle');
      return;
    }
    let cancelled = false;
    setRoomChatStatus('loading');
    setReportedRoomMessageIds(new Set());
    void fetchChatMessages({
      conversationType: 'room',
      subjectId: roomChatSubjectId,
      limit: 50,
    }).then(
      (messages) => {
        if (cancelled) return;
        const visibleMessages = messages.filter(canShowChatMessage);
        setRoomChatMessages(visibleMessages);
        setRoomChatStatus('ready');
        const latestMessageId = visibleMessages.at(-1)?.id;
        void markChatRead({
          conversationType: 'room',
          subjectId: roomChatSubjectId,
          lastReadMessageId: latestMessageId,
        }).then(refreshUnreadChats, () => undefined);
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
  }, [profile, refreshUnreadChats, roomChatSubjectId]);

  useEffect(() => {
    const element = roomChatMessagesRef.current;
    if (!element) return;
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
    if (requestAnonymousNameBeforeStart()) return;
    setError('');
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
            }
          },
          onDisconnect: () => {
            if (platformCustomRoomRef.current === room) {
              platformCustomRoomRef.current = null;
              setCreatedMatchID('');
            }
          },
          onBoardgameMatchReady: (message) => {
            if (!isPlatformBoardgameRelayAcknowledged(nextSession.matchID, message)) return;
            if (platformCustomRoomRef.current === room) {
              platformCustomRoomRef.current = null;
            }
            setCreatedMatchID('');
            void room.leave(true).catch(() => undefined);
            navigateToOnlineSession(nextSession);
          },
        },
      );
      platformCustomRoomRef.current = room;
      setCreatedMatchID(nextSession.matchID);
    } catch (err) {
      Sentry.captureException(err, { tags: { action: 'start-online' } });
      setError(onlineErrorMessage(err));
    }
  };

  const handleQuickMatch = async () => {
    if (!isLoggedIn()) {
      setError(t('lobby.loginRequired'));
      return;
    }
    if (requestAnonymousNameBeforeStart()) return;
    setError('');
    setMatchmakingActive(true);
    setMatchmakingCancellable(true);
    cancelRef.current = false;
    phaseRef.current = 'platform-waiting';

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

  const handleCancelMatchmaking = () => {
    if (phaseRef.current !== 'platform-waiting') return;
    cancelRef.current = true;
    pendingQuickMatchSessionRef.current = null;
    setMatchmakingCancellable(false);
    platformQuickMatchRoomRef.current?.send('cancelQuickMatch', {});
    void platformQuickMatchRoomRef.current?.leave(true).catch(() => {});
    platformQuickMatchRoomRef.current = null;
    resetMatchmaking();
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

  const canStart = cardsReady && !!deck0Name;
  const startDisabledReason = !cardsReady ? t('game.loading') : !deck0Name ? t('lobby.selectDeckFirst') : '';
  const rank = profile ? eloToRank(profile.elo) : null;
  const unreadChatTotal = unreadChats.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const directChatPeerName = directChat?.friend?.nickname || directChat?.peerUserId || '';
  const draftPreview = formatAnonymousDisplayName({
    baseName: sanitizeAnonymousBaseName(anonymousNameDraft),
    suffix: anonymousIdentity.suffix,
  });

  const scrollToPanel = (ref: RefObject<HTMLDivElement | null>) => {
    window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openUnreadConversation = (conversation: ChatUnreadConversation) => {
    const action = resolveUnreadConversationAction(conversation, { profileId: profile?.id, friends });
    if (!action) return;

    if (action.kind === 'match') {
      navigate(buildMatchHistoryChatPath(action.subjectId));
      return;
    }
    if (action.kind === 'room') {
      setRoomChatSubjectOverride(action.subjectId);
      setMatchID(action.subjectId);
      scrollToPanel(customRoomPanelRef);
      return;
    }
    if (action.kind === 'global') {
      scrollToPanel(lobbyChatPanelRef);
      void markChatRead({
        conversationType: 'global',
        subjectId: action.subjectId,
        lastReadMessageId: unreadConversationLatestMessageId(conversation),
      }).then(refreshUnreadChats, () => undefined);
      return;
    }
    if (action.kind === 'direct') {
      setDirectChat({ subjectId: action.subjectId, peerUserId: action.peerUserId, friend: action.friend });
      scrollToPanel(directChatPanelRef);
    }
  };

  const openFriendChat = (friend: FriendProfile) => {
    if (!profile) return;
    const subjectId = buildDirectConversationSubjectId(profile.id, friend.userId);
    if (!subjectId) return;
    setDirectChat({ subjectId, peerUserId: friend.userId, friend });
  };

  const handleAddFriend = async () => {
    if (!profile) return;
    const friendUserId = friendUserIdDraft.trim();
    if (!friendUserId) return;
    setFriendActionId(friendUserId);
    try {
      await addFriend(friendUserId);
      setFriendUserIdDraft('');
      await refreshFriends();
      showToast({ title: t('friend.added'), kind: 'success' });
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'friends',
        message: 'add friend failed',
        level: 'warning',
        data: { friend_user_id: friendUserId, error: err instanceof Error ? err.message : String(err) },
      });
      showToast({ title: t('friend.addFailed'), kind: 'error' });
    } finally {
      setFriendActionId(null);
    }
  };

  const handleRemoveFriend = async (friend: FriendProfile) => {
    setFriendActionId(friend.userId);
    try {
      await removeFriend(friend.userId);
      if (directChat?.peerUserId === friend.userId) setDirectChat(null);
      await refreshFriends();
      showToast({ title: t('friend.removed'), kind: 'success' });
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'friends',
        message: 'remove friend failed',
        level: 'warning',
        data: { friend_user_id: friend.userId, error: err instanceof Error ? err.message : String(err) },
      });
      showToast({ title: t('friend.removeFailed'), kind: 'error' });
    } finally {
      setFriendActionId(null);
    }
  };

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

  const handleDirectChatSubmit = async () => {
    if (!profile || !directChat || !directChatDraft.trim() || directChatStatus === 'sending') return;
    const content = directChatDraft.trim();
    setDirectChatStatus('sending');
    try {
      const result = await sendChatMessage({
        conversationType: 'direct',
        subjectId: directChat.subjectId,
        content,
        title: directChatPeerName ? `${profile.nickname} / ${directChatPeerName}` : '',
        authorDisplayName: profile.nickname,
        authorRole: 'player',
      });
      if (canShowChatMessage(result.message)) {
        setDirectChatMessages((messages) => [...messages, result.message]);
        void markChatRead({
          conversationType: 'direct',
          subjectId: directChat.subjectId,
          lastReadMessageId: result.message.id,
        }).then(refreshUnreadChats, () => undefined);
      }
      setDirectChatDraft('');
      setDirectChatStatus('ready');
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'chat',
        message: 'direct chat send failed',
        level: 'warning',
        data: { peer_user_id: directChat.peerUserId, error: err instanceof Error ? err.message : String(err) },
      });
      setDirectChatStatus('ready');
      showToast({ title: t('chat.sendFailed'), kind: 'error' });
    }
  };

  const handleDirectChatTranslate = useCallback(
    async (message: DirectChatEntry) => {
      if (message.translation?.status === 'loading') return;
      const targetLanguage = locale.toLowerCase();
      applyDirectChatTranslation(message.id, { status: 'loading', targetLanguage });
      try {
        const result = await requestChatTranslation(message.id, targetLanguage);
        applyDirectChatTranslation(message.id, {
          status: result.translation.status,
          targetLanguage: result.translation.targetLanguage,
          content: result.translation.translatedContent || undefined,
        });
      } catch (err) {
        applyDirectChatTranslation(message.id, { status: 'unavailable', targetLanguage });
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'direct chat translation failed',
          level: 'warning',
          data: { message_id: message.id, error: err instanceof Error ? err.message : String(err) },
        });
      }
    },
    [applyDirectChatTranslation, locale],
  );

  const handleDirectChatReport = useCallback(
    async (message: DirectChatEntry) => {
      if (message.authorUserId === profile?.id || reportedDirectMessageIds.has(message.id)) return;
      setReportedDirectMessageIds((ids) => new Set(ids).add(message.id));
      try {
        await reportChatMessage(message.id, { reason: 'inappropriate' });
        showToast({ title: t('chat.reported'), kind: 'success' });
      } catch (err) {
        setReportedDirectMessageIds((ids) => {
          const next = new Set(ids);
          next.delete(message.id);
          return next;
        });
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'direct chat report failed',
          level: 'warning',
          data: { message_id: message.id, error: err instanceof Error ? err.message : String(err) },
        });
        showToast({ title: t('chat.reportFailed'), kind: 'error' });
      }
    },
    [profile?.id, reportedDirectMessageIds, showToast],
  );

  const handleLobbyChatSubmit = async () => {
    if (!profile || !lobbyChatDraft.trim() || lobbyChatStatus === 'sending') return;
    const content = lobbyChatDraft.trim();
    setLobbyChatStatus('sending');
    try {
      const result = await sendChatMessage({
        conversationType: 'global',
        subjectId: GLOBAL_LOBBY_CHAT_SUBJECT_ID,
        content,
        title: t('chat.globalTitle'),
        authorDisplayName: profile.nickname,
        authorRole: 'player',
      });
      if (canShowChatMessage(result.message)) {
        setLobbyChatMessages((messages) => [...messages, result.message]);
        void markChatRead({
          conversationType: 'global',
          subjectId: GLOBAL_LOBBY_CHAT_SUBJECT_ID,
          lastReadMessageId: result.message.id,
        }).then(refreshUnreadChats, () => undefined);
      }
      setLobbyChatDraft('');
      setLobbyChatStatus('ready');
    } catch (err) {
      Sentry.addBreadcrumb({
        category: 'chat',
        message: 'global lobby chat send failed',
        level: 'warning',
        data: { error: err instanceof Error ? err.message : String(err) },
      });
      setLobbyChatStatus('ready');
      showToast({ title: t('chat.sendFailed'), kind: 'error' });
    }
  };

  const handleLobbyChatTranslate = useCallback(
    async (message: LobbyChatEntry) => {
      if (message.translation?.status === 'loading') return;
      const targetLanguage = locale.toLowerCase();
      applyLobbyChatTranslation(message.id, { status: 'loading', targetLanguage });
      try {
        const result = await requestChatTranslation(message.id, targetLanguage);
        applyLobbyChatTranslation(message.id, {
          status: result.translation.status,
          targetLanguage: result.translation.targetLanguage,
          content: result.translation.translatedContent || undefined,
        });
      } catch (err) {
        applyLobbyChatTranslation(message.id, { status: 'unavailable', targetLanguage });
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'global lobby chat translation failed',
          level: 'warning',
          data: { message_id: message.id, error: err instanceof Error ? err.message : String(err) },
        });
      }
    },
    [applyLobbyChatTranslation, locale],
  );

  const handleLobbyChatReport = useCallback(
    async (message: LobbyChatEntry) => {
      if (message.authorUserId === profile?.id || reportedLobbyMessageIds.has(message.id)) return;
      setReportedLobbyMessageIds((ids) => new Set(ids).add(message.id));
      try {
        await reportChatMessage(message.id, { reason: 'inappropriate' });
        showToast({ title: t('chat.reported'), kind: 'success' });
      } catch (err) {
        setReportedLobbyMessageIds((ids) => {
          const next = new Set(ids);
          next.delete(message.id);
          return next;
        });
        Sentry.addBreadcrumb({
          category: 'chat',
          message: 'global lobby chat report failed',
          level: 'warning',
          data: { message_id: message.id, error: err instanceof Error ? err.message : String(err) },
        });
        showToast({ title: t('chat.reportFailed'), kind: 'error' });
      }
    },
    [profile?.id, reportedLobbyMessageIds, showToast],
  );

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
        setRoomChatMessages((messages) => [...messages, result.message]);
        void markChatRead({
          conversationType: 'room',
          subjectId: roomChatSubjectId,
          lastReadMessageId: result.message.id,
        }).then(refreshUnreadChats, () => undefined);
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
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute left-1/3 top-1/4 h-[50vh] w-[90vh] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[oklch(from_var(--time-night)_l_c_h_/_0.06)] blur-[var(--ambient-glow-blur-md)]" />
        <div className="absolute inset-0 opacity-[0.04] [background-image:var(--pattern-dot)] [background-size:var(--pattern-dot-size)]" />
      </div>

      <AppHeader
        title={t('lobby.onlineTitle')}
        subtitle={t('lobby.onlineLobbySubtitle')}
        backTo="/"
        leftMeta={<OnlinePresenceBadge onlineCount={onlineCount} />}
        actions={
          <div className="hidden items-center gap-2 px-2 font-mono text-caption uppercase tracking-[var(--tracking-label)] text-content-primary/50 sm:flex">
            <Radio className="size-3 animate-pulse text-accent-action" aria-hidden="true" />
            <span className="max-w-[14rem] truncate">
              {profile ? `${profile.nickname} · ELO ${profile.elo}` : anonymousDisplayName}
            </span>
          </div>
        }
      />

      <main className="relative z-[var(--z-dropdown)] h-full overflow-y-auto px-4 pb-10 pt-20 md:pt-24">
        <div className="mx-auto grid w-full max-w-5xl items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          {/* 左：快速配對操作台 */}
          <RoomPanel mode="quick">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
                  {t('lobby.quickMatch')}
                </div>
                <h2 className="mt-1 font-display text-3xl font-bold">{t('lobby.onlineTitle')}</h2>
              </div>
              <OnlinePresenceBadge onlineCount={onlineCount} variant="panel" className="w-full sm:w-auto" />
            </div>

            {/* 匿名身份 */}
            <Panel variant="ghost">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                    {t('anonymous.identity')}
                  </div>
                  <div className="mt-1 truncate font-mono text-sm text-accent-primary">
                    {profile ? profile.nickname : editingAnonymousName ? draftPreview : anonymousDisplayName}
                  </div>
                </div>
                {!profile && (
                  <Button
                    className="size-11 shrink-0 p-0 tracking-normal"
                    variant="secondary"
                    type="button"
                    onClick={startEditingAnonymousName}
                    aria-label={t('anonymous.editName')}
                    title={t('anonymous.editName')}
                  >
                    <Pencil strokeWidth={1.25} className="size-3.5" />
                  </Button>
                )}
              </div>
              {!profile && editingAnonymousName && (
                <div className="mt-3 flex gap-2">
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
                  <Button
                    className="size-11 shrink-0 p-0 tracking-normal"
                    variant="primary"
                    type="button"
                    onClick={saveAnonymousName}
                    aria-label={t('common.save')}
                    title={t('common.save')}
                  >
                    <Check strokeWidth={1.25} className="size-4" />
                  </Button>
                  <Button
                    className="size-11 shrink-0 p-0 tracking-normal"
                    variant="secondary"
                    type="button"
                    onClick={cancelAnonymousNameEdit}
                    aria-label={t('common.cancel')}
                    title={t('common.cancel')}
                  >
                    <X strokeWidth={1.25} className="size-4" />
                  </Button>
                </div>
              )}
              {!profile && showAnonymousNamePrompt && (
                <p className="mt-3 text-caption leading-relaxed text-accent-primary/70">
                  {t('anonymous.firstStartPrompt')}
                </p>
              )}
              {!profile && !editingAnonymousName && (
                <p className="mt-2 text-caption leading-relaxed text-content-primary/40">
                  {t('anonymous.registerHint')}
                </p>
              )}
            </Panel>

            {!profile && (
              <Panel variant="ghost">
                <div className="mb-3 text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                  {t('auth.login')} / {t('auth.register')}
                </div>
                <AuthSection onAuthChanged={handleAuthChanged} />
              </Panel>
            )}

            {/* 當前牌組摘要 */}
            <Panel variant="ghost">
              <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                {t('lobby.currentDeck')}
              </div>
              <div className="mt-1 truncate font-display text-lg font-bold">
                {deck0Name ? resolveDeckLabel(deck0Name, deckOptions) : t('lobby.noDeckSelected')}
              </div>
            </Panel>

            {/* 段位卡 */}
            <Panel variant="ghost">
              <div className="flex items-center justify-between text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                <span>{t('lobby.rank')}</span>
                <span className="text-accent-primary">{rank ? rank.name : t('lobby.guestRank')}</span>
              </div>
              <div className="mt-2 h-1 w-full bg-content-primary/10">
                <div
                  className="h-full bg-gradient-to-r from-accent-action to-accent-primary transition-all"
                  style={{ width: rank ? `${Math.round(rank.progress * 100)}%` : '0%' }}
                />
              </div>
              <div className="mt-1 font-mono text-minutia text-content-primary/40">
                {profile ? `ELO ${profile.elo} · ${profile.wins}/${profile.matchCount}` : t('lobby.loginRequired')}
              </div>
            </Panel>

            {profile && (
              <Panel variant="ghost" data-chat-surface="unread">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <MessageCircle className="size-4 shrink-0 text-accent-primary/80" strokeWidth={1.25} />
                    <div className="min-w-0">
                      <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                        {t('chat.unreadTitle')}
                      </div>
                      <div className="mt-1 truncate font-mono text-sm text-accent-primary">
                        {unreadChatStatus === 'loading'
                          ? t('presence.syncing')
                          : unreadChatTotal > 0
                            ? translate(locale, 'chat.unreadCount').replace('{count}', String(unreadChatTotal))
                            : t('chat.unreadEmpty')}
                      </div>
                    </div>
                  </div>
                  <Button
                    className="size-11 shrink-0 p-0"
                    variant="ghost"
                    type="button"
                    onClick={refreshUnreadChats}
                    aria-label={t('chat.refreshUnread')}
                    title={t('chat.refreshUnread')}
                  >
                    <Radio className="size-3.5" strokeWidth={1.25} />
                  </Button>
                </div>

                {unreadChatStatus === 'unavailable' && (
                  <p className="mt-3 text-caption leading-relaxed text-accent-action/70">
                    {t('chat.unreadUnavailable')}
                  </p>
                )}

                {unreadChats.length > 0 && (
                  <div className="mt-3 grid gap-2">
                    {unreadChats.map((conversation) => {
                      const label =
                        conversation.title ||
                        translate(locale, 'chat.conversationLabel')
                          .replace('{type}', conversation.type)
                          .replace('{subjectId}', conversation.subjectId);
                      const time = conversation.latestMessageAt
                        ? new Date(conversation.latestMessageAt).toLocaleString(locale, {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '';
                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          data-unread-conversation={conversation.type}
                          data-unread-subject={conversation.subjectId}
                          className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm border border-border-soft bg-surface-canvas/40 px-3 py-2 text-left transition hover:border-accent-primary/40 disabled:cursor-default disabled:hover:border-border-soft"
                          onClick={() => openUnreadConversation(conversation)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-xs text-content-primary/80">{label}</span>
                            <span className="mt-1 block truncate text-minutia uppercase tracking-[var(--tracking-label)] text-content-primary/35">
                              {time || conversation.subjectId}
                            </span>
                          </span>
                          <span className="rounded-sm bg-accent-primary/15 px-2 py-1 font-mono text-minutia text-accent-primary">
                            {conversation.unreadCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Panel>
            )}

            {/* 開始匹配 */}
            <div className="grid gap-2">
              <Button
                className="w-full bg-gradient-to-r from-accent-action to-accent-primary py-4 font-display text-lg font-bold tracking-normal text-surface-canvas transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
                type="button"
                onClick={handleQuickMatch}
                disabled={matchmakingActive || !canStart}
                aria-describedby={!canStart ? 'online-quick-match-helper' : undefined}
              >
                {t('lobby.beginMatch')}
              </Button>

              {!canStart && (
                <p id="online-quick-match-helper" className="text-caption leading-relaxed text-accent-action/70">
                  {startDisabledReason}
                </p>
              )}
            </div>

            {matchmakingActive && (
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-caption text-accent-primary/70">
                  <span className="size-1.5 animate-pulse rounded-full bg-accent-action" />
                  {t('lobby.matchmakingSearching')}
                </span>
                {matchmakingCancellable && (
                  <Button
                    className="min-h-11"
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={handleCancelMatchmaking}
                  >
                    {t('lobby.matchmakingCancel')}
                  </Button>
                )}
              </div>
            )}
          </RoomPanel>

          {/* 右：牌組選擇 + 自訂房間 */}
          <section className="flex min-w-0 flex-col gap-4">
            {/* 牌組選擇 */}
            <RoomPanel mode="deck">
              <DeckSelector
                label={t('lobby.myDeck')}
                value={deck0Name}
                options={deckOptions}
                onChange={handleDeckChange}
              />
            </RoomPanel>

            {/* 自訂房間 */}
            <div ref={customRoomPanelRef}>
              <RoomPanel mode="custom">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
                      {t('lobby.customRooms')}
                    </div>
                    <h2 className="font-display text-2xl font-bold">{t('lobby.createRoom')}</h2>
                  </div>
                  <div className="grid gap-2 sm:justify-items-end">
                    <Button
                      className="!min-h-11"
                      size="sm"
                      variant="secondary"
                      type="button"
                      onClick={() => runOnline()}
                      disabled={matchmakingActive || !canStart}
                      aria-describedby={!canStart ? 'online-create-room-helper' : undefined}
                    >
                      + {t('lobby.createRoom')}
                    </Button>

                    {!canStart && (
                      <p
                        id="online-create-room-helper"
                        className="max-w-[18rem] text-left text-caption leading-relaxed text-accent-action/70 sm:text-right"
                      >
                        {startDisabledReason}
                      </p>
                    )}
                  </div>
                </div>

                {/* 加入房間 */}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    className="min-h-11 min-w-0 flex-1"
                    value={matchID}
                    onChange={(event) => {
                      setRoomChatSubjectOverride('');
                      setMatchID(event.target.value.trim());
                    }}
                    placeholder={t('lobby.roomCodePlaceholder')}
                    aria-label={t('lobby.roomCode')}
                    disabled={matchmakingActive}
                  />
                  <Button
                    className="min-h-11"
                    variant="secondary"
                    type="button"
                    disabled={!matchID || matchmakingActive}
                    onClick={() => runOnline(matchID)}
                  >
                    {t('lobby.joinRoom')}
                  </Button>
                </div>

                {serverDeckError && (
                  <Alert tone="danger" role="alert">
                    {serverDeckError}
                  </Alert>
                )}
                {cardsLoadError && (
                  <Alert tone="danger" role="alert">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>{t('game.cardsUnavailable')}</span>
                      <Button type="button" variant="secondary" onClick={() => void onRetryCards?.()}>
                        {t('common.retry')}
                      </Button>
                    </div>
                  </Alert>
                )}

                {/* 已建立房間資訊 */}
                {createdMatchID && (
                  <RoomDetails>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                        {t('online.roomCode')}
                      </span>
                      <span className="font-mono text-xs text-accent-primary">{createdMatchID}</span>
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/40">
                        {t('online.shareLink')}
                      </span>
                      <Input
                        className="min-h-11 min-w-0 font-mono text-xs text-content-primary/70"
                        value={buildOnlineRoomUrl(createdMatchID)}
                        readOnly
                        aria-label={t('online.shareLink')}
                      />
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <Button
                        className="!min-h-11"
                        size="sm"
                        variant="secondary"
                        type="button"
                        onClick={handleCopyShareLink}
                      >
                        {copied ? t('online.copied') : t('online.copyLink')}
                      </Button>
                      <span className="text-caption text-content-primary/40">{t('online.hostWaitingHelper')}</span>
                    </div>
                  </RoomDetails>
                )}

                {profile && (
                  <div
                    className="grid min-h-72 grid-rows-[auto_minmax(0,1fr)_auto] rounded-sm border border-border-soft bg-surface-canvas/30"
                    data-chat-surface="room"
                    data-chat-subject={roomChatSubjectId}
                  >
                    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-soft px-3">
                      <div className="min-w-0">
                        <div className="text-minutia uppercase tracking-[var(--tracking-label)] text-content-primary/35">
                          {t('chat.roomEyebrow')}
                        </div>
                        <div className="truncate font-mono text-xs text-accent-primary">
                          {roomChatSubjectId || t('chat.roomSubjectEmpty')}
                        </div>
                      </div>
                      <MessageCircle className="size-4 shrink-0 text-content-primary/35" strokeWidth={1.25} />
                    </div>

                    <div ref={roomChatMessagesRef} className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
                      {!roomChatSubjectId && (
                        <div className="grid min-h-full place-items-center px-4 text-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/35">
                          {t('chat.roomSubjectEmpty')}
                        </div>
                      )}
                      {roomChatSubjectId && roomChatStatus === 'loading' && (
                        <div className="grid min-h-full place-items-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/35">
                          {t('presence.syncing')}
                        </div>
                      )}
                      {roomChatSubjectId && roomChatStatus === 'unavailable' && (
                        <div className="grid min-h-full place-items-center px-4 text-center text-caption text-accent-action/70">
                          {t('chat.historyUnavailable')}
                        </div>
                      )}
                      {roomChatSubjectId &&
                        roomChatStatus !== 'loading' &&
                        roomChatStatus !== 'unavailable' &&
                        roomChatMessages.length === 0 && (
                          <div className="grid min-h-full place-items-center text-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/35">
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
                            <div className="px-1 pb-1 font-mono text-minutia uppercase tracking-[var(--tracking-label)] text-content-primary/35">
                              <span>{message.authorDisplayName || message.authorUserId || t('auth.guest')}</span>
                              <span className="ml-2 inline-flex items-center gap-1">
                                <Button
                                  className="size-7 p-0 tracking-normal"
                                  variant="ghost"
                                  type="button"
                                  onClick={() => void handleRoomChatTranslate(message)}
                                  disabled={message.translation?.status === 'loading'}
                                  aria-label={t('chat.translate')}
                                  title={t('chat.translate')}
                                >
                                  <Languages className="size-3" strokeWidth={1.25} />
                                </Button>
                                {!self && (
                                  <Button
                                    className="size-7 p-0 tracking-normal"
                                    variant="ghost"
                                    type="button"
                                    onClick={() => void handleRoomChatReport(message)}
                                    disabled={reportedRoomMessageIds.has(message.id)}
                                    aria-label={
                                      reportedRoomMessageIds.has(message.id) ? t('chat.reported') : t('chat.report')
                                    }
                                    title={
                                      reportedRoomMessageIds.has(message.id) ? t('chat.reported') : t('chat.report')
                                    }
                                  >
                                    <Flag className="size-3" strokeWidth={1.25} />
                                  </Button>
                                )}
                              </span>
                            </div>
                            <div
                              className={`rounded-sm border px-3 py-2 text-caption leading-relaxed [overflow-wrap:anywhere] ${
                                self
                                  ? 'border-accent-primary/25 bg-accent-primary/10 text-content-primary'
                                  : 'border-border-soft bg-surface-elevated/50 text-content-primary'
                              }`}
                            >
                              {message.content}
                            </div>
                            {message.translation && (
                              <div
                                className={`mt-1 rounded-sm border px-3 py-2 text-caption leading-relaxed [overflow-wrap:anywhere] ${
                                  message.translation.status === 'ready' && message.translation.content
                                    ? 'border-accent-primary/20 bg-accent-primary/10 text-content-muted'
                                    : 'border-border-soft bg-surface-canvas/40 font-mono uppercase tracking-[var(--tracking-kicker)] text-content-primary/35'
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
                        disabled={
                          !roomChatSubjectId || roomChatStatus === 'sending' || roomChatStatus === 'unavailable'
                        }
                      />
                      <Button
                        className="size-11 p-0 tracking-normal"
                        variant="primary"
                        type="submit"
                        disabled={
                          !roomChatSubjectId ||
                          !roomChatDraft.trim() ||
                          roomChatStatus === 'sending' ||
                          roomChatStatus === 'unavailable'
                        }
                        aria-label={t('chat.send')}
                        title={t('chat.send')}
                      >
                        <Send className="size-4" strokeWidth={1.25} />
                      </Button>
                    </form>
                  </div>
                )}

                {error && (
                  <Alert tone="danger" role="alert">
                    {error}
                  </Alert>
                )}
              </RoomPanel>
            </div>

            {profile && (
              <div ref={directChatPanelRef}>
                <RoomPanel mode="custom" data-chat-surface="direct">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
                        {t('friend.title')}
                      </div>
                      <h2 className="font-display text-2xl font-bold">{t('chat.directTitle')}</h2>
                    </div>
                    <Button
                      className="size-11 shrink-0 p-0 tracking-normal"
                      variant="ghost"
                      type="button"
                      onClick={refreshFriends}
                      aria-label={t('friend.refresh')}
                      title={t('friend.refresh')}
                    >
                      <Radio className="size-3.5" strokeWidth={1.25} />
                    </Button>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      className="min-h-11 min-w-0 flex-1 font-mono text-xs"
                      value={friendUserIdDraft}
                      onChange={(event) => setFriendUserIdDraft(event.target.value.slice(0, 128))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleAddFriend();
                      }}
                      placeholder={t('friend.userId')}
                      aria-label={t('friend.userId')}
                      disabled={friendActionId !== null}
                    />
                    <Button
                      className="min-h-11"
                      variant="secondary"
                      type="button"
                      leftIcon={<UserPlus className="size-4" strokeWidth={1.25} />}
                      disabled={!friendUserIdDraft.trim() || friendActionId !== null}
                      onClick={() => void handleAddFriend()}
                    >
                      {t('friend.add')}
                    </Button>
                  </div>

                  {friendStatus === 'unavailable' && (
                    <Alert tone="danger" role="alert">
                      {t('friend.unavailable')}
                    </Alert>
                  )}

                  <div className="grid gap-2 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                    <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
                      {friendStatus === 'loading' && (
                        <div className="grid min-h-16 place-items-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/35">
                          {t('presence.syncing')}
                        </div>
                      )}
                      {friendStatus !== 'loading' && friends.length === 0 && (
                        <div className="grid min-h-16 place-items-center rounded-sm border border-border-soft bg-surface-canvas/30 px-3 text-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/35">
                          {t('friend.empty')}
                        </div>
                      )}
                      {friends.map((friend) => (
                        <div
                          key={friend.userId}
                          data-friend-user-id={friend.userId}
                          className={`grid min-h-16 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-sm border px-3 py-2 transition ${
                            directChat?.peerUserId === friend.userId
                              ? 'border-accent-primary/50 bg-accent-primary/10'
                              : 'border-border-soft bg-surface-canvas/30'
                          }`}
                        >
                          <button
                            type="button"
                            data-direct-chat-open={friend.userId}
                            className="min-w-0 text-left"
                            onClick={() => openFriendChat(friend)}
                            aria-label={`${t('chat.directTitle')} ${friend.nickname || friend.userId}`}
                          >
                            <span className="block truncate font-mono text-xs text-content-primary/80">
                              {friend.nickname || friend.userId}
                            </span>
                            <span className="mt-1 block truncate text-minutia uppercase tracking-[var(--tracking-label)] text-content-primary/35">
                              {friend.userId}
                            </span>
                          </button>
                          <Button
                            className="size-10 shrink-0 p-0 tracking-normal"
                            variant="ghost"
                            type="button"
                            data-friend-invite-action="send"
                            data-friend-user-id={friend.userId}
                            onClick={() => void handleInviteFriend(friend)}
                            disabled={
                              friendInviteActionId !== null ||
                              friendInvitePeerId !== null ||
                              matchmakingActive ||
                              !canStart
                            }
                            aria-label={t('friend.invite')}
                            title={
                              friendInvitePeerId === friend.userId ? t('friend.inviteWaiting') : t('friend.invite')
                            }
                          >
                            <Send className="size-3.5" strokeWidth={1.25} />
                          </Button>
                          <Button
                            className="size-10 shrink-0 p-0 tracking-normal"
                            variant="ghost"
                            type="button"
                            data-friend-invite-action="accept"
                            data-friend-user-id={friend.userId}
                            onClick={() => void handleAcceptFriendInvite(friend)}
                            disabled={
                              friendInviteActionId !== null ||
                              matchmakingActive ||
                              (friendInvitePeerId !== null && friendInvitePeerId !== friend.userId)
                            }
                            aria-label={t('friend.acceptInvite')}
                            title={
                              friendInviteMode === 'incoming' && friendInvitePeerId === friend.userId
                                ? t('friend.inviteIncoming')
                                : t('friend.acceptInvite')
                            }
                          >
                            <Check className="size-3.5" strokeWidth={1.25} />
                          </Button>
                          <Button
                            className="size-10 shrink-0 p-0 tracking-normal"
                            variant="ghost"
                            type="button"
                            onClick={() => void handleRemoveFriend(friend)}
                            disabled={friendActionId === friend.userId}
                            aria-label={t('friend.remove')}
                            title={t('friend.remove')}
                          >
                            <Trash2 className="size-3.5" strokeWidth={1.25} />
                          </Button>
                        </div>
                      ))}
                    </div>

                    <div className="grid min-h-80 grid-rows-[auto_minmax(0,1fr)_auto] rounded-sm border border-border-soft bg-surface-canvas/30">
                      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-soft px-3">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs text-accent-primary">
                            {directChat ? directChatPeerName : t('chat.directTitle')}
                          </div>
                          <div className="truncate text-minutia uppercase tracking-[var(--tracking-label)] text-content-primary/35">
                            {directChat?.peerUserId || t('friend.empty')}
                          </div>
                        </div>
                        {directChat && (
                          <Button
                            className="size-10 shrink-0 p-0 tracking-normal"
                            variant="ghost"
                            type="button"
                            onClick={() => setDirectChat(null)}
                            aria-label={t('common.close')}
                            title={t('common.close')}
                          >
                            <X className="size-3.5" strokeWidth={1.25} />
                          </Button>
                        )}
                      </div>

                      <div ref={directChatMessagesRef} className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
                        {!directChat && (
                          <div className="grid min-h-full place-items-center text-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/35">
                            {t('chat.selectDirect')}
                          </div>
                        )}
                        {directChat && directChatStatus === 'loading' && (
                          <div className="grid min-h-full place-items-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/35">
                            {t('presence.syncing')}
                          </div>
                        )}
                        {directChat && directChatStatus === 'unavailable' && (
                          <div className="grid min-h-full place-items-center px-4 text-center text-caption text-accent-action/70">
                            {t('chat.historyUnavailable')}
                          </div>
                        )}
                        {directChat &&
                          directChatStatus !== 'loading' &&
                          directChatStatus !== 'unavailable' &&
                          directChatMessages.length === 0 && (
                            <div className="grid min-h-full place-items-center text-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/35">
                              {t('chat.empty')}
                            </div>
                          )}
                        {directChatMessages.map((message) => {
                          const self = message.authorUserId === profile.id;
                          return (
                            <div
                              key={message.id}
                              data-chat-message="direct"
                              className={`max-w-[86%] ${self ? 'self-end text-right' : 'self-start text-left'}`}
                            >
                              <div className="px-1 pb-1 font-mono text-minutia uppercase tracking-[var(--tracking-label)] text-content-primary/35">
                                <span>{message.authorDisplayName || message.authorUserId || t('auth.guest')}</span>
                                <span className="ml-2 inline-flex items-center gap-1">
                                  <Button
                                    className="size-7 p-0 tracking-normal"
                                    variant="ghost"
                                    type="button"
                                    onClick={() => void handleDirectChatTranslate(message)}
                                    disabled={message.translation?.status === 'loading'}
                                    aria-label={t('chat.translate')}
                                    title={t('chat.translate')}
                                  >
                                    <Languages className="size-3" strokeWidth={1.25} />
                                  </Button>
                                  {!self && (
                                    <Button
                                      className="size-7 p-0 tracking-normal"
                                      variant="ghost"
                                      type="button"
                                      onClick={() => void handleDirectChatReport(message)}
                                      disabled={reportedDirectMessageIds.has(message.id)}
                                      aria-label={
                                        reportedDirectMessageIds.has(message.id) ? t('chat.reported') : t('chat.report')
                                      }
                                      title={
                                        reportedDirectMessageIds.has(message.id) ? t('chat.reported') : t('chat.report')
                                      }
                                    >
                                      <Flag className="size-3" strokeWidth={1.25} />
                                    </Button>
                                  )}
                                </span>
                              </div>
                              <div
                                className={`rounded-sm border px-3 py-2 text-caption leading-relaxed [overflow-wrap:anywhere] ${
                                  self
                                    ? 'border-accent-primary/25 bg-accent-primary/10 text-content-primary'
                                    : 'border-border-soft bg-surface-elevated/50 text-content-primary'
                                }`}
                              >
                                {message.content}
                              </div>
                              {message.translation && (
                                <div
                                  className={`mt-1 rounded-sm border px-3 py-2 text-caption leading-relaxed [overflow-wrap:anywhere] ${
                                    message.translation.status === 'ready' && message.translation.content
                                      ? 'border-accent-primary/20 bg-accent-primary/10 text-content-muted'
                                      : 'border-border-soft bg-surface-canvas/40 font-mono uppercase tracking-[var(--tracking-kicker)] text-content-primary/35'
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
                          );
                        })}
                      </div>

                      <form
                        className="grid grid-cols-[minmax(0,1fr)_var(--touch-target-min)] gap-2 border-t border-border-soft p-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleDirectChatSubmit();
                        }}
                      >
                        <Input
                          className="min-h-11 min-w-0"
                          value={directChatDraft}
                          onChange={(event) => setDirectChatDraft(event.target.value.slice(0, 500))}
                          placeholder={t('chat.messagePlaceholder')}
                          aria-label={t('chat.messagePlaceholder')}
                          disabled={!directChat || directChatStatus === 'sending' || directChatStatus === 'unavailable'}
                        />
                        <Button
                          className="size-11 p-0 tracking-normal"
                          variant="primary"
                          type="submit"
                          disabled={
                            !directChat ||
                            !directChatDraft.trim() ||
                            directChatStatus === 'sending' ||
                            directChatStatus === 'unavailable'
                          }
                          aria-label={t('chat.send')}
                          title={t('chat.send')}
                        >
                          <Send className="size-4" strokeWidth={1.25} />
                        </Button>
                      </form>
                    </div>
                  </div>
                </RoomPanel>
              </div>
            )}

            {profile && (
              <div ref={lobbyChatPanelRef}>
                <RoomPanel mode="custom" data-chat-surface="global">
                  <div className="flex flex-col gap-1">
                    <div className="text-caption uppercase tracking-[var(--tracking-kicker)] text-accent-primary/70">
                      {t('chat.globalEyebrow')}
                    </div>
                    <h2 className="font-display text-2xl font-bold">{t('chat.globalTitle')}</h2>
                  </div>

                  <div className="grid min-h-80 grid-rows-[minmax(0,1fr)_auto] rounded-sm border border-border-soft bg-surface-canvas/30">
                    <div ref={lobbyChatMessagesRef} className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
                      {lobbyChatStatus === 'loading' && (
                        <div className="grid min-h-full place-items-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/35">
                          {t('presence.syncing')}
                        </div>
                      )}
                      {lobbyChatStatus === 'unavailable' && (
                        <div className="grid min-h-full place-items-center px-4 text-center text-caption text-accent-action/70">
                          {t('chat.historyUnavailable')}
                        </div>
                      )}
                      {lobbyChatStatus !== 'loading' &&
                        lobbyChatStatus !== 'unavailable' &&
                        lobbyChatMessages.length === 0 && (
                          <div className="grid min-h-full place-items-center text-center font-mono text-caption uppercase tracking-[var(--tracking-kicker)] text-content-primary/35">
                            {t('chat.empty')}
                          </div>
                        )}
                      {lobbyChatMessages.map((message) => {
                        const self = message.authorUserId === profile.id;
                        return (
                          <div
                            key={message.id}
                            data-chat-message="global"
                            className={`max-w-[86%] ${self ? 'self-end text-right' : 'self-start text-left'}`}
                          >
                            <div className="px-1 pb-1 font-mono text-minutia uppercase tracking-[var(--tracking-label)] text-content-primary/35">
                              <span>{message.authorDisplayName || message.authorUserId || t('auth.guest')}</span>
                              <span className="ml-2 inline-flex items-center gap-1">
                                <Button
                                  className="size-7 p-0 tracking-normal"
                                  variant="ghost"
                                  type="button"
                                  onClick={() => void handleLobbyChatTranslate(message)}
                                  disabled={message.translation?.status === 'loading'}
                                  aria-label={t('chat.translate')}
                                  title={t('chat.translate')}
                                >
                                  <Languages className="size-3" strokeWidth={1.25} />
                                </Button>
                                {!self && (
                                  <Button
                                    className="size-7 p-0 tracking-normal"
                                    variant="ghost"
                                    type="button"
                                    onClick={() => void handleLobbyChatReport(message)}
                                    disabled={reportedLobbyMessageIds.has(message.id)}
                                    aria-label={
                                      reportedLobbyMessageIds.has(message.id) ? t('chat.reported') : t('chat.report')
                                    }
                                    title={
                                      reportedLobbyMessageIds.has(message.id) ? t('chat.reported') : t('chat.report')
                                    }
                                  >
                                    <Flag className="size-3" strokeWidth={1.25} />
                                  </Button>
                                )}
                              </span>
                            </div>
                            <div
                              className={`rounded-sm border px-3 py-2 text-caption leading-relaxed [overflow-wrap:anywhere] ${
                                self
                                  ? 'border-accent-primary/25 bg-accent-primary/10 text-content-primary'
                                  : 'border-border-soft bg-surface-elevated/50 text-content-primary'
                              }`}
                            >
                              {message.content}
                            </div>
                            {message.translation && (
                              <div
                                className={`mt-1 rounded-sm border px-3 py-2 text-caption leading-relaxed [overflow-wrap:anywhere] ${
                                  message.translation.status === 'ready' && message.translation.content
                                    ? 'border-accent-primary/20 bg-accent-primary/10 text-content-muted'
                                    : 'border-border-soft bg-surface-canvas/40 font-mono uppercase tracking-[var(--tracking-kicker)] text-content-primary/35'
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
                        );
                      })}
                    </div>

                    <form
                      className="grid grid-cols-[minmax(0,1fr)_var(--touch-target-min)] gap-2 border-t border-border-soft p-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleLobbyChatSubmit();
                      }}
                    >
                      <Input
                        className="min-h-11 min-w-0"
                        value={lobbyChatDraft}
                        onChange={(event) => setLobbyChatDraft(event.target.value.slice(0, 500))}
                        placeholder={t('chat.messagePlaceholder')}
                        aria-label={t('chat.messagePlaceholder')}
                        disabled={lobbyChatStatus === 'sending' || lobbyChatStatus === 'unavailable'}
                      />
                      <Button
                        className="size-11 p-0 tracking-normal"
                        variant="primary"
                        type="submit"
                        disabled={
                          !lobbyChatDraft.trim() || lobbyChatStatus === 'sending' || lobbyChatStatus === 'unavailable'
                        }
                        aria-label={t('chat.send')}
                        title={t('chat.send')}
                      >
                        <Send className="size-4" strokeWidth={1.25} />
                      </Button>
                    </form>
                  </div>
                </RoomPanel>
              </div>
            )}
          </section>
        </div>
      </main>
    </PageShell>
  );
}
