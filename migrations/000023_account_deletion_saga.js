/** Durable cross-system account deletion state and Logto principal tombstones. */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'account_deletion_requests',
    {
      id: { type: 'text', primaryKey: true },
      user_id: { type: 'text', notNull: true },
      provider: { type: 'text', notNull: true },
      provider_user_id: { type: 'text', notNull: true },
      status: { type: 'text', notNull: true, default: 'prepared' },
      attempt_count: { type: 'integer', notNull: true, default: 0 },
      last_error: { type: 'text', notNull: true, default: '' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      provider_deleted_at: { type: 'timestamptz' },
      completed_at: { type: 'timestamptz' },
    },
    {
      ifNotExists: true,
      constraints: {
        check:
          "status IN ('prepared', 'provider_deleting', 'provider_deleted', 'provider_failed', 'completed') AND attempt_count >= 0",
      },
    },
  );
  pgm.createIndex('account_deletion_requests', ['user_id'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_account_deletion_requests_active_user',
    where: "status <> 'completed'",
  });
  pgm.createIndex('account_deletion_requests', ['provider', 'provider_user_id'], {
    ifNotExists: true,
    name: 'idx_account_deletion_requests_principal',
  });
  pgm.createIndex('account_deletion_requests', ['status', 'updated_at'], {
    ifNotExists: true,
    name: 'idx_account_deletion_requests_recovery',
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('account_deletion_requests', { ifExists: true, cascade: true });
};
