/** Durable relationship/account revocation events for cross-service delivery. */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'relationship_change_outbox',
    {
      event_id: { type: 'text', primaryKey: true },
      idempotency_key: { type: 'text', unique: true },
      version: { type: 'smallint', notNull: true, default: 1 },
      kind: { type: 'text', notNull: true },
      user_ids: { type: 'text[]', notNull: true },
      actor_user_id: { type: 'text' },
      occurred_at: { type: 'timestamptz', notNull: true },
      status: { type: 'text', notNull: true, default: 'pending' },
      attempt_count: { type: 'integer', notNull: true, default: 0 },
      poison_count: { type: 'integer', notNull: true, default: 0 },
      next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      locked_at: { type: 'timestamptz' },
      lock_token: { type: 'text' },
      lease_expires_at: { type: 'timestamptz' },
      last_error: { type: 'text', notNull: true, default: '' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      delivered_at: { type: 'timestamptz' },
    },
    {
      ifNotExists: true,
      constraints: {
        check: [
          'version = 1',
          "kind IN ('friendship_added', 'friendship_removed', 'block_created', 'block_removed', 'account_deleted')",
          "status IN ('pending', 'processing', 'delivered', 'dead_letter')",
          'attempt_count >= 0',
          'poison_count >= 0',
          'cardinality(user_ids) BETWEEN 1 AND 2',
          "(kind = 'account_deleted' AND cardinality(user_ids) = 1) OR (kind <> 'account_deleted' AND cardinality(user_ids) = 2)",
          'actor_user_id IS NULL OR actor_user_id = ANY(user_ids)',
          "kind NOT IN ('block_created', 'block_removed') OR actor_user_id IS NOT NULL",
        ],
      },
    },
  );
  pgm.createIndex('relationship_change_outbox', ['status', 'next_attempt_at'], {
    ifNotExists: true,
    name: 'idx_relationship_change_outbox_delivery',
  });
  pgm.createIndex('relationship_change_outbox', ['created_at'], {
    ifNotExists: true,
    name: 'idx_relationship_change_outbox_created',
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('relationship_change_outbox', { ifExists: true, cascade: true });
};
