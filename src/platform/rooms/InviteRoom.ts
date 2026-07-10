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

export function parseFriendInviteId(inviteId: string): { inviterUserId: string; targetUserId: string } | null {
  const parts = inviteId.split(':');
  if (parts.length !== 4 || parts[0] !== 'friend' || parts[1] !== 'v1') return null;
  try {
    const inviterUserId = decodeURIComponent(parts[2] ?? '').trim();
    const targetUserId = decodeURIComponent(parts[3] ?? '').trim();
    if (!inviterUserId || !targetUserId || inviterUserId === targetUserId) return null;
    return { inviterUserId, targetUserId };
  } catch {
    return null;
  }
}

export class InviteRoom extends Room<{ metadata: InviteRoomMetadata; client: PlatformClient }> {
  maxClients = 8;
  autoDispose = false;

  private inviteId = '';
  private status: InviteStatus = 'pending';
  private inviterUserId?: string;
  private targetUserId?: string;
  private roomCode?: string;
  private boardgameMatchID?: string;
  private inviter?: PlatformClientProfile;
  private createdAt = Date.now();
  private expiresAt = this.createdAt + INVITE_TTL_MS;

  async onCreate(options: InviteRoomOptions = {}): Promise<void> {
    this.maxMessagesPerSecond = 4;
    this.inviteId = optionalText(options.inviteId, 128) ?? this.roomId;
    const friendInvite = parseFriendInviteId(this.inviteId);
    this.inviterUserId = friendInvite?.inviterUserId;
    this.targetUserId = friendInvite?.targetUserId ?? optionalText(options.targetUserId, 128);
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
      if (!this.inviter || client.sessionId !== this.inviter.sessionId) return;
      void this.cancel(optionalText(message.reason, 80) ?? 'cancelled');
    });

    this.onMessage<BoardgameMatchReadyMessage>('boardgameMatchReady', (client, message) => {
      if (!this.inviter || client.sessionId !== this.inviter.sessionId) return;
      if (this.status !== 'accepted') return;
      const boardgameMatchID = optionalText(message.boardgameMatchID, 128);
      if (!boardgameMatchID || this.boardgameMatchID) return;
      this.boardgameMatchID = boardgameMatchID;
      this.roomCode = this.roomCode ?? boardgameMatchID;
      void this.refreshMetadata();
      this.broadcast('boardgameMatchReady', { boardgameMatchID });
      this.broadcastSnapshot();
    });

    await this.refreshMetadata();
  }

  onAuth(_client: PlatformClient, options: InviteRoomOptions, context: AuthContext): PlatformAuth {
    const auth = authenticatePlatformClient(options, context);
    if (!auth.authenticated) throw new Error('Authentication required');
    const inviteId = optionalText(options.inviteId, 128);
    const friendInvite = inviteId ? parseFriendInviteId(inviteId) : null;
    if (!inviteId || !friendInvite) throw new Error('Invalid invite id');
    const targetUserId = optionalText(options.targetUserId, 128);
    if (targetUserId && targetUserId !== friendInvite.targetUserId) throw new Error('Invalid invite target');
    if (auth.userId !== friendInvite.inviterUserId && auth.userId !== friendInvite.targetUserId) {
      throw new Error('Invite access denied');
    }
    return { ...auth, role: 'player' };
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
    if (!this.inviter && this.canBecomeInviter(client.userData)) this.inviter = client.userData;
    await this.refreshMetadata();
    this.clock.setTimeout(() => client.send('inviteSnapshot', this.snapshot()), 50);
  }

  async onLeave(client: PlatformClient): Promise<void> {
    if (this.inviter?.sessionId === client.sessionId) {
      const replacementInviter = this.replacementInviterProfile(client.sessionId);
      if (replacementInviter) {
        this.inviter = replacementInviter;
        await this.refreshMetadata();
        this.broadcastSnapshot();
        return;
      }
      if ((this.status === 'pending' || this.status === 'accepted') && !this.boardgameMatchID) {
        await this.cancel('inviter_left');
        return;
      }
    }

    await this.refreshMetadata();
  }

  private replacementInviterProfile(leavingSessionId: string): PlatformClientProfile | undefined {
    return this.clients
      .map((item) => item.userData)
      .find((profile): profile is PlatformClientProfile =>
        Boolean(profile && profile.sessionId !== leavingSessionId && this.isInviter(profile)),
      );
  }

  private canCancel(): boolean {
    if (this.status === 'pending') return true;
    return this.status === 'accepted' && !this.boardgameMatchID;
  }

  private async cancel(reason: string): Promise<void> {
    if (!this.canCancel()) return;
    this.status = 'cancelled';
    await this.refreshMetadata();
    this.broadcast('inviteCancelled', { inviteId: this.inviteId, reason });
    this.broadcastSnapshot();
  }

  private canRespond(client: PlatformClient): client is PlatformClient & { userData: PlatformClientProfile } {
    if (this.status !== 'pending' || !this.inviter || !client.userData) return false;
    if (this.isInviter(client.userData)) return false;
    if (this.targetUserId && client.userData.userId !== this.targetUserId) return false;
    return true;
  }

  private canBecomeInviter(profile: PlatformClientProfile): boolean {
    return this.inviterUserId ? profile.userId === this.inviterUserId : true;
  }

  private isInviter(profile: PlatformClientProfile): boolean {
    return this.inviterUserId ? profile.userId === this.inviterUserId : this.inviter?.sessionId === profile.sessionId;
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
