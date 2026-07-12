/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'friend_requests',
    {
      id: { type: 'bigserial', primaryKey: true },
      requester_user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      recipient_user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      status: { type: 'text', notNull: true, default: 'pending' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      responded_at: { type: 'timestamptz' },
    },
    {
      ifNotExists: true,
      constraints: {
        unique: ['requester_user_id', 'recipient_user_id'],
        check: "requester_user_id <> recipient_user_id AND status IN ('pending', 'accepted', 'rejected')",
      },
    },
  );
  pgm.createIndex('friend_requests', ['recipient_user_id', 'status'], {
    ifNotExists: true,
    name: 'idx_friend_requests_recipient_status',
  });

  pgm.createTable(
    'user_blocks',
    {
      blocker_user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      blocked_user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['blocker_user_id', 'blocked_user_id'],
        check: 'blocker_user_id <> blocked_user_id',
      },
    },
  );
  pgm.createIndex('user_blocks', ['blocked_user_id'], {
    ifNotExists: true,
    name: 'idx_user_blocks_blocked',
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('user_blocks', { ifExists: true, cascade: true });
  pgm.dropTable('friend_requests', { ifExists: true, cascade: true });
};
