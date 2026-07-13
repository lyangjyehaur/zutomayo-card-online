import type { Client } from '@colyseus/core';

export type PlatformRole = 'player' | 'spectator';
export type MatchShellStatus = 'waiting' | 'ready' | 'in_progress' | 'finished';
export type QuickMatchStatus = 'waiting' | 'matched' | 'cancelled' | 'finished';
export type CustomRoomStatus = 'waiting' | 'ready' | 'cancelled' | 'finished';
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'finished';

export interface PlatformAuth {
  userId: string;
  displayName: string;
  role: PlatformRole;
  authenticated: boolean;
  /** Internal access token retained only for a revocation check on join. */
  accessToken?: string;
}

export interface PlatformClientProfile {
  sessionId: string;
  userId: string;
  displayName: string;
  role: PlatformRole;
  joinedAt: number;
  boardgamePlayerID?: string;
  hasBoardgameCredentials?: boolean;
  /** Canonical deck reserved by the quick-match server. */
  deckName?: string;
}

export type PlatformFriendPresenceEvent = 'online' | 'offline' | 'update';
export type PlatformRelationshipChangeKind =
  | 'friendship_added'
  | 'friendship_removed'
  | 'block_created'
  | 'block_removed'
  | 'account_deleted';

interface PlatformRelationshipChangeBase {
  version: 1;
  eventId: string;
  userIds: string[];
  occurredAt: string;
}

export type PlatformRelationshipChange = PlatformRelationshipChangeBase &
  (
    | { kind: 'block_created' | 'block_removed'; actorUserId: string }
    | {
        kind: Exclude<PlatformRelationshipChangeKind, 'block_created' | 'block_removed'>;
        actorUserId?: string;
      }
  );

export interface PlatformFriendPresence {
  event: PlatformFriendPresenceEvent;
  userId: string;
  online: boolean;
  activeSessionCount: number;
  profiles: PlatformClientProfile[];
  updatedAt: number;
}

export interface PlatformClientMessages {
  lobbySnapshot: {
    roomId: string;
    onlineCount: number;
    friends: PlatformFriendPresence[];
  };
  friendPresence: PlatformFriendPresence;
  roomSnapshot: {
    roomId: string;
    boardgameMatchID?: string;
    status: MatchShellStatus;
    players: PlatformClientProfile[];
    spectators: PlatformClientProfile[];
  };
  presence: {
    event: 'join' | 'leave';
    profile?: PlatformClientProfile;
    players: number;
    spectators: number;
    onlineCount?: number;
  };
  boardgameMatchLinked: {
    boardgameMatchID: string;
    status: MatchShellStatus;
  };
  quickMatchSnapshot: {
    roomId: string;
    status: QuickMatchStatus;
    players: PlatformClientProfile[];
    hostSessionId?: string;
    boardgameMatchID?: string;
  };
  quickMatchMatched: {
    roomId: string;
    role: 'host' | 'guest';
    deckName: string;
    deckReservationId?: string;
    opponent?: PlatformClientProfile;
  };
  quickMatchCancelled: {
    reason: string;
  };
  boardgameMatchReady: {
    boardgameMatchID: string;
  };
  customRoomSnapshot: {
    roomId: string;
    roomCode: string;
    status: CustomRoomStatus;
    host?: PlatformClientProfile;
    players: PlatformClientProfile[];
    spectators: PlatformClientProfile[];
    boardgameMatchID?: string;
  };
  customRoomCancelled: {
    reason: string;
  };
  inviteSnapshot: {
    roomId: string;
    inviteId: string;
    status: InviteStatus;
    inviter?: PlatformClientProfile;
    targetUserId?: string;
    roomCode?: string;
    boardgameMatchID?: string;
    createdAt: number;
    expiresAt: number;
  };
  inviteAccepted: {
    inviteId: string;
    acceptedBy: PlatformClientProfile;
    roomCode?: string;
    boardgameMatchID?: string;
  };
  inviteDeclined: {
    inviteId: string;
    declinedBy?: PlatformClientProfile;
    reason: string;
  };
  inviteCancelled: {
    inviteId: string;
    reason: string;
  };
  chatPreview: {
    conversationId: string;
    messageId: string;
  };
}

export type PlatformClient = Client<{
  auth: PlatformAuth;
  userData: PlatformClientProfile;
  messages: PlatformClientMessages;
}>;

export interface LobbyRoomMetadata {
  kind: 'lobby';
  onlineCount: number;
}

export interface MatchShellRoomMetadata {
  kind: 'match-shell';
  boardgameMatchID?: string;
  status: MatchShellStatus;
  playerCount: number;
  spectatorCount: number;
  conversationId?: string;
}

export interface QuickMatchRoomMetadata {
  kind: 'quick-match';
  status: QuickMatchStatus;
  playerCount: number;
  hostSessionId?: string;
  boardgameMatchID?: string;
}

export interface CustomRoomMetadata {
  kind: 'custom-room';
  roomCode: string;
  status: CustomRoomStatus;
  playerCount: number;
  spectatorCount: number;
  boardgameMatchID?: string;
}

export interface InviteRoomMetadata {
  kind: 'invite';
  inviteId: string;
  status: InviteStatus;
  targetUserId?: string;
  roomCode?: string;
  boardgameMatchID?: string;
}

export interface LobbyJoinOptions {
  userId?: unknown;
  displayName?: unknown;
  role?: unknown;
}

export interface MatchShellRoomOptions extends LobbyJoinOptions {
  boardgameMatchID?: unknown;
  boardgamePlayerID?: unknown;
  hasBoardgameCredentials?: unknown;
  platformSeatToken?: unknown;
  conversationId?: unknown;
  status?: unknown;
  maxPlayers?: unknown;
  maxSpectators?: unknown;
}

export interface QuickMatchRoomOptions extends LobbyJoinOptions {
  deckName?: unknown;
  deckReservationId?: unknown;
  status?: unknown;
}

export interface CustomRoomOptions extends LobbyJoinOptions {
  roomCode?: unknown;
  boardgameMatchID?: unknown;
  status?: unknown;
}

export interface InviteRoomOptions extends LobbyJoinOptions {
  inviteId?: unknown;
  targetUserId?: unknown;
  roomCode?: unknown;
  boardgameMatchID?: unknown;
  status?: unknown;
}

export interface LinkBoardgameMatchMessage {
  boardgameMatchID?: unknown;
}

export interface ChatPreviewMessage {
  messageId?: unknown;
  conversationId?: unknown;
}

export interface BoardgameMatchReadyMessage {
  boardgameMatchID?: unknown;
}

export interface InviteResponseMessage {
  reason?: unknown;
}
