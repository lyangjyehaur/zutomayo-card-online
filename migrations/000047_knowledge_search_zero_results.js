/** Aggregate privacy-filtered public search queries that returned no results. */

export const shorthands = undefined;

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable('knowledge_search_zero_results', {
    id: { type: 'text', primaryKey: true },
    normalized_query: { type: 'text', notNull: true },
    locale: { type: 'text', notNull: true },
    scope: { type: 'text', notNull: true },
    occurrence_count: { type: 'bigint', notNull: true, default: 1 },
    first_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.addConstraint('knowledge_search_zero_results', 'knowledge_search_zero_results_query_check', {
    check: "normalized_query <> '' AND char_length(normalized_query) <= 120",
  });
  pgm.addConstraint('knowledge_search_zero_results', 'knowledge_search_zero_results_id_check', {
    check: "id ~ '^[0-9a-f]{64}$'",
  });
  pgm.addConstraint('knowledge_search_zero_results', 'knowledge_search_zero_results_locale_check', {
    check: "locale IN ('ja', 'zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko')",
  });
  pgm.addConstraint('knowledge_search_zero_results', 'knowledge_search_zero_results_scope_check', {
    check: "scope IN ('all', 'card', 'qa', 'rule', 'errata', 'deck')",
  });
  pgm.addConstraint('knowledge_search_zero_results', 'knowledge_search_zero_results_count_check', {
    check: 'occurrence_count > 0',
  });
  pgm.createIndex('knowledge_search_zero_results', [{ name: 'last_seen_at', sort: 'DESC' }], {
    name: 'idx_knowledge_search_zero_results_last_seen',
  });
  pgm.createIndex(
    'knowledge_search_zero_results',
    [
      { name: 'occurrence_count', sort: 'DESC' },
      { name: 'last_seen_at', sort: 'DESC' },
    ],
    { name: 'idx_knowledge_search_zero_results_popular' },
  );
};

export const down = false;
