import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeOfficialText,
  officialCorrectedNameMatches,
  normalizeQaRows,
  officialContentHash,
  type OfficialErrataSnapshotRow,
  type OfficialQaSnapshotRow,
} from './officialRulingsData';

const QA_DATA_URL =
  'https://script.google.com/macros/s/AKfycbxezC8Yd98DvURUQCOVlPawdRyu2XHCsBIRbWCGx_IKlqv6DTX2behOrEx0r8HiWhtTxw/exec';
const ERRATA_BASE_URL = 'https://zutomayocard.net/errata/';
const require = createRequire(import.meta.url);
const { Pool } = require('pg') as typeof import('pg');
const { assertPostgresExpectedRole, postgresConnectionString, postgresSslConfig } =
  require('../api/runtimeSecurityConfig.cjs') as {
    assertPostgresExpectedRole: (env: NodeJS.ProcessEnv, expectedRoleVariable: string) => string;
    postgresConnectionString: (env: NodeJS.ProcessEnv) => string | undefined;
    postgresSslConfig: (env: NodeJS.ProcessEnv) => false | { rejectUnauthorized: boolean; ca?: string };
  };
const args = new Set(process.argv.slice(2));
const optionValue = (name: string) => {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const fixtureDir = optionValue('--fixture-dir');
const reportPath = optionValue('--report');
const baselineApi = optionValue('--baseline-api') || process.env.OFFICIAL_RULINGS_BASELINE_API_URL;

const PACK_PREFIX = new Map([
  ['THE WORLD IS CHANGING', '1st'],
  ['ALL ALONG THE WATCHTOWER', '2nd'],
  ['Off Minor', '3rd'],
  ['Fantasy Is Reality', '4th'],
]);
const NAME_ERRATA_IDS = new Set(['006', '011']);

async function fetchText(url: string): Promise<string> {
  if (fixtureDir) return readFile(fixtureFileForUrl(url, fixtureDir), 'utf8');
  const response = await fetch(url, {
    headers: { Accept: 'text/html,application/json', 'User-Agent': 'zutomayo-card-online-official-sync/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Official source returned HTTP ${response.status}: ${url}`);
  return response.text();
}

export function fixtureFileForUrl(url: string, directory: string): string {
  if (url === QA_DATA_URL) return path.resolve(directory, 'qa-source.json');
  const parsed = new URL(url);
  const detail = parsed.pathname.match(/^\/errata\/(\d{3})\/$/);
  if (detail) return path.resolve(directory, `errata-${detail[1]}.html`);
  const page = parsed.searchParams.get('page') || '1';
  if (parsed.pathname === '/errata/') return path.resolve(directory, `errata-page-${page}.html`);
  throw new Error(`No official-rulings fixture mapping for ${url}`);
}

function mainHtml(html: string): string {
  const match = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (!match) throw new Error('Official page is missing <main>');
  return match[1];
}

function paragraphs(html: string): string[] {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => normalizeOfficialText(match[1]))
    .filter(Boolean);
}

export function parseErrataList(html: string): Array<{ errataId: string; publishedAt: string }> {
  const main = mainHtml(html);
  const items = [
    ...main.matchAll(
      /<a\b[^>]*href=["'](?:https:\/\/zutomayocard\.net)?\/errata\/(\d{3})\/["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ]
    .map((match) => ({ errataId: match[1], publishedAt: paragraphs(match[2])[0] || '' }))
    .filter((item) => /^\d{4}\.\d{2}\.\d{2}$/.test(item.publishedAt))
    .map((item) => ({ ...item, publishedAt: item.publishedAt.replaceAll('.', '-') }));
  if (items.length === 0) throw new Error('Official errata list parser found no entries');
  return items;
}

function cardIdFor(pack: string, cardNumber: string): string {
  const prefix = PACK_PREFIX.get(pack);
  const number = Number(cardNumber.split('/')[0]);
  if (!prefix || !Number.isInteger(number) || number <= 0) {
    throw new Error(`Cannot map official errata card: ${pack} ${cardNumber}`);
  }
  return `${prefix}_${number}`;
}

export function parseErrataDetail(
  html: string,
  meta: { errataId: string; publishedAt: string },
): OfficialErrataSnapshotRow {
  const values = paragraphs(mainHtml(html));
  if (values[0] !== '誤' || values[2] !== '正') {
    throw new Error(`Official errata ${meta.errataId} has an unexpected correction layout`);
  }
  const row = {
    errataId: meta.errataId,
    cardId: cardIdFor(values[9] || '', values[11] || ''),
    publishedAt: meta.publishedAt,
    cardName: values[5] || '',
    rarity: values[7] || '',
    pack: values[9] || '',
    cardNumber: values[11] || '',
    incorrectText: values[1] || '',
    correctedText: values[3] || '',
    reason: values[12] || '',
    replacementPolicy: values[13] || '',
    usagePolicy: values.slice(14).join('\n'),
    sourceUrl: `${ERRATA_BASE_URL}${meta.errataId}/`,
  };
  for (const [field, value] of Object.entries(row)) {
    if (!value) throw new Error(`Official errata ${meta.errataId} has empty ${field}`);
  }
  return row;
}

async function fetchOfficialQa(): Promise<OfficialQaSnapshotRow[]> {
  const raw = JSON.parse(await fetchText(QA_DATA_URL)) as { qa?: unknown };
  const rows = normalizeQaRows(raw.qa, { requireExplicitPublic: true });
  const minimumRows = fixtureDir ? 1 : 50;
  if (rows.length < minimumRows) {
    throw new Error(`Official Q&A source unexpectedly returned only ${rows.length} public rows`);
  }
  return rows;
}

async function fetchOfficialErrata(): Promise<OfficialErrataSnapshotRow[]> {
  const entries = new Map<string, { errataId: string; publishedAt: string }>();
  let page = 1;
  while (page <= 20) {
    const url = page === 1 ? ERRATA_BASE_URL : `${ERRATA_BASE_URL}?page=${page}`;
    const html = await fetchText(url);
    for (const item of parseErrataList(html)) entries.set(item.errataId, item);
    if (!html.includes(`errata?page=${page + 1}`)) break;
    page += 1;
  }
  const details = await Promise.all(
    [...entries.values()].map(async (meta) =>
      parseErrataDetail(await fetchText(`${ERRATA_BASE_URL}${meta.errataId}/`), meta),
    ),
  );
  return details.sort((a, b) => a.errataId.localeCompare(b.errataId));
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function contentChanges<T extends { id?: string; errataId?: string; contentHash?: string }>(
  localRows: T[],
  remoteRows: T[],
  normalize: (row: T) => unknown,
) {
  const key = (row: T) => row.id || row.errataId || '';
  const local = new Map(localRows.map((row) => [key(row), row.contentHash || officialContentHash(normalize(row))]));
  const remote = new Map(remoteRows.map((row) => [key(row), officialContentHash(normalize(row))]));
  return {
    added: [...remote.keys()].filter((id) => !local.has(id)),
    removed: [...local.keys()].filter((id) => !remote.has(id)),
    updated: [...remote.keys()].filter((id) => local.has(id) && local.get(id) !== remote.get(id)),
  };
}

export function shouldFailSyncCheck(options: { check: boolean; changed: boolean; apply: boolean }): boolean {
  return options.check && options.changed && !options.apply;
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value ?? '').slice(0, 10);
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
          user: process.env.PG_USER || migrationUser || 'postgres',
          password: process.env.PG_PASSWORD || '',
          database: process.env.PG_DATABASE || 'postgres',
        }),
    ssl: postgresSslConfig(process.env),
    max: 1,
  });
}

async function loadPostgresSnapshot(client: import('pg').PoolClient) {
  const [qaResult, errataResult] = await Promise.all([
    client.query(
      `SELECT id, number, published_at, question_ja, answer_ja, tags, related_card_ids, content_hash
         FROM official_qa_items
        WHERE publication_status = 'published'
        ORDER BY number`,
    ),
    client.query(
      `SELECT errata.errata_id, errata.card_id, errata.published_at,
              card.name AS card_name, card.rarity, card.pack, errata.card_number,
              errata.incorrect_text,
              CASE WHEN errata.affects_name THEN card.name ELSE card.effect END AS corrected_text,
              errata.reason_ja, errata.replacement_policy_ja, errata.usage_policy_ja,
              errata.source_url, errata.content_hash
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
      contentHash: row.content_hash,
    })) as OfficialQaSnapshotRow[],
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
      contentHash: row.content_hash,
    })) as OfficialErrataSnapshotRow[],
  };
}

async function fetchBaselineApiSnapshot(baseUrl: string) {
  const base = `${baseUrl.replace(/\/+$/, '')}/`;
  const [qaResponse, errataResponse] = await Promise.all([
    fetch(new URL('official/qa?lang=ja', base), { signal: AbortSignal.timeout(20_000) }),
    fetch(new URL('official/errata?lang=ja', base), { signal: AbortSignal.timeout(20_000) }),
  ]);
  if (!qaResponse.ok || !errataResponse.ok) {
    throw new Error(
      `Official rulings baseline API unavailable: Q&A ${qaResponse.status}, errata ${errataResponse.status}`,
    );
  }
  const qaBody = (await qaResponse.json()) as {
    items?: Array<{
      id?: unknown;
      number?: unknown;
      publishedAt?: unknown;
      source?: { question?: unknown; answer?: unknown };
      tags?: unknown;
      relatedCardIds?: unknown;
    }>;
  };
  const errataBody = (await errataResponse.json()) as {
    items?: Array<{
      errataId?: unknown;
      cardId?: unknown;
      publishedAt?: unknown;
      cardNameJa?: unknown;
      rarity?: unknown;
      pack?: unknown;
      cardNumber?: unknown;
      source?: {
        incorrectText?: unknown;
        correctedText?: unknown;
        reason?: unknown;
        replacementPolicy?: unknown;
        usagePolicy?: unknown;
      };
      sourceUrl?: unknown;
    }>;
  };
  return {
    qa: (qaBody.items || []).map((item) => ({
      id: String(item.id || ''),
      number: Number(item.number),
      date: String(item.publishedAt || '').slice(0, 10),
      question: String(item.source?.question || ''),
      answer: String(item.source?.answer || ''),
      tags: Array.isArray(item.tags) ? item.tags : [],
      relatedCards: Array.isArray(item.relatedCardIds) ? item.relatedCardIds : [],
    })) as OfficialQaSnapshotRow[],
    errata: (errataBody.items || []).map((item) => ({
      errataId: String(item.errataId || ''),
      cardId: String(item.cardId || ''),
      publishedAt: String(item.publishedAt || '').slice(0, 10),
      cardName: String(item.cardNameJa || ''),
      rarity: String(item.rarity || ''),
      pack: String(item.pack || ''),
      cardNumber: String(item.cardNumber || ''),
      incorrectText: String(item.source?.incorrectText || ''),
      correctedText: String(item.source?.correctedText || ''),
      reason: String(item.source?.reason || ''),
      replacementPolicy: String(item.source?.replacementPolicy || ''),
      usagePolicy: String(item.source?.usagePolicy || ''),
      sourceUrl: String(item.sourceUrl || ''),
    })) as OfficialErrataSnapshotRow[],
  };
}

async function applySnapshots(
  client: import('pg').PoolClient,
  qaRows: OfficialQaSnapshotRow[],
  errataRows: OfficialErrataSnapshotRow[],
) {
  const cardRows = (await client.query('SELECT id, name, effect FROM cards')).rows as Array<{
    id: string;
    name: string;
    effect: string;
  }>;
  const cards = new Map(cardRows.map((card) => [card.id, card]));
  for (const cardId of new Set(qaRows.flatMap((row) => row.relatedCards))) {
    if (!cards.has(cardId)) throw new Error(`Official Q&A references unknown card ${cardId}`);
  }
  try {
    await client.query('BEGIN');
    for (const row of qaRows) {
      const hash = officialContentHash({
        number: row.number,
        date: row.date,
        question: row.question,
        answer: row.answer,
        tags: row.tags,
        relatedCards: row.relatedCards,
      });
      await client.query(
        `INSERT INTO official_qa_items (
           id, number, published_at, question_ja, answer_ja, tags, related_card_ids,
           source_url, content_hash, content_version, publication_status,
           source_updated_at, last_seen_at, updated_at
         ) VALUES (
           $1, $2, $3::date, $4, $5, $6::text[], $7::text[], $8, $9, 1,
           'published', $3::date::timestamptz, NOW(), NOW()
         )
         ON CONFLICT (id) DO UPDATE SET
           number = EXCLUDED.number,
           published_at = EXCLUDED.published_at,
           question_ja = EXCLUDED.question_ja,
           answer_ja = EXCLUDED.answer_ja,
           tags = EXCLUDED.tags,
           related_card_ids = EXCLUDED.related_card_ids,
           source_url = EXCLUDED.source_url,
           content_version = official_qa_items.content_version +
             CASE WHEN official_qa_items.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN 1 ELSE 0 END,
           content_hash = EXCLUDED.content_hash,
           publication_status = 'published',
           source_updated_at = EXCLUDED.source_updated_at,
           last_seen_at = NOW(),
           updated_at = CASE
             WHEN official_qa_items.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN NOW()
             ELSE official_qa_items.updated_at
           END`,
        [
          row.id,
          row.number,
          row.date,
          row.question,
          row.answer,
          row.tags,
          row.relatedCards,
          'https://zutomayocard.net/qa/',
          hash,
        ],
      );
    }
    await client.query(
      `UPDATE official_qa_items
          SET publication_status = 'inactive', updated_at = NOW()
        WHERE publication_status = 'published'
          AND NOT (id = ANY($1::text[]))`,
      [qaRows.map((row) => row.id)],
    );
    for (const row of errataRows) {
      const card = cards.get(row.cardId);
      if (!card) throw new Error(`Official errata references unknown card ${row.cardId}`);
      const affectsName = NAME_ERRATA_IDS.has(row.errataId);
      if (affectsName && !officialCorrectedNameMatches(row.correctedText, card.name)) {
        throw new Error(`Official errata ${row.errataId} corrected name does not match card ${row.cardId}`);
      }
      if (!affectsName && /[ぁ-んァ-ヶ一-龠]/.test(row.correctedText) && card.effect !== row.correctedText) {
        throw new Error(`Official errata ${row.errataId} corrected effect does not match card ${row.cardId}`);
      }
      const hash = officialContentHash({
        publishedAt: row.publishedAt,
        cardId: row.cardId,
        cardNumber: row.cardNumber,
        incorrectText: row.incorrectText,
        correctedText: row.correctedText,
        reason: row.reason,
        replacementPolicy: row.replacementPolicy,
        usagePolicy: row.usagePolicy,
      });
      const result = await client.query(
        `UPDATE card_official_errata
            SET published_at = $3,
                incorrect_text = $4,
                reason_ja = $5,
                replacement_policy_ja = $6,
                usage_policy_ja = $7,
                card_number = $8,
                source_url = $9,
                content_version = content_version +
                  CASE WHEN content_hash IS DISTINCT FROM $10 THEN 1 ELSE 0 END,
                content_hash = $10,
                publication_status = 'published',
                last_seen_at = NOW(),
                updated_at = CASE WHEN content_hash IS DISTINCT FROM $10 THEN NOW() ELSE updated_at END
          WHERE errata_id = $1 AND card_id = $2`,
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
          hash,
        ],
      );
      if (result.rowCount !== 1) {
        throw new Error(`Official errata ${row.errataId} is missing; import official card texts first`);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (args.has('--write')) throw new Error('--write was removed; official content is stored in PostgreSQL');
  if (args.has('--baseline-empty') && args.has('--apply')) {
    throw new Error('--baseline-empty is only available for read-only parser tests');
  }
  const needsPool = args.has('--apply') || (!baselineApi && !args.has('--baseline-empty'));
  const pool = needsPool ? createPool() : undefined;
  const client = pool ? await pool.connect() : undefined;
  try {
    const [remoteQa, remoteErrata, local] = await Promise.all([
      fetchOfficialQa(),
      fetchOfficialErrata(),
      baselineApi
        ? fetchBaselineApiSnapshot(baselineApi)
        : args.has('--baseline-empty')
          ? Promise.resolve({ qa: [], errata: [] })
          : loadPostgresSnapshot(client!),
    ]);
    const qaDiff = contentChanges(local.qa, remoteQa, (row) => ({
      number: row.number,
      date: row.date,
      question: row.question,
      answer: row.answer,
      tags: row.tags,
      relatedCards: row.relatedCards,
    }));
    const errataDiff = contentChanges(local.errata, remoteErrata, (row) => ({
      publishedAt: row.publishedAt,
      cardId: row.cardId,
      cardNumber: row.cardNumber,
      incorrectText: row.incorrectText,
      correctedText: row.correctedText,
      reason: row.reason,
      replacementPolicy: row.replacementPolicy,
      usagePolicy: row.usagePolicy,
    }));
    const qaChanged = Object.values(qaDiff).some((values) => values.length > 0);
    const errataChanged = Object.values(errataDiff).some((values) => values.length > 0);
    const report = {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      baseline: baselineApi ? 'public-api' : args.has('--baseline-empty') ? 'empty-test' : 'postgresql',
      qa: { local: local.qa.length, remote: remoteQa.length, changed: qaChanged, ...qaDiff },
      errata: { local: local.errata.length, remote: remoteErrata.length, changed: errataChanged, ...errataDiff },
    };
    console.log(JSON.stringify(report, null, 2));
    if (reportPath) await writeFile(path.resolve(reportPath), stableJson(report));
    if (args.has('--apply')) await applySnapshots(client!, remoteQa, remoteErrata);
    if (
      shouldFailSyncCheck({
        check: args.has('--check'),
        changed: qaChanged || errataChanged,
        apply: args.has('--apply'),
      })
    ) {
      process.exitCode = 2;
    }
  } finally {
    client?.release();
    await pool?.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
