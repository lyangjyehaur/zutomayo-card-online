/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'admin_users',
    {
      id: { type: 'text', primaryKey: true },
      username: { type: 'text', notNull: true, unique: true },
      password_hash: { type: 'text', notNull: true },
      salt: { type: 'text', notNull: true },
      role: { type: 'text', notNull: true, default: 'viewer' },
      totp_secret_ciphertext: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      last_login_at: { type: 'timestamptz' },
      disabled_at: { type: 'timestamptz' },
    },
    {
      ifNotExists: true,
      constraints: {
        check: "role IN ('viewer', 'moderator', 'operator', 'admin')",
      },
    },
  );

  pgm.createTable(
    'admin_sessions',
    {
      jti: { type: 'text', primaryKey: true },
      admin_user_id: { type: 'text', notNull: true, references: 'admin_users(id)', onDelete: 'CASCADE' },
      role: { type: 'text', notNull: true },
      expires_at: { type: 'timestamptz', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      revoked_at: { type: 'timestamptz' },
      last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );
  pgm.createIndex('admin_sessions', ['admin_user_id', 'expires_at'], {
    ifNotExists: true,
    name: 'idx_admin_sessions_user_expiry',
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('admin_sessions', { ifExists: true, cascade: true });
  pgm.dropTable('admin_users', { ifExists: true, cascade: true });
};
