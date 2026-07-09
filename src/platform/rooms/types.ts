import type { Client } from '@colyseus/core';

export type PlatformRole = 'player' | 'spectator' | 'moderator';
export type MatchShellStatus = 'waiting' | 'ready' | 'in_progress' | 'finished';
export type QuickMatchStatus = 'waiting' | 'matched' | 'cancelled' | 'finished';
export type CustomRoomStatus = 'waiting' | 'ready' | 'cancelled' | 'finished';
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface PlatformAuth {
  userId: string;
  displayName: string;
  role: PlatformRole;
}

export interface PlatformClientProfile {
  sessionId: string;
  userId: string;
  displayName: string;
  role: PlatformRole;
  joinedAt: number;
}

export interface PlatformClientMessages {
  lobbySnapshot: {
    roomId: string;
    onlineCount: number;
  };
  roomSnapshot: {
    roomId: string;
    boardgameMatchID?: string;
    status: MatchShellStatus;
    players: PlatformClientProfile[];
    spectators: PlatformClientProfile[];
  };
  presence: {
    event: 'join' | 'leave';
    profile: PlatformClientProfile;
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
    conversationId?: string;
    sender: PlatformClientProfile;
    text: string;
    createdAt: number;
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
  conversationId?: unknown;
  maxPlayers?: unknown;
  maxSpectators?: unknown;
}

export interface QuickMatchRoomOptions extends LobbyJoinOptions {
  deckName?: unknown;
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
}

export interface LinkBoardgameMatchMessage {
  boardgameMatchID?: unknown;
}

export interface ChatPreviewMessage {
  text?: unknown;
  conversationId?: unknown;
}

export interface BoardgameMatchReadyMessage {
  boardgameMatchID?: unknown;
}

export interface InviteResponseMessage {
  reason?: unknown;
}
