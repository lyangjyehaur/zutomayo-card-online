/* global module */

const { AccountMutationError, acquireAccountMutationLocks } = require('./accountMutationLock.cjs');
const { enqueueRelationshipChange } = require('./relationshipOutbox.cjs');

function normalizeUserId(value) {
  if (typeof value !== 'string') return '';
  const userId = value.trim().slice(0, 128);
  return /^[a-zA-Z0-9:_-]{3,128}$/.test(userId) ? userId : '';
}

async function withRelationshipTransaction(pool, userIds, operation) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  try {
    await client.query('BEGIN');
    await acquireAccountMutationLocks(client, userIds);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof AccountMutationError) return { ok: false, status: 404, error: 'User not found' };
    throw error;
  } finally {
    release();
  }
}

function mapFriend(row) {
  return {
    userId: row.friend_user_id,
    nickname: row.nickname || '',
    elo: Number(row.elo) || 0,
    matchCount: Number(row.match_count) || 0,
    wins: Number(row.wins) || 0,
    createdAt: row.created_at,
  };
}

async function listFriends({ pool, userId }) {
  const cleanUserId = normalizeUserId(userId);
  if (!cleanUserId) return { ok: false, status: 401, error: 'Unauthorized' };
  const { rows } = await pool.query(
    `SELECT f.friend_user_id, f.created_at, u.nickname, u.elo, u.match_count, u.wins
     FROM user_friends f
     JOIN users u ON u.id = f.friend_user_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC`,
    [cleanUserId],
  );
  return { ok: true, body: { friends: rows.map(mapFriend) } };
}

async function addFriend({ pool, userId, body }) {
  const cleanUserId = normalizeUserId(userId);
  const friendUserId = normalizeUserId(body.friendUserId);
  if (!cleanUserId) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!friendUserId || friendUserId === cleanUserId) {
    return { ok: false, status: 400, error: 'Invalid friend user' };
  }

  return withRelationshipTransaction(pool, [cleanUserId, friendUserId], async (client) => {
    const inserted = await client.query(
      `INSERT INTO user_friends (user_id, friend_user_id)
       VALUES ($1, $2), ($2, $1)
       ON CONFLICT (user_id, friend_user_id) DO NOTHING
       RETURNING created_at`,
      [cleanUserId, friendUserId],
    );
    if (inserted.rows[0]) {
      await enqueueRelationshipChange(client, 'friendship_added', [cleanUserId, friendUserId], {
        idempotencyKey: `friendship_added:${cleanUserId}:${friendUserId}:${new Date(
          inserted.rows[0].created_at,
        ).toISOString()}`,
      });
    }
    return { ok: true, body: { ok: true, friendUserId } };
  });
}

async function removeFriend({ pool, userId, friendUserId }) {
  const cleanUserId = normalizeUserId(userId);
  const cleanFriendUserId = normalizeUserId(friendUserId);
  if (!cleanUserId) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!cleanFriendUserId || cleanFriendUserId === cleanUserId) {
    return { ok: false, status: 400, error: 'Invalid friend user' };
  }
  return withRelationshipTransaction(pool, [cleanUserId, cleanFriendUserId], async (client) => {
    const removed = await client.query(
      `DELETE FROM user_friends
       WHERE (user_id = $1 AND friend_user_id = $2)
          OR (user_id = $2 AND friend_user_id = $1)
       RETURNING created_at`,
      [cleanUserId, cleanFriendUserId],
    );
    if (removed.rows[0]) {
      await enqueueRelationshipChange(client, 'friendship_removed', [cleanUserId, cleanFriendUserId], {
        idempotencyKey: `friendship_removed:${cleanUserId}:${cleanFriendUserId}:${new Date(
          removed.rows[0].created_at,
        ).toISOString()}`,
      });
    }
    return { ok: true, body: { ok: true } };
  });
}

module.exports = {
  addFriend,
  listFriends,
  normalizeUserId,
  removeFriend,
};
