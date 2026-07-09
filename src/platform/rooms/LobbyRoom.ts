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
    this.broadcast('presence', {
      event: 'join',
      profile: client.userData,
      players: this.clients.filter((item) => item.userData?.role === 'player').length,
      spectators: this.clients.filter((item) => item.userData?.role !== 'player').length,
    });
  }

  async onLeave(client: PlatformClient): Promise<void> {
    const profile = client.userData;
    await this.refreshMetadata();
    if (profile) {
      this.broadcast('presence', {
        event: 'leave',
        profile,
        players: this.clients.filter((item) => item.userData?.role === 'player').length,
        spectators: this.clients.filter((item) => item.userData?.role !== 'player').length,
      });
    }
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
