'use strict';

const LEGACY_CARD_MIGRATIONS = Object.freeze([
  '000007_card_official_texts_i18n',
  '000008_card_official_errata',
  '000009_card_official_errata_english_source',
]);

const LEGACY_CARD_MIGRATION_IGNORE_PATTERN =
  '(?:000007_card_official_texts_i18n|000008_card_official_errata|000009_card_official_errata_english_source)\\.js';

function migrationIgnorePatternForApplied(appliedNames) {
  const applied = new Set(Array.isArray(appliedNames) ? appliedNames : []);
  return LEGACY_CARD_MIGRATIONS.some((name) => applied.has(name)) ? undefined : LEGACY_CARD_MIGRATION_IGNORE_PATTERN;
}

async function listAppliedMigrationNames(pool) {
  const table = await pool.query("SELECT to_regclass('public.schema_migrations') AS name");
  if (!table.rows[0]?.name) return [];
  const result = await pool.query('SELECT name FROM public.schema_migrations');
  return result.rows.map((row) => String(row.name || '')).filter(Boolean);
}

module.exports = {
  LEGACY_CARD_MIGRATIONS,
  LEGACY_CARD_MIGRATION_IGNORE_PATTERN,
  listAppliedMigrationNames,
  migrationIgnorePatternForApplied,
};
