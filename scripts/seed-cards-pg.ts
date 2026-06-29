import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESET_DECKS } from '../src/game/cards/presetDecks';
import type { CardDef } from '../src/game/types';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');

type CardEffectsI18n = Record<string, Record<string, string>>;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'postgres',
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS card_effects_i18n (
    card_id TEXT NOT NULL,
    lang TEXT NOT NULL,
    effect_text TEXT NOT NULL DEFAULT '',
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
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
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

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

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
  ];
}

async function main(): Promise<void> {
  const cards = readJsonFile<CardDef[]>(resolve(projectRoot, 'cards.json'));
  const effectsI18n = readJsonFile<CardEffectsI18n>(resolve(projectRoot, 'data/card-effects-i18n.json'));
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
           en_effect_official, image, errata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
           updated_at = NOW()`,
        cardParams(card),
      );
    }

    for (const [cardId, translations] of Object.entries(effectsI18n)) {
      for (const [lang, effectText] of Object.entries(translations)) {
        if (lang.includes('name')) continue;
        await client.query(
          `INSERT INTO card_effects_i18n (card_id, lang, effect_text)
           VALUES ($1, $2, $3)
           ON CONFLICT (card_id, lang) DO UPDATE SET effect_text = EXCLUDED.effect_text`,
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
