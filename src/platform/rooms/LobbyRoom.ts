import { Room, type AuthContext } from '@colyseus/core';
import { createEmptyPlatformFriendStore, type PlatformFriendStore } from '../friendStore';
import { platformLogger as logger } from '../logger';
import { recordPlatformReconnect } from '../metrics';
import { assertPlatformAuthCurrent, authenticatePlatformClientCurrent } from './auth';
import type {
  LobbyJoinOptions,
  LobbyRoomMetadata,
  PlatformAuth,
  PlatformClient,
  PlatformFriendPresenceEvent,
  PlatformRelationshipChange,
} from './types';

export class LobbyRoom extends Room<{ metadata: LobbyRoomMetadata; client: PlatformClient }> {
  static friendStore: PlatformFriendStore = createEmptyPlatformFriendStore();
  private static readonly activeRooms = new Set<LobbyRoom>();

  maxClients = 1_000;
  autoDispose = false;
  private readonly friendUserIdsBySession = new Map<string, Set<string>>();

  static configureFriendStore(friendStore: PlatformFriendStore): void {
    LobbyRoom.friendStore = friendStore;
  }

  static async handleRelationshipChange(change: PlatformRelationshipChange): Promise<void> {
    await Promise.all([...LobbyRoom.activeRooms].map((room) => room.applyRelationshipChange(change)));
  }

  static async reconcileAuthorization(): Promise<void> {
    await Promise.all([...LobbyRoom.activeRooms].map((room) => room.reconcileAuthorization()));
  }

  static clearActiveRoomsForTests(): void {
    LobbyRoom.activeRooms.clear();
  }

  async onCreate(): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        kind: 'lobby',
        onlineCount: 0,
      },
    });
    LobbyRoom.activeRooms.add(this);
  }

  onDispose(): void {
    LobbyRoom.activeRooms.delete(this);
  }

  async onAuth(_client: PlatformClient, options: LobbyJoinOptions, context: AuthContext): Promise<PlatformAuth> {
    return authenticatePlatformClientCurrent(options, context);
  }

  async onJoin(client: PlatformClient): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new Error('Missing platform auth');
    await assertPlatformAuthCurrent(auth);
    const reconnectingUser = this.clients.some((item) => item.userData?.userId === auth.userId);
    client.userData = {
      sessionId: client.sessionId,
      userId: auth.userId,
      displayName: auth.displayName,
      role: auth.role,
      joinedAt: Date.now(),
    };
    if (reconnectingUser) recordPlatformReconnect('lobby');
    const friendUserIds = await this.friendUserIdsFor(auth.userId);
    this.friendUserIdsBySession.set(client.sessionId, friendUserIds);
    await this.refreshMetadata();
    client.send('lobbySnapshot', this.snapshot(client));
    this.broadcast('presence', this.presencePayload('join'));
    await this.broadcastFriendPresence(
      this.onlineSessionCount(auth.userId) > 1 ? 'update' : 'online',
      client.userData,
      undefined,
      friendUserIds,
    );
  }

  async onLeave(client: PlatformClient): Promise<void> {
    const profile = client.userData;
    this.friendUserIdsBySession.delete(client.sessionId);
    await this.refreshMetadata(client.sessionId);
    if (profile) {
      this.broadcast('presence', this.presencePayload('leave', client.sessionId));
      await this.broadcastFriendPresence(
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

  private async broadcastFriendPresence(
    event: PlatformFriendPresenceEvent,
    profile: NonNullable<PlatformClient['userData']>,
    ignoredSessionId?: string,
    currentProfileFriendUserIds?: Set<string>,
  ): Promise<void> {
    const payload = this.friendPresencePayload(event, profile.userId, ignoredSessionId);
    const profileFriendUserIds = currentProfileFriendUserIds ?? (await this.friendUserIdsFor(profile.userId));
    this.clients.forEach((client) => {
      if (client.sessionId === ignoredSessionId || !client.userData?.userId) return;
      const subscriptions = this.friendUserIdsBySession.get(client.sessionId) ?? new Set<string>();
      const wasVisible = subscriptions.has(profile.userId);
      const isVisible = profileFriendUserIds.has(client.userData.userId);
      if (isVisible) subscriptions.add(profile.userId);
      else subscriptions.delete(profile.userId);
      this.friendUserIdsBySession.set(client.sessionId, subscriptions);
      if (isVisible) {
        client.send('friendPresence', payload);
      } else if (wasVisible) {
        client.send('friendPresence', {
          event: 'offline',
          userId: profile.userId,
          online: false,
          activeSessionCount: 0,
          profiles: [],
          updatedAt: Date.now(),
        });
      }
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

  private sendFriendOffline(client: PlatformClient, userId: string): void {
    client.send('friendPresence', {
      event: 'offline',
      userId,
      online: false,
      activeSessionCount: 0,
      profiles: [],
      updatedAt: Date.now(),
    });
  }

  private async applyRelationshipChange(change: PlatformRelationshipChange): Promise<void> {
    const affectedUserIds = new Set(change.userIds);
    if (change.kind === 'account_deleted') {
      const deletedUserId = change.userIds[0];
      for (const client of this.clients) {
        if (client.userData?.userId === deletedUserId) {
          client.leave(4001, 'account_deleted');
          continue;
        }
        const subscriptions = this.friendUserIdsBySession.get(client.sessionId);
        if (!subscriptions?.delete(deletedUserId)) continue;
        this.sendFriendOffline(client, deletedUserId);
      }
      return;
    }

    await Promise.all(
      this.clients.map(async (client) => {
        const userId = client.userData?.userId;
        if (!userId || !affectedUserIds.has(userId)) return;
        await this.refreshClientFriendSubscriptions(client, userId);
      }),
    );
  }

  private async refreshClientFriendSubscriptions(client: PlatformClient, userId: string): Promise<void> {
    const previous = this.friendUserIdsBySession.get(client.sessionId) ?? new Set<string>();
    const next = await this.friendUserIdsFor(userId);
    for (const removedUserId of previous) {
      if (!next.has(removedUserId)) this.sendFriendOffline(client, removedUserId);
    }
    for (const friendUserId of next) {
      client.send('friendPresence', this.friendPresencePayload('update', friendUserId, client.sessionId));
    }
    this.friendUserIdsBySession.set(client.sessionId, next);
  }

  private async reconcileAuthorization(): Promise<void> {
    await Promise.all(
      this.clients.map(async (client) => {
        const auth = client.auth;
        const userId = client.userData?.userId;
        if (!auth || !userId) return;
        try {
          await assertPlatformAuthCurrent(auth);
        } catch {
          client.leave(4001, 'authorization_revoked');
          return;
        }
        await this.refreshClientFriendSubscriptions(client, userId);
      }),
    );
  }
}
