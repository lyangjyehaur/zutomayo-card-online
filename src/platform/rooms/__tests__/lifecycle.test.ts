import { describe, expect, it, vi } from 'vitest';
import { CustomRoom } from '../CustomRoom';
import { QuickMatchRoom } from '../QuickMatchRoom';
import type { BoardgameMatchReadyMessage, PlatformAuth, PlatformClient, PlatformClientProfile } from '../types';

type BoardgameMatchReadyHandler = (client: PlatformClient, message: BoardgameMatchReadyMessage) => void;

function client(sessionId: string, auth: PlatformAuth): PlatformClient & { send: ReturnType<typeof vi.fn> } {
  return {
    sessionId,
    auth,
    send: vi.fn(),
  } as PlatformClient & { send: ReturnType<typeof vi.fn> };
}

function profile(client: PlatformClient): PlatformClientProfile {
  return {
    sessionId: client.sessionId,
    userId: client.auth!.userId,
    displayName: client.auth!.displayName,
    role: 'player',
    joinedAt: 1000,
  };
}

describe('platform room lifecycle', () => {
  it('quick match pairs two players and only the host can relay the boardgame match id', async () => {
    const room = new QuickMatchRoom();
    const handlers = new Map<string, BoardgameMatchReadyHandler>();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    const lock = vi.spyOn(room, 'lock').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation(((type: string, handler: BoardgameMatchReadyHandler) => {
      handlers.set(type, handler);
      return room;
    }) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(((handler: () => void) => {
      handler();
      return { clear: vi.fn() };
    }) as never);

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

    expect(lock).toHaveBeenCalledOnce();
    expect(host.send).toHaveBeenCalledWith('quickMatchMatched', expect.objectContaining({ role: 'host' }));
    expect(guest.send).toHaveBeenCalledWith('quickMatchMatched', expect.objectContaining({ role: 'guest' }));
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        kind: 'quick-match',
        status: 'matched',
        playerCount: 2,
        hostSessionId: 'session_host',
      }),
    });

    const relay = handlers.get('boardgameMatchReady');
    expect(relay).toBeDefined();
    relay?.(guest, { boardgameMatchID: 'bgio-match-ignored' });
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());

    relay?.(host, { boardgameMatchID: ' bgio-match-1 ' });
    expect(broadcast).toHaveBeenCalledWith('boardgameMatchReady', { boardgameMatchID: 'bgio-match-1' });
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        status: 'finished',
        boardgameMatchID: 'bgio-match-1',
      }),
    });
  });

  it('custom room lets only the host relay the boardgame match id', async () => {
    const room = new CustomRoom();
    const handlers = new Map<string, BoardgameMatchReadyHandler>();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation(((type: string, handler: BoardgameMatchReadyHandler) => {
      handlers.set(type, handler);
      return room;
    }) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(((_handler: () => void) => ({ clear: vi.fn() })) as never);

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

    await room.onCreate({ roomCode: 'ROOM42', status: 'waiting' });
    room.clients.push(host);
    await room.onJoin(host);
    room.clients.push(guest);
    await room.onJoin(guest);

    const relay = handlers.get('boardgameMatchReady');
    expect(relay).toBeDefined();
    relay?.(guest, { boardgameMatchID: 'bgio-match-ignored' });
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());

    relay?.(host, { boardgameMatchID: 'bgio-match-2' });
    expect(broadcast).toHaveBeenCalledWith('boardgameMatchReady', { boardgameMatchID: 'bgio-match-2' });
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        kind: 'custom-room',
        roomCode: 'ROOM42',
        status: 'ready',
        playerCount: 2,
        boardgameMatchID: 'bgio-match-2',
      }),
    });
  });

  it('custom room cancellation is controlled by the waiting host', async () => {
    const room = new CustomRoom();
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(((_handler: () => void) => ({ clear: vi.fn() })) as never);

    const host = client('session_host', {
      userId: 'u_host',
      displayName: 'Host',
      role: 'player',
      authenticated: true,
    });
    host.userData = profile(host);

    await room.onCreate({ roomCode: 'ROOM42', status: 'waiting' });
    room.clients.push(host);
    await room.onJoin(host);
    await room.onLeave(host);

    expect(broadcast).toHaveBeenCalledWith('customRoomCancelled', { reason: 'host_left' });
  });
});
