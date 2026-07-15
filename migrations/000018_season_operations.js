/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.addColumns(
    'seasons',
    {
      rating_decay_percent: { type: 'integer', notNull: true, default: 25 },
      rules_version: { type: 'text', notNull: true, default: 'current' },
      reward_config: { type: 'jsonb', notNull: true, default: pgm.func('\'{"tiers":[]}\'::jsonb') },
      activated_at: { type: 'timestamptz' },
    },
    { ifNotExists: true },
  );
  pgm.addConstraint('seasons', 'ck_seasons_rating_decay_percent', {
    check: 'rating_decay_percent BETWEEN 0 AND 100',
  });

  pgm.createTable(
    'season_rewards',
    {
      season_id: { type: 'text', notNull: true, references: 'seasons(id)', onDelete: 'CASCADE' },
      user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      final_rank: { type: 'integer', notNull: true },
      final_rating: { type: 'integer', notNull: true },
      reward_tier: { type: 'text', notNull: true },
      reward_payload: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      claimed_at: { type: 'timestamptz' },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['season_id', 'user_id'],
        check: 'final_rank > 0',
      },
    },
  );
  pgm.createIndex('season_rewards', ['user_id', { name: 'granted_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_season_rewards_user',
  });
  pgm.createIndex('seasons', ['status'], {
    ifNotExists: true,
    unique: true,
    where: "status = 'active'",
    name: 'idx_seasons_single_active',
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropIndex('seasons', ['status'], { ifExists: true, name: 'idx_seasons_single_active' });
  pgm.dropTable('season_rewards', { ifExists: true, cascade: true });
  pgm.dropConstraint('seasons', 'ck_seasons_rating_decay_percent', { ifExists: true });
  pgm.dropColumns('seasons', ['rating_decay_percent', 'rules_version', 'reward_config', 'activated_at'], {
    ifExists: true,
  });
};
