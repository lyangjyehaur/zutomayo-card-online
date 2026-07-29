/** Persist each signed-in user's physical card collection. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable('user_card_collection', {
    user_id: { type: 'text', notNull: true, references: 'users', onDelete: 'CASCADE' },
    card_id: { type: 'text', notNull: true, references: 'cards', onDelete: 'CASCADE' },
    acquired_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.addConstraint('user_card_collection', 'user_card_collection_pkey', {
    primaryKey: ['user_id', 'card_id'],
  });
  pgm.createIndex('user_card_collection', ['user_id', 'updated_at'], {
    name: 'idx_user_card_collection_user_updated',
  });
};

export const down = false;
