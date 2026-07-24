import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateCardDataset, type CardTranslationSnapshot } from './cardDatasetGate';
import type { CardDef } from '../src/game/types';

const DERIVED_LANGUAGES = ['zh-TW', 'zh-CN', 'zh-HK', 'ko'] as const;

type PublicCardText = {
  name?: unknown;
  effect?: unknown;
  reviewStatus?: unknown;
};

type PublicCardTexts = Record<string, Record<string, PublicCardText>>;

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
  const [cards, texts, presetDecks, gameConfig] = await Promise.all([
    fetchJson<CardDef[]>(base, 'cards'),
    fetchJson<PublicCardTexts>(base, 'cards/texts'),
    fetchJson<Array<{ id: string; name: string; cardIds: string[] }>>(base, 'preset-decks'),
    fetchJson<Record<string, unknown>>(base, 'config'),
  ]);
  if (!Array.isArray(cards)) throw new Error('public cards response must be an array');
  if (!texts || typeof texts !== 'object' || Array.isArray(texts)) {
    throw new Error('public card texts response must be an object');
  }
  const smoke = gameSmoke(base);
  const report = evaluateCardDataset(
    { cards, translations: cardTextsToRows(texts), presetDecks, gameConfig },
    { expectedCardCount: 422, gameSmokePassed: smoke.passed },
  );
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        evidenceType: 'card-dataset-preflight',
        releaseEvidence: false,
        source: base.toString(),
        status: report.failures.length === 0 ? 'passed' : 'failed',
        datasetSha256: report.datasetSha256,
        metrics: report.metrics,
        checks: report.checks,
        failures: report.failures,
        gameSmokeOutput: smoke.output,
      },
      null,
      2,
    ),
  );
  if (report.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
