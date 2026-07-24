import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  applyCanonicalQaCardNames,
  errataHashInput,
  OFFICIAL_TRANSLATION_LOCALES,
  officialContentHash,
  officialCorrectedNameMatches,
  parseOfficialTranslationsSnapshot,
  qaHashInput,
  type OfficialErrataSnapshotRow,
  type OfficialCanonicalCardNames,
  type OfficialQaSnapshotRow,
  type OfficialTranslationLocale,
  type OfficialTranslationsSnapshot,
} from './officialRulingsData';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');
const { fetchOfficialSourceSnapshot } = require('../api/officialRulingsSource.cjs') as {
  fetchOfficialSourceSnapshot: () => Promise<{
    qa: OfficialQaSnapshotRow[];
    errata: OfficialErrataSnapshotRow[];
  }>;
};
const { assertPostgresExpectedRole, postgresConnectionString, postgresSslConfig } =
  require('../api/runtimeSecurityConfig.cjs') as {
    assertPostgresExpectedRole: (env: NodeJS.ProcessEnv, variable: string) => string;
    postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
    postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
  };

const NAME_ERRATA_IDS = new Set(['006', '011']);
const SHA_PATTERN = /^[a-f0-9]{40}$/;

function option(name: string): string {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function translationInput(): Promise<string> {
  const source = option('--translations');
  if (!source) throw new Error('--translations is required; use - to read the untracked reviewed JSON from stdin');
  return source === '-' ? readStdin() : readFile(path.resolve(source), 'utf8');
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function createPool() {
  const migrationUser = assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
  const connectionString = postgresConnectionString(process.env);
  return new Pool({
    ...(connectionString
      ? { connectionString }
      : {
          host: process.env.PG_HOST || 'localhost',
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER || migrationUser,
          password: process.env.PG_PASSWORD || '',
          database: process.env.PG_DATABASE || 'postgres',
        }),
    ssl: postgresSslConfig(process.env),
    max: 1,
  });
}

async function cardDataset(client: import('pg').PoolClient) {
  const [{ rows }, { rows: localizedNames }] = await Promise.all([
    client.query(
      `SELECT id, name, effect, en_name_official, en_effect_official
       FROM cards ORDER BY id`,
    ),
    client.query(
      `SELECT card_id, lang, name_text, effect_text, effect_source, review_status
         FROM card_texts_i18n
        WHERE lang = ANY($1::text[]) AND review_status = 'verified'
        ORDER BY card_id, lang`,
      [OFFICIAL_TRANSLATION_LOCALES.filter((locale) => locale !== 'en')],
    ),
  ]);
  if (rows.length < 400) throw new Error(`Official-rulings release refuses incomplete card dataset (${rows.length})`);
  return { rows, localizedNames, hash: hash({ cards: rows, localizedNames }) };
}

function canonicalCardNames(dataset: Awaited<ReturnType<typeof cardDataset>>): OfficialCanonicalCardNames {
  const cards = Object.fromEntries(
    dataset.rows.map((row) => [
      row.id,
      {
        ja: row.name,
        translations: {
          en: row.en_name_official,
          'zh-TW': '',
          'zh-CN': '',
          'zh-HK': '',
          ko: '',
        },
      },
    ]),
  ) as OfficialCanonicalCardNames;
  for (const row of dataset.localizedNames) {
    const locale = row.lang as OfficialTranslationLocale;
    if (cards[row.card_id] && locale !== 'en') cards[row.card_id].translations[locale] = row.name_text;
  }
  return cards;
}

function validateCards(
  cards: Map<string, { name: string; effect: string }>,
  qa: OfficialQaSnapshotRow[],
  errata: OfficialErrataSnapshotRow[],
) {
  for (const cardId of new Set(qa.flatMap((row) => row.relatedCards))) {
    if (!cards.has(cardId)) throw new Error(`Official Q&A references unknown card ${cardId}`);
  }
  for (const row of errata) {
    const card = cards.get(row.cardId);
    if (!card) throw new Error(`Official errata references unknown card ${row.cardId}`);
    if (NAME_ERRATA_IDS.has(row.errataId)) {
      if (!officialCorrectedNameMatches(row.correctedText, card.name)) {
        throw new Error(`Official errata ${row.errataId} corrected name does not match card ${row.cardId}`);
      }
    } else if (/[ぁ-んァ-ヶ一-龠]/.test(row.correctedText) && card.effect !== row.correctedText) {
      throw new Error(`Official errata ${row.errataId} corrected effect does not match card ${row.cardId}`);
    }
  }
}

async function upsertSources(
  client: import('pg').PoolClient,
  qa: OfficialQaSnapshotRow[],
  errata: OfficialErrataSnapshotRow[],
) {
  for (const row of qa) {
    await client.query(
      `INSERT INTO official_qa_items (
         id, number, published_at, question_ja, answer_ja, tags, related_card_ids, source_url,
         content_hash, content_version, publication_status, source_updated_at, last_seen_at, updated_at
       ) VALUES ($1,$2,$3::date,$4,$5,$6::text[],$7::text[],'https://zutomayocard.net/qa/',
                 $8,1,'published',$3::date::timestamptz,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET
         number=EXCLUDED.number, published_at=EXCLUDED.published_at, question_ja=EXCLUDED.question_ja,
         answer_ja=EXCLUDED.answer_ja, tags=EXCLUDED.tags, related_card_ids=EXCLUDED.related_card_ids,
         source_url=EXCLUDED.source_url,
         content_version=official_qa_items.content_version +
           CASE WHEN official_qa_items.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN 1 ELSE 0 END,
         content_hash=EXCLUDED.content_hash, publication_status='published',
         source_updated_at=EXCLUDED.source_updated_at, last_seen_at=NOW(),
         updated_at=CASE WHEN official_qa_items.content_hash IS DISTINCT FROM EXCLUDED.content_hash
                         THEN NOW() ELSE official_qa_items.updated_at END`,
      [
        row.id,
        row.number,
        row.date,
        row.question,
        row.answer,
        row.tags,
        row.relatedCards,
        officialContentHash(qaHashInput(row)),
      ],
    );
  }
  await client.query(
    `UPDATE official_qa_items SET publication_status='inactive', updated_at=NOW()
      WHERE publication_status='published' AND NOT (id = ANY($1::text[]))`,
    [qa.map((row) => row.id)],
  );
  for (const row of errata) {
    const result = await client.query(
      `UPDATE card_official_errata SET
         published_at=$3, incorrect_text=$4, reason_ja=$5, replacement_policy_ja=$6,
         usage_policy_ja=$7, card_number=$8, source_url=$9,
         content_version=content_version + CASE WHEN content_hash IS DISTINCT FROM $10 THEN 1 ELSE 0 END,
         content_hash=$10, publication_status='published', last_seen_at=NOW(),
         updated_at=CASE WHEN content_hash IS DISTINCT FROM $10 THEN NOW() ELSE updated_at END
       WHERE errata_id=$1 AND card_id=$2`,
      [
        row.errataId,
        row.cardId,
        row.publishedAt,
        row.incorrectText,
        row.reason,
        row.replacementPolicy,
        row.usagePolicy,
        row.cardNumber,
        row.sourceUrl,
        officialContentHash(errataHashInput(row)),
      ],
    );
    if (result.rowCount !== 1) throw new Error(`Official errata ${row.errataId} is missing; import card texts first`);
  }
  await client.query(
    `UPDATE card_official_errata SET publication_status='inactive', updated_at=NOW()
      WHERE publication_status='published' AND NOT (errata_id = ANY($1::text[]))`,
    [errata.map((row) => row.errataId)],
  );
}

async function upsertTranslations(client: import('pg').PoolClient, translations: OfficialTranslationsSnapshot) {
  for (const row of translations.qa) {
    for (const locale of OFFICIAL_TRANSLATION_LOCALES) {
      const value = row.translations[locale];
      await client.query(
        `INSERT INTO official_qa_translations
           (qa_id,content_version,locale,question_text,answer_text,status,provider,model,review_note,updated_at)
         SELECT id,content_version,$2,$3,$4,'verified','reviewed-static','direct-v1',
                'Imported from the reviewed untracked release source.',NOW()
           FROM official_qa_items WHERE id=$1 AND publication_status='published'
         ON CONFLICT (qa_id,content_version,locale) DO UPDATE SET
           question_text=EXCLUDED.question_text, answer_text=EXCLUDED.answer_text, status='verified',
           provider=EXCLUDED.provider, model=EXCLUDED.model, review_note=EXCLUDED.review_note, updated_at=NOW()`,
        [row.id, locale, value.question, value.answer],
      );
    }
  }
  for (const row of translations.errata) {
    for (const locale of OFFICIAL_TRANSLATION_LOCALES) {
      const value = row.translations[locale];
      await client.query(
        `INSERT INTO card_official_errata_translations
           (errata_id,content_version,locale,incorrect_text,reason_text,replacement_policy_text,
            usage_policy_text,status,provider,model,review_note,updated_at)
         SELECT errata_id,content_version,$2,$3,$4,$5,$6,'verified','reviewed-static','direct-v1',
                'Imported from the reviewed untracked release source.',NOW()
           FROM card_official_errata WHERE errata_id=$1 AND publication_status='published'
         ON CONFLICT (errata_id,content_version,locale) DO UPDATE SET
           incorrect_text=EXCLUDED.incorrect_text, reason_text=EXCLUDED.reason_text,
           replacement_policy_text=EXCLUDED.replacement_policy_text, usage_policy_text=EXCLUDED.usage_policy_text,
           status='verified', provider=EXCLUDED.provider, model=EXCLUDED.model,
           review_note=EXCLUDED.review_note, updated_at=NOW()`,
        [row.errataId, locale, value.incorrectText, value.reason, value.replacementPolicy, value.usagePolicy],
      );
    }
  }
}

async function assertComplete(client: import('pg').PoolClient, qaCount: number, errataCount: number) {
  const [qa, errata] = await Promise.all([
    client.query(
      `SELECT COUNT(*)::int AS count FROM official_qa_items q
       JOIN official_qa_translations t ON t.qa_id=q.id AND t.content_version=q.content_version
       WHERE q.publication_status='published' AND t.locale=ANY($1::text[])
         AND t.status='verified' AND t.question_text<>'' AND t.answer_text<>''`,
      [OFFICIAL_TRANSLATION_LOCALES],
    ),
    client.query(
      `SELECT COUNT(*)::int AS count FROM card_official_errata e
       JOIN card_official_errata_translations t ON t.errata_id=e.errata_id AND t.content_version=e.content_version
       WHERE e.publication_status='published' AND t.locale=ANY($1::text[])
         AND t.status='verified' AND t.incorrect_text<>'' AND t.reason_text<>''
         AND t.replacement_policy_text<>'' AND t.usage_policy_text<>''`,
      [OFFICIAL_TRANSLATION_LOCALES],
    ),
  ]);
  if (qa.rows[0].count !== qaCount * OFFICIAL_TRANSLATION_LOCALES.length)
    throw new Error('Q&A translations are incomplete');
  if (errata.rows[0].count !== errataCount * OFFICIAL_TRANSLATION_LOCALES.length) {
    throw new Error('Errata translations are incomplete');
  }
}

async function activateRelease(
  client: import('pg').PoolClient,
  release: {
    id: string;
    sourceHash: string;
    translationHash: string;
    cardHash: string;
    appVersion: string;
    buildId: string;
  },
  translations: OfficialTranslationsSnapshot,
  sourceCheckedAt: string,
) {
  await client.query(
    `INSERT INTO official_rulings_releases
       (id,source_hash,translation_hash,card_dataset_hash,qa_count,errata_count,locale_count,locales,
        app_version,build_id,translation_source_generated_at,source_checked_at,status,activated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11::timestamptz,$12::timestamptz,'active',NOW())
     ON CONFLICT (id) DO UPDATE SET status='active', activated_at=NOW()`,
    [
      release.id,
      release.sourceHash,
      release.translationHash,
      release.cardHash,
      translations.qa.length,
      translations.errata.length,
      translations.locales.length,
      translations.locales,
      release.appVersion,
      release.buildId,
      translations.generatedAt,
      sourceCheckedAt,
    ],
  );
  await client.query(
    `INSERT INTO official_rulings_release_qa
       (release_id,qa_id,content_version,content_hash,number,published_at,question_ja,answer_ja,tags,
        related_card_ids,source_url,last_seen_at)
     SELECT $1,id,content_version,content_hash,number,published_at,question_ja,answer_ja,tags,
            related_card_ids,source_url,last_seen_at FROM official_qa_items WHERE publication_status='published'
     ON CONFLICT DO NOTHING`,
    [release.id],
  );
  await client.query(
    `INSERT INTO official_rulings_release_errata
       (release_id,errata_id,content_version,content_hash,card_id,published_at,card_number,incorrect_text,
        corrected_japanese_text,reason_ja,replacement_policy_ja,usage_policy_ja,affects_name,affects_effect,
        source_url,last_seen_at)
     SELECT $1,e.errata_id,e.content_version,e.content_hash,e.card_id,e.published_at,e.card_number,e.incorrect_text,
            CASE WHEN e.affects_name THEN c.name ELSE c.effect END,e.reason_ja,e.replacement_policy_ja,e.usage_policy_ja,
            e.affects_name,e.affects_effect,e.source_url,e.last_seen_at
       FROM card_official_errata e JOIN cards c ON c.id=e.card_id WHERE e.publication_status='published'
     ON CONFLICT DO NOTHING`,
    [release.id],
  );
  await client.query(`UPDATE official_rulings_releases SET status='superseded' WHERE status='active' AND id<>$1`, [
    release.id,
  ]);
  await client.query(
    `INSERT INTO official_rulings_active_release (key,release_id,activated_at) VALUES ('active',$1,NOW())
     ON CONFLICT (key) DO UPDATE SET release_id=EXCLUDED.release_id, activated_at=NOW()`,
    [release.id],
  );
}

export async function main() {
  const appVersion = option('--app-version');
  const buildId = option('--build-id').toLowerCase();
  if (!/^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/.test(appVersion)) throw new Error('--app-version is invalid');
  if (!SHA_PATTERN.test(buildId)) throw new Error('--build-id must be a full Git SHA');
  const [rawTranslations, source] = await Promise.all([translationInput(), fetchOfficialSourceSnapshot()]);
  const sourceCheckedAt = new Date().toISOString();
  let translations = parseOfficialTranslationsSnapshot(rawTranslations, source);
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('official-rulings-release'))");
    const dataset = await cardDataset(client);
    validateCards(new Map(dataset.rows.map((row) => [row.id, row])), source.qa, source.errata);
    translations = applyCanonicalQaCardNames(translations, source.qa, canonicalCardNames(dataset));
    await upsertSources(client, source.qa, source.errata);
    await upsertTranslations(client, translations);
    await assertComplete(client, source.qa.length, source.errata.length);
    const sourceHash = hash({ qa: source.qa.map(qaHashInput), errata: source.errata.map(errataHashInput) });
    const translationHash = hash({ locales: translations.locales, qa: translations.qa, errata: translations.errata });
    const id = hash({ sourceHash, translationHash, cardHash: dataset.hash, appVersion, buildId });
    await activateRelease(
      client,
      { id, sourceHash, translationHash, cardHash: dataset.hash, appVersion, buildId },
      translations,
      sourceCheckedAt,
    );
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        releaseId: id,
        sourceHash,
        translationHash,
        cardDatasetHash: dataset.hash,
        qaCount: source.qa.length,
        errataCount: source.errata.length,
        locales: translations.locales,
      }),
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
