/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumn('admin_users', {
    user_id: { type: 'text', references: 'users(id)', onDelete: 'CASCADE' },
  });
  pgm.createIndex('admin_users', ['user_id'], {
    unique: true,
    name: 'uq_admin_users_user_id',
  });
  pgm.alterColumn('admin_users', 'password_hash', { allowNull: true });
  pgm.alterColumn('admin_users', 'salt', { allowNull: true });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql('DELETE FROM admin_users WHERE user_id IS NOT NULL AND (password_hash IS NULL OR salt IS NULL)');
  pgm.alterColumn('admin_users', 'password_hash', { notNull: true });
  pgm.alterColumn('admin_users', 'salt', { notNull: true });
  pgm.dropIndex('admin_users', ['user_id'], { ifExists: true, name: 'uq_admin_users_user_id' });
  pgm.dropColumn('admin_users', 'user_id', { ifExists: true });
};
