import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface OfficialQaSnapshotRow {
  id: string;
  number: number;
  date: string;
  question: string;
  answer: string;
  tags: string[];
  relatedCards: string[];
}

export interface OfficialErrataSnapshotRow {
  errataId: string;
  cardId: string;
  publishedAt: string;
  cardName: string;
  rarity: string;
  pack: string;
  cardNumber: string;
  incorrectText: string;
  correctedText: string;
  reason: string;
  replacementPolicy: string;
  usagePolicy: string;
  sourceUrl: string;
}

export const OFFICIAL_TRANSLATION_LOCALES = ['zh-TW', 'zh-CN', 'zh-HK', 'en', 'ko'] as const;
export type OfficialTranslationLocale = (typeof OFFICIAL_TRANSLATION_LOCALES)[number];

export interface OfficialQaTranslationSeed {
  id: string;
  sourceHash: string;
  translations: Record<OfficialTranslationLocale, { question: string; answer: string }>;
}

export interface OfficialErrataTranslationSeed {
  errataId: string;
  sourceHash: string;
  translations: Record<
    OfficialTranslationLocale,
    { incorrectText: string; reason: string; replacementPolicy: string; usagePolicy: string }
  >;
}

export interface OfficialTranslationsSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  provider: string;
  locales: OfficialTranslationLocale[];
  qa: OfficialQaTranslationSeed[];
  errata: OfficialErrataTranslationSeed[];
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
};

export function normalizeOfficialText(value: unknown): string {
  return String(value ?? '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|quot|#39|lt|gt|nbsp);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeOfficialText(item)).filter(Boolean);
}

export function officialContentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function protectedTokens(value: string): string[] {
  return value.match(/\[\[CARD:[^\]]+\]\]|SEND TO POWER|[0-9０-９]+|★+/g) ?? [];
}

export function validateOfficialTranslation(source: string, translated: string): void {
  const sourceTokens = protectedTokens(source).sort();
  const translatedTokens = protectedTokens(translated).sort();
  if (JSON.stringify(sourceTokens) !== JSON.stringify(translatedTokens)) {
    throw new Error(
      `Official-rulings translation changed protected tokens: expected ${JSON.stringify(sourceTokens)}, received ${JSON.stringify(translatedTokens)}`,
    );
  }
}

export function normalizeQaRows(
  raw: unknown,
  options: { requireExplicitPublic?: boolean } = {},
): OfficialQaSnapshotRow[] {
  if (!Array.isArray(raw)) throw new Error('Official Q&A snapshot must be an array');
  const rows = raw
    .filter((item) => {
      if (!item || typeof item !== 'object') return false;
      if (!options.requireExplicitPublic) return true;
      return (item as { public?: unknown }).public === '公開';
    })
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        id: normalizeOfficialText(record.id),
        number: Number(record.number),
        date: normalizeOfficialText(record.date).slice(0, 10),
        question: normalizeOfficialText(record.question),
        answer: normalizeOfficialText(record.answer),
        tags: strings(record.tags),
        relatedCards: strings(record.relatedCards ?? record.card),
      };
    });

  const ids = new Set<string>();
  const numbers = new Set<number>();
  for (const row of rows) {
    if (!/^qa_\d+$/.test(row.id)) throw new Error(`Invalid official Q&A id: ${row.id || '(empty)'}`);
    if (!Number.isInteger(row.number) || row.number <= 0) throw new Error(`Invalid official Q&A number: ${row.number}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`Invalid official Q&A date: ${row.id}`);
    if (!row.question || !row.answer) throw new Error(`Official Q&A question/answer is empty: ${row.id}`);
    if (ids.has(row.id)) throw new Error(`Duplicate official Q&A id: ${row.id}`);
    if (numbers.has(row.number)) throw new Error(`Duplicate official Q&A number: ${row.number}`);
    ids.add(row.id);
    numbers.add(row.number);
  }
  return rows.sort((a, b) => a.number - b.number);
}

function staticTranslationText(value: unknown, label: string): string {
  const normalized = normalizeOfficialText(value);
  if (!normalized) throw new Error(`Official translation is empty: ${label}`);
  if (/ZXQ|⟦\s*(?:SEG|KEEP)|<script\b/i.test(String(value))) {
    throw new Error(`Official translation contains a generation artifact: ${label}`);
  }
  return normalized;
}

function validateStaticSymbols(source: string, translated: string, label: string) {
  const stars = (value: string) => (value.match(/★+/g) ?? []).map((token) => token.length).sort();
  const sendToPowerCount = (value: string) => value.match(/SEND TO POWER/g)?.length ?? 0;
  if (JSON.stringify(stars(source)) !== JSON.stringify(stars(translated))) {
    throw new Error(`Official translation changed ★ symbols: ${label}`);
  }
  if (sendToPowerCount(source) !== sendToPowerCount(translated)) {
    throw new Error(`Official translation changed SEND TO POWER tokens: ${label}`);
  }
}

export async function loadOfficialTranslationsSnapshot(
  path: string,
  sources: { qa: OfficialQaSnapshotRow[]; errata: OfficialErrataSnapshotRow[] },
): Promise<OfficialTranslationsSnapshot> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  if (parsed.schemaVersion !== 1) throw new Error('Official translations snapshot schemaVersion must be 1');
  const locales = Array.isArray(parsed.locales) ? parsed.locales.map(String) : [];
  if (JSON.stringify(locales) !== JSON.stringify(OFFICIAL_TRANSLATION_LOCALES)) {
    throw new Error(`Official translations locales must be ${OFFICIAL_TRANSLATION_LOCALES.join(', ')}`);
  }
  const qaRows = Array.isArray(parsed.qa) ? parsed.qa : [];
  const errataRows = Array.isArray(parsed.errata) ? parsed.errata : [];
  if (qaRows.length !== sources.qa.length || errataRows.length !== sources.errata.length) {
    throw new Error('Official translations snapshot does not cover every source row');
  }
  const qaSources = new Map(sources.qa.map((row) => [row.id, row]));
  const errataSources = new Map(sources.errata.map((row) => [row.errataId, row]));
  const qa = qaRows.map((value) => {
    const record = value as Record<string, unknown>;
    const id = normalizeOfficialText(record.id);
    const source = qaSources.get(id);
    if (!source) throw new Error(`Official translation references unknown Q&A: ${id}`);
    const sourceHash = normalizeOfficialText(record.sourceHash);
    if (sourceHash !== officialContentHash(qaHashInput(source))) {
      throw new Error(`Official Q&A translation is stale: ${id}`);
    }
    const rawTranslations = record.translations as Record<string, Record<string, unknown>>;
    const translations = Object.fromEntries(
      OFFICIAL_TRANSLATION_LOCALES.map((locale) => {
        const question = staticTranslationText(rawTranslations?.[locale]?.question, `${id} ${locale} question`);
        const answer = staticTranslationText(rawTranslations?.[locale]?.answer, `${id} ${locale} answer`);
        validateStaticSymbols(`${source.question}\n${source.answer}`, `${question}\n${answer}`, `${id} ${locale}`);
        return [locale, { question, answer }];
      }),
    ) as OfficialQaTranslationSeed['translations'];
    return { id, sourceHash, translations };
  });
  const errata = errataRows.map((value) => {
    const record = value as Record<string, unknown>;
    const errataId = normalizeOfficialText(record.errataId);
    const source = errataSources.get(errataId);
    if (!source) throw new Error(`Official translation references unknown errata: ${errataId}`);
    const sourceHash = normalizeOfficialText(record.sourceHash);
    if (sourceHash !== officialContentHash(errataHashInput(source))) {
      throw new Error(`Official errata translation is stale: ${errataId}`);
    }
    const rawTranslations = record.translations as Record<string, Record<string, unknown>>;
    const translations = Object.fromEntries(
      OFFICIAL_TRANSLATION_LOCALES.map((locale) => {
        const translation = {
          incorrectText: staticTranslationText(
            rawTranslations?.[locale]?.incorrectText,
            `${errataId} ${locale} incorrectText`,
          ),
          reason: staticTranslationText(rawTranslations?.[locale]?.reason, `${errataId} ${locale} reason`),
          replacementPolicy: staticTranslationText(
            rawTranslations?.[locale]?.replacementPolicy,
            `${errataId} ${locale} replacementPolicy`,
          ),
          usagePolicy: staticTranslationText(
            rawTranslations?.[locale]?.usagePolicy,
            `${errataId} ${locale} usagePolicy`,
          ),
        };
        validateStaticSymbols(
          [source.incorrectText, source.reason, source.replacementPolicy, source.usagePolicy].join('\n'),
          Object.values(translation).join('\n'),
          `${errataId} ${locale}`,
        );
        return [locale, translation];
      }),
    ) as OfficialErrataTranslationSeed['translations'];
    return { errataId, sourceHash, translations };
  });
  return {
    schemaVersion: 1,
    generatedAt: staticTranslationText(parsed.generatedAt, 'generatedAt'),
    provider: staticTranslationText(parsed.provider, 'provider'),
    locales: [...OFFICIAL_TRANSLATION_LOCALES],
    qa,
    errata,
  };
}

export function qaHashInput(row: OfficialQaSnapshotRow) {
  return {
    number: row.number,
    date: row.date,
    question: row.question,
    answer: row.answer,
    tags: row.tags,
    relatedCards: row.relatedCards,
  };
}

export function errataHashInput(row: OfficialErrataSnapshotRow) {
  return {
    publishedAt: row.publishedAt,
    cardId: row.cardId,
    cardNumber: row.cardNumber,
    incorrectText: row.incorrectText,
    correctedText: row.correctedText,
    reason: row.reason,
    replacementPolicy: row.replacementPolicy,
    usagePolicy: row.usagePolicy,
  };
}
