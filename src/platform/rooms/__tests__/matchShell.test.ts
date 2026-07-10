import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '@colyseus/core';
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

describe('match shell room', () => {
  it('demotes player joins without boardgame credentials to spectator presence', async () => {
    const room = new MatchShellRoom();
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'onMessage').mockImplementation((() => room) as never);

    await room.onCreate({ boardgameMatchID: 'bgio-match-1' });
    const auth = room.onAuth(
      {} as PlatformClient,
      { userId: 'guest:player', displayName: 'Player', role: 'player', boardgamePlayerID: '0' },
      authContext(),
    );
    expect(auth.role).toBe('spectator');

    const client = {
      sessionId: 'session_player',
      auth,
      send: vi.fn(),
    } as unknown as PlatformClient & { send: ReturnType<typeof vi.fn> };
    room.clients.push(client);
    await room.onJoin(client, { boardgamePlayerID: '0' });

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
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
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
    await room.onJoin(client, { boardgamePlayerID: '0', hasBoardgameCredentials: true });

    expect(client.userData).toEqual(
      expect.objectContaining({
        role: 'player',
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
      }),
    );
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
    await room.onJoin(existingClient, { boardgamePlayerID: '0', hasBoardgameCredentials: true });

    const duplicateAuth = room.onAuth(
      {} as PlatformClient,
      {
        userId: 'guest:duplicate',
        displayName: 'Duplicate',
        role: 'player',
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
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
    await room.onJoin(oldClient, { boardgamePlayerID: '0', hasBoardgameCredentials: true });

    const reconnectAuth = room.onAuth(
      {} as PlatformClient,
      {
        userId: 'guest:player',
        displayName: 'Player',
        role: 'player',
        boardgamePlayerID: '0',
        hasBoardgameCredentials: true,
      },
      authContext(),
    );
    expect(reconnectAuth.role).toBe('player');

    room.clients.push(newClient);
    await room.onJoin(newClient, { boardgamePlayerID: '0', hasBoardgameCredentials: true });

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

  it('only lets credentialed players or moderators link boardgame match ids', async () => {
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

    linkBoardgameMatch?.({ userData: spectator } as PlatformClient, { boardgameMatchID: 'bgio-ignored-1' });
    linkBoardgameMatch?.({ userData: uncredentialedPlayer } as PlatformClient, { boardgameMatchID: 'bgio-ignored-2' });
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
        status: 'ready',
      }),
    });
  });

  it('ignores chat preview messages from unauthenticated clients', async () => {
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

    await room.onCreate({ boardgameMatchID: 'bgio-match-1', conversationId: 'match:bgio-match-1' });
    const chatPreview = handlers.get('chatPreview');
    expect(chatPreview).toBeDefined();

    chatPreview?.({ auth: { authenticated: false }, userData: profile } as PlatformClient, { text: 'fake' });
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
      { text: 'persisted hello', conversationId: 'match:bgio-match-1' },
    );

    expect(broadcast).toHaveBeenCalledWith(
      'chatPreview',
      expect.objectContaining({
        conversationId: 'match:bgio-match-1',
        text: 'persisted hello',
      }),
    );
  });
});
