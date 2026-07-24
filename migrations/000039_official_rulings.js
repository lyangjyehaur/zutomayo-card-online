/** Versioned official Q&A and errata notice translations. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'official_qa_items',
    {
      id: { type: 'text', primaryKey: true },
      number: { type: 'integer', notNull: true, unique: true },
      published_at: { type: 'date', notNull: true },
      question_ja: { type: 'text', notNull: true },
      answer_ja: { type: 'text', notNull: true },
      tags: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
      related_card_ids: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
      source_url: { type: 'text', notNull: true },
      content_hash: { type: 'text', notNull: true },
      content_version: { type: 'integer', notNull: true, default: 1 },
      publication_status: { type: 'text', notNull: true, default: 'published' },
      source_updated_at: { type: 'timestamptz' },
      last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check:
          "number > 0 AND content_version > 0 AND publication_status IN ('published', 'inactive') AND question_ja <> '' AND answer_ja <> ''",
      },
    },
  );
  pgm.createIndex('official_qa_items', ['publication_status', { name: 'number', sort: 'ASC' }], {
    ifNotExists: true,
    name: 'idx_official_qa_publication_number',
  });
  pgm.createIndex('official_qa_items', 'related_card_ids', {
    ifNotExists: true,
    name: 'idx_official_qa_related_cards',
    method: 'gin',
  });

  pgm.createTable(
    'official_qa_translations',
    {
      qa_id: { type: 'text', notNull: true, references: 'official_qa_items(id)', onDelete: 'CASCADE' },
      content_version: { type: 'integer', notNull: true },
      locale: { type: 'text', notNull: true },
      question_text: { type: 'text', notNull: true, default: '' },
      answer_text: { type: 'text', notNull: true, default: '' },
      status: { type: 'text', notNull: true, default: 'pending_review' },
      provider: { type: 'text', notNull: true, default: '' },
      model: { type: 'text', notNull: true, default: '' },
      review_note: { type: 'text', notNull: true, default: '' },
      reviewed_by_user_id: { type: 'text' },
      reviewed_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['qa_id', 'content_version', 'locale'],
        check:
          "locale IN ('zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko') AND status IN ('pending_review', 'machine', 'verified', 'failed')",
      },
    },
  );
  pgm.createIndex('official_qa_translations', ['locale', 'status'], {
    ifNotExists: true,
    name: 'idx_official_qa_translations_locale_status',
  });

  for (const [name, definition] of Object.entries({
    reason_ja: { type: 'text', notNull: true, default: '' },
    replacement_policy_ja: { type: 'text', notNull: true, default: '' },
    usage_policy_ja: { type: 'text', notNull: true, default: '' },
    card_number: { type: 'text', notNull: true, default: '' },
    content_hash: { type: 'text', notNull: true, default: '' },
    content_version: { type: 'integer', notNull: true, default: 1 },
    publication_status: { type: 'text', notNull: true, default: 'published' },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  })) {
    pgm.addColumn('card_official_errata', { [name]: definition }, { ifNotExists: true });
  }

  pgm.createTable(
    'card_official_errata_translations',
    {
      errata_id: { type: 'text', notNull: true, references: 'card_official_errata(errata_id)', onDelete: 'CASCADE' },
      content_version: { type: 'integer', notNull: true },
      locale: { type: 'text', notNull: true },
      incorrect_text: { type: 'text', notNull: true, default: '' },
      reason_text: { type: 'text', notNull: true, default: '' },
      replacement_policy_text: { type: 'text', notNull: true, default: '' },
      usage_policy_text: { type: 'text', notNull: true, default: '' },
      status: { type: 'text', notNull: true, default: 'pending_review' },
      provider: { type: 'text', notNull: true, default: '' },
      model: { type: 'text', notNull: true, default: '' },
      review_note: { type: 'text', notNull: true, default: '' },
      reviewed_by_user_id: { type: 'text' },
      reviewed_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['errata_id', 'content_version', 'locale'],
        check:
          "locale IN ('zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko') AND status IN ('pending_review', 'machine', 'verified', 'failed')",
      },
    },
  );
  pgm.createIndex('card_official_errata_translations', ['locale', 'status'], {
    ifNotExists: true,
    name: 'idx_card_official_errata_translations_locale_status',
  });

  pgm.createTable(
    'official_rulings_sync_runs',
    {
      id: { type: 'text', primaryKey: true },
      trigger_source: { type: 'text', notNull: true, default: 'admin' },
      status: { type: 'text', notNull: true, default: 'running' },
      qa_local_count: { type: 'integer', notNull: true, default: 0 },
      qa_remote_count: { type: 'integer', notNull: true, default: 0 },
      errata_local_count: { type: 'integer', notNull: true, default: 0 },
      errata_remote_count: { type: 'integer', notNull: true, default: 0 },
      diff: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      error_text: { type: 'text', notNull: true, default: '' },
      requested_by_admin_user_id: { type: 'text' },
      started_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      finished_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check:
          "trigger_source IN ('admin', 'schedule', 'cli') AND status IN ('running', 'no_change', 'changes', 'failed') AND qa_local_count >= 0 AND qa_remote_count >= 0 AND errata_local_count >= 0 AND errata_remote_count >= 0",
      },
    },
  );
  pgm.createIndex('official_rulings_sync_runs', [{ name: 'started_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_official_rulings_sync_runs_started',
  });
};

export const down = false;
