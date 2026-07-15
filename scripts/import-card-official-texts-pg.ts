import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');

type ExtractedCard = {
  id: string;
  japaneseName: string;
  enNameOfficial: string;
  nameStatus: string;
  japaneseEffect: string;
  enEffectOfficial: string;
  effectStatus: string;
};

const source = process.argv[2] || 'data/card-english-extraction.json';
const cards = (JSON.parse(fs.readFileSync(source, 'utf8')) as { cards: ExtractedCard[] }).cards;
if (cards.some((card) => card.nameStatus !== 'verified' || card.effectStatus !== 'verified')) {
  throw new Error('Refusing import: every official name/effect must be verified');
}

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'postgres',
});

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id, name, effect FROM cards ORDER BY id');
    const existingById = new Map(existing.rows.map((row) => [row.id as string, row]));
    const mismatches: string[] = [];
    for (const card of cards) {
      const row = existingById.get(card.id);
      if (!row) {
        mismatches.push(`${card.id}: missing from PG`);
        continue;
      }
      if (row.name !== card.japaneseName) mismatches.push(`${card.id}: Japanese name differs from PG`);
      if ((row.effect || '') !== card.japaneseEffect) mismatches.push(`${card.id}: Japanese effect differs from PG`);
    }
    if (existingById.size !== cards.length) {
      mismatches.push(`PG has ${existingById.size} cards; extraction has ${cards.length}`);
    }
    if (mismatches.length > 0) {
      throw new Error(`Refusing import due to source mismatch:\n${mismatches.join('\n')}`);
    }

    for (const card of cards) {
      await client.query(
        `UPDATE cards
         SET en_name_official = $2, en_effect_official = $3, updated_at = NOW()
         WHERE id = $1`,
        [card.id, card.enNameOfficial, card.enEffectOfficial],
      );
      await client.query(
        `INSERT INTO card_texts_i18n (
           card_id, lang, name_text, effect_text, name_source, effect_source,
           review_status, review_note
         )
         VALUES
           ($1, 'ja', $2, $3, 'official_card_print', 'official_card_print', 'official', ''),
           ($1, 'en', $4, $5, 'official_card_print', 'official_card_print', 'official', '')
         ON CONFLICT (card_id, lang) DO UPDATE SET
           name_text = EXCLUDED.name_text,
           effect_text = EXCLUDED.effect_text,
           name_source = EXCLUDED.name_source,
           effect_source = EXCLUDED.effect_source,
           review_status = EXCLUDED.review_status,
           review_note = EXCLUDED.review_note,
           updated_at = NOW()`,
        [card.id, card.japaneseName, card.japaneseEffect, card.enNameOfficial, card.enEffectOfficial],
      );
    }
    await client.query('COMMIT');
    console.log(`Imported official Japanese/English text for ${cards.length} cards.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
