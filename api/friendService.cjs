/* global module */

function normalizeUserId(value) {
  if (typeof value !== 'string') return '';
  const userId = value.trim().slice(0, 128);
  return /^[a-zA-Z0-9:_-]{3,128}$/.test(userId) ? userId : '';
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

  const friend = (await pool.query('SELECT id FROM users WHERE id = $1', [friendUserId])).rows[0];
  if (!friend) return { ok: false, status: 404, error: 'User not found' };

  await pool.query(
    `INSERT INTO user_friends (user_id, friend_user_id)
     VALUES ($1, $2), ($2, $1)
     ON CONFLICT (user_id, friend_user_id) DO NOTHING`,
    [cleanUserId, friendUserId],
  );
  return { ok: true, body: { ok: true, friendUserId } };
}

async function removeFriend({ pool, userId, friendUserId }) {
  const cleanUserId = normalizeUserId(userId);
  const cleanFriendUserId = normalizeUserId(friendUserId);
  if (!cleanUserId) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!cleanFriendUserId || cleanFriendUserId === cleanUserId) {
    return { ok: false, status: 400, error: 'Invalid friend user' };
  }
  await pool.query(
    `DELETE FROM user_friends
     WHERE (user_id = $1 AND friend_user_id = $2)
        OR (user_id = $2 AND friend_user_id = $1)`,
    [cleanUserId, cleanFriendUserId],
  );
  return { ok: true, body: { ok: true } };
}

module.exports = {
  addFriend,
  listFriends,
  normalizeUserId,
  removeFriend,
};
