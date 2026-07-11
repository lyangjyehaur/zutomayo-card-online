/**
 * Persist durable chat sanctions for admin moderation.
 *
 * ChatService checks active sanctions before accepting match, room, direct,
 * or global chat messages, so this table must exist on the normal migration
 * path as well as the initSchema fallback path.
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
    'chat_user_sanctions',
    {
      id: { type: 'text', primaryKey: true },
      target_user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      type: { type: 'text', notNull: true, default: 'chat_mute' },
      status: { type: 'text', notNull: true, default: 'active' },
      reason: { type: 'text', notNull: true, default: '' },
      source_report_id: { type: 'text', references: 'chat_reports(id)', onDelete: 'SET NULL' },
      source_message_id: { type: 'text', references: 'chat_messages(id)', onDelete: 'SET NULL' },
      conversation_id: { type: 'text', references: 'chat_conversations(id)', onDelete: 'SET NULL' },
      created_by_user_id: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      expires_at: { type: 'timestamptz' },
      revoked_at: { type: 'timestamptz' },
      revoked_by_user_id: { type: 'text' },
      revocation_reason: { type: 'text', notNull: true, default: '' },
    },
    { ifNotExists: true },
  );
  pgm.createIndex('chat_user_sanctions', ['target_user_id', 'type', 'status', { name: 'expires_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_chat_user_sanctions_target_active',
  });
};

export const down = false;
