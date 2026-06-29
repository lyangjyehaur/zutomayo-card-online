/* global module */

function clampLimit(value, fallback, max) {
  return Math.min(Number(value) || fallback, max);
}

function mapAdminUser(user) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    elo: user.elo,
    matchCount: user.match_count,
    wins: user.wins,
    createdAt: user.created_at,
    winRate: user.match_count > 0 ? Math.round((user.wins / user.match_count) * 100) : 0,
  };
}

async function adminLogin(body, adminPassword, createAdminToken) {
  if (!adminPassword) return { ok: false, status: 503, error: 'Admin not configured' };
  if (body.password !== adminPassword) return { ok: false, status: 401, error: 'Invalid password' };
  return { ok: true, body: { token: createAdminToken() } };
}

async function listAdminUsers(pool, limitParam) {
  const limit = clampLimit(limitParam, 100, 500);
  const users = (
    await pool.query(
      'SELECT id, email, nickname, elo, match_count, wins, created_at FROM users ORDER BY created_at DESC LIMIT $1',
      [limit],
    )
  ).rows;
  return { users: users.map(mapAdminUser) };
}

async function resetUserElo(pool, targetUserId, elo) {
  const newElo = Math.max(0, Math.min(9999, Math.trunc(Number(elo) || 1000)));
  await pool.query('UPDATE users SET elo = $1 WHERE id = $2', [newElo, targetUserId]);
  return { id: targetUserId, elo: newElo };
}

module.exports = {
  adminLogin,
  listAdminUsers,
  mapAdminUser,
  resetUserElo,
};
