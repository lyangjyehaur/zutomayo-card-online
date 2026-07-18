import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeRoomCache, LocalDriver } from '@colyseus/core';
import { PLATFORM_PENDING_INVITE_DISCOVERY_PATH } from '../../platformInviteDiscovery';
import { platformLogger } from '../logger';
import {
  createPendingInviteDiscoveryHandler,
  createRedisPendingInviteRoomQuery,
  platformPendingInviteTimeoutsFromEnv,
} from '../pendingInviteDiscovery';

function response() {
  const res = {
    status: vi.fn(),
    set: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.set.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function allowDiscovery() {
  return { check: vi.fn(async () => true) };
}

function authenticatedRequest(token = 'token') {
  return {
    headers: { cookie: `zutomayo_session=${token}` },
    socket: { remoteAddress: '203.0.113.20' },
  };
}

describe('pending invite discovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses bounded query and Redis command timeouts from runtime configuration', () => {
    expect(platformPendingInviteTimeoutsFromEnv({})).toEqual({
      queryTimeoutMs: 2_000,
      redisCommandTimeoutMs: 1_500,
    });
    expect(
      platformPendingInviteTimeoutsFromEnv({
        PLATFORM_INVITE_DISCOVERY_QUERY_TIMEOUT_MS: '2100',
        PLATFORM_MATCHMAKER_REDIS_COMMAND_TIMEOUT_MS: '1800',
      }),
    ).toEqual({
      queryTimeoutMs: 2_100,
      redisCommandTimeoutMs: 1_800,
    });
  });

  it('uses the current cookie JWT identity and returns only an opaque pending room id', async () => {
    const verifyUserId = vi.fn(async () => 'u_current');
    const limiter = allowDiscovery();
    const queryRooms = vi.fn(async () => [
      {
        name: 'invite',
        roomId: 'invite_room_current',
        locked: false,
        metadata: {
          kind: 'invite',
          status: 'pending',
          targetUserId: 'u_current',
          inviteId: 'friend:v1:u_other:u_current',
          roomCode: 'private-room-code',
          boardgameMatchID: 'private-match-id',
        },
      },
    ]);
    const handler = createPendingInviteDiscoveryHandler({ verifyUserId, limiter, queryRooms });
    const res = response();

    await handler(
      {
        headers: { cookie: 'other=1; zutomayo_session=signed-cookie-token' },
        socket: { remoteAddress: '203.0.113.20' },
        body: { targetUserId: 'u_spoofed' },
        query: { targetUserId: 'u_spoofed' },
      } as never,
      res as never,
      vi.fn(),
    );

    expect(PLATFORM_PENDING_INVITE_DISCOVERY_PATH).toBe('/matchmake/invites/pending');
    expect(verifyUserId).toHaveBeenCalledWith('signed-cookie-token');
    expect(queryRooms).toHaveBeenCalledWith(
      { name: 'invite', status: 'pending', targetUserId: 'u_current', locked: false },
      { createdAt: 1 },
    );
    expect(limiter.check).toHaveBeenCalledWith({ ip: '203.0.113.20', userId: 'u_current' });
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith({ pendingInvite: { roomId: 'invite_room_current' } });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('u_other');
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('private-room-code');
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('private-match-id');
  });

  it('does not disclose non-pending, other-user, malformed, or locked listings', async () => {
    const queryRooms = vi.fn(async () => [
      {
        name: 'invite',
        roomId: 'other_target',
        locked: false,
        metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_other' },
      },
      {
        name: 'invite',
        roomId: 'accepted_room',
        locked: false,
        metadata: { kind: 'invite', status: 'accepted', targetUserId: 'u_current' },
      },
      {
        name: 'invite',
        roomId: 'locked_room',
        locked: true,
        metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_current' },
      },
      {
        name: 'invite',
        roomId: '../invalid-room',
        locked: false,
        metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_current' },
      },
    ]);
    const handler = createPendingInviteDiscoveryHandler({
      verifyUserId: async () => 'u_current',
      limiter: allowDiscovery(),
      queryRooms,
    });
    const res = response();

    await handler(authenticatedRequest() as never, res as never, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ pendingInvite: null });
  });

  it('fails closed without a current cookie identity or when room discovery is unavailable', async () => {
    const queryRooms = vi.fn(async () => []);
    const limiter = allowDiscovery();
    const missingCookie = createPendingInviteDiscoveryHandler({
      verifyUserId: async () => 'u_current',
      limiter,
      queryRooms,
    });
    const missingCookieResponse = response();
    await missingCookie(
      { headers: { authorization: 'Bearer ignored' }, socket: { remoteAddress: '203.0.113.20' } } as never,
      missingCookieResponse as never,
      vi.fn(),
    );
    expect(missingCookieResponse.status).toHaveBeenCalledWith(401);
    expect(queryRooms).not.toHaveBeenCalled();

    const revoked = createPendingInviteDiscoveryHandler({ verifyUserId: async () => '', limiter, queryRooms });
    const revokedResponse = response();
    await revoked(authenticatedRequest('revoked') as never, revokedResponse as never, vi.fn());
    expect(revokedResponse.status).toHaveBeenCalledWith(401);
    expect(queryRooms).not.toHaveBeenCalled();

    vi.spyOn(platformLogger, 'error').mockImplementation(() => undefined as never);
    const unavailable = createPendingInviteDiscoveryHandler({
      verifyUserId: async () => 'u_current',
      limiter,
      queryRooms: async () => {
        throw new Error('redis unavailable');
      },
    });
    const unavailableResponse = response();
    await unavailable(authenticatedRequest() as never, unavailableResponse as never, vi.fn());
    expect(unavailableResponse.status).toHaveBeenCalledWith(503);
    expect(unavailableResponse.json).toHaveBeenCalledWith({
      error: 'Pending invite discovery is temporarily unavailable',
    });
  });

  it('uses a separate fail-closed quota before querying rooms', async () => {
    const limiter = { check: vi.fn(async () => false) };
    const queryRooms = vi.fn(async () => []);
    const handler = createPendingInviteDiscoveryHandler({
      verifyUserId: async () => 'u_current',
      limiter,
      queryRooms,
    });
    const res = response();

    await handler(authenticatedRequest() as never, res as never, vi.fn());

    expect(limiter.check).toHaveBeenCalledWith({ ip: '203.0.113.20', userId: 'u_current' });
    expect(queryRooms).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('bounds stalled room discovery and fails closed', async () => {
    vi.spyOn(platformLogger, 'error').mockImplementation(() => undefined as never);
    const handler = createPendingInviteDiscoveryHandler({
      verifyUserId: async () => 'u_current',
      limiter: allowDiscovery(),
      queryTimeoutMs: 5,
      queryRooms: () => new Promise(() => undefined),
    });
    const res = response();

    await handler(authenticatedRequest() as never, res as never, vi.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Pending invite discovery is temporarily unavailable' });
  });

  it('recovers after a transient Redis roomcache timeout without retaining a rejected query', async () => {
    vi.spyOn(platformLogger, 'error').mockImplementation(() => undefined as never);
    const hgetall = vi
      .fn()
      .mockRejectedValueOnce(new Error('Command timed out'))
      .mockResolvedValueOnce({
        malformed: '{',
        wrong_target: JSON.stringify({
          name: 'invite',
          roomId: 'wrong_target_room',
          locked: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_other' },
        }),
        locked: JSON.stringify({
          name: 'invite',
          roomId: 'locked_room',
          locked: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_current' },
        }),
        accepted: JSON.stringify({
          name: 'invite',
          roomId: 'accepted_room',
          locked: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          metadata: { kind: 'invite', status: 'accepted', targetUserId: 'u_current' },
        }),
        invalid_room: JSON.stringify({
          name: 'invite',
          roomId: '../invalid-room',
          locked: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_current' },
        }),
        newer: JSON.stringify({
          name: 'invite',
          roomId: 'newer_room',
          locked: false,
          createdAt: '2026-01-01T00:02:00.000Z',
          metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_current' },
        }),
        older: JSON.stringify({
          name: 'invite',
          roomId: 'older_room',
          locked: false,
          createdAt: '2026-01-01T00:01:00.000Z',
          metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_current' },
        }),
      });
    const handler = createPendingInviteDiscoveryHandler({
      verifyUserId: async () => 'u_current',
      limiter: allowDiscovery(),
      queryRooms: createRedisPendingInviteRoomQuery({ hgetall }),
    });

    const timedOutResponse = response();
    await handler(authenticatedRequest() as never, timedOutResponse as never, vi.fn());
    expect(timedOutResponse.status).toHaveBeenCalledWith(503);

    const recoveredResponse = response();
    await handler(authenticatedRequest() as never, recoveredResponse as never, vi.fn());
    expect(recoveredResponse.json).toHaveBeenCalledWith({ pendingInvite: { roomId: 'older_room' } });
    expect(hgetall).toHaveBeenCalledTimes(2);
    expect(hgetall).toHaveBeenNthCalledWith(1, 'roomcaches');
    expect(hgetall).toHaveBeenNthCalledWith(2, 'roomcaches');
  });

  it('filters real Colyseus driver metadata before returning the oldest matching room', async () => {
    const driver = new LocalDriver();
    driver.rooms.push(
      initializeRoomCache({
        name: 'invite',
        roomId: 'other_user_room',
        processId: 'p1',
        locked: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_other' },
      }),
      initializeRoomCache({
        name: 'invite',
        roomId: 'current_user_room',
        processId: 'p2',
        locked: false,
        createdAt: new Date('2026-01-01T00:01:00.000Z'),
        metadata: { kind: 'invite', status: 'pending', targetUserId: 'u_current' },
      }),
    );
    const handler = createPendingInviteDiscoveryHandler({
      verifyUserId: async () => 'u_current',
      limiter: allowDiscovery(),
      queryRooms: async (conditions, sortOptions) => driver.query(conditions as never, sortOptions) as never,
    });
    const res = response();

    await handler(authenticatedRequest() as never, res as never, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ pendingInvite: { roomId: 'current_user_room' } });
  });
});
