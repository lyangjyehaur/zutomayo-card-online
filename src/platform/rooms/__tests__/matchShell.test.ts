import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '@colyseus/core';
import { createEmptyPlatformMatchParticipantStore } from '../../matchParticipantStore';
import { createPlatformSeatToken } from '../../seatToken';
import { MatchShellRoom } from '../MatchShellRoom';
import type { ChatPreviewMessage, LinkBoardgameMatchMessage, PlatformClient, PlatformClientProfile } from '../types';

type ChatPreviewHandler = (client: PlatformClient, message: ChatPreviewMessage) => void;
type LinkBoardgameMatchHandler = (client: PlatformClient, message: LinkBoardgameMatchMessage) => void;

function authContext(): AuthContext {
  return {
    headers: new Headers(),
    ip: '127.0.0.1',
  };
}

const originalSeatTokenSecret = process.env.PLATFORM_SEAT_TOKEN_SECRET;
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

function seatToken(matchID = 'bgio-match-1', playerID: '0' | '1' = '0'): string {
  process.env.PLATFORM_SEAT_TOKEN_SECRET = 'test-seat-token-secret-at-least-32-characters';
  return createPlatformSeatToken({ matchID, playerID });
}

afterEach(() => {
  process.env.PLATFORM_SEAT_TOKEN_SECRET = originalSeatTokenSecret;
  process.env.JWT_SECRET = originalJwtSecret;
  MatchShellRoom.configureParticipantStore(createEmptyPlatformMatchParticipantStore());
});

describe('match shell room', () => {
  it('demotes player joins without boardgame credentials to spectator presence', async () => {
    const room = new MatchShellRoom();
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    await room.onCreate({ boardgameMatchID: 'bgio-match-1' });
    const auth = room.onAuth(
      {} as PlatformClient,
      {
        userId: 'guest:player',
        displayName: 'Player',
        role: 'player',
        boardgameMatchID: 'bgio-match-1',
        boardgamePlayerID: '0',
      },
      authContext(),
    );
    expect(auth.role).toBe('spectator');

    const client = {
      sessionId: 'session_player',
      auth,
      send: vi.fn(),
    } as unknown as PlatformClient & { send: ReturnType<typeof vi.fn> };
    room.clients.push(client);
    await room.onJoin(client, { boardgameMatchID: 'bgio-match-1', boardgamePlayerID: '0' });

    expect(client.userData).toEqual(
      expect.objectContaining({
        role: 'spectator',
        boardgamePlayerID: undefined,
        hasBoardgameCredentials: false,
      }),
    );
    expect(broadcast).toHaveBeenCalledWith(
      'presence',
      expect.objectContaining({
        players: 0,
        spectators: 1,
      }),
    );
  });

  it('keeps credentialed boardgame seats as player presence', async () => {
    const room = new MatchShellRoom();
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    await room.onCreate({ boardgameMatchID: 'bgio-match-1' });
    const auth = room.onAuth(
      {} as PlatformClient,
      {
        userId: 'guest:player',
        displayName: 'Player',
        role: 'player',
        boardgameMatchID: 'bgio-match-1',
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
        platformSeatToken: seatToken(),
      },
      authContext(),
    );
    expect(auth.role).toBe('player');

    const client = {
      sessionId: 'session_player',
      auth,
      send: vi.fn(),
    } as unknown as PlatformClient & { send: ReturnType<typeof vi.fn> };
    room.clients.push(client);
    await room.onJoin(client, {
      boardgameMatchID: 'bgio-match-1',
      boardgamePlayerID: '0',
      hasBoardgameCredentials: true,
      platformSeatToken: seatToken(),
    });

    expect(client.userData).toEqual(
      expect.objectContaining({
        role: 'player',
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
      }),
    );
  });

  it('records authenticated match-shell participants for durable match chat access', async () => {
    const recordParticipant = vi.fn(async () => undefined);
    MatchShellRoom.configureParticipantStore({
      ...createEmptyPlatformMatchParticipantStore(),
      recordParticipant,
    });
    const room = new MatchShellRoom();
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    await room.onCreate({ boardgameMatchID: 'bgio-match-1' });
    const client = {
      sessionId: 'session_spectator',
      auth: {
        userId: 'u_spectator',
        displayName: 'Spectator',
        role: 'spectator',
        authenticated: true,
      },
      send: vi.fn(),
    } as unknown as PlatformClient & { send: ReturnType<typeof vi.fn> };
    room.clients.push(client);

    await room.onJoin(client, { boardgameMatchID: 'bgio-match-1' });

    expect(recordParticipant).toHaveBeenCalledWith({
      boardgameMatchID: 'bgio-match-1',
      userId: 'u_spectator',
      role: 'spectator',
      boardgamePlayerID: undefined,
      displayName: 'Spectator',
    });
  });

  it('records verified cookie identity instead of client-supplied match-shell ids', async () => {
    const recordParticipant = vi.fn(async () => undefined);
    MatchShellRoom.configureParticipantStore({
      ...createEmptyPlatformMatchParticipantStore(),
      recordParticipant,
    });
    const room = new MatchShellRoom();
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    await room.onCreate({ boardgameMatchID: 'bgio-match-1' });
    const auth = room.onAuth(
      {} as PlatformClient,
      {
        boardgameMatchID: 'bgio-match-1',
        userId: 'match:bgio-match-1:player:0',
        displayName: 'Player',
        role: 'player',
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
        platformSeatToken: seatToken(),
      },
      cookieAuthContext('u_cookie_player'),
    );

    const client = {
      sessionId: 'session_player',
      auth,
      send: vi.fn(),
    } as unknown as PlatformClient & { send: ReturnType<typeof vi.fn> };
    room.clients.push(client);
    await room.onJoin(client, {
      boardgameMatchID: 'bgio-match-1',
      boardgamePlayerID: '0',
      hasBoardgameCredentials: true,
      platformSeatToken: seatToken(),
    });

    expect(recordParticipant).toHaveBeenCalledWith({
      boardgameMatchID: 'bgio-match-1',
      userId: 'u_cookie_player',
      role: 'player',
      boardgamePlayerID: '0',
      displayName: 'Player',
    });
  });

  it('demotes player joins that only self-report boardgame credentials', async () => {
    const room = new MatchShellRoom();
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    await room.onCreate({ boardgameMatchID: 'bgio-match-1' });

    const auth = room.onAuth(
      {} as PlatformClient,
      {
        userId: 'guest:spoofed',
        displayName: 'Spoofed',
        role: 'player',
        boardgameMatchID: 'bgio-match-1',
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
      },
      authContext(),
    );

    expect(auth.role).toBe('spectator');
  });

  it('normalizes prelinked match shells to ready status', async () => {
    const room = new MatchShellRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    await room.onCreate({ boardgameMatchID: 'bgio-match-1', status: 'waiting' });

    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        boardgameMatchID: 'bgio-match-1',
        status: 'ready',
      }),
    });
  });

  it('rejects joins that target a different boardgame match shell', async () => {
    const room = new MatchShellRoom();
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    await room.onCreate({ boardgameMatchID: 'bgio-match-1' });

    expect(() =>
      room.onAuth(
        {} as PlatformClient,
        {
          userId: 'u_player',
          displayName: 'Player',
          role: 'player',
          boardgameMatchID: 'bgio-match-2',
          boardgamePlayerID: '0',
          hasBoardgameCredentials: true,
          platformSeatToken: seatToken(),
        },
        authContext(),
      ),
    ).toThrow('Match shell access denied');
  });

  it('demotes duplicate boardgame player seats from different users', async () => {
    const room = new MatchShellRoom();
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    await room.onCreate({ boardgameMatchID: 'bgio-match-1' });
    const existingClient = {
      sessionId: 'session_existing',
      auth: {
        userId: 'guest:existing',
        displayName: 'Existing',
        role: 'player',
        authenticated: true,
      },
      send: vi.fn(),
    } as unknown as PlatformClient & { send: ReturnType<typeof vi.fn> };
    room.clients.push(existingClient);
    await room.onJoin(existingClient, {
      boardgameMatchID: 'bgio-match-1',
      boardgamePlayerID: '0',
      hasBoardgameCredentials: true,
      platformSeatToken: seatToken(),
    });

    const duplicateAuth = room.onAuth(
      {} as PlatformClient,
      {
        userId: 'guest:duplicate',
        displayName: 'Duplicate',
        role: 'player',
        boardgameMatchID: 'bgio-match-1',
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
        platformSeatToken: seatToken(),
      },
      authContext(),
    );

    expect(duplicateAuth.role).toBe('spectator');
  });

  it('transfers a boardgame player seat to the same user reconnect session', async () => {
    const room = new MatchShellRoom();
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    await room.onCreate({ boardgameMatchID: 'bgio-match-1' });
    const oldClient = {
      sessionId: 'session_old',
      auth: {
        userId: 'guest:player',
        displayName: 'Player',
        role: 'player',
        authenticated: true,
      },
      send: vi.fn(),
    } as unknown as PlatformClient & { send: ReturnType<typeof vi.fn> };
    const newClient = {
      sessionId: 'session_new',
      auth: {
        userId: 'guest:player',
        displayName: 'Player',
        role: 'player',
        authenticated: true,
      },
      send: vi.fn(),
    } as unknown as PlatformClient & { send: ReturnType<typeof vi.fn> };

    room.clients.push(oldClient);
    await room.onJoin(oldClient, {
      boardgameMatchID: 'bgio-match-1',
      boardgamePlayerID: '0',
      hasBoardgameCredentials: true,
      platformSeatToken: seatToken(),
    });

    const reconnectAuth = room.onAuth(
      {} as PlatformClient,
      {
        userId: 'guest:player',
        displayName: 'Player',
        role: 'player',
        boardgameMatchID: 'bgio-match-1',
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
        platformSeatToken: seatToken(),
      },
      authContext(),
    );
    expect(reconnectAuth.role).toBe('player');

    room.clients.push(newClient);
    await room.onJoin(newClient, {
      boardgameMatchID: 'bgio-match-1',
      boardgamePlayerID: '0',
      hasBoardgameCredentials: true,
      platformSeatToken: seatToken(),
    });

    expect(oldClient.userData).toEqual(
      expect.objectContaining({
        role: 'spectator',
        boardgamePlayerID: undefined,
        hasBoardgameCredentials: false,
      }),
    );
    expect(newClient.userData).toEqual(
      expect.objectContaining({
        role: 'player',
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
      }),
    );
    expect(broadcast).toHaveBeenLastCalledWith(
      'presence',
      expect.objectContaining({
        players: 1,
        spectators: 1,
      }),
    );
  });

  it('only lets credentialed players link the boardgame match id once', async () => {
    const room = new MatchShellRoom();
    const handlers = new Map<string, LinkBoardgameMatchHandler>();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'onMessage').mockImplementation(((type: string, handler: LinkBoardgameMatchHandler) => {
      handlers.set(type, handler);
      return room;
    }) as never);

    await room.onCreate({ status: 'waiting' });
    const linkBoardgameMatch = handlers.get('linkBoardgameMatch');
    expect(linkBoardgameMatch).toBeDefined();

    const spectator: PlatformClientProfile = {
      sessionId: 'session_spectator',
      userId: 'u_spectator',
      displayName: 'Spectator',
      role: 'spectator',
      joinedAt: 1000,
    };
    const uncredentialedPlayer: PlatformClientProfile = {
      sessionId: 'session_player',
      userId: 'u_player',
      displayName: 'Player',
      role: 'player',
      joinedAt: 1000,
      boardgamePlayerID: '0',
    };
    const credentialedPlayer: PlatformClientProfile = {
      ...uncredentialedPlayer,
      sessionId: 'session_host',
      userId: 'u_host',
      displayName: 'Host',
      hasBoardgameCredentials: true,
    };
    const selfReportedModerator = {
      sessionId: 'session_mod',
      userId: 'u_mod',
      displayName: 'Mod',
      role: 'moderator',
      joinedAt: 1000,
    } as unknown as PlatformClientProfile;

    linkBoardgameMatch?.({ userData: spectator } as PlatformClient, { boardgameMatchID: 'bgio-ignored-1' });
    linkBoardgameMatch?.({ userData: uncredentialedPlayer } as PlatformClient, { boardgameMatchID: 'bgio-ignored-2' });
    linkBoardgameMatch?.({ userData: selfReportedModerator } as PlatformClient, {
      boardgameMatchID: 'bgio-ignored-mod',
    });
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchLinked', expect.anything());

    linkBoardgameMatch?.({ userData: credentialedPlayer } as PlatformClient, { boardgameMatchID: ' bgio-match-1 ' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(broadcast).toHaveBeenCalledWith('boardgameMatchLinked', {
      boardgameMatchID: 'bgio-match-1',
      status: 'ready',
    });
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        boardgameMatchID: 'bgio-match-1',
        conversationId: 'match:bgio-match-1',
        status: 'ready',
      }),
    });

    broadcast.mockClear();
    setMatchmaking.mockClear();
    linkBoardgameMatch?.({ userData: credentialedPlayer } as PlatformClient, { boardgameMatchID: 'bgio-match-2' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(broadcast).not.toHaveBeenCalledWith('boardgameMatchLinked', expect.anything());
    expect(setMatchmaking).not.toHaveBeenCalled();
  });

  it('keeps match chat preview scoped to the shell conversation', async () => {
    const room = new MatchShellRoom();
    const handlers = new Map<string, ChatPreviewHandler>();
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation(((type: string, handler: ChatPreviewHandler) => {
      handlers.set(type, handler);
      return room;
    }) as never);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    const profile: PlatformClientProfile = {
      sessionId: 'session_1',
      userId: 'guest:session_1',
      displayName: 'Guest',
      role: 'spectator',
      joinedAt: 1000,
    };

    await room.onCreate({ boardgameMatchID: 'bgio-match-1', conversationId: 'match:bgio-other-match' });
    const chatPreview = handlers.get('chatPreview');
    expect(chatPreview).toBeDefined();

    chatPreview?.({ auth: { authenticated: false }, userData: profile } as PlatformClient, {
      messageId: 'chat_msg_fake',
    });
    expect(broadcast).not.toHaveBeenCalledWith('chatPreview', expect.anything());

    chatPreview?.(
      {
        auth: {
          userId: 'u_1',
          displayName: 'Alice',
          role: 'spectator',
          authenticated: true,
        },
        userData: { ...profile, userId: 'u_1', displayName: 'Alice' },
      } as PlatformClient,
      { messageId: 'chat_msg_wrong_room', conversationId: 'match:bgio-other-match' },
    );
    expect(broadcast).not.toHaveBeenCalledWith('chatPreview', expect.anything());

    chatPreview?.(
      {
        auth: {
          userId: 'u_1',
          displayName: 'Alice',
          role: 'spectator',
          authenticated: true,
        },
        userData: { ...profile, userId: 'u_1', displayName: 'Alice' },
      } as PlatformClient,
      { messageId: 'chat_msg_persisted' },
    );
    expect(broadcast).toHaveBeenCalledWith(
      'chatPreview',
      expect.objectContaining({
        conversationId: 'match:bgio-match-1',
        messageId: 'chat_msg_persisted',
      }),
    );
  });
});
