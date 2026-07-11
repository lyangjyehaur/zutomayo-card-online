import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyPlatformFriendStore } from '../../friendStore';
import { LobbyRoom } from '../LobbyRoom';
import type { PlatformAuth, PlatformClient } from '../types';

function lobbyClient(sessionId: string, auth: PlatformAuth): PlatformClient & { send: ReturnType<typeof vi.fn> } {
  return {
    sessionId,
    auth,
    send: vi.fn(),
  } as PlatformClient & { send: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  LobbyRoom.configureFriendStore(createEmptyPlatformFriendStore());
});

describe('lobby room', () => {
  it('uses server-side friend subscriptions for friend presence updates', async () => {
    const room = new LobbyRoom();
    const listFriendUserIds = vi.fn(async (userId: string) => {
      if (userId === 'u_alice') return ['u_bob'];
      if (userId === 'u_bob') return ['u_alice'];
      return [];
    });
    LobbyRoom.configureFriendStore({ listFriendUserIds });
    vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);

    const alice = lobbyClient('session_alice', {
      userId: 'u_alice',
      displayName: 'Alice',
      role: 'player',
      authenticated: true,
    });
    const mallory = lobbyClient('session_mallory', {
      userId: 'u_mallory',
      displayName: 'Mallory',
      role: 'spectator',
      authenticated: true,
    });
    const bob = lobbyClient('session_bob', {
      userId: 'u_bob',
      displayName: 'Bob',
      role: 'player',
      authenticated: true,
    });

    await room.onCreate();
    room.clients.push(alice);
    await room.onJoin(alice);
    expect(room.broadcast).toHaveBeenCalledWith(
      'presence',
      expect.not.objectContaining({
        profile: expect.anything(),
      }),
    );
    room.clients.push(mallory);
    await room.onJoin(mallory);

    expect(listFriendUserIds).toHaveBeenCalledWith('u_alice');
    expect(alice.send).toHaveBeenCalledWith(
      'lobbySnapshot',
      expect.objectContaining({
        friends: [
          expect.objectContaining({
            userId: 'u_bob',
            online: false,
            activeSessionCount: 0,
          }),
        ],
      }),
    );
    expect(mallory.send).not.toHaveBeenCalledWith('friendPresence', expect.anything());

    room.clients.push(bob);
    await room.onJoin(bob);

    expect(alice.send).toHaveBeenCalledWith(
      'friendPresence',
      expect.objectContaining({
        event: 'online',
        userId: 'u_bob',
        online: true,
        activeSessionCount: 1,
      }),
    );
    expect(mallory.send).not.toHaveBeenCalledWith('friendPresence', expect.anything());

    await room.onLeave(bob);

    expect(alice.send).toHaveBeenCalledWith(
      'friendPresence',
      expect.objectContaining({
        event: 'offline',
        userId: 'u_bob',
        online: false,
        activeSessionCount: 0,
      }),
    );
  });

  it('excludes the leaving lobby session from presence and matchmaking counts', async () => {
    const room = new LobbyRoom();
    const setMatchmaking = vi.spyOn(room, 'setMatchmaking').mockResolvedValue(undefined);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);

    const alice = lobbyClient('session_alice', {
      userId: 'u_alice',
      displayName: 'Alice',
      role: 'player',
      authenticated: true,
    });
    const bob = lobbyClient('session_bob', {
      userId: 'u_bob',
      displayName: 'Bob',
      role: 'spectator',
      authenticated: true,
    });

    await room.onCreate();
    room.clients.push(alice);
    await room.onJoin(alice);
    room.clients.push(bob);
    await room.onJoin(bob);

    broadcast.mockClear();
    setMatchmaking.mockClear();
    await room.onLeave(bob);

    expect(broadcast).toHaveBeenCalledWith(
      'presence',
      expect.objectContaining({
        event: 'leave',
        players: 1,
        spectators: 0,
        onlineCount: 1,
      }),
    );
    expect(setMatchmaking).toHaveBeenLastCalledWith({
      metadata: expect.objectContaining({
        onlineCount: 1,
      }),
    });
  });
});
