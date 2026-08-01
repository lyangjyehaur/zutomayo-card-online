import { describe, expect, it, vi } from 'vitest';
import {
  platformRedisHealthChecks,
  resolvePlatformColyseusRedisConnectionConfig,
  resolvePlatformRedisRoleConnections,
} from '../platform/config';

describe('platform Colyseus Redis isolation', () => {
  const productionSharedRedis = 'rediss://:shared-password@shared-redis.example.com:6379/1';

  it('falls back to REDIS_URL for production compatibility when no isolated URL is configured', () => {
    expect(
      resolvePlatformRedisRoleConnections({
        NODE_ENV: 'production',
        REDIS_URL: productionSharedRedis,
      }),
    ).toEqual({
      shared: { url: productionSharedRedis, tls: true, authenticated: true },
      colyseus: { url: productionSharedRedis, tls: true, authenticated: true },
    });
  });

  it('keeps shared application Redis separate from Colyseus discovery and presence', () => {
    expect(
      resolvePlatformRedisRoleConnections({
        NODE_ENV: 'production',
        REDIS_URL: productionSharedRedis,
        PLATFORM_REQUIRE_ISOLATED_REDIS: 'true',
        PLATFORM_COLYSEUS_REDIS_URL: 'redis://:colyseus-password@colyseus-redis:6379/2',
      }),
    ).toEqual({
      shared: { url: productionSharedRedis, tls: true, authenticated: true },
      colyseus: {
        url: 'redis://:colyseus-password@colyseus-redis:6379/2',
        tls: false,
        authenticated: true,
      },
    });
  });

  it('fails closed when a deployment contract requires an isolated Redis URL', () => {
    expect(() =>
      resolvePlatformRedisRoleConnections({
        NODE_ENV: 'production',
        REDIS_URL: productionSharedRedis,
        PLATFORM_REQUIRE_ISOLATED_REDIS: 'true',
      }),
    ).toThrow('PLATFORM_COLYSEUS_REDIS_URL is required');
    expect(() =>
      resolvePlatformRedisRoleConnections({
        NODE_ENV: 'production',
        REDIS_URL: productionSharedRedis,
        PLATFORM_REQUIRE_ISOLATED_REDIS: 'sometimes',
      }),
    ).toThrow('must be either true or false');
    expect(() =>
      resolvePlatformRedisRoleConnections({
        NODE_ENV: 'production',
        REDIS_URL: productionSharedRedis,
        PLATFORM_REQUIRE_ISOLATED_REDIS: 'true',
        PLATFORM_COLYSEUS_REDIS_URL: 'rediss://:different-password@shared-redis.example.com:6379/9',
      }),
    ).toThrow('must use a different Redis server');
  });

  it('treats an omitted rediss port as the ioredis default 6379 for isolation checks', () => {
    expect(() =>
      resolvePlatformRedisRoleConnections({
        NODE_ENV: 'production',
        REDIS_URL: 'rediss://:shared-password@shared-redis.example.com',
        PLATFORM_REQUIRE_ISOLATED_REDIS: 'true',
        PLATFORM_COLYSEUS_REDIS_URL: 'rediss://:colyseus-password@shared-redis.example.com:6379',
      }),
    ).toThrow('must use a different Redis server');
  });

  it('allows authenticated plaintext only for an explicitly allowed internal hostname', () => {
    expect(
      resolvePlatformColyseusRedisConnectionConfig({
        NODE_ENV: 'production',
        REDIS_URL: productionSharedRedis,
        PLATFORM_COLYSEUS_REDIS_URL: 'redis://:password@slot-green-redis:6379',
        PLATFORM_COLYSEUS_REDIS_INTERNAL_HOSTS: 'slot-blue-redis, slot-green-redis',
      }),
    ).toMatchObject({
      url: 'redis://:password@slot-green-redis:6379',
      tls: false,
      authenticated: true,
    });
    expect(() =>
      resolvePlatformColyseusRedisConnectionConfig({
        PLATFORM_COLYSEUS_REDIS_URL: 'redis://:password@redis.example.com:6379',
        PLATFORM_COLYSEUS_REDIS_INTERNAL_HOSTS: 'redis.example.com',
      }),
    ).toThrow('internal DNS hostnames');
  });

  it('accepts authenticated rediss URLs but rejects missing credentials and external plaintext', () => {
    expect(
      resolvePlatformColyseusRedisConnectionConfig({
        PLATFORM_COLYSEUS_REDIS_URL: 'rediss://:password@redis.example.com:6379?tls=true',
      }),
    ).toEqual({
      url: 'rediss://:password@redis.example.com:6379',
      tls: true,
      authenticated: true,
    });
    expect(() =>
      resolvePlatformColyseusRedisConnectionConfig({
        PLATFORM_COLYSEUS_REDIS_URL: 'rediss://redis.example.com:6379',
      }),
    ).toThrow('requires a password');
    expect(() =>
      resolvePlatformColyseusRedisConnectionConfig({
        PLATFORM_COLYSEUS_REDIS_URL: 'redis://:password@redis.example.com:6379',
      }),
    ).toThrow('explicitly allowed');
    expect(() =>
      resolvePlatformColyseusRedisConnectionConfig({
        PLATFORM_COLYSEUS_REDIS_URL: 'rediss://:password@redis.example.com:6379?family=6',
      }),
    ).toThrow('unsupported query option');
  });

  it('gives shared and Colyseus Redis distinct health/readiness check names', async () => {
    const shared = { ping: vi.fn(async () => 'PONG shared') };
    const colyseus = { ping: vi.fn(async () => 'PONG colyseus') };

    const checks = platformRedisHealthChecks(shared, colyseus);

    expect(checks.map(({ name }) => name)).toEqual(['redis-shared', 'redis-colyseus']);
    await expect(Promise.all(checks.map(({ promise }) => promise))).resolves.toEqual(['PONG shared', 'PONG colyseus']);
    expect(shared.ping).toHaveBeenCalledOnce();
    expect(colyseus.ping).toHaveBeenCalledOnce();
  });
});
