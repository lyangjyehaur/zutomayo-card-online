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
    for (const migration of [cardTexts, errata, errataSource]) {
      expect(migration).toContain('export const down = false;');
    }
  });

  it('tracks all 12 official errata against the corrected Japanese card source', () => {
    const errata = JSON.parse(readRepoFile('data/card-official-errata.json')) as {
      errata: Array<{
        errataId: string;
        cardId: string;
        fields: Array<'name' | 'effect'>;
        correctedJapaneseText: string;
        correctedEnglishText: string;
        correctedEnglishStatus: string;
        correctedEnglishSource: string;
      }>;
    };
    const extraction = JSON.parse(readRepoFile('data/card-english-extraction.json')) as {
      cards: Array<{ id: string; japaneseName: string; japaneseEffect: string; enEffectOfficial: string }>;
    };
    const cardsById = new Map(extraction.cards.map((card) => [card.id, card]));

    expect(errata.errata).toHaveLength(12);
    expect(new Set(errata.errata.map((entry) => entry.cardId)).size).toBe(12);
    for (const entry of errata.errata) {
      const card = cardsById.get(entry.cardId);
      expect(card, `missing ${entry.cardId}`).toBeDefined();
      expect(entry.correctedJapaneseText).toBe(
        entry.fields.includes('name') ? card?.japaneseName : card?.japaneseEffect,
      );
    }
    expect(errata.errata.find((entry) => entry.cardId === '3rd_31')?.correctedEnglishText).toContain(
      'regardless of its Power',
    );
    expect(errata.errata.find((entry) => entry.cardId === '4th_76')?.correctedEnglishText).toBe(
      'GUREKUMA-KUN (Pain Give Form)',
    );
    expect(errata.errata.find((entry) => entry.cardId === '4th_61')).toMatchObject({
      correctedEnglishText:
        'Place any number of cards from your hand at the bottom of the deck. If you do, draw the same number of cards from the deck.',
      correctedEnglishStatus: 'verified',
      correctedEnglishSource: 'official_card_print_unaffected',
    });
    expect(errata.errata.find((entry) => entry.cardId === '4th_61')?.correctedEnglishText).toBe(
      cardsById.get('4th_61')?.enEffectOfficial,
    );
    for (const cardId of ['3rd_8', '3rd_22']) {
      const correctedEnglish = errata.errata.find((entry) => entry.cardId === cardId)?.correctedEnglishText;
      expect(correctedEnglish).toContain('cards of the four attributes');
      expect(correctedEnglish).not.toContain('all four attributes');
    }
    const effectErrata = errata.errata.filter((entry) => entry.fields.includes('effect'));
    expect(effectErrata).toHaveLength(10);
    expect(effectErrata.every((entry) => entry.correctedEnglishStatus === 'verified')).toBe(true);
    for (const entry of effectErrata) {
      expect(entry.correctedEnglishText).not.toMatch(/\b(?:1|a) card\b/i);
    }
  });
});
