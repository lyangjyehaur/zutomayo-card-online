import { Room, type AuthContext } from '@colyseus/core';
import { createEmptyPlatformBlockStore, type PlatformBlockStore } from '../blockStore';
import { platformLogger as logger } from '../logger';
import { assertPlatformAuthCurrent, authenticatePlatformClientCurrent } from './auth';
import type {
  BoardgameMatchReadyMessage,
  PlatformAuth,
  PlatformClient,
  PlatformClientProfile,
  QuickMatchRoomMetadata,
  QuickMatchRoomOptions,
  QuickMatchStatus,
  PlatformRelationshipChange,
} from './types';

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

const DEFAULT_QUICK_MATCH_DECK_NAME = '__random__';
const QUICK_MATCH_AUTH_RESERVATION_TTL_MS = Math.min(
  30_000,
  Math.max(2_000, Number(process.env.QUICK_MATCH_AUTH_RESERVATION_TTL_MS) || 10_000),
);
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
  private static readonly activeRooms = new Set<QuickMatchRoom>();

  static configureBlockStore(store: PlatformBlockStore | null): void {
    QuickMatchRoom.blockStore = store ?? createEmptyPlatformBlockStore();
  }

  static async handleRelationshipChange(change: PlatformRelationshipChange): Promise<void> {
    await Promise.all([...QuickMatchRoom.activeRooms].map((room) => room.applyRelationshipChange(change)));
  }

  static async reconcileAuthorization(): Promise<void> {
    await Promise.all([...QuickMatchRoom.activeRooms].map((room) => room.reconcileAuthorization()));
  }

  static clearActiveRoomsForTests(): void {
    QuickMatchRoom.activeRooms.clear();
  }

  maxClients = 2;

  private status: QuickMatchStatus = 'waiting';
  private hostSessionId?: string;
  private matchedUserIds?: readonly [string, string];
  private boardgameMatchID?: string;
  private authenticatedUserIds = new Set<string>();
  private deckReservations = new Map<
    string,
    { deckName: string; reservationId?: string; sessionId?: string; expiresAt: number }
  >();
  private joinedSessionIds = new Set<string>();
  private failedTransitionSessionIds = new Set<string>();
  private authAdmissionTail: Promise<void> = Promise.resolve();
  private finalRelayInFlight = false;

  async onCreate(): Promise<void> {
    this.autoDispose = true;
    this.maxMessagesPerSecond = 4;

    this.onMessage<BoardgameMatchReadyMessage>('boardgameMatchReady', (client, message) => {
      void this.finishBoardgameMatch(client, message);
    });

    this.onMessage('cancelQuickMatch', (client) => {
      if (!client.userData) return;
      if (this.status === 'matched' && client.sessionId !== this.hostSessionId) return;
      void this.cancel('player_left');
    });

    this.onMessage('requestQuickMatchSnapshot', (client) => {
      if (!client.userData || !this.joinedSessionIds.has(client.sessionId)) return;
      this.sendCurrentState(client);
    });

    await this.refreshMetadata();
    QuickMatchRoom.activeRooms.add(this);
  }

  onDispose(): void {
    QuickMatchRoom.activeRooms.delete(this);
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
    await this.reserveQuickMatchIdentity(auth.userId, deckName, reservationId, _client.sessionId);
    return { ...auth, role: 'player' };
  }

  private async reserveQuickMatchIdentity(
    userId: string,
    deckName: string,
    reservationId?: string,
    sessionId?: string,
  ): Promise<void> {
    let releaseAdmission!: () => void;
    const previousAdmission = this.authAdmissionTail;
    this.authAdmissionTail = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    await previousAdmission;
    try {
      this.pruneExpiredReservations();
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
      this.deckReservations.set(userId, {
        deckName,
        ...(reservationId ? { reservationId } : {}),
        ...(sessionId ? { sessionId } : {}),
        expiresAt: Date.now() + QUICK_MATCH_AUTH_RESERVATION_TTL_MS,
      });
    } finally {
      releaseAdmission();
    }
  }

  async onJoin(client: PlatformClient, options: QuickMatchRoomOptions = {}): Promise<void> {
    const auth = client.auth;
    if (!auth) throw new Error('Missing platform auth');
    await assertPlatformAuthCurrent(auth);
    const reservation = this.deckReservations.get(auth.userId);
    if (reservation && reservation.expiresAt <= Date.now()) {
      this.authenticatedUserIds.delete(auth.userId);
      this.deckReservations.delete(auth.userId);
      throw new Error('Expired quick-match reservation');
    }
    if (reservation?.sessionId && reservation.sessionId !== client.sessionId) {
      throw new Error('Stale quick-match reservation');
    }
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

    try {
      await this.assertCurrentPairAllowed();
    } catch (error) {
      this.authenticatedUserIds.delete(auth.userId);
      this.deckReservations.delete(auth.userId);
      client.userData = undefined;
      throw error;
    }
    this.joinedSessionIds.add(client.sessionId);

    if (this.clients.length >= 2 && this.status === 'waiting') {
      const matchedUserIds = this.currentPairUserIds();
      if (!matchedUserIds) throw new Error('Quick-match pair is unavailable');
      this.status = 'matched';
      this.hostSessionId = this.clients[0]?.sessionId;
      this.matchedUserIds = matchedUserIds;
      try {
        await this.lock();
        await this.refreshMetadata();
        this.sendMatchedMessages();
        this.broadcastSnapshot();
      } catch (error) {
        this.failedTransitionSessionIds.add(client.sessionId);
        this.status = 'waiting';
        this.hostSessionId = undefined;
        this.matchedUserIds = undefined;
        try {
          await this.unlock();
        } catch {
          // The room may already be disposed; the metadata rollback below is
          // still attempted so a later admission cannot observe "matched".
        }
        try {
          await this.refreshMetadata();
        } catch {
          // Preserve the original admission error for the client.
        }
        throw error;
      }
      return;
    }

    await this.refreshMetadata();
    this.sendCurrentState(client);
  }

  private pruneExpiredReservations(now = Date.now()): void {
    for (const [userId, reservation] of this.deckReservations) {
      if (reservation.expiresAt > now) continue;
      if (this.clients.some((client) => client.userData?.userId === userId)) continue;
      this.deckReservations.delete(userId);
      this.authenticatedUserIds.delete(userId);
    }
  }

  async onLeave(client: PlatformClient): Promise<void> {
    const completedJoin = this.joinedSessionIds.delete(client.sessionId);
    const failedTransition = this.failedTransitionSessionIds.delete(client.sessionId);
    const userId = client.userData?.userId;
    if (userId) {
      this.authenticatedUserIds.delete(userId);
      this.deckReservations.delete(userId);
    }
    if (!completedJoin || failedTransition) {
      await this.refreshMetadata(client.sessionId);
      return;
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

  private sendMatchedMessage(client: PlatformClient): void {
    if (!this.hostSessionId || !client.userData) return;
    const role = client.sessionId === this.hostSessionId ? 'host' : 'guest';
    const opponent = this.clients.find((item) => item.sessionId !== client.sessionId)?.userData;
    client.send('quickMatchMatched', {
      roomId: this.roomId,
      role,
      deckName: client.userData.deckName || DEFAULT_QUICK_MATCH_DECK_NAME,
      deckReservationId: this.deckReservations.get(client.userData.userId)?.reservationId,
      opponent,
    });
  }

  private sendMatchedMessages(): void {
    for (const client of this.clients) this.sendMatchedMessage(client);
  }

  private sendCurrentState(client: PlatformClient): void {
    if (this.status === 'matched' || this.status === 'finished') this.sendMatchedMessage(client);
    client.send('quickMatchSnapshot', this.snapshot());
  }

  private async assertCurrentPairAllowed(): Promise<void> {
    const userIds = this.currentPairUserIds();
    if (!userIds) return;
    if (await QuickMatchRoom.blockStore.areUsersBlocked(userIds[0], userIds[1])) {
      throw new Error('Quick match is not allowed');
    }
  }

  private currentPairUserIds(): [string, string] | undefined {
    const userIds = [
      ...new Set(
        this.clients
          .map((client) => client.userData?.userId || client.auth?.userId)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    ];
    return userIds.length >= 2 ? [userIds[0], userIds[1]] : undefined;
  }

  private async finishBoardgameMatch(client: PlatformClient, message: BoardgameMatchReadyMessage): Promise<void> {
    if (client.sessionId !== this.hostSessionId || this.status !== 'matched' || this.finalRelayInFlight) return;
    const boardgameMatchID = optionalText(message.boardgameMatchID, 128);
    if (!boardgameMatchID) return;
    const pair = this.matchedUserIds;
    if (!pair) {
      await this.cancel('relationship_check_unavailable');
      return;
    }
    this.finalRelayInFlight = true;

    try {
      const transitioned = await QuickMatchRoom.blockStore.withPairTransitionFence(pair[0], pair[1], async () => {
        if (client.sessionId !== this.hostSessionId || this.status !== 'matched') return false;
        this.boardgameMatchID = boardgameMatchID;
        this.status = 'finished';
        return true;
      });
      if (!transitioned) {
        if (this.status === 'matched') await this.cancel('relationship_changed');
        return;
      }

      await this.refreshMetadata();
      this.broadcast('boardgameMatchReady', { boardgameMatchID });
      this.broadcastSnapshot();
    } catch (err) {
      logger.warn({ err, roomId: this.roomId }, 'quick-match final relationship fence failed');
      if (this.isFinishedTransition(boardgameMatchID)) {
        this.status = 'matched';
        this.boardgameMatchID = undefined;
      }
      if (this.status === 'matched') await this.cancel('relationship_check_unavailable');
    } finally {
      this.finalRelayInFlight = false;
    }
  }

  private isFinishedTransition(boardgameMatchID: string): boolean {
    return this.status === 'finished' && this.boardgameMatchID === boardgameMatchID;
  }

  private broadcastSnapshot(ignoredSessionId?: string): void {
    this.broadcast('quickMatchSnapshot', this.snapshot(ignoredSessionId));
  }

  private async cancel(reason: string, ignoredSessionId?: string): Promise<void> {
    if (this.status === 'cancelled' || this.status === 'finished') return;
    this.status = 'cancelled';
    this.hostSessionId = undefined;
    this.matchedUserIds = undefined;
    this.boardgameMatchID = undefined;
    this.authenticatedUserIds.clear();
    this.deckReservations.clear();
    try {
      await this.refreshMetadata(ignoredSessionId);
    } catch (err) {
      logger.warn({ err, roomId: this.roomId, reason }, 'quick-match cancellation metadata update failed');
    }
    this.broadcast('quickMatchCancelled', { reason });
    this.broadcastSnapshot(ignoredSessionId);
  }

  private roomUserIds(): Set<string> {
    const userIds = new Set(this.authenticatedUserIds);
    for (const userId of this.matchedUserIds ?? []) userIds.add(userId);
    for (const client of this.clients) {
      const userId = client.userData?.userId || client.auth?.userId;
      if (userId) userIds.add(userId);
    }
    return userIds;
  }

  private async applyRelationshipChange(change: PlatformRelationshipChange): Promise<void> {
    const roomUserIds = this.roomUserIds();
    if (change.kind === 'account_deleted') {
      const deletedUserId = change.userIds[0];
      if (!roomUserIds.has(deletedUserId)) return;
      await this.cancel('account_deleted');
      for (const client of this.clients) {
        if ((client.userData?.userId || client.auth?.userId) === deletedUserId) {
          client.leave(4001, 'account_deleted');
        }
      }
      return;
    }
    if (change.kind === 'block_created' && change.userIds.every((userId) => roomUserIds.has(userId))) {
      await this.cancel('relationship_changed');
    }
  }

  private async reconcileAuthorization(): Promise<void> {
    for (const client of this.clients) {
      if (!client.auth) continue;
      try {
        await assertPlatformAuthCurrent(client.auth);
      } catch {
        await this.cancel('authorization_revoked');
        client.leave(4001, 'authorization_revoked');
      }
    }
    if (this.status !== 'waiting' && this.status !== 'matched') return;
    try {
      await this.assertCurrentPairAllowed();
    } catch {
      await this.cancel('relationship_changed');
    }
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
