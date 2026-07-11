import type { Room, SeatReservation } from 'colyseus.js';

export type PlatformRole = 'player' | 'spectator';

export interface PlatformLobbyJoinOptions {
  userId: string;
  displayName: string;
  role?: PlatformRole;
}

export interface PlatformLobbyHandlers {
  onOnlineCount: (onlineCount: number) => void;
  onFriendPresence?: (presence: PlatformFriendPresence) => void;
  onDisconnect?: () => void;
}

export interface PlatformMatchShellJoinOptions {
  boardgameMatchID: string;
  userId: string;
  displayName: string;
  role?: PlatformRole;
  boardgamePlayerID?: string;
  hasBoardgameCredentials?: boolean;
  platformSeatToken?: string;
}

export interface PlatformQuickMatchJoinOptions {
  userId: string;
  displayName: string;
  deckName?: string;
}

export interface PlatformCustomRoomOptions {
  roomCode: string;
  boardgameMatchID?: string;
  userId: string;
  displayName: string;
  role?: PlatformRole;
}

export interface PlatformInviteOptions {
  inviteId: string;
  userId: string;
  displayName: string;
  targetUserId?: string;
  roomCode?: string;
  boardgameMatchID?: string;
}

export interface PlatformClientProfile {
  sessionId: string;
  userId: string;
  displayName: string;
  role: PlatformRole;
  joinedAt: number;
  boardgamePlayerID?: string;
  hasBoardgameCredentials?: boolean;
}

export type PlatformFriendPresenceEvent = 'online' | 'offline' | 'update';

export interface PlatformFriendPresence {
  event: PlatformFriendPresenceEvent;
  userId: string;
  online: boolean;
  activeSessionCount: number;
  profiles: PlatformClientProfile[];
  updatedAt: number;
}

export interface PlatformLobbySnapshot {
  roomId: string;
  onlineCount: number;
  friends: PlatformFriendPresence[];
}

export interface PlatformMatchShellSnapshot {
  roomId: string;
  boardgameMatchID?: string;
  status: 'waiting' | 'ready' | 'in_progress' | 'finished';
  players: PlatformClientProfile[];
  spectators: PlatformClientProfile[];
}

export interface PlatformMatchShellPresence {
  players: number;
  spectators: number;
}

export interface PlatformChatPreview {
  conversationId?: string;
  sender: PlatformClientProfile;
  messageId: string;
  createdAt: number;
}

export interface PlatformQuickMatchSnapshot {
  roomId: string;
  status: 'waiting' | 'matched' | 'cancelled' | 'finished';
  players: PlatformClientProfile[];
  hostSessionId?: string;
  boardgameMatchID?: string;
}

export interface PlatformQuickMatchMatched {
  roomId: string;
  role: 'host' | 'guest';
  opponent?: PlatformClientProfile;
}

export interface PlatformBoardgameMatchReady {
  boardgameMatchID: string;
}

export interface PlatformCustomRoomSnapshot {
  roomId: string;
  roomCode: string;
  status: 'waiting' | 'ready' | 'cancelled' | 'finished';
  host?: PlatformClientProfile;
  players: PlatformClientProfile[];
  spectators: PlatformClientProfile[];
  boardgameMatchID?: string;
}

export interface PlatformCustomRoomHandlers {
  onSnapshot?: (snapshot: PlatformCustomRoomSnapshot) => void;
  onBoardgameMatchReady?: (message: PlatformBoardgameMatchReady) => void;
  onCancelled?: (reason: string) => void;
  onDisconnect?: () => void;
}

export interface PlatformInviteSnapshot {
  roomId: string;
  inviteId: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'finished';
  inviter?: PlatformClientProfile;
  targetUserId?: string;
  roomCode?: string;
  boardgameMatchID?: string;
  createdAt: number;
  expiresAt: number;
}

export interface PlatformInviteAccepted {
  inviteId: string;
  acceptedBy: PlatformClientProfile;
  roomCode?: string;
  boardgameMatchID?: string;
}

export interface PlatformInviteDeclined {
  inviteId: string;
  declinedBy?: PlatformClientProfile;
  reason: string;
}

export interface PlatformInviteCancelled {
  inviteId: string;
  reason: string;
}

export interface PlatformInviteHandlers {
  onSnapshot?: (snapshot: PlatformInviteSnapshot) => void;
  onAccepted?: (message: PlatformInviteAccepted) => void;
  onBoardgameMatchReady?: (message: PlatformBoardgameMatchReady) => void;
  onDeclined?: (message: PlatformInviteDeclined) => void;
  onCancelled?: (message: PlatformInviteCancelled) => void;
  onDisconnect?: () => void;
}

export interface PlatformQuickMatchHandlers {
  onSnapshot?: (snapshot: PlatformQuickMatchSnapshot) => void;
  onMatched?: (match: PlatformQuickMatchMatched) => void;
  onBoardgameMatchReady?: (message: PlatformBoardgameMatchReady) => void;
  onCancelled?: (reason: string) => void;
  onDisconnect?: () => void;
}

export interface PlatformMatchShellHandlers {
  onSnapshot?: (snapshot: PlatformMatchShellSnapshot) => void;
  onPresence?: (presence: PlatformMatchShellPresence) => void;
  onChatPreview?: (message: PlatformChatPreview) => void;
  onDisconnect?: () => void;
}

interface LocationLike {
  protocol: string;
  hostname: string;
  port: string;
}

export type PlatformLobbyRoom = Room<unknown>;
export type PlatformCustomRoom = Room<unknown>;
export type PlatformInviteRoom = Room<unknown>;
export type PlatformMatchShellRoom = Room<unknown>;
export type PlatformQuickMatchRoom = Room<unknown>;

interface FlatSeatReservation {
  name: string;
  roomId: string;
  sessionId: string;
  processId?: string;
  protocol?: string;
  reconnectionToken?: string;
  devMode?: boolean;
}

function readConfiguredPlatformUrl(): string | undefined {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return viteEnv?.VITE_PLATFORM_URL ?? (typeof process === 'undefined' ? undefined : process.env.VITE_PLATFORM_URL);
}

export function resolvePlatformEndpoint(
  configuredUrl = readConfiguredPlatformUrl(),
  location: LocationLike | undefined = typeof window === 'undefined' ? undefined : window.location,
): string {
  const trimmed = configuredUrl?.trim();
  if (trimmed) return trimmed;

  if (!location) return 'ws://127.0.0.1:3002';

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = location.port === '3000' || location.port === '5173' ? '3002' : location.port;
  return `${protocol}//${location.hostname}${port ? `:${port}` : ''}`;
}

export function platformOnlineCountFromMessage(message: unknown): number | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as { onlineCount?: unknown; players?: unknown; spectators?: unknown };
  if (Number.isFinite(data.onlineCount)) return Math.max(0, Math.trunc(data.onlineCount as number));
  if (Number.isFinite(data.players) && Number.isFinite(data.spectators)) {
    return Math.max(0, Math.trunc((data.players as number) + (data.spectators as number)));
  }
  return null;
}

function platformProfileFromMessage(value: unknown): PlatformClientProfile | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<PlatformClientProfile>;
  if (typeof data.sessionId !== 'string' || typeof data.userId !== 'string') return null;
  const profile: PlatformClientProfile = {
    sessionId: data.sessionId,
    userId: data.userId,
    displayName: typeof data.displayName === 'string' ? data.displayName : 'Player',
    role: data.role === 'player' || data.role === 'spectator' ? data.role : 'spectator',
    joinedAt: Number.isFinite(data.joinedAt) ? Math.trunc(data.joinedAt as number) : Date.now(),
  };
  if (data.boardgamePlayerID === '0' || data.boardgamePlayerID === '1') {
    profile.boardgamePlayerID = data.boardgamePlayerID;
  }
  if (data.hasBoardgameCredentials === true) {
    profile.hasBoardgameCredentials = true;
  }
  return profile;
}

export function platformFriendPresenceFromMessage(message: unknown): PlatformFriendPresence | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as {
    event?: unknown;
    userId?: unknown;
    online?: unknown;
    activeSessionCount?: unknown;
    profiles?: unknown;
    updatedAt?: unknown;
  };
  if (data.event !== 'online' && data.event !== 'offline' && data.event !== 'update') return null;
  if (typeof data.userId !== 'string' || !data.userId.trim()) return null;
  const profiles = Array.isArray(data.profiles)
    ? data.profiles
        .map(platformProfileFromMessage)
        .filter((profile): profile is PlatformClientProfile => Boolean(profile))
    : [];
  return {
    event: data.event,
    userId: data.userId.trim().slice(0, 128),
    online: typeof data.online === 'boolean' ? data.online : profiles.length > 0,
    activeSessionCount: Number.isFinite(data.activeSessionCount)
      ? Math.max(0, Math.trunc(data.activeSessionCount as number))
      : profiles.length,
    profiles,
    updatedAt: Number.isFinite(data.updatedAt) ? Math.trunc(data.updatedAt as number) : Date.now(),
  };
}

export function platformLobbySnapshotFromMessage(message: unknown): PlatformLobbySnapshot | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as { roomId?: unknown; onlineCount?: unknown; friends?: unknown };
  if (typeof data.roomId !== 'string' || !Number.isFinite(data.onlineCount)) return null;
  const friends = Array.isArray(data.friends)
    ? data.friends
        .map(platformFriendPresenceFromMessage)
        .filter((presence): presence is PlatformFriendPresence => Boolean(presence))
    : [];
  return {
    roomId: data.roomId,
    onlineCount: Math.max(0, Math.trunc(data.onlineCount as number)),
    friends,
  };
}

export function normalizeSeatReservation(response: FlatSeatReservation | SeatReservation): SeatReservation {
  if ('room' in response) return response;
  const room = {
    name: response.name,
    roomId: response.roomId,
    processId: response.processId,
    clients: 0,
    maxClients: 0,
  } as SeatReservation['room'] & { processId?: string };

  return {
    sessionId: response.sessionId,
    protocol: response.protocol,
    reconnectionToken: response.reconnectionToken,
    devMode: response.devMode,
    room,
  };
}

async function joinPlatformRoom(
  roomName: string,
  options: Record<string, unknown>,
  method: 'joinOrCreate' | 'create' | 'join' = 'joinOrCreate',
): Promise<Room<unknown>> {
  const { Client } = await import('colyseus.js');
  const client = new Client(resolvePlatformEndpoint());
  const response = await client.http.post(`matchmake/${method}/${roomName}`, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  });
  return client.consumeSeatReservation(normalizeSeatReservation(response.data as FlatSeatReservation));
}

export async function connectPlatformLobby(
  options: PlatformLobbyJoinOptions,
  handlers: PlatformLobbyHandlers,
): Promise<PlatformLobbyRoom> {
  const room = await joinPlatformRoom('lobby', {
    userId: options.userId,
    displayName: options.displayName,
    role: options.role ?? 'spectator',
  });

  const handlePresence = (message: unknown) => {
    const onlineCount = platformOnlineCountFromMessage(message);
    if (onlineCount !== null) handlers.onOnlineCount(onlineCount);
  };

  room.onMessage('lobbySnapshot', (message) => {
    const snapshot = platformLobbySnapshotFromMessage(message);
    if (snapshot) {
      handlers.onOnlineCount(snapshot.onlineCount);
      snapshot.friends.forEach((presence) => handlers.onFriendPresence?.(presence));
      return;
    }
    handlePresence(message);
  });
  room.onMessage('presence', handlePresence);
  room.onMessage('friendPresence', (message) => {
    const presence = platformFriendPresenceFromMessage(message);
    if (presence) handlers.onFriendPresence?.(presence);
  });
  room.onLeave(() => handlers.onDisconnect?.());

  return room;
}

export function platformPresenceFromMatchShellMessage(message: unknown): PlatformMatchShellPresence | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as { players?: unknown; spectators?: unknown };
  if (!Number.isFinite(data.players) || !Number.isFinite(data.spectators)) return null;
  return {
    players: Math.max(0, Math.trunc(data.players as number)),
    spectators: Math.max(0, Math.trunc(data.spectators as number)),
  };
}

export function platformChatPreviewFromMessage(message: unknown): PlatformChatPreview | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as {
    conversationId?: unknown;
    sender?: Partial<PlatformClientProfile>;
    messageId?: unknown;
    createdAt?: unknown;
    content?: unknown;
    text?: unknown;
    translatedContent?: unknown;
    metadata?: unknown;
  };
  if (
    data.content !== undefined ||
    data.text !== undefined ||
    data.translatedContent !== undefined ||
    data.metadata !== undefined
  ) {
    return null;
  }
  if (typeof data.messageId !== 'string' || !data.messageId.trim()) return null;
  if (!data.sender || typeof data.sender !== 'object') return null;
  if (typeof data.sender.sessionId !== 'string' || typeof data.sender.userId !== 'string') return null;
  return {
    conversationId: typeof data.conversationId === 'string' ? data.conversationId : undefined,
    sender: {
      sessionId: data.sender.sessionId,
      userId: data.sender.userId,
      displayName: typeof data.sender.displayName === 'string' ? data.sender.displayName : 'Player',
      role: data.sender.role === 'player' || data.sender.role === 'spectator' ? data.sender.role : 'spectator',
      joinedAt: Number.isFinite(data.sender.joinedAt) ? Math.trunc(data.sender.joinedAt as number) : Date.now(),
    },
    messageId: data.messageId.trim().slice(0, 128),
    createdAt: Number.isFinite(data.createdAt) ? Math.trunc(data.createdAt as number) : Date.now(),
  };
}

export function platformQuickMatchSnapshotFromMessage(message: unknown): PlatformQuickMatchSnapshot | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as {
    roomId?: unknown;
    status?: unknown;
    players?: unknown;
    hostSessionId?: unknown;
    boardgameMatchID?: unknown;
  };
  if (typeof data.roomId !== 'string') return null;
  if (
    data.status !== 'waiting' &&
    data.status !== 'matched' &&
    data.status !== 'cancelled' &&
    data.status !== 'finished'
  ) {
    return null;
  }
  const players = Array.isArray(data.players)
    ? data.players
        .map(platformProfileFromMessage)
        .filter((profile): profile is PlatformClientProfile => Boolean(profile))
    : [];
  return {
    roomId: data.roomId,
    status: data.status,
    players,
    hostSessionId: typeof data.hostSessionId === 'string' ? data.hostSessionId : undefined,
    boardgameMatchID: typeof data.boardgameMatchID === 'string' ? data.boardgameMatchID : undefined,
  };
}

export function platformQuickMatchMatchedFromMessage(message: unknown): PlatformQuickMatchMatched | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as { roomId?: unknown; role?: unknown; opponent?: unknown };
  if (typeof data.roomId !== 'string') return null;
  if (data.role !== 'host' && data.role !== 'guest') return null;
  return {
    roomId: data.roomId,
    role: data.role,
    opponent: platformProfileFromMessage(data.opponent) ?? undefined,
  };
}

export function platformBoardgameMatchReadyFromMessage(message: unknown): PlatformBoardgameMatchReady | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as { boardgameMatchID?: unknown };
  if (typeof data.boardgameMatchID !== 'string' || !data.boardgameMatchID.trim()) return null;
  return { boardgameMatchID: data.boardgameMatchID.trim().slice(0, 128) };
}

export function isPlatformBoardgameRelayAcknowledged(
  expectedBoardgameMatchID: string | undefined,
  message: PlatformBoardgameMatchReady,
): boolean {
  const expected = expectedBoardgameMatchID?.trim().slice(0, 128);
  return Boolean(expected && expected === message.boardgameMatchID);
}

export function shouldLinkPlatformMatchShell(options: PlatformMatchShellJoinOptions): boolean {
  return (
    (options.role ?? 'spectator') === 'player' &&
    options.hasBoardgameCredentials === true &&
    Boolean(options.platformSeatToken)
  );
}

export function platformCustomRoomSnapshotFromMessage(message: unknown): PlatformCustomRoomSnapshot | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as {
    roomId?: unknown;
    roomCode?: unknown;
    status?: unknown;
    host?: unknown;
    players?: unknown;
    spectators?: unknown;
    boardgameMatchID?: unknown;
  };
  if (typeof data.roomId !== 'string' || typeof data.roomCode !== 'string') return null;
  if (
    data.status !== 'waiting' &&
    data.status !== 'ready' &&
    data.status !== 'cancelled' &&
    data.status !== 'finished'
  ) {
    return null;
  }
  const players = Array.isArray(data.players)
    ? data.players
        .map(platformProfileFromMessage)
        .filter((profile): profile is PlatformClientProfile => Boolean(profile))
    : [];
  const spectators = Array.isArray(data.spectators)
    ? data.spectators
        .map(platformProfileFromMessage)
        .filter((profile): profile is PlatformClientProfile => Boolean(profile))
    : [];
  return {
    roomId: data.roomId,
    roomCode: data.roomCode,
    status: data.status,
    host: platformProfileFromMessage(data.host) ?? undefined,
    players,
    spectators,
    boardgameMatchID: typeof data.boardgameMatchID === 'string' ? data.boardgameMatchID : undefined,
  };
}

function bindPlatformCustomRoomHandlers(room: Room<unknown>, handlers: PlatformCustomRoomHandlers): PlatformCustomRoom {
  room.onMessage('customRoomSnapshot', (message) => {
    const snapshot = platformCustomRoomSnapshotFromMessage(message);
    if (snapshot) handlers.onSnapshot?.(snapshot);
  });
  room.onMessage('boardgameMatchReady', (message) => {
    const ready = platformBoardgameMatchReadyFromMessage(message);
    if (ready) handlers.onBoardgameMatchReady?.(ready);
  });
  room.onMessage('customRoomCancelled', (message) => {
    const reason =
      message && typeof message === 'object' && typeof (message as { reason?: unknown }).reason === 'string'
        ? (message as { reason: string }).reason
        : 'cancelled';
    handlers.onCancelled?.(reason);
  });
  room.onLeave(() => handlers.onDisconnect?.());
  return room;
}

export async function createPlatformCustomRoom(
  options: PlatformCustomRoomOptions,
  handlers: PlatformCustomRoomHandlers = {},
): Promise<PlatformCustomRoom> {
  const room = await joinPlatformRoom(
    'custom_room',
    {
      roomCode: options.roomCode,
      boardgameMatchID: options.boardgameMatchID,
      userId: options.userId,
      displayName: options.displayName,
      role: 'player',
      status: 'waiting',
    },
    'joinOrCreate',
  );
  return bindPlatformCustomRoomHandlers(room, handlers);
}

export async function joinPlatformCustomRoom(
  options: PlatformCustomRoomOptions,
  handlers: PlatformCustomRoomHandlers = {},
): Promise<PlatformCustomRoom> {
  const joinWithStatus = (status: 'waiting' | 'ready') =>
    joinPlatformRoom(
      'custom_room',
      {
        roomCode: options.roomCode,
        userId: options.userId,
        displayName: options.displayName,
        role: options.role ?? 'player',
        status,
      },
      'join',
    );
  const room = await joinWithStatus('waiting').catch(() => joinWithStatus('ready'));
  return bindPlatformCustomRoomHandlers(room, handlers);
}

export function platformInviteSnapshotFromMessage(message: unknown): PlatformInviteSnapshot | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as {
    roomId?: unknown;
    inviteId?: unknown;
    status?: unknown;
    inviter?: unknown;
    targetUserId?: unknown;
    roomCode?: unknown;
    boardgameMatchID?: unknown;
    createdAt?: unknown;
    expiresAt?: unknown;
  };
  if (typeof data.roomId !== 'string' || typeof data.inviteId !== 'string') return null;
  if (
    data.status !== 'pending' &&
    data.status !== 'accepted' &&
    data.status !== 'declined' &&
    data.status !== 'cancelled' &&
    data.status !== 'expired' &&
    data.status !== 'finished'
  ) {
    return null;
  }
  return {
    roomId: data.roomId,
    inviteId: data.inviteId,
    status: data.status,
    inviter: platformProfileFromMessage(data.inviter) ?? undefined,
    targetUserId: typeof data.targetUserId === 'string' ? data.targetUserId : undefined,
    roomCode: typeof data.roomCode === 'string' ? data.roomCode : undefined,
    boardgameMatchID: typeof data.boardgameMatchID === 'string' ? data.boardgameMatchID : undefined,
    createdAt: Number.isFinite(data.createdAt) ? Math.trunc(data.createdAt as number) : Date.now(),
    expiresAt: Number.isFinite(data.expiresAt) ? Math.trunc(data.expiresAt as number) : Date.now(),
  };
}

export function platformInviteAcceptedFromMessage(message: unknown): PlatformInviteAccepted | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as { inviteId?: unknown; acceptedBy?: unknown; roomCode?: unknown; boardgameMatchID?: unknown };
  const acceptedBy = platformProfileFromMessage(data.acceptedBy);
  if (typeof data.inviteId !== 'string' || !acceptedBy) return null;
  return {
    inviteId: data.inviteId,
    acceptedBy,
    roomCode: typeof data.roomCode === 'string' ? data.roomCode : undefined,
    boardgameMatchID: typeof data.boardgameMatchID === 'string' ? data.boardgameMatchID : undefined,
  };
}

export function platformInviteDeclinedFromMessage(message: unknown): PlatformInviteDeclined | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as { inviteId?: unknown; declinedBy?: unknown; reason?: unknown };
  if (typeof data.inviteId !== 'string') return null;
  return {
    inviteId: data.inviteId,
    declinedBy: platformProfileFromMessage(data.declinedBy) ?? undefined,
    reason: typeof data.reason === 'string' ? data.reason : 'declined',
  };
}

export function platformInviteCancelledFromMessage(message: unknown): PlatformInviteCancelled | null {
  if (!message || typeof message !== 'object') return null;
  const data = message as { inviteId?: unknown; reason?: unknown };
  if (typeof data.inviteId !== 'string') return null;
  return {
    inviteId: data.inviteId,
    reason: typeof data.reason === 'string' ? data.reason : 'cancelled',
  };
}

function bindPlatformInviteHandlers(room: Room<unknown>, handlers: PlatformInviteHandlers): PlatformInviteRoom {
  room.onMessage('inviteSnapshot', (message) => {
    const snapshot = platformInviteSnapshotFromMessage(message);
    if (snapshot) handlers.onSnapshot?.(snapshot);
  });
  room.onMessage('inviteAccepted', (message) => {
    const accepted = platformInviteAcceptedFromMessage(message);
    if (accepted) handlers.onAccepted?.(accepted);
  });
  room.onMessage('inviteDeclined', (message) => {
    const declined = platformInviteDeclinedFromMessage(message);
    if (declined) handlers.onDeclined?.(declined);
  });
  room.onMessage('inviteCancelled', (message) => {
    const cancelled = platformInviteCancelledFromMessage(message);
    if (cancelled) handlers.onCancelled?.(cancelled);
  });
  room.onMessage('boardgameMatchReady', (message) => {
    const ready = platformBoardgameMatchReadyFromMessage(message);
    if (ready) handlers.onBoardgameMatchReady?.(ready);
  });
  room.onLeave(() => handlers.onDisconnect?.());
  return room;
}

export function buildPlatformFriendInviteId(inviterUserId: string, targetUserId: string): string {
  return `friend:v1:${encodeURIComponent(inviterUserId)}:${encodeURIComponent(targetUserId)}`;
}

export async function createPlatformInvite(
  options: PlatformInviteOptions,
  handlers: PlatformInviteHandlers = {},
): Promise<PlatformInviteRoom> {
  const room = await joinPlatformRoom(
    'invite',
    {
      inviteId: options.inviteId,
      targetUserId: options.targetUserId,
      roomCode: options.roomCode,
      boardgameMatchID: options.boardgameMatchID,
      userId: options.userId,
      displayName: options.displayName,
      role: 'player',
      status: 'pending',
    },
    'create',
  );
  return bindPlatformInviteHandlers(room, handlers);
}

export async function joinPlatformInvite(
  options: PlatformInviteOptions,
  handlers: PlatformInviteHandlers = {},
): Promise<PlatformInviteRoom> {
  const room = await joinPlatformRoom(
    'invite',
    {
      inviteId: options.inviteId,
      targetUserId: options.targetUserId,
      userId: options.userId,
      displayName: options.displayName,
      role: 'player',
      status: 'pending',
    },
    'join',
  );
  return bindPlatformInviteHandlers(room, handlers);
}

export async function connectPlatformQuickMatch(
  options: PlatformQuickMatchJoinOptions,
  handlers: PlatformQuickMatchHandlers,
): Promise<PlatformQuickMatchRoom> {
  const room = await joinPlatformRoom('quick_match', {
    userId: options.userId,
    displayName: options.displayName,
    role: 'player',
    deckName: options.deckName,
    status: 'waiting',
  });

  room.onMessage('quickMatchSnapshot', (message) => {
    const snapshot = platformQuickMatchSnapshotFromMessage(message);
    if (snapshot) handlers.onSnapshot?.(snapshot);
  });
  room.onMessage('quickMatchMatched', (message) => {
    const matched = platformQuickMatchMatchedFromMessage(message);
    if (matched) handlers.onMatched?.(matched);
  });
  room.onMessage('boardgameMatchReady', (message) => {
    const ready = platformBoardgameMatchReadyFromMessage(message);
    if (ready) handlers.onBoardgameMatchReady?.(ready);
  });
  room.onMessage('quickMatchCancelled', (message) => {
    const reason =
      message && typeof message === 'object' && typeof (message as { reason?: unknown }).reason === 'string'
        ? (message as { reason: string }).reason
        : 'cancelled';
    handlers.onCancelled?.(reason);
  });
  room.onLeave(() => handlers.onDisconnect?.());

  return room;
}

export async function connectPlatformMatchShell(
  options: PlatformMatchShellJoinOptions,
  handlers: PlatformMatchShellHandlers,
): Promise<PlatformMatchShellRoom> {
  const room = await joinPlatformRoom('match_shell', {
    boardgameMatchID: options.boardgameMatchID,
    userId: options.userId,
    displayName: options.displayName,
    role: options.role ?? 'spectator',
    status: 'ready',
    boardgamePlayerID: options.boardgamePlayerID,
    hasBoardgameCredentials: options.hasBoardgameCredentials === true,
    platformSeatToken: options.platformSeatToken,
  });

  room.onMessage<PlatformMatchShellSnapshot>('roomSnapshot', (snapshot) => {
    handlers.onSnapshot?.(snapshot);
    handlers.onPresence?.({
      players: snapshot.players.length,
      spectators: snapshot.spectators.length,
    });
  });
  room.onMessage('presence', (message) => {
    const presence = platformPresenceFromMatchShellMessage(message);
    if (presence) handlers.onPresence?.(presence);
  });
  room.onMessage('chatPreview', (message) => {
    const preview = platformChatPreviewFromMessage(message);
    if (preview) handlers.onChatPreview?.(preview);
  });
  room.onMessage('boardgameMatchLinked', () => undefined);
  room.onLeave(() => handlers.onDisconnect?.());
  if (shouldLinkPlatformMatchShell(options)) {
    room.send('linkBoardgameMatch', { boardgameMatchID: options.boardgameMatchID });
  }

  return room;
}
