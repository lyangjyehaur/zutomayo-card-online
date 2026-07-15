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

  it('adopts existing official English card fields without a destructive rollback', () => {
    const initSchema = readRepoFile('api/server.cjs');
    const seedSchema = readRepoFile('scripts/seed-cards-pg.ts');
    const migration = readRepoFile('migrations/000025_card_official_english.js');
    for (const field of ['en_name_official', 'en_effect_official']) {
      expect(migration).toContain(`${field}: { type: 'text', default: '' }`);
      expect(initSchema).toContain(`${field} TEXT DEFAULT ''`);
      expect(seedSchema).toContain(`${field} TEXT DEFAULT ''`);
      expect(initSchema).toContain(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS ${field} TEXT DEFAULT ''`);
      expect(seedSchema).toContain(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS ${field} TEXT DEFAULT ''`);
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
    for (const artifact of [
      'season_match_results',
      'account_export_jobs',
      'account_export_audit',
      'admin_audit_log',
      'account_deletion_requests',
      'relationship_change_outbox',
      'identity_anonymized_at',
      'identities_redacted_at',
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
    expect(migration).toContain('reviewed legacy tombstone backfill');
    expect(migration).toContain('account export audit anonymization requires a deleted account');
    expect(migration).toContain('admin audit anonymization requires a deleted account');
    expect(migration).toContain('request_id = NULL');
    expect(migration.match(/details = '\{\}'::jsonb/g)).toHaveLength(2);
    expect(migration).toContain("COALESCE(p_replacement, '') !~");
    expect(migration).toContain('export const down = false;');
  });
});
