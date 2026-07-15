import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectPlatformMatchShellWithRetry, platformMatchShellReconnectDelay } from '../platformMatchShellConnection';
import type { PlatformMatchShellHandlers, PlatformMatchShellRoom } from '../platformClient';

afterEach(() => {
  vi.useRealTimers();
});

function fakeRoom(): PlatformMatchShellRoom {
  return { leave: vi.fn(async () => undefined) } as unknown as PlatformMatchShellRoom;
}

describe('platform match shell reconnect controller', () => {
  it('uses a capped exponential delay', () => {
    expect(platformMatchShellReconnectDelay(0)).toBe(500);
    expect(platformMatchShellReconnectDelay(1)).toBe(1000);
    expect(platformMatchShellReconnectDelay(4)).toBe(8000);
    expect(platformMatchShellReconnectDelay(99)).toBe(8000);
  });

  it('rejoins after a room disconnect and forwards the new room', async () => {
    vi.useFakeTimers();
    const rooms = [fakeRoom(), fakeRoom()];
    const connectionHandlers: PlatformMatchShellHandlers[] = [];
    const connect = vi.fn(async (_options, handlers: PlatformMatchShellHandlers) => {
      connectionHandlers.push(handlers);
      return rooms[connectionHandlers.length - 1];
    });
    const states: string[] = [];
    const onRoomChange = vi.fn();
    const controller = connectPlatformMatchShellWithRetry(
      { boardgameMatchID: 'match-1', userId: 'user-1', displayName: 'Alice' },
      {
        onRoomChange,
        onStateChange: (state) => states.push(state),
      },
      { connect, setTimeout, clearTimeout },
    );

    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onRoomChange).toHaveBeenLastCalledWith(rooms[0]);
    connectionHandlers[0].onDisconnect?.();
    expect(states).toContain('reconnecting');
    expect(onRoomChange).toHaveBeenLastCalledWith(null);

    await vi.advanceTimersByTimeAsync(platformMatchShellReconnectDelay(0));
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(onRoomChange).toHaveBeenLastCalledWith(rooms[1]);

    await controller.stop();
    expect(onRoomChange).toHaveBeenLastCalledWith(null);
  });

  it('cancels pending retries on stop', async () => {
    vi.useFakeTimers();
    const connect = vi.fn(async (_options, handlers: PlatformMatchShellHandlers) => {
      handlers.onDisconnect?.();
      return fakeRoom();
    });
    const controller = connectPlatformMatchShellWithRetry(
      { boardgameMatchID: 'match-1', userId: 'user-1', displayName: 'Alice' },
      {},
      { connect, setTimeout, clearTimeout },
    );
    await Promise.resolve();
    await controller.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
