import { createRequire } from 'node:module';
import {
  auditCardNames,
  buildDerivedNameRows,
  DERIVED_NAME_LANGS,
  loadCardNamesAuditInput,
} from './cardNameTranslations';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');
const { assertPostgresExpectedRole, postgresConnectionString, postgresSslConfig } =
  require('../api/runtimeSecurityConfig.cjs') as {
    assertPostgresExpectedRole: (env: NodeJS.ProcessEnv, expectedRoleVariable: string) => string;
    postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
    postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
  };

const sourcePath = process.argv[2] || process.env.CARD_NAME_I18N_SOURCE || 'data/card-names-i18n.json';
const songTitlesPath = process.env.CARD_SONG_I18N_SOURCE || 'data/card-song-titles-i18n.json';
const input = loadCardNamesAuditInput(sourcePath, songTitlesPath);
const problems = auditCardNames(input);
if (problems.length > 0) {
  throw new Error(`Refusing derived-name import:\n${problems.join('\n')}`);
}

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

type EffectSnapshot = {
  cardId: string;
  lang: string;
  effectText: string;
  effectSource: string;
};

async function readEffectSnapshot(client: import('pg').PoolClient): Promise<EffectSnapshot[]> {
  const result = await client.query(
    `SELECT card_id, lang, effect_text, effect_source
     FROM card_texts_i18n
     WHERE lang = ANY($1::text[])
       AND NULLIF(BTRIM(effect_text), '') IS NOT NULL
     ORDER BY card_id, lang`,
    [[...DERIVED_NAME_LANGS]],
  );
  return result.rows.map((row) => ({
    cardId: String(row.card_id),
    lang: String(row.lang),
    effectText: String(row.effect_text || ''),
    effectSource: String(row.effect_source || ''),
  }));
}

async function main(): Promise<void> {
  const client = await pool.connect();
  const rows = buildDerivedNameRows(input);
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('card-derived-names-import'))");

    const existing = await client.query('SELECT id, name, en_name_official FROM cards ORDER BY id');
    const existingById = new Map(existing.rows.map((row) => [String(row.id), row]));
    const mismatches: string[] = [];
    for (const card of input.extraction.cards) {
      const dbCard = existingById.get(card.id);
      if (!dbCard) {
        mismatches.push(`${card.id}: missing from PostgreSQL`);
        continue;
      }
      if (String(dbCard.name || '') !== card.japaneseName) {
        mismatches.push(`${card.id}: PostgreSQL Japanese name differs from the corrected official source`);
      }
      if (String(dbCard.en_name_official || '') !== card.enNameOfficial) {
        mismatches.push(`${card.id}: PostgreSQL English name differs from the human-verified official print`);
      }
    }
    if (existingById.size !== input.extraction.cards.length) {
      mismatches.push(
        `PostgreSQL has ${existingById.size} cards; reviewed source has ${input.extraction.cards.length}`,
      );
    }
    if (mismatches.length > 0) {
      throw new Error(`Refusing import due to official-source mismatch:\n${mismatches.join('\n')}`);
    }

    const effectsBefore = await readEffectSnapshot(client);
    const reviewNote =
      'Name reviewed from corrected official Japanese, human-verified official printed English, and canonical songs; ' +
      `name SHA-256 ${input.review.cardNamesSourceSha256}; song SHA-256 ${input.review.songTitlesSourceSha256}`;
    for (const row of rows) {
      await client.query(
        `INSERT INTO card_texts_i18n (
           card_id, lang, name_text, name_source, review_status, review_note
         )
         VALUES ($1, $2, $3, $4, 'verified', $5)
         ON CONFLICT (card_id, lang) DO UPDATE SET
           name_text = EXCLUDED.name_text,
           name_source = EXCLUDED.name_source,
           review_status = 'verified',
           review_note = CASE
             WHEN NULLIF(BTRIM(card_texts_i18n.effect_text), '') IS NOT NULL
              AND NULLIF(BTRIM(card_texts_i18n.review_note), '') IS NOT NULL
               THEN card_texts_i18n.review_note
             ELSE EXCLUDED.review_note
           END,
           updated_at = NOW()`,
        [row.cardId, row.lang, row.nameText, row.nameSource, reviewNote],
      );
    }

    await client.query(
      `INSERT INTO game_config (key, value, description)
       VALUES ('card_song_titles_i18n', $1::jsonb, $2)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         description = EXCLUDED.description,
         updated_at = NOW()`,
      [
        JSON.stringify(input.songs),
        'Reviewed canonical ZUTOMAYO song titles used by card names, song fields, and effects',
      ],
    );

    const effectsAfter = await readEffectSnapshot(client);
    if (JSON.stringify(effectsAfter) !== JSON.stringify(effectsBefore)) {
      throw new Error('Refusing import: existing derived effect text or provenance changed during name import');
    }

    const importedCounts = await client.query(
      `SELECT lang, COUNT(*)::integer AS count
       FROM card_texts_i18n
       WHERE lang = ANY($1::text[])
         AND NULLIF(BTRIM(name_text), '') IS NOT NULL
         AND review_status = 'verified'
       GROUP BY lang
       ORDER BY lang`,
      [[...DERIVED_NAME_LANGS]],
    );
    const counts = new Map(importedCounts.rows.map((row) => [String(row.lang), Number(row.count)]));
    for (const lang of DERIVED_NAME_LANGS) {
      if (counts.get(lang) !== 422) throw new Error(`${lang}: expected 422 verified card names after import`);
    }

    await client.query(
      `INSERT INTO admin_audit_log (
         admin_user_id, action, target_type, target_id, details
       )
       VALUES ($1, 'import_card_derived_names', 'card_texts_i18n', $2, $3::jsonb)`,
      [
        process.env.CARD_I18N_IMPORT_ADMIN_USER_ID || null,
        input.review.cardNamesSourceSha256,
        JSON.stringify({
          reviewedAt: input.review.reviewedAt,
          reviewBasis: input.review.reviewBasis,
          cards: input.review.cardCount,
          nameTranslations: rows.length,
          songs: input.review.songCount,
          languages: DERIVED_NAME_LANGS,
          songTitleLanguages: input.review.songTitleLanguages,
          cardNamesSourceSha256: input.review.cardNamesSourceSha256,
          songTitlesSourceSha256: input.review.songTitlesSourceSha256,
          preservedDerivedEffects: effectsAfter.length,
        }),
      ],
    );

    await client.query('COMMIT');
    console.log(
      `Imported ${rows.length} verified card names for ${input.review.cardCount} cards and ` +
        `${input.review.songCount} canonical songs; preserved ${effectsAfter.length} translated effects.`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
