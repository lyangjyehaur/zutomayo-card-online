import { describe, expect, it, vi } from 'vitest';
import { createPostgresPlatformBlockStore } from '../blockStore';
import { createPostgresPlatformFriendStore } from '../friendStore';

describe('platform social block stores', () => {
  it('checks blocks in both directions for quick-match admission', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ blocked: true }] }));
    const store = createPostgresPlatformBlockStore({ query });

    await expect(store.areUsersBlocked('u_first', 'u_second')).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('OR (blocker_user_id = $2'), ['u_first', 'u_second']);
  });

  it('excludes bidirectionally blocked friends from presence and invites', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ friend_user_id: 'u_friend' }] }));
    const store = createPostgresPlatformFriendStore({ query });

    await expect(store.listFriendUserIds('u_self')).resolves.toEqual(['u_friend']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM user_blocks b'), ['u_self', 100]);
    expect(query.mock.calls[0]?.[0]).toContain('b.blocker_user_id = user_friends.friend_user_id');
  });
});
