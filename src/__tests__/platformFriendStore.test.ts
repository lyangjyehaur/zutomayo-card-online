import { describe, expect, it, vi } from 'vitest';
import {
  isPlatformRedisMode,
  redisUrlWithDb,
  resolvePlatformCorsOrigin,
  resolvePlatformCorsOrigins,
  resolvePlatformRedisMode,
} from '../platform/config';
import {
  MAX_PLATFORM_FRIEND_PRESENCE_IDS,
  createEmptyPlatformFriendStore,
  createPostgresPlatformFriendStore,
  mapFriendUserIdRows,
  normalizePlatformUserId,
  resolvePlatformFriendStoreMode,
} from '../platform/friendStore';

describe('platform friend store', () => {
  it('normalizes platform user ids consistently with auth and API friend ids', () => {
    expect(normalizePlatformUserId(' user:abc_123-xyz ')).toBe('user:abc_123-xyz');
    expect(normalizePlatformUserId('ab')).toBe('');
    expect(normalizePlatformUserId('user@example.com')).toBe('');
    expect(normalizePlatformUserId(123)).toBe('');
  });

  it('maps friend rows defensively with de-duplication, self filtering, and cap', () => {
    const rows = [
      { friend_user_id: 'u_friend_1' },
      { friend_user_id: 'u_self' },
      { friend_user_id: 'bad user' },
      { friend_user_id: 'u_friend_1' },
      ...Array.from({ length: MAX_PLATFORM_FRIEND_PRESENCE_IDS + 5 }, (_, index) => ({
        friend_user_id: `u_friend_${index + 2}`,
      })),
    ];

    const friendUserIds = mapFriendUserIdRows(rows, 'u_self');

    expect(friendUserIds).toHaveLength(MAX_PLATFORM_FRIEND_PRESENCE_IDS);
    expect(friendUserIds[0]).toBe('u_friend_1');
    expect(friendUserIds).not.toContain('u_self');
    expect(friendUserIds).not.toContain('bad user');
  });

  it('queries user_friends for server-side lobby presence subscriptions', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ friend_user_id: 'u_friend' }],
      })),
      end: vi.fn(async () => undefined),
    };
    const store = createPostgresPlatformFriendStore(pool);

    await expect(store.listFriendUserIds('u_self')).resolves.toEqual(['u_friend']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM user_friends'), [
      'u_self',
      MAX_PLATFORM_FRIEND_PRESENCE_IDS,
    ]);
    await store.close?.();
    expect(pool.end).toHaveBeenCalled();
  });

  it('uses an empty store when Postgres friend presence is disabled', async () => {
    await expect(createEmptyPlatformFriendStore().listFriendUserIds('u_self')).resolves.toEqual([]);
    expect(resolvePlatformFriendStoreMode({ PLATFORM_FRIEND_STORE: 'none', NODE_ENV: 'production' })).toBe('none');
    expect(resolvePlatformFriendStoreMode({ PLATFORM_FRIEND_STORE: 'postgres' })).toBe('postgres');
    expect(resolvePlatformFriendStoreMode({ NODE_ENV: 'production' })).toBe('postgres');
    expect(resolvePlatformFriendStoreMode({})).toBe('none');
  });
});

describe('platform runtime config', () => {
  it('resolves documented Redis mode defaults by environment', () => {
    expect(resolvePlatformRedisMode(undefined, 'development')).toBe('memory');
    expect(resolvePlatformRedisMode('', 'test')).toBe('memory');
    expect(resolvePlatformRedisMode(undefined, 'production')).toBe('redis');
    expect(resolvePlatformRedisMode('unknown', 'production')).toBe('redis');
    expect(resolvePlatformRedisMode('unknown', 'development')).toBe('memory');
  });

  it('accepts explicit platform Redis modes case-insensitively', () => {
    expect(isPlatformRedisMode('memory')).toBe(true);
    expect(isPlatformRedisMode(' Redis ')).toBe(true);
    expect(isPlatformRedisMode('postgres')).toBe(false);
    expect(resolvePlatformRedisMode(' Memory ', 'production')).toBe('memory');
    expect(resolvePlatformRedisMode('REDIS', 'development')).toBe('redis');
  });

  it('adds the configured Redis DB only when the URL has no DB path', () => {
    expect(redisUrlWithDb('redis://localhost:6379', 3)).toBe('redis://localhost:6379/3');
    expect(redisUrlWithDb('redis://localhost:6379/', 4)).toBe('redis://localhost:6379/4');
    expect(redisUrlWithDb('redis://localhost:6379/2', 5)).toBe('redis://localhost:6379/2');
    expect(redisUrlWithDb('not a url', 6)).toBe('not a url');
  });

  it('allows documented local platform browser origins by default', () => {
    const origins = resolvePlatformCorsOrigins(undefined);

    expect(resolvePlatformCorsOrigin('http://localhost:5173', origins)).toBe('http://localhost:5173');
    expect(resolvePlatformCorsOrigin('http://localhost:3000', origins)).toBe('http://localhost:3000');
    expect(resolvePlatformCorsOrigin('http://evil.example.com', origins)).toBeNull();
  });

  it('uses explicit platform CORS origins when configured', () => {
    const origins = resolvePlatformCorsOrigins(' https://game.example.com, https://admin.example.com ');

    expect(resolvePlatformCorsOrigin('https://game.example.com', origins)).toBe('https://game.example.com');
    expect(resolvePlatformCorsOrigin('http://localhost:5173', origins)).toBeNull();
  });
});
