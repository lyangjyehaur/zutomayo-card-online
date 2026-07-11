import crypto from 'node:crypto';
import type { AuthContext } from '@colyseus/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlatformMatchParticipantStore } from '../../matchParticipantStore';
import { CustomRoom } from '../CustomRoom';
import { QuickMatchRoom } from '../QuickMatchRoom';
import type { BoardgameMatchReadyMessage, PlatformAuth, PlatformClient, PlatformClientProfile } from '../types';

type BoardgameMatchReadyHandler = (client: PlatformClient, message: BoardgameMatchReadyMessage) => void;

const originalJwtSecret = process.env.JWT_SECRET;

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signToken(input: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function createJwt(userId: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({
    sub: userId,
    userId,
    iat: now,
    exp: now + 3600,
  });
  const input = `${header}.${payload}`;
  return `${input}.${signToken(input, secret)}`;
}

function cookieAuthContext(userId: string): AuthContext {
  process.env.JWT_SECRET = 'test-platform-jwt-secret-at-least-32-characters';
  const token = createJwt(userId, process.env.JWT_SECRET);
  return {
    headers: new Headers({ cookie: `zutomayo_session=${encodeURIComponent(token)}` }),
    ip: '127.0.0.1',
  };
}

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
  afterEach(() => {
    process.env.JWT_SECRET = originalJwtSecret;
    CustomRoom.configureParticipantStore(createEmptyPlatformMatchParticipantStore());
  });

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

  it('keeps guest cancellation and leave from interrupting a matched quick match relay', async () => {
    const room = new QuickMatchRoom();
    const handlers = new Map<string, (client: PlatformClient, message?: unknown) => void>();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'lock').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation(((
      type: string,
      handler: (client: PlatformClient, message?: unknown) => void,
    ) => {
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

    broadcast.mockClear();
    setMatchmaking.mockClear();

    handlers.get('cancelQuickMatch')?.(guest);

    expect(broadcast).not.toHaveBeenCalledWith('quickMatchCancelled', expect.anything());
    expect(setMatchmaking).not.toHaveBeenCalledWith({
      metadata: expect.objectContaining({ status: 'cancelled' }),
    });

    await room.onLeave(guest);

    expect(broadcast).not.toHaveBeenCalledWith('quickMatchCancelled', expect.anything());
    expect(setMatchmaking).not.toHaveBeenCalledWith({
      metadata: expect.objectContaining({ status: 'cancelled' }),
    });

    handlers.get('boardgameMatchReady')?.(host, { boardgameMatchID: 'bgio-match-2' });

    expect(broadcast).toHaveBeenCalledWith('boardgameMatchReady', { boardgameMatchID: 'bgio-match-2' });
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        status: 'finished',
        boardgameMatchID: 'bgio-match-2',
      }),
    });
  });

  it('custom room lets only the host relay the boardgame match id once', async () => {
    const room = new CustomRoom();
    const handlers = new Map<string, BoardgameMatchReadyHandler>();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    const lock = vi.spyOn(room, 'lock').mockImplementation(() => undefined as never);
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
    expect(lock).toHaveBeenCalledOnce();
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

    broadcast.mockClear();
    setMatchmaking.mockClear();
    lock.mockClear();
    relay?.(host, { boardgameMatchID: 'bgio-match-3' });
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());
    expect(setMatchmaking).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
  });

  it('records authenticated custom-room participants for durable room chat access', async () => {
    const recordRoomParticipant = vi.fn(async () => undefined);
    CustomRoom.configureParticipantStore({
      ...createEmptyPlatformMatchParticipantStore(),
      recordRoomParticipant,
    });
    const room = new CustomRoom();
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(((_handler: () => void) => ({ clear: vi.fn() })) as never);

    const spectator = client('session_spectator', {
      userId: 'u_spectator',
      displayName: 'Spectator',
      role: 'spectator',
      authenticated: true,
    });

    await room.onCreate({ roomCode: 'ROOM42', status: 'waiting' });
    room.clients.push(spectator);
    await room.onJoin(spectator);

    expect(recordRoomParticipant).toHaveBeenCalledWith({
      roomCode: 'ROOM42',
      userId: 'u_spectator',
      role: 'spectator',
      displayName: 'Spectator',
    });
  });

  it('records verified cookie identity instead of client-supplied custom-room ids', async () => {
    const recordRoomParticipant = vi.fn(async () => undefined);
    CustomRoom.configureParticipantStore({
      ...createEmptyPlatformMatchParticipantStore(),
      recordRoomParticipant,
    });
    const room = new CustomRoom();
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(((_handler: () => void) => ({ clear: vi.fn() })) as never);

    await room.onCreate({ roomCode: 'ROOM42', status: 'waiting' });
    const auth = room.onAuth(
      {} as PlatformClient,
      {
        roomCode: 'ROOM42',
        userId: 'match:ROOM42:player:0',
        displayName: 'Host',
        role: 'player',
      },
      cookieAuthContext('u_cookie_host'),
    );
    const host = client('session_host', auth);
    room.clients.push(host);
    await room.onJoin(host);

    expect(recordRoomParticipant).toHaveBeenCalledWith({
      roomCode: 'ROOM42',
      userId: 'u_cookie_host',
      role: 'player',
      displayName: 'Host',
    });
  });

  it('rejects custom-room joins that target a different room identity', async () => {
    const room = new CustomRoom();
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(((_handler: () => void) => ({ clear: vi.fn() })) as never);

    await room.onCreate({ roomCode: 'ROOM42', boardgameMatchID: 'bgio-match-1', status: 'waiting' });

    expect(() =>
      room.onAuth(
        {} as PlatformClient,
        {
          roomCode: 'OTHER42',
          boardgameMatchID: 'bgio-match-1',
          userId: 'u_player',
          displayName: 'Player',
          role: 'player',
        },
        cookieAuthContext('u_player'),
      ),
    ).toThrow('Custom room access denied');

    expect(() =>
      room.onAuth(
        {} as PlatformClient,
        {
          boardgameMatchID: 'bgio-match-1',
          userId: 'u_player',
          displayName: 'Player',
          role: 'player',
        },
        cookieAuthContext('u_player'),
      ),
    ).toThrow('Custom room access denied');

    expect(() =>
      room.onAuth(
        {} as PlatformClient,
        {
          roomCode: 'ROOM42',
          boardgameMatchID: 'bgio-other-match',
          userId: 'u_player',
          displayName: 'Player',
          role: 'player',
        },
        cookieAuthContext('u_player'),
      ),
    ).toThrow('Custom room access denied');

    expect(() =>
      room.onAuth(
        {} as PlatformClient,
        {
          roomCode: ' ROOM42 ',
          boardgameMatchID: ' bgio-match-1 ',
          userId: 'u_player',
          displayName: 'Player',
          role: 'player',
        },
        cookieAuthContext('u_player'),
      ),
    ).not.toThrow();
  });

  it('custom room keeps spectators out of player seats and relay authority', async () => {
    const room = new CustomRoom();
    const handlers = new Map<string, BoardgameMatchReadyHandler>();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'lock').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation(((type: string, handler: BoardgameMatchReadyHandler) => {
      handlers.set(type, handler);
      return room;
    }) as never);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(((_handler: () => void) => ({ clear: vi.fn() })) as never);

    const spectator = client('session_spectator', {
      userId: 'u_spectator',
      displayName: 'Spectator',
      role: 'spectator',
      authenticated: true,
    });
    const host = client('session_host', {
      userId: 'u_host',
      displayName: 'Host',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate({ roomCode: 'ROOM42', status: 'waiting' });
    room.clients.push(spectator);
    await room.onJoin(spectator);

    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        kind: 'custom-room',
        status: 'waiting',
        playerCount: 0,
        spectatorCount: 1,
      }),
    });

    broadcast.mockClear();
    setMatchmaking.mockClear();
    handlers.get('boardgameMatchReady')?.(spectator, { boardgameMatchID: 'bgio-spectator-ignored' });

    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());
    expect(setMatchmaking).not.toHaveBeenCalledWith({
      metadata: expect.objectContaining({ boardgameMatchID: 'bgio-spectator-ignored' }),
    });

    room.clients.push(host);
    await room.onJoin(host);
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        kind: 'custom-room',
        status: 'waiting',
        playerCount: 1,
        spectatorCount: 1,
      }),
    });

    handlers.get('boardgameMatchReady')?.(host, { boardgameMatchID: 'bgio-match-2' });
    expect(broadcast).toHaveBeenCalledWith('boardgameMatchReady', { boardgameMatchID: 'bgio-match-2' });
  });

  it('demotes extra custom-room players to spectators for durable room chat roles', async () => {
    const recordRoomParticipant = vi.fn(async () => undefined);
    CustomRoom.configureParticipantStore({
      ...createEmptyPlatformMatchParticipantStore(),
      recordRoomParticipant,
    });
    const room = new CustomRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
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
    const extra = client('session_extra', {
      userId: 'u_extra',
      displayName: 'Extra',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate({ roomCode: 'ROOM42', status: 'waiting' });
    room.clients.push(host);
    await room.onJoin(host);
    room.clients.push(guest);
    await room.onJoin(guest);
    room.clients.push(extra);
    await room.onJoin(extra);

    expect(extra.userData).toEqual(
      expect.objectContaining({
        userId: 'u_extra',
        role: 'spectator',
      }),
    );
    expect(recordRoomParticipant).toHaveBeenLastCalledWith({
      roomCode: 'ROOM42',
      userId: 'u_extra',
      role: 'spectator',
      displayName: 'Extra',
    });
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        kind: 'custom-room',
        roomCode: 'ROOM42',
        playerCount: 2,
        spectatorCount: 1,
      }),
    });
  });

  it('custom room promotes a prelinked waiting host room when a guest joins', async () => {
    const room = new CustomRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    const lock = vi.spyOn(room, 'lock').mockImplementation(() => undefined as never);
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

    await room.onCreate({ roomCode: 'ROOM42', boardgameMatchID: 'bgio-match-3', status: 'waiting' });
    room.clients.push(host);
    await room.onJoin(host);

    broadcast.mockClear();
    setMatchmaking.mockClear();

    room.clients.push(guest);
    await room.onJoin(guest);

    expect(lock).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith('boardgameMatchReady', { boardgameMatchID: 'bgio-match-3' });
    expect(setMatchmaking).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        kind: 'custom-room',
        roomCode: 'ROOM42',
        status: 'ready',
        playerCount: 2,
        boardgameMatchID: 'bgio-match-3',
      }),
    });
  });

  it('custom room defaults prelinked host rooms to waiting until a guest joins', async () => {
    const room = new CustomRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    const lock = vi.spyOn(room, 'lock').mockImplementation(() => undefined as never);
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
    const spectator = client('session_spectator', {
      userId: 'u_spectator',
      displayName: 'Spectator',
      role: 'spectator',
      authenticated: true,
    });

    await room.onCreate({ roomCode: 'ROOM42', boardgameMatchID: 'bgio-match-3' });

    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        kind: 'custom-room',
        roomCode: 'ROOM42',
        status: 'waiting',
        playerCount: 0,
        boardgameMatchID: 'bgio-match-3',
      }),
    });

    room.clients.push(host);
    await room.onJoin(host);
    expect(lock).not.toHaveBeenCalled();
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        status: 'waiting',
        playerCount: 1,
        boardgameMatchID: 'bgio-match-3',
      }),
    });
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());

    room.clients.push(spectator);
    await room.onJoin(spectator);
    expect(lock).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchReady', expect.anything());
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        status: 'waiting',
        playerCount: 1,
        spectatorCount: 1,
        boardgameMatchID: 'bgio-match-3',
      }),
    });

    room.clients.push(guest);
    await room.onJoin(guest);
    expect(lock).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith('boardgameMatchReady', { boardgameMatchID: 'bgio-match-3' });
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        status: 'ready',
        playerCount: 2,
        boardgameMatchID: 'bgio-match-3',
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

  it('custom room transfers waiting host ownership to a reconnect session', async () => {
    const room = new CustomRoom();
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room.clock, 'setTimeout').mockImplementation(((_handler: () => void) => ({ clear: vi.fn() })) as never);

    const oldHost = client('session_host_old', {
      userId: 'u_host',
      displayName: 'Host',
      role: 'player',
      authenticated: true,
    });
    const newHost = client('session_host_new', {
      userId: 'u_host',
      displayName: 'Host',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate({ roomCode: 'ROOM42', status: 'waiting' });
    room.clients.push(oldHost);
    await room.onJoin(oldHost);
    room.clients.push(newHost);
    await room.onJoin(newHost);
    await room.onLeave(oldHost);

    expect(broadcast).not.toHaveBeenCalledWith('customRoomCancelled', expect.anything());
    expect(broadcast).toHaveBeenLastCalledWith(
      'customRoomSnapshot',
      expect.objectContaining({
        host: expect.objectContaining({ sessionId: 'session_host_new', userId: 'u_host' }),
      }),
    );
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        kind: 'custom-room',
        status: 'waiting',
        playerCount: 2,
      }),
    });
  });
});
