/* global module, require */

const crypto = require('crypto');

const ROLE_PERMISSIONS = Object.freeze({
  viewer: ['users:read', 'matches:read', 'audit:read', 'seasons:read'],
  moderator: ['users:read', 'matches:read', 'audit:read', 'seasons:read', 'chat:moderate', 'feedback:moderate'],
  operator: [
    'users:read',
    'matches:read',
    'audit:read',
    'chat:moderate',
    'feedback:moderate',
    'elo:write',
    'cards:write',
    'config:write',
    'seasons:read',
    'seasons:write',
    'legal-holds:read',
  ],
  admin: ['*'],
});

function hasAdminPermission(role, permission) {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) return Buffer.alloc(0);
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpCode(secret, timestamp = Date.now(), stepSeconds = 30) {
  const key = decodeBase32(secret);
  if (!key.length) return '';
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function verifyTotp(secret, suppliedCode, timestamp = Date.now()) {
  if (!/^\d{6}$/.test(String(suppliedCode || ''))) return false;
  return [-1, 0, 1].some((window) => timingSafeTextEqual(totpCode(secret, timestamp + window * 30_000), suppliedCode));
}

async function authenticateAdmin({
  pool,
  body,
  hashPassword,
  decryptTotpSecret,
  createSessionToken,
  passwordIterations,
  sessionTtlSeconds = 60 * 60,
  generateJti = () => crypto.randomBytes(18).toString('hex'),
}) {
  const username = String(body.username || '')
    .trim()
    .toLowerCase()
    .slice(0, 80);
  const user = (
    await pool.query(
      `SELECT id, username, password_hash, salt, role, totp_secret_ciphertext
       FROM admin_users WHERE username = $1 AND disabled_at IS NULL`,
      [username],
    )
  ).rows[0];
  if (!user) return { ok: false, status: 401, error: 'Invalid admin credentials' };
  if (!user.password_hash || !user.salt) {
    return { ok: false, status: 401, error: 'Invalid admin credentials' };
  }

  const computedHash = await hashPassword(body.password, user.salt, passwordIterations);
  if (!timingSafeTextEqual(computedHash, user.password_hash)) {
    return { ok: false, status: 401, error: 'Invalid admin credentials' };
  }
  if (!user.totp_secret_ciphertext) return { ok: false, status: 403, error: 'Admin MFA is not configured' };
  const totpSecret = await decryptTotpSecret(user.totp_secret_ciphertext);
  if (!verifyTotp(totpSecret, body.totpCode)) return { ok: false, status: 401, error: 'Invalid admin MFA code' };

  return issueAdminSession({
    pool,
    adminUserId: user.id,
    role: user.role,
    createSessionToken,
    sessionTtlSeconds,
    generateJti,
  });
}

async function issueAdminSession({
  pool,
  adminUserId,
  role,
  createSessionToken,
  sessionTtlSeconds = 60 * 60,
  generateJti = () => crypto.randomBytes(18).toString('hex'),
}) {
  const jti = generateJti();
  const ttl = Math.max(300, Math.min(Number(sessionTtlSeconds) || 3600, 8 * 60 * 60));
  const token = createSessionToken({ adminUserId, role, jti, expiresIn: ttl });
  await pool.query(
    `INSERT INTO admin_sessions (jti, admin_user_id, role, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'))`,
    [jti, adminUserId, role, ttl],
  );
  await pool.query('UPDATE admin_users SET last_login_at = NOW() WHERE id = $1', [adminUserId]);
  return { ok: true, body: { token, role, expiresIn: ttl } };
}

async function createLinkedAdminSession({
  pool,
  userId,
  createSessionToken,
  sessionTtlSeconds = 60 * 60,
  generateJti = () => crypto.randomBytes(18).toString('hex'),
}) {
  const admin = (
    await pool.query(
      `SELECT a.id, a.role
       FROM admin_users a
       JOIN users u ON u.id = a.user_id
       WHERE a.user_id = $1
         AND a.disabled_at IS NULL
         AND u.deleted_at IS NULL`,
      [userId],
    )
  ).rows[0];
  if (!admin) return { ok: false, status: 403, error: 'Account does not have admin access' };
  return issueAdminSession({
    pool,
    adminUserId: admin.id,
    role: admin.role,
    createSessionToken,
    sessionTtlSeconds,
    generateJti,
  });
}

async function verifyAdminSession({ pool, payload, permission }) {
  if (!payload || !payload.adminUserId || !payload.jti || !payload.role) return null;
  if (!hasAdminPermission(payload.role, permission)) return null;
  const session = (
    await pool.query(
      `SELECT s.admin_user_id, s.role
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_user_id
       WHERE s.jti = $1
         AND s.admin_user_id = $2
         AND s.role = $3
         AND u.role = $3
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
         AND u.disabled_at IS NULL`,
      [payload.jti, payload.adminUserId, payload.role],
    )
  ).rows[0];
  if (!session) return null;
  await pool.query('UPDATE admin_sessions SET last_seen_at = NOW() WHERE jti = $1', [payload.jti]);
  return { adminUserId: session.admin_user_id, role: session.role };
}

async function revokeAdminSession({ pool, jti, adminUserId }) {
  await pool.query(
    `UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE jti = $1 AND admin_user_id = $2`,
    [jti, adminUserId],
  );
  return { ok: true, body: { revoked: true } };
}

module.exports = {
  ROLE_PERMISSIONS,
  authenticateAdmin,
  createLinkedAdminSession,
  decodeBase32,
  hasAdminPermission,
  revokeAdminSession,
  timingSafeTextEqual,
  totpCode,
  verifyAdminSession,
  verifyTotp,
};
