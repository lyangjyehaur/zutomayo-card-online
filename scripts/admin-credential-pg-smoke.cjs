#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const util = require('util');
const { Pool } = require('pg');
const { authenticateAdmin, totpCode, verifyAdminSession } = require('../api/adminAuthService.cjs');
const { mutateAdminCredentials } = require('../api/adminCredentialService.cjs');
const { decryptAdminTotpSecret, encryptAdminTotpSecret, randomBase32 } = require('../api/adminSecretCrypto.cjs');

const pbkdf2 = util.promisify(crypto.pbkdf2);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function hashPassword(password, salt, iterations = 100_000) {
  return (await pbkdf2(password, salt, iterations, 64, 'sha512')).toString('hex');
}

async function login({ pool, username, password, totpSecret, encryptionKey, jti }) {
  return authenticateAdmin({
    pool,
    body: { username, password, totpCode: totpCode(totpSecret) },
    hashPassword,
    decryptTotpSecret: (ciphertext) => decryptAdminTotpSecret(ciphertext, encryptionKey),
    createSessionToken: ({ jti: sessionJti }) => `smoke-token:${sessionJti}`,
    passwordIterations: 100_000,
    generateJti: () => jti,
  });
}

async function main() {
  const connectionString = String(process.env.ADMIN_CREDENTIAL_PG_SMOKE_URL || '').trim();
  if (!/^postgres(?:ql)?:\/\//.test(connectionString)) {
    throw new Error('ADMIN_CREDENTIAL_PG_SMOKE_URL must identify an isolated PostgreSQL test database');
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('admin credential PostgreSQL smoke cannot run in production');
  const databaseHost = new URL(connectionString).hostname;
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (!localHosts.has(databaseHost) && process.env.ADMIN_CREDENTIAL_PG_SMOKE_ALLOW_REMOTE !== 'true') {
    throw new Error('remote admin credential smoke requires ADMIN_CREDENTIAL_PG_SMOKE_ALLOW_REMOTE=true');
  }

  const schema = `admin_credential_smoke_${crypto.randomBytes(8).toString('hex')}`;
  const controlPool = new Pool({ connectionString, max: 1 });
  let smokePool;
  try {
    await controlPool.query(`CREATE SCHEMA ${schema}`);
    await controlPool.query(
      `CREATE TABLE ${schema}.admin_users (
         id TEXT PRIMARY KEY,
         username TEXT UNIQUE NOT NULL,
         password_hash TEXT NOT NULL,
         salt TEXT NOT NULL,
         role TEXT NOT NULL,
         totp_secret_ciphertext TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         last_login_at TIMESTAMPTZ,
         disabled_at TIMESTAMPTZ
       )`,
    );
    await controlPool.query(
      `CREATE TABLE ${schema}.admin_sessions (
         jti TEXT PRIMARY KEY,
         admin_user_id TEXT NOT NULL REFERENCES ${schema}.admin_users(id) ON DELETE CASCADE,
         role TEXT NOT NULL,
         expires_at TIMESTAMPTZ NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         revoked_at TIMESTAMPTZ,
         last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    await controlPool.query(
      `CREATE TABLE ${schema}.admin_audit_log (
         id BIGSERIAL PRIMARY KEY,
         admin_user_id TEXT,
         action TEXT NOT NULL,
         target_type TEXT NOT NULL,
         target_id TEXT,
         details JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );

    smokePool = new Pool({ connectionString, max: 2, options: `-c search_path=${schema}` });
    const encryptionKey = 'admin-smoke-encryption-key-at-least-32-characters';
    const oldPassword = 'admin-smoke-old-password';
    const rotatedPassword = 'admin-smoke-rotated-password';
    const recoveredPassword = 'admin-smoke-recovered-password';
    const oldTotpSecret = randomBase32();
    const rotatedTotpSecret = randomBase32();
    const recoveredTotpSecret = randomBase32();
    const oldPasswordHash = await hashPassword(oldPassword, 'salt-v1');
    const rotatedPasswordHash = await hashPassword(rotatedPassword, 'salt-v2');
    const recoveredPasswordHash = await hashPassword(recoveredPassword, 'salt-v3');
    const oldTotpEnvelope = encryptAdminTotpSecret(oldTotpSecret, encryptionKey);
    const rotatedTotpEnvelope = encryptAdminTotpSecret(rotatedTotpSecret, encryptionKey);
    const recoveredTotpEnvelope = encryptAdminTotpSecret(recoveredTotpSecret, encryptionKey);
    const common = {
      pool: smokePool,
      username: 'smoke_operator',
      role: 'operator',
      salt: 'salt-v1',
      passwordHash: oldPasswordHash,
      totpSecretCiphertext: oldTotpEnvelope,
    };
    const created = await mutateAdminCredentials({
      ...common,
      mode: 'create',
      adminUserId: 'admin_0123456789abcdef',
    });
    invariant(created.mode === 'create', 'create did not commit');

    const oldLogin = await login({
      pool: smokePool,
      username: 'smoke_operator',
      password: oldPassword,
      totpSecret: oldTotpSecret,
      encryptionKey,
      jti: 'active-before-rotate',
    });
    invariant(oldLogin.ok === true, 'newly created admin credentials could not log in');
    const rotated = await mutateAdminCredentials({
      ...common,
      mode: 'rotate',
      passwordHash: rotatedPasswordHash,
      salt: 'salt-v2',
      totpSecretCiphertext: rotatedTotpEnvelope,
    });
    invariant(rotated.sessionsRevoked === 1, 'rotate did not revoke the active jti');
    const revokedOldSession = await verifyAdminSession({
      pool: smokePool,
      payload: { adminUserId: created.id, role: 'operator', jti: 'active-before-rotate' },
      permission: 'users:read',
    });
    invariant(revokedOldSession === null, 'pre-rotation jti remained valid');
    const rejectedOldLogin = await login({
      pool: smokePool,
      username: 'smoke_operator',
      password: oldPassword,
      totpSecret: oldTotpSecret,
      encryptionKey,
      jti: 'old-credential-must-not-exist',
    });
    invariant(rejectedOldLogin.ok === false, 'pre-rotation password and TOTP remained valid');
    const rotatedLogin = await login({
      pool: smokePool,
      username: 'smoke_operator',
      password: rotatedPassword,
      totpSecret: rotatedTotpSecret,
      encryptionKey,
      jti: 'active-before-recover',
    });
    invariant(rotatedLogin.ok === true, 'rotated credentials could not log in');

    await smokePool.query('UPDATE admin_users SET disabled_at = NOW() WHERE id = $1', [created.id]);
    const recovered = await mutateAdminCredentials({
      ...common,
      mode: 'recover',
      passwordHash: recoveredPasswordHash,
      salt: 'salt-v3',
      totpSecretCiphertext: recoveredTotpEnvelope,
    });
    invariant(recovered.sessionsRevoked === 1, 'recover did not revoke the residual active jti');
    const rejectedRotatedLogin = await login({
      pool: smokePool,
      username: 'smoke_operator',
      password: rotatedPassword,
      totpSecret: rotatedTotpSecret,
      encryptionKey,
      jti: 'rotated-credential-must-not-exist',
    });
    invariant(rejectedRotatedLogin.ok === false, 'pre-recovery credentials remained valid');
    const recoveredLogin = await login({
      pool: smokePool,
      username: 'smoke_operator',
      password: recoveredPassword,
      totpSecret: recoveredTotpSecret,
      encryptionKey,
      jti: 'active-after-recover',
    });
    invariant(recoveredLogin.ok === true, 'recovered credentials could not log in');

    const persisted = (
      await smokePool.query(
        `SELECT u.password_hash, u.disabled_at,
                COUNT(*) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > NOW())::int AS active_sessions
         FROM admin_users u
         LEFT JOIN admin_sessions s ON s.admin_user_id = u.id
         WHERE u.id = $1
         GROUP BY u.id`,
        [created.id],
      )
    ).rows[0];
    invariant(persisted.password_hash === recoveredPasswordHash, 'recovery credential was not persisted');
    invariant(persisted.disabled_at === null, 'recovery did not enable the administrator');
    invariant(persisted.active_sessions === 1, 'only the post-recovery session should remain active');

    let resumeDecryption;
    let signalDecryptionStarted;
    const decryptionStarted = new Promise((resolve) => {
      signalDecryptionStarted = resolve;
    });
    const decryptionPaused = new Promise((resolve) => {
      resumeDecryption = resolve;
    });
    const staleLogin = authenticateAdmin({
      pool: smokePool,
      body: { username: 'smoke_operator', password: recoveredPassword, totpCode: totpCode(recoveredTotpSecret) },
      hashPassword: async () => recoveredPasswordHash,
      decryptTotpSecret: async () => {
        signalDecryptionStarted();
        await decryptionPaused;
        return recoveredTotpSecret;
      },
      createSessionToken: () => 'must-not-be-issued',
      passwordIterations: 100_000,
      generateJti: () => 'stale-login-must-not-exist',
    });
    await decryptionStarted;
    const concurrentRotation = await mutateAdminCredentials({
      ...common,
      mode: 'rotate',
      passwordHash: 'password-hash-v4',
      salt: 'salt-v4',
      totpSecretCiphertext: 'ciphertext-v4',
    });
    invariant(concurrentRotation.sessionsRevoked === 1, 'concurrent rotation did not revoke the recovered jti');
    resumeDecryption();
    const staleLoginResult = await staleLogin;
    invariant(staleLoginResult.ok === false, 'stale credential snapshot minted a post-rotation jti');
    const staleSession = await smokePool.query(
      "SELECT jti FROM admin_sessions WHERE jti = 'stale-login-must-not-exist'",
    );
    invariant(staleSession.rowCount === 0, 'stale credential jti was persisted');

    const audits = (
      await smokePool.query(
        `SELECT action, details::text AS details
         FROM admin_audit_log
         ORDER BY id`,
      )
    ).rows;
    invariant(audits.length === 4, 'expected one durable audit per successful operation');
    invariant(
      audits.map(({ action }) => action).join(',') ===
        'admin_account_created,admin_credentials_rotated,admin_account_recovered,admin_credentials_rotated',
      'audit actions are incomplete',
    );
    const serializedAudits = JSON.stringify(audits);
    const forbiddenAuditMaterial = [
      oldPassword,
      rotatedPassword,
      recoveredPassword,
      oldTotpSecret,
      rotatedTotpSecret,
      recoveredTotpSecret,
      oldPasswordHash,
      rotatedPasswordHash,
      recoveredPasswordHash,
      oldTotpEnvelope,
      rotatedTotpEnvelope,
      recoveredTotpEnvelope,
      'password-hash',
      'salt-v',
      'ciphertext-v',
    ];
    for (const forbidden of forbiddenAuditMaterial) {
      invariant(!serializedAudits.includes(forbidden), 'audit leaked credential material');
    }

    await smokePool.query(
      `INSERT INTO admin_sessions (jti, admin_user_id, role, expires_at)
       VALUES ('must-survive-rollback', $1, 'operator', NOW() + INTERVAL '1 hour')`,
      [created.id],
    );
    await smokePool.query(
      `CREATE FUNCTION reject_admin_audit() RETURNS trigger
       LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END $$`,
    );
    await smokePool.query(
      `CREATE TRIGGER reject_admin_audit
       BEFORE INSERT ON admin_audit_log
       FOR EACH ROW EXECUTE FUNCTION reject_admin_audit()`,
    );
    let rejected = false;
    try {
      await mutateAdminCredentials({
        ...common,
        mode: 'rotate',
        passwordHash: 'password-hash-must-rollback',
        salt: 'salt-must-rollback',
        totpSecretCiphertext: 'ciphertext-must-rollback',
      });
    } catch (error) {
      rejected = String(error.message).includes('forced audit failure');
    }
    invariant(rejected, 'forced audit failure did not reject the transaction');
    const rolledBack = (
      await smokePool.query(
        `SELECT u.password_hash, s.revoked_at
         FROM admin_users u
         JOIN admin_sessions s ON s.admin_user_id = u.id
         WHERE u.id = $1 AND s.jti = 'must-survive-rollback'`,
        [created.id],
      )
    ).rows[0];
    invariant(rolledBack.password_hash === 'password-hash-v4', 'credential update survived audit rollback');
    invariant(rolledBack.revoked_at === null, 'session revocation survived audit rollback');

    process.stdout.write('Admin credential PostgreSQL smoke passed.\n');
  } finally {
    if (smokePool) await smokePool.end();
    await controlPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await controlPool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`Admin credential PostgreSQL smoke failed: ${error.message}\n`);
  process.exitCode = 1;
});
