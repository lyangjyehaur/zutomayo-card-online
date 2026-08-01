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

  it('holds relationship writer locks through the final transition and commit', async () => {
    const events: string[] = [];
    const release = vi.fn();
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      events.push(sql);
      if (sql.includes('AS live_count')) return { rows: [{ live_count: 2 }] };
      if (sql.includes('AS blocked')) return { rows: [{ blocked: false }] };
      return { rows: [] };
    });
    const store = createPostgresPlatformBlockStore({
      query,
      connect: async () => ({ query, release }),
    });

    await expect(
      store.withPairTransitionFence('u_second', 'u_first', async () => {
        events.push('transition');
        return true;
      }),
    ).resolves.toBe(true);

    expect(events.indexOf('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY')).toBeLessThan(events.indexOf('transition'));
    expect(events.indexOf('transition')).toBeLessThan(events.indexOf('COMMIT'));
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['legal-hold:account:u_first']);
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['legal-hold:account:u_second']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not enter the final transition after the fenced DB read observes a committed block', async () => {
    const transition = vi.fn(async () => true);
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('AS live_count')) return { rows: [{ live_count: 2 }] };
      return { rows: sql.includes('AS blocked') ? [{ blocked: true }] : [] };
    });
    const store = createPostgresPlatformBlockStore({ query });

    await expect(store.withPairTransitionFence('u_first', 'u_second', transition)).resolves.toBe(false);

    expect(transition).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('does not enter the final transition after account deletion wins the fenced lock', async () => {
    const transition = vi.fn(async () => true);
    const query = vi.fn(async (sql: string, _params?: unknown[]) => ({
      rows: sql.includes('AS live_count') ? [{ live_count: 1 }] : [],
    }));
    const store = createPostgresPlatformBlockStore({ query });

    await expect(store.withPairTransitionFence('u_first', 'u_second', transition)).resolves.toBe(false);

    expect(transition).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('AS blocked'))).toBe(false);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back and fails closed when the fenced transition cannot complete', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('AS live_count')) return { rows: [{ live_count: 2 }] };
      return { rows: sql.includes('AS blocked') ? [{ blocked: false }] : [] };
    });
    const store = createPostgresPlatformBlockStore({ query });

    await expect(
      store.withPairTransitionFence('u_first', 'u_second', async () => {
        throw new Error('transition unavailable');
      }),
    ).rejects.toThrow('transition unavailable');

    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });

  it('excludes bidirectionally blocked friends from presence and invites', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ friend_user_id: 'u_friend' }] }));
    const store = createPostgresPlatformFriendStore({ query });

    await expect(store.listFriendUserIds('u_self')).resolves.toEqual(['u_friend']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM user_blocks b'), ['u_self', 100]);
    expect(query.mock.calls[0]?.[0]).toContain('b.blocker_user_id = user_friends.friend_user_id');
  });

  it('checks mutual friendship directly without the presence-list limit', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ friends: true }] }));
    const store = createPostgresPlatformFriendStore({ query });

    await expect(store.areUsersFriends?.('u_first', 'u_second')).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('AND EXISTS'), ['u_first', 'u_second']);
    expect(query.mock.calls[0]?.[0]).toContain('AND NOT EXISTS');
  });
});
