/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumns(
    'users',
    {
      email_verified: { type: 'boolean', notNull: true, default: false },
      auth_version: { type: 'integer', notNull: true, default: 1 },
      deleted_at: { type: 'timestamptz' },
    },
    { ifNotExists: true },
  );

  pgm.createTable(
    'account_action_tokens',
    {
      id: { type: 'bigserial', primaryKey: true },
      user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      action_type: { type: 'text', notNull: true },
      token_hash: { type: 'text', notNull: true, unique: true },
      expires_at: { type: 'timestamptz', notNull: true },
      consumed_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check: "action_type IN ('verify_email', 'reset_password')",
      },
    },
  );
  pgm.createIndex('account_action_tokens', ['user_id', 'action_type'], {
    ifNotExists: true,
    name: 'idx_account_action_tokens_user_action',
  });
  pgm.createIndex('account_action_tokens', ['expires_at'], {
    ifNotExists: true,
    name: 'idx_account_action_tokens_expiry',
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('account_action_tokens', { ifExists: true, cascade: true });
  pgm.dropColumns('users', ['email_verified', 'auth_version', 'deleted_at'], { ifExists: true });
};
