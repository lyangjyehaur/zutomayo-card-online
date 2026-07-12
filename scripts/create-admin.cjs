#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const util = require('util');
const { Pool } = require('pg');
const { encryptAdminTotpSecret, randomBase32 } = require('../api/adminSecretCrypto.cjs');
const { postgresConnectionString, postgresSslConfig } = require('../api/runtimeSecurityConfig.cjs');

const pbkdf2 = util.promisify(crypto.pbkdf2);
const VALID_ROLES = new Set(['viewer', 'moderator', 'operator', 'admin']);

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

async function main() {
  const username = argument('username').trim().toLowerCase();
  const role = argument('role') || 'admin';
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
  const encryptionSecret = process.env.ADMIN_TOTP_ENCRYPTION_KEY || '';
  if (!/^[a-z0-9._-]{3,80}$/.test(username)) throw new Error('--username must be 3-80 safe characters');
  if (!VALID_ROLES.has(role)) throw new Error('--role must be viewer, moderator, operator, or admin');
  if (password.length < 16) throw new Error('ADMIN_BOOTSTRAP_PASSWORD must be at least 16 characters');

  const totpSecret = process.env.ADMIN_BOOTSTRAP_TOTP_SECRET || randomBase32();
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = (await pbkdf2(password, salt, 100_000, 64, 'sha512')).toString('hex');
  const ciphertext = encryptAdminTotpSecret(totpSecret, encryptionSecret);
  const databaseUrl = postgresConnectionString(process.env);
  const pool = new Pool({
    ...(databaseUrl
      ? { connectionString: databaseUrl }
      : {
          host: process.env.PG_HOST,
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER,
          password: process.env.PG_PASSWORD,
          database: process.env.PG_DATABASE,
        }),
    ssl: postgresSslConfig(process.env),
  });

  try {
    const id = `admin_${crypto.randomBytes(8).toString('hex')}`;
    await pool.query(
      `INSERT INTO admin_users (id, username, password_hash, salt, role, totp_secret_ciphertext, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (username)
       DO UPDATE SET password_hash = EXCLUDED.password_hash,
                     salt = EXCLUDED.salt,
                     role = EXCLUDED.role,
                     totp_secret_ciphertext = EXCLUDED.totp_secret_ciphertext,
                     disabled_at = NULL,
                     updated_at = NOW()`,
      [id, username, passwordHash, salt, role, ciphertext],
    );
    process.stdout.write(`Admin ${username} created with role ${role}.\n`);
    process.stdout.write(`TOTP secret (store it now; it will not be shown again): ${totpSecret}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
