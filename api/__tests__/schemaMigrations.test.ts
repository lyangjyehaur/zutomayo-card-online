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

  it('backfills the reward entitlement ledger for every existing grant', () => {
    const consistencyMigration = readRepoFile('migrations/000021_season_result_consistency.js');
    expect(consistencyMigration).toContain('SELECT season_id, user_id, reward_tier, reward_payload, granted_at');
    expect(consistencyMigration).not.toContain('WHERE claimed_at IS NOT NULL');
  });

  it('adopts schema artifacts created by the historical initSchema fallback', () => {
    const replayMigration = readRepoFile('migrations/000019_replay_metadata.js');
    const consistencyMigration = readRepoFile('migrations/000021_season_result_consistency.js');

    expect(replayMigration.match(/\{ ifNotExists: true \}/g)).toHaveLength(2);
    expect(consistencyMigration).toContain('DROP CONSTRAINT IF EXISTS fk_season_match_results_canonical_match');
  });

  it('adopts existing official English card fields before the append-only migration tightens nullability', () => {
    const initSchema = readRepoFile('api/server.cjs');
    const seedSchema = readRepoFile('scripts/seed-cards-pg.ts');
    const migration = readRepoFile('migrations/000025_card_official_english.js');
    for (const field of ['en_name_official', 'en_effect_official']) {
      expect(migration).toContain(`${field}: { type: 'text', default: '' }`);
      expect(initSchema).toContain(`${field} TEXT NOT NULL DEFAULT ''`);
      expect(seedSchema).toContain(`${field} TEXT NOT NULL DEFAULT ''`);
      expect(initSchema).toContain(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS ${field} TEXT NOT NULL DEFAULT ''`);
      expect(seedSchema).toContain(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS ${field} TEXT NOT NULL DEFAULT ''`);
    }
    expect(migration).toContain('{ ifNotExists: true }');
    expect(migration).toContain('export const down = false;');
    expect(migration).not.toContain('dropColumns');
  });

  it('keeps asynchronous account exports durable, fenced, and physically purgeable', () => {
    const migration = readRepoFile('migrations/000026_account_export_jobs.js');
    for (const artifact of [
      'account_export_jobs',
      'account_export_audit',
      'lease_token',
      'lease_expires_at',
      'object_version_id',
      'content_sha256',
      'purged_at',
      'idx_account_export_jobs_retention',
      'idx_account_export_audit_retention',
      'uq_account_export_audit_request_event',
      'uq_account_export_audit_request_terminal',
    ]) {
      expect(migration).toContain(artifact);
    }
    expect(migration).toContain('export const down = false;');
    expect(migration).toContain("onDelete: 'RESTRICT'");
    expect(migration).toContain('Compliance audit evidence must not cascade away');
    expect(migration).not.toMatch(/account_export_audit[\s\S]*user_id:[^\n]*onDelete: 'CASCADE'/);
  });

  it('makes every retained deletion audit surface explicitly anonymizable', () => {
    const migration = readRepoFile('migrations/000027_account_deletion_anonymization.js');
    const initSchema = readRepoFile('api/server.cjs');
    for (const artifact of [
      'season_match_results',
      'account_export_jobs',
      'account_export_audit',
      'admin_audit_log',
      'account_deletion_requests',
      'relationship_change_outbox',
      "pgm.addColumns('users'",
      'identity_anonymized_at',
      'identities_redacted_at',
      'idx_users_deleted_identity_pending',
      'idx_season_match_results_winner_user',
      'idx_season_match_results_loser_user',
      'idx_account_deletion_requests_user_all',
      'idx_relationship_change_outbox_user_ids',
      'idx_admin_audit_log_target_id',
      'idx_bjg_matches_updated_at',
      'idx_bjg_matches_game_name',
      "onDelete: 'SET NULL'",
    ]) {
      expect(migration).toContain(artifact);
    }
    expect(migration).toContain('ALTER COLUMN winner_user_id DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN loser_user_id DROP NOT NULL');
    expect(migration.match(/ALTER COLUMN user_id DROP NOT NULL/g)).toHaveLength(2);
    expect(migration).not.toContain('000027 requires a reviewed legacy tombstone backfill before migration');
    expect(initSchema).toContain('ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_anonymized_at TIMESTAMPTZ');
    expect(initSchema).toContain('idx_users_deleted_identity_pending');
    expect(migration).toContain('account export audit anonymization requires a deleted account');
    expect(migration).toContain('admin audit anonymization requires a deleted account');
    expect(migration).toContain('request_id = NULL');
    expect(migration.match(/details = '\{\}'::jsonb/g)).toHaveLength(2);
    expect(migration).toContain("COALESCE(p_replacement, '') !~");
    expect(migration).toContain('export const down = false;');
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
      'corrected_japanese_text',
      'corrected_english_text',
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

    expect(developmentRunner).toContain('ssl: postgresSslConfig(process.env)');
    for (const runner of [migrationRunner, developmentRunner]) {
      expect(runner).toContain('migrationOrderPolicyForApplied');
      expect(runner).toContain('checkOrder: migrationPolicy.checkOrder');
      expect(runner).toContain('assertOutOfOrderBackfillApplied');
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
    for (const migration of [cardTexts, errata, errataSource]) {
      expect(migration).toContain('export const down = false;');
    }
  });

  it('creates an irreversible signed official-card dataset ledger', () => {
    const migration = readRepoFile('migrations/000031_official_card_data_releases.js');

    for (const column of [
      'dataset_sha256',
      'extraction_sha256',
      'errata_sha256',
      'review_provenance_sha256',
      'release_sha',
      'card_count',
      'errata_count',
      'applied_at',
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain("dataset_sha256 ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("extraction_sha256 ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("errata_sha256 ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("review_provenance_sha256 ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("release_sha ~ '^[a-f0-9]{40}$'");
    expect(migration).toContain('card_count > 0');
    expect(migration).toContain('errata_count >= 0');
    expect(migration).toContain('errata_count <= card_count');
    expect(migration).toContain('export const down = false;');
  });

  it('keeps reviewed card-source validation in explicit local import workflows', () => {
    const officialImport = readRepoFile('scripts/import-card-official-texts-pg.ts');

    expect(officialImport).toContain('every printed English name/effect must be human-reviewed');
    expect(officialImport).toContain('official errata source must contain 12 unique cards');
    expect(officialImport).toContain('corrected Japanese does not match official card data');
  });
});
