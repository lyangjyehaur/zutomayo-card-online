/* global module, require, Buffer */

const crypto = require('crypto');

const VALID_ADMIN_ROLES = new Set(['viewer', 'moderator', 'operator', 'admin']);

function clampLimit(value, fallback, max) {
  return Math.min(Number(value) || fallback, max);
}

function mapAdminUser(user, currentAdminUserId = '') {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    elo: user.elo,
    matchCount: user.match_count,
    wins: user.wins,
    createdAt: user.created_at,
    winRate: user.match_count > 0 ? Math.round((user.wins / user.match_count) * 100) : 0,
    adminRole: user.admin_disabled_at ? null : user.admin_role || null,
    isCurrentAdmin: Boolean(currentAdminUserId && user.admin_user_id === currentAdminUserId),
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

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

async function listAdminUsers(
  pool,
  limitParam,
  { query = '', includeAdminRoles = false, currentAdminUserId = '' } = {},
) {
  const limit = clampLimit(limitParam, 100, 500);
  const normalizedQuery = String(query || '')
    .trim()
    .toLowerCase()
    .slice(0, 200);
  const pattern = `%${escapeLike(normalizedQuery)}%`;
  const adminColumns = includeAdminRoles
    ? 'a.id AS admin_user_id, a.role AS admin_role, a.disabled_at AS admin_disabled_at'
    : 'NULL::text AS admin_user_id, NULL::text AS admin_role, NULL::timestamptz AS admin_disabled_at';
  const adminJoin = includeAdminRoles ? 'LEFT JOIN admin_users a ON a.user_id = u.id' : '';
  const users = (
    await pool.query(
      `SELECT u.id, u.email, u.nickname, u.elo, u.match_count, u.wins, u.created_at, ${adminColumns}
       FROM users u
       ${adminJoin}
       WHERE u.deleted_at IS NULL
         AND ($2 = '' OR LOWER(u.id) LIKE $3 ESCAPE '\\' OR LOWER(u.email) LIKE $3 ESCAPE '\\' OR LOWER(u.nickname) LIKE $3 ESCAPE '\\')
       ORDER BY u.created_at DESC
       LIMIT $1`,
      [limit, normalizedQuery, pattern],
    )
  ).rows;
  return { users: users.map((user) => mapAdminUser(user, currentAdminUserId)) };
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

function linkedAdminId(userId) {
  return `admin_user_${crypto.createHash('sha256').update(userId).digest('hex').slice(0, 16)}`;
}

async function updateLinkedAdminRole(pool, { targetUserId, role, actorAdminUserId }) {
  if (role !== null && !VALID_ADMIN_ROLES.has(role)) {
    return { ok: false, status: 400, error: 'Invalid admin role' };
  }

  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('linked-admin-role-management'))");
    const target = (
      await client.query(
        `SELECT u.id, u.email, a.id AS admin_user_id, a.role AS admin_role
         FROM users u
         LEFT JOIN admin_users a ON a.user_id = u.id
         WHERE u.id = $1 AND u.deleted_at IS NULL
         FOR UPDATE OF u`,
        [targetUserId],
      )
    ).rows[0];

    if (!target) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: 'Active user not found' };
    }
    if (target.admin_user_id && target.admin_user_id === actorAdminUserId) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: 'You cannot change your own admin role' };
    }

    if (role === null) {
      if (target.admin_user_id) {
        await client.query('DELETE FROM admin_users WHERE id = $1', [target.admin_user_id]);
        await writeAuditLog(client, {
          adminUserId: actorAdminUserId,
          action: 'revoke_admin_role',
          targetType: 'user',
          targetId: target.id,
          details: { email: target.email, previousRole: target.admin_role, newRole: null },
        });
      }
      await client.query('COMMIT');
      return { ok: true, body: { id: target.id, adminRole: null } };
    }

    const adminId = linkedAdminId(target.id);
    const assigned = (
      await client.query(
        `INSERT INTO admin_users (id, user_id, username, password_hash, salt, role, updated_at)
         VALUES ($1, $2, $3, NULL, NULL, $4, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET role = EXCLUDED.role,
                       disabled_at = NULL,
                       updated_at = NOW()
         RETURNING id, role`,
        [adminId, target.id, `user:${target.id}`, role],
      )
    ).rows[0];
    await client.query('DELETE FROM admin_sessions WHERE admin_user_id = $1', [assigned.id]);
    await writeAuditLog(client, {
      adminUserId: actorAdminUserId,
      action: target.admin_user_id ? 'update_admin_role' : 'grant_admin_role',
      targetType: 'user',
      targetId: target.id,
      details: { email: target.email, previousRole: target.admin_role || null, newRole: assigned.role },
    });
    await client.query('COMMIT');
    return { ok: true, body: { id: target.id, adminRole: assigned.role } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

module.exports = {
  adminLogin,
  linkedAdminId,
  listAdminUsers,
  mapAdminUser,
  resetUserElo,
  updateLinkedAdminRole,
  writeAuditLog,
};
