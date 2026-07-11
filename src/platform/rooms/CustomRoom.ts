import { Room, type AuthContext } from '@colyseus/core';
import { authenticatePlatformClient } from './auth';
import type {
  BoardgameMatchReadyMessage,
  CustomRoomMetadata,
  CustomRoomOptions,
  CustomRoomStatus,
  PlatformAuth,
  PlatformClient,
  PlatformClientProfile,
} from './types';

const CUSTOM_ROOM_TTL_MS = 30 * 60 * 1000;

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeStatus(value: unknown): CustomRoomStatus {
  if (value === 'waiting' || value === 'ready' || value === 'cancelled' || value === 'finished') return value;
  return 'waiting';
}

export class CustomRoom extends Room<{ metadata: CustomRoomMetadata; client: PlatformClient }> {
  maxClients = 16;
  autoDispose = false;

  private roomCode = '';
  private boardgameMatchID?: string;
  private status: CustomRoomStatus = 'waiting';
  private host?: PlatformClientProfile;

  async onCreate(options: CustomRoomOptions = {}): Promise<void> {
    this.maxMessagesPerSecond = 4;
    this.roomCode = optionalText(options.roomCode, 128) ?? this.roomId;
    this.boardgameMatchID = optionalText(options.boardgameMatchID, 128);
    this.status = normalizeStatus(options.status);

    this.clock.setTimeout(() => {
      void this.disconnect();
    }, CUSTOM_ROOM_TTL_MS);

    this.onMessage<BoardgameMatchReadyMessage>('boardgameMatchReady', (client, message) => {
      if (!this.host || client.sessionId !== this.host.sessionId) return;
      const boardgameMatchID = optionalText(message.boardgameMatchID, 128);
      if (!boardgameMatchID || this.boardgameMatchID || this.status === 'cancelled' || this.status === 'finished') {
        return;
      }
      this.boardgameMatchID = boardgameMatchID;
      this.status = 'ready';
      this.lockReadyRoom();
      void this.refreshMetadata();
      this.broadcast('boardgameMatchReady', { boardgameMatchID });
      this.broadcastSnapshot();
    });

    this.onMessage('cancelCustomRoom', (client) => {
      if (!this.host || client.sessionId !== this.host.sessionId) return;
      void this.cancel('host_cancelled');
    });

    await this.refreshMetadata();
  }

  onAuth(_client: PlatformClient, options: CustomRoomOptions, context: AuthContext): PlatformAuth {
    return authenticatePlatformClient(options, context);
  }

  async onJoin(client: PlatformClient): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new Error('Missing platform auth');
    const previousHost = this.host;
    client.userData = {
      sessionId: client.sessionId,
      userId: auth.userId,
      displayName: auth.displayName,
      role: auth.role,
      joinedAt: Date.now(),
    };
    const isHostReconnect = previousHost?.userId === client.userData.userId;
    if (client.userData.role === 'player' && (!previousHost || isHostReconnect)) this.host = client.userData;

    if (
      this.boardgameMatchID &&
      this.status === 'waiting' &&
      previousHost &&
      !isHostReconnect &&
      auth.role === 'player'
    ) {
      this.status = 'ready';
      this.lockReadyRoom();
      await this.refreshMetadata();
      this.broadcast('boardgameMatchReady', { boardgameMatchID: this.boardgameMatchID });
    }

    await this.refreshMetadata();
    this.clock.setTimeout(() => {
      client.send('customRoomSnapshot', this.snapshot());
      if (this.boardgameMatchID && this.status === 'ready') {
        client.send('boardgameMatchReady', { boardgameMatchID: this.boardgameMatchID });
      }
      this.broadcastSnapshot();
    }, 50);
  }

  async onLeave(client: PlatformClient): Promise<void> {
    if (this.status === 'waiting' && this.host?.sessionId === client.sessionId) {
      const replacementHost = this.clients
        .map((item) => item.userData)
        .find((profile): profile is PlatformClientProfile =>
          Boolean(profile && profile.sessionId !== client.sessionId && profile.userId === this.host?.userId),
        );
      if (replacementHost) {
        this.host = replacementHost;
        await this.refreshMetadata();
        this.broadcastSnapshot();
        return;
      }
      await this.cancel('host_left');
      return;
    }

    await this.refreshMetadata();
    this.broadcastSnapshot();
  }

  private profiles(): PlatformClientProfile[] {
    return this.clients
      .map((client) => client.userData)
      .filter((profile): profile is PlatformClientProfile => Boolean(profile));
  }

  private roleProfiles(role: PlatformAuth['role']): PlatformClientProfile[] {
    return this.profiles().filter((profile) => profile.role === role);
  }

  private snapshot(): PlatformClient['~messages']['customRoomSnapshot'] {
    return {
      roomId: this.roomId,
      roomCode: this.roomCode,
      status: this.status,
      host: this.host,
      players: this.roleProfiles('player'),
      spectators: this.roleProfiles('spectator'),
      boardgameMatchID: this.boardgameMatchID,
    };
  }

  private broadcastSnapshot(): void {
    this.broadcast('customRoomSnapshot', this.snapshot());
  }

  private lockReadyRoom(): void {
    if (this.status === 'ready' && !this.locked) {
      this.lock();
    }
  }

  private async cancel(reason: string): Promise<void> {
    if (this.status === 'cancelled' || this.status === 'finished') return;
    this.status = 'cancelled';
    await this.refreshMetadata();
    this.broadcast('customRoomCancelled', { reason });
    this.broadcastSnapshot();
  }

  private async refreshMetadata(): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        kind: 'custom-room',
        roomCode: this.roomCode,
        status: this.status,
        playerCount: this.roleProfiles('player').length,
        spectatorCount: this.roleProfiles('spectator').length,
        boardgameMatchID: this.boardgameMatchID,
      },
    });
  }
}
