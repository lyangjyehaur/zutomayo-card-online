import { Room, type AuthContext } from '@colyseus/core';
import { authenticatePlatformClient } from './auth';
import type {
  BoardgameMatchReadyMessage,
  InviteResponseMessage,
  InviteRoomMetadata,
  InviteRoomOptions,
  InviteStatus,
  PlatformAuth,
  PlatformClient,
  PlatformClientProfile,
} from './types';

const INVITE_TTL_MS = 10 * 60 * 1000;

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export class InviteRoom extends Room<{ metadata: InviteRoomMetadata; client: PlatformClient }> {
  maxClients = 8;
  autoDispose = false;

  private inviteId = '';
  private status: InviteStatus = 'pending';
  private targetUserId?: string;
  private roomCode?: string;
  private boardgameMatchID?: string;
  private inviter?: PlatformClientProfile;
  private createdAt = Date.now();
  private expiresAt = this.createdAt + INVITE_TTL_MS;

  async onCreate(options: InviteRoomOptions = {}): Promise<void> {
    this.maxMessagesPerSecond = 4;
    this.inviteId = optionalText(options.inviteId, 128) ?? this.roomId;
    this.targetUserId = optionalText(options.targetUserId, 128);
    this.roomCode = optionalText(options.roomCode, 128);
    this.boardgameMatchID = optionalText(options.boardgameMatchID, 128);
    this.createdAt = Date.now();
    this.expiresAt = this.createdAt + INVITE_TTL_MS;

    this.clock.setTimeout(() => {
      if (this.status === 'pending') {
        this.status = 'expired';
        void this.refreshMetadata();
        this.broadcast('inviteCancelled', { inviteId: this.inviteId, reason: 'expired' });
        this.broadcastSnapshot();
      }
      void this.disconnect();
    }, INVITE_TTL_MS);

    this.onMessage<InviteResponseMessage>('acceptInvite', (client) => {
      if (!this.canRespond(client)) return;
      this.status = 'accepted';
      void this.refreshMetadata();
      this.broadcast('inviteAccepted', {
        inviteId: this.inviteId,
        acceptedBy: client.userData,
        roomCode: this.roomCode,
        boardgameMatchID: this.boardgameMatchID,
      });
      this.broadcastSnapshot();
    });

    this.onMessage<InviteResponseMessage>('declineInvite', (client, message) => {
      if (!this.canRespond(client)) return;
      this.status = 'declined';
      const reason = optionalText(message.reason, 80) ?? 'declined';
      void this.refreshMetadata();
      this.broadcast('inviteDeclined', {
        inviteId: this.inviteId,
        declinedBy: client.userData,
        reason,
      });
      this.broadcastSnapshot();
    });

    this.onMessage<InviteResponseMessage>('cancelInvite', (client, message) => {
      if (this.inviter && client.sessionId !== this.inviter.sessionId) return;
      void this.cancel(optionalText(message.reason, 80) ?? 'cancelled');
    });

    this.onMessage<BoardgameMatchReadyMessage>('boardgameMatchReady', (client, message) => {
      if (!this.inviter || client.sessionId !== this.inviter.sessionId) return;
      if (this.status !== 'accepted') return;
      const boardgameMatchID = optionalText(message.boardgameMatchID, 128);
      if (!boardgameMatchID) return;
      this.boardgameMatchID = boardgameMatchID;
      this.roomCode = this.roomCode ?? boardgameMatchID;
      void this.refreshMetadata();
      this.broadcast('boardgameMatchReady', { boardgameMatchID });
      this.broadcastSnapshot();
    });

    await this.refreshMetadata();
  }

  onAuth(_client: PlatformClient, options: InviteRoomOptions, context: AuthContext): PlatformAuth {
    return { ...authenticatePlatformClient(options, context), role: 'player' };
  }

  async onJoin(client: PlatformClient): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new Error('Missing platform auth');
    client.userData = {
      sessionId: client.sessionId,
      userId: auth.userId,
      displayName: auth.displayName,
      role: 'player',
      joinedAt: Date.now(),
    };
    if (!this.inviter) this.inviter = client.userData;
    await this.refreshMetadata();
    this.clock.setTimeout(() => client.send('inviteSnapshot', this.snapshot()), 50);
  }

  async onLeave(client: PlatformClient): Promise<void> {
    if (this.status === 'pending' && this.inviter?.sessionId === client.sessionId) {
      await this.cancel('inviter_left');
      return;
    }
    await this.refreshMetadata();
  }

  private canRespond(client: PlatformClient): client is PlatformClient & { userData: PlatformClientProfile } {
    if (this.status !== 'pending' || !client.userData) return false;
    if (this.inviter?.sessionId === client.sessionId) return false;
    if (this.targetUserId && client.userData.userId !== this.targetUserId) return false;
    return true;
  }

  private snapshot(): PlatformClient['~messages']['inviteSnapshot'] {
    return {
      roomId: this.roomId,
      inviteId: this.inviteId,
      status: this.status,
      inviter: this.inviter,
      targetUserId: this.targetUserId,
      roomCode: this.roomCode,
      boardgameMatchID: this.boardgameMatchID,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
    };
  }

  private broadcastSnapshot(): void {
    this.broadcast('inviteSnapshot', this.snapshot());
  }

  private async cancel(reason: string): Promise<void> {
    if (this.status !== 'pending') return;
    this.status = 'cancelled';
    await this.refreshMetadata();
    this.broadcast('inviteCancelled', { inviteId: this.inviteId, reason });
    this.broadcastSnapshot();
  }

  private async refreshMetadata(): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        kind: 'invite',
        inviteId: this.inviteId,
        status: this.status,
        targetUserId: this.targetUserId,
        roomCode: this.roomCode,
        boardgameMatchID: this.boardgameMatchID,
      },
    });
  }
}
