'use strict';

const LEGACY_CARD_MIGRATIONS = Object.freeze([
  '000007_card_official_texts_i18n',
  '000008_card_official_errata',
  '000009_card_official_errata_english_source',
]);

const LEGACY_CARD_MIGRATION_IGNORE_PATTERN =
  '(?:000007_card_official_texts_i18n|000008_card_official_errata|000009_card_official_errata_english_source)\\.js';
const LEGACY_OFFICIAL_CARD_DATA_MIGRATION = '000031_official_card_data_releases';
const LEGACY_OFFICIAL_CARD_DATA_IGNORE_PATTERN = `${LEGACY_OFFICIAL_CARD_DATA_MIGRATION}\\.js`;
const DEFAULT_MIGRATION_IGNORE_PATTERN = `(?:${LEGACY_CARD_MIGRATION_IGNORE_PATTERN}|${LEGACY_OFFICIAL_CARD_DATA_IGNORE_PATTERN})`;

const PRE_CARD_HARDENING_BASELINE = Object.freeze([
  '000001_init_schema',
  '000002_chat_report_snapshots',
  '000003_platform_match_participants',
  '000004_platform_room_participants',
  '000005_chat_user_sanctions',
  '000006_user_friends',
  '000010_account_lifecycle',
  '000011_social_safety',
  '000012_seasons',
  '000013_admin_accounts',
  '000014_verified_platform_memberships',
  '000015_game_seats_result_outbox',
  '000016_trust_hardening',
  '000017_data_retention',
  '000018_season_operations',
]);

const DEFERRED_HARDENING_MIGRATIONS = Object.freeze([
  '000019_replay_metadata',
  '000020_schema_checksums',
  '000021_season_result_consistency',
  '000022_retention_hardening',
  '000023_account_deletion_saga',
  '000024_relationship_change_outbox',
  '000025_card_official_english',
  '000026_account_export_jobs',
  '000027_account_deletion_anonymization',
]);

const CANONICAL_CARD_MIGRATIONS = Object.freeze([
  '000028_card_official_texts_i18n',
  '000029_card_official_errata',
  '000030_card_official_errata_english_source',
]);
const ANNOUNCEMENTS_MIGRATION = '000032_announcements';
const ADMIN_LINKED_AUTH_MIGRATION = '000033_admin_linked_auth_contract';
const CARD_TEXT_AUTHORITY_MIGRATION = '000033_card_text_authority';

const KNOWN_OUT_OF_ORDER_HISTORY = new Set([
  ...PRE_CARD_HARDENING_BASELINE,
  ...LEGACY_CARD_MIGRATIONS,
  ...DEFERRED_HARDENING_MIGRATIONS,
  ...CANONICAL_CARD_MIGRATIONS,
  LEGACY_OFFICIAL_CARD_DATA_MIGRATION,
  '000031_user_linked_admins',
  ANNOUNCEMENTS_MIGRATION,
  '000032_official_card_data_releases',
  ADMIN_LINKED_AUTH_MIGRATION,
  CARD_TEXT_AUTHORITY_MIGRATION,
]);

function migrationIgnorePatternForApplied(appliedNames) {
  const applied = new Set(Array.isArray(appliedNames) ? appliedNames : []);
  const ignorePatterns = [];
  if (!LEGACY_CARD_MIGRATIONS.some((name) => applied.has(name))) {
    ignorePatterns.push(LEGACY_CARD_MIGRATION_IGNORE_PATTERN);
  }
  if (!applied.has(LEGACY_OFFICIAL_CARD_DATA_MIGRATION)) {
    ignorePatterns.push(LEGACY_OFFICIAL_CARD_DATA_IGNORE_PATTERN);
  }
  if (ignorePatterns.length === 0) return undefined;
  if (ignorePatterns.length === 2) return DEFAULT_MIGRATION_IGNORE_PATTERN;
  return ignorePatterns[0];
}

/**
 * `000028`-`000030` shipped on master before deferred hardening assigned
 * `000019`-`000027`. A database that followed that exact lineage must apply
 * the missing hardening migrations once, even though their numbers precede
 * an already-applied card migration. Master later shipped announcements as
 * `000032_announcements`; existing P0-P5 histories may likewise need to apply
 * that file after `000032_official_card_data_releases`/`000033`. Master then
 * shipped card-text authority under the same numeric prefix as the deferred
 * admin auth contract; the full names remain unique, so authority-first
 * databases may backfill the admin contract once. These reviewed lineages are
 * normalized once; every other lineage fails closed.
 */
function migrationOrderPolicyForApplied(appliedNames) {
  const names = Array.isArray(appliedNames) ? appliedNames.map(String) : [];
  const applied = new Set(names);
  const ignorePattern = migrationIgnorePatternForApplied(names);
  const appliedCanonical = CANONICAL_CARD_MIGRATIONS.filter((name) => applied.has(name));
  const missingHardening = DEFERRED_HARDENING_MIGRATIONS.filter((name) => !applied.has(name));
  const firstCanonicalIndex = names.findIndex((name) => CANONICAL_CARD_MIGRATIONS.includes(name));
  const requiresAnnouncementBackfill =
    !applied.has(ANNOUNCEMENTS_MIGRATION) && names.some((name) => name.localeCompare(ANNOUNCEMENTS_MIGRATION) > 0);
  const requiresAdminAuthBackfill =
    applied.has(CARD_TEXT_AUTHORITY_MIGRATION) && !applied.has(ADMIN_LINKED_AUTH_MIGRATION);
  const requiresOrderNormalization =
    requiresAnnouncementBackfill ||
    requiresAdminAuthBackfill ||
    (firstCanonicalIndex >= 0 &&
      names.some((name, index) => index > firstCanonicalIndex && DEFERRED_HARDENING_MIGRATIONS.includes(name)));

  if (appliedCanonical.length === 0 || (missingHardening.length === 0 && !requiresOrderNormalization)) {
    return { ignorePattern, checkOrder: true, outOfOrderBackfill: [], normalizeOrder: false };
  }

  const expectedCanonicalPrefix = CANONICAL_CARD_MIGRATIONS.slice(0, appliedCanonical.length);
  if (JSON.stringify(appliedCanonical) !== JSON.stringify(expectedCanonicalPrefix)) {
    throw new Error(
      `Refusing migration order compatibility for a non-prefix canonical card history: ${appliedCanonical.join(', ')}`,
    );
  }

  const missingBaseline = PRE_CARD_HARDENING_BASELINE.filter((name) => !applied.has(name));
  if (missingBaseline.length > 0) {
    throw new Error(
      `Refusing migration order compatibility because the required pre-card baseline is incomplete: ${missingBaseline.join(', ')}`,
    );
  }

  const unknownApplied = names.filter((name) => !KNOWN_OUT_OF_ORDER_HISTORY.has(name));
  if (unknownApplied.length > 0) {
    throw new Error(
      `Refusing migration order compatibility for unknown applied migrations: ${[...new Set(unknownApplied)].join(', ')}`,
    );
  }

  return {
    ignorePattern,
    checkOrder: false,
    outOfOrderBackfill: missingHardening,
    normalizeOrder: true,
  };
}

function assertOutOfOrderBackfillApplied(requiredNames, appliedNames) {
  const applied = new Set(Array.isArray(appliedNames) ? appliedNames.map(String) : []);
  const missing = (Array.isArray(requiredNames) ? requiredNames : []).filter((name) => !applied.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Migration order compatibility did not apply the required hardening migrations: ${missing.join(', ')}`,
    );
  }
}

function assertAppliedMigrationOrder(appliedNames) {
  const names = Array.isArray(appliedNames) ? appliedNames.map(String) : [];
  const expected = [...names].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error('Applied migration metadata is not in canonical filename order');
  }
}

async function normalizeAppliedMigrationOrder(pool) {
  await pool.query(`
    BEGIN;
    LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE;
    WITH desired AS (
      SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY name)::integer AS new_id,
        MIN(run_on) OVER () AS anchor_run_on
        FROM public.schema_migrations
    )
    UPDATE public.schema_migrations AS migration
       SET id = -desired.new_id,
           run_on = desired.anchor_run_on + ((desired.new_id - 1) * INTERVAL '1 microsecond')
      FROM desired
     WHERE migration.id = desired.id;
    UPDATE public.schema_migrations SET id = -id;
    SELECT setval(
      pg_get_serial_sequence('public.schema_migrations', 'id'),
      GREATEST((SELECT MAX(id) FROM public.schema_migrations), 1),
      TRUE
    );
    COMMIT;
  `);
}

async function listAppliedMigrationNames(pool) {
  const table = await pool.query("SELECT to_regclass('public.schema_migrations') AS name");
  if (!table.rows[0]?.name) return [];
  // Match node-pg-migrate's own history ordering exactly.
  const result = await pool.query('SELECT name FROM public.schema_migrations ORDER BY run_on, id');
  return result.rows.map((row) => String(row.name || '')).filter(Boolean);
}

module.exports = {
  ADMIN_LINKED_AUTH_MIGRATION,
  ANNOUNCEMENTS_MIGRATION,
  CARD_TEXT_AUTHORITY_MIGRATION,
  CANONICAL_CARD_MIGRATIONS,
  DEFAULT_MIGRATION_IGNORE_PATTERN,
  DEFERRED_HARDENING_MIGRATIONS,
  LEGACY_CARD_MIGRATIONS,
  LEGACY_CARD_MIGRATION_IGNORE_PATTERN,
  LEGACY_OFFICIAL_CARD_DATA_IGNORE_PATTERN,
  LEGACY_OFFICIAL_CARD_DATA_MIGRATION,
  PRE_CARD_HARDENING_BASELINE,
  assertAppliedMigrationOrder,
  assertOutOfOrderBackfillApplied,
  listAppliedMigrationNames,
  migrationIgnorePatternForApplied,
  migrationOrderPolicyForApplied,
  normalizeAppliedMigrationOrder,
};
