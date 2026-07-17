/** Public announcements with versioned LLM translation cache. */
export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable(
    'announcements',
    {
      id: { type: 'text', primaryKey: true },
      title: { type: 'text', notNull: true },
      content: { type: 'text', notNull: true },
      source_language: { type: 'text', notNull: true, default: 'zh-tw' },
      status: { type: 'text', notNull: true, default: 'draft' },
      content_version: { type: 'integer', notNull: true, default: 1 },
      published_at: { type: 'timestamptz' },
      expires_at: { type: 'timestamptz' },
      created_by_user_id: { type: 'text' },
      updated_by_user_id: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        check: "status IN ('draft', 'published', 'archived') AND content_version > 0",
      },
    },
  );
  pgm.createIndex('announcements', ['status', { name: 'published_at', sort: 'DESC' }], {
    ifNotExists: true,
    name: 'idx_announcements_publication',
  });

  pgm.createTable(
    'announcement_translations',
    {
      announcement_id: {
        type: 'text',
        notNull: true,
        references: 'announcements(id)',
        onDelete: 'CASCADE',
      },
      content_version: { type: 'integer', notNull: true },
      target_language: { type: 'text', notNull: true },
      translated_title: { type: 'text', notNull: true, default: '' },
      translated_content: { type: 'text', notNull: true, default: '' },
      provider: { type: 'text', notNull: true, default: '' },
      model: { type: 'text', notNull: true, default: '' },
      status: { type: 'text', notNull: true, default: 'ready' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['announcement_id', 'content_version', 'target_language'],
        check: "status IN ('pending', 'ready')",
      },
    },
  );
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('announcement_translations', { ifExists: true, cascade: true });
  pgm.dropTable('announcements', { ifExists: true, cascade: true });
};
