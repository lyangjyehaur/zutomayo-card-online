import { createHash } from 'node:crypto';
import type { CardDef } from '../src/game/types';

export type SeedCardDataRelease = {
  datasetSha256: string;
  extractionSha256: string;
  errataSha256: string;
  reviewProvenanceSha256: string;
  releaseSha: string;
  cardCount: number;
  errataCount: number;
};

const EMPTY_ERRATA_JSON = '[]';
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/;

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex');
}

export function createSeedCardDataRelease(
  cards: CardDef[],
  i18n: Record<string, Record<string, string>>,
  releaseSha?: string,
): SeedCardDataRelease {
  const cardsJson = JSON.stringify(cards);
  const i18nJson = JSON.stringify(i18n);
  const datasetSha256 = sha256(`${cardsJson}\0${i18nJson}\0${EMPTY_ERRATA_JSON}`);
  return {
    datasetSha256,
    extractionSha256: sha256(cardsJson),
    errataSha256: sha256(EMPTY_ERRATA_JSON),
    reviewProvenanceSha256: sha256(i18nJson),
    releaseSha: releaseSha && RELEASE_SHA_PATTERN.test(releaseSha) ? releaseSha : datasetSha256.slice(0, 40),
    cardCount: cards.length,
    errataCount: 0,
  };
}

export function validateSeedCardDataRelease(
  value: unknown,
  cards: CardDef[],
  i18n: Record<string, Record<string, string>>,
): SeedCardDataRelease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<SeedCardDataRelease>;
  if (typeof candidate.releaseSha !== 'string' || !RELEASE_SHA_PATTERN.test(candidate.releaseSha)) return null;
  const expected = createSeedCardDataRelease(cards, i18n, candidate.releaseSha);
  return Object.entries(expected).every(
    ([key, expectedValue]) => candidate[key as keyof SeedCardDataRelease] === expectedValue,
  )
    ? expected
    : null;
}
