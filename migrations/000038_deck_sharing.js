/** Public deck-share snapshots, trusted engagement, and moderation evidence. */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'deck_shares',
    {
      id: { type: 'text', primaryKey: true },
      owner_user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      source_deck_id: { type: 'text', references: 'decks(id)', onDelete: 'SET NULL' },
      name: { type: 'text', notNull: true },
      card_ids: { type: 'jsonb', notNull: true },
      visibility: { type: 'text', notNull: true, default: 'public' },
      publication_status: { type: 'text', notNull: true, default: 'published' },
      moderation_status: { type: 'text', notNull: true, default: 'visible' },
      moderation_reason: { type: 'text', notNull: true, default: '' },
      published_rules_version: { type: 'text', notNull: true, default: 'legacy' },
      published_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      unpublished_at: { type: 'timestamptz' },
      moderated_at: { type: 'timestamptz' },
      moderated_by_admin_user_id: { type: 'text' },
    },
    {
      constraints: {
        check: [
          "id ~ '^ds_[A-Za-z0-9_-]{8,128}$'",
          "visibility IN ('public', 'unlisted')",
          "publication_status IN ('published', 'unpublished')",
          "moderation_status IN ('visible', 'hidden', 'pending_review')",
          "jsonb_typeof(card_ids) = 'array'",
        ],
      },
    },
  );
  pgm.createIndex('deck_shares', ['source_deck_id'], {
    name: 'uq_deck_shares_source_deck',
    unique: true,
    where: 'source_deck_id IS NOT NULL',
  });
  pgm.createIndex('deck_shares', ['owner_user_id', { name: 'updated_at', sort: 'DESC' }], {
    name: 'idx_deck_shares_owner_updated',
  });
  pgm.createIndex(
    'deck_shares',
    ['publication_status', 'moderation_status', 'visibility', { name: 'updated_at', sort: 'DESC' }, 'id'],
    { name: 'idx_deck_shares_public_lobby' },
  );

  pgm.createTable(
    'deck_share_likes',
    {
      share_id: { type: 'text', notNull: true, references: 'deck_shares(id)', onDelete: 'CASCADE' },
      user_id: { type: 'text', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    { constraints: { primaryKey: ['share_id', 'user_id'] } },
  );
  pgm.createIndex('deck_share_likes', ['user_id', { name: 'created_at', sort: 'DESC' }], {
    name: 'idx_deck_share_likes_user_created',
  });

  pgm.createTable('deck_share_copy_events', {
    id: { type: 'bigserial', primaryKey: true },
    share_id: { type: 'text', notNull: true, references: 'deck_shares(id)', onDelete: 'CASCADE' },
    user_id: { type: 'text', references: 'users(id)', onDelete: 'SET NULL' },
    copied_deck_id: { type: 'text', references: 'decks(id)', onDelete: 'SET NULL' },
    idempotency_key: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('deck_share_copy_events', ['share_id', { name: 'created_at', sort: 'DESC' }], {
    name: 'idx_deck_share_copy_events_share_created',
  });
  pgm.createIndex('deck_share_copy_events', ['share_id', 'user_id', 'idempotency_key'], {
    name: 'uq_deck_share_copy_events_idempotency',
    unique: true,
    where: 'user_id IS NOT NULL AND idempotency_key IS NOT NULL',
  });

  pgm.createTable(
    'deck_share_reports',
    {
      id: { type: 'text', primaryKey: true },
      share_id: { type: 'text', notNull: true, references: 'deck_shares(id)', onDelete: 'CASCADE' },
      reporter_user_id: { type: 'text', references: 'users(id)', onDelete: 'SET NULL' },
      reason: { type: 'text', notNull: true },
      note: { type: 'text', notNull: true, default: '' },
      status: { type: 'text', notNull: true, default: 'pending' },
      resolution_note: { type: 'text', notNull: true, default: '' },
      reviewed_by_admin_user_id: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      resolved_at: { type: 'timestamptz' },
    },
    {
      constraints: {
        check: [
          "id ~ '^dsr_[A-Za-z0-9_-]{8,128}$'",
          "reason IN ('inappropriate_name', 'impersonation_or_harassment', 'spam', 'other')",
          "status IN ('pending', 'reviewing', 'resolved', 'dismissed')",
        ],
      },
    },
  );
  pgm.createIndex('deck_share_reports', ['status', { name: 'created_at', sort: 'DESC' }], {
    name: 'idx_deck_share_reports_status_created',
  });
  pgm.createIndex('deck_share_reports', ['share_id', 'reporter_user_id'], {
    name: 'uq_deck_share_reports_active_reporter',
    unique: true,
    where: "reporter_user_id IS NOT NULL AND status IN ('pending', 'reviewing')",
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('deck_share_reports', { ifExists: true, cascade: true });
  pgm.dropTable('deck_share_copy_events', { ifExists: true, cascade: true });
  pgm.dropTable('deck_share_likes', { ifExists: true, cascade: true });
  pgm.dropTable('deck_shares', { ifExists: true, cascade: true });
};
