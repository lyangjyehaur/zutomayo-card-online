/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'seasons',
    {
      id: { type: 'text', primaryKey: true },
      name: { type: 'text', notNull: true },
      status: { type: 'text', notNull: true, default: 'scheduled' },
      starts_at: { type: 'timestamptz', notNull: true },
      ends_at: { type: 'timestamptz', notNull: true },
      starting_rating: { type: 'integer', notNull: true, default: 1000 },
      placement_matches: { type: 'integer', notNull: true, default: 5 },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      closed_at: { type: 'timestamptz' },
    },
    {
      ifNotExists: true,
      constraints: {
        check:
          "status IN ('scheduled', 'active', 'closed') AND ends_at > starts_at AND placement_matches BETWEEN 0 AND 20",
      },
    },
  );
  pgm.createIndex('seasons', ['status'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_seasons_single_active',
    where: "status = 'active'",
  });
  pgm.createIndex('seasons', [{ name: 'starts_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_seasons_starts_at',
  });

  pgm.createTable(
    'season_ratings',
    {
      season_id: { type: 'text', notNull: true, references: 'seasons(id)', onDelete: 'CASCADE' },
      user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      rating: { type: 'integer', notNull: true },
      match_count: { type: 'integer', notNull: true, default: 0 },
      wins: { type: 'integer', notNull: true, default: 0 },
      placement_complete: { type: 'boolean', notNull: true, default: false },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: { primaryKey: ['season_id', 'user_id'] },
    },
  );
  pgm.createIndex('season_ratings', ['season_id', { name: 'rating', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_season_ratings_leaderboard',
  });

  pgm.createTable(
    'season_match_results',
    {
      season_id: { type: 'text', notNull: true, references: 'seasons(id)', onDelete: 'CASCADE' },
      source_match_id: { type: 'text', notNull: true },
      winner_user_id: { type: 'text', notNull: true, references: 'users(id)' },
      loser_user_id: { type: 'text', notNull: true, references: 'users(id)' },
      winner_delta: { type: 'integer', notNull: true },
      loser_delta: { type: 'integer', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['season_id', 'source_match_id'],
        check: 'winner_user_id <> loser_user_id',
      },
    },
  );
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('season_match_results', { ifExists: true, cascade: true });
  pgm.dropTable('season_ratings', { ifExists: true, cascade: true });
  pgm.dropTable('seasons', { ifExists: true, cascade: true });
};
