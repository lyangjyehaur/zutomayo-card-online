#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');

const VALID_ROLES = new Set(['viewer', 'moderator', 'operator', 'admin']);

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

async function main() {
  const userId = argument('user-id').trim();
  const email = argument('email').trim().toLowerCase();
  const role = argument('role') || 'admin';
  const remove = process.argv.includes('--remove');
  if (Boolean(userId) === Boolean(email)) throw new Error('Provide exactly one of --user-id or --email');
  if (!remove && !VALID_ROLES.has(role)) throw new Error('--role must be viewer, moderator, operator, or admin');

  const migrationUser = assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
  const databaseUrl = postgresConnectionString(process.env);
  const pool = new Pool({
    ...(databaseUrl
      ? { connectionString: databaseUrl }
      : {
          host: process.env.PG_HOST,
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER || migrationUser,
          password: process.env.PG_PASSWORD,
          database: process.env.PG_DATABASE,
        }),
    ssl: postgresSslConfig(process.env),
  });

  try {
    const user = (
      await pool.query(
        userId
          ? 'SELECT id, email FROM users WHERE id = $1 AND deleted_at IS NULL'
          : 'SELECT id, email FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL',
        [userId || email],
      )
    ).rows[0];
    if (!user) throw new Error('Active user not found');

    if (remove) {
      const removed = await pool.query('DELETE FROM admin_users WHERE user_id = $1 RETURNING id', [user.id]);
      if (!removed.rowCount) throw new Error('User is not linked to an admin role');
      process.stdout.write(`Unlinked ${user.email} (${user.id}) from admin access.\n`);
      return;
    }

    const adminId = `admin_user_${crypto.createHash('sha256').update(user.id).digest('hex').slice(0, 16)}`;
    await pool.query(
      `INSERT INTO admin_users (id, user_id, username, password_hash, salt, role, updated_at)
       VALUES ($1, $2, $3, NULL, NULL, $4, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET role = EXCLUDED.role,
                     disabled_at = NULL,
                     updated_at = NOW()`,
      [adminId, user.id, `user:${user.id}`, role],
    );
    process.stdout.write(`Linked ${user.email} (${user.id}) to admin role ${role}.\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
