/** Atomic, verifiable official-rulings content releases. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable('official_rulings_releases', {
    id: { type: 'text', primaryKey: true },
    source_hash: { type: 'text', notNull: true },
    translation_hash: { type: 'text', notNull: true },
    card_dataset_hash: { type: 'text', notNull: true },
    qa_count: { type: 'integer', notNull: true },
    errata_count: { type: 'integer', notNull: true },
    locale_count: { type: 'integer', notNull: true },
    locales: { type: 'text[]', notNull: true },
    app_version: { type: 'text', notNull: true },
    build_id: { type: 'text', notNull: true },
    translation_source_generated_at: { type: 'timestamptz', notNull: true },
    source_checked_at: { type: 'timestamptz', notNull: true },
    status: { type: 'text', notNull: true, default: 'candidate' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    activated_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('official_rulings_releases', 'official_rulings_releases_integrity', {
    check:
      "source_hash ~ '^[a-f0-9]{64}$' AND translation_hash ~ '^[a-f0-9]{64}$' AND card_dataset_hash ~ '^[a-f0-9]{64}$' AND qa_count > 0 AND errata_count > 0 AND locale_count = 5 AND cardinality(locales) = 5 AND status IN ('candidate', 'active', 'superseded')",
  });

  pgm.createTable(
    'official_rulings_release_qa',
    {
      release_id: {
        type: 'text',
        notNull: true,
        references: 'official_rulings_releases(id)',
        onDelete: 'CASCADE',
      },
      qa_id: { type: 'text', notNull: true, references: 'official_qa_items(id)', onDelete: 'RESTRICT' },
      content_version: { type: 'integer', notNull: true },
      content_hash: { type: 'text', notNull: true },
      number: { type: 'integer', notNull: true },
      published_at: { type: 'date', notNull: true },
      question_ja: { type: 'text', notNull: true },
      answer_ja: { type: 'text', notNull: true },
      tags: { type: 'text[]', notNull: true },
      related_card_ids: { type: 'text[]', notNull: true },
      source_url: { type: 'text', notNull: true },
      last_seen_at: { type: 'timestamptz', notNull: true },
    },
    { constraints: { primaryKey: ['release_id', 'qa_id'] } },
  );

  pgm.createTable(
    'official_rulings_release_errata',
    {
      release_id: {
        type: 'text',
        notNull: true,
        references: 'official_rulings_releases(id)',
        onDelete: 'CASCADE',
      },
      errata_id: {
        type: 'text',
        notNull: true,
        references: 'card_official_errata(errata_id)',
        onDelete: 'RESTRICT',
      },
      content_version: { type: 'integer', notNull: true },
      content_hash: { type: 'text', notNull: true },
      card_id: { type: 'text', notNull: true, references: 'cards(id)', onDelete: 'RESTRICT' },
      published_at: { type: 'date', notNull: true },
      card_number: { type: 'text', notNull: true },
      incorrect_text: { type: 'text', notNull: true },
      corrected_japanese_text: { type: 'text', notNull: true },
      reason_ja: { type: 'text', notNull: true },
      replacement_policy_ja: { type: 'text', notNull: true },
      usage_policy_ja: { type: 'text', notNull: true },
      affects_name: { type: 'boolean', notNull: true },
      affects_effect: { type: 'boolean', notNull: true },
      source_url: { type: 'text', notNull: true },
      last_seen_at: { type: 'timestamptz', notNull: true },
    },
    { constraints: { primaryKey: ['release_id', 'errata_id'] } },
  );

  pgm.createTable('official_rulings_active_release', {
    key: { type: 'text', primaryKey: true, default: 'active' },
    release_id: {
      type: 'text',
      notNull: true,
      references: 'official_rulings_releases(id)',
      onDelete: 'RESTRICT',
    },
    activated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.addConstraint('official_rulings_active_release', 'official_rulings_active_release_singleton', {
    check: "key = 'active'",
  });
};

export const down = false;
