import { createRequire } from 'node:module';
import {
  auditDerivedEffects,
  buildDerivedEffectRows,
  DERIVED_EFFECT_LANGS,
  loadDerivedEffectsAuditInput,
} from './cardDerivedEffects';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');
const { assertPostgresExpectedRole, postgresConnectionString, postgresSslConfig } =
  require('../api/runtimeSecurityConfig.cjs') as {
    assertPostgresExpectedRole: (env: NodeJS.ProcessEnv, expectedRoleVariable: string) => string;
    postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
    postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
  };

const sourcePath = process.argv[2] || process.env.CARD_EFFECT_I18N_SOURCE || 'data/card-effects-i18n.json';
const input = loadDerivedEffectsAuditInput(sourcePath);
const problems = auditDerivedEffects(input);
if (problems.length > 0) {
  throw new Error(`Refusing derived-effect import:\n${problems.join('\n')}`);
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

async function main(): Promise<void> {
  const client = await pool.connect();
  const effectCards = input.extraction.cards.filter((card) => card.japaneseEffect.trim());
  const effectCardIds = effectCards.map((card) => card.id);
  const rows = buildDerivedEffectRows(input);
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('card-derived-effects-import'))");

    const existing = await client.query(
      `SELECT id, effect, en_effect_official
       FROM cards
       WHERE NULLIF(BTRIM(effect), '') IS NOT NULL
       ORDER BY id`,
    );
    const existingById = new Map(
      existing.rows.map((row) => [
        row.id as string,
        { effect: String(row.effect || ''), enEffectOfficial: String(row.en_effect_official || '') },
      ]),
    );
    const mismatches: string[] = [];
    for (const card of effectCards) {
      const dbCard = existingById.get(card.id);
      if (!dbCard) {
        mismatches.push(`${card.id}: missing effect card from PostgreSQL`);
        continue;
      }
      if (dbCard.effect !== card.japaneseEffect) {
        mismatches.push(`${card.id}: PostgreSQL Japanese effect differs from the corrected official source`);
      }
      if (dbCard.enEffectOfficial !== card.enEffectOfficial) {
        mismatches.push(`${card.id}: PostgreSQL English effect differs from the human-verified official print`);
      }
    }
    if (existingById.size !== effectCards.length) {
      mismatches.push(`PostgreSQL has ${existingById.size} effect cards; reviewed source has ${effectCards.length}`);
    }
    if (mismatches.length > 0) {
      throw new Error(`Refusing import due to official-source mismatch:\n${mismatches.join('\n')}`);
    }

    const translatedNames = await client.query(
      `SELECT card_id, lang
       FROM card_texts_i18n
       WHERE lang = ANY($1::text[])
         AND card_id = ANY($2::text[])
         AND NULLIF(BTRIM(name_text), '') IS NOT NULL
       ORDER BY card_id, lang`,
      [[...DERIVED_EFFECT_LANGS], effectCardIds],
    );
    if (translatedNames.rows.length > 0) {
      const examples = translatedNames.rows
        .slice(0, 10)
        .map((row) => `${String(row.card_id)}/${String(row.lang)}`)
        .join(', ');
      throw new Error(
        `Refusing import: review_status covers the whole card-text row, but unreviewed translated names exist (${examples})`,
      );
    }

    const deletedEnglish = await client.query("DELETE FROM card_effects_i18n WHERE lang = 'en'");
    const reviewNote =
      'Effect reviewed from corrected official Japanese and human-verified official printed English; ' +
      `source SHA-256 ${input.review.sourceSha256}`;
    for (const row of rows) {
      await client.query(
        `INSERT INTO card_effects_i18n (card_id, lang, effect_text)
         VALUES ($1, $2, $3)
         ON CONFLICT (card_id, lang) DO UPDATE SET effect_text = EXCLUDED.effect_text`,
        [row.cardId, row.lang, row.effectText],
      );
      await client.query(
        `INSERT INTO card_texts_i18n (
           card_id, lang, effect_text, effect_source, review_status, review_note
         )
         VALUES ($1, $2, $3, $4, 'verified', $5)
         ON CONFLICT (card_id, lang) DO UPDATE SET
           effect_text = EXCLUDED.effect_text,
           effect_source = EXCLUDED.effect_source,
           review_status = EXCLUDED.review_status,
           review_note = EXCLUDED.review_note,
           updated_at = NOW()`,
        [row.cardId, row.lang, row.effectText, row.effectSource, reviewNote],
      );
    }

    const oldEnglishCount = await client.query(
      "SELECT COUNT(*)::integer AS count FROM card_effects_i18n WHERE lang = 'en'",
    );
    if (Number(oldEnglishCount.rows[0]?.count) !== 0) {
      throw new Error('Legacy English effect rows remain after cleanup');
    }

    await client.query(
      `INSERT INTO admin_audit_log (
         admin_user_id, action, target_type, target_id, details
       )
       VALUES ($1, 'import_card_derived_effects', 'card_effects_i18n', $2, $3::jsonb)`,
      [
        process.env.CARD_I18N_IMPORT_ADMIN_USER_ID || null,
        input.review.sourceSha256,
        JSON.stringify({
          reviewedAt: input.review.reviewedAt,
          reviewBasis: input.review.reviewBasis,
          cards: effectCards.length,
          translations: rows.length,
          languages: DERIVED_EFFECT_LANGS,
          removedLegacyEnglishRows: deletedEnglish.rowCount ?? 0,
        }),
      ],
    );

    await client.query('COMMIT');
    console.log(
      `Imported ${rows.length} verified derived effects for ${effectCards.length} cards; ` +
        `removed ${deletedEnglish.rowCount ?? 0} legacy English rows.`,
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
