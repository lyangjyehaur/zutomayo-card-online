import { describe, expect, it, vi } from 'vitest';
import { createPlatformSeatToken } from '../../seatToken';
import { CustomRoom } from '../CustomRoom';
import { InviteRoom } from '../InviteRoom';
import { MatchShellRoom } from '../MatchShellRoom';
import { QuickMatchRoom } from '../QuickMatchRoom';
import type { PlatformAuth, PlatformClient } from '../types';

const forbiddenBoardgameStateKeys = new Set([
  'G',
  'ctx',
  'gameState',
  'state',
  'deck',
  'hand',
  'discard',
  'moves',
  'actionLog',
  'secret',
  'cards',
  'effects',
  'credentials',
  'playerView',
]);

function collectForbiddenKeys(value: unknown, path = '$', found: string[] = []): string[] {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, found));
    return found;
  }

  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (forbiddenBoardgameStateKeys.has(key)) found.push(nextPath);
    collectForbiddenKeys(item, nextPath, found);
  }
  return found;
}

function expectNoBoardgameState(value: unknown): void {
  expect(collectForbiddenKeys(value)).toEqual([]);
}

function client(sessionId: string, auth: PlatformAuth): PlatformClient & { send: ReturnType<typeof vi.fn> } {
  return {
    sessionId,
    auth,
    send: vi.fn(),
  } as PlatformClient & { send: ReturnType<typeof vi.fn> };
}

function runShortTimersOnly(handler: () => void, timeout?: number): { clear: ReturnType<typeof vi.fn> } {
  if (typeof timeout === 'number' && timeout <= 100) handler();
  return { clear: vi.fn() };
}

const poisonedBoardgamePayload = {
  G: { hand: ['hidden-card'] },
  ctx: { phase: 'main' },
  deck: ['secret-card'],
  credentials: 'raw-boardgame-credentials',
  actionLog: [{ move: 'play-card' }],
  playerView: { hand: ['hidden-card'] },
};

function seatToken(): string {
  process.env.PLATFORM_SEAT_TOKEN_SECRET = 'test-seat-token-secret-at-least-32-characters';
  return createPlatformSeatToken({ matchID: 'bgio-match-1', playerID: '0' });
}

describe('platform room boundary', () => {
  it('keeps match shell snapshots and metadata free of boardgame state', async () => {
    const room = new MatchShellRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    const player = client('session_player', {
      userId: 'u_player',
      displayName: 'Player',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate({
      boardgameMatchID: 'bgio-match-1',
      conversationId: 'match:bgio-match-1',
      ...poisonedBoardgamePayload,
    });
    room.clients.push(player);
    await room.onJoin(player, {
      boardgameMatchID: 'bgio-match-1',
      boardgamePlayerID: '0',
      hasBoardgameCredentials: true,
      platformSeatToken: seatToken(),
      ...poisonedBoardgamePayload,
    });

    expectNoBoardgameState(player.send.mock.calls);
    expectNoBoardgameState(setMatchmaking.mock.calls);
  });

  it('keeps quick match snapshots and metadata free of boardgame state', async () => {
    const room = new QuickMatchRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'lock').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(runShortTimersOnly as never);

    const host = client('session_host', {
      userId: 'u_host',
      displayName: 'Host',
      role: 'player',
      authenticated: true,
    });
    const guest = client('session_guest', {
      userId: 'u_guest',
      displayName: 'Guest',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate();
    room.clients.push(host);
    await room.onJoin(host);
    room.clients.push(guest);
    await room.onJoin(guest);

    expectNoBoardgameState(host.send.mock.calls);
    expectNoBoardgameState(guest.send.mock.calls);
    expectNoBoardgameState(broadcast.mock.calls);
    expectNoBoardgameState(setMatchmaking.mock.calls);
  });

  it('keeps custom room snapshots and metadata free of boardgame state', async () => {
    const room = new CustomRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(runShortTimersOnly as never);

    const host = client('session_host', {
      userId: 'u_host',
      displayName: 'Host',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate({ roomCode: 'ROOM42', boardgameMatchID: 'bgio-match-1', ...poisonedBoardgamePayload });
    room.clients.push(host);
    await room.onJoin(host);

    expectNoBoardgameState(host.send.mock.calls);
    expectNoBoardgameState(broadcast.mock.calls);
    expectNoBoardgameState(setMatchmaking.mock.calls);
  });

  it('keeps invite snapshots and metadata free of boardgame state', async () => {
    const room = new InviteRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(runShortTimersOnly as never);

    const inviter = client('session_inviter', {
      userId: 'u_inviter',
      displayName: 'Inviter',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate({
      inviteId: 'friend:v1:u_inviter:u_target',
      targetUserId: 'u_target',
      boardgameMatchID: 'bgio-match-1',
      ...poisonedBoardgamePayload,
    });
    room.clients.push(inviter);
    await room.onJoin(inviter);

    expectNoBoardgameState(inviter.send.mock.calls);
    expectNoBoardgameState(broadcast.mock.calls);
    expectNoBoardgameState(setMatchmaking.mock.calls);
  });
});
