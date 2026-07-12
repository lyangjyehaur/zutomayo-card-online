import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { blockUser, createFriendRequest, listBlocks, listFriendRequests, respondToFriendRequest, unblockUser } =
  require('../socialSafetyService.cjs') as Record<
    string,
    (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  >;

function createPool(handler: (sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] }) {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params)),
  };
}

describe('social safety service', () => {
  it('creates a pending friend request without granting friendship', async () => {
    const pool = createPool((sql) => {
      if (sql.startsWith('SELECT id FROM users')) return { rows: [{ id: 'u_friend' }] };
      if (sql.startsWith('INSERT INTO friend_requests')) {
        return { rows: [{ id: 7, status: 'pending', created_at: 'now', updated_at: 'now' }] };
      }
      return { rows: [] };
    });

    await expect(createFriendRequest({ pool, userId: 'u_me', targetUserId: 'u_friend' })).resolves.toMatchObject({
      ok: true,
      body: { friendUserId: 'u_friend', request: { status: 'pending' } },
    });
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO user_friends'), expect.anything());
  });

  it('rejects requests when either user has blocked the other', async () => {
    const pool = createPool((sql) => {
      if (sql.startsWith('SELECT id FROM users')) return { rows: [{ id: 'u_friend' }] };
      if (sql.includes('FROM user_blocks')) return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    });

    await expect(createFriendRequest({ pool, userId: 'u_me', targetUserId: 'u_friend' })).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Friend request is not allowed',
    });
  });

  it('only lets the recipient accept and creates friendship in both directions', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM friend_requests') && sql.includes('FOR UPDATE')) {
        return { rows: [{ requester_user_id: 'u_sender', recipient_user_id: 'u_me' }] };
      }
      return { rows: [] };
    });

    await expect(respondToFriendRequest({ pool, userId: 'u_me', requestId: 9, accept: true })).resolves.toEqual({
      ok: true,
      body: { accepted: true, friendUserId: 'u_sender' },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('VALUES ($1, $2), ($2, $1)'), ['u_sender', 'u_me']);
  });

  it('rechecks bidirectional blocks after locking a pending friend request', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('FROM friend_requests') && sql.includes('FOR UPDATE')) {
        return { rows: [{ requester_user_id: 'u_sender', recipient_user_id: 'u_me' }] };
      }
      if (sql.includes('FROM user_blocks')) return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    });

    await expect(respondToFriendRequest({ pool, userId: 'u_me', requestId: 9, accept: true })).resolves.toEqual({
      ok: false,
      status: 403,
      error: 'Friend request is not allowed',
    });
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO user_friends'), expect.anything());
    expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('SET status = $1'), expect.anything());
  });

  it('blocking removes friendships and pending requests transactionally', async () => {
    const pool = createPool((sql) => {
      if (sql.startsWith('SELECT id FROM users')) return { rows: [{ id: 'u_target' }] };
      return { rows: [] };
    });

    await expect(blockUser({ pool, userId: 'u_me', targetUserId: 'u_target' })).resolves.toEqual({
      ok: true,
      body: { blocked: true, userId: 'u_target' },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM user_friends'), ['u_me', 'u_target']);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM friend_requests'), [
      'u_me',
      'u_target',
    ]);
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
  });

  it('lists and removes blocks for the authenticated user', async () => {
    const pool = createPool((sql) =>
      sql.includes('FROM user_blocks b')
        ? { rows: [{ blocked_user_id: 'u_target', nickname: 'Target', created_at: 'now' }] }
        : { rows: [] },
    );

    await expect(listBlocks({ pool, userId: 'u_me' })).resolves.toMatchObject({
      ok: true,
      body: { blocks: [{ blocked_user_id: 'u_target' }] },
    });
    await expect(unblockUser({ pool, userId: 'u_me', targetUserId: 'u_target' })).resolves.toEqual({
      ok: true,
      body: { blocked: false, userId: 'u_target' },
    });
  });

  it('lists pending incoming and outgoing requests', async () => {
    const pool = createPool(() => ({ rows: [{ id: 1, status: 'pending' }] }));
    await expect(listFriendRequests({ pool, userId: 'u_me' })).resolves.toEqual({
      ok: true,
      body: { requests: [{ id: 1, status: 'pending' }] },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM user_blocks b'), ['u_me']);
  });
});
