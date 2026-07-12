import { Room, type AuthContext } from '@colyseus/core';
import { assertPlatformAuthCurrent, authenticatePlatformClientCurrent } from './auth';
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

const DEFAULT_QUICK_MATCH_DECK_NAME = '__random__';
const QUICK_MATCH_DECK_NAMES = new Set(
  (process.env.QUICK_MATCH_DECK_NAMES || '__random__,dark,flame,electric,wind')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);

function quickMatchDeckName(value: unknown): string | undefined {
  const deckName = optionalText(value, 60);
  return deckName && QUICK_MATCH_DECK_NAMES.has(deckName) ? deckName : undefined;
}

export class QuickMatchRoom extends Room<{ metadata: QuickMatchRoomMetadata; client: PlatformClient }> {
  maxClients = 2;

  private status: QuickMatchStatus = 'waiting';
  private hostSessionId?: string;
  private boardgameMatchID?: string;
  private authenticatedUserIds = new Set<string>();
  private deckReservations = new Map<string, string>();

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

  async onAuth(_client: PlatformClient, options: QuickMatchRoomOptions, context: AuthContext): Promise<PlatformAuth> {
    const auth = await authenticatePlatformClientCurrent(options, context);
    if (!auth.authenticated) throw new Error('Authentication required');
    if (this.status !== 'waiting') throw new Error('Quick match is not joinable');
    // 在 onAuth 階段原子標記 userId，避免 onJoin 前的 TOCTOU 競爭讓同一使用者重複加入。
    // 同時保留 this.clients 檢查作為防禦深度（處理未經 onAuth 直接加入的 client）。
    if (
      this.authenticatedUserIds.has(auth.userId) ||
      this.clients.some((client) => client.userData?.userId === auth.userId)
    ) {
      throw new Error('Already queued');
    }
    const deckName =
      quickMatchDeckName(options.deckName) ||
      (process.env.NODE_ENV === 'production' ? undefined : DEFAULT_QUICK_MATCH_DECK_NAME);
    if (!deckName) throw new Error('A server-supported deck is required');
    this.authenticatedUserIds.add(auth.userId);
    this.deckReservations.set(auth.userId, deckName);
    return { ...auth, role: 'player' };
  }

  async onJoin(client: PlatformClient, options: QuickMatchRoomOptions = {}): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new Error('Missing platform auth');
    await assertPlatformAuthCurrent(auth);
    const deckName =
      this.deckReservations.get(auth.userId) ??
      (process.env.NODE_ENV === 'production'
        ? undefined
        : quickMatchDeckName(options.deckName) || DEFAULT_QUICK_MATCH_DECK_NAME);
    if (!deckName) throw new Error('Missing quick-match deck reservation');
    client.userData = {
      sessionId: client.sessionId,
      userId: auth.userId,
      displayName: auth.displayName,
      role: 'player',
      joinedAt: Date.now(),
      deckName,
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
    const userId = client.userData?.userId;
    if (userId) {
      this.authenticatedUserIds.delete(userId);
      this.deckReservations.delete(userId);
    }
    if (this.status === 'matched' && client.sessionId !== this.hostSessionId) {
      await this.refreshMetadata(client.sessionId);
      return;
    }
    if (this.status === 'waiting' || this.status === 'matched') {
      await this.cancel(client.userData ? 'player_left' : 'connection_lost', client.sessionId);
      return;
    }
    await this.refreshMetadata(client.sessionId);
  }

  private profiles(ignoredSessionId?: string): PlatformClientProfile[] {
    return this.clients
      .filter((client) => client.sessionId !== ignoredSessionId)
      .map((client) => client.userData)
      .filter((profile): profile is PlatformClientProfile => Boolean(profile));
  }

  private snapshot(ignoredSessionId?: string): PlatformClient['~messages']['quickMatchSnapshot'] {
    return {
      roomId: this.roomId,
      status: this.status,
      players: this.profiles(ignoredSessionId),
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
        deckName: client.userData?.deckName || DEFAULT_QUICK_MATCH_DECK_NAME,
        opponent,
      });
    }
  }

  private broadcastSnapshot(ignoredSessionId?: string): void {
    this.broadcast('quickMatchSnapshot', this.snapshot(ignoredSessionId));
  }

  private async cancel(reason: string, ignoredSessionId?: string): Promise<void> {
    if (this.status === 'cancelled' || this.status === 'finished') return;
    this.status = 'cancelled';
    await this.refreshMetadata(ignoredSessionId);
    this.broadcast('quickMatchCancelled', { reason });
    this.broadcastSnapshot(ignoredSessionId);
  }

  private async refreshMetadata(ignoredSessionId?: string): Promise<void> {
    await this.setMatchmaking({
      metadata: {
        kind: 'quick-match',
        status: this.status,
        playerCount: this.profiles(ignoredSessionId).length,
        hostSessionId: this.hostSessionId,
        boardgameMatchID: this.boardgameMatchID,
      },
    });
  }
}
