/* global module */

const crypto = require('crypto');

const ADMIN_CREDENTIAL_MODES = Object.freeze(['create', 'rotate', 'recover']);
const ADMIN_ROLES = Object.freeze(['viewer', 'moderator', 'operator', 'admin']);

function assertCredentialInput({ mode, username, role, passwordHash, salt, totpSecretCiphertext, adminUserId }) {
  if (!ADMIN_CREDENTIAL_MODES.includes(mode)) throw new Error('admin credential mode is invalid');
  if (!/^[a-z0-9._-]{3,80}$/.test(username)) throw new Error('admin username is invalid');
  if (role && !ADMIN_ROLES.includes(role)) throw new Error('admin role is invalid');
  if (!passwordHash || !salt || !totpSecretCiphertext) throw new Error('admin credential material is incomplete');
  if (mode === 'create' && !/^admin_[a-f0-9]{16}$/.test(adminUserId)) throw new Error('admin user id is invalid');
}

function auditAction(mode) {
  if (mode === 'create') return 'admin_account_created';
  if (mode === 'rotate') return 'admin_credentials_rotated';
  return 'admin_account_recovered';
}

async function mutateAdminCredentials({
  pool,
  mode,
  username,
  role,
  passwordHash,
  salt,
  totpSecretCiphertext,
  adminUserId = `admin_${crypto.randomBytes(8).toString('hex')}`,
}) {
  assertCredentialInput({ mode, username, role, passwordHash, salt, totpSecretCiphertext, adminUserId });
  if (!pool || typeof pool.connect !== 'function')
    throw new Error('admin credential mutation requires a PostgreSQL pool');

  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;

    // The advisory lock also serializes concurrent creates, for which no row exists yet.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('admin-credentials:' || $1, 0))", [username]);
    let current = (
      await client.query(
        `SELECT id, username, role, disabled_at
         FROM admin_users
         WHERE username = $1
         FOR UPDATE`,
        [username],
      )
    ).rows[0];
    let previousRole = null;
    let wasDisabled = false;

    if (mode === 'create') {
      if (current) throw new Error(`admin ${username} already exists; use admin:rotate or admin:recover`);
      const nextRole = role || 'admin';
      current = (
        await client.query(
          `INSERT INTO admin_users
             (id, username, password_hash, salt, role, totp_secret_ciphertext, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           RETURNING id, username, role, disabled_at`,
          [adminUserId, username, passwordHash, salt, nextRole, totpSecretCiphertext],
        )
      ).rows[0];
      // Make the row-locking contract explicit for every operation, including create.
      await client.query('SELECT id FROM admin_users WHERE id = $1 FOR UPDATE', [current.id]);
    } else {
      if (!current) throw new Error(`admin ${username} does not exist; use admin:create`);
      if (mode === 'rotate' && current.disabled_at) {
        throw new Error(`admin ${username} is disabled; use admin:recover`);
      }
      if (mode === 'recover' && !current.disabled_at) {
        throw new Error(`admin ${username} is active; use admin:rotate`);
      }

      previousRole = current.role;
      wasDisabled = Boolean(current.disabled_at);
      const nextRole = role || current.role;
      current = (
        await client.query(
          `UPDATE admin_users
           SET password_hash = $1,
               salt = $2,
               role = $3,
               totp_secret_ciphertext = $4,
               disabled_at = CASE WHEN $5 = 'recover' THEN NULL ELSE disabled_at END,
               updated_at = NOW()
           WHERE id = $6
           RETURNING id, username, role, disabled_at`,
          [passwordHash, salt, nextRole, totpSecretCiphertext, mode, current.id],
        )
      ).rows[0];
    }

    let sessionsRevoked = 0;
    if (mode !== 'create') {
      const revoked = await client.query(
        `UPDATE admin_sessions
         SET revoked_at = NOW()
         WHERE admin_user_id = $1
           AND revoked_at IS NULL
           AND expires_at > NOW()`,
        [current.id],
      );
      sessionsRevoked = revoked.rowCount || 0;
    }

    const details = {
      source: 'admin_credential_cli',
      operation: mode,
      username,
      role: current.role,
      sessionsRevoked,
      ...(mode === 'create' ? {} : { previousRole, wasDisabled }),
    };
    await client.query(
      `INSERT INTO admin_audit_log
         (admin_user_id, action, target_type, target_id, details)
       VALUES (NULL, $1, 'admin_user', $2, $3::jsonb)`,
      [auditAction(mode), current.id, JSON.stringify(details)],
    );

    await client.query('COMMIT');
    transactionOpen = false;
    return {
      id: current.id,
      username: current.username,
      role: current.role,
      mode,
      sessionsRevoked,
    };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ADMIN_CREDENTIAL_MODES,
  ADMIN_ROLES,
  mutateAdminCredentials,
};
