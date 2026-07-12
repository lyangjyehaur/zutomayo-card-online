import { Room, type AuthContext } from '@colyseus/core';
import { createEmptyPlatformBlockStore, type PlatformBlockStore } from '../blockStore';
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
  private static blockStore: PlatformBlockStore = createEmptyPlatformBlockStore();

  static configureBlockStore(store: PlatformBlockStore | null): void {
    QuickMatchRoom.blockStore = store ?? createEmptyPlatformBlockStore();
  }

  maxClients = 2;

  private status: QuickMatchStatus = 'waiting';
  private hostSessionId?: string;
  private boardgameMatchID?: string;
  private authenticatedUserIds = new Set<string>();
  private deckReservations = new Map<string, { deckName: string; reservationId?: string }>();
  private authAdmissionTail: Promise<void> = Promise.resolve();

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
    const reservationId = optionalText(options.deckReservationId, 128);
    if (reservationId && !/^dr_[A-Za-z0-9_-]{16,120}$/.test(reservationId)) {
      throw new Error('Invalid deck reservation');
    }
    const deckName =
      quickMatchDeckName(options.deckName) ||
      (reservationId ? '__reserved__' : undefined) ||
      (process.env.NODE_ENV === 'production' ? undefined : DEFAULT_QUICK_MATCH_DECK_NAME);
    if (!deckName) throw new Error('A server-supported deck is required');
    await this.reserveQuickMatchIdentity(auth.userId, deckName, reservationId);
    return { ...auth, role: 'player' };
  }

  private async reserveQuickMatchIdentity(userId: string, deckName: string, reservationId?: string): Promise<void> {
    let releaseAdmission!: () => void;
    const previousAdmission = this.authAdmissionTail;
    this.authAdmissionTail = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    await previousAdmission;
    try {
      // Serialize the async PostgreSQL block check with identity reservation so
      // two concurrent onAuth calls cannot both observe an empty room.
      if (this.authenticatedUserIds.has(userId) || this.clients.some((client) => client.userData?.userId === userId)) {
        throw new Error('Already queued');
      }
      const queuedUserIds = new Set(this.authenticatedUserIds);
      for (const client of this.clients) {
        if (client.userData?.userId) queuedUserIds.add(client.userData.userId);
      }
      for (const queuedUserId of queuedUserIds) {
        if (await QuickMatchRoom.blockStore.areUsersBlocked(userId, queuedUserId)) {
          throw new Error('Quick match is not allowed');
        }
      }
      this.authenticatedUserIds.add(userId);
      this.deckReservations.set(userId, { deckName, ...(reservationId ? { reservationId } : {}) });
    } finally {
      releaseAdmission();
    }
  }

  async onJoin(client: PlatformClient, options: QuickMatchRoomOptions = {}): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new Error('Missing platform auth');
    await assertPlatformAuthCurrent(auth);
    const reservation = this.deckReservations.get(auth.userId);
    const deckName =
      reservation?.deckName ??
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
        deckReservationId: client.userData?.userId
          ? this.deckReservations.get(client.userData.userId)?.reservationId
          : undefined,
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
