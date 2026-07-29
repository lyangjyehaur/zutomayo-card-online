import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateCardDataset, type CardTranslationSnapshot } from './cardDatasetGate';
import type { CardDef } from '../src/game/types';

const DERIVED_LANGUAGES = ['zh-TW', 'zh-CN', 'zh-HK', 'ko'] as const;
const EXPECTED_PLAYABLE_CARD_COUNT = 479;
const EXPECTED_DISPLAY_ONLY_CARD_COUNT = 7;

type PublicCardText = {
  name?: unknown;
  effect?: unknown;
  reviewStatus?: unknown;
};

type PublicCardTexts = Record<string, Record<string, PublicCardText>>;

export function evaluateCatalogTranslations(
  catalogCards: ReadonlyArray<Pick<CardDef, 'id' | 'effect'>>,
  texts: PublicCardTexts,
) {
  const failures: string[] = [];
  let verifiedCatalogTranslationRows = 0;

  for (const card of catalogCards) {
    for (const lang of DERIVED_LANGUAGES) {
      const entry = texts[card.id]?.[lang];
      const validName = typeof entry?.name === 'string' && entry.name.trim() !== '';
      const validEffect = !card.effect.trim() || (typeof entry?.effect === 'string' && entry.effect.trim() !== '');
      const verified = entry?.reviewStatus === 'verified';
      if (validName && validEffect && verified) {
        verifiedCatalogTranslationRows += 1;
      } else {
        failures.push(`incomplete catalog translation: ${card.id}/${lang}`);
      }
    }
  }

  return {
    metrics: { verifiedCatalogTranslationRows },
    checks: { catalogTranslationsComplete: failures.length === 0 },
    failures,
  };
}

export function cardTextsToRows(texts: PublicCardTexts): CardTranslationSnapshot[] {
  return Object.keys(texts)
    .sort()
    .flatMap((cardId) =>
      DERIVED_LANGUAGES.map((lang) => {
        const entry = texts[cardId]?.[lang];
        return {
          cardId,
          lang,
          nameText: typeof entry?.name === 'string' ? entry.name : '',
          effectText: typeof entry?.effect === 'string' ? entry.effect : '',
          reviewStatus: typeof entry?.reviewStatus === 'string' ? entry.reviewStatus : '',
        };
      }),
    );
}

export function playableCardTextsToRows(
  texts: PublicCardTexts,
  playableCardIds: readonly string[],
): CardTranslationSnapshot[] {
  const playableIds = new Set(playableCardIds);
  return cardTextsToRows(texts).filter((row) => playableIds.has(row.cardId));
}

export function evaluatePublicCatalog(
  playableCards: ReadonlyArray<Pick<CardDef, 'id' | 'playStatus'>>,
  catalogCards: ReadonlyArray<Pick<CardDef, 'id' | 'playStatus'>>,
) {
  const failures: string[] = [];
  const playableIds = [...playableCards.map((card) => card.id)].sort();
  const catalogPlayableIds = catalogCards
    .filter((card) => card.playStatus === 'playable')
    .map((card) => card.id)
    .sort();
  const displayOnlyCards = catalogCards.filter((card) => card.playStatus === 'display_only');
  const uniqueCatalogIds = new Set(catalogCards.map((card) => card.id)).size === catalogCards.length;
  const playableCardsExcludedFromCatalogOnly = playableCards.every((card) => card.playStatus === 'playable');
  const playableCatalogMatches = JSON.stringify(catalogPlayableIds) === JSON.stringify(playableIds);
  const expectedDisplayOnlyCardCount = displayOnlyCards.length === EXPECTED_DISPLAY_ONLY_CARD_COUNT;
  const expectedCatalogCardCount =
    catalogCards.length === EXPECTED_PLAYABLE_CARD_COUNT + EXPECTED_DISPLAY_ONLY_CARD_COUNT;

  if (!uniqueCatalogIds) failures.push('catalog card IDs are not unique');
  if (!playableCardsExcludedFromCatalogOnly) failures.push('public battle cards contain non-playable entries');
  if (!playableCatalogMatches) failures.push('catalog playable cards do not match the public battle card pool');
  if (!expectedDisplayOnlyCardCount) {
    failures.push(`expected ${EXPECTED_DISPLAY_ONLY_CARD_COUNT} display-only cards, found ${displayOnlyCards.length}`);
  }
  if (!expectedCatalogCardCount) {
    failures.push(
      `expected ${EXPECTED_PLAYABLE_CARD_COUNT + EXPECTED_DISPLAY_ONLY_CARD_COUNT} catalog cards, found ${catalogCards.length}`,
    );
  }

  return {
    metrics: {
      catalogCards: catalogCards.length,
      displayOnlyCards: displayOnlyCards.length,
    },
    checks: {
      uniqueCatalogIds,
      playableCardsExcludedFromCatalogOnly,
      playableCatalogMatches,
      expectedDisplayOnlyCardCount,
      expectedCatalogCardCount,
    },
    failures,
  };
}

function apiBaseUrl(argv: string[]): URL {
  if (argv.length !== 2 || argv[0] !== '--base-url' || !argv[1]) {
    throw new Error('usage: npm run preflight:card-dataset -- --base-url https://host.example/api/');
  }
  const base = new URL(argv[1]);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('--base-url must use HTTP(S)');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return base;
}

async function fetchJson<T>(base: URL, endpoint: string): Promise<T> {
  const url = new URL(endpoint, base);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} failed with HTTP ${response.status}`);
  return (await response.json()) as T;
}

function gameSmoke(base: URL): { passed: boolean; output: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/game-smoke.ts'], {
    env: { ...process.env, CARD_API_URL: base.toString() },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    passed: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim().slice(-8_000),
  };
}

async function main(): Promise<void> {
  const base = apiBaseUrl(process.argv.slice(2));
  const [cards, catalogCards, texts, presetDecks, gameConfig] = await Promise.all([
    fetchJson<CardDef[]>(base, 'cards'),
    fetchJson<CardDef[]>(base, 'catalog/cards'),
    fetchJson<PublicCardTexts>(base, 'cards/texts'),
    fetchJson<Array<{ id: string; name: string; cardIds: string[] }>>(base, 'preset-decks'),
    fetchJson<Record<string, unknown>>(base, 'config'),
  ]);
  if (!Array.isArray(cards)) throw new Error('public cards response must be an array');
  if (!Array.isArray(catalogCards)) throw new Error('public catalog cards response must be an array');
  if (!texts || typeof texts !== 'object' || Array.isArray(texts)) {
    throw new Error('public card texts response must be an object');
  }
  const smoke = gameSmoke(base);
  const catalogReport = evaluatePublicCatalog(cards, catalogCards);
  const catalogTranslationReport = evaluateCatalogTranslations(catalogCards, texts);
  const report = evaluateCardDataset(
    {
      cards,
      translations: playableCardTextsToRows(
        texts,
        cards.map((card) => card.id),
      ),
      presetDecks,
      gameConfig,
    },
    { expectedCardCount: EXPECTED_PLAYABLE_CARD_COUNT, gameSmokePassed: smoke.passed },
  );
  const failures = [...report.failures, ...catalogReport.failures, ...catalogTranslationReport.failures];
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        evidenceType: 'card-dataset-preflight',
        releaseEvidence: false,
        source: base.toString(),
        status: failures.length === 0 ? 'passed' : 'failed',
        datasetSha256: report.datasetSha256,
        metrics: { ...report.metrics, ...catalogReport.metrics, ...catalogTranslationReport.metrics },
        checks: { ...report.checks, ...catalogReport.checks, ...catalogTranslationReport.checks },
        failures,
        gameSmokeOutput: smoke.output,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
