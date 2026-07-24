/** Versioned official Grand Rules and Floor Rules documents. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'official_rule_documents',
    {
      document_id: { type: 'text', notNull: true },
      document_version: { type: 'text', notNull: true },
      title_ja: { type: 'text', notNull: true },
      summary_ja: { type: 'text', notNull: true },
      published_at: { type: 'date', notNull: true },
      source_url: { type: 'text', notNull: true },
      source_sha256: { type: 'text', notNull: true },
      source_page_count: { type: 'integer', notNull: true },
      content_hash: { type: 'text', notNull: true },
      publication_status: { type: 'text', notNull: true, default: 'candidate' },
      source_checked_at: { type: 'timestamptz', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      constraints: {
        primaryKey: ['document_id', 'document_version'],
        check:
          "document_id IN ('grand', 'floor') AND document_version <> '' AND title_ja <> '' AND summary_ja <> '' AND source_url ~ '^https://' AND source_sha256 ~ '^[a-f0-9]{64}$' AND content_hash ~ '^[a-f0-9]{64}$' AND source_page_count > 0 AND publication_status IN ('candidate', 'active', 'superseded')",
      },
    },
  );

  pgm.createTable(
    'official_rule_sections',
    {
      document_id: { type: 'text', notNull: true },
      document_version: { type: 'text', notNull: true },
      section_id: { type: 'text', notNull: true },
      section_number: { type: 'text', notNull: true, default: '' },
      parent_section_id: { type: 'text' },
      level: { type: 'integer', notNull: true },
      sort_order: { type: 'integer', notNull: true },
      page_start: { type: 'integer', notNull: true },
      page_end: { type: 'integer', notNull: true },
      title_ja: { type: 'text', notNull: true },
      body_ja: { type: 'text', notNull: true },
      content_hash: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      constraints: {
        primaryKey: ['document_id', 'document_version', 'section_id'],
        foreignKeys: {
          columns: ['document_id', 'document_version'],
          references: 'official_rule_documents(document_id, document_version)',
          onDelete: 'CASCADE',
        },
        check:
          "section_id <> '' AND level BETWEEN 1 AND 4 AND sort_order >= 0 AND page_start > 0 AND page_end >= page_start AND title_ja <> '' AND body_ja <> '' AND content_hash ~ '^[a-f0-9]{64}$'",
      },
    },
  );
  pgm.createIndex('official_rule_sections', ['document_id', 'document_version', 'sort_order'], {
    name: 'idx_official_rule_sections_order',
  });

  pgm.createTable(
    'official_rule_section_translations',
    {
      document_id: { type: 'text', notNull: true },
      document_version: { type: 'text', notNull: true },
      section_id: { type: 'text', notNull: true },
      locale: { type: 'text', notNull: true },
      title_text: { type: 'text', notNull: true },
      body_text: { type: 'text', notNull: true },
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
      constraints: {
        primaryKey: ['document_id', 'document_version', 'section_id', 'locale'],
        foreignKeys: {
          columns: ['document_id', 'document_version', 'section_id'],
          references: 'official_rule_sections(document_id, document_version, section_id)',
          onDelete: 'CASCADE',
        },
        check:
          "locale IN ('zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko') AND title_text <> '' AND body_text <> '' AND status IN ('pending_review', 'machine', 'verified', 'failed')",
      },
    },
  );
  pgm.createIndex('official_rule_section_translations', ['locale', 'status'], {
    name: 'idx_official_rule_section_translations_locale_status',
  });

  pgm.createTable(
    'official_rule_active_versions',
    {
      document_id: { type: 'text', primaryKey: true },
      document_version: { type: 'text', notNull: true },
      activated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      constraints: {
        foreignKeys: {
          columns: ['document_id', 'document_version'],
          references: 'official_rule_documents(document_id, document_version)',
          onDelete: 'RESTRICT',
        },
        check: "document_id IN ('grand', 'floor')",
      },
    },
  );
};

export const down = false;
