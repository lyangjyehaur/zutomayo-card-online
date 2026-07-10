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

function normalizeStatus(value: unknown, boardgameMatchID?: string): MatchShellStatus {
  if (value === 'waiting' || value === 'ready' || value === 'in_progress' || value === 'finished') return value;
  return boardgameMatchID ? 'ready' : 'waiting';
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
    this.conversationId = optionalText(options.conversationId, 128);
    this.status = normalizeStatus(options.status, this.boardgameMatchID);
    this.maxMessagesPerSecond = 6;

    this.onMessage<LinkBoardgameMatchMessage>('linkBoardgameMatch', (client, message) => {
      if (client.userData?.role !== 'moderator' && client.userData?.role !== 'player') return;
      const boardgameMatchID = optionalText(message.boardgameMatchID, 128);
      if (!boardgameMatchID) return;
      void this.linkBoardgameMatch(boardgameMatchID);
    });

    this.onMessage<ChatPreviewMessage>('chatPreview', (client, message) => {
      const text = optionalText(message.text, 500);
      if (!text || !client.userData || !client.auth?.authenticated) return;
      this.broadcast('chatPreview', {
        conversationId: optionalText(message.conversationId, 128) ?? this.conversationId,
        sender: client.userData,
        text,
        createdAt: Date.now(),
      });
    });

    await this.refreshMetadata();
  }

  onAuth(_client: PlatformClient, options: MatchShellRoomOptions, context: AuthContext): PlatformAuth {
    const auth = authenticatePlatformClient(options, context);
    const currentPlayers = this.clients.filter((client) => client.userData?.role === 'player').length;
    if (auth.role === 'player' && currentPlayers >= this.maxPlayerSeats) {
      return { ...auth, role: 'spectator' };
    }
    return auth;
  }

  async onJoin(client: PlatformClient, options: MatchShellRoomOptions): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new Error('Missing platform auth');
    const role = this.resolveRole(auth.role);
    client.userData = {
      sessionId: client.sessionId,
      userId: auth.userId,
      displayName: auth.displayName,
      role,
      joinedAt: Date.now(),
      boardgamePlayerID: boardgamePlayerIDFromOptions(options, role),
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

  private resolveRole(requestedRole: PlatformAuth['role']): PlatformAuth['role'] {
    if (requestedRole !== 'player') return requestedRole;
    const currentPlayers = this.clients.filter((client) => client.userData?.role === 'player').length;
    return currentPlayers >= this.maxPlayerSeats ? 'spectator' : 'player';
  }

  private async linkBoardgameMatch(boardgameMatchID: string): Promise<void> {
    this.boardgameMatchID = boardgameMatchID;
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
