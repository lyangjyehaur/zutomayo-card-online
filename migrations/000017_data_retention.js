/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'legal_holds',
    {
      id: { type: 'text', primaryKey: true },
      subject_type: { type: 'text', notNull: true },
      subject_id: { type: 'text', notNull: true },
      reason: { type: 'text', notNull: true },
      owner: { type: 'text', notNull: true },
      expires_at: { type: 'timestamptz' },
      released_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    },
    {
      ifNotExists: true,
      constraints: {
        check: "subject_type IN ('account', 'match', 'conversation', 'message', 'report', 'feedback')",
      },
    },
  );
  pgm.createIndex('legal_holds', ['subject_type', 'subject_id'], {
    ifNotExists: true,
    name: 'idx_legal_holds_subject',
  });
  pgm.createIndex('legal_holds', ['released_at', 'expires_at'], {
    ifNotExists: true,
    name: 'idx_legal_holds_active',
  });

  pgm.createTable(
    'retention_runs',
    {
      id: { type: 'text', primaryKey: true },
      mode: { type: 'text', notNull: true, default: 'live' },
      status: { type: 'text', notNull: true, default: 'running' },
      started_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      finished_at: { type: 'timestamptz' },
      deleted_counts: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      error: { type: 'text' },
    },
    {
      ifNotExists: true,
      constraints: {
        check: "mode IN ('dry_run', 'live') AND status IN ('running', 'succeeded', 'failed')",
      },
    },
  );
  pgm.createIndex('retention_runs', [{ name: 'started_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_retention_runs_started',
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('retention_runs', { ifExists: true, cascade: true });
  pgm.dropTable('legal_holds', { ifExists: true, cascade: true });
};
