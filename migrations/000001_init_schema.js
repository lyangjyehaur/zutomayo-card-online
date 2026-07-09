/**
 * 初始 schema migration。
 *
 * 將 api/server.cjs 的 initSchema() 內容轉為 node-pg-migrate 格式。
 * 全部 createTable / createIndex / addColumn 都使用 ifNotExists: true，
 * 與原本的 CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN IF NOT EXISTS
 * 行為一致，確保在既有 DB 上執行不會衝突（node-pg-migrate 首次跑時會自動
 * 建立 schema_migrations 表並記錄此 migration 已執行）。
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // ===== users =====
  pgm.createTable(
    'users',
    {
      id: { type: 'text', primaryKey: true },
      email: { type: 'text', notNull: true, unique: true },
      password_hash: { type: 'text', notNull: true },
      salt: { type: 'text', notNull: true },
      nickname: { type: 'text', notNull: true },
      elo: { type: 'integer', notNull: true, default: 1000 },
      match_count: { type: 'integer', notNull: true, default: 0 },
      wins: { type: 'integer', notNull: true, default: 0 },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );
  pgm.createIndex('users', [{ name: 'elo', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_users_elo',
  });

  // ===== user_identities =====
  pgm.createTable(
    'user_identities',
    {
      user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      provider: { type: 'text', notNull: true },
      provider_user_id: { type: 'text', notNull: true },
      email: { type: 'text', default: '' },
      email_verified: { type: 'boolean', notNull: true, default: false },
      display_name: { type: 'text', default: '' },
      avatar_url: { type: 'text', default: '' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      access_token_ciphertext: { type: 'text' },
      refresh_token_ciphertext: { type: 'text' },
      token_expires_at: { type: 'timestamptz' },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['provider', 'provider_user_id'],
      },
    },
  );
  pgm.createIndex('user_identities', ['user_id', 'provider'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_user_identities_user_provider',
  });
  pgm.createIndex('user_identities', ['user_id'], {
    ifNotExists: true,
    name: 'idx_user_identities_user',
  });
  // 為舊 DB（user_identities 建表時尚未有這些欄位）補欄位
  pgm.addColumn('user_identities', { access_token_ciphertext: { type: 'text' } }, { ifNotExists: true });
  pgm.addColumn('user_identities', { refresh_token_ciphertext: { type: 'text' } }, { ifNotExists: true });
  pgm.addColumn('user_identities', { token_expires_at: { type: 'timestamptz' } }, { ifNotExists: true });

  // ===== decks =====
  pgm.createTable(
    'decks',
    {
      id: { type: 'text', primaryKey: true },
      user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      name: { type: 'text', notNull: true },
      card_ids: { type: 'jsonb', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );
  pgm.createIndex('decks', ['user_id'], {
    ifNotExists: true,
    name: 'idx_decks_user',
  });

  // ===== matches =====
  pgm.createTable(
    'matches',
    {
      id: { type: 'text', primaryKey: true },
      source_match_id: { type: 'text' },
      player0_id: { type: 'text', references: 'users(id)' },
      player1_id: { type: 'text', references: 'users(id)' },
      winner_id: { type: 'text' },
      loser_id: { type: 'text' },
      winner_elo_change: { type: 'integer', notNull: true, default: 0 },
      loser_elo_change: { type: 'integer', notNull: true, default: 0 },
      turns: { type: 'integer' },
      duration_seconds: { type: 'integer' },
      action_log: { type: 'jsonb' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );
  pgm.createIndex('matches', ['player0_id'], {
    ifNotExists: true,
    name: 'idx_matches_player0',
  });
  pgm.createIndex('matches', ['player1_id'], {
    ifNotExists: true,
    name: 'idx_matches_player1',
  });
  pgm.createIndex('matches', ['winner_id'], {
    ifNotExists: true,
    name: 'idx_matches_winner',
  });
  pgm.createIndex('matches', ['loser_id'], {
    ifNotExists: true,
    name: 'idx_matches_loser',
  });
  pgm.createIndex('matches', [{ name: 'created_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_matches_created_at',
  });
  // 為舊 DB（matches 建表時尚未有 source_match_id）補欄位
  pgm.addColumn('matches', { source_match_id: { type: 'text' } }, { ifNotExists: true });
  pgm.createIndex('matches', ['source_match_id'], {
    ifNotExists: true,
    unique: true,
    name: 'idx_matches_source_match_id',
    where: 'source_match_id IS NOT NULL',
  });

  // ===== cards =====
  pgm.createTable(
    'cards',
    {
      id: { type: 'text', primaryKey: true },
      name: { type: 'text', notNull: true },
      pack: { type: 'text', notNull: true },
      song: { type: 'text', default: '' },
      illustrator: { type: 'text', default: '' },
      rarity: { type: 'text', default: '' },
      element: { type: 'text', notNull: true },
      type: { type: 'text', notNull: true },
      clock: { type: 'integer', default: 0 },
      attack_night: { type: 'integer' },
      attack_day: { type: 'integer' },
      power_cost: { type: 'integer', default: 0 },
      send_to_power: { type: 'integer', default: 0 },
      effect: { type: 'text', default: '' },
      image: { type: 'text', default: '' },
      errata: { type: 'text', default: '' },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  // ===== card_effects_i18n =====
  pgm.createTable(
    'card_effects_i18n',
    {
      card_id: { type: 'text', notNull: true },
      lang: { type: 'text', notNull: true },
      effect_text: { type: 'text', notNull: true, default: '' },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['card_id', 'lang'],
      },
    },
  );

  // ===== game_config =====
  pgm.createTable(
    'game_config',
    {
      key: { type: 'text', primaryKey: true },
      value: { type: 'jsonb', notNull: true },
      description: { type: 'text', default: '' },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  // ===== preset_decks =====
  pgm.createTable(
    'preset_decks',
    {
      id: { type: 'text', primaryKey: true },
      name: { type: 'text', notNull: true },
      card_ids: { type: 'jsonb', notNull: true },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  // ===== admin_audit_log =====
  pgm.createTable(
    'admin_audit_log',
    {
      id: { type: 'bigserial', primaryKey: true },
      admin_user_id: { type: 'text' },
      action: { type: 'text', notNull: true },
      target_type: { type: 'text', notNull: true },
      target_id: { type: 'text' },
      details: { type: 'jsonb' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );
  // 為舊 DB（admin_audit_log 建表時尚未有此欄位）補欄位
  pgm.addColumn('admin_audit_log', { admin_user_id: { type: 'text' } }, { ifNotExists: true });

  // ===== feedback_posts =====
  pgm.createTable(
    'feedback_posts',
    {
      id: { type: 'text', primaryKey: true },
      title: { type: 'text', notNull: true },
      description: { type: 'text', notNull: true, default: '' },
      author_user_id: { type: 'text', references: 'users(id)', onDelete: 'SET NULL' },
      anonymous_id: { type: 'text' },
      status: { type: 'text', notNull: true, default: 'open' },
      tag: { type: 'text', notNull: true, default: '' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      edited_at: { type: 'timestamptz' },
      original_post_id: { type: 'text', references: 'feedback_posts(id)', onDelete: 'SET NULL' },
    },
    {
      ifNotExists: true,
      constraints: {
        check: [
          'author_user_id IS NOT NULL OR anonymous_id IS NOT NULL',
          'NOT (author_user_id IS NOT NULL AND anonymous_id IS NOT NULL)',
        ],
      },
    },
  );
  pgm.createIndex('feedback_posts', ['status'], {
    ifNotExists: true,
    name: 'idx_feedback_posts_status',
  });
  pgm.createIndex('feedback_posts', [{ name: 'created_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_feedback_posts_created_at',
  });
  // 為舊 DB 補欄位
  pgm.addColumn('feedback_posts', { edited_at: { type: 'timestamptz' } }, { ifNotExists: true });
  pgm.addColumn(
    'feedback_posts',
    { original_post_id: { type: 'text', references: 'feedback_posts(id)', onDelete: 'SET NULL' } },
    { ifNotExists: true },
  );

  // ===== feedback_votes =====
  pgm.createTable(
    'feedback_votes',
    {
      post_id: {
        type: 'text',
        notNull: true,
        references: 'feedback_posts(id)',
        onDelete: 'CASCADE',
      },
      voter_user_id: { type: 'text', references: 'users(id)', onDelete: 'CASCADE' },
      anonymous_id: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check: [
          'voter_user_id IS NOT NULL OR anonymous_id IS NOT NULL',
          'NOT (voter_user_id IS NOT NULL AND anonymous_id IS NOT NULL)',
        ],
      },
    },
  );
  pgm.createIndex('feedback_votes', ['post_id', 'voter_user_id'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_feedback_votes_user',
    where: 'voter_user_id IS NOT NULL',
  });
  pgm.createIndex('feedback_votes', ['post_id', 'anonymous_id'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_feedback_votes_anon',
    where: 'anonymous_id IS NOT NULL',
  });

  // ===== feedback_comments =====
  pgm.createTable(
    'feedback_comments',
    {
      id: { type: 'text', primaryKey: true },
      post_id: {
        type: 'text',
        notNull: true,
        references: 'feedback_posts(id)',
        onDelete: 'CASCADE',
      },
      content: { type: 'text', notNull: true },
      author_user_id: { type: 'text', references: 'users(id)', onDelete: 'SET NULL' },
      anonymous_id: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      is_official: { type: 'boolean', notNull: true, default: false },
      edited_at: { type: 'timestamptz' },
    },
    {
      ifNotExists: true,
      constraints: {
        check: [
          'author_user_id IS NOT NULL OR anonymous_id IS NOT NULL',
          'NOT (author_user_id IS NOT NULL AND anonymous_id IS NOT NULL)',
        ],
      },
    },
  );
  pgm.createIndex('feedback_comments', ['post_id', 'created_at'], {
    ifNotExists: true,
    name: 'idx_feedback_comments_post',
  });
  // 為舊 DB 補欄位
  pgm.addColumn(
    'feedback_comments',
    { is_official: { type: 'boolean', notNull: true, default: false } },
    { ifNotExists: true },
  );
  pgm.addColumn('feedback_comments', { edited_at: { type: 'timestamptz' } }, { ifNotExists: true });

  // ===== feedback_comment_votes =====
  pgm.createTable(
    'feedback_comment_votes',
    {
      comment_id: {
        type: 'text',
        notNull: true,
        references: 'feedback_comments(id)',
        onDelete: 'CASCADE',
      },
      voter_user_id: { type: 'text', references: 'users(id)', onDelete: 'CASCADE' },
      anonymous_id: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check: [
          'voter_user_id IS NOT NULL OR anonymous_id IS NOT NULL',
          'NOT (voter_user_id IS NOT NULL AND anonymous_id IS NOT NULL)',
        ],
      },
    },
  );
  pgm.createIndex('feedback_comment_votes', ['comment_id', 'voter_user_id'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_feedback_comment_votes_user',
    where: 'voter_user_id IS NOT NULL',
  });
  pgm.createIndex('feedback_comment_votes', ['comment_id', 'anonymous_id'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_feedback_comment_votes_anon',
    where: 'anonymous_id IS NOT NULL',
  });

  // ===== feedback_tags =====
  pgm.createTable(
    'feedback_tags',
    {
      id: { type: 'text', primaryKey: true },
      name: { type: 'text', notNull: true, unique: true },
      color: { type: 'text', notNull: true, default: '' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { ifNotExists: true },
  );

  // ===== feedback_comment_reactions =====
  pgm.createTable(
    'feedback_comment_reactions',
    {
      comment_id: {
        type: 'text',
        notNull: true,
        references: 'feedback_comments(id)',
        onDelete: 'CASCADE',
      },
      voter_user_id: { type: 'text', references: 'users(id)', onDelete: 'CASCADE' },
      anonymous_id: { type: 'text' },
      emoji: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check: [
          'voter_user_id IS NOT NULL OR anonymous_id IS NOT NULL',
          'NOT (voter_user_id IS NOT NULL AND anonymous_id IS NOT NULL)',
        ],
      },
    },
  );
  pgm.createIndex('feedback_comment_reactions', ['comment_id', 'voter_user_id', 'emoji'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_feedback_comment_reactions_user',
    where: 'voter_user_id IS NOT NULL',
  });
  pgm.createIndex('feedback_comment_reactions', ['comment_id', 'anonymous_id', 'emoji'], {
    ifNotExists: true,
    unique: true,
    name: 'uq_feedback_comment_reactions_anon',
    where: 'anonymous_id IS NOT NULL',
  });

  // ===== feedback_attachments =====
  pgm.createTable(
    'feedback_attachments',
    {
      id: { type: 'text', primaryKey: true },
      post_id: { type: 'text', references: 'feedback_posts(id)', onDelete: 'CASCADE' },
      comment_id: { type: 'text', references: 'feedback_comments(id)', onDelete: 'CASCADE' },
      file_name: { type: 'text', notNull: true, default: '' },
      content_type: { type: 'text', notNull: true, default: 'image/png' },
      file_size: { type: 'integer', notNull: true, default: 0 },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check: 'post_id IS NOT NULL OR comment_id IS NOT NULL',
      },
    },
  );
};

// 初始 schema 不可逆（不提供 down migration）
export const down = false;
