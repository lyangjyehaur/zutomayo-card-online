import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  loadOfficialTranslationsSnapshot,
  type OfficialErrataSnapshotRow,
  type OfficialQaSnapshotRow,
} from './officialRulingsData';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');
const { assertPostgresExpectedRole, postgresConnectionString, postgresSslConfig } =
  require('../api/runtimeSecurityConfig.cjs') as {
    assertPostgresExpectedRole: (env: NodeJS.ProcessEnv, expectedRoleVariable: string) => string;
    postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
    postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
  };

const translationsPath = path.resolve(
  root,
  process.env.OFFICIAL_TRANSLATIONS_SOURCE || 'data/official-rulings-translations.json',
);
const migrationUser = assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
const connectionString = postgresConnectionString(process.env);
const pool = new Pool({
  ...(connectionString
    ? { connectionString }
    : {
        host: process.env.PG_HOST || 'localhost',
        port: Number(process.env.PG_PORT) || 5432,
        user: process.env.PG_USER || migrationUser || 'postgres',
        password: process.env.PG_PASSWORD || '',
        database: process.env.PG_DATABASE || 'postgres',
      }),
  ssl: postgresSslConfig(process.env),
  max: 1,
});

function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value ?? '').slice(0, 10);
}

async function loadPostgresSources(client: import('pg').PoolClient): Promise<{
  qa: OfficialQaSnapshotRow[];
  errata: OfficialErrataSnapshotRow[];
}> {
  const [qaResult, errataResult] = await Promise.all([
    client.query(
      `SELECT id, number, published_at, question_ja, answer_ja, tags, related_card_ids
         FROM official_qa_items
        WHERE publication_status = 'published'
        ORDER BY number`,
    ),
    client.query(
      `SELECT errata.errata_id,
              errata.card_id,
              errata.published_at,
              card.name AS card_name,
              card.rarity,
              card.pack,
              errata.card_number,
              errata.incorrect_text,
              CASE WHEN errata.affects_name THEN card.name ELSE card.effect END AS corrected_text,
              errata.reason_ja,
              errata.replacement_policy_ja,
              errata.usage_policy_ja,
              errata.source_url
         FROM card_official_errata errata
         JOIN cards card ON card.id = errata.card_id
        WHERE errata.publication_status = 'published'
        ORDER BY errata.errata_id`,
    ),
  ]);
  return {
    qa: qaResult.rows.map((row) => ({
      id: row.id,
      number: Number(row.number),
      date: dateOnly(row.published_at),
      question: row.question_ja,
      answer: row.answer_ja,
      tags: row.tags || [],
      relatedCards: row.related_card_ids || [],
    })),
    errata: errataResult.rows.map((row) => ({
      errataId: row.errata_id,
      cardId: row.card_id,
      publishedAt: dateOnly(row.published_at),
      cardName: row.card_name,
      rarity: row.rarity,
      pack: row.pack,
      cardNumber: row.card_number,
      incorrectText: row.incorrect_text,
      correctedText: row.corrected_text,
      reason: row.reason_ja,
      replacementPolicy: row.replacement_policy_ja,
      usagePolicy: row.usage_policy_ja,
      sourceUrl: row.source_url,
    })),
  };
}

async function main() {
  const client = await pool.connect();
  try {
    const sources = await loadPostgresSources(client);
    if (sources.qa.length === 0 || sources.errata.length === 0) {
      throw new Error('Import official Japanese Q&A and errata into PostgreSQL before importing translations');
    }
    const translations = await loadOfficialTranslationsSnapshot(translationsPath, sources);
    await client.query('BEGIN');
    for (const row of translations.qa) {
      for (const locale of translations.locales) {
        const translation = row.translations[locale];
        await client.query(
          `INSERT INTO official_qa_translations (
             qa_id, content_version, locale, question_text, answer_text, status,
             provider, model, review_note, updated_at
           )
           SELECT qa.id, qa.content_version, $2, $3, $4, 'machine', $5, 'static-import-v1',
                  'Imported from a local reviewed source file; verify against the Japanese source in the admin panel.', NOW()
             FROM official_qa_items qa
            WHERE qa.id = $1 AND qa.publication_status = 'published'
           ON CONFLICT (qa_id, content_version, locale)
           DO UPDATE SET question_text = EXCLUDED.question_text,
                         answer_text = EXCLUDED.answer_text,
                         status = 'machine',
                         provider = EXCLUDED.provider,
                         model = EXCLUDED.model,
                         review_note = EXCLUDED.review_note,
                         updated_at = NOW()
           WHERE official_qa_translations.status <> 'verified'`,
          [row.id, locale, translation.question, translation.answer, translations.provider],
        );
      }
    }
    for (const row of translations.errata) {
      for (const locale of translations.locales) {
        const translation = row.translations[locale];
        await client.query(
          `INSERT INTO card_official_errata_translations (
             errata_id, content_version, locale, incorrect_text, reason_text,
             replacement_policy_text, usage_policy_text, status, provider, model,
             review_note, updated_at
           )
           SELECT errata.errata_id, errata.content_version, $2, $3, $4, $5, $6,
                  'machine', $7, 'static-import-v1',
                  'Imported from a local reviewed source file; verify against the Japanese source in the admin panel.', NOW()
             FROM card_official_errata errata
            WHERE errata.errata_id = $1 AND errata.publication_status = 'published'
           ON CONFLICT (errata_id, content_version, locale)
           DO UPDATE SET incorrect_text = EXCLUDED.incorrect_text,
                         reason_text = EXCLUDED.reason_text,
                         replacement_policy_text = EXCLUDED.replacement_policy_text,
                         usage_policy_text = EXCLUDED.usage_policy_text,
                         status = 'machine',
                         provider = EXCLUDED.provider,
                         model = EXCLUDED.model,
                         review_note = EXCLUDED.review_note,
                         updated_at = NOW()
           WHERE card_official_errata_translations.status <> 'verified'`,
          [
            row.errataId,
            locale,
            translation.incorrectText,
            translation.reason,
            translation.replacementPolicy,
            translation.usagePolicy,
            translations.provider,
          ],
        );
      }
    }
    await client.query('COMMIT');
    console.log(
      `Imported ${(translations.qa.length + translations.errata.length) * translations.locales.length} official ruling translations into PostgreSQL`,
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
