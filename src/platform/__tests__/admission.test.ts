import { describe, expect, it, vi } from 'vitest';
import {
  createPlatformAdmissionLimiter,
  createPlatformAdmissionMiddleware,
  createPlatformPendingInviteDiscoveryLimiter,
  platformAdmissionClientIp,
  platformPendingInviteDiscoveryLimitsFromEnv,
  RedisPlatformAdmissionLimiter,
  type PlatformAdmissionLimits,
} from '../admission';

const limits: PlatformAdmissionLimits = {
  ipLimit: 3,
  userLimit: 2,
  globalLimit: 10,
  windowSeconds: 60,
  timeoutMs: 20,
};

describe('platform admission limiter', () => {
  it('atomically consumes IP, user, and global Redis quotas without storing raw identities', async () => {
    const evalCommand = vi.fn(async () => [1, 1, 1]);
    const limiter = new RedisPlatformAdmissionLimiter({ eval: evalCommand }, limits);

    await expect(limiter.check({ ip: '203.0.113.8', userId: 'logto:user-1' }, 120_000)).resolves.toBe(true);
    expect(evalCommand).toHaveBeenCalledTimes(1);
    const args = evalCommand.mock.calls[0] as unknown as Array<unknown>;
    expect(args[1]).toBe(3);
    expect(args.slice(2, 5)).toEqual([
      expect.stringMatching(/^platform:admission:\{v1:2\}:ip:[a-f0-9]{32}$/),
      expect.stringMatching(/^platform:admission:\{v1:2\}:user:[a-f0-9]{32}$/),
      'platform:admission:{v1:2}:global',
    ]);
    expect(args.join(' ')).not.toContain('203.0.113.8');
    expect(args.join(' ')).not.toContain('logto:user-1');
    expect(args.slice(-4)).toEqual([120, 10, 3, 2]);
  });

  it('rejects when any quota is exceeded or Redis returns an invalid reply', async () => {
    const overUser = new RedisPlatformAdmissionLimiter({ eval: vi.fn(async () => [1, 3, 1]) }, limits);
    await expect(overUser.check({ ip: '203.0.113.8', userId: 'u_1' })).resolves.toBe(false);

    const invalidReply = new RedisPlatformAdmissionLimiter({ eval: vi.fn(async () => null) }, limits);
    await expect(invalidReply.check({ ip: '203.0.113.8', userId: 'u_1' })).resolves.toBe(false);
  });

  it('fails closed within a bounded time when Redis is unavailable', async () => {
    const unavailable = new RedisPlatformAdmissionLimiter(
      {
        eval: vi.fn(async () => {
          throw new Error('redis unavailable');
        }),
      },
      limits,
    );
    await expect(unavailable.check({ ip: '203.0.113.8' })).resolves.toBe(false);

    const stalled = new RedisPlatformAdmissionLimiter(
      { eval: vi.fn(() => new Promise(() => undefined)) },
      { ...limits, timeoutMs: 5 },
    );
    await expect(stalled.check({ ip: '203.0.113.8' })).resolves.toBe(false);
  });

  it('requires Redis in production while allowing explicit local memory mode', async () => {
    await expect(
      createPlatformAdmissionLimiter(null, { nodeEnv: 'production' }).check({ ip: '127.0.0.1' }),
    ).resolves.toBe(false);
    await expect(createPlatformAdmissionLimiter(null, { nodeEnv: 'test' }).check({ ip: '127.0.0.1' })).resolves.toBe(
      true,
    );
  });

  it('uses an independent, wider Redis quota namespace for invite discovery reads', async () => {
    const evalCommand = vi.fn(async () => [1, 1, 1]);
    const discoveryLimits = platformPendingInviteDiscoveryLimitsFromEnv({});
    const limiter = createPlatformPendingInviteDiscoveryLimiter(
      { eval: evalCommand },
      { nodeEnv: 'production', limits: discoveryLimits },
    );

    await expect(limiter.check({ ip: '203.0.113.8', userId: 'u_reader' }, 120_000)).resolves.toBe(true);

    const args = evalCommand.mock.calls[0] as unknown as Array<unknown>;
    expect(args.slice(2, 5)).toEqual([
      expect.stringMatching(/^platform:invite-discovery:\{v1:2\}:ip:[a-f0-9]{32}$/),
      expect.stringMatching(/^platform:invite-discovery:\{v1:2\}:user:[a-f0-9]{32}$/),
      'platform:invite-discovery:{v1:2}:global',
    ]);
    expect(args.join(' ')).not.toContain('platform:admission:');
    expect(args.slice(-4)).toEqual([120, 20_000, 600, 30]);
  });
});

describe('platform admission IP boundary', () => {
  it('ignores spoofed forwarding headers from untrusted peers', () => {
    expect(platformAdmissionClientIp('198.51.100.9', '203.0.113.1', '10.0.0.0/8')).toBe('198.51.100.9');
  });

  it('walks trusted IPv4 and IPv6 proxy chains from right to left', () => {
    expect(platformAdmissionClientIp('10.0.0.5', '203.0.113.7, 10.0.0.4', '10.0.0.0/8')).toBe('203.0.113.7');
    expect(platformAdmissionClientIp('2001:db8:1::5', '2001:db8:2::7, 2001:db8:1::4', '2001:db8:1::/48')).toBe(
      '2001:db8:2::7',
    );
  });
});

describe('platform admission middleware', () => {
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

  it('checks matchmake requests before Colyseus allocates a room', async () => {
    const limiter = { check: vi.fn(async () => true) };
    const middleware = createPlatformAdmissionMiddleware({ limiter });
    const req = {
      method: 'POST',
      path: '/matchmake/create/quick_match',
      socket: { remoteAddress: '203.0.113.9' },
      headers: {},
    };
    const res = response();
    const next = vi.fn();

    await middleware(req as never, res as never, next);

    expect(limiter.check).toHaveBeenCalledWith({ ip: '203.0.113.9' });
    expect(req.headers).toMatchObject({ 'x-forwarded-for': '203.0.113.9' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not consume room admission quota for pending invite discovery GETs', async () => {
    const limiter = { check: vi.fn(async () => true) };
    const middleware = createPlatformAdmissionMiddleware({ limiter });
    const next = vi.fn();

    await middleware(
      {
        method: 'GET',
        path: '/matchmake/invites/pending',
        socket: { remoteAddress: '203.0.113.9' },
        headers: { cookie: 'zutomayo_session=signed-token' },
      } as never,
      response() as never,
      next,
    );

    expect(limiter.check).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses only a durably verified cookie identity for the user quota', async () => {
    const limiter = { check: vi.fn(async () => true) };
    const verifyUserId = vi.fn(async () => 'u_verified');
    const middleware = createPlatformAdmissionMiddleware({ limiter, verifyUserId });
    const req = {
      method: 'POST',
      path: '/matchmake/joinById/custom_room',
      socket: { remoteAddress: '203.0.113.10' },
      headers: { cookie: 'zutomayo_session=signed-token' },
    };

    await middleware(req as never, response() as never, vi.fn());

    expect(verifyUserId).toHaveBeenCalledWith('signed-token');
    expect(limiter.check).toHaveBeenCalledWith({ ip: '203.0.113.10', userId: 'u_verified' });
  });

  it('rejects invalid authentication and exhausted admission without invoking Colyseus', async () => {
    const invalidLimiter = { check: vi.fn(async () => true) };
    const invalidMiddleware = createPlatformAdmissionMiddleware({
      limiter: invalidLimiter,
      verifyUserId: vi.fn(async () => ''),
    });
    const invalidResponse = response();
    const invalidNext = vi.fn();
    await invalidMiddleware(
      {
        method: 'POST',
        path: '/matchmake/join/lobby',
        socket: { remoteAddress: '203.0.113.11' },
        headers: { cookie: 'zutomayo_session=revoked-token' },
      } as never,
      invalidResponse as never,
      invalidNext,
    );
    expect(invalidResponse.status).toHaveBeenCalledWith(401);
    expect(invalidLimiter.check).not.toHaveBeenCalled();
    expect(invalidNext).not.toHaveBeenCalled();

    const exhaustedLimiter = { check: vi.fn(async () => false) };
    const exhaustedMiddleware = createPlatformAdmissionMiddleware({ limiter: exhaustedLimiter });
    const exhaustedResponse = response();
    const exhaustedNext = vi.fn();
    await exhaustedMiddleware(
      {
        method: 'POST',
        path: '/matchmake/join/lobby',
        socket: { remoteAddress: '203.0.113.12' },
        headers: {},
      } as never,
      exhaustedResponse as never,
      exhaustedNext,
    );
    expect(exhaustedResponse.status).toHaveBeenCalledWith(429);
    expect(exhaustedNext).not.toHaveBeenCalled();
  });
});
