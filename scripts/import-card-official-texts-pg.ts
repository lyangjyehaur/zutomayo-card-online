import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');
const { assertPostgresExpectedRole, postgresConnectionString, postgresSslConfig } =
  require('../api/runtimeSecurityConfig.cjs') as {
    assertPostgresExpectedRole: (env: NodeJS.ProcessEnv, expectedRoleVariable: string) => string;
    postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
    postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
  };

type ExtractedCard = {
  id: string;
  japaneseName: string;
  enNameOfficial: string;
  nameStatus: string;
  japaneseEffect: string;
  enEffectOfficial: string;
  effectStatus: string;
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

type OfficialCardDataManifest = {
  cards: ExtractedCard[];
  errata: OfficialErrata[];
  cardCount: number;
  errataCount: number;
  datasetSha256: string;
  extractionSha256: string;
  errataSha256: string;
  reviewProvenanceSha256: string;
};

const { assertOfficialCardData, loadOfficialCardDataManifest } = require('./card-data-gate.cjs') as {
  assertOfficialCardData: (
    pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> },
    options: { manifest: OfficialCardDataManifest; requireLedger: boolean; requireExact: boolean },
  ) => Promise<unknown>;
  loadOfficialCardDataManifest: (options?: {
    extractionPath?: string;
    errataPath?: string;
    humanReviewsPath?: string;
    ocrOverridesPath?: string;
  }) => OfficialCardDataManifest;
};

const source = process.argv[2] || process.env.CARD_EXTRACTION_SOURCE || 'data/card-english-extraction.json';
const cards = (JSON.parse(fs.readFileSync(source, 'utf8')) as { cards: ExtractedCard[] }).cards;
const errataSource = process.env.CARD_ERRATA_SOURCE || 'data/card-official-errata.json';
const officialErrata = (JSON.parse(fs.readFileSync(errataSource, 'utf8')) as { errata: OfficialErrata[] }).errata;
if (
  cards.some(
    (card) =>
      card.nameStatus !== 'human_verified' ||
      (card.japaneseEffect ? card.effectStatus !== 'human_verified' : card.effectStatus !== 'not_applicable'),
  )
) {
  throw new Error('Refusing import: every printed English name/effect must be human-reviewed');
}
if (officialErrata.length !== 12 || new Set(officialErrata.map((entry) => entry.cardId)).size !== 12) {
  throw new Error('Refusing import: official errata source must contain 12 unique cards');
}

const migrationUser = assertPostgresExpectedRole(process.env, 'PG_MIGRATION_USER');
const releaseSha = String(process.env.RELEASE_SHA || '')
  .trim()
  .toLowerCase();
if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
  throw new Error('RELEASE_SHA must be the full 40-character commit for an official card data import');
}
const cardDataManifest = loadOfficialCardDataManifest({
  extractionPath: source,
  errataPath: errataSource,
  humanReviewsPath: process.env.CARD_HUMAN_REVIEWS_SOURCE,
  ocrOverridesPath: process.env.CARD_OCR_OVERRIDES_SOURCE,
});
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
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('zutomayo:official-card-data-release'))");
    const previouslyApplied = await client.query(
      `SELECT dataset_sha256
       FROM official_card_data_releases
       WHERE dataset_sha256 = $1
       LIMIT 1`,
      [cardDataManifest.datasetSha256],
    );
    if (previouslyApplied.rows.length > 0) {
      await assertOfficialCardData(client, {
        manifest: cardDataManifest,
        requireLedger: true,
        requireExact: false,
      });
      await client.query('COMMIT');
      console.log(
        `Official card dataset ${cardDataManifest.datasetSha256} was already applied; preserving audited edits.`,
      );
      return;
    }
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

    const cardsById = new Map(cards.map((card) => [card.id, card]));
    for (const entry of officialErrata) {
      const card = cardsById.get(entry.cardId);
      if (!card) {
        mismatches.push(`${entry.cardId}: official errata card missing from extraction`);
        continue;
      }
      const correctedJapanese = entry.fields.includes('name') ? card.japaneseName : card.japaneseEffect;
      if (correctedJapanese !== entry.correctedJapaneseText) {
        mismatches.push(`${entry.cardId}: corrected Japanese does not match official card data`);
      }
      if (entry.correctedEnglishSource === 'official_card_print_unaffected') {
        const printedEnglish = entry.fields.includes('name') ? card.enNameOfficial : card.enEffectOfficial;
        if (entry.correctedEnglishText !== printedEnglish) {
          mismatches.push(`${entry.cardId}: unaffected English does not exactly match reviewed card print`);
        }
      }
    }
    if (mismatches.length > 0) {
      throw new Error(`Refusing import due to official errata mismatch:\n${mismatches.join('\n')}`);
    }

    for (const card of cards) {
      await client.query(
        `UPDATE cards
         SET en_name_official = $2, en_effect_official = $3, updated_at = NOW()
         WHERE id = $1`,
        [card.id, card.enNameOfficial, card.enEffectOfficial],
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
      if (!card) throw new Error(`${entry.cardId}: missing extraction after validation`);
      const affectsName = entry.fields.includes('name');
      const affectsEffect = entry.fields.includes('effect');
      const correctedEnglish =
        entry.correctedEnglishSource === 'official_card_print_unaffected'
          ? affectsName
            ? card.enNameOfficial
            : card.enEffectOfficial
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

    await client.query(
      `INSERT INTO official_card_data_releases (
         dataset_sha256, extraction_sha256, errata_sha256, review_provenance_sha256, release_sha,
         card_count, errata_count
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        cardDataManifest.datasetSha256,
        cardDataManifest.extractionSha256,
        cardDataManifest.errataSha256,
        cardDataManifest.reviewProvenanceSha256,
        releaseSha,
        cardDataManifest.cardCount,
        cardDataManifest.errataCount,
      ],
    );
    await assertOfficialCardData(client, {
      manifest: cardDataManifest,
      requireLedger: true,
      requireExact: true,
    });
    await client.query('COMMIT');
    console.log(
      `Imported canonical official Japanese/English text for ${cards.length} cards and ${officialErrata.length} errata.`,
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
