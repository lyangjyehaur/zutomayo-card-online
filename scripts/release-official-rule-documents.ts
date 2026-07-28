import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCanonicalRulesTerminology } from '../src/rulesTerminology';
import { OFFICIAL_TRANSLATION_LOCALES, type OfficialTranslationLocale } from './officialRulingsData';

const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');
const { postgresConnectionString, postgresSslConfig } = require('../api/runtimeSecurityConfig.cjs') as {
  postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
  postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
};

type DocumentId = 'grand' | 'floor';

const OFFICIAL_RULES_INDEX_URL = 'https://zutomayocard.net/rule/';
const FLOOR_SECTION_IDS = [
  'overview',
  'chapter-1',
  'chapter-1-spectators',
  'chapter-2',
  'chapter-3',
  'chapter-3-organizer',
  'chapter-3-judge',
  'chapter-3-staff',
  'chapter-3-player',
  'chapter-3-spectator',
  'chapter-4',
  'chapter-4-cards',
  'chapter-4-proxies',
  'chapter-4-sleeves',
  'chapter-4-playmat',
  'chapter-4-clock',
  'chapter-4-notes',
  'chapter-5',
  'chapter-6',
  'chapter-6-procedure',
  'chapter-6-precautions',
  'chapter-6-judge',
  'chapter-7',
  'chapter-7-game-result',
  'chapter-7-turn-end',
  'chapter-7-match-result',
  'chapter-7-bo3',
  'chapter-7-bo3-time',
  'chapter-7-reporting',
  'chapter-7-concession',
  'chapter-8',
  'chapter-9',
  'chapter-10',
  'chapter-10-caution',
  'chapter-10-warning',
  'chapter-10-game-loss',
  'chapter-10-disqualification',
  'chapter-10-suspension',
] as const;
const FLOOR_TRANSLATION_MINIMUM_LENGTHS: Record<OfficialTranslationLocale, number> = {
  'zh-TW': 7_500,
  'zh-CN': 7_500,
  'zh-HK': 7_500,
  en: 23_000,
  ko: 11_500,
};

interface SectionTranslation {
  title: string;
  body: string;
}

interface RuleSectionInput {
  id: string;
  number: string;
  parentId?: string | null;
  level: number;
  order: number;
  pageStart: number;
  pageEnd: number;
  titleJa: string;
  bodyJa: string;
  translations: Record<OfficialTranslationLocale, SectionTranslation>;
}

interface RuleDocumentInput {
  id: DocumentId;
  version: string;
  publishedAt: string;
  titleJa: string;
  summaryJa: string;
  sourceUrl: string;
  sourceSha256: string;
  pageCount: number;
  sections: RuleSectionInput[];
}

interface RuleDocumentsSnapshot {
  schemaVersion: 1;
  sourceCheckedAt: string;
  provider: 'direct';
  locales: OfficialTranslationLocale[];
  documents: RuleDocumentInput[];
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nonEmpty(value: unknown, label: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new Error(`${label} must not be empty`);
  return result;
}

function floorStructureMarkers(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim().match(/^(?:●|・|※|\d+\.)/)?.[0])
    .filter((marker): marker is string => Boolean(marker));
}

export function validateSnapshot(value: unknown): RuleDocumentsSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Rule document release input must be an object');
  const snapshot = value as RuleDocumentsSnapshot;
  if (snapshot.schemaVersion !== 1 || snapshot.provider !== 'direct') {
    throw new Error('Unsupported official rule document release schema');
  }
  if (JSON.stringify(snapshot.locales) !== JSON.stringify(OFFICIAL_TRANSLATION_LOCALES)) {
    throw new Error('Official rule document release must contain all five locales in canonical order');
  }
  if (!Array.isArray(snapshot.documents) || snapshot.documents.length !== 2) {
    throw new Error('Official rule document release must contain Grand Rules and Floor Rules');
  }
  const ids = snapshot.documents.map((document) => document.id).sort();
  if (ids.join(',') !== 'floor,grand') throw new Error('Official rule document ids must be grand and floor');
  nonEmpty(snapshot.sourceCheckedAt, 'sourceCheckedAt');

  for (const document of snapshot.documents) {
    nonEmpty(document.version, `${document.id}.version`);
    nonEmpty(document.titleJa, `${document.id}.titleJa`);
    nonEmpty(document.summaryJa, `${document.id}.summaryJa`);
    if (!/^https:\/\//.test(document.sourceUrl)) throw new Error(`${document.id}.sourceUrl must use HTTPS`);
    if (!/^[a-f0-9]{64}$/.test(document.sourceSha256)) throw new Error(`${document.id}.sourceSha256 is invalid`);
    if (!Number.isInteger(document.pageCount) || document.pageCount < 1) {
      throw new Error(`${document.id}.pageCount is invalid`);
    }
    if (!Array.isArray(document.sections) || document.sections.length < 2) {
      throw new Error(`${document.id} must contain an overview and at least one rule section`);
    }
    const sectionIds = new Set<string>();
    for (const section of document.sections) {
      if (sectionIds.has(section.id)) throw new Error(`${document.id} has duplicate section ${section.id}`);
      sectionIds.add(nonEmpty(section.id, `${document.id}.section.id`));
      nonEmpty(section.titleJa, `${document.id}.${section.id}.titleJa`);
      if (typeof section.bodyJa !== 'string') {
        throw new Error(`${document.id}.${section.id}.bodyJa must be a string`);
      }
      if (!Number.isInteger(section.order) || section.order < 0) throw new Error(`${section.id}.order is invalid`);
      if (!Number.isInteger(section.level) || section.level < 1 || section.level > 4) {
        throw new Error(`${section.id}.level is invalid`);
      }
      if (
        !Number.isInteger(section.pageStart) ||
        !Number.isInteger(section.pageEnd) ||
        section.pageStart < 1 ||
        section.pageEnd < section.pageStart ||
        section.pageEnd > document.pageCount
      ) {
        throw new Error(`${section.id}.pages are invalid`);
      }
      for (const locale of OFFICIAL_TRANSLATION_LOCALES) {
        const translation = section.translations?.[locale];
        if (!translation) throw new Error(`${document.id}.${section.id}.${locale} is missing`);
        const title = nonEmpty(translation.title, `${document.id}.${section.id}.${locale}.title`);
        if (typeof translation.body !== 'string') {
          throw new Error(`${document.id}.${section.id}.${locale}.body must be a string`);
        }
        const body = translation.body.trim();
        if (Boolean(section.bodyJa.trim()) !== Boolean(body)) {
          throw new Error(
            `${document.id}.${section.id}.${locale}.body must match the source section's structural/content state`,
          );
        }
        assertCanonicalRulesTerminology(locale, `${title}\n${body}`, `${document.id}.${section.id}.${locale}`);
      }
    }
    for (const section of document.sections) {
      if (section.parentId && !sectionIds.has(section.parentId)) {
        throw new Error(`${document.id}.${section.id} references missing parent ${section.parentId}`);
      }
    }
    if (document.id === 'grand') {
      const chapterNumbers = document.sections
        .filter((section) => section.level === 1 && section.id !== 'overview')
        .map((section) => section.number);
      const expectedChapters = Array.from({ length: 10 }, (_, index) => String(index + 1));
      if (JSON.stringify(chapterNumbers) !== JSON.stringify(expectedChapters)) {
        throw new Error('Grand Rules release must preserve the official chapter structure from 1 through 10');
      }
      const numberedRuleIds = document.sections.flatMap((section) => [
        ...(section.number ? [section.number] : []),
        ...[...section.bodyJa.matchAll(/(?:^|\n)(\d+(?:\.\d+)+)(?=\s)/g)].map((match) => match[1]),
      ]);
      const uniqueNumberedRuleIds = new Set(numberedRuleIds);
      const sourceTextLength = document.sections.reduce(
        (total, section) => total + section.titleJa.length + section.bodyJa.length,
        0,
      );
      if (numberedRuleIds.length < 190 || uniqueNumberedRuleIds.size < 185 || sourceTextLength < 10_000) {
        throw new Error(
          'Grand Rules release is incomplete: the full numbered source text from the official PDF is required',
        );
      }
      for (const locale of OFFICIAL_TRANSLATION_LOCALES) {
        const translatedLength = document.sections.reduce(
          (total, section) =>
            total + section.translations[locale].title.length + section.translations[locale].body.length,
          0,
        );
        if (translatedLength < 7_000) {
          throw new Error(`Grand Rules ${locale} translation is incomplete (${translatedLength} characters)`);
        }
        for (const section of document.sections) {
          const sourceRuleIds = [...section.bodyJa.matchAll(/(?:^|\n)(\d+(?:\.\d+)+)(?=\s)/g)].map((match) => match[1]);
          const translatedRuleIds = [
            ...section.translations[locale].body.matchAll(/(?:^|\n)(\d+(?:\.\d+)+)(?=\s)/g),
          ].map((match) => match[1]);
          if (JSON.stringify(sourceRuleIds) !== JSON.stringify(translatedRuleIds)) {
            throw new Error(`Grand Rules ${section.id}.${locale} does not preserve every numbered rule`);
          }
        }
      }
    }
    if (document.id === 'floor') {
      const chapterNumbers = document.sections
        .filter((section) => section.level === 1 && section.id !== 'overview')
        .map((section) => section.number);
      const expectedChapters = Array.from({ length: 10 }, (_, index) => String(index + 1));
      if (JSON.stringify(chapterNumbers) !== JSON.stringify(expectedChapters)) {
        throw new Error('Floor Rules release must preserve the official chapter structure from 1 through 10');
      }
      if (JSON.stringify(document.sections.map((section) => section.id)) !== JSON.stringify(FLOOR_SECTION_IDS)) {
        throw new Error(
          'Floor Rules release must preserve every reviewed chapter and subsection from the official PDF',
        );
      }
      const sourceTextLength = document.sections.reduce(
        (total, section) => total + section.titleJa.length + section.bodyJa.length,
        0,
      );
      const sourceMarkerCount = document.sections.reduce(
        (total, section) => total + floorStructureMarkers(section.bodyJa).length,
        0,
      );
      if (sourceTextLength < 12_000 || sourceMarkerCount < 140) {
        throw new Error(
          'Floor Rules release is incomplete: the full structured source text from the official PDF is required',
        );
      }
      for (const locale of OFFICIAL_TRANSLATION_LOCALES) {
        const translatedLength = document.sections.reduce(
          (total, section) =>
            total + section.translations[locale].title.length + section.translations[locale].body.length,
          0,
        );
        if (translatedLength < FLOOR_TRANSLATION_MINIMUM_LENGTHS[locale]) {
          throw new Error(`Floor Rules ${locale} translation is incomplete (${translatedLength} characters)`);
        }
        for (const section of document.sections) {
          if (
            JSON.stringify(floorStructureMarkers(section.bodyJa)) !==
            JSON.stringify(floorStructureMarkers(section.translations[locale].body))
          ) {
            throw new Error(`Floor Rules ${section.id}.${locale} does not preserve every list item and numbered step`);
          }
        }
      }
    }
  }
  return snapshot;
}

async function verifyOfficialPdf(document: RuleDocumentInput, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(document.sourceUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; ZutomayoCardOnlineRulesSync/1.0)',
      referer: 'https://zutomayocard.net/rule/',
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Cannot download ${document.id} PDF: HTTP ${response.status}`);
  const digest = createHash('sha256')
    .update(Buffer.from(await response.arrayBuffer()))
    .digest('hex');
  if (digest !== document.sourceSha256) {
    throw new Error(`${document.id} PDF changed: expected ${document.sourceSha256}, received ${digest}`);
  }
}

export async function verifyCurrentOfficialSources(
  documents: RuleDocumentInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const listingResponse = await fetchImpl(OFFICIAL_RULES_INDEX_URL, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; ZutomayoCardOnlineRulesSync/1.0)' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!listingResponse.ok) {
    throw new Error(`Cannot read the official rules index: HTTP ${listingResponse.status}`);
  }
  const listingHtml = await listingResponse.text();
  for (const document of documents) {
    if (!listingHtml.includes(document.sourceUrl)) {
      throw new Error(`${document.id} PDF is no longer listed by the official rules index`);
    }
  }
  await Promise.all(documents.map((document) => verifyOfficialPdf(document, fetchImpl)));
}

function createPool() {
  const connectionString = postgresConnectionString(process.env);
  return new Pool({
    ...(connectionString
      ? { connectionString }
      : {
          host: process.env.PG_HOST || 'localhost',
          port: Number(process.env.PG_PORT) || 5432,
          user: process.env.PG_MIGRATION_USER || process.env.PG_USER || 'postgres',
          password: process.env.PG_MIGRATION_PASSWORD || process.env.PG_PASSWORD || '',
          database: process.env.PG_DATABASE || 'postgres',
        }),
    ssl: postgresSslConfig(process.env),
    max: 1,
  });
}

async function upsertDocument(client: import('pg').PoolClient, document: RuleDocumentInput, sourceCheckedAt: string) {
  const documentHash = hash({
    ...document,
    sections: document.sections.map(({ translations: _translations, ...section }) => section),
  });
  await client.query(
    `INSERT INTO official_rule_documents
       (document_id,document_version,title_ja,summary_ja,published_at,source_url,source_sha256,
        source_page_count,content_hash,publication_status,source_checked_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'candidate',$10::timestamptz,NOW())
     ON CONFLICT (document_id,document_version) DO UPDATE SET
       title_ja=EXCLUDED.title_ja, summary_ja=EXCLUDED.summary_ja, published_at=EXCLUDED.published_at,
       source_url=EXCLUDED.source_url, source_sha256=EXCLUDED.source_sha256,
       source_page_count=EXCLUDED.source_page_count, content_hash=EXCLUDED.content_hash,
       source_checked_at=EXCLUDED.source_checked_at, updated_at=NOW()`,
    [
      document.id,
      document.version,
      document.titleJa,
      document.summaryJa,
      document.publishedAt,
      document.sourceUrl,
      document.sourceSha256,
      document.pageCount,
      documentHash,
      sourceCheckedAt,
    ],
  );

  for (const section of document.sections) {
    const sectionHash = hash({ title: section.titleJa, body: section.bodyJa });
    await client.query(
      `INSERT INTO official_rule_sections
         (document_id,document_version,section_id,section_number,parent_section_id,level,sort_order,
          page_start,page_end,title_ja,body_ja,content_hash,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (document_id,document_version,section_id) DO UPDATE SET
         section_number=EXCLUDED.section_number, parent_section_id=EXCLUDED.parent_section_id,
         level=EXCLUDED.level, sort_order=EXCLUDED.sort_order, page_start=EXCLUDED.page_start,
         page_end=EXCLUDED.page_end, title_ja=EXCLUDED.title_ja, body_ja=EXCLUDED.body_ja,
         content_hash=EXCLUDED.content_hash, updated_at=NOW()`,
      [
        document.id,
        document.version,
        section.id,
        section.number,
        section.parentId || null,
        section.level,
        section.order,
        section.pageStart,
        section.pageEnd,
        section.titleJa,
        section.bodyJa,
        sectionHash,
      ],
    );
    for (const locale of OFFICIAL_TRANSLATION_LOCALES) {
      const translation = section.translations[locale];
      await client.query(
        `INSERT INTO official_rule_section_translations
           (document_id,document_version,section_id,locale,title_text,body_text,status,provider,model,
            review_note,reviewed_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'verified','reviewed-direct','direct-v1',
                 'Directly translated and reviewed against the official Japanese PDF.',NOW(),NOW())
         ON CONFLICT (document_id,document_version,section_id,locale) DO UPDATE SET
           title_text=EXCLUDED.title_text, body_text=EXCLUDED.body_text, status='verified',
           provider=EXCLUDED.provider, model=EXCLUDED.model, review_note=EXCLUDED.review_note,
           reviewed_at=NOW(), updated_at=NOW()`,
        [document.id, document.version, section.id, locale, translation.title, translation.body],
      );
    }
  }

  await client.query(
    `DELETE FROM official_rule_sections
      WHERE document_id=$1 AND document_version=$2 AND NOT (section_id=ANY($3::text[]))`,
    [document.id, document.version, document.sections.map((section) => section.id)],
  );
  const expected = document.sections.length * OFFICIAL_TRANSLATION_LOCALES.length;
  const count = Number(
    (
      await client.query(
        `SELECT COUNT(*)::int AS count
           FROM official_rule_section_translations
          WHERE document_id=$1 AND document_version=$2
            AND locale=ANY($3::text[]) AND status='verified' AND title_text<>''`,
        [document.id, document.version, OFFICIAL_TRANSLATION_LOCALES],
      )
    ).rows[0]?.count || 0,
  );
  if (count !== expected) throw new Error(`${document.id} translation release is incomplete (${count}/${expected})`);
}

async function activateDocument(client: import('pg').PoolClient, document: RuleDocumentInput) {
  await client.query(
    `UPDATE official_rule_documents SET publication_status='superseded',updated_at=NOW()
      WHERE document_id=$1 AND publication_status='active' AND document_version<>$2`,
    [document.id, document.version],
  );
  await client.query(
    `UPDATE official_rule_documents SET publication_status='active',updated_at=NOW()
      WHERE document_id=$1 AND document_version=$2`,
    [document.id, document.version],
  );
  await client.query(
    `INSERT INTO official_rule_active_versions (document_id,document_version,activated_at)
     VALUES ($1,$2,NOW())
     ON CONFLICT (document_id) DO UPDATE SET document_version=EXCLUDED.document_version,activated_at=NOW()`,
    [document.id, document.version],
  );
}

export async function main() {
  const inputPath = process.env.OFFICIAL_RULE_DOCUMENTS_FILE;
  if (!inputPath) throw new Error('OFFICIAL_RULE_DOCUMENTS_FILE is required');
  const snapshot = validateSnapshot(JSON.parse(await readFile(path.resolve(inputPath), 'utf8')));
  await verifyCurrentOfficialSources(snapshot.documents);
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('official-rule-documents-release'))");
    for (const document of snapshot.documents) await upsertDocument(client, document, snapshot.sourceCheckedAt);
    for (const document of snapshot.documents) await activateDocument(client, document);
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        documents: snapshot.documents.map((document) => ({
          id: document.id,
          version: document.version,
          sections: document.sections.length - 1,
          sourceSha256: document.sourceSha256,
        })),
        locales: snapshot.locales,
        sourceCheckedAt: snapshot.sourceCheckedAt,
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
