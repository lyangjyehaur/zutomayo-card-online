import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repoRoot = new URL('../..', import.meta.url);

function readRepoFile(path: string): string {
  return readFileSync(new URL(path, `${repoRoot.href}/`), 'utf8');
}

function readMigrations(): string {
  const migrationsDir = new URL('migrations/', `${repoRoot.href}/`);
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .map((file) => readFileSync(new URL(file, migrationsDir), 'utf8'))
    .join('\n');
}

describe('schema migrations', () => {
  it('keeps durable chat and platform evidence schema aligned with initSchema fallback', () => {
    const initSchema = readRepoFile('api/server.cjs');
    const migrations = readMigrations();
    const durableArtifacts = [
      'platform_match_participants',
      'platform_room_participants',
      'chat_conversations',
      'chat_messages',
      'chat_message_translations',
      'chat_read_states',
      'chat_reports',
      'chat_moderation_events',
      'chat_user_sanctions',
      'target_user_id',
      'source_report_id',
      'source_message_id',
      'conversation_id',
      'revoked_at',
      'revocation_reason',
      'idx_chat_user_sanctions_target_active',
    ];

    for (const artifact of durableArtifacts) {
      expect(initSchema, `initSchema fallback missing ${artifact}`).toContain(artifact);
      expect(migrations, `migrations missing ${artifact}`).toContain(artifact);
    }

    for (const artifact of ['bjg_matches', 'bjg_match_seats', 'bjg_match_result_outbox']) {
      expect(migrations, `migrations missing game trust-chain table ${artifact}`).toContain(artifact);
    }
    expect(migrations).toContain('rules_version');
    for (const artifact of [
      'completed_at',
      'settling_at',
      'season_reward_entitlements',
      'uq_season_match_results_source',
      'action_log_purged_at',
      'anonymized_at',
      'retention_anonymized_at',
      'legal_hold_objects',
      'account_deletion_requests',
      'provider_deleting',
      'provider_deleted',
      'relationship_change_outbox',
      'dead_letter',
    ]) {
      expect(migrations, `migrations missing season consistency artifact ${artifact}`).toContain(artifact);
    }
    expect(initSchema).toContain("rules_version TEXT NOT NULL DEFAULT 'legacy'");
    expect(initSchema, 'initSchema fallback missing verified chat membership column').toContain('access_verified');
  });

  it('links administrator roles to signed-in user accounts', () => {
    const migration = readRepoFile('migrations/000031_user_linked_admins.js');
    const schemaGate = readRepoFile('api/schemaGate.cjs');
    const linkScript = readRepoFile('scripts/link-admin-user.cjs');

    expect(migration).toContain("references: 'users(id)'");
    expect(migration).toContain("name: 'uq_admin_users_user_id'");
    expect(schemaGate).toContain("admin_users: ['id', 'user_id', 'username', 'role', 'disabled_at']");
    expect(linkScript).toContain('ON CONFLICT (user_id)');
    expect(linkScript).toContain('DELETE FROM admin_users WHERE user_id = $1 RETURNING id');
  });

  it('stores versioned announcement translations separately from source content', () => {
    const migration = readRepoFile('migrations/000032_announcements.js');
    const schemaGate = readRepoFile('api/schemaGate.cjs');

    expect(migration).toContain("'announcements',");
    expect(migration).toContain("'announcement_translations',");
    expect(migration).toContain("primaryKey: ['announcement_id', 'content_version', 'target_language']");
    expect(schemaGate).toContain("'announcement_translations'");
  });

  it('keeps guarded deck-sharing schema aligned with the development fallback', () => {
    const migration = readRepoFile('migrations/000038_deck_sharing.js');
    const initSchema = readRepoFile('api/server.cjs');
    const schemaGate = readRepoFile('api/schemaGate.cjs');
    for (const artifact of [
      'deck_shares',
      'deck_share_likes',
      'deck_share_copy_events',
      'deck_share_reports',
      'uq_deck_shares_source_deck',
      'idx_deck_shares_public_lobby',
      'uq_deck_share_copy_events_idempotency',
      'uq_deck_share_reports_active_reporter',
    ]) {
      expect(migration, `migration missing ${artifact}`).toContain(artifact);
      expect(initSchema, `initSchema fallback missing ${artifact}`).toContain(artifact);
      expect(schemaGate, `schema gate missing ${artifact}`).toContain(artifact);
    }
    expect(migration).toContain("onDelete: 'SET NULL'");
    expect(migration).toContain("visibility IN ('public', 'unlisted')");
    expect(initSchema).toContain('requireDeckSharing: DECK_SHARING_ENABLED');
  });

  it('stores versioned official Q&A and errata translations separately from Japanese source content', () => {
    const migration = readRepoFile('migrations/000039_official_rulings.js');
    const schemaGate = readRepoFile('api/schemaGate.cjs');
    const initSchema = readRepoFile('api/server.cjs');

    for (const artifact of [
      'official_qa_items',
      'official_qa_translations',
      'card_official_errata_translations',
      'official_rulings_sync_runs',
      'content_version',
      'publication_status',
      'replacement_policy_ja',
      'usage_policy_ja',
    ]) {
      expect(migration).toContain(artifact);
      expect(schemaGate).toContain(artifact);
      expect(initSchema).toContain(artifact);
    }
    expect(migration).toContain("primaryKey: ['qa_id', 'content_version', 'locale']");
    expect(migration).toContain("primaryKey: ['errata_id', 'content_version', 'locale']");
    expect(migration).toContain("status IN ('running', 'no_change', 'changes', 'failed')");
    expect(migration).toContain('export const down = false');
  });

  it('gates official rulings behind an atomic active release manifest', () => {
    const migration = readRepoFile('migrations/000040_official_rulings_releases.js');
    const schemaGate = readRepoFile('api/schemaGate.cjs');
    const initSchema = readRepoFile('api/server.cjs');
    for (const artifact of [
      'official_rulings_releases',
      'official_rulings_release_qa',
      'official_rulings_release_errata',
      'official_rulings_active_release',
      'card_dataset_hash',
      'translation_hash',
    ]) {
      expect(migration).toContain(artifact);
      expect(schemaGate).toContain(artifact);
      expect(initSchema).toContain(artifact);
    }
    expect(migration).toContain("status IN ('candidate', 'active', 'superseded')");
    expect(migration).toContain('export const down = false');
  });

  it('backfills the reward entitlement ledger for every existing grant', () => {
    const consistencyMigration = readRepoFile('migrations/000021_season_result_consistency.js');
    expect(consistencyMigration).toContain('SELECT season_id, user_id, reward_tier, reward_payload, granted_at');
    expect(consistencyMigration).not.toContain('WHERE claimed_at IS NOT NULL');
  });

  it('keeps official and localized card text schema aligned with initSchema fallback', () => {
    const initSchema = readRepoFile('api/server.cjs');
    const migrations = readMigrations();
    const cardTextArtifacts = [
      'en_name_official',
      'en_effect_official',
      'card_texts_i18n',
      'name_text',
      'effect_text',
      'name_source',
      'effect_source',
      'review_status',
      'review_note',
      'idx_card_texts_i18n_lang_review',
      'has_official_errata',
      'official_errata_id',
      'official_errata_affects_name',
      'official_errata_affects_effect',
      'official_errata_url',
      'card_official_errata',
      'corrected_english_status',
      'corrected_english_source',
      'idx_cards_has_official_errata',
    ];

    for (const artifact of cardTextArtifacts) {
      expect(initSchema, `initSchema fallback missing ${artifact}`).toContain(artifact);
      expect(migrations, `migrations missing ${artifact}`).toContain(artifact);
    }
  });

  it('appends the canonical card migrations without invalidating existing P0-P5 histories', () => {
    const migrationRunner = readRepoFile('scripts/db-migrate.cjs');
    const developmentRunner = readRepoFile('api/server.cjs');
    const compatibility = readRepoFile('scripts/migration-order-compat.cjs');
    const cardTexts = readRepoFile('migrations/000028_card_official_texts_i18n.js');
    const errata = readRepoFile('migrations/000029_card_official_errata.js');
    const errataSource = readRepoFile('migrations/000030_card_official_errata_english_source.js');
    const authority = readRepoFile('migrations/000033_card_text_authority.js');
    const rollbackCompatibility = readRepoFile('migrations/000034_card_text_rollback_compat.js');
    const removeRollbackCompatibility = readRepoFile('migrations/000035_remove_card_text_rollback_compat.js');
    const hardenedI18nContract = readRepoFile('migrations/000036_harden_card_i18n_contract.js');

    expect(migrationRunner).toContain('migrationIgnorePatternForApplied');
    expect(developmentRunner).toContain('migrationIgnorePatternForApplied');
    expect(developmentRunner).toContain('ignorePattern,');
    expect(developmentRunner).toContain('ssl: postgresSslConfig(process.env)');
    for (const runner of [migrationRunner, developmentRunner]) {
      expect(runner).toContain('checkOrder: true');
    }
    for (const legacyName of [
      '000007_card_official_texts_i18n',
      '000008_card_official_errata',
      '000009_card_official_errata_english_source',
    ]) {
      expect(compatibility).toContain(legacyName);
    }
    expect(cardTexts).toContain('ALTER COLUMN en_name_official SET NOT NULL');
    expect(cardTexts).toContain('ALTER COLUMN en_effect_official SET NOT NULL');
    expect(cardTexts.match(/ON CONFLICT \(card_id, lang\) DO NOTHING/g)).toHaveLength(3);
    expect(cardTexts).not.toMatch(/ON CONFLICT \(card_id, lang\) DO UPDATE/);
    expect(errata).toContain('card_official_errata');
    expect(errataSource).toContain('card_official_errata_english_source_check');
    expect(authority).toContain("DELETE FROM card_texts_i18n WHERE lang IN ('ja', 'en')");
    expect(authority).toContain('DROP TABLE IF EXISTS card_effects_i18n');
    expect(authority).toContain('DROP COLUMN IF EXISTS corrected_japanese_text');
    expect(authority).toContain("CHECK (lang NOT IN ('ja', 'en'))");
    expect(rollbackCompatibility).toContain('CREATE VIEW card_effects_i18n');
    expect(rollbackCompatibility).toContain('card_official_errata_no_corrected_text_cache');
    expect(rollbackCompatibility).toContain('corrected_japanese_text IS NULL');
    expect(removeRollbackCompatibility).toContain('DROP VIEW IF EXISTS card_effects_i18n');
    expect(removeRollbackCompatibility).toContain('DROP COLUMN IF EXISTS corrected_japanese_text');
    expect(removeRollbackCompatibility).toContain('DROP COLUMN IF EXISTS corrected_english_text');
    expect(hardenedI18nContract).toContain("lang IN ('zh-TW', 'zh-CN', 'zh-HK', 'ko')");
    expect(hardenedI18nContract).toContain("review_status IN ('verified', 'pending_review')");
    expect(hardenedI18nContract).toContain('resolve data before migration 000036');
    for (const migration of [
      cardTexts,
      errata,
      errataSource,
      authority,
      rollbackCompatibility,
      removeRollbackCompatibility,
      hardenedI18nContract,
    ]) {
      expect(migration).toContain('export const down = false;');
    }
  });

  it('keeps reviewed card-source validation in explicit local import workflows', () => {
    const officialImport = readRepoFile('scripts/import-card-official-texts-pg.ts');
    const derivedImport = readRepoFile('scripts/import-card-derived-effects-pg.ts');
    const derivedAudit = readRepoFile('scripts/cardDerivedEffects.ts');

    expect(officialImport).toContain('every printed English name/effect must be human-reviewed');
    expect(officialImport).toContain('official errata source must contain 12 unique cards');
    expect(officialImport).toContain('corrected Japanese does not match official card data');
    expect(derivedImport).toContain('PostgreSQL English effect differs from the effective official text');
    expect(derivedAudit).toContain('legacy en is forbidden');
  });
});
