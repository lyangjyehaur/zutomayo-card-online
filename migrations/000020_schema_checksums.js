/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'schema_migration_checksums',
    {
      name: { type: 'text', primaryKey: true },
      sha256: { type: 'text', notNull: true },
      recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: { check: "sha256 ~ '^[a-f0-9]{64}$'" },
    },
  );
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('schema_migration_checksums', { ifExists: true, cascade: true });
};
