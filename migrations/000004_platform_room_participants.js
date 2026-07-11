/**
 * Persist account-backed Colyseus custom-room participation.
 *
 * ChatService uses this durable membership evidence before allowing
 * pregame room chat access.
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
    'platform_room_participants',
    {
      room_code: { type: 'text', notNull: true },
      user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      role: { type: 'text', notNull: true, default: 'spectator' },
      display_name: { type: 'text', notNull: true, default: '' },
      first_joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['room_code', 'user_id'],
      },
    },
  );
  pgm.createIndex('platform_room_participants', ['user_id', { name: 'last_seen_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_platform_room_participants_user',
  });
  pgm.createIndex('platform_room_participants', ['room_code', 'role'], {
    ifNotExists: true,
    name: 'idx_platform_room_participants_room_role',
  });
};

export const down = false;
