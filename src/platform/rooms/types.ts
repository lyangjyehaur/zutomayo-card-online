import type { Client } from '@colyseus/core';

export type PlatformRole = 'player' | 'spectator' | 'moderator';
export type MatchShellStatus = 'waiting' | 'ready' | 'in_progress' | 'finished';

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

export interface LinkBoardgameMatchMessage {
  boardgameMatchID?: unknown;
}

export interface ChatPreviewMessage {
  text?: unknown;
  conversationId?: unknown;
}
