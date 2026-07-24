import { createRequire } from 'node:module';
import { validateOfficialTranslation } from './officialRulingsData';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');
const { createTranslationServiceFromEnv } = require('../api/translationService.cjs') as {
  createTranslationServiceFromEnv: (
    env: NodeJS.ProcessEnv,
  ) =>
    | ((input: {
        text: string;
        sourceLanguage: string;
        targetLanguage: string;
        purpose: string;
        resourceType: string;
        resourceId: string;
        maxLength: number;
      }) => Promise<{ translatedContent: string; provider?: string; model?: string }>)
    | undefined;
};
const { postgresConnectionString, postgresSslConfig } = require('../api/runtimeSecurityConfig.cjs') as {
  postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
  postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
};

const SUPPORTED_TARGETS = ['zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'] as const;
const localeArg = process.argv.find((value) => value.startsWith('--locale='))?.split('=')[1];
const limitArg =
  Number(process.argv.find((value) => value.startsWith('--limit='))?.split('=')[1]) || Number.MAX_SAFE_INTEGER;
const targets = localeArg ? [localeArg] : [...SUPPORTED_TARGETS];
for (const locale of targets) {
  if (!SUPPORTED_TARGETS.includes(locale as (typeof SUPPORTED_TARGETS)[number])) {
    throw new Error(`Unsupported target locale: ${locale}`);
  }
}

function parseJson(value: string): Record<string, string> {
  const clean = value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed = JSON.parse(clean) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, item]) => [key, typeof item === 'string' ? item.trim() : '']),
  );
}

async function localizedCardNames(pool: InstanceType<typeof Pool>, locale: string) {
  const { rows } = await pool.query(
    `SELECT card.id, card.name, card.en_name_official, localized.name_text, localized.review_status
       FROM cards card
       LEFT JOIN card_texts_i18n localized
         ON localized.card_id = card.id AND localized.lang = $1`,
    [locale],
  );
  return new Map(
    rows.map((row) => [
      row.id as string,
      locale === 'en'
        ? row.en_name_official || row.name
        : row.review_status === 'verified' && row.name_text
          ? row.name_text
          : row.en_name_official || row.name,
    ]),
  );
}

function tokenizeCards(value: string, cardIds: string[], japaneseNames: Map<string, string>) {
  let output = value;
  for (const cardId of cardIds) {
    const name = japaneseNames.get(cardId);
    if (name) output = output.replaceAll(name, `[[CARD:${cardId}]]`);
  }
  return output;
}

function restoreCards(value: string, names: Map<string, string>) {
  return value.replace(/\[\[CARD:([^\]]+)\]\]/g, (_match, cardId: string) => names.get(cardId) || cardId);
}

async function main() {
  const translate = createTranslationServiceFromEnv(process.env);
  if (!translate) throw new Error('TRANSLATION_ENDPOINT or CHAT_TRANSLATION_ENDPOINT is required');
  const connectionString = postgresConnectionString(process.env);
  const pool = new Pool({
    ...(connectionString
      ? { connectionString }
      : {
          host: process.env.PG_HOST || 'localhost',
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER || 'postgres',
          password: process.env.PG_PASSWORD || '',
          database: process.env.PG_DATABASE || 'postgres',
        }),
    ssl: postgresSslConfig(process.env),
    max: 1,
  });
  try {
    const cardRows = await pool.query('SELECT id, name FROM cards');
    const japaneseNames = new Map(cardRows.rows.map((row) => [row.id as string, row.name as string]));
    let translatedCount = 0;
    for (const locale of targets) {
      const targetNames = await localizedCardNames(pool, locale);
      const qaRows = (
        await pool.query(
          `SELECT qa.*
             FROM official_qa_items qa
            WHERE qa.publication_status = 'published'
              AND NOT EXISTS (
                SELECT 1 FROM official_qa_translations translation
                 WHERE translation.qa_id = qa.id
                   AND translation.content_version = qa.content_version
                   AND translation.locale = $1
                   AND translation.status IN ('machine', 'verified')
              )
            ORDER BY qa.number`,
          [locale],
        )
      ).rows;
      for (const row of qaRows) {
        if (translatedCount >= limitArg) break;
        const cardIds = Array.isArray(row.related_card_ids) ? row.related_card_ids : [];
        const payload = {
          question: tokenizeCards(row.question_ja, cardIds, japaneseNames),
          answer: tokenizeCards(row.answer_ja, cardIds, japaneseNames),
          instruction:
            'Translate faithfully as a trading-card rules ruling. Preserve every [[CARD:id]] token, number, ★ symbol, zone label, and SEND TO POWER. Return JSON with question and answer only.',
        };
        const result = await translate({
          text: JSON.stringify(payload),
          sourceLanguage: 'ja',
          targetLanguage: locale,
          purpose: 'official-rulings',
          resourceType: 'official_qa',
          resourceId: row.id,
          maxLength: 30_000,
        });
        const parsed = parseJson(result.translatedContent);
        if (!parsed.question || !parsed.answer) throw new Error(`Incomplete Q&A translation: ${row.id} ${locale}`);
        validateOfficialTranslation(`${payload.question}\n${payload.answer}`, `${parsed.question}\n${parsed.answer}`);
        await pool.query(
          `INSERT INTO official_qa_translations (
             qa_id, content_version, locale, question_text, answer_text, status, provider, model, updated_at
           ) VALUES ($1, $2, $3, $4, $5, 'machine', $6, $7, NOW())
           ON CONFLICT (qa_id, content_version, locale)
           DO UPDATE SET question_text = EXCLUDED.question_text,
                         answer_text = EXCLUDED.answer_text,
                         status = CASE
                           WHEN official_qa_translations.status = 'verified' THEN 'verified'
                           ELSE 'machine'
                         END,
                         provider = EXCLUDED.provider,
                         model = EXCLUDED.model,
                         updated_at = NOW()`,
          [
            row.id,
            row.content_version,
            locale,
            restoreCards(parsed.question, targetNames),
            restoreCards(parsed.answer, targetNames),
            result.provider || 'llm',
            result.model || '',
          ],
        );
        translatedCount += 1;
      }

      const errataRows = (
        await pool.query(
          `SELECT errata.*
             FROM card_official_errata errata
            WHERE errata.publication_status = 'published'
              AND NOT EXISTS (
                SELECT 1 FROM card_official_errata_translations translation
                 WHERE translation.errata_id = errata.errata_id
                   AND translation.content_version = errata.content_version
                   AND translation.locale = $1
                   AND translation.status IN ('machine', 'verified')
              )
            ORDER BY errata.errata_id`,
          [locale],
        )
      ).rows;
      for (const row of errataRows) {
        if (translatedCount >= limitArg) break;
        const payload = {
          incorrectText: row.incorrect_text,
          reason: row.reason_ja,
          replacementPolicy: row.replacement_policy_ja,
          usagePolicy: row.usage_policy_ja,
          instruction:
            'Translate faithfully as an official card errata notice. Preserve every number, ★ symbol, zone label, and SEND TO POWER. Return JSON with incorrectText, reason, replacementPolicy, and usagePolicy only.',
        };
        const result = await translate({
          text: JSON.stringify(payload),
          sourceLanguage: 'ja',
          targetLanguage: locale,
          purpose: 'official-rulings',
          resourceType: 'official_errata',
          resourceId: row.errata_id,
          maxLength: 30_000,
        });
        const parsed = parseJson(result.translatedContent);
        if (!parsed.incorrectText || !parsed.reason || !parsed.replacementPolicy || !parsed.usagePolicy) {
          throw new Error(`Incomplete errata translation: ${row.errata_id} ${locale}`);
        }
        validateOfficialTranslation(
          [payload.incorrectText, payload.reason, payload.replacementPolicy, payload.usagePolicy].join('\n'),
          [parsed.incorrectText, parsed.reason, parsed.replacementPolicy, parsed.usagePolicy].join('\n'),
        );
        await pool.query(
          `INSERT INTO card_official_errata_translations (
             errata_id, content_version, locale, incorrect_text, reason_text,
             replacement_policy_text, usage_policy_text, status, provider, model, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'machine', $8, $9, NOW())
           ON CONFLICT (errata_id, content_version, locale)
           DO UPDATE SET incorrect_text = EXCLUDED.incorrect_text,
                         reason_text = EXCLUDED.reason_text,
                         replacement_policy_text = EXCLUDED.replacement_policy_text,
                         usage_policy_text = EXCLUDED.usage_policy_text,
                         status = CASE
                           WHEN card_official_errata_translations.status = 'verified' THEN 'verified'
                           ELSE 'machine'
                         END,
                         provider = EXCLUDED.provider,
                         model = EXCLUDED.model,
                         updated_at = NOW()`,
          [
            row.errata_id,
            row.content_version,
            locale,
            parsed.incorrectText,
            parsed.reason,
            parsed.replacementPolicy,
            parsed.usagePolicy,
            result.provider || 'llm',
            result.model || '',
          ],
        );
        translatedCount += 1;
      }
    }
    console.log(`Generated ${translatedCount} official-rulings translations`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
