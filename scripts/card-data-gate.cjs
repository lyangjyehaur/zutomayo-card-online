#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Pool } = require('pg');
const {
  assertPostgresExpectedRole,
  postgresConnectionString,
  postgresSslConfig,
} = require('../api/runtimeSecurityConfig.cjs');

const EXPECTED_CARD_COUNT = 422;
const EXTRACTION_PATH = resolve(
  process.env.CARD_EXTRACTION_SOURCE || resolve(__dirname, '..', 'data', 'card-english-extraction.json'),
);
const ERRATA_PATH = resolve(
  process.env.CARD_ERRATA_SOURCE || resolve(__dirname, '..', 'data', 'card-official-errata.json'),
);
const HUMAN_REVIEWS_PATH = resolve(
  process.env.CARD_HUMAN_REVIEWS_SOURCE || resolve(__dirname, '..', 'data', 'card-english-human-reviews.json'),
);
const OCR_OVERRIDES_PATH = resolve(
  process.env.CARD_OCR_OVERRIDES_SOURCE || resolve(__dirname, 'card-english-ocr-overrides.json'),
);

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function loadOfficialCardDataManifest({
  extractionPath = EXTRACTION_PATH,
  errataPath = ERRATA_PATH,
  humanReviewsPath = HUMAN_REVIEWS_PATH,
  ocrOverridesPath = OCR_OVERRIDES_PATH,
} = {}) {
  const extractionContents = readFileSync(extractionPath);
  const errataContents = readFileSync(errataPath);
  const humanReviewsContents = readFileSync(humanReviewsPath);
  const ocrOverridesContents = readFileSync(ocrOverridesPath);
  const extraction = JSON.parse(extractionContents.toString('utf8'));
  const errata = JSON.parse(errataContents.toString('utf8'));
  if (!Array.isArray(extraction.cards) || extraction.cards.length !== EXPECTED_CARD_COUNT) {
    throw new Error(`official card extraction must contain exactly ${EXPECTED_CARD_COUNT} cards`);
  }
  if (!Array.isArray(errata.errata) || errata.errata.length === 0) {
    throw new Error('official errata data is malformed');
  }
  const hash = createHash('sha256');
  hash.update(extractionContents);
  hash.update('\0');
  hash.update(errataContents);
  hash.update('\0');
  hash.update(humanReviewsContents);
  hash.update('\0');
  hash.update(ocrOverridesContents);
  const reviewHash = createHash('sha256');
  reviewHash.update(humanReviewsContents);
  reviewHash.update('\0');
  reviewHash.update(ocrOverridesContents);
  return {
    cards: extraction.cards,
    errata: errata.errata,
    cardCount: extraction.cards.length,
    errataCount: errata.errata.length,
    extractionSha256: sha256(extractionContents),
    errataSha256: sha256(errataContents),
    reviewProvenanceSha256: reviewHash.digest('hex'),
    datasetSha256: hash.digest('hex'),
  };
}

function loadExpectedErrataCardIds(sourcePaths) {
  return loadOfficialCardDataManifest(sourcePaths)
    .errata.map((entry) => String(entry.cardId || ''))
    .sort();
}

function officialCardDataChecksum(sourcePaths) {
  return loadOfficialCardDataManifest(sourcePaths).datasetSha256;
}

function count(row, key) {
  const value = Number(row?.[key]);
  return Number.isInteger(value) ? value : Number.NaN;
}

function rowsDiffer(actual, expected) {
  return Object.entries(expected).some(([key, value]) => {
    if (typeof value === 'boolean') return actual?.[key] !== value;
    return String(actual?.[key] ?? '') !== String(value ?? '');
  });
}

function exactSignedDataProblems(manifest, actualCards, actualTexts, actualErrata) {
  const problems = [];
  const expectedCards = new Map();
  const expectedTexts = new Map();
  const expectedErrata = new Map();

  for (const card of manifest.cards) {
    expectedCards.set(card.id, {
      id: card.id,
      name: card.japaneseName,
      effect: card.japaneseEffect,
      en_name_official: card.enNameOfficial,
      en_effect_official: card.enEffectOfficial,
    });
    expectedTexts.set(`${card.id}:ja`, {
      card_id: card.id,
      lang: 'ja',
      name_text: card.japaneseName,
      effect_text: card.japaneseEffect,
      name_source: 'official_card_print',
      effect_source: 'official_card_print',
      review_status: 'official',
      review_note: '',
    });
    expectedTexts.set(`${card.id}:en`, {
      card_id: card.id,
      lang: 'en',
      name_text: card.enNameOfficial,
      effect_text: card.enEffectOfficial,
      name_source: 'official_card_print',
      effect_source: 'official_card_print',
      review_status: 'official',
      review_note: '',
    });
  }

  for (const entry of manifest.errata) {
    const card = expectedCards.get(entry.cardId);
    if (!card) {
      problems.push(`${entry.cardId}: signed errata card is absent from the extraction`);
      continue;
    }
    const affectsName = entry.fields.includes('name');
    const affectsEffect = entry.fields.includes('effect');
    const note = `Official errata ${entry.errataId}: ${entry.sourceUrl}`;
    expectedTexts.set(`${entry.cardId}:ja`, {
      card_id: entry.cardId,
      lang: 'ja',
      name_text: card.name,
      effect_text: card.effect,
      name_source: affectsName ? 'official_errata_notice' : 'official_card_print',
      effect_source: affectsEffect ? 'official_errata_notice' : 'official_card_print',
      review_status: 'official',
      review_note: note,
    });
    expectedTexts.set(`${entry.cardId}:en`, {
      card_id: entry.cardId,
      lang: 'en',
      name_text: affectsName ? entry.correctedEnglishText : card.en_name_official,
      effect_text: affectsEffect ? entry.correctedEnglishText : card.en_effect_official,
      name_source: affectsName ? entry.correctedEnglishSource : 'official_card_print',
      effect_source: affectsEffect ? entry.correctedEnglishSource : 'official_card_print',
      review_status: entry.correctedEnglishStatus,
      review_note: note,
    });
    expectedErrata.set(entry.cardId, {
      errata_id: entry.errataId,
      card_id: entry.cardId,
      published_at: entry.publishedAt,
      affects_name: affectsName,
      affects_effect: affectsEffect,
      incorrect_text: entry.incorrectText,
      corrected_japanese_text: entry.correctedJapaneseText,
      corrected_english_text: entry.correctedEnglishText,
      corrected_english_status: entry.correctedEnglishStatus,
      corrected_english_source: entry.correctedEnglishSource,
      source_url: entry.sourceUrl,
    });
  }

  const actualCardMap = new Map(actualCards.map((row) => [String(row.id), row]));
  const actualTextMap = new Map(actualTexts.map((row) => [`${row.card_id}:${row.lang}`, row]));
  const actualErrataMap = new Map(actualErrata.map((row) => [String(row.card_id), row]));
  const cardMismatches = [...expectedCards].filter(([id, expected]) => rowsDiffer(actualCardMap.get(id), expected));
  const textMismatches = [...expectedTexts].filter(([key, expected]) => rowsDiffer(actualTextMap.get(key), expected));
  const errataMismatches = [...expectedErrata].filter(([id, expected]) =>
    rowsDiffer(actualErrataMap.get(id), expected),
  );

  if (actualCardMap.size !== expectedCards.size || cardMismatches.length > 0) {
    problems.push(`${cardMismatches.length} card text rows differ from the signed dataset`);
  }
  if (actualTextMap.size !== expectedTexts.size || textMismatches.length > 0) {
    problems.push(`${textMismatches.length} ja/en localized rows differ from the signed dataset`);
  }
  if (actualErrataMap.size !== expectedErrata.size || errataMismatches.length > 0) {
    problems.push(`${errataMismatches.length} errata rows differ from the signed dataset`);
  }
  return problems;
}

async function assertOfficialCardData(pool, options = {}) {
  const manifest = options.manifest || loadOfficialCardDataManifest();
  const expectedCardCount = options.expectedCardCount ?? manifest.cardCount;
  const expectedErrataCardIds =
    options.expectedErrataCardIds ?? manifest.errata.map((entry) => String(entry.cardId || '')).sort();
  const requireLedger = options.requireLedger !== false;
  const requireExact = options.requireExact === true;
  const queries = [
    pool.query(`
      SELECT
        COUNT(*)::integer AS card_count,
        COUNT(*) FILTER (
          WHERE BTRIM(COALESCE(en_name_official, '')) = ''
        )::integer AS missing_english_names,
        COUNT(*) FILTER (
          WHERE BTRIM(COALESCE(effect, '')) <> ''
            AND BTRIM(COALESCE(en_effect_official, '')) = ''
        )::integer AS missing_english_effects
      FROM cards
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE localized.lang = 'ja')::integer AS japanese_rows,
        COUNT(*) FILTER (WHERE localized.lang = 'en')::integer AS english_rows,
        COUNT(*) FILTER (
          WHERE localized.lang = 'ja' AND localized.review_status <> 'official'
        )::integer AS invalid_japanese_statuses,
        COUNT(*) FILTER (
          WHERE localized.lang = 'en' AND localized.review_status = 'pending_review'
        )::integer AS pending_english_rows,
        COUNT(*) FILTER (
          WHERE localized.lang = 'en' AND BTRIM(localized.name_text) = ''
        )::integer AS missing_localized_english_names,
        COUNT(*) FILTER (
          WHERE localized.lang = 'en'
            AND BTRIM(COALESCE(cards.effect, '')) <> ''
            AND BTRIM(localized.effect_text) = ''
        )::integer AS missing_localized_english_effects
      FROM card_texts_i18n localized
      JOIN cards ON cards.id = localized.card_id
      WHERE localized.lang IN ('ja', 'en')
    `),
    pool.query(`
      SELECT
        COUNT(*)::integer AS errata_count,
        COALESCE(ARRAY_AGG(card_id ORDER BY card_id), ARRAY[]::text[]) AS card_ids,
        COUNT(*) FILTER (
          WHERE BTRIM(corrected_japanese_text) = ''
            OR BTRIM(corrected_english_text) = ''
            OR corrected_english_status = 'pending_review'
            OR BTRIM(corrected_english_source) = ''
            OR BTRIM(source_url) = ''
        )::integer AS incomplete_errata
      FROM card_official_errata
    `),
    pool.query(`
      SELECT COUNT(*)::integer AS mismatch_count
      FROM cards
      FULL OUTER JOIN card_official_errata errata ON errata.card_id = cards.id
      WHERE cards.id IS NULL
        OR cards.has_official_errata IS DISTINCT FROM (errata.card_id IS NOT NULL)
        OR (
          errata.card_id IS NOT NULL
          AND (
            cards.official_errata_id IS DISTINCT FROM errata.errata_id
            OR cards.official_errata_affects_name IS DISTINCT FROM errata.affects_name
            OR cards.official_errata_affects_effect IS DISTINCT FROM errata.affects_effect
            OR cards.official_errata_url IS DISTINCT FROM errata.source_url
          )
        )
        OR (
          errata.card_id IS NULL
          AND (
            cards.official_errata_id IS NOT NULL
            OR cards.official_errata_affects_name
            OR cards.official_errata_affects_effect
            OR cards.official_errata_url <> ''
          )
        )
    `),
  ];
  if (requireLedger) {
    queries.push(
      pool.query(
        `SELECT dataset_sha256, extraction_sha256, errata_sha256, review_provenance_sha256, release_sha,
                card_count, errata_count
         FROM official_card_data_releases
         WHERE dataset_sha256 = $1
         LIMIT 1`,
        [manifest.datasetSha256],
      ),
    );
  }
  if (requireExact) {
    queries.push(
      pool.query(
        `SELECT id, name, effect, en_name_official, en_effect_official
         FROM cards
         ORDER BY id`,
      ),
      pool.query(
        `SELECT card_id, lang, name_text, effect_text, name_source, effect_source,
                review_status, review_note
         FROM card_texts_i18n
         WHERE lang IN ('ja', 'en')
         ORDER BY card_id, lang`,
      ),
      pool.query(
        `SELECT errata_id, card_id, published_at::text, affects_name, affects_effect,
                incorrect_text, corrected_japanese_text, corrected_english_text,
                corrected_english_status, corrected_english_source, source_url
         FROM card_official_errata
         ORDER BY card_id`,
      ),
    );
  }
  const results = await Promise.all(queries);
  const [cardsResult, textsResult, errataResult, flagResult] = results;
  let resultIndex = 4;
  const ledgerResult = requireLedger ? results[resultIndex++] : undefined;
  const exactCards = requireExact ? results[resultIndex++] : undefined;
  const exactTexts = requireExact ? results[resultIndex++] : undefined;
  const exactErrata = requireExact ? results[resultIndex++] : undefined;

  const cards = cardsResult.rows[0];
  const texts = textsResult.rows[0];
  const errata = errataResult.rows[0];
  const flags = flagResult.rows[0];
  const actualErrataCardIds = Array.isArray(errata?.card_ids) ? errata.card_ids.map(String).sort() : [];
  const expectedIds = [...expectedErrataCardIds].map(String).sort();
  const problems = [];

  if (count(cards, 'card_count') !== expectedCardCount) {
    problems.push(`expected ${expectedCardCount} cards, got ${cards?.card_count ?? 'unknown'}`);
  }
  if (count(cards, 'missing_english_names') !== 0) {
    problems.push(`${cards?.missing_english_names ?? 'unknown'} cards are missing official English names`);
  }
  if (count(cards, 'missing_english_effects') !== 0) {
    problems.push(`${cards?.missing_english_effects ?? 'unknown'} effect cards are missing official English effects`);
  }
  if (count(texts, 'japanese_rows') !== expectedCardCount || count(texts, 'english_rows') !== expectedCardCount) {
    problems.push(
      `localized official rows are incomplete (ja=${texts?.japanese_rows ?? 'unknown'}, en=${texts?.english_rows ?? 'unknown'})`,
    );
  }
  for (const [key, label] of [
    ['invalid_japanese_statuses', 'Japanese rows with a non-official status'],
    ['pending_english_rows', 'English rows still pending review'],
    ['missing_localized_english_names', 'localized English names are empty'],
    ['missing_localized_english_effects', 'localized English effects are empty'],
  ]) {
    if (count(texts, key) !== 0) problems.push(`${texts?.[key] ?? 'unknown'} ${label}`);
  }
  if (count(errata, 'errata_count') !== expectedIds.length) {
    problems.push(`expected ${expectedIds.length} errata rows, got ${errata?.errata_count ?? 'unknown'}`);
  }
  if (JSON.stringify(actualErrataCardIds) !== JSON.stringify(expectedIds)) {
    problems.push('errata card IDs do not match the signed release dataset');
  }
  if (count(errata, 'incomplete_errata') !== 0) {
    problems.push(`${errata?.incomplete_errata ?? 'unknown'} errata rows are incomplete or unreviewed`);
  }
  if (count(flags, 'mismatch_count') !== 0) {
    problems.push(`${flags?.mismatch_count ?? 'unknown'} card errata flags disagree with errata rows`);
  }
  if (requireLedger) {
    const ledger = ledgerResult?.rows?.[0];
    if (!ledger) {
      problems.push(`signed dataset ${manifest.datasetSha256} has no completed release ledger row`);
    } else {
      if (
        ledger.dataset_sha256 !== manifest.datasetSha256 ||
        ledger.extraction_sha256 !== manifest.extractionSha256 ||
        ledger.errata_sha256 !== manifest.errataSha256 ||
        ledger.review_provenance_sha256 !== manifest.reviewProvenanceSha256 ||
        count(ledger, 'card_count') !== manifest.cardCount ||
        count(ledger, 'errata_count') !== manifest.errataCount
      ) {
        problems.push('signed dataset ledger metadata does not match the release image');
      }
      if (!/^[a-f0-9]{40}$/.test(String(ledger.release_sha || ''))) {
        problems.push('signed dataset ledger is missing a full release commit SHA');
      }
    }
  }
  if (requireExact) {
    problems.push(
      ...exactSignedDataProblems(manifest, exactCards?.rows || [], exactTexts?.rows || [], exactErrata?.rows || []),
    );
  }

  if (problems.length > 0) {
    throw new Error(`official card data gate failed:\n- ${problems.join('\n- ')}`);
  }

  return {
    cardCount: expectedCardCount,
    errataCount: expectedIds.length,
    checksum: manifest.datasetSha256,
    extractionSha256: manifest.extractionSha256,
    errataSha256: manifest.errataSha256,
    reviewProvenanceSha256: manifest.reviewProvenanceSha256,
  };
}

async function main() {
  assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
  const connectionString = postgresConnectionString(process.env);
  const pool = new Pool({
    ...(connectionString
      ? { connectionString }
      : {
          host: process.env.PG_HOST || 'localhost',
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_USER || process.env.PG_MIGRATION_USER || 'postgres',
          password: process.env.PG_PASSWORD || '',
          database: process.env.PG_DATABASE || 'postgres',
        }),
    ssl: postgresSslConfig(process.env),
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const result = await assertOfficialCardData(pool);
    console.log(
      `official card data gate: ${result.cardCount} cards, ${result.errataCount} errata (${result.checksum})`,
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_CARD_COUNT,
  assertOfficialCardData,
  loadExpectedErrataCardIds,
  loadOfficialCardDataManifest,
  officialCardDataChecksum,
};
