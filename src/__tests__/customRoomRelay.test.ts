import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CustomRoomRelayError,
  customRoomRelayErrorKey,
  resolvePlatformCustomRoomMatchID,
  type JoinPlatformCustomRoom,
} from '../platform/customRoomRelay';
import type { PlatformCustomRoom, PlatformCustomRoomHandlers } from '../platformClient';

function mockRoom(): PlatformCustomRoom {
  return {
    leave: vi.fn(async () => undefined),
  } as unknown as PlatformCustomRoom;
}

function resolverInput(joinPlatformCustomRoom: JoinPlatformCustomRoom, timeoutMs = 1000) {
  return {
    roomCode: 'ROOM42',
    userId: 'u_guest',
    displayName: 'Guest',
    joinPlatformCustomRoom,
    timeoutMs,
  };
}

describe('custom room platform relay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves only with the boardgame match id relayed by Colyseus', async () => {
    let handlers: PlatformCustomRoomHandlers | undefined;
    const room = mockRoom();
    const joinPlatformCustomRoom = vi.fn(async (_options, nextHandlers) => {
      handlers = nextHandlers;
      return room;
    }) satisfies JoinPlatformCustomRoom;

    const matchID = resolvePlatformCustomRoomMatchID(resolverInput(joinPlatformCustomRoom));
    handlers?.onSnapshot?.({
      roomId: 'platform-room-1',
      roomCode: 'ROOM42',
      status: 'ready',
      players: [],
      spectators: [],
      boardgameMatchID: ' bgio-match-1 ',
    });

    await expect(matchID).resolves.toBe('bgio-match-1');
    expect(joinPlatformCustomRoom).toHaveBeenCalledWith(
      expect.objectContaining({ roomCode: 'ROOM42', userId: 'u_guest', displayName: 'Guest' }),
      expect.any(Object),
    );
  });

  it('ignores non-ready or mismatched custom-room snapshots before resolving', async () => {
    vi.useFakeTimers();
    let handlers: PlatformCustomRoomHandlers | undefined;
    const room = mockRoom();
    const joinPlatformCustomRoom = vi.fn(async (_options, nextHandlers) => {
      handlers = nextHandlers;
      return room;
    }) satisfies JoinPlatformCustomRoom;

    const matchID = resolvePlatformCustomRoomMatchID(resolverInput(joinPlatformCustomRoom, 1000));
    const observed = matchID.catch((err: unknown) => err);

    handlers?.onSnapshot?.({
      roomId: 'platform-room-1',
      roomCode: 'ROOM42',
      status: 'waiting',
      players: [],
      spectators: [],
      boardgameMatchID: 'bgio-too-early',
    });
    handlers?.onSnapshot?.({
      roomId: 'platform-room-2',
      roomCode: 'OTHER42',
      status: 'ready',
      players: [],
      spectators: [],
      boardgameMatchID: 'bgio-wrong-room',
    });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(observed).resolves.toEqual(new CustomRoomRelayError('timeout'));
    expect(room.leave).toHaveBeenCalledWith(true);
  });

  it('rejects on timeout instead of falling back to the input room code', async () => {
    vi.useFakeTimers();
    const room = mockRoom();
    const joinPlatformCustomRoom = vi.fn(async () => room) satisfies JoinPlatformCustomRoom;

    const matchID = resolvePlatformCustomRoomMatchID(resolverInput(joinPlatformCustomRoom, 1000));
    const observed = matchID.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);
    const error = await observed;

    expect(error).toMatchObject({
      name: 'CustomRoomRelayError',
      reason: 'timeout',
    });
    expect(error).not.toBe('ROOM42');
    expect(room.leave).toHaveBeenCalledWith(true);
  });

  it('rejects when the platform custom room is cancelled or disconnected', async () => {
    let handlers: PlatformCustomRoomHandlers | undefined;
    const joinPlatformCustomRoom = vi.fn(async (_options, nextHandlers) => {
      handlers = nextHandlers;
      return mockRoom();
    }) satisfies JoinPlatformCustomRoom;

    const cancelled = resolvePlatformCustomRoomMatchID(resolverInput(joinPlatformCustomRoom));
    const observedCancellation = cancelled.catch((err: unknown) => err);
    handlers?.onCancelled?.('host_left');
    await expect(observedCancellation).resolves.toEqual(new CustomRoomRelayError('cancelled'));

    const disconnected = resolvePlatformCustomRoomMatchID(resolverInput(joinPlatformCustomRoom));
    const observedDisconnect = disconnected.catch((err: unknown) => err);
    handlers?.onDisconnect?.();
    await expect(observedDisconnect).resolves.toEqual(new CustomRoomRelayError('disconnected'));
  });

  it('rejects join failures as retryable room join errors', async () => {
    const joinPlatformCustomRoom = vi.fn(async () => {
      throw new Error('platform unavailable');
    }) satisfies JoinPlatformCustomRoom;

    const observed = resolvePlatformCustomRoomMatchID(resolverInput(joinPlatformCustomRoom)).catch(
      (err: unknown) => err,
    );

    await expect(observed).resolves.toEqual(new CustomRoomRelayError('join_failed'));
  });

  it('maps relay failures to retryable lobby error keys', () => {
    expect(customRoomRelayErrorKey(new CustomRoomRelayError('timeout'))).toBe('lobby.matchmakingTimeout');
    expect(customRoomRelayErrorKey(new CustomRoomRelayError('cancelled'))).toBe('lobby.onlineError');
    expect(customRoomRelayErrorKey(new CustomRoomRelayError('disconnected'))).toBe('lobby.onlineError');
    expect(customRoomRelayErrorKey(new CustomRoomRelayError('join_failed'))).toBe('lobby.onlineError');
    expect(customRoomRelayErrorKey(new Error('other'))).toBeNull();
  });
});
