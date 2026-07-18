import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { PRESET_DECKS } from '../src/game/cards/presetDecks';
import type { CardDef } from '../src/game/types';
import { loadSeedCardI18n, loadSeedCards } from './cardSource';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');
const { assertPostgresExpectedRole, postgresConnectionString, postgresSslConfig } =
  require('../api/runtimeSecurityConfig.cjs') as {
    assertPostgresExpectedRole: (env: NodeJS.ProcessEnv, expectedRoleVariable: string) => string;
    postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
    postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
  };

type OfficialErrata = {
  errataId: string;
  cardId: string;
  publishedAt: string;
  fields: Array<'name' | 'effect'>;
  incorrectText: string;
  correctedJapaneseText: string;
  correctedEnglishText: string;
  correctedEnglishStatus: 'official' | 'verified' | 'pending_review';
  correctedEnglishSource:
    | 'official_errata_notice'
    | 'official_card_print_unaffected'
    | 'official_card_print_corrected'
    | 'official_japanese_errata_translation';
  sourceUrl: string;
};

const allowEmptyOfficialErrata =
  process.env.NODE_ENV === 'test' && process.env.SEED_ALLOW_EMPTY_OFFICIAL_ERRATA === 'true';
const officialErrata = allowEmptyOfficialErrata
  ? []
  : (
      JSON.parse(
        readFileSync(
          process.env.CARD_ERRATA_SOURCE || new URL('../data/card-official-errata.json', import.meta.url),
          'utf8',
        ),
      ) as { errata: OfficialErrata[] }
    ).errata;

const migrationUser = assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
const databaseUrl = postgresConnectionString(process.env);
const pool = new Pool({
  ...(databaseUrl
    ? { connectionString: databaseUrl }
    : {
        host: process.env.PG_HOST || 'localhost',
        port: Number(process.env.PG_PORT) || 5432,
        user: process.env.PG_USER || migrationUser || 'postgres',
        password: process.env.PG_PASSWORD || '',
        database: process.env.PG_DATABASE || 'postgres',
      }),
  ssl: postgresSslConfig(process.env),
});

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    en_name_official TEXT DEFAULT '',
    pack TEXT NOT NULL,
    song TEXT DEFAULT '',
    illustrator TEXT DEFAULT '',
    rarity TEXT DEFAULT '',
    element TEXT NOT NULL,
    type TEXT NOT NULL,
    clock INTEGER DEFAULT 0,
    attack_night INTEGER,
    attack_day INTEGER,
    power_cost INTEGER DEFAULT 0,
    send_to_power INTEGER DEFAULT 0,
    effect TEXT DEFAULT '',
    en_effect_official TEXT DEFAULT '',
    image TEXT DEFAULT '',
    errata TEXT DEFAULT '',
    has_official_errata BOOLEAN NOT NULL DEFAULT FALSE,
    official_errata_id TEXT,
    official_errata_affects_name BOOLEAN NOT NULL DEFAULT FALSE,
    official_errata_affects_effect BOOLEAN NOT NULL DEFAULT FALSE,
    official_errata_url TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS en_name_official TEXT NOT NULL DEFAULT '';
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS en_effect_official TEXT NOT NULL DEFAULT '';
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS has_official_errata BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS official_errata_id TEXT;
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS official_errata_affects_name BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS official_errata_affects_effect BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS official_errata_url TEXT NOT NULL DEFAULT '';
  CREATE INDEX IF NOT EXISTS idx_cards_has_official_errata ON cards(has_official_errata);

  CREATE TABLE IF NOT EXISTS card_official_errata (
    errata_id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
    published_at DATE NOT NULL,
    affects_name BOOLEAN NOT NULL DEFAULT FALSE,
    affects_effect BOOLEAN NOT NULL DEFAULT FALSE,
    incorrect_text TEXT NOT NULL DEFAULT '',
    corrected_english_status TEXT NOT NULL DEFAULT 'pending_review'
      CHECK (corrected_english_status IN ('official', 'verified', 'pending_review')),
    corrected_english_source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (affects_name OR affects_effect)
  );
  ALTER TABLE card_official_errata
    ADD COLUMN IF NOT EXISTS corrected_english_source TEXT NOT NULL
    DEFAULT 'official_japanese_errata_translation';

  CREATE TABLE IF NOT EXISTS card_texts_i18n (
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    lang TEXT NOT NULL CONSTRAINT card_texts_i18n_derived_lang_check CHECK (lang NOT IN ('ja', 'en')),
    name_text TEXT NOT NULL DEFAULT '',
    effect_text TEXT NOT NULL DEFAULT '',
    name_source TEXT NOT NULL DEFAULT '',
    effect_source TEXT NOT NULL DEFAULT '',
    review_status TEXT NOT NULL DEFAULT 'pending_review'
      CHECK (review_status IN ('official', 'verified', 'pending_review')),
    review_note TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (card_id, lang)
  );

  CREATE TABLE IF NOT EXISTS game_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS preset_decks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    card_ids JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    admin_user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS admin_user_id TEXT;
`;

const DEFAULT_GAME_CONFIG: Array<{ key: string; value: unknown; description: string }> = [
  {
    key: 'chronos',
    value: {
      positions: 12,
      midnight: 0,
      noon: 6,
      nightPositions: [0, 1, 2, 3, 10, 11],
      dayPositions: [4, 5, 6, 7, 8, 9],
    },
    description: 'Chronos board positions and day/night mapping',
  },
  { key: 'turnTimerMs', value: 60000, description: 'Default turn timer in milliseconds' },
  { key: 'deckSize', value: 20, description: 'Required deck size' },
  { key: 'maxCopies', value: 2, description: 'Maximum copies of one card per deck' },
];

function presetCardIds(cards: CardDef[], element: CardDef['element']): string[] {
  const ids = cards
    .filter((card) => card.element === element)
    .slice(0, 20)
    .map((card) => card.id);
  if (ids.length !== 20) throw new Error(`Preset element ${element} does not have enough cards`);
  return ids;
}

function cardParams(card: CardDef): unknown[] {
  return [
    card.id,
    card.name,
    card.enNameOfficial ?? '',
    card.pack,
    card.song,
    card.illustrator,
    card.rarity,
    card.element,
    card.type,
    card.clock,
    card.attack?.night ?? null,
    card.attack?.day ?? null,
    card.powerCost,
    card.sendToPower,
    card.effect,
    card.enEffectOfficial ?? '',
    card.image,
    card.errata,
    Boolean(card.hasOfficialErrata),
    card.officialErrataId ?? null,
    Boolean(card.officialErrataAffectsName),
    Boolean(card.officialErrataAffectsEffect),
    card.officialErrataUrl ?? '',
  ];
}

async function main(): Promise<void> {
  const cards = await loadSeedCards();
  const effectsI18n = await loadSeedCardI18n();
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const expectedErrataCount = allowEmptyOfficialErrata ? 0 : 12;
  if (
    officialErrata.length !== expectedErrataCount ||
    new Set(officialErrata.map((entry) => entry.cardId)).size !== expectedErrataCount
  ) {
    throw new Error(`Official errata source must contain ${expectedErrataCount} unique cards`);
  }
  for (const entry of officialErrata) {
    const card = cardsById.get(entry.cardId);
    const correctedJapanese = entry.fields.includes('name') ? card?.name : card?.effect;
    if (correctedJapanese !== entry.correctedJapaneseText) {
      throw new Error(`${entry.cardId}: seed card text does not match corrected official Japanese`);
    }
    if (entry.correctedEnglishSource === 'official_card_print_unaffected') {
      const printedEnglish = entry.fields.includes('name') ? card?.enNameOfficial : card?.enEffectOfficial;
      if (entry.correctedEnglishText !== printedEnglish) {
        throw new Error(`${entry.cardId}: unaffected English does not exactly match reviewed card print`);
      }
    }
  }
  const presetDecks = Object.entries(PRESET_DECKS).map(([id, deck]) => ({
    id,
    name: deck.name,
    cardIds: presetCardIds(cards, deck.element),
  }));

  await pool.query(SCHEMA_SQL);

  const client = await pool.connect();
  let translationCount = 0;
  try {
    await client.query('BEGIN');

    for (const card of cards) {
      await client.query(
        `INSERT INTO cards (
           id, name, en_name_official, pack, song, illustrator, rarity, element, type, clock,
           attack_night, attack_day, power_cost, send_to_power, effect,
           en_effect_official, image, errata, has_official_errata, official_errata_id,
           official_errata_affects_name, official_errata_affects_effect, official_errata_url
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                 $19, $20, $21, $22, $23)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           en_name_official = EXCLUDED.en_name_official,
           pack = EXCLUDED.pack,
           song = EXCLUDED.song,
           illustrator = EXCLUDED.illustrator,
           rarity = EXCLUDED.rarity,
           element = EXCLUDED.element,
           type = EXCLUDED.type,
           clock = EXCLUDED.clock,
           attack_night = EXCLUDED.attack_night,
           attack_day = EXCLUDED.attack_day,
           power_cost = EXCLUDED.power_cost,
           send_to_power = EXCLUDED.send_to_power,
           effect = EXCLUDED.effect,
           en_effect_official = EXCLUDED.en_effect_official,
           image = EXCLUDED.image,
           errata = EXCLUDED.errata,
           has_official_errata = EXCLUDED.has_official_errata,
           official_errata_id = EXCLUDED.official_errata_id,
           official_errata_affects_name = EXCLUDED.official_errata_affects_name,
           official_errata_affects_effect = EXCLUDED.official_errata_affects_effect,
           official_errata_url = EXCLUDED.official_errata_url,
           updated_at = NOW()`,
        cardParams(card),
      );
    }

    await client.query(`
      UPDATE cards
      SET has_official_errata = FALSE,
          official_errata_id = NULL,
          official_errata_affects_name = FALSE,
          official_errata_affects_effect = FALSE,
          official_errata_url = '';
      DELETE FROM card_official_errata;
    `);
    for (const entry of officialErrata) {
      const card = cardsById.get(entry.cardId);
      if (!card) throw new Error(`${entry.cardId}: missing seed card after validation`);
      const affectsName = entry.fields.includes('name');
      const affectsEffect = entry.fields.includes('effect');
      const correctedEnglish =
        entry.correctedEnglishSource === 'official_card_print_unaffected'
          ? affectsName
            ? card.enNameOfficial || ''
            : card.enEffectOfficial || ''
          : entry.correctedEnglishText;
      await client.query(
        `UPDATE cards
         SET name = CASE WHEN $3 THEN $6 ELSE name END,
             effect = CASE WHEN $4 THEN $6 ELSE effect END,
             en_name_official = CASE WHEN $3 THEN $7 ELSE en_name_official END,
             en_effect_official = CASE WHEN $4 THEN $7 ELSE en_effect_official END,
             has_official_errata = TRUE,
             official_errata_id = $2,
             official_errata_affects_name = $3,
             official_errata_affects_effect = $4,
             official_errata_url = $5,
             updated_at = NOW()
         WHERE id = $1`,
        [
          entry.cardId,
          entry.errataId,
          affectsName,
          affectsEffect,
          entry.sourceUrl,
          entry.correctedJapaneseText,
          correctedEnglish,
        ],
      );
      await client.query(
        `INSERT INTO card_official_errata (
           errata_id, card_id, published_at, affects_name, affects_effect,
           incorrect_text, corrected_english_status, corrected_english_source, source_url
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.errataId,
          entry.cardId,
          entry.publishedAt,
          affectsName,
          affectsEffect,
          entry.incorrectText,
          entry.correctedEnglishStatus,
          entry.correctedEnglishSource,
          entry.sourceUrl,
        ],
      );
    }

    for (const [cardId, translations] of Object.entries(effectsI18n)) {
      for (const [lang, effectText] of Object.entries(translations)) {
        if (lang.includes('name')) continue;
        if (lang === 'ja' || lang === 'en') continue;
        await client.query(
          `INSERT INTO card_texts_i18n (
             card_id, lang, effect_text, effect_source, review_status
           )
           VALUES ($1, $2, $3, 'seed_card_effect_i18n', 'pending_review')
           ON CONFLICT (card_id, lang) DO UPDATE SET
             effect_text = CASE
               WHEN card_texts_i18n.review_status IN ('official', 'verified')
                 THEN card_texts_i18n.effect_text
               ELSE EXCLUDED.effect_text
             END,
             effect_source = CASE
               WHEN card_texts_i18n.review_status IN ('official', 'verified')
                 THEN card_texts_i18n.effect_source
               ELSE EXCLUDED.effect_source
             END,
             review_status = CASE
               WHEN card_texts_i18n.review_status IN ('official', 'verified')
                 THEN card_texts_i18n.review_status
               ELSE 'pending_review'
             END,
             review_note = CASE
               WHEN card_texts_i18n.review_status IN ('official', 'verified')
                 THEN card_texts_i18n.review_note
               ELSE ''
             END,
             updated_at = NOW()`,
          [cardId, lang, effectText],
        );
        translationCount += 1;
      }
    }

    for (const deck of presetDecks) {
      await client.query(
        `INSERT INTO preset_decks (id, name, card_ids)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           card_ids = EXCLUDED.card_ids,
           updated_at = NOW()`,
        [deck.id, deck.name, JSON.stringify(deck.cardIds)],
      );
    }

    for (const config of DEFAULT_GAME_CONFIG) {
      await client.query(
        `INSERT INTO game_config (key, value, description)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           description = EXCLUDED.description,
           updated_at = NOW()`,
        [config.key, JSON.stringify(config.value), config.description],
      );
    }

    await client.query('COMMIT');
    console.log(
      `Seeded ${cards.length} cards, ${translationCount} translations, ${presetDecks.length} decks, ${DEFAULT_GAME_CONFIG.length} configs inserted`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Card seed failed:', err);
  process.exit(1);
});
