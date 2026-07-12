/**
 * user_friends 表 migration。
 *
 * 將 api/server.cjs initSchema() 中的 user_friends CREATE TABLE 移入
 * node-pg-migrate 系統，消除 schema drift。initSchema() 的 fallback 保留
 * 以維持既有 DB 的向後相容。
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable(
    'user_friends',
    {
      user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      friend_user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['user_id', 'friend_user_id'],
        check: 'user_id <> friend_user_id',
      },
    },
  );
  pgm.createIndex('user_friends', ['friend_user_id'], {
    ifNotExists: true,
    name: 'idx_user_friends_friend',
  });
};

export const down = (pgm) => {
  pgm.dropTable('user_friends', { ifExists: true, cascade: true });
};
