/** Encrypted runtime integration settings managed from the admin panel. */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'service_integrations',
    {
      key: { type: 'text', primaryKey: true },
      config: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      secret_ciphertext: { type: 'text' },
      updated_by_user_id: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('service_integrations', { ifExists: true, cascade: true });
};
