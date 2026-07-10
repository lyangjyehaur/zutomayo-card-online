import { Room, type AuthContext } from '@colyseus/core';
import { authenticatePlatformClient } from './auth';
import type {
  BoardgameMatchReadyMessage,
  PlatformAuth,
  PlatformClient,
  PlatformClientProfile,
  QuickMatchRoomMetadata,
  QuickMatchRoomOptions,
  QuickMatchStatus,
} from './types';

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export class QuickMatchRoom extends Room<{ metadata: QuickMatchRoomMetadata; client: PlatformClient }> {
  maxClients = 2;

  private status: QuickMatchStatus = 'waiting';
  private hostSessionId?: string;
  private boardgameMatchID?: string;

  async onCreate(): Promise<void> {
    this.autoDispose = true;
    this.maxMessagesPerSecond = 4;

    this.onMessage<BoardgameMatchReadyMessage>('boardgameMatchReady', (client, message) => {
      if (client.sessionId !== this.hostSessionId) return;
      const boardgameMatchID = optionalText(message.boardgameMatchID, 128);
      if (!boardgameMatchID || this.status !== 'matched') return;
      this.boardgameMatchID = boardgameMatchID;
      this.status = 'finished';
      void this.refreshMetadata();
      this.broadcast('boardgameMatchReady', { boardgameMatchID });
      this.broadcastSnapshot();
    });

    this.onMessage('cancelQuickMatch', (client) => {
      if (!client.userData) return;
      if (this.status === 'matched' && client.sessionId !== this.hostSessionId) return;
      void this.cancel('player_left');
    });

    await this.refreshMetadata();
  }

  onAuth(_client: PlatformClient, options: QuickMatchRoomOptions, context: AuthContext): PlatformAuth {
    const auth = authenticatePlatformClient(options, context);
    if (!auth.authenticated) throw new Error('Authentication required');
    if (this.clients.some((client) => client.userData?.userId === auth.userId)) {
      throw new Error('Already queued');
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

    if (this.clients.length >= 2 && this.status === 'waiting') {
      this.status = 'matched';
      this.hostSessionId = this.clients[0]?.sessionId;
      this.lock();
      await this.refreshMetadata();
      this.clock.setTimeout(() => {
        this.sendMatchedMessages();
        this.broadcastSnapshot();
      }, 50);
      return;
    }

    await this.refreshMetadata();
    client.send('quickMatchSnapshot', this.snapshot());
  }

  async onLeave(client: PlatformClient): Promise<void> {
    if (this.status === 'matched' && client.sessionId !== this.hostSessionId) {
      await this.refreshMetadata();
      return;
    }
    if (this.status === 'waiting' || this.status === 'matched') {
      await this.cancel(client.userData ? 'player_left' : 'connection_lost');
      return;
    }
    await this.refreshMetadata();
  }

  private profiles(): PlatformClientProfile[] {
    return this.clients
      .map((client) => client.userData)
      .filter((profile): profile is PlatformClientProfile => Boolean(profile));
  }

  private snapshot(): PlatformClient['~messages']['quickMatchSnapshot'] {
    return {
      roomId: this.roomId,
      status: this.status,
      players: this.profiles(),
      hostSessionId: this.hostSessionId,
      boardgameMatchID: this.boardgameMatchID,
    };
  }

  private sendMatchedMessages(): void {
    for (const client of this.clients) {
      const role = client.sessionId === this.hostSessionId ? 'host' : 'guest';
      const opponent = this.clients.find((item) => item.sessionId !== client.sessionId)?.userData;
      client.send('quickMatchMatched', {
        roomId: this.roomId,
        role,
        opponent,
      });
    }
  }

  private broadcastSnapshot(): void {
    this.broadcast('quickMatchSnapshot', this.snapshot());
  }

  private async cancel(reason: string): Promise<void> {
    if (this.status === 'cancelled' || this.status === 'finished') return;
    this.status = 'cancelled';
    await this.refreshMetadata();
    this.broadcast('quickMatchCancelled', { reason });
    this.broadcastSnapshot();
  }

  private async refreshMetadata(): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        kind: 'quick-match',
        status: this.status,
        playerCount: this.profiles().length,
        hostSessionId: this.hostSessionId,
        boardgameMatchID: this.boardgameMatchID,
      },
    });
  }
}
