import { Room, type AuthContext } from '@colyseus/core';
import { authenticatePlatformClient } from './auth';
import type { LobbyJoinOptions, LobbyRoomMetadata, PlatformAuth, PlatformClient } from './types';

export class LobbyRoom extends Room<{ metadata: LobbyRoomMetadata; client: PlatformClient }> {
  maxClients = 1_000;
  autoDispose = false;

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
    await this.refreshMetadata();
    client.send('lobbySnapshot', this.snapshot());
    this.broadcast('presence', this.presencePayload('join', client.userData));
  }

  async onLeave(client: PlatformClient): Promise<void> {
    const profile = client.userData;
    await this.refreshMetadata();
    if (profile) {
      this.broadcast('presence', this.presencePayload('leave', profile));
    }
  }

  private snapshot(): PlatformClient['~messages']['lobbySnapshot'] {
    return {
      roomId: this.roomId,
      onlineCount: this.clients.length,
    };
  }

  private presencePayload(event: 'join' | 'leave', profile: NonNullable<PlatformClient['userData']>) {
    const players = this.clients.filter((item) => item.userData?.role === 'player').length;
    const spectators = this.clients.filter((item) => item.userData?.role !== 'player').length;
    return {
      event,
      profile,
      players,
      spectators,
      onlineCount: this.clients.length,
    };
  }

  private async refreshMetadata(): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        kind: 'lobby',
        onlineCount: this.clients.length,
      },
    });
  }
}
