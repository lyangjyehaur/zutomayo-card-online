import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  applyCanonicalQaCardNames,
  errataHashInput,
  OFFICIAL_TRANSLATION_LOCALES,
  officialContentHash,
  parseOfficialTranslationsSnapshot,
  qaHashInput,
  referencedQaCardIds,
  type OfficialCanonicalCardNames,
  type OfficialErrataSnapshotRow,
  type OfficialQaSnapshotRow,
  type OfficialTranslationLocale,
  type OfficialTranslationsSnapshot,
} from './officialRulingsData';

const require = createRequire(import.meta.url);
const { fetchOfficialSourceSnapshot } = require('../api/officialRulingsSource.cjs') as {
  fetchOfficialSourceSnapshot: () => Promise<{
    qa: OfficialQaSnapshotRow[];
    errata: OfficialErrataSnapshotRow[];
  }>;
};

type PublicQaItem = {
  id: string;
  relatedCardIds: string[];
  source: { question: string; answer: string };
  localized: { question: string; answer: string };
  effectiveLocale: string;
};

type PublicErrataItem = {
  errataId: string;
  localized: { incorrectText: string; reason: string; replacementPolicy: string; usagePolicy: string };
  effectiveLocale: string;
};

type CardTexts = Record<
  string,
  Partial<Record<'ja' | OfficialTranslationLocale, { name: string; reviewStatus: string }>>
>;

const QUOTED_TEXT_PATTERN =
  /「([^」]+)」|『([^』]+)』|《([^》]+)》|〈([^〉]+)〉|【([^】]+)】|“([^”]+)”|‘([^’]+)’|"([^"]+)"|``([^']+)''|(?:^|[\s(])'([^'\n]{2,60})'(?=[\p{L}\s?!.,)]|$)|``([^`]+)``/gmu;

function option(name: string): string {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function apiUrl(base: string, pathname: string): string {
  return new URL(pathname, `${base.replace(/\/+$/, '')}/`).toString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Baseline request failed (${response.status}): ${url}`);
  return (await response.json()) as T;
}

function quotedValues(value: string): string[] {
  return [...value.matchAll(QUOTED_TEXT_PATTERN)].map((match) => match.slice(1).find(Boolean) || '').filter(Boolean);
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
}

function bigramSimilarity(left: string, right: string): number {
  const a = normalized(left);
  const b = normalized(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (value: string) => {
    if (value.length < 2) return [value];
    return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
  };
  const leftBigrams = bigrams(a);
  const rightBigrams = bigrams(b);
  const remaining = [...rightBigrams];
  let matches = 0;
  for (const gram of leftBigrams) {
    const index = remaining.indexOf(gram);
    if (index < 0) continue;
    matches += 1;
    remaining.splice(index, 1);
  }
  return (2 * matches) / (leftBigrams.length + rightBigrams.length);
}

export function inferCardNameAliases(
  qaByLocale: Record<OfficialTranslationLocale, PublicQaItem[]>,
  cardTexts: CardTexts,
): Map<string, string[]> {
  const counts = new Map<string, Map<string, number>>();
  const catalog = canonicalCatalog(cardTexts);
  for (const locale of OFFICIAL_TRANSLATION_LOCALES) {
    for (const item of qaByLocale[locale]) {
      const sourceQuotes = quotedValues(`${item.source.question}\n${item.source.answer}`);
      const translatedQuotes = quotedValues(`${item.localized.question}\n${item.localized.answer}`);
      const referencedCardIds = referencedQaCardIds({ ...item.source, relatedCards: item.relatedCardIds }, catalog);
      const occurrences = sourceQuotes.flatMap((value, sourceIndex) =>
        referencedCardIds
          .filter((cardId) => normalized(value) === normalized(cardTexts[cardId]?.ja?.name || ''))
          .map((cardId) => ({ cardId, sourceIndex })),
      );
      const assignedSources = new Set<number>();
      const assignedTargets = new Set<number>();
      const assignments: Array<{ cardId: string; alias: string }> = [];
      const assign = (occurrenceIndex: number, targetIndex: number) => {
        assignedSources.add(occurrenceIndex);
        assignedTargets.add(targetIndex);
        assignments.push({ cardId: occurrences[occurrenceIndex].cardId, alias: translatedQuotes[targetIndex] });
      };

      for (let occurrenceIndex = 0; occurrenceIndex < occurrences.length; occurrenceIndex += 1) {
        const canonicalName = cardTexts[occurrences[occurrenceIndex].cardId]?.[locale]?.name || '';
        const exactTarget = translatedQuotes.findIndex(
          (value, targetIndex) => !assignedTargets.has(targetIndex) && normalized(value) === normalized(canonicalName),
        );
        if (exactTarget >= 0) assign(occurrenceIndex, exactTarget);
      }

      const candidates = occurrences.flatMap((occurrence, occurrenceIndex) => {
        if (assignedSources.has(occurrenceIndex)) return [];
        const canonicalName = cardTexts[occurrence.cardId]?.[locale]?.name || '';
        return translatedQuotes.flatMap((alias, targetIndex) => {
          if (assignedTargets.has(targetIndex)) return [];
          const sourcePosition = (occurrence.sourceIndex + 0.5) / Math.max(sourceQuotes.length, 1);
          const targetPosition = (targetIndex + 0.5) / Math.max(translatedQuotes.length, 1);
          return [
            {
              occurrenceIndex,
              targetIndex,
              score: bigramSimilarity(canonicalName, alias) * 4 + 1 - Math.abs(sourcePosition - targetPosition),
            },
          ];
        });
      });
      candidates.sort((left, right) => right.score - left.score);
      for (const candidate of candidates) {
        if (assignedSources.has(candidate.occurrenceIndex) || assignedTargets.has(candidate.targetIndex)) continue;
        assign(candidate.occurrenceIndex, candidate.targetIndex);
      }

      for (const { cardId, alias } of assignments) {
        const key = `${locale}:${cardId}`;
        const aliases = counts.get(key) || new Map<string, number>();
        aliases.set(alias, (aliases.get(alias) || 0) + 1);
        counts.set(key, aliases);
      }
    }
  }
  return new Map(
    [...counts].map(([key, aliases]) => [
      key,
      [...aliases]
        .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
        .map(([alias]) => alias),
    ]),
  );
}

export function replaceQaCardNamesWithTokens(
  item: PublicQaItem,
  source: OfficialQaSnapshotRow,
  locale: OfficialTranslationLocale,
  cardTexts: CardTexts,
  aliases: Map<string, string[]>,
): { question: string; answer: string; replacements: number } {
  let question = item.localized.question;
  let answer = item.localized.answer;
  let replacements = 0;
  const sourceText = normalized(`${source.question}\n${source.answer}`);
  const referencedCardIds = referencedQaCardIds(source, canonicalCatalog(cardTexts));
  const operations = referencedCardIds.flatMap((cardId) => {
    const japaneseName = cardTexts[cardId]?.ja?.name || '';
    if (!japaneseName || !sourceText.includes(normalized(japaneseName))) return [];
    const canonicalName = cardTexts[cardId]?.[locale]?.name || '';
    if (!canonicalName) throw new Error(`Reviewed ${locale} card name is missing for ${cardId}`);
    const candidates = [...new Set([...(aliases.get(`${locale}:${cardId}`) || []), canonicalName])]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    return candidates.map((candidate) => ({ cardId, candidate }));
  });
  for (const { cardId, candidate } of operations) {
    const token = `[[CARD:${cardId}]]`;
    const questionCount = question.split(candidate).length - 1;
    const answerCount = answer.split(candidate).length - 1;
    if (questionCount > 0) question = question.replaceAll(candidate, token);
    if (answerCount > 0) answer = answer.replaceAll(candidate, token);
    replacements += questionCount + answerCount;
  }
  for (const cardId of referencedCardIds) {
    const japaneseName = cardTexts[cardId]?.ja?.name || '';
    if (!japaneseName || !sourceText.includes(normalized(japaneseName))) continue;
    if (!`${question}\n${answer}`.includes(`[[CARD:${cardId}]]`)) {
      throw new Error(`Could not identify the translated card-name alias for ${source.id}/${locale}/${cardId}`);
    }
  }
  return { question, answer, replacements };
}

function canonicalCatalog(cardTexts: CardTexts): OfficialCanonicalCardNames {
  return Object.fromEntries(
    Object.entries(cardTexts).map(([cardId, values]) => [
      cardId,
      {
        ja: values.ja?.name || '',
        translations: Object.fromEntries(
          OFFICIAL_TRANSLATION_LOCALES.map((locale) => [locale, values[locale]?.name || '']),
        ),
      },
    ]),
  ) as OfficialCanonicalCardNames;
}

export async function main() {
  const baselineApi = option('--baseline-api') || process.env.OFFICIAL_RULINGS_BASELINE_API_URL || '';
  const output = path.resolve(option('--output') || 'data/official-rulings-translations.json');
  if (!baselineApi) throw new Error('--baseline-api or OFFICIAL_RULINGS_BASELINE_API_URL is required');
  const base = new URL(baselineApi);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Baseline API must use HTTP or HTTPS');

  const [source, cardTexts, ...localePayloads] = await Promise.all([
    fetchOfficialSourceSnapshot(),
    fetchJson<CardTexts>(apiUrl(base.toString(), '/api/cards/texts?lang=zh-TW')),
    ...OFFICIAL_TRANSLATION_LOCALES.flatMap((locale) => [
      fetchJson<{ items: PublicQaItem[] }>(apiUrl(base.toString(), `/api/official/qa?lang=${locale}`)),
      fetchJson<{ items: PublicErrataItem[] }>(apiUrl(base.toString(), `/api/official/errata?lang=${locale}`)),
    ]),
  ]);
  const qaByLocale = {} as Record<OfficialTranslationLocale, PublicQaItem[]>;
  const errataByLocale = {} as Record<OfficialTranslationLocale, PublicErrataItem[]>;
  OFFICIAL_TRANSLATION_LOCALES.forEach((locale, index) => {
    qaByLocale[locale] = (localePayloads[index * 2] as { items: PublicQaItem[] }).items;
    errataByLocale[locale] = (localePayloads[index * 2 + 1] as { items: PublicErrataItem[] }).items;
  });
  const aliases = inferCardNameAliases(qaByLocale, cardTexts);
  let replacementCount = 0;
  const snapshot: OfficialTranslationsSnapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provider: 'reviewed-baseline-canonicalized',
    locales: [...OFFICIAL_TRANSLATION_LOCALES],
    qa: source.qa.map((row) => ({
      id: row.id,
      sourceHash: officialContentHash(qaHashInput(row)),
      translations: Object.fromEntries(
        OFFICIAL_TRANSLATION_LOCALES.map((locale) => {
          const item = qaByLocale[locale].find((candidate) => candidate.id === row.id);
          if (!item || item.effectiveLocale !== locale)
            throw new Error(`Baseline Q&A ${row.id}/${locale} is incomplete`);
          const translation = replaceQaCardNamesWithTokens(item, row, locale, cardTexts, aliases);
          replacementCount += translation.replacements;
          return [locale, { question: translation.question, answer: translation.answer }];
        }),
      ) as OfficialTranslationsSnapshot['qa'][number]['translations'],
    })),
    errata: source.errata.map((row) => ({
      errataId: row.errataId,
      sourceHash: officialContentHash(errataHashInput(row)),
      translations: Object.fromEntries(
        OFFICIAL_TRANSLATION_LOCALES.map((locale) => {
          const item = errataByLocale[locale].find((candidate) => candidate.errataId === row.errataId);
          if (!item || item.effectiveLocale !== locale) {
            throw new Error(`Baseline errata ${row.errataId}/${locale} is incomplete`);
          }
          return [locale, item.localized];
        }),
      ) as OfficialTranslationsSnapshot['errata'][number]['translations'],
    })),
  };
  const parsed = parseOfficialTranslationsSnapshot(JSON.stringify(snapshot), source);
  applyCanonicalQaCardNames(parsed, source.qa, canonicalCatalog(cardTexts));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, {
    flag: process.argv.includes('--force') ? 'w' : 'wx',
  });
  console.log(
    JSON.stringify({ output, qaCount: snapshot.qa.length, errataCount: snapshot.errata.length, replacementCount }),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
