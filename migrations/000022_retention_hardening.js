/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumns(
    'matches',
    {
      action_log_purged_at: { type: 'timestamptz' },
      anonymized_at: { type: 'timestamptz' },
    },
    { ifNotExists: true },
  );
  pgm.createIndex('matches', ['action_log_purged_at', 'completed_at'], {
    ifNotExists: true,
    name: 'idx_matches_action_log_retention',
    where: 'action_log_purged_at IS NULL',
  });
  pgm.createIndex('matches', ['anonymized_at', 'completed_at'], {
    ifNotExists: true,
    name: 'idx_matches_identity_retention',
    where: 'anonymized_at IS NULL',
  });

  pgm.addColumns('chat_messages', { retention_anonymized_at: { type: 'timestamptz' } }, { ifNotExists: true });
  pgm.createIndex('chat_messages', ['retention_anonymized_at', 'created_at'], {
    ifNotExists: true,
    name: 'idx_chat_messages_retention',
    where: 'retention_anonymized_at IS NULL',
  });

  pgm.addColumns(
    'retention_runs',
    {
      heartbeat_at: { type: 'timestamptz' },
      batch_count: { type: 'integer', notNull: true, default: 0 },
      duration_ms: { type: 'bigint' },
    },
    { ifNotExists: true },
  );

  pgm.createTable(
    'legal_hold_objects',
    {
      hold_id: { type: 'text', notNull: true, references: 'legal_holds(id)', onDelete: 'CASCADE' },
      object_type: { type: 'text', notNull: true },
      object_id: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['hold_id', 'object_type', 'object_id'],
        check: "object_type IN ('account', 'match', 'conversation', 'message', 'report', 'feedback')",
      },
    },
  );
  pgm.createIndex('legal_hold_objects', ['object_type', 'object_id'], {
    ifNotExists: true,
    name: 'idx_legal_hold_objects_subject',
  });

  // Preserve the semantics of holds created before the expansion table existed.
  pgm.sql(`
    INSERT INTO legal_hold_objects (hold_id, object_type, object_id)
    SELECT id, subject_type, subject_id
      FROM legal_holds
    ON CONFLICT (hold_id, object_type, object_id) DO NOTHING
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('legal_hold_objects', { ifExists: true, cascade: true });
  pgm.dropColumns('retention_runs', ['heartbeat_at', 'batch_count', 'duration_ms'], { ifExists: true });
  pgm.dropIndex('chat_messages', ['retention_anonymized_at', 'created_at'], {
    ifExists: true,
    name: 'idx_chat_messages_retention',
  });
  pgm.dropColumn('chat_messages', 'retention_anonymized_at', { ifExists: true });
  pgm.dropIndex('matches', ['action_log_purged_at', 'completed_at'], {
    ifExists: true,
    name: 'idx_matches_action_log_retention',
  });
  pgm.dropIndex('matches', ['anonymized_at', 'completed_at'], {
    ifExists: true,
    name: 'idx_matches_identity_retention',
  });
  pgm.dropColumns('matches', ['action_log_purged_at', 'anonymized_at'], { ifExists: true });
};
