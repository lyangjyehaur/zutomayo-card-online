import { Room, type AuthContext } from '@colyseus/core';
import { platformLogger as logger } from '../logger';
import { createEmptyPlatformMatchParticipantStore, type PlatformMatchParticipantStore } from '../matchParticipantStore';
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

function sameRequiredText(current: string | undefined, next: unknown, maxLength: number): boolean {
  const supplied = optionalText(next, maxLength);
  return Boolean(supplied && current && supplied === current);
}

function sameOptionalText(current: string | undefined, next: unknown, maxLength: number): boolean {
  const supplied = optionalText(next, maxLength);
  return !supplied || Boolean(current && supplied === current);
}

export class CustomRoom extends Room<{ metadata: CustomRoomMetadata; client: PlatformClient }> {
  private static participantStore: PlatformMatchParticipantStore = createEmptyPlatformMatchParticipantStore();
  maxClients = 16;
  autoDispose = false;

  private roomCode = '';
  private boardgameMatchID?: string;
  private status: CustomRoomStatus = 'waiting';
  private host?: PlatformClientProfile;

  static configureParticipantStore(store: PlatformMatchParticipantStore): void {
    CustomRoom.participantStore = store;
  }

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
    if (!this.isJoinableStatus()) {
      throw new Error('Custom room is not joinable');
    }
    if (!sameRequiredText(this.roomCode, options.roomCode, 128)) {
      throw new Error('Custom room access denied');
    }
    if (!sameOptionalText(this.boardgameMatchID, options.boardgameMatchID, 128)) {
      throw new Error('Custom room access denied');
    }
    return authenticatePlatformClient(options, context);
  }

  async onJoin(client: PlatformClient): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new Error('Missing platform auth');
    const previousHost = this.host;
    const role = this.resolveRole(auth.role, auth.userId, previousHost);
    const profile: PlatformClientProfile = {
      sessionId: client.sessionId,
      userId: auth.userId,
      displayName: auth.displayName,
      role,
      joinedAt: Date.now(),
    };
    const isHostReconnect = previousHost?.userId === profile.userId;

    await this.recordRoomParticipant(profile, auth.authenticated);

    client.userData = profile;
    if (profile.role === 'player' && (!previousHost || isHostReconnect)) this.host = profile;

    if (this.boardgameMatchID && this.status === 'waiting' && previousHost && !isHostReconnect && role === 'player') {
      this.status = 'ready';
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
    if ((this.status === 'waiting' || this.status === 'ready') && this.host?.sessionId === client.sessionId) {
      let replacementHost = this.clients
        .map((item) => item.userData)
        .find((profile): profile is PlatformClientProfile =>
          Boolean(profile && profile.sessionId !== client.sessionId && profile.userId === this.host?.userId),
        );
      // ready 狀態下若找不到同 userId 的替換，讓最早已加入的 client 接管 host
      if (!replacementHost && this.status === 'ready') {
        replacementHost = this.clients
          .map((c) => c.userData)
          .find((p): p is PlatformClientProfile => Boolean(p && p.sessionId !== client.sessionId));
      }
      if (replacementHost) {
        this.host = replacementHost;
        await this.refreshMetadata();
        this.broadcastSnapshot();
        return;
      }
      this.host = undefined;
      await this.cancel('host_left', client.sessionId);
      return;
    }

    await this.refreshMetadata(client.sessionId);
    this.broadcastSnapshot(client.sessionId);
  }

  private activeClients(ignoredSessionId?: string): PlatformClient[] {
    return this.clients.filter((client) => client.sessionId !== ignoredSessionId);
  }

  private profiles(ignoredSessionId?: string): PlatformClientProfile[] {
    return this.activeClients(ignoredSessionId)
      .map((client) => client.userData)
      .filter((profile): profile is PlatformClientProfile => Boolean(profile));
  }

  private roleProfiles(role: PlatformAuth['role'], ignoredSessionId?: string): PlatformClientProfile[] {
    return this.profiles(ignoredSessionId).filter((profile) => profile.role === role);
  }

  private resolveRole(
    requestedRole: PlatformAuth['role'],
    userId: string,
    host: PlatformClientProfile | undefined,
  ): PlatformAuth['role'] {
    if (requestedRole !== 'player') return requestedRole;
    if (!host || host.userId === userId) return 'player';
    const guestPlayerUserIds = new Set(
      this.roleProfiles('player')
        .filter((profile) => profile.userId !== host.userId)
        .map((profile) => profile.userId),
    );
    return guestPlayerUserIds.size === 0 || guestPlayerUserIds.has(userId) ? 'player' : 'spectator';
  }

  private isJoinableStatus(): boolean {
    return this.status === 'waiting' || this.status === 'ready';
  }

  private async recordRoomParticipant(profile: PlatformClientProfile, authenticated: boolean): Promise<void> {
    if (!authenticated) return;
    try {
      await CustomRoom.participantStore.recordRoomParticipant({
        roomCode: this.roomCode,
        userId: profile.userId,
        role: profile.role,
        displayName: profile.displayName,
      });
    } catch (err) {
      logger.warn({ err, roomCode: this.roomCode, userId: profile.userId }, 'failed to record custom-room participant');
      throw err;
    }
  }

  private snapshot(ignoredSessionId?: string): PlatformClient['~messages']['customRoomSnapshot'] {
    return {
      roomId: this.roomId,
      roomCode: this.roomCode,
      status: this.status,
      host: this.host,
      players: this.roleProfiles('player', ignoredSessionId),
      spectators: this.roleProfiles('spectator', ignoredSessionId),
      boardgameMatchID: this.boardgameMatchID,
    };
  }

  private broadcastSnapshot(ignoredSessionId?: string): void {
    this.broadcast('customRoomSnapshot', this.snapshot(ignoredSessionId));
  }

  private async cancel(reason: string, ignoredSessionId?: string): Promise<void> {
    if (this.status === 'cancelled' || this.status === 'finished') return;
    this.status = 'cancelled';
    await this.refreshMetadata(ignoredSessionId);
    this.broadcast('customRoomCancelled', { reason });
    this.broadcastSnapshot(ignoredSessionId);
  }

  private async refreshMetadata(ignoredSessionId?: string): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        kind: 'custom-room',
        roomCode: this.roomCode,
        status: this.status,
        playerCount: this.roleProfiles('player', ignoredSessionId).length,
        spectatorCount: this.roleProfiles('spectator', ignoredSessionId).length,
        boardgameMatchID: this.boardgameMatchID,
      },
    });
  }
}
