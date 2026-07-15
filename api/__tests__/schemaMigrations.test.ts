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
      'idx_cards_has_official_errata',
    ];

    for (const artifact of cardTextArtifacts) {
      expect(initSchema, `initSchema fallback missing ${artifact}`).toContain(artifact);
      expect(migrations, `migrations missing ${artifact}`).toContain(artifact);
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
      }>;
    };
    const extraction = JSON.parse(readRepoFile('data/card-english-extraction.json')) as {
      cards: Array<{ id: string; japaneseName: string; japaneseEffect: string }>;
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
  });
});
