/* global module, require, Buffer */
/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto');

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
  // constant-time comparison to prevent timing attacks
  const received = Buffer.from(String(body.password ?? ''));
  const expected = Buffer.from(String(adminPassword));
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return { ok: false, status: 401, error: 'Invalid password' };
  }
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

// 寫入 admin 稽核日誌。adminUserId 為執行操作的 admin 識別（目前為共享密碼 'admin'）。
async function writeAuditLog(pool, { adminUserId, action, targetType, targetId, details }) {
  await pool.query(
    'INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [adminUserId ?? null, action, targetType, targetId ?? null, JSON.stringify(details ?? {})],
  );
}

async function resetUserElo(pool, targetUserId, elo, adminUserId) {
  const newElo = Math.max(0, Math.min(9999, Math.trunc(Number(elo) || 1000)));
  const prev = await pool.query('SELECT elo FROM users WHERE id = $1', [targetUserId]);
  const oldElo = prev.rows[0] ? Number(prev.rows[0].elo) : null;
  await pool.query('UPDATE users SET elo = $1 WHERE id = $2', [newElo, targetUserId]);
  await writeAuditLog(pool, {
    adminUserId: adminUserId ?? null,
    action: 'reset_elo',
    targetType: 'user',
    targetId: targetUserId,
    details: { oldElo, newElo },
  });
  return { id: targetUserId, elo: newElo };
}

module.exports = {
  adminLogin,
  listAdminUsers,
  mapAdminUser,
  resetUserElo,
  writeAuditLog,
};
