/** Persist reviewed, explainable card synergy groups and directional relations. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'card_synergy_groups',
    {
      id: { type: 'text', primaryKey: true },
      title: { type: 'text', notNull: true },
      primary_category: { type: 'text', notNull: true },
      rationale_ja: { type: 'text', notNull: true },
      rationale_i18n: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      evidence: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
      review_status: { type: 'text', notNull: true, default: 'candidate' },
      recommendation_eligible: { type: 'boolean', notNull: true, default: false },
      source_version: { type: 'text', notNull: true },
      rules_version: { type: 'text', notNull: true },
      reviewed_by_user_id: { type: 'text' },
      reviewed_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      constraints: {
        check:
          "id <> '' AND title <> '' AND rationale_ja <> '' AND source_version <> '' AND rules_version <> '' AND review_status IN ('candidate', 'approved', 'rejected', 'needs_changes')",
      },
    },
  );

  pgm.createTable(
    'card_synergy_relations',
    {
      id: { type: 'text', primaryKey: true },
      group_id: { type: 'text', references: 'card_synergy_groups', onDelete: 'SET NULL' },
      source_card_id: { type: 'text', notNull: true, references: 'cards', onDelete: 'CASCADE' },
      target_card_id: { type: 'text', notNull: true, references: 'cards', onDelete: 'CASCADE' },
      kind: { type: 'text', notNull: true },
      primary_category: { type: 'text', notNull: true },
      categories: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
      confidence: { type: 'text', notNull: true },
      score: { type: 'integer', notNull: true },
      rationale_ja: { type: 'text', notNull: true },
      rationale_i18n: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      evidence: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
      review_status: { type: 'text', notNull: true, default: 'candidate' },
      recommendation_eligible: { type: 'boolean', notNull: true, default: false },
      source_version: { type: 'text', notNull: true },
      rules_version: { type: 'text', notNull: true },
      reviewed_by_user_id: { type: 'text' },
      reviewed_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      constraints: {
        unique: ['source_card_id', 'target_card_id', 'kind', 'primary_category', 'source_version'],
        check:
          "id <> '' AND source_card_id <> target_card_id AND kind IN ('enables', 'conflicts') AND confidence IN ('high', 'medium', 'low') AND score BETWEEN -1000 AND 1000 AND rationale_ja <> '' AND source_version <> '' AND rules_version <> '' AND review_status IN ('candidate', 'approved', 'rejected', 'needs_changes')",
      },
    },
  );
  pgm.createIndex('card_synergy_relations', ['source_card_id', 'review_status', 'recommendation_eligible'], {
    name: 'idx_card_synergy_recommendations',
  });
  pgm.createIndex('card_synergy_relations', ['primary_category', 'confidence', 'review_status'], {
    name: 'idx_card_synergy_review_queue',
  });
};

export const down = false;
