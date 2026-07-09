import { describe, expect, it, vi } from 'vitest';
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
