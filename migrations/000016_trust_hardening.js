/** Durable deck reservations used by the boardgame/game-server trust boundary. */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'deck_reservations',
    {
      id: { type: 'text', primaryKey: true },
      user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      deck_id: { type: 'text', notNull: true, references: 'decks(id)', onDelete: 'CASCADE' },
      deck_version: { type: 'text', notNull: true },
      rules_version: { type: 'text', notNull: true },
      card_ids: { type: 'jsonb', notNull: true },
      match_id: { type: 'text' },
      player_id: { type: 'text' },
      expires_at: { type: 'timestamptz', notNull: true },
      consumed_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check: "player_id IS NULL OR player_id IN ('0', '1')",
      },
    },
  );
  pgm.createIndex('deck_reservations', ['user_id', 'created_at'], {
    ifNotExists: true,
    name: 'idx_deck_reservations_user_created',
  });
  pgm.createIndex('deck_reservations', ['expires_at'], {
    ifNotExists: true,
    name: 'idx_deck_reservations_expiry',
  });
  pgm.createIndex('deck_reservations', ['match_id', 'player_id'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_deck_reservations_match_seat',
    where: 'match_id IS NOT NULL AND player_id IS NOT NULL',
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('deck_reservations', { ifExists: true, cascade: true });
};
