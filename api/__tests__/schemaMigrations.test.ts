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
});
