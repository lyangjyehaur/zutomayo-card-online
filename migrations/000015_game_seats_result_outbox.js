/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  // The migration service runs before the game process, so it must not rely
  // on PostgresAdapter.connect() having created the boardgame table already.
  pgm.createTable(
    'bjg_matches',
    {
      match_id: { type: 'text', primaryKey: true },
      state: { type: 'jsonb' },
      initial_state: { type: 'jsonb' },
      metadata: { type: 'jsonb', notNull: true },
      log: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  pgm.createTable(
    'bjg_match_seats',
    {
      match_id: { type: 'text', notNull: true, references: 'bjg_matches(match_id)', onDelete: 'CASCADE' },
      player_id: { type: 'text', notNull: true },
      user_id: { type: 'text', notNull: true },
      ranked_eligible: { type: 'boolean', notNull: true, default: false },
      credential_hash: { type: 'text', notNull: true },
      reserved_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      last_resumed_at: { type: 'timestamptz' },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['match_id', 'player_id'],
        unique: ['match_id', 'user_id'],
        check: "player_id IN ('0', '1')",
      },
    },
  );
  pgm.createIndex('bjg_match_seats', ['user_id', { name: 'reserved_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_bjg_match_seats_user',
  });

  pgm.createTable(
    'bjg_match_result_outbox',
    {
      source_match_id: {
        type: 'text',
        primaryKey: true,
        references: 'bjg_matches(match_id)',
        onDelete: 'CASCADE',
      },
      player0_user_id: { type: 'text' },
      player1_user_id: { type: 'text' },
      winner_player: { type: 'smallint' },
      winner_user_id: { type: 'text' },
      loser_user_id: { type: 'text' },
      ranked_eligible: { type: 'boolean', notNull: true, default: false },
      turns: { type: 'integer', notNull: true, default: 0 },
      duration_seconds: { type: 'integer', notNull: true, default: 0 },
      action_log: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
      state_id: { type: 'integer' },
      status: { type: 'text', notNull: true, default: 'pending' },
      attempt_count: { type: 'integer', notNull: true, default: 0 },
      next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      locked_at: { type: 'timestamptz' },
      last_error: { type: 'text' },
      delivered_match_id: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      delivered_at: { type: 'timestamptz' },
    },
    {
      ifNotExists: true,
      constraints: {
        check:
          "status IN ('pending', 'processing', 'delivered', 'unrated') AND (winner_player IS NULL OR winner_player IN (0, 1))",
      },
    },
  );
  pgm.createIndex('bjg_match_result_outbox', ['status', 'next_attempt_at'], {
    ifNotExists: true,
    name: 'idx_bjg_match_result_outbox_delivery',
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('bjg_match_result_outbox', { ifExists: true, cascade: true });
  pgm.dropTable('bjg_match_seats', { ifExists: true, cascade: true });
};
