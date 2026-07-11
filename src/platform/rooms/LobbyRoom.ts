import { Room, type AuthContext } from '@colyseus/core';
import { createEmptyPlatformFriendStore, type PlatformFriendStore } from '../friendStore';
import { platformLogger as logger } from '../logger';
import { authenticatePlatformClient } from './auth';
import type {
  LobbyJoinOptions,
  LobbyRoomMetadata,
  PlatformAuth,
  PlatformClient,
  PlatformFriendPresenceEvent,
} from './types';

export class LobbyRoom extends Room<{ metadata: LobbyRoomMetadata; client: PlatformClient }> {
  static friendStore: PlatformFriendStore = createEmptyPlatformFriendStore();

  maxClients = 1_000;
  autoDispose = false;
  private readonly friendUserIdsBySession = new Map<string, Set<string>>();

  static configureFriendStore(friendStore: PlatformFriendStore): void {
    LobbyRoom.friendStore = friendStore;
  }

  async onCreate(): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        kind: 'lobby',
        onlineCount: 0,
      },
    });
  }

  onAuth(_client: PlatformClient, options: LobbyJoinOptions, context: AuthContext): PlatformAuth {
    return authenticatePlatformClient(options, context);
  }

  async onJoin(client: PlatformClient): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new Error('Missing platform auth');
    client.userData = {
      sessionId: client.sessionId,
      userId: auth.userId,
      displayName: auth.displayName,
      role: auth.role,
      joinedAt: Date.now(),
    };
    this.friendUserIdsBySession.set(client.sessionId, await this.friendUserIdsFor(auth.userId));
    await this.refreshMetadata();
    client.send('lobbySnapshot', this.snapshot(client));
    this.broadcast('presence', this.presencePayload('join'));
    this.broadcastFriendPresence(this.onlineSessionCount(auth.userId) > 1 ? 'update' : 'online', client.userData);
  }

  async onLeave(client: PlatformClient): Promise<void> {
    const profile = client.userData;
    this.friendUserIdsBySession.delete(client.sessionId);
    await this.refreshMetadata(client.sessionId);
    if (profile) {
      this.broadcast('presence', this.presencePayload('leave', client.sessionId));
      this.broadcastFriendPresence(
        this.onlineSessionCount(profile.userId, client.sessionId) > 0 ? 'update' : 'offline',
        profile,
        client.sessionId,
      );
    }
  }

  private snapshot(client: PlatformClient): PlatformClient['~messages']['lobbySnapshot'] {
    const friendUserIds = this.friendUserIdsBySession.get(client.sessionId) ?? new Set<string>();
    return {
      roomId: this.roomId,
      onlineCount: this.clients.length,
      friends: Array.from(friendUserIds, (userId) => this.friendPresencePayload('update', userId, client.sessionId)),
    };
  }

  private activeClients(ignoredSessionId?: string): PlatformClient[] {
    return this.clients.filter((client) => client.sessionId !== ignoredSessionId);
  }

  private presencePayload(event: 'join' | 'leave', ignoredSessionId?: string) {
    const clients = this.activeClients(ignoredSessionId);
    const players = clients.filter((item) => item.userData?.role === 'player').length;
    const spectators = clients.filter((item) => item.userData?.role !== 'player').length;
    return {
      event,
      players,
      spectators,
      onlineCount: clients.length,
    };
  }

  private async refreshMetadata(ignoredSessionId?: string): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        kind: 'lobby',
        onlineCount: this.activeClients(ignoredSessionId).length,
      },
    });
  }

  private broadcastFriendPresence(
    event: PlatformFriendPresenceEvent,
    profile: NonNullable<PlatformClient['userData']>,
    ignoredSessionId?: string,
  ) {
    const payload = this.friendPresencePayload(event, profile.userId, ignoredSessionId);
    this.clients.forEach((client) => {
      if (!this.friendUserIdsBySession.get(client.sessionId)?.has(profile.userId)) return;
      client.send('friendPresence', payload);
    });
  }

  private friendPresencePayload(
    event: PlatformFriendPresenceEvent,
    userId: string,
    ignoredSessionId?: string,
  ): PlatformClient['~messages']['friendPresence'] {
    const profiles = this.onlineProfilesByUserId(userId, ignoredSessionId);
    return {
      event,
      userId,
      online: profiles.length > 0,
      activeSessionCount: profiles.length,
      profiles,
      updatedAt: Date.now(),
    };
  }

  private onlineProfilesByUserId(userId: string, ignoredSessionId?: string): NonNullable<PlatformClient['userData']>[] {
    return this.clients
      .filter((client) => client.sessionId !== ignoredSessionId && client.userData?.userId === userId)
      .map((client) => client.userData)
      .filter((profile): profile is NonNullable<PlatformClient['userData']> => Boolean(profile));
  }

  private onlineSessionCount(userId: string, ignoredSessionId?: string): number {
    return this.onlineProfilesByUserId(userId, ignoredSessionId).length;
  }

  private async friendUserIdsFor(userId: string): Promise<Set<string>> {
    try {
      return new Set(await LobbyRoom.friendStore.listFriendUserIds(userId));
    } catch (err) {
      logger.warn({ err, userId }, 'failed to load lobby friend presence subscriptions');
      return new Set();
    }
  }
}
