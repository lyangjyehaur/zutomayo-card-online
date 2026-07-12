/* global module, require */

const crypto = require('crypto');

const ACCOUNT_ACTIONS = new Set(['verify_email', 'reset_password']);
const DEFAULT_TOKEN_TTL_SECONDS = 30 * 60;
const MIN_PASSWORD_LENGTH = 12;

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

function hashAccountToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function withTransaction(pool, operation) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = typeof client.release === 'function' ? () => client.release() : () => undefined;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    release();
  }
}

async function issueAccountToken({
  pool,
  userId,
  actionType,
  ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS,
  generateToken = () => crypto.randomBytes(32).toString('base64url'),
}) {
  if (!ACCOUNT_ACTIONS.has(actionType)) throw new Error('Unsupported account action');
  const token = generateToken();
  const tokenHash = hashAccountToken(token);
  const lifetime = Math.max(60, Math.min(Number(ttlSeconds) || DEFAULT_TOKEN_TTL_SECONDS, 24 * 60 * 60));

  await withTransaction(pool, async (client) => {
    // Serialize issuance per account so concurrent requests cannot leave two
    // valid reset/verification tokens after each has deleted the old row.
    const user = (await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!user) throw new Error('User not found');
    await client.query(
      `DELETE FROM account_action_tokens
       WHERE user_id = $1 AND action_type = $2 AND consumed_at IS NULL`,
      [userId, actionType],
    );
    await client.query(
      `INSERT INTO account_action_tokens
         (user_id, action_type, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'))`,
      [userId, actionType, tokenHash, lifetime],
    );
  });

  return { token, expiresIn: lifetime };
}

async function requestEmailVerification({ pool, userId, generateToken, ttlSeconds }) {
  const user = (
    await pool.query('SELECT id, email, email_verified, deleted_at FROM users WHERE id = $1', [userId])
  ).rows[0];
  if (!user || user.deleted_at) return { ok: false, status: 404, error: 'User not found' };
  if (user.email_verified) return { ok: true, body: { alreadyVerified: true } };

  const issued = await issueAccountToken({
    pool,
    userId,
    actionType: 'verify_email',
    generateToken,
    ttlSeconds,
  });
  return { ok: true, body: { email: user.email, ...issued } };
}

async function verifyEmailToken({ pool, token }) {
  const tokenHash = hashAccountToken(token);
  if (!tokenHash || !token) return { ok: false, status: 400, error: 'Invalid verification token' };

  return withTransaction(pool, async (client) => {
    const consumed = (
      await client.query(
        `UPDATE account_action_tokens
         SET consumed_at = NOW()
         WHERE token_hash = $1
           AND action_type = 'verify_email'
           AND consumed_at IS NULL
           AND expires_at > NOW()
         RETURNING user_id`,
        [tokenHash],
      )
    ).rows[0];
    if (!consumed) return { ok: false, status: 400, error: 'Invalid or expired verification token' };
    await client.query('UPDATE users SET email_verified = TRUE WHERE id = $1 AND deleted_at IS NULL', [
      consumed.user_id,
    ]);
    return { ok: true, body: { verified: true } };
  });
}

async function requestPasswordReset({ pool, email, generateToken, ttlSeconds }) {
  const cleanEmail = normalizeEmail(email);
  const user = (
    await pool.query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [cleanEmail])
  ).rows[0];
  if (!user) return { ok: true, body: { accepted: true } };

  const issued = await issueAccountToken({
    pool,
    userId: user.id,
    actionType: 'reset_password',
    generateToken,
    ttlSeconds,
  });
  return { ok: true, body: { accepted: true, ...issued } };
}

async function resetPassword({ pool, token, newPassword, hashPassword, generateSalt }) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  const tokenHash = hashAccountToken(token);
  if (!tokenHash || !token) return { ok: false, status: 400, error: 'Invalid reset token' };

  return withTransaction(pool, async (client) => {
    const consumed = (
      await client.query(
        `UPDATE account_action_tokens
         SET consumed_at = NOW()
         WHERE token_hash = $1
           AND action_type = 'reset_password'
           AND consumed_at IS NULL
           AND expires_at > NOW()
         RETURNING user_id`,
        [tokenHash],
      )
    ).rows[0];
    if (!consumed) return { ok: false, status: 400, error: 'Invalid or expired reset token' };

    const salt = generateSalt();
    const passwordHash = await hashPassword(newPassword, salt);
    await client.query(
      `UPDATE users
       SET password_hash = $1, salt = $2, auth_version = auth_version + 1
       WHERE id = $3 AND deleted_at IS NULL`,
      [passwordHash, salt, consumed.user_id],
    );
    return { ok: true, body: { reset: true, revokeSessions: true, userId: consumed.user_id } };
  });
}

async function exportAccountData({ pool, userId }) {
  const user = (
    await pool.query(
      `SELECT id, email, email_verified, nickname, elo, match_count, wins, created_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    )
  ).rows[0];
  if (!user) return { ok: false, status: 404, error: 'User not found' };

  const [identities, decks, matches, friends, blocks] = await Promise.all([
    pool.query(
      `SELECT provider, email, email_verified, display_name, created_at, updated_at
       FROM user_identities WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    ),
    pool.query('SELECT id, name, card_ids, created_at, updated_at FROM decks WHERE user_id = $1 ORDER BY created_at', [
      userId,
    ]),
    pool.query(
      `SELECT id, source_match_id, player0_id, player1_id, winner_id, loser_id,
              winner_elo_change, loser_elo_change, turns, duration_seconds, created_at
       FROM matches WHERE player0_id = $1 OR player1_id = $1 ORDER BY created_at DESC`,
      [userId],
    ),
    pool.query('SELECT friend_user_id, created_at FROM user_friends WHERE user_id = $1 ORDER BY created_at', [userId]),
    pool.query('SELECT blocked_user_id, created_at FROM user_blocks WHERE blocker_user_id = $1 ORDER BY created_at', [
      userId,
    ]),
  ]);

  return {
    ok: true,
    body: {
      exportedAt: new Date().toISOString(),
      account: user,
      identities: identities.rows,
      decks: decks.rows,
      matches: matches.rows,
      friends: friends.rows,
      blocks: blocks.rows,
    },
  };
}

async function deleteAccount({ pool, userId }) {
  return withTransaction(pool, async (client) => {
    const user = (
      await client.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [userId])
    ).rows[0];
    if (!user) return { ok: false, status: 404, error: 'User not found' };

    await client.query('DELETE FROM user_identities WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM decks WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_friends WHERE user_id = $1 OR friend_user_id = $1', [userId]);
    await client.query('DELETE FROM friend_requests WHERE requester_user_id = $1 OR recipient_user_id = $1', [userId]);
    await client.query('DELETE FROM user_blocks WHERE blocker_user_id = $1 OR blocked_user_id = $1', [userId]);
    await client.query('DELETE FROM account_action_tokens WHERE user_id = $1', [userId]);
    await client.query(
      `UPDATE users
       SET email = $2,
           nickname = 'Deleted Player',
           password_hash = $3,
           salt = '',
           email_verified = FALSE,
           auth_version = auth_version + 1,
           deleted_at = NOW()
       WHERE id = $1`,
      [userId, `deleted+${userId}@invalid.local`, `deleted:${crypto.randomBytes(24).toString('hex')}`],
    );
    return { ok: true, body: { deleted: true } };
  });
}

module.exports = {
  DEFAULT_TOKEN_TTL_SECONDS,
  MIN_PASSWORD_LENGTH,
  deleteAccount,
  exportAccountData,
  hashAccountToken,
  issueAccountToken,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  verifyEmailToken,
};
