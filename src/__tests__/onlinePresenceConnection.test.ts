import { describe, expect, it, vi } from 'vitest';
import type { PlatformLobbyHandlers, PlatformLobbyJoinOptions, PlatformLobbyRoom } from '../platformClient';
import { createOnlinePresenceConnectionController } from '../hooks/onlinePresenceConnection';

function createFallback() {
  let started = false;
  const start = vi.fn(() => {
    started = true;
  });
  const stop = vi.fn(() => {
    started = false;
  });
  return {
    controller: {
      get started() {
        return started;
      },
      start,
      stop,
    },
    start,
    stop,
  };
}

function createRoom(leave = vi.fn(async () => undefined)): PlatformLobbyRoom {
  return { leave } as unknown as PlatformLobbyRoom;
}

describe('online presence Colyseus connection controller', () => {
  it('starts HTTP heartbeat fallback when the Colyseus lobby connection fails', async () => {
    const fallback = createFallback();
    const connectPlatformLobby = vi.fn(
      async (_options: PlatformLobbyJoinOptions, _handlers: PlatformLobbyHandlers): Promise<PlatformLobbyRoom> => {
        throw new Error('platform unavailable');
      },
    );

    const controller = createOnlinePresenceConnectionController({
      connectPlatformLobby,
      loadVisitorId: () => 'anon:presence:abc_12345',
      fallback: fallback.controller,
      setOnlineCount: vi.fn(),
    });

    controller.connect();
    controller.connect();
    await Promise.resolve();

    expect(connectPlatformLobby).toHaveBeenCalledTimes(1);
    expect(connectPlatformLobby.mock.calls[0]?.[0]).toEqual({
      userId: 'anon:presence:abc_12345',
      displayName: 'visitor',
      role: 'spectator',
    });
    expect(connectPlatformLobby.mock.calls[0]?.[0]).not.toHaveProperty('friendIds');
    expect(fallback.start).toHaveBeenCalledTimes(1);
  });

  it('uses platform online counts, restarts fallback on disconnect, and leaves on dispose', async () => {
    const fallback = createFallback();
    const setOnlineCount = vi.fn();
    const leave = vi.fn(async () => undefined);
    let lobbyHandlers: PlatformLobbyHandlers | undefined;
    const connectPlatformLobby = vi.fn(
      async (_options: PlatformLobbyJoinOptions, handlers: PlatformLobbyHandlers): Promise<PlatformLobbyRoom> => {
        lobbyHandlers = handlers;
        return createRoom(leave);
      },
    );

    const controller = createOnlinePresenceConnectionController({
      connectPlatformLobby,
      loadVisitorId: () => 'anon:presence:abc_12345',
      fallback: fallback.controller,
      setOnlineCount,
    });

    controller.connect();
    await Promise.resolve();

    fallback.controller.start();
    lobbyHandlers?.onOnlineCount(7);
    lobbyHandlers?.onDisconnect?.();
    controller.dispose();
    lobbyHandlers?.onOnlineCount(9);
    lobbyHandlers?.onDisconnect?.();

    expect(fallback.stop).toHaveBeenCalledTimes(2);
    expect(setOnlineCount).toHaveBeenCalledTimes(1);
    expect(setOnlineCount).toHaveBeenCalledWith(7);
    expect(fallback.start).toHaveBeenCalledTimes(2);
    expect(leave).toHaveBeenCalledWith(true);
  });

  it('leaves a late Colyseus room when the hook is disposed before connect resolves', async () => {
    const fallback = createFallback();
    const leave = vi.fn(async () => undefined);
    let resolveRoom!: (room: PlatformLobbyRoom) => void;
    const connectPlatformLobby = vi.fn(
      () =>
        new Promise<PlatformLobbyRoom>((resolve) => {
          resolveRoom = resolve;
        }),
    );

    const controller = createOnlinePresenceConnectionController({
      connectPlatformLobby,
      loadVisitorId: () => 'anon:presence:abc_12345',
      fallback: fallback.controller,
      setOnlineCount: vi.fn(),
    });

    controller.connect();
    controller.dispose();
    resolveRoom(createRoom(leave));
    await Promise.resolve();

    expect(controller.disposed).toBe(true);
    expect(fallback.stop).toHaveBeenCalledTimes(1);
    expect(leave).toHaveBeenCalledWith(true);
  });
});
