import { Room, type AuthContext } from '@colyseus/core';
import { authenticatePlatformClient } from './auth';
import type {
  ChatPreviewMessage,
  LinkBoardgameMatchMessage,
  MatchShellRoomMetadata,
  MatchShellRoomOptions,
  MatchShellStatus,
  PlatformAuth,
  PlatformClient,
  PlatformClientProfile,
} from './types';

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(1, Math.min(value as number, max));
}

function boardgamePlayerIDFromOptions(options: MatchShellRoomOptions, role: PlatformAuth['role']): string | undefined {
  if (role !== 'player') return undefined;
  if (options.boardgamePlayerID !== '0' && options.boardgamePlayerID !== '1') return undefined;
  return options.boardgamePlayerID;
}

function hasValidBoardgamePlayerSeat(options: MatchShellRoomOptions): boolean {
  return (
    options.hasBoardgameCredentials === true && (options.boardgamePlayerID === '0' || options.boardgamePlayerID === '1')
  );
}

function normalizeStatus(value: unknown, boardgameMatchID?: string): MatchShellStatus {
  if (value === 'waiting' || value === 'ready' || value === 'in_progress' || value === 'finished') return value;
  return boardgameMatchID ? 'ready' : 'waiting';
}

function canLinkBoardgameMatch(profile: PlatformClientProfile | undefined): boolean {
  if (!profile) return false;
  if (profile.role === 'moderator') return true;
  return profile.role === 'player' && profile.hasBoardgameCredentials === true;
}

function sameBoardgameMatchID(current: string | undefined, next: unknown): boolean {
  if (!current) return true;
  return optionalText(next, 128) === current;
}

function matchConversationId(boardgameMatchID: string | undefined): string | undefined {
  return boardgameMatchID ? `match:${boardgameMatchID}` : undefined;
}

function normalizeMatchConversationId(value: unknown, boardgameMatchID: string | undefined): string | undefined {
  const expectedConversationId = matchConversationId(boardgameMatchID);
  if (!expectedConversationId) return undefined;
  const suppliedConversationId = optionalText(value, 128);
  return suppliedConversationId === expectedConversationId ? suppliedConversationId : expectedConversationId;
}

export class MatchShellRoom extends Room<{ metadata: MatchShellRoomMetadata; client: PlatformClient }> {
  private boardgameMatchID?: string;
  private conversationId?: string;
  private status: MatchShellStatus = 'waiting';
  private maxPlayerSeats = 2;

  async onCreate(options: MatchShellRoomOptions = {}): Promise<void> {
    this.maxPlayerSeats = positiveInteger(options.maxPlayers, 2, 8);
    const maxSpectators = positiveInteger(options.maxSpectators, 98, 500);
    this.maxClients = this.maxPlayerSeats + maxSpectators;
    this.boardgameMatchID = optionalText(options.boardgameMatchID, 128);
    this.conversationId = normalizeMatchConversationId(options.conversationId, this.boardgameMatchID);
    this.status = normalizeStatus(options.status, this.boardgameMatchID);
    this.maxMessagesPerSecond = 6;

    this.onMessage<LinkBoardgameMatchMessage>('linkBoardgameMatch', (client, message) => {
      if (!canLinkBoardgameMatch(client.userData)) return;
      const boardgameMatchID = optionalText(message.boardgameMatchID, 128);
      if (!boardgameMatchID) return;
      void this.linkBoardgameMatch(boardgameMatchID);
    });

    this.onMessage<ChatPreviewMessage>('chatPreview', (client, message) => {
      const text = optionalText(message.text, 500);
      if (!text || !client.userData || !client.auth?.authenticated) return;
      const suppliedConversationId = optionalText(message.conversationId, 128);
      if (!this.conversationId || (suppliedConversationId && suppliedConversationId !== this.conversationId)) return;
      this.broadcast('chatPreview', {
        conversationId: this.conversationId,
        sender: client.userData,
        text,
        createdAt: Date.now(),
      });
    });

    await this.refreshMetadata();
  }

  onAuth(_client: PlatformClient, options: MatchShellRoomOptions, context: AuthContext): PlatformAuth {
    if (!sameBoardgameMatchID(this.boardgameMatchID, options.boardgameMatchID)) {
      throw new Error('Match shell access denied');
    }
    const auth = authenticatePlatformClient(options, context);
    if (auth.role === 'player' && !hasValidBoardgamePlayerSeat(options)) {
      return { ...auth, role: 'spectator' };
    }
    const existingSeatHolder = this.playerProfileByBoardgamePlayerID(options.boardgamePlayerID);
    if (auth.role === 'player' && existingSeatHolder && existingSeatHolder.userId !== auth.userId) {
      return { ...auth, role: 'spectator' };
    }
    const currentPlayers = this.clients.filter((client) => client.userData?.role === 'player').length;
    if (auth.role === 'player' && currentPlayers >= this.maxPlayerSeats && !existingSeatHolder) {
      return { ...auth, role: 'spectator' };
    }
    return auth;
  }

  async onJoin(client: PlatformClient, options: MatchShellRoomOptions): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new Error('Missing platform auth');
    const role = this.resolveRole(auth.role, options, auth.userId);
    const boardgamePlayerID = boardgamePlayerIDFromOptions(options, role);
    if (role === 'player' && boardgamePlayerID) {
      this.releaseReconnectSeat(boardgamePlayerID, auth.userId, client.sessionId);
    }
    client.userData = {
      sessionId: client.sessionId,
      userId: auth.userId,
      displayName: auth.displayName,
      role,
      joinedAt: Date.now(),
      boardgamePlayerID,
      hasBoardgameCredentials: role === 'player' && options.hasBoardgameCredentials === true,
    };

    await this.refreshMetadata();
    client.send('roomSnapshot', this.snapshot());
    this.broadcastPresence('join', client.userData);
  }

  async onLeave(client: PlatformClient): Promise<void> {
    const profile = client.userData;
    await this.refreshMetadata();
    if (profile) this.broadcastPresence('leave', profile);
  }

  private resolveRole(
    requestedRole: PlatformAuth['role'],
    options: MatchShellRoomOptions = {},
    userId = '',
  ): PlatformAuth['role'] {
    if (requestedRole !== 'player') return requestedRole;
    const existingSeatHolder = this.playerProfileByBoardgamePlayerID(options.boardgamePlayerID);
    if (existingSeatHolder?.userId === userId) return 'player';
    const currentPlayers = this.clients.filter((client) => client.userData?.role === 'player').length;
    return currentPlayers >= this.maxPlayerSeats ? 'spectator' : 'player';
  }

  private playerProfileByBoardgamePlayerID(boardgamePlayerID: unknown): PlatformClientProfile | undefined {
    if (boardgamePlayerID !== '0' && boardgamePlayerID !== '1') return undefined;
    return this.profiles('player').find((profile) => profile.boardgamePlayerID === boardgamePlayerID);
  }

  private releaseReconnectSeat(boardgamePlayerID: string, userId: string, currentSessionId: string): void {
    for (const client of this.clients) {
      const profile = client.userData;
      if (!profile || profile.sessionId === currentSessionId) continue;
      if (profile.role !== 'player' || profile.boardgamePlayerID !== boardgamePlayerID || profile.userId !== userId) {
        continue;
      }
      profile.role = 'spectator';
      profile.boardgamePlayerID = undefined;
      profile.hasBoardgameCredentials = false;
    }
  }

  private async linkBoardgameMatch(boardgameMatchID: string): Promise<void> {
    if (this.boardgameMatchID && this.boardgameMatchID !== boardgameMatchID) return;
    this.boardgameMatchID = boardgameMatchID;
    this.conversationId = matchConversationId(boardgameMatchID);
    this.status = 'ready';
    await this.refreshMetadata();
    this.broadcast('boardgameMatchLinked', {
      boardgameMatchID,
      status: this.status,
    });
  }

  private snapshot(): PlatformClient['~messages']['roomSnapshot'] {
    return {
      roomId: this.roomId,
      boardgameMatchID: this.boardgameMatchID,
      status: this.status,
      players: this.profiles('player'),
      spectators: this.clients
        .map((client) => client.userData)
        .filter((profile): profile is PlatformClientProfile => Boolean(profile && profile.role !== 'player')),
    };
  }

  private profiles(role: PlatformAuth['role']): PlatformClientProfile[] {
    return this.clients
      .map((client) => client.userData)
      .filter((profile): profile is PlatformClientProfile => Boolean(profile && profile.role === role));
  }

  private broadcastPresence(event: 'join' | 'leave', profile: PlatformClientProfile): void {
    this.broadcast('presence', {
      event,
      profile,
      players: this.profiles('player').length,
      spectators: this.clients.filter((client) => client.userData?.role !== 'player').length,
    });
  }

  private async refreshMetadata(): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        kind: 'match-shell',
        boardgameMatchID: this.boardgameMatchID,
        status: this.status,
        playerCount: this.profiles('player').length,
        spectatorCount: this.clients.filter((client) => client.userData?.role !== 'player').length,
        conversationId: this.conversationId,
      },
    });
  }
}
